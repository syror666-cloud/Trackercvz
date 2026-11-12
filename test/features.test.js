'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const { openDb, createUser } = require('../src/db');
const { createApp } = require('../src/app');
const { createNotifier } = require('../src/notify');
const { generateVapidKeys, vapidAuthorization, encryptPayload, isAllowedEndpoint } = require('../src/push');
const { nextRecurringRun, zonedToUtc } = require('../src/schedule');

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

/** Browser side of RFC 8291, to check that what we encrypt can be decrypted. */
function decrypt(body, uaEcdh, authSecret) {
  const salt = body.subarray(0, 16);
  const idLen = body[20];
  const asPublic = body.subarray(21, 21 + idLen);
  const ciphertext = body.subarray(21 + idLen);
  const uaPublic = uaEcdh.getPublicKey();
  const shared = uaEcdh.computeSecret(asPublic);
  const ikm = hmac(hmac(authSecret, shared), Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  assert.equal(plain[plain.length - 1], 2, 'padding delimiter');
  return plain.subarray(0, plain.length - 1).toString('utf8');
}

function fakeBrowserSubscription(endpoint = 'https://fcm.googleapis.com/fcm/send/abc123') {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return {
    ecdh,
    auth,
    json: { endpoint, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } },
  };
}

test('push payload encryption round-trips and VAPID JWT verifies', () => {
  const sub = fakeBrowserSubscription();
  const body = encryptPayload('{"title":"Hallo 💪"}', sub.json.keys.p256dh, sub.json.keys.auth);
  assert.equal(body.readUInt32BE(16), 4096);
  assert.equal(decrypt(body, sub.ecdh, sub.auth), '{"title":"Hallo 💪"}');

  const keys = generateVapidKeys();
  const header = vapidAuthorization('https://web.push.apple.com/abc', keys, 'mailto:a@b.de');
  const [, jwt, k] = header.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, keys.publicKey);
  const [h, c, sig] = jwt.split('.');
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  assert.equal(claims.aud, 'https://web.push.apple.com');
  assert.equal(claims.sub, 'mailto:a@b.de');
  const pub = crypto.createPublicKey({ key: { ...JSON.parse(keys.privateJwk), d: undefined }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));

  assert.ok(isAllowedEndpoint('https://web.push.apple.com/QAbc'));
  assert.ok(isAllowedEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x'));
  assert.ok(!isAllowedEndpoint('http://fcm.googleapis.com/x'));
  assert.ok(!isAllowedEndpoint('https://169.254.169.254/latest'));
  assert.ok(!isAllowedEndpoint('https://evil.example/fcm.googleapis.com'));
});

test('recurring schedule respects Berlin time incl. daylight saving', () => {
  const tz = 'Europe/Berlin';
  // Summer (UTC+2): 08:00 Berlin = 06:00 UTC
  assert.equal(new Date(zonedToUtc('2026-07-01', '08:00', tz)).toISOString(), '2026-07-01T06:00:00.000Z');
  // Winter (UTC+1)
  assert.equal(new Date(zonedToUtc('2026-12-01', '08:00', tz)).toISOString(), '2026-12-01T07:00:00.000Z');

  // Daily: after 09:00 Berlin on Wed 2026-11-11 the next 08:00 is Thursday.
  const after = Date.parse('2026-11-11T08:00:00Z');
  assert.equal(new Date(nextRecurringRun({ schedule: 'daily', time: '08:00' }, after, tz)).toISOString(), '2026-11-12T07:00:00.000Z');
  // Same day if still ahead.
  assert.equal(new Date(nextRecurringRun({ schedule: 'daily', time: '20:30' }, after, tz)).toISOString(), '2026-11-11T19:30:00.000Z');
  // Weekly Mon + Fri from Wednesday → Friday.
  assert.equal(
    new Date(nextRecurringRun({ schedule: 'weekly', time: '07:15', weekdays: [1, 5] }, after, tz)).toISOString(),
    '2026-11-13T06:15:00.000Z'
  );
  // Across the DST switch (Sun 2026-03-29): Monday 08:00 is already summer time.
  assert.equal(
    new Date(nextRecurringRun({ schedule: 'weekly', time: '08:00', weekdays: [1] }, Date.parse('2026-03-28T12:00:00Z'), tz)).toISOString(),
    '2026-03-30T06:00:00.000Z'
  );
});

async function setup() {
  const db = openDb(':memory:');
  createUser(db, { username: 'coach', displayName: 'Coach', password: 'coachpass123', role: 'coach' });
  const sent = [];
  const fetchImpl = async (url, opts) => {
    sent.push({ url, opts });
    return { status: url.includes('gone') ? 410 : 201 };
  };
  const notifier = createNotifier(db, { subject: 'mailto:test@example.com', fetchImpl });
  const server = http.createServer(createApp({ db, notifier, health: true, publicDir: path.join(__dirname, '..', 'public') }));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  function client() {
    let cookie = '';
    return async (method, url, body, headers = {}) => {
      const res = await fetch(base + url, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, data: await res.json().catch(() => null) };
    };
  }
  return { db, server, client, sent, notifier };
}

test('push consent, coach notifications and chat push', async (t) => {
  const { server, client, sent, notifier, db } = await setup();
  t.after(() => server.close());
  const coach = client();
  await coach('POST', '/api/login', { username: 'coach', password: 'coachpass123' });
  const annaId = (await coach('POST', '/api/clients', { username: 'anna', displayName: 'Anna', password: 'annapass123' })).data.client.id;
  const benId = (await coach('POST', '/api/clients', { username: 'ben', displayName: 'Ben', password: 'benpass1234' })).data.client.id;
  await coach('POST', '/api/clients', { username: 'cara', displayName: 'Cara', password: 'carapass123' });

  const anna = client();
  await anna('POST', '/api/login', { username: 'anna', password: 'annapass123' });
  const cfg = await anna('GET', '/api/push/config');
  assert.equal(cfg.data.status, 'unknown');
  assert.equal(cfg.data.publicKey, notifier.publicKey);

  const sub = fakeBrowserSubscription();
  assert.equal((await anna('POST', '/api/push/subscribe', { subscription: { ...sub.json, endpoint: 'https://internal.local/x' } })).status, 400);
  assert.equal((await anna('POST', '/api/push/subscribe', { subscription: sub.json })).status, 200);
  assert.equal((await anna('GET', '/api/push/config')).data.status, 'granted');

  const ben = client();
  await ben('POST', '/api/login', { username: 'ben', password: 'benpass1234' });
  await ben('POST', '/api/push/consent', { status: 'denied' });

  const clients = (await coach('GET', '/api/clients')).data.clients;
  assert.deepEqual(
    clients.map((c) => [c.displayName, c.pushStatus, c.pushDevices]),
    [['Anna', 'granted', 1], ['Ben', 'denied', 0], ['Cara', 'unknown', 0]]
  );

  // Clients cannot manage notifications.
  assert.equal((await anna('GET', '/api/notifications')).status, 403);

  // Send-now notification to everybody reaches only Anna's device.
  const now = await coach('POST', '/api/notifications', { title: 'Wasser trinken', body: '2 Liter heute!', audience: 'all', schedule: 'once' });
  assert.equal(now.status, 201);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, sub.json.endpoint);
  assert.deepEqual(JSON.parse(decrypt(Buffer.from(sent[0].opts.body), sub.ecdh, sub.auth)), { title: 'Wasser trinken', body: '2 Liter heute!', url: '/' });
  const list = (await coach('GET', '/api/notifications')).data.notifications;
  assert.equal(list[0].active, false);
  assert.match(list[0].lastResult, /1 von 1/);

  // Recurring weekly notification for Ben only: Ben declined, so nothing is delivered.
  const weekly = await coach('POST', '/api/notifications', {
    title: 'Wiegen', body: 'Montag ist Wiegetag', audience: 'some', recipientIds: [benId], schedule: 'weekly', time: '07:00', weekdays: [1],
  });
  assert.equal(weekly.status, 201);
  assert.equal(weekly.data.notification.scheduleText, 'Mo um 07:00 Uhr');
  assert.ok(Date.parse(weekly.data.notification.nextRunAt) > Date.now());
  const sendNow = await coach('POST', `/api/notifications/${weekly.data.notification.id}/send`);
  assert.match(sendNow.data.notification.lastResult, /Keine Empfänger/);
  assert.equal(sendNow.data.notification.active, true);

  // Due notifications run via the scheduler.
  const daily = (await coach('POST', '/api/notifications', { title: 'Schritte', body: 'Noch 2000!', audience: 'some', recipientIds: [annaId], schedule: 'daily', time: '18:00' })).data.notification;
  db.prepare('UPDATE notifications SET next_run_at = ? WHERE id = ?').run(Date.now() - 1000, daily.id);
  await notifier.runDue();
  assert.equal(sent.length, 2);
  const after = (await coach('GET', '/api/notifications')).data.notifications.find((n) => n.id === daily.id);
  assert.ok(Date.parse(after.nextRunAt) > Date.now(), 'rescheduled');

  // Pause / delete
  assert.equal((await coach('PATCH', `/api/notifications/${daily.id}`, { active: false })).data.notification.active, false);
  assert.equal((await coach('DELETE', `/api/notifications/${daily.id}`)).status, 200);

  // Validation
  assert.equal((await coach('POST', '/api/notifications', { title: 'x', body: 'y', audience: 'all', schedule: 'weekly', time: '07:00', weekdays: [] })).status, 400);
  assert.equal((await coach('POST', '/api/notifications', { title: 'x', body: 'y', audience: 'all', schedule: 'daily', time: '25:00' })).status, 400);
  assert.equal((await coach('POST', '/api/notifications', { title: 'x', body: 'y', audience: 'some', recipientIds: [], schedule: 'once' })).status, 400);

  // Chat message from coach triggers a push to Anna.
  await coach('POST', `/api/messages?userId=${annaId}`, { body: 'Super Woche!' });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(sent.length, 3);
  const chatPush = JSON.parse(decrypt(Buffer.from(sent[2].opts.body), sub.ecdh, sub.auth));
  assert.equal(chatPush.body, 'Du hast eine neue Nachricht von deinem Coach');
  assert.ok(!JSON.stringify(chatPush).includes('Super Woche'), 'the message text must not be in the notification');

  // Expired subscriptions (410) are removed.
  db.prepare("UPDATE push_subscriptions SET endpoint = 'https://fcm.googleapis.com/gone' WHERE user_id = ?").run(annaId);
  await coach('POST', `/api/messages?userId=${annaId}`, { body: 'Hallo?' });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await anna('GET', '/api/push/config')).data.devices, 0);
});

test('health import with personal key', async (t) => {
  const { server, client } = await setup();
  t.after(() => server.close());
  const coach = client();
  await coach('POST', '/api/login', { username: 'coach', password: 'coachpass123' });
  await coach('POST', '/api/clients', { username: 'anna', password: 'annapass123' });
  const anna = client();
  await anna('POST', '/api/login', { username: 'anna', password: 'annapass123' });

  assert.equal((await anna('GET', '/api/health/token')).data.linked, false);
  const { token } = (await anna('POST', '/api/health/token')).data;
  assert.match(token, /^tt_/);

  const shortcut = client(); // no session cookie, like the Shortcuts app
  const imp = (body, key = token) => shortcut('POST', '/api/health/import', body, { Authorization: `Bearer ${key}` });
  assert.equal((await imp({ steps: 100 }, 'tt_wrong')).status, 401);
  assert.equal((await imp({})).status, 400);

  await anna('PUT', '/api/entries/2026-01-05', { weight: 70, note: 'Notiz bleibt' });
  let r = await imp({ date: '2026-01-05', steps: '8.523' });
  assert.equal(r.status, 200);
  assert.equal(r.data.saved.steps, 8523);
  r = await imp({ date: '2026-01-05', steps: 9001.6 });
  const e = (await anna('GET', '/api/entries')).data.entries.find((x) => x.date === '2026-01-05');
  assert.deepEqual([e.weight, e.steps, e.note], [70, 9002, 'Notiz bleibt']);

  // Without date → today
  r = await imp({ steps: 1234, weight: '71,2' });
  assert.equal(r.status, 200);
  assert.match(r.data.date, /^\d{4}-\d{2}-\d{2}$/);

  const status = (await anna('GET', '/api/health/token')).data;
  assert.ok(status.linked && status.lastUsedAt);
  const overview = (await coach('GET', '/api/clients')).data.clients[0];
  assert.equal(overview.healthLinked, true);

  // New key invalidates the old one; deleting unlinks.
  const { token: token2 } = (await anna('POST', '/api/health/token')).data;
  assert.equal((await imp({ steps: 1 })).status, 401);
  assert.equal((await imp({ steps: 1 }, token2)).status, 200);
  await anna('DELETE', '/api/health/token');
  assert.equal((await imp({ steps: 1 }, token2)).status, 401);
  assert.equal((await coach('POST', '/api/health/token')).status, 403);
});
