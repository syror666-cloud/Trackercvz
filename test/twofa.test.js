'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { openDb, createUser } = require('../src/db');
const { createApp } = require('../src/app');
const { totp, base32Encode, checkCode } = require('../src/twofa');

test('totp: RFC 6238 test vectors (what Authy shows)', () => {
  const s = base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(totp(s, 1), '287082');
  assert.equal(totp(s, Math.floor(1111111109 / 30)), '081804');
  assert.equal(totp(s, Math.floor(2000000000 / 30)), '279037');
  const now = Date.now();
  const step = Math.floor(now / 30000);
  assert.notEqual(checkCode(s, totp(s, step - 1), -1, now), null, 'previous step still ok (clock drift)');
  assert.equal(checkCode(s, totp(s, step - 3), -1, now), null, 'old code refused');
});

test('2fa: setup, login with code, replay, recovery codes, reset, switch off', async (t) => {
  const db = openDb(':memory:');
  createUser(db, { username: 'coach', displayName: 'Coach', password: 'coachpass123', role: 'coach' });
  const outbox = [];
  const mailer = { enabled: true, via: 'test', from: 'x@example.com', send: async (m) => { outbox.push(m); return { id: 'x' }; } };
  db.prepare("UPDATE users SET email = 'coach@example.com', email_verified = 1").run();
  const server = http.createServer(createApp({ db, mailer, appUrl: 'https://app.example.com', publicDir: path.join(__dirname, '..', 'public') }));
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const jar = {};
  const call = async (who, method, url, body) => {
    const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(jar[who] ? { Cookie: jar[who] } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set && who) jar[who] = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  await call('a', 'POST', '/api/login', { username: 'coach', password: 'coachpass123' });
  await call('b', 'POST', '/api/login', { username: 'coach', password: 'coachpass123' }); // second device
  assert.equal((await call('a', 'GET', '/api/me')).data.user.twoFactor, false);

  // setup needs the password; enabling needs a real code
  assert.equal((await call('a', 'POST', '/api/me/2fa/setup', { password: 'falsch' })).status, 400);
  const s = (await call('a', 'POST', '/api/me/2fa/setup', { password: 'coachpass123' })).data;
  assert.match(s.otpauth, /^otpauth:\/\/totp\/StayOnTrack:coach\?secret=[A-Z2-7]+&issuer=StayOnTrack/);
  assert.match(s.qr, /^data:image\/gif;base64,/);
  const secret = s.secret.replace(/\s/g, '');
  const code = (offset = 0) => totp(secret, Math.floor(Date.now() / 30000) + offset);
  assert.equal((await call('a', 'POST', '/api/me/2fa/enable', { code: '000000' })).status, 400);
  const en = (await call('a', 'POST', '/api/me/2fa/enable', { code: code(-1) })).data;
  assert.equal(en.enabled, true);
  assert.equal(en.recoveryCodes.length, 10);
  // the secret is stored encrypted, recovery codes only hashed
  const row = db.prepare("SELECT totp_secret, recovery_codes FROM users WHERE username = 'coach'").get();
  assert.ok(!row.totp_secret.includes(secret));
  assert.ok(!row.recovery_codes.includes(en.recoveryCodes[0]));
  // other devices are signed out, this one stays
  assert.equal((await call('b', 'GET', '/api/me')).status, 401);
  assert.equal((await call('a', 'GET', '/api/me')).status, 200);

  // login: password alone gives no session, only a ticket
  const l1 = await call('c', 'POST', '/api/login', { username: 'coach', password: 'coachpass123' });
  assert.equal(l1.data.twoFactor, true);
  assert.equal(l1.data.user, undefined);
  assert.equal((await call('c', 'GET', '/api/me')).status, 401);
  assert.equal((await call('c', 'POST', '/api/login/2fa', { ticket: l1.data.ticket, code: '123456' })).status, 401);
  assert.equal((await call('c', 'POST', '/api/login/2fa', { ticket: 'erfunden', code: code() })).status, 401);
  const ok = await call('c', 'POST', '/api/login/2fa', { ticket: l1.data.ticket, code: code() });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.username, 'coach');
  assert.equal((await call('c', 'GET', '/api/me')).status, 200);
  // the same code can't be used twice, a used ticket is gone
  const l2 = await call('d', 'POST', '/api/login', { username: 'coach', password: 'coachpass123' });
  assert.equal((await call('d', 'POST', '/api/login/2fa', { ticket: l2.data.ticket, code: code() })).status, 401, 'replay');
  assert.equal((await call('d', 'POST', '/api/login/2fa', { ticket: l1.data.ticket, code: code(1) })).status, 401, 'old ticket');
  // 5 wrong codes kill the ticket
  for (let i = 0; i < 4; i++) await call('d', 'POST', '/api/login/2fa', { ticket: l2.data.ticket, code: '111111' });
  assert.equal((await call('d', 'POST', '/api/login/2fa', { ticket: l2.data.ticket, code: code(1) })).status, 401);

  // recovery code: works once
  await new Promise((r) => setTimeout(r, 10));
  const l3 = await call('e', 'POST', '/api/login', { username: 'coach', password: 'coachpass123' });
  assert.equal(l3.status, 200, 'account not locked yet');
  const rec = await call('e', 'POST', '/api/login/2fa', { ticket: l3.data.ticket, code: en.recoveryCodes[0].toUpperCase() });
  assert.equal(rec.status, 200);
  assert.equal(rec.data.recoveryUsed, 9);
  const l4 = await call('f', 'POST', '/api/login', { username: 'coach', password: 'coachpass123' });
  assert.equal((await call('f', 'POST', '/api/login/2fa', { ticket: l4.data.ticket, code: en.recoveryCodes[0] })).status, 401, 'one-time');

  // password reset by e-mail does not get around the code
  await call(null, 'POST', '/api/password/forgot', { login: 'coach' });
  const mailCode = outbox.at(-1).text.match(/(\d{6})/)[1];
  const reset = await call('g', 'POST', '/api/password/reset', { login: 'coach', code: mailCode, password: 'Wolkenberg7' });
  assert.equal(reset.status, 200);
  assert.equal(reset.data.user, null);
  assert.equal(reset.data.twoFactor, true);
  assert.equal((await call('g', 'GET', '/api/me')).status, 401);

  // switch off: password + code
  const h = await call('h', 'POST', '/api/login', { username: 'coach', password: 'Wolkenberg7' });
  await call('h', 'POST', '/api/login/2fa', { ticket: h.data.ticket, code: en.recoveryCodes[1] });
  assert.equal((await call('h', 'POST', '/api/me/2fa/disable', { password: 'Wolkenberg7', code: '000000' })).status, 400);
  assert.equal((await call('h', 'POST', '/api/me/2fa/disable', { password: 'Wolkenberg7', code: en.recoveryCodes[2] })).data.enabled, false);
  const plain = await call('i', 'POST', '/api/login', { username: 'coach', password: 'Wolkenberg7' });
  assert.ok(plain.data.user, 'normal login again');
});
