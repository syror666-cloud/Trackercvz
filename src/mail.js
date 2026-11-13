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
      async send({ to, subject, text, html }) {
        const res = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to: [to], subject, text, html }),
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) throw new Error(`Resend antwortet mit ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
      },
    };
  }
  if (env.SMTP_HOST && from) {
    let transport = null;
    const port = Number(env.SMTP_PORT) || 587;
    return {
      enabled: true,
      via: 'smtp',
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

/** A plain, readable mail with one button. */
function mailBody({ greeting, lines, button, link, footer }) {
  const text = [greeting, '', ...lines, '', `${button}: ${link}`, '', footer, '', '– StayOnTrack'].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#edf5f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#002941">
  <div style="max-width:480px;margin:0 auto;padding:32px 20px">
    <p style="font-size:18px;font-weight:600;margin:0 0 20px">Stay<b>On</b>Track</p>
    <div style="background:#fff;padding:28px 24px;border-radius:14px 0 0 0">
      <p style="margin:0 0 14px">${escHtml(greeting)}</p>
      ${lines.map((l) => `<p style="margin:0 0 14px;line-height:1.5">${escHtml(l)}</p>`).join('')}
      <p style="margin:24px 0"><a href="${escHtml(link)}" style="display:inline-block;background:#002941;color:#fff;text-decoration:none;padding:12px 20px;font-weight:600">${escHtml(button)}</a></p>
      <p style="margin:0;font-size:13px;color:#526b7b;line-height:1.5">${escHtml(footer)}</p>
    </div>
    <p style="font-size:12px;color:#526b7b;margin:16px 0 0;word-break:break-all">Link funktioniert nicht? Kopiere ihn in den Browser:<br>${escHtml(link)}</p>
  </div></body></html>`;
  return { text, html };
}

module.exports = { createMailer, mailBody };
