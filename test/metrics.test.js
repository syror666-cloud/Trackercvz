'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { openDb, createUser } = require('../src/db');
const { createApp } = require('../src/app');
const { createNotifier } = require('../src/notify');

async function setup() {
  const db = openDb(':memory:');
  createUser(db, { username: 'coach', displayName: 'Coach', password: 'coachpass123', role: 'coach' });
  const pushes = [];
  const notifier = createNotifier(db, { subject: 'mailto:t@example.com', fetchImpl: async () => ({ status: 201 }) });
  notifier.sendToUsers = async (ids, payload) => {
    pushes.push({ ids, payload });
    return { devices: 0, delivered: 0, failed: 0 };
  };
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
  const coach = client();
  await coach('POST', '/api/login', { username: 'coach', password: 'coachpass123' });
  return { server, client, coach, pushes };
}

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

test('categories are coach-only; measurements follow the category', async (t) => {
  const { server, client, coach } = await setup();
  t.after(() => server.close());
  const id = (await coach('POST', '/api/clients', { username: 'anna', displayName: 'Anna', password: 'annapass123' })).data.client.id;
  const anna = client();
  await anna('POST', '/api/login', { username: 'anna', password: 'annapass123' });

  // Defaults: Bauchumfang for Diät, Kraft-PRs for Aufbau
  const defs = (await coach('GET', '/api/metrics')).data;
  assert.deepEqual(defs.metrics.map((m) => [m.name, m.kind, m.categories]), [['Bauchumfang', 'number', ['diet']], ['Kraft-PRs', 'pr', ['build']]]);
  assert.equal((await anna('GET', '/api/metrics')).status, 403);

  // No category → no extra measurements
  assert.deepEqual((await anna('GET', '/api/measurements')).data.metrics, []);
  const belly = defs.metrics[0].id;
  assert.equal((await anna('PUT', `/api/measurements/${belly}/${today()}`, { value: 90 })).status, 403);

  // Coach sets Diät; client never sees the category itself
  assert.equal((await coach('PATCH', `/api/clients/${id}`, { category: 'bulk' })).status, 400);
  assert.equal((await coach('PATCH', `/api/clients/${id}`, { category: 'diet' })).status, 200);
  assert.equal((await coach('GET', '/api/clients')).data.clients[0].category, 'diet');
  const me = (await anna('GET', '/api/me')).data.user;
  assert.equal('category' in me, false);

  const mine = (await anna('GET', '/api/measurements')).data.metrics;
  assert.deepEqual(mine.map((m) => m.name), ['Bauchumfang']);
  await anna('PUT', `/api/measurements/${belly}/${daysAgo(9)}`, { value: '92,5' });
  await anna('PUT', `/api/measurements/${belly}/${daysAgo(1)}`, { value: 90 });
  let r = await anna('PUT', `/api/measurements/${belly}/${today()}`, { value: 89.4 });
  assert.deepEqual(r.data.metrics[0].values.map((v) => v.value), [92.5, 90, 89.4]);
  r = await anna('PUT', `/api/measurements/${belly}/${today()}`, { value: null });
  assert.equal(r.data.metrics[0].values.length, 2);

  // Check-in review compares the last value of each week
  const review = (await coach('GET', `/api/checkins/review?userId=${id}`)).data;
  assert.equal(review.client.category, 'diet');
  assert.deepEqual([review.measurements[0].previous.value, review.measurements[0].current.value, review.measurements[0].delta], [92.5, 90, -2.5]);

  // Admin adds a metric for Diät + Reverse Diät
  const hip = (await coach('POST', '/api/metrics', { name: 'Hüftumfang', unit: 'cm', categories: ['diet', 'reverse'] })).data.metric;
  assert.equal((await coach('POST', '/api/metrics', { name: 'X', categories: ['vegan'] })).status, 400);
  assert.deepEqual((await anna('GET', '/api/measurements')).data.metrics.map((m) => m.name), ['Bauchumfang', 'Hüftumfang']);
  // Deactivate → gone for the client
  await coach('PATCH', `/api/metrics/${hip.id}`, { active: false });
  assert.deepEqual((await anna('GET', '/api/measurements')).data.metrics.map((m) => m.name), ['Bauchumfang']);
  assert.equal((await anna('POST', '/api/metrics', { name: 'Y' })).status, 403);
});

test('gym PRs for Aufbau: records detected, coach notified', async (t) => {
  const { server, client, coach, pushes } = await setup();
  t.after(() => server.close());
  const id = (await coach('POST', '/api/clients', { username: 'ben', displayName: 'Ben', password: 'benpass1234' })).data.client.id;
  await coach('PATCH', `/api/clients/${id}`, { category: 'build' });
  const ben = client();
  await ben('POST', '/api/login', { username: 'ben', password: 'benpass1234' });
  const prMetric = (await ben('GET', '/api/measurements')).data.metrics.find((m) => m.kind === 'pr');
  assert.ok(prMetric);

  let r = await ben('POST', '/api/prs', { metricId: prMetric.id, date: daysAgo(10), exercise: 'Bankdrücken', weight: 90, reps: 5 });
  assert.equal(r.status, 201);
  assert.equal(r.data.saved.isRecord, true);
  assert.equal(pushes.length, 0, 'first entry is a baseline, no push');
  r = await ben('POST', '/api/prs', { metricId: prMetric.id, date: daysAgo(2), exercise: 'bankdrücken', weight: 92.5, reps: 3 });
  assert.equal(r.data.saved.isRecord, true);
  assert.deepEqual(r.data.saved.previous, { weight: 90, reps: 5 });
  assert.match(pushes[0].payload.title, /Neuer PR von Ben/);
  r = await ben('POST', '/api/prs', { metricId: prMetric.id, exercise: 'Bankdrücken', weight: 85, reps: 8 });
  assert.equal(r.data.saved.isRecord, false);
  assert.match(r.data.saved.date, /^\d{4}-\d{2}-\d{2}$/);

  assert.equal((await ben('POST', '/api/prs', { metricId: prMetric.id, exercise: '', weight: 1, reps: 1 })).status, 400);
  assert.equal((await ben('POST', '/api/prs', { metricId: prMetric.id, exercise: 'Kniebeuge', weight: 100, reps: 0 })).status, 400);

  const review = (await coach('GET', `/api/checkins/review?userId=${id}`)).data;
  const prReview = review.measurements.find((m) => m.kind === 'pr');
  assert.equal(prReview.prsThisWeek.length, 2);
  assert.equal(prReview.records.length, 1);

  // Delete own PR; other clients and coach cannot.
  const last = r.data.metrics.find((m) => m.kind === 'pr').prs.at(-1);
  assert.equal((await coach('DELETE', `/api/prs/${last.id}`)).status, 404);
  assert.equal((await ben('DELETE', `/api/prs/${last.id}`)).status, 200);

  // Category change to Diät removes PR tracking for the client.
  await coach('PATCH', `/api/clients/${id}`, { category: 'diet' });
  assert.equal((await ben('POST', '/api/prs', { metricId: prMetric.id, exercise: 'Bankdrücken', weight: 100, reps: 1 })).status, 403);
  await coach('PATCH', `/api/clients/${id}`, { category: null });
  assert.equal((await coach('GET', '/api/clients')).data.clients[0].category, null);
});
