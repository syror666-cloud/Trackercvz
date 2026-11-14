'use strict';

/**
 * Invitation links: the coach invites a client by link (and, with an address, by e-mail); the client picks their
 * own username and password. No more passing on start passwords.
 *
 * - One-time link with a random 256-bit token; only its hash is stored; valid 14 days; the coach can withdraw it.
 * - If the invitation was e-mailed and the client keeps that address, it counts as confirmed (they got the mail).
 * - Accepting is rate-limited per address; the new client is logged in straight away.
 */

const crypto = require('node:crypto');
const { createUser } = require('./db');
const { renderMail } = require('./mail');

const VALID_MS = 14 * 24 * 60 * 60 * 1000;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function inviteRoutes({ db, HttpError, readBody, textField, requireCoach, notifier, mailer, appUrl, clientIp,
  validateUsername, validatePassword, startSession, setEmail, log = console }) {
  const base = appUrl ? appUrl.replace(/\/+$/, '') : '';
  const q = {
    insert: db.prepare('INSERT INTO invites (token_hash, display_name, email, created_by, expires_at) VALUES (?, ?, ?, ?, ?)'),
    byHash: db.prepare('SELECT * FROM invites WHERE token_hash = ?'),
    byId: db.prepare('SELECT * FROM invites WHERE id = ?'),
    open: db.prepare('SELECT * FROM invites WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > ? ORDER BY id DESC'),
    use: db.prepare("UPDATE invites SET used_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), user_id = ? WHERE id = ? AND used_at IS NULL"),
    revoke: db.prepare("UPDATE invites SET revoked_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ? AND used_at IS NULL"),
    renew: db.prepare('UPDATE invites SET token_hash = ?, expires_at = ? WHERE id = ?'),
    userByName: db.prepare('SELECT 1 FROM users WHERE username = ?'),
    coachName: db.prepare('SELECT display_name FROM users WHERE id = ?'),
    verify: db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?'),
  };
  const hits = new Map();
  const limited = (key, max, windowMs) => {
    const now = Date.now();
    const r = hits.get(key);
    if (!r || r.reset < now) {
      hits.set(key, { count: 1, reset: now + windowMs });
      return false;
    }
    return ++r.count > max;
  };

  const row = (i) => ({
    id: i.id, displayName: i.display_name, email: i.email, createdAt: i.created_at,
    expiresAt: new Date(i.expires_at).toISOString(), mailed: Boolean(i.mailed_at),
  });

  function find(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{30,80}$/.test(token)) return null;
    const i = q.byHash.get(sha256(token));
    if (!i || i.used_at || i.revoked_at || i.expires_at < Date.now()) return null;
    return i;
  }

  async function mailInvite(invite, token, coach) {
    if (!invite.email || !mailer || !mailer.enabled || !base) return false;
    const first = String(invite.display_name).split(' ')[0];
    const { text, html } = renderMail({
      appUrl: base,
      eyebrow: 'Einladung',
      title: `${coach} lädt dich zu StayOnTrack ein`,
      preheader: 'Leg dein Konto an – dauert eine Minute.',
      paragraphs: [
        `Hallo ${first},`,
        `${coach} begleitet dich ab jetzt mit StayOnTrack: Gewicht, Schritte, Schlaf, Ernährung und Training an einem Ort – mit Plan, wöchentlichem Check-in und direktem Draht zu deinem Coach.`,
        'Tipp auf den Button, wähl einen Benutzernamen und ein Passwort – fertig.',
      ],
      button: { label: 'Konto anlegen', link: `${base}/#/invite/${token}` },
      note: 'Der Link gilt 14 Tage und funktioniert nur einmal. Du kennst den Absender nicht? Dann ignoriere diese Mail einfach.',
    });
    await mailer.send({ to: invite.email, subject: `${coach} lädt dich zu StayOnTrack ein`, text, html });
    db.prepare("UPDATE invites SET mailed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?").run(invite.id);
    return true;
  }

  function newToken() {
    return crypto.randomBytes(32).toString('base64url');
  }

  return [
    ['GET', /^\/api\/invites$/, async (ctx) => {
      requireCoach(ctx);
      return { invites: q.open.all(Date.now()).map(row) };
    }],

    ['POST', /^\/api\/invites$/, async (ctx) => {
      const coach = requireCoach(ctx);
      const b = await readBody(ctx.req);
      const displayName = textField(b.displayName, { name: 'Name', max: 80 });
      if (!displayName) throw new HttpError(400, 'Bitte einen Namen angeben');
      let email = null;
      if (b.email) {
        email = String(b.email).trim();
        if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new HttpError(400, 'Bitte eine gültige E-Mail-Adresse angeben');
        if (db.prepare('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE').get(email)) throw new HttpError(409, 'Diese E-Mail-Adresse hat schon ein Konto');
      }
      const token = newToken();
      const id = Number(q.insert.run(sha256(token), displayName, email, coach.id, Date.now() + VALID_MS).lastInsertRowid);
      let mailed = false;
      let mailError = null;
      if (email) {
        try {
          mailed = await mailInvite(q.byId.get(id), token, coach.display_name);
        } catch (err) {
          mailError = String(err.message).slice(0, 200);
          log.error('Einladung: E-Mail fehlgeschlagen –', mailError);
        }
      }
      ctx.res.statusCode = 201;
      return { invite: row(q.byId.get(id)), token, link: base ? `${base}/#/invite/${token}` : null, mailed, mailError };
    }],

    // a fresh link for an open invitation (the old one stops working)
    ['POST', /^\/api\/invites\/(\d+)\/renew$/, async (ctx, [, id]) => {
      const coach = requireCoach(ctx);
      const i = q.byId.get(Number(id));
      if (!i || i.used_at || i.revoked_at) throw new HttpError(404, 'Einladung nicht gefunden');
      const token = newToken();
      q.renew.run(sha256(token), Date.now() + VALID_MS, i.id);
      let mailed = false;
      if (i.email) mailed = await mailInvite(q.byId.get(i.id), token, coach.display_name).catch(() => false);
      return { invite: row(q.byId.get(i.id)), token, link: base ? `${base}/#/invite/${token}` : null, mailed };
    }],

    ['DELETE', /^\/api\/invites\/(\d+)$/, async (ctx, [, id]) => {
      requireCoach(ctx);
      q.revoke.run(Number(id));
      return { invites: q.open.all(Date.now()).map(row) };
    }],

    // public: what the invitation page shows
    ['GET', /^\/api\/invite$/, async (ctx) => {
      const i = find(ctx.url.searchParams.get('token'));
      if (!i) throw new HttpError(404, 'Diese Einladung ist ungültig, abgelaufen oder wurde schon benutzt. Frag deinen Coach nach einem neuen Link.');
      const coach = (q.coachName.get(i.created_by) || {}).display_name || 'Dein Coach';
      const suggestion = String(i.display_name).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '').slice(0, 32);
      return { displayName: i.display_name, email: i.email, coach, usernameSuggestion: suggestion.length >= 3 ? suggestion : '' };
    }],

    // public: create the account from the invitation
    ['POST', /^\/api\/invite\/accept$/, async (ctx) => {
      if (limited(`ip:${clientIp(ctx.req)}`, 10, 15 * 60 * 1000)) throw new HttpError(429, 'Zu viele Versuche. Bitte in 15 Minuten erneut versuchen.');
      const b = await readBody(ctx.req);
      const i = find(b.token);
      if (!i) throw new HttpError(404, 'Diese Einladung ist ungültig, abgelaufen oder wurde schon benutzt.');
      const username = validateUsername(typeof b.username === 'string' ? b.username.trim() : b.username);
      const password = validatePassword(b.password);
      if (b.consent !== true) throw new HttpError(400, 'Bitte stimme der Datenschutzerklärung zu');
      if (q.userByName.get(username)) throw new HttpError(409, 'Dieser Benutzername ist schon vergeben');
      const displayName = textField(b.displayName, { name: 'Name', max: 80 }) || i.display_name;
      const email = typeof b.email === 'string' && b.email.trim() ? b.email.trim() : null;
      db.exec('BEGIN');
      let userId;
      try {
        userId = createUser(db, { username, displayName, password, role: 'client' });
        if (!q.use.run(userId, i.id).changes) throw new HttpError(409, 'Diese Einladung wurde gerade schon benutzt');
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      let emailNote = null;
      if (email) {
        try {
          const sameAsInvite = i.email && i.mailed_at && i.email.toLowerCase() === email.toLowerCase();
          const r = setEmail(userId, email, { quiet: sameAsInvite });
          if (sameAsInvite) q.verify.run(userId); // the invitation reached this address: confirmed
          else if (r.delivery) r.delivery.catch(() => {});
        } catch (err) {
          emailNote = err.message; // the account exists anyway; the address can be added later
        }
      }
      notifier.sendToUsers(notifier.coachIds(), { title: '🎉 Einladung angenommen', body: `${displayName} ist jetzt dabei.`, url: `/#/client/${userId}` }).catch(() => {});
      return { user: startSession(ctx, db.prepare('SELECT * FROM users WHERE id = ?').get(userId)), emailNote };
    }],
  ];
}

module.exports = { inviteRoutes };
