'use strict';

/**
 * E-mail address per account: log in with it, confirm it, reset a forgotten password.
 *
 * Security:
 *  - password reset: a 6-digit code by mail, typed into the app together with the new password;
 *    valid 15 minutes, at most 5 tries, then a new code is needed; only a salted hash is stored
 *  - address confirmation: a link with a random 256-bit token (hash stored), valid 7 days, one-time use
 *  - a reset code only goes to a CONFIRMED address (a typo can't hand an account to a stranger)
 *  - "forgot password" answers the same whether or not the account exists (no enumeration),
 *    and is rate-limited per address and per account
 *  - changing the own address needs the current password; a reset ends all sessions
 */

const crypto = require('node:crypto');
const { hashPassword, verifyPassword } = require('./db');
const { renderMail } = require('./mail');

const RESET_MS = 15 * 60 * 1000;
const RESET_TRIES = 5;
const VERIFY_MS = 7 * 24 * 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@<>()[\],;:"]{1,64}@[^\s@<>()[\],;:"]{1,253}\.[^\s@<>()[\],;:"]{2,63}$/;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function emailAuth({ db, HttpError, readBody, requireUser, requireCoach, mailer, appUrl, clientIp, validatePassword, startSession, log = console }) {
  const enabled = Boolean(mailer && mailer.enabled && appUrl);
  const base = appUrl ? appUrl.replace(/\/+$/, '') : '';
  const q = {
    byId: db.prepare('SELECT * FROM users WHERE id = ?'),
    byEmail: db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE'),
    byName: db.prepare('SELECT * FROM users WHERE username = ?'),
    setEmail: db.prepare('UPDATE users SET email = ?, email_verified = ? WHERE id = ?'),
    verify: db.prepare('UPDATE users SET email_verified = 1 WHERE id = ? AND email = ? COLLATE NOCASE'),
    setPassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
    dropSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    insertToken: db.prepare('INSERT INTO email_tokens (token_hash, user_id, purpose, email, expires_at) VALUES (?, ?, ?, ?, ?)'),
    token: db.prepare('SELECT * FROM email_tokens WHERE token_hash = ? AND purpose = ?'),
    resetOf: db.prepare("SELECT * FROM email_tokens WHERE user_id = ? AND purpose = 'reset' AND used_at IS NULL ORDER BY expires_at DESC LIMIT 1"),
    failTry: db.prepare('UPDATE email_tokens SET attempts = attempts + 1 WHERE token_hash = ?'),
    useToken: db.prepare('UPDATE email_tokens SET used_at = ? WHERE token_hash = ?'),
    dropTokens: db.prepare('DELETE FROM email_tokens WHERE user_id = ? AND purpose = ? AND used_at IS NULL'),
    pruneTokens: db.prepare('DELETE FROM email_tokens WHERE expires_at < ?'),
  };

  // ---- rate limits (in memory) ----
  const hits = new Map();
  function limited(key, max, windowMs) {
    const now = Date.now();
    if (hits.size > 10000) for (const [k, r] of hits) if (r.reset < now) hits.delete(k);
    const r = hits.get(key);
    if (!r || r.reset < now) {
      hits.set(key, { count: 1, reset: now + windowMs });
      return false;
    }
    r.count += 1;
    return r.count > max;
  }

  function normalizeEmail(v) {
    if (v === null || v === '') return null;
    if (typeof v !== 'string') throw new HttpError(400, 'Ungültige E-Mail-Adresse');
    const e = v.trim();
    if (e.length > 254 || !EMAIL_RE.test(e)) throw new HttpError(400, 'Bitte eine gültige E-Mail-Adresse angeben');
    return e;
  }

  function newToken(userId, purpose, email, ttl) {
    q.pruneTokens.run(Date.now());
    q.dropTokens.run(userId, purpose);
    const token = crypto.randomBytes(32).toString('hex');
    q.insertToken.run(sha256(token), userId, purpose, email, Date.now() + ttl);
    return token;
  }

  /** 6-digit reset code; stored as "salt:hash" so the same code for two people never collides. */
  function newResetCode(userId, email) {
    q.pruneTokens.run(Date.now());
    q.dropTokens.run(userId, 'reset');
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    const salt = crypto.randomBytes(16).toString('hex');
    q.insertToken.run(`${salt}:${sha256(`${salt}:${code}`)}`, userId, 'reset', email, Date.now() + RESET_MS);
    return code;
  }
  function codeMatches(row, code) {
    const [salt, hash] = row.token_hash.split(':');
    if (!salt || !hash) return false;
    const a = Buffer.from(sha256(`${salt}:${code}`), 'hex');
    const b = Buffer.from(hash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  function useToken(token, purpose) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new HttpError(400, 'Dieser Link ist ungültig.');
    const t = q.token.get(sha256(token), purpose);
    if (!t || t.used_at) throw new HttpError(400, 'Dieser Link ist ungültig oder wurde schon benutzt.');
    if (t.expires_at < Date.now()) throw new HttpError(400, 'Dieser Link ist abgelaufen. Fordere einfach einen neuen an.');
    return t;
  }

  /** Mails go out in the background: the answer must not reveal (by timing) whether an account exists. */
  function deliver(mail) {
    mailer.send(mail).catch((err) => log.error('E-Mail konnte nicht gesendet werden:', err.message));
  }
  /** Sends and reports the outcome: { ok } or { error } – for actions of logged-in people, who should see a failure. */
  async function deliverChecked(mail) {
    try {
      await mailer.send(mail);
      return { ok: true };
    } catch (err) {
      log.error('E-Mail konnte nicht gesendet werden:', err.message);
      return { error: err.message };
    }
  }

  /** Returns null when mail is off, otherwise a promise of { ok } / { error }. */
  function sendVerify(user, email) {
    if (!enabled || !email) return null;
    const token = newToken(user.id, 'verify', email, VERIFY_MS);
    const { text, html } = renderMail({
      appUrl: base,
      preheader: 'Ein Klick, dann kannst du dich auch mit dieser Adresse anmelden.',
      eyebrow: 'E-Mail-Adresse',
      title: 'Bestätige deine E-Mail-Adresse',
      paragraphs: [
        `Hallo ${String(user.display_name).split(' ')[0]},`,
        'ein Tipp, und diese Adresse gehört zu deinem StayOnTrack-Konto. Danach kannst du dich auch mit ihr anmelden und ein vergessenes Passwort selbst zurücksetzen.',
      ],
      button: { label: 'E-Mail-Adresse bestätigen', link: `${base}/#/verify/${token}` },
      note: 'Der Link ist 7 Tage gültig. Du hast das nicht veranlasst? Dann ignoriere diese Mail einfach – es passiert nichts.',
    });
    return deliverChecked({ to: email, subject: 'Bitte bestätige deine E-Mail-Adresse', text, html });
  }

  /** Sets (or removes) an account's address; a new address is unconfirmed and gets a confirmation mail. */
  function setEmail(userId, value, { quiet = false } = {}) {
    const email = normalizeEmail(value);
    const u = q.byId.get(userId);
    if (email) {
      const clash = q.byEmail.get(email);
      if (clash && clash.id !== userId) throw new HttpError(409, 'Diese E-Mail-Adresse wird schon für ein anderes Konto verwendet');
    }
    const same = email && u.email && u.email.toLowerCase() === email.toLowerCase();
    if (same && u.email_verified) return { changed: false, verifySent: false, delivery: null };
    if (!same) {
      q.setEmail.run(email, 0, userId);
      q.dropTokens.run(userId, 'verify');
      q.dropTokens.run(userId, 'reset');
    }
    // new address – or the same one, still unconfirmed: (again) a confirmation mail
    const delivery = quiet ? null : sendVerify(u, email);
    return { changed: !same, verifySent: Boolean(delivery), delivery };
  }

  /** For login: an address (case-insensitive) or a username. */
  function findForLogin(login) {
    return login.includes('@') ? q.byEmail.get(login) : q.byName.get(login);
  }

  const routes = [
    // public: tells the login page whether "Passwort vergessen" works
    ['GET', /^\/api\/auth\/config$/, async () => ({ passwordReset: enabled })],

    ['POST', /^\/api\/password\/forgot$/, async (ctx) => {
      if (!enabled) throw new HttpError(503, 'Passwort-Zurücksetzen ist nicht eingerichtet. Wende dich an deinen Coach.');
      const { login } = await readBody(ctx.req);
      const key = typeof login === 'string' ? login.trim().toLowerCase().slice(0, 254) : '';
      if (!key) throw new HttpError(400, 'Bitte E-Mail-Adresse oder Benutzernamen angeben');
      if (limited(`ip:${clientIp(ctx.req)}`, 5, 15 * 60 * 1000)) throw new HttpError(429, 'Zu viele Anfragen. Bitte in 15 Minuten erneut versuchen.');
      const u = findForLogin(key);
      if (u && u.email && u.email_verified && !limited(`acct:${u.id}`, 3, 60 * 60 * 1000)) {
        const code = newResetCode(u.id, u.email);
        const { text, html } = renderMail({
          appUrl: base,
          preheader: `Dein Code: ${code} – 15 Minuten gültig.`,
          eyebrow: 'Passwort zurücksetzen',
          title: 'Dein Code',
          paragraphs: [
            `Hallo ${String(u.display_name).split(' ')[0]},`,
            'gib diesen Code in der App ein, um ein neues Passwort festzulegen.',
          ],
          code,
          codeHint: `Gültig für 15 Minuten · Benutzername ${u.username}`,
          note: 'Gib den Code niemandem weiter – auch nicht deinem Coach. Du hast das nicht angefordert? Dann ignoriere diese Mail, dein Passwort bleibt, wie es ist.',
        });
        deliver({ to: u.email, subject: `${code} ist dein StayOnTrack-Code`, text, html });
      }
      return { ok: true };
    }],

    // code from the mail + new password → password changed, logged out everywhere else, logged in here
    ['POST', /^\/api\/password\/reset$/, async (ctx) => {
      const { login, code, password } = await readBody(ctx.req);
      if (limited(`reset-ip:${clientIp(ctx.req)}`, 20, 15 * 60 * 1000)) throw new HttpError(429, 'Zu viele Versuche. Bitte in 15 Minuten erneut versuchen.');
      const wrong = 'Der Code ist falsch oder abgelaufen.';
      const key = typeof login === 'string' ? login.trim().slice(0, 254) : '';
      const c = typeof code === 'string' ? code.replace(/\D/g, '') : '';
      if (!key || c.length !== 6) throw new HttpError(400, 'Bitte den 6-stelligen Code aus der Mail eingeben.');
      const pw = validatePassword(password);
      const u = findForLogin(key);
      const t = u && q.resetOf.get(u.id);
      if (!t || t.expires_at < Date.now() || !u.email || u.email.toLowerCase() !== t.email.toLowerCase()) throw new HttpError(400, wrong);
      if (t.attempts >= RESET_TRIES) throw new HttpError(400, 'Zu viele Fehlversuche – fordere einen neuen Code an.');
      if (!codeMatches(t, c)) {
        q.failTry.run(t.token_hash);
        const left = RESET_TRIES - t.attempts - 1;
        if (left <= 0) {
          q.useToken.run(Date.now(), t.token_hash);
          throw new HttpError(400, 'Zu viele Fehlversuche – fordere einen neuen Code an.');
        }
        throw new HttpError(400, `${wrong} Noch ${left} ${left === 1 ? 'Versuch' : 'Versuche'}.`);
      }
      q.setPassword.run(hashPassword(pw), u.id);
      q.useToken.run(Date.now(), t.token_hash);
      q.dropTokens.run(u.id, 'reset');
      q.dropSessions.run(u.id); // log out everywhere …
      const user = startSession ? startSession(ctx, q.byId.get(u.id)) : null; // … and in here
      return { ok: true, username: u.username, user };
    }],

    ['POST', /^\/api\/email\/verify$/, async (ctx) => {
      const { token } = await readBody(ctx.req);
      const t = useToken(token, 'verify');
      const r = q.verify.run(t.user_id, t.email);
      q.useToken.run(Date.now(), sha256(token));
      if (!r.changes) throw new HttpError(400, 'Diese E-Mail-Adresse gehört nicht mehr zu deinem Konto.');
      return { ok: true, email: t.email };
    }],

    // own address: needs the current password
    ['PUT', /^\/api\/me\/email$/, async (ctx) => {
      const u = requireUser(ctx);
      const { email, password } = await readBody(ctx.req);
      if (typeof password !== 'string' || !verifyPassword(password, u.password_hash)) throw new HttpError(400, 'Passwort ist falsch');
      const { delivery, ...r } = setEmail(u.id, email);
      const sent = delivery ? await delivery : null;
      return { ...r, mail: enabled, mailError: sent && sent.error ? friendlyMailError(sent.error) : null };
    }],

    ['POST', /^\/api\/me\/email\/verify$/, async (ctx) => {
      const u = requireUser(ctx);
      if (!u.email) throw new HttpError(400, 'Du hast noch keine E-Mail-Adresse hinterlegt');
      if (u.email_verified) return { ok: true, alreadyVerified: true };
      if (!enabled) throw new HttpError(503, 'E-Mail-Versand ist nicht eingerichtet');
      if (limited(`verify:${u.id}`, 3, 60 * 60 * 1000)) throw new HttpError(429, 'Gerade erst gesendet – schau in dein Postfach (auch im Spam).');
      const sent = await sendVerify(u, u.email);
      if (sent && sent.error) throw new HttpError(502, friendlyMailError(sent.error));
      return { ok: true };
    }],

    // ---- Coach: is mail set up correctly? Shows the sender and sends a test mail with the real error, if any ----
    ['GET', /^\/api\/mail\/status$/, async (ctx) => {
      requireCoach(ctx);
      return { enabled, via: mailer.via || null, from: mailer.from || null, appUrl: base || null, warning: senderWarning() };
    }],
    ['POST', /^\/api\/mail\/test$/, async (ctx) => {
      const u = requireCoach(ctx);
      if (!enabled) throw new HttpError(503, base ? 'E-Mail ist nicht eingerichtet (RESEND_API_KEY bzw. SMTP_HOST und MAIL_FROM fehlen).' : 'APP_URL fehlt.');
      const { to } = await readBody(ctx.req);
      const target = normalizeEmail(typeof to === 'string' && to.trim() ? to : u.email);
      if (!target) throw new HttpError(400, 'Bitte eine E-Mail-Adresse angeben');
      if (limited(`mailtest:${u.id}`, 10, 60 * 60 * 1000)) throw new HttpError(429, 'Genug Test-Mails für diese Stunde.');
      const { text, html } = renderMail({
        appUrl: base,
        title: 'Test-Mail von StayOnTrack',
        paragraphs: ['Wenn du das liest, funktioniert der E-Mail-Versand.', `Absender: ${mailer.from}`],
        note: 'Diese Mail hast du selbst im Admin-Tool angefordert.',
      });
      const sent = await deliverChecked({ to: target, subject: 'Test-Mail von StayOnTrack', text, html });
      if (sent.error) throw new HttpError(502, friendlyMailError(sent.error));
      return { ok: true, to: target };
    }],
  ];

  /** The sender still the example from the README, or a domain that obviously isn't the own one. */
  function senderWarning() {
    const from = String(mailer.from || '');
    if (/deine-domain|example\.(com|org|de)|beispiel/i.test(from)) return `MAIL_FROM ist noch der Beispielwert (${from}). Trag deine eigene Absenderadresse ein.`;
    return null;
  }

  /** Mail provider errors in words people understand, with the original detail. */
  function friendlyMailError(msg) {
    const m = String(msg);
    const dom = m.match(/The ([^ ]+) domain is not verified/);
    if (dom) return `E-Mail konnte nicht gesendet werden: Die Absender-Domain ${dom[1]} ist bei Resend nicht bestätigt. Prüfe MAIL_FROM (aktuell ${mailer.from}).`;
    if (/\b401\b|API key is invalid|restricted_api_key/i.test(m)) return 'E-Mail konnte nicht gesendet werden: Der API-Schlüssel (RESEND_API_KEY) ist ungültig oder darf nicht senden.';
    return `E-Mail konnte nicht gesendet werden: ${m.slice(0, 200)}`;
  }

  return { routes, setEmail, findForLogin, enabled };
}

module.exports = { emailAuth };
