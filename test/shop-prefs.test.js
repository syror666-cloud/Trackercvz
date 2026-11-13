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
  assert.equal(shop.flavors.length, 14);
  assert.ok(shop.flavors.every((f) => f.price >= 1 && f.price <= 5));
  assert.equal(shop.flavors.find((f) => f.key === 'mcd_cup').rarity, 'legendary');
  assert.equal(shop.flavors.find((f) => f.key === 'testo_vial').rarity, 'mythic');
  assert.ok(shop.flavors.every((f) => shop.rarities.includes(f.rarity)));
  assert.deepEqual(shop.rarities, ['common', 'rare', 'epic', 'legendary', 'mythic']);
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
  // the coach's purchase goes into the coach's own test fridge, never into the client's
  assert.equal((await coach('POST', '/api/shop/buy', { flavor: 'white' })).status, 201);
  assert.equal((await coach('GET', `/api/shop?userId=${id}`)).data.items.length, 1);
});

test('prefs: language, theme and Liquid Glass are saved per person', async (t) => {
  const { server, max } = await withClient();
  t.after(() => server.close());
  assert.deepEqual((await max('GET', '/api/me')).data.user.prefs, { lang: 'de', theme: 'system', glass: false, mailReports: true });
  assert.deepEqual((await max('PATCH', '/api/me/prefs', { lang: 'it', glass: true })).data.prefs, { lang: 'it', theme: 'system', glass: true, mailReports: true });
  await max('PATCH', '/api/me/prefs', { theme: 'dark' });
  assert.deepEqual((await max('GET', '/api/me')).data.user.prefs, { lang: 'it', theme: 'dark', glass: true, mailReports: true });
  assert.equal((await max('PATCH', '/api/me/prefs', { lang: 'fr' })).status, 400);
  assert.equal((await max('PATCH', '/api/me/prefs', { theme: 'blue' })).status, 400);
  assert.equal((await max('PATCH', '/api/me/prefs', { glass: 'yes' })).status, 400);
});

test('Apple Health import is switched off', async (t) => {
  const { server, max } = await withClient();
  t.after(() => server.close());
  assert.equal((await max('GET', '/api/health/token')).status, 404);
});

test('security: correcting an entry that earned a medal takes back what was bought with it', async (t) => {
  const { server, max, coach, id } = await withClient();
  t.after(() => server.close());
  // 100 000 steps on one day = steps bronze = 1 token
  await max('PUT', `/api/entries/${day(0)}`, { steps: 100000 });
  assert.equal((await max('GET', '/api/shop')).data.balance.available, 1);
  assert.equal((await max('POST', '/api/shop/buy', { flavor: 'white' })).status, 201);
  // the client corrects the steps: the medal and its token are gone, so is the can
  const r = await max('PUT', `/api/entries/${day(0)}`, { steps: 5000 });
  assert.deepEqual(r.data.revoked.map((x) => x.flavor), ['white']);
  const shop = (await max('GET', '/api/shop')).data;
  assert.equal(shop.items.length, 0);
  assert.deepEqual(shop.balance, { earned: 0, spent: 0, available: 0 });
  assert.equal((await coach('GET', `/api/shop?userId=${id}`)).data.items.length, 0);
});

test('security: only as much is taken back as needed, newest purchases first', async (t) => {
  const { server, max } = await withClient();
  t.after(() => server.close());
  // 10 days with 12 000 steps: streak, steps total and step goal bronze = 3 tokens
  for (let i = 0; i < 10; i++) await max('PUT', `/api/entries/${day(i)}`, { steps: 12000 });
  await max('POST', '/api/shop/buy', { flavor: 'white' });
  await max('POST', '/api/shop/buy', { flavor: 'red' });
  // deleting one day breaks the streak and drops below 10 step-goal days: only 1 token left
  const r = await max('DELETE', `/api/entries/${day(4)}`);
  assert.deepEqual(r.data.revoked.map((x) => x.flavor), ['red']);
  const shop = (await max('GET', '/api/shop')).data;
  assert.deepEqual(shop.items.map((i) => i.flavor), ['white']);
  assert.deepEqual(shop.balance, { earned: 1, spent: 1, available: 0 });
});

test('coach test fridge: free, only for the coach, can be emptied', async (t) => {
  const { server, max, coach, id } = await withClient();
  t.after(() => server.close());
  let own = (await coach('GET', '/api/shop')).data;
  assert.equal(own.free, true);
  assert.equal(own.items.length, 0);
  // everything is free, even the mythic vial, as often as wanted
  for (const flavor of ['testo_vial', 'mcd_cup']) assert.equal((await coach('POST', '/api/shop/buy', { flavor })).status, 201);
  // sold out after one purchase, for the coach too (emptying the fridge brings it back)
  assert.equal((await coach('POST', '/api/shop/buy', { flavor: 'testo_vial' })).status, 409);
  own = (await coach('GET', '/api/shop')).data;
  assert.deepEqual(own.items.map((i) => [i.flavor, i.cost]), [['testo_vial', 0], ['mcd_cup', 0]]);
  // clients get nothing for free and do not see the coach's items
  const client = (await max('GET', '/api/shop')).data;
  assert.equal(client.free, undefined);
  assert.equal(client.items.length, 0);
  assert.equal((await max('POST', '/api/shop/buy', { flavor: 'testo_vial' })).status, 409);
  assert.equal((await max('DELETE', '/api/shop/items')).status, 403);
  // the coach's view of a client is still that client's real fridge
  assert.equal((await coach('GET', `/api/shop?userId=${id}`)).data.free, undefined);
  // empty again
  assert.equal((await coach('DELETE', '/api/shop/items')).data.items.length, 0);
  assert.equal((await coach('POST', '/api/shop/buy', { flavor: 'testo_vial' })).status, 201);
});

test('shop: each item can be bought once (sold out), and is back once it was taken back', async (t) => {
  const { server, max } = await withClient();
  t.after(() => server.close());
  for (let i = 0; i < 10; i++) await max('PUT', `/api/entries/${day(i)}`, { steps: 12000 }); // 3 tokens
  assert.equal((await max('POST', '/api/shop/buy', { flavor: 'white' })).status, 201);
  const again = await max('POST', '/api/shop/buy', { flavor: 'white' });
  assert.equal(again.status, 409);
  assert.match(again.data.error, /ausverkauft/);
  assert.equal((await max('GET', '/api/shop')).data.balance.available, 2); // no token was taken for the refused try
  // a correction takes the can back – then it can be bought again
  await max('DELETE', `/api/entries/${day(4)}`);
  for (let i = 4; i < 10; i++) await max('DELETE', `/api/entries/${day(i)}`);
  assert.equal((await max('GET', '/api/shop')).data.items.length, 0);
  for (let i = 0; i < 10; i++) await max('PUT', `/api/entries/${day(i)}`, { steps: 12000 });
  assert.equal((await max('POST', '/api/shop/buy', { flavor: 'white' })).status, 201);
});
