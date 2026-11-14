(function () {
  'use strict';

  const app = document.getElementById('app');
  const topbar = document.getElementById('topbar');
  const dialog = document.getElementById('dialog');
  const nav = document.getElementById('nav');
  let me = null;
  let cleanups = [];
  let unreadTimer = null;
  const onCleanup = (fn) => cleanups.push(fn);

  // ---------- helpers ----------
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const pad2 = (n) => String(n).padStart(2, '0');
  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  };
  const addDays = (s, n) => Charts.dayStr(Charts.dayNum(s) + n);
  const daysBetween = (a, b) => Charts.dayNum(b) - Charts.dayNum(a);

  const num = (v, d = 0) =>
    v === null || v === undefined || Number.isNaN(v)
      ? '–'
      : Number(v).toLocaleString((window.I18N ? I18N.locale : 'de-DE'), { minimumFractionDigits: d, maximumFractionDigits: d });

  const signed = (v, d = 1) => (v > 0 ? '+' : v < 0 ? '−' : '±') + num(Math.abs(v), d);

  function fmtSleep(h) {
    if (h === null || h === undefined) return '–';
    const total = Math.round(h * 60);
    return `${Math.floor(total / 60)}:${pad2(total % 60)} h`;
  }

  function fmtDate(s, opts) {
    return new Date(`${s}T12:00:00`).toLocaleDateString((window.I18N ? I18N.locale : 'de-DE'), opts || { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function relDay(s) {
    if (!s) return 'noch nie';
    const d = daysBetween(s, todayStr());
    if (d <= 0) return 'heute';
    if (d === 1) return 'gestern';
    return `vor ${d} Tagen`;
  }

  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

  function parseNum(v) {
    const t = String(v ?? '').trim().replace(',', '.');
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : NaN;
  }

  function randomPassword() {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const buf = new Uint32Array(12);
    crypto.getRandomValues(buf);
    return Array.from(buf, (x) => chars[x % chars.length]).join('');
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Fehler ${res.status}`);
      err.status = res.status;
      if (res.status === 401 && me && url !== '/api/login') {
        me = null;
        route();
      }
      throw err;
    }
    return data;
  }

  let toastTimer;
  function toast(msg, isError) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = isError ? 'toast error-toast' : 'toast';
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 3200);
  }

  /** Opens a modal form. `onSubmit(form)` may throw to show an error; return false to keep it open. */
  function openDialog(html, onSubmit) {
    dialog.innerHTML = `<form method="dialog" novalidate>${html}<p class="error" hidden></p></form>`;
    const form = dialog.querySelector('form');
    const errEl = form.querySelector('.error');
    form.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dialog.close()));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errEl.hidden = true;
      const btn = form.querySelector('[type=submit]');
      if (btn) btn.disabled = true;
      try {
        const keep = await onSubmit(form);
        if (keep !== false) dialog.close();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
      } finally {
        if (btn) btn.disabled = false;
      }
    });
    dialog.showModal();
    const first = form.querySelector('input, textarea');
    if (first) first.focus();
  }

  /**
   * Left column on wide screens: scrolls with the page until its bottom (e.g. the save button) is visible,
   * then stays there. Short columns simply stay at the top.
   */
  function stickyColumn(el) {
    if (!el) return;
    const update = () => {
      const gap = 16;
      const header = topbar.offsetHeight || 60;
      el.style.top = `${Math.min(header + gap, window.innerHeight - el.offsetHeight - gap)}px`;
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    onCleanup(() => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    });
  }

  /** Small brass line above page titles, e.g. "Mittwoch, 11. November". */
  const todayLong = () => new Date().toLocaleDateString((window.I18N ? I18N.locale : 'de-DE'), { weekday: 'long', day: 'numeric', month: 'long' });
  const eyebrow = (text) => `<p class="eyebrow">${esc(text)}</p>`;

  /** Greeting by time of day: morning until 11, midday until 14, afternoon until 18, evening until 23. */
  function greeting(date = new Date()) {
    const h = date.getHours();
    if (h >= 5 && h < 11) return 'Guten Morgen';
    if (h >= 11 && h < 14) return 'Guten Mittag';
    if (h >= 14 && h < 18) return 'Schönen Nachmittag';
    if (h >= 18 && h < 23) return 'Guten Abend';
    return 'Gute Nacht';
  }

  /** "Highlights of your week" list (only rendered when there is something to celebrate). */
  function highlightsHtml(list, title) {
    if (!list || !list.length) return '';
    return `<div class="highlights"><div class="highlights-title">✨ ${esc(title)}</div>
      <ul>${list.map((h) => `<li><span class="hl-icon" aria-hidden="true">${h.icon}</span><span>${esc(h.text)}</span></li>`).join('')}</ul></div>`;
  }

  // ---------- client categories (coach only) ----------
  const CATEGORIES = { diet: 'Diät', reverse: 'Reverse Diät', build: 'Aufbau', maintenance: 'Maintenance' };
  const catTag = (c) => (c && CATEGORIES[c] ? `<span class="cat cat-${c}">${CATEGORIES[c]}</span>` : '');

  // ---------- "Gespeichert" confirmation in the middle of the screen ----------
  let hudTimer;
  function savedHud(text = 'Gespeichert', sub = '') {
    let hud = document.getElementById('saved-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'saved-hud';
      hud.className = 'saved-hud';
      hud.setAttribute('role', 'status');
      hud.setAttribute('aria-live', 'assertive');
      document.body.appendChild(hud);
    }
    hud.innerHTML = `<div class="saved-box">
        <svg viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="23"/><path d="M15 27.5l7.5 7.5L37.5 19"/></svg>
        <strong>${esc(text)}</strong>${sub ? `<span>${esc(sub)}</span>` : ''}
      </div>`;
    hud.classList.remove('show');
    void hud.offsetWidth; // restart the animation
    hud.classList.add('show');
    clearTimeout(hudTimer);
    hudTimer = setTimeout(() => hud.classList.remove('show'), 1600);
  }


  // ---------- "What's new" on app start after every update (remembered on the server) ----------
  // EVERY UPDATE: add a new entry at the TOP with a new id. People who missed several updates see all
  // of them (newest first); once dismissed it does not come back on any device.
  const CHANGELOG = [
    {
      id: '2026-11-shop-cosmic', date: 'November 2026',
      client: [
        ['🌌', 'Zwei neue Seltenheiten', 'Neu im Shop: „Ungewöhnlich“ und ganz oben „Kosmisch“ – mit eigener Kaufanimation zwischen Sternen und Planeten.'],
        ['🛒', '13 neue Produkte', 'Unter anderem ESN Designer Whey, Isoclear, Crank, Flexpresso, Designer Bar, MORE Matcha, MORE Zero Sirup, der Goldene Shaker und der Galaxy Shaker. Der Shop ist jetzt nach Seltenheit sortiert.'],
        ['🏅', 'Deine Vitrine', 'Wähle in der Hall of Fame bis zu drei erreichte Medaillen für dein Profil. Deine Head2Head-Gegner sehen sie.'],
      ],
      coach: [
        ['🌌', 'Shop: 2 Seltenheiten, 13 Produkte', 'Ungewöhnlich und Kosmisch, neue Formen (Proteindose, Shaker, Riegel, Flasche, Beutel) und mehr Animation – probier sie im Test-Kühlschrank aus.'],
        ['🏅', 'Medaillen-Vitrine', 'Klienten können bis zu drei erreichte Medaillen ins Profil stellen; im Head2Head sehen sich die Spieler gegenseitig.'],
      ],
    },
    {
      id: '2026-11-google-health', date: 'November 2026',
      client: [
        ['🔗', 'Google Health verbinden', 'Unter Einstellungen kannst du Google Health verbinden. Dann kommen deine Schritte und dein Schlaf automatisch in den Tracker – von Fitbit, Pixel Watch oder Apps über Health Connect. Kein Abtippen mehr.'],
      ],
      coach: [
        ['🔗', 'Google Health', 'Klienten können Google Health verbinden; Schritte und Schlaf werden alle 2 Stunden übernommen. Im Klientenprofil siehst du, wer verbunden ist. Einrichtung: siehe README (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET).'],
      ],
    },
    {
      id: '2026-11-pdf-reports', date: 'November 2026',
      client: [
        ['📄', 'Berichte als PDF', 'Deinen Ernährungsplan und jeden Wochen-Check-in gibt es jetzt als schön gestaltetes PDF – zum Herunterladen in der App und automatisch per E-Mail. Abbestellen kannst du die Mails unter Einstellungen.'],
        ['✉️', 'Neues E-Mail-Design', 'Mails von StayOnTrack sehen jetzt ruhiger und moderner aus – auch im Dunkelmodus.'],
      ],
      coach: [
        ['📄', 'PDF-Berichte & automatische Mails', 'Jeder Check-in geht automatisch per E-Mail an den Klienten – mit Kennzahlen im Vergleich zur Vorwoche und dem PDF-Bericht (Kommentar, Diagramme, alle Tage). Den Ernährungsplan kannst du im Ernährungs-Tab als PDF laden oder per Mail schicken; nach einem KI-Entwurf geht er automatisch raus. Nur an bestätigte Adressen.'],
      ],
    },
    {
      id: '2026-11-mail-check', date: 'November 2026',
      client: [],
      coach: [
        ['✉️', 'E-Mail-Versand prüfen', 'Im Admin-Tool zeigt „E-Mail-Versand“ jetzt Dienst und Absender, warnt bei einem Beispiel-Absender und schickt auf Knopfdruck eine Test-Mail – mit der genauen Fehlermeldung, falls etwas nicht stimmt.'],
      ],
    },
    {
      id: '2026-11-h2h-token', date: 'November 2026',
      client: [
        ['🪙', 'Head2Head-Sieg = 1 Token', 'Jedes gewonnene Duell bringt dir 1 Token für den Kühlschrank-Shop. Den letzten Tag kannst du noch bis zum nächsten Tag nachtragen, dann steht der Endstand fest.'],
        ['🔢', 'Passwort vergessen? Jetzt mit Code', 'Du bekommst einen 6-stelligen Code per E-Mail, gibst ihn direkt in der App ein und legst dort dein neues Passwort fest.'],
      ],
      coach: [
        ['🪙', 'Head2Head-Siege bringen Token', 'Jedes gewonnene Duell zählt 1 Token im Shop (Endstand wird einen Tag nach Ende festgeschrieben).'],
        ['✉️', 'Neues E-Mail-Design, Reset per Code', 'Mails kommen jetzt im StayOnTrack-Look. Zum Zurücksetzen gibt es einen 6-stelligen Code (15 Minuten, 5 Versuche) statt eines Links.'],
      ],
    },
    {
      id: '2026-11-email-h2h', date: 'November 2026',
      client: [
        ['⚔️', 'Head2Head', 'Fordere andere heraus: Schritte, Trainingstage, Schlaf, Kalorienziel oder Gewicht verlieren (in %), 1–4 Wochen. Unter Konto → Head2Head einschalten – nur wer mitmacht, ist sichtbar, und verglichen wird nur die Disziplin des Duells.'],
        ['✉️', 'Anmelden mit E-Mail', 'Hinterlege unter Konto deine E-Mail-Adresse. Dann kannst du dich damit anmelden und ein vergessenes Passwort selbst zurücksetzen.'],
      ],
      coach: [
        ['✉️', 'E-Mail-Login & Passwort zurücksetzen', 'Beim Anlegen oder unter „Zugang verwalten“ kannst du die E-Mail-Adresse eines Klienten hinterlegen. Nach Bestätigung per Link kann er sich damit anmelden und sein Passwort selbst zurücksetzen. Dafür braucht der Server einen E-Mail-Versand (siehe README).'],
        ['⚔️', 'Head2Head für Klienten', 'Klienten können sich gegenseitig herausfordern und ihre Fortschritte vergleichen – freiwillig, nur mit der Disziplin des Duells, Gewicht nur in Prozent.'],
      ],
    },
    {
      id: '2026-11-barcode-db', date: 'November 2026',
      client: [
        ['📦', 'Scanner kennt jetzt über 320.000 Produkte', 'Fast alles aus deutschen, österreichischen und Schweizer Supermärkten wird beim Scannen sofort erkannt – mit Kalorien und Makros. Was fehlt, trägst du einmal ein; danach erkennt der Scanner es.'],
        ['🔎', 'Markenprodukte suchen', 'In der Suche findest du jetzt auch Markenprodukte, z. B. „Ehrmann Protein“ oder „Barebells“.'],
        ['💪', 'Mehr Fitness-Lebensmittel', 'Neue Kategorie Fitness & Sporternährung: Whey, Isolat, Proteinbrot, Shirataki, Reiswaffeln und vieles mehr – rund 600 Lebensmittel insgesamt.'],
      ],
      coach: [
        ['📦', 'Barcode-Datenbank mit 320.000 Produkten', 'Der Scanner sucht zuerst in einer mitgelieferten Open-Food-Facts-Datenbank (DE/AT/CH), dann online. Unbekannte Produkte, die ein Klient einträgt, werden für den nächsten Scan gemerkt.'],
        ['💪', 'Fitness & Sporternährung', 'Die Lebensmittel-Datenbank hat jetzt rund 600 Einträge, davon über 120 neue mit Fitness-Fokus.'],
      ],
    },
    {
      id: '2026-11-food-diary', date: 'November 2026',
      client: [
        ['📷', 'Ernährungstagebuch mit Barcode-Scanner', 'Unter Ernährung → Tagebuch trägst du ein, was du isst – Packung scannen, aus der Datenbank wählen oder selbst eintragen. Kalorien und Makros werden mitgezählt, die Tageskalorien landen automatisch im Tracker.'],
        ['🥩', 'Makros im Ernährungsplan', 'Zu jedem Lebensmittel, jeder Mahlzeit und dem ganzen Tag siehst du jetzt Eiweiß, Kohlenhydrate und Fett.'],
        ['🥦', 'Fast 5× so viele Lebensmittel', 'Die Datenbank hat jetzt rund 470 Lebensmittel, alle mit Makros.'],
      ],
      coach: [
        ['📷', 'Ernährungstagebuch', 'Klienten führen jetzt ein Tagebuch mit Barcode-Scanner (Daten: Open Food Facts). Du siehst es im Ernährungs-Tab des Klienten – nur lesend.'],
        ['🥩', 'Makros & Makroziele', 'Pläne zeigen Eiweiß, Kohlenhydrate und Fett pro Lebensmittel, Mahlzeit und Tag. Im Ernährungs-Tab legst du Makroziele fest; der KI-Entwurf berücksichtigt sie.'],
        ['🥦', 'Lebensmittel-Datenbank ×5', 'Rund 470 Lebensmittel mit Makros statt 99. Eigene Lebensmittel kannst du um Makros ergänzen.'],
      ],
    },
    {
      id: '2026-11-motion-soldout', date: 'November 2026',
      client: [
        ['🏷️', 'Sold out', 'Jedes Getränk gibt es einmal: Nach dem Kauf ist es im Shop ausverkauft.'],
        ['✨', 'Sanftere Übergänge', 'Seiten, Fenster und Fortschrittsanzeigen gleiten jetzt ruhig ins Bild.'],
      ],
      coach: [
        ['🏷️', 'Sold out im Shop', 'Jedes Getränk kann ein Klient nur einmal kaufen – im Test-Kühlschrank kannst du es durch Leeren zurückholen.'],
        ['✨', 'Sanftere Übergänge', 'Seiten, Fenster und Fortschrittsanzeigen gleiten jetzt ruhig ins Bild.'],
      ],
    },
    {
      id: '2026-11-coach-fridge', date: 'November 2026',
      client: [],
      coach: [
        ['🧪', 'Dein Test-Kühlschrank', 'Unter Konto → Test-Kühlschrank: Kühlschrank und Shop nur für dich, alles gratis. Probier Seltenheiten und Kaufanimationen aus und leere ihn jederzeit wieder.'],
      ],
    },
    {
      id: '2026-11-buy-fx', date: 'November 2026',
      client: [
        ['🎆', 'Große Kaufanimation', 'Jeder Kauf im Shop wird gefeiert – je seltener das Getränk, desto spektakulärer.'],
        ['⚖️', 'Faire Token', 'Fällt eine Medaille durch eine Korrektur weg, verschwindet auch das, was du mit ihren Token gekauft hast.'],
      ],
      coach: [
        ['🎆', 'Kaufanimation im Shop', 'Klienten sehen beim Kauf eine Vollbild-Animation, die mit der Seltenheit wächst.'],
        ['⚖️', 'Kein Token-Trick mehr', 'Korrigiert ein Klient Werte und verliert dadurch eine Medaille, wird der Kauf damit zurückgenommen.'],
      ],
    },
    {
      id: '2026-11-mythic', date: 'November 2026',
      client: [
        ['🥤', 'Neu im Shop', "Ein McDonald's Becher (legendär) und als erste mythische Belohnung ein Vial Testosteron-Öl."],
      ],
      coach: [
        ['🥤', 'Neu im Shop', "McDonald's Becher (legendär) und Vial Testosteron-Öl (mythisch, neue höchste Seltenheit)."],
      ],
    },
    {
      id: '2026-11-fridge-name', date: 'November 2026',
      client: [
        ['🧊', 'Dein eigener Kühlschrank', 'Auf der Tür deines Kühlschranks steht jetzt dein Name – in Pixel-Schrift.'],
      ],
      coach: [
        ['🧊', 'Kühlschrank mit Namen', 'Jeder Kühlschrank trägt jetzt den Namen des Klienten auf der Tür, z. B. „CLAUDE’S FRIDGE“.'],
      ],
    },
    {
      id: '2026-11-sicherheit', date: 'November 2026',
      client: [],
      coach: [
        ['🔒', 'Mehr Sicherheit', 'Besserer Schutz gegen Passwort-Raten beim Login. Automatische KI-Entwürfe und Push-Nachrichten bei Plan-Anfragen sind begrenzt, damit niemand dein KI-Guthaben aufbrauchen kann.'],
      ],
    },
    {
      id: '2026-11-ki-vorgaben', date: 'November 2026',
      client: [],
      coach: [
        ['✦', 'KI-Vorgaben', 'Im Admin-Tool legst du fest, was die KI in welche Mahlzeit packt – z. B. kein warmes Hauptgericht zum Frühstück. Beim Entwurf kannst du zusätzlich einen einmaligen Hinweis mitgeben.'],
      ],
    },
    {
      id: '2026-11-ki-token', date: 'November 2026',
      client: [
        ['🪙', 'Medaillen sind jetzt Token wert', 'Bronze 1, Silber 2, Gold 3 Token – im Shop tauschst du sie gegen Dosen.'],
        ['🍽', 'Ernährungsplan anfragen', 'Noch kein Plan? Unter „Ernährung“ beantwortest du ein paar Fragen und dein Coach erstellt deinen Plan.'],
        ['ℹ️', 'Übungen erklärt', 'Tippe im Trainingsplan auf „i“ neben einer Übung: Fotos, Ausführung und Tipp.'],
        ['💎', 'Seltene Dosen', 'Dosen haben jetzt Seltenheiten – die seltensten stehen im Kühlschrank ganz oben.'],
      ],
      coach: [
        ['✦', 'KI-Überblick im Check-in', 'Auf Knopfdruck eine kurze Zusammenfassung der Woche – nur wenn du sie anforderst.'],
        ['🤖', 'KI-Entwurf für Ernährungspläne', 'Fragt ein Klient einen Plan an, liegt ein Entwurf bereit. Du prüfst, änderst und schickst ihn ab.'],
        ['🍽', 'Plan-Anfragen', 'Klienten ohne Plan schicken dir ihre Vorlieben – mit eigener Aufgabe im Dashboard.'],
        ['🏋️', 'Trainingsvorlagen', 'Alle Vorlagen mit 2–3 Sätzen und 6–10 Wiederholungen, jede Übung mit Anleitung und Fotos.'],
      ],
    },
    {
      id: '2026-11-stayontrack', date: 'November 2026',
      client: [
        ['✨', 'Neuer Name: StayOnTrack', 'Mit neuem, schlichtem Logo.'],
        ['🌍', 'Sprache & Erscheinungsbild', 'In den Einstellungen: Deutsch, Englisch, Spanisch oder Italienisch – und Hell, Dunkel oder wie das System.'],
        ['🫧', 'Liquid Glass', 'Optional in den Einstellungen: gläserne Leisten und Menüs wie im aktuellen iOS.'],
        ['🧊', 'Kühlschrank & Shop', 'Hall of Fame jetzt unter Konto, mit Kühlschrank und Shop.'],
      ],
      coach: [
        ['✨', 'Neuer Name: StayOnTrack', 'Mit neuem, schlichtem Logo.'],
        ['🌍', 'Sprache & Erscheinungsbild', 'Unter Konto: Deutsch, Englisch, Spanisch oder Italienisch – und Hell, Dunkel oder wie das System.'],
        ['🫧', 'Liquid Glass', 'Optional unter Konto: gläserne Leisten und Menüs wie im aktuellen iOS.'],
        ['⏸️', 'Apple Health', 'Apple Health ist vorerst deaktiviert.'],
      ],
    },
    {
      id: '2026-11-training-hof', date: 'November 2026',
      client: [
        ['🏋️', 'Trainingsplan', 'Neuer Tab „Training“: Split wählen, Übungen anpassen und Gewichte tracken.'],
        ['🏆', 'Hall of Fame', 'Medaillen in Bronze, Silber und Gold für deine Erfolge.'],
      ],
      coach: [
        ['🏋️', 'Trainingspläne', 'Neuer Tab beim Klienten: Plan ansehen, bearbeiten und Trainingshistorie je Übung.'],
        ['🏆', 'Hall of Fame', 'Beim Klienten: seine Medaillen und wie nah er an den nächsten ist.'],
      ],
    },
  ];
  const RELEASE = CHANGELOG[0].id;
  let whatsNewChecked = false;
  async function maybeShowWhatsNew() {
    if (whatsNewChecked || !me) return;
    whatsNewChecked = true;
    if (me.seenRelease === undefined) {
      try {
        me = (await api('GET', '/api/me')).user;
      } catch {
        return;
      }
    }
    if (me.seenRelease === RELEASE) return;
    // everything since the last update this person saw (unknown / none: the last three updates)
    const seenAt = CHANGELOG.findIndex((r) => r.id === me.seenRelease);
    const missed = CHANGELOG.slice(0, seenAt === -1 ? 3 : seenAt);
    const role = me.role === 'coach' ? 'coach' : 'client';
    const items = missed.flatMap((r) => r[role]).slice(0, 10);
    if (!items.length) {
      // nothing new for this role: just remember the update silently
      me.seenRelease = RELEASE;
      api('POST', '/api/me/release', { release: RELEASE }).catch(() => {});
      return;
    }
    const dlg = document.createElement('dialog');
    dlg.className = 'whats-new';
    dlg.setAttribute('aria-labelledby', 'wn-title');
    dlg.innerHTML = `
      <div class="wn-head"><span class="wn-badge">Neu</span><h2 id="wn-title">Das ist neu</h2>
        ${missed.length > 1 ? `<p class="muted small" style="margin:0">${missed.length} Updates seit deinem letzten Besuch</p>` : ''}</div>
      <ul class="wn-list">${items.map(([icon, title, text]) => `<li><span class="wn-icon" aria-hidden="true">${icon}</span><div><strong>${esc(title)}</strong><p>${esc(text)}</p></div></li>`).join('')}</ul>
      <div class="wn-actions">
        ${me.role === 'coach' ? '' : '<button type="button" class="btn-secondary" data-wn-go>Zum Shop</button>'}
        <button type="button" class="btn-primary" data-wn-ok>Verstanden</button>
      </div>`;
    document.body.appendChild(dlg);
    let done = false;
    const dismiss = (go) => {
      if (done) return;
      done = true;
      me.seenRelease = RELEASE;
      api('POST', '/api/me/release', { release: RELEASE }).catch(() => {});
      dlg.close();
      dlg.remove();
      if (go) location.hash = '#/account/fame/shop';
    };
    dlg.querySelector('[data-wn-ok]').addEventListener('click', () => dismiss(false));
    const go = dlg.querySelector('[data-wn-go]');
    if (go) go.addEventListener('click', () => dismiss(true));
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      dismiss(false);
    });
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dismiss(false); // tap on the backdrop
    });
    dlg.showModal();
    dlg.querySelector('[data-wn-ok]').focus({ preventScroll: true });
    dlg.scrollTop = 0;
  }

  // ---------- routing ----------
  async function boot() {
    try {
      me = (await api('GET', '/api/me')).user;
    } catch {
      me = null;
    }
    if (me) applyPrefs(me.prefs);
    try {
      await route();
    } finally {
      hideSplash();
    }
    setTimeout(maybeShowWhatsNew, 450);
  }

  /** Start screen with the logo (in index.html) – fades out once the first page is ready. */
  function hideSplash() {
    const splash = document.getElementById('splash');
    if (!splash) return;
    splash.classList.add('hide');
    setTimeout(() => splash.remove(), 400);
  }

  /** Placeholder while a page loads: the small pulsing logo instead of an empty page. */
  const LOGO = '<svg class="logo-mark" viewBox="0 0 64 64" aria-hidden="true"><rect class="lm-tile" width="64" height="64" rx="18"/><circle cx="32" cy="32" r="17" fill="none" stroke-width="7" stroke-linecap="round" stroke-dasharray="86.04 106.81" transform="rotate(-10 32 32)" class="lm-ring"/><circle cx="44.02" cy="19.98" r="5.2" class="lm-dot"/></svg>';
  const LOADING = '<div class="page-loading" role="status" aria-label="Lädt">' + LOGO + '<span></span></div>';

  // Page transition: content rises in briefly when the screen changes – not when the same screen redraws
  // (e.g. after an action), so frequent interactions stay calm.
  let lastViewKey = null;
  function setView(html) {
    cleanups.forEach((fn) => fn());
    cleanups = [];
    app.innerHTML = html;
    window.scrollTo(0, 0);
    const key = location.hash.split('?')[0];
    const isLoader = html === LOADING;
    if (key !== lastViewKey || app.dataset.loading === '1') {
      app.classList.remove('view-enter');
      void app.offsetWidth; // restart the entrance animation
      app.classList.add('view-enter');
      // only the first appearance animates; later redraws inside the screen stay still
      clearTimeout(setView.enterTimer);
      setView.enterTimer = setTimeout(() => app.classList.remove('view-enter'), 750);
    }
    app.dataset.loading = isLoader ? '1' : '';
    if (!isLoader) lastViewKey = key;
  }

  function route() {
    // links from e-mails work with or without being logged in
    const verify = location.hash.match(/^#\/verify\/([a-f0-9]{64})$/);
    if (verify) return renderVerifyEmail(verify[1]);
    if (!me) {
      topbar.hidden = true;
      clearInterval(unreadTimer);
      unreadTimer = null;
      return renderLogin();
    }
    topbar.hidden = false;
    renderUserBadge();
    if (location.hash === '#/fame') return location.replace('#/account/fame');
    if (location.hash.startsWith('#/account')) {
      renderNav();
      if (!unreadTimer) unreadTimer = setInterval(refreshUnread, 30000);
      refreshUnread();
      const duel = location.hash.match(/^#\/account\/h2h(?:\/(\d+))?$/);
      if (duel && me.role === 'client') return renderAccount(null, { h2h: duel[1] ? Number(duel[1]) : true });
      const fame = location.hash.match(/^#\/account\/fame(?:\/(fridge|shop))?$/);
      // coaches have no medals: their "Hall of Fame" is just the free test fridge
      return renderAccount(fame ? fame[1] || (me.role === 'coach' ? 'fridge' : 'medals') : null);
    }
    renderNav();
    if (!unreadTimer) unreadTimer = setInterval(refreshUnread, 30000);
    refreshUnread();
    const m = location.hash.match(/^#\/client\/(\d+)(?:\/(chat|nutrition|fame(?:\/fridge)?|training(?:\/history)?))?/);
    if (me.role === 'coach') {
      if (m) return renderCoachClient(Number(m[1]), m[2] || 'overview');
      if (location.hash === '#/admin') return renderAdmin();
      const inbox = location.hash.match(/^#\/messages(?:\/(\d+))?$/);
      if (inbox) return renderInbox(inbox[1] ? Number(inbox[1]) : null);
      if (location.hash === '#/checkin/done') return renderCheckinDone();
      const ci = location.hash.match(/^#\/checkin(?:\/(\d+))?/);
      if (ci) return renderCheckin(ci[1] ? Number(ci[1]) : null);
      return renderCoachHome();
    }
    if (location.hash === '#/chat') return renderClientChat();
    const settings = location.hash.match(/^#\/settings(?:\/(.+))?$/);
    if (settings) return renderClientSettings(settings[1]);
    if (location.hash === '#/nutrition') return renderClientNutrition();
    if (location.hash === '#/nutrition/diary') return renderFoodDiary();
    if (location.hash === '#/training' || location.hash === '#/training/history') return renderClientTraining(location.hash === '#/training/history');
    return renderClientHome();
  }

  function renderNav() {
    const links =
      me.role === 'coach'
        ? [['#/', 'Klienten', false], ['#/messages', 'Nachrichten', true], ['#/checkin', 'Check-in', false], ['#/admin', 'Admin', false]]
        : [['#/', 'Tracker', false], ['#/training', 'Training', false], ['#/nutrition', 'Ernährung', false], ['#/chat', 'Nachrichten', true], ['#/settings', 'Einstellungen', false]];
    let current =
      me.role === 'coach'
        ? location.hash.startsWith('#/checkin') ? '#/checkin' : location.hash.startsWith('#/messages') ? '#/messages' : location.hash === '#/admin' ? '#/admin' : '#/'
        : location.hash.startsWith('#/training') ? '#/training' : location.hash.startsWith('#/nutrition') ? '#/nutrition' : location.hash.startsWith('#/settings') ? '#/settings' : location.hash === '#/chat' ? '#/chat' : '#/';
    if (location.hash.startsWith('#/account')) current = null; // the account page lives in the profile menu
    nav.innerHTML = links
      .map(
        ([href, label, badge]) =>
          `<a href="${href}"${href === current ? ' aria-current="page"' : ''}><span class="nav-icon">${NAV_ICONS[label] || ''}${badge ? '<span class="count" data-unread hidden></span>' : ''}</span><span class="nav-label">${label}</span></a>`
      )
      .join('');
  }

  const svgIcon = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const NAV_ICONS = {
    Tracker: svgIcon('<path d="M3 12h4l3-7 4 14 3-7h4"/>'),
    Training: svgIcon('<path d="M6.5 7v10M3.5 9.5v5M17.5 7v10M20.5 9.5v5M6.5 12h11"/>'),
    Ernährung: svgIcon('<path d="M7 3v7a2 2 0 0 0 4 0V3M9 10v11M17 3c-1.7 1.3-2.5 3.6-2.5 6.5 0 2 .8 3 2.5 3.5V21"/>'),
    Nachrichten: svgIcon('<path d="M4 5h16v11H9l-5 4z"/>'),
    Einstellungen: svgIcon('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
    Klienten: svgIcon('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.6-3.4 3-5.3 6-5.3s5.4 1.9 6 5.3"/><path d="M16 4.8a3.2 3.2 0 0 1 0 6.3M18 14.9c1.6.7 2.7 2.4 3 5.1"/>'),
    'Check-in': svgIcon('<rect x="5" y="4" width="14" height="17" rx="1"/><path d="M9 3h6v3H9zM9 13l2 2 4-4"/>'),
    Admin: svgIcon('<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>'),
  };
  const PERSON_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><circle cx="12" cy="9" r="4"/><path d="M4 21c.8-4.2 3.9-6.5 8-6.5s7.2 2.3 8 6.5z"/></svg>';

  /** Profile picture (or a placeholder) in the top bar and in the account menu. */
  function avatarHtml(user) {
    return user && user.avatar ? `<img src="${esc(user.avatar)}" alt="">` : PERSON_ICON;
  }
  function renderUserBadge() {
    document.querySelectorAll('[data-avatar]').forEach((el) => {
      el.innerHTML = avatarHtml(me);
      el.classList.toggle('has-img', Boolean(me.avatar));
    });
    document.getElementById('menu-name').textContent = me.displayName;
    document.getElementById('menu-role').textContent = `@${me.username} · ${me.role === 'coach' ? 'Coach' : 'Klient'}`;
  }

  async function refreshUnread() {
    if (!me) return;
    try {
      const { unread } = await api('GET', '/api/messages/unread');
      nav.querySelectorAll('[data-unread]').forEach((b) => {
        b.textContent = unread > 99 ? '99+' : unread;
        b.hidden = !unread;
      });
    } catch {
      /* ignore – shown again on next poll */
    }
  }

  window.addEventListener('hashchange', route);

  const avatarBtn = document.getElementById('avatar-btn');
  const userMenu = document.getElementById('user-menu');
  function setMenu(open) {
    userMenu.hidden = !open;
    avatarBtn.setAttribute('aria-expanded', String(open));
  }
  avatarBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setMenu(userMenu.hidden);
  });
  document.addEventListener('click', (e) => {
    if (!userMenu.hidden && !userMenu.contains(e.target)) setMenu(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !userMenu.hidden) {
      setMenu(false);
      avatarBtn.focus();
    }
  });
  document.getElementById('menu-account').addEventListener('click', () => setMenu(false));

  document.getElementById('btn-logout').addEventListener('click', async () => {
    setMenu(false);
    await push.forgetDevice().catch(() => {});
    await api('POST', '/api/logout').catch(() => {});
    me = null;
    location.hash = '';
    route();
  });

  function openPasswordDialog() {
    openDialog(
      `<h2>Passwort ändern</h2>
       <div class="field"><label for="pw-cur">Aktuelles Passwort</label>
         <input id="pw-cur" name="cur" type="password" autocomplete="current-password" required></div>
       <div class="field"><label for="pw-new">Neues Passwort</label>
         <input id="pw-new" name="next" type="password" autocomplete="new-password" minlength="8" required>
         <div class="hint">Mindestens 8 Zeichen</div></div>
       <div class="dialog-actions">
         <button type="button" class="btn-secondary" data-close>Abbrechen</button>
         <button type="submit" class="btn-primary">Speichern</button>
       </div>`,
      async (f) => {
        await api('POST', '/api/me/password', { currentPassword: f.cur.value, newPassword: f.next.value });
        savedHud('Passwort geändert');
      }
    );
  }

  // ---------- account: profile picture, name, username, password ----------
  function renderAccount(fameSub, { h2h } = {}) {
    const tabs = `<nav class="tabs" aria-label="Konto">
          <a href="#/account"${fameSub || h2h ? '' : ' aria-current="page"'}>Profil</a>
          ${me.role === 'client'
            ? `<a href="#/account/fame"${fameSub ? ' aria-current="page"' : ''}>Hall of Fame</a>
               <a href="#/account/h2h"${h2h ? ' aria-current="page"' : ''}>Head2Head</a>`
            : `<a href="#/account/fame/fridge"${fameSub ? ' aria-current="page"' : ''}>Test-Kühlschrank</a>`}
        </nav>`;
    const head = `<div class="page-head"><div>${eyebrow(me.role === 'coach' ? 'Coach' : 'Dein Profil')}<h1>Konto</h1></div></div>${tabs}`;
    if (h2h) {
      setView(`${head}<div id="h2h">${LOADING}</div>`);
      mountH2H(document.getElementById('h2h'), h2h === true ? null : h2h);
      return;
    }
    if (fameSub) {
      setView(`${head}<div id="fame">${LOADING}</div>`);
      mountHallOfFame(document.getElementById('fame'), { base: '#/account/fame', sub: fameSub, coachTest: me.role === 'coach' });
      return;
    }
    setView(`
      ${head}
      <div class="account-grid">
        <section class="card account-photo">
          <div class="avatar avatar-xl ${me.avatar ? 'has-img' : ''}" data-avatar-preview>${avatarHtml(me)}</div>
          <div>
            <h2>Profilbild</h2>
            <p class="muted small">Quadratisch zugeschnitten. ${me.role === 'client' ? (me.h2hVisible ? 'Sehen dein Coach und – weil Head2Head an ist – andere Head2Head-Spieler.' : 'Sieht nur dein Coach.') : 'Sehen deine Klienten nicht.'}</p>
            <div class="row" style="gap:8px">
              <label class="btn btn-secondary file-btn">Bild wählen<input type="file" accept="image/*" data-avatar-file hidden></label>
              ${me.avatar ? '<button type="button" class="btn-ghost danger-text" data-avatar-remove>Entfernen</button>' : ''}
            </div>
          </div>
        </section>
        <form class="card" id="profile-form" novalidate>
          <h2 style="margin-bottom:14px">Profil</h2>
          <div class="field"><label for="pf-name">Name</label><input id="pf-name" name="displayName" maxlength="80" value="${esc(me.displayName)}"></div>
          <div class="field"><label for="pf-user">Benutzername</label><input id="pf-user" name="username" maxlength="32" autocapitalize="none" value="${esc(me.username)}">
            <div class="hint">Damit meldest du dich an. 3–32 Zeichen: Buchstaben, Ziffern, . _ -</div></div>
          <button type="submit" class="btn-primary">Speichern</button>
          <p class="error" hidden></p>
        </form>
        ${me.role === 'client' ? '<section class="card profile-vitrine" id="profile-vitrine"></section>' : ''}
        <section class="card" id="email-card"></section>
        <section class="card">
          <h2 style="margin-bottom:8px">Passwort</h2>
          <p class="muted small">Ändere dein Passwort regelmäßig und nutze es nirgendwo sonst.</p>
          <button type="button" class="btn-secondary" data-password>Passwort ändern</button>
        </section>
        ${me.role === 'coach' ? '<section class="card" id="prefs-card"></section>' : ''}
      </div>`);
    if (me.role === 'coach') mountPrefsCard(document.getElementById('prefs-card'));
    mountEmailCard(document.getElementById('email-card'));
    const pv = document.getElementById('profile-vitrine');
    if (pv) api('GET', '/api/achievements').then((d) => {
      pv.innerHTML = `${FAME_DEFS}<h2 style="margin-bottom:8px">Vitrine</h2>
        ${d.showcase.length ? `<div class="profile-showcase">${d.showcase.map((m) => `<div>${miniMedal(m, 'lg')}<span class="small">${esc(m.title)}</span></div>`).join('')}</div>`
          : '<p class="muted small">Noch leer. Wähle in der Hall of Fame bis zu drei erreichte Medaillen – deine Head2Head-Gegner sehen sie.</p>'}
        <a class="btn btn-secondary btn-sm" href="#/account/fame">${d.showcase.length ? 'Vitrine ändern' : 'Medaillen auswählen'}</a>`;
    }).catch(() => pv.remove());

    const fileInput = app.querySelector('[data-avatar-file]');
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      try {
        const image = await squareImage(file, 320);
        me = (await api('PUT', '/api/me/avatar', { image })).user;
        renderUserBadge();
        savedHud('Profilbild gespeichert');
        renderAccount();
      } catch (err) {
        toast(err.message, true);
      }
    });
    const remove = app.querySelector('[data-avatar-remove]');
    if (remove) {
      remove.addEventListener('click', async () => {
        me = (await api('DELETE', '/api/me/avatar')).user;
        renderUserBadge();
        toast('Profilbild entfernt');
        renderAccount();
      });
    }
    const form = document.getElementById('profile-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = form.querySelector('.error');
      errEl.hidden = true;
      try {
        me = (await api('PATCH', '/api/me', { displayName: form.displayName.value, username: form.username.value.trim() })).user;
        renderUserBadge();
        savedHud('Gespeichert');
      } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
      }
    });
    app.querySelector('[data-password]').addEventListener('click', openPasswordDialog);
  }

  /** Crops an image file to a centred square and returns a small JPEG data URL. */
  function squareImage(file, size) {
    return new Promise((resolve, reject) => {
      if (!/^image\//.test(file.type)) return reject(new Error('Bitte eine Bilddatei wählen.'));
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Bild konnte nicht gelesen werden.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Dieses Bildformat wird nicht unterstützt.'));
        img.onload = () => {
          const side = Math.min(img.naturalWidth, img.naturalHeight);
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ---------- login ----------
  function renderLogin(prefillUser) {
    setView(`
      <div class="login-wrap">
        <div class="login-intro">
          ${eyebrow('StayOnTrack · Coaching')}
          <h1>Fortschritt,<br>präzise <em>festgehalten.</em></h1>
          <p>Gewicht, Schritte, Schlaf und Ernährung an einem Ort. Dein Coach sieht mit – du bleibst dran.</p>
          <div class="login-facts"><span>Täglich tracken</span><span>Wöchentlicher Check-in</span><span>Persönlicher Plan</span></div>
        </div>
        <form class="card login-card" id="login-form">
          <div class="login-logo" role="img" aria-label="StayOnTrack">${LOGO}<span class="login-wordmark">Stay<b>On</b>Track</span></div>
          <div class="field"><label for="u">Benutzername oder E-Mail</label>
            <input id="u" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" value="${esc(prefillUser || '')}" required></div>
          <div class="field"><label for="p">Passwort</label>
            <input id="p" name="password" type="password" autocomplete="current-password" required></div>
          <button class="btn-primary btn-block" type="submit">Anmelden</button>
          <p class="error" hidden></p>
          <p class="small login-forgot" hidden><button type="button" class="link-btn" data-forgot>Passwort vergessen?</button></p>
          <p class="small login-legal"><a href="/datenschutz">Datenschutz</a> · <a href="/impressum">Impressum</a></p>
        </form>
      </div>`);
    const form = document.getElementById('login-form');
    (prefillUser ? form.password : form.username).focus();
    loadAuthConfig().then((cfg) => {
      const f = form.querySelector('.login-forgot');
      if (!cfg.passwordReset || !f) return;
      f.hidden = false;
      f.querySelector('[data-forgot]').addEventListener('click', () => openForgotDialog(form.username.value.trim()));
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = form.querySelector('.error');
      errEl.hidden = true;
      try {
        me = (await api('POST', '/api/login', { username: form.username.value, password: form.password.value })).user;
        whatsNewChecked = false; // another person may log in on this device
        applyPrefs(me.prefs);
        route();
        setTimeout(maybeShowWhatsNew, 450);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
      }
    });
  }


  // ---------- e-mail: confirm, reset password ----------
  let authConfig = null;
  async function loadAuthConfig() {
    if (!authConfig) authConfig = await api('GET', '/api/auth/config').catch(() => ({ passwordReset: false }));
    return authConfig;
  }

  /** Forgot password: step 1 asks for the account, step 2 takes the code from the mail and the new password. */
  function openForgotDialog(prefill) {
    openDialog(`
      <h2>Passwort vergessen?</h2>
      <p class="muted small" style="margin-top:-6px">Gib deine E-Mail-Adresse oder deinen Benutzernamen ein. Du bekommst einen 6-stelligen Code an deine bestätigte E-Mail-Adresse.</p>
      <div class="field"><label for="fg-login">E-Mail oder Benutzername</label>
        <input id="fg-login" name="login" autocomplete="username" autocapitalize="none" spellcheck="false" value="${esc(prefill || '')}" required></div>
      <div class="dialog-actions"><button type="button" class="btn-secondary" data-close>Abbrechen</button><button type="submit" class="btn-primary">Code senden</button></div>`,
    async (f) => {
      const login = f.login.value.trim();
      if (!login) throw new Error('Bitte E-Mail-Adresse oder Benutzernamen angeben.');
      await api('POST', '/api/password/forgot', { login });
      setTimeout(() => openCodeDialog(login), 0);
    });
  }

  function openCodeDialog(login) {
    if (dialog.open) dialog.close();
    openDialog(`
      <h2>Code eingeben</h2>
      <p class="muted small" style="margin-top:-6px">Falls ein Konto mit bestätigter E-Mail-Adresse zu <strong>${esc(login)}</strong> passt, ist ein 6-stelliger Code unterwegs. Er ist 15 Minuten gültig – schau auch im Spam-Ordner nach.</p>
      <div class="field"><label for="rc-code">Code aus der E-Mail</label>
        <input id="rc-code" name="code" class="code-input" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]*" maxlength="7" placeholder="••••••" required></div>
      <div class="field"><label for="rc-pw">Neues Passwort</label>
        <input id="rc-pw" name="pw" type="password" autocomplete="new-password" minlength="8" required><div class="hint">Mindestens 8 Zeichen</div></div>
      <div class="field"><label for="rc-pw2">Neues Passwort wiederholen</label>
        <input id="rc-pw2" name="pw2" type="password" autocomplete="new-password" minlength="8" required></div>
      <p class="small"><button type="button" class="link-btn" data-resend>Keinen Code bekommen? Neuen senden</button></p>
      <div class="dialog-actions"><button type="button" class="btn-secondary" data-close>Abbrechen</button><button type="submit" class="btn-primary">Passwort ändern</button></div>`,
    async (f) => {
      const code = f.code.value.replace(/\D/g, '');
      if (code.length !== 6) throw new Error('Der Code hat 6 Ziffern.');
      if (f.pw.value.length < 8) throw new Error('Das Passwort braucht mindestens 8 Zeichen.');
      if (f.pw.value !== f.pw2.value) throw new Error('Die beiden Passwörter stimmen nicht überein.');
      const r = await api('POST', '/api/password/reset', { login, code, password: f.pw.value });
      if (r.user) {
        me = r.user;
        whatsNewChecked = false;
        applyPrefs(me.prefs);
        location.hash = '#/';
        route();
        savedHud('Passwort geändert', 'Du bist angemeldet');
        setTimeout(maybeShowWhatsNew, 900);
      }
    });
    const f = dialog.querySelector('form');
    f.code.addEventListener('input', () => {
      const d = f.code.value.replace(/\D/g, '').slice(0, 6);
      if (f.code.value !== d) f.code.value = d;
      if (d.length === 6) f.pw.focus();
    });
    f.querySelector('[data-resend]').addEventListener('click', async () => {
      try {
        await api('POST', '/api/password/forgot', { login });
        toast('Neuer Code ist unterwegs.');
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  async function renderVerifyEmail(token) {
    if (dialog.open) dialog.close();
    if (!me) topbar.hidden = true;
    setView(LOADING);
    let ok = null;
    let msg = '';
    try {
      ok = await api('POST', '/api/email/verify', { token });
      if (me) me.emailVerified = true;
    } catch (err) {
      msg = err.message;
    }
    setView(`
      <div class="login-wrap single">
        <div class="card login-card verify-card">
          <div class="login-logo" role="img" aria-label="StayOnTrack">${LOGO}<span class="login-wordmark">Stay<b>On</b>Track</span></div>
          ${ok ? `<p class="verify-icon" aria-hidden="true">✓</p><h2>E-Mail-Adresse bestätigt</h2>
            <p class="muted">${esc(ok.email)} gehört jetzt zu deinem Konto. Du kannst dich damit anmelden und ein vergessenes Passwort zurücksetzen.</p>`
            : `<h2>Das hat nicht geklappt</h2><p class="muted">${esc(msg)}</p>`}
          <a class="btn btn-primary btn-block" href="#/">${me ? 'Zur App' : 'Zur Anmeldung'}</a>
        </div>
      </div>`);
  }

  /** Account page: the own address, its status, change it (with password). */
  async function mountEmailCard(root) {
    const cfg = await loadAuthConfig();
    const draw = () => {
      const has = Boolean(me.email);
      root.innerHTML = `
        <h2 style="margin-bottom:8px">E-Mail-Adresse</h2>
        ${has ? `<p class="email-line"><strong>${esc(me.email)}</strong>
            <span class="badge ${me.emailVerified ? 'good' : 'warn'}">${me.emailVerified ? 'bestätigt' : 'nicht bestätigt'}</span></p>` : '<p class="muted small">Noch keine hinterlegt.</p>'}
        <p class="muted small">Mit deiner E-Mail-Adresse kannst du dich statt mit dem Benutzernamen anmelden${cfg.passwordReset ? ' und ein vergessenes Passwort selbst zurücksetzen' : ''}.${me.role === 'client' ? ' Sieht nur dein Coach.' : ''}</p>
        <div class="row" style="gap:8px">
          <button type="button" class="btn-secondary" data-email-edit>${has ? 'Ändern' : 'E-Mail hinzufügen'}</button>
          ${has && !me.emailVerified && cfg.passwordReset ? '<button type="button" class="btn-ghost" data-email-resend>Bestätigung erneut senden</button>' : ''}
        </div>`;
      root.querySelector('[data-email-edit]').addEventListener('click', () => openDialog(`
        <h2>${has ? 'E-Mail-Adresse ändern' : 'E-Mail-Adresse hinzufügen'}</h2>
        <div class="field"><label for="em-new">E-Mail-Adresse</label><input id="em-new" name="email" type="email" autocomplete="email" value="${esc(me.email || '')}" placeholder="name@beispiel.de"></div>
        <div class="field"><label for="em-pw">Dein Passwort</label><input id="em-pw" name="password" type="password" autocomplete="current-password" required>
          <div class="hint">Zur Sicherheit – damit niemand an einem offenen Gerät deine Adresse ändern kann.</div></div>
        ${cfg.passwordReset ? '<p class="muted small">Du bekommst eine Mail mit einem Bestätigungslink.</p>' : ''}
        <div class="dialog-actions">${has ? '<button type="button" class="btn-ghost danger-text" data-email-remove style="margin-right:auto">Entfernen</button>' : ''}
          <button type="button" class="btn-secondary" data-close>Abbrechen</button><button type="submit" class="btn-primary">Speichern</button></div>`,
      async (f) => {
        const email = f.email.value.trim();
        if (!email) throw new Error('Bitte eine E-Mail-Adresse angeben.');
        const r = await api('PUT', '/api/me/email', { email, password: f.password.value });
        me = (await api('GET', '/api/me')).user;
        draw();
        if (r.mailError) toast(r.mailError, true);
        else savedHud('Gespeichert', r.verifySent ? 'Bestätigungslink ist unterwegs' : '');
      }));
      const resend = root.querySelector('[data-email-resend]');
      if (resend) resend.addEventListener('click', async () => {
        try {
          await api('POST', '/api/me/email/verify');
          toast('Bestätigungslink gesendet – schau in dein Postfach.');
        } catch (err) {
          toast(err.message, true);
        }
      });
      document.addEventListener('click', onRemove);
    };
    async function onRemove(e) {
      if (!e.target.closest('[data-email-remove]')) return;
      const f = e.target.closest('form');
      try {
        await api('PUT', '/api/me/email', { email: null, password: f.password.value });
        dialog.close();
        me = (await api('GET', '/api/me')).user;
        toast('E-Mail-Adresse entfernt');
        draw();
      } catch (err) {
        const el = f.querySelector('.error');
        el.textContent = err.message === 'Passwort ist falsch' ? 'Bitte gib zum Entfernen dein Passwort ein.' : err.message;
        el.hidden = false;
      }
    }
    onCleanup(() => document.removeEventListener('click', onRemove));
    draw();
  }

  // ---------- Head2Head ----------
  const H2H_ICONS = { steps: '👟', training: '🏋️', volume: '⚖️', consistency: '📅', weight_loss: '📉', sleep: '🌙', calories: '🍽' };
  const h2hWeeks = (days) => (days === 7 ? '1 Woche' : `${days / 7} Wochen`);
  const h2hVal = (v, m) => (v === null || v === undefined ? '–' : `${num(v, m.decimals)}${m.unit === '%' ? ' %' : m.unit === 't' ? ' t' : ''}`);
  const h2hAvatar = (p, cls = '') => `<span class="avatar h2h-av ${cls} ${p.avatar ? 'has-img' : ''}">${p.avatar ? `<img src="${esc(p.avatar)}" alt="">` : `<span class="h2h-initial">${esc((p.displayName || '?').trim()[0] || '?')}</span>`}</span>`;

  /** "You 12 400 · 9 800 Jana" with a tug-of-war bar. */
  function h2hScore(c, m) {
    const a = Math.max(0, c.me.value || 0);
    const b = Math.max(0, c.them.value || 0);
    const share = a + b > 0 ? (a / (a + b)) * 100 : 50;
    return `<div class="h2h-score">
      <div class="h2h-side me ${c.leader === 'me' ? 'lead' : ''}"><span class="h2h-who">Du</span><strong>${esc(h2hVal(c.me.value, m))}</strong></div>
      <div class="h2h-side them ${c.leader === 'them' ? 'lead' : ''}"><span class="h2h-who">${esc(c.them.displayName)}</span><strong>${esc(h2hVal(c.them.value, m))}</strong></div>
      <div class="h2h-tug" role="img" aria-label="Du ${esc(h2hVal(c.me.value, m))}, ${esc(c.them.displayName)} ${esc(h2hVal(c.them.value, m))}"><i style="width:${share.toFixed(1)}%"></i></div>
    </div>`;
  }

  function h2hCard(c, metrics, { actions: canAct = true, link = true } = {}) {
    const m = metrics[c.metric];
    const title = `${H2H_ICONS[c.metric] || '⚔️'} ${m.label} · ${h2hWeeks(c.days)}`;
    const vs = `<div class="h2h-vs"><span class="h2h-side-col">${h2hAvatar(c.me)}${showcaseRow(c.me.showcase, 'sm')}</span><span class="h2h-vs-x" aria-hidden="true">VS</span><span class="h2h-side-col">${h2hAvatar(c.them)}${showcaseRow(c.them.showcase, 'sm')}</span></div>`;
    let body = '';
    let actions = '';
    if (c.status === 'pending') {
      body = c.role === 'opponent'
        ? `<p><strong>${esc(c.them.displayName)}</strong> fordert dich heraus.</p>${c.message ? `<p class="h2h-msg">„${esc(c.message)}“</p>` : ''}<p class="muted small">${esc(m.hint)}</p>`
        : `<p>Warte auf <strong>${esc(c.them.displayName)}</strong>…</p>${c.message ? `<p class="h2h-msg">„${esc(c.message)}“</p>` : ''}`;
      if (canAct) actions = c.role === 'opponent'
        ? `<button type="button" class="btn-primary btn-sm" data-h2h-act="accept" data-id="${c.id}">Annehmen</button><button type="button" class="btn-ghost btn-sm" data-h2h-act="decline" data-id="${c.id}">Ablehnen</button>`
        : `<button type="button" class="btn-ghost btn-sm" data-h2h-act="cancel" data-id="${c.id}">Zurückziehen</button>`;
    } else if (c.status === 'running' || c.status === 'finished') {
      const left = c.days - c.dayOf;
      body = `${h2hScore(c, m)}<p class="muted small h2h-meta">${c.status === 'running'
        ? `Tag ${c.dayOf} von ${c.days} · ${left ? `noch ${left} ${left === 1 ? 'Tag' : 'Tage'}` : 'letzter Tag'}`
        : c.final ? `Beendet am ${esc(fmtDate(c.endDate, { day: 'numeric', month: 'long' }))}${c.token ? ' · <span class="coin-inline"><i class="coin" aria-hidden="true"></i> +1 Token</span>' : ''}`
          : 'Vorbei – bis morgen könnt ihr den letzten Tag noch nachtragen, dann steht der Endstand fest.'}</p>`;
      if (link) actions = `<a class="btn btn-secondary btn-sm" href="#/account/h2h/${c.id}">Verlauf ansehen</a>`;
    } else {
      body = `<p class="muted small">${{ declined: 'Abgelehnt', cancelled: 'Zurückgezogen', expired: 'Nicht beantwortet – abgelaufen' }[c.status]}</p>`;
    }
    const badge = c.status === 'finished'
      ? `<span class="badge ${c.result === 'won' ? 'good' : c.result === 'lost' ? '' : ''} h2h-result">${{ won: '🏆 Gewonnen', lost: 'Verloren', draw: 'Unentschieden' }[c.result]}</span>`
      : c.status === 'running' ? `<span class="badge h2h-live">${c.leader === 'me' ? 'Du führst' : c.leader === 'them' ? `${esc(c.them.displayName)} führt` : 'Gleichstand'}</span>`
        : c.status === 'pending' ? `<span class="badge warn">${c.role === 'opponent' ? 'Neu' : 'Offen'}</span>` : '';
    return `<article class="card h2h-card s-${c.status}">
      <div class="row-between h2h-card-head"><h3>${title}</h3>${badge}</div>
      ${vs}${body}${actions ? `<div class="row h2h-actions">${actions}</div>` : ''}
    </article>`;
  }

  /** Two lines, one per player, over the days of the duel; direct labels at the ends, hover tooltip. */
  function h2hChart(root, c, m) {
    const a = c.series.me;
    const b = c.series.them;
    const W = Math.max(root.clientWidth, 280);
    const H = 220;
    const pad = { l: 46, r: 64, t: 14, b: 26 };
    const days = c.days;
    const vals = [...a, ...b].map((p) => p.value).filter((v) => v !== null);
    const hi = Math.max(...vals, m.unit === '%' ? 1 : 1);
    const lo = Math.min(0, ...vals);
    const x = (i) => pad.l + (i / Math.max(1, days - 1)) * (W - pad.l - pad.r);
    const y = (v) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (H - pad.t - pad.b);
    const path = (s) => s.map((p, i) => (p.value === null ? null : `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)).filter(Boolean).join(' L');
    const ticks = [lo, (lo + hi) / 2, hi];
    const endLabel = (s, who, cls) => {
      const p = [...s].reverse().find((q) => q.value !== null);
      if (!p) return '';
      const i = s.lastIndexOf(p);
      return `<circle class="h2h-dot ${cls}" cx="${x(i)}" cy="${y(p.value)}" r="4"/><text class="h2h-endlabel" x="${x(i) + 8}" y="${y(p.value) + 4}">${esc(who)}</text>`;
    };
    root.innerHTML = `<svg class="h2h-chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Verlauf: Du gegen ${esc(c.them.displayName)}">
      ${ticks.map((t) => `<line class="h2h-gridline" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/><text class="h2h-axis" x="${pad.l - 6}" y="${y(t) + 4}" text-anchor="end">${esc(num(t, m.decimals && hi < 10 ? 1 : 0))}</text>`).join('')}
      <text class="h2h-axis" x="${pad.l}" y="${H - 6}">Tag 1</text><text class="h2h-axis" x="${W - pad.r}" y="${H - 6}" text-anchor="end">Tag ${days}</text>
      ${b.length ? `<path class="h2h-line them" d="M${path(b)}"/>` : ''}${a.length ? `<path class="h2h-line me" d="M${path(a)}"/>` : ''}
      ${endLabel(b, c.them.displayName.split(' ')[0], 'them')}${endLabel(a, 'Du', 'me')}
      <line class="h2h-cross" y1="${pad.t}" y2="${H - pad.b}" hidden/>
      <rect class="h2h-hit" x="${pad.l}" y="${pad.t}" width="${W - pad.l - pad.r}" height="${H - pad.t - pad.b}"/>
    </svg><div class="h2h-tip" hidden></div>
    <div class="h2h-legend"><span><i class="me"></i>Du</span><span><i class="them"></i>${esc(c.them.displayName)}</span></div>`;
    const svg = root.querySelector('svg');
    const tip = root.querySelector('.h2h-tip');
    const cross = root.querySelector('.h2h-cross');
    const move = (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(Math.max(a.length, b.length) - 1, Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (days - 1))));
      if (i < 0 || (!a[i] && !b[i])) return;
      cross.setAttribute('x1', x(i));
      cross.setAttribute('x2', x(i));
      cross.hidden = false;
      const date = (a[i] || b[i]).date;
      tip.innerHTML = `<strong>Tag ${i + 1}</strong> · ${esc(fmtDate(date, { day: 'numeric', month: 'short' }))}<br><i class="me"></i>Du: ${esc(h2hVal(a[i]?.value, m))}<br><i class="them"></i>${esc(c.them.displayName)}: ${esc(h2hVal(b[i]?.value, m))}`;
      tip.hidden = false;
      tip.style.left = `${Math.min(r.width - 150, Math.max(0, (x(i) / W) * r.width - 70))}px`;
    };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerdown', move);
    svg.addEventListener('pointerleave', () => {
      tip.hidden = true;
      cross.hidden = true;
    });
  }

  async function mountH2H(root, detailId) {
    let data;
    try {
      data = await api('GET', '/api/h2h');
    } catch (err) {
      root.innerHTML = `<div class="card empty-state">${esc(err.message)}</div>`;
      return;
    }
    const redraw = () => mountH2H(root, detailId);
    const defs = FAME_DEFS; // medal gradients for the showcases
    if (detailId) return drawDetail();
    const M = data.metrics;
    if (!data.visible) {
      root.innerHTML = `<section class="card h2h-intro">
        <p class="h2h-hero" aria-hidden="true">⚔️</p>
        <h2>Head2Head</h2>
        <p>Fordere andere Klienten heraus – Schritte, Trainingstage, Schlaf, Kalorienziel oder Gewicht verlieren – für 1, 2 oder 4 Wochen. Wer am Ende vorne liegt, gewinnt – und bekommt 1 Token für den Kühlschrank-Shop.</p>
        <ul class="h2h-privacy small">
          <li>Andere sehen nur deinen Namen <strong>${esc(me.displayName)}</strong>, dein Profilbild und die Medaillen in deiner Vitrine.</li>
          <li>In einem Duell wird nur die gewählte Disziplin verglichen – und nur für dessen Dauer.</li>
          <li>Gewicht zählt in Prozent vom Startgewicht. Deine Kilos sieht niemand.</li>
          <li>Du kannst Head2Head jederzeit wieder ausschalten.</li>
        </ul>
        <button type="button" class="btn-primary" data-h2h-on>Head2Head einschalten</button>
      </section>
      ${data.challenges.length ? `<h3 class="h2h-section">Frühere Duelle</h3><div class="h2h-grid">${data.challenges.map((c) => h2hCard(c, M, { actions: false, link: false })).join('')}</div>` : ''}`;
      root.querySelector('[data-h2h-on]').addEventListener('click', async () => {
        await api('PUT', '/api/h2h/visible', { visible: true });
        me.h2hVisible = true;
        savedHud('Head2Head an', 'Fordere jemanden heraus');
        redraw();
      });
      return;
    }
    const inbox = data.challenges.filter((c) => c.status === 'pending' && c.role === 'opponent');
    const running = data.challenges.filter((c) => c.status === 'running' || (c.status === 'pending' && c.role === 'challenger'));
    const past = data.challenges.filter((c) => c.status === 'finished');
    const r = data.record;
    root.innerHTML = `${defs}
      <div class="h2h-top">
        <div class="h2h-record" aria-label="Deine Bilanz"><span><strong>${r.won}</strong> Siege</span><span><strong>${r.draw}</strong> Unentschieden</span><span><strong>${r.lost}</strong> Niederlagen</span></div>
        <button type="button" class="btn-primary" data-h2h-new ${data.players.length ? '' : 'disabled'}>⚔️ Herausfordern</button>
      </div>
      ${data.players.length ? '' : '<p class="card muted small">Noch hat niemand sonst Head2Head eingeschaltet. Sobald jemand mitmacht, kannst du ihn herausfordern.</p>'}
      ${inbox.length ? `<h3 class="h2h-section">Für dich</h3><div class="h2h-grid">${inbox.map((c) => h2hCard(c, M)).join('')}</div>` : ''}
      ${running.length ? `<h3 class="h2h-section">Laufend</h3><div class="h2h-grid">${running.map((c) => h2hCard(c, M)).join('')}</div>` : ''}
      ${past.length ? `<h3 class="h2h-section">Beendet</h3><div class="h2h-grid">${past.map((c) => h2hCard(c, M)).join('')}</div>` : ''}
      ${data.players.length ? `<h3 class="h2h-section">Wer macht mit</h3><ul class="card h2h-players">${data.players.map((p) => `<li>${h2hAvatar(p)}<span class="h2h-pname">${esc(p.displayName)}<span class="muted small">${p.record.won} Siege · ${p.record.lost} Niederlagen</span>${showcaseRow(p.showcase, 'sm')}</span>
        <button type="button" class="btn-secondary btn-sm" data-h2h-challenge="${p.id}">Herausfordern</button></li>`).join('')}</ul>` : ''}
      <p class="small muted h2h-off"><button type="button" class="link-btn" data-h2h-off>Head2Head ausschalten</button> – offene Herausforderungen verfallen, laufende Duelle laufen zu Ende.</p>`;
    root.querySelectorAll('[data-h2h-act]').forEach((b) => b.addEventListener('click', async () => {
      try {
        const res = await api('POST', `/api/h2h/${b.dataset.id}/${b.dataset.h2hAct}`);
        if (b.dataset.h2hAct === 'accept') {
          savedHud('Angenommen', "Los geht's – ab heute zählt's");
          location.hash = `#/account/h2h/${res.challenge.id}`;
          return;
        }
        toast(b.dataset.h2hAct === 'decline' ? 'Abgelehnt' : 'Zurückgezogen');
        redraw();
      } catch (err) {
        toast(err.message, true);
      }
    }));
    const openNew = (opponentId) => openChallengeDialog(data, opponentId, redraw);
    const nb = root.querySelector('[data-h2h-new]');
    if (nb) nb.addEventListener('click', () => openNew(null));
    root.querySelectorAll('[data-h2h-challenge]').forEach((b) => b.addEventListener('click', () => openNew(Number(b.dataset.h2hChallenge))));
    root.querySelector('[data-h2h-off]').addEventListener('click', async () => {
      if (!confirm('Head2Head ausschalten? Andere sehen dich dann nicht mehr.')) return;
      await api('PUT', '/api/h2h/visible', { visible: false });
      me.h2hVisible = false;
      toast('Head2Head ausgeschaltet');
      redraw();
    });

    async function drawDetail() {
      let c;
      try {
        c = (await api('GET', `/api/h2h/${detailId}`)).challenge;
      } catch (err) {
        root.innerHTML = `<div class="card empty-state">${esc(err.message)} <a href="#/account/h2h">Zurück</a></div>`;
        return;
      }
      const m = data.metrics[c.metric];
      root.innerHTML = `${defs}<p><a href="#/account/h2h" class="back-link">← Alle Duelle</a></p>
        ${h2hCard(c, data.metrics, { actions: data.visible, link: false })}
        ${c.series ? `<section class="card"><h3 style="margin-bottom:8px">Verlauf</h3><p class="muted small" style="margin-top:0">${esc(m.hint)}</p><div class="h2h-chart-wrap"></div></section>` : ''}`;
      root.querySelectorAll('[data-h2h-act]').forEach((b) => b.addEventListener('click', async () => {
        try {
          await api('POST', `/api/h2h/${b.dataset.id}/${b.dataset.h2hAct}`);
          redraw();
        } catch (err) {
          toast(err.message, true);
        }
      }));
      if (c.series) {
        const wrap = root.querySelector('.h2h-chart-wrap');
        h2hChart(wrap, c, m);
        const ro = new ResizeObserver(() => h2hChart(wrap, c, m));
        ro.observe(wrap);
        onCleanup(() => ro.disconnect());
      }
    }
  }

  function openChallengeDialog(data, opponentId, done) {
    const M = data.metrics;
    openDialog(`
      <h2>⚔️ Herausfordern</h2>
      <div class="field"><label for="hc-opp">Gegner</label><select id="hc-opp" name="opponent">${data.players.map((p) => `<option value="${p.id}" ${p.id === opponentId ? 'selected' : ''}>${esc(p.displayName)}</option>`).join('')}</select></div>
      <fieldset class="pr-q"><legend>Disziplin</legend><div class="h2h-metrics">${Object.entries(M).map(([k, m], i) => `<label class="h2h-metric"><input type="radio" name="metric" value="${k}" ${i === 0 ? 'checked' : ''}>
        <span><b>${H2H_ICONS[k]} ${esc(m.label)}</b><small>${esc(m.hint)}</small></span></label>`).join('')}</div></fieldset>
      <fieldset class="pr-q"><legend>Dauer</legend><div class="seg-wide">${data.durations.map((d, i) => `<label><input type="radio" name="days" value="${d}" ${i === 1 ? 'checked' : ''}><span>${h2hWeeks(d)}</span></label>`).join('')}</div></fieldset>
      <div class="field"><label for="hc-msg">Kampfansage <span class="muted">(optional)</span></label><input id="hc-msg" name="message" maxlength="140" placeholder="z. B. Diesmal schlag ich dich!"></div>
      <p class="muted small">Startet, sobald die Herausforderung angenommen wird. Unbeantwortet verfällt sie nach 7 Tagen.</p>
      <div class="dialog-actions"><button type="button" class="btn-secondary" data-close>Abbrechen</button><button type="submit" class="btn-primary">Herausforderung senden</button></div>`,
    async (f) => {
      await api('POST', '/api/h2h', {
        opponentId: Number(f.opponent.value), metric: f.querySelector('input[name=metric]:checked').value,
        days: Number(f.querySelector('input[name=days]:checked').value), message: f.message.value,
      });
      savedHud('Herausforderung gesendet', f.opponent.selectedOptions[0].textContent);
      done();
    });
  }

  /** Tracker home: new challenges and running duels at a glance. */
  async function mountH2HHome(root) {
    if (!root || !me.h2hVisible) return;
    let data;
    try {
      data = await api('GET', '/api/h2h');
    } catch {
      return;
    }
    const inbox = data.challenges.filter((c) => c.status === 'pending' && c.role === 'opponent');
    const running = data.challenges.filter((c) => c.status === 'running');
    if (!inbox.length && !running.length) return;
    root.innerHTML = `<section class="card h2h-home">
      <div class="row-between"><h2>⚔️ Head2Head</h2><a href="#/account/h2h" class="small">Alle Duelle →</a></div>
      ${inbox.map((c) => `<a class="h2h-home-row" href="#/account/h2h"><span class="badge warn">Neu</span> <strong>${esc(c.them.displayName)}</strong> fordert dich heraus: ${esc(data.metrics[c.metric].label)}</a>`).join('')}
      ${running.map((c) => `<a class="h2h-home-row" href="#/account/h2h/${c.id}">${H2H_ICONS[c.metric]} ${esc(data.metrics[c.metric].label)} vs. <strong>${esc(c.them.displayName)}</strong>
        <span class="h2h-home-score ${c.leader}">${esc(h2hVal(c.me.value, data.metrics[c.metric]))} : ${esc(h2hVal(c.them.value, data.metrics[c.metric]))}</span></a>`).join('')}
    </section>`;
  }

  // ---------- client: daily entry ----------
  async function renderClientHome() {
    setView(LOADING);
    const [{ entries }, { goals, history }, { metrics }] = await Promise.all([
      api('GET', '/api/entries'),
      api('GET', '/api/goals'),
      api('GET', '/api/measurements'),
    ]);
    const state = { entries, goals, history, metrics };
    const numberMetrics = () => state.metrics.filter((m) => m.kind === 'number');

    setView(`
      <div class="page-head">
        <div>${eyebrow(todayLong())}<h1>${greeting()}, ${esc(me.displayName.split(' ')[0])}</h1><p class="muted" id="streak"></p></div>
      </div>
      <div id="push-prompt"></div>
      <div id="checkin-card"></div>
      <div id="h2h-home"></div>
      <section class="card today-card" id="today-card" aria-label="Heute"></section>
      <div class="sheet-backdrop" id="sheet-backdrop" hidden></div>
      <div class="grid-2">
        <form class="card entry-sheet" id="entry-form" novalidate aria-label="Tageseintrag">
          <div class="sheet-grabber" aria-hidden="true"></div>
          <div class="row-between" style="margin-bottom:12px">
            <h2>Tageseintrag</h2>
            <span class="row" style="gap:6px"><span class="badge" id="entry-status"></span>
              <button type="button" class="sheet-close" data-sheet-close aria-label="Schließen">✕</button></span>
          </div>
          <div class="field"><label for="f-date">Datum</label>
            <input id="f-date" name="date" type="date" required></div>
          <div class="field"><label for="f-weight">Gewicht</label>
            <div class="input-unit"><input id="f-weight" name="weight" inputmode="decimal" placeholder="z. B. 82,4"><span>kg</span></div></div>
          <div class="field"><label for="f-steps">Schritte</label>
            <div class="input-unit"><input id="f-steps" name="steps" inputmode="numeric" placeholder="z. B. 8500"><span>Schritte</span></div></div>
          <div class="field"><label for="f-sleep-h">Schlaf (letzte Nacht)</label>
            <div class="field-row">
              <div class="input-unit"><input id="f-sleep-h" name="sleepH" inputmode="numeric" placeholder="7"><span>Std.</span></div>
              <div class="input-unit"><input id="f-sleep-m" name="sleepM" inputmode="numeric" placeholder="30" aria-label="Schlaf Minuten"><span>Min.</span></div>
            </div></div>
          <div data-metric-fields></div>
          <fieldset class="field"><legend>Trainingstag?</legend>
            <div class="choice">
              <label><input type="radio" name="training" value="true"><span>🏋️ Ja</span></label>
              <label><input type="radio" name="training" value="false"><span class="no">Nein</span></label>
            </div></fieldset>
          <fieldset class="field" data-kcal-block hidden><legend>Kalorien laut Plan eingehalten? <span class="plan-hint" data-kcal-plan></span></legend>
            <div class="choice">
              <label><input type="radio" name="caloriesOk" value="true"><span>✓ Ja</span></label>
              <label><input type="radio" name="caloriesOk" value="false"><span class="no">✗ Nein</span></label>
            </div>
            <div data-kcal-eaten hidden style="margin-top:10px">
              <label for="f-kcal">Wie viel hast du gegessen? <span class="muted">(optional)</span></label>
              <div class="input-unit"><input id="f-kcal" name="calories" inputmode="numeric" placeholder="z. B. 2650"><span>kcal</span></div>
            </div></fieldset>
          <div class="field"><label for="f-note">Notiz <span class="muted">(optional)</span></label>
            <textarea id="f-note" name="note" maxlength="500" placeholder="Wie lief der Tag? Training, Ernährung, Befinden…"></textarea></div>
          <button class="btn-primary btn-block" type="submit">Speichern</button>
          <p class="error" hidden></p>
          <p class="hint">Du kannst jeden Wert auch später am Tag ergänzen – bereits gespeicherte Werte bleiben erhalten.</p>
        </form>
        <div id="dashboard" class="stack"></div>
      </div>`);

    const form = document.getElementById('entry-form');
    stickyColumn(form);
    const today = todayStr();
    form.date.max = today;
    form.date.value = today;

    // ---- Phones: the form opens as a sheet from the "Heute" card ----
    const compact = () => matchMedia('(max-width: 720px)').matches;
    const backdrop = document.getElementById('sheet-backdrop');
    function openSheet(date) {
      if (date) form.date.value = date;
      fillForm();
      if (!compact()) {
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      document.body.classList.add('sheet-open');
      backdrop.hidden = false;
      form.scrollTop = 0;
    }
    function closeSheet() {
      document.body.classList.remove('sheet-open');
      backdrop.hidden = true;
    }
    backdrop.addEventListener('click', closeSheet);
    form.querySelector('[data-sheet-close]').addEventListener('click', closeSheet);
    const onKey = (e) => {
      if (e.key === 'Escape' && document.body.classList.contains('sheet-open')) closeSheet();
    };
    document.addEventListener('keydown', onKey);
    onCleanup(() => {
      closeSheet();
      document.removeEventListener('keydown', onKey);
    });

    /** Today at a glance: what is already tracked, and one button to add the rest. */
    function drawToday() {
      const card = document.getElementById('today-card');
      const e = state.entries.find((x) => x.date === today) || null;
      const chip = (label, done, value) =>
        `<li class="${done ? 'done' : ''}"><span class="tc-mark" aria-hidden="true">${done ? '✓' : ''}</span><span class="tc-label">${label}</span><span class="tc-value">${done ? value : 'offen'}</span></li>`;
      const items = [
        chip('Gewicht', e && e.weight !== null, e && e.weight !== null ? `${num(e.weight, 1)} kg` : ''),
        chip('Schritte', e && e.steps !== null, e && e.steps !== null ? num(e.steps) : ''),
        chip('Schlaf', e && e.sleep !== null, e && e.sleep !== null ? fmtSleep(e.sleep) : ''),
        chip('Training', e && e.training !== null && e.training !== undefined, e && e.training ? 'Ja' : 'Nein'),
      ];
      if (hasKcal(state.goals)) {
        items.push(chip('Kalorien', e && e.caloriesOk !== null && e.caloriesOk !== undefined, e && e.caloriesOk ? 'eingehalten' : e && e.calories ? `${num(e.calories)} kcal` : 'nicht eingehalten'));
      }
      const done = items.filter((x) => x.startsWith('<li class="done"')).length;
      card.innerHTML = `
        <div class="row-between today-head">
          <div><h2>Heute</h2><p class="small muted" style="margin:2px 0 0">${done} von ${items.length} eingetragen</p></div>
          <span class="today-ring" style="--p:${Math.round((done / items.length) * 100)}" aria-hidden="true"><b>${done}/${items.length}</b></span>
        </div>
        <ul class="today-list">${items.join('')}</ul>
        <button type="button" class="btn-primary btn-block" data-open-sheet>${done ? 'Eintrag ergänzen' : 'Tag eintragen'}</button>`;
      card.querySelector('[data-open-sheet]').addEventListener('click', () => openSheet(today));
    }

    function fillForm() {
      const e = state.entries.find((x) => x.date === form.date.value);
      form.weight.value = e && e.weight !== null ? String(e.weight).replace('.', ',') : '';
      form.steps.value = e && e.steps !== null ? e.steps : '';
      if (e && e.sleep !== null) {
        const total = Math.round(e.sleep * 60);
        form.sleepH.value = Math.floor(total / 60);
        form.sleepM.value = total % 60 || '';
      } else {
        form.sleepH.value = '';
        form.sleepM.value = '';
      }
      form.note.value = (e && e.note) || '';
      const setChoice = (name, v) =>
        form.querySelectorAll(`[name=${name}]`).forEach((r) => {
          r.checked = v !== null && v !== undefined && r.value === String(v);
          r.dataset.was = String(r.checked);
        });
      setChoice('training', e ? e.training : null);
      setChoice('caloriesOk', e ? e.caloriesOk : null);
      form.calories.value = e && e.calories !== null && e.calories !== undefined ? e.calories : '';
      drawMetricFields();
      syncKcal();
      const status = document.getElementById('entry-status');
      status.textContent = e ? 'gespeichert' : 'noch offen';
      status.className = e ? 'badge good' : 'badge';
    }

    function updateStreak() {
      const dates = new Set(state.entries.map((e) => e.date));
      let streak = 0;
      let d = dates.has(today) ? today : addDays(today, -1);
      while (dates.has(d)) {
        streak++;
        d = addDays(d, -1);
      }
      document.getElementById('streak').textContent = streak
        ? `🔥 ${streak} ${streak === 1 ? 'Tag' : 'Tage'} in Folge eingetragen`
        : 'Trag heute deine Werte ein.';
    }

    function syncKcal() {
      const block = form.querySelector('[data-kcal-block]');
      block.hidden = !hasKcal(state.goals);
      form.querySelector('[data-kcal-plan]').textContent = hasKcal(state.goals) ? `(Plan: ${fmtKcal(state.goals.caloriesMin, state.goals.caloriesMax)})` : '';
      const no = form.querySelector('[name=caloriesOk][value=false]').checked;
      form.querySelector('[data-kcal-eaten]').hidden = !no;
    }
    form.addEventListener('change', (e) => {
      if (e.target.name === 'caloriesOk') syncKcal();
    });
    // Tapping a selected choice again clears it.
    form.querySelectorAll('.choice input').forEach((r) =>
      r.addEventListener('click', () => {
        if (r.dataset.was === 'true') {
          r.checked = false;
          syncKcal();
        }
        form.querySelectorAll(`[name=${r.name}]`).forEach((x) => (x.dataset.was = String(x.checked)));
      })
    );
    // Extra measurements of the client's category (e.g. Bauchumfang), filled per date.
    function drawMetricFields() {
      const box = form.querySelector('[data-metric-fields]');
      box.innerHTML = numberMetrics()
        .map((m) => {
          const v = (m.values || []).find((x) => x.date === form.date.value);
          return `<div class="field"><label for="m-${m.id}">${esc(m.name)} <span class="muted">(optional)</span></label>
            <div class="input-unit"><input id="m-${m.id}" data-metric="${m.id}" inputmode="decimal" value="${v ? String(v.value).replace('.', ',') : ''}"><span>${esc(m.unit)}</span></div></div>`;
        })
        .join('');
    }

    form.date.addEventListener('change', fillForm);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const errEl = form.querySelector('.error');
      errEl.hidden = true;
      try {
        const weight = parseNum(form.weight.value);
        const steps = parseNum(form.steps.value);
        const sh = parseNum(form.sleepH.value);
        const sm = parseNum(form.sleepM.value);
        if ([weight, steps, sh, sm].some(Number.isNaN)) throw new Error('Bitte nur Zahlen eingeben.');
        if (sm !== null && (sm < 0 || sm >= 60)) throw new Error('Minuten müssen zwischen 0 und 59 liegen.');
        const sleep = sh === null && sm === null ? null : Math.round(((sh || 0) + (sm || 0) / 60) * 100) / 100;
        if (!form.date.value) throw new Error('Bitte ein Datum wählen.');
        const choice = (name) => {
          const r = form.querySelector(`[name=${name}]:checked`);
          return r ? r.value === 'true' : null;
        };
        const caloriesOk = hasKcal(state.goals) ? choice('caloriesOk') : undefined;
        const calories = caloriesOk === false ? parseNum(form.calories.value) : caloriesOk === undefined ? undefined : null;
        if (Number.isNaN(calories)) throw new Error('Bitte bei den Kalorien nur Zahlen eingeben.');
        const metricInputs = [...form.querySelectorAll('[data-metric]')].map((inp) => ({ id: Number(inp.dataset.metric), value: parseNum(inp.value) }));
        if (metricInputs.some((x) => Number.isNaN(x.value))) throw new Error('Bitte bei den Zusatzmaßen nur Zahlen eingeben.');
        const date = form.date.value;
        const { entry, revoked } = await api('PUT', `/api/entries/${date}`, {
          weight, steps, sleep, note: form.note.value, training: choice('training'), caloriesOk, calories,
        });
        if (revoked && revoked.length) setTimeout(() => notifyRevoked(revoked), 1700); // after the "saved" check mark
        let metricsChanged = false;
        for (const x of metricInputs) {
          const m = state.metrics.find((y) => y.id === x.id);
          const old = (m.values || []).find((v) => v.date === date);
          if ((old ? old.value : null) !== x.value) {
            state.metrics = (await api('PUT', `/api/measurements/${x.id}/${date}`, { value: x.value })).metrics;
            metricsChanged = true;
          }
        }
        state.entries = state.entries.filter((x) => x.date !== date);
        if (entry) state.entries.push(entry);
        state.entries.sort((a, b) => a.date.localeCompare(b.date));
        if (entry || metricsChanged) savedHud('Gespeichert', fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' }));
        else toast('Eintrag entfernt');
        closeSheet();
        fillForm();
        updateStreak();
        drawToday();
        dash.update(state.entries);
        if (metricsChanged) dash.setMeasurements(state.metrics);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
      }
    });

    const dash = mountDashboard(document.getElementById('dashboard'), {
      entries: state.entries,
      goals: state.goals,
      history: state.history,
      measurements: state.metrics,
      async onPrAdd(body) {
        const res = await api('POST', '/api/prs', body);
        state.metrics = res.metrics;
        const what = `${res.saved.exercise}: ${num(res.saved.weight, 1)} kg × ${res.saved.reps}`;
        if (res.saved.isRecord && res.saved.previous) savedHud('Neuer Bestwert! 💪', what);
        else savedHud('Gespeichert', what);
        return res.metrics;
      },
      async onPrDelete(id) {
        state.metrics = (await api('DELETE', `/api/prs/${id}`)).metrics;
        toast('PR gelöscht');
        return state.metrics;
      },
      onEdit(date) {
        openSheet(date);
      },
      async onDelete(date) {
        if (!confirm(`Eintrag vom ${fmtDate(date)} löschen?`)) return;
        const del = await api('DELETE', `/api/entries/${date}`);
        state.entries = state.entries.filter((x) => x.date !== date);
        toast('Eintrag gelöscht');
        if (del.revoked && del.revoked.length) setTimeout(() => notifyRevoked(del.revoked), 1500);
        fillForm();
        updateStreak();
        drawToday();
        dash.update(state.entries);
      },
    });
    fillForm();
    updateStreak();
    drawToday();
    maybeShowPushPrompt(document.getElementById('push-prompt'));
    mountH2HHome(document.getElementById('h2h-home'));
    mountClientCheckin(document.getElementById('checkin-card'), async () => {
      const g = await api('GET', '/api/goals');
      state.goals = g.goals;
      state.history = g.history;
      dash.setGoals(g.goals, g.history);
      syncKcal();
    });
  }

  // ---------- client: latest check-in ----------
  async function mountClientCheckin(root, onAccepted) {
    let checkins;
    try {
      ({ checkins } = await api('GET', '/api/checkins'));
    } catch {
      return;
    }
    const ci = checkins[0];
    const recent = ci && Date.now() - Date.parse(ci.createdAt) < 8 * 86400000;
    // Once the client has accepted the changes, the check-in is done and the card disappears.
    if (!ci || ci.status === 'accepted' || !(recent || (ci.status === 'open' && ci.changes.length))) {
      root.innerHTML = '';
      return;
    }
    const date = new Date(ci.createdAt).toLocaleDateString((window.I18N ? I18N.locale : 'de-DE'), { weekday: 'long', day: '2-digit', month: '2-digit' });
    const hasChanges = ci.changes.length > 0;
    const changesHtml = hasChanges
      ? `<div class="proposal"><div class="small muted" style="margin-bottom:6px">Vorgeschlagene Anpassungen für deinen Plan</div>
          <ul class="change-list">${ci.changeItems
            .map((i) => `<li><span>${esc(i.label)}</span><span><s class="muted">${esc(i.before)}</s> → <strong>${esc(i.after)}</strong></span></li>`)
            .join('')}</ul></div>`
      : '';
    const state =
      ci.status === 'accepted'
        ? `<p class="good small" style="margin:10px 0 0"><strong>✓ Angenommen</strong> am ${esc(new Date(ci.acceptedAt).toLocaleDateString((window.I18N ? I18N.locale : 'de-DE')))} – dein Plan ist aktualisiert.</p>`
        : '';
    root.innerHTML = `
      <section class="card checkin-card">
        <div class="row-between"><h2>📋 Check-in von deinem Coach</h2><span class="badge">${esc(date)}</span></div>
        <p class="checkin-msg">${esc(ci.message)}</p>
        ${highlightsHtml(ci.highlights, 'Highlights deiner Woche')}
        ${changesHtml}
        ${state}
        <div class="row" style="margin-top:12px">
          ${hasChanges && ci.status === 'open' ? '<button type="button" class="btn-primary" data-accept>✓ Anpassungen annehmen</button>' : ''}
          <button type="button" class="btn-secondary" data-reply>${ci.repliedAt ? 'Nochmal antworten' : 'Antworten'}</button>
          <a class="btn btn-ghost" href="/api/checkins/${ci.id}/pdf" download>Als PDF</a>
        </div>
        <form class="reply-form" hidden>
          <textarea name="body" maxlength="2000" placeholder="Deine Antwort an den Coach…"></textarea>
          <div class="row" style="margin-top:8px"><button type="submit" class="btn-primary">Antwort senden</button>
            <button type="button" class="btn-ghost" data-cancel>Abbrechen</button></div>
        </form>
        ${ci.repliedAt ? '<p class="small muted" style="margin:8px 0 0">Deine Antwort ist im Chat unter „Nachrichten“.</p>' : ''}
      </section>`;

    const form = root.querySelector('.reply-form');
    root.querySelector('[data-reply]').addEventListener('click', () => {
      form.hidden = false;
      form.body.focus();
    });
    root.querySelector('[data-cancel]').addEventListener('click', () => (form.hidden = true));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!form.body.value.trim()) return;
      try {
        await api('POST', `/api/checkins/${ci.id}/reply`, { body: form.body.value });
        toast('Antwort gesendet');
        mountClientCheckin(root, onAccepted);
      } catch (err) {
        toast(err.message, true);
      }
    });
    const accept = root.querySelector('[data-accept]');
    if (accept) {
      accept.addEventListener('click', async () => {
        accept.disabled = true;
        try {
          await api('POST', `/api/checkins/${ci.id}/accept`);
          toast('Anpassungen angenommen – dein Plan ist aktualisiert ✓');
          await onAccepted();
          mountClientCheckin(root, onAccepted);
        } catch (err) {
          accept.disabled = false;
          toast(err.message, true);
        }
      });
    }
  }

  // ---------- plan (goals) helpers ----------
  const PLAN_LABELS = {
    calories: 'Kalorien pro Tag',
    stepsGoal: 'Schritte pro Tag',
    sleepGoal: 'Schlaf pro Nacht',
    targetWeight: 'Zielgewicht',
  };
  function fmtPlan(key, v) {
    if (v === null || v === undefined) return '–';
    if (key === 'stepsGoal') return `${num(v)} Schritte`;
    if (key === 'sleepGoal') return fmtSleep(v);
    return `${num(v, 1)} kg`;
  }
  const hasKcal = (g) => g && g.caloriesMin !== null && g.caloriesMin !== undefined;
  function fmtKcal(min, max) {
    if (min === null || min === undefined) return '–';
    return min === max ? `${num(min)} kcal` : `${num(min)}–${num(max)} kcal`;
  }
  const kcalMid = (g) => (hasKcal(g) ? Math.round((g.caloriesMin + g.caloriesMax) / 2) : null);

  /** Calorie range for every day between from and to, from the history of plan changes. */
  function kcalTargets(history, from, to) {
    const changes = (history || []).map((h) => {
      const d = new Date(h.changedAt);
      return { date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`, min: h.caloriesMin, max: h.caloriesMax };
    });
    const out = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      let cur = null;
      for (const c of changes) if (c.date <= d) cur = c;
      if (cur && cur.min !== null && cur.min !== undefined) out.push({ date: d, min: cur.min, max: cur.max });
    }
    return out;
  }

  function kcalCell(e) {
    if (e.caloriesOk === true) return '<span class="good">✓ eingehalten</span>';
    if (e.caloriesOk === false) return `<span class="bad">✗ ${e.calories !== null && e.calories !== undefined ? `${num(e.calories)} kcal` : 'nicht eingehalten'}</span>`;
    return '–';
  }

  // ---------- shared dashboard ----------
  const RANGES = [
    ['30', '30 T'],
    ['90', '90 T'],
    ['365', '1 J'],
    ['all', 'Alle'],
  ];

  /** Tiny trend graphics for the metric rows (glanceable, decorative – the value is always in text). */
  function sparkLine(values) {
    const pts = values.map((v, i) => [i, v]).filter(([, v]) => v !== null && v !== undefined);
    if (pts.length < 2) return '';
    const W = 96, H = 34, P = 3;
    const ys = pts.map(([, v]) => v);
    const lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
    const x = (i) => P + (i / Math.max(1, values.length - 1)) * (W - 2 * P);
    const y = (v) => H - P - ((v - lo) / span) * (H - 2 * P);
    const d = pts.map(([i, v], k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const [li, lv] = pts[pts.length - 1];
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${d}"/><circle cx="${x(li).toFixed(1)}" cy="${y(lv).toFixed(1)}" r="2.6"/></svg>`;
  }
  function sparkBars(values, goal) {
    const max = Math.max(goal || 0, ...values.filter((v) => v !== null && v !== undefined), 1);
    const W = 96, H = 34, n = values.length, bw = W / n;
    const bars = values
      .map((v, i) => {
        if (v === null || v === undefined) return `<rect x="${(i * bw + 1).toFixed(1)}" y="${H - 2}" width="${(bw - 2).toFixed(1)}" height="2" class="empty"/>`;
        const h = Math.max(2, (v / max) * (H - 2));
        return `<rect x="${(i * bw + 1).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${h.toFixed(1)}" class="${goal && v >= goal ? 'hit' : ''}"/>`;
      })
      .join('');
    return `<svg class="spark bars" viewBox="0 0 ${W} ${H}" aria-hidden="true">${bars}</svg>`;
  }
  /** Last 7 days as small marks: ✓ kept / ✕ missed / · no answer (shape, not only colour). */
  function weekMarks(days, fn) {
    const names = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
    return `<span class="week-marks" aria-hidden="true">${days
      .map((d) => {
        const v = fn(d.entry);
        const cls = v === true ? 'yes' : v === false ? 'no' : 'none';
        return `<span class="wm ${cls}"><i>${v === true ? '✓' : v === false ? '✕' : ''}</i><small>${names[new Date(`${d.date}T12:00:00`).getDay()]}</small></span>`;
      })
      .join('')}</span>`;
  }

  function mountDashboard(root, { entries, goals, history, measurements, onEdit, onDelete, onPrAdd, onPrDelete }) {
    let rangeKey = '30';
    let all = entries;
    const open = new Set(['weight']); // expanded metric rows

    root.innerHTML = `
      <div class="row-between dash-head">
        <div><h2>Verlauf</h2><p class="dash-summary small" data-summary></p></div>
        <div class="segmented" role="group" aria-label="Zeitraum der Diagramme">
          ${RANGES.map(([k, l]) => `<button type="button" data-range="${k}" aria-pressed="${k === rangeKey}">${l}</button>`).join('')}
        </div>
      </div>
      <div class="metric-list" data-metrics></div>
      <div data-pr></div>
      <details class="card entries-details">
        <summary><span>Alle Einträge</span><span class="muted small" data-entries-count></span></summary>
        <div class="table-wrap" data-table></div>
      </details>`;

    root.querySelectorAll('[data-range]').forEach((b) =>
      b.addEventListener('click', () => {
        rangeKey = b.dataset.range;
        root.querySelectorAll('[data-range]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        draw();
      })
    );

    function rangeBounds() {
      const to = todayStr();
      if (rangeKey === 'all') return { from: all.length ? all[0].date : addDays(to, -29), to };
      return { from: addDays(to, -(Number(rangeKey) - 1)), to };
    }

    /** One row per metric: value + context + sparkline; tapping reveals the full chart. */
    function buildMetrics() {
      const today = todayStr();
      const byDate = new Map(all.map((e) => [e.date, e]));
      const lastDays = (n) => Array.from({ length: n }, (_, i) => addDays(today, i - n + 1)).map((date) => ({ date, entry: byDate.get(date) || null }));
      const last7 = lastDays(7).map((d) => d.entry).filter(Boolean);
      const spark14 = (k) => lastDays(14).map((d) => (d.entry ? d.entry[k] : null));
      const list = [];

      // Weight
      const weights = all.filter((e) => e.weight !== null);
      const cur = weights[weights.length - 1] || null;
      let ref7 = null;
      if (cur) for (const w of weights) if (daysBetween(w.date, cur.date) >= 7) ref7 = w;
      const goodDir = goals.targetWeight !== null && cur && goals.targetWeight > cur.weight ? 1 : -1;
      const deltaHtml = (d, label) => `<span class="${d === 0 ? '' : Math.sign(d) === goodDir ? 'down' : 'up'}">${signed(d)} kg</span> ${label}`;
      const wSub = [];
      if (cur && ref7) wSub.push(deltaHtml(cur.weight - ref7.weight, 'in 7 Tagen'));
      if (goals.targetWeight !== null && cur) {
        wSub.push(Math.abs(cur.weight - goals.targetWeight) < 0.05 ? '<span class="good">Ziel erreicht</span>' : `noch ${num(Math.abs(cur.weight - goals.targetWeight), 1)} kg bis ${num(goals.targetWeight, 1)} kg`);
      }
      list.push({
        key: 'weight', label: 'Gewicht', cls: 'm-weight',
        value: cur ? `${num(cur.weight, 1)}<small>kg</small>` : '–',
        sub: cur ? wSub.join(' · ') || `am ${fmtDate(cur.date, { day: '2-digit', month: '2-digit' })}` : 'Noch kein Gewicht eingetragen',
        spark: sparkLine(spark14('weight')),
        legend: '<div class="legend"><span><i class="faint"></i>Tageswert</span><span><i></i>Ø 7 Tage</span></div>',
        render(el, from, to, inRange) {
          Charts.render(el, { data: inRange.map((e) => ({ date: e.date, value: e.weight })), from, to, type: 'line', trend: true, goal: goals.targetWeight, unit: 'kg', decimals: 1, label: 'Gewichtsverlauf' });
        },
      });

      // Calories (only with a plan or answers)
      const kcalAnswered = last7.filter((e) => e.caloriesOk !== null && e.caloriesOk !== undefined);
      if (hasKcal(goals) || kcalAnswered.length) {
        list.push({
          key: 'kcal', label: 'Kalorien', cls: 'm-kcal',
          value: hasKcal(goals) ? `${num(kcalMid(goals))}<small>kcal</small>` : '–',
          sub: [
            hasKcal(goals) && goals.caloriesMin !== goals.caloriesMax ? `Range ${esc(fmtKcal(goals.caloriesMin, goals.caloriesMax))}` : hasKcal(goals) ? 'Vorgabe' : 'Keine Vorgabe',
            kcalAnswered.length ? `${kcalAnswered.filter((e) => e.caloriesOk).length}/${kcalAnswered.length} Tage eingehalten` : '',
          ].filter(Boolean).join(' · '),
          spark: weekMarks(lastDays(7), (e) => (e ? e.caloriesOk : null)),
          legend: `<div class="legend"><span><i class="lg-band"></i>Range</span><span><i></i>Mittelwert</span><span><i class="lg-dot" style="background:var(--good)"></i>eingehalten</span><span><i class="lg-dot" style="background:var(--bad)"></i>nicht eingehalten</span></div>`,
          render(el, from, to, inRange) {
            Charts.renderCalories(el, { from, to, height: 190, targets: kcalTargets(history, from, to), days: inRange.map((e) => ({ date: e.date, ok: e.caloriesOk, kcal: e.calories })) });
          },
        });
      }

      // Steps & sleep
      const steps7 = avg(last7.filter((e) => e.steps !== null).map((e) => e.steps));
      const stepsHit = goals.stepsGoal ? last7.filter((e) => e.steps !== null && e.steps >= goals.stepsGoal).length : null;
      list.push({
        key: 'steps', label: 'Schritte', cls: 'm-steps', note: 'Ø 7 Tage',
        value: num(steps7),
        sub: goals.stepsGoal ? `Ziel ${num(goals.stepsGoal)} · an ${stepsHit} von 7 Tagen erreicht` : 'Kein Schrittziel',
        spark: sparkBars(spark14('steps'), goals.stepsGoal),
        render(el, from, to, inRange) {
          Charts.render(el, { data: inRange.map((e) => ({ date: e.date, value: e.steps })), from, to, type: 'bar', goal: goals.stepsGoal, unit: 'Schritte', label: 'Schritte pro Tag' });
        },
      });
      const sleep7 = avg(last7.filter((e) => e.sleep !== null).map((e) => e.sleep));
      const sleepHit = goals.sleepGoal ? last7.filter((e) => e.sleep !== null && e.sleep >= goals.sleepGoal).length : null;
      list.push({
        key: 'sleep', label: 'Schlaf', cls: 'm-sleep', note: 'Ø 7 Tage',
        value: fmtSleep(sleep7).replace(' h', '<small>h</small>'),
        sub: goals.sleepGoal ? `Ziel ${fmtSleep(goals.sleepGoal)} · in ${sleepHit} von 7 Nächten erreicht` : 'Kein Schlafziel',
        spark: sparkBars(spark14('sleep'), goals.sleepGoal),
        render(el, from, to, inRange) {
          Charts.render(el, { data: inRange.map((e) => ({ date: e.date, value: e.sleep })), from, to, type: 'bar', decimals: 1, goal: goals.sleepGoal, label: 'Schlafdauer', formatValue: fmtSleep });
        },
      });

      // Training (no chart – the week marks say it all)
      list.push({
        key: 'training', label: 'Training', cls: 'm-training',
        value: `${last7.filter((e) => e.training === true).length}<small>× in 7 Tagen</small>`,
        sub: '',
        spark: weekMarks(lastDays(7), (e) => (e && e.training !== null && e.training !== undefined ? e.training : null)),
      });

      // Extra measurements of the client's category
      for (const m of (measurements || []).filter((x) => x.kind === 'number')) {
        const vals = m.values || [];
        const last = vals[vals.length - 1];
        const { from } = rangeBounds();
        const first = vals.find((v) => v.date >= from) || vals[0];
        const delta = last && first && last.date !== first.date ? last.value - first.value : null;
        list.push({
          key: `metric-${m.id}`, label: m.name, cls: 'm-extra',
          value: last ? `${num(last.value, 1)}<small>${esc(m.unit)}</small>` : '–',
          sub: last ? (delta !== null ? `${signed(delta)} ${esc(m.unit)} im Zeitraum` : `am ${fmtDate(last.date, { day: '2-digit', month: '2-digit' })}`) : 'Noch kein Wert',
          spark: sparkLine(vals.slice(-14).map((v) => v.value)),
          render(el, f, to) {
            Charts.render(el, { data: vals.filter((v) => v.date >= f && v.date <= to), from: f, to, type: 'line', unit: m.unit, decimals: 1, height: 170, label: m.name });
          },
        });
      }
      return list;
    }

    function drawMetrics() {
      const slot = root.querySelector('[data-metrics]');
      const { from, to } = rangeBounds();
      const inRange = all.filter((e) => e.date >= from && e.date <= to);
      const metrics = buildMetrics();
      slot.innerHTML = metrics
        .map((m) => {
          const expandable = Boolean(m.render);
          const isOpen = expandable && open.has(m.key);
          const head = `
            <span class="metric-info">
              <span class="metric-label"><i class="metric-dot"></i>${esc(m.label)}${m.note ? `<span class="muted"> · ${m.note}</span>` : ''}</span>
              <span class="metric-value">${m.value}</span>
              ${m.sub ? `<span class="metric-sub">${m.sub}</span>` : ''}
            </span>
            <span class="metric-visual">${m.spark || ''}</span>
            ${expandable ? '<span class="metric-chev" aria-hidden="true"></span>' : ''}`;
          return `<section class="card metric ${m.cls} ${isOpen ? 'open' : ''}" data-metric="${m.key}">
            ${expandable
              ? `<button type="button" class="metric-row" aria-expanded="${isOpen}" aria-controls="md-${m.key}">${head}</button>`
              : `<div class="metric-row static">${head}</div>`}
            ${expandable ? `<div class="metric-detail" id="md-${m.key}" ${isOpen ? '' : 'hidden'}>${m.legend || ''}<div class="chart-${m.key.startsWith('metric-') ? 'metric' : m.key}" data-chart></div></div>` : ''}
          </section>`;
        })
        .join('');
      const renderOpen = () => {
        for (const m of metrics) {
          if (!m.render || !open.has(m.key)) continue;
          const el = slot.querySelector(`[data-metric="${m.key}"] [data-chart]`);
          if (el) m.render(el, from, to, inRange);
        }
      };
      renderOpen();
      slot.querySelectorAll('.metric-row[aria-expanded]').forEach((btn) =>
        btn.addEventListener('click', () => {
          const key = btn.closest('[data-metric]').dataset.metric;
          if (open.has(key)) open.delete(key);
          else open.add(key);
          drawMetrics();
        })
      );
      drawMetrics.renderOpen = renderOpen;

      // One line of context instead of a "consistency" tile
      const today = todayStr();
      const days7 = new Set(all.filter((e) => daysBetween(e.date, today) >= 0 && daysBetween(e.date, today) < 7).map((e) => e.date)).size;
      const lastEntry = all.length ? all[all.length - 1].date : null;
      root.querySelector('[data-summary]').innerHTML = `<span class="${days7 >= 6 ? 'good' : days7 >= 4 ? '' : 'bad'}"><strong>${days7}/7</strong> Tage eingetragen</span> · letzter Eintrag ${esc(relDay(lastEntry))}`;
    }

    function drawTable() {
      const { from, to } = rangeBounds();
      const rows = all.filter((e) => e.date >= from && e.date <= to).slice().reverse();
      const wrap = root.querySelector('[data-table]');
      root.querySelector('[data-entries-count]').textContent = rows.length ? `${rows.length} im Zeitraum` : '';
      if (!rows.length) {
        wrap.innerHTML = '<div class="empty-state">Keine Einträge in diesem Zeitraum.</div>';
        return;
      }
      const editable = Boolean(onEdit);
      wrap.innerHTML = `<table>
        <thead><tr><th>Datum</th><th class="num">Gewicht</th><th class="num">Schritte</th><th class="num">Schlaf</th><th>Training</th><th>Kalorien</th><th>Notiz</th>${editable ? '<th></th>' : ''}</tr></thead>
        <tbody>${rows
          .map(
            (e) => `<tr>
              <td>${esc(fmtDate(e.date))}</td>
              <td class="num">${e.weight !== null ? `${num(e.weight, 1)} kg` : '–'}</td>
              <td class="num">${num(e.steps)}</td>
              <td class="num">${fmtSleep(e.sleep)}</td>
              <td>${e.training === true ? '🏋️ Ja' : e.training === false ? '<span class="muted">Nein</span>' : '–'}</td>
              <td>${kcalCell(e)}</td>
              <td class="note">${esc(e.note || '')}</td>
              ${editable ? `<td class="actions"><button type="button" class="btn-ghost btn-sm" data-edit="${e.date}">Bearbeiten</button><button type="button" class="btn-ghost btn-sm" data-del="${e.date}" aria-label="Löschen">✕</button></td>` : ''}
            </tr>`
          )
          .join('')}</tbody></table>`;
      if (editable) {
        wrap.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => onEdit(b.dataset.edit)));
        wrap.querySelectorAll('[data-del]').forEach((b) =>
          b.addEventListener('click', () => onDelete(b.dataset.del).catch((err) => toast(err.message, true)))
        );
      }
    }

    function drawPrs() {
      const slot = root.querySelector('[data-pr]');
      const prMetric = (measurements || []).find((m) => m.kind === 'pr');
      if (!prMetric) {
        slot.innerHTML = '';
        slot.hidden = true;
        return;
      }
      slot.hidden = false;
      const prs = prMetric.prs || [];
      const best = new Map();
      for (const p of prs) {
        const k = p.exercise.toLowerCase();
        const b = best.get(k);
        if (!b) best.set(k, { ...p, first: p });
        else if (p.weight > b.weight || (p.weight === b.weight && p.reps > b.reps)) best.set(k, { ...p, first: b.first });
      }
      const exercises = [...new Set(prs.map((p) => p.exercise))];
      slot.innerHTML = `<section class="card pr-card">
        <div class="row-between" style="margin-bottom:12px"><h3>💪 ${esc(prMetric.name)}</h3><span class="muted small">${prs.length} Einträge</span></div>
        ${onPrAdd ? `<form class="pr-form" novalidate>
          <input name="exercise" list="pr-exercises" maxlength="60" placeholder="Übung, z. B. Bankdrücken" aria-label="Übung">
          <datalist id="pr-exercises">${exercises.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
          <div class="input-unit"><input name="weight" inputmode="decimal" placeholder="Gewicht" aria-label="Gewicht"><span>kg</span></div>
          <div class="input-unit"><input name="reps" inputmode="numeric" placeholder="Wdh." aria-label="Wiederholungen"><span>×</span></div>
          <button type="submit" class="btn-primary">PR speichern</button>
        </form>` : ''}
        ${best.size ? `<div class="table-wrap"><table>
          <thead><tr><th>Übung</th><th class="num">Bestwert</th><th class="num">Seit Start</th><th>Datum</th></tr></thead>
          <tbody>${[...best.values()]
            .sort((a, b) => a.exercise.localeCompare(b.exercise))
            .map((b) => {
              const gain = b.first && b.first.id !== b.id ? b.weight - b.first.weight : null;
              return `<tr><td>${esc(b.exercise)}</td><td class="num"><strong>${num(b.weight, 1)} kg × ${b.reps}</strong></td>
                <td class="num ${gain > 0 ? 'good' : ''}">${gain !== null ? `${signed(gain)} kg` : '–'}</td><td>${esc(fmtDate(b.date, { day: '2-digit', month: '2-digit', year: '2-digit' }))}</td></tr>`;
            })
            .join('')}</tbody></table></div>
          <details class="pr-history"><summary>Alle Einträge</summary>
            <ul class="plain-list">${prs
              .slice()
              .reverse()
              .map((p) => `<li><span>${esc(fmtDate(p.date, { day: '2-digit', month: '2-digit' }))} · ${esc(p.exercise)} · ${num(p.weight, 1)} kg × ${p.reps} ${p.isRecord && p.previous ? '<span class="badge good">Rekord</span>' : ''}</span>
                ${onPrDelete ? `<button type="button" class="btn-ghost btn-sm" data-del-pr="${p.id}" aria-label="Löschen">✕</button>` : ''}</li>`)
              .join('')}</ul></details>` : `<p class="muted small" style="margin:0">${onPrAdd ? 'Noch keine PRs – trag deinen ersten Bestwert ein.' : 'Noch keine PRs eingetragen.'}</p>`}
      </section>`;
      const form = slot.querySelector('.pr-form');
      if (form) {
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          try {
            const weight = parseNum(form.weight.value);
            const reps = parseNum(form.reps.value);
            if (!form.exercise.value.trim()) throw new Error('Bitte die Übung angeben.');
            if (weight === null || Number.isNaN(weight) || !reps || Number.isNaN(reps)) throw new Error('Bitte Gewicht und Wiederholungen angeben.');
            measurements = await onPrAdd({ metricId: prMetric.id, exercise: form.exercise.value, weight, reps, date: todayStr() });
            drawPrs();
          } catch (err) {
            toast(err.message, true);
          }
        });
      }
      slot.querySelectorAll('[data-del-pr]').forEach((b) =>
        b.addEventListener('click', async () => {
          if (!confirm('Diesen PR löschen?')) return;
          try {
            measurements = await onPrDelete(Number(b.dataset.delPr));
            drawPrs();
          } catch (err) {
            toast(err.message, true);
          }
        })
      );
    }

    function draw() {
      drawMetrics();
      drawTable();
    }

    let resizeTimer;
    const resizeHandler = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => drawMetrics.renderOpen && drawMetrics.renderOpen(), 150);
    };
    window.addEventListener('resize', resizeHandler);
    onCleanup(() => window.removeEventListener('resize', resizeHandler));

    draw();
    drawPrs();
    return {
      update(newEntries) {
        all = newEntries;
        draw();
      },
      setMeasurements(m) {
        measurements = m;
        drawMetrics();
        drawPrs();
      },
      setGoals(g, h) {
        goals = g;
        if (h) history = h;
        draw();
      },
    };
  }

  // ---------- push notifications ----------
  const push = {
    supported: () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
    isIos: () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    standalone: () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,

    /** Why push can't work in this browser, or null if it can. */
    blocker() {
      if (push.isIos() && !push.standalone()) return 'ios-home-screen';
      if (!push.supported()) return 'unsupported';
      return null;
    },

    async registration() {
      if (!('serviceWorker' in navigator)) return null;
      return navigator.serviceWorker.register('/sw.js');
    },

    async localSubscription() {
      if (!push.supported()) return null;
      const reg = await navigator.serviceWorker.getRegistration();
      return reg ? reg.pushManager.getSubscription() : null;
    },

    async enable() {
      const { publicKey } = await api('GET', '/api/push/config');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        if (permission === 'denied') {
          await api('POST', '/api/push/consent', { status: 'denied' });
          throw new Error('Mitteilungen sind im Browser blockiert. Du kannst sie in den Einstellungen deines Geräts für diese Seite wieder erlauben.');
        }
        throw new Error('Mitteilungen wurden nicht erlaubt.');
      }
      const reg = await push.registration();
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const raw = atob(publicKey.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (publicKey.length % 4)) % 4));
        try {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: Uint8Array.from(raw, (c) => c.charCodeAt(0)),
          });
        } catch (err) {
          throw new Error(`Dieser Browser konnte sich nicht für Push-Nachrichten anmelden. Bitte einen anderen Browser oder das Handy verwenden. (${err.message})`);
        }
      }
      await api('POST', '/api/push/subscribe', { subscription: sub.toJSON() });
    },

    async disable() {
      await push.forgetDevice();
      await api('POST', '/api/push/consent', { status: 'denied' });
    },

    /** Stops pushes to this browser only (e.g. on logout), without changing consent. */
    async forgetDevice() {
      const sub = await push.localSubscription();
      if (!sub) return;
      await api('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    },
  };

  const IOS_HINT =
    'Auf dem iPhone funktionieren Push-Nachrichten nur, wenn StayOnTrack auf dem Home-Bildschirm liegt: ' +
    'In Safari unten auf das Teilen-Symbol tippen → „Zum Home-Bildschirm“ → danach StayOnTrack über das neue App-Symbol öffnen und hier aktivieren.';

  /** Card with push status + buttons. Used on the client settings page and for the coach. */
  async function mountPushCard(root, { title, intro }) {
    const [cfg, local] = await Promise.all([api('GET', '/api/push/config'), push.localSubscription().catch(() => null)]);
    const blocker = push.blocker();
    let statusHtml;
    let buttons = '';
    if (cfg.status === 'granted' && local) {
      statusHtml = '<span class="badge good">Aktiv auf diesem Gerät</span>';
      buttons = `<button type="button" class="btn-secondary" data-push="test">Test senden</button>
                 <button type="button" class="btn-ghost" data-push="off">Deaktivieren</button>`;
    } else if (blocker === 'ios-home-screen') {
      statusHtml = '<span class="badge warn">Erst zum Home-Bildschirm hinzufügen</span>';
    } else if (blocker === 'unsupported') {
      statusHtml = '<span class="badge">Von diesem Browser nicht unterstützt</span>';
    } else {
      statusHtml =
        cfg.status === 'denied'
          ? '<span class="badge bad">Ausgeschaltet</span>'
          : cfg.status === 'granted'
            ? `<span class="badge warn">Aktiv auf ${cfg.devices} anderen Gerät${cfg.devices === 1 ? '' : 'en'}</span>`
            : '<span class="badge">Noch nicht eingerichtet</span>';
      buttons = '<button type="button" class="btn-primary" data-push="on">Benachrichtigungen aktivieren</button>';
    }
    root.innerHTML = `
      <div class="row-between" style="margin-bottom:8px"><h2>${esc(title)}</h2>${statusHtml}</div>
      <p class="muted small">${esc(intro)}</p>
      ${blocker === 'ios-home-screen' ? `<p class="hint-box">${esc(IOS_HINT)}</p>` : ''}
      <div class="row">${buttons}</div>`;
    const run = (fn, msg) => async (e) => {
      e.target.disabled = true;
      try {
        await fn();
        if (msg) toast(msg);
      } catch (err) {
        toast(err.message, true);
      }
      mountPushCard(root, { title, intro });
    };
    const on = root.querySelector('[data-push=on]');
    if (on) on.addEventListener('click', run(push.enable, 'Benachrichtigungen aktiviert ✓'));
    const off = root.querySelector('[data-push=off]');
    if (off) off.addEventListener('click', run(push.disable, 'Benachrichtigungen ausgeschaltet'));
    const test = root.querySelector('[data-push=test]');
    if (test) {
      test.addEventListener('click', run(async () => {
        const r = await api('POST', '/api/push/test');
        if (!r.delivered) throw new Error('Test konnte nicht zugestellt werden.');
      }, 'Test gesendet – kommt gleich an'));
    }
  }

  /** One-time question on the tracker page for clients who haven't decided yet. */
  async function maybeShowPushPrompt(root) {
    try {
      const cfg = await api('GET', '/api/push/config');
      if (cfg.status !== 'unknown' || push.blocker() === 'unsupported') return;
      const ios = push.blocker() === 'ios-home-screen';
      try {
        if (ios && localStorage.getItem('pushPromptLater') === todayStr()) return;
      } catch {
        /* storage unavailable */
      }
      root.innerHTML = `
        <div class="card banner">
          <div><strong>🔔 Erinnerungen &amp; Nachrichten von deinem Coach aufs Handy?</strong>
            <p class="small muted">${ios ? esc(IOS_HINT) : 'Du kannst das jederzeit unter „Einstellungen“ wieder ändern.'}</p></div>
          <div class="row">
            ${ios ? '<button type="button" class="btn-secondary" data-later>Später</button>' : `
              <button type="button" class="btn-primary" data-yes>Ja, aktivieren</button>
              <button type="button" class="btn-ghost" data-no>Nein danke</button>`}
          </div>
        </div>`;
      const yes = root.querySelector('[data-yes]');
      if (yes) {
        yes.addEventListener('click', async () => {
          try {
            await push.enable();
            toast('Benachrichtigungen aktiviert ✓');
            root.innerHTML = '';
          } catch (err) {
            toast(err.message, true);
          }
        });
      }
      const no = root.querySelector('[data-no]');
      if (no) {
        no.addEventListener('click', async () => {
          await api('POST', '/api/push/consent', { status: 'denied' }).catch(() => {});
          root.innerHTML = '';
        });
      }
      const later = root.querySelector('[data-later]');
      if (later) {
        later.addEventListener('click', () => {
          try {
            localStorage.setItem('pushPromptLater', todayStr());
          } catch {
            /* ignore */
          }
          root.innerHTML = '';
        });
      }
    } catch {
      /* not critical */
    }
  }


  // ---------- Google Health: steps and sleep automatically ----------
  const GOOGLE_RESULT = {
    'google-ok': ['Google Health verbunden', 'Schritte und Schlaf kommen jetzt automatisch'],
    'google-partial': ['Teilweise verbunden', 'Nicht alle Daten sind freigegeben'],
  };
  const GOOGLE_ERRORS = {
    denied: 'Du hast die Freigabe bei Google abgebrochen. Du kannst es jederzeit nochmal versuchen.',
    state: 'Die Anmeldung bei Google ist abgelaufen. Bitte starte die Verbindung nochmal.',
    token: 'Google hat die Verbindung nicht bestätigt. Bitte versuch es nochmal.',
    scopes: 'Ohne Freigabe von Schritten oder Schlaf kann StayOnTrack nichts übernehmen. Wähle bei Google mindestens eins davon aus.',
    google: 'Google meldet einen Fehler. Bitte versuch es später nochmal.',
  };

  async function mountGoogleCard(root) {
    if (!root) return;
    let st;
    try {
      st = await api('GET', '/api/google');
    } catch {
      root.hidden = true;
      return;
    }
    if (!st.configured && !st.connected) {
      root.hidden = true; // not set up on the server: nothing to offer
      return;
    }
    const when = (iso) => (iso ? new Date(iso).toLocaleString((window.I18N ? I18N.locale : 'de-DE'), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'noch nie');
    const draw = (busy) => {
      const on = st.connected;
      root.innerHTML = `
        <div class="row-between"><h2>Google Health</h2>
          <span class="badge ${on ? 'good' : st.revoked ? 'bad' : ''}">${on ? 'Verbunden' : st.revoked ? 'Zugriff entzogen' : 'Nicht verbunden'}</span></div>
        <p class="muted small">Schritte und Schlaf kommen automatisch in deinen Tracker – von deinem Fitbit, deiner Pixel Watch oder aus Apps, die mit Google Health bzw. Health Connect verbunden sind.</p>
        ${on ? `<ul class="google-scopes">
            <li class="${st.steps ? 'ok' : 'off'}"><span aria-hidden="true">${st.steps ? '✓' : '–'}</span> Schritte ${st.steps ? '' : '<span class="muted small">(nicht freigegeben)</span>'}</li>
            <li class="${st.sleep ? 'ok' : 'off'}"><span aria-hidden="true">${st.sleep ? '✓' : '–'}</span> Schlaf ${st.sleep ? '' : '<span class="muted small">(nicht freigegeben)</span>'}</li>
          </ul>
          <p class="small muted">Zuletzt abgeglichen: <strong>${esc(when(st.lastSyncAt))}</strong> · automatisch alle 2 Stunden</p>
          ${st.lastError ? `<p class="small bad">Letzter Abgleich fehlgeschlagen: ${esc(st.lastError)}</p>` : ''}
          ${!st.steps || !st.sleep ? '<p class="small">Fehlt etwas? <button type="button" class="link-btn" data-google-connect>Freigabe erweitern</button></p>' : ''}
          <div class="row" style="gap:8px">
            <button type="button" class="btn-secondary" data-google-sync ${busy ? 'disabled' : ''}>${busy ? 'Gleiche ab…' : 'Jetzt abgleichen'}</button>
            <button type="button" class="btn-ghost danger-text" data-google-off>Trennen</button>
          </div>`
        : `<details class="google-privacy"><summary>Was wird übertragen?</summary>
            <p class="small muted">Nur deine täglichen <strong>Schritte</strong> und deine <strong>Schlafdauer</strong> (Nickerchen zählen nicht) – lesend, nichts wird bei Google verändert. Werte, die du selbst einträgst, wie Gewicht oder Notizen, bleiben unberührt. Trennen kannst du jederzeit hier oder in deinem Google-Konto. Mehr in der <a href="/datenschutz" target="_blank" rel="noopener">Datenschutzerklärung</a>.</p></details>
          ${st.revoked ? '<p class="small bad">Der Zugriff wurde in deinem Google-Konto entfernt. Verbinde dich neu, damit wieder Daten kommen.</p>' : ''}
          <button type="button" class="btn-primary" data-google-connect>${st.revoked ? 'Neu verbinden' : 'Mit Google Health verbinden'}</button>`}`;
      root.querySelectorAll('[data-google-connect]').forEach((b) => b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          const { url } = await api('POST', '/api/google/connect');
          location.href = url;
        } catch (err) {
          toast(err.message, true);
          b.disabled = false;
        }
      }));
      const sync = root.querySelector('[data-google-sync]');
      if (sync) sync.addEventListener('click', async () => {
        draw(true);
        try {
          const r = await api('POST', '/api/google/sync');
          st = r.status;
          savedHud('Abgeglichen', `${r.steps} Tage Schritte · ${r.sleep} Nächte Schlaf`);
        } catch (err) {
          toast(err.message, true);
          st = await api('GET', '/api/google').catch(() => st);
        }
        draw(false);
      });
      const off = root.querySelector('[data-google-off]');
      if (off) off.addEventListener('click', async () => {
        if (!confirm('Google Health trennen? Bereits übertragene Werte bleiben im Tracker.')) return;
        st = await api('DELETE', '/api/google');
        toast('Google Health getrennt');
        draw(false);
      });
    };
    draw(false);
  }

  // ---------- client: settings (push + appearance) ----------
  async function renderClientSettings(sub) {
    setView(`
      <div class="page-head"><div>${eyebrow('Konto')}<h1>Einstellungen</h1></div></div>
      <div class="settings-grid">
        <section class="card" id="google-card"></section>
        <section class="card" id="push-card"><p class="muted">Lade…</p></section>
        <section class="card" id="prefs-card"></section>
      </div>`);
    mountGoogleCard(document.getElementById('google-card'));
    // back from Google: show the result once, then clean up the address
    if (sub) {
      const [kind, code] = sub.split('/');
      if (GOOGLE_RESULT[kind]) savedHud(...GOOGLE_RESULT[kind]);
      else if (kind === 'google-error') toast(GOOGLE_ERRORS[code] || GOOGLE_ERRORS.google, true);
      history.replaceState(null, '', '#/settings');
    }
    mountPushCard(document.getElementById('push-card'), {
      title: 'Push-Benachrichtigungen',
      intro: 'Erinnerungen deines Coaches und neue Chat-Nachrichten direkt aufs Handy.',
    }).catch((err) => toast(err.message, true));
    mountPrefsCard(document.getElementById('prefs-card'));
  }

  // ---------- chat ----------
  function renderClientChat() {
    setView(`<div class="page-head"><div>${eyebrow('Chat mit deinem Coach')}<h1>Nachrichten</h1></div></div><div id="chat"></div>`);
    mountChat(document.getElementById('chat'), {
      query: '',
      title: 'Dein Draht zum Coach',
      subtitle: 'Wünsche, Fragen und Vorschläge – nur dein Coach liest mit.',
      empty: 'Noch keine Nachrichten. Schreib deinem Coach, was dir auf dem Herzen liegt – z. B. Wünsche zum Training, Fragen zur Ernährung oder Vorschläge.',
    });
  }

  function mountChat(root, { query, title, subtitle, empty, headExtra, onUpdate }) {
    root.innerHTML = `
      <section class="card chat">
        <div class="chat-head">${headExtra || ''}<div><h2>${esc(title)}</h2><p class="muted small">${esc(subtitle)}</p></div></div>
        <div class="chat-log" aria-live="polite"><p class="chat-empty">Lade…</p></div>
        <form class="chat-form">
          <textarea name="body" rows="1" maxlength="2000" placeholder="Nachricht schreiben…" aria-label="Nachricht"></textarea>
          <button class="btn-primary" type="submit">Senden</button>
        </form>
      </section>`;
    const log = root.querySelector('.chat-log');
    const form = root.querySelector('.chat-form');
    const input = form.body;
    let messages = [];
    let lastId = 0;
    let stopped = false;
    let scrolledOnce = false;

    const timeOf = (iso) => new Date(iso).toLocaleTimeString((window.I18N ? I18N.locale : 'de-DE'), { hour: '2-digit', minute: '2-digit' });
    const dayOf = (iso) => {
      const d = new Date(iso);
      const local = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      const diff = daysBetween(local, todayStr());
      return diff === 0 ? 'Heute' : diff === 1 ? 'Gestern' : fmtDate(local);
    };

    function draw() {
      if (!messages.length) {
        log.innerHTML = `<p class="chat-empty">${esc(empty)}</p>`;
        return;
      }
      const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
      let day = '';
      log.innerHTML = messages
        .map((m) => {
          const d = dayOf(m.createdAt);
          const sep = d !== day ? `<div class="chat-day">${esc(d)}</div>` : '';
          day = d;
          return `${sep}<div class="msg ${m.mine ? 'mine' : 'theirs'}">${esc(m.body)}<time>${timeOf(m.createdAt)}</time></div>`;
        })
        .join('');
      if (nearBottom || !scrolledOnce) log.scrollTop = log.scrollHeight;
      scrolledOnce = true;
    }

    async function load() {
      try {
        const { messages: fresh } = await api('GET', `/api/messages${query}${query ? '&' : '?'}after=${lastId}`);
        if (stopped) return;
        if (fresh.length || !lastId) {
          messages = messages.concat(fresh);
          if (fresh.length) lastId = fresh[fresh.length - 1].id;
          draw();
          refreshUnread();
          if (onUpdate) onUpdate();
        }
      } catch {
        /* retry on next poll */
      }
    }

    function autosize() {
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight + 2, 160)}px`;
    }
    input.addEventListener('input', autosize);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer: coarse)').matches) {
        e.preventDefault();
        form.requestSubmit();
      }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = input.value.trim();
      if (!body) return;
      const btn = form.querySelector('button');
      btn.disabled = true;
      try {
        await api('POST', `/api/messages${query}`, { body });
        input.value = '';
        autosize();
        await load();
        log.scrollTop = log.scrollHeight;
      } catch (err) {
        toast(err.message, true);
      } finally {
        btn.disabled = false;
        input.focus();
      }
    });

    load();
    const timer = setInterval(load, 8000);
    onCleanup(() => {
      stopped = true;
      clearInterval(timer);
    });
  }

  // ---------- coach: all chats in one place ----------
  async function renderInbox(selectedId) {
    setView(`
      <div class="page-head inbox-head"><div>${eyebrow('Coaching')}<h1>Nachrichten</h1></div></div>
      <div class="inbox ${selectedId ? 'has-chat' : ''}">
        <aside class="card inbox-list" aria-label="Chats"><p class="muted small">Lade…</p></aside>
        <div class="inbox-chat"></div>
      </div>`);
    const listEl = app.querySelector('.inbox-list');
    const chatEl = app.querySelector('.inbox-chat');
    let convs = [];
    let filter = '';

    const when = (iso) => {
      const d = new Date(iso);
      const local = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      const diff = daysBetween(local, todayStr());
      if (diff === 0) return d.toLocaleTimeString((window.I18N ? I18N.locale : 'de-DE'), { hour: '2-digit', minute: '2-digit' });
      if (diff === 1) return 'gestern';
      return d.toLocaleDateString((window.I18N ? I18N.locale : 'de-DE'), { day: '2-digit', month: '2-digit' });
    };
    const initials = (name) => name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
    const avatarOf = (c) =>
      c.avatar ? `<img class="inbox-avatar" src="${esc(c.avatar)}" alt="">` : `<span class="inbox-avatar initials">${esc(initials(c.displayName))}</span>`;

    function drawList() {
      const term = filter.trim().toLowerCase();
      const shown = convs.filter((c) => !term || c.displayName.toLowerCase().includes(term));
      const totalUnread = convs.reduce((a, c) => a + c.unread, 0);
      listEl.innerHTML = `
        <div class="inbox-list-head"><h2>Chats</h2>${totalUnread ? `<span class="unread-badge">${totalUnread} ungelesen</span>` : ''}</div>
        <input type="search" class="inbox-search" placeholder="Klient suchen" value="${esc(filter)}" aria-label="Klient suchen">
        <ul class="inbox-items">${shown
          .map((c) => `<li><a href="#/messages/${c.clientId}" class="inbox-item ${c.clientId === selectedId ? 'active' : ''} ${c.unread ? 'unread' : ''}"${c.clientId === selectedId ? ' aria-current="true"' : ''}>
              ${avatarOf(c)}
              <span class="inbox-main">
                <span class="inbox-top"><span class="inbox-name">${esc(c.displayName)} ${catTag(c.category)}</span>${c.lastMessage ? `<time>${esc(when(c.lastMessage.createdAt))}</time>` : ''}</span>
                <span class="inbox-preview">${c.lastMessage ? `${c.lastMessage.fromCoach ? '<span class="muted">Du: </span>' : ''}${esc(c.lastMessage.body)}` : '<span class="muted">Noch keine Nachrichten</span>'}</span>
              </span>
              ${c.unread ? `<span class="count">${c.unread}</span>` : ''}
            </a></li>`)
          .join('') || '<li class="muted small" style="padding:12px 4px">Keine Treffer.</li>'}</ul>`;
      const search = listEl.querySelector('.inbox-search');
      search.addEventListener('input', () => {
        filter = search.value;
        const pos = search.selectionStart;
        drawList();
        const s2 = listEl.querySelector('.inbox-search');
        s2.focus();
        s2.setSelectionRange(pos, pos);
      });
    }

    async function loadList() {
      try {
        convs = (await api('GET', '/api/messages/inbox')).conversations;
        if (!listEl.querySelector('.inbox-search:focus')) drawList();
      } catch {
        /* next poll */
      }
    }

    await loadList();
    const timer = setInterval(loadList, 12000);
    onCleanup(() => clearInterval(timer));

    if (!selectedId) {
      chatEl.innerHTML = `<div class="card inbox-empty"><p style="font-size:2rem;margin:0">💬</p>
        <p>${convs.length ? 'Wähle links einen Chat aus.' : 'Noch keine Klienten.'}</p></div>`;
      return;
    }
    const c = convs.find((x) => x.clientId === selectedId);
    if (!c) {
      chatEl.innerHTML = '<div class="card empty-state">Klient nicht gefunden.</div>';
      return;
    }
    mountChat(chatEl, {
      query: `?userId=${c.clientId}`,
      title: c.displayName,
      subtitle: `@${c.username}`,
      empty: `${c.displayName} hat dir noch nicht geschrieben. Du kannst das Gespräch auch selbst beginnen.`,
      headExtra: `<a class="inbox-back" href="#/messages" aria-label="Alle Chats">←</a>${avatarOf(c)}`,
      onUpdate: loadList,
    });
    const head = chatEl.querySelector('.chat-head');
    head.insertAdjacentHTML('beforeend', `<a class="small inbox-profile" href="#/client/${c.clientId}">Profil →</a>`);
  }

  // ---------- coach: overview ----------
  let pushOpen = false; // remembers whether the push section was expanded
  async function renderCoachHome() {
    setView(LOADING);
    const [{ clients }, queue, { weightAutomation, automation }] = await Promise.all([
      api('GET', '/api/clients'),
      api('GET', '/api/checkins/queue'),
      api('GET', '/api/notifications'),
    ]);

    const cards = clients
      .map((c) => {
        const days = c.lastEntry ? daysBetween(c.lastEntry, todayStr()) : null;
        const cls = days === null ? 'bad' : days <= 1 ? 'good' : days <= 3 ? 'warn' : 'bad';
        const delta = c.lastWeight !== null && c.firstWeight !== null ? c.lastWeight - c.firstWeight : null;
        return `<a class="card client-card" href="#/client/${c.id}${c.unreadMessages ? '/chat' : ''}">
          <div class="row-between">
            <h3>${c.avatar ? `<img class="mini-avatar" src="${esc(c.avatar)}" alt="">` : ''}${esc(c.displayName)} ${catTag(c.category)}</h3>
            <div class="row" style="gap:6px">
              ${c.unreadMessages ? `<span class="unread-badge">💬 ${c.unreadMessages} neu</span>` : ''}
              ${c.openSwaps ? `<span class="unread-badge">🍽 ${c.openSwaps}</span>` : ''}
              <span class="badge ${cls}">${relDay(c.lastEntry)}</span>
            </div>
          </div>
          <div class="muted small">@${esc(c.username)} · ${c.entries7d}/7 Tage eingetragen</div>
          <div class="metrics">
            <div><div class="metric-v">${c.lastWeight !== null ? `${num(c.lastWeight, 1)} kg` : '–'}</div>
              <div class="metric-l">${delta !== null ? `${signed(delta)} kg gesamt` : 'Gewicht'}</div></div>
            <div><div class="metric-v">${num(c.avgSteps7d)}</div><div class="metric-l">Schritte Ø 7 T</div></div>
            <div><div class="metric-v">${fmtSleep(c.avgSleep7d)}</div><div class="metric-l">Schlaf Ø 7 T</div></div>
          </div>
        </a>`;
      })
      .join('');

    setView(`
      <div class="page-head">
        <div>${eyebrow(todayLong())}<h1>Meine Klienten</h1><p class="muted">${clients.length} ${clients.length === 1 ? 'Klient' : 'Klienten'}</p></div>
        <button class="btn-primary" id="btn-new-client" type="button">+ Neuer Klient</button>
      </div>
      ${clients.length ? coachDashboard(clients, queue, weightAutomation) : ''}
      ${clients.length ? `<div class="client-list">${cards}</div>` : `<div class="card empty-state">
        <p>Noch keine Klienten angelegt.</p>
        <p>Lege einen Zugang an und gib die Zugangsdaten an deinen Klienten weiter.</p></div>`}
      <details class="push-section" ${pushOpen ? 'open' : ''}>
      <summary class="push-summary">
        <span><span class="push-title">Push-Benachrichtigungen</span>
          <span class="muted small">${[automation && automation.enabled, weightAutomation && weightAutomation.enabled].filter(Boolean).length} Automatik${[automation && automation.enabled, weightAutomation && weightAutomation.enabled].filter(Boolean).length === 1 ? '' : 'en'} aktiv · Zustimmung, geplante Nachrichten</span></span>
        <span class="metric-chev" aria-hidden="true"></span>
      </summary>
      <div class="push-body">
      <div class="row-between" style="margin-bottom:14px">
        <p class="muted small" style="margin:0">Einmalige und wiederkehrende Nachrichten an Klienten, die zugestimmt haben.</p>
        <button class="btn-primary" id="btn-new-push" type="button">+ Neue Push-Nachricht</button>
      </div>
      <div class="push-grid">
        <section class="card">
          <h3 style="margin-bottom:10px">Zustimmung deiner Klienten</h3>
          <div id="consent-list"></div>
        </section>
        <section class="card">
          <h3 style="margin-bottom:10px">Geplant &amp; gesendet</h3>
          <div id="notif-list"><p class="muted small">Lade…</p></div>
        </section>
        <section class="card" id="coach-push-card"></section>
      </div>
      </div>
      </details>`);
    app.querySelector('.push-section').addEventListener('toggle', (e) => {
      pushOpen = e.target.open;
    });

    renderConsentList(document.getElementById('consent-list'), clients);
    const notifRoot = document.getElementById('notif-list');
    const reloadNotifications = () => loadNotifications(notifRoot).catch((err) => toast(err.message, true));
    reloadNotifications();
    document.getElementById('btn-new-push').addEventListener('click', () => openPushDialog(clients, reloadNotifications));
    mountPushCard(document.getElementById('coach-push-card'), {
      title: 'Für dich',
      intro: 'Lass dich auf diesem Gerät benachrichtigen, wenn ein Klient dir schreibt.',
    }).catch(() => {});

    document.getElementById('btn-new-client').addEventListener('click', () => {
      const pw = randomPassword();
      openDialog(
        `<h2>Neuen Klienten anlegen</h2>
         <div class="field"><label for="c-name">Name</label><input id="c-name" name="displayName" required placeholder="Max Mustermann"></div>
         <div class="field"><label for="c-user">Benutzername</label><input id="c-user" name="username" autocapitalize="none" required placeholder="max">
           <div class="hint">3–32 Zeichen: Buchstaben, Ziffern, . _ -</div></div>
         <div class="field"><label for="c-mail">E-Mail <span class="muted">(optional)</span></label><input id="c-mail" name="email" type="email" autocomplete="off" placeholder="max@beispiel.de">
           <div class="hint">Zum Anmelden und um ein vergessenes Passwort selbst zurückzusetzen. Der Klient bekommt einen Bestätigungslink.</div></div>
         <div class="field"><label for="c-pw">Startpasswort</label><input id="c-pw" name="password" value="${pw}" required>
           <div class="hint">Der Klient kann es nach dem ersten Login selbst ändern.</div></div>
         <div class="dialog-actions">
           <button type="button" class="btn-secondary" data-close>Abbrechen</button>
           <button type="submit" class="btn-primary">Anlegen</button>
         </div>`,
        async (f) => {
          const { client } = await api('POST', '/api/clients', {
            displayName: f.displayName.value, username: f.username.value.trim(), password: f.password.value,
            email: f.email.value.trim() || undefined,
          });
          showCredentials(client.displayName, client.username, f.password.value, () => {
            location.hash = `#/client/${client.id}`;
          });
          return false;
        }
      );
    });
  }

  // ---------- coach: weekly check-in ----------
  async function renderCheckin(selectedId) {
    setView(LOADING);
    const { clients } = await api('GET', '/api/checkins/queue');
    if (!clients.length) {
      setView('<div class="page-head"><h1>Check-in</h1></div><div class="card empty-state">Noch keine Klienten angelegt.</div>');
      return;
    }
    const done = clients.filter((c) => c.doneThisWeek).length;
    const selected = clients.find((c) => c.id === selectedId) || clients.find((c) => !c.doneThisWeek) || clients[0];
    const idx = clients.indexOf(selected);

    setView(`
      <div class="page-head">
        <div>${eyebrow('Coaching')}<h1>Wöchentlicher Check-in</h1>
          <p class="muted">${done} von ${clients.length} diese Woche erledigt</p></div>
        <div class="progress" aria-hidden="true"><span style="width:${Math.round((done / clients.length) * 100)}%"></span></div>
      </div>
      <nav class="queue" aria-label="Klienten">
        ${clients
          .map(
            (c, i) => `<a href="#/checkin/${c.id}" class="queue-item ${c.doneThisWeek ? 'done' : ''}"${c.id === selected.id ? ' aria-current="page"' : ''}>
              <span class="queue-num">${c.doneThisWeek ? '✓' : i + 1}</span><span>${esc(c.displayName)}</span>${c.category ? `<i class="cat-dot cat-${c.category}" title="${CATEGORIES[c.category]}"></i>` : ''}</a>`
          )
          .join('')}
      </nav>
      <div id="checkin-body">${LOADING}</div>`);
    const current = document.querySelector('.queue [aria-current]');
    if (current) current.scrollIntoView({ block: 'nearest', inline: 'center' });

    const rv = await api('GET', `/api/checkins/review?userId=${selected.id}`);
    const { comparison: cmp, goals } = rv;
    const cur = cmp.current;
    const prev = cmp.previous;
    const shortD = (d) => fmtDate(d, { weekday: 'short', day: '2-digit', month: '2-digit' });

    const deltaCell = (d, fmt, goodDir) => {
      if (d === null || d === undefined) return '<td class="num muted">–</td>';
      const cls = d === 0 || !goodDir ? '' : Math.sign(d) === goodDir ? 'good' : 'bad';
      return `<td class="num ${cls}">${d > 0 ? '+' : d < 0 ? '−' : '±'}${fmt(Math.abs(d))}</td>`;
    };
    const weightDir = goals.targetWeight !== null && cur.weightAvg !== null && goals.targetWeight > cur.weightAvg ? 1 : -1;
    const hit = (n, total) => (n === null ? '–' : `${n}/${total}`);
    const rows = [
      ['Gewicht Ø', `${num(prev.weightAvg, 1)} kg`, `${num(cur.weightAvg, 1)} kg`, deltaCell(cmp.delta.weightAvg, (v) => `${num(v, 1)} kg`, weightDir)],
      ['Gewicht min – max', prev.weighIns ? `${num(prev.weightMin, 1)} – ${num(prev.weightMax, 1)}` : '–', cur.weighIns ? `${num(cur.weightMin, 1)} – ${num(cur.weightMax, 1)}` : '–', '<td></td>'],
      ['Wiegungen', prev.weighIns, cur.weighIns, deltaCell(cur.weighIns - prev.weighIns, (v) => num(v), 1)],
      ['Schritte Ø', num(prev.stepsAvg), num(cur.stepsAvg), deltaCell(cmp.delta.stepsAvg, (v) => num(v), 1)],
      ['Schrittziel erreicht', hit(prev.stepsGoalDays, 7), hit(cur.stepsGoalDays, 7), '<td></td>'],
      ['Schlaf Ø', fmtSleep(prev.sleepAvg), fmtSleep(cur.sleepAvg), deltaCell(cmp.delta.sleepAvg, (v) => fmtSleep(v), 1)],
      ['Schlafziel erreicht', hit(prev.sleepGoalDays, 7), hit(cur.sleepGoalDays, 7), '<td></td>'],
      ['🏋️ Trainingstage', `${prev.trainingDays}×`, `${cur.trainingDays}×`, deltaCell(cmp.delta.trainingDays, (v) => `${num(v)}×`, 1)],
      ['Kalorienplan eingehalten', prev.caloriesAnswered ? `${prev.caloriesOkDays}/${prev.caloriesAnswered}` : '–', cur.caloriesAnswered ? `${cur.caloriesOkDays}/${cur.caloriesAnswered}` : '–', deltaCell(cmp.delta.caloriesOkDays, (v) => num(v), 1)],
      ['Ø gegessen, wenn nicht eingehalten', prev.caloriesReportedAvg ? `${num(prev.caloriesReportedAvg)} kcal` : '–', cur.caloriesReportedAvg ? `${num(cur.caloriesReportedAvg)} kcal` : '–', '<td></td>'],
      ['Tage eingetragen', `${prev.daysLogged}/7`, `${cur.daysLogged}/7`, deltaCell(cmp.delta.daysLogged, (v) => num(v), 1)],
    ];

    const dayTable = (days) => `<table class="day-table">
      <thead><tr><th>Tag</th><th class="num">Gewicht</th><th class="num">Schritte</th><th class="num">Schlaf</th><th>Training</th><th>Kalorien</th><th>Notiz</th></tr></thead>
      <tbody>${days
        .map((d) => `<tr class="${d.weight === null && d.steps === null && d.sleep === null && !d.note && d.training === null && d.caloriesOk === null ? 'empty-day' : ''}">
          <td>${esc(shortD(d.date))}</td>
          <td class="num">${d.weight !== null ? num(d.weight, 1) : '–'}</td>
          <td class="num ${goals.stepsGoal && d.steps !== null ? (d.steps >= goals.stepsGoal ? 'good' : '') : ''}">${num(d.steps)}</td>
          <td class="num">${fmtSleep(d.sleep)}</td>
          <td>${d.training === true ? '🏋️ Ja' : d.training === false ? '<span class="muted">Nein</span>' : '–'}</td>
          <td>${kcalCell(d)}</td>
          <td class="note">${esc(d.note || '')}</td></tr>`)
        .join('')}</tbody></table>`;

    const last = rv.checkins[0];
    const lastHtml = last
      ? `<div class="small muted">Letzter Check-in: ${esc(new Date(last.createdAt).toLocaleDateString((window.I18N ? I18N.locale : 'de-DE')))} ·
          ${last.status === 'accepted' ? '<span class="good">Anpassungen angenommen</span>' : last.changes.length ? '<span class="warn">Anpassungen noch offen</span>' : 'ohne Anpassungen'}
          ${last.seenAt ? ' · gelesen' : ' · noch nicht gelesen'}</div>`
      : '<div class="small muted">Erster Check-in für diesen Klienten.</div>';
    const msgsHtml = rv.clientMessages.length
      ? `<div class="client-msgs"><div class="small muted" style="margin-bottom:6px">Nachrichten von ${esc(rv.client.displayName)} seit dem letzten Check-in</div>
          ${rv.clientMessages.map((m) => `<div class="msg theirs">${esc(m.body)}<time>${esc(new Date(m.createdAt).toLocaleString((window.I18N ? I18N.locale : 'de-DE'), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}</time></div>`).join('')}
          <a class="small" href="#/client/${selected.id}/chat">Zum Chat →</a></div>`
      : '';

    const nextOpen = clients.slice(idx + 1).find((c) => !c.doneThisWeek) || clients.find((c, i) => i !== idx && !c.doneThisWeek);
    const kcalRow = `
      <div class="field plan-field" data-plan="calories"><label for="p-kmin">Zielkalorien pro Tag <span class="muted small">aktuell: ${esc(fmtKcal(goals.caloriesMin, goals.caloriesMax))}</span></label>
        <div class="kcal-range">
          <div class="input-unit"><input id="p-kmin" name="caloriesMin" inputmode="numeric" placeholder="von" value="${goals.caloriesMin ?? ''}"><span>kcal</span></div>
          <span>–</span>
          <div class="input-unit"><input id="p-kmax" name="caloriesMax" inputmode="numeric" placeholder="bis" aria-label="Kalorien bis" value="${goals.caloriesMax !== null && goals.caloriesMax !== goals.caloriesMin ? goals.caloriesMax : ''}"><span>kcal</span></div>
        </div></div>`;
    const fieldRow = (key, label, unit, mode, placeholder) => `
      <div class="field plan-field"><label for="p-${key}">${label} <span class="muted small">aktuell: ${esc(fmtPlan(key, goals[key]))}</span></label>
        <div class="input-unit"><input id="p-${key}" name="${key}" inputmode="${mode}" placeholder="${placeholder}"
          value="${goals[key] === null || goals[key] === undefined ? '' : String(goals[key]).replace('.', ',')}"><span>${unit}</span></div></div>`;

    document.getElementById('checkin-body').innerHTML = `
      <div class="checkin-grid">
        <div class="stack">
          <section class="card ai-card" id="ai-summary" aria-live="polite"></section>
          <section class="card">
            <div class="row-between" style="margin-bottom:8px">
              <h2>${esc(rv.client.displayName)} – Wochenvergleich ${catTag(rv.client.category)}</h2>
              <a class="small" href="#/client/${selected.id}">Alle Daten →</a>
            </div>
            <p class="small muted" style="margin:0 0 10px">Diese Woche: ${esc(shortD(cur.from))} – ${esc(shortD(cur.to))} · Vorwoche: ${esc(shortD(prev.from))} – ${esc(shortD(prev.to))}</p>
            <div class="table-wrap"><table class="compare">
              <thead><tr><th></th><th class="num">Vorwoche</th><th class="num">Diese Woche</th><th class="num">Veränderung</th></tr></thead>
              <tbody>${rows.map(([l, a, b, d]) => `<tr><td>${l}</td><td class="num">${a}</td><td class="num"><strong>${b}</strong></td>${d}</tr>`).join('')}
              ${(rv.measurements || [])
                .filter((m) => m.kind === 'number')
                .map((m) => {
                  const dir = rv.client.category === 'diet' ? -1 : rv.client.category === 'build' ? 1 : 0;
                  const v = (x) => (x ? `${num(x.value, 1)} ${esc(m.unit)}` : '–');
                  return `<tr class="metric-row"><td>${esc(m.name)} <span class="muted small">(letzter Wert)</span></td><td class="num">${v(m.previous)}</td><td class="num"><strong>${v(m.current)}</strong></td>${deltaCell(m.delta, (x) => `${num(x, 1)} ${esc(m.unit)}`, dir)}</tr>`;
                })
                .join('')}</tbody>
            </table></div>
            ${(rv.measurements || [])
              .filter((m) => m.kind === 'pr')
              .map((m) => `<div class="pr-week"><h3>💪 ${esc(m.name)} diese Woche</h3>${m.prsThisWeek.length
                ? `<ul class="plain-list">${m.prsThisWeek
                    .map((p) => `<li><span>${esc(shortD(p.date))} · ${esc(p.exercise)} · <strong>${num(p.weight, 1)} kg × ${p.reps}</strong></span>${p.isRecord && p.previous ? `<span class="badge good">Rekord · vorher ${num(p.previous.weight, 1)} kg × ${p.previous.reps}</span>` : ''}</li>`)
                    .join('')}</ul>`
                : '<p class="muted small" style="margin:4px 0 0">Keine neuen Einträge.</p>'}</div>`)
              .join('')}
          </section>
          <section class="card chart-card"><h3>Gewicht – 14 Tage</h3><div class="chart-weight" data-chart="ci-weight"></div></section>
          <section class="card chart-card"><h3>Schritte – 14 Tage</h3><div class="chart-steps" data-chart="ci-steps"></div></section>
          <section class="card">
            <h3 style="margin-bottom:8px">Diese Woche im Detail</h3>
            <div class="table-wrap">${dayTable(cmp.days.slice(7).reverse())}</div>
          </section>
          <details class="card">
            <summary><strong>Vorwoche im Detail</strong></summary>
            <div class="table-wrap" style="margin-top:8px">${dayTable(cmp.days.slice(0, 7).reverse())}</div>
          </details>
        </div>
        <form class="card checkin-form" id="checkin-form" novalidate>
          <h2>Check-in schreiben</h2>
          ${lastHtml}
          ${rv.highlights && rv.highlights.length
            ? `<div class="hl-preview">${highlightsHtml(rv.highlights, 'Highlights, die dein Klient mitbekommt')}</div>`
            : '<p class="small muted" style="margin:10px 0 0">Diese Woche keine Highlights – im Check-in wird dann keine Highlight-Box angezeigt.</p>'}
          ${msgsHtml}
          <div class="field" style="margin-top:12px"><label for="ci-msg">Nachricht an ${esc(rv.client.displayName)}</label>
            <textarea id="ci-msg" name="message" maxlength="4000" rows="6" placeholder="Wie lief die Woche? Was war gut, was nehmen wir uns vor?"></textarea></div>
          <h3 style="margin:4px 0 8px">Plan anpassen <span class="muted small">(optional)</span></h3>
          ${kcalRow}
          ${fieldRow('stepsGoal', 'Schritte pro Tag', 'Schritte', 'numeric', 'z. B. 10000')}
          ${fieldRow('sleepGoal', 'Schlaf pro Nacht', 'Std.', 'decimal', 'z. B. 7,5')}
          ${fieldRow('targetWeight', 'Zielgewicht', 'kg', 'decimal', 'z. B. 80')}
          <p class="hint" data-changes>Keine Änderungen am Plan – nur Feedback.</p>
          <button class="btn-primary btn-block" type="submit">Check-in senden${nextOpen ? ' & weiter →' : ''}</button>
          ${nextOpen ? `<a class="btn btn-ghost btn-block" href="#/checkin/${nextOpen.id}">Überspringen → ${esc(nextOpen.displayName)}</a>` : ''}
          <p class="error" hidden></p>
          <p class="hint">Der Check-in erscheint oben in der Übersicht des Klienten (nicht im Chat). Er kann die Anpassungen mit einem Klick annehmen – nur seine Antwort landet im Chat.</p>
        </form>
      </div>`;
    mountAiSummary(document.getElementById('ai-summary'), selected.id);

    const from = cmp.days[0].date;
    const to = cmp.days[13].date;
    const drawCiCharts = () => {
      Charts.render(document.querySelector('[data-chart=ci-weight]'), {
        data: cmp.days.map((d) => ({ date: d.date, value: d.weight })), from, to, type: 'line',
        goal: goals.targetWeight, unit: 'kg', decimals: 1, height: 170,
      });
      Charts.render(document.querySelector('[data-chart=ci-steps]'), {
        data: cmp.days.map((d) => ({ date: d.date, value: d.steps })), from, to, type: 'bar',
        goal: goals.stepsGoal, unit: 'Schritte', height: 170,
      });
    };
    drawCiCharts();
    window.addEventListener('resize', drawCiCharts);
    onCleanup(() => window.removeEventListener('resize', drawCiCharts));

    const form = document.getElementById('checkin-form');
    const keys = ['stepsGoal', 'sleepGoal', 'targetWeight'];
    const readProposal = () => {
      const p = {};
      for (const k of keys) {
        const v = parseNum(form[k].value);
        if (Number.isNaN(v)) throw new Error('Bitte nur Zahlen eingeben.');
        if (v !== null && v !== goals[k]) p[k] = v;
      }
      let lo = parseNum(form.caloriesMin.value);
      let hi = parseNum(form.caloriesMax.value);
      if (Number.isNaN(lo) || Number.isNaN(hi)) throw new Error('Bitte nur Zahlen eingeben.');
      if (lo !== null || hi !== null) {
        lo = lo ?? hi;
        hi = hi ?? lo;
        if (lo > hi) throw new Error('Kalorien: „von“ muss kleiner als „bis“ sein.');
        if (lo !== goals.caloriesMin || hi !== goals.caloriesMax) {
          p.caloriesMin = lo;
          p.caloriesMax = hi;
        }
      }
      return p;
    };
    const showChanges = () => {
      const hint = form.querySelector('[data-changes]');
      let p = {};
      try {
        p = readProposal();
      } catch {
        /* shown on submit */
      }
      for (const k of keys) form[k].closest('.plan-field').classList.toggle('changed', k in p);
      form.querySelector('[data-plan=calories]').classList.toggle('changed', 'caloriesMin' in p);
      const list = keys.filter((k) => k in p).map((k) => `${PLAN_LABELS[k]}: ${fmtPlan(k, goals[k])} → ${fmtPlan(k, p[k])}`);
      if ('caloriesMin' in p) {
        list.unshift(`${PLAN_LABELS.calories}: ${fmtKcal(goals.caloriesMin, goals.caloriesMax)} → ${fmtKcal(p.caloriesMin, p.caloriesMax)}`);
      }
      hint.innerHTML = list.length
        ? `<strong>Vorschlag an den Klienten:</strong><br>${list.map(esc).join('<br>')}`
        : 'Keine Änderungen am Plan – nur Feedback.';
    };
    form.addEventListener('input', showChanges);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = form.querySelector('.error');
      errEl.hidden = true;
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        if (!form.message.value.trim()) throw new Error('Bitte eine Nachricht schreiben.');
        const sent = await api('POST', `/api/checkins?userId=${selected.id}`, { message: form.message.value, proposal: readProposal() });
        toast(`Check-in an ${rv.client.displayName} gesendet ✓${sent.mail === 'ok' ? ' – auch per E-Mail mit PDF' : ''}`);
        location.hash = nextOpen ? `#/checkin/${nextOpen.id}` : '#/checkin/done';
      } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
        btn.disabled = false;
      }
    });
  }


  // ---------- AI (coach): check-in summary on request, nutrition plan draft ----------
  const aiTime = (iso) => new Date(iso).toLocaleString(window.I18N ? I18N.locale : 'de-DE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const AI_OFF = '<p class="muted small" style="margin:0">KI ist noch nicht eingerichtet. Mit einem API-Schlüssel (Umgebungsvariable <code>ANTHROPIC_API_KEY</code>) bekommst du hier eine Zusammenfassung auf Knopfdruck.</p>';
  const AI_LOADING = '<div class="ai-loading" role="status" aria-label="KI arbeitet"><span></span><span></span><span></span></div>';

  /** Check-in: the summary is only made when the coach asks; the last one stays until asked again. */
  async function mountAiSummary(root, clientId) {
    if (!root) return;
    let state;
    try {
      state = await api('GET', `/api/ai/checkin-summary?userId=${clientId}`);
    } catch {
      root.hidden = true;
      return;
    }
    const list = (title, items, cls) => (items && items.length ? `<div class="ai-block ${cls}"><h4>${title}</h4><ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '');
    const draw = (busy) => {
      const s = state.summary;
      let body;
      if (!state.enabled) body = AI_OFF;
      else if (busy) body = AI_LOADING;
      else if (s) {
        body = `<p class="ai-overview">${esc(s.overview)}</p>
          <div class="ai-cols">${list('Lief gut', s.positives, 'good')}${list('Auffällig', s.concerns, 'warn')}${list('Vorschläge', s.suggestions, '')}${list('Genauer ansehen', s.lookCloser, '')}</div>
          <p class="muted small ai-meta">Erstellt ${esc(aiTime(s.createdAt))} · nur auf Anfrage, wird nicht automatisch aktualisiert. KI kann sich irren – die Daten unten sind maßgeblich.</p>`;
      } else body = '<p class="muted small" style="margin:0">Schneller Überblick über die Woche – wird erst erstellt, wenn du darauf tippst.</p>';
      root.innerHTML = `
        <div class="row-between ai-head"><h2><span class="ai-spark" aria-hidden="true">✦</span> KI-Überblick</h2>
          ${state.enabled ? `<button type="button" class="${s ? 'btn-secondary' : 'btn-primary'} btn-sm" data-ai-run ${busy ? 'disabled' : ''}>${busy ? 'Wird erstellt…' : s ? 'Neu erstellen' : 'Zusammenfassung erstellen'}</button>` : ''}</div>
        ${body}`;
      const run = root.querySelector('[data-ai-run]');
      if (run && !busy) run.addEventListener('click', async () => {
        draw(true);
        try {
          state = await api('POST', `/api/ai/checkin-summary?userId=${clientId}`);
        } catch (err) {
          toast(err.message, true);
        }
        draw(false);
      });
    };
    draw(false);
  }

  /** Coach nutrition tab: AI draft from the client's wishes – review and edit, then send. */
  async function mountAiDraft(root, client, onApplied) {
    if (!root) return;
    let state;
    try {
      state = await api('GET', `/api/ai/nutrition-draft?userId=${client.id}`);
    } catch {
      root.hidden = true;
      return;
    }
    let busy = false;
    let hint = '';
    const kcalOf = (i) => Math.round((i.amount * i.kcal) / 100);
    const macrosOf = (items) => {
      const t = { protein: 0, carbs: 0, fat: 0 };
      for (const i of items) for (const [k] of MACROS) t[k] += ((i[k] || 0) * i.amount) / 100;
      for (const [k] of MACROS) t[k] = Math.round(t[k]);
      return t;
    };
    const draw = () => {
      const d = state.draft;
      let body;
      if (!state.enabled) body = '<p class="muted small" style="margin:0">KI ist noch nicht eingerichtet (<code>ANTHROPIC_API_KEY</code>). Dann entsteht hier aus den Wünschen automatisch ein Planentwurf, den du prüfst und abschickst.</p>';
      else if (busy) body = `${AI_LOADING}<p class="muted small">Die KI stellt aus den Wünschen und eurer Lebensmittel-Datenbank einen Plan zusammen…</p>`;
      else if (!d) body = '<p class="muted small" style="margin:0">Aus den Wünschen und dem Kalorienziel einen Plan vorschlagen lassen. Du prüfst und änderst ihn, bevor der Klient etwas sieht.</p>';
      else {
        body = `${d.notes ? `<p class="ai-overview">${esc(d.notes)}</p>` : ''}
          ${d.meals.map((m, mi) => `<div class="ai-meal" data-meal="${mi}">
            <div class="row-between ai-meal-head"><input class="ai-meal-name" value="${esc(m.name)}" maxlength="60" aria-label="Name der Mahlzeit"><span class="muted small" data-meal-kcal></span></div>
            <ul>${m.items.map((i, ii) => `<li data-item="${ii}"><span class="ai-food">${esc(i.name)}</span>
              <span class="input-unit ai-amount"><input inputmode="numeric" value="${i.amount}" aria-label="Menge: ${esc(i.name)}"><span>${esc(i.unit)}</span></span>
              <span class="ai-kcal" data-kcal></span>
              <button type="button" class="icon-btn" data-del aria-label="${esc(i.name)} entfernen">✕</button></li>`).join('')}</ul></div>`).join('')}
          <p class="ai-total">Gesamt <strong data-total></strong></p>
          <div class="row ai-actions">
            <button type="button" class="btn-primary" data-ai-apply>Geprüft – an ${esc(client.displayName)} senden</button>
            <button type="button" class="btn-ghost" data-ai-drop>Verwerfen</button>
          </div>
          <p class="muted small ai-meta">Entwurf vom ${esc(aiTime(d.createdAt))}. Nach dem Senden kannst du den Plan wie gewohnt weiter bearbeiten.</p>`;
      }
      root.innerHTML = `
        <div class="row-between ai-head"><h2><span class="ai-spark" aria-hidden="true">✦</span> KI-Entwurf</h2>
          ${state.enabled && !busy ? `<button type="button" class="${d ? 'btn-ghost' : 'btn-primary'} btn-sm" data-ai-run>${d ? 'Neu erstellen' : 'Entwurf erstellen'}</button>` : ''}</div>
        ${state.enabled && !busy ? `<div class="ai-hint"><input data-ai-hint maxlength="300" value="${esc(hint)}" placeholder="Hinweis für diesen Entwurf (optional), z. B. Frühstück lieber süß" aria-label="Hinweis für diesen Entwurf">
          <p class="muted small">Gilt nur für den nächsten Entwurf. Dauerhafte Regeln stellst du im <a href="#/admin">Admin-Tool</a> unter „KI-Vorgaben“ ein.</p></div>` : ''}
        ${body}`;
      const hintEl = root.querySelector('[data-ai-hint]');
      if (hintEl) hintEl.addEventListener('input', () => { hint = hintEl.value; });
      const run = root.querySelector('[data-ai-run]');
      if (run) run.addEventListener('click', async () => {
        if (d && !confirm('Neuen Entwurf erstellen? Deine Änderungen am aktuellen Entwurf gehen verloren.')) return;
        busy = true;
        draw();
        try {
          state = await api('POST', `/api/ai/nutrition-draft?userId=${client.id}`, { hint });
        } catch (err) {
          toast(err.message, true);
        }
        busy = false;
        draw();
      });
      if (!d || busy || !state.enabled) return;
      const recalc = () => {
        let all = 0;
        root.querySelectorAll('[data-meal]').forEach((mEl) => {
          const m = d.meals[Number(mEl.dataset.meal)];
          const sum = m.items.reduce((b, i) => b + kcalOf(i), 0);
          all += sum;
          mEl.querySelector('[data-meal-kcal]').textContent = `${num(sum)} kcal`;
          mEl.querySelectorAll('[data-item]').forEach((iEl) => {
            iEl.querySelector('[data-kcal]').textContent = `${num(kcalOf(m.items[Number(iEl.dataset.item)]))} kcal`;
          });
        });
        const mt = macrosOf(d.meals.flatMap((m) => m.items));
        root.querySelector('[data-total]').textContent = `${num(all)} kcal · E ${num(mt.protein)} g · K ${num(mt.carbs)} g · F ${num(mt.fat)} g`;
      };
      root.querySelectorAll('[data-meal]').forEach((mEl) => {
        const mi = Number(mEl.dataset.meal);
        const m = d.meals[mi];
        mEl.querySelector('.ai-meal-name').addEventListener('input', (e) => { m.name = e.target.value; });
        mEl.querySelectorAll('[data-item]').forEach((iEl) => {
          const idx = Number(iEl.dataset.item);
          iEl.querySelector('input').addEventListener('input', (e) => {
            m.items[idx].amount = Math.max(0, Math.round(Number(e.target.value.replace(',', '.')) || 0));
            recalc();
          });
          iEl.querySelector('[data-del]').addEventListener('click', () => {
            m.items.splice(idx, 1);
            if (!m.items.length) d.meals.splice(mi, 1);
            draw();
          });
        });
      });
      recalc();
      root.querySelector('[data-ai-drop]').addEventListener('click', async () => {
        if (!confirm('Entwurf verwerfen?')) return;
        try {
          state = await api('DELETE', `/api/ai/nutrition-draft?userId=${client.id}`);
        } catch (err) {
          toast(err.message, true);
        }
        draw();
      });
      root.querySelector('[data-ai-apply]').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          await api('POST', `/api/ai/nutrition-draft/apply?userId=${client.id}`, {
            meals: d.meals.map((m) => ({ type: m.type, name: m.name, items: m.items.filter((i) => i.amount > 0).map((i) => ({ foodId: i.foodId, amount: i.amount })) })),
          });
          savedHud('Plan gesendet', client.displayName);
          onApplied();
        } catch (err) {
          toast(err.message, true);
          btn.disabled = false;
        }
      });
    };
    draw();
  }

  async function renderCheckinDone() {
    const { clients } = await api('GET', '/api/checkins/queue');
    if (clients.some((c) => !c.doneThisWeek)) return renderCheckin(null);
    setView(`<div class="page-head"><h1>Wöchentlicher Check-in</h1></div>
      <div class="card empty-state"><p style="font-size:2rem;margin:0">🎉</p>
        <h2>Alle ${clients.length} Check-ins für diese Woche erledigt!</h2>
        <p>Die Antworten deiner Klienten findest du im Chat.</p>
        <a class="btn btn-secondary" href="#/">Zur Übersicht</a></div>`);
  }

  // ---------- food picker (search in the food database) ----------
  let foodCache = null;
  async function loadFoods(force) {
    if (!foodCache || force) foodCache = (await api('GET', '/api/foods')).foods;
    return foodCache;
  }
  const fmtAmount = (amount, unit) => `${num(amount, amount % 1 ? 1 : 0)} ${unit}`;
  const itemKcal = (amount, kcal) => Math.round((amount * kcal) / 100);
  const sameKcalAmount = (kcal, per100) => (per100 > 0 ? Math.max(5, Math.round(((kcal / per100) * 100) / 5) * 5) : 100);

  /**
   * Text field with live search in the food database.
   * onPick(food) is called with the chosen food (or null when the text is changed again).
   * With allowCreate, a "neu anlegen" entry lets the coach add a missing food on the spot.
   */
  function foodPicker(root, { onPick, allowCreate, placeholder }) {
    root.classList.add('food-picker');
    root.innerHTML = `<input type="search" autocomplete="off" placeholder="${esc(placeholder || 'Lebensmittel suchen…')}" aria-label="Lebensmittel suchen">
      <ul class="food-results" role="listbox" hidden></ul>`;
    const input = root.querySelector('input');
    const list = root.querySelector('ul');
    let chosen = null;
    const close = () => (list.hidden = true);

    async function update() {
      const foods = await loadFoods();
      const term = input.value.trim().toLowerCase();
      const hits = (term ? foods.filter((f) => f.name.toLowerCase().includes(term)) : foods)
        .sort((a, b) => (term ? Number(!a.name.toLowerCase().startsWith(term)) - Number(!b.name.toLowerCase().startsWith(term)) : 0))
        .slice(0, 40);
      list.innerHTML =
        hits.map((f) => `<li role="option" data-id="${f.id}"><span>${esc(f.name)}</span><span class="muted small">${num(f.kcal)} kcal/100 ${f.unit}${hasMacros(f) ? ` · E ${gram(f.protein)} K ${gram(f.carbs)} F ${gram(f.fat)}` : ''}</span></li>`).join('') +
        (allowCreate && term ? `<li data-create class="create">+ „${esc(input.value.trim())}“ neu anlegen</li>` : '') +
        (!hits.length && !allowCreate ? '<li class="muted small" data-none>Nicht in der Liste – schreib deinen Wunsch einfach unten rein.</li>' : '');
      list.hidden = false;
    }
    input.addEventListener('focus', update);
    input.addEventListener('input', () => {
      if (chosen) {
        chosen = null;
        onPick(null);
      }
      update();
    });
    list.addEventListener('pointerdown', (e) => e.preventDefault());
    list.addEventListener('click', async (e) => {
      const li = e.target.closest('li');
      if (!li || li.dataset.none !== undefined) return;
      if (li.dataset.create !== undefined) {
        close();
        const food = await createFoodDialog(input.value.trim());
        if (food) pick(food);
        return;
      }
      pick(foodCache.find((f) => f.id === Number(li.dataset.id)));
    });
    input.addEventListener('blur', () => setTimeout(close, 150));
    function pick(f) {
      chosen = f;
      input.value = f.name;
      close();
      onPick(f);
    }
    return { get value() { return chosen; }, input, clear() { chosen = null; input.value = ''; } };
  }

  /** Small form to add a food to the database. Resolves with the new food, or null. */
  function createFoodDialog(name, existing) {
    return new Promise((resolve) => {
      const sub = document.createElement('dialog');
      sub.className = 'sub-dialog';
      document.body.appendChild(sub);
      sub.innerHTML = `<form method="dialog" novalidate>
        <h2>${existing ? 'Lebensmittel bearbeiten' : 'Lebensmittel anlegen'}</h2>
        <div class="field"><label for="nf-name">Name</label><input id="nf-name" name="name" maxlength="80" value="${esc(existing ? existing.name : name || '')}" required></div>
        <div class="field-row">
          <div class="field"><label for="nf-kcal">kcal pro 100</label><input id="nf-kcal" name="kcal" inputmode="decimal" value="${existing ? String(existing.kcal).replace('.', ',') : ''}" required></div>
          <div class="field"><label for="nf-unit">Einheit</label><select id="nf-unit" name="unit">
            <option value="g"${existing && existing.unit === 'ml' ? '' : ' selected'}>g</option><option value="ml"${existing && existing.unit === 'ml' ? ' selected' : ''}>ml</option></select></div>
        </div>
        <div class="field-row three">
          <div class="field"><label for="nf-p">Eiweiß</label><input id="nf-p" name="protein" inputmode="decimal" placeholder="g/100" value="${existing && existing.protein !== null && existing.protein !== undefined ? String(existing.protein).replace('.', ',') : ''}"></div>
          <div class="field"><label for="nf-c">Kohlenh.</label><input id="nf-c" name="carbs" inputmode="decimal" placeholder="g/100" value="${existing && existing.carbs !== null && existing.carbs !== undefined ? String(existing.carbs).replace('.', ',') : ''}"></div>
          <div class="field"><label for="nf-f">Fett</label><input id="nf-f" name="fat" inputmode="decimal" placeholder="g/100" value="${existing && existing.fat !== null && existing.fat !== undefined ? String(existing.fat).replace('.', ',') : ''}"></div>
        </div>
        <div class="field"><label for="nf-cat">Kategorie</label><input id="nf-cat" name="category" maxlength="40" value="${esc(existing ? existing.category || '' : 'Eigene')}"></div>
        <p class="error" hidden></p>
        <div class="dialog-actions"><button type="button" class="btn-secondary" data-cancel>Abbrechen</button><button type="submit" class="btn-primary">Speichern</button></div>
      </form>`;
      const f = sub.querySelector('form');
      const done = (v) => {
        sub.close();
        sub.remove();
        resolve(v);
      };
      f.querySelector('[data-cancel]').addEventListener('click', () => done(null));
      sub.addEventListener('cancel', () => done(null));
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = f.querySelector('.error');
        try {
          const kcal = parseNum(f.kcal.value);
          if (kcal === null || Number.isNaN(kcal)) throw new Error('Bitte kcal pro 100 g angeben.');
          const mac = (k) => {
            const x = parseNum(f[k].value);
            if (Number.isNaN(x)) throw new Error('Makros bitte als Zahl in Gramm pro 100 angeben.');
            return x;
          };
          const body = { name: f.name.value, kcal, unit: f.unit.value, category: f.category.value, protein: mac('protein'), carbs: mac('carbs'), fat: mac('fat') };
          const { food } = existing ? await api('PATCH', `/api/foods/${existing.id}`, body) : await api('POST', '/api/foods', body);
          await loadFoods(true);
          toast(existing ? 'Lebensmittel gespeichert' : `„${food.name}“ angelegt`);
          done(food);
        } catch (ex) {
          err.textContent = ex.message;
          err.hidden = false;
        }
      });
      sub.showModal();
      f.name.focus();
    });
  }

  // ---------- nutrition plan: shared rendering ----------
  function planSummary(plan, goals) {
    const target = hasKcal(goals) ? fmtKcal(goals.caloriesMin, goals.caloriesMax) : null;
    let cls = '';
    if (hasKcal(goals) && plan.totalKcal) {
      cls = plan.totalKcal < goals.caloriesMin - 50 || plan.totalKcal > goals.caloriesMax + 50 ? 'warn' : 'good';
    }
    return `<div class="card plan-summary">
      <div><div class="stat-label">Tagesplan</div><div class="stat-value ${cls}">${num(plan.totalKcal)} <small>kcal</small></div></div>
      <div class="muted small">${target ? `Zielkalorien: <strong>${esc(target)}</strong>` : 'Noch keine Zielkalorien festgelegt'}</div>
      ${plan.macros && plan.totalKcal ? `<div class="plan-macros">${macroBars(plan.macros, plan.macroGoals)}${plan.macros.complete ? '' : '<p class="muted small" style="margin:6px 0 0">Nicht für alle Lebensmittel sind Makros hinterlegt.</p>'}</div>` : ''}
    </div>`;
  }

  const SWAP_STATUS = { open: ['Offen', ''], done: ['Umgesetzt ✓', 'good'], declined: ['Abgelehnt', 'bad'] };
  /** Decided requests stay in the lists for one day, then disappear. */
  const DECISION_VISIBLE_MS = 86400000;
  const isRecentDecision = (r) => r.status !== 'open' && r.resolvedAt && Date.now() - Date.parse(r.resolvedAt) < DECISION_VISIBLE_MS;
  function requestLine(r) {
    const [label, cls] = SWAP_STATUS[r.status];
    const wish = [r.wantedFood ? r.wantedFood.name : null, r.wish].filter(Boolean).join(' – ');
    return `<div class="swap-req">
      <div class="row-between"><strong>${esc(r.subject.split(' · ')[0])}</strong><span class="badge ${cls}">${label}</span></div>
      <div class="small">→ ${esc(wish)}</div>
      ${r.coachNote ? `<div class="small muted">Coach: ${esc(r.coachNote)}</div>` : ''}
      <div class="small muted">${esc(new Date(r.createdAt).toLocaleDateString((window.I18N ? I18N.locale : 'de-DE'), { day: '2-digit', month: '2-digit' }))}${r.subject.includes(' · ') ? ` · ${esc(r.subject.split(' · ')[1])}` : ''}</div>
    </div>`;
  }

  // ---------- client: nutrition plan ----------

  // ---------- nutrition plan request (client without a plan → coach) ----------
  /** Answers as "question: chosen options" rows. */
  function planRequestSummary(questions, a) {
    const label = (q, v) => (q.options.find(([k]) => k === v) || [v, v])[1];
    const rows = questions
      .map((q) => {
        let val = q.type === 'single' ? (a[q.key] ? label(q, a[q.key]) : '') : (a[q.key] || []).map((v) => label(q, v)).join(', ');
        if (q.key === 'avoid' && a.avoidOther) val = [val, a.avoidOther].filter(Boolean).join(', ');
        return val ? `<div class="pr-row"><dt>${esc(q.label)}</dt><dd>${esc(val)}</dd></div>` : '';
      })
      .join('');
    return `<dl class="pr-summary">${rows}${a.note ? `<div class="pr-row"><dt>Anmerkung</dt><dd>${esc(a.note)}</dd></div>` : ''}</dl>`;
  }

  function openPlanRequestForm(questions, current, onSaved) {
    const a = current || {};
    const choice = (q, [k, l]) => {
      const checked = q.type === 'single' ? a[q.key] === k : (a[q.key] || []).includes(k);
      return `<label class="pr-choice"><input type="${q.type === 'single' ? 'radio' : 'checkbox'}" name="${q.key}" value="${esc(k)}" ${checked ? 'checked' : ''}><span>${esc(l)}</span></label>`;
    };
    openDialog(`
      <h2>Ernährungsplan anfragen</h2>
      <p class="muted small" style="margin-top:-8px">Ein paar Fragen, damit dein Coach den Plan auf dich zuschneiden kann. Dauert etwa eine Minute.</p>
      ${questions.map((q) => `<fieldset class="pr-q">
          <legend>${esc(q.label)}${q.required ? '' : ' <span class="muted small">(optional)</span>'}</legend>
          ${q.hint ? `<p class="hint">${esc(q.hint)}</p>` : ''}
          <div class="pr-choices">${q.options.map((o) => choice(q, o)).join('')}</div>
          ${q.other ? `<input name="avoidOther" maxlength="120" placeholder="Sonstiges, z. B. Pilze" value="${esc(a.avoidOther || '')}" aria-label="Sonstiges, was nicht geht">` : ''}
        </fieldset>`).join('')}
      <div class="field"><label for="pr-note">Noch etwas? <span class="muted small">(optional)</span></label>
        <textarea id="pr-note" name="note" rows="3" maxlength="500" placeholder="z. B. Mittags esse ich in der Kantine">${esc(a.note || '')}</textarea></div>
      <div class="row" style="justify-content:flex-end;gap:8px">
        <button type="button" class="btn-secondary" data-close>Abbrechen</button>
        <button type="submit" class="btn-primary">${current ? 'Antworten speichern' : 'Anfrage senden'}</button>
      </div>`, async (form) => {
      const answers = {};
      for (const q of questions) {
        if (q.type === 'single') {
          const sel = form.querySelector(`input[name="${q.key}"]:checked`);
          if (!sel && q.required) throw new Error(`Bitte beantworten: ${q.label}`);
          if (sel) answers[q.key] = sel.value;
        } else {
          answers[q.key] = [...form.querySelectorAll(`input[name="${q.key}"]:checked`)].map((i) => i.value);
        }
      }
      const r = await api('PUT', '/api/nutrition/request', { answers, avoidOther: form.avoidOther ? form.avoidOther.value : '', note: form.note.value });
      savedHud(current ? 'Gespeichert' : 'Anfrage gesendet', 'Dein Coach meldet sich');
      onSaved(r);
    });
  }

  async function mountPlanRequest(root) {
    let data;
    try {
      data = await api('GET', '/api/nutrition/request');
    } catch (err) {
      root.innerHTML = `<div class="card empty-state">${esc(err.message)}</div>`;
      return;
    }
    const draw = () => {
      const r = data.request;
      root.innerHTML = r
        ? `<section class="card plan-request sent">
            <div class="row-between"><h2>Anfrage gesendet ✓</h2><span class="badge">${esc(fmtDate(r.updatedAt.slice(0, 10), { day: 'numeric', month: 'long' }))}</span></div>
            <p class="muted">${r.status === 'open' ? 'Dein Coach stellt dir anhand deiner Antworten einen Plan zusammen. Du bekommst Bescheid, sobald er da ist.' : 'Dein Coach arbeitet an deinem Plan.'}</p>
            ${planRequestSummary(data.questions, r.answers)}
            <button type="button" class="btn-secondary" data-pr-edit>Antworten ändern</button>
          </section>`
        : `<section class="card plan-request">
            <p class="pr-icon" aria-hidden="true">🍽</p>
            <h2>Noch kein Ernährungsplan</h2>
            <p class="muted">Erzähl deinem Coach kurz, was du magst und was nicht – daraus stellt er dir deinen Plan zusammen.</p>
            <button type="button" class="btn-primary" data-pr-edit>Plan beim Coach anfragen</button>
          </section>`;
      root.querySelector('[data-pr-edit]').addEventListener('click', () =>
        openPlanRequestForm(data.questions, r && r.answers, (next) => {
          data = next;
          draw();
        }));
    };
    draw();
  }

  async function renderClientNutrition() {
    setView(LOADING);
    const [plan, { goals }] = await Promise.all([api('GET', '/api/nutrition'), api('GET', '/api/goals')]);
    drawClientNutrition(plan, goals);
  }

  function drawClientNutrition(plan, goals) {
    const openFor = (pred) => plan.requests.find((r) => r.status === 'open' && pred(r));
    const meals = plan.meals
      .map((m) => {
        const mealReq = openFor((r) => r.type === 'meal' && r.mealId === m.id);
        return `<section class="card meal">
          <div class="row-between meal-head"><h2>${esc(m.name)}</h2><span class="muted small">${num(m.kcalTotal)} kcal</span></div>
          ${hasMacros(m.macros) && m.items.length ? `<p class="meal-macros">${macroInline(m.macros)}</p>` : ''}
          <ul class="meal-items">${m.items
            .map((i) => {
              const req = openFor((r) => r.itemId === i.id);
              return `<li>
                <div class="item-main"><span class="item-name">${esc(i.name)}</span>
                  <span class="muted small">${esc(fmtAmount(i.amount, i.unit))} · ${num(i.kcalTotal)} kcal ${macroInline(i)}</span></div>
                ${req ? '<span class="badge warn">Tausch angefragt</span>' : `<button type="button" class="btn-ghost btn-sm" data-swap-item="${i.id}">⇄ Tauschen</button>`}
              </li>`;
            })
            .join('') || '<li class="muted small">Noch keine Lebensmittel.</li>'}</ul>
          ${mealReq
            ? '<p class="small"><span class="badge warn">Tausch der ganzen Mahlzeit angefragt</span></p>'
            : `<button type="button" class="btn-secondary btn-sm" data-swap-meal="${m.id}">Ganze Mahlzeit tauschen anfragen</button>`}
        </section>`;
      })
      .join('');
    const open = plan.requests.filter((r) => r.status === 'open');
    const doneReqs = plan.requests.filter(isRecentDecision);

    setView(`
      <div class="page-head"><div>${eyebrow('Von deinem Coach')}<h1>Ernährung</h1>
        <p class="muted">${plan.meals.length ? 'Du kannst einzelne Lebensmittel oder ganze Mahlzeiten zum Tausch anfragen – dein Coach entscheidet.' : 'Dein Coach stellt dir einen Plan zusammen, der zu dir passt.'}</p></div></div>
      ${nutritionTabs('plan')}
      ${plan.meals.length ? '<p class="pdf-row"><a class="btn btn-secondary btn-sm" href="/api/nutrition/pdf" download>Plan als PDF</a></p>' : ''}
      ${plan.meals.length ? `
      <div class="nutrition-grid">
        <div class="stack">${planSummary(plan, goals)}${meals}</div>
        <aside class="stack">
          <section class="card"><h3 style="margin-bottom:8px">Meine Tauschwünsche</h3>
            ${open.length || doneReqs.length ? '' : '<p class="muted small">Noch keine. Tipp auf „⇄ Tauschen“ bei einem Lebensmittel.</p>'}
            ${open.map((r) => `${requestLine(r)}<button type="button" class="btn-ghost btn-sm" data-cancel-req="${r.id}">Zurückziehen</button>`).join('')}
            ${doneReqs.map(requestLine).join('')}
          </section>
        </aside>
      </div>` : '<div id="plan-request"></div>'}`);
    if (!plan.meals.length) mountPlanRequest(document.getElementById('plan-request'));

    const refresh = (p) => drawClientNutrition(p, goals);
    app.querySelectorAll('[data-swap-item]').forEach((b) =>
      b.addEventListener('click', () => {
        const item = plan.meals.flatMap((m) => m.items.map((i) => ({ ...i, meal: m.name }))).find((i) => i.id === Number(b.dataset.swapItem));
        openItemSwapDialog(item, refresh);
      })
    );
    app.querySelectorAll('[data-swap-meal]').forEach((b) =>
      b.addEventListener('click', () => {
        const meal = plan.meals.find((m) => m.id === Number(b.dataset.swapMeal));
        openDialog(
          `<h2>${esc(meal.name)} tauschen</h2>
           <p class="muted small">Dein Coach entscheidet und passt den Plan an.</p>
           <div class="field"><label for="mw">Was möchtest du stattdessen essen?</label>
             <textarea id="mw" name="wish" maxlength="500" required placeholder="z. B. Lieber Rührei mit Vollkornbrot statt Haferflocken"></textarea></div>
           <div class="dialog-actions"><button type="button" class="btn-secondary" data-close>Abbrechen</button>
             <button type="submit" class="btn-primary">Anfrage senden</button></div>`,
          async (f) => {
            if (!f.wish.value.trim()) throw new Error('Bitte beschreib kurz deinen Wunsch.');
            const p = await api('POST', '/api/nutrition/requests', { type: 'meal', mealId: meal.id, wish: f.wish.value });
            toast('Anfrage an deinen Coach gesendet ✓');
            refresh(p);
          }
        );
      })
    );
    app.querySelectorAll('[data-cancel-req]').forEach((b) =>
      b.addEventListener('click', async () => {
        try {
          refresh(await api('DELETE', `/api/nutrition/requests/${b.dataset.cancelReq}`));
          toast('Anfrage zurückgezogen');
        } catch (err) {
          toast(err.message, true);
        }
      })
    );
  }

  function openItemSwapDialog(item, refresh) {
    let wanted = null;
    openDialog(
      `<h2>${esc(item.name)} tauschen</h2>
       <p class="muted small">${esc(fmtAmount(item.amount, item.unit))} · ${num(item.kcalTotal)} kcal · ${esc(item.meal)}</p>
       <div class="field"><label>Wogegen möchtest du tauschen?</label><div data-picker></div>
         <div class="hint" data-equiv></div></div>
       <div class="field"><label for="iw">Anmerkung <span class="muted">(optional)</span></label>
         <textarea id="iw" name="wish" maxlength="500" placeholder="z. B. Reis vertrage ich abends nicht so gut"></textarea></div>
       <div class="dialog-actions"><button type="button" class="btn-secondary" data-close>Abbrechen</button>
         <button type="submit" class="btn-primary">Anfrage senden</button></div>`,
      async (f) => {
        if (!wanted && !f.wish.value.trim()) throw new Error('Bitte ein Lebensmittel wählen oder deinen Wunsch beschreiben.');
        const p = await api('POST', '/api/nutrition/requests', { type: 'item', itemId: item.id, wantedFoodId: wanted ? wanted.id : undefined, wish: f.wish.value });
        toast('Tauschwunsch an deinen Coach gesendet ✓');
        refresh(p);
      }
    );
    const equiv = dialog.querySelector('[data-equiv]');
    foodPicker(dialog.querySelector('[data-picker]'), {
      placeholder: 'z. B. Kartoffeln',
      onPick(f) {
        wanted = f;
        equiv.textContent = f
          ? `Gleich viele Kalorien wären ca. ${fmtAmount(sameKcalAmount(item.kcalTotal, f.kcal), f.unit)} ${f.name}. Dein Coach legt die Menge fest.`
          : '';
      },
    });
  }


  // ---------- macros (protein, carbs, fat) ----------
  const MACROS = [['protein', 'Eiweiß', 'E'], ['carbs', 'Kohlenhydrate', 'K'], ['fat', 'Fett', 'F']];
  const gram = (v) => (v === null || v === undefined ? '–' : num(v, v > 0 && v < 10 && v % 1 ? 1 : 0));
  const hasMacros = (m) => m && MACROS.some(([k]) => m[k] !== null && m[k] !== undefined);
  /** "E 24 g · K 60 g · F 9 g" as small coloured chips. */
  function macroInline(m) {
    if (!hasMacros(m)) return '';
    return `<span class="macro-inline">${MACROS.map(([k, label, s]) => `<span class="mi mi-${k}" title="${label}"><b aria-hidden="true">${s}</b><span class="sr-only">${label}</span> ${gram(m[k])} g</span>`).join('')}</span>`;
  }
  /** Three bars (eaten/planned vs. target). Without a target the bar shows the share of energy. */
  function macroBars(totals, targets) {
    const energy = MACROS.reduce((a, [k]) => a + (totals[k] || 0) * (k === 'fat' ? 9 : 4), 0);
    return `<div class="macro-bars">${MACROS.map(([k, label]) => {
      const v = totals[k] || 0;
      const t = targets && targets[k];
      const pct = t ? Math.min(100, (v / t) * 100) : energy ? ((v * (k === 'fat' ? 9 : 4)) / energy) * 100 : 0;
      const over = t && v > t * 1.1;
      return `<div class="macro-bar mb-${k}">
        <div class="row-between"><span>${label}</span><span class="small"><strong>${gram(v)}</strong>${t ? ` / ${gram(t)}` : ''} g${t ? '' : ` <span class="muted">· ${num(pct)} %</span>`}</span></div>
        <div class="mb-track ${over ? 'over' : ''}"><i style="width:${pct.toFixed(1)}%"></i></div>
      </div>`;
    }).join('')}</div>`;
  }

  // ---------- barcode scanner ----------
  let zxingLoad = null;
  function loadZxing() {
    if (window.ZXing) return Promise.resolve(window.ZXing);
    zxingLoad = zxingLoad || new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/vendor/zxing.min.js';
      s.onload = () => resolve(window.ZXing);
      s.onerror = () => {
        zxingLoad = null;
        reject(new Error('Scanner konnte nicht geladen werden.'));
      };
      document.head.appendChild(s);
    });
    return zxingLoad;
  }

  /**
   * Full-screen camera view that resolves with an EAN/UPC code, or null when closed.
   * Uses the built-in BarcodeDetector where there is one (Chrome on Android), otherwise ZXing.
   * Typing the number below the barcode always works as a fallback.
   */
  function scanBarcode() {
    return new Promise((resolve) => {
      const ov = document.createElement('div');
      ov.className = 'scanner';
      ov.setAttribute('role', 'dialog');
      ov.setAttribute('aria-modal', 'true');
      ov.setAttribute('aria-label', 'Barcode scannen');
      ov.innerHTML = `
        <video playsinline muted aria-hidden="true"></video>
        <div class="scan-frame" aria-hidden="true"><i></i></div>
        <div class="scan-top"><button type="button" class="scan-close" aria-label="Scanner schließen">✕</button></div>
        <div class="scan-bottom">
          <p class="scan-status" role="status">Kamera wird gestartet…</p>
          <form class="scan-manual" novalidate>
            <input name="code" inputmode="numeric" autocomplete="off" pattern="[0-9]*" maxlength="14" placeholder="oder Nummer unter dem Barcode eintippen" aria-label="Barcode-Nummer">
            <button type="submit" class="btn-primary">OK</button>
          </form>
        </div>`;
      document.body.appendChild(ov);
      document.body.classList.add('fx-open');
      const video = ov.querySelector('video');
      const status = ov.querySelector('.scan-status');
      let stream = null;
      let timer = null;
      let done = false;
      const finish = (code) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (stream) stream.getTracks().forEach((t) => t.stop());
        document.removeEventListener('keydown', onKey);
        ov.classList.add('out');
        setTimeout(() => {
          ov.remove();
          document.body.classList.remove('fx-open');
        }, 220);
        if (code && navigator.vibrate) navigator.vibrate(40);
        resolve(code || null);
      };
      const onKey = (e) => e.key === 'Escape' && finish(null);
      document.addEventListener('keydown', onKey);
      ov.querySelector('.scan-close').addEventListener('click', () => finish(null));
      ov.querySelector('.scan-manual').addEventListener('submit', (e) => {
        e.preventDefault();
        const code = e.target.code.value.replace(/\D/g, '');
        if (!/^\d{8,14}$/.test(code)) {
          status.textContent = 'Ein Barcode hat 8 bis 14 Ziffern.';
          return;
        }
        finish(code);
      });
      const valid = (c) => /^\d{8,14}$/.test(c || '');

      (async () => {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          status.textContent = 'Keine Kamera verfügbar – tipp die Nummer unter dem Barcode ein.';
          ov.querySelector('input').focus();
          return;
        }
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        } catch {
          status.textContent = 'Kein Kamerazugriff. Erlaube die Kamera in den Browser-Einstellungen oder tipp die Nummer ein.';
          ov.querySelector('input').focus();
          return;
        }
        if (done) return stream.getTracks().forEach((t) => t.stop());
        video.srcObject = stream;
        await video.play().catch(() => {});
        // sharp picture up close: continuous autofocus where the camera supports it
        const track = stream.getVideoTracks()[0];
        const caps = track && track.getCapabilities ? track.getCapabilities() : {};
        if (caps.focusMode && caps.focusMode.includes('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
        ov.classList.add('live');
        status.textContent = 'Barcode in den Rahmen halten';
        let detect;
        const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
        if ('BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats().catch(() => [])).includes('ean_13')) {
          const det = new BarcodeDetector({ formats });
          detect = async () => {
            const hits = await det.detect(video).catch(() => []);
            return hits.map((h) => h.rawValue).find(valid);
          };
        } else {
          const Z = await loadZxing().catch(() => null);
          if (!Z) {
            status.textContent = 'Scanner konnte nicht geladen werden – tipp die Nummer ein.';
            return;
          }
          const hints = new Map([[Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E]], [Z.DecodeHintType.TRY_HARDER, true]]);
          const reader = new Z.MultiFormatReader();
          reader.setHints(hints);
          const canvas = document.createElement('canvas');
          const g = canvas.getContext('2d', { willReadFrequently: true });
          let round = 0;
          detect = async () => {
            const w = video.videoWidth;
            const h = video.videoHeight;
            if (!w || !h) return null;
            // mostly the middle band, where the frame is (faster, less noise); every third try the whole picture
            const full = ++round % 3 === 0;
            const cw = full ? w : Math.round(w * 0.8);
            const ch = full ? h : Math.round(h * 0.45);
            canvas.width = cw;
            canvas.height = ch;
            g.drawImage(video, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, cw, ch);
            try {
              const bmp = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas)));
              return reader.decodeWithState(bmp).getText();
            } catch {
              return null;
            } finally {
              reader.reset();
            }
          };
        }
        // the same code twice in a row, so a half-read barcode isn't taken
        let last = null;
        const tick = async () => {
          if (done) return;
          const code = await detect();
          if (code && valid(code)) {
            if (code === last) return finish(code);
            last = code;
          }
          timer = setTimeout(tick, 120);
        };
        tick();
      })();
    });
  }

  // ---------- food diary ----------
  const DIARY_MEALS = [['fruehstueck', 'Frühstück'], ['mittag', 'Mittagessen'], ['abend', 'Abendessen'], ['snack', 'Snacks']];
  const AMOUNT_CHIPS = [50, 100, 150, 200, 250];

  function nutritionTabs(active) {
    return `<nav class="tabs" aria-label="Ernährung">
      <a href="#/nutrition" ${active === 'plan' ? 'aria-current="page"' : ''}>Plan</a>
      <a href="#/nutrition/diary" ${active === 'diary' ? 'aria-current="page"' : ''}>Tagebuch</a>
    </nav>`;
  }

  async function renderFoodDiary() {
    setView(LOADING);
    const saved = sessionStorage.getItem('diaryDate');
    const date = saved && saved <= todayStr() ? saved : todayStr();
    setView(`
      <div class="page-head"><div>${eyebrow('Was du isst')}<h1>Ernährung</h1></div></div>
      ${nutritionTabs('diary')}
      <div id="diary"></div>`);
    mountDiary(document.getElementById('diary'), { date, readOnly: false });
  }

  /** Diary of one day. readOnly + clientId for the coach. */
  async function mountDiary(root, { date, readOnly, clientId }) {
    const q = clientId ? `&userId=${clientId}` : '';
    let day;
    const load = async (d) => {
      date = d;
      if (!readOnly) try { sessionStorage.setItem('diaryDate', d); } catch { /* private mode */ }
      root.setAttribute('aria-busy', 'true');
      try {
        day = await api('GET', `/api/foodlog?date=${d}${q}`);
      } catch (err) {
        root.innerHTML = `<div class="card empty-state">${esc(err.message)}</div>`;
        return;
      }
      root.removeAttribute('aria-busy');
      draw();
    };
    const afterChange = (r) => {
      day = r.day;
      if (r.revoked && r.revoked.length) toast(`${r.revoked.length} Dose(n) zurückgegeben – die Medaillen dafür gibt es nicht mehr.`, true);
      draw();
    };

    function draw() {
      const t = day.totals;
      const tg = day.targets;
      const kcalTarget = tg.kcal || (tg.kcalMin && tg.kcalMax ? Math.round((tg.kcalMin + tg.kcalMax) / 2) : null);
      const left = kcalTarget ? kcalTarget - t.kcal : null;
      const ringPct = kcalTarget ? Math.min(1, t.kcal / kcalTarget) : 0;
      const over = tg.kcalMax ? t.kcal > tg.kcalMax : kcalTarget ? t.kcal > kcalTarget * 1.1 : false;
      const R = 52;
      const C = 2 * Math.PI * R;
      const isToday = date === todayStr();
      const label = isToday ? 'Heute' : date === addDays(todayStr(), -1) ? 'Gestern' : fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' });
      const meals = DIARY_MEALS.map(([key, name]) => {
        const items = day.items.filter((i) => i.meal === key);
        const kcal = items.reduce((a, i) => a + i.kcal, 0);
        return `<section class="card diary-meal" data-meal="${key}">
          <div class="row-between meal-head"><h2>${name}</h2><span class="muted small">${items.length ? `${num(kcal)} kcal` : ''}</span></div>
          ${items.length ? `<ul class="diary-items">${items.map((i) => `<li>
            <${readOnly ? 'div' : 'button type="button"'} class="diary-item" data-item="${i.id}">
              <span class="di-main"><span class="item-name">${esc(i.name)}</span>
                <span class="muted small di-sub">${i.brand ? `${esc(i.brand)} · ` : ''}${esc(fmtAmount(i.amount, i.unit))} ${macroInline(i)}</span></span>
              <span class="di-kcal">${num(i.kcal)}<small> kcal</small></span>
            </${readOnly ? 'div' : 'button'}></li>`).join('')}</ul>` : `<p class="muted small diary-empty">${readOnly ? 'Nichts eingetragen.' : 'Noch nichts eingetragen.'}</p>`}
          ${readOnly ? '' : `<div class="row diary-add"><button type="button" class="btn-secondary btn-sm" data-add="${key}">+ Lebensmittel</button>
            <button type="button" class="btn-ghost btn-sm" data-scan="${key}"><span aria-hidden="true">▥</span> Scannen</button></div>`}
        </section>`;
      }).join('');
      root.innerHTML = `
        <div class="diary-date">
          <button type="button" class="icon-btn" data-day="-1" aria-label="Vorheriger Tag">‹</button>
          <strong>${esc(label)}</strong>
          <button type="button" class="icon-btn" data-day="1" aria-label="Nächster Tag" ${isToday ? 'disabled' : ''}>›</button>
        </div>
        <div class="diary-grid">
          <section class="card diary-summary">
            <div class="kcal-ring ${over ? 'over' : ''}" role="img" aria-label="${num(t.kcal)} kcal gegessen${kcalTarget ? ` von ${num(kcalTarget)}` : ''}">
              <svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="${R}" class="kr-track"/>
                <circle cx="60" cy="60" r="${R}" class="kr-fill" stroke-dasharray="${(C * ringPct).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 60 60)"/></svg>
              <div class="kr-text"><strong>${num(t.kcal)}</strong><span>kcal</span></div>
            </div>
            <div class="diary-sum-side">
              <p class="kcal-left ${over ? 'bad' : ''}">${kcalTarget ? (left >= 0 ? `Noch <strong>${num(left)}</strong> kcal` : `<strong>${num(-left)}</strong> kcal drüber`) : 'Noch kein Kalorienziel'}</p>
              ${tg.kcalMin && tg.kcalMax ? `<p class="muted small">Ziel ${esc(fmtKcal(tg.kcalMin, tg.kcalMax))}</p>` : ''}
              ${macroBars(t, tg)}
            </div>
          </section>
          <div class="stack diary-meals">${meals}</div>
        </div>
        ${readOnly ? '' : '<p class="muted small diary-note">Die Kalorien des Tages landen automatisch im Tracker. Produktdaten beim Scannen: Open Food Facts.</p>'}`;
      root.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => load(addDays(date, Number(b.dataset.day)))));
      if (readOnly) return;
      root.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => openAddFood(b.dataset.add)));
      root.querySelectorAll('[data-scan]').forEach((b) => b.addEventListener('click', () => scanAndAdd(b.dataset.scan)));
      root.querySelectorAll('[data-item]').forEach((b) => b.addEventListener('click', () => openEditItem(day.items.find((i) => i.id === Number(b.dataset.item)))));
    }

    async function scanAndAdd(meal) {
      const code = await scanBarcode();
      if (!code) return;
      let product = null;
      try {
        product = (await api('GET', `/api/barcode/${code}`)).product;
      } catch {
        product = null;
      }
      // the server couldn't find or reach it: ask Open Food Facts straight from the phone
      if (!product || !product.found) product = (await offFromBrowser(code)) || product;
      if (!product) {
        toast('Die Produktdatenbank ist gerade nicht erreichbar – trag die Werte von der Packung ein.', true);
        return openManual(meal, { barcode: code });
      }
      if (!product.found) {
        toast('Produkt nicht gefunden – trag die Werte von der Packung ein.');
        return openManual(meal, { barcode: code });
      }
      openAmount(meal, { ...product, source: 'barcode' });
    }

    /** Direct lookup at Open Food Facts from the browser (fallback when the server can't reach it). */
    async function offFromBrowser(code) {
      try {
        const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,product_name_de,brands,nutriments,serving_size,quantity`, { signal: AbortSignal.timeout(7000) });
        if (!res.ok) return null;
        const d = await res.json();
        const p = d && d.status === 1 && d.product;
        if (!p) return null;
        const n = p.nutriments || {};
        const v = (x) => (x === undefined || x === null || x === '' || Number.isNaN(Number(x)) ? null : Math.round(Number(x) * 10) / 10);
        const kcal = v(n['energy-kcal_100g']) ?? (v(n.energy_100g) !== null ? Math.round(n.energy_100g / 4.184) : null);
        const name = String(p.product_name_de || p.product_name || '').trim();
        if (!name || kcal === null) return null;
        return {
          found: true, barcode: code, name: name.slice(0, 80), brand: String(p.brands || '').split(',')[0].trim().slice(0, 60) || null,
          kcal: Math.round(kcal), protein: v(n.proteins_100g), carbs: v(n.carbohydrates_100g), fat: v(n.fat_100g),
          unit: /\d\s*(ml|cl|l)\b/i.test(p.quantity || '') ? 'ml' : 'g', serving: p.serving_size || null,
        };
      } catch {
        return null;
      }
    }

    /** Step 1: search the database, recent foods, scan or type in. */
    async function openAddFood(meal) {
      const mealName = DIARY_MEALS.find(([k]) => k === meal)[1];
      openDialog(`
        <h2>${esc(mealName)}</h2>
        <div class="add-food-top">
          <input type="search" name="q" autocomplete="off" placeholder="Lebensmittel oder Marke suchen…" aria-label="Lebensmittel oder Marke suchen">
          <button type="button" class="btn-secondary" data-scan-here><span aria-hidden="true">▥</span> Scannen</button>
        </div>
        <ul class="food-results add-food-list" role="listbox" aria-label="Treffer"></ul>
        <p class="small"><button type="button" class="link-btn" data-manual>Nicht dabei? Selbst eintragen</button></p>
        <div class="dialog-actions"><button type="button" class="btn-secondary" data-close>Schließen</button></div>`, async () => false);
      const input = dialog.querySelector('input[name=q]');
      const list = dialog.querySelector('.add-food-list');
      let recent = [];
      const [foods] = await Promise.all([loadFoods(), api('GET', '/api/foodlog/recent').then((r) => { recent = r.recent; }).catch(() => {})]);
      let shown = [];
      let brands = [];
      let brandTimer = null;
      let brandSeq = 0;
      const searchBrands = () => {
        clearTimeout(brandTimer);
        const term = input.value.trim();
        if (term.length < 3) {
          brands = [];
          return;
        }
        const seq = ++brandSeq;
        brandTimer = setTimeout(async () => {
          try {
            const r = await api('GET', `/api/products?q=${encodeURIComponent(term)}`);
            if (seq !== brandSeq) return;
            brands = r.products;
            show(true);
          } catch { /* the basic list still works */ }
        }, 250);
      };
      const show = (keepBrands) => {
        if (!keepBrands) searchBrands();
        const term = input.value.trim().toLowerCase();
        if (!term) {
          shown = recent.map((r) => ({ ...r, recent: true }));
          if (!shown.length) shown = foods.slice(0, 0);
        } else {
          shown = foods
            .filter((f) => f.name.toLowerCase().includes(term) || (f.category || '').toLowerCase().includes(term))
            .sort((a, b) => Number(!a.name.toLowerCase().startsWith(term)) - Number(!b.name.toLowerCase().startsWith(term)) || a.name.length - b.name.length)
            .slice(0, term.length >= 3 ? 12 : 40);
        }
        const generic = shown.length;
        if (term.length >= 3) shown = shown.concat(brands.map((b) => ({ ...b, branded: true })));
        const row = (f, i) => `<li role="option" tabindex="0" data-i="${i}"><span><span class="item-name">${esc(f.name)}</span>${f.brand ? ` <span class="muted small">${esc(f.brand)}</span>` : ''}
            <span class="muted small di-sub">${num(f.kcal)} kcal/100 ${f.unit} ${macroInline(f)}</span></span>${f.recent ? `<span class="muted small">${esc(fmtAmount(f.amount, f.unit))}</span>` : ''}</li>`;
        if (term.length >= 3) {
          list.innerHTML = (generic ? '<li class="list-label muted small" aria-hidden="true">Lebensmittel</li>' : '') + shown.slice(0, generic).map(row).join('') +
            (brands.length ? '<li class="list-label muted small" aria-hidden="true">Markenprodukte</li>' + shown.slice(generic).map((f, j) => row(f, generic + j)).join('') : '') +
            (shown.length ? '' : '<li class="muted small" data-none>Nichts gefunden. Scann die Packung oder trag es selbst ein.</li>');
          return;
        }
        list.innerHTML = (!term && shown.length ? '<li class="list-label muted small" aria-hidden="true">Zuletzt gegessen</li>' : '') +
          (shown.map((f, i) => `<li role="option" tabindex="0" data-i="${i}"><span><span class="item-name">${esc(f.name)}</span>${f.brand ? ` <span class="muted small">${esc(f.brand)}</span>` : ''}
            <span class="muted small di-sub">${num(f.kcal)} kcal/100 ${f.unit} ${macroInline(f)}</span></span>${f.recent ? `<span class="muted small">${esc(fmtAmount(f.amount, f.unit))}</span>` : ''}</li>`).join('') ||
          `<li class="muted small" data-none>${term ? 'Nichts gefunden. Scann die Packung oder trag es selbst ein.' : 'Tipp los, z. B. „Skyr“ oder „Barebells“ – oder scann einen Barcode.'}</li>`);
      };
      input.addEventListener('input', () => show());
      const choose = (li) => {
        if (!li || li.dataset.i === undefined) return;
        const f = shown[Number(li.dataset.i)];
        openAmount(meal, f.recent
          ? { ...f, source: f.foodId ? 'db' : 'custom', id: f.foodId, suggested: f.amount }
          : f.branded ? { ...f, source: 'barcode' } : { ...f, source: 'db' });
      };
      list.addEventListener('click', (e) => choose(e.target.closest('li')));
      list.addEventListener('keydown', (e) => e.key === 'Enter' && choose(e.target.closest('li')));
      dialog.querySelector('[data-scan-here]').addEventListener('click', () => {
        dialog.close();
        scanAndAdd(meal);
      });
      dialog.querySelector('[data-manual]').addEventListener('click', () => openManual(meal, { name: input.value.trim() }));
      show();
      input.focus();
    }

    /** Step 2: how much? Live preview of kcal and macros. */
    function openAmount(meal, f) {
      if (dialog.open) dialog.close();
      const mealName = DIARY_MEALS.find(([k]) => k === meal)[1];
      const serving = f.serving && /(\d+(?:[.,]\d+)?)\s*(g|ml)\b/i.exec(f.serving);
      const servingRaw = serving ? Number(serving[1].replace(',', '.')) : null;
      const servingAmount = servingRaw ? (servingRaw >= 10 ? Math.round(servingRaw) : Math.round(servingRaw * 10) / 10) : null;
      const start = f.suggested || servingAmount || 100;
      openDialog(`
        <h2>${esc(f.name)}</h2>
        <p class="muted small" style="margin-top:-6px">${f.brand ? `${esc(f.brand)} · ` : ''}${num(f.kcal)} kcal/100 ${esc(f.unit)} ${macroInline(f)}</p>
        <div class="field"><label for="fa-amount">Menge</label>
          <div class="input-unit"><input id="fa-amount" name="amount" inputmode="decimal" value="${String(start).replace('.', ',')}" required><span>${esc(f.unit)}</span></div>
          <div class="row chip-row">${[...(servingAmount ? [servingAmount] : []), ...AMOUNT_CHIPS.filter((a) => a !== servingAmount)].map((a, i) =>
            `<button type="button" class="btn-ghost btn-sm chip" data-chip="${a}">${i === 0 && servingAmount ? `1 Portion (${esc(fmtAmount(a, f.unit))})` : esc(fmtAmount(a, f.unit))}</button>`).join('')}</div></div>
        <div class="field"><label for="fa-meal">Mahlzeit</label><select id="fa-meal" name="meal">${DIARY_MEALS.map(([k, n]) => `<option value="${k}" ${k === meal ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <div class="amount-preview" aria-live="polite"></div>
        <div class="dialog-actions"><button type="button" class="btn-secondary" data-close>Abbrechen</button><button type="submit" class="btn-primary">Zu ${esc(mealName)} hinzufügen</button></div>`,
      async (form) => {
        const amount = parseNum(form.amount.value);
        if (!amount || Number.isNaN(amount) || amount <= 0) throw new Error('Bitte eine Menge angeben.');
        const body = { date, meal: form.meal.value, amount };
        if (f.source === 'db') body.foodId = f.id;
        else Object.assign(body, { name: f.name, brand: f.brand, barcode: f.barcode, unit: f.unit, kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat });
        afterChange(await api('POST', '/api/foodlog', body));
        savedHud('Eingetragen', `${fmtAmount(amount, f.unit)} ${f.name}`);
      });
      const form = dialog.querySelector('form');
      const preview = form.querySelector('.amount-preview');
      const mealSel = form.meal;
      const submit = form.querySelector('[type=submit]');
      const upd = () => {
        const a = parseNum(form.amount.value) || 0;
        const m = (k) => (f[k] === null || f[k] === undefined ? null : Math.round(((a * f[k]) / 100) * 10) / 10);
        preview.innerHTML = `<strong>${num(itemKcal(a, f.kcal))} kcal</strong> ${macroInline({ protein: m('protein'), carbs: m('carbs'), fat: m('fat') })}`;
        submit.textContent = `Zu ${DIARY_MEALS.find(([k]) => k === mealSel.value)[1]} hinzufügen`;
      };
      form.amount.addEventListener('input', upd);
      mealSel.addEventListener('change', upd);
      form.querySelectorAll('[data-chip]').forEach((b) => b.addEventListener('click', () => {
        form.amount.value = String(b.dataset.chip).replace('.', ',');
        upd();
      }));
      upd();
      form.amount.select();
    }

    /** Typed in from the packaging (also when a scanned product is unknown). */
    function openManual(meal, pre) {
      if (dialog.open) dialog.close();
      const v = (k) => (pre[k] === null || pre[k] === undefined ? '' : String(pre[k]).replace('.', ','));
      openDialog(`
        <h2>Selbst eintragen</h2>
        <p class="muted small" style="margin-top:-6px">Die Werte pro 100 g stehen auf der Packung (Nährwerttabelle).${pre.barcode ? ` Barcode ${esc(pre.barcode)}.` : ''}</p>
        <div class="field"><label for="fm-name">Name</label><input id="fm-name" name="name" maxlength="80" value="${esc(pre.name || '')}" required></div>
        <div class="field"><label for="fm-brand">Marke <span class="muted">(optional)</span></label><input id="fm-brand" name="brand" maxlength="60" value="${esc(pre.brand || '')}"></div>
        <div class="field-row">
          <div class="field"><label for="fm-kcal">kcal pro 100</label><input id="fm-kcal" name="kcal" inputmode="decimal" value="${v('kcal')}" required></div>
          <div class="field"><label for="fm-unit">Einheit</label><select id="fm-unit" name="unit"><option value="g">g</option><option value="ml" ${pre.unit === 'ml' ? 'selected' : ''}>ml</option></select></div>
        </div>
        <div class="field-row three">
          <div class="field"><label for="fm-p">Eiweiß</label><input id="fm-p" name="protein" inputmode="decimal" value="${v('protein')}" placeholder="g"></div>
          <div class="field"><label for="fm-c">Kohlenh.</label><input id="fm-c" name="carbs" inputmode="decimal" value="${v('carbs')}" placeholder="g"></div>
          <div class="field"><label for="fm-f">Fett</label><input id="fm-f" name="fat" inputmode="decimal" value="${v('fat')}" placeholder="g"></div>
        </div>
        <div class="dialog-actions"><button type="button" class="btn-secondary" data-close>Abbrechen</button><button type="submit" class="btn-primary">Weiter</button></div>`,
      async (form) => {
        const kcal = parseNum(form.kcal.value);
        if (!form.name.value.trim()) throw new Error('Bitte einen Namen angeben.');
        if (kcal === null || Number.isNaN(kcal)) throw new Error('Bitte die kcal pro 100 angeben.');
        const mac = (n) => {
          const x = parseNum(form[n].value);
          if (Number.isNaN(x)) throw new Error('Makros bitte als Zahl in Gramm.');
          return x;
        };
        const f = { source: 'custom', name: form.name.value.trim(), brand: form.brand.value.trim() || null, barcode: pre.barcode || null, unit: form.unit.value, kcal, protein: mac('protein'), carbs: mac('carbs'), fat: mac('fat') };
        setTimeout(() => openAmount(meal, f), 0);
      });
    }

    function openEditItem(i) {
      openDialog(`
        <h2>${esc(i.name)}</h2>
        <p class="muted small" style="margin-top:-6px">${num(i.per100.kcal)} kcal/100 ${esc(i.unit)} ${macroInline(i.per100)}</p>
        <div class="field-row">
          <div class="field"><label for="fe-amount">Menge</label><div class="input-unit"><input id="fe-amount" name="amount" inputmode="decimal" value="${String(i.amount).replace('.', ',')}"><span>${esc(i.unit)}</span></div></div>
          <div class="field"><label for="fe-meal">Mahlzeit</label><select id="fe-meal" name="meal">${DIARY_MEALS.map(([k, n]) => `<option value="${k}" ${k === i.meal ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        </div>
        <div class="dialog-actions"><button type="button" class="btn-ghost danger-text" data-del style="margin-right:auto">Löschen</button>
          <button type="button" class="btn-secondary" data-close>Abbrechen</button><button type="submit" class="btn-primary">Speichern</button></div>`,
      async (form) => {
        const amount = parseNum(form.amount.value);
        if (!amount || Number.isNaN(amount)) throw new Error('Bitte eine Menge angeben.');
        afterChange(await api('PATCH', `/api/foodlog/${i.id}`, { amount, meal: form.meal.value }));
      });
      dialog.querySelector('[data-del]').addEventListener('click', async () => {
        try {
          afterChange(await api('DELETE', `/api/foodlog/${i.id}`));
          dialog.close();
          toast(`${i.name} entfernt`);
        } catch (err) {
          toast(err.message, true);
        }
      });
    }

    await load(date);
  }

  // ---------- coach: nutrition plan editor ----------
  async function mountCoachNutrition(root, client, goals) {
    const [plan, , pr] = await Promise.all([api('GET', `/api/nutrition?userId=${client.id}`), loadFoods(), api('GET', `/api/nutrition/request?userId=${client.id}`)]);
    planRequest = pr;
    drawCoachNutrition(root, client, goals, plan);
  }

  let planRequest = null; // the client's preferences for a new plan (coach view)
  function drawCoachNutrition(root, client, goals, plan) {
    const redraw = (p) => drawCoachNutrition(root, client, goals, p);
    // the first meal answers the request (the server marks it done as well)
    if (plan.meals.length && planRequest && planRequest.request) planRequest.request.status = 'done';
    const call = async (method, url, body, msg) => {
      try {
        const p = await api(method, url, body);
        if (msg) toast(msg);
        redraw(p);
      } catch (err) {
        toast(err.message, true);
      }
    };
    const open = plan.requests.filter((r) => r.status === 'open');
    const history = plan.requests.filter(isRecentDecision);
    const itemById = new Map(plan.meals.flatMap((m) => m.items.map((i) => [i.id, { ...i, meal: m }])));

    const requestsHtml = open.length
      ? `<section class="card requests-card"><h2 style="margin-bottom:8px">🍽 Offene Tauschwünsche (${open.length})</h2>
          ${open
            .map((r) => {
              const it = r.itemId ? itemById.get(r.itemId) : null;
              const canApply = it && r.wantedFood;
              const amount = canApply ? sameKcalAmount(it.kcalTotal, r.wantedFood.kcal) : null;
              return `<div class="swap-req">
                ${requestLine(r)}
                <div class="row" style="gap:6px;margin-top:6px">
                  ${canApply ? `<button type="button" class="btn-primary btn-sm" data-apply="${r.id}">Tausch übernehmen: ${esc(fmtAmount(amount, r.wantedFood.unit))} ${esc(r.wantedFood.name)} (≈ ${num(itemKcal(amount, r.wantedFood.kcal))} kcal)</button>` : ''}
                  <button type="button" class="btn-secondary btn-sm" data-resolve="${r.id}" data-status="done">Erledigt – Plan selbst angepasst</button>
                  <button type="button" class="btn-ghost btn-sm danger-text" data-resolve="${r.id}" data-status="declined">Ablehnen</button>
                </div></div>`;
            })
            .join('')}
        </section>`
      : '';

    const mealsHtml = plan.meals
      .map((m, mi) => {
        const reqItemIds = new Set(open.filter((r) => r.mealId === m.id).map((r) => r.itemId));
        const mealReq = open.some((r) => r.type === 'meal' && r.mealId === m.id);
        return `<section class="card meal ${mealReq ? 'has-request' : ''}">
          <div class="row-between meal-head">
            <h2>${esc(m.name)} ${mealReq ? '<span class="badge warn">Tauschwunsch</span>' : ''}</h2>
            <div class="row" style="gap:2px">
              <span class="muted small" style="margin-right:8px">${num(m.kcalTotal)} kcal${hasMacros(m.macros) && m.items.length ? ` · E ${gram(m.macros.protein)} · K ${gram(m.macros.carbs)} · F ${gram(m.macros.fat)} g` : ''}</span>
              <button type="button" class="btn-ghost btn-sm" data-move="${m.id}" data-dir="-1" ${mi === 0 ? 'disabled' : ''} aria-label="Nach oben">↑</button>
              <button type="button" class="btn-ghost btn-sm" data-move="${m.id}" data-dir="1" ${mi === plan.meals.length - 1 ? 'disabled' : ''} aria-label="Nach unten">↓</button>
              <button type="button" class="btn-ghost btn-sm" data-rename="${m.id}">Umbenennen</button>
              <button type="button" class="btn-ghost btn-sm danger-text" data-del-meal="${m.id}" aria-label="Mahlzeit löschen">✕</button>
            </div>
          </div>
          <div class="table-wrap"><table class="plan-table">
            <thead><tr><th>Lebensmittel</th><th class="num">Menge</th><th class="num">kcal/100</th><th class="num">kcal</th><th class="num macro-col">E · K · F (g)</th><th></th></tr></thead>
            <tbody>${m.items
              .map((i) => `<tr class="${reqItemIds.has(i.id) ? 'has-request' : ''}">
                <td>${esc(i.name)} ${reqItemIds.has(i.id) ? '<span class="badge warn">Tauschwunsch</span>' : ''}</td>
                <td class="num"><input class="amount-input" data-amount="${i.id}" inputmode="decimal" value="${String(i.amount).replace('.', ',')}" aria-label="Menge"> ${esc(i.unit)}</td>
                <td class="num muted">${num(i.kcal)}</td>
                <td class="num"><strong>${num(i.kcalTotal)}</strong></td>
                <td class="num muted macro-col">${hasMacros(i) ? `${gram(i.protein)} · ${gram(i.carbs)} · ${gram(i.fat)}` : '–'}</td>
                <td class="actions"><button type="button" class="btn-ghost btn-sm" data-replace="${i.id}">Ersetzen</button><button type="button" class="btn-ghost btn-sm danger-text" data-del-item="${i.id}" aria-label="Entfernen">✕</button></td>
              </tr>`)
              .join('') || '<tr><td colspan="6" class="muted small">Noch keine Lebensmittel.</td></tr>'}</tbody>
          </table></div>
          <form class="add-item" data-add="${m.id}">
            <div data-picker></div>
            <div class="input-unit amount-field"><input name="amount" inputmode="decimal" placeholder="Menge"><span data-unit>g</span></div>
            <button type="submit" class="btn-secondary">+ Hinzufügen</button>
          </form>
        </section>`;
      })
      .join('');

    root.innerHTML = `
      <div class="nutrition-grid">
        <div class="stack">
          ${requestsHtml}
          ${planRequest && planRequest.request && (planRequest.request.status === 'open' || !plan.meals.length) ? `
          <section class="card requests-card plan-request-coach">
            <div class="row-between"><h2>🍽 Wünsche für den Ernährungsplan</h2>
              <span class="badge ${planRequest.request.status === 'open' ? 'warn' : 'good'}">${planRequest.request.status === 'open' ? 'offen' : 'erledigt'}</span></div>
            <p class="muted small">Angefragt am ${esc(fmtDate(planRequest.request.updatedAt.slice(0, 10), { day: 'numeric', month: 'long' }))}. Mit der ersten Mahlzeit gilt die Anfrage als erledigt.</p>
            ${planRequestSummary(planRequest.questions, planRequest.request.answers)}
            ${planRequest.request.status === 'open' ? '<button type="button" class="btn-secondary btn-sm" data-pr-done>Als erledigt markieren</button>' : ''}
          </section>` : ''}
          ${plan.meals.length ? '' : '<section class="card ai-card" id="ai-draft" aria-live="polite"></section>'}
          ${planSummary(plan, goals)}
          ${plan.meals.length ? `<div class="row pdf-row coach-pdf">
            <a class="btn btn-secondary btn-sm" href="/api/nutrition/pdf?userId=${client.id}" download>PDF herunterladen</a>
            <button type="button" class="btn-secondary btn-sm" data-plan-mail>Per E-Mail an ${esc(client.displayName.split(' ')[0])}</button>
            <span class="muted small" data-mail-hint></span></div>` : ''}
          ${mealsHtml || '<div class="card empty-state">Noch kein Ernährungsplan. Leg unten die erste Mahlzeit an – oder lass oben einen KI-Entwurf erstellen.</div>'}
          <form class="card add-meal" id="add-meal">
            <h3>Mahlzeit hinzufügen</h3>
            <div class="row" style="gap:6px">${['Frühstück', 'Mittagessen', 'Abendessen', 'Snack', 'Pre-Workout', 'Post-Workout']
              .map((n) => `<button type="button" class="btn-ghost btn-sm chip" data-quick="${n}">${n}</button>`)
              .join('')}</div>
            <div class="row" style="gap:8px;flex-wrap:nowrap"><input name="name" maxlength="60" placeholder="Eigener Name, z. B. Mahlzeit 1"><button type="submit" class="btn-primary">Anlegen</button></div>
          </form>
        </div>
        <aside class="stack">
          <form class="card macro-goals" id="macro-goals">
            <h3 style="margin-bottom:4px">Makroziele pro Tag</h3>
            <p class="muted small" style="margin-top:0">${esc(client.displayName)} sieht sie im Plan und im Tagebuch. Leer lassen = kein Ziel.</p>
            <div class="field-row three">${MACROS.map(([k, label]) => `<div class="field"><label for="mg-${k}">${label}</label>
              <div class="input-unit"><input id="mg-${k}" name="${k}" inputmode="numeric" value="${plan.macroGoals && plan.macroGoals[k] !== null ? plan.macroGoals[k] : ''}"><span>g</span></div></div>`).join('')}</div>
            ${hasKcal(goals) ? `<p class="small muted" data-mg-kcal></p>` : ''}
            <button type="submit" class="btn-secondary btn-sm">Makroziele speichern</button>
          </form>
          <section class="card coach-diary"><h3 style="margin-bottom:8px">Ernährungstagebuch</h3><div id="coach-diary"></div></section>
          <section class="card"><h3 style="margin-bottom:8px">So funktioniert's</h3>
            <p class="small muted">Du legst Mahlzeiten und Mengen fest. ${esc(client.displayName)} sieht den Plan unter „Ernährung“ und kann einzelne Lebensmittel oder ganze Mahlzeiten zum Tausch anfragen – du bekommst dann eine Push-Nachricht. Ändern kannst nur du.</p>
            <p class="small muted">Lebensmittel fehlt? Einfach den Namen eintippen und „neu anlegen“ – oder im <a href="#/admin">Admin-Tool</a> pflegen.</p>
          </section>
          ${history.length ? `<section class="card"><h3 style="margin-bottom:8px">Erledigte Tauschwünsche</h3>${history.map(requestLine).join('')}<p class="small muted" style="margin:8px 0 0">Verschwinden nach einem Tag.</p></section>` : ''}
        </aside>
      </div>`;

    // Plan as PDF by e-mail
    const pm = root.querySelector('[data-plan-mail]');
    if (pm) {
      const hint = root.querySelector('[data-mail-hint]');
      api('GET', `/api/reports/status?userId=${client.id}`).then((st) => {
        if (st.status !== 'ok') {
          pm.disabled = true;
          hint.textContent = st.text;
        }
      }).catch(() => {});
      pm.addEventListener('click', async () => {
        pm.disabled = true;
        try {
          const r = await api('POST', `/api/nutrition/pdf/mail?userId=${client.id}`);
          savedHud('Plan gesendet', r.to);
        } catch (err) {
          toast(err.message, true);
        }
        pm.disabled = false;
      });
    }

    // Macro targets
    const mg = root.querySelector('#macro-goals');
    const mgKcal = mg.querySelector('[data-mg-kcal]');
    const mgUpd = () => {
      if (!mgKcal) return;
      const v = (k) => parseNum(mg[k].value) || 0;
      const kcal = v('protein') * 4 + v('carbs') * 4 + v('fat') * 9;
      mgKcal.textContent = kcal ? `Ergibt ${num(kcal)} kcal – Zielkalorien ${fmtKcal(goals.caloriesMin, goals.caloriesMax)}.` : '';
    };
    mg.addEventListener('input', mgUpd);
    mgUpd();
    mg.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {};
      for (const [k] of MACROS) {
        const x = parseNum(mg[k].value);
        if (Number.isNaN(x)) return toast('Makroziele bitte als ganze Gramm angeben.', true);
        body[k] = x === null ? null : Math.round(x);
      }
      try {
        const r = await api('PUT', `/api/macro-goals?userId=${client.id}`, body);
        plan.macroGoals = r.macroGoals;
        savedHud('Makroziele gespeichert', client.displayName);
        redraw(plan);
      } catch (err) {
        toast(err.message, true);
      }
    });
    mountDiary(root.querySelector('#coach-diary'), { date: todayStr(), readOnly: true, clientId: client.id });

    // Add items
    root.querySelectorAll('[data-add]').forEach((form) => {
      let food = null;
      const picker = foodPicker(form.querySelector('[data-picker]'), {
        allowCreate: true,
        onPick(f) {
          food = f;
          form.querySelector('[data-unit]').textContent = f ? f.unit : 'g';
          if (f) form.amount.focus();
        },
      });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const amount = parseNum(form.amount.value);
        if (!food) return toast('Bitte ein Lebensmittel aus der Liste wählen oder neu anlegen.', true);
        if (!amount || Number.isNaN(amount)) return toast('Bitte eine Menge angeben.', true);
        picker.clear();
        call('POST', `/api/nutrition/meals/${form.dataset.add}/items`, { foodId: food.id, amount });
      });
    });
    root.querySelectorAll('[data-amount]').forEach((inp) =>
      inp.addEventListener('change', () => {
        const amount = parseNum(inp.value);
        if (!amount || Number.isNaN(amount)) return toast('Bitte eine gültige Menge angeben.', true);
        call('PATCH', `/api/nutrition/items/${inp.dataset.amount}`, { amount });
      })
    );
    root.querySelectorAll('[data-del-item]').forEach((b) => b.addEventListener('click', () => call('DELETE', `/api/nutrition/items/${b.dataset.delItem}`)));
    root.querySelectorAll('[data-replace]').forEach((b) =>
      b.addEventListener('click', () => {
        const it = itemById.get(Number(b.dataset.replace));
        let food = null;
        openDialog(
          `<h2>${esc(it.name)} ersetzen</h2>
           <p class="muted small">Aktuell: ${esc(fmtAmount(it.amount, it.unit))} · ${num(it.kcalTotal)} kcal</p>
           <div class="field"><label>Neues Lebensmittel</label><div data-picker></div></div>
           <div class="field"><label for="ra">Menge</label><div class="input-unit"><input id="ra" name="amount" inputmode="decimal"><span data-unit>g</span></div>
             <div class="hint" data-equiv>Die Menge wird automatisch kcal-gleich vorgeschlagen.</div></div>
           <div class="dialog-actions"><button type="button" class="btn-secondary" data-close>Abbrechen</button><button type="submit" class="btn-primary">Ersetzen</button></div>`,
          async (f) => {
            if (!food) throw new Error('Bitte ein Lebensmittel wählen.');
            const amount = parseNum(f.amount.value);
            if (!amount || Number.isNaN(amount)) throw new Error('Bitte eine Menge angeben.');
            redraw(await api('PATCH', `/api/nutrition/items/${it.id}`, { foodId: food.id, amount }));
            toast('Ersetzt ✓');
          }
        );
        const f = dialog.querySelector('form');
        foodPicker(dialog.querySelector('[data-picker]'), {
          allowCreate: true,
          onPick(x) {
            food = x;
            if (!x) return;
            const amount = sameKcalAmount(it.kcalTotal, x.kcal);
            f.amount.value = amount;
            f.querySelector('[data-unit]').textContent = x.unit;
            f.querySelector('[data-equiv]').textContent = `${fmtAmount(amount, x.unit)} ${x.name} ≈ ${num(itemKcal(amount, x.kcal))} kcal (vorher ${num(it.kcalTotal)} kcal)`;
          },
        });
      })
    );
    root.querySelectorAll('[data-move]').forEach((b) =>
      b.addEventListener('click', () => call('PATCH', `/api/nutrition/meals/${b.dataset.move}`, { move: Number(b.dataset.dir) }))
    );
    root.querySelectorAll('[data-del-meal]').forEach((b) =>
      b.addEventListener('click', () => {
        const m = plan.meals.find((x) => x.id === Number(b.dataset.delMeal));
        if (confirm(`Mahlzeit „${m.name}“ mit allen Lebensmitteln löschen?`)) call('DELETE', `/api/nutrition/meals/${m.id}`, null, 'Mahlzeit gelöscht');
      })
    );
    root.querySelectorAll('[data-rename]').forEach((b) =>
      b.addEventListener('click', () => {
        const m = plan.meals.find((x) => x.id === Number(b.dataset.rename));
        openDialog(
          `<h2>Mahlzeit umbenennen</h2><div class="field"><label for="mn">Name</label><input id="mn" name="name" maxlength="60" value="${esc(m.name)}"></div>
           <div class="dialog-actions"><button type="button" class="btn-secondary" data-close>Abbrechen</button><button type="submit" class="btn-primary">Speichern</button></div>`,
          async (f) => redraw(await api('PATCH', `/api/nutrition/meals/${m.id}`, { name: f.name.value }))
        );
      })
    );
    if (!plan.meals.length) {
      mountAiDraft(root.querySelector('#ai-draft'), client, async () => {
        const p = await api('GET', `/api/nutrition?userId=${client.id}`);
        if (planRequest && planRequest.request) planRequest.request.status = 'done';
        redraw(p);
      });
    }
    const prDone = root.querySelector('[data-pr-done]');
    if (prDone) prDone.addEventListener('click', async () => {
      try {
        planRequest = await api('POST', `/api/nutrition/request/done?userId=${client.id}`);
        redraw(plan);
      } catch (err) {
        toast(err.message, true);
      }
    });
    const addMeal = root.querySelector('#add-meal');
    const createMeal = (name) => call('POST', `/api/nutrition/meals?userId=${client.id}`, { name }, `„${name}“ angelegt`);
    addMeal.querySelectorAll('[data-quick]').forEach((b) => b.addEventListener('click', () => createMeal(b.dataset.quick)));
    addMeal.addEventListener('submit', (e) => {
      e.preventDefault();
      if (addMeal.name.value.trim()) createMeal(addMeal.name.value.trim());
    });

    // Swap requests
    root.querySelectorAll('[data-apply]').forEach((b) =>
      b.addEventListener('click', () => call('POST', `/api/nutrition/requests/${b.dataset.apply}/resolve`, { status: 'done', apply: true }, 'Getauscht ✓ – Klient wird benachrichtigt'))
    );
    root.querySelectorAll('[data-resolve]').forEach((b) =>
      b.addEventListener('click', () => {
        const declined = b.dataset.status === 'declined';
        openDialog(
          `<h2>${declined ? 'Tauschwunsch ablehnen' : 'Als erledigt markieren'}</h2>
           <div class="field"><label for="rn">Kurze Nachricht an ${esc(client.displayName)} <span class="muted">(optional)</span></label>
             <textarea id="rn" name="note" maxlength="500" placeholder="${declined ? 'z. B. Reis bleibt diese Woche, wir schauen beim Check-in nochmal.' : 'z. B. Hab dir Kartoffeln eingeplant.'}"></textarea></div>
           <div class="dialog-actions"><button type="button" class="btn-secondary" data-close>Abbrechen</button>
             <button type="submit" class="${declined ? 'btn-danger' : 'btn-primary'}">${declined ? 'Ablehnen' : 'Erledigt'}</button></div>`,
          async (f) => {
            redraw(await api('POST', `/api/nutrition/requests/${b.dataset.resolve}/resolve`, { status: b.dataset.status, note: f.note.value }));
            toast(declined ? 'Abgelehnt – Klient wird benachrichtigt' : 'Erledigt – Klient wird benachrichtigt');
          }
        );
      })
    );
  }

  // ---------- coach: admin tool ----------
  async function renderAdmin() {
    setView(LOADING);
    const [ov] = await Promise.all([api('GET', '/api/admin/overview'), loadFoods(true)]);
    setView(`
      <div class="page-head"><div>${eyebrow('Werkzeuge')}<h1>Admin</h1><p class="muted">Aktivität deiner Klienten, automatische Erinnerungen und Lebensmittel-Datenbank.</p></div></div>
      <div class="stack">
        <section class="card" id="mail-status"></section>
        <section class="card" id="activity"></section>
        <section class="card" id="weight-reminder"></section>
        <section class="card" id="reminder"></section>
        <section class="card" id="metrics"></section>
        <section class="card" id="foods"></section>
        <section class="card ai-card" id="ai-guidelines"></section>
      </div>`);
    drawAiGuidelines();
    drawMailStatus();
    drawActivity(ov);
    drawReminder(ov);
    drawWeightReminder(ov);
    drawFoods();
    drawMetricsAdmin();
  }

  /** E-mail setup: sender, provider, a warning for an example sender, and a test mail that shows the real error. */
  async function drawMailStatus() {
    const root = document.getElementById('mail-status');
    let st;
    try {
      st = await api('GET', '/api/mail/status');
    } catch {
      root.hidden = true;
      return;
    }
    root.innerHTML = `
      <div class="row-between"><h2>✉️ E-Mail-Versand</h2><span class="badge ${st.enabled && !st.warning ? 'good' : 'warn'}">${st.enabled ? (st.warning ? 'prüfen' : 'aktiv') : 'aus'}</span></div>
      ${st.enabled ? `<dl class="mail-status">
          <div><dt>Dienst</dt><dd>${st.via === 'resend' ? 'Resend' : 'SMTP'}</dd></div>
          <div><dt>Absender</dt><dd><code>${esc(st.from)}</code></dd></div>
          <div><dt>Links auf</dt><dd><code>${esc(st.appUrl || '–')}</code></dd></div>
        </dl>
        ${st.warning ? `<p class="mail-warning">⚠️ ${esc(st.warning)}</p>` : ''}
        <form class="row mail-test" novalidate>
          <input name="to" type="email" placeholder="${esc(me.email || 'deine@adresse.de')}" aria-label="Test-Mail an">
          <button type="submit" class="btn-secondary">Test-Mail senden</button>
        </form>
        <p class="small muted" data-mail-result></p>`
        : '<p class="muted small">Ohne E-Mail-Versand gibt es kein „Passwort vergessen“. Einrichten mit <code>RESEND_API_KEY</code> und <code>MAIL_FROM</code> (siehe README).</p>'}`;
    const f = root.querySelector('.mail-test');
    if (!f) return;
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const out = root.querySelector('[data-mail-result]');
      const btn = f.querySelector('button');
      btn.disabled = true;
      out.className = 'small muted';
      out.textContent = 'Wird gesendet…';
      try {
        const r = await api('POST', '/api/mail/test', { to: f.to.value.trim() || undefined });
        out.className = 'small good';
        out.textContent = `✓ Gesendet an ${r.to}. Schau in dein Postfach (auch im Spam).`;
      } catch (err) {
        out.className = 'small bad';
        out.textContent = err.message;
      }
      btn.disabled = false;
    });
  }

  /** Rules the AI follows for nutrition drafts (e.g. what belongs into breakfast). */
  async function drawAiGuidelines() {
    const root = document.getElementById('ai-guidelines');
    let g;
    try {
      g = await api('GET', '/api/ai/guidelines');
    } catch {
      root.hidden = true;
      return;
    }
    root.innerHTML = `
      <div class="row-between" style="margin-bottom:6px"><h2><span class="ai-spark" aria-hidden="true">✦</span> KI-Vorgaben für Ernährungspläne</h2>
        <span class="badge ${g.custom ? 'good' : ''}">${g.custom ? 'angepasst' : 'Standard'}</span></div>
      <p class="small muted" style="margin:0 0 10px">Daran hält sich die KI bei jedem Entwurf – z. B. was zum Frühstück passt und was nicht. Eine Regel pro Zeile, in deinen eigenen Worten.</p>
      <form id="ai-guidelines-form" novalidate>
        <textarea name="guidelines" rows="9" maxlength="4000" aria-label="KI-Vorgaben">${esc(g.guidelines)}</textarea>
        <div class="row" style="gap:8px;margin-top:10px">
          <button type="submit" class="btn-primary">Vorgaben speichern</button>
          ${g.custom ? '<button type="button" class="btn-ghost" data-reset>Standard wiederherstellen</button>' : ''}
        </div>
      </form>`;
    const form = root.querySelector('form');
    const save = async (text) => {
      try {
        await api('PUT', '/api/ai/guidelines', { guidelines: text });
        savedHud('Gespeichert', 'KI-Vorgaben');
        drawAiGuidelines();
      } catch (err) {
        toast(err.message, true);
      }
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      save(form.guidelines.value);
    });
    const reset = root.querySelector('[data-reset]');
    if (reset) reset.addEventListener('click', () => {
      if (confirm('Deine Vorgaben durch den Standard ersetzen?')) save('');
    });
  }

  async function drawMetricsAdmin() {
    const root = document.getElementById('metrics');
    const { categories, counts, metrics } = await api('GET', '/api/metrics');
    const cats = Object.entries(categories);
    root.innerHTML = `
      <div class="row-between" style="margin-bottom:8px"><h2>Kategorien &amp; Zusatzmaße</h2></div>
      <p class="small muted" style="margin:0 0 12px">Lege fest, welche Zusatzmaße Klienten einer Kategorie tracken. Die Kategorie selbst sieht nur du – Klienten sehen nur die passenden Felder.</p>
      <div class="row" style="gap:14px;margin-bottom:14px">${cats.map(([k]) => `<span>${catTag(k)} <span class="muted small">${counts[k] || 0}</span></span>`).join('')}
        <span class="muted small">ohne Kategorie: ${counts.none || 0}</span></div>
      <div class="table-wrap"><table class="metrics-table">
        <thead><tr><th>Zusatzmaß</th><th>Art</th>${cats.map(([, l]) => `<th class="center">${l}</th>`).join('')}<th class="center">Aktiv</th><th></th></tr></thead>
        <tbody>${metrics
          .map((m) => `<tr data-metric-row="${m.id}">
            <td><strong>${esc(m.name)}</strong> ${m.unit ? `<span class="muted small">${esc(m.unit)}</span>` : ''}</td>
            <td class="muted small">${m.kind === 'pr' ? 'Kraft-PRs (Übung, kg, Wdh.)' : 'Zahl pro Tag'}</td>
            ${cats.map(([k]) => `<td class="center"><input type="checkbox" class="cell-check" data-cat-check="${k}" ${m.categories.includes(k) ? 'checked' : ''} aria-label="${esc(m.name)}: ${categories[k]}"></td>`).join('')}
            <td class="center"><input type="checkbox" class="cell-check" data-active ${m.active ? 'checked' : ''} aria-label="${esc(m.name)} aktiv"></td>
            <td class="actions"><button type="button" class="btn-ghost btn-sm danger-text" data-del-metric aria-label="Löschen">✕</button></td>
          </tr>`)
          .join('') || `<tr><td colspan="${cats.length + 4}" class="muted">Noch keine Zusatzmaße.</td></tr>`}</tbody>
      </table></div>
      <form class="metric-form" novalidate>
        <input name="name" maxlength="40" placeholder="Neues Maß, z. B. Oberarmumfang" aria-label="Name">
        <input name="unit" maxlength="12" placeholder="Einheit, z. B. cm" aria-label="Einheit">
        <select name="kind" aria-label="Art"><option value="number">Zahl pro Tag</option><option value="pr">Kraft-PRs</option></select>
        <button type="submit" class="btn-secondary">+ Hinzufügen</button>
      </form>`;

    root.querySelectorAll('[data-metric-row]').forEach((tr) => {
      const id = tr.dataset.metricRow;
      const save = async (body, msg) => {
        try {
          await api('PATCH', `/api/metrics/${id}`, body);
          toast(msg);
        } catch (err) {
          toast(err.message, true);
          drawMetricsAdmin();
        }
      };
      tr.querySelectorAll('[data-cat-check]').forEach((cb) =>
        cb.addEventListener('change', () =>
          save({ categories: [...tr.querySelectorAll('[data-cat-check]:checked')].map((x) => x.dataset.catCheck) }, 'Zuordnung gespeichert')
        )
      );
      tr.querySelector('[data-active]').addEventListener('change', (e) => save({ active: e.target.checked }, e.target.checked ? 'Aktiviert' : 'Deaktiviert'));
      tr.querySelector('[data-del-metric]').addEventListener('click', async () => {
        if (!confirm('Dieses Zusatzmaß mit allen eingetragenen Werten löschen? Tipp: „Aktiv“ abwählen blendet es nur aus.')) return;
        await api('DELETE', `/api/metrics/${id}`).catch((err) => toast(err.message, true));
        drawMetricsAdmin();
      });
    });
    const f = root.querySelector('.metric-form');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('POST', '/api/metrics', { name: f.name.value, unit: f.unit.value, kind: f.kind.value, categories: [] });
        toast('Zusatzmaß angelegt – jetzt Kategorien anhaken');
        drawMetricsAdmin();
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  const fmtTs = (iso) =>
    iso ? new Date(iso).toLocaleString((window.I18N ? I18N.locale : 'de-DE'), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–';

  function drawActivity(ov) {
    const root = document.getElementById('activity');
    const rows = ov.clients.slice().sort((a, b) => b.missingDays - a.missingDays);
    const missingBadge = (c) => {
      const d = c.missingDays;
      const cls = d <= 1 ? 'good' : d === 2 ? 'warn' : 'bad';
      if (!c.lastEntry) return `<span class="badge ${d >= 2 ? 'bad' : ''}">noch nie eingetragen</span>`;
      return `<span class="badge ${cls}">${d === 0 ? 'heute eingetragen' : d === 1 ? 'seit gestern' : `${d} Tage`}</span>`;
    };
    const reminderText = {
      ok: '–',
      due: '<span class="warn">fällig</span>',
      'sent-today': 'heute erinnert',
      'already-reminded': 'schon erinnert',
      'no-push': '<span class="muted">kein Push</span>',
    };
    root.innerHTML = `
      <div class="row-between" style="margin-bottom:8px"><h2>Aktivität &amp; Logins</h2><span class="muted small">${rows.length} Klienten</span></div>
      <p class="small muted" style="margin:0 0 10px">„App genutzt“ zählt die Tage, an denen der Klient den Tracker geöffnet hat. Logins sind seltener, weil man 30 Tage angemeldet bleibt.</p>
      <div class="table-wrap"><table class="activity-table">
        <thead><tr><th>Klient</th><th>Kategorie</th><th>Ohne Eintrag</th><th class="num">Einträge 7 T</th><th class="num">App genutzt 7 T / 30 T</th><th>Zuletzt aktiv</th><th>Letzter Login</th><th class="num">Logins 30 T</th><th>Erinnerung</th></tr></thead>
        <tbody>${rows
          .map((c) => `<tr>
            <td><a href="#/client/${c.id}"><strong>${esc(c.displayName)}</strong></a></td>
            <td>${catTag(c.category) || '<span class="muted small">–</span>'}</td>
            <td>${missingBadge(c)}</td>
            <td class="num">${c.entries7}/7</td>
            <td class="num">${c.activeDays7} / ${c.activeDays30}</td>
            <td>${esc(fmtTs(c.lastSeen))}</td>
            <td>${esc(fmtTs(c.lastLogin))}</td>
            <td class="num">${c.logins30}</td>
            <td class="small">${reminderText[c.reminderState] || '–'}${c.lastReminder ? `<div class="muted">zuletzt ${esc(fmtDate(c.lastReminder, { day: '2-digit', month: '2-digit' }))}</div>` : ''}</td>
          </tr>`)
          .join('') || '<tr><td colspan="9" class="muted">Noch keine Klienten.</td></tr>'}</tbody>
      </table></div>`;
  }

  function drawWeightReminder(ov) {
    const root = document.getElementById('weight-reminder');
    const cfg = ov.weightReminder;
    const due = ov.weightToday.filter((c) => c.state === 'due');
    const noPush = ov.weightToday.filter((c) => c.state === 'no-push');
    const done = ov.weightToday.filter((c) => c.state === 'done');
    root.innerHTML = `
      <form novalidate>
        <div class="row-between" style="margin-bottom:8px">
          <h2>⚖️ Gewichts-Erinnerung</h2>
          <label class="switch"><input type="checkbox" name="enabled" ${cfg.enabled ? 'checked' : ''}><span></span><b>${cfg.enabled ? 'Aktiv' : 'Aus'}</b></label>
        </div>
        <p class="small muted" style="margin:0 0 12px">Jeden Tag zur eingestellten Uhrzeit bekommen alle, die noch kein Gewicht eingetragen haben, eine Push-Nachricht.</p>
        <div class="reminder-grid">
          <div class="field"><label for="w-time">Uhrzeit <span class="muted">(deutsche Zeit)</span></label>
            <input id="w-time" type="time" name="time" value="${esc(cfg.time)}"></div>
          <div class="field"><label for="w-title">Titel</label><input id="w-title" name="title" maxlength="60" value="${esc(cfg.title)}"></div>
        </div>
        <div class="field"><label for="w-body">Text</label><textarea id="w-body" name="body" maxlength="240">${esc(cfg.body)}</textarea>
          <div class="hint">Platzhalter: <code>{name}</code> = Name des Klienten</div></div>
        <div class="row">
          <button type="submit" class="btn-primary">Speichern</button>
          <button type="button" class="btn-secondary" data-run>Jetzt senden</button>
        </div>
        <p class="error" hidden></p>
        <div class="hint-box small" style="margin-top:12px">
          <div><strong>Heute noch ohne Gewicht:</strong> ${due.length ? due.map((c) => esc(c.name)).join(', ') : 'niemand mit Push'} · <span class="muted">${done.length} von ${ov.weightToday.length} haben schon gewogen</span></div>
          ${noPush.length ? `<div class="muted">Ohne Push-Zustimmung (bekommen nichts): ${noPush.map((c) => esc(c.name)).join(', ')}</div>` : ''}
          <div class="muted">Letzter Lauf: ${cfg.lastRunAt ? `${esc(fmtTs(cfg.lastRunAt))} – ${esc(cfg.lastResult || '')}` : 'noch nie'}</div>
        </div>
      </form>`;
    const f = root.querySelector('form');
    const showErr = (err) => {
      const e = f.querySelector('.error');
      e.textContent = err.message;
      e.hidden = false;
    };
    const save = async (body, msg) => {
      try {
        const next = await api('PUT', '/api/admin/weight-reminder', body);
        toast(msg);
        drawWeightReminder(next);
      } catch (err) {
        showErr(err);
      }
    };
    f.enabled.addEventListener('change', () => save({ enabled: f.enabled.checked }, f.enabled.checked ? 'Gewichts-Erinnerung aktiv ✓' : 'Gewichts-Erinnerung aus'));
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      save({ enabled: f.enabled.checked, time: f.time.value, title: f.title.value, body: f.body.value }, 'Gespeichert ✓');
    });
    f.querySelector('[data-run]').addEventListener('click', async () => {
      if (!confirm('Erinnerung jetzt an alle ohne Gewicht von heute senden?')) return;
      try {
        const next = await api('POST', '/api/admin/weight-reminder/run');
        toast(next.result.recipients ? `${next.result.delivered} von ${next.result.recipients} erinnert` : 'Niemand fällig');
        drawWeightReminder(next);
      } catch (err) {
        showErr(err);
      }
    });
  }

  function drawReminder(ov) {
    const root = document.getElementById('reminder');
    const cfg = ov.reminder;
    const due = ov.clients.filter((c) => c.reminderState === 'due');
    const noPush = ov.clients.filter((c) => c.reminderState === 'no-push');
    root.innerHTML = `
      <form id="reminder-form" novalidate>
        <div class="row-between" style="margin-bottom:8px">
          <h2>🤖 Automatische Erinnerung</h2>
          <label class="switch"><input type="checkbox" name="enabled" ${cfg.enabled ? 'checked' : ''}><span></span><b>${cfg.enabled ? 'Aktiv' : 'Aus'}</b></label>
        </div>
        <p class="small muted" style="margin:0 0 12px">Einmal am Tag prüft der Tracker, wer zu lange nichts eingetragen hat, und schickt eine Push-Nachricht – nur an Klienten, die Push zugestimmt haben. Erscheint auch in deiner <a href="#/">Push-Übersicht</a>.</p>
        <div class="reminder-grid">
          <div class="field"><label for="r-days">Erinnern nach</label>
            <div class="input-unit"><input id="r-days" name="days" inputmode="numeric" value="${cfg.days}"><span>Tagen ohne Eintrag</span></div></div>
          <div class="field"><label for="r-time">Täglich prüfen um <span class="muted">(deutsche Zeit)</span></label>
            <input id="r-time" type="time" name="time" value="${esc(cfg.time)}"></div>
        </div>
        <div class="field"><label for="r-title">Titel</label><input id="r-title" name="title" maxlength="60" value="${esc(cfg.title)}"></div>
        <div class="field"><label for="r-body">Text</label><textarea id="r-body" name="body" maxlength="240">${esc(cfg.body)}</textarea>
          <div class="hint">Platzhalter: <code>{name}</code> = Name des Klienten, <code>{tage}</code> = Tage ohne Eintrag</div></div>
        <label class="check"><input type="checkbox" name="repeatDaily" ${cfg.repeatDaily ? 'checked' : ''}> Täglich wiederholen, solange nichts eingetragen wird <span class="muted small">(sonst einmal pro Lücke)</span></label>
        <div class="row" style="margin-top:12px">
          <button type="submit" class="btn-primary">Speichern</button>
          <button type="button" class="btn-secondary" data-run>Jetzt prüfen &amp; senden</button>
        </div>
        <p class="error" hidden></p>
        <div class="hint-box small" style="margin-top:12px">
          <div><strong>Heute fällig:</strong> ${due.length ? due.map((c) => `${esc(c.displayName)} (${c.missingDays} Tage)`).join(', ') : 'niemand'}</div>
          ${noPush.length ? `<div class="muted">Ohne Push-Zustimmung (bekommen nichts): ${noPush.map((c) => esc(c.displayName)).join(', ')}</div>` : ''}
          <div class="muted">Letzter Lauf: ${cfg.lastRunAt ? `${esc(fmtTs(cfg.lastRunAt))} – ${esc(cfg.lastResult || '')}` : 'noch nie'}</div>
        </div>
      </form>`;
    const f = root.querySelector('form');
    const body = () => {
      const days = parseNum(f.days.value);
      if (!days || Number.isNaN(days)) throw new Error('Bitte eine Anzahl Tage angeben.');
      return { enabled: f.enabled.checked, days, time: f.time.value, title: f.title.value, body: f.body.value, repeatDaily: f.repeatDaily.checked };
    };
    const showErr = (err) => {
      const e = f.querySelector('.error');
      e.textContent = err.message;
      e.hidden = false;
    };
    f.enabled.addEventListener('change', async () => {
      try {
        const next = await api('PUT', '/api/admin/reminder', { enabled: f.enabled.checked });
        toast(f.enabled.checked ? 'Automatische Erinnerung aktiv ✓' : 'Automatische Erinnerung aus');
        drawReminder(next);
        drawActivity(next);
      } catch (err) {
        showErr(err);
      }
    });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const next = await api('PUT', '/api/admin/reminder', body());
        toast('Gespeichert ✓');
        drawReminder(next);
        drawActivity(next);
      } catch (err) {
        showErr(err);
      }
    });
    f.querySelector('[data-run]').addEventListener('click', async () => {
      try {
        await api('PUT', '/api/admin/reminder', body());
        const next = await api('POST', '/api/admin/reminder/run');
        toast(next.result.recipients ? `${next.result.delivered} von ${next.result.recipients} erinnert` : 'Niemand fällig');
        drawReminder(next);
        drawActivity(next);
      } catch (err) {
        showErr(err);
      }
    });
  }

  function drawFoods(term = '') {
    const root = document.getElementById('foods');
    const t = term.trim().toLowerCase();
    const list = foodCache.filter((f) => !t || f.name.toLowerCase().includes(t) || (f.category || '').toLowerCase().includes(t));
    root.innerHTML = `
      <div class="row-between" style="margin-bottom:8px"><h2>Lebensmittel-Datenbank</h2>
        <button type="button" class="btn-primary btn-sm" data-new-food>+ Lebensmittel anlegen</button></div>
      <p class="small muted" style="margin:0 0 10px">${foodCache.length} Lebensmittel, kcal und Makros (Eiweiß · Kohlenhydrate · Fett) pro 100 g bzw. 100 ml. Die mitgelieferten Werte sind Richtwerte – du kannst alles anpassen.</p>
      <input type="search" data-food-search placeholder="Suchen, z. B. Reis oder Obst" value="${esc(term)}" style="margin-bottom:10px">
      <div class="table-wrap food-table-wrap"><table>
        <thead><tr><th>Lebensmittel</th><th class="num">kcal / 100</th><th class="num macro-col">E · K · F (g)</th><th>Kategorie</th><th></th></tr></thead>
        <tbody>${list
          .map((f) => `<tr><td>${esc(f.name)} ${f.custom ? '<span class="badge">eigenes</span>' : ''}</td>
            <td class="num">${num(f.kcal)} <span class="muted small">/ 100 ${f.unit}</span></td>
            <td class="num muted small macro-col">${hasMacros(f) ? `${gram(f.protein)} · ${gram(f.carbs)} · ${gram(f.fat)}` : '–'}</td>
            <td class="muted small">${esc(f.category || '')}</td>
            <td class="actions"><button type="button" class="btn-ghost btn-sm" data-edit-food="${f.id}">Bearbeiten</button><button type="button" class="btn-ghost btn-sm danger-text" data-del-food="${f.id}" aria-label="Löschen">✕</button></td></tr>`)
          .join('') || '<tr><td colspan="5" class="muted">Nichts gefunden.</td></tr>'}</tbody>
      </table></div>`;
    const search = root.querySelector('[data-food-search]');
    search.addEventListener('input', () => {
      const pos = search.selectionStart;
      drawFoods(search.value);
      const s2 = document.querySelector('[data-food-search]');
      s2.focus();
      s2.setSelectionRange(pos, pos);
    });
    root.querySelector('[data-new-food]').addEventListener('click', async () => {
      if (await createFoodDialog(search.value)) drawFoods(search.value);
    });
    root.querySelectorAll('[data-edit-food]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (await createFoodDialog('', foodCache.find((f) => f.id === Number(b.dataset.editFood)))) drawFoods(search.value);
      })
    );
    root.querySelectorAll('[data-del-food]').forEach((b) =>
      b.addEventListener('click', async () => {
        const f = foodCache.find((x) => x.id === Number(b.dataset.delFood));
        if (!confirm(`„${f.name}“ aus der Datenbank löschen? Bestehende Ernährungspläne bleiben unverändert.`)) return;
        await api('DELETE', `/api/foods/${f.id}`);
        await loadFoods(true);
        toast('Gelöscht');
        drawFoods(search.value);
      })
    );
  }

  // ---------- coach: push notifications ----------
  function consentBadge(c) {
    if (c.pushStatus === 'granted') {
      return c.pushDevices
        ? `<span class="badge good">✓ Zugestimmt · ${c.pushDevices} Gerät${c.pushDevices === 1 ? '' : 'e'}</span>`
        : '<span class="badge warn">Zugestimmt, kein aktives Gerät</span>';
    }
    if (c.pushStatus === 'denied') return '<span class="badge bad">✗ Abgelehnt</span>';
    return '<span class="badge">Noch nicht gefragt</span>';
  }

  function renderConsentList(root, clients) {
    if (!clients.length) {
      root.innerHTML = '<p class="muted small">Noch keine Klienten.</p>';
      return;
    }
    const count = (st) => clients.filter((c) => c.pushStatus === st).length;
    root.innerHTML = `
      <p class="small muted" style="margin:0 0 8px">${count('granted')} zugestimmt · ${count('denied')} abgelehnt · ${count('unknown')} offen</p>
      <ul class="plain-list">${clients
        .map((c) => `<li><a href="#/client/${c.id}">${esc(c.displayName)}</a>${consentBadge(c)}</li>`)
        .join('')}</ul>`;
  }

  async function loadNotifications(root) {
    const { notifications, timezone, automation: auto, weightAutomation: wa } = await api('GET', '/api/notifications');
    const autoHtml = `
      <div class="notif automation">
        <div class="row-between"><strong>🤖 Automatisch: Erinnerung bei fehlendem Eintrag</strong>
          <span class="badge ${auto.enabled ? 'good' : ''}">${auto.enabled ? `Täglich ${esc(auto.time)} Uhr` : 'Aus'}</span></div>
        <div class="small muted">${auto.enabled
          ? `Geht an Klienten, die ${auto.days} ${auto.days === 1 ? 'Tag' : 'Tage'} nichts eingetragen haben.${auto.lastResult ? ` Zuletzt: ${esc(auto.lastResult)}` : ''}`
          : 'Schickt automatisch eine Push-Nachricht an Klienten, die eine Weile nichts eingetragen haben.'}</div>
        <a class="small" href="#/admin">Im Admin-Tool einstellen →</a>
      </div>
      <div class="notif automation">
        <div class="row-between"><strong>⚖️ Automatisch: Gewichts-Erinnerung</strong>
          <span class="badge ${wa.enabled ? 'good' : ''}">${wa.enabled ? `Täglich ${esc(wa.time)} Uhr` : 'Aus'}</span></div>
        <div class="small muted">${wa.enabled
          ? `Geht an alle, die bis ${esc(wa.time)} Uhr noch kein Gewicht eingetragen haben.${wa.lastResult ? ` Zuletzt: ${esc(wa.lastResult)}` : ''}`
          : 'Erinnert täglich alle, die noch kein Gewicht eingetragen haben.'}</div>
        <a class="small" href="#/admin">Im Admin-Tool einstellen →</a>
      </div>`;
    if (!notifications.length) {
      root.innerHTML = `${autoHtml}<p class="muted small">Noch keine eigenen Push-Nachrichten. Leg oben deine erste an.</p>`;
      return;
    }
    const fmt = (iso) =>
      new Date(iso).toLocaleString((window.I18N ? I18N.locale : 'de-DE'), { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: timezone });
    root.innerHTML = `${autoHtml}<ul class="notif-list">${notifications
      .map((n) => {
        const state = n.active
          ? n.nextRunAt
            ? `Nächste: ${esc(fmt(n.nextRunAt))}`
            : 'Aktiv'
          : n.schedule === 'once'
            ? n.lastSentAt ? 'Gesendet' : 'Abgebrochen'
            : 'Pausiert';
        const who = n.audience === 'all' ? 'Alle mit Zustimmung' : esc(n.recipientNames.join(', '));
        return `<li class="notif ${n.active ? '' : 'inactive'}">
          <div class="row-between"><strong>${esc(n.title)}</strong>
            <span class="badge ${n.active ? 'good' : ''}">${esc(n.scheduleText)}</span></div>
          <div class="small">${esc(n.body)}</div>
          <div class="small muted">An: ${who} · ${state}${n.lastSentAt ? ` · Zuletzt ${esc(fmt(n.lastSentAt))}: ${esc(n.lastResult || '')}` : ''}</div>
          <div class="row notif-actions">
            <button type="button" class="btn-ghost btn-sm" data-send="${n.id}">Jetzt senden</button>
            ${n.schedule !== 'once' ? `<button type="button" class="btn-ghost btn-sm" data-toggle="${n.id}" data-active="${n.active}">${n.active ? 'Pausieren' : 'Fortsetzen'}</button>` : ''}
            ${n.schedule === 'once' && n.active ? `<button type="button" class="btn-ghost btn-sm" data-toggle="${n.id}" data-active="true">Abbrechen</button>` : ''}
            <button type="button" class="btn-ghost btn-sm danger-text" data-del="${n.id}">Löschen</button>
          </div>
        </li>`;
      })
      .join('')}</ul>`;

    const reload = () => loadNotifications(root).catch((err) => toast(err.message, true));
    root.querySelectorAll('[data-send]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm('Diese Nachricht jetzt an alle Empfänger senden?')) return;
        try {
          const { notification } = await api('POST', `/api/notifications/${b.dataset.send}/send`);
          toast(notification.lastResult || 'Gesendet');
        } catch (err) {
          toast(err.message, true);
        }
        reload();
      })
    );
    root.querySelectorAll('[data-toggle]').forEach((b) =>
      b.addEventListener('click', async () => {
        try {
          await api('PATCH', `/api/notifications/${b.dataset.toggle}`, { active: b.dataset.active !== 'true' });
        } catch (err) {
          toast(err.message, true);
        }
        reload();
      })
    );
    root.querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm('Push-Nachricht löschen?')) return;
        await api('DELETE', `/api/notifications/${b.dataset.del}`).catch((err) => toast(err.message, true));
        reload();
      })
    );
  }

  function openPushDialog(clients, onSaved) {
    const days = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
    const granted = clients.filter((c) => c.pushStatus === 'granted').length;
    openDialog(
      `<h2>Neue Push-Nachricht</h2>
       <div class="field"><label for="n-title">Titel</label><input id="n-title" name="title" maxlength="60" required placeholder="z. B. Zeit zum Eintragen ⏰"></div>
       <div class="field"><label for="n-body">Text</label><textarea id="n-body" name="body" maxlength="240" required placeholder="z. B. Trag noch schnell Gewicht, Schritte und Schlaf ein 💪"></textarea></div>

       <fieldset class="field"><legend>Empfänger</legend>
         <label class="check"><input type="radio" name="audience" value="all" checked> Alle Klienten mit Zustimmung (${granted})</label>
         <label class="check"><input type="radio" name="audience" value="some"> Bestimmte Klienten</label>
         <div class="choice-list" data-recipients hidden>${clients
           .map((c) => `<label class="check"><input type="checkbox" name="recipient" value="${c.id}"${c.pushStatus === 'granted' ? '' : ' disabled'}>
             ${esc(c.displayName)} ${c.pushStatus === 'granted' ? '' : '<span class="muted small">(keine Zustimmung)</span>'}</label>`)
           .join('')}</div>
       </fieldset>

       <fieldset class="field"><legend>Wann?</legend>
         <div class="segmented seg-wide" role="radiogroup">
           <label><input type="radio" name="schedule" value="once" checked><span>Einmalig</span></label>
           <label><input type="radio" name="schedule" value="daily"><span>Täglich</span></label>
           <label><input type="radio" name="schedule" value="weekly"><span>Wöchentlich</span></label>
         </div>
         <div data-once>
           <label class="check"><input type="radio" name="when" value="now" checked> Sofort senden</label>
           <label class="check"><input type="radio" name="when" value="later"> Zu einem Zeitpunkt:</label>
           <input type="datetime-local" name="sendAt" disabled>
         </div>
         <div data-weekdays hidden>
           <div class="weekday-picker">${days
             .map((d, i) => `<label><input type="checkbox" name="weekday" value="${i + 1}"${i === 0 ? ' checked' : ''}><span>${d}</span></label>`)
             .join('')}</div>
         </div>
         <div data-time hidden>
           <label for="n-time">Uhrzeit <span class="muted">(deutsche Zeit)</span></label>
           <input id="n-time" type="time" name="time" value="08:00">
         </div>
       </fieldset>
       <div class="dialog-actions">
         <button type="button" class="btn-secondary" data-close>Abbrechen</button>
         <button type="submit" class="btn-primary">Speichern</button>
       </div>`,
      async (f) => {
        const schedule = f.schedule.value;
        const body = {
          title: f.title.value,
          body: f.body.value,
          audience: f.audience.value,
          recipientIds: [...f.querySelectorAll('[name=recipient]:checked')].map((x) => Number(x.value)),
          schedule,
        };
        if (schedule === 'once' && f.when.value === 'later') {
          if (!f.sendAt.value) throw new Error('Bitte Datum und Uhrzeit wählen.');
          body.sendAt = new Date(f.sendAt.value).toISOString();
        }
        if (schedule !== 'once') body.time = f.time.value;
        if (schedule === 'weekly') body.weekdays = [...f.querySelectorAll('[name=weekday]:checked')].map((x) => Number(x.value));
        const { notification } = await api('POST', '/api/notifications', body);
        toast(schedule === 'once' && !body.sendAt ? notification.lastResult || 'Gesendet' : 'Push-Nachricht geplant ✓');
        onSaved();
      }
    );
    const f = dialog.querySelector('form');
    const sync = () => {
      const sch = f.schedule.value;
      f.querySelector('[data-once]').hidden = sch !== 'once';
      f.querySelector('[data-weekdays]').hidden = sch !== 'weekly';
      f.querySelector('[data-time]').hidden = sch === 'once';
      f.querySelector('[data-recipients]').hidden = f.audience.value !== 'some';
      f.sendAt.disabled = f.when.value !== 'later';
      f.querySelector('[type=submit]').textContent = sch === 'once' && f.when.value === 'now' ? 'Jetzt senden' : 'Speichern';
    };
    f.addEventListener('change', sync);
    sync();
  }

  /** "To do" tiles above the client list: messages, check-ins (weekend only), swaps, pending plans, inactivity. */
  function coachDashboard(clients, queue, weightAutomation) {
    const byId = new Map(queue.clients.map((q) => [q.id, q]));
    const who = (c) => `${c.avatar ? `<img class="mini-avatar" src="${esc(c.avatar)}" alt="">` : ''}${esc(c.displayName)}`;
    const tile = ({ key, title, items, empty, total, note, cls }) => `
      <section class="card dash-tile ${cls || ''} ${items.length ? 'has-items' : ''}" data-tile="${key}">
        <div class="dash-top"><span class="stat-label">${title}</span><span class="dash-num">${total ?? items.length}</span></div>
        ${note ? `<p class="small muted dash-note">${note}</p>` : ''}
        ${items.length
          ? `<ul class="dash-list">${items.slice(0, 5).map((i) => `<li><a href="${i.href}">${i.label}</a>${i.meta ? `<span class="muted small">${i.meta}</span>` : ''}</li>`).join('')}${items.length > 5 ? `<li class="muted small">+ ${items.length - 5} weitere</li>` : ''}</ul>`
          : `<p class="dash-empty small">${empty}</p>`}
      </section>`;

    const messages = clients.filter((c) => c.unreadMessages).map((c) => ({ href: `#/messages/${c.id}`, label: who(c), meta: `${c.unreadMessages} neu` }));
    const swaps = clients.filter((c) => c.openSwaps).map((c) => ({ href: `#/client/${c.id}/nutrition`, label: who(c), meta: `${c.openSwaps} offen` }));
    const pendingPlans = clients
      .filter((c) => {
        const q = byId.get(c.id);
        return q && q.lastCheckin && q.lastCheckin.status === 'open' && q.lastCheckin.changes.length;
      })
      .map((c) => ({ href: `#/client/${c.id}`, label: who(c), meta: 'nicht angenommen' }));
    const inactive = clients
      .map((c) => ({ c, days: c.lastEntry ? daysBetween(c.lastEntry, todayStr()) : null }))
      .filter(({ days }) => days === null || days >= 2)
      .sort((a, b) => (b.days ?? 999) - (a.days ?? 999))
      .map(({ c, days }) => ({ href: `#/client/${c.id}`, label: who(c), meta: days === null ? 'noch nie' : `${days} Tage` }));
    const openCheckins = queue.isWeekend
      ? clients.filter((c) => byId.get(c.id) && !byId.get(c.id).doneThisWeek).map((c) => ({ href: `#/checkin/${c.id}`, label: who(c) }))
      : [];

    const weightOpen = clients.filter((c) => c.weightToday === null || c.weightToday === undefined).map((c) => ({ href: `#/client/${c.id}`, label: who(c) }));
    const weightDone = clients.length - weightOpen.length;
    const todos = [
      { key: 'messages', title: 'Ungelesene Nachrichten', short: 'Nachrichten', items: messages, total: clients.reduce((a, c) => a + (c.unreadMessages || 0), 0) },
      {
        key: 'weight', title: 'Gewicht heute offen', short: 'Gewicht heute', items: weightOpen,
        note: `${weightDone} von ${clients.length} eingetragen${weightAutomation && weightAutomation.enabled ? ` · Erinnerung um ${esc(weightAutomation.time)} Uhr` : ''}`,
      },
      ...(queue.isWeekend
        ? [{ key: 'checkins', title: 'Offene Check-ins', short: 'Check-ins', items: openCheckins, note: `${clients.length - openCheckins.length} von ${clients.length} erledigt` }]
        : []),
      { key: 'planRequests', title: 'Ernährungsplan angefragt', short: 'Plan-Anfragen', items: clients.filter((c) => c.planRequest).map((c) => ({ href: `#/client/${c.id}/nutrition`, label: who(c), meta: 'wartet auf Plan' })) },
      { key: 'swaps', title: 'Tauschwünsche', short: 'Tauschwünsche', items: swaps, total: clients.reduce((a, c) => a + (c.openSwaps || 0), 0) },
      { key: 'plans', title: 'Plananpassungen offen', short: 'Plananpassungen', items: pendingPlans },
      { key: 'inactive', title: 'Ohne Eintrag seit 2+ Tagen', short: 'Alle tracken', items: inactive },
    ];
    const openTodos = todos.filter((t) => t.items.length);
    const doneTodos = todos.filter((t) => !t.items.length);
    return `
    <section class="todo-section" aria-label="Zu erledigen">
      <div class="row-between todo-head"><h2>Zu erledigen</h2>${openTodos.length ? `<span class="muted small">${openTodos.reduce((a, t) => a + t.items.length, 0)} offen</span>` : ''}</div>
      ${openTodos.length ? `<div class="dash-grid">${openTodos.map((t) => tile(t)).join('')}</div>` : '<div class="card all-done"><strong>Alles erledigt.</strong> <span class="muted">Gerade wartet nichts auf dich.</span></div>'}
      <ul class="done-chips">
        ${doneTodos.map((t) => `<li>✓ ${esc(t.short)}</li>`).join('')}
        ${queue.isWeekend ? '' : '<li class="off">Check-ins ab Samstag</li>'}
      </ul>
    </section>
    <div class="row-between list-head"><h2>Alle Klienten</h2></div>`;
  }

  function showCredentials(name, username, password, after) {
    const text = `Dein Zugang zu StayOnTrack\nAdresse: ${location.origin}\nBenutzername: ${username}\nPasswort: ${password}`;
    dialog.innerHTML = `<form method="dialog">
      <h2>Zugang für ${esc(name)}</h2>
      <p class="muted small">Schick diese Daten an deinen Klienten. Das Passwort wird danach nicht mehr angezeigt.</p>
      <div class="credentials">${esc(text)}</div>
      <div class="dialog-actions">
        <button type="button" class="btn-secondary" data-copy>Kopieren</button>
        <button type="submit" class="btn-primary">Fertig</button>
      </div></form>`;
    dialog.querySelector('[data-copy]').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(text);
        toast('In die Zwischenablage kopiert');
      } catch {
        toast('Kopieren nicht möglich – bitte manuell markieren', true);
      }
    });
    dialog.addEventListener('close', () => after && after(), { once: true });
    if (!dialog.open) dialog.showModal();
  }

  // ---------- coach: client detail ----------
  let goalsPanelOpenFor = null; // keeps the goals panel open while editing (e.g. after changing the category)
  // ---------- training plan (client and coach) ----------
  const fmtKg = (w) => (w === null || w === undefined ? '–' : `${num(w, w % 1 ? 1 : 0)} kg`);
  const fmtSet = (s) => `${s.weight !== null && s.weight !== undefined ? `${num(s.weight, s.weight % 1 ? 1 : 0)} kg` : '–'} × ${s.reps ?? '–'}`;
  const exKey = (name) => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  let tmpSeq = 0;

  // How-to for the standard exercises: steps, muscles and start/end photos (public/exercises, public domain)
  let exerciseInfo = null;
  async function loadExerciseInfo() {
    if (!exerciseInfo) exerciseInfo = await fetch('/exercises/info.json').then((r) => r.json()).catch(() => ({}));
    return exerciseInfo;
  }
  const infoBtn = (name) =>
    exerciseInfo && exerciseInfo[exKey(name)]
      ? `<button type="button" class="info-btn" data-info="${esc(name)}" aria-label="Anleitung: ${esc(name)}" title="Anleitung">i</button>`
      : '';
  function showExerciseInfo(name) {
    const i = exerciseInfo && exerciseInfo[exKey(name)];
    if (!i) return;
    dialog.innerHTML = `<div class="ex-info">
        <div class="row-between ex-info-head"><h2>${esc(i.name)}</h2>
          <button type="button" class="sheet-close ex-close" data-close aria-label="Schließen">✕</button></div>
        <div class="ex-photos">
          <figure><img src="/exercises/${esc(i.img)}-0.jpg" alt="${esc(i.name)}: Startposition" loading="lazy" width="420" height="280"><figcaption>Start</figcaption></figure>
          <figure><img src="/exercises/${esc(i.img)}-1.jpg" alt="${esc(i.name)}: Endposition" loading="lazy" width="420" height="280"><figcaption>Ende</figcaption></figure>
        </div>
        <p class="ex-muscles"><span class="muted small">Zielmuskeln</span><br>${esc(i.muscles)}</p>
        <ol class="ex-steps">${i.steps.map((st) => `<li>${esc(st)}</li>`).join('')}</ol>
        <p class="ex-tip"><strong>Tipp:</strong> ${esc(i.tip)}</p>
      </div>`;
    dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
    dialog.showModal();
  }
  const tmpId = (p) => `${p}${Date.now().toString(36)}${(tmpSeq++).toString(36)}`;

  /**
   * Training plan page. opts: { userId (coach only), base: hash of the page, coach: bool, clientName }.
   * Modes: setup (no plan yet) → edit → overview → workout; the history has its own hash (base + '/history').
   */
  async function mountTraining(root, opts) {
    const query = opts.userId ? `?userId=${opts.userId}` : '';
    let data;
    try {
      data = await api('GET', `/api/training${query}`);
    } catch (err) {
      root.innerHTML = `<div class="card empty-state">${esc(err.message)}</div>`;
      return;
    }
    await loadExerciseInfo();
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-info]');
      if (b) showExerciseInfo(b.dataset.info);
    });
    let mode = data.plan ? 'overview' : 'setup';
    let draft = null; // { split, days } while editing
    let setupDays = data.plan ? data.plan.daysPerWeek : 3;
    let workoutDay = null;
    const you = opts.coach ? esc(opts.clientName || 'dein Klient') : 'du';
    const H = opts.coach ? 'h2 class="page-title-sm"' : 'h1';
    const HC = opts.coach ? 'h2' : 'h1';

    const datalist = `<datalist id="exercise-list">${data.exercises.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>`;
    const setUnsaved = (on) => root.toggleAttribute('data-unsaved', on);

    function draw() {
      setUnsaved(mode === 'edit' || mode === 'workout');
      if (mode === 'setup') return drawSetup();
      if (mode === 'edit') return drawEdit();
      if (mode === 'workout') return drawWorkout();
      return drawOverview();
    }

    // ---- 1. no plan yet: days per week + split ----
    function drawSetup() {
      const splitCard = (s) => {
        const fits = s.days.includes(setupDays);
        const hint = s.key === 'custom' ? 'Frei' : fits ? 'Passt' : `Ideal: ${s.days.join(' oder ')} Tage`;
        return `<button type="button" class="split-card ${fits ? 'fits' : ''} ${s.key === 'custom' ? 'custom' : ''}" data-split="${s.key}">
          <span class="split-top"><span class="split-name">${esc(s.name)}</span><span class="split-fit">${esc(hint)}</span></span>
          <span class="split-desc">${esc(s.desc)}</span></button>`;
      };
      const sorted = [...data.splits.filter((s) => s.key !== 'custom')].sort((a, b) => Number(b.days.includes(setupDays)) - Number(a.days.includes(setupDays)));
      root.innerHTML = `
        <div class="page-head"><div>${eyebrow(opts.coach ? 'Trainingsplan' : 'Neu')}<${H}>${opts.coach ? `Trainingsplan für ${you}` : 'Dein Trainingsplan'}</${HC}>
          <p class="muted">${data.plan ? 'Wähle einen neuen Split – dein bisheriger Plan bleibt, bis du speicherst.' : 'Noch kein Plan. In zwei Schritten zu deinem Standardplan – danach kannst du alles anpassen.'}</p></div>
          ${data.plan ? '<button type="button" class="btn-secondary" data-cancel>Abbrechen</button>' : ''}</div>
        <section class="card setup-step">
          <h2><span class="step-num">1</span> Wie oft pro Woche trainieren?</h2>
          <div class="days-picker" role="radiogroup" aria-label="Trainingstage pro Woche">
            ${[2, 3, 4, 5, 6].map((n) => `<button type="button" role="radio" aria-checked="${n === setupDays}" data-days="${n}"><b>${n}</b><span>Tage</span></button>`).join('')}
          </div>
        </section>
        <section class="setup-step">
          <h2><span class="step-num">2</span> Welcher Split?</h2>
          <p class="muted small">Ein Split mit „Passt“ ist für ${setupDays} Trainingstage gedacht. Du bekommst einen Standardplan mit Übungen, Sätzen und Wiederholungen.</p>
          <div class="split-grid">${sorted.map(splitCard).join('')}${splitCard(data.splits.find((s) => s.key === 'custom'))}</div>
        </section>`;
      root.querySelectorAll('[data-days]').forEach((b) => b.addEventListener('click', () => {
        setupDays = Number(b.dataset.days);
        drawSetup();
      }));
      root.querySelectorAll('[data-split]').forEach((b) => b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          const t = await api('GET', `/api/training/template?split=${b.dataset.split}&days=${setupDays}`);
          draft = { split: b.dataset.split, days: t.days };
          mode = 'edit';
          draw();
          window.scrollTo(0, 0);
        } catch (err) {
          toast(err.message, true);
          b.disabled = false;
        }
      }));
      const cancel = root.querySelector('[data-cancel]');
      if (cancel) cancel.addEventListener('click', () => { mode = 'overview'; draw(); });
    }

    // ---- 2. edit: day names, exercises (+), sets × reps, save at the bottom ----
    function drawEdit() {
      const splitName = (data.splits.find((s) => s.key === draft.split) || {}).name || '';
      root.innerHTML = `
        <div class="page-head"><div>${eyebrow(splitName)}<${H}>Plan bearbeiten</${HC}>
          <p class="muted">Benenne die Tage, passe Übungen an und füge mit + neue hinzu. Gespeichert wird unten.</p></div>
          <button type="button" class="btn-secondary" data-resplit>Split wechseln</button></div>
        ${datalist}
        <div class="tp-days">${draft.days.map((d, i) => `
          <section class="card tp-day" data-day="${i}">
            <div class="tp-day-head">
              <span class="tp-day-num">Tag ${i + 1}</span>
              <input class="tp-day-name" value="${esc(d.name)}" maxlength="40" aria-label="Name von Tag ${i + 1}" data-day-name>
              ${draft.days.length > 1 ? `<button type="button" class="icon-btn" data-remove-day aria-label="Tag ${i + 1} entfernen">✕</button>` : ''}
            </div>
            <div class="tp-ex-head" aria-hidden="true"><span>Übung</span><span>Sätze</span><span>Wdh.</span><span></span></div>
            <ul class="tp-ex-list">${d.exercises.map((e, j) => `
              <li class="tp-ex" data-ex="${j}">
                <input value="${esc(e.name)}" list="exercise-list" maxlength="60" placeholder="Übung" aria-label="Übung" data-f="name">
                <input value="${esc(e.sets)}" inputmode="numeric" maxlength="2" aria-label="Sätze" data-f="sets">
                <input value="${esc(e.reps)}" maxlength="12" placeholder="8–12" aria-label="Wiederholungen" data-f="reps">
                <button type="button" class="icon-btn" data-remove-ex aria-label="${esc(e.name || 'Übung')} entfernen">✕</button>
              </li>`).join('') || '<li class="muted small tp-empty">Noch keine Übungen.</li>'}</ul>
            <button type="button" class="btn-add" data-add-ex><span aria-hidden="true">+</span> Übung hinzufügen</button>
          </section>`).join('')}
        </div>
        ${draft.days.length < 7 ? '<button type="button" class="btn-secondary btn-block tp-add-day" data-add-day>+ Trainingstag hinzufügen</button>' : ''}
        <div class="save-bar">
          ${data.plan ? '<button type="button" class="btn-secondary" data-cancel>Abbrechen</button>' : ''}
          <button type="button" class="btn-primary" data-save>Plan speichern</button>
        </div>`;

      // keep the draft in sync with the inputs (no redraw while typing)
      root.querySelectorAll('[data-day]').forEach((dayEl) => {
        const d = draft.days[Number(dayEl.dataset.day)];
        dayEl.querySelector('[data-day-name]').addEventListener('input', (e) => { d.name = e.target.value; });
        dayEl.querySelectorAll('[data-ex]').forEach((exEl) => {
          const ex = d.exercises[Number(exEl.dataset.ex)];
          exEl.querySelectorAll('[data-f]').forEach((inp) => inp.addEventListener('input', () => { ex[inp.dataset.f] = inp.value; }));
          exEl.querySelector('[data-remove-ex]').addEventListener('click', () => {
            d.exercises.splice(Number(exEl.dataset.ex), 1);
            drawEdit();
          });
        });
        dayEl.querySelector('[data-add-ex]').addEventListener('click', () => {
          d.exercises.push({ id: tmpId('e'), name: '', sets: 3, reps: '8–12', note: '' });
          drawEdit();
          const rows = root.querySelectorAll(`[data-day="${dayEl.dataset.day}"] [data-ex]`);
          rows[rows.length - 1].querySelector('input').focus();
        });
        const rm = dayEl.querySelector('[data-remove-day]');
        if (rm) rm.addEventListener('click', () => {
          if (d.exercises.length && !confirm(`„${d.name}“ mit ${d.exercises.length} Übungen entfernen?`)) return;
          draft.days.splice(Number(dayEl.dataset.day), 1);
          drawEdit();
        });
      });
      const addDay = root.querySelector('[data-add-day]');
      if (addDay) addDay.addEventListener('click', () => {
        draft.days.push({ id: tmpId('d'), name: `Tag ${draft.days.length + 1}`, exercises: [] });
        drawEdit();
      });
      root.querySelector('[data-resplit]').addEventListener('click', () => {
        if (!confirm('Split wechseln? Deine Änderungen hier gehen verloren.')) return;
        mode = 'setup';
        setupDays = draft.days.length;
        draw();
      });
      const cancel = root.querySelector('[data-cancel]');
      if (cancel) cancel.addEventListener('click', () => { mode = 'overview'; draw(); });
      root.querySelector('[data-save]').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const days = draft.days.map((d) => ({ ...d, exercises: d.exercises.filter((x) => x.name.trim()).map((x) => ({ ...x, sets: Number(x.sets) || 3 })) }));
          data = await api('PUT', `/api/training${query}`, { split: draft.split, days });
          draft = null;
          mode = 'overview';
          draw();
          window.scrollTo(0, 0);
          savedHud('Gespeichert', 'Trainingsplan');
        } catch (err) {
          toast(err.message, true);
          btn.disabled = false;
        }
      });
    }

    // ---- 3. overview: all days, last values, start a workout, history at the bottom ----
    function drawOverview() {
      const p = data.plan;
      const last = data.recent[0];
      const editor = p.updatedBy ? (p.updatedBy.role === 'coach' ? (opts.coach ? 'dir' : 'deinem Coach') : opts.coach ? you : 'dir') : '';
      root.innerHTML = `
        <div class="page-head"><div>${eyebrow(`${p.splitName} · ${p.days.length} Tage pro Woche`)}<${H}>${opts.coach ? 'Trainingsplan' : 'Dein Trainingsplan'}</${HC}>
          <p class="muted">${last ? `Letztes Training: <strong>${esc(last.dayName)}</strong> · ${esc(relDay(last.date))}` : 'Noch kein Training gespeichert.'}${editor ? ` · zuletzt geändert von ${editor}` : ''}</p></div>
          <button type="button" class="btn-secondary" data-edit>Plan bearbeiten</button></div>
        <div class="tp-overview">${p.days.map((d, i) => {
          const done = data.recent.find((w) => w.dayId === d.id);
          return `<section class="card tp-day-view">
            <div class="row-between tp-day-view-head">
              <div><span class="tp-day-num">Tag ${i + 1}</span><h2>${esc(d.name)}</h2>
                <p class="muted small">${d.exercises.length} Übungen${done ? ` · zuletzt ${esc(relDay(done.date))}` : ''}</p></div>
              ${d.exercises.length ? `<button type="button" class="btn-primary" data-start="${i}">Training starten</button>` : ''}
            </div>
            <ul class="tp-view-list">${d.exercises.map((e) => {
              const l = data.last[exKey(e.name)];
              const top = l ? l.sets.reduce((b, s) => ((s.weight ?? -1) > (b.weight ?? -1) ? s : b), l.sets[0]) : null;
              return `<li><span class="tp-view-name">${esc(e.name)} ${infoBtn(e.name)}</span><span class="tp-view-target">${esc(e.sets)} × ${esc(e.reps || '–')}</span>
                <span class="tp-view-last">${top ? `<span class="tp-last-label">Zuletzt </span>${fmtSet(top)}` : '<span class="muted">–</span>'}</span></li>`;
            }).join('') || '<li class="muted small">Noch keine Übungen – über „Plan bearbeiten“ hinzufügen.</li>'}</ul>
          </section>`;
        }).join('')}</div>
        <a class="btn btn-secondary btn-block history-link" href="${opts.base}/history">
          <span aria-hidden="true">📈</span> Trainingshistorie</a>`;
      root.querySelector('[data-edit]').addEventListener('click', () => {
        draft = { split: p.split, days: JSON.parse(JSON.stringify(p.days)) };
        mode = 'edit';
        draw();
      });
      root.querySelectorAll('[data-start]').forEach((b) => b.addEventListener('click', () => {
        workoutDay = p.days[Number(b.dataset.start)];
        mode = 'workout';
        draw();
        window.scrollTo(0, 0);
      }));
    }

    // ---- 4. workout: weight + reps per set, prefilled with the last session ----
    function drawWorkout() {
      const d = workoutDay;
      const rows = d.exercises.map((e) => {
        const l = data.last[exKey(e.name)];
        const n = Math.max(Number(e.sets) || 1, l ? l.sets.length : 0);
        return { name: e.name, target: `${e.sets} × ${e.reps || '–'}`, last: l, sets: Array.from({ length: n }, (_, i) => (l && l.sets[i] ? { ...l.sets[i] } : { weight: null, reps: null })) };
      });
      const val = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','));
      function paint() {
        root.innerHTML = `
          <button type="button" class="back" data-back>← Trainingsplan</button>
          <div class="page-head"><div>${eyebrow('Training')}<${H}>${esc(d.name)}</${HC}>
            <p class="muted">${rows.some((r) => r.last) ? 'Die Werte vom letzten Mal sind schon eingetragen – passe an, was du heute geschafft hast.' : 'Trag pro Satz Gewicht und Wiederholungen ein. Beim nächsten Mal stehen diese Werte schon hier.'}</p></div>
            <div class="field wo-date"><label for="wo-date">Datum</label><input type="date" id="wo-date" value="${todayStr()}" max="${todayStr()}"></div></div>
          <div class="wo-list">${rows.map((r, i) => `
            <section class="card wo-ex" data-r="${i}">
              <div class="row-between wo-head"><h2>${esc(r.name)} ${infoBtn(r.name)}</h2><span class="badge">Ziel ${esc(r.target)}</span></div>
              <p class="small muted wo-last">${r.last ? `Letztes Mal (${esc(fmtDate(r.last.date, { day: 'numeric', month: 'short' }))}): ${r.last.sets.map(fmtSet).join(' · ')}` : 'Erstes Mal – trag dein Startgewicht ein.'}</p>
              <div class="wo-sets">
                <div class="wo-set wo-set-head" aria-hidden="true"><span>Satz</span><span>Gewicht</span><span>Wdh.</span></div>
                ${r.sets.map((s, j) => `<div class="wo-set" data-s="${j}"><span class="wo-num">${j + 1}</span>
                  <div class="input-unit"><input inputmode="decimal" value="${val(s.weight)}" aria-label="${esc(r.name)} Satz ${j + 1} Gewicht" data-f="weight"><span>kg</span></div>
                  <div class="input-unit"><input inputmode="numeric" value="${val(s.reps)}" aria-label="${esc(r.name)} Satz ${j + 1} Wiederholungen" data-f="reps"><span>Wdh.</span></div></div>`).join('')}
              </div>
              <button type="button" class="btn-add" data-add-set><span aria-hidden="true">+</span> Satz</button>
            </section>`).join('')}</div>
          <div class="save-bar">
            <button type="button" class="btn-secondary" data-back>Abbrechen</button>
            <button type="button" class="btn-primary" data-save>Training speichern</button>
          </div>`;
        root.querySelectorAll('[data-r]').forEach((el) => {
          const r = rows[Number(el.dataset.r)];
          el.querySelectorAll('[data-s]').forEach((sEl) => sEl.querySelectorAll('[data-f]').forEach((inp) => inp.addEventListener('input', () => {
            r.sets[Number(sEl.dataset.s)][inp.dataset.f] = inp.value;
          })));
          el.querySelector('[data-add-set]').addEventListener('click', () => {
            const prev = r.sets[r.sets.length - 1] || { weight: null, reps: null };
            r.sets.push({ ...prev });
            paint();
          });
        });
        root.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => { mode = 'overview'; draw(); }));
        root.querySelector('[data-save]').addEventListener('click', async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          try {
            const clean = (v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim().replace(',', '.'));
            data = await api('POST', `/api/training/workouts${query}`, {
              date: document.getElementById('wo-date').value,
              dayId: d.id,
              dayName: d.name,
              exercises: rows.map((r) => ({ name: r.name, sets: r.sets.map((s) => ({ weight: clean(s.weight), reps: clean(s.reps) })) })),
            });
            mode = 'overview';
            draw();
            window.scrollTo(0, 0);
            savedHud('Training gespeichert', d.name);
          } catch (err) {
            toast(err.message, true);
            btn.disabled = false;
          }
        });
      }
      paint();
    }

    draw();
  }

  /** Per exercise: development of the heaviest set per session. */
  async function mountTrainingHistory(root, opts) {
    const query = opts.userId ? `?userId=${opts.userId}` : '';
    let exercises;
    await loadExerciseInfo();
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-info]');
      if (b) showExerciseInfo(b.dataset.info);
    });
    try {
      ({ exercises } = await api('GET', `/api/training/history${query}`));
    } catch (err) {
      root.innerHTML = `<div class="card empty-state">${esc(err.message)}</div>`;
      return;
    }
    root.innerHTML = `
      <a class="back" href="${opts.base}">← Trainingsplan</a>
      <div class="page-head"><div>${eyebrow('Training')}${opts.coach ? '<h2 class="page-title-sm">Trainingshistorie</h2>' : '<h1>Trainingshistorie</h1>'}
        <p class="muted">Schwerster Satz pro Training – so siehst du, wie sich deine Gewichte entwickeln.</p></div></div>
      ${exercises.length ? `<div class="hist-grid">${exercises.map((e, i) => {
        const first = e.sessions[0];
        const lastS = e.sessions[e.sessions.length - 1];
        const diff = first.topWeight !== null && lastS.topWeight !== null && e.sessions.length > 1 ? lastS.topWeight - first.topWeight : null;
        return `<section class="card hist-card">
          <div class="row-between hist-head"><h2>${esc(e.name)} ${infoBtn(e.name)}</h2>
            ${diff !== null ? `<span class="badge ${diff > 0 ? 'good' : ''}">${diff > 0 ? '+' : ''}${num(diff, diff % 1 ? 1 : 0)} kg</span>` : ''}</div>
          <div class="hist-stats">
            <div><span class="metric-value">${esc(fmtKg(lastS.topWeight))}</span><span class="muted small">zuletzt · ${esc(fmtDate(lastS.date, { day: 'numeric', month: 'short' }))}</span></div>
            <div><span class="metric-value">${esc(fmtKg(e.best))}</span><span class="muted small">Bestwert</span></div>
            <div><span class="metric-value">${e.sessions.length}</span><span class="muted small">${e.sessions.length === 1 ? 'Training' : 'Trainings'}</span></div>
          </div>
          <div class="chart-hist" data-hist="${i}"></div>
        </section>`;
      }).join('')}</div>` : `<div class="card empty-state">Noch keine Trainings gespeichert. Starte im Trainingsplan ein Training – danach siehst du hier für jede Übung deinen Verlauf.</div>`}`;
    const renderCharts = () => root.querySelectorAll('[data-hist]').forEach((el) => {
      const e = exercises[Number(el.dataset.hist)];
      const from = e.sessions[0].date;
      const to = e.sessions[e.sessions.length - 1].date;
      Charts.render(el, {
        data: e.sessions.map((s) => ({ date: s.date, value: s.topWeight })),
        from: from === to ? addDays(from, -3) : from,
        to: from === to ? addDays(to, 3) : to,
        type: 'line', unit: 'kg', decimals: 1, height: 170, label: `${e.name}: Gewichtsverlauf`,
      });
    });
    renderCharts();
    let t;
    const onResize = () => { clearTimeout(t); t = setTimeout(renderCharts, 150); };
    window.addEventListener('resize', onResize);
    onCleanup(() => window.removeEventListener('resize', onResize));
  }

  async function renderClientTraining(history) {
    setView(`<div id="training">${LOADING}</div>`);
    const root = document.getElementById('training');
    if (history) return mountTrainingHistory(root, { base: '#/training' });
    return mountTraining(root, { base: '#/training' });
  }

  // ---------- Hall of Fame (client; coach sees it per client) ----------
  const TIER_NAMES = { bronze: 'Bronze', silver: 'Silber', gold: 'Gold' };
  /** Icon artwork on a 24×24 grid; parts with class "a" carry the icon's own animation. */
  const FAME_ICONS = {
    flame: '<g class="a"><path d="M12 3c.6 3-1.7 4.6-3 6.6-1.4 2-1.6 4.6-.2 6.6A5 5 0 0 0 17 14c.2-2-.6-3.6-1.6-4.8.1 1.5-.5 2.7-1.6 3.2.6-3.5-.4-7-1.8-9.4z"/></g>',
    steps: '<g class="a a1"><ellipse cx="8.5" cy="9" rx="2.3" ry="3.6"/><circle cx="8.3" cy="14.3" r="1.5"/></g><g class="a a2"><ellipse cx="15.5" cy="12" rx="2.3" ry="3.6"/><circle cx="15.7" cy="17.3" r="1.5"/></g>',
    target: '<circle cx="12" cy="12" r="7.5" fill="none" stroke-width="1.8"/><circle class="a" cx="12" cy="12" r="4" fill="none" stroke-width="1.8"/><circle cx="12" cy="12" r="1.6"/>',
    moon: '<g class="a"><path d="M15.5 4.5A7.5 7.5 0 1 0 19.5 16 6 6 0 0 1 15.5 4.5z"/></g><path class="a2" d="M18 5.5l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z"/>',
    scale: '<rect x="4.5" y="5" width="15" height="14" rx="3" fill="none" stroke-width="1.8"/><path d="M8 10a4 4 0 0 1 8 0z" fill="none" stroke-width="1.6"/><path class="a" d="M12 10l1.6-2.6" fill="none" stroke-width="1.6" stroke-linecap="round"/>',
    apple: '<g class="a"><path d="M12 8c-1.6-1.2-5-1.2-6 1.8-1 3 .6 7 2.6 8.6 1.2 1 2.2.6 3.4.1 1.2.5 2.2.9 3.4-.1 2-1.6 3.6-5.6 2.6-8.6-1-3-4.4-3-6-1.8z"/><path d="M12 8c0-2 1-3.4 2.6-4" fill="none" stroke-width="1.5" stroke-linecap="round"/></g>',
    dumbbell: '<g class="a"><rect x="3" y="9" width="3" height="6" rx="1"/><rect x="6" y="7.5" width="2.6" height="9" rx="1"/><rect x="18" y="9" width="3" height="6" rx="1"/><rect x="15.4" y="7.5" width="2.6" height="9" rx="1"/><rect x="8.6" y="11" width="6.8" height="2"/></g>',
    plate: '<g class="a"><circle cx="12" cy="12" r="8" fill="none" stroke-width="2.4"/><circle cx="12" cy="12" r="4.4" fill="none" stroke-width="1.2" stroke-dasharray="2 1.6"/><circle cx="12" cy="12" r="1.6"/></g>',
    trophy: '<g class="a"><path d="M8 4.5h8v4a4 4 0 0 1-8 0z"/><path d="M8 6H5.5a2.5 2.5 0 0 0 2.6 3M16 6h2.5a2.5 2.5 0 0 1-2.6 3" fill="none" stroke-width="1.5"/><path d="M11 12.5h2v3h-2zM8.5 16h7v2.5h-7z"/></g>',
    check: '<rect x="5.5" y="4.5" width="13" height="16" rx="2" fill="none" stroke-width="1.7"/><path d="M9.5 3.5h5v2.5h-5z"/><path class="a" d="M8.8 13l2.3 2.3 4.4-4.6" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  };
  const FAME_DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
    <linearGradient id="hof-bronze" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f0b27a"/><stop offset=".5" stop-color="#c47a3a"/><stop offset="1" stop-color="#8a4f1f"/></linearGradient>
    <linearGradient id="hof-silver" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#c3ccd3"/><stop offset="1" stop-color="#8794a0"/></linearGradient>
    <linearGradient id="hof-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1a8"/><stop offset=".45" stop-color="#f2c230"/><stop offset="1" stop-color="#b8860b"/></linearGradient>
    <clipPath id="hof-clip"><circle cx="32" cy="32" r="27"/></clipPath></defs></svg>`;

  function medalSvg(icon, tier, earned, progress) {
    const C = 2 * Math.PI * 30;
    return `<svg class="medal-svg" viewBox="0 0 64 64" aria-hidden="true">
      ${earned ? '' : `<circle class="medal-track" cx="32" cy="32" r="30"/><circle class="medal-prog" cx="32" cy="32" r="30" stroke-dasharray="${((C * progress) / 100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 32 32)"/>`}
      <circle class="medal-face" cx="32" cy="32" r="27" ${earned ? `fill="url(#hof-${tier})"` : ''}/>
      <circle class="medal-rim" cx="32" cy="32" r="22.5"/>
      ${earned ? '<g clip-path="url(#hof-clip)"><rect class="medal-shine" x="-30" y="-10" width="14" height="90" transform="rotate(25 32 32)"/></g>' : ''}
      <g class="medal-icon ic-${icon}" transform="translate(18 18) scale(1.1667)">${FAME_ICONS[icon] || ''}</g>
    </svg>`;
  }

  /** Small earned medal for showcases (profile, Head2Head). Needs FAME_DEFS on the page. */
  const miniMedal = (m, size = '') => `<span class="mini-medal ${size} tier-${m.level}" title="${esc(m.title)} – ${esc(TIER_NAMES[m.level])}" role="img" aria-label="${esc(m.title)} ${esc(TIER_NAMES[m.level])}">${medalSvg(m.icon, m.level, true, 100)}</span>`;
  const showcaseRow = (list, size) => (list && list.length ? `<span class="showcase-row">${list.map((m) => miniMedal(m, size)).join('')}</span>` : '');

  async function mountMedals(root, opts) {
    const query = opts.userId ? `?userId=${opts.userId}` : '';
    let data;
    try {
      data = await api('GET', `/api/achievements${query}`);
    } catch (err) {
      root.innerHTML = `<div class="card empty-state">${esc(err.message)}</div>`;
      return;
    }
    const fmtVal = (a, v) => (a.key === 'volume' ? `${num(v / 1000, v >= 10000 ? 0 : 1)} t` : num(v));
    const fmtGoal = (a, g) => (a.key === 'volume' ? `${num(g / 1000)} t` : num(g));

    // newly earned since this person last looked (only the client's own view celebrates)
    const seenKey = `hof-seen-${me.id}`;
    let seen = null;
    if (!opts.coach) {
      try { seen = JSON.parse(localStorage.getItem(seenKey) || 'null'); } catch { seen = null; }
    }
    const earnedIds = data.achievements.flatMap((a) => a.tiers.filter((t) => t.achievedAt).map((t) => `${a.key}:${t.level}`));
    const fresh = seen ? earnedIds.filter((x) => !seen.includes(x)) : [];
    if (!opts.coach) {
      try { localStorage.setItem(seenKey, JSON.stringify(earnedIds)); } catch { /* private mode */ }
    }

    const selected = {};
    const own = !opts.coach && !opts.userId && me.role === 'client';
    let pins = (data.showcase || []).map((m) => m.id);
    const maxPins = data.showcaseMax || 3;
    const medalById = (id) => {
      const [key, level] = id.split(':');
      const a = data.achievements.find((x) => x.key === key);
      return a ? { id, key, level, icon: a.icon, title: a.title } : null;
    };
    function vitrine() {
      const slots = Array.from({ length: maxPins }, (_, i) => pins[i] && medalById(pins[i]));
      return `<section class="card vitrine" aria-label="Deine Vitrine">
        <div class="row-between"><div><h2>Deine Vitrine</h2>
          <p class="muted small">${own ? `Bis zu ${maxPins} Medaillen für dein Profil – deine Head2Head-Gegner sehen sie.` : 'Diese Medaillen zeigt der Klient in seinem Profil.'}</p></div></div>
        <div class="vitrine-slots">${slots.map((m, i) => (m
          ? `<div class="vitrine-slot filled">${miniMedal(m, 'lg')}<span class="vs-title">${esc(m.title)}</span><span class="muted small">${esc(TIER_NAMES[m.level])}</span>
              ${own ? `<button type="button" class="icon-btn vs-remove" data-unpin="${esc(m.id)}" aria-label="${esc(m.title)} aus der Vitrine nehmen">✕</button>` : ''}</div>`
          : `<div class="vitrine-slot empty"><span class="vs-plus" aria-hidden="true">+</span><span class="muted small">${own ? (i === pins.length ? 'Tipp unten eine erreichte Medaille an' : 'Frei') : 'Leer'}</span></div>`)).join('')}</div>
      </section>`;
    }
    async function savePins(next) {
      try {
        const r = await api('PUT', '/api/me/showcase', { medals: next });
        pins = r.showcase.map((m) => m.id);
        root.querySelector('.vitrine').outerHTML = vitrine();
        bindVitrine();
        root.querySelectorAll('[data-fame]').forEach((el) => refreshCard(el));
      } catch (err) {
        toast(err.message, true);
      }
    }
    function bindVitrine() {
      root.querySelectorAll('[data-unpin]').forEach((b) => b.addEventListener('click', () => savePins(pins.filter((x) => x !== b.dataset.unpin))));
    }
    const nextTier = (a) => a.tiers.find((t) => !t.achievedAt);
    const s = data.summary;
    const upcoming = data.achievements
      .map((a) => ({ a, t: nextTier(a) }))
      .filter((x) => x.t && x.t.progress > 0)
      .sort((x, y) => y.t.progress - x.t.progress)
      .slice(0, 3);

    function detail(a) {
      const t = a.tiers.find((x) => x.level === selected[a.key]) || nextTier(a) || a.tiers[2];
      selected[a.key] = t.level;
      const status = t.achievedAt
        ? `<span class="fame-done">✓ Erreicht am ${esc(fmtDate(t.achievedAt, { day: 'numeric', month: 'long', year: 'numeric' }))}</span>`
        : `<span>${esc(fmtVal(a, Math.min(a.current, t.goal)))} von ${esc(fmtGoal(a, t.goal))} ${esc(a.unit)}</span><span class="fame-pct">${t.progress} %</span>`;
      const id = `${a.key}:${t.level}`;
      const pinned = pins.includes(id);
      const pinBtn = own && t.achievedAt
        ? `<button type="button" class="btn-ghost btn-sm pin-btn ${pinned ? 'on' : ''}" data-pin="${esc(id)}" ${!pinned && pins.length >= maxPins ? 'disabled title="Vitrine ist voll – nimm erst eine Medaille heraus"' : ''}>${pinned ? '★ In der Vitrine' : '☆ In die Vitrine'}</button>`
        : '';
      return `<p class="fame-goal"><span class="fame-tier-name tier-${t.level}">${TIER_NAMES[t.level]}</span> ${esc(t.text)}</p>
        <div class="fame-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${t.achievedAt ? 100 : t.progress}" aria-label="${esc(a.title)} ${TIER_NAMES[t.level]}"><span style="width:${t.achievedAt ? 100 : t.progress}%" class="tier-${t.level}"></span></div>
        <p class="fame-status small">${status}${pinBtn}</p>`;
    }

    function card(a) {
      const all = a.tiers.every((t) => t.achievedAt);
      const extra = a.key === 'streak' && a.running ? `<span class="muted small">Gerade ${a.running} ${a.running === 1 ? 'Tag' : 'Tage'} in Folge</span>`
        : `<span class="muted small">${esc(fmtVal(a, a.current))} ${esc(a.unit)}${a.key === 'streak' ? ' (Rekord)' : ''}</span>`;
      return `<section class="card fame-card ${all ? 'complete' : ''}" data-fame="${a.key}">
        <div class="fame-head"><div><h2>${esc(a.title)}</h2>${extra}</div>${all ? '<span class="badge good">Alle Stufen 🎉</span>' : ''}</div>
        <div class="fame-medals" role="group" aria-label="${esc(a.title)}: Stufen">
          ${a.tiers.map((t) => {
            const isNew = fresh.includes(`${a.key}:${t.level}`);
            const label = `${TIER_NAMES[t.level]}: ${t.text} – ${t.achievedAt ? 'erreicht' : `${t.progress} % geschafft`}`;
            return `<button type="button" class="medal ${t.achievedAt ? 'earned' : 'locked'} ${isNew ? 'new' : ''} ${pins.includes(`${a.key}:${t.level}`) ? 'pinned' : ''} tier-${t.level}" data-tier="${t.level}" aria-pressed="false" aria-label="${esc(label)}">
              ${medalSvg(a.icon, t.level, Boolean(t.achievedAt), t.progress)}
              <span class="medal-cap"><b>${TIER_NAMES[t.level]}</b><span>${t.achievedAt ? '✓' : `${t.progress} %`}</span></span>
            </button>`;
          }).join('')}
        </div>
        <div class="fame-detail" aria-live="polite">${detail(a)}</div>
      </section>`;
    }

    const freshNames = fresh.map((id) => {
      const [k, lvl] = id.split(':');
      return `${(data.achievements.find((a) => a.key === k) || {}).title} ${TIER_NAMES[lvl]}`;
    });
    root.innerHTML = `${FAME_DEFS}
      ${hofHeader(opts, 'medals', opts.coach ? `Was ${esc(opts.clientName || 'dein Klient')} schon geschafft hat – und was als Nächstes kommt.` : 'Jede Medaille steht für etwas, das du durchgezogen hast. Ausgegraute zeigen, was als Nächstes kommt.')}
      ${own || pins.length ? vitrine() : ''}
      ${freshNames.length ? `<div class="fame-new-banner" role="status">🎉 <strong>Neu freigeschaltet:</strong> ${esc(freshNames.slice(0, 3).join(', '))}${freshNames.length > 3 ? ` und ${freshNames.length - 3} weitere` : ''}</div>` : ''}
      <section class="card fame-summary">
        <div class="fame-count"><span class="fame-big">${s.earned}</span><span class="muted">von ${s.total} Medaillen</span><span class="fame-tokens"><i class="coin" aria-hidden="true"></i> ${s.tokens} Token verdient</span></div>
        <div class="fame-bar fame-bar-total" aria-hidden="true"><span style="width:${Math.round((s.earned / s.total) * 100)}%"></span></div>
        <ul class="fame-tally">
          ${['gold', 'silver', 'bronze'].map((l) => `<li><span class="tally-dot tier-${l}"></span>${s[l]} ${TIER_NAMES[l]} <span class="muted small">(je ${{ gold: 3, silver: 2, bronze: 1 }[l]} Token)</span></li>`).join('')}
          ${s.h2hWins ? `<li><span aria-hidden="true">⚔️</span> ${s.h2hWins} Head2Head-${s.h2hWins === 1 ? 'Sieg' : 'Siege'} <span class="muted small">(je 1 Token)</span></li>` : ''}
        </ul>
        ${upcoming.length ? `<div class="fame-next"><h3>Fast geschafft</h3><ul>${upcoming.map(({ a, t }) => `
          <li><span class="tally-dot tier-${t.level}"></span><span class="fn-text"><b>${esc(a.title)} ${TIER_NAMES[t.level]}</b> · noch ${esc(fmtGoal(a, t.goal - a.current))} ${esc(a.unit)}</span><span class="fame-pct">${t.progress} %</span></li>`).join('')}</ul></div>` : ''}
      </section>
      <div class="fame-grid">${data.achievements.map(card).join('')}</div>`;

    function bindPin(el) {
      const b = el.querySelector('[data-pin]');
      if (b) b.addEventListener('click', () => {
        const id = b.dataset.pin;
        savePins(pins.includes(id) ? pins.filter((x) => x !== id) : [...pins, id]);
      });
    }
    function refreshCard(el) {
      const a = data.achievements.find((x) => x.key === el.dataset.fame);
      el.querySelector('.fame-detail').innerHTML = detail(a);
      el.querySelectorAll('.medal').forEach((m) => m.classList.toggle('pinned', pins.includes(`${a.key}:${m.dataset.tier}`)));
      bindPin(el);
    }
    root.querySelectorAll('[data-fame]').forEach((el) => {
      const a = data.achievements.find((x) => x.key === el.dataset.fame);
      const sync = () => el.querySelectorAll('.medal').forEach((m) => m.setAttribute('aria-pressed', String(m.dataset.tier === selected[a.key])));
      sync();
      bindPin(el);
      el.querySelectorAll('.medal').forEach((m) => m.addEventListener('click', () => {
        selected[a.key] = m.dataset.tier;
        el.querySelector('.fame-detail').innerHTML = detail(a);
        bindPin(el);
        sync();
      }));
    });
    bindVitrine();
  }

  /** opts: { base (hash), sub: 'medals' | 'fridge' | 'shop', coach, userId, clientName } */
  function mountHallOfFame(root, opts) {
    if (opts.coachTest) return opts.sub === 'shop' ? mountShop(root, opts) : mountFridge(root, opts);
    if (opts.sub === 'fridge') return mountFridge(root, opts);
    if (opts.sub === 'shop' && !opts.coach) return mountShop(root, opts);
    return mountMedals(root, opts);
  }

  // ---------- appearance & language (per person, cached for the next start) ----------
  const PREFS_KEY = 'sot-prefs';
  function applyPrefs(p) {
    if (!p) return;
    const root = document.documentElement;
    if (p.theme === 'light' || p.theme === 'dark') root.dataset.theme = p.theme;
    else delete root.dataset.theme;
    root.classList.toggle('glass', Boolean(p.glass));
    const dark = p.theme === 'dark' || (p.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#002941' : '#ffffff'));
    if (window.I18N) I18N.setLang(p.lang || 'de');
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* private mode */ }
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => me && applyPrefs(me.prefs));

  const LANG_OPTIONS = [['de', 'Deutsch'], ['en', 'English'], ['es', 'Español'], ['it', 'Italiano']];
  function mountPrefsCard(root) {
    const p = me.prefs || { lang: 'de', theme: 'system', glass: false };
    root.innerHTML = `
      <h2 style="margin-bottom:6px">Darstellung</h2>
      <p class="muted small" style="margin-top:0">Gilt für dein Konto auf allen Geräten.</p>
      <div class="pref-row">
        <span class="pref-label" id="pref-lang-l">Sprache</span>
        <div class="pref-choices" role="radiogroup" aria-labelledby="pref-lang-l">
          ${LANG_OPTIONS.map(([k, l]) => `<button type="button" role="radio" lang="${k}" aria-checked="${p.lang === k}" data-pref="lang" data-val="${k}" data-no-i18n>${l}</button>`).join('')}
        </div>
      </div>
      <div class="pref-row">
        <span class="pref-label" id="pref-theme-l">Erscheinungsbild</span>
        <div class="pref-choices" role="radiogroup" aria-labelledby="pref-theme-l">
          ${[['system', 'System'], ['light', 'Hell'], ['dark', 'Dunkel']].map(([k, l]) => `<button type="button" role="radio" aria-checked="${p.theme === k}" data-pref="theme" data-val="${k}">${l}</button>`).join('')}
        </div>
      </div>
      <div class="pref-row pref-glass">
        <div><span class="pref-label">Liquid Glass</span>
          <p class="muted small">Gläserne, durchscheinende Leisten und Menüs – angelehnt an das aktuelle iOS-Design.</p></div>
        <label class="switch"><input type="checkbox" data-pref="glass" ${p.glass ? 'checked' : ''}><span></span><b>${p.glass ? 'An' : 'Aus'}</b></label>
      </div>
      ${me.role === 'client' ? `<div class="pref-row pref-glass">
        <div><span class="pref-label">Berichte per E-Mail</span>
          <p class="muted small">Wochen-Check-in und Ernährungsplan als PDF an deine bestätigte E-Mail-Adresse.${me.email ? '' : ' Hinterlege dafür unter Konto deine E-Mail-Adresse.'}</p></div>
        <label class="switch"><input type="checkbox" data-pref="mailReports" ${p.mailReports !== false ? 'checked' : ''}><span></span><b>${p.mailReports !== false ? 'An' : 'Aus'}</b></label>
      </div>` : ''}`;
    async function save(patch) {
      const prev = me.prefs;
      me.prefs = { ...prev, ...patch };
      applyPrefs(me.prefs);
      if (patch.lang) route(); // dates and numbers follow the language too
      else mountPrefsCard(root);
      try {
        const r = await api('PATCH', '/api/me/prefs', patch);
        me.prefs = r.prefs;
      } catch (err) {
        me.prefs = prev;
        applyPrefs(prev);
        mountPrefsCard(root);
        toast(err.message, true);
      }
    }
    root.querySelectorAll('button[data-pref]').forEach((b) => b.addEventListener('click', () => save({ [b.dataset.pref]: b.dataset.val })));
    root.querySelector('input[data-pref="glass"]').addEventListener('change', (e) => save({ glass: e.target.checked }));
    const mr = root.querySelector('input[data-pref="mailReports"]');
    if (mr) mr.addEventListener('change', (e) => save({ mailReports: e.target.checked }));
  }

  // ---------- Hall of Fame: sub menu, fridge (3D glide into a pixel-art fridge) and medal shop ----------
  function hofHeader(opts, sub, text) {
    const link = (key, href, label) => `<a href="${href}"${sub === key ? ' aria-current="page"' : ''}>${label}</a>`;
    if (opts.coachTest) {
      return `<div class="hof-head">
        <div>${eyebrow('Nur für dich als Coach')}<h2 class="page-title-sm">Test-Kühlschrank</h2>
          <p class="muted">Alles gratis – zum Ausprobieren von Kühlschrank, Seltenheiten und Kaufanimationen. Deine Klienten sehen davon nichts.</p></div>
        <nav class="hof-nav" aria-label="Test-Kühlschrank">${link('fridge', `${opts.base}/fridge`, 'Kühlschrank')}${link('shop', `${opts.base}/shop`, 'Shop')}</nav>
      </div>`;
    }
    return `<div class="hof-head">
        <div>${eyebrow(opts.coach ? 'Erfolge' : 'Deine Erfolge')}<h2 class="page-title-sm">Hall of Fame</h2>
          <p class="muted">${text}</p></div>
        <nav class="hof-nav" aria-label="Hall of Fame">
          ${link('medals', opts.base, 'Medaillen')}${link('fridge', `${opts.base}/fridge`, 'Kühlschrank')}${opts.coach ? '' : link('shop', `${opts.base}/shop`, 'Shop')}
        </nav>
      </div>`;
  }

  /** Pixel rectangles → crisp SVG. rects: [x, y, w, h, color] on a w×h grid. */
  const pixelSvg = (w, h, rects, cls = '') =>
    `<svg class="pixel ${cls}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" aria-hidden="true">${rects
      .map(([x, y, rw, rh, c]) => `<rect x="${x}" y="${y}" width="${rw}" height="${rh}" fill="${c}"/>`)
      .join('')}</svg>`;

  /** Fast-food cup with lid and straw, 10×18 (generic red/yellow design, no brand logo). */
  function cupSvg(f, cls = '') {
    const [red, shade, yellow, white] = f.colors;
    return pixelSvg(10, 18, [
      [6, 0, 1, 1, white], [6, 1, 1, 1, red], [6, 2, 1, 1, white], [6, 3, 1, 1, red], // striped straw
      [1, 3, 8, 1, '#e9edf0'], [0, 4, 10, 1, '#f7f9fa'], [0, 4, 1, 1, '#c9d1d7'], [9, 4, 1, 1, '#c9d1d7'], // lid
      [0, 5, 10, 3, red], [1, 8, 8, 3, yellow], [1, 11, 8, 3, red], [2, 14, 6, 3, red], [3, 17, 4, 1, shade],
      [0, 8, 1, 3, red], [9, 8, 1, 3, red], // band sits inside the tapering cup
      [1, 9, 8, 1, white], // thin white line through the yellow band
      [8, 5, 2, 3, shade], [8, 11, 1, 3, shade], [7, 14, 1, 3, shade], [1, 5, 1, 3, 'rgba(255,255,255,0.4)'], [2, 11, 1, 6, 'rgba(255,255,255,0.3)'],
    ], `can cup ${cls}`);
  }

  /** Small glass vial with crimp cap and amber oil, 10×18. */
  function vialSvg(f, cls = '') {
    const [oil, oilDark, label, stripe] = f.colors;
    return pixelSvg(10, 18, [
      [3, 0, 4, 3, '#9aa6ae'], [3, 0, 4, 1, '#c8d0d5'], [3, 3, 4, 1, '#6f7b83'], // crimp cap
      [4, 4, 2, 2, 'rgba(210,232,240,0.85)'], // neck
      [2, 6, 6, 1, 'rgba(210,232,240,0.85)'], [2, 7, 6, 10, 'rgba(210,232,240,0.6)'], [3, 17, 4, 1, '#8aa1ad'], // glass
      [1, 7, 1, 10, '#8aa1ad'], [8, 7, 1, 10, '#8aa1ad'], [1, 6, 1, 1, '#8aa1ad'], [8, 6, 1, 1, '#8aa1ad'], [3, 4, 1, 2, '#8aa1ad'], [6, 4, 1, 2, '#8aa1ad'], // outline
      [2, 9, 6, 8, oil], [6, 9, 2, 8, oilDark], [2, 9, 6, 1, '#f1c867'], // oil with meniscus
      [2, 11, 6, 3, label], [3, 12, 3, 1, stripe], [6, 11, 2, 3, 'rgba(0,0,0,0.1)'], // label
      [2, 7, 1, 9, 'rgba(255,255,255,0.75)'], [7, 7, 1, 10, 'rgba(120,150,165,0.45)'],
    ], `can vial ${cls}`);
  }

  /** Supplement tub with screw lid and label, 10×18. */
  function tubSvg(f, cls = '') {
    const [body, shade, band, accent] = f.colors;
    return pixelSvg(10, 18, [
      [1, 3, 8, 1, shade], [0, 4, 10, 2, shade], [1, 3, 8, 1, 'rgba(255,255,255,0.3)'], [0, 5, 10, 1, 'rgba(0,0,0,0.18)'], // lid
      [0, 6, 10, 11, body], [8, 6, 2, 11, 'rgba(0,0,0,0.18)'], [1, 6, 1, 10, 'rgba(255,255,255,0.35)'], // body
      [0, 9, 10, 5, band], [8, 9, 2, 5, 'rgba(0,0,0,0.12)'], [2, 10, 5, 1, accent], [2, 12, 3, 1, accent], [6, 12, 1, 1, accent], // label
      [1, 17, 8, 1, shade],
    ], `can tub ${cls}`);
  }

  /** Protein shaker: flip cap, see-through cup with the shake inside, 10×18. */
  function shakerSvg(f, cls = '') {
    const [frame, shade, liquid, accent] = f.colors;
    return pixelSvg(10, 18, [
      [4, 0, 2, 1, accent], [3, 1, 4, 1, frame], [2, 2, 6, 2, frame], [1, 4, 8, 1, shade], // cap
      [1, 5, 8, 12, 'rgba(222,236,243,0.55)'], [0, 5, 1, 12, frame], [9, 5, 1, 12, frame], [1, 17, 8, 1, frame], // cup
      [1, 9, 8, 8, liquid], [1, 9, 8, 1, 'rgba(255,255,255,0.55)'], [6, 10, 2, 7, 'rgba(0,0,0,0.12)'], // shake
      [7, 6, 2, 1, shade], [7, 8, 2, 1, shade], [7, 12, 2, 1, shade], [7, 15, 2, 1, shade], // scale
      [2, 12, 3, 1, accent], [2, 6, 1, 10, 'rgba(255,255,255,0.6)'],
    ], `can shaker ${cls}`);
  }

  /** Protein bar standing up: crimped wrapper with a window, 10×18. */
  function barSvg(f, cls = '') {
    const [wrap, shade, choc, accent] = f.colors;
    return pixelSvg(10, 18, [
      [2, 0, 1, 1, shade], [4, 0, 1, 1, shade], [6, 0, 1, 1, shade], [2, 1, 6, 1, shade], // top crimp
      [2, 2, 6, 14, wrap], [6, 2, 2, 14, 'rgba(0,0,0,0.2)'], [2, 2, 1, 14, 'rgba(255,255,255,0.22)'],
      [3, 4, 3, 7, choc], [3, 4, 3, 1, 'rgba(255,255,255,0.35)'], [4, 6, 1, 1, 'rgba(0,0,0,0.25)'], [4, 9, 1, 1, 'rgba(0,0,0,0.25)'], // window
      [2, 12, 6, 1, accent], [3, 14, 3, 1, accent],
      [2, 16, 6, 1, shade], [3, 17, 1, 1, shade], [5, 17, 1, 1, shade], [7, 17, 1, 1, shade], // bottom crimp
    ], `can bar ${cls}`);
  }

  /** Bottle with cap and label (syrup, ready-to-drink shake), 10×18. */
  function bottleSvg(f, cls = '') {
    const [body, shade, label, accent] = f.colors;
    return pixelSvg(10, 18, [
      [3, 0, 4, 2, accent], [3, 0, 4, 1, 'rgba(255,255,255,0.3)'], [4, 2, 2, 2, body], [3, 4, 4, 1, body], // cap, neck
      [2, 5, 6, 12, body], [6, 5, 2, 12, shade], [3, 17, 4, 1, shade],
      [2, 8, 6, 5, label], [6, 8, 2, 5, 'rgba(0,0,0,0.1)'], [3, 10, 3, 1, accent], [3, 11, 2, 1, accent],
      [3, 5, 1, 11, 'rgba(255,255,255,0.5)'],
    ], `can bottle ${cls}`);
  }

  /** Stand-up pouch with zip and window (powder), 10×18. */
  function pouchSvg(f, cls = '') {
    const [body, shade, label, accent] = f.colors;
    return pixelSvg(10, 18, [
      [1, 1, 8, 2, shade], [1, 1, 8, 1, 'rgba(255,255,255,0.25)'], [1, 3, 8, 1, 'rgba(0,0,0,0.2)'], // seal + zip
      [1, 4, 8, 4, body], [0, 8, 10, 9, body], [8, 4, 1, 4, shade], [9, 8, 1, 9, shade], [1, 17, 8, 1, shade], // bag
      [2, 7, 6, 6, label], [3, 9, 4, 1, accent], [3, 11, 2, 1, accent], [5, 14, 2, 2, accent], [6, 13, 1, 1, accent], // label with a leaf
      [1, 4, 1, 12, 'rgba(255,255,255,0.3)'],
    ], `can pouch ${cls}`);
  }

  /** Pixel art of a fridge item by its kind. */
  const ITEM_ART = { cup: cupSvg, vial: vialSvg, tub: tubSvg, shaker: shakerSvg, bar: barSvg, bottle: bottleSvg, pouch: pouchSvg };
  const itemSvg = (f, cls = '') => (ITEM_ART[f.kind] || canSvg)(f, cls);
  /** Cold drinks get condensation; everything else a glint of light. */
  const COLD_KINDS = new Set(['can', 'cup', 'bottle', 'shaker']);

  /** A 10×18 pixel can in the flavour's colours (generic design, no brand mark). */
  function canSvg(f, cls = '') {
    const [body, shade, band, accent] = f.colors;
    return pixelSvg(10, 18, [
      [2, 0, 6, 1, '#7f8f99'], [1, 1, 8, 1, '#c3ced5'], [3, 1, 2, 1, '#eef3f6'],
      [1, 2, 8, 14, body], [7, 2, 2, 14, shade], [2, 2, 1, 14, 'rgba(255,255,255,0.45)'],
      [1, 6, 8, 6, band], [7, 6, 2, 6, 'rgba(0,0,0,0.12)'],
      [3, 6, 1, 2, accent], [4, 8, 1, 2, accent], [5, 6, 1, 2, accent], [6, 8, 1, 2, accent], [4, 10, 3, 1, accent],
      [1, 16, 8, 1, '#aab7bf'], [2, 17, 6, 1, '#7f8f99'],
    ], `can ${cls}`);
  }

  // Rarity of a can: name, colour and sort rank (rarest first in the fridge)
  const RARITY = {
    common: { name: 'Gewöhnlich', rank: 0 },
    uncommon: { name: 'Ungewöhnlich', rank: 1 },
    rare: { name: 'Selten', rank: 2 },
    epic: { name: 'Episch', rank: 3 },
    legendary: { name: 'Legendär', rank: 4 },
    mythic: { name: 'Mythisch', rank: 5 },
    cosmic: { name: 'Kosmisch', rank: 6 },
  };
  /** Small faceted gem above a can; colour and animation per rarity (CSS .gem-*). */
  const gemSvg = (r) => `<svg class="gem gem-${r}" viewBox="0 0 16 14" aria-hidden="true">
      <path class="g-body" d="M4 1h8l3 4-7 8-7-8z"/><path class="g-top" d="M4 1h8l3 4H1z"/><path class="g-hi" d="M5.5 2.2h3L7 4.6H3.4z"/></svg>`;
  /** An item with its rarity gem; cold drinks get condensation drops, the vial a glint instead. */
  const coldCan = (f, extra = '') => {
    const rank = (RARITY[f.rarity] || RARITY.common).rank;
    const cold = COLD_KINDS.has(f.kind || 'can');
    return `<span class="cold-can r-${f.rarity} kind-${f.kind || 'can'}" ${extra}>
      <span class="gem-wrap" title="${esc((RARITY[f.rarity] || RARITY.common).name)}">${gemSvg(f.rarity)}</span>
      <span class="can-body">${itemSvg(f)}${cold ? '<span class="frost"></span><i class="drop d1"></i><i class="drop d2"></i><i class="drop d3"></i>' : '<span class="glint"></span>'}${
        f.rarity === 'cosmic' ? '<span class="cosmos" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>' : ''}${
        rank >= 4 ? '<i class="sparkle s1" aria-hidden="true"></i><i class="sparkle s2" aria-hidden="true"></i>' : ''}</span>
    </span>`;
  };
  const cobweb = (cls) => `<svg class="cobweb ${cls}" viewBox="0 0 100 100" aria-hidden="true">
      <path d="M0 0L100 0M0 0L96 30M0 0L80 62M0 0L54 86M0 0L28 98M0 0L0 100"/>
      <path d="M26 0Q22 6 25 8Q20 14 21 16Q14 20 14 21Q8 24 7 26Q2 26 0 26"/>
      <path d="M52 0Q45 10 49 16Q40 26 41 33Q30 38 28 43Q16 46 14 51Q4 51 0 52"/>
      <path d="M80 0Q70 16 74 24Q61 40 62 49Q46 57 43 64Q26 70 21 76Q8 76 0 78"/></svg>`;
  const flySvg = `<svg viewBox="0 0 20 14" aria-hidden="true"><ellipse class="wing w1" cx="8" cy="4" rx="5" ry="3"/><ellipse class="wing w2" cx="12" cy="4" rx="5" ry="3"/>
      <ellipse cx="10" cy="9" rx="4" ry="3.2" fill="#1d2b33"/><circle cx="14" cy="8" r="2.2" fill="#1d2b33"/><circle cx="15" cy="7.4" r="0.8" fill="#c0392b"/></svg>`;

  // Fridge artwork on a 28×50 grid (8 px per pixel on screen): freezer rows 0–13, main compartment 14–49.
  const FR = { line: '#1d3446', body: '#e9f2f6', shade: '#c4d5df', hi: '#ffffff', handle: '#8ea4b3' };
  const fridgeDoorSvg = () => pixelSvg(28, 36, [
    [0, 0, 28, 36, FR.line], [1, 1, 26, 34, FR.body], [24, 1, 3, 34, FR.shade], [2, 2, 1, 32, FR.hi],
    [21, 3, 2, 10, FR.handle], [21, 3, 1, 10, '#b7c8d3'], [1, 34, 26, 1, FR.shade],
    [6, 8, 3, 3, '#fd6e6e'], [10, 12, 3, 3, '#b6dfed'], [6, 16, 2, 2, '#002941'],
  ], 'fridge-art');
  const fridgeDoorBackSvg = () => pixelSvg(28, 36, [
    [0, 0, 28, 36, FR.line], [1, 1, 26, 34, '#dbe9f0'], [3, 3, 22, 30, '#f2f8fb'],
    [3, 10, 22, 2, '#a9c6d4'], [3, 20, 22, 2, '#a9c6d4'], [3, 30, 22, 2, '#a9c6d4'],
    [5, 6, 3, 4, '#fff3b0'], [9, 6, 3, 4, '#ffd1d1'], [5, 16, 2, 4, '#c8f0d5'],
  ], 'fridge-art');
  // 3×5 pixel font for the name plate on the fridge door (rows top to bottom, 1 = pixel)
  const PIXEL_FONT = {
    A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
    F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
    K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
    P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
    U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
    Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
    4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010', 8: '111101111101111',
    9: '111101111001110', '-': '000000111000000', '.': '000000000000010',
  };
  const UMLAUT = { Ä: 'A', Ö: 'O', Ü: 'U' };
  /** Glyph runs of a text: [{ bits, width, dots }]; apostrophe and space are narrower. */
  function glyphsOf(text) {
    return [...text].map((ch) => {
      if (ch === "'") return { bits: '11000', width: 1 };
      if (ch === ' ') return { bits: '', width: 2 };
      const base = UMLAUT[ch] || ch;
      return PIXEL_FONT[base] ? { bits: PIXEL_FONT[base], width: 3, dots: Boolean(UMLAUT[ch]) } : null;
    }).filter(Boolean);
  }
  const textUnits = (g) => g.reduce((a, x) => a + x.width + 1, 0) - 1;
  /** Pixel rects for a line of text, `s` = size of one font pixel in fridge pixels, centred on cx. */
  function pixelTextRects(glyphs, cx, y, s, color) {
    const rects = [];
    let x = cx - (textUnits(glyphs) * s) / 2;
    for (const g of glyphs) {
      for (let i = 0; i < g.bits.length; i++) {
        if (g.bits[i] === '1') rects.push([x + (i % g.width) * s, y + Math.floor(i / g.width) * s, s, s, color]);
      }
      if (g.dots) rects.push([x, y - 1.5 * s, s, s, color], [x + 2 * s, y - 1.5 * s, s, s, color]);
      x += (g.width + 1) * s;
    }
    return rects;
  }
  /** "Claude" -> CLAUDE'S, "James" -> JAMES' (first name only, letters the font can draw). */
  function fridgeOwner(displayName) {
    const first = String(displayName || '').trim().split(/\s+/)[0] || '';
    let name = first.toUpperCase().replace(/ß/g, 'SS').normalize('NFC')
      .replace(/[^A-Z0-9ÄÖÜ.-]/g, (c) => c.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]/g, ''));
    if (name.length > 12 && name.includes('-')) name = name.split('-')[0]; // long double names: first part
    if (name.length > 12) name = `${name.slice(0, 11)}.`;
    name = name.replace(/^[.-]+|[-]+$/g, '');
    if (!name) return '';
    return /S$/.test(name) ? `${name}'` : `${name}'S`;
  }
  /** Freezer door; with an owner its name is embossed on it in pixel letters ("CLAUDE'S" / "FRIDGE"). */
  const freezerSvg = (owner) => {
    const rects = [
      [0, 0, 28, 14, FR.line], [1, 1, 26, 12, FR.body], [24, 1, 3, 12, FR.shade], [2, 2, 1, 10, FR.hi],
      [21, 8, 2, 4, FR.handle], [1, 12, 26, 1, FR.shade],
    ];
    const lines = [owner, 'FRIDGE'].filter(Boolean).map(glyphsOf);
    // one letter size for both lines: as large as possible within the door (handle and edge shading stay free)
    const s = Math.min(0.75, ...lines.map((g) => 17 / textUnits(g)));
    const cx = 12;
    const lineGap = 2.2 * s;
    const top = 6.5 - ((lines.length * 5 + (lines.length - 1) * 2.2) * s) / 2 + (owner && /[ÄÖÜ]/.test(owner) ? 0.4 * s : 0);
    lines.forEach((g, i) => {
      const y = top + i * (5 * s + lineGap);
      rects.push(...pixelTextRects(g, cx + s * 0.35, y + s * 0.35, s, 'rgba(255,255,255,0.95)')); // highlight: embossed look
      rects.push(...pixelTextRects(g, cx, y, s, '#7f97a8'));
    });
    return pixelSvg(28, 14, rects, 'fridge-art');
  };
  const fridgeInsideSvg = () => pixelSvg(28, 36, [
    [0, 0, 28, 36, FR.line], [1, 1, 26, 34, '#cfe2ec'], [3, 2, 22, 32, '#f3fbff'],
    [8, 2, 12, 2, '#fff6c9'], [6, 4, 16, 3, 'rgba(255,246,201,0.55)'],
    [3, 13, 22, 2, '#a9c6d4'], [3, 23, 22, 2, '#a9c6d4'], [3, 31, 22, 3, '#d6e7ef'],
  ], 'fridge-art');

  async function mountFridge(root, opts) {
    const query = opts.userId ? `?userId=${opts.userId}` : '';
    let shop;
    try {
      shop = await api('GET', `/api/shop${query}`);
      if (!opts.coach && shop.revoked && shop.revoked.length) notifyRevoked(shop.revoked);
    } catch (err) {
      root.innerHTML = `<div class="card empty-state">${esc(err.message)}</div>`;
      return;
    }
    const flavor = (k) => shop.flavors.find((f) => f.key === k);
    // rarest first; within a rarity in the order they were bought. Fills from the top left, row by row.
    const cans = shop.items
      .map((i) => ({ ...flavor(i.flavor), boughtId: i.id }))
      .filter((f) => f.key)
      .sort((a, b) => RARITY[b.rarity].rank - RARITY[a.rarity].rank || a.boughtId - b.boughtId);
    const perShelf = matchMedia('(max-width: 720px)').matches ? 5 : 6;
    const shelves = Math.max(3, Math.ceil(cans.length / perShelf));
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

    root.innerHTML = `${hofHeader(opts, 'fridge', opts.coach ? 'Was sich dein Klient mit seinen Medaillen gegönnt hat.' : 'Dein Kühlschrank – gefüllt mit dem, was du dir mit deinen Token gegönnt hast.')}
      <div class="fridge-stage ${reduce ? 'skip' : ''}" data-stage>
        <div class="fridge-cam" aria-hidden="true">
          <div class="fridge">
            <div class="fridge-side"></div>
            <div class="fridge-freezer">${freezerSvg(fridgeOwner(opts.coach ? opts.clientName : me && me.displayName))}</div>
            <div class="fridge-inside">${fridgeInsideSvg()}</div>
            <div class="fridge-door"><div class="door-front">${fridgeDoorSvg()}</div><div class="door-back">${fridgeDoorBackSvg()}</div></div>
          </div>
          <div class="fridge-shadow"></div>
        </div>
        <section class="fridge-view" aria-label="Inhalt des Kühlschranks">
          <div class="fridge-light" aria-hidden="true"></div>
          ${cans.length ? '' : `<div class="fridge-empty-fx" aria-hidden="true">${cobweb('tl')}${cobweb('tr')}<span class="fly f1">${flySvg}</span><span class="fly f2">${flySvg}</span></div>`}
          ${Array.from({ length: shelves }, (_, s) => `<div class="shelf">${cans.slice(s * perShelf, (s + 1) * perShelf)
            .map((f, i) => `<span class="shelf-can" style="--i:${s * perShelf + i}" title="${esc(f.name)} · ${esc(RARITY[f.rarity].name)}">${coldCan(f)}<span class="sr-only">${esc(f.name)}, ${esc(RARITY[f.rarity].name)}</span></span>`).join('')}</div>`).join('')}
          ${cans.length ? '' : `<p class="fridge-empty">${opts.coach ? 'Noch leer – dein Klient hat sich noch nichts gegönnt.' : 'Noch leer. Im <a href="' + opts.base + '/shop">Shop</a> tauschst du Token gegen Dosen.'}</p>`}
        </section>
      </div>
      <div class="fridge-meta">
        <span class="muted">${shop.free ? `${cans.length} ${cans.length === 1 ? 'Getränk' : 'Getränke'} · Testmodus: alles gratis` : `${cans.length} ${cans.length === 1 ? 'Dose' : 'Dosen'} · ${shop.balance.available} Token übrig`}</span>
        <span class="row" style="gap:6px">
          ${shop.free && cans.length ? '<button type="button" class="btn-ghost btn-sm" data-empty-fridge>Kühlschrank leeren</button>' : ''}
          ${reduce ? '' : '<button type="button" class="btn-ghost btn-sm" data-replay>↻ Nochmal reingleiten</button>'}
        </span>
      </div>`;
    const emptyBtn = root.querySelector('[data-empty-fridge]');
    if (emptyBtn) emptyBtn.addEventListener('click', async () => {
      if (!confirm('Test-Kühlschrank leeren?')) return;
      try {
        await api('DELETE', '/api/shop/items');
        mountFridge(root, opts);
      } catch (err) {
        toast(err.message, true);
      }
    });
    const replay = root.querySelector('[data-replay]');
    if (replay) replay.addEventListener('click', () => {
      const stage = root.querySelector('[data-stage]');
      stage.classList.remove('play');
      void stage.offsetWidth; // restart the animation
      stage.classList.add('play');
    });
    // bring the whole fridge into view first, then start gliding in
    const stage = root.querySelector('[data-stage]');
    const r = stage.getBoundingClientRect();
    const hidden = r.top < 70 || r.bottom > innerHeight - (innerWidth <= 720 ? 90 : 10);
    if (hidden) stage.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    setTimeout(() => stage.classList.add('play'), hidden && !reduce ? 450 : 0);
  }

  /**
   * Full-screen celebration after buying. The rarer the item, the bigger the show:
   * common – drop and sparks · rare – glow and light rays · epic – spin, shock wave, shake ·
   * legendary – charge-up silhouette, flash, coin rain · mythic – heartbeat in the dark, prism rays, double wave.
   * Tap or Escape skips it; with reduced motion only a calm card is shown.
   */
  const BUY_FX = {
    common: { pre: 0, total: 2600, particles: 14, colors: ['#ffffff', '#c3ced5', '#8fa1ad'] },
    uncommon: { pre: 0, total: 2800, particles: 20, colors: ['#c8f0d5', '#3fae5a', '#ffffff', '#9be3a8'] },
    rare: { pre: 0, total: 3000, particles: 26, colors: ['#bfe0ff', '#3a8ee8', '#ffffff'] },
    epic: { pre: 0, total: 3400, particles: 40, colors: ['#e6d6ff', '#a463e0', '#ffffff', '#ff8fd8'] },
    legendary: { pre: 0.9, total: 4600, particles: 60, colors: ['#fff1a8', '#f2c230', '#ffffff', '#ffb627'], coins: 22 },
    mythic: { pre: 1.6, total: 5800, particles: 96, colors: ['#ff3d6e', '#a463e0', '#3a8ee8', '#7ed957', '#f2c230', '#ffffff'], coins: 0, stars: 40 },
    // cosmic: the sky goes dark, a vortex pulls everything in, a supernova flash – then the item hangs among orbiting planets
    cosmic: { pre: 2.4, total: 7400, particles: 130, colors: ['#7b6cff', '#5ef2ff', '#ff6ad5', '#ffffff', '#f2c230', '#9d8bff'], coins: 0, stars: 110 },
  };
  function playPurchaseFx(f) {
    const cfg = BUY_FX[f.rarity] || BUY_FX.common;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const rnd = (a, b) => a + Math.random() * (b - a);
    const particles = reduce ? '' : Array.from({ length: cfg.particles }, (_, i) => {
      const angle = (360 / cfg.particles) * i + rnd(-8, 8);
      const color = cfg.colors[i % cfg.colors.length];
      const far = f.rarity === 'cosmic' ? 640 : f.rarity === 'mythic' ? 520 : 380;
      return `<i style="--a:${angle.toFixed(1)}deg;--d:${Math.round(rnd(140, far))}px;--c:${color};--s:${rnd(5, f.rarity === 'common' ? 9 : 13).toFixed(1)}px;--t:${rnd(0, 0.25).toFixed(2)}s"></i>`;
    }).join('');
    const coins = reduce || !cfg.coins ? '' : Array.from({ length: cfg.coins }, () =>
      `<i class="fx-coin" style="left:${rnd(2, 98).toFixed(1)}%;--t:${rnd(0, 1.2).toFixed(2)}s;--r:${Math.round(rnd(-360, 360))}deg;--z:${rnd(0.7, 1.3).toFixed(2)}"></i>`).join('');
    const stars = !reduce && cfg.stars ? Array.from({ length: cfg.stars }, () =>
      `<i style="left:${rnd(0, 100).toFixed(1)}%;top:${rnd(0, 100).toFixed(1)}%;--t:${rnd(0, 2).toFixed(2)}s;--z:${rnd(0.6, 1.8).toFixed(2)}"></i>`).join('') : '';
    const cosmic = f.rarity === 'cosmic' && !reduce;
    const fx = document.createElement('div');
    fx.className = `buy-fx r-${f.rarity} ${reduce ? 'calm' : ''}`;
    fx.style.setProperty('--pre', `${cfg.pre}s`);
    fx.setAttribute('role', 'status');
    fx.setAttribute('aria-live', 'assertive');
    fx.innerHTML = `
      <div class="fx-backdrop"></div>
      ${stars ? `<div class="fx-stars" aria-hidden="true">${stars}</div>` : ''}
      ${cosmic ? '<div class="fx-nebula" aria-hidden="true"><i></i><i></i><i></i></div>' : ''}
      <div class="fx-stage" aria-hidden="true">
        ${cosmic ? '<div class="fx-vortex"></div><div class="fx-orbit o1"><i></i></div><div class="fx-orbit o2"><i></i></div><div class="fx-orbit o3"><i></i></div>' : ''}
        <div class="fx-rays"></div>
        <div class="fx-glow"></div>
        <div class="fx-rings"><i></i><i></i></div>
        <div class="fx-particles">${particles}</div>
        <div class="fx-item">${coldCan(f)}</div>
      </div>
      <div class="fx-coins" aria-hidden="true">${coins}</div>
      <div class="fx-text">
        <span class="fx-rarity">${esc(RARITY[f.rarity].name)}</span>
        <strong class="fx-name">${esc(f.name)}</strong>
        <span class="fx-sub">Ab in deinen Kühlschrank</span>
      </div>
      <div class="fx-flash" aria-hidden="true"></div>
      <p class="fx-skip">Tippen zum Schließen</p>`;
    document.body.appendChild(fx);
    document.body.classList.add('fx-open');
    if (!reduce && navigator.vibrate) {
      const pattern = { legendary: [30, 50, 30, 50, 120], mythic: [20, 80, 20, 80, 20, 80, 200], epic: [40, 40, 60], cosmic: [15, 60, 15, 60, 15, 60, 30, 40, 300] }[f.rarity];
      if (pattern) setTimeout(() => navigator.vibrate(pattern), cfg.pre * 1000);
    }
    return new Promise((resolve) => {
      let done = false;
      const close = () => {
        if (done) return;
        done = true;
        fx.classList.add('fx-out');
        document.removeEventListener('keydown', onKey);
        setTimeout(() => {
          fx.remove();
          document.body.classList.remove('fx-open');
          resolve();
        }, 350);
      };
      const onKey = (e) => {
        if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') close();
      };
      fx.addEventListener('click', close);
      document.addEventListener('keydown', onKey);
      setTimeout(close, reduce ? 2200 : cfg.total);
    });
  }

  /** Medals went away after a correction, so did what was bought with their tokens. */
  function notifyRevoked(revoked) {
    const names = revoked.map((r) => r.name).join(', ');
    toast(`Aus deinem Kühlschrank genommen: ${names} – die Medaille dafür ist durch die Korrektur weggefallen.`, true);
  }

  /** Shop grouped by rarity, from common to cosmic. */
  function shopSections(flavors, card) {
    const groups = Object.keys(RARITY)
      .map((r) => [r, flavors.filter((f) => f.rarity === r).sort((a, b) => a.price - b.price || a.name.localeCompare(b.name))])
      .filter(([, list]) => list.length);
    return groups.map(([r, list]) => `<section class="shop-group r-${r}" aria-label="${esc(RARITY[r].name)}">
        <h3 class="shop-group-head"><span class="gem-wrap">${gemSvg(r)}</span>${esc(RARITY[r].name)} <span class="muted small">${list.length}</span></h3>
        <div class="shop-grid">${list.map(card).join('')}</div>
      </section>`).join('');
  }

  /** Cards lean towards the pointer (desktop, not with reduced motion). */
  function tiltCards(root) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !matchMedia('(hover: hover)').matches) return;
    root.querySelectorAll('.shop-item:not(.sold-out)').forEach((card) => {
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        card.style.setProperty('--rx', `${(-y * 10).toFixed(2)}deg`);
        card.style.setProperty('--ry', `${(x * 12).toFixed(2)}deg`);
        card.style.setProperty('--mx', `${((x + 0.5) * 100).toFixed(1)}%`);
        card.style.setProperty('--my', `${((y + 0.5) * 100).toFixed(1)}%`);
        card.classList.add('tilting');
      });
      card.addEventListener('pointerleave', () => {
        card.classList.remove('tilting');
        card.style.removeProperty('--rx');
        card.style.removeProperty('--ry');
      });
    });
  }

  async function mountShop(root, opts) {
    let shop;
    try {
      shop = await api('GET', '/api/shop');
      if (shop.revoked && shop.revoked.length) notifyRevoked(shop.revoked);
    } catch (err) {
      root.innerHTML = `<div class="card empty-state">${esc(err.message)}</div>`;
      return;
    }
    let justBought = null;
    const ownedSet = () => new Set(shop.items.map((i) => i.flavor));
    let owned = ownedSet();
    /** Already in the fridge: sold out. The stamp animates in right after buying. */
    const soldOutCard = (f, price) => `<section class="card shop-item sold-out ${justBought === f.key ? 'just-sold' : ''}" style="--can:${f.colors[0]}" aria-label="${esc(f.name)}: Sold out">
        <div class="shop-can">${coldCan(f)}<span class="sold-stamp" aria-hidden="true">Sold out</span></div>
        <h3>${esc(f.name)}</h3>
        <span class="rarity-tag r-${f.rarity}">${esc(RARITY[f.rarity].name)}</span>
        ${price}
        <button type="button" class="btn-secondary btn-sm btn-block" disabled>Sold out</button>
      </section>`;
    function draw() {
      owned = ownedSet();
      const b = shop.balance;
      if (shop.free) return drawFree();
      root.innerHTML = `${hofHeader(opts, 'shop', 'Jede Medaille ist Token wert – Bronze 1, Silber 2, Gold 3. Tausch sie gegen etwas für deinen Kühlschrank.')}
        <section class="card shop-balance">
          <div><span class="fame-big">${b.available}</span> <span class="muted">Token verfügbar</span></div>
          <p class="muted small">${b.earned} verdient · ${b.spent} ausgegeben</p>
          <a class="btn btn-secondary btn-sm" href="${opts.base}/fridge">Zum Kühlschrank →</a>
        </section>
        ${shopSections(shop.flavors, (f) => {
          if (owned.has(f.key)) return soldOutCard(f, `<p class="shop-price" aria-label="${f.price} Token">${'<i class="coin"></i>'.repeat(f.price)}<span>${f.price}</span></p>`);
          const can = b.available >= f.price;
          return `<section class="card shop-item" style="--can:${f.colors[0]}">
            <div class="shop-can">${coldCan(f, 'data-wobble')}</div>
            <h3>${esc(f.name)}</h3>
            <span class="rarity-tag r-${f.rarity}">${esc(RARITY[f.rarity].name)}</span>
            <p class="shop-price" aria-label="${f.price} Token">${'<i class="coin"></i>'.repeat(f.price)}<span>${f.price}</span></p>
            <button type="button" class="${can ? 'btn-primary' : 'btn-secondary'} btn-sm btn-block" data-buy="${f.key}" ${can ? '' : 'disabled'}>${can ? 'Kaufen' : `Noch ${f.price - b.available} Token`}</button>
          </section>`;
        })}`;
      tiltCards(root);
      root.querySelectorAll('[data-buy]').forEach((btn) => btn.addEventListener('click', async () => {
        btn.disabled = true;
        const f = shop.flavors.find((x) => x.key === btn.dataset.buy);
        try {
          shop = await api('POST', '/api/shop/buy', { flavor: f.key });
          await playPurchaseFx(f);
          justBought = f.key; // the sold-out stamp lands once the celebration is over
          draw();
          justBought = null;
        } catch (err) {
          toast(err.message, true);
          btn.disabled = false;
        }
      }));
    }
    function drawFree() {
      owned = ownedSet();
      root.innerHTML = `${hofHeader(opts, 'shop', '')}
        <section class="card shop-balance">
          <div><span class="fame-big">∞</span> <span class="muted">Testmodus – alles gratis</span></div>
          <p class="muted small">${shop.items.length} ${shop.items.length === 1 ? 'Getränk' : 'Getränke'} im Test-Kühlschrank</p>
          <span class="row" style="gap:6px">
            ${shop.items.length ? '<button type="button" class="btn-ghost btn-sm" data-empty-fridge>Kühlschrank leeren</button>' : ''}
            <a class="btn btn-secondary btn-sm" href="${opts.base}/fridge">Zum Kühlschrank →</a>
          </span>
        </section>
        ${shopSections(shop.flavors, (f) => (owned.has(f.key) ? soldOutCard(f, '<p class="shop-price"><span class="muted">Gratis</span></p>') : `<section class="card shop-item" style="--can:${f.colors[0]}">
            <div class="shop-can">${coldCan(f, 'data-wobble')}</div>
            <h3>${esc(f.name)}</h3>
            <span class="rarity-tag r-${f.rarity}">${esc(RARITY[f.rarity].name)}</span>
            <p class="shop-price"><span class="muted">Gratis</span> <s class="muted small">${f.price} Token</s></p>
            <button type="button" class="btn-primary btn-sm btn-block" data-buy="${f.key}">Gratis holen</button>
          </section>`))}`;
      tiltCards(root);
      root.querySelectorAll('[data-buy]').forEach((btn) => btn.addEventListener('click', async () => {
        btn.disabled = true;
        const f = shop.flavors.find((x) => x.key === btn.dataset.buy);
        try {
          shop = await api('POST', '/api/shop/buy', { flavor: f.key });
          await playPurchaseFx(f);
          justBought = f.key;
          drawFree();
          justBought = null;
        } catch (err) {
          toast(err.message, true);
          btn.disabled = false;
        }
      }));
      const emptyBtn = root.querySelector('[data-empty-fridge]');
      if (emptyBtn) emptyBtn.addEventListener('click', async () => {
        if (!confirm('Test-Kühlschrank leeren?')) return;
        try {
          shop = await api('DELETE', '/api/shop/items');
          drawFree();
        } catch (err) {
          toast(err.message, true);
        }
      });
    }
    draw();
  }

  async function renderCoachClient(id, tab) {
    setView(LOADING);
    let clients, entries, goals;
    let goalHistory = [];
    let measurements = [];
    let metricDefs = [];
    try {
      if (tab === 'overview') {
        [{ metrics: measurements }, { metrics: metricDefs }] = await Promise.all([
          api('GET', `/api/measurements?userId=${id}`),
          api('GET', '/api/metrics'),
        ]);
      }
      [{ clients }, { entries }, { goals }] = await Promise.all([
        api('GET', '/api/clients'),
        tab !== 'overview' ? { entries: [] } : api('GET', `/api/entries?userId=${id}`),
        tab === 'chat' || tab.startsWith('fame') || tab.startsWith('training') ? { goals: {} } : api('GET', `/api/goals?userId=${id}`).then((g) => {
          goalHistory = g.history;
          return g;
        }),
      ]);
      if (!clients.some((c) => c.id === id)) throw new Error('Klient nicht gefunden');
    } catch (err) {
      setView(`<a class="back" href="#/">← Alle Klienten</a><div class="card empty-state">${esc(err.message)}</div>`);
      return;
    }
    const client = clients.find((c) => c.id === id);

    const head = `
      <a class="back" href="#/">← Alle Klienten</a>
      <div class="page-head">
        <div>${eyebrow('Klient')}<h1>${esc(client.displayName)} ${catTag(client.category)}</h1><p class="muted">@${esc(client.username)} · Klient seit ${esc(fmtDate(client.createdAt.slice(0, 10), { month: 'long', year: 'numeric' }))}</p>
          <div class="row" style="gap:6px;margin-top:6px">${consentBadge(client)}${client.googleLinked ? `<span class="badge good" title="Schritte und Schlaf kommen automatisch">Google Health ✓${client.googleSyncAt ? ` · ${esc(relDay(client.googleSyncAt.slice(0, 10)))}` : ''}</span>` : ''}</div></div>
        <div class="row">
          <a class="btn btn-secondary" href="/api/entries.csv?userId=${id}">CSV exportieren</a>
        </div>
      </div>
      <nav class="tabs" aria-label="Bereiche">
        <a href="#/client/${id}"${tab === 'overview' ? ' aria-current="page"' : ''}>Übersicht</a>
        <a href="#/client/${id}/nutrition"${tab === 'nutrition' ? ' aria-current="page"' : ''}>Ernährungsplan${
          client.openSwaps ? ` <span class="count">${client.openSwaps}</span>` : ''
        }</a>
        <a href="#/client/${id}/training"${tab.startsWith('training') ? ' aria-current="page"' : ''}>Trainingsplan</a>
        <a href="#/client/${id}/fame"${tab.startsWith('fame') ? ' aria-current="page"' : ''}>Hall of Fame</a>
        <a href="#/client/${id}/chat"${tab === 'chat' ? ' aria-current="page"' : ''}>Nachrichten${
          client.unreadMessages && tab !== 'chat' ? ` <span class="count">${client.unreadMessages}</span>` : ''
        }</a>
      </nav>`;

    if (tab === 'nutrition') {
      setView(`${head}<div id="nutrition">${LOADING}</div>`);
      mountCoachNutrition(document.getElementById('nutrition'), client, goals);
      return;
    }

    if (tab.startsWith('fame')) {
      setView(`${head}<div id="fame">${LOADING}</div>`);
      mountHallOfFame(document.getElementById('fame'), { userId: id, coach: true, clientName: client.displayName, base: `#/client/${id}/fame`, sub: tab === 'fame/fridge' ? 'fridge' : 'medals' });
      return;
    }

    if (tab.startsWith('training')) {
      setView(`${head}<div id="training">${LOADING}</div>`);
      const root = document.getElementById('training');
      const opts = { userId: id, coach: true, clientName: client.displayName, base: `#/client/${id}/training` };
      if (tab === 'training/history') mountTrainingHistory(root, opts);
      else mountTraining(root, opts);
      return;
    }

    if (tab === 'chat') {
      setView(`${head}<div id="chat"></div>`);
      mountChat(document.getElementById('chat'), {
        query: `?userId=${id}`,
        title: `Nachrichten mit ${client.displayName}`,
        subtitle: 'Wünsche, Fragen und Vorschläge deines Klienten',
        empty: `${client.displayName} hat dir noch nicht geschrieben. Du kannst das Gespräch auch selbst beginnen.`,
      });
      return;
    }

    setView(`
      ${head}
      <div class="goals-panel" id="goals-panel" ${goalsPanelOpenFor === id ? '' : 'hidden'}>
        <div class="goals-panel-grid">
          <section class="card" id="category-card">
            <div class="row-between" style="margin-bottom:10px"><h2>Kategorie</h2><span class="muted small">nur für dich sichtbar</span></div>
            <div class="cat-picker" role="radiogroup" aria-label="Kategorie">
              ${[[null, 'Keine'], ...Object.entries(CATEGORIES)]
                .map(([k, l]) => `<button type="button" role="radio" aria-checked="${(client.category || null) === k}" data-cat="${k || ''}" class="cat-option ${k ? `cat-${k}` : ''}">${l}</button>`)
                .join('')}
            </div>
            <p class="hint">${client.category
              ? `Zusatzmaße: ${esc(metricDefs.filter((m) => m.active && m.categories.includes(client.category)).map((m) => m.name).join(', ') || 'keine')} · <a href="#/admin">im Admin-Tool ändern</a>`
              : 'Mit einer Kategorie bekommt dein Klient passende Zusatzmaße (z. B. Bauchumfang bei Diät).'}</p>
          </section>
          <form class="card" id="goals-form" novalidate>
            <h2 style="margin-bottom:12px">Plan &amp; Ziele</h2>
            <div class="field"><label for="g-kmin">Zielkalorien pro Tag <span class="muted small">(Range, z. B. 2200 – 2300)</span></label>
              <div class="kcal-range">
                <div class="input-unit"><input id="g-kmin" name="caloriesMin" inputmode="numeric" placeholder="von"><span>kcal</span></div>
                <span>–</span>
                <div class="input-unit"><input id="g-kmax" name="caloriesMax" inputmode="numeric" placeholder="bis" aria-label="Kalorien bis"><span>kcal</span></div>
              </div>
              <div class="hint">Für einen festen Wert nur „von“ ausfüllen. Im Diagramm erscheint der Mittelwert.</div></div>
            <div class="field"><label for="g-w">Zielgewicht</label>
              <div class="input-unit"><input id="g-w" name="targetWeight" inputmode="decimal"><span>kg</span></div></div>
            <div class="field"><label for="g-s">Schritte pro Tag</label>
              <div class="input-unit"><input id="g-s" name="stepsGoal" inputmode="numeric"><span>Schritte</span></div></div>
            <div class="field"><label for="g-sl">Schlaf pro Nacht</label>
              <div class="input-unit"><input id="g-sl" name="sleepGoal" inputmode="decimal" placeholder="z. B. 7,5"><span>Std.</span></div></div>
            <button class="btn-primary btn-block" type="submit">Plan speichern</button>
            <p class="error" hidden></p>
            <p class="hint">Den Plan sieht dein Klient in seiner Übersicht. Änderungen mit Erklärung schickst du am besten über den <a href="#/checkin/${id}">Check-in</a>.</p>
          </form>
          <div class="card">
            <h2 style="margin-bottom:12px">Zugang verwalten</h2>
            <div class="stack">
              <button class="btn-secondary btn-block" type="button" id="btn-rename">Namen ändern</button>
              <button class="btn-secondary btn-block" type="button" id="btn-email">${client.email ? 'E-Mail ändern' : 'E-Mail hinterlegen'}</button>
              ${client.email ? `<p class="small muted" style="margin:0">${esc(client.email)} · ${client.emailVerified ? 'bestätigt ✓' : 'noch nicht bestätigt'}</p>` : ''}
              <button class="btn-secondary btn-block" type="button" id="btn-reset">Neues Passwort vergeben</button>
              <button class="btn-danger btn-block" type="button" id="btn-delete">Klient löschen</button>
            </div>
          </div>
        </div>
      </div>
      <div id="dashboard" class="stack"></div>`);

    // "Ziele ändern" opens the panel with category, plan & goals and account settings.
    const headRow = app.querySelector('.page-head a[href^="/api/entries.csv"]').parentElement;
    headRow.insertAdjacentHTML('afterbegin', `<button type="button" class="btn-primary" id="btn-goals" aria-controls="goals-panel"></button>`);
    const goalsBtn = document.getElementById('btn-goals');
    const goalsPanel = document.getElementById('goals-panel');
    const syncGoalsBtn = () => {
      const open = !goalsPanel.hidden;
      goalsBtn.textContent = open ? 'Schließen' : 'Ziele ändern';
      goalsBtn.className = open ? 'btn-secondary' : 'btn-primary';
      goalsBtn.setAttribute('aria-expanded', String(open));
      goalsPanelOpenFor = open ? id : null;
    };
    goalsBtn.addEventListener('click', () => {
      goalsPanel.hidden = !goalsPanel.hidden;
      syncGoalsBtn();
      if (!goalsPanel.hidden) goalsPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    syncGoalsBtn();
    const dash = mountDashboard(document.getElementById('dashboard'), { entries, goals, history: goalHistory, measurements });
    document.querySelectorAll('[data-cat]').forEach((b) =>
      b.addEventListener('click', async () => {
        try {
          await api('PATCH', `/api/clients/${id}`, { category: b.dataset.cat || null });
          toast(b.dataset.cat ? `Kategorie: ${CATEGORIES[b.dataset.cat]}` : 'Kategorie entfernt');
          renderCoachClient(id, 'overview');
        } catch (err) {
          toast(err.message, true);
        }
      })
    );

    const gf = document.getElementById('goals-form');
    const show = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','));
    gf.targetWeight.value = show(goals.targetWeight);
    gf.stepsGoal.value = show(goals.stepsGoal);
    gf.sleepGoal.value = show(goals.sleepGoal);
    gf.caloriesMin.value = show(goals.caloriesMin);
    gf.caloriesMax.value = show(goals.caloriesMax === goals.caloriesMin ? null : goals.caloriesMax);
    gf.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = gf.querySelector('.error');
      errEl.hidden = true;
      try {
        const body = {
          targetWeight: parseNum(gf.targetWeight.value),
          stepsGoal: parseNum(gf.stepsGoal.value),
          sleepGoal: parseNum(gf.sleepGoal.value),
          caloriesMin: parseNum(gf.caloriesMin.value),
          caloriesMax: parseNum(gf.caloriesMax.value),
        };
        if (Object.values(body).some(Number.isNaN)) throw new Error('Bitte nur Zahlen eingeben.');
        await api('PUT', `/api/goals?userId=${id}`, body);
        const fresh = await api('GET', `/api/goals?userId=${id}`);
        dash.setGoals(fresh.goals, fresh.history);
        toast('Plan gespeichert');
      } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
      }
    });

    document.getElementById('btn-rename').addEventListener('click', () => {
      openDialog(
        `<h2>Namen ändern</h2>
         <div class="field"><label for="r-name">Name</label><input id="r-name" name="displayName" value="${esc(client.displayName)}" required></div>
         <div class="dialog-actions"><button type="button" class="btn-secondary" data-close>Abbrechen</button>
           <button type="submit" class="btn-primary">Speichern</button></div>`,
        async (f) => {
          await api('PATCH', `/api/clients/${id}`, { displayName: f.displayName.value });
          toast('Name geändert');
          renderCoachClient(id);
        }
      );
    });

    document.getElementById('btn-email').addEventListener('click', () => {
      openDialog(
        `<h2>E-Mail-Adresse</h2>
         <p class="muted small">${esc(client.displayName)} kann sich damit anmelden und – nach Bestätigung per Link – ein vergessenes Passwort selbst zurücksetzen.</p>
         <div class="field"><label for="ce-mail">E-Mail</label><input id="ce-mail" name="email" type="email" value="${esc(client.email || '')}" placeholder="max@beispiel.de"></div>
         <div class="dialog-actions"><button type="button" class="btn-secondary" data-close>Abbrechen</button>
           <button type="submit" class="btn-primary">Speichern</button></div>`,
        async (f) => {
          const r = await api('PATCH', `/api/clients/${id}`, { email: f.email.value.trim() || null });
          if (r.mailError) toast(`Gespeichert, aber: ${r.mailError}`, true);
          else savedHud('Gespeichert', r.verifySent ? 'Bestätigungslink ist unterwegs' : '');
          renderCoachClient(id);
        }
      );
    });

    document.getElementById('btn-reset').addEventListener('click', () => {
      openDialog(
        `<h2>Neues Passwort</h2>
         <p class="muted small">Der Klient wird auf allen Geräten abgemeldet und muss sich mit dem neuen Passwort anmelden.</p>
         <div class="field"><label for="n-pw">Neues Passwort</label><input id="n-pw" name="password" value="${randomPassword()}" required></div>
         <div class="dialog-actions"><button type="button" class="btn-secondary" data-close>Abbrechen</button>
           <button type="submit" class="btn-primary">Passwort setzen</button></div>`,
        async (f) => {
          await api('PATCH', `/api/clients/${id}`, { password: f.password.value });
          showCredentials(client.displayName, client.username, f.password.value);
          return false;
        }
      );
    });

    document.getElementById('btn-delete').addEventListener('click', async () => {
      if (!confirm(`${client.displayName} und alle Einträge endgültig löschen?`)) return;
      try {
        await api('DELETE', `/api/clients/${id}`);
        toast('Klient gelöscht');
        location.hash = '#/';
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  /**
   * Pull to refresh (phones): pull down at the top of the page. A coral ring fills while pulling,
   * the arrow flips when you can let go, the ring spins while loading and ends with a check mark.
   */
  function setupPullToRefresh() {
    if (!matchMedia('(pointer: coarse)').matches) return;
    const ptr = document.createElement('div');
    ptr.className = 'ptr';
    ptr.setAttribute('aria-hidden', 'true');
    ptr.innerHTML = `<div class="ptr-badge"><svg viewBox="0 0 40 40">
        <circle class="ptr-track" cx="20" cy="20" r="15"/><circle class="ptr-ring" cx="20" cy="20" r="15"/>
        <path class="ptr-arrow" d="M20 13v13M14.5 21l5.5 5.5 5.5-5.5"/><path class="ptr-check" d="M13.5 20.5l4.5 4.5 8.5-9"/></svg></div>`;
    document.body.appendChild(ptr);
    const ring = ptr.querySelector('.ptr-ring');
    const CIRC = 2 * Math.PI * 15;
    ring.style.strokeDasharray = `${CIRC}`;
    const THRESHOLD = 72;
    const MAX = 120;
    let startY = null;
    let dist = 0;
    let armed = false;
    let busy = false;

    const enabled = () => me && innerWidth <= 720 && !dialog.open && !document.querySelector('.sub-dialog[open]') && !document.body.classList.contains('sheet-open') && !document.querySelector('[data-unsaved]');
    const blockedBy = (target) => {
      const scroller = target.closest('.chat-log, .food-results, .user-menu, .food-table-wrap');
      return scroller && scroller.scrollTop > 0;
    };
    function paint() {
      const p = Math.min(1, dist / THRESHOLD);
      ptr.style.transform = `translate(-50%, ${dist - 56}px)`;
      ptr.style.opacity = String(Math.min(1, dist / 30));
      ring.style.strokeDashoffset = String(CIRC * (1 - p));
      ptr.classList.toggle('ready', p >= 1);
      app.style.transform = `translateY(${dist * 0.45}px)`;
    }
    function settle() {
      ptr.classList.add('settling');
      app.classList.add('settling');
      dist = 0;
      paint();
      setTimeout(() => {
        ptr.classList.remove('settling', 'ready', 'loading', 'done');
        app.classList.remove('settling');
        app.style.transform = '';
      }, 320);
    }

    window.addEventListener('touchstart', (e) => {
      if (busy || !enabled() || window.scrollY > 0 || e.touches.length !== 1 || blockedBy(e.target)) return;
      startY = e.touches[0].clientY;
      dist = 0;
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (startY === null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0 || window.scrollY > 0) {
        if (dist > 0) settle();
        startY = null;
        return;
      }
      e.preventDefault(); // we handle this gesture
      dist = MAX * (1 - Math.exp(-dy / (MAX * 1.4))); // rubber band
      const nowArmed = dist >= THRESHOLD;
      if (nowArmed && !armed && navigator.vibrate) navigator.vibrate(8);
      armed = nowArmed;
      paint();
    }, { passive: false });

    window.addEventListener('touchend', async () => {
      if (startY === null) return;
      startY = null;
      if (!armed) return settle();
      armed = false;
      busy = true;
      ptr.classList.add('loading', 'settling');
      app.classList.add('settling');
      dist = 64;
      paint();
      const minTime = new Promise((r) => setTimeout(r, 700));
      try {
        await Promise.all([Promise.resolve(route()), minTime]);
        refreshUnread();
        ptr.classList.remove('loading');
        ptr.classList.add('done');
        await new Promise((r) => setTimeout(r, 450));
      } catch {
        /* the page shows its own error */
      }
      busy = false;
      settle();
    });
  }

  setupPullToRefresh();
  boot();
})();
