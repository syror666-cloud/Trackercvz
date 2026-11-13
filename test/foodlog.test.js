'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { openDb, createUser } = require('../src/db');
const { createApp } = require('../src/app');
const { createNotifier } = require('../src/notify');
const { createReminders } = require('../src/admin');
const seed = require('../src/foods-seed');
const { productFromOff } = require('../src/foodlog');

const OFF = {
  '4000417025005': {
    product_name: 'Haferflocken kernig', brands: 'Kölln, Peter Kölln', quantity: '500 g',
    nutriments: { 'energy-kcal_100g': 372, proteins_100g: 13.5, carbohydrates_100g: 58.7, fat_100g: 7 },
  },
  '5449000000996': {
    product_name: 'Cola', brands: 'Coca-Cola', quantity: '1,5 l',
    nutriments: { energy_100g: 180, proteins_100g: 0, carbohydrates_100g: 10.6, fat_100g: 0 },
  },
};

async function setup() {
  const db = openDb(':memory:');
  createUser(db, { username: 'coach', displayName: 'Coach', password: 'coachpass123', role: 'coach' });
  const notifier = createNotifier(db, { subject: 'mailto:t@example.com', fetchImpl: async () => ({ status: 201 }) });
  const reminders = createReminders(db, notifier);
  const lookups = [];
  const barcodeLookup = async (code) => {
    lookups.push(code);
    if (code === '99999999') throw new Error('offline');
    return OFF[code] || null;
  };
  const server = http.createServer(createApp({ db, notifier, reminders, barcodeLookup, publicDir: path.join(__dirname, '..', 'public') }));
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
  const id = (await coach('POST', '/api/clients', { username: 'max', displayName: 'Max', password: 'maxpass123' })).data.client.id;
  const max = client();
  await max('POST', '/api/login', { username: 'max', password: 'maxpass123' });
  return { db, server, client, coach, max, id, lookups };
}
const today = () => new Date().toISOString().slice(0, 10);

test('food database: several hundred foods, all with macros, no duplicates', () => {
  assert.ok(seed.length >= 450, `only ${seed.length} foods`);
  const names = new Set(seed.map((f) => f[0].toLowerCase()));
  assert.equal(names.size, seed.length);
  for (const [name, kcal, unit, , p, c, f] of seed) {
    assert.ok(['g', 'ml'].includes(unit), name);
    assert.ok([p, c, f].every((v) => typeof v === 'number' && v >= 0 && v <= 100), name);
    // energy from macros should roughly match the kcal value (alcohol and fibre aside)
    if (!['Erythrit', 'Xylit'].includes(name)) assert.ok(p * 4 + c * 4 + f * 9 <= kcal * 1.35 + 15, `${name}: macros too high for ${kcal} kcal`);
  }
});

test('nutrition plan: items, meals and the day carry protein, carbs and fat', async (t) => {
  const { server, coach, max, id } = await setup();
  t.after(() => server.close());
  const oats = (await coach('GET', '/api/foods?q=Haferflocken')).data.foods.find((f) => f.name === 'Haferflocken');
  assert.ok(oats.protein > 10 && oats.carbs > 50);
  const meal = (await coach('POST', `/api/nutrition/meals?userId=${id}`, { name: 'Frühstück' })).data;
  const mealId = (meal.meal || meal.meals?.[0] || meal).id ?? meal.plan?.meals?.[0]?.id;
  const plan0 = (await coach('GET', `/api/nutrition?userId=${id}`)).data;
  const mid = mealId ?? plan0.meals[0].id;
  assert.equal((await coach('POST', `/api/nutrition/meals/${mid}/items?userId=${id}`, { foodId: oats.id, amount: 80 })).status < 300, true);
  assert.equal((await coach('POST', `/api/nutrition/meals/${mid}/items?userId=${id}`, { name: 'Eigenes Ding', kcal: 100, unit: 'g', amount: 50 })).status < 300, true);
  const plan = (await max('GET', '/api/nutrition')).data;
  const item = plan.meals[0].items.find((i) => i.foodId === oats.id);
  assert.equal(item.protein, Math.round(0.8 * oats.protein * 10) / 10);
  assert.equal(plan.meals[0].macros.protein, Math.round(item.protein));
  assert.equal(plan.macros.complete, false); // the typed-in item has no macros
  // macro targets: the coach sets them, the client reads them
  assert.equal((await max('PUT', '/api/macro-goals', { protein: 200 })).status, 403);
  await coach('PUT', `/api/macro-goals?userId=${id}`, { protein: 160, carbs: 250, fat: 70 });
  assert.deepEqual((await max('GET', '/api/macro-goals')).data.macroGoals, { protein: 160, carbs: 250, fat: 70 });
  assert.equal((await max('GET', '/api/nutrition')).data.macroGoals.protein, 160);
});

test('food diary: add from database, barcode and by hand; totals and tracker calories follow', async (t) => {
  const { server, client, coach, max, id, lookups } = await setup();
  t.after(() => server.close());
  const d = today();
  const oats = (await max('GET', '/api/foods?q=Haferflocken')).data.foods.find((f) => f.name === 'Haferflocken');
  let r = await max('POST', '/api/foodlog', { date: d, meal: 'fruehstueck', foodId: oats.id, amount: 100 });
  assert.equal(r.status, 200);
  assert.equal(r.data.day.totals.kcal, oats.kcal);
  // barcode: looked up once, then cached
  const p = (await max('GET', '/api/barcode/4000417025005')).data.product;
  assert.equal(p.found, true);
  assert.equal(p.brand, 'Kölln');
  assert.equal(p.kcal, 372);
  await max('GET', '/api/barcode/4000417025005');
  assert.equal(lookups.filter((c) => c === '4000417025005').length, 1);
  // kJ only → converted, liquid → ml
  const cola = (await max('GET', '/api/barcode/5449000000996')).data.product;
  assert.equal(cola.kcal, 43);
  assert.equal(cola.unit, 'ml');
  assert.equal((await max('GET', '/api/barcode/12345678')).data.product.found, false);
  assert.equal((await max('GET', '/api/barcode/99999999')).status, 502);
  assert.equal((await max('GET', '/api/barcode/123')).status, 404);
  r = await max('POST', '/api/foodlog', { date: d, meal: 'snack', barcode: '4000417025005', name: p.name, brand: p.brand, kcal: p.kcal, protein: p.protein, carbs: p.carbs, fat: p.fat, amount: 50 });
  assert.equal(r.status, 200);
  r = await max('POST', '/api/foodlog', { date: d, meal: 'abend', name: 'Pizza vom Italiener', kcal: 250, protein: 11, carbs: 30, fat: 9, amount: 400 });
  const total = oats.kcal + 186 + 1000;
  assert.equal(r.data.day.totals.kcal, total);
  assert.equal(r.data.day.items.length, 3);
  // the tracker shows the eaten calories
  let entries = (await max('GET', `/api/entries?from=${d}&to=${d}`)).data;
  const entryOf = (data) => (data.entries || data).find((e) => e.date === d);
  assert.equal(entryOf(entries).calories, total);
  // coach can read, not write
  assert.equal((await coach('GET', `/api/foodlog?userId=${id}&date=${d}`)).data.items.length, 3);
  assert.equal((await coach('POST', `/api/foodlog?userId=${id}`, { date: d, meal: 'snack', foodId: oats.id, amount: 10 })).status, 403);
  // change amount and meal, delete
  const pizza = r.data.item;
  r = await max('PATCH', `/api/foodlog/${pizza.id}`, { amount: 200, meal: 'mittag' });
  assert.equal(r.data.item.meal, 'mittag');
  assert.equal(r.data.day.totals.kcal, total - 500);
  assert.equal((await max('POST', '/api/foodlog', { date: d, meal: 'brunch', foodId: oats.id, amount: 10 })).status, 400);
  for (const i of r.data.day.items) await max('DELETE', `/api/foodlog/${i.id}`);
  entries = (await max('GET', `/api/entries?from=${d}&to=${d}`)).data;
  assert.equal(entryOf(entries), undefined);
  // other clients can't touch it
  await coach('POST', '/api/clients', { username: 'jana', displayName: 'Jana', password: 'janapass123' });
  const mine = (await max('POST', '/api/foodlog', { date: d, meal: 'snack', foodId: oats.id, amount: 10 })).data.item;
  const jana = client();
  await jana('POST', '/api/login', { username: 'jana', password: 'janapass123' });
  assert.equal((await jana('DELETE', `/api/foodlog/${mine.id}`)).status, 404);
  assert.equal((await jana('PATCH', `/api/foodlog/${mine.id}`, { amount: 5 })).status, 404);
});

test('Open Food Facts mapping', () => {
  const p = productFromOff({ product_name: '  Skyr  ', brands: 'Arla', quantity: '450g', nutriments: { 'energy-kcal_100g': '63', proteins_100g: 11, carbohydrates_100g: 4, fat_100g: 0.2 } });
  assert.deepEqual(p, { name: 'Skyr', brand: 'Arla', kcal: 63, protein: 11, carbs: 4, fat: 0.2, unit: 'g', serving: null });
});
