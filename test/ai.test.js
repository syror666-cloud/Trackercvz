'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { openDb, createUser } = require('../src/db');
const { createApp } = require('../src/app');
const { createNotifier } = require('../src/notify');
const { createReminders } = require('../src/admin');

/** Stand-in for the Anthropic client: records requests, answers with queued JSON. */
function fakeClient() {
  const calls = [];
  const replies = [];
  const create = async (params) => {
    calls.push(params);
    const r = replies.shift() || {};
    if (r.refusal) return { stop_reason: 'refusal', model: params.model, content: [] };
    return { stop_reason: 'end_turn', model: params.model, content: [{ type: 'text', text: JSON.stringify(r) }] };
  };
  return { calls, replies, messages: { create }, beta: { messages: { create } } };
}

async function setup(aiClient) {
  const db = openDb(':memory:');
  createUser(db, { username: 'coach', displayName: 'Coach', password: 'coachpass123', role: 'coach' });
  const pushes = [];
  const notifier = createNotifier(db, { subject: 'mailto:t@example.com', fetchImpl: async () => ({ status: 201 }) });
  const realSend = notifier.sendToUsers;
  notifier.sendToUsers = async (ids, payload) => {
    pushes.push({ ids, payload });
    return realSend(ids, payload);
  };
  const server = http.createServer(createApp({ db, notifier, reminders: createReminders(db, notifier), aiClient, publicDir: path.join(__dirname, '..', 'public') }));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    return async (method, url, body) => {
      const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, data: await res.json().catch(() => null) };
    };
  };
  const coach = client();
  await coach('POST', '/api/login', { username: 'coach', password: 'coachpass123' });
  const id = (await coach('POST', '/api/clients', { username: 'max', displayName: 'Max Mustermann', password: 'maxpass123' })).data.client.id;
  const max = client();
  await max('POST', '/api/login', { username: 'max', password: 'maxpass123' });
  return { server, coach, max, id, pushes };
}

test('AI is off without a key', async (t) => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const { server, coach, id } = await setup(null);
  t.after(() => { server.close(); if (saved) process.env.ANTHROPIC_API_KEY = saved; });
  assert.equal((await coach('GET', '/api/ai/status')).data.enabled, false);
  assert.equal((await coach('POST', `/api/ai/checkin-summary?userId=${id}`)).status, 503);
});

test('check-in summary only on request, stored, no client name sent', async (t) => {
  const ai = fakeClient();
  const { server, coach, max, id } = await setup(ai);
  t.after(() => server.close());
  await max('PUT', '/api/entries/2026-11-10', { weight: 82.1, steps: 9000 });
  assert.equal((await coach('GET', `/api/ai/checkin-summary?userId=${id}`)).data.summary, null);
  assert.equal(ai.calls.length, 0); // nothing happens by itself
  ai.replies.push({ overview: 'Gute Woche.', positives: ['Schritte stabil'], concerns: [], suggestions: ['Schrittziel halten'], lookCloser: [] });
  const r = await coach('POST', `/api/ai/checkin-summary?userId=${id}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.summary.overview, 'Gute Woche.');
  assert.equal(ai.calls.length, 1);
  const p = ai.calls[0];
  assert.equal(p.output_config.format.type, 'json_schema');
  assert.doesNotMatch(JSON.stringify(p.messages), /Mustermann|"max"/);
  assert.equal((await coach('GET', `/api/ai/checkin-summary?userId=${id}`)).data.summary.overview, 'Gute Woche.');
  assert.equal(ai.calls.length, 1);
  assert.equal((await max('POST', '/api/ai/checkin-summary')).status, 403);
  ai.replies.push({ refusal: true });
  assert.equal((await coach('POST', `/api/ai/checkin-summary?userId=${id}`)).status, 502);
});

test('nutrition draft: made on request, unknown foods dropped, coach approves and sends', async (t) => {
  const ai = fakeClient();
  const { server, coach, max, id, pushes } = await setup(ai);
  t.after(() => server.close());
  const foods = (await coach('GET', '/api/foods')).data.foods;
  const oats = foods.find((f) => f.name.startsWith('Haferflocken'));
  const skyr = foods.find((f) => f.name.startsWith('Skyr'));
  // the client's request triggers a draft in the background
  ai.replies.push({ meals: [{ name: 'Frühstück', items: [{ foodId: oats.id, amount: 80 }, { foodId: 999999, amount: 50 }, { foodId: skyr.id, amount: 250 }] }], notes: 'Proteinreich.' });
  await max('PUT', '/api/nutrition/request', { answers: { diet: 'omni', meals: '3', budget: 'low', cooking: 'quick' } });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(ai.calls.length, 1);
  assert.match(ai.calls[0].messages[0].content, /Haferflocken/);
  let d = (await coach('GET', `/api/ai/nutrition-draft?userId=${id}`)).data.draft;
  assert.equal(d.meals[0].items.length, 2); // the unknown food is gone
  assert.equal(d.meals[0].kcalTotal, d.meals[0].items.reduce((a, i) => a + i.kcalTotal, 0));
  assert.ok(pushes.some((p) => /KI-Entwurf/.test(p.payload.title)));
  // the client never sees the draft
  assert.equal((await max('GET', '/api/ai/nutrition-draft')).status, 403);
  assert.equal((await max('GET', '/api/nutrition')).data.meals.length, 0);
  // coach edits (less oats) and sends
  const edited = [{ name: 'Frühstück', items: [{ foodId: oats.id, amount: 60 }, { foodId: skyr.id, amount: 250 }] }];
  const r = await coach('POST', `/api/ai/nutrition-draft/apply?userId=${id}`, { meals: edited });
  assert.equal(r.status, 200);
  const plan = (await max('GET', '/api/nutrition')).data;
  assert.equal(plan.meals[0].items.find((i) => i.foodId === oats.id).amount, 60);
  assert.ok(pushes.some((p) => p.ids.includes(id) && /Ernährungsplan ist da/.test(p.payload.title)));
  assert.equal((await coach('GET', `/api/nutrition/request?userId=${id}`)).data.request.status, 'done');
  d = (await coach('GET', `/api/ai/nutrition-draft?userId=${id}`)).data.draft;
  assert.equal(d, null);
  assert.equal((await coach('POST', `/api/ai/nutrition-draft/apply?userId=${id}`, { meals: edited })).status, 409);
});
