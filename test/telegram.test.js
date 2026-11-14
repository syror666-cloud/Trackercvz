'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { openDb, createUser } = require('../src/db');
const { createApp } = require('../src/app');
const { createNotifier } = require('../src/notify');
const { createReminders } = require('../src/admin');
const { createTelegram } = require('../src/telegram');
const { localDate } = require('../src/schedule');

/** A fake Telegram Bot API that records every call. */
function fakeTelegram() {
  const calls = [];
  let nextId = 100;
  const fetchImpl = async (url, init) => {
    const method = url.split('/').pop();
    const body = JSON.parse(init.body || '{}');
    calls.push({ method, body });
    let result = true;
    if (method === 'getMe') result = { username: 'sot_test_bot' };
    if (method === 'sendMessage') result = { message_id: nextId++, chat: { id: body.chat_id } };
    return { status: 200, json: async () => ({ ok: true, result }) };
  };
  return { calls, fetchImpl, sent: () => calls.filter((c) => c.method === 'sendMessage') };
}

/** A scripted model: each call returns the next response; records what it was sent. */
function fakeClaude(script) {
  const requests = [];
  return {
    requests,
    messages: {
      create: async (params) => {
        requests.push(JSON.parse(JSON.stringify(params)));
        const next = script.shift();
        return typeof next === 'function' ? next(params) : next;
      },
    },
  };
}

async function setup(t, { claude } = {}) {
  const db = openDb(':memory:');
  const coachId = createUser(db, { username: 'coach', displayName: 'Coach Lena', password: 'coachpass123', role: 'coach' });
  const maxId = createUser(db, { username: 'max', displayName: 'Max Muster', password: 'maxpass123', role: 'client' });
  const notifier = createNotifier(db, { subject: 'mailto:t@example.com', fetchImpl: async () => ({ status: 201 }), timezone: 'Europe/Berlin' });
  const tgApi = fakeTelegram();
  const telegram = createTelegram({
    db, notifier, localDate, appUrl: 'https://app.example.com', fetchImpl: tgApi.fetchImpl, aiClient: claude || null,
    env: { TELEGRAM_BOT_TOKEN: '123:abc' }, log: { log() {}, error() {} },
  });
  const server = http.createServer(createApp({ db, notifier, telegram, reminders: createReminders(db, notifier), publicDir: path.join(__dirname, '..', 'public') }));
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const jar = {};
  const call = async (who, method, url, body, headers = {}) => {
    const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(jar[who] ? { Cookie: jar[who] } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) jar[who] = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  await call('coach', 'POST', '/api/login', { username: 'coach', password: 'coachpass123' });
  await call('max', 'POST', '/api/login', { username: 'max', password: 'maxpass123' });
  const chat = (text, extra = {}) => telegram.handleUpdate({ message: { message_id: 1, chat: { id: 555, type: 'private' }, from: { first_name: 'Lena' }, text, ...extra } });
  const settle = () => new Promise((r) => setTimeout(r, 30));
  return { db, coachId, maxId, telegram, tgApi, call, chat, settle };
}

test('telegram: link, forward notifications, reply to a client', async (t) => {
  const { db, maxId, telegram, tgApi, call, chat, settle } = await setup(t);
  // strangers get nothing
  await chat('Hallo');
  assert.match(tgApi.sent().at(-1).body.text, /nur für Coaches/);
  // link through the app
  assert.equal((await call('max', 'POST', '/api/telegram/link')).status, 403);
  const link = (await call('coach', 'POST', '/api/telegram/link')).data;
  const code = link.url.match(/^https:\/\/t\.me\/sot_test_bot\?start=([\w-]+)$/)[1];
  await chat(`/start ${code}`);
  assert.match(tgApi.sent().at(-1).body.text, /Verbunden/);
  assert.equal((await call('coach', 'GET', '/api/telegram')).data.linked.name, 'Lena');
  // the code works only once
  await chat(`/start ${code}`);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM telegram_links').get().n, 1);

  // a client writes → the coach gets it in Telegram with an "open" button
  await call('max', 'POST', '/api/messages', { body: 'Kann ich heute Pizza essen?' });
  await settle();
  const note = tgApi.sent().at(-1).body;
  assert.equal(note.chat_id, '555');
  assert.match(note.text, /Nachricht von Max Muster/);
  assert.match(note.text, /Pizza/);
  assert.equal(note.reply_markup.inline_keyboard[0][0].url, `https://app.example.com/#/messages/${maxId}`);
  const notifMsgId = tgApi.calls.filter((c) => c.method === 'sendMessage').length + 99;

  // replying to it sends the text straight to Max
  await chat('Klar, eine kleine – und viel Wasser dazu!', { reply_to_message: { message_id: notifMsgId } });
  const m = db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT 1').get();
  assert.equal(m.client_id, maxId);
  assert.equal(m.body, 'Klar, eine kleine – und viel Wasser dazu!');
  assert.match(tgApi.sent().at(-1).body.text, /An Max Muster gesendet/);

  // commands
  await chat('/offen');
  assert.match(tgApi.sent().at(-1).body.text, /Wartet auf dich/);
  await chat('/heute');
  assert.match(tgApi.sent().at(-1).body.text, /Aufmerksamkeit/);

  // webhook needs the secret
  assert.equal((await call('x', 'POST', '/api/telegram/webhook', { update_id: 1 })).status, 401);
  assert.equal((await call('x', 'POST', '/api/telegram/webhook', { update_id: 1 }, { 'X-Telegram-Bot-Api-Secret-Token': telegram.secret })).status, 200);

  // unlink
  await call('coach', 'DELETE', '/api/telegram');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM telegram_links').get().n, 0);
});

test('telegram assistant: names never reach the model, actions wait for the button', async (t) => {
  let claude;
  claude = fakeClaude([
    // 1) the model looks up open requests
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu1', name: 'offene_anfragen', input: {} }] },
    // 2) then drafts a message to the client it was told about (by code)
    (p) => {
      const id = p.messages[0].content.match(/K(\d+)/)[1];
      return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu2', name: 'nachricht_senden', input: { klient: `K${id}`, text: 'Hi {name}, dein Plan kommt am Freitag!' } }] };
    },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Entwurf für K2 liegt bereit.' }] },
  ]);
  const { db, maxId, tgApi, call, chat, telegram } = await setup(t, { claude });
  const code = (await call('coach', 'POST', '/api/telegram/link')).data.url.split('start=')[1];
  await chat(`/start ${code}`);
  await call('max', 'POST', '/api/messages', { body: 'Hallo Lena, ich bin Max – wann kommt mein Plan?' });

  await chat('Was ist offen? Schreib Max, dass sein Plan Freitag kommt.');
  // nothing with a name went to the model
  const sentToModel = JSON.stringify(claude.requests);
  assert.doesNotMatch(sentToModel, /Max|Muster/);
  assert.match(sentToModel, new RegExp(`K${maxId}`));
  assert.equal(claude.requests[0].model, 'claude-haiku-5-5');
  // the draft is shown with buttons, with the real name back in
  const draft = tgApi.sent().find((c) => /Nachricht an/.test(c.body.text));
  assert.match(draft.body.text, /Max Muster/);
  assert.match(draft.body.text, /Hi Max, dein Plan kommt am Freitag!/);
  const before = db.prepare('SELECT COUNT(*) AS n FROM messages').get().n;
  // the model's closing text has the name put back
  assert.equal(tgApi.calls.filter((c) => c.method === 'sendMessage').at(-1).body.text, 'Entwurf für Max Muster liegt bereit.');
  // tap "Senden"
  const data = draft.body.reply_markup.inline_keyboard[0][0].callback_data;
  await telegram.handleUpdate({ callback_query: { id: 'cb1', data, message: { message_id: 999, chat: { id: 555 } } } });
  const after = db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT 1').get();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM messages').get().n, before + 1);
  assert.equal(after.body, 'Hi Max, dein Plan kommt am Freitag!');
  // a second tap does nothing
  await telegram.handleUpdate({ callback_query: { id: 'cb2', data, message: { message_id: 999, chat: { id: 555 } } } });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM messages').get().n, before + 1);
});
