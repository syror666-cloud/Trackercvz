'use strict';

// Usage: npm run create-coach -- <benutzername> <passwort> ["Anzeigename"]
const fs = require('node:fs');
const path = require('node:path');
const { openDb, createUser } = require('../src/db');

const [username, password, displayName] = process.argv.slice(2);
if (!username || !password) {
  console.error('Aufruf: npm run create-coach -- <benutzername> <passwort> ["Anzeigename"]');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Das Passwort muss mindestens 8 Zeichen haben.');
  process.exit(1);
}

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
fs.mkdirSync(dataDir, { recursive: true });
const db = openDb(path.join(dataDir, 'tracker.db'));
try {
  createUser(db, { username, displayName: displayName || username, password, role: 'coach' });
  console.log(`Coach-Konto "${username}" angelegt.`);
} catch (err) {
  console.error(/UNIQUE/.test(err.message) ? 'Benutzername ist bereits vergeben.' : err.message);
  process.exit(1);
}
