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
  createUser(db, { username: 'coach', displayName: 'Coach Lena', password: 'coachpass123', role: 'coach' });
  const notifier = createNotifier(db, { subject: 'mailto:t@example.com', fetchImpl: async () => ({ status: 201 }) });
  const pushes = [];
  notifier.sendToUsers = async (ids, payload) => { pushes.push({ ids, payload }); return {}; };
  const reminders = createReminders(db, notifier);
  const outbox = [];
  const mailer = { enabled: true, via: 'resend', from: 'S <n@mail.example-app.de>', send: async (m) => { outbox.push(m); } };
  const server = http.createServer(createApp({ db, notifier, reminders, mailer, appUrl: 'https://app.example.com', publicDir: path.join(__dirname, '..', 'public') }));
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
  return { db, server, client, coach, outbox, pushes };
}

test('invites: link by mail, client picks own login, one-time, address confirmed, coach notified', async (t) => {
  const { db, server, client, coach, outbox, pushes } = await setup();
  t.after(() => server.close());
  const r = (await coach('POST', '/api/invites', { displayName: 'Max Müller', email: 'max@example.com' })).data;
  assert.equal(r.mailed, true);
  assert.ok(r.link.startsWith('https://app.example.com/#/invite/'));
  assert.equal(outbox[0].to, 'max@example.com');
  assert.match(outbox[0].subject, /Coach Lena lädt dich zu StayOnTrack ein/);
  assert.ok(outbox[0].text.includes(r.link));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM invites WHERE token_hash = ?').get(r.token).n, 0, 'only a hash is stored');
  assert.equal((await coach('GET', '/api/invites')).data.invites.length, 1);
  // the invitation page
  const anon = client();
  const info = (await anon('GET', `/api/invite?token=${r.token}`)).data;
  assert.deepEqual(info, { displayName: 'Max Müller', email: 'max@example.com', coach: 'Coach Lena', usernameSuggestion: 'max.muller' });
  assert.equal((await anon('POST', '/api/invite/accept', { token: r.token, username: 'max', password: 'maxpass123' })).status, 400, 'consent needed');
  assert.equal((await anon('POST', '/api/invite/accept', { token: r.token, username: 'coach', password: 'maxpass123', consent: true })).status, 409);
  const acc = await anon('POST', '/api/invite/accept', { token: r.token, username: 'max', password: 'maxpass123', email: 'max@example.com', consent: true });
  assert.equal(acc.status, 200);
  assert.equal(acc.data.user.username, 'max');
  assert.equal(acc.data.user.emailVerified, true, 'the invitation reached this address');
  assert.equal((await anon('GET', '/api/me')).data.user.displayName, 'Max Müller', 'logged in straight away');
  assert.match(pushes.at(-1).payload.body, /Max Müller ist jetzt dabei/);
  // one-time
  assert.equal((await client()('POST', '/api/invite/accept', { token: r.token, username: 'max2', password: 'maxpass123', consent: true })).status, 404);
  assert.equal((await coach('GET', '/api/invites')).data.invites.length, 0);
});

test('invites: without e-mail, renew, withdraw, expiry, bad tokens', async (t) => {
  const { db, server, client, coach, outbox } = await setup();
  t.after(() => server.close());
  const r = (await coach('POST', '/api/invites', { displayName: 'Jana' })).data;
  assert.equal(r.mailed, false);
  assert.equal(outbox.length, 0);
  const renewed = (await coach('POST', `/api/invites/${r.invite.id}/renew`)).data;
  assert.notEqual(renewed.token, r.token);
  const anon = client();
  assert.equal((await anon('GET', `/api/invite?token=${r.token}`)).status, 404, 'the old link stops working');
  assert.equal((await anon('GET', `/api/invite?token=${renewed.token}`)).status, 200);
  await coach('DELETE', `/api/invites/${r.invite.id}`);
  assert.equal((await anon('GET', `/api/invite?token=${renewed.token}`)).status, 404, 'withdrawn');
  const r2 = (await coach('POST', '/api/invites', { displayName: 'Tom' })).data;
  db.prepare('UPDATE invites SET expires_at = 1').run();
  assert.equal((await anon('GET', `/api/invite?token=${r2.token}`)).status, 404, 'expired');
  assert.equal((await anon('GET', '/api/invite?token=abc')).status, 404);
  // a client typed a different address: it needs confirming
  const r3 = (await coach('POST', '/api/invites', { displayName: 'Ida' })).data;
  const acc = (await anon('POST', '/api/invite/accept', { token: r3.token, username: 'ida', password: 'idapass123', email: 'ida@example.com', consent: true })).data;
  assert.equal(acc.user.emailVerified, false);
  await new Promise((res) => setTimeout(res, 50));
  assert.match(outbox.at(-1).subject, /bestätige/i);
  // only the coach invites
  assert.equal((await anon('POST', '/api/invites', { displayName: 'X' })).status, 403);
});
