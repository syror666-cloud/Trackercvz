'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { openDb, createUser } = require('../src/db');
const { createApp } = require('../src/app');
const { createNotifier } = require('../src/notify');
const { createReminders } = require('../src/admin');
const { longestStreak } = require('../src/recap');

test('recap: longest streak', () => {
  assert.equal(longestStreak(['2026-10-01', '2026-10-02', '2026-10-04', '2026-10-05', '2026-10-06']), 3);
  assert.equal(longestStreak([]), 0);
});

test('recap: a month in numbers', async (t) => {
  const db = openDb(':memory:');
  createUser(db, { username: 'coach', displayName: 'Coach', password: 'coachpass123', role: 'coach' });
  const id = createUser(db, { username: 'anna', displayName: 'Anna', password: 'annapass123', role: 'client' });
  const other = createUser(db, { username: 'ben', displayName: 'Ben', password: 'benpass1234', role: 'client' });
  const notifier = createNotifier(db, { subject: 'mailto:t@example.com', fetchImpl: async () => ({ status: 201 }), timezone: 'Europe/Berlin' });
  const server = http.createServer(createApp({ db, notifier, reminders: createReminders(db, notifier), publicDir: path.join(__dirname, '..', 'public') }));
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const jar = {};
  const call = async (who, url) => {
    const res = await fetch(base + url, { headers: jar[who] ? { Cookie: jar[who] } : {} });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  for (const [who, pw] of [['anna', 'annapass123'], ['coach', 'coachpass123'], ['ben', 'benpass1234']]) {
    const res = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: who, password: pw }) });
    jar[who] = res.headers.get('set-cookie').split(';')[0];
  }
  const w = db.prepare('INSERT INTO workouts (client_id, date, day_id, day_name, duration_min, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const s = db.prepare('INSERT INTO workout_sets (workout_id, exercise_key, exercise_name, set_no, weight, reps) VALUES (?, ?, ?, ?, ?, ?)');
  // September: bench 80 kg
  const sep = Number(w.run(id, '2026-09-20', 'd1', 'Push', 50, '2026-09-20T05:00:00Z').lastInsertRowid);
  s.run(sep, 'bankdrücken', 'Bankdrücken', 1, 80, 5);
  // October: three early workouts, bench 85 kg (a PR), lots of squats
  for (const [date, bench] of [['2026-10-02', 82.5], ['2026-10-03', 85], ['2026-10-04', 80]]) {
    const wid = Number(w.run(id, date, 'd1', 'Push', 60, `${date}T05:30:00Z`).lastInsertRowid);
    s.run(wid, 'bankdrücken', 'Bankdrücken', 1, bench, 5);
    for (let i = 1; i <= 3; i++) s.run(wid, 'kniebeuge', 'Kniebeuge', i, 100, 8);
  }
  const e = db.prepare('INSERT INTO entries (user_id, date, weight, steps, sleep, calories_ok) VALUES (?, ?, ?, ?, ?, ?)');
  for (let d = 1; d <= 20; d++) e.run(id, `2026-10-${String(d).padStart(2, '0')}`, 80 - d * 0.1, 11000 + d, 7.8, d % 2);

  const r = (await call('anna', '/api/recap?month=2026-10')).data;
  assert.equal(r.monthName, 'Oktober');
  assert.equal(r.partial, false);
  assert.equal(r.training.workouts, 3);
  assert.equal(r.training.minutes, 180);
  assert.equal(r.training.volume, Math.round((82.5 + 85 + 80) * 5 + 9 * 800));
  assert.equal(r.training.prevWorkouts, 1);
  assert.equal(r.training.favourite.name, 'Kniebeuge');
  assert.deepEqual(r.training.heaviest, { name: 'Kniebeuge', weight: 100 });
  assert.deepEqual(r.training.prs.map((p) => [p.name, p.weight, p.previous]), [['Bankdrücken', 85, 80]]);
  assert.equal(r.training.early, 3);
  assert.equal(r.steps.avg, 11011);
  assert.equal(r.steps.best.date, '2026-10-20');
  assert.equal(r.sleep.avg, 7.8);
  assert.ok(r.weight.change < 0);
  assert.equal(r.consistency.streak, 20);
  assert.equal(r.consistency.caloriesKept, 10);
  assert.equal(r.persona.title, 'Der Frühaufsteher');
  assert.deepEqual((await call('anna', '/api/recap/months')).data.months, ['2026-10', '2026-09']);
  // coach sees it, other clients don't
  assert.equal((await call('coach', `/api/recap?month=2026-10&userId=${id}`)).data.training.workouts, 3);
  assert.equal((await call('ben', `/api/recap?month=2026-10&userId=${id}`)).data.training.workouts, 0);
  assert.equal((await call('anna', '/api/recap?month=2099-01')).status, 400);
  void other;
});
