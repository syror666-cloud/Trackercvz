'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { openDb, createUser } = require('./src/db');
const { createApp } = require('./src/app');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));

fs.mkdirSync(DATA_DIR, { recursive: true });
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

const app = createApp({
  db,
  publicDir: path.join(__dirname, 'public'),
  secureCookies: process.env.SECURE_COOKIES === 'true' || process.env.NODE_ENV === 'production',
});

http.createServer(app).listen(PORT, () => {
  console.log(`Tracker läuft auf http://localhost:${PORT}`);
});
