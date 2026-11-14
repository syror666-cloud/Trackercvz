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
  const notifier = createNotifier(db, { subject: 'mailto:t@example.com', fetchImpl: async () => ({ status: 201 }) });
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
  return { db, server, client, coach };
}

test('onboarding: start password must be replaced, tour flag, existing accounts unaffected', async (t) => {
  const { server, client, coach } = await setup();
  t.after(() => server.close());
  const id = (await coach('POST', '/api/clients', { username: 'max', displayName: 'Max', password: 'start12345' })).data.client.id;
  const max = client();
  let me = (await max('POST', '/api/login', { username: 'max', password: 'start12345' })).data.user;
  assert.equal(me.mustChangePassword, true);
  assert.equal(me.onboarded, false);
  assert.equal((await max('POST', '/api/me/first-password', { newPassword: 'start12345' })).status, 400, 'not the start password again');
  assert.equal((await max('POST', '/api/me/first-password', { newPassword: 'kurz' })).status, 400);
  me = (await max('POST', '/api/me/first-password', { newPassword: 'meinEigenes1' })).data.user;
  assert.equal(me.mustChangePassword, false);
  assert.equal((await max('POST', '/api/me/first-password', { newPassword: 'nochmal1234' })).status, 409);
  assert.equal((await client()('POST', '/api/login', { username: 'max', password: 'start12345' })).status, 401);
  // during the tour the e-mail can be added without typing the password again
  assert.equal((await max('PUT', '/api/me/email', { email: 'max@example.com' })).status, 200);
  me = (await max('POST', '/api/me/onboarded')).data.user;
  assert.equal(me.onboarded, true);
  assert.equal((await max('PUT', '/api/me/email', { email: 'neu@example.com' })).status, 400, 'afterwards the password is needed');
  // the coach sets a new password → it must be replaced again
  await coach('PATCH', `/api/clients/${id}`, { password: 'reset12345' });
  const again = (await client()('POST', '/api/login', { username: 'max', password: 'reset12345' })).data.user;
  assert.equal(again.mustChangePassword, true);
  assert.equal(again.onboarded, true, 'the tour is not shown twice');
  // the coach is never asked
  assert.equal((await coach('GET', '/api/me')).data.user.onboarded, true);
});

test('onboarding: accounts that existed before the update count as onboarded', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sot-onb-')), 'old.db');
  const { DatabaseSync } = require('node:sqlite');
  // an old database without the onboarding columns
  let db = openDb(file);
  createUser(db, { username: 'alt', displayName: 'Alt', password: 'altpass123', role: 'client' });
  db.exec('ALTER TABLE users DROP COLUMN onboarded_at');
  db.exec('ALTER TABLE users DROP COLUMN must_change_password');
  db.close();
  db = openDb(file);
  assert.ok(db.prepare('SELECT onboarded_at FROM users WHERE username = ?').get('alt').onboarded_at);
  createUser(db, { username: 'neu', displayName: 'Neu', password: 'neupass123', role: 'client' });
  assert.equal(db.prepare('SELECT onboarded_at FROM users WHERE username = ?').get('neu').onboarded_at, null);
  db.close();
  void DatabaseSync;
});
