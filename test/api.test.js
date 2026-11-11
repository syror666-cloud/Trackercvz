'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { openDb, createUser } = require('../src/db');
const { createApp } = require('../src/app');

async function setup() {
  const db = openDb(':memory:');
  createUser(db, { username: 'coach', displayName: 'Coach', password: 'coachpass123', role: 'coach' });
  const server = http.createServer(createApp({ db, publicDir: path.join(__dirname, '..', 'public') }));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;

  function client() {
    let cookie = '';
    return async (method, url, body) => {
      const res = await fetch(base + url, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      const text = await res.text();
      let data = text;
      try { data = JSON.parse(text); } catch {}
      return { status: res.status, data, headers: res.headers };
    };
  }
  return { server, base, client };
}

test('coach creates client, client logs entries, coach sees them', async (t) => {
  const { server, client } = await setup();
  t.after(() => server.close());

  const coach = client();
  assert.equal((await coach('GET', '/api/me')).status, 401);
  assert.equal((await coach('POST', '/api/login', { username: 'coach', password: 'wrong-password' })).status, 401);
  const login = await coach('POST', '/api/login', { username: 'coach', password: 'coachpass123' });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.role, 'coach');

  const created = await coach('POST', '/api/clients', { username: 'max', displayName: 'Max', password: 'maxpass123' });
  assert.equal(created.status, 201);
  const clientId = created.data.client.id;
  assert.equal((await coach('POST', '/api/clients', { username: 'MAX', password: 'whatever123' })).status, 409);

  const max = client();
  assert.equal((await max('POST', '/api/login', { username: 'max', password: 'maxpass123' })).status, 200);
  assert.equal((await max('GET', '/api/clients')).status, 403);

  let r = await max('PUT', '/api/entries/2026-01-01', { weight: '82,4', steps: 9000 });
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.entry.weight, r.data.entry.steps, r.data.entry.sleep], [82.4, 9000, null]);

  // Partial update keeps existing values.
  r = await max('PUT', '/api/entries/2026-01-01', { sleep: 7.5 });
  assert.deepEqual([r.data.entry.weight, r.data.entry.steps, r.data.entry.sleep], [82.4, 9000, 7.5]);

  await max('PUT', '/api/entries/2026-01-02', { weight: 82.0, note: 'Beine; "schwer"' });

  // Validation
  assert.equal((await max('PUT', '/api/entries/2026-02-30', { weight: 80 })).status, 400);
  assert.equal((await max('PUT', '/api/entries/2026-01-03', { weight: 5 })).status, 400);
  assert.equal((await max('PUT', '/api/entries/2026-01-03', { steps: 10.5 })).status, 400);
  assert.equal((await max('PUT', '/api/entries/2999-01-01', { weight: 80 })).status, 400);

  // Coach can read but not write entries.
  const list = await coach('GET', `/api/entries?userId=${clientId}`);
  assert.equal(list.status, 200);
  assert.deepEqual(list.data.entries.map((e) => e.date), ['2026-01-01', '2026-01-02']);
  assert.equal((await coach('PUT', '/api/entries/2026-01-05', { weight: 80 })).status, 403);
  assert.equal((await coach('GET', '/api/entries?userId=999')).status, 404);

  const csv = await coach('GET', `/api/entries.csv?userId=${clientId}`);
  assert.equal(csv.status, 200);
  assert.match(csv.data, /2026-01-01;82,4;9000;7,5;/);
  assert.match(csv.data, /"Beine; ""schwer"""/);

  const overview = await coach('GET', '/api/clients');
  assert.equal(overview.data.clients[0].lastWeight, 82);
  assert.equal(overview.data.clients[0].firstWeight, 82.4);

  // Goals: coach sets, client reads, client cannot set.
  assert.equal((await coach('PUT', `/api/goals?userId=${clientId}`, { targetWeight: 78, stepsGoal: 10000, sleepGoal: 7.5 })).status, 200);
  assert.deepEqual((await max('GET', '/api/goals')).data.goals, { targetWeight: 78, stepsGoal: 10000, sleepGoal: 7.5 });
  assert.equal((await max('PUT', `/api/goals?userId=${clientId}`, { targetWeight: 50 })).status, 403);

  // Clearing all values removes the entry.
  r = await max('PUT', '/api/entries/2026-01-02', { weight: null, note: null });
  assert.equal(r.data.entry, null);
  assert.equal((await max('GET', '/api/entries')).data.entries.length, 1);

  // Password reset by coach logs the client out.
  assert.equal((await coach('PATCH', `/api/clients/${clientId}`, { password: 'newpass12345' })).status, 200);
  assert.equal((await max('GET', '/api/me')).status, 401);
  assert.equal((await max('POST', '/api/login', { username: 'max', password: 'newpass12345' })).status, 200);

  // Delete client removes their data.
  assert.equal((await coach('DELETE', `/api/clients/${clientId}`)).status, 200);
  assert.equal((await coach('GET', '/api/clients')).data.clients.length, 0);
  assert.equal((await max('GET', '/api/me')).status, 401);
});

test('clients cannot see each other', async (t) => {
  const { server, client } = await setup();
  t.after(() => server.close());
  const coach = client();
  await coach('POST', '/api/login', { username: 'coach', password: 'coachpass123' });
  const a = (await coach('POST', '/api/clients', { username: 'anna', password: 'annapass123' })).data.client.id;
  await coach('POST', '/api/clients', { username: 'ben', password: 'benpass1234' });

  const anna = client();
  await anna('POST', '/api/login', { username: 'anna', password: 'annapass123' });
  await anna('PUT', '/api/entries/2026-01-01', { weight: 60 });

  const ben = client();
  await ben('POST', '/api/login', { username: 'ben', password: 'benpass1234' });
  // userId is ignored for clients: they only ever get their own data.
  const r = await ben('GET', `/api/entries?userId=${a}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.entries.length, 0);
});

test('rejects non-JSON writes and serves the app shell', async (t) => {
  const { server, base } = await setup();
  t.after(() => server.close());
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'username=coach&password=coachpass123',
  });
  assert.equal(res.status, 415);

  const page = await fetch(`${base}/some/deep/link`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<main id="app"/);
  const traversal = await fetch(`${base}/..%2f..%2fpackage.json`);
  assert.doesNotMatch(await traversal.text(), /"scripts"/);
});
