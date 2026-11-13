'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { openDb, createUser } = require('./src/db');
const { createApp } = require('./src/app');
const { createNotifier } = require('./src/notify');
const { createReminders } = require('./src/admin');
const { openCatalog } = require('./src/catalog');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));

try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.accessSync(DATA_DIR, fs.constants.W_OK);
} catch (err) {
  console.error(`Datenordner "${DATA_DIR}" ist nicht vorhanden oder nicht beschreibbar (${err.code}).`);
  console.error('Auf Render: Persistent Disk anlegen und als Mount Path exakt denselben Pfad wie DATA_DIR eintragen.');
  process.exit(1);
}
const db = openDb(path.join(DATA_DIR, 'tracker.db'));

// First start: create the coach account from environment variables.
const hasCoach = db.prepare("SELECT 1 FROM users WHERE role = 'coach' LIMIT 1").get();
if (!hasCoach) {
  const { COACH_USERNAME, COACH_PASSWORD, COACH_NAME } = process.env;
  if (COACH_USERNAME && COACH_PASSWORD) {
    if (COACH_PASSWORD.length < 8) {
      console.error('COACH_PASSWORD muss mindestens 8 Zeichen haben.');
      process.exit(1);
    }
    createUser(db, { username: COACH_USERNAME, displayName: COACH_NAME || COACH_USERNAME, password: COACH_PASSWORD, role: 'coach' });
    console.log(`Coach-Konto "${COACH_USERNAME}" angelegt.`);
  } else {
    console.warn('Noch kein Coach-Konto vorhanden. Setze COACH_USERNAME und COACH_PASSWORD oder führe "npm run create-coach" aus.');
  }
}

const notifier = createNotifier(db, {
  subject: process.env.VAPID_SUBJECT,
  timezone: process.env.APP_TIMEZONE || 'Europe/Berlin',
});

const reminders = createReminders(db, notifier);

// Scheduled coach push messages and the daily inactivity reminder: check every 30 seconds.
setInterval(() => {
  notifier.runDue().catch((err) => console.error(err));
  reminders.runScheduled().catch((err) => console.error(err));
  reminders.runWeightScheduled().catch((err) => console.error(err));
}, 30000).unref();

// Barcode product database (built once from the bundled Open Food Facts extract).
let catalog = null;
try {
  catalog = openCatalog(DATA_DIR);
} catch (err) {
  console.error('Produktdatenbank konnte nicht geladen werden – Barcodes werden nur online gesucht:', err.message);
}

const app = createApp({
  db,
  catalog,
  notifier,
  reminders,
  publicDir: path.join(__dirname, 'public'),
  secureCookies: process.env.SECURE_COOKIES === 'true' || process.env.NODE_ENV === 'production',
  trustProxy: process.env.TRUST_PROXY === 'true' || Boolean(process.env.RENDER),
});

http.createServer(app).listen(PORT, () => {
  console.log(`Tracker läuft auf http://localhost:${PORT}`);
});
