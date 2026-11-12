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
  for (let i = 0; i < 22; i++) results.push(await login('Coach', 'falsch', `203.0.113.${i}`));
  assert.equal(results.filter((s) => s === 401).length, 20);
  assert.deepEqual(results.slice(20), [429, 429]);
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
