'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { openDb, createUser } = require('../src/db');
const { createBackups, unpack } = require('../src/backup');
const { localDate } = require('../src/schedule');

const quiet = { log() {}, warn() {}, error() {} };
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sot-backup-'));

test('backup: consistent, encrypted, restorable, mailed; daily schedule; no mail without a key', async () => {
  const dir = tmpDir();
  const db = openDb(path.join(dir, 'tracker.db'));
  createUser(db, { username: 'coach', displayName: 'Coach', password: 'coachpass123', role: 'coach' });
  const outbox = [];
  const mailer = { enabled: true, send: async (m) => { outbox.push(m); } };
  let clock = Date.parse('2026-11-14T01:30:00Z'); // 02:30 in Berlin
  const b = createBackups({ db, dataDir: dir, mailer, localDate, timezone: 'Europe/Berlin', log: quiet, env: { BACKUP_KEY: 'geheim-123', BACKUP_EMAIL: 'coach@example.com' }, now: () => clock });
  assert.equal(await b.tick(), null, 'not before 3 o\'clock');
  clock = Date.parse('2026-11-14T02:05:00Z'); // 03:05
  const st = await b.tick();
  assert.equal(st.local, 1);
  assert.equal(st.last.encrypted, true);
  assert.equal(st.last.mailed, 'coach@example.com');
  assert.equal(await b.tick(), null, 'once a day');
  // the mail carries the encrypted file; it isn't readable without the key
  const att = outbox[0].attachments[0];
  assert.match(att.filename, /\.db\.gz\.enc$/);
  assert.equal(att.content.subarray(0, 6).toString(), 'SOTBK1');
  assert.ok(!att.content.includes(Buffer.from('coach')));
  assert.throws(() => unpack(att.content, 'falsch'));
  // restore
  const restored = path.join(dir, 'restored.db');
  fs.writeFileSync(restored, unpack(att.content, 'geheim-123'));
  const r = new DatabaseSync(restored);
  assert.equal(r.prepare('SELECT username FROM users').get().username, 'coach');
  r.close();
  // old local backups are pruned after 14 days
  clock += 15 * 864e5;
  await b.run('manual');
  assert.equal(b.status().local, 1);
  // without a key: kept locally (gzip only), never mailed
  const b2 = createBackups({ db, dataDir: tmpDir(), mailer, localDate, timezone: 'Europe/Berlin', log: quiet, env: { BACKUP_EMAIL: 'coach@example.com' }, now: () => clock });
  const n = outbox.length;
  const st2 = await b2.run('manual');
  assert.equal(st2.last.encrypted, false);
  assert.equal(st2.last.mailed, null);
  assert.equal(outbox.length, n);
  assert.equal(st2.mailReady, false);
});
