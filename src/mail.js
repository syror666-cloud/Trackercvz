'use strict';

/**
 * Outgoing e-mail (password reset, e-mail confirmation).
 *
 * Two ways, chosen by environment variables:
 *  - RESEND_API_KEY: HTTPS API of resend.com – works everywhere, also where outgoing SMTP ports are blocked
 *    (e.g. Render's free plan).
 *  - SMTP_HOST (+ SMTP_PORT, SMTP_USER, SMTP_PASS): any mail server, e.g. Brevo, Gmail, Strato, IONOS.
 * MAIL_FROM is the sender, e.g. "StayOnTrack <noreply@deine-domain.de>".
 * Without either, mail is off and the app hides "Passwort vergessen".
 */

function createMailer(env = process.env, { fetchImpl = fetch, log = console } = {}) {
  const from = env.MAIL_FROM || '';
  if (env.RESEND_API_KEY && from) {
    return {
      enabled: true,
      via: 'resend',
      from,
      /**
       * One idempotency key per mail, so a retry never sends it twice. Retries with backoff on network errors,
       * 5xx and 429 (honouring retry-after); other 4xx errors are final. Returns the Resend email id.
       */
      async send({ to, subject, text, html, attachments }, { retries = 3, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
        const idempotencyKey = require('node:crypto').randomUUID();
        for (let attempt = 0; ; attempt++) {
          let res = null;
          try {
            res = await fetchImpl('https://api.resend.com/emails', {
              method: 'POST',
              headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
              body: JSON.stringify({
                from, to: [to], subject, text, html,
                ...(attachments && attachments.length ? { attachments: attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString('base64') })) } : {}),
              }),
              signal: AbortSignal.timeout(10000),
            });
          } catch (err) {
            if (attempt >= retries) throw err;
          }
          if (res && res.ok) {
            const data = await res.json().catch(() => ({}));
            log.log(`E-Mail gesendet (Resend ${data.id || '?'})`);
            return data.id || null;
          }
          if (res && res.status < 500 && res.status !== 429) {
            throw new Error(`Resend antwortet mit ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
          }
          if (attempt >= retries) throw new Error(`Resend antwortet mit ${res ? res.status : 'keiner Verbindung'}`);
          const after = res && Number(res.headers.get('retry-after'));
          await sleep(after > 0 ? Math.min(after, 30) * 1000 : 500 * 2 ** attempt);
        }
      },
    };
  }
  if (env.SMTP_HOST && from) {
    let transport = null;
    const port = Number(env.SMTP_PORT) || 587;
    return {
      enabled: true,
      via: 'smtp',
      from,
      async send({ to, subject, text, html, attachments }) {
        if (!transport) {
          const nodemailer = require('nodemailer');
          transport = nodemailer.createTransport({
            host: env.SMTP_HOST,
            port,
            secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
            requireTLS: port === 587,
            auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS || '' } : undefined,
            connectionTimeout: 10000,
            socketTimeout: 15000,
          });
        }
        await transport.sendMail({ from, to, subject, text, html, attachments: (attachments || []).map((a) => ({ filename: a.filename, content: Buffer.from(a.content), contentType: a.contentType })) });
      },
    };
  }
  if (env.RESEND_API_KEY || env.SMTP_HOST) log.warn('E-Mail: MAIL_FROM fehlt – E-Mail-Versand ist aus.');
  return { enabled: false, via: null, async send() { throw new Error('E-Mail ist nicht eingerichtet'); } };
}

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Calm, Apple-like palette: neutral grey page, white card, near-black text; brand colours only as accents.
const C = {
  page: '#f5f5f7', card: '#ffffff', text: '#1d1d1f', secondary: '#6e6e73', tertiary: '#86868b', fill: '#f5f5f7',
  line: '#e8e8ed', navy: '#002941', coral: '#fd6e6e', good: '#1f8a4c', bad: '#c0392b',
};
const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','SF Pro Display','Helvetica Neue',Helvetica,Arial,sans-serif";
const MONO = "'SF Mono',ui-monospace,Menlo,Consolas,'Liberation Mono',monospace";

/**
 * Mail in a calm, Apple-like style: app icon centred on top, a large title, 17 px body text, plenty of air,
 * one rounded card. Optional: a one-time code (one selectable line, easy to copy), a row of key figures,
 * one pill button, a quiet note. Table layout and inline styles, so it holds up in Gmail, Outlook and
 * Apple Mail; dark mode where supported. Always with a plain-text part.
 *
 * opts: { preheader, eyebrow, title, paragraphs: [], code, codeHint, stats: [{ label, value, delta, good }],
 *         button: { label, link }, note, appUrl }
 */
function renderMail({ preheader, eyebrow, title, paragraphs = [], code, codeHint, stats, button, note, appUrl }) {
  const base = appUrl ? appUrl.replace(/\/+$/, '') : '';
  const text = [
    title, '', ...paragraphs.flatMap((p) => [p, '']),
    ...(code ? [`Dein Code: ${code}`, codeHint || '', ''] : []),
    ...(stats && stats.length ? [...stats.map((x) => `${x.label}: ${x.value}${x.delta ? ` (${x.delta})` : ''}`), ''] : []),
    ...(button ? [`${button.label}: ${button.link}`, ''] : []),
    note || '', '', 'StayOnTrack', base,
  ].join('\n').replace(/\n{3,}/g, '\n\n');

  const p = (t, extra = '') => `<p class="t" style="margin:0 0 16px;font:400 17px/1.47 ${FONT};color:${C.text};letter-spacing:-0.022em;${extra}">${escHtml(t)}</p>`;
  const statCells = (stats || []).slice(0, 4).map((x) => `<td class="stat" valign="top" style="padding:14px 8px;text-align:center;background:${C.fill};border-radius:14px;width:${Math.floor(100 / Math.min(4, stats.length))}%">
      <div class="s" style="font:500 12px/1.3 ${FONT};color:${C.secondary};letter-spacing:0">${escHtml(x.label)}</div>
      <div class="t" style="font:600 22px/1.25 ${FONT};color:${C.text};letter-spacing:-0.02em;margin-top:4px">${escHtml(x.value)}</div>
      ${x.delta ? `<div style="font:500 13px/1.3 ${FONT};color:${x.good === true ? C.good : x.good === false ? C.bad : C.secondary};margin-top:2px">${escHtml(x.delta)}</div>` : ''}
    </td>`).join('<td style="width:8px"></td>');

  const html = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
<title>${escHtml(title)}</title>
<style>
  @media (prefers-color-scheme: dark) {
    .bg { background:#000000 !important; }
    .card { background:#1c1c1e !important; }
    .t { color:#f5f5f7 !important; }
    .s { color:#98989d !important; }
    .fill, .stat { background:#2c2c2e !important; }
    .rule { border-color:#38383a !important; }
    .btn { background:#fd6e6e !important; color:#1d1d1f !important; }
  }
  @media (max-width: 520px) {
    .card { padding:36px 22px 30px !important; border-radius:20px !important; }
    .h1 { font-size:26px !important; }
    .code { font-size:32px !important; letter-spacing:8px !important; }
    .stat { display:block !important; width:auto !important; margin-bottom:8px !important; }
  }
  a { color:inherit; }
</style></head>
<body class="bg" style="margin:0;padding:0;background:${C.page};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escHtml(preheader || title)}&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg" style="background:${C.page}">
  <tr><td align="center" style="padding:40px 14px 32px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px">
      <tr><td align="center" style="padding:0 0 22px">
        ${base ? `<img src="${escHtml(base)}/icon-192.png" width="56" height="56" alt="StayOnTrack" style="display:block;width:56px;height:56px;border-radius:13px;border:0">` : ''}
      </td></tr>
      <tr><td class="card" style="background:${C.card};border-radius:24px;padding:44px 40px 36px">
        ${eyebrow ? `<p class="s" style="margin:0 0 8px;text-align:center;font:600 13px/1.3 ${FONT};color:${C.secondary};letter-spacing:0.02em;text-transform:uppercase">${escHtml(eyebrow)}</p>` : ''}
        <h1 class="t h1" style="margin:0 0 24px;text-align:center;font:700 30px/1.15 ${FONT};color:${C.text};letter-spacing:-0.03em">${escHtml(title)}</h1>
        ${paragraphs.map((t) => p(t)).join('')}
        ${code ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:26px 0 10px"><tr><td class="fill" align="center" style="background:${C.fill};border-radius:18px;padding:22px 12px 18px">
            <div class="t code" style="font:600 40px/1.1 ${MONO};letter-spacing:12px;padding-left:12px;color:${C.text}">${escHtml(code)}</div>
            ${codeHint ? `<div class="s" style="margin-top:10px;font:400 14px/1.4 ${FONT};color:${C.secondary}">${escHtml(codeHint)}</div>` : ''}
          </td></tr></table>` : ''}
        ${stats && stats.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 8px"><tr>${statCells}</tr></table>` : ''}
        ${button ? `<table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:28px auto 6px"><tr><td class="btn" align="center" style="background:${C.navy};border-radius:980px">
            <a href="${escHtml(button.link)}" class="btn" style="display:inline-block;padding:14px 30px;font:500 17px/1.2 ${FONT};color:#ffffff;text-decoration:none;border-radius:980px;background:${C.navy};letter-spacing:-0.01em">${escHtml(button.label)}</a>
          </td></tr></table>
          <p class="s" style="margin:14px 0 0;text-align:center;font:400 12px/1.5 ${FONT};color:${C.tertiary};word-break:break-all">Falls der Button nicht geht: <a href="${escHtml(button.link)}" style="color:${C.tertiary}">${escHtml(button.link)}</a></p>` : ''}
        ${note ? `<p class="s rule" style="margin:30px 0 0;padding-top:20px;border-top:1px solid ${C.line};text-align:center;font:400 13px/1.5 ${FONT};color:${C.secondary}">${escHtml(note)}</p>` : ''}
      </td></tr>
      <tr><td align="center" style="padding:24px 24px 0">
        <p class="s" style="margin:0;font:600 13px/1.4 ${FONT};color:${C.secondary};letter-spacing:-0.01em">StayOnTrack</p>
        <p class="s" style="margin:4px 0 0;font:400 12px/1.5 ${FONT};color:${C.tertiary}">Automatische Nachricht – Antworten werden nicht gelesen.<br>Schreib deinem Coach einfach in der App.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
  return { text, html };
}

module.exports = { createMailer, renderMail };
