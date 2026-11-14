'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { openDb, createUser } = require('../src/db');
const { createApp } = require('../src/app');
const { createNotifier } = require('../src/notify');
const { createReminders } = require('../src/admin');

test('privacy: own data export without secrets, deletion request reaches the coach', async (t) => {
  const db = openDb(':memory:');
  createUser(db, { username: 'coach', displayName: 'Coach', password: 'coachpass123', role: 'coach' });
  const notifier = createNotifier(db, { subject: 'mailto:t@example.com', fetchImpl: async () => ({ status: 201 }) });
  const pushes = [];
  notifier.sendToUsers = async (ids, payload) => { pushes.push(payload); return {}; };
  const server = http.createServer(createApp({ db, notifier, reminders: createReminders(db, notifier), publicDir: path.join(__dirname, '..', 'public') }));
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    return async (method, url, body, raw) => {
      const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      if (raw) return { status: res.status, headers: res.headers, text: await res.text() };
      return { status: res.status, data: await res.json().catch(() => null) };
    };
  };
  const coach = client();
  await coach('POST', '/api/login', { username: 'coach', password: 'coachpass123' });
  const id = (await coach('POST', '/api/clients', { username: 'max', displayName: 'Max', password: 'maxpass123' })).data.client.id;
  const max = client();
  await max('POST', '/api/login', { username: 'max', password: 'maxpass123' });
  const d = new Date().toISOString().slice(0, 10);
  await max('PUT', `/api/entries/${d}`, { weight: 80, steps: 9000, note: 'gut' });
  await max('POST', '/api/messages', { body: 'Hallo Coach' });
  // export
  const r = await max('GET', '/api/me/export', null, true);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /stayontrack-daten-max-\d{4}-\d{2}-\d{2}\.json/);
  const data = JSON.parse(r.text);
  assert.equal(data.profile.username, 'max');
  assert.equal(data.entries[0].weight, 80);
  assert.equal(data.messages[0].from, 'Max');
  assert.ok(!r.text.includes('scrypt$'), 'no password hash');
  assert.ok(!/password_hash|token_hash|refresh_token/.test(r.text));
  assert.equal((await coach('GET', '/api/me/export')).status, 403);
  // deletion request
  const req = (await max('POST', '/api/me/deletion-request', { reason: 'Coaching beendet' })).data;
  assert.ok(req.user.deletionRequestedAt);
  assert.match(pushes.at(-1).body, /Max möchte, dass das Konto gelöscht wird/);
  const c = (await coach('GET', '/api/clients')).data.clients.find((x) => x.id === id);
  assert.equal(c.deletionReason, 'Coaching beendet');
  const att = (await coach('GET', '/api/attention')).data.clients.find((x) => x.id === id);
  assert.equal(att.reasons[0].key, 'deletion');
  assert.equal(att.level, 'high');
  // withdraw
  assert.equal((await max('DELETE', '/api/me/deletion-request')).data.user.deletionRequestedAt, null);
});
