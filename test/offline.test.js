'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { openDb, createUser } = require('../src/db');
const { createApp } = require('../src/app');
const { localDate } = require('../src/schedule');

test('offline outbox: a write sent twice with the same Idempotency-Key is saved once', async (t) => {
  const db = openDb(':memory:');
  createUser(db, { username: 'anna', displayName: 'Anna', password: 'annapass123', role: 'client' });
  createUser(db, { username: 'ben', displayName: 'Ben', password: 'benpass1234', role: 'client' });
  const server = http.createServer(createApp({ db, publicDir: path.join(__dirname, '..', 'public') }));
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const jar = {};
  for (const [w, p] of [['anna', 'annapass123'], ['ben', 'benpass1234']]) {
    const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: w, password: p }) });
    jar[w] = r.headers.get('set-cookie').split(';')[0];
  }
  const send = (who, url, body, key) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: jar[who], ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, replay: r.headers.get('idempotent-replay'), data: await r.json() }));
  const today = localDate(Date.now(), 'Europe/Berlin');
  const food = { date: today, meal: 'snack', amount: 150, name: 'Banane', unit: 'g', kcal: 89 };

  // the phone sends, the answer is lost, the outbox sends again
  const a = await send('anna', '/api/foodlog', food, 'key-food-0001');
  const b = await send('anna', '/api/foodlog', food, 'key-food-0001');
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(b.replay, 'true');
  assert.deepEqual(b.data, a.data, 'same answer again');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM food_log').get().n, 1);
  // in parallel too
  const par = await Promise.all(Array.from({ length: 5 }, () => send('anna', '/api/messages', { body: 'Bin offline gewesen' }, 'key-msg-00001')));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 1);
  assert.ok(par.every((r) => r.status === 201 || r.status === 409));
  // another key or another person: a new entry
  await send('anna', '/api/foodlog', food, 'key-food-0002');
  await send('ben', '/api/foodlog', food, 'key-food-0001');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM food_log').get().n, 3);
  // without a key: as before
  await send('anna', '/api/foodlog', food);
  await send('anna', '/api/foodlog', food);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM food_log').get().n, 5);
  // a failed request is not stored: fixing it and sending again works
  const bad = await send('anna', '/api/foodlog', { ...food, amount: -1 }, 'key-food-0003');
  assert.equal(bad.status, 400);
  assert.equal((await send('anna', '/api/foodlog', food, 'key-food-0003')).status, 200);
});
