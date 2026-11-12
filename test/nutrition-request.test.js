'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { openDb, createUser } = require('../src/db');
const { createApp } = require('../src/app');
const { createNotifier } = require('../src/notify');
const { createReminders } = require('../src/admin');

async function setup() {
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
  const coach = client();
  await coach('POST', '/api/login', { username: 'coach', password: 'coachpass123' });
  return { db, server, client, coach, pushes, reminders };
}


async function withClient() {
  const ctx = await setup();
  const id = (await ctx.coach('POST', '/api/clients', { username: 'max', displayName: 'Max', password: 'maxpass123' })).data.client.id;
  const max = ctx.client();
  await max('POST', '/api/login', { username: 'max', password: 'maxpass123' });
  return { ...ctx, id, max };
}
const day = (n) => new Date(Date.UTC(2026, 9, 1) + n * 86400000).toISOString().slice(0, 10);

test('nutrition plan request: client asks with preferences, coach gets push and sees it', async (t) => {
  const { server, max, coach, id, pushes } = await withClient();
  t.after(() => server.close());
  const empty = (await max('GET', '/api/nutrition/request')).data;
  assert.equal(empty.request, null);
  assert.ok(empty.questions.find((q) => q.key === 'protein').options.some(([k]) => k === 'chicken'));
  // required answers missing
  const bad = await max('PUT', '/api/nutrition/request', { answers: { diet: 'omni' } });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /Mahlzeiten/);
  assert.equal((await max('PUT', '/api/nutrition/request', { answers: { diet: 'keto', meals: '3', budget: 'low', cooking: 'quick' } })).status, 400);
  const before = pushes.length;
  const r = await max('PUT', '/api/nutrition/request', {
    answers: { diet: 'omni', avoid: ['lactose', 'lactose', 'nuts'], protein: ['chicken', 'fish'], meals: '4', budget: 'low', cooking: 'quick', prep: 'yes' },
    avoidOther: 'Pilze', note: 'Mittags Kantine',
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.request.answers.avoid, ['lactose', 'nuts']);
  assert.equal(r.data.request.status, 'open');
  assert.match(pushes.slice(before)[0].payload.title, /Ernährungsplan/);
  // the coach sees it on the client list and in the client's nutrition tab
  assert.equal((await coach('GET', '/api/clients')).data.clients.find((c) => c.id === id).planRequest, true);
  assert.equal((await coach('GET', `/api/nutrition/request?userId=${id}`)).data.request.answers.note, 'Mittags Kantine');
  assert.equal((await coach('PUT', `/api/nutrition/request?userId=${id}`, { answers: {} })).status, 403);
  // the first meal answers the request; then the client cannot ask again
  await coach('POST', `/api/nutrition/meals?userId=${id}`, { name: 'Frühstück' });
  assert.equal((await coach('GET', `/api/nutrition/request?userId=${id}`)).data.request.status, 'done');
  assert.equal((await coach('GET', '/api/clients')).data.clients.find((c) => c.id === id).planRequest, false);
  assert.equal((await max('PUT', '/api/nutrition/request', { answers: { diet: 'omni', meals: '3', budget: 'low', cooking: 'quick' } })).status, 409);
});

test('nutrition plan request: coach can mark it done', async (t) => {
  const { server, max, coach, id } = await withClient();
  t.after(() => server.close());
  await max('PUT', '/api/nutrition/request', { answers: { diet: 'vegan', meals: '3', budget: 'none', cooking: 'loves' } });
  assert.equal((await coach('POST', `/api/nutrition/request/done?userId=${id}`)).data.request.status, 'done');
  assert.equal((await max('POST', '/api/nutrition/request/done')).status, 403);
});
