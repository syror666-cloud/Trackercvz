'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { openDb, createUser } = require('../src/db');
const { createApp } = require('../src/app');
const { createNotifier } = require('../src/notify');
const { createReminders } = require('../src/admin');
const { SPLITS } = require('../src/training-templates');

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

test('templates: every split builds the requested number of days with exercises', async (t) => {
  const { server, max } = await withClient();
  t.after(() => server.close());
  for (const s of SPLITS) {
    for (const days of s.days) {
      const r = await max('GET', `/api/training/template?split=${s.key}&days=${days}`);
      assert.equal(r.status, 200, s.key);
      assert.equal(r.data.days.length, days);
      assert.ok(r.data.days.every((d) => d.exercises.length >= 4), s.key);
      for (const e of r.data.days.flatMap((d) => d.exercises)) {
        assert.ok(e.sets >= 2 && e.sets <= 3, `${e.name}: ${e.sets} Sätze`);
        assert.ok(['6–8', '8–10'].includes(e.reps), `${e.name}: ${e.reps}`);
      }
    }
  }
  const ppl = (await max('GET', '/api/training/template?split=ppl&days=6')).data.days.map((d) => d.name);
  assert.deepEqual(ppl, ['Push A', 'Pull A', 'Legs A', 'Push B', 'Pull B', 'Legs B']);
  const custom = (await max('GET', '/api/training/template?split=custom&days=3')).data.days;
  assert.deepEqual(custom.map((d) => [d.name, d.exercises.length]), [['Tag 1', 0], ['Tag 2', 0], ['Tag 3', 0]]);
  assert.equal((await max('GET', '/api/training/template?split=nope&days=3')).status, 400);
});

test('plan is shared: client creates it, coach edits it, client gets a push', async (t) => {
  const { server, coach, max, id, pushes } = await withClient();
  t.after(() => server.close());
  assert.equal((await max('GET', '/api/training')).data.plan, null);
  const days = (await max('GET', '/api/training/template?split=upper_lower&days=4')).data.days;
  days[0].exercises.push({ name: 'Shrugs', sets: 3, reps: '12' });
  const saved = await max('PUT', '/api/training', { split: 'upper_lower', days });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.plan.splitName, 'Upper / Lower');
  assert.equal(saved.data.plan.days[0].exercises.at(-1).name, 'Shrugs');

  const seen = (await coach('GET', `/api/training?userId=${id}`)).data.plan;
  assert.equal(seen.days.length, 4);
  seen.days[1].name = 'Beine schwer';
  const before = pushes.length;
  const edited = await coach('PUT', `/api/training?userId=${id}`, { split: seen.split, days: seen.days });
  assert.equal(edited.data.plan.days[1].name, 'Beine schwer');
  assert.equal(edited.data.plan.updatedBy.role, 'coach');
  assert.deepEqual(pushes.slice(before).find((p) => p.ids.includes(id)).payload.url, '/#/training');
  assert.equal((await max('GET', '/api/training')).data.plan.days[1].name, 'Beine schwer');
  assert.equal((await max('PUT', '/api/training', { split: 'x', days })).status, 400);
  assert.equal((await max('PUT', '/api/training', { split: 'custom', days: [] })).status, 400);
});

test('workouts: last values come back, history per exercise', async (t) => {
  const { server, max, coach, id } = await withClient();
  t.after(() => server.close());
  const days = (await max('GET', '/api/training/template?split=ppl&days=3')).data.days;
  await max('PUT', '/api/training', { split: 'ppl', days });
  const push = days[0];
  const log = (date, w) => max('POST', '/api/training/workouts', {
    date, dayId: push.id, dayName: push.name,
    exercises: [{ name: 'Bankdrücken', sets: [{ weight: w, reps: 8 }, { weight: w, reps: 7 }, { weight: '', reps: '' }] }],
  });
  assert.equal((await log('2026-11-02', 60)).status, 200);
  await log('2026-11-05', 62.5);
  const r = await log('2026-11-09', 65);
  assert.deepEqual(r.data.last['bankdrücken'].sets, [{ weight: 65, reps: 8 }, { weight: 65, reps: 7 }]);
  assert.equal(r.data.last['bankdrücken'].date, '2026-11-09');
  // saving the same day again replaces the sets instead of adding more
  await max('POST', '/api/training/workouts', { date: '2026-11-09', dayId: push.id, dayName: push.name, exercises: [{ name: 'bankdrücken ', sets: [{ weight: 67.5, reps: 6 }] }] });

  const hist = (await coach('GET', `/api/training/history?userId=${id}`)).data.exercises;
  const bench = hist.find((e) => e.key === 'bankdrücken');
  assert.deepEqual(bench.sessions.map((s) => [s.date, s.topWeight]), [['2026-11-02', 60], ['2026-11-05', 62.5], ['2026-11-09', 67.5]]);
  assert.equal(bench.best, 67.5);
  assert.equal(bench.sessions.at(-1).sets.length, 1);

  assert.equal((await max('POST', '/api/training/workouts', { date: 'gestern', dayId: push.id, exercises: [] })).status, 400);
  assert.equal((await max('POST', '/api/training/workouts', { date: '2026-11-10', dayId: push.id, exercises: [{ name: 'X', sets: [{ weight: -5, reps: 3 }] }] })).status, 400);
  // a workout without any filled set is not stored
  await max('POST', '/api/training/workouts', { date: '2026-11-11', dayId: push.id, dayName: 'Push A', exercises: [{ name: 'Dips', sets: [{ weight: null, reps: null }] }] });
  assert.equal((await max('GET', '/api/training')).data.recent.some((w) => w.date === '2026-11-11'), false);
});
