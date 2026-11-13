'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { openDb, createUser } = require('../src/db');
const { createApp } = require('../src/app');
const { createNotifier } = require('../src/notify');
const { createReminders } = require('../src/admin');
const { SCOPES } = require('../src/google-health');

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const civil = (d) => { const [year, month, day] = d.split('-').map(Number); return { date: { year, month, day } }; };

function fakeGoogle({ scopes = `${SCOPES.steps} ${SCOPES.sleep}` } = {}) {
  const calls = [];
  const state = { revoked: false };
  const json = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } });
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const u = new URL(url);
    if (u.href === 'https://oauth2.googleapis.com/token') {
      const p = new URLSearchParams(init.body);
      if (p.get('grant_type') === 'authorization_code') {
        if (p.get('code') !== 'good-code' || !p.get('code_verifier')) return json(400, { error: 'invalid_grant' });
        return json(200, { access_token: 'acc-1', refresh_token: 'refresh-secret', expires_in: 30, scope: scopes });
      }
      if (state.revoked) return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
      return json(200, { access_token: 'acc-2', expires_in: 30 });
    }
    if (u.href.startsWith('https://oauth2.googleapis.com/revoke')) return json(200, {});
    if (init.headers && init.headers.Authorization !== 'Bearer acc-1' && init.headers.Authorization !== 'Bearer acc-2') return json(401, {});
    if (u.pathname.endsWith('/steps/dataPoints:dailyRollUp')) {
      if (!scopes.includes(SCOPES.steps)) return json(403, { error: { message: 'denied' } });
      return json(200, { rollupDataPoints: [
        { civilStartTime: civil(daysAgo(1)), civilEndTime: civil(today()), steps: { countSum: '11234' } },
        { civilStartTime: civil(today()), civilEndTime: civil(daysAgo(-1)), steps: { countSum: '4321' } },
        { civilStartTime: civil(daysAgo(2)), civilEndTime: civil(daysAgo(1)), steps: { countSum: '0' } },
      ] });
    }
    if (u.pathname.endsWith('/sleep/dataPoints')) {
      assert.match(u.searchParams.get('filter'), /^sleep\.interval\.civil_end_time >= "\d{4}-\d{2}-\d{2}" AND sleep\.interval\.civil_end_time < "\d{4}-\d{2}-\d{2}"$/);
      return json(200, { dataPoints: [
        { sleep: { interval: { civilEndTime: civil(today()) }, metadata: { nap: false, mainSleep: true }, summary: { minutesAsleep: '432' } } },
        { sleep: { interval: { civilEndTime: civil(today()) }, metadata: { nap: true }, summary: { minutesAsleep: '25' } } },
        { sleep: { interval: { civilEndTime: civil(daysAgo(1)) }, metadata: { nap: false }, summary: { minutesAsleep: '390' } } },
      ] });
    }
    return json(404, { error: { message: `unexpected ${u.href}` } });
  };
  return { fetchImpl, calls, state };
}

async function setup(opts) {
  const db = openDb(':memory:');
  createUser(db, { username: 'coach', displayName: 'Coach', password: 'coachpass123', role: 'coach' });
  const notifier = createNotifier(db, { subject: 'mailto:t@example.com', fetchImpl: async () => ({ status: 201 }) });
  const reminders = createReminders(db, notifier);
  const g = fakeGoogle(opts);
  const server = http.createServer(createApp({
    db, notifier, reminders, appUrl: 'https://app.example.com', publicDir: path.join(__dirname, '..', 'public'),
    googleEnv: { GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'csecret' }, googleFetch: g.fetchImpl,
  }));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    return async (method, url, body) => {
      const res = await fetch(base + url, {
        method, redirect: 'manual',
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, location: res.headers.get('location'), data: await res.json().catch(() => null) };
    };
  };
  const coach = client();
  await coach('POST', '/api/login', { username: 'coach', password: 'coachpass123' });
  const id = (await coach('POST', '/api/clients', { username: 'max', displayName: 'Max', password: 'maxpass123' })).data.client.id;
  const max = client();
  await max('POST', '/api/login', { username: 'max', password: 'maxpass123' });
  return { db, server, coach, max, client, id, g, base };
}
const wait = () => new Promise((r) => setTimeout(r, 150));

async function connect(max, code = 'good-code') {
  const { url } = (await max('POST', '/api/google/connect')).data;
  const u = new URL(url);
  return { u, cb: await max('GET', `/api/google/callback?code=${code}&state=${encodeURIComponent(u.searchParams.get('state'))}`) };
}

test('google health: connect with PKCE, steps and sleep land in the tracker, token stored encrypted', async (t) => {
  const { db, server, coach, max, id, g } = await setup();
  t.after(() => server.close());
  assert.deepEqual((await max('GET', '/api/google')).data, {
    configured: true, connected: false, revoked: false, steps: false, sleep: false, connectedAt: null, lastSyncAt: null, lastError: null,
  });
  const { u, cb } = await connect(max);
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://app.example.com/api/google/callback');
  assert.equal(u.searchParams.get('scope'), `${SCOPES.steps} ${SCOPES.sleep}`);
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('access_type'), 'offline');
  assert.equal(cb.status, 302);
  assert.equal(cb.location, '/#/settings/google-ok');
  await wait();
  const link = db.prepare('SELECT * FROM google_links WHERE user_id = ?').get(id);
  assert.ok(link.refresh_token.startsWith('v1:'));
  assert.ok(!link.refresh_token.includes('refresh-secret'), 'refresh token encrypted');
  // first sync: steps per day, sleep summed per wake-up day without naps, zero days skipped
  const e = (d) => db.prepare('SELECT steps, sleep FROM entries WHERE user_id = ? AND date = ?').get(id, d);
  assert.deepEqual({ ...e(today()) }, { steps: 4321, sleep: 7.2 });
  assert.deepEqual({ ...e(daysAgo(1)) }, { steps: 11234, sleep: 6.5 });
  assert.equal(e(daysAgo(2)), undefined);
  const st = (await max('GET', '/api/google')).data;
  assert.equal(st.connected, true);
  assert.ok(st.lastSyncAt);
  // manual values on other fields stay; the coach sees the link
  await max('PUT', `/api/entries/${today()}`, { weight: 80 });
  const r = await max('POST', '/api/google/sync');
  assert.equal(r.status, 200);
  assert.deepEqual({ ...db.prepare('SELECT weight, steps FROM entries WHERE user_id = ? AND date = ?').get(id, today()) }, { weight: 80, steps: 4321 });
  assert.equal((await coach('GET', '/api/clients')).data.clients[0].googleLinked, true);
  assert.equal((await coach('GET', `/api/google?userId=${id}`)).data.connected, true);
  // a state can't be reused
  const again = await max('GET', `/api/google/callback?code=good-code&state=${encodeURIComponent(u.searchParams.get('state'))}`);
  assert.equal(again.location, '/#/settings/google-error/state');
  // disconnect revokes at Google
  await max('DELETE', '/api/google');
  assert.ok(g.calls.some((c) => c.url.startsWith('https://oauth2.googleapis.com/revoke')));
  assert.equal((await max('GET', '/api/google')).data.connected, false);
});

test('google health: denied consent, bad state, only one scope, revoked access', async (t) => {
  const { server, max, client, g } = await setup({ scopes: SCOPES.steps });
  t.after(() => server.close());
  const { url } = (await max('POST', '/api/google/connect')).data;
  const state = new URL(url).searchParams.get('state');
  assert.equal((await max('GET', `/api/google/callback?error=access_denied&state=${state}`)).location, '/#/settings/google-error/denied');
  assert.equal((await max('GET', '/api/google/callback?code=good-code&state=forged')).location, '/#/settings/google-error/state');
  // only steps granted: works, sleep marked missing
  const { cb } = await connect(max);
  assert.equal(cb.location, '/#/settings/google-partial');
  await wait();
  let st = (await max('GET', '/api/google')).data;
  assert.equal(st.steps, true);
  assert.equal(st.sleep, false);
  const r = (await max('POST', '/api/google/sync')).data;
  assert.deepEqual(r.missing, ['sleep']);
  // access revoked in the Google account → a clear message, status shows it, sync stops
  g.state.revoked = true;
  const res = await max('POST', '/api/google/sync');
  assert.equal(res.status, 502);
  assert.match(res.data.error, /Google-Konto entfernt/);
  st = (await max('GET', '/api/google')).data;
  assert.equal(st.revoked, true);
  assert.equal(st.connected, false);
  // coaches can't connect
  const coach = client();
  await coach('POST', '/api/login', { username: 'coach', password: 'coachpass123' });
  assert.equal((await coach('POST', '/api/google/connect')).status, 403);
});
