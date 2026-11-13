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
  notifier.sendToUsers = async () => ({ sent: 0 });
  const reminders = createReminders(db, notifier);
  const outbox = [];
  const mailer = { enabled: true, via: 'resend', from: 'StayOnTrack <noreply@mail.example-app.de>', send: async (m) => { outbox.push(m); } };
  const server = http.createServer(createApp({ db, notifier, reminders, mailer, appUrl: 'https://app.example.com', publicDir: path.join(__dirname, '..', 'public') }));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    return async (method, url, body, raw) => {
      const res = await fetch(base + url, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      if (raw) return { status: res.status, headers: res.headers, buf: Buffer.from(await res.arrayBuffer()) };
      return { status: res.status, data: await res.json().catch(() => null) };
    };
  };
  const coach = client();
  await coach('POST', '/api/login', { username: 'coach', password: 'coachpass123' });
  const id = (await coach('POST', '/api/clients', { username: 'max', displayName: 'Max Müller', password: 'maxpass123' })).data.client.id;
  const max = client();
  await max('POST', '/api/login', { username: 'max', password: 'maxpass123' });
  const tick = () => new Promise((r) => setTimeout(r, 300));
  return { db, server, coach, max, client, id, outbox, tick };
}
const isPdf = (buf) => buf.subarray(0, 5).toString() === '%PDF-';

test('reports: plan and check-in as PDF downloads; only own check-ins', async (t) => {
  const { server, coach, max, client, id } = await setup();
  t.after(() => server.close());
  const oats = (await coach('GET', '/api/foods?q=Haferflocken')).data.foods.find((f) => f.name === 'Haferflocken');
  const plan = (await coach('POST', `/api/nutrition/meals?userId=${id}`, { name: 'Frühstück' })).data;
  await coach('POST', `/api/nutrition/meals/${plan.meals[0].id}/items?userId=${id}`, { foodId: oats.id, amount: 80 });
  let r = await max('GET', '/api/nutrition/pdf', null, true);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  assert.match(r.headers.get('content-disposition'), /Ernaehrungsplan-Max-Muller\.pdf/);
  assert.ok(isPdf(r.buf));
  assert.ok(isPdf((await coach('GET', `/api/nutrition/pdf?userId=${id}`, null, true)).buf));
  // check-in
  const today = new Date().toISOString().slice(0, 10);
  await max('PUT', `/api/entries/${today}`, { weight: 84.2, steps: 11000, sleep: 7.2 });
  const ci = (await coach('POST', `/api/checkins?userId=${id}`, { message: 'Starke Woche!', proposal: { stepsGoal: 11000 } })).data;
  assert.equal(ci.mail, 'no-email');
  r = await max('GET', `/api/checkins/${ci.checkin.id}/pdf`, null, true);
  assert.equal(r.status, 200);
  assert.ok(isPdf(r.buf));
  // another client can't
  await coach('POST', '/api/clients', { username: 'jana', displayName: 'Jana', password: 'janapass123' });
  const jana = client();
  await jana('POST', '/api/login', { username: 'jana', password: 'janapass123' });
  assert.equal((await jana('GET', `/api/checkins/${ci.checkin.id}/pdf`, null, true)).status, 404);
});

test('reports: check-in and plan go out by e-mail with the PDF – only to confirmed addresses, can be switched off', async (t) => {
  const { db, server, coach, max, id, outbox, tick } = await setup();
  t.after(() => server.close());
  const oats = (await coach('GET', '/api/foods?q=Haferflocken')).data.foods.find((f) => f.name === 'Haferflocken');
  const plan = (await coach('POST', `/api/nutrition/meals?userId=${id}`, { name: 'Frühstück' })).data;
  await coach('POST', `/api/nutrition/meals/${plan.meals[0].id}/items?userId=${id}`, { foodId: oats.id, amount: 80 });
  // unconfirmed address: nothing goes out
  await coach('PATCH', `/api/clients/${id}`, { email: 'max@example.com' });
  outbox.length = 0;
  assert.equal((await coach('GET', `/api/reports/status?userId=${id}`)).data.status, 'unverified');
  assert.equal((await coach('POST', `/api/nutrition/pdf/mail?userId=${id}`)).status, 409);
  db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(id);
  // the coach sends the plan
  const sent = await coach('POST', `/api/nutrition/pdf/mail?userId=${id}`);
  assert.equal(sent.status, 200);
  assert.equal(outbox[0].to, 'max@example.com');
  assert.equal(outbox[0].attachments[0].filename, 'Ernaehrungsplan-Max-Muller.pdf');
  assert.ok(isPdf(outbox[0].attachments[0].content));
  // a check-in mails automatically, with key figures and the PDF
  const today = new Date().toISOString().slice(0, 10);
  await max('PUT', `/api/entries/${today}`, { weight: 84.2, steps: 11000, sleep: 7.2 });
  const ci = (await coach('POST', `/api/checkins?userId=${id}`, { message: 'Starke Woche!' })).data;
  assert.equal(ci.mail, 'ok');
  await tick();
  const m = outbox.at(-1);
  assert.equal(m.subject, 'Dein Wochen-Check-in ist da');
  assert.match(m.text, /Schritte Ø: 11\.000/);
  assert.match(m.attachments[0].filename, /^Check-in-Max-Muller-\d{4}-\d{2}-\d{2}\.pdf$/);
  assert.ok(isPdf(m.attachments[0].content));
  // switched off by the client
  await max('PATCH', '/api/me/prefs', { mailReports: false });
  const n = outbox.length;
  assert.equal((await coach('POST', `/api/checkins?userId=${id}`, { message: 'Noch eine Woche' })).data.mail, 'off');
  await tick();
  assert.equal(outbox.length, n);
});

test('legal pages: privacy policy and imprint, operator from environment, Google limited-use statement', async () => {
  const { legalHandler } = require('../src/legal');
  const run = (env, p) => {
    let out = null;
    const res = { writeHead: (s, h) => { out = { status: s, headers: h }; }, end: (b) => { out.body = b; } };
    const ok = legalHandler(env)({ method: 'GET' }, res, p);
    return ok ? out : null;
  };
  const env = { LEGAL_NAME: 'Lena Coach', LEGAL_ADDRESS: 'Musterweg 1|12345 Musterstadt', LEGAL_EMAIL: 'kontakt@example.de' };
  const priv = run(env, '/datenschutz');
  assert.equal(priv.status, 200);
  assert.match(priv.body, /Lena Coach<br>Musterweg 1<br>12345 Musterstadt/);
  assert.match(priv.body, /googlehealth\.sleep\.readonly/);
  assert.match(priv.body, /Limited Use requirements/);
  assert.match(run(env, '/impressum').body, /§ 5 DDG/);
  assert.match(run({}, '/datenschutz').body, /fehlen noch/);
  assert.equal(run(env, '/irgendwas'), null);
  assert.ok(run({ LEGAL_NAME: '<script>' }, '/impressum').body.includes('&lt;script&gt;'));
});
