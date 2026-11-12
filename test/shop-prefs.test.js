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

test('shop: medals are worth tokens (bronze 1, silver 2, gold 3), cans go into the fridge', async (t) => {
  const { server, max, coach, id } = await withClient();
  t.after(() => server.close());
  let shop = (await max('GET', '/api/shop')).data;
  assert.equal(shop.flavors.length, 12);
  assert.ok(shop.flavors.every((f) => f.price >= 1 && f.price <= 3));
  assert.ok(shop.flavors.every((f) => shop.rarities.includes(f.rarity)));
  assert.deepEqual(shop.rarities, ['common', 'rare', 'epic', 'legendary']);
  assert.deepEqual(shop.balance, { earned: 0, spent: 0, available: 0 });
  assert.equal((await max('POST', '/api/shop/buy', { flavor: 'white' })).status, 409);
  // 10 days in a row with 12 000 steps: streak, step total and step goal bronze = 3 medals
  for (let i = 0; i < 10; i++) await max('PUT', `/api/entries/${day(i)}`, { steps: 12000 });
  shop = (await max('GET', '/api/shop')).data;
  assert.equal(shop.balance.available, 3);
  const r = await max('POST', '/api/shop/buy', { flavor: 'gold' });
  assert.equal(r.status, 201);
  assert.deepEqual(r.data.balance, { earned: 3, spent: 3, available: 0 });
  assert.equal(r.data.items[0].flavor, 'gold');
  const broke = await max('POST', '/api/shop/buy', { flavor: 'white' });
  assert.equal(broke.status, 409);
  assert.match(broke.data.error, /1 Token/);
  assert.equal((await max('POST', '/api/shop/buy', { flavor: 'cola' })).status, 400);
  // 15 days in a row: streak silver (+2 on top of bronze) = 3 + 2 more tokens
  for (let i = 10; i < 15; i++) await max('PUT', `/api/entries/${day(i)}`, { steps: 12000 });
  assert.equal((await max('GET', '/api/shop')).data.balance.earned, 5);
  // the coach sees the fridge but cannot shop
  assert.equal((await coach('GET', `/api/shop?userId=${id}`)).data.items.length, 1);
  assert.equal((await coach('POST', '/api/shop/buy', { flavor: 'white' })).status, 403);
});

test('prefs: language, theme and Liquid Glass are saved per person', async (t) => {
  const { server, max } = await withClient();
  t.after(() => server.close());
  assert.deepEqual((await max('GET', '/api/me')).data.user.prefs, { lang: 'de', theme: 'system', glass: false });
  assert.deepEqual((await max('PATCH', '/api/me/prefs', { lang: 'it', glass: true })).data.prefs, { lang: 'it', theme: 'system', glass: true });
  await max('PATCH', '/api/me/prefs', { theme: 'dark' });
  assert.deepEqual((await max('GET', '/api/me')).data.user.prefs, { lang: 'it', theme: 'dark', glass: true });
  assert.equal((await max('PATCH', '/api/me/prefs', { lang: 'fr' })).status, 400);
  assert.equal((await max('PATCH', '/api/me/prefs', { theme: 'blue' })).status, 400);
  assert.equal((await max('PATCH', '/api/me/prefs', { glass: 'yes' })).status, 400);
});

test('Apple Health import is switched off', async (t) => {
  const { server, max } = await withClient();
  t.after(() => server.close());
  assert.equal((await max('GET', '/api/health/token')).status, 404);
});
