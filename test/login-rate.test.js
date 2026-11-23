'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { openDb, createUser } = require('../src/db');
const { createApp } = require('../src/app');
const { createNotifier } = require('../src/notify');
const { createReminders } = require('../src/admin');

async function start(trustProxy) {
  const db = openDb(':memory:');
  createUser(db, { username: 'coach', displayName: 'Coach', password: 'coachpass123', role: 'coach' });
  createUser(db, { username: 'max', displayName: 'Max', password: 'maxpass1234', role: 'client' });
  const notifier = createNotifier(db, {});
  const server = http.createServer(createApp({ db, notifier, reminders: createReminders(db, notifier), trustProxy, publicDir: path.join(__dirname, '..', 'public') }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = (username, password, xff) => fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(xff ? { 'X-Forwarded-For': xff } : {}) },
    body: JSON.stringify({ username, password }),
  }).then((r) => r.status);
  return { server, login };
}

test('security: forged X-Forwarded-For entries do not reset the login limit (behind a proxy)', async (t) => {
  const { server, login } = await start(true);
  t.after(() => server.close());
  // the proxy appends the real address last; the attacker controls everything before it
  const results = [];
  for (let i = 0; i < 12; i++) results.push(await login('coach', 'falsch', `198.51.100.${i}, 203.0.113.7`));
  assert.deepEqual(results.slice(0, 10), Array(10).fill(401));
  assert.deepEqual(results.slice(10), [429, 429]);
  // another real address is not affected
  assert.equal(await login('max', 'maxpass1234', '203.0.113.99'), 200);
});

test('security: per-account limit holds even when the attacker really changes addresses', async (t) => {
  const { server, login } = await start(true);
  t.after(() => server.close());
  const results = [];
  for (let i = 0; i < 12; i++) results.push(await login('Coach', 'falsch', `203.0.113.${i}`));
  assert.equal(results.filter((s) => s === 401).length, 10);
  assert.deepEqual(results.slice(10), [429, 429]);
  // the account stays locked for the window, even with the right password; other accounts work
  assert.equal(await login('coach', 'coachpass123', '203.0.113.200'), 429);
  assert.equal(await login('max', 'maxpass1234', '203.0.113.201'), 200);
});

test('security: without a proxy the forwarded header is ignored', async (t) => {
  const { server, login } = await start(false);
  t.after(() => server.close());
  const results = [];
  for (let i = 0; i < 11; i++) results.push(await login('max', 'falsch', `198.51.100.${i}`));
  assert.equal(results[10], 429);
});

test('security: weak passwords are refused, CSV cells cannot run formulas', async () => {
  const { validatePassword, csvCell } = require('../src/app')._test || {};
  if (!validatePassword) return; // helpers not exported
  for (const p of ['12345678', 'passwort1', 'aaaaaaaa', 'Maximilian2024']) {
    assert.throws(() => validatePassword(p, { username: 'max', displayName: 'Maximilian Muster' }), /zu leicht/);
  }
  assert.equal(validatePassword('Wolkenberg7', { username: 'max' }), 'Wolkenberg7');
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell('-5 kg'), "'-5 kg");
  assert.equal(csvCell(-5), '-5');
});

test('security: clients can only log the last 31 days (no inventing a past for medals)', async (t) => {
  const http = require('node:http');
  const path = require('node:path');
  const { openDb, createUser } = require('../src/db');
  const { createApp } = require('../src/app');
  const db = openDb(':memory:');
  createUser(db, { username: 'anna', displayName: 'Anna', password: 'annapass123', role: 'client' });
  const server = http.createServer(createApp({ db, publicDir: path.join(__dirname, '..', 'public') }));
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const lg = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'anna', password: 'annapass123' }) });
  const Cookie = lg.headers.get('set-cookie').split(';')[0];
  const put = (date, body) => fetch(`${base}${date}`, { method: date.includes('foodlog') || date.includes('workouts') ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json', Cookie }, body: JSON.stringify(body) }).then((r) => r.status);
  const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  assert.equal(await put(`/api/entries/${day(20)}`, { weight: 70 }), 200);
  assert.equal(await put(`/api/entries/${day(45)}`, { weight: 70 }), 400);
  assert.equal(await put('/api/entries/2015-01-01', { steps: 150000 }), 400);
  assert.equal(await put('/api/foodlog', { date: day(60), meal: 'mittag', amount: 100, name: 'x', unit: 'g', kcal: 100 }), 400);
  assert.equal(await put('/api/training/workouts', { date: day(60), dayId: 'd1', dayName: 'x', exercises: [{ name: 'Bank', sets: [{ weight: 50, reps: 5 }] }] }), 400);
});
