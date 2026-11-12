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

test('hall of fame: streak and step tiers with dates and progress', async (t) => {
  const { server, max, coach, id } = await withClient();
  t.after(() => server.close());
  const empty = (await max('GET', '/api/achievements')).data;
  assert.equal(empty.summary.earned, 0);
  assert.equal(empty.summary.total, empty.achievements.length * 3);
  // 15 days in a row with 12 000 steps, a gap, then 3 more days
  for (let i = 0; i < 15; i++) await max('PUT', `/api/entries/${day(i)}`, { steps: 12000, weight: 80 });
  for (let i = 17; i < 20; i++) await max('PUT', `/api/entries/${day(i)}`, { steps: 12000 });
  const a = (await coach('GET', `/api/achievements?userId=${id}`)).data;
  const streak = a.achievements.find((x) => x.key === 'streak');
  assert.equal(streak.current, 15);
  assert.deepEqual(streak.tiers.map((x) => x.achievedAt), [day(6), day(13), null]);
  assert.equal(streak.tiers[2].progress, 50);
  assert.match(streak.tiers[0].text, /7 Tage in Folge/);
  const steps = a.achievements.find((x) => x.key === 'steps_total');
  assert.equal(steps.current, 18 * 12000);
  assert.deepEqual(steps.tiers.map((x) => x.achievedAt), [day(8), null, null]); // 9 × 12 000 ≥ 100 000
  assert.equal(steps.tiers[1].progress, 86);
  assert.equal(a.achievements.find((x) => x.key === 'step_goal').current, 18);
  assert.equal(a.summary.bronze, 2 + 1); // streak, steps, step goal (10 days)
});

test('hall of fame: trainings, lifted volume and new personal bests', async (t) => {
  const { server, max } = await withClient();
  t.after(() => server.close());
  for (let i = 0; i < 6; i++) {
    await max('POST', '/api/training/workouts', { date: day(i * 2), dayId: 'd1', dayName: 'Push', exercises: [{ name: 'Bankdrücken', sets: [{ weight: 60 + i * 2.5, reps: 10 }, { weight: 60 + i * 2.5, reps: 10 }] }] });
  }
  await max('PUT', `/api/entries/${day(3)}`, { training: true });
  const a = (await max('GET', '/api/achievements')).data.achievements;
  assert.equal(a.find((x) => x.key === 'trainings').current, 7);
  assert.equal(a.find((x) => x.key === 'prs').current, 5);
  assert.equal(a.find((x) => x.key === 'prs').tiers[0].achievedAt, day(10));
  const vol = a.find((x) => x.key === 'volume');
  assert.equal(vol.current, [0, 1, 2, 3, 4, 5].reduce((s, i) => s + (60 + i * 2.5) * 20, 0));
  assert.equal(vol.tiers[0].achievedAt, null);
});
