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

-- Every successful login, and one row per day a user opened the app (for the admin tool).
CREATE TABLE IF NOT EXISTS logins (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS logins_user ON logins (user_id, created_at);
CREATE TABLE IF NOT EXISTS activity_days (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date    TEXT NOT NULL,
  PRIMARY KEY (user_id, date)
);

-- Automatic "you haven't tracked for N days" reminders: last reminder per client.
CREATE TABLE IF NOT EXISTS reminder_state (
  user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_sent_date TEXT NOT NULL,
  last_result    TEXT
);

-- Food database: calories per 100 g (or 100 ml).
CREATE TABLE IF NOT EXISTS foods (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  kcal       REAL NOT NULL,
  unit       TEXT NOT NULL DEFAULT 'g' CHECK (unit IN ('g', 'ml')),
  category   TEXT,
  is_custom  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Nutrition plan: meals with items. Items keep a copy of name and kcal so the plan stays stable.
CREATE TABLE IF NOT EXISTS meals (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  position  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS meals_client ON meals (client_id, position);
CREATE TABLE IF NOT EXISTS meal_items (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  meal_id  INTEGER NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  food_id  INTEGER REFERENCES foods(id) ON DELETE SET NULL,
  name     TEXT NOT NULL,
  kcal     REAL NOT NULL,
  unit     TEXT NOT NULL DEFAULT 'g',
  amount   REAL NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS meal_items_meal ON meal_items (meal_id, position);

-- Client requests to swap a food or a whole meal; only the coach changes the plan.
CREATE TABLE IF NOT EXISTS swap_requests (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type           TEXT NOT NULL CHECK (type IN ('item', 'meal')),
  meal_id        INTEGER REFERENCES meals(id) ON DELETE SET NULL,
  item_id        INTEGER REFERENCES meal_items(id) ON DELETE SET NULL,
  subject        TEXT NOT NULL,
  wish           TEXT,
  wanted_food_id INTEGER REFERENCES foods(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'declined')),
  coach_note     TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  resolved_at    TEXT
);
CREATE INDEX IF NOT EXISTS swap_requests_client ON swap_requests (client_id, status);

-- Extra measurements per client category (configured by the coach in the admin tool).
-- kind 'number': one value per day (e.g. Bauchumfang); kind 'pr': strength records (exercise, weight, reps).
CREATE TABLE IF NOT EXISTS metrics (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  unit       TEXT NOT NULL DEFAULT '',
  kind       TEXT NOT NULL DEFAULT 'number' CHECK (kind IN ('number', 'pr')),
  categories TEXT NOT NULL DEFAULT '[]',
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE TABLE IF NOT EXISTS metric_values (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric_id INTEGER NOT NULL REFERENCES metrics(id) ON DELETE CASCADE,
  date      TEXT NOT NULL,
  value     REAL NOT NULL,
  PRIMARY KEY (user_id, metric_id, date)
);
CREATE TABLE IF NOT EXISTS prs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric_id  INTEGER NOT NULL REFERENCES metrics(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  exercise   TEXT NOT NULL,
  weight     REAL NOT NULL,
  reps       INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS prs_user ON prs (user_id, date);

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

-- Training plan (one per client, edited by client and coach) and logged workouts.
CREATE TABLE IF NOT EXISTS training_plans (
  client_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  split          TEXT NOT NULL,
  days_per_week  INTEGER NOT NULL,
  data           TEXT NOT NULL,
  updated_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE TABLE IF NOT EXISTS workouts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  day_id      TEXT NOT NULL,
  day_name    TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (client_id, date, day_id)
);
CREATE TABLE IF NOT EXISTS workout_sets (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_id     INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  exercise_key   TEXT NOT NULL,
  exercise_name  TEXT NOT NULL,
  set_no         INTEGER NOT NULL,
  weight         REAL,
  reps           INTEGER
);
CREATE INDEX IF NOT EXISTS workout_sets_key ON workout_sets (exercise_key, workout_id);

-- Fridge: energy drinks bought with medals in the Hall of Fame shop.
CREATE TABLE IF NOT EXISTS fridge_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  flavor      TEXT NOT NULL,
  cost        INTEGER NOT NULL,
  bought_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS fridge_client ON fridge_items (client_id, id);

-- AI results for the coach: last check-in summary and the current nutrition plan draft per client.
CREATE TABLE IF NOT EXISTS ai_results (
  client_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('checkin', 'nutrition')),
  content     TEXT NOT NULL,
  model       TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (client_id, kind)
);

-- Food diary: what a client ate, with nutrients per 100 g/ml captured at logging time.
CREATE TABLE IF NOT EXISTS food_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  meal        TEXT NOT NULL CHECK (meal IN ('fruehstueck', 'mittag', 'abend', 'snack')),
  name        TEXT NOT NULL,
  brand       TEXT,
  barcode     TEXT,
  food_id     INTEGER REFERENCES foods(id) ON DELETE SET NULL,
  amount      REAL NOT NULL,
  unit        TEXT NOT NULL DEFAULT 'g',
  kcal        REAL NOT NULL,
  protein     REAL,
  carbs       REAL,
  fat         REAL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS food_log_day ON food_log (client_id, date);

-- Products looked up by barcode (Open Food Facts), cached so a code is only fetched once.
CREATE TABLE IF NOT EXISTS barcode_products (
  barcode     TEXT PRIMARY KEY,
  found       INTEGER NOT NULL,
  name        TEXT,
  brand       TEXT,
  kcal        REAL,
  protein     REAL,
  carbs       REAL,
  fat         REAL,
  unit        TEXT,
  serving     REAL,
  fetched_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Daily macro targets in grams, set by the coach (calorie targets stay in goals).
CREATE TABLE IF NOT EXISTS macro_goals (
  user_id  INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  protein  REAL,
  carbs    REAL,
  fat      REAL
);

-- One-time links sent by e-mail: password reset and e-mail confirmation (only the hash is stored).
CREATE TABLE IF NOT EXISTS email_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    TEXT NOT NULL CHECK (purpose IN ('reset', 'verify')),
  email      TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);
CREATE INDEX IF NOT EXISTS email_tokens_user ON email_tokens (user_id, purpose);

-- Invitation links for new clients (only the token's hash is stored).
CREATE TABLE IF NOT EXISTS invites (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash   TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  email        TEXT,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  expires_at   INTEGER NOT NULL,
  mailed_at    TEXT,
  used_at      TEXT,
  revoked_at   TEXT,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- Google Health: encrypted refresh token per client, and one-time OAuth states (CSRF + PKCE).
CREATE TABLE IF NOT EXISTS google_links (
  user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  refresh_token  TEXT NOT NULL,
  scopes         TEXT NOT NULL DEFAULT '',
  connected_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  last_sync_at   TEXT,
  last_error     TEXT
);
CREATE TABLE IF NOT EXISTS google_oauth_states (
  state_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  verifier    TEXT NOT NULL,
  expires_at  INTEGER NOT NULL
);

-- Head2Head: two clients challenge each other in one discipline for a fixed time.
CREATE TABLE IF NOT EXISTS h2h_challenges (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  challenger_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opponent_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric        TEXT NOT NULL,
  days          INTEGER NOT NULL,
  message       TEXT,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'declined', 'cancelled')),
  start_date    TEXT,
  end_date      TEXT,
  ended_notified INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  responded_at  TEXT
);
CREATE INDEX IF NOT EXISTS h2h_challenger ON h2h_challenges (challenger_id);
CREATE INDEX IF NOT EXISTS h2h_opponent ON h2h_challenges (opponent_id);

-- A client without a nutrition plan asks the coach for one, with food preferences.
CREATE TABLE IF NOT EXISTS nutrition_requests (
  client_id   INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  answers     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
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

  addColumns(db, 'checkins', [['highlights', "TEXT NOT NULL DEFAULT '[]'"]]);
  addColumns(db, 'users', [['last_seen_at', 'TEXT'], ['category', 'TEXT'], ['avatar', 'TEXT'], ['avatar_updated', 'TEXT'], ['seen_release', 'TEXT'], ['prefs', 'TEXT']]);
  addColumns(db, 'users', [['email', 'TEXT'], ['email_verified', 'INTEGER NOT NULL DEFAULT 0'], ['h2h_visible', 'INTEGER NOT NULL DEFAULT 0'], ['showcase', "TEXT NOT NULL DEFAULT '[]'"]]);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (email COLLATE NOCASE) WHERE email IS NOT NULL');
  // onboarding: start passwords from the coach must be replaced; existing accounts count as onboarded
  const hadOnboarding = db.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name = 'onboarded_at'").get();
  addColumns(db, 'users', [['must_change_password', 'INTEGER NOT NULL DEFAULT 0'], ['onboarded_at', 'TEXT']]);
  addColumns(db, 'users', [['deletion_requested_at', 'TEXT'], ['deletion_reason', 'TEXT']]);
  if (!hadOnboarding) db.exec("UPDATE users SET onboarded_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE onboarded_at IS NULL");
  // the Apple Health shortcut import was replaced by Google Health
  db.exec('DROP TABLE IF EXISTS health_tokens');
  addColumns(db, 'h2h_challenges', [['final_challenger', 'REAL'], ['final_opponent', 'REAL'], ['winner_id', 'INTEGER'], ['frozen_at', 'TEXT']]);
  addColumns(db, 'email_tokens', [['attempts', 'INTEGER NOT NULL DEFAULT 0']]);

  // Starter extra measurements: belly circumference for diets, gym PRs for building muscle.
  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'metrics_seeded'").get()) {
    const add = db.prepare('INSERT INTO metrics (name, unit, kind, categories) VALUES (?, ?, ?, ?)');
    add.run('Bauchumfang', 'cm', 'number', JSON.stringify(['diet']));
    add.run('Kraft-PRs', 'kg', 'pr', JSON.stringify(['build']));
    db.exec("INSERT INTO settings (key, value) VALUES ('metrics_seeded', 'done')");
  }

  // Starter food database (only once, so foods the coach deleted don't come back).
  // Macros per 100 g/ml for foods and for the foods copied into nutrition plans.
  addColumns(db, 'foods', [['protein', 'REAL'], ['carbs', 'REAL'], ['fat', 'REAL']]);
  addColumns(db, 'meal_items', [['protein', 'REAL'], ['carbs', 'REAL'], ['fat', 'REAL']]);

  // Food database v3 (about 600 foods with macros, many for fitness): add what is missing, fill macros of the
  // standard foods. Foods the coach created or edited keep their values. Raise FOODS_SEED when the list grows.
  const FOODS_SEED = 'foods_seeded_v3';
  if (!db.prepare('SELECT 1 FROM settings WHERE key = ?').get(FOODS_SEED)) {
    const insert = db.prepare('INSERT OR IGNORE INTO foods (name, kcal, unit, category, protein, carbs, fat) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const fill = db.prepare('UPDATE foods SET protein = ?, carbs = ?, fat = ? WHERE name = ? AND is_custom = 0 AND protein IS NULL');
    const fillItems = db.prepare(
      'UPDATE meal_items SET protein = ?, carbs = ?, fat = ? WHERE food_id = (SELECT id FROM foods WHERE name = ?) AND protein IS NULL'
    );
    db.exec('BEGIN');
    for (const [name, kcal, unit, category, protein, carbs, fat] of require('./foods-seed')) {
      insert.run(name, kcal, unit, category, protein, carbs, fat);
      fill.run(protein, carbs, fat, name);
      fillItems.run(protein, carbs, fat, name);
    }
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, 'done')").run(FOODS_SEED);
    db.exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('foods_seeded', 'done')");
    db.exec('COMMIT');
  }

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
