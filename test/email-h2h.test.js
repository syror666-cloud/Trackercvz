'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { openDb, createUser } = require('../src/db');
const { createApp } = require('../src/app');
const { createNotifier } = require('../src/notify');
const { createReminders } = require('../src/admin');
const { createMailer } = require('../src/mail');

async function setup({ mail = true } = {}) {
  const db = openDb(':memory:');
  createUser(db, { username: 'coach', displayName: 'Coach', password: 'coachpass123', role: 'coach' });
  const notifier = createNotifier(db, { subject: 'mailto:t@example.com', fetchImpl: async () => ({ status: 201 }) });
  const pushes = [];
  notifier.sendToUsers = async (ids, payload) => {
    pushes.push({ ids, payload });
    return { sent: 0 };
  };
  const reminders = createReminders(db, notifier);
  const outbox = [];
  const mailer = mail ? { enabled: true, via: 'test', send: async (m) => { outbox.push(m); } } : createMailer({});
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
  const login = async (username, password) => {
    const c = client();
    const r = await c('POST', '/api/login', { username, password });
    assert.equal(r.status, 200, `login ${username}`);
    return c;
  };
  const tick = () => new Promise((r) => setImmediate(r));
  return { db, server, client, coach, login, outbox, pushes, tick };
}
const tokenIn = (mail, kind) => mail.text.match(new RegExp(`#/${kind}/([a-f0-9]{64})`))[1];

test('e-mail: confirm, log in with it, reset a forgotten password', async (t) => {
  const { server, client, coach, login, outbox, tick, db } = await setup();
  t.after(() => server.close());
  // the coach adds the client with an address → confirmation mail
  const id = (await coach('POST', '/api/clients', { username: 'max', displayName: 'Max', password: 'maxpass123', email: 'Max@Example.com' })).data.client.id;
  await tick();
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].to, 'Max@Example.com');
  assert.match(outbox[0].text, /https:\/\/app\.example\.com\/#\/verify\//);
  // log in with the address (any case) works right away
  const max = await login('max@example.com', 'maxpass123');
  let me = (await max('GET', '/api/me')).data.user;
  assert.equal(me.email, 'Max@Example.com');
  assert.equal(me.emailVerified, false);
  // not yet confirmed → no reset mail, but the same answer
  const anon = client();
  assert.deepEqual((await anon('POST', '/api/password/forgot', { login: 'max@example.com' })).data, { ok: true });
  await tick();
  assert.equal(outbox.length, 1);
  // confirm
  assert.equal((await anon('POST', '/api/email/verify', { token: tokenIn(outbox[0], 'verify') })).status, 200);
  assert.equal((await anon('POST', '/api/email/verify', { token: tokenIn(outbox[0], 'verify') })).status, 400, 'one-time');
  me = (await max('GET', '/api/me')).data.user;
  assert.equal(me.emailVerified, true);
  // forgot: unknown accounts get the same answer and no mail
  assert.deepEqual((await anon('POST', '/api/password/forgot', { login: 'nobody@example.com' })).data, { ok: true });
  await tick();
  assert.equal(outbox.length, 1);
  // by username works too → a 6-digit code, no link
  assert.equal((await anon('POST', '/api/password/forgot', { login: 'max' })).status, 200);
  await tick();
  assert.equal(outbox.length, 2);
  const code = outbox[1].text.match(/Dein Code: (\d{6})/)[1];
  assert.equal(outbox[1].subject, `${code} ist dein StayOnTrack-Code`);
  assert.doesNotMatch(outbox[1].text + outbox[1].html, /#\/reset\//);
  assert.match(outbox[1].html, new RegExp(code.split('').map((d) => `>${d}<`).join('[\\s\\S]*')));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM email_tokens WHERE purpose = 'reset' AND token_hash LIKE ?").get(`%${code}%`).n, 0, 'only a hash is stored');
  const wrongCode = code === '000000' ? '111111' : '000000';
  assert.equal((await anon('POST', '/api/password/reset', { login: 'max@example.com', code, password: 'kurz' })).status, 400);
  let r = await anon('POST', '/api/password/reset', { login: 'max', code: wrongCode, password: 'neuesPasswort1' });
  assert.match(r.data.error, /Noch 4 Versuche/);
  // unknown accounts: same answer
  assert.match((await anon('POST', '/api/password/reset', { login: 'niemand', code, password: 'neuesPasswort1' })).data.error, /falsch oder abgelaufen/);
  r = await anon('POST', '/api/password/reset', { login: 'Max@Example.com', code, password: 'neuesPasswort1' });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.username, 'max', 'logged in right away');
  assert.equal((await anon('GET', '/api/me')).status, 200);
  assert.equal((await anon('POST', '/api/password/reset', { login: 'max', code, password: 'nochEinPasswort' })).status, 400, 'one-time');
  // other sessions ended, new password works, old doesn't
  assert.equal((await max('GET', '/api/me')).status, 401);
  assert.equal((await client()('POST', '/api/login', { username: 'max', password: 'maxpass123' })).status, 401);
  await login('max@example.com', 'neuesPasswort1');
  // 5 wrong tries burn the code
  await anon('POST', '/api/password/forgot', { login: 'max' });
  await tick();
  const code2 = outbox[2].text.match(/Dein Code: (\d{6})/)[1];
  const bad = code2 === '000000' ? '111111' : '000000';
  for (let k = 0; k < 4; k++) await anon('POST', '/api/password/reset', { login: 'max', code: bad, password: 'abcdefgh1' });
  assert.match((await anon('POST', '/api/password/reset', { login: 'max', code: bad, password: 'abcdefgh1' })).data.error, /Zu viele Fehlversuche/);
  assert.equal((await anon('POST', '/api/password/reset', { login: 'max', code: code2, password: 'abcdefgh1' })).status, 400, 'burnt');
  // expired code
  await anon('POST', '/api/password/forgot', { login: 'max' });
  await tick();
  db.prepare('UPDATE email_tokens SET expires_at = 1').run();
  assert.match((await anon('POST', '/api/password/reset', { login: 'max', code: outbox[3].text.match(/Dein Code: (\d{6})/)[1], password: 'abcdefgh1' })).data.error, /abgelaufen/);
  void id;
});

test('e-mail: changing the own address needs the password; addresses are unique; rate limit', async (t) => {
  const { server, client, coach, login, outbox, tick } = await setup();
  t.after(() => server.close());
  await coach('POST', '/api/clients', { username: 'max', displayName: 'Max', password: 'maxpass123' });
  const janaId = (await coach('POST', '/api/clients', { username: 'jana', displayName: 'Jana', password: 'janapass123', email: 'jana@example.com' })).data.client.id;
  const max = await login('max', 'maxpass123');
  assert.equal((await max('PUT', '/api/me/email', { email: 'max@example.com', password: 'falsch' })).status, 400);
  assert.equal((await max('PUT', '/api/me/email', { email: 'kein-mail', password: 'maxpass123' })).status, 400);
  assert.equal((await max('PUT', '/api/me/email', { email: 'JANA@example.com', password: 'maxpass123' })).status, 409);
  const r = await max('PUT', '/api/me/email', { email: 'max@example.com', password: 'maxpass123' });
  assert.equal(r.data.verifySent, true);
  await tick();
  assert.equal(outbox.at(-1).to, 'max@example.com');
  // the coach sees and changes addresses
  const list = (await coach('GET', '/api/clients')).data.clients;
  assert.equal(list.find((c) => c.username === 'jana').email, 'jana@example.com');
  assert.equal((await coach('PATCH', `/api/clients/${janaId}`, { email: null })).data.client.email, null);
  // forgot is rate limited per address
  const anon = client();
  for (let i = 0; i < 5; i++) await anon('POST', '/api/password/forgot', { login: `x${i}@example.com` });
  assert.equal((await anon('POST', '/api/password/forgot', { login: 'y@example.com' })).status, 429);
});

test('e-mail: without a mail setup, reset is off', async (t) => {
  const { server, client } = await setup({ mail: false });
  t.after(() => server.close());
  assert.deepEqual((await client()('GET', '/api/auth/config')).data, { passwordReset: false });
  assert.equal((await client()('POST', '/api/password/forgot', { login: 'max' })).status, 503);
});

test('head2head: opt in, challenge, accept, compare, finish', async (t) => {
  const { server, coach, login, pushes, db } = await setup();
  t.after(() => server.close());
  const maxId = (await coach('POST', '/api/clients', { username: 'max', displayName: 'Max', password: 'maxpass123' })).data.client.id;
  const janaId = (await coach('POST', '/api/clients', { username: 'jana', displayName: 'Jana', password: 'janapass123' })).data.client.id;
  await coach('POST', '/api/clients', { username: 'tom', displayName: 'Tom', password: 'tompass123' });
  const max = await login('max', 'maxpass123');
  const jana = await login('jana', 'janapass123');
  // nobody is visible until they switch it on
  let h = (await max('GET', '/api/h2h')).data;
  assert.equal(h.visible, false);
  assert.deepEqual(h.players, []);
  assert.equal((await max('POST', '/api/h2h', { opponentId: janaId, metric: 'steps', days: 7 })).status, 409);
  await max('PUT', '/api/h2h/visible', { visible: true });
  assert.deepEqual((await max('GET', '/api/h2h')).data.players, [], 'Jana and Tom are not visible yet');
  assert.equal((await max('POST', '/api/h2h', { opponentId: janaId, metric: 'steps', days: 7 })).status, 404);
  await jana('PUT', '/api/h2h/visible', { visible: true });
  h = (await max('GET', '/api/h2h')).data;
  assert.deepEqual(h.players.map((p) => p.displayName), ['Jana']);
  assert.equal(h.players[0].email, undefined, 'no private data');
  // each other's pictures, but not of invisible clients
  db.prepare("UPDATE users SET avatar = 'data:image/png;base64,iVBORw0KGgo=' WHERE id IN (?, ?)").run(janaId, maxId);
  assert.equal((await max('GET', `/api/avatar/${janaId}`)).status, 200);
  // challenge
  assert.equal((await max('POST', '/api/h2h', { opponentId: janaId, metric: 'nope', days: 7 })).status, 400);
  assert.equal((await max('POST', '/api/h2h', { opponentId: janaId, metric: 'steps', days: 5 })).status, 400);
  const c = (await max('POST', '/api/h2h', { opponentId: janaId, metric: 'steps', days: 7, message: 'Na, traust du dich?' })).data.challenge;
  assert.equal(c.status, 'pending');
  assert.equal(pushes.at(-1).ids[0], janaId);
  assert.match(pushes.at(-1).payload.body, /Max fordert dich heraus: Schritte, 1 Woche/);
  assert.equal((await max('POST', '/api/h2h', { opponentId: janaId, metric: 'sleep', days: 7 })).status, 409, 'one open duel per pair');
  assert.equal((await max('POST', `/api/h2h/${c.id}/accept`)).status, 403, 'only the opponent answers');
  const acc = (await jana('POST', `/api/h2h/${c.id}/accept`)).data.challenge;
  assert.equal(acc.status, 'running');
  assert.equal(acc.role, 'opponent');
  // progress: only steps within the duel count
  const today = acc.startDate;
  await max('PUT', `/api/entries/${today}`, { steps: 12000, weight: 90 });
  await jana('PUT', `/api/entries/${today}`, { steps: 9000 });
  let d = (await max('GET', `/api/h2h/${c.id}`)).data.challenge;
  assert.equal(d.me.value, 12000);
  assert.equal(d.them.value, 9000);
  assert.equal(d.leader, 'me');
  assert.equal(d.series.me.length, 1);
  d = (await jana('GET', `/api/h2h/${c.id}`)).data.challenge;
  assert.equal(d.leader, 'them');
  // the coach can look (read-only)
  assert.equal((await coach('GET', `/api/h2h/${c.id}?userId=${maxId}`)).data.challenge.me.value, 12000);
  // time passes: the duel ends, both get a push
  db.prepare("UPDATE h2h_challenges SET start_date = date(start_date, '-7 days'), end_date = date(end_date, '-7 days')").run();
  db.prepare("UPDATE entries SET date = date(date, '-5 days')").run();
  h = (await max('GET', '/api/h2h')).data;
  assert.equal(h.challenges[0].status, 'finished');
  assert.equal(h.challenges[0].final, false, 'yesterday ended: the last day can still be logged');
  assert.equal(h.record.won, 1);
  assert.equal((await max('GET', '/api/achievements')).data.summary.h2hWins, 0);
  db.prepare("UPDATE h2h_challenges SET start_date = date(start_date, '-1 days'), end_date = date(end_date, '-1 days')").run();
  h = (await max('GET', '/api/h2h')).data;
  assert.equal(h.challenges[0].final, true);
  assert.equal(h.challenges[0].token, true);
  assert.equal(h.challenges[0].status, 'finished');
  assert.equal(h.challenges[0].result, 'won');
  assert.deepEqual(h.record, { won: 1, lost: 0, draw: 0 });
  assert.deepEqual((await jana('GET', '/api/h2h')).data.record, { won: 0, lost: 1, draw: 0 });
  const ends = pushes.filter((p) => /Head2Head/.test(p.payload.title) && p.payload.url.endsWith(`/${c.id}`) && !/Herausforderung/.test(p.payload.title));
  assert.deepEqual(ends.map((p) => p.ids[0]).sort(), [maxId, janaId].sort());
  assert.equal(ends.find((p) => p.ids[0] === maxId).payload.title, '🏆 Head2Head gewonnen – +1 Token!');
  // the win is worth 1 token in the shop; the final score no longer changes with corrected entries
  const shop = (await max('GET', '/api/shop')).data;
  const ach = (await max('GET', '/api/achievements')).data.summary;
  assert.equal(ach.h2hWins, 1);
  assert.equal(shop.balance.earned, ach.medalTokens + 1);
  assert.equal((await jana('GET', '/api/achievements')).data.summary.h2hWins, 0);
  db.prepare('UPDATE entries SET steps = 1 WHERE user_id = ?').run(maxId);
  assert.equal((await max('GET', `/api/h2h/${c.id}`)).data.challenge.me.value, 12000);
  // opting out cancels open challenges
  const c2 = (await jana('POST', '/api/h2h', { opponentId: maxId, metric: 'weight_loss', days: 14 })).data.challenge;
  await max('PUT', '/api/h2h/visible', { visible: false });
  assert.equal((await jana('GET', '/api/h2h')).data.challenges.find((x) => x.id === c2.id).status, 'cancelled');
  assert.equal((await jana('GET', `/api/avatar/${maxId}`)).status, 404);
});

test('head2head: weight is compared in percent of the starting weight', async (t) => {
  const { server, coach, login, db } = await setup();
  t.after(() => server.close());
  const janaId = (await coach('POST', '/api/clients', { username: 'jana', displayName: 'Jana', password: 'janapass123' })).data.client.id;
  await coach('POST', '/api/clients', { username: 'max', displayName: 'Max', password: 'maxpass123' });
  const max = await login('max', 'maxpass123');
  const jana = await login('jana', 'janapass123');
  await max('PUT', '/api/h2h/visible', { visible: true });
  await jana('PUT', '/api/h2h/visible', { visible: true });
  const c = (await max('POST', '/api/h2h', { opponentId: janaId, metric: 'weight_loss', days: 14 })).data.challenge;
  const start = (await jana('POST', `/api/h2h/${c.id}/accept`)).data.challenge.startDate;
  db.prepare("UPDATE h2h_challenges SET start_date = date(start_date, '-3 days'), end_date = date(end_date, '-3 days')").run();
  const day = (n) => db.prepare('SELECT date(?, ?) AS d').get(start, `${n} days`).d;
  await max('PUT', `/api/entries/${day(-4)}`, { weight: 100 }); // the last weight before the start counts
  await max('PUT', `/api/entries/${day(-1)}`, { weight: 98 });
  await jana('PUT', `/api/entries/${day(-2)}`, { weight: 60 });
  await jana('PUT', `/api/entries/${day(0)}`, { weight: 59.4 });
  const d = (await max('GET', `/api/h2h/${c.id}`)).data.challenge;
  assert.equal(d.me.value, 2);
  assert.equal(d.them.value, 1);
  assert.equal(JSON.stringify(d).includes('59.4'), false, 'no kilograms');
});
