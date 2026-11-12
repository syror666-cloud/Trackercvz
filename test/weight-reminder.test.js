'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const { openDb, createUser } = require('../src/db');
const { createApp } = require('../src/app');
const { createNotifier } = require('../src/notify');
const { createReminders } = require('../src/admin');

test('daily weight reminder: dashboard data and push to everyone without weight today', async (t) => {
  const db = openDb(':memory:');
  createUser(db, { username: 'coach', displayName: 'Coach', password: 'coachpass123', role: 'coach' });
  const pushes = [];
  const notifier = createNotifier(db, { subject: 'mailto:t@example.com', fetchImpl: async () => ({ status: 201 }) });
  const realSend = notifier.sendToUsers;
  notifier.sendToUsers = async (ids, payload) => {
    pushes.push({ ids, payload });
    return realSend(ids, payload);
  };
  const reminders = createReminders(db, notifier);
  const server = http.createServer(createApp({ db, notifier, reminders, publicDir: path.join(__dirname, '..', 'public') }));
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    return async (method, url, body) => {
      const res = await fetch(base + url, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, data: await res.json().catch(() => null) };
    };
  };
  const subscribe = (c) => {
    const e = crypto.createECDH('prime256v1');
    e.generateKeys();
    return c('POST', '/api/push/subscribe', {
      subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}`, keys: { p256dh: e.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } },
    });
  };

  const coach = client();
  await coach('POST', '/api/login', { username: 'coach', password: 'coachpass123' });
  for (const u of ['anna', 'ben', 'cara']) await coach('POST', '/api/clients', { username: u, displayName: u[0].toUpperCase() + u.slice(1), password: `${u}pass1234` });
  const login = async (u) => {
    const c = client();
    await c('POST', '/api/login', { username: u, password: `${u}pass1234` });
    return c;
  };
  const anna = await login('anna'); // weighs in today
  const ben = await login('ben'); // forgets, has push
  const cara = await login('cara'); // forgets, no push
  await subscribe(anna);
  await subscribe(ben);
  const today = reminders.today();
  await anna('PUT', `/api/entries/${today}`, { weight: 61.2 });
  await ben('PUT', `/api/entries/${today}`, { steps: 5000 }); // an entry, but no weight

  // Dashboard data
  const list = (await coach('GET', '/api/clients')).data.clients;
  assert.deepEqual(list.map((c) => [c.displayName, c.weightToday]), [['Anna', 61.2], ['Ben', null], ['Cara', null]]);

  // Admin preview + defaults (on, 18:00)
  const ov = (await coach('GET', '/api/admin/overview')).data;
  assert.deepEqual([ov.weightReminder.enabled, ov.weightReminder.time], [true, '18:00']);
  assert.deepEqual(ov.weightToday.map((c) => [c.name, c.state]), [['Anna', 'done'], ['Ben', 'due'], ['Cara', 'no-push']]);

  // Run now → only Ben
  const run = (await coach('POST', '/api/admin/weight-reminder/run')).data.result;
  assert.deepEqual(run.names, ['Ben']);
  assert.match(pushes.at(-1).payload.body, /Hey Ben, du hast heute noch kein Gewicht eingetragen/);

  // Scheduler: not before the configured time, then once per day
  const at = (hhmm) => require('../src/schedule').zonedToUtc(today, hhmm, notifier.timezone);
  assert.equal(await reminders.runWeightScheduled(at('17:59')), null);
  const first = await reminders.runWeightScheduled(at('18:01'));
  assert.equal(first.recipients, 1);
  assert.equal(await reminders.runWeightScheduled(at('18:30')), null);

  // Settings
  assert.equal((await coach('PUT', '/api/admin/weight-reminder', { time: '7:00' })).status, 400);
  const off = (await coach('PUT', '/api/admin/weight-reminder', { enabled: false, time: '19:30', title: 'Waage!' })).data.weightReminder;
  assert.deepEqual([off.enabled, off.time, off.title], [false, '19:30', 'Waage!']);
  assert.equal((await anna('PUT', '/api/admin/weight-reminder', { enabled: true })).status, 403);
});
