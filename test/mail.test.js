'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMailer } = require('../src/mail');

const quiet = { log() {}, warn() {}, error() {} };
const res = (status, body = {}, headers = {}) => ({
  ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body),
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
});

test('resend: same idempotency key on retries, retries 5xx/429/network, not other 4xx', async () => {
  const calls = [];
  const replies = [() => { throw new Error('ECONNRESET'); }, () => res(503), () => res(429, {}, { 'retry-after': '2' }), () => res(200, { id: 'em_1' })];
  const m = createMailer({ RESEND_API_KEY: 'k', MAIL_FROM: 'A <a@x.de>' }, { log: quiet, fetchImpl: async (url, opts) => { calls.push(opts); return replies[calls.length - 1](); } });
  const waits = [];
  const id = await m.send({ to: 'b@x.de', subject: 's', text: 't', html: 'h' }, { sleep: async (ms) => waits.push(ms) });
  assert.equal(id, 'em_1');
  assert.equal(calls.length, 4);
  assert.equal(new Set(calls.map((c) => c.headers['Idempotency-Key'])).size, 1);
  assert.deepEqual(waits, [500, 1000, 2000]);
  // a second mail gets a new key
  const calls2 = [];
  const m2 = createMailer({ RESEND_API_KEY: 'k', MAIL_FROM: 'A <a@x.de>' }, { log: quiet, fetchImpl: async (u, o) => { calls2.push(o); return res(422, { message: 'invalid from' }); } });
  await assert.rejects(m2.send({ to: 'b@x.de', subject: 's', text: 't', html: 'h' }, { sleep: async () => {} }), /422/);
  assert.equal(calls2.length, 1, 'no retry on 4xx');
  assert.notEqual(calls2[0].headers['Idempotency-Key'], calls[0].headers['Idempotency-Key']);
});
