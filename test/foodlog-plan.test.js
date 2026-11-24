'use strict';

process.env.CLIENT_BACKFILL_DAYS = '100000';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { openDb, createUser } = require('../src/db');
const { createApp } = require('../src/app');

test('dashboard calories: "eaten as planned" fills in the plan (kcal + macros); the diary always wins', async (t) => {
  const db = openDb(':memory:');
  createUser(db, { username: 'coach', displayName: 'Coach', password: 'coachpass123', role: 'coach' });
  const anna = createUser(db, { username: 'anna', displayName: 'Anna', password: 'annapass123', role: 'client' });
  db.prepare('INSERT INTO goals (user_id, calories_min, calories_max) VALUES (?, 2400, 2600)').run(anna);
  db.prepare('INSERT INTO macro_goals (user_id, protein, carbs, fat) VALUES (?, 170, 250, 70)').run(anna);
  const server = http.createServer(createApp({ db, publicDir: path.join(__dirname, '..', 'public') }));
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'anna', password: 'annapass123' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const call = async (method, url, body) => (await fetch(base + url, { method, headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();
  const date = '2026-11-20';
  const day = () => call('GET', `/api/foodlog?date=${date}`);

  // nothing entered: diary (empty)
  let d = await day();
  assert.equal(d.source, 'diary');
  assert.deepEqual(d.shown, { kcal: 0, protein: 0, carbs: 0, fat: 0 });

  // "eaten as planned" without plan meals: calorie goal (middle of the range) and macro goals
  await call('PUT', `/api/entries/${date}`, { caloriesOk: true });
  d = await day();
  assert.equal(d.source, 'plan');
  assert.deepEqual(d.shown, { kcal: 2500, protein: 170, carbs: 250, fat: 70 });
  assert.deepEqual(d.totals, { kcal: 0, protein: 0, carbs: 0, fat: 0 }, 'the diary itself stays empty');

  // with a meal plan: the plan's own calories and macros
  const meal = db.prepare("INSERT INTO meals (client_id, name) VALUES (?, 'Frühstück')").run(anna).lastInsertRowid;
  db.prepare("INSERT INTO meal_items (meal_id, name, kcal, protein, carbs, fat, amount) VALUES (?, 'Haferflocken', 370, 13, 59, 7, 100)").run(meal);
  db.prepare("INSERT INTO meal_items (meal_id, name, kcal, protein, carbs, fat, amount) VALUES (?, 'Skyr', 63, 11, 4, 0.2, 500)").run(meal);
  d = await day();
  assert.equal(d.source, 'plan');
  assert.deepEqual(d.shown, { kcal: 685, protein: 68, carbs: 79, fat: 8 });

  // "no, 3100 kcal": those calories
  await call('PUT', `/api/entries/${date}`, { caloriesOk: false, calories: 3100 });
  d = await day();
  assert.equal(d.source, 'entry');
  assert.equal(d.shown.kcal, 3100);

  // as soon as something is in the diary, the diary counts
  await call('PUT', `/api/entries/${date}`, { caloriesOk: true });
  await call('POST', '/api/foodlog', { date, meal: 'mittag', amount: 100, name: 'Reis', unit: 'g', kcal: 350, protein: 7, carbs: 77, fat: 1 });
  d = await day();
  assert.equal(d.source, 'diary');
  assert.equal(d.shown.kcal, 350);
});
