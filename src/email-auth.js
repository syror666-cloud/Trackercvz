'use strict';

/**
 * E-mail address per account: log in with it, confirm it, reset a forgotten password.
 *
 * Security:
 *  - links carry a random 256-bit token; only its SHA-256 hash is stored; one-time use
 *  - reset links expire after 60 minutes, confirmation links after 7 days
 *  - a reset mail only goes to a CONFIRMED address (a typo can't hand an account to a stranger)
 *  - "forgot password" answers the same whether or not the account exists (no enumeration),
 *    and is rate-limited per address and per account
 *  - changing the own address needs the current password; a reset ends all sessions
 */

const crypto = require('node:crypto');
const { hashPassword, verifyPassword } = require('./db');
const { mailBody } = require('./mail');

const RESET_MS = 60 * 60 * 1000;
const VERIFY_MS = 7 * 24 * 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@<>()[\],;:"]{1,64}@[^\s@<>()[\],;:"]{1,253}\.[^\s@<>()[\],;:"]{2,63}$/;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function emailAuth({ db, HttpError, readBody, requireUser, mailer, appUrl, clientIp, validatePassword, log = console }) {
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

  function sendVerify(user, email) {
    if (!enabled || !email) return false;
    const token = newToken(user.id, 'verify', email, VERIFY_MS);
    const { text, html } = mailBody({
      greeting: `Hallo ${user.display_name},`,
      lines: ['bitte bestätige, dass diese E-Mail-Adresse zu deinem StayOnTrack-Konto gehört. Damit kannst du dich auch mit ihr anmelden und ein vergessenes Passwort zurücksetzen.'],
      button: 'E-Mail-Adresse bestätigen',
      link: `${base}/#/verify/${token}`,
      footer: 'Der Link ist 7 Tage gültig. Du hast das nicht veranlasst? Dann ignoriere diese Mail einfach.',
    });
    deliver({ to: email, subject: 'Bitte bestätige deine E-Mail-Adresse', text, html });
    return true;
  }

  /** Sets (or removes) an account's address; a new address is unconfirmed and gets a confirmation mail. */
  function setEmail(userId, value) {
    const email = normalizeEmail(value);
    const u = q.byId.get(userId);
    if (email) {
      const clash = q.byEmail.get(email);
      if (clash && clash.id !== userId) throw new HttpError(409, 'Diese E-Mail-Adresse wird schon für ein anderes Konto verwendet');
    }
    const same = email && u.email && u.email.toLowerCase() === email.toLowerCase();
    if (same) return { changed: false, verifySent: false };
    q.setEmail.run(email, 0, userId);
    q.dropTokens.run(userId, 'verify');
    q.dropTokens.run(userId, 'reset');
    return { changed: true, verifySent: sendVerify(u, email) };
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
        const token = newToken(u.id, 'reset', u.email, RESET_MS);
        const { text, html } = mailBody({
          greeting: `Hallo ${u.display_name},`,
          lines: ['jemand – hoffentlich du – möchte das Passwort für dein StayOnTrack-Konto zurücksetzen.', `Dein Benutzername: ${u.username}`],
          button: 'Neues Passwort festlegen',
          link: `${base}/#/reset/${token}`,
          footer: 'Der Link ist 60 Minuten gültig und funktioniert nur einmal. Du warst das nicht? Dann ignoriere diese Mail – dein Passwort bleibt unverändert.',
        });
        deliver({ to: u.email, subject: 'Passwort zurücksetzen', text, html });
      }
      return { ok: true };
    }],

    ['POST', /^\/api\/password\/reset$/, async (ctx) => {
      const { token, password } = await readBody(ctx.req);
      if (limited(`reset-ip:${clientIp(ctx.req)}`, 20, 15 * 60 * 1000)) throw new HttpError(429, 'Zu viele Versuche. Bitte später erneut versuchen.');
      const t = useToken(token, 'reset');
      const pw = validatePassword(password);
      const u = q.byId.get(t.user_id);
      if (!u || !u.email || u.email.toLowerCase() !== t.email.toLowerCase()) throw new HttpError(400, 'Dieser Link ist nicht mehr gültig.');
      q.setPassword.run(hashPassword(pw), u.id);
      q.useToken.run(Date.now(), sha256(token));
      q.dropTokens.run(u.id, 'reset');
      q.dropSessions.run(u.id); // log out everywhere
      return { ok: true, username: u.username };
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
      const r = setEmail(u.id, email);
      return { ...r, mail: enabled };
    }],

    ['POST', /^\/api\/me\/email\/verify$/, async (ctx) => {
      const u = requireUser(ctx);
      if (!u.email) throw new HttpError(400, 'Du hast noch keine E-Mail-Adresse hinterlegt');
      if (u.email_verified) return { ok: true, alreadyVerified: true };
      if (!enabled) throw new HttpError(503, 'E-Mail-Versand ist nicht eingerichtet');
      if (limited(`verify:${u.id}`, 3, 60 * 60 * 1000)) throw new HttpError(429, 'Gerade erst gesendet – schau in dein Postfach (auch im Spam).');
      sendVerify(u, u.email);
      return { ok: true };
    }],
  ];

  return { routes, setEmail, findForLogin, enabled };
}

module.exports = { emailAuth };
