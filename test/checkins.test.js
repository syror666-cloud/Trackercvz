'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { openDb, createUser } = require('../src/db');
const { createApp } = require('../src/app');
const { createNotifier } = require('../src/notify');
const { weekComparison } = require('../src/weekstats');

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
  await coach('PUT', `/api/goals?userId=${id}`, { caloriesGoal: 2400, stepsGoal: 8000, sleepGoal: 7, targetWeight: 80 });

  const max = client();
  await max('POST', '/api/login', { username: 'max', password: 'maxpass123' });
  await max('PUT', `/api/entries/${new Date().toISOString().slice(0, 10)}`, { weight: 84, steps: 9000 });

  // Queue
  let queue = (await coach('GET', '/api/checkins/queue')).data.clients;
  assert.deepEqual(queue.map((c) => [c.displayName, c.doneThisWeek]), [['Ben', false], ['Max', false]]);
  assert.equal((await max('GET', '/api/checkins/queue')).status, 403);

  // Review data
  const review = (await coach('GET', `/api/checkins/review?userId=${id}`)).data;
  assert.equal(review.goals.caloriesGoal, 2400);
  assert.equal(review.comparison.current.daysLogged, 1);

  // Create check-in: unchanged values are dropped from the proposal.
  assert.equal((await coach('POST', `/api/checkins?userId=${id}`, { message: '  ' })).status, 400);
  assert.equal((await coach('POST', `/api/checkins?userId=${id}`, { message: 'x', proposal: { caloriesGoal: 300 } })).status, 400);
  const created = await coach('POST', `/api/checkins?userId=${id}`, {
    message: 'Starke Woche! Wir gehen etwas runter mit den Kalorien.',
    proposal: { caloriesGoal: 2200, stepsGoal: 10000, sleepGoal: 7 },
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.data.checkin.proposal, { caloriesGoal: 2200, stepsGoal: 10000 });
  assert.deepEqual(created.data.checkin.changes, ['Kalorien pro Tag: 2.400 kcal → 2.200 kcal', 'Schritte pro Tag: 8.000 Schritte → 10.000 Schritte']);

  queue = (await coach('GET', '/api/checkins/queue')).data.clients;
  assert.equal(queue.find((c) => c.id === id).doneThisWeek, true);

  // Client sees it, also as chat message.
  const list = (await max('GET', '/api/checkins')).data.checkins;
  assert.equal(list.length, 1);
  assert.equal(list[0].status, 'open');
  const chat = (await max('GET', '/api/messages')).data.messages;
  assert.match(chat[0].body, /Check-in[\s\S]*Kalorien pro Tag: 2\.400 kcal → 2\.200 kcal/);

  // Reply + accept
  const ciId = list[0].id;
  assert.equal((await max('POST', `/api/checkins/${ciId}/reply`, { body: 'Danke! Passt.' })).status, 200);
  const acc = await max('POST', `/api/checkins/${ciId}/accept`);
  assert.equal(acc.status, 200);
  assert.equal(acc.data.checkin.status, 'accepted');
  assert.equal((await max('POST', `/api/checkins/${ciId}/accept`)).status, 409);

  const goals = (await max('GET', '/api/goals')).data;
  assert.deepEqual(goals.goals, { targetWeight: 80, stepsGoal: 10000, sleepGoal: 7, caloriesGoal: 2200 });
  assert.deepEqual(goals.history.map((h) => [h.caloriesGoal, h.source]), [[2400, 'coach'], [2200, 'checkin']]);

  // Coach sees reply in review and acceptance in chat.
  const review2 = (await coach('GET', `/api/checkins/review?userId=${id}`)).data;
  assert.equal(review2.checkins[0].status, 'accepted');
  assert.ok(review2.clientMessages.some((m) => /Danke! Passt/.test(m.body)));

  // Other clients cannot accept someone else's check-in; coach cannot accept.
  const ben = client();
  await ben('POST', '/api/login', { username: 'ben', password: 'benpass1234' });
  const ci2 = (await coach('POST', `/api/checkins?userId=${id}`, { message: 'Weiter so', proposal: { caloriesGoal: 2100 } })).data.checkin.id;
  assert.equal((await ben('POST', `/api/checkins/${ci2}/accept`)).status, 404);
  assert.equal((await coach('POST', `/api/checkins/${ci2}/accept`)).status, 404);

  // Check-in without proposal cannot be "accepted".
  const ci3 = (await coach('POST', `/api/checkins?userId=${id}`, { message: 'Nur Feedback' })).data.checkin.id;
  assert.equal((await max('POST', `/api/checkins/${ci3}/accept`)).status, 400);
});
