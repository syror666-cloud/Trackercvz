'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { openDb, createUser, wakeArchived } = require('../src/db');
const { createApp } = require('../src/app');
const { createNotifier } = require('../src/notify');
const { createReminders } = require('../src/admin');
const { localDate } = require('../src/schedule');

const today = () => localDate(Date.now(), 'Europe/Berlin');
const plus = (n) => new Date(Date.parse(`${today()}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

test('archive: paused clients leave the to-dos and come back on their date', async (t) => {
  const db = openDb(':memory:');
  createUser(db, { username: 'coach', displayName: 'Coach', password: 'coachpass123', role: 'coach' });
  const notifier = createNotifier(db, { subject: 'mailto:t@example.com', fetchImpl: async () => ({ status: 201 }), timezone: 'Europe/Berlin' });
  const reminders = createReminders(db, notifier);
  const server = http.createServer(createApp({ db, notifier, reminders, publicDir: path.join(__dirname, '..', 'public') }));
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
  const anna = createUser(db, { username: 'anna', displayName: 'Anna', password: 'passwort123', role: 'client' });
  const ben = createUser(db, { username: 'ben', displayName: 'Ben', password: 'passwort123', role: 'client' });
  db.prepare("UPDATE users SET created_at = datetime('now', '-30 days')").run();

  // validation
  assert.equal((await call('PATCH', `/api/clients/${anna}`, { archive: { until: today() } })).status, 400);
  assert.equal((await call('PATCH', `/api/clients/${anna}`, { archive: { until: plus(400) } })).status, 400);
  assert.equal((await call('PATCH', `/api/clients/${anna}`, { archive: { until: '2026-02-31' } })).status, 400);

  const r = await call('PATCH', `/api/clients/${anna}`, { archive: { until: plus(7), note: 'Urlaub' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.client.archiveUntil, plus(7));
  const list = (await call('GET', '/api/clients')).data.clients;
  assert.equal(list.find((c) => c.id === anna).archiveNote, 'Urlaub');
  assert.ok(list.find((c) => c.id === anna).archivedAt);
  assert.equal(list.find((c) => c.id === ben).archivedAt, null);

  // out of attention, check-in queue and reminders
  const att = (await call('GET', '/api/attention')).data;
  assert.equal(att.total, 1);
  assert.equal(att.archived, 1);
  assert.deepEqual((await call('GET', '/api/checkins/queue')).data.clients.map((c) => c.id), [ben]);
  assert.deepEqual(reminders.evaluate({ days: 1 }, today()).map((c) => c.id), [ben]);
  assert.deepEqual(reminders.weightEvaluate(today()).map((c) => c.id), [ben]);

  // the date comes: back automatically
  assert.deepEqual(wakeArchived(db, plus(6)), []);
  assert.deepEqual(wakeArchived(db, plus(7)), [anna]);
  assert.equal((await call('GET', '/api/clients')).data.clients.find((c) => c.id === anna).archivedAt, null);

  // open-ended pause, then brought back by hand
  await call('PATCH', `/api/clients/${ben}`, { archive: {} });
  assert.deepEqual(wakeArchived(db, plus(365)), []);
  await call('PATCH', `/api/clients/${ben}`, { archive: null });
  assert.equal((await call('GET', '/api/attention')).data.archived, 0);

  // delete
  assert.equal((await call('DELETE', `/api/clients/${ben}`)).status, 200);
  assert.equal(db.prepare('SELECT 1 FROM users WHERE id = ?').get(ben), undefined);
});
