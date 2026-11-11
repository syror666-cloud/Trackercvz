'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { hashPassword, verifyPassword, createUser } = require('./db');
const { createNotifier } = require('./notify');
const { isAllowedEndpoint } = require('./push');
const { nextRecurringRun, localDate } = require('./schedule');
const { weekComparison } = require('./weekstats');
const { nutritionRoutes } = require('./nutrition');
const { createReminders, adminRoutes } = require('./admin');
const { metricsModule, CATEGORIES } = require('./metrics');

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
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.jpg': 'image/jpeg',
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
    caloriesOk: r.calories_ok === null || r.calories_ok === undefined ? null : Boolean(r.calories_ok),
    calories: r.calories ?? null,
    training: r.training === null || r.training === undefined ? null : Boolean(r.training),
    updatedAt: r.updated_at,
  };
}

/** Yes/no answers: true/false, null clears, undefined keeps the saved value. Stored as 1/0. */
function boolField(value, name) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'boolean') throw new HttpError(400, `${name}: nur Ja oder Nein`);
  return value ? 1 : 0;
}

function goalsRow(r) {
  return {
    targetWeight: r ? r.target_weight : null,
    stepsGoal: r ? r.steps_goal : null,
    sleepGoal: r ? r.sleep_goal : null,
    caloriesMin: r ? r.calories_min ?? null : null,
    caloriesMax: r ? r.calories_max ?? null : null,
  };
}

const PLAN_FIELDS = {
  caloriesMin: { name: 'Kalorien (von)', min: 800, max: 8000, integer: true },
  caloriesMax: { name: 'Kalorien (bis)', min: 800, max: 8000, integer: true },
  stepsGoal: { name: 'Schrittziel', min: 0, max: 200000, integer: true, unit: 'Schritte', label: 'Schritte pro Tag' },
  sleepGoal: { name: 'Schlafziel', min: 0, max: 24, unit: 'Std.', label: 'Schlaf pro Nacht' },
  targetWeight: { name: 'Zielgewicht', min: 20, max: 400, unit: 'kg', label: 'Zielgewicht' },
};

/**
 * Validates plan values from a request. A single calorie value becomes a range with equal bounds.
 * Keys that are missing stay undefined.
 */
function parsePlan(raw) {
  const p = {};
  for (const [k, spec] of Object.entries(PLAN_FIELDS)) p[k] = numberField(raw[k], spec);
  const lo = p.caloriesMin ?? null;
  const hi = p.caloriesMax ?? null;
  if (lo !== null || hi !== null) {
    p.caloriesMin = lo ?? hi;
    p.caloriesMax = hi ?? lo;
    if (p.caloriesMin > p.caloriesMax) throw new HttpError(400, 'Kalorien: „von“ muss kleiner als „bis“ sein');
  }
  return p;
}

/** Older check-ins stored a single calorie goal; read it as a range. */
function normalizePlan(obj) {
  const o = { ...obj };
  if ('caloriesGoal' in o) {
    if (!('caloriesMin' in o)) {
      o.caloriesMin = o.caloriesGoal;
      o.caloriesMax = o.caloriesGoal;
    }
    delete o.caloriesGoal;
  }
  return o;
}

const de = (v, d = 0) => Number(v).toLocaleString('de-DE', { maximumFractionDigits: d });

function fmtKcalRange(min, max) {
  if (min === null || min === undefined) return '–';
  return min === max ? `${de(min)} kcal` : `${de(min)}–${de(max)} kcal`;
}

function fmtPlanValue(key, v) {
  if (v === null || v === undefined) return '–';
  const d = key === 'sleepGoal' || key === 'targetWeight' ? 1 : 0;
  return `${de(v, d)} ${PLAN_FIELDS[key].unit}`;
}

/** Proposed plan changes as {label, before, after}; the calorie range counts as one item. */
function proposalItems(previous, proposal) {
  const items = [];
  if ('caloriesMin' in proposal || 'caloriesMax' in proposal) {
    items.push({
      key: 'calories',
      label: 'Kalorien pro Tag',
      before: fmtKcalRange(previous.caloriesMin, previous.caloriesMax),
      after: fmtKcalRange(proposal.caloriesMin ?? previous.caloriesMin, proposal.caloriesMax ?? previous.caloriesMax),
    });
  }
  for (const k of ['stepsGoal', 'sleepGoal', 'targetWeight']) {
    if (k in proposal) {
      items.push({ key: k, label: PLAN_FIELDS[k].label, before: fmtPlanValue(k, previous[k]), after: fmtPlanValue(k, proposal[k]) });
    }
  }
  return items;
}

function describeProposal(previous, proposal) {
  return proposalItems(previous, proposal).map((i) => `${i.label}: ${i.before} → ${i.after}`);
}

const publicUser = (u) => ({ id: u.id, username: u.username, displayName: u.display_name, role: u.role });

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Step counts from the Shortcuts app may arrive as "8.523", "8523,0" or 8523.4. */
function parseSteps(value) {
  if (value === undefined || value === null || value === '') return value === '' ? null : value;
  if (typeof value === 'number') return Math.round(value);
  const t = String(value).replace(/[^\d.,]/g, '');
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) return Number(t.replace(/[.,]/g, ''));
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) && t ? Math.round(n) : value;
}

const WEEKDAY_NAMES = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

function createApp({ db, publicDir, secureCookies = false, trustProxy = false, notifier, reminders }) {
  notifier = notifier || createNotifier(db, {});
  reminders = reminders || createReminders(db, notifier);
  let metrics; // created further down, once all helpers exist
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
    setCategory: db.prepare('UPDATE users SET category = ? WHERE id = ?'),
    deleteUser: db.prepare("DELETE FROM users WHERE id = ? AND role = 'client'"),
    clients: db.prepare(
      `SELECT u.id, u.username, u.display_name, u.created_at, u.category,
         (SELECT MAX(date) FROM entries e WHERE e.user_id = u.id) AS last_entry,
         (SELECT weight FROM entries e WHERE e.user_id = u.id AND weight IS NOT NULL ORDER BY date DESC LIMIT 1) AS last_weight,
         (SELECT weight FROM entries e WHERE e.user_id = u.id AND weight IS NOT NULL ORDER BY date ASC LIMIT 1) AS first_weight,
         (SELECT COUNT(*) FROM entries e WHERE e.user_id = u.id AND e.date > date('now', '-7 days')) AS entries_7d,
         (SELECT AVG(steps) FROM entries e WHERE e.user_id = u.id AND steps IS NOT NULL AND e.date > date('now', '-7 days')) AS avg_steps_7d,
         (SELECT AVG(sleep) FROM entries e WHERE e.user_id = u.id AND sleep IS NOT NULL AND e.date > date('now', '-7 days')) AS avg_sleep_7d,
         (SELECT COUNT(*) FROM messages m WHERE m.client_id = u.id AND m.sender_id = u.id AND m.read_at IS NULL) AS unread_messages,
         (SELECT status FROM push_consent pc WHERE pc.user_id = u.id) AS push_status,
         (SELECT COUNT(*) FROM push_subscriptions ps WHERE ps.user_id = u.id) AS push_devices,
         (SELECT last_used_at FROM health_tokens ht WHERE ht.user_id = u.id) AS health_last_used,
         (SELECT COUNT(*) FROM health_tokens ht WHERE ht.user_id = u.id) AS health_linked,
         (SELECT COUNT(*) FROM swap_requests sr WHERE sr.client_id = u.id AND sr.status = 'open') AS open_swaps
       FROM users u WHERE u.role = 'client' ORDER BY u.display_name COLLATE NOCASE`
    ),
    entries: db.prepare('SELECT * FROM entries WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date ASC'),
    entry: db.prepare('SELECT * FROM entries WHERE user_id = ? AND date = ?'),
    upsertEntry: db.prepare(
      `INSERT INTO entries (user_id, date, weight, steps, sleep, note, calories_ok, calories, training, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT (user_id, date) DO UPDATE SET
         weight = excluded.weight, steps = excluded.steps, sleep = excluded.sleep, note = excluded.note,
         calories_ok = excluded.calories_ok, calories = excluded.calories, training = excluded.training,
         updated_at = excluded.updated_at`
    ),
    deleteEntry: db.prepare('DELETE FROM entries WHERE user_id = ? AND date = ?'),
    goals: db.prepare('SELECT * FROM goals WHERE user_id = ?'),
    insertLogin: db.prepare('INSERT INTO logins (user_id) VALUES (?)'),
    markActiveDay: db.prepare('INSERT OR IGNORE INTO activity_days (user_id, date) VALUES (?, ?)'),
    setLastSeen: db.prepare("UPDATE users SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?"),
    consent: db.prepare('SELECT status FROM push_consent WHERE user_id = ?'),
    setConsent: db.prepare(
      `INSERT INTO push_consent (user_id, status) VALUES (?, ?)
       ON CONFLICT (user_id) DO UPDATE SET status = excluded.status, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`
    ),
    subCount: db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?'),
    upsertSub: db.prepare(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh,
         auth = excluded.auth, user_agent = excluded.user_agent`
    ),
    deleteSubByEndpoint: db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?'),
    deleteSubsOfUser: db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?'),
    notifications: db.prepare('SELECT * FROM notifications ORDER BY active DESC, COALESCE(next_run_at, last_sent_at) DESC, id DESC'),
    notification: db.prepare('SELECT * FROM notifications WHERE id = ?'),
    insertNotification: db.prepare(
      `INSERT INTO notifications (title, body, audience, recipient_ids, schedule, time, weekdays, next_run_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    setNotificationActive: db.prepare('UPDATE notifications SET active = ?, next_run_at = ? WHERE id = ?'),
    deleteNotification: db.prepare('DELETE FROM notifications WHERE id = ?'),
    healthToken: db.prepare('SELECT * FROM health_tokens WHERE user_id = ?'),
    upsertHealthToken: db.prepare(
      `INSERT INTO health_tokens (user_id, token_hash) VALUES (?, ?)
       ON CONFLICT (user_id) DO UPDATE SET token_hash = excluded.token_hash,
         created_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), last_used_at = NULL`
    ),
    deleteHealthToken: db.prepare('DELETE FROM health_tokens WHERE user_id = ?'),
    touchHealthToken: db.prepare(
      "UPDATE health_tokens SET last_used_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE user_id = ?"
    ),
    userByHealthToken: db.prepare(
      "SELECT u.* FROM health_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ? AND u.role = 'client'"
    ),
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
      `INSERT INTO goals (user_id, target_weight, steps_goal, sleep_goal, calories_min, calories_max, calories_goal)
       VALUES (?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT (user_id) DO UPDATE SET
         target_weight = excluded.target_weight, steps_goal = excluded.steps_goal, sleep_goal = excluded.sleep_goal,
         calories_min = excluded.calories_min, calories_max = excluded.calories_max, calories_goal = NULL`
    ),
    insertGoalHistory: db.prepare(
      `INSERT INTO goal_history (user_id, target_weight, steps_goal, sleep_goal, calories_min, calories_max, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ),
    goalHistory: db.prepare('SELECT * FROM goal_history WHERE user_id = ? ORDER BY id ASC'),
    allEntries: db.prepare('SELECT * FROM entries WHERE user_id = ? ORDER BY date ASC'),
    insertCheckin: db.prepare(
      'INSERT INTO checkins (client_id, coach_id, message, proposal, previous) VALUES (?, ?, ?, ?, ?)'
    ),
    checkin: db.prepare('SELECT * FROM checkins WHERE id = ?'),
    checkinsOf: db.prepare('SELECT * FROM checkins WHERE client_id = ? ORDER BY id DESC LIMIT ?'),
    lastCheckin: db.prepare('SELECT * FROM checkins WHERE client_id = ? ORDER BY id DESC LIMIT 1'),
    acceptCheckin: db.prepare(
      "UPDATE checkins SET status = 'accepted', accepted_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?"
    ),
    seenCheckins: db.prepare(
      "UPDATE checkins SET seen_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE client_id = ? AND seen_at IS NULL"
    ),
    repliedCheckin: db.prepare(
      "UPDATE checkins SET replied_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?"
    ),
    clientsBasic: db.prepare(
      `SELECT u.id, u.display_name, u.username, u.category,
         (SELECT MAX(date) FROM entries e WHERE e.user_id = u.id) AS last_entry
       FROM users u WHERE u.role = 'client' ORDER BY u.display_name COLLATE NOCASE`
    ),
    messagesSince: db.prepare(
      `SELECT m.*, u.role AS sender_role FROM messages m JOIN users u ON u.id = m.sender_id
       WHERE m.client_id = ? AND m.created_at >= ? ORDER BY m.id ASC LIMIT 50`
    ),
  };

  const loginAttempts = new Map();
  const userName = db.prepare('SELECT display_name FROM users WHERE id = ?');

  function notificationRow(n) {
    const ids = JSON.parse(n.recipient_ids);
    const weekdays = JSON.parse(n.weekdays);
    let scheduleText;
    if (n.schedule === 'daily') scheduleText = `Täglich um ${n.time} Uhr`;
    else if (n.schedule === 'weekly') scheduleText = `${weekdays.map((d) => WEEKDAY_NAMES[d - 1]).join(', ')} um ${n.time} Uhr`;
    else scheduleText = 'Einmalig';
    return {
      id: n.id,
      title: n.title,
      body: n.body,
      audience: n.audience,
      recipientIds: ids,
      recipientNames: ids.map((id) => (userName.get(id) || {}).display_name).filter(Boolean),
      schedule: n.schedule,
      scheduleText,
      time: n.time,
      weekdays,
      active: Boolean(n.active),
      nextRunAt: n.active && n.next_run_at ? new Date(n.next_run_at).toISOString() : null,
      lastSentAt: n.last_sent_at ? new Date(n.last_sent_at).toISOString() : null,
      lastResult: n.last_result,
    };
  }

  function saveGoals(userId, g, source) {
    const v = [g.targetWeight ?? null, g.stepsGoal ?? null, g.sleepGoal ?? null, g.caloriesMin ?? null, g.caloriesMax ?? null];
    q.upsertGoals.run(userId, ...v);
    q.insertGoalHistory.run(userId, ...v, source);
  }

  function checkinRow(ci) {
    const proposal = normalizePlan(JSON.parse(ci.proposal));
    const previous = normalizePlan(JSON.parse(ci.previous));
    return {
      id: ci.id,
      message: ci.message,
      proposal,
      previous,
      changes: describeProposal(previous, proposal),
      changeItems: proposalItems(previous, proposal),
      status: ci.status,
      createdAt: ci.created_at,
      seenAt: ci.seen_at,
      repliedAt: ci.replied_at,
      acceptedAt: ci.accepted_at,
    };
  }

  function requestOrigin(req) {
    const proto = trustProxy ? String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() : secureCookies ? 'https' : 'http';
    return req.headers.host ? `${proto || 'http'}://${req.headers.host}` : null;
  }

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
      q.insertLogin.run(u.id);
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
          category: r.category,
          createdAt: r.created_at,
          lastEntry: r.last_entry,
          lastWeight: r.last_weight,
          firstWeight: r.first_weight,
          entries7d: r.entries_7d,
          avgSteps7d: r.avg_steps_7d,
          avgSleep7d: r.avg_sleep_7d,
          unreadMessages: r.unread_messages,
          pushStatus: r.push_status || 'unknown',
          pushDevices: r.push_devices,
          healthLinked: Boolean(r.health_linked),
          healthLastUsed: r.health_last_used,
          openSwaps: r.open_swaps,
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
      if (body.category !== undefined) {
        if (body.category !== null && !(body.category in CATEGORIES)) throw new HttpError(400, 'Ungültige Kategorie');
        q.setCategory.run(body.category, c.id);
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
    ['GET', /^\/api\/goals$/, async (ctx) => {
      const c = targetClient(ctx);
      return {
        goals: goalsRow(q.goals.get(c.id)),
        history: q.goalHistory.all(c.id).map((h) => ({ ...goalsRow(h), source: h.source, changedAt: h.changed_at })),
      };
    }],

    ['PUT', /^\/api\/goals$/, async (ctx) => {
      requireCoach(ctx);
      const c = targetClient(ctx);
      const body = await readBody(ctx.req);
      const parsed = parsePlan(body);
      const g = {};
      for (const k of Object.keys(PLAN_FIELDS)) g[k] = parsed[k] ?? null;
      saveGoals(c.id, g, 'coach');
      return { goals: g };
    }],

    // ---- Weekly check-ins ----
    ['GET', /^\/api\/checkins\/queue$/, async (ctx) => {
      requireCoach(ctx);
      const weekAgo = new Date(Date.now() - 6 * 86400000).toISOString();
      return {
        clients: q.clientsBasic.all().map((c) => {
          const last = q.lastCheckin.get(c.id);
          return {
            id: c.id,
            displayName: c.display_name,
            username: c.username,
            category: c.category,
            lastEntry: c.last_entry,
            lastCheckin: last ? checkinRow(last) : null,
            doneThisWeek: Boolean(last && last.created_at >= weekAgo),
          };
        }),
      };
    }],

    ['GET', /^\/api\/checkins\/review$/, async (ctx) => {
      requireCoach(ctx);
      const c = targetClient(ctx);
      const goals = q.goals.get(c.id);
      const today = localDate(Date.now(), notifier.timezone);
      const last = q.lastCheckin.get(c.id);
      const since = last ? last.created_at : new Date(Date.now() - 14 * 86400000).toISOString();
      return {
        client: { id: c.id, displayName: c.display_name, username: c.username, category: c.category },
        measurements: metrics.reviewFor(c, today),
        goals: goalsRow(goals),
        comparison: weekComparison(q.allEntries.all(c.id), today, goals),
        checkins: q.checkinsOf.all(c.id, 5).map(checkinRow),
        clientMessages: q.messagesSince
          .all(c.id, since)
          .filter((m) => m.sender_role === 'client')
          .map((m) => ({ id: m.id, body: m.body, createdAt: m.created_at })),
      };
    }],

    ['GET', /^\/api\/checkins$/, async (ctx) => {
      const u = requireUser(ctx);
      const c = targetClient(ctx);
      if (u.role === 'client') q.seenCheckins.run(c.id);
      return { checkins: q.checkinsOf.all(c.id, 10).map(checkinRow) };
    }],

    ['POST', /^\/api\/checkins$/, async (ctx) => {
      const coach = requireCoach(ctx);
      const c = targetClient(ctx);
      const body = await readBody(ctx.req);
      const message = textField(body.message, { name: 'Nachricht', max: 4000 });
      if (!message) throw new HttpError(400, 'Bitte eine Nachricht für den Check-in schreiben');
      const current = goalsRow(q.goals.get(c.id));
      const raw = body.proposal && typeof body.proposal === 'object' ? body.proposal : {};
      const wanted = parsePlan(raw);
      const proposal = {};
      for (const k of ['stepsGoal', 'sleepGoal', 'targetWeight']) {
        if (wanted[k] !== undefined && wanted[k] !== null && wanted[k] !== current[k]) proposal[k] = wanted[k];
      }
      if (
        wanted.caloriesMin !== undefined && wanted.caloriesMin !== null &&
        (wanted.caloriesMin !== current.caloriesMin || wanted.caloriesMax !== current.caloriesMax)
      ) {
        proposal.caloriesMin = wanted.caloriesMin;
        proposal.caloriesMax = wanted.caloriesMax;
      }
      const id = Number(
        q.insertCheckin.run(c.id, coach.id, message, JSON.stringify(proposal), JSON.stringify(current)).lastInsertRowid
      );

      // The check-in itself stays out of the chat; the client gets a push and sees it on the tracker page.
      const changes = describeProposal(current, proposal);
      notifier
        .sendToUsers([c.id], {
          title: 'Dein Check-in ist da 📋',
          body: changes.length ? 'Dein Coach hat Feedback und Anpassungen für deinen Plan.' : 'Dein Coach hat dir Feedback geschickt.',
          url: '/#/',
        })
        .catch((err) => console.error(err));
      ctx.res.statusCode = 201;
      return { checkin: checkinRow(q.checkin.get(id)) };
    }],

    ['POST', /^\/api\/checkins\/(\d+)\/accept$/, async (ctx, [, id]) => {
      const u = requireUser(ctx);
      const ci = q.checkin.get(Number(id));
      if (!ci || u.role !== 'client' || ci.client_id !== u.id) throw new HttpError(404, 'Check-in nicht gefunden');
      if (ci.status === 'accepted') throw new HttpError(409, 'Bereits angenommen');
      const proposal = normalizePlan(JSON.parse(ci.proposal));
      if (!Object.keys(proposal).length) throw new HttpError(400, 'Dieser Check-in enthält keine Anpassungen');
      const goals = { ...goalsRow(q.goals.get(u.id)), ...proposal };
      saveGoals(u.id, goals, 'checkin');
      q.acceptCheckin.run(ci.id);
      notifier
        .sendToUsers(notifier.coachIds(), {
          title: `${u.display_name} hat die Anpassungen angenommen ✅`,
          body: describeProposal(normalizePlan(JSON.parse(ci.previous)), proposal).join(' · '),
          url: `/#/checkin/${u.id}`,
        })
        .catch((err) => console.error(err));
      return { checkin: checkinRow(q.checkin.get(ci.id)), goals };
    }],

    ['POST', /^\/api\/checkins\/(\d+)\/reply$/, async (ctx, [, id]) => {
      const u = requireUser(ctx);
      const ci = q.checkin.get(Number(id));
      if (!ci || u.role !== 'client' || ci.client_id !== u.id) throw new HttpError(404, 'Check-in nicht gefunden');
      const body = textField((await readBody(ctx.req)).body, { name: 'Antwort', max: 2000 });
      if (!body) throw new HttpError(400, 'Antwort darf nicht leer sein');
      const ciDate = new Date(ci.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', timeZone: notifier.timezone });
      q.insertMessage.run(u.id, u.id, `↩️ Antwort auf den Check-in vom ${ciDate}:\n${body}`);
      q.repliedCheckin.run(ci.id);
      notifier
        .sendToUsers(notifier.coachIds(), {
          title: `${u.display_name} hat auf den Check-in geantwortet`,
          body: body.length > 120 ? `${body.slice(0, 117)}…` : body,
          url: `/#/client/${u.id}/chat`,
        })
        .catch((err) => console.error(err));
      return { checkin: checkinRow(q.checkin.get(ci.id)) };
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
      // Notify the other side; failures must not break sending the message.
      const preview = body.length > 120 ? `${body.slice(0, 117)}…` : body;
      const push =
        u.role === 'coach'
          ? notifier.sendToUsers([c.id], { title: 'Neue Nachricht von deinem Coach', body: preview, url: '/#/chat' })
          : notifier.sendToUsers(notifier.coachIds(), {
              title: `Nachricht von ${c.display_name}`, body: preview, url: `/#/client/${c.id}/chat`,
            });
      push.catch((err) => console.error(err));
      ctx.res.statusCode = 201;
      return { id };
    }],

    // ---- Push notifications ----
    ['GET', /^\/api\/push\/config$/, async (ctx) => {
      const u = requireUser(ctx);
      const consent = q.consent.get(u.id);
      return {
        publicKey: notifier.publicKey,
        status: consent ? consent.status : 'unknown',
        devices: q.subCount.get(u.id).n,
      };
    }],

    ['POST', /^\/api\/push\/subscribe$/, async (ctx) => {
      const u = requireUser(ctx);
      const { subscription } = await readBody(ctx.req);
      const endpoint = subscription && subscription.endpoint;
      const keys = (subscription && subscription.keys) || {};
      if (typeof endpoint !== 'string' || !isAllowedEndpoint(endpoint)) throw new HttpError(400, 'Unbekannter Push-Dienst');
      if (typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string' || keys.p256dh.length > 200 || keys.auth.length > 100) {
        throw new HttpError(400, 'Ungültige Push-Schlüssel');
      }
      q.upsertSub.run(u.id, endpoint, keys.p256dh, keys.auth, String(ctx.req.headers['user-agent'] || '').slice(0, 300));
      q.setConsent.run(u.id, 'granted');
      notifier.rememberOrigin(requestOrigin(ctx.req));
      return { ok: true };
    }],

    ['POST', /^\/api\/push\/unsubscribe$/, async (ctx) => {
      const u = requireUser(ctx);
      const { endpoint } = await readBody(ctx.req);
      if (typeof endpoint === 'string') q.deleteSubByEndpoint.run(u.id, endpoint);
      return { ok: true };
    }],

    ['POST', /^\/api\/push\/consent$/, async (ctx) => {
      const u = requireUser(ctx);
      const { status } = await readBody(ctx.req);
      if (status !== 'denied') throw new HttpError(400, 'Ungültiger Status');
      q.setConsent.run(u.id, 'denied');
      q.deleteSubsOfUser.run(u.id);
      return { ok: true };
    }],

    ['POST', /^\/api\/push\/test$/, async (ctx) => {
      const u = requireUser(ctx);
      const r = await notifier.sendToUsers([u.id], {
        title: 'Thabstracker', body: 'Benachrichtigungen sind aktiv 💪', url: '/',
      });
      return r;
    }],

    // ---- Coach: scheduled push notifications ----
    ['GET', /^\/api\/notifications$/, async (ctx) => {
      requireCoach(ctx);
      return {
        timezone: notifier.timezone,
        notifications: q.notifications.all().map(notificationRow),
        automation: reminders.config(),
      };
    }],

    ['POST', /^\/api\/notifications$/, async (ctx) => {
      requireCoach(ctx);
      const b = await readBody(ctx.req);
      const title = textField(b.title, { name: 'Titel', max: 60 });
      const text = textField(b.body, { name: 'Text', max: 240 });
      if (!title || !text) throw new HttpError(400, 'Titel und Text sind Pflicht');
      if (!['all', 'some'].includes(b.audience)) throw new HttpError(400, 'Empfänger fehlen');
      let recipients = [];
      if (b.audience === 'some') {
        if (!Array.isArray(b.recipientIds) || !b.recipientIds.length) throw new HttpError(400, 'Bitte mindestens einen Klienten auswählen');
        recipients = [...new Set(b.recipientIds.map(Number))];
        for (const id of recipients) clientById(id);
      }
      if (!['once', 'daily', 'weekly'].includes(b.schedule)) throw new HttpError(400, 'Ungültige Wiederholung');

      let time = null;
      let weekdays = [];
      let nextRun;
      if (b.schedule === 'once') {
        if (b.sendAt) {
          nextRun = Date.parse(b.sendAt);
          if (!Number.isFinite(nextRun)) throw new HttpError(400, 'Ungültiger Zeitpunkt');
          if (nextRun < Date.now() - 60000) throw new HttpError(400, 'Der Zeitpunkt liegt in der Vergangenheit');
        } else {
          nextRun = Date.now();
        }
      } else {
        if (typeof b.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time)) throw new HttpError(400, 'Bitte eine Uhrzeit angeben');
        time = b.time;
        if (b.schedule === 'weekly') {
          weekdays = Array.isArray(b.weekdays) ? [...new Set(b.weekdays.map(Number))].filter((d) => d >= 1 && d <= 7).sort() : [];
          if (!weekdays.length) throw new HttpError(400, 'Bitte mindestens einen Wochentag auswählen');
        }
        nextRun = nextRecurringRun({ schedule: b.schedule, time, weekdays }, Date.now(), notifier.timezone);
      }

      const id = Number(
        q.insertNotification.run(title, text, b.audience, JSON.stringify(recipients), b.schedule, time, JSON.stringify(weekdays), nextRun)
          .lastInsertRowid
      );
      if (b.schedule === 'once' && !b.sendAt) await notifier.runDue();
      ctx.res.statusCode = 201;
      return { notification: notificationRow(q.notification.get(id)) };
    }],

    ['PATCH', /^\/api\/notifications\/(\d+)$/, async (ctx, [, id]) => {
      requireCoach(ctx);
      const n = q.notification.get(Number(id));
      if (!n) throw new HttpError(404, 'Nicht gefunden');
      const { active } = await readBody(ctx.req);
      if (typeof active !== 'boolean') throw new HttpError(400, 'Ungültiger Status');
      if (n.schedule === 'once' && active && (!n.next_run_at || n.last_sent_at)) {
        throw new HttpError(400, 'Einmalige Nachrichten können nach dem Senden nicht erneut aktiviert werden');
      }
      const next = active && n.schedule !== 'once'
        ? nextRecurringRun({ schedule: n.schedule, time: n.time, weekdays: JSON.parse(n.weekdays) }, Date.now(), notifier.timezone)
        : n.next_run_at;
      q.setNotificationActive.run(active ? 1 : 0, next, n.id);
      return { notification: notificationRow(q.notification.get(n.id)) };
    }],

    ['POST', /^\/api\/notifications\/(\d+)\/send$/, async (ctx, [, id]) => {
      requireCoach(ctx);
      const r = await notifier.sendNow(Number(id));
      if (!r) throw new HttpError(404, 'Nicht gefunden');
      return { result: r, notification: notificationRow(q.notification.get(Number(id))) };
    }],

    ['DELETE', /^\/api\/notifications\/(\d+)$/, async (ctx, [, id]) => {
      requireCoach(ctx);
      q.deleteNotification.run(Number(id));
      return { ok: true };
    }],

    // ---- Apple Health & Co.: personal import key ----
    ['GET', /^\/api\/health\/token$/, async (ctx) => {
      const u = requireUser(ctx);
      const t = q.healthToken.get(u.id);
      return { linked: Boolean(t), createdAt: t ? t.created_at : null, lastUsedAt: t ? t.last_used_at : null };
    }],

    ['POST', /^\/api\/health\/token$/, async (ctx) => {
      const u = requireUser(ctx);
      if (u.role !== 'client') throw new HttpError(403, 'Nur für Klienten');
      const token = `tt_${crypto.randomBytes(24).toString('base64url')}`;
      q.upsertHealthToken.run(u.id, sha256(token));
      return { token };
    }],

    ['DELETE', /^\/api\/health\/token$/, async (ctx) => {
      const u = requireUser(ctx);
      q.deleteHealthToken.run(u.id);
      return { ok: true };
    }],

    ['POST', /^\/api\/health\/import$/, async (ctx) => {
      const auth = String(ctx.req.headers.authorization || '');
      const m = auth.match(/^Bearer\s+(\S+)$/i);
      const owner = m ? q.userByHealthToken.get(sha256(m[1])) : null;
      if (!owner) throw new HttpError(401, 'Ungültiger oder fehlender Schlüssel');
      const body = await readBody(ctx.req);
      const date = body.date === undefined || body.date === '' ? localDate(Date.now(), notifier.timezone) : body.date;
      if (!isValidDate(date) || date > maxAllowedDate()) throw new HttpError(400, 'Ungültiges Datum');
      const incoming = {
        weight: numberField(body.weight === '' ? undefined : body.weight, { name: 'Gewicht', min: 20, max: 400 }),
        steps: numberField(parseSteps(body.steps === '' ? undefined : body.steps), { name: 'Schritte', min: 0, max: 200000, integer: true }),
        sleep: numberField(body.sleep === '' ? undefined : body.sleep, { name: 'Schlaf', min: 0, max: 24 }),
      };
      if (Object.values(incoming).every((v) => v === undefined || v === null)) {
        throw new HttpError(400, 'Keine Werte übermittelt (steps, weight oder sleep)');
      }
      const existing = q.entry.get(owner.id, date) || {};
      const merged = {};
      for (const k of ['weight', 'steps', 'sleep']) {
        merged[k] = incoming[k] !== undefined && incoming[k] !== null ? incoming[k] : existing[k] ?? null;
      }
      q.upsertEntry.run(
        owner.id, date, merged.weight, merged.steps, merged.sleep, existing.note ?? null,
        existing.calories_ok ?? null, existing.calories ?? null, existing.training ?? null
      );
      q.touchHealthToken.run(owner.id);
      return { ok: true, date, saved: incoming };
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
      const lines = ['Datum;Gewicht (kg);Schritte;Schlaf (h);Trainingstag;Kalorienplan eingehalten;Gegessene kcal;Notiz'];
      for (const r of q.entries.all(c.id, from, to)) {
        const num = (v) => (v === null ? '' : String(v).replace('.', ','));
        const yn = (v) => (v === null || v === undefined ? '' : v ? 'ja' : 'nein');
        lines.push(
          [r.date, num(r.weight), r.steps ?? '', num(r.sleep), yn(r.training), yn(r.calories_ok), r.calories ?? '', csvCell(r.note)].join(';')
        );
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
        calories_ok: boolField(body.caloriesOk, 'Kalorienplan eingehalten'),
        calories: numberField(body.calories, { name: 'Gegessene Kalorien', min: 0, max: 15000, integer: true }),
        training: boolField(body.training, 'Trainingstag'),
      };
      // "Plan eingehalten" makes a separately entered calorie number meaningless.
      if (incoming.calories_ok === 1) incoming.calories = null;
      // Fields left out keep their saved value; null clears them.
      const existing = q.entry.get(u.id, date) || {};
      const merged = {};
      for (const k of Object.keys(incoming)) merged[k] = incoming[k] !== undefined ? incoming[k] : existing[k] ?? null;
      if (Object.values(merged).every((v) => v === null)) {
        q.deleteEntry.run(u.id, date);
        return { entry: null };
      }
      q.upsertEntry.run(
        u.id, date, merged.weight, merged.steps, merged.sleep, merged.note,
        merged.calories_ok, merged.calories, merged.training
      );
      return { entry: entryRow(q.entry.get(u.id, date)) };
    }],

    ['DELETE', /^\/api\/entries\/(\d{4}-\d{2}-\d{2})$/, async (ctx, [, date]) => {
      const u = requireUser(ctx);
      if (u.role !== 'client') throw new HttpError(403, 'Nur Klienten können Einträge löschen');
      q.deleteEntry.run(u.id, date);
      return { ok: true };
    }],
  ];

  const deps = {
    db, notifier, reminders, HttpError, readBody, textField, numberField, requireUser, requireCoach, targetClient, clientById,
    isValidDate, maxAllowedDate, localDate,
  };
  metrics = metricsModule(deps);
  routes.push(...nutritionRoutes(deps), ...adminRoutes(deps), ...metrics.routes);

  // App usage for the admin tool: one row per day and user, "last seen" at most once a minute.
  const lastSeenWritten = new Map();
  function recordActivity(user) {
    const now = Date.now();
    if (now - (lastSeenWritten.get(user.id) || 0) < 60000) return;
    lastSeenWritten.set(user.id, now);
    q.setLastSeen.run(user.id);
    q.markActiveDay.run(user.id, localDate(now, notifier.timezone));
  }

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
    // Always revalidate, so phones pick up a new version right after a deploy; unchanged files answer 304.
    const etag = `"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' });
      return res.end();
    }
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ETag: etag,
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
      if (ctx.user) recordActivity(ctx.user);
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
