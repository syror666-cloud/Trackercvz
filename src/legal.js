'use strict';

/**
 * Public legal pages: /datenschutz (privacy policy, also linked on Google's consent screen) and /impressum.
 * The operator's details come from environment variables, so no personal data lives in the code:
 *   LEGAL_NAME, LEGAL_ADDRESS (lines separated by "|" or new lines), LEGAL_EMAIL, LEGAL_PHONE (optional)
 * This is a template that fits how the app works – it is not legal advice.
 */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const STAND = 'November 2026';

function operator(env) {
  const name = (env.LEGAL_NAME || '').trim();
  const address = String(env.LEGAL_ADDRESS || '').split(/\||\n/).map((l) => l.trim()).filter(Boolean);
  const email = (env.LEGAL_EMAIL || '').trim();
  const phone = (env.LEGAL_PHONE || '').trim();
  const complete = Boolean(name && address.length && email);
  const block = complete
    ? `<p>${esc(name)}<br>${address.map(esc).join('<br>')}<br>E-Mail: <a href="mailto:${esc(email)}">${esc(email)}</a>${phone ? `<br>Telefon: ${esc(phone)}` : ''}</p>`
    : '<p class="todo">Name, Anschrift und E-Mail-Adresse des Betreibers fehlen noch (Umgebungsvariablen <code>LEGAL_NAME</code>, <code>LEGAL_ADDRESS</code>, <code>LEGAL_EMAIL</code>).</p>';
  return { name, email, block, complete };
}

function page(title, body) {
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><title>${esc(title)} – StayOnTrack</title>
<link rel="icon" href="/favicon.png">
<style>
  @font-face { font-family: Inter; src: url(/fonts/inter.woff2) format('woff2'); font-weight: 100 900; font-display: swap; }
  :root { --bg: #f5f5f7; --card: #fff; --text: #1d1d1f; --muted: #6e6e73; --line: #e5e5ea; --accent: #002941; --todo: #8a5a07; }
  @media (prefers-color-scheme: dark) { :root { --bg: #000; --card: #1c1c1e; --text: #f5f5f7; --muted: #98989d; --line: #38383a; --accent: #b6dfed; --todo: #e8c95a; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 17px/1.55 Inter, -apple-system, system-ui, sans-serif; letter-spacing: -0.011em; }
  main { max-width: 760px; margin: 0 auto; padding: 40px 16px 64px; }
  .brand { display: flex; align-items: center; gap: 10px; text-decoration: none; color: inherit; font-weight: 600; margin-bottom: 28px; }
  .brand img { width: 36px; height: 36px; border-radius: 9px; }
  article { background: var(--card); border-radius: 22px; padding: 40px clamp(20px, 5vw, 48px); }
  h1 { font-size: clamp(28px, 6vw, 36px); line-height: 1.15; letter-spacing: -0.03em; margin: 0 0 6px; }
  .stand { color: var(--muted); margin: 0 0 28px; font-size: 15px; }
  h2 { font-size: 20px; letter-spacing: -0.02em; margin: 34px 0 10px; }
  h3 { font-size: 17px; margin: 22px 0 6px; }
  p, li { margin: 0 0 12px; }
  ul { padding-left: 1.2em; }
  a { color: var(--accent); }
  code { font-size: 0.9em; }
  .todo { color: var(--todo); border-left: 3px solid var(--todo); padding-left: 12px; }
  .note { color: var(--muted); font-size: 15px; }
  footer { text-align: center; color: var(--muted); font-size: 14px; margin-top: 24px; }
  footer a { color: var(--muted); margin: 0 8px; }
</style></head>
<body><main>
  <a class="brand" href="/"><img src="/icon-192.png" alt=""><span>StayOnTrack</span></a>
  <article>${body}</article>
  <footer><a href="/">Zur App</a><a href="/datenschutz">Datenschutz</a><a href="/impressum">Impressum</a></footer>
</main></body></html>`;
}

function privacyPage(env) {
  const op = operator(env);
  return page('Datenschutzerklärung', `
    <h1>Datenschutzerklärung</h1>
    <p class="stand">Stand: ${STAND}</p>
    <p>StayOnTrack ist eine App für Fitness- und Ernährungscoaching. Klientinnen und Klienten halten darin ihre Fortschritte fest, ihr Coach begleitet sie. Hier steht, welche Daten dabei verarbeitet werden, wozu und welche Rechte du hast.</p>

    <h2>1. Verantwortlicher</h2>
    ${op.block}

    <h2>2. Welche Daten wir verarbeiten</h2>
    <ul>
      <li><strong>Konto:</strong> Name, Benutzername, Passwort (nur als sicherer Hash), optional E-Mail-Adresse und Profilbild, Spracheinstellung und Erscheinungsbild.</li>
      <li><strong>Gesundheits- und Fitnessdaten:</strong> Gewicht, Schritte, Schlaf, Kalorien und Mahlzeiten (Ernährungstagebuch), Trainingseinheiten, Körpermaße und Notizen – so, wie du sie einträgst oder aus Google Health übernimmst.</li>
      <li><strong>Coaching:</strong> Ziele, Ernährungs- und Trainingspläne, wöchentliche Check-ins, Nachrichten mit deinem Coach.</li>
      <li><strong>Technisches:</strong> Anmeldezeitpunkte, Tage mit Nutzung der App, Push-Abonnements deiner Geräte. Server-Protokolle enthalten IP-Adressen nur kurzzeitig zur Abwehr von Missbrauch (z. B. zu vieler Anmeldeversuche).</li>
    </ul>

    <h2>3. Zwecke und Rechtsgrundlagen</h2>
    <p>Wir verarbeiten die Daten, um das Coaching durchzuführen (Art. 6 Abs. 1 lit. b DSGVO). Gesundheitsdaten verarbeiten wir auf Grundlage deiner ausdrücklichen Einwilligung (Art. 9 Abs. 2 lit. a DSGVO), die du mit der Nutzung der App und beim Verbinden von Google Health erteilst und jederzeit für die Zukunft widerrufen kannst. Sicherheitsmaßnahmen wie Anmeldebegrenzungen beruhen auf unserem berechtigten Interesse (Art. 6 Abs. 1 lit. f DSGVO).</p>

    <h2>4. Google Health</h2>
    <p>Wenn du in den Einstellungen „Mit Google Health verbinden“ wählst, liest StayOnTrack mit deiner Zustimmung aus deinem Google-Konto:</p>
    <ul>
      <li><strong>Schritte</strong> (Tagessummen) – Berechtigung <code>googlehealth.activity_and_fitness.readonly</code></li>
      <li><strong>Schlafdauer</strong> (Minuten geschlafen je Nacht) – Berechtigung <code>googlehealth.sleep.readonly</code></li>
    </ul>
    <p>Die Werte werden ausschließlich in deinen Tracker übernommen, damit du und dein Coach deinen Fortschritt sehen. StayOnTrack liest nur, schreibt nichts in dein Google-Konto und ruft keine anderen Daten ab. Die Daten werden nicht verkauft, nicht für Werbung genutzt, nicht an Dritte weitergegeben und nicht zum Trainieren von KI-Modellen verwendet. Ein Mensch sieht sie nur, soweit es für das Coaching nötig ist (dein Coach) oder für Sicherheit und Fehlerbehebung erforderlich ist.</p>
    <p>Die Verbindung speichern wir als verschlüsseltes Token. Du kannst sie jederzeit in der App unter Einstellungen → Google Health → „Trennen“ oder in deinem Google-Konto (<a href="https://myaccount.google.com/connections">myaccount.google.com/connections</a>) beenden; das Token wird dann gelöscht und bei Google widerrufen. Bereits übernommene Werte bleiben Teil deines Trackers, bis du ihre Löschung verlangst oder dein Konto gelöscht wird.</p>
    <p lang="en">StayOnTrack's use and transfer to any other app of information received from Google APIs will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements.</p>

    <h2>5. Empfänger und Dienstleister</h2>
    <ul>
      <li><strong>Hosting:</strong> Die App und ihre Datenbank laufen bei Render Services, Inc. (USA), je nach gewählter Server-Region in der EU (Frankfurt) oder in den USA. Übermittlungen in die USA sind durch die EU-Standardvertragsklauseln abgesichert.</li>
      <li><strong>E-Mail:</strong> Bestätigungs-Mails, Codes zum Zurücksetzen des Passworts und Berichte (Check-in, Ernährungsplan als PDF) versenden wir über Resend (Region EU/Irland). Dabei werden deine E-Mail-Adresse und der Inhalt der Mail übermittelt.</li>
      <li><strong>Produktdaten:</strong> Beim Scannen eines Barcodes wird nur die Barcode-Nummer an Open Food Facts gesendet, wenn das Produkt nicht in unserer eigenen Datenbank ist.</li>
      <li><strong>KI-Unterstützung für den Coach</strong> (optional): Für Zusammenfassungen und Planentwürfe werden Messwerte und Ernährungswünsche – ohne deinen Namen – an Anthropic (USA) übermittelt; Anthropic nutzt diese Daten nicht zum Training.</li>
      <li><strong>Push-Nachrichten:</strong> Werden über die Push-Dienste deines Browsers bzw. Geräteherstellers (z. B. Apple, Google, Mozilla) zugestellt.</li>
    </ul>

    <h2>6. Wer deine Daten sieht</h2>
    <p>Dein Coach sieht deine Einträge, Pläne, Check-ins und Nachrichten. Andere Klienten sehen nichts davon. Ausnahme: Wenn du Head2Head einschaltest, sehen andere Teilnehmende deinen Namen, dein Profilbild und in einem Duell nur die gewählte Disziplin (Gewicht ausschließlich als Prozentwert).</p>

    <h2>7. Speicherdauer</h2>
    <p>Wir speichern deine Daten, solange dein Konto besteht. Wird das Konto gelöscht, werden alle zugehörigen Daten gelöscht. Einmal-Codes und Bestätigungslinks verfallen nach 15 Minuten bzw. 7 Tagen.</p>

    <h2>8. Cookies</h2>
    <p>StayOnTrack setzt nur ein technisch notwendiges Cookie für die Anmeldung. Es gibt kein Tracking und keine Werbe- oder Analyse-Cookies.</p>

    <h2>9. Deine Rechte</h2>
    <p>Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch sowie das Recht, erteilte Einwilligungen jederzeit zu widerrufen. Wende dich dazu an ${op.email ? `<a href="mailto:${esc(op.email)}">${esc(op.email)}</a>` : 'den Verantwortlichen (oben)'}. Außerdem kannst du dich bei einer Datenschutz-Aufsichtsbehörde beschweren.</p>
    <p class="note">Diese Erklärung beschreibt, wie StayOnTrack technisch arbeitet. Sie ersetzt keine Rechtsberatung.</p>`);
}

function imprintPage(env) {
  const op = operator(env);
  return page('Impressum', `
    <h1>Impressum</h1>
    <p class="stand">Angaben gemäß § 5 DDG</p>
    ${op.block}
    <h2>Verantwortlich für den Inhalt</h2>
    <p>${op.name ? esc(op.name) : '<span class="todo">Name fehlt noch (<code>LEGAL_NAME</code>)</span>'}</p>
    <p class="note">Datenschutz: siehe <a href="/datenschutz">Datenschutzerklärung</a>.</p>`);
}

/** Handles GET /datenschutz and /impressum; returns true when it answered. */
function legalHandler(env = process.env) {
  return (req, res, pathname) => {
    const p = pathname.replace(/\/+$/, '');
    const html = p === '/datenschutz' || p === '/privacy' ? privacyPage(env) : p === '/impressum' ? imprintPage(env) : null;
    if (!html) return false;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : html);
    return true;
  };
}

module.exports = { legalHandler, privacyPage, imprintPage };
