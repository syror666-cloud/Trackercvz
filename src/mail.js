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
      async send({ to, subject, text, html }, { retries = 3, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
        const idempotencyKey = require('node:crypto').randomUUID();
        for (let attempt = 0; ; attempt++) {
          let res = null;
          try {
            res = await fetchImpl('https://api.resend.com/emails', {
              method: 'POST',
              headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
              body: JSON.stringify({ from, to: [to], subject, text, html }),
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
      async send({ to, subject, text, html }) {
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
        await transport.sendMail({ from, to, subject, text, html });
      },
    };
  }
  if (env.RESEND_API_KEY || env.SMTP_HOST) log.warn('E-Mail: MAIL_FROM fehlt – E-Mail-Versand ist aus.');
  return { enabled: false, via: null, async send() { throw new Error('E-Mail ist nicht eingerichtet'); } };
}

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Brand colours of the app (Midnight Navy, Soft Blue, Coral)
const C = { navy: '#002941', page: '#edf5f8', card: '#ffffff', soft: '#b6dfed', softBg: '#f4f9fb', coral: '#fd6e6e', muted: '#526b7b', line: '#e1ebf0' };
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/**
 * Branded mail in the app's look: logo, a card with a coral accent, an optional big one-time code
 * and/or one button, a quiet security note. Table layout and inline styles, so it looks the same in
 * Gmail, Outlook and Apple Mail; dark mode where the mail app supports it. Always with a plain-text part.
 *
 * opts: { preheader, title, paragraphs: [], code, codeHint, button: { label, link }, note, appUrl }
 */
function renderMail({ preheader, title, paragraphs = [], code, codeHint, button, note, appUrl }) {
  const base = appUrl ? appUrl.replace(/\/+$/, '') : '';
  const text = [
    title, '', ...paragraphs.flatMap((p) => [p, '']),
    ...(code ? [`Dein Code: ${code}`, codeHint || '', ''] : []),
    ...(button ? [`${button.label}: ${button.link}`, ''] : []),
    note || '', '', '– StayOnTrack', base,
  ].join('\n').replace(/\n{3,}/g, '\n\n');

  const digits = code ? String(code).split('').map((d) => `<span class="sot-digit" style="display:inline-block;width:44px;margin:0 3px;padding:12px 0;background:${C.card};border:1px solid ${C.soft};border-radius:10px;font:700 30px/1 ${FONT};color:${C.navy};text-align:center">${escHtml(d)}</span>`).join('') : '';
  const html = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>${escHtml(title)}</title>
<style>
  @media (prefers-color-scheme: dark) {
    .sot-page { background:#001a2b !important; }
    .sot-card { background:#002941 !important; }
    .sot-text, .sot-title, .sot-brand { color:#eaf5fa !important; }
    .sot-muted { color:#8fb0c2 !important; }
    .sot-codebox { background:#08344f !important; }
    .sot-digit { background:#002941 !important; color:#eaf5fa !important; border-color:#1e4f6c !important; }
    .sot-btn { background:#fd6e6e !important; color:#002941 !important; }
    .sot-rule { border-color:#0f3c58 !important; }
  }
  @media (max-width: 480px) { .sot-digit { width:38px !important; font-size:26px !important; margin:0 2px !important; } }
</style></head>
<body style="margin:0;padding:0;background:${C.page}" class="sot-page">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escHtml(preheader || title)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="sot-page" style="background:${C.page}">
  <tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
      <tr><td style="padding:0 4px 18px">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          ${base ? `<td style="padding-right:10px"><img src="${escHtml(base)}/icon-192.png" width="36" height="36" alt="" style="display:block;border-radius:10px"></td>` : ''}
          <td class="sot-brand" style="font:500 19px ${FONT};color:${C.navy};letter-spacing:-0.01em">Stay<b>On</b>Track</td>
        </tr></table>
      </td></tr>
      <tr><td class="sot-card" style="background:${C.card};border-radius:16px 0 0 0;border-top:4px solid ${C.coral};padding:32px 28px">
        <h1 class="sot-title" style="margin:0 0 16px;font:600 24px/1.25 ${FONT};color:${C.navy};letter-spacing:-0.02em">${escHtml(title)}</h1>
        ${paragraphs.map((p) => `<p class="sot-text" style="margin:0 0 14px;font:400 16px/1.55 ${FONT};color:${C.navy}">${escHtml(p)}</p>`).join('')}
        ${code ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 8px"><tr><td class="sot-codebox" align="center" style="background:${C.softBg};border-radius:12px;padding:20px 8px">
            <div style="white-space:nowrap">${digits}</div>
            ${codeHint ? `<p class="sot-muted" style="margin:14px 0 0;font:400 14px/1.4 ${FONT};color:${C.muted}">${escHtml(codeHint)}</p>` : ''}
          </td></tr></table>` : ''}
        ${button ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px"><tr><td class="sot-btn" style="background:${C.navy}">
            <a href="${escHtml(button.link)}" class="sot-btn" style="display:inline-block;padding:14px 24px;font:600 16px ${FONT};color:#ffffff;text-decoration:none;background:${C.navy}">${escHtml(button.label)}</a>
          </td></tr></table>
          <p class="sot-muted" style="margin:10px 0 0;font:400 12px/1.5 ${FONT};color:${C.muted};word-break:break-all">Button geht nicht? Kopiere diesen Link in deinen Browser:<br>${escHtml(button.link)}</p>` : ''}
        ${note ? `<p class="sot-muted sot-rule" style="margin:24px 0 0;padding-top:16px;border-top:1px solid ${C.line};font:400 13px/1.5 ${FONT};color:${C.muted}">🔒 ${escHtml(note)}</p>` : ''}
      </td></tr>
      <tr><td style="padding:18px 4px 0">
        <p class="sot-muted" style="margin:0;font:400 12px/1.5 ${FONT};color:${C.muted}">Diese Mail kommt automatisch von StayOnTrack, weil für dein Konto eine Aktion angefordert wurde. Antworten auf diese Mail werden nicht gelesen – schreib deinem Coach einfach in der App.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
  return { text, html };
}

module.exports = { createMailer, renderMail };
