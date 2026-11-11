'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { openDb, createUser } = require('../src/db');
const { createApp } = require('../src/app');

// 1×1 transparent PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function setup() {
  const db = openDb(':memory:');
  createUser(db, { username: 'coach', displayName: 'Coach', password: 'coachpass123', role: 'coach' });
  const server = http.createServer(createApp({ db, publicDir: path.join(__dirname, '..', 'public') }));
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
      const type = res.headers.get('content-type') || '';
      return { status: res.status, type, data: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
    };
  };
  const coach = client();
  await coach('POST', '/api/login', { username: 'coach', password: 'coachpass123' });
  return { server, client, coach };
}

test('account: change name, username and profile picture', async (t) => {
  const { server, client, coach } = await setup();
  t.after(() => server.close());
  const annaId = (await coach('POST', '/api/clients', { username: 'anna', displayName: 'Anna', password: 'annapass123' })).data.client.id;
  await coach('POST', '/api/clients', { username: 'ben', password: 'benpass1234' });
  const anna = client();
  await anna('POST', '/api/login', { username: 'anna', password: 'annapass123' });

  assert.equal((await anna('GET', '/api/me')).data.user.avatar, null);
  assert.equal((await anna('PATCH', '/api/me', { username: 'BEN' })).status, 409);
  assert.equal((await anna('PATCH', '/api/me', { username: 'a' })).status, 400);
  const r = await anna('PATCH', '/api/me', { username: 'anna.k', displayName: 'Anna K.' });
  assert.deepEqual([r.data.user.username, r.data.user.displayName], ['anna.k', 'Anna K.']);
  // New username works for the next login
  const again = client();
  assert.equal((await again('POST', '/api/login', { username: 'anna.k', password: 'annapass123' })).status, 200);

  // Avatar
  assert.equal((await anna('PUT', '/api/me/avatar', { image: 'data:text/html;base64,PGgxPg==' })).status, 400);
  const up = await anna('PUT', '/api/me/avatar', { image: PNG });
  assert.match(up.data.user.avatar, new RegExp(`^/api/avatar/${annaId}\\?v=`));
  const img = await anna('GET', `/api/avatar/${annaId}`);
  assert.equal(img.status, 200);
  assert.equal(img.type, 'image/png');
  assert.equal(img.data.subarray(1, 4).toString(), 'PNG');
  // Coach can see it (and it appears in the client list), other clients cannot.
  assert.equal((await coach('GET', `/api/avatar/${annaId}`)).status, 200);
  assert.ok((await coach('GET', '/api/clients')).data.clients.find((c) => c.id === annaId).avatar);
  const ben = client();
  await ben('POST', '/api/login', { username: 'ben', password: 'benpass1234' });
  assert.equal((await ben('GET', `/api/avatar/${annaId}`)).status, 404);
  // Remove
  assert.equal((await anna('DELETE', '/api/me/avatar')).data.user.avatar, null);
  assert.equal((await anna('GET', `/api/avatar/${annaId}`)).status, 404);
});

test('check-in queue reports the weekend period', async (t) => {
  const { server, coach } = await setup();
  t.after(() => server.close());
  await coach('POST', '/api/clients', { username: 'anna', password: 'annapass123' });
  const q = (await coach('GET', '/api/checkins/queue')).data;
  assert.equal(typeof q.isWeekend, 'boolean');
  const start = new Date(q.periodStart);
  // Period starts on a Saturday (Berlin time) at most 6 days ago.
  const berlinDay = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', weekday: 'short' }).format(start);
  assert.equal(berlinDay, 'Sat');
  assert.ok(Date.now() - start.getTime() < 7 * 86400000);
});
