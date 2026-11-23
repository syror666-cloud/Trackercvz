'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { openDb, createUser } = require('../src/db');
const { createApp } = require('../src/app');
const { createNotifier } = require('../src/notify');

test('design: new look by default, classic stays selectable, clients vote, coach sees the result', async (t) => {
  const db = openDb(':memory:');
  createUser(db, { username: 'coach', displayName: 'Coach', password: 'coachpass123', role: 'coach' });
  createUser(db, { username: 'anna', displayName: 'Anna', password: 'annapass123', role: 'client' });
  createUser(db, { username: 'ben', displayName: 'Ben', password: 'benpass1234', role: 'client' });
  db.prepare("UPDATE users SET onboarded_at = '2026-01-01T00:00:00Z'").run();
  const notifier = createNotifier(db, { subject: 'mailto:t@example.com', fetchImpl: async () => ({ status: 201 }) });
  const pushed = [];
  notifier.onSend((ids, p) => pushed.push(p));
  const server = http.createServer(createApp({ db, notifier, publicDir: path.join(__dirname, '..', 'public') }));
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const jar = {};
  const call = async (who, method, url, body) => {
    const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(jar[who] ? { Cookie: jar[who] } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) jar[who] = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  for (const [w, p] of [['coach', 'coachpass123'], ['anna', 'annapass123'], ['ben', 'benpass1234']]) await call(w, 'POST', '/api/login', { username: w, password: p });

  // everyone gets the announcement once; new look and haptics are on by default
  let me = (await call('anna', 'GET', '/api/me')).data.user;
  assert.equal(me.showDesignIntro, true);
  assert.equal(me.prefs.design, 'club');
  assert.equal(me.prefs.haptics, true);
  assert.ok(me.memberSince);
  assert.equal((await call('coach', 'GET', '/api/me')).data.user.showDesignIntro, true);
  await call('anna', 'POST', '/api/me/design-intro/seen');
  assert.equal((await call('anna', 'GET', '/api/me')).data.user.showDesignIntro, false);

  // switching back to the classic look and turning haptics off are personal settings
  assert.equal((await call('anna', 'PATCH', '/api/me/prefs', { design: 'neon' })).status, 400);
  assert.equal((await call('anna', 'PATCH', '/api/me/prefs', { haptics: 'yes' })).status, 400);
  const pr = (await call('anna', 'PATCH', '/api/me/prefs', { design: 'classic', haptics: false })).data.prefs;
  assert.equal(pr.design, 'classic');
  assert.equal(pr.haptics, false);
  assert.equal((await call('ben', 'GET', '/api/me')).data.user.prefs.design, 'club');

  // voting
  assert.equal((await call('anna', 'GET', '/api/design-vote')).data.vote, null);
  assert.equal((await call('anna', 'PUT', '/api/design-vote', { choice: 'other' })).status, 400);
  assert.equal((await call('coach', 'PUT', '/api/design-vote', { choice: 'club' })).status, 403);
  let v = (await call('anna', 'PUT', '/api/design-vote', { choice: 'classic' })).data.vote;
  assert.equal(v.choice, 'classic');
  assert.equal(pushed.length, 0, 'a vote without comment does not ping the coach');
  v = (await call('anna', 'PUT', '/api/design-vote', { choice: 'club', comment: 'Das Beige ist top' })).data.vote;
  assert.equal(v.choice, 'club');
  assert.equal(v.comment, 'Das Beige ist top');
  assert.equal(pushed.length, 1);
  assert.match(pushed[0].title, /Anna: Neues Design/);
  await call('anna', 'PUT', '/api/design-vote', { choice: 'club', comment: 'Das Beige ist top' });
  assert.equal(pushed.length, 1, 'the same comment again is not a new ping');
  await call('ben', 'PUT', '/api/design-vote', { choice: 'classic', comment: '<b>lieber blau</b>' });

  // result for the coach only
  assert.equal((await call('anna', 'GET', '/api/design-votes')).status, 403);
  const r = (await call('coach', 'GET', '/api/design-votes')).data;
  assert.equal(r.club, 1);
  assert.equal(r.classic, 1);
  assert.equal(r.members, 2);
  assert.deepEqual(r.items.map((i) => i.displayName).sort(), ['Anna', 'Ben']);
  assert.equal(r.items.find((i) => i.displayName === 'Ben').comment, '<b>lieber blau</b>', 'stored as text, escaped when shown');

  // the vote is part of the personal data export and goes with the account
  const exp = (await call('anna', 'GET', '/api/me/export')).data;
  assert.equal(exp.designVote[0].choice, 'club');
  assert.equal(exp.designVote[0].comment, 'Das Beige ist top');
  const annaId = db.prepare("SELECT id FROM users WHERE username = 'anna'").get().id;
  db.prepare('DELETE FROM users WHERE id = ?').run(annaId);
  assert.equal((await call('coach', 'GET', '/api/design-votes')).data.club, 0);
});

test('design vote round 2: votes cleared, announcement again, everyone back on the new look – once', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sot-dv-')), 'db.sqlite');
  let db = openDb(file);
  const id = createUser(db, { username: 'anna', displayName: 'Anna', password: 'annapass123', role: 'client' });
  // state as after round 1
  db.prepare("DELETE FROM settings WHERE key = 'design_vote_round2'").run();
  db.prepare("UPDATE users SET design_intro_at = '2026-11-20T10:00:00Z', prefs = ? WHERE id = ?").run(JSON.stringify({ lang: 'de', design: 'classic', glass: true }), id);
  db.prepare("INSERT INTO design_votes (user_id, choice) VALUES (?, 'classic')").run(id);
  db.close();
  db = openDb(file);
  const u = db.prepare('SELECT design_intro_at, prefs FROM users WHERE id = ?').get(id);
  assert.equal(u.design_intro_at, null);
  assert.deepEqual(JSON.parse(u.prefs), { lang: 'de', design: 'club', glass: true });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM design_votes').get().n, 0);
  // a vote in round 2 survives the next restart
  db.prepare("INSERT INTO design_votes (user_id, choice) VALUES (?, 'club')").run(id);
  db.close();
  db = openDb(file);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM design_votes').get().n, 1);
  db.close();
});

test('coach note: the latest coach message of the last week, without marking it read', async (t) => {
  const db = openDb(':memory:');
  const coach = createUser(db, { username: 'coach', displayName: 'Thabs', password: 'coachpass123', role: 'coach' });
  const anna = createUser(db, { username: 'anna', displayName: 'Anna', password: 'annapass123', role: 'client' });
  const notifier = createNotifier(db, { subject: 'mailto:t@example.com', fetchImpl: async () => ({ status: 201 }) });
  const server = http.createServer(createApp({ db, notifier, publicDir: path.join(__dirname, '..', 'public') }));
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = async (u, p) => (await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).headers.get('set-cookie').split(';')[0];
  const ca = await login('anna', 'annapass123');
  const cc = await login('coach', 'coachpass123');
  const note = async (cookie) => fetch(`${base}/api/coach-note`, { headers: { Cookie: cookie } });
  assert.equal((await (await note(ca)).json()).note, null);
  assert.equal((await note(cc)).status, 403);
  const ins = db.prepare('INSERT INTO messages (client_id, sender_id, body, created_at) VALUES (?, ?, ?, ?)');
  ins.run(anna, coach, 'Alte Nachricht', '2020-01-01T08:00:00Z');
  assert.equal((await (await note(ca)).json()).note, null, 'older than a week');
  ins.run(anna, coach, 'Starke Woche. Heute Beine!', new Date().toISOString().slice(0, 19) + 'Z');
  ins.run(anna, anna, 'Danke!', new Date().toISOString().slice(0, 19) + 'Z');
  const n = (await (await note(ca)).json()).note;
  assert.equal(n.body, 'Starke Woche. Heute Beine!');
  assert.equal(n.coachName, 'Thabs');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM messages WHERE read_at IS NOT NULL').get().n, 0);
});
