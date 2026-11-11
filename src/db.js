'use strict';

const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('coach', 'client')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  weight     REAL,
  steps      INTEGER,
  sleep      REAL,
  note       TEXT,
  calories_ok INTEGER,
  calories   INTEGER,
  training   INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, date)
);

CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  read_at    TEXT
);
CREATE INDEX IF NOT EXISTS messages_client ON messages (client_id, id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint        TEXT NOT NULL UNIQUE,
  p256dh          TEXT NOT NULL,
  auth            TEXT NOT NULL,
  user_agent      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  last_success_at TEXT
);

-- Whether a user agreed to push messages: 'granted' or 'denied' (no row = not asked yet).
CREATE TABLE IF NOT EXISTS push_consent (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL CHECK (status IN ('granted', 'denied')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  audience      TEXT NOT NULL CHECK (audience IN ('all', 'some')),
  recipient_ids TEXT NOT NULL DEFAULT '[]',
  schedule      TEXT NOT NULL CHECK (schedule IN ('once', 'daily', 'weekly')),
  time          TEXT,
  weekdays      TEXT NOT NULL DEFAULT '[]',
  active        INTEGER NOT NULL DEFAULT 1,
  next_run_at   INTEGER,
  last_sent_at  INTEGER,
  last_result   TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Personal key for automatic imports (e.g. Apple Health via the Shortcuts app).
CREATE TABLE IF NOT EXISTS health_tokens (
  user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS goals (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  target_weight REAL,
  steps_goal    INTEGER,
  sleep_goal    REAL,
  calories_goal INTEGER,
  calories_min  INTEGER,
  calories_max  INTEGER
);

-- Every change of a client's plan, for the history charts.
CREATE TABLE IF NOT EXISTS goal_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_weight REAL,
  steps_goal    INTEGER,
  sleep_goal    REAL,
  calories_goal INTEGER,
  calories_min  INTEGER,
  calories_max  INTEGER,
  source        TEXT NOT NULL DEFAULT 'coach',
  changed_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS goal_history_user ON goal_history (user_id, id);

-- Weekly check-ins: coach feedback + proposed plan changes the client can accept.
CREATE TABLE IF NOT EXISTS checkins (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  coach_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  message      TEXT NOT NULL,
  proposal     TEXT NOT NULL DEFAULT '{}',
  previous     TEXT NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted')),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  seen_at      TEXT,
  replied_at   TEXT,
  accepted_at  TEXT
);
CREATE INDEX IF NOT EXISTS checkins_client ON checkins (client_id, id);
`;

function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

function addColumns(db, table, columns) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  for (const [name, type] of columns) {
    if (!existing.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
}

/** Brings databases created by older versions up to date. Safe to run on every start. */
function migrate(db) {
  addColumns(db, 'goals', [['calories_goal', 'INTEGER'], ['calories_min', 'INTEGER'], ['calories_max', 'INTEGER']]);
  addColumns(db, 'goal_history', [['calories_min', 'INTEGER'], ['calories_max', 'INTEGER']]);
  addColumns(db, 'entries', [['calories_ok', 'INTEGER'], ['calories', 'INTEGER'], ['training', 'INTEGER']]);

  // Single calorie goals become a range with the same lower and upper bound.
  db.exec(`UPDATE goals SET calories_min = calories_goal, calories_max = calories_goal
           WHERE calories_goal IS NOT NULL AND calories_min IS NULL`);
  db.exec(`UPDATE goal_history SET calories_min = calories_goal, calories_max = calories_goal
           WHERE calories_goal IS NOT NULL AND calories_min IS NULL`);

  // Check-ins no longer post into the chat: remove the automatic messages older versions created.
  const flag = db.prepare("SELECT 1 FROM settings WHERE key = 'migration_checkin_chat_cleanup'").get();
  if (!flag) {
    db.exec(`DELETE FROM messages WHERE body LIKE '📋 Wöchentlicher Check-in%' OR body LIKE '✅ Anpassungen angenommen:%'`);
    db.exec("INSERT INTO settings (key, value) VALUES ('migration_checkin_chat_cleanup', 'done')");
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

function createUser(db, { username, displayName, password, role }) {
  const info = db
    .prepare('INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(username, displayName || username, hashPassword(password), role);
  return Number(info.lastInsertRowid);
}

module.exports = { openDb, hashPassword, verifyPassword, createUser };
