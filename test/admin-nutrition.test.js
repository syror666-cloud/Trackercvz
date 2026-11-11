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
const { sameKcalAmount } = require('../src/nutrition');

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

test('food database: seeded, searchable, coach can add and edit', async (t) => {
  const { server, client, coach } = await setup();
  t.after(() => server.close());
  const all = (await coach('GET', '/api/foods')).data.foods;
  assert.ok(all.length > 80);
  const rice = (await coach('GET', '/api/foods?q=reis')).data.foods;
  assert.equal(rice[0].name.startsWith('Reis'), true);
  assert.equal(rice.find((f) => f.name === 'Reis (roh)').kcal, 350);

  const created = await coach('POST', '/api/foods', { name: 'Thabs Protein-Pancake-Mix', kcal: 365, category: 'Eigene' });
  assert.equal(created.status, 201);
  assert.equal(created.data.food.custom, true);
  assert.equal((await coach('POST', '/api/foods', { name: 'thabs protein-pancake-mix', kcal: 1 })).status, 409);
  assert.equal((await coach('POST', '/api/foods', { name: 'X', kcal: 5000 })).status, 400);
  const edited = await coach('PATCH', `/api/foods/${created.data.food.id}`, { kcal: 370 });
  assert.equal(edited.data.food.kcal, 370);

  await coach('POST', '/api/clients', { username: 'max', password: 'maxpass123' });
  const max = client();
  await max('POST', '/api/login', { username: 'max', password: 'maxpass123' });
  assert.equal((await max('GET', '/api/foods?q=kart')).status, 200);
  assert.equal((await max('POST', '/api/foods', { name: 'Pizza', kcal: 270 })).status, 403);
});

test('nutrition plan: coach builds it, client requests swaps, coach resolves', async (t) => {
  const { server, client, coach, pushes } = await setup();
  t.after(() => server.close());
  const id = (await coach('POST', '/api/clients', { username: 'max', displayName: 'Max', password: 'maxpass123' })).data.client.id;
  const foods = (await coach('GET', '/api/foods')).data.foods;
  const food = (name) => foods.find((f) => f.name === name);

  let plan = (await coach('POST', `/api/nutrition/meals?userId=${id}`, { name: 'Mittagessen' })).data;
  plan = (await coach('POST', `/api/nutrition/meals?userId=${id}`, { name: 'Frühstück' })).data;
  const lunch = plan.meals[0];
  const breakfast = plan.meals[1];
  // Frühstück nach oben verschieben
  plan = (await coach('PATCH', `/api/nutrition/meals/${breakfast.id}`, { move: -1 })).data;
  assert.deepEqual(plan.meals.map((m) => m.name), ['Frühstück', 'Mittagessen']);

  plan = (await coach('POST', `/api/nutrition/meals/${lunch.id}/items`, { foodId: food('Reis (roh)').id, amount: 100 })).data;
  plan = (await coach('POST', `/api/nutrition/meals/${lunch.id}/items`, { foodId: food('Hähnchenbrust (roh)').id, amount: 200 })).data;
  plan = (await coach('POST', `/api/nutrition/meals/${breakfast.id}/items`, { name: 'Omas Granola', kcal: 450, unit: 'g', amount: 60 })).data;
  const lunchPlan = plan.meals.find((m) => m.id === lunch.id);
  assert.equal(lunchPlan.kcalTotal, 350 + 210);
  assert.equal(plan.totalKcal, 350 + 210 + 270);

  const max = client();
  await max('POST', '/api/login', { username: 'max', password: 'maxpass123' });
  const own = (await max('GET', '/api/nutrition')).data;
  assert.equal(own.totalKcal, 830);
  // Clients can't change the plan.
  assert.equal((await max('POST', `/api/nutrition/meals/${lunch.id}/items`, { foodId: 1, amount: 10 })).status, 403);
  assert.equal((await max('PATCH', `/api/nutrition/items/${lunchPlan.items[0].id}`, { amount: 500 })).status, 403);

  // Item swap: rice → potatoes
  const riceItem = lunchPlan.items[0];
  assert.equal((await max('POST', '/api/nutrition/requests', { type: 'item', itemId: riceItem.id })).status, 400);
  const req = await max('POST', '/api/nutrition/requests', { type: 'item', itemId: riceItem.id, wantedFoodId: food('Kartoffeln').id, wish: 'Lieber Kartoffeln' });
  assert.equal(req.status, 201);
  assert.equal((await max('POST', '/api/nutrition/requests', { type: 'item', itemId: riceItem.id, wish: 'Nudeln' })).status, 409);
  const push = pushes.find((p) => p.payload.title.includes('Tauschwunsch'));
  assert.ok(push);
  assert.equal(push.payload.body, 'Reis (roh) (100 g) → Kartoffeln');

  // Coach overview shows the open request.
  assert.equal((await coach('GET', '/api/clients')).data.clients[0].openSwaps, 1);

  // Coach applies with one click: same calories → 350 kcal / 75 per 100 g ≈ 465 g
  const reqId = req.data.requests[0].id;
  plan = (await coach('POST', `/api/nutrition/requests/${reqId}/resolve`, { status: 'done', apply: true, note: 'Gute Idee!' })).data;
  const swapped = plan.meals.find((m) => m.id === lunch.id).items.find((i) => i.id === riceItem.id);
  assert.deepEqual([swapped.name, swapped.amount, swapped.kcalTotal], ['Kartoffeln', 465, 349]);
  assert.equal(plan.requests[0].status, 'done');
  assert.ok(pushes.some((p) => p.ids[0] === id && p.payload.title.includes('angepasst')));
  assert.equal((await coach('POST', `/api/nutrition/requests/${reqId}/resolve`, { status: 'done' })).status, 409);

  // Without any note: wish-only food swap, resolved without a message.
  const plain = await max('POST', '/api/nutrition/requests', { type: 'item', itemId: lunchPlan.items[1].id, wantedFoodId: food('Putenbrust (roh)').id });
  assert.equal(plain.status, 201);
  const plainId = plain.data.requests.find((r) => r.status === 'open').id;
  assert.equal((await coach('POST', `/api/nutrition/requests/${plainId}/resolve`, { status: 'done', apply: true })).status, 200);

  // Whole meal swap needs a wish; coach declines with note; client can cancel open ones.
  assert.equal((await max('POST', '/api/nutrition/requests', { type: 'meal', mealId: breakfast.id })).status, 400);
  const mreq = await max('POST', '/api/nutrition/requests', { type: 'meal', mealId: breakfast.id, wish: 'Lieber Rührei mit Brot' });
  assert.equal(mreq.status, 201);
  const mreqId = mreq.data.requests.find((r) => r.type === 'meal').id;
  plan = (await coach('POST', `/api/nutrition/requests/${mreqId}/resolve`, { status: 'declined', note: 'Diese Woche noch nicht' })).data;
  assert.equal(plan.requests.find((r) => r.id === mreqId).coachNote, 'Diese Woche noch nicht');
  const third = await max('POST', '/api/nutrition/requests', { type: 'meal', mealId: breakfast.id, wish: 'Porridge' });
  const thirdId = third.data.requests.find((r) => r.status === 'open').id;
  assert.equal((await max('DELETE', `/api/nutrition/requests/${thirdId}`)).status, 200);

  // Other clients see nothing of Max.
  await coach('POST', '/api/clients', { username: 'ben', password: 'benpass1234' });
  const ben = client();
  await ben('POST', '/api/login', { username: 'ben', password: 'benpass1234' });
  assert.equal((await ben('GET', `/api/nutrition?userId=${id}`)).data.meals.length, 0);
  assert.equal((await ben('POST', '/api/nutrition/requests', { type: 'meal', mealId: breakfast.id, wish: 'x' })).status, 404);

  assert.equal(sameKcalAmount(350, 75), 465);
});

test('admin: activity overview and automatic inactivity reminder', async (t) => {
  const { db, server, client, coach, pushes, reminders } = await setup();
  t.after(() => server.close());
  const maxId = (await coach('POST', '/api/clients', { username: 'max', displayName: 'Max', password: 'maxpass123' })).data.client.id;
  const lenaId = (await coach('POST', '/api/clients', { username: 'lena', displayName: 'Lena', password: 'lenapass123' })).data.client.id;

  const max = client();
  await max('POST', '/api/login', { username: 'max', password: 'maxpass123' });
  await max('GET', '/api/me');
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  await max('POST', '/api/push/subscribe', {
    subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } },
  });
  const lena = client();
  await lena('POST', '/api/login', { username: 'lena', password: 'lenapass123' });
  await lena('POST', '/api/login', { username: 'lena', password: 'lenapass123' });

  const today = reminders.today();
  const daysAgo = (n) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
  await max('PUT', `/api/entries/${daysAgo(3)}`, { weight: 80 });
  await lena('PUT', `/api/entries/${today}`, { weight: 60 });

  let ov = (await coach('GET', '/api/admin/overview')).data;
  const rowMax = ov.clients.find((c) => c.id === maxId);
  const rowLena = ov.clients.find((c) => c.id === lenaId);
  assert.equal(rowLena.logins30, 2);
  assert.equal(rowMax.logins30, 1);
  assert.equal(rowMax.activeDays7, 1);
  assert.equal(rowMax.missingDays, 3);
  assert.equal(rowLena.missingDays, 0);
  assert.equal(rowMax.reminderState, 'due');
  assert.equal(rowLena.reminderState, 'ok');
  assert.equal((await max('GET', '/api/admin/overview')).status, 403);

  // Configure + run now
  ov = (await coach('PUT', '/api/admin/reminder', { enabled: true, days: 2, time: '00:00', title: 'Hey {name}', body: '{tage} Tage ohne Eintrag' })).data;
  assert.equal(ov.reminder.enabled, true);
  assert.equal((await coach('PUT', '/api/admin/reminder', { time: '25:00' })).status, 400);
  const run = (await coach('POST', '/api/admin/reminder/run')).data;
  assert.equal(run.result.recipients, 1);
  const reminderPush = pushes.find((p) => p.payload.title === 'Hey Max');
  assert.equal(reminderPush.payload.body, '3 Tage ohne Eintrag');
  // Not again for the same gap …
  assert.equal((await coach('POST', '/api/admin/reminder/run')).data.result.recipients, 0);
  assert.equal((await coach('GET', '/api/admin/overview')).data.clients.find((c) => c.id === maxId).reminderState, 'sent-today');

  // … and the scheduler runs only once per day at the configured time.
  db.prepare('DELETE FROM reminder_state').run();
  const first = await reminders.runScheduled();
  assert.equal(first.recipients, 1);
  assert.equal(await reminders.runScheduled(), null);
  reminders.save({ ...reminders.config(), lastRunDate: null, time: '23:59' });
  const noonUtc = Date.parse(`${today}T10:00:00Z`);
  assert.equal(await reminders.runScheduled(noonUtc), null, 'not before the configured time');
});
