(function () {
  'use strict';

  const app = document.getElementById('app');
  const topbar = document.getElementById('topbar');
  const dialog = document.getElementById('dialog');
  let me = null;
  let resizeHandler = null;

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
      : Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

  const signed = (v, d = 1) => (v > 0 ? '+' : v < 0 ? '−' : '±') + num(Math.abs(v), d);

  function fmtSleep(h) {
    if (h === null || h === undefined) return '–';
    const total = Math.round(h * 60);
    return `${Math.floor(total / 60)}:${pad2(total % 60)} h`;
  }

  function fmtDate(s, opts) {
    return new Date(`${s}T12:00:00`).toLocaleDateString('de-DE', opts || { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
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

  // ---------- routing ----------
  async function boot() {
    try {
      me = (await api('GET', '/api/me')).user;
    } catch {
      me = null;
    }
    route();
  }

  function setView(html) {
    if (resizeHandler) window.removeEventListener('resize', resizeHandler);
    resizeHandler = null;
    app.innerHTML = html;
    window.scrollTo(0, 0);
  }

  function route() {
    if (!me) {
      topbar.hidden = true;
      return renderLogin();
    }
    topbar.hidden = false;
    document.getElementById('whoami').textContent = `${me.displayName} · ${me.role === 'coach' ? 'Coach' : 'Klient'}`;
    const m = location.hash.match(/^#\/client\/(\d+)/);
    if (me.role === 'coach') {
      if (m) return renderCoachClient(Number(m[1]));
      return renderCoachHome();
    }
    return renderClientHome();
  }

  window.addEventListener('hashchange', route);

  document.getElementById('btn-logout').addEventListener('click', async () => {
    await api('POST', '/api/logout').catch(() => {});
    me = null;
    location.hash = '';
    route();
  });

  document.getElementById('btn-password').addEventListener('click', () => {
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
        toast('Passwort geändert');
      }
    );
  });

  // ---------- login ----------
  function renderLogin() {
    setView(`
      <div class="login-wrap">
        <form class="card login-card" id="login-form">
          <div class="brand"><img src="/icon.svg" alt="" width="32" height="32"><span>Fitness Tracker</span></div>
          <div class="field"><label for="u">Benutzername</label>
            <input id="u" name="username" autocomplete="username" autocapitalize="none" required></div>
          <div class="field"><label for="p">Passwort</label>
            <input id="p" name="password" type="password" autocomplete="current-password" required></div>
          <button class="btn-primary btn-block" type="submit">Anmelden</button>
          <p class="error" hidden></p>
        </form>
      </div>`);
    const form = document.getElementById('login-form');
    form.username.focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = form.querySelector('.error');
      errEl.hidden = true;
      try {
        me = (await api('POST', '/api/login', { username: form.username.value, password: form.password.value })).user;
        route();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
      }
    });
  }

  // ---------- client: daily entry ----------
  async function renderClientHome() {
    setView('<p class="muted">Lade…</p>');
    const [{ entries }, { goals }] = await Promise.all([api('GET', '/api/entries'), api('GET', '/api/goals')]);
    const state = { entries, goals };

    setView(`
      <div class="page-head">
        <div><h1>Hallo ${esc(me.displayName)}</h1><p class="muted" id="streak"></p></div>
      </div>
      <div class="grid-2">
        <form class="card" id="entry-form" novalidate>
          <div class="row-between" style="margin-bottom:12px">
            <h2>Tageseintrag</h2>
            <span class="badge" id="entry-status"></span>
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
          <div class="field"><label for="f-note">Notiz <span class="muted">(optional)</span></label>
            <textarea id="f-note" name="note" maxlength="500" placeholder="Wie lief der Tag? Training, Ernährung, Befinden…"></textarea></div>
          <button class="btn-primary btn-block" type="submit">Speichern</button>
          <p class="error" hidden></p>
          <p class="hint">Du kannst jeden Wert auch später am Tag ergänzen – bereits gespeicherte Werte bleiben erhalten.</p>
        </form>
        <div id="dashboard" class="stack"></div>
      </div>`);

    const form = document.getElementById('entry-form');
    const today = todayStr();
    form.date.max = today;
    form.date.value = today;

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
        const { entry } = await api('PUT', `/api/entries/${form.date.value}`, {
          weight, steps, sleep, note: form.note.value,
        });
        state.entries = state.entries.filter((x) => x.date !== form.date.value);
        if (entry) state.entries.push(entry);
        state.entries.sort((a, b) => a.date.localeCompare(b.date));
        toast(entry ? 'Eintrag gespeichert ✓' : 'Eintrag entfernt');
        fillForm();
        updateStreak();
        dash.update(state.entries);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
      }
    });

    const dash = mountDashboard(document.getElementById('dashboard'), {
      entries: state.entries,
      goals: state.goals,
      onEdit(date) {
        form.date.value = date;
        fillForm();
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      async onDelete(date) {
        if (!confirm(`Eintrag vom ${fmtDate(date)} löschen?`)) return;
        await api('DELETE', `/api/entries/${date}`);
        state.entries = state.entries.filter((x) => x.date !== date);
        toast('Eintrag gelöscht');
        fillForm();
        updateStreak();
        dash.update(state.entries);
      },
    });
    fillForm();
    updateStreak();
  }

  // ---------- shared dashboard ----------
  const RANGES = [
    ['30', '30 T'],
    ['90', '90 T'],
    ['365', '1 J'],
    ['all', 'Alle'],
  ];

  function mountDashboard(root, { entries, goals, onEdit, onDelete }) {
    let rangeKey = '30';
    let all = entries;

    root.innerHTML = `
      <div class="row-between">
        <h2>Verlauf</h2>
        <div class="segmented" role="group" aria-label="Zeitraum">
          ${RANGES.map(([k, l]) => `<button type="button" data-range="${k}" aria-pressed="${k === rangeKey}">${l}</button>`).join('')}
        </div>
      </div>
      <div class="stats" data-stats></div>
      <div class="card chart-card">
        <div class="row-between"><h3>Gewicht</h3>
          <div class="legend"><span><i class="faint"></i>Tageswert</span><span><i></i>Ø 7 Tage</span></div></div>
        <div class="chart-weight" data-chart="weight"></div>
      </div>
      <div class="card chart-card"><h3>Schritte</h3><div class="chart-steps" data-chart="steps"></div></div>
      <div class="card chart-card"><h3>Schlaf</h3><div class="chart-sleep" data-chart="sleep"></div></div>
      <div class="card">
        <h3 style="margin-bottom:8px">Einträge</h3>
        <div class="table-wrap" data-table></div>
      </div>`;

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

    function drawStats() {
      const today = todayStr();
      const last7 = all.filter((e) => daysBetween(e.date, today) < 7 && daysBetween(e.date, today) >= 0);
      const weights = all.filter((e) => e.weight !== null);
      const cur = weights.length ? weights[weights.length - 1] : null;
      const start = weights.length ? weights[0] : null;
      // Compare against the latest weigh-in at least 7 days older than the current one.
      let ref7 = null;
      if (cur) for (const w of weights) if (daysBetween(w.date, cur.date) >= 7) ref7 = w;

      const goodDir = goals.targetWeight !== null && cur && goals.targetWeight > cur.weight ? 1 : -1;
      const deltaCls = (d) => (d === 0 ? '' : Math.sign(d) === goodDir ? 'down' : 'up');

      let weightSub = 'Noch kein Gewicht eingetragen';
      if (cur) {
        const parts = [];
        if (ref7) {
          const d = cur.weight - ref7.weight;
          parts.push(`<span class="${deltaCls(d)}">${signed(d)} kg</span> in 7 T`);
        }
        if (start && start.date !== cur.date) {
          const d = cur.weight - start.weight;
          parts.push(`<span class="${deltaCls(d)}">${signed(d)} kg</span> gesamt`);
        }
        weightSub = parts.join(' · ') || `am ${fmtDate(cur.date, { day: '2-digit', month: '2-digit' })}`;
      }

      const steps7 = avg(last7.filter((e) => e.steps !== null).map((e) => e.steps));
      const sleep7 = avg(last7.filter((e) => e.sleep !== null).map((e) => e.sleep));
      const stepsHit = goals.stepsGoal ? last7.filter((e) => e.steps !== null && e.steps >= goals.stepsGoal).length : null;
      const sleepHit = goals.sleepGoal ? last7.filter((e) => e.sleep !== null && e.sleep >= goals.sleepGoal).length : null;

      let targetSub = 'Kein Zielgewicht festgelegt';
      if (goals.targetWeight !== null) {
        targetSub = cur
          ? Math.abs(cur.weight - goals.targetWeight) < 0.05
            ? '<span class="good">Ziel erreicht 🎉</span>'
            : `noch ${num(Math.abs(cur.weight - goals.targetWeight), 1)} kg`
          : '';
        targetSub = `Ziel ${num(goals.targetWeight, 1)} kg · ${targetSub}`;
      }

      const daysLogged = new Set(last7.map((e) => e.date)).size;
      const consistencyCls = daysLogged >= 6 ? 'good' : daysLogged >= 4 ? 'warn' : 'bad';

      root.querySelector('[data-stats]').innerHTML = `
        <div class="card stat">
          <div class="stat-label"><span class="dot-key" style="background:var(--weight)"></span>Gewicht</div>
          <div class="stat-value">${cur ? num(cur.weight, 1) : '–'} <small>kg</small></div>
          <div class="stat-sub">${weightSub}</div>
          <div class="stat-sub">${targetSub}</div>
        </div>
        <div class="card stat">
          <div class="stat-label"><span class="dot-key" style="background:var(--steps)"></span>Schritte Ø 7 T</div>
          <div class="stat-value">${num(steps7)}</div>
          <div class="stat-sub">${goals.stepsGoal ? `Ziel ${num(goals.stepsGoal)} · ${stepsHit}/7 Tage erreicht` : 'Kein Schrittziel'}</div>
        </div>
        <div class="card stat">
          <div class="stat-label"><span class="dot-key" style="background:var(--sleep)"></span>Schlaf Ø 7 T</div>
          <div class="stat-value">${fmtSleep(sleep7)}</div>
          <div class="stat-sub">${goals.sleepGoal ? `Ziel ${fmtSleep(goals.sleepGoal)} · ${sleepHit}/7 Nächte erreicht` : 'Kein Schlafziel'}</div>
        </div>
        <div class="card stat">
          <div class="stat-label">Konsequenz</div>
          <div class="stat-value ${consistencyCls}">${daysLogged}<small>/7</small></div>
          <div class="stat-sub">Tage eingetragen (letzte Woche)</div>
          <div class="stat-sub">Letzter Eintrag: ${relDay(all.length ? all[all.length - 1].date : null)}</div>
        </div>`;
    }

    function drawCharts() {
      const { from, to } = rangeBounds();
      const inRange = all.filter((e) => e.date >= from && e.date <= to);
      const series = (k) => inRange.map((e) => ({ date: e.date, value: e[k] }));
      Charts.render(root.querySelector('[data-chart=weight]'), {
        data: series('weight'), from, to, type: 'line', trend: true,
        goal: goals.targetWeight, unit: 'kg', decimals: 1, label: 'Gewichtsverlauf',
      });
      Charts.render(root.querySelector('[data-chart=steps]'), {
        data: series('steps'), from, to, type: 'bar',
        goal: goals.stepsGoal, unit: 'Schritte', label: 'Schritte pro Tag',
      });
      Charts.render(root.querySelector('[data-chart=sleep]'), {
        data: series('sleep'), from, to, type: 'bar', decimals: 1,
        goal: goals.sleepGoal, label: 'Schlafdauer', formatValue: fmtSleep,
      });
    }

    function drawTable() {
      const { from, to } = rangeBounds();
      const rows = all.filter((e) => e.date >= from && e.date <= to).slice().reverse();
      const wrap = root.querySelector('[data-table]');
      if (!rows.length) {
        wrap.innerHTML = '<div class="empty-state">Keine Einträge in diesem Zeitraum.</div>';
        return;
      }
      const editable = Boolean(onEdit);
      wrap.innerHTML = `<table>
        <thead><tr><th>Datum</th><th class="num">Gewicht</th><th class="num">Schritte</th><th class="num">Schlaf</th><th>Notiz</th>${editable ? '<th></th>' : ''}</tr></thead>
        <tbody>${rows
          .map(
            (e) => `<tr>
              <td>${esc(fmtDate(e.date))}</td>
              <td class="num">${e.weight !== null ? `${num(e.weight, 1)} kg` : '–'}</td>
              <td class="num">${num(e.steps)}</td>
              <td class="num">${fmtSleep(e.sleep)}</td>
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

    function draw() {
      drawStats();
      drawCharts();
      drawTable();
    }

    let resizeTimer;
    resizeHandler = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(drawCharts, 150);
    };
    window.addEventListener('resize', resizeHandler);

    draw();
    return {
      update(newEntries) {
        all = newEntries;
        draw();
      },
      setGoals(g) {
        goals = g;
        draw();
      },
    };
  }

  // ---------- coach: overview ----------
  async function renderCoachHome() {
    setView('<p class="muted">Lade…</p>');
    const { clients } = await api('GET', '/api/clients');

    const cards = clients
      .map((c) => {
        const days = c.lastEntry ? daysBetween(c.lastEntry, todayStr()) : null;
        const cls = days === null ? 'bad' : days <= 1 ? 'good' : days <= 3 ? 'warn' : 'bad';
        const delta = c.lastWeight !== null && c.firstWeight !== null ? c.lastWeight - c.firstWeight : null;
        return `<a class="card client-card" href="#/client/${c.id}">
          <div class="row-between">
            <h3>${esc(c.displayName)}</h3>
            <span class="badge ${cls}">${relDay(c.lastEntry)}</span>
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
        <div><h1>Meine Klienten</h1><p class="muted">${clients.length} ${clients.length === 1 ? 'Klient' : 'Klienten'}</p></div>
        <button class="btn-primary" id="btn-new-client" type="button">+ Neuer Klient</button>
      </div>
      ${clients.length ? `<div class="client-list">${cards}</div>` : `<div class="card empty-state">
        <p>Noch keine Klienten angelegt.</p>
        <p>Lege einen Zugang an und gib die Zugangsdaten an deinen Klienten weiter.</p></div>`}`);

    document.getElementById('btn-new-client').addEventListener('click', () => {
      const pw = randomPassword();
      openDialog(
        `<h2>Neuen Klienten anlegen</h2>
         <div class="field"><label for="c-name">Name</label><input id="c-name" name="displayName" required placeholder="Max Mustermann"></div>
         <div class="field"><label for="c-user">Benutzername</label><input id="c-user" name="username" autocapitalize="none" required placeholder="max">
           <div class="hint">3–32 Zeichen: Buchstaben, Ziffern, . _ -</div></div>
         <div class="field"><label for="c-pw">Startpasswort</label><input id="c-pw" name="password" value="${pw}" required>
           <div class="hint">Der Klient kann es nach dem ersten Login selbst ändern.</div></div>
         <div class="dialog-actions">
           <button type="button" class="btn-secondary" data-close>Abbrechen</button>
           <button type="submit" class="btn-primary">Anlegen</button>
         </div>`,
        async (f) => {
          const { client } = await api('POST', '/api/clients', {
            displayName: f.displayName.value, username: f.username.value.trim(), password: f.password.value,
          });
          showCredentials(client.displayName, client.username, f.password.value, () => {
            location.hash = `#/client/${client.id}`;
          });
          return false;
        }
      );
    });
  }

  function showCredentials(name, username, password, after) {
    const text = `Dein Zugang zum Fitness Tracker\nAdresse: ${location.origin}\nBenutzername: ${username}\nPasswort: ${password}`;
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
  async function renderCoachClient(id) {
    setView('<p class="muted">Lade…</p>');
    let clients, entries, goals;
    try {
      [{ clients }, { entries }, { goals }] = await Promise.all([
        api('GET', '/api/clients'),
        api('GET', `/api/entries?userId=${id}`),
        api('GET', `/api/goals?userId=${id}`),
      ]);
    } catch (err) {
      setView(`<a class="back" href="#/">← Alle Klienten</a><div class="card empty-state">${esc(err.message)}</div>`);
      return;
    }
    const client = clients.find((c) => c.id === id);

    setView(`
      <a class="back" href="#/">← Alle Klienten</a>
      <div class="page-head">
        <div><h1>${esc(client.displayName)}</h1><p class="muted">@${esc(client.username)} · Klient seit ${esc(fmtDate(client.createdAt.slice(0, 10), { month: 'long', year: 'numeric' }))}</p></div>
        <div class="row">
          <a class="btn btn-secondary" href="/api/entries.csv?userId=${id}">CSV exportieren</a>
        </div>
      </div>
      <div class="grid-2">
        <div class="stack">
          <form class="card" id="goals-form" novalidate>
            <h2 style="margin-bottom:12px">Ziele</h2>
            <div class="field"><label for="g-w">Zielgewicht</label>
              <div class="input-unit"><input id="g-w" name="targetWeight" inputmode="decimal"><span>kg</span></div></div>
            <div class="field"><label for="g-s">Schritte pro Tag</label>
              <div class="input-unit"><input id="g-s" name="stepsGoal" inputmode="numeric"><span>Schritte</span></div></div>
            <div class="field"><label for="g-sl">Schlaf pro Nacht</label>
              <div class="input-unit"><input id="g-sl" name="sleepGoal" inputmode="decimal" placeholder="z. B. 7,5"><span>Std.</span></div></div>
            <button class="btn-primary btn-block" type="submit">Ziele speichern</button>
            <p class="error" hidden></p>
            <p class="hint">Die Ziele sieht dein Klient in seiner Übersicht.</p>
          </form>
          <div class="card">
            <h2 style="margin-bottom:12px">Zugang verwalten</h2>
            <div class="stack">
              <button class="btn-secondary btn-block" type="button" id="btn-rename">Namen ändern</button>
              <button class="btn-secondary btn-block" type="button" id="btn-reset">Neues Passwort vergeben</button>
              <button class="btn-danger btn-block" type="button" id="btn-delete">Klient löschen</button>
            </div>
          </div>
        </div>
        <div id="dashboard" class="stack"></div>
      </div>`);

    const dash = mountDashboard(document.getElementById('dashboard'), { entries, goals });

    const gf = document.getElementById('goals-form');
    const show = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','));
    gf.targetWeight.value = show(goals.targetWeight);
    gf.stepsGoal.value = show(goals.stepsGoal);
    gf.sleepGoal.value = show(goals.sleepGoal);
    gf.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = gf.querySelector('.error');
      errEl.hidden = true;
      try {
        const body = {
          targetWeight: parseNum(gf.targetWeight.value),
          stepsGoal: parseNum(gf.stepsGoal.value),
          sleepGoal: parseNum(gf.sleepGoal.value),
        };
        if (Object.values(body).some(Number.isNaN)) throw new Error('Bitte nur Zahlen eingeben.');
        const res = await api('PUT', `/api/goals?userId=${id}`, body);
        dash.setGoals(res.goals);
        toast('Ziele gespeichert');
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

  boot();
})();
