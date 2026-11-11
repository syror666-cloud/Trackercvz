'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { hashPassword, verifyPassword, createUser } = require('./db');

const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
const MAX_BODY = 64 * 1024;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Latest date a client may log: tomorrow in UTC, which covers every time zone's "today". */
function maxAllowedDate() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function numberField(value, { name, min, max, integer }) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new HttpError(400, `${name}: ungültige Zahl`);
  if (integer && !Number.isInteger(n)) throw new HttpError(400, `${name}: nur ganze Zahlen`);
  if (n < min || n > max) throw new HttpError(400, `${name}: muss zwischen ${min} und ${max} liegen`);
  return n;
}

function textField(value, { name, max }) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') throw new HttpError(400, `${name}: ungültiger Text`);
  const t = value.trim();
  if (t.length > max) throw new HttpError(400, `${name}: maximal ${max} Zeichen`);
  return t || null;
}

function validateUsername(u) {
  if (typeof u !== 'string' || !/^[a-zA-Z0-9._-]{3,32}$/.test(u)) {
    throw new HttpError(400, 'Benutzername: 3–32 Zeichen, nur Buchstaben, Ziffern, . _ -');
  }
  return u;
}

function validatePassword(p) {
  if (typeof p !== 'string' || p.length < 8 || p.length > 200) {
    throw new HttpError(400, 'Passwort: mindestens 8 Zeichen');
  }
  return p;
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Anfrage zu groß'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
        resolve(parsed);
      } catch {
        reject(new HttpError(400, 'Ungültiges JSON'));
      }
    });
    req.on('error', reject);
  });
}

function entryRow(r) {
  return {
    date: r.date,
    weight: r.weight,
    steps: r.steps,
    sleep: r.sleep,
    note: r.note,
    updatedAt: r.updated_at,
  };
}

function goalsRow(r) {
  return {
    targetWeight: r ? r.target_weight : null,
    stepsGoal: r ? r.steps_goal : null,
    sleepGoal: r ? r.sleep_goal : null,
  };
}

const publicUser = (u) => ({ id: u.id, username: u.username, displayName: u.display_name, role: u.role });

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function createApp({ db, publicDir, secureCookies = false, trustProxy = false }) {
  const q = {
    sessionUser: db.prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`
    ),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    deleteUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?'),
    deleteAllUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    setPassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
    setDisplayName: db.prepare('UPDATE users SET display_name = ? WHERE id = ?'),
    deleteUser: db.prepare("DELETE FROM users WHERE id = ? AND role = 'client'"),
    clients: db.prepare(
      `SELECT u.id, u.username, u.display_name, u.created_at,
         (SELECT MAX(date) FROM entries e WHERE e.user_id = u.id) AS last_entry,
         (SELECT weight FROM entries e WHERE e.user_id = u.id AND weight IS NOT NULL ORDER BY date DESC LIMIT 1) AS last_weight,
         (SELECT weight FROM entries e WHERE e.user_id = u.id AND weight IS NOT NULL ORDER BY date ASC LIMIT 1) AS first_weight,
         (SELECT COUNT(*) FROM entries e WHERE e.user_id = u.id AND e.date > date('now', '-7 days')) AS entries_7d,
         (SELECT AVG(steps) FROM entries e WHERE e.user_id = u.id AND steps IS NOT NULL AND e.date > date('now', '-7 days')) AS avg_steps_7d,
         (SELECT AVG(sleep) FROM entries e WHERE e.user_id = u.id AND sleep IS NOT NULL AND e.date > date('now', '-7 days')) AS avg_sleep_7d,
         (SELECT COUNT(*) FROM messages m WHERE m.client_id = u.id AND m.sender_id = u.id AND m.read_at IS NULL) AS unread_messages
       FROM users u WHERE u.role = 'client' ORDER BY u.display_name COLLATE NOCASE`
    ),
    entries: db.prepare('SELECT * FROM entries WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date ASC'),
    entry: db.prepare('SELECT * FROM entries WHERE user_id = ? AND date = ?'),
    upsertEntry: db.prepare(
      `INSERT INTO entries (user_id, date, weight, steps, sleep, note, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT (user_id, date) DO UPDATE SET
         weight = excluded.weight, steps = excluded.steps, sleep = excluded.sleep,
         note = excluded.note, updated_at = excluded.updated_at`
    ),
    deleteEntry: db.prepare('DELETE FROM entries WHERE user_id = ? AND date = ?'),
    goals: db.prepare('SELECT * FROM goals WHERE user_id = ?'),
    messages: db.prepare(
      `SELECT m.*, u.role AS sender_role, u.display_name AS sender_name
       FROM messages m JOIN users u ON u.id = m.sender_id
       WHERE m.client_id = ? AND m.id > ? ORDER BY m.id ASC LIMIT 500`
    ),
    lastMessages: db.prepare(
      `SELECT * FROM (
         SELECT m.*, u.role AS sender_role, u.display_name AS sender_name
         FROM messages m JOIN users u ON u.id = m.sender_id
         WHERE m.client_id = ? ORDER BY m.id DESC LIMIT 300
       ) ORDER BY id ASC`
    ),
    insertMessage: db.prepare('INSERT INTO messages (client_id, sender_id, body) VALUES (?, ?, ?)'),
    markRead: db.prepare(
      `UPDATE messages SET read_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE client_id = ? AND sender_id <> ? AND read_at IS NULL`
    ),
    unreadForClient: db.prepare(
      'SELECT COUNT(*) AS n FROM messages WHERE client_id = ? AND sender_id <> ? AND read_at IS NULL'
    ),
    unreadForCoach: db.prepare(
      `SELECT COUNT(*) AS n FROM messages m JOIN users u ON u.id = m.sender_id
       WHERE u.role = 'client' AND m.read_at IS NULL`
    ),
    upsertGoals: db.prepare(
      `INSERT INTO goals (user_id, target_weight, steps_goal, sleep_goal) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         target_weight = excluded.target_weight, steps_goal = excluded.steps_goal, sleep_goal = excluded.sleep_goal`
    ),
  };

  const loginAttempts = new Map();

  function cookie(token, maxAgeSec) {
    const parts = [`sid=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSec}`];
    if (secureCookies) parts.push('Secure');
    return parts.join('; ');
  }

  function currentUser(req) {
    const token = parseCookies(req.headers.cookie).sid;
    if (!token) return null;
    const u = q.sessionUser.get(sha256(token), Date.now());
    return u ? { ...u, tokenHash: sha256(token) } : null;
  }

  function requireUser(ctx) {
    if (!ctx.user) throw new HttpError(401, 'Nicht angemeldet');
    return ctx.user;
  }

  function requireCoach(ctx) {
    const u = requireUser(ctx);
    if (u.role !== 'coach') throw new HttpError(403, 'Nur für Coaches');
    return u;
  }

  /** Which client's data a request is about: clients always see themselves, coaches pick one. */
  function targetClient(ctx) {
    const u = requireUser(ctx);
    if (u.role === 'client') return u;
    const id = Number(ctx.url.searchParams.get('userId'));
    const c = Number.isInteger(id) ? q.userById.get(id) : null;
    if (!c || c.role !== 'client') throw new HttpError(404, 'Klient nicht gefunden');
    return c;
  }

  function clientById(id) {
    const c = q.userById.get(Number(id));
    if (!c || c.role !== 'client') throw new HttpError(404, 'Klient nicht gefunden');
    return c;
  }

  function rangeParams(url) {
    const from = url.searchParams.get('from') || '0000-01-01';
    const to = url.searchParams.get('to') || '9999-12-31';
    if (!isValidDate(from) && from !== '0000-01-01') throw new HttpError(400, 'Ungültiges Startdatum');
    if (!isValidDate(to) && to !== '9999-12-31') throw new HttpError(400, 'Ungültiges Enddatum');
    return { from, to };
  }

  function checkLoginRate(ip) {
    const now = Date.now();
    const rec = loginAttempts.get(ip);
    if (!rec || rec.reset < now) {
      loginAttempts.set(ip, { count: 1, reset: now + LOGIN_WINDOW_MS });
      return;
    }
    rec.count += 1;
    if (rec.count > LOGIN_MAX_ATTEMPTS) {
      throw new HttpError(429, 'Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.');
    }
  }

  const routes = [
    ['POST', /^\/api\/login$/, async (ctx) => {
      // Behind a hosting proxy every request arrives from the proxy's address; use the forwarded client IP.
      const forwarded = trustProxy ? String(ctx.req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
      const ip = forwarded || ctx.req.socket.remoteAddress || 'unknown';
      checkLoginRate(ip);
      const { username, password } = await readBody(ctx.req);
      const u = typeof username === 'string' ? q.userByName.get(username.trim()) : null;
      if (!u || typeof password !== 'string' || !verifyPassword(password, u.password_hash)) {
        throw new HttpError(401, 'Benutzername oder Passwort falsch');
      }
      loginAttempts.delete(ip);
      q.deleteExpiredSessions.run(Date.now());
      const token = crypto.randomBytes(32).toString('hex');
      q.insertSession.run(sha256(token), u.id, Date.now() + SESSION_MS);
      ctx.res.setHeader('Set-Cookie', cookie(token, SESSION_MS / 1000));
      return { user: publicUser(u) };
    }],

    ['POST', /^\/api\/logout$/, async (ctx) => {
      if (ctx.user) q.deleteSession.run(ctx.user.tokenHash);
      ctx.res.setHeader('Set-Cookie', cookie('', 0));
      return { ok: true };
    }],

    ['GET', /^\/api\/me$/, async (ctx) => ({ user: publicUser(requireUser(ctx)) })],

    ['POST', /^\/api\/me\/password$/, async (ctx) => {
      const u = requireUser(ctx);
      const { currentPassword, newPassword } = await readBody(ctx.req);
      if (typeof currentPassword !== 'string' || !verifyPassword(currentPassword, u.password_hash)) {
        throw new HttpError(400, 'Aktuelles Passwort ist falsch');
      }
      q.setPassword.run(hashPassword(validatePassword(newPassword)), u.id);
      q.deleteUserSessions.run(u.id, u.tokenHash);
      return { ok: true };
    }],

    // ---- Coach: client management ----
    ['GET', /^\/api\/clients$/, async (ctx) => {
      requireCoach(ctx);
      return {
        clients: q.clients.all().map((r) => ({
          id: r.id,
          username: r.username,
          displayName: r.display_name,
          createdAt: r.created_at,
          lastEntry: r.last_entry,
          lastWeight: r.last_weight,
          firstWeight: r.first_weight,
          entries7d: r.entries_7d,
          avgSteps7d: r.avg_steps_7d,
          avgSleep7d: r.avg_sleep_7d,
          unreadMessages: r.unread_messages,
        })),
      };
    }],

    ['POST', /^\/api\/clients$/, async (ctx) => {
      requireCoach(ctx);
      const body = await readBody(ctx.req);
      const username = validateUsername(body.username);
      const password = validatePassword(body.password);
      const displayName = textField(body.displayName, { name: 'Name', max: 80 }) || username;
      if (q.userByName.get(username)) throw new HttpError(409, 'Benutzername ist bereits vergeben');
      const id = createUser(db, { username, displayName, password, role: 'client' });
      ctx.res.statusCode = 201;
      return { client: publicUser(q.userById.get(id)) };
    }],

    ['PATCH', /^\/api\/clients\/(\d+)$/, async (ctx, [, id]) => {
      requireCoach(ctx);
      const c = clientById(id);
      const body = await readBody(ctx.req);
      if (body.displayName !== undefined) {
        const name = textField(body.displayName, { name: 'Name', max: 80 });
        if (!name) throw new HttpError(400, 'Name darf nicht leer sein');
        q.setDisplayName.run(name, c.id);
      }
      if (body.password !== undefined) {
        q.setPassword.run(hashPassword(validatePassword(body.password)), c.id);
        q.deleteAllUserSessions.run(c.id);
      }
      return { client: publicUser(q.userById.get(c.id)) };
    }],

    ['DELETE', /^\/api\/clients\/(\d+)$/, async (ctx, [, id]) => {
      requireCoach(ctx);
      const c = clientById(id);
      q.deleteUser.run(c.id);
      return { ok: true };
    }],

    // ---- Goals ----
    ['GET', /^\/api\/goals$/, async (ctx) => ({ goals: goalsRow(q.goals.get(targetClient(ctx).id)) })],

    ['PUT', /^\/api\/goals$/, async (ctx) => {
      requireCoach(ctx);
      const c = targetClient(ctx);
      const body = await readBody(ctx.req);
      const g = {
        targetWeight: numberField(body.targetWeight, { name: 'Zielgewicht', min: 20, max: 400 }) ?? null,
        stepsGoal: numberField(body.stepsGoal, { name: 'Schrittziel', min: 0, max: 200000, integer: true }) ?? null,
        sleepGoal: numberField(body.sleepGoal, { name: 'Schlafziel', min: 0, max: 24 }) ?? null,
      };
      q.upsertGoals.run(c.id, g.targetWeight, g.stepsGoal, g.sleepGoal);
      return { goals: g };
    }],

    // ---- Messages (one thread per client, between client and coach) ----
    ['GET', /^\/api\/messages\/unread$/, async (ctx) => {
      const u = requireUser(ctx);
      const n = u.role === 'coach' ? q.unreadForCoach.get().n : q.unreadForClient.get(u.id, u.id).n;
      return { unread: n };
    }],

    ['GET', /^\/api\/messages$/, async (ctx) => {
      const u = requireUser(ctx);
      const c = targetClient(ctx);
      const after = Number(ctx.url.searchParams.get('after')) || 0;
      q.markRead.run(c.id, u.id);
      const rows = after > 0 ? q.messages.all(c.id, after) : q.lastMessages.all(c.id);
      return {
        messages: rows.map((m) => ({
          id: m.id,
          body: m.body,
          createdAt: m.created_at,
          readAt: m.read_at,
          fromCoach: m.sender_role === 'coach',
          senderName: m.sender_name,
          mine: m.sender_id === u.id,
        })),
      };
    }],

    ['POST', /^\/api\/messages$/, async (ctx) => {
      const u = requireUser(ctx);
      const c = targetClient(ctx);
      const body = textField((await readBody(ctx.req)).body, { name: 'Nachricht', max: 2000 });
      if (!body) throw new HttpError(400, 'Nachricht darf nicht leer sein');
      const id = Number(q.insertMessage.run(c.id, u.id, body).lastInsertRowid);
      ctx.res.statusCode = 201;
      return { id };
    }],

    // ---- Entries ----
    ['GET', /^\/api\/entries$/, async (ctx) => {
      const c = targetClient(ctx);
      const { from, to } = rangeParams(ctx.url);
      return { entries: q.entries.all(c.id, from, to).map(entryRow) };
    }],

    ['GET', /^\/api\/entries\.csv$/, async (ctx) => {
      const c = targetClient(ctx);
      const { from, to } = rangeParams(ctx.url);
      const lines = ['Datum;Gewicht (kg);Schritte;Schlaf (h);Notiz'];
      for (const r of q.entries.all(c.id, from, to)) {
        const num = (v) => (v === null ? '' : String(v).replace('.', ','));
        lines.push([r.date, num(r.weight), r.steps ?? '', num(r.sleep), csvCell(r.note)].join(';'));
      }
      const safeName = c.username.replace(/[^a-zA-Z0-9._-]/g, '_');
      ctx.res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="tracker-${safeName}.csv"`,
      });
      ctx.res.end('﻿' + lines.join('\r\n') + '\r\n');
      return undefined;
    }],

    ['PUT', /^\/api\/entries\/(\d{4}-\d{2}-\d{2})$/, async (ctx, [, date]) => {
      const u = requireUser(ctx);
      if (u.role !== 'client') throw new HttpError(403, 'Nur Klienten können Einträge erfassen');
      if (!isValidDate(date)) throw new HttpError(400, 'Ungültiges Datum');
      if (date > maxAllowedDate()) throw new HttpError(400, 'Einträge in der Zukunft sind nicht möglich');
      const body = await readBody(ctx.req);
      const incoming = {
        weight: numberField(body.weight, { name: 'Gewicht', min: 20, max: 400 }),
        steps: numberField(body.steps, { name: 'Schritte', min: 0, max: 200000, integer: true }),
        sleep: numberField(body.sleep, { name: 'Schlaf', min: 0, max: 24 }),
        note: textField(body.note, { name: 'Notiz', max: 500 }),
      };
      // Fields left out keep their saved value; null clears them.
      const existing = q.entry.get(u.id, date) || {};
      const merged = {};
      for (const k of Object.keys(incoming)) merged[k] = incoming[k] !== undefined ? incoming[k] : existing[k] ?? null;
      if (merged.weight === null && merged.steps === null && merged.sleep === null && merged.note === null) {
        q.deleteEntry.run(u.id, date);
        return { entry: null };
      }
      q.upsertEntry.run(u.id, date, merged.weight, merged.steps, merged.sleep, merged.note);
      return { entry: entryRow(q.entry.get(u.id, date)) };
    }],

    ['DELETE', /^\/api\/entries\/(\d{4}-\d{2}-\d{2})$/, async (ctx, [, date]) => {
      const u = requireUser(ctx);
      if (u.role !== 'client') throw new HttpError(403, 'Nur Klienten können Einträge löschen');
      q.deleteEntry.run(u.id, date);
      return { ok: true };
    }],
  ];

  const root = path.resolve(publicDir);

  function serveStatic(req, res, pathname) {
    let rel;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      rel = '/';
    }
    let file = path.resolve(root, '.' + rel);
    if (file !== root && !file.startsWith(root + path.sep)) file = path.join(root, 'index.html');
    let stat = fs.statSync(file, { throwIfNoEntry: false });
    if (!stat || stat.isDirectory()) {
      // Single-page app: unknown paths fall back to index.html.
      file = path.join(root, 'index.html');
      stat = fs.statSync(file);
    }
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }

  return async function handler(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'"
    );

    const url = new URL(req.url, 'http://localhost');
    try {
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Methode nicht erlaubt');
        return serveStatic(req, res, url.pathname);
      }

      // Mutating API calls must be JSON; together with SameSite=Strict cookies this blocks CSRF.
      if (!['GET', 'HEAD'].includes(req.method)) {
        const ct = String(req.headers['content-type'] || '');
        const hasBody = Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding'];
        if (hasBody && !ct.startsWith('application/json')) throw new HttpError(415, 'Nur JSON erlaubt');
      }

      const ctx = { req, res, url, user: currentUser(req) };
      for (const [method, re, fn] of routes) {
        const m = url.pathname.match(re);
        if (m && method === req.method) {
          const result = await fn(ctx, m);
          if (result !== undefined) {
            res.writeHead(res.statusCode || 200, {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'no-store',
            });
            res.end(JSON.stringify(result));
          }
          return;
        }
      }
      throw new HttpError(404, 'Nicht gefunden');
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      if (res.headersSent) return res.end();
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: status === 500 ? 'Interner Fehler' : err.message }));
    }
  };
}

module.exports = { createApp, isValidDate };
