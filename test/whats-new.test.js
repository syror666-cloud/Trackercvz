'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { openDb, createUser } = require('../src/db');
const { createApp } = require('../src/app');
const { createNotifier } = require('../src/notify');
const { createReminders } = require('../src/admin');

test('"what\'s new" is remembered per user on the server', async (t) => {
  const db = openDb(':memory:');
  createUser(db, { username: 'coach', displayName: 'Coach', password: 'coachpass123', role: 'coach' });
  const notifier = createNotifier(db, { subject: 'mailto:t@example.com', fetchImpl: async () => ({ status: 201 }) });
  const server = http.createServer(createApp({ db, notifier, reminders: createReminders(db, notifier), publicDir: path.join(__dirname, '..', 'public') }));
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  await call('POST', '/api/login', { username: 'coach', password: 'coachpass123' });
  assert.equal((await call('GET', '/api/me')).data.user.seenRelease, null);
  assert.equal((await call('POST', '/api/me/release', {})).status, 400);
  assert.equal((await call('POST', '/api/me/release', { release: '2026-11-training-hof' })).status, 200);
  assert.equal((await call('GET', '/api/me')).data.user.seenRelease, '2026-11-training-hof');
  cookie = '';
  assert.equal((await call('POST', '/api/me/release', { release: 'x' })).status, 401);
});
