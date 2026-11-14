#!/usr/bin/env node
'use strict';

// Restores a StayOnTrack backup: node scripts/restore-backup.js <backup-file> <target.db>
// Encrypted backups (*.enc) need the same BACKUP_KEY as when they were made (environment variable or prompt).
// Stop the app first and keep a copy of the current tracker.db before replacing it.

const fs = require('node:fs');
const { unpack } = require('../src/backup');

const [file, target] = process.argv.slice(2);
if (!file || !target) {
  console.error('Aufruf: BACKUP_KEY=… node scripts/restore-backup.js <sicherung> <ziel.db>');
  process.exit(1);
}
if (fs.existsSync(target)) {
  console.error(`${target} gibt es schon – bitte einen neuen Dateinamen wählen oder die Datei erst wegsichern.`);
  process.exit(1);
}
try {
  const db = unpack(fs.readFileSync(file), process.env.BACKUP_KEY || '');
  if (db.subarray(0, 15).toString() !== 'SQLite format 3') throw new Error('Das Ergebnis ist keine SQLite-Datenbank');
  fs.writeFileSync(target, db, { mode: 0o600 });
  console.log(`Wiederhergestellt: ${target} (${Math.round(db.length / 1024)} KB). Lege sie als tracker.db in den Datenordner und starte die App neu.`);
} catch (err) {
  console.error('Wiederherstellen fehlgeschlagen:', err.message.includes('auth') || err.message.includes('Unsupported state') ? 'falscher BACKUP_KEY oder beschädigte Datei' : err.message);
  process.exit(1);
}
