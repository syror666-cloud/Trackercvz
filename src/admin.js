'use strict';

// Admin tool: client activity (logins, app use, tracking) and the automatic "not tracked for N days" reminder.

const { localDate, zonedToUtc } = require('./schedule');

const DAY_MS = 86400000;
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

const DEFAULT_REMINDER = {
  enabled: false,
  days: 2,
  time: '18:00',
  title: 'Kurze Erinnerung 👋',
  body: 'Hey {name}, seit {tage} Tagen fehlt dein Eintrag. Nimm dir kurz eine Minute für deinen Tracker!',
  repeatDaily: false,
  lastRunDate: null,
  lastRunAt: null,
  lastResult: null,
};

function createReminders(db, notifier) {
  const tz = notifier.timezone;
  const q = {
    get: db.prepare("SELECT value FROM settings WHERE key = 'inactivity_reminder'"),
    set: db.prepare(
      `INSERT INTO settings (key, value) VALUES ('inactivity_reminder', ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`
    ),
    clients: db.prepare(
      `SELECT u.id, u.display_name, u.created_at,
         (SELECT MAX(date) FROM entries e WHERE e.user_id = u.id) AS last_entry,
         (SELECT status FROM push_consent pc WHERE pc.user_id = u.id) AS push_status,
         (SELECT COUNT(*) FROM push_subscriptions ps WHERE ps.user_id = u.id) AS push_devices,
         (SELECT last_sent_date FROM reminder_state rs WHERE rs.user_id = u.id) AS last_reminder,
         (SELECT last_result FROM reminder_state rs WHERE rs.user_id = u.id) AS last_reminder_result
       FROM users u WHERE u.role = 'client' ORDER BY u.display_name COLLATE NOCASE`
    ),
    setState: db.prepare(
      `INSERT INTO reminder_state (user_id, last_sent_date, last_result) VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET last_sent_date = excluded.last_sent_date, last_result = excluded.last_result`
    ),
  };

  function config() {
    const row = q.get.get();
    return { ...DEFAULT_REMINDER, ...(row ? JSON.parse(row.value) : {}) };
  }
  function save(cfg) {
    q.set.run(JSON.stringify(cfg));
    return cfg;
  }

  /** Days without an entry, counting today. Clients who never tracked count from the day they were added. */
  function missingDays(c, today) {
    if (c.last_entry) return Math.max(0, daysBetween(c.last_entry, today));
    const created = localDate(Date.parse(c.created_at.replace(' ', 'T') + (c.created_at.endsWith('Z') ? '' : 'Z')), tz);
    return Math.max(0, daysBetween(created, today) + 1);
  }

  /** Who gets a reminder today: N+ days without entry, push allowed, not already reminded for this gap. */
  function evaluate(cfg, today) {
    return q.clients.all().map((c) => {
      const missing = missingDays(c, today);
      let state = 'ok';
      if (missing >= cfg.days) {
        const alreadyThisGap = c.last_reminder && (!c.last_entry || c.last_reminder > c.last_entry);
        if (c.push_status !== 'granted' || !c.push_devices) state = 'no-push';
        else if (c.last_reminder === today) state = 'sent-today';
        else if (alreadyThisGap && !cfg.repeatDaily) state = 'already-reminded';
        else state = 'due';
      }
      return { id: c.id, name: c.display_name, missing, lastEntry: c.last_entry, state, lastReminder: c.last_reminder, lastReminderResult: c.last_reminder_result };
    });
  }

  async function sendDue(cfg, today) {
    const list = evaluate(cfg, today).filter((c) => c.state === 'due');
    let delivered = 0;
    for (const c of list) {
      const fill = (t) => t.replace(/\{name\}/g, c.name).replace(/\{tage\}/g, String(c.missing));
      const r = await notifier.sendToUsers([c.id], { title: fill(cfg.title), body: fill(cfg.body), url: '/' });
      if (r.delivered) delivered++;
      q.setState.run(c.id, today, r.delivered ? 'zugestellt' : 'nicht zugestellt');
    }
    return { recipients: list.length, delivered, names: list.map((c) => c.name) };
  }

  /** Called by the scheduler: once a day at the configured time. */
  async function runScheduled(now = Date.now()) {
    const cfg = config();
    if (!cfg.enabled) return null;
    const today = localDate(now, tz);
    if (cfg.lastRunDate === today || zonedToUtc(today, cfg.time, tz) > now) return null;
    cfg.lastRunDate = today;
    save(cfg); // mark first, so a slow run is never started twice
    const r = await sendDue(cfg, today);
    save({ ...config(), lastRunAt: new Date(now).toISOString(), lastResult: describe(r) });
    return r;
  }

  async function runNow(now = Date.now()) {
    const cfg = config();
    const today = localDate(now, tz);
    const r = await sendDue(cfg, today);
    save({ ...config(), lastRunAt: new Date(now).toISOString(), lastResult: describe(r) });
    return r;
  }

  function describe(r) {
    if (!r.recipients) return 'Niemand fällig';
    return `${r.delivered} von ${r.recipients} erinnert (${r.names.join(', ')})`;
  }

  return { config, save, evaluate, runScheduled, runNow, timezone: tz, today: (now = Date.now()) => localDate(now, tz) };
}

function adminRoutes({ db, reminders, HttpError, readBody, textField, numberField, requireCoach }) {
  const q = {
    activity: db.prepare(
      `SELECT u.id, u.display_name, u.username, u.created_at, u.last_seen_at, u.category,
         (SELECT MAX(created_at) FROM logins l WHERE l.user_id = u.id) AS last_login,
         (SELECT COUNT(*) FROM logins l WHERE l.user_id = u.id AND l.created_at >= ?) AS logins_7,
         (SELECT COUNT(*) FROM logins l WHERE l.user_id = u.id AND l.created_at >= ?) AS logins_30,
         (SELECT COUNT(*) FROM activity_days a WHERE a.user_id = u.id AND a.date > ?) AS active_7,
         (SELECT COUNT(*) FROM activity_days a WHERE a.user_id = u.id AND a.date > ?) AS active_30,
         (SELECT COUNT(*) FROM entries e WHERE e.user_id = u.id AND e.date > ?) AS entries_7,
         (SELECT COUNT(*) FROM entries e WHERE e.user_id = u.id AND e.date > ?) AS entries_30
       FROM users u WHERE u.role = 'client' ORDER BY u.display_name COLLATE NOCASE`
    ),
  };

  function overview() {
    const now = Date.now();
    const today = reminders.today(now);
    const iso = (days) => new Date(now - days * DAY_MS).toISOString();
    const cfg = reminders.config();
    const evals = new Map(reminders.evaluate(cfg, today).map((e) => [e.id, e]));
    const clients = q.activity.all(iso(7), iso(30), addDays(today, -7), addDays(today, -30), addDays(today, -7), addDays(today, -30)).map((r) => {
      const ev = evals.get(r.id);
      return {
        id: r.id,
        displayName: r.display_name,
        username: r.username,
        category: r.category,
        lastLogin: r.last_login,
        lastSeen: r.last_seen_at,
        logins7: r.logins_7,
        logins30: r.logins_30,
        activeDays7: r.active_7,
        activeDays30: r.active_30,
        entries7: r.entries_7,
        entries30: r.entries_30,
        missingDays: ev.missing,
        lastEntry: ev.lastEntry,
        reminderState: ev.state,
        lastReminder: ev.lastReminder,
        lastReminderResult: ev.lastReminderResult,
      };
    });
    return { reminder: cfg, clients, timezone: reminders.timezone };
  }

  return [
    ['GET', /^\/api\/admin\/overview$/, async (ctx) => {
      requireCoach(ctx);
      return overview();
    }],

    ['PUT', /^\/api\/admin\/reminder$/, async (ctx) => {
      requireCoach(ctx);
      const b = await readBody(ctx.req);
      const cfg = reminders.config();
      if (b.enabled !== undefined) {
        if (typeof b.enabled !== 'boolean') throw new HttpError(400, 'Ungültiger Wert');
        cfg.enabled = b.enabled;
      }
      if (b.days !== undefined) cfg.days = numberField(b.days, { name: 'Tage', min: 1, max: 30, integer: true });
      if (b.time !== undefined) {
        if (typeof b.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time)) throw new HttpError(400, 'Bitte eine gültige Uhrzeit angeben');
        // A new time today should still run today if it is later than now.
        if (b.time !== cfg.time) cfg.lastRunDate = null;
        cfg.time = b.time;
      }
      if (b.title !== undefined) {
        cfg.title = textField(b.title, { name: 'Titel', max: 60 });
        if (!cfg.title) throw new HttpError(400, 'Titel darf nicht leer sein');
      }
      if (b.body !== undefined) {
        cfg.body = textField(b.body, { name: 'Text', max: 240 });
        if (!cfg.body) throw new HttpError(400, 'Text darf nicht leer sein');
      }
      if (b.repeatDaily !== undefined) cfg.repeatDaily = Boolean(b.repeatDaily);
      reminders.save(cfg);
      return overview();
    }],

    ['POST', /^\/api\/admin\/reminder\/run$/, async (ctx) => {
      requireCoach(ctx);
      const result = await reminders.runNow();
      return { result, ...overview() };
    }],
  ];
}

module.exports = { createReminders, adminRoutes };
