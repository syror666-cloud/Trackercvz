'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { openDb, createUser } = require('../src/db');
const { createApp } = require('../src/app');
const { createNotifier } = require('../src/notify');

test('feedback: thank-you once, wishes become coach to-dos', async (t) => {
  const db = openDb(':memory:');
  createUser(db, { username: 'coach', displayName: 'Coach', password: 'coachpass123', role: 'coach' });
  const anna = createUser(db, { username: 'anna', displayName: 'Anna', password: 'annapass123', role: 'client' });
  createUser(db, { username: 'ben', displayName: 'Ben', password: 'benpass1234', role: 'client' });
  db.prepare("UPDATE users SET onboarded_at = '2026-01-01T00:00:00Z'").run();
  const notifier = createNotifier(db, { subject: 'mailto:t@example.com', fetchImpl: async () => ({ status: 201 }) });
  const pushed = [];
  notifier.onSend((ids, p) => pushed.push(p.title));
  const server = http.createServer(createApp({ db, notifier, publicDir: path.join(__dirname, '..', 'public') }));
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const jar = {};
  const call = async (who, method, url, body) => {
    const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(jar[who] ? { Cookie: jar[who] } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) jar[who] = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  for (const [w, p] of [['coach', 'coachpass123'], ['anna', 'annapass123'], ['ben', 'benpass1234']]) await call(w, 'POST', '/api/login', { username: w, password: p });

  assert.equal((await call('anna', 'GET', '/api/me')).data.user.showThanks, true);
  assert.equal((await call('coach', 'GET', '/api/me')).data.user.showThanks, false);
  const th = (await call('anna', 'GET', '/api/thanks')).data;
  assert.equal(th.community.members, 2);
  assert.equal((await call('coach', 'GET', '/api/thanks')).status, 403);

  // a wish: to-do for the coach, push, the thank-you screen is done
  assert.equal((await call('anna', 'POST', '/api/feedback', { body: '  ' })).status, 400);
  assert.equal((await call('anna', 'POST', '/api/feedback', { body: 'Wasser-Erinnerung bitte!' })).status, 201);
  assert.equal((await call('anna', 'GET', '/api/me')).data.user.showThanks, false);
  assert.ok(pushed.some((p) => /Wunsch von Anna/.test(p)));
  let list = (await call('coach', 'GET', '/api/feedback')).data;
  assert.equal(list.open, 1);
  assert.equal(list.items[0].displayName, 'Anna');
  assert.equal(list.items[0].body, 'Wasser-Erinnerung bitte!');
  // clients can't read or tick off the to-dos
  assert.equal((await call('ben', 'GET', '/api/feedback')).status, 403);
  assert.equal((await call('ben', 'PATCH', `/api/feedback/${list.items[0].id}`, { done: true })).status, 403);
  // done / open again
  await call('coach', 'PATCH', `/api/feedback/${list.items[0].id}`, { done: true });
  list = (await call('coach', 'GET', '/api/feedback')).data;
  assert.equal(list.open, 0);
  assert.ok(list.items[0].doneAt);
  // skip without a wish; spam limit
  await call('ben', 'POST', '/api/thanks/seen');
  assert.equal((await call('ben', 'GET', '/api/me')).data.user.showThanks, false);
  for (let i = 0; i < 4; i++) await call('anna', 'POST', '/api/feedback', { body: `Idee ${i}` });
  assert.equal((await call('anna', 'POST', '/api/feedback', { body: 'noch eine' })).status, 429);
  // in the data export
  const exp = await fetch(`${base}/api/me/export`, { headers: { Cookie: jar.anna } }).then((r) => r.json());
  assert.equal(exp.wishesAndIdeas.length, 5);
  void anna;
});
