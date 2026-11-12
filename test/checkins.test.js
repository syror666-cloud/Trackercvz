'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { openDb, createUser } = require('../src/db');
const { createApp } = require('../src/app');
const { createNotifier } = require('../src/notify');
const { weekComparison } = require('../src/weekstats');
const { localDate } = require('../src/schedule');

test('week comparison: last 7 days vs. the 7 before', () => {
  const entries = [
    { date: '2026-11-01', weight: 85, steps: 6000, sleep: 6.5, note: null },
    { date: '2026-11-03', weight: 84.6, steps: 8000, sleep: 7, note: null },
    { date: '2026-11-06', weight: 84.2, steps: 11000, sleep: 7.5, note: 'gut' },
    { date: '2026-11-10', weight: 83.8, steps: 9000, sleep: 8, note: null },
  ];
  const r = weekComparison(entries, '2026-11-11', { steps_goal: 10000, sleep_goal: 7.5 });
  assert.deepEqual([r.current.from, r.current.to, r.previous.from, r.previous.to], ['2026-11-05', '2026-11-11', '2026-10-29', '2026-11-04']);
  assert.equal(r.current.daysLogged, 2);
  assert.equal(r.current.weightAvg, 84);
  assert.equal(r.previous.weightAvg, 84.8);
  assert.equal(r.delta.weightAvg, -0.8);
  assert.equal(r.current.stepsAvg, 10000);
  assert.equal(r.current.stepsGoalDays, 1);
  assert.equal(r.current.sleepGoalDays, 2);
  assert.equal(r.days.length, 14);
  assert.equal(r.days[13].date, '2026-11-11');
});

async function setup() {
  const db = openDb(':memory:');
  createUser(db, { username: 'coach', displayName: 'Coach', password: 'coachpass123', role: 'coach' });
  const notifier = createNotifier(db, { subject: 'mailto:t@example.com', fetchImpl: async () => ({ status: 201 }) });
  const server = http.createServer(createApp({ db, notifier, publicDir: path.join(__dirname, '..', 'public') }));
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
  return { server, client };
}

test('check-in: coach proposes, client replies and accepts, plan updates', async (t) => {
  const { server, client } = await setup();
  t.after(() => server.close());
  const coach = client();
  await coach('POST', '/api/login', { username: 'coach', password: 'coachpass123' });
  const id = (await coach('POST', '/api/clients', { username: 'max', displayName: 'Max', password: 'maxpass123' })).data.client.id;
  await coach('POST', '/api/clients', { username: 'ben', displayName: 'Ben', password: 'benpass1234' });
  await coach('PUT', `/api/goals?userId=${id}`, { caloriesMin: 2400, caloriesMax: 2500, stepsGoal: 8000, sleepGoal: 7, targetWeight: 80 });

  const max = client();
  await max('POST', '/api/login', { username: 'max', password: 'maxpass123' });
  // "today" in the app's time zone (the UTC date is a day behind late in the evening)
  await max('PUT', `/api/entries/${localDate(Date.now(), 'Europe/Berlin')}`, { weight: 84, steps: 9000, training: true, caloriesOk: false, calories: 2900 });

  // Queue
  let queue = (await coach('GET', '/api/checkins/queue')).data.clients;
  assert.deepEqual(queue.map((c) => [c.displayName, c.doneThisWeek]), [['Ben', false], ['Max', false]]);
  assert.equal((await max('GET', '/api/checkins/queue')).status, 403);

  // Review data
  const review = (await coach('GET', `/api/checkins/review?userId=${id}`)).data;
  assert.deepEqual([review.goals.caloriesMin, review.goals.caloriesMax], [2400, 2500]);
  assert.equal(review.comparison.current.daysLogged, 1);
  assert.equal(review.comparison.current.trainingDays, 1);
  assert.equal(review.comparison.current.caloriesOkDays, 0);
  assert.equal(review.comparison.current.caloriesAnswered, 1);
  assert.equal(review.comparison.current.caloriesReportedAvg, 2900);
  assert.equal(review.comparison.days[13].training, true);

  // Create check-in: unchanged values are dropped from the proposal.
  assert.equal((await coach('POST', `/api/checkins?userId=${id}`, { message: '  ' })).status, 400);
  assert.equal((await coach('POST', `/api/checkins?userId=${id}`, { message: 'x', proposal: { caloriesMin: 300 } })).status, 400);
  assert.equal((await coach('POST', `/api/checkins?userId=${id}`, { message: 'x', proposal: { caloriesMin: 2300, caloriesMax: 2200 } })).status, 400);
  const created = await coach('POST', `/api/checkins?userId=${id}`, {
    message: 'Starke Woche! Wir gehen etwas runter mit den Kalorien.',
    proposal: { caloriesMin: 2200, caloriesMax: 2300, stepsGoal: 10000, sleepGoal: 7 },
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.data.checkin.proposal, { stepsGoal: 10000, caloriesMin: 2200, caloriesMax: 2300 });
  assert.deepEqual(created.data.checkin.changes, ['Kalorien pro Tag: 2.400–2.500 kcal → 2.200–2.300 kcal', 'Schritte pro Tag: 8.000 Schritte → 10.000 Schritte']);

  queue = (await coach('GET', '/api/checkins/queue')).data.clients;
  assert.equal(queue.find((c) => c.id === id).doneThisWeek, true);

  // Client sees it on the tracker page – but NOT in the chat.
  const list = (await max('GET', '/api/checkins')).data.checkins;
  assert.equal(list.length, 1);
  assert.equal(list[0].status, 'open');
  assert.deepEqual(list[0].changeItems[0], { key: 'calories', label: 'Kalorien pro Tag', before: '2.400–2.500 kcal', after: '2.200–2.300 kcal' });
  assert.equal((await max('GET', '/api/messages')).data.messages.length, 0);

  // Reply + accept
  const ciId = list[0].id;
  assert.equal((await max('POST', `/api/checkins/${ciId}/reply`, { body: 'Danke! Passt.' })).status, 200);
  const acc = await max('POST', `/api/checkins/${ciId}/accept`);
  assert.equal(acc.status, 200);
  assert.equal(acc.data.checkin.status, 'accepted');
  assert.equal((await max('POST', `/api/checkins/${ciId}/accept`)).status, 409);

  const goals = (await max('GET', '/api/goals')).data;
  assert.deepEqual(goals.goals, { targetWeight: 80, stepsGoal: 10000, sleepGoal: 7, caloriesMin: 2200, caloriesMax: 2300 });
  assert.deepEqual(goals.history.map((h) => [h.caloriesMin, h.caloriesMax, h.source]), [[2400, 2500, 'coach'], [2200, 2300, 'checkin']]);

  // Only the client's reply ended up in the chat; accepting ran in the background.
  const chat = (await max('GET', '/api/messages')).data.messages;
  assert.equal(chat.length, 1);
  assert.match(chat[0].body, /^↩️ Antwort auf den Check-in vom \d\d\.\d\d\.:\nDanke! Passt\.$/);

  // Coach sees reply in review and acceptance in chat.
  const review2 = (await coach('GET', `/api/checkins/review?userId=${id}`)).data;
  assert.equal(review2.checkins[0].status, 'accepted');
  assert.ok(review2.clientMessages.some((m) => /Danke! Passt/.test(m.body)));

  // Other clients cannot accept someone else's check-in; coach cannot accept.
  const ben = client();
  await ben('POST', '/api/login', { username: 'ben', password: 'benpass1234' });
  const ci2 = (await coach('POST', `/api/checkins?userId=${id}`, { message: 'Weiter so', proposal: { caloriesMin: 2100 } })).data.checkin.id;
  assert.equal((await ben('POST', `/api/checkins/${ci2}/accept`)).status, 404);
  assert.equal((await coach('POST', `/api/checkins/${ci2}/accept`)).status, 404);

  // Check-in without proposal cannot be "accepted".
  const ci3 = (await coach('POST', `/api/checkins?userId=${id}`, { message: 'Nur Feedback' })).data.checkin.id;
  assert.equal((await max('POST', `/api/checkins/${ci3}/accept`)).status, 400);
});

test('daily entry: calorie plan, eaten calories and training day', async (t) => {
  const { server, client } = await setup();
  t.after(() => server.close());
  const coach = client();
  await coach('POST', '/api/login', { username: 'coach', password: 'coachpass123' });
  await coach('POST', '/api/clients', { username: 'max', password: 'maxpass123' });
  const max = client();
  await max('POST', '/api/login', { username: 'max', password: 'maxpass123' });

  let r = await max('PUT', '/api/entries/2026-01-05', { caloriesOk: false, calories: 2850, training: true });
  assert.deepEqual([r.data.entry.caloriesOk, r.data.entry.calories, r.data.entry.training], [false, 2850, true]);
  // "Eingehalten" clears a previously entered calorie number.
  r = await max('PUT', '/api/entries/2026-01-05', { caloriesOk: true });
  assert.deepEqual([r.data.entry.caloriesOk, r.data.entry.calories, r.data.entry.training], [true, null, true]);
  // Answering only "kein Training" is a valid entry on its own.
  r = await max('PUT', '/api/entries/2026-01-06', { training: false });
  assert.equal(r.data.entry.training, false);
  assert.equal((await max('PUT', '/api/entries/2026-01-07', { training: 'ja' })).status, 400);
  assert.equal((await max('PUT', '/api/entries/2026-01-07', { calories: -5 })).status, 400);

  // Coach: single value becomes a range; von > bis is rejected.
  const id = (await coach('GET', '/api/clients')).data.clients[0].id;
  assert.deepEqual((await coach('PUT', `/api/goals?userId=${id}`, { caloriesMin: 2000 })).data.goals.caloriesMax, 2000);
  assert.equal((await coach('PUT', `/api/goals?userId=${id}`, { caloriesMin: 2500, caloriesMax: 2000 })).status, 400);
});

test('migration: old single calorie goal and check-in chat messages', () => {
  const { DatabaseSync } = require('node:sqlite');
  const os = require('node:os');
  const fs = require('node:fs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-'));
  const file = path.join(dir, 'old.db');
  const old = new DatabaseSync(file);
  old.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, display_name TEXT, password_hash TEXT, role TEXT, created_at TEXT);
    INSERT INTO users (id, username, display_name, password_hash, role) VALUES (1, 'c', 'C', 'x', 'coach'), (2, 'm', 'M', 'x', 'client');
    CREATE TABLE goals (user_id INTEGER PRIMARY KEY, target_weight REAL, steps_goal INTEGER, sleep_goal REAL, calories_goal INTEGER);
    INSERT INTO goals VALUES (2, 80, 10000, 7.5, 2300);
    CREATE TABLE entries (user_id INTEGER, date TEXT, weight REAL, steps INTEGER, sleep REAL, note TEXT, updated_at TEXT, PRIMARY KEY (user_id, date));
    INSERT INTO entries VALUES (2, '2026-01-01', 80, 1000, 7, NULL, '2026-01-01');
    CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER, sender_id INTEGER, body TEXT NOT NULL, created_at TEXT, read_at TEXT);
    INSERT INTO messages (client_id, sender_id, body) VALUES (2, 1, '📋 Wöchentlicher Check-in

Top!'), (2, 2, '✅ Anpassungen angenommen:
• x'), (2, 2, 'Hallo Coach');
  `);
  old.close();
  const db = openDb(file);
  const g = db.prepare('SELECT calories_min, calories_max FROM goals WHERE user_id = 2').get();
  assert.deepEqual([g.calories_min, g.calories_max], [2300, 2300]);
  assert.deepEqual(db.prepare('SELECT body FROM messages').all().map((m) => m.body), ['Hallo Coach']);
  assert.equal(db.prepare('SELECT training FROM entries').get().training, null);
  db.close();
  // Running again changes nothing.
  const again = openDb(file);
  assert.equal(again.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 1);
  again.close();
});
