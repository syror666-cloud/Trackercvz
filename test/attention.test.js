'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { openDb, createUser } = require('../src/db');
const { createApp } = require('../src/app');
const { createNotifier } = require('../src/notify');
const { createReminders } = require('../src/admin');
const { localDate } = require('../src/schedule');

const today = () => localDate(Date.now(), 'Europe/Berlin');
const ago = (n) => new Date(Date.parse(`${today()}T00:00:00Z`) - n * 864e5).toISOString().slice(0, 10);

test('attention: clients ranked by explainable signals', async (t) => {
  const db = openDb(':memory:');
  const coachId = createUser(db, { username: 'coach', displayName: 'Coach', password: 'coachpass123', role: 'coach' });
  const notifier = createNotifier(db, { subject: 'mailto:t@example.com', fetchImpl: async () => ({ status: 201 }), timezone: 'Europe/Berlin' });
  const server = http.createServer(createApp({ db, notifier, reminders: createReminders(db, notifier), publicDir: path.join(__dirname, '..', 'public') }));
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  await call('POST', '/api/login', { username: 'coach', password: 'coachpass123' });
  const mk = (u) => createUser(db, { username: u, displayName: u, password: 'passwort123', role: 'client' });
  const entry = db.prepare('INSERT INTO entries (user_id, date, weight, steps, calories_ok) VALUES (?, ?, ?, ?, ?)');
  const old = (id) => db.prepare("UPDATE users SET created_at = datetime('now', '-30 days') WHERE id = ?").run(id);
  // dieter: weight goes up although he wants to lose, steps collapse, quiet for 4 days, waiting message
  const dieter = mk('dieter'); old(dieter);
  db.prepare('UPDATE users SET category = ? WHERE id = ?').run('diet', dieter);
  for (let i = 13; i >= 4; i--) entry.run(dieter, ago(i), i >= 7 ? 90 : 91.2, i >= 7 ? 11000 : 5000, 1);
  db.prepare("INSERT INTO messages (client_id, sender_id, body, created_at) VALUES (?, ?, 'Hilfe?', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-20 hours'))").run(dieter, dieter);
  db.prepare("INSERT INTO checkins (client_id, coach_id, message, created_at) VALUES (?, ?, 'x', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-12 days'))").run(dieter, coachId);
  // fine: logs every day, steady
  const fine = mk('fine'); old(fine);
  for (let i = 13; i >= 0; i--) entry.run(fine, ago(i), 70, 9000, 1);
  db.prepare("INSERT INTO checkins (client_id, coach_id, message, created_at) VALUES (?, ?, 'x', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-2 days'))").run(fine, coachId);
  // newbie: account 5 days old, never logged
  const newbie = mk('newbie');
  db.prepare("UPDATE users SET created_at = datetime('now', '-5 days') WHERE id = ?").run(newbie);

  const r = (await call('GET', '/api/attention')).data;
  assert.equal(r.total, 3);
  assert.equal(r.fine, 1);
  assert.deepEqual(r.clients.map((c) => c.displayName), ['dieter', 'newbie']);
  const d = r.clients[0];
  assert.equal(d.level, 'high');
  const keys = d.reasons.map((x) => x.key);
  for (const k of ['quiet', 'weight-wrong', 'steps', 'messages', 'checkin']) assert.ok(keys.includes(k), k);
  assert.match(d.reasons.find((x) => x.key === 'weight-wrong').text, /entgegen dem Ziel/);
  assert.match(r.clients[1].reasons[0].text, /noch nichts eingetragen/);
  // clients can't see it
  const client = await fetch(`${base}/api/attention`);
  assert.equal(client.status, 401);
});
