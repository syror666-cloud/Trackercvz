'use strict';

/**
 * End-to-end smoke tests: the real app in a real browser, with a fresh database.
 * Run with `npm run test:e2e` (needs Playwright with Chromium: `npm i -D playwright && npx playwright install chromium`).
 * Without Playwright the tests are skipped.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const path = require('node:path');

let chromium = null;
try {
  ({ chromium } = require('playwright'));
} catch {
  chromium = null;
}
const skip = chromium ? false : 'Playwright ist nicht installiert';

const { openDb, createUser } = require('../src/db');
const { createApp } = require('../src/app');
const { createNotifier } = require('../src/notify');
const { createReminders } = require('../src/admin');

let server;
let base;
let browser;
let db;

test.before(async () => {
  if (skip) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sot-e2e-'));
  db = openDb(path.join(dir, 'tracker.db'));
  createUser(db, { username: 'coach', displayName: 'Coach Lena', password: 'coachpass123', role: 'coach' });
  const max = createUser(db, { username: 'max', displayName: 'Max Muster', password: 'maxpass123', role: 'client' });
  db.prepare("UPDATE users SET onboarded_at = '2026-01-01T00:00:00Z', seen_release = ? WHERE id = ?").run('x', max);
  const notifier = createNotifier(db, { subject: 'mailto:t@example.com', fetchImpl: async () => ({ status: 201 }) });
  server = http.createServer(createApp({ db, notifier, reminders: createReminders(db, notifier), publicDir: path.join(__dirname, '..', 'public') }));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});

test.after(async () => {
  if (browser) await browser.close();
  if (server) server.close();
});

/** New browser session, logged in; dismisses "what's new" and the tour. */
async function loginAs(username, password, viewport = { width: 1200, height: 900 }) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.fill('input[name=username]', username);
  await page.fill('input[name=password]', password);
  await page.click('#login-form button[type=submit]');
  await page.waitForSelector('#app:not([data-loading="1"])');
  await dismissOverlays(page);
  return { page, errors };
}
async function dismissOverlays(page) {
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(500);
    const close = page.locator('[data-wn-ok], .tour [data-skip]');
    if (await close.count()) await close.first().click();
  }
}

test('client: daily entry is saved and shown', { skip }, async () => {
  const { page, errors } = await loginAs('max', 'maxpass123');
  await page.waitForSelector('#entry-form');
  if (!(await page.locator('#f-weight').isVisible())) await page.click('[data-open-sheet]');
  await page.fill('#f-weight', '82,4');
  await page.fill('#f-steps', '9500');
  await page.click('#entry-form button[type=submit]');
  await page.waitForTimeout(800);
  const row = db.prepare("SELECT weight, steps FROM entries WHERE user_id = (SELECT id FROM users WHERE username = 'max') ORDER BY date DESC LIMIT 1").get();
  assert.deepEqual({ ...row }, { weight: 82.4, steps: 9500 });
  assert.deepEqual(errors, []);
});

test('client: food diary – search a food and add it', { skip }, async () => {
  const { page, errors } = await loginAs('max', 'maxpass123');
  await page.goto(`${base}/#/nutrition/diary`);
  await page.click('[data-add="fruehstueck"]');
  await page.fill('dialog input[name=q]', 'Haferflocken');
  await page.click('dialog .add-food-list li[data-i="0"]');
  await page.fill('dialog input[name=amount]', '60');
  await page.click('dialog button[type=submit]');
  await page.waitForSelector('.diary-item');
  assert.match(await page.locator('.diary-meal[data-meal="fruehstueck"]').innerText(), /Haferflocken/);
  assert.deepEqual(errors, []);
});

test('coach: test fridge – buy for free, celebration, sold out', { skip }, async () => {
  const { page, errors } = await loginAs('coach', 'coachpass123');
  await page.goto(`${base}/#/account/fame/shop`);
  await page.click('.shop-item:has-text("Ultra White") [data-buy]');
  await page.waitForSelector('.buy-fx');
  await page.click('.buy-fx');
  await page.waitForSelector('.buy-fx', { state: 'detached' });
  await page.waitForSelector('.shop-item.sold-out:has-text("Ultra White")');
  assert.deepEqual(errors, []);
});

test('check-in: coach sends it, client sees it', { skip }, async () => {
  const { page: coach, errors } = await loginAs('coach', 'coachpass123');
  const id = db.prepare("SELECT id FROM users WHERE username = 'max'").get().id;
  await coach.goto(`${base}/#/checkin/${id}`);
  await coach.fill('#ci-msg', 'Starke Woche, weiter so!');
  await coach.click('#checkin-form button[type=submit]');
  await coach.waitForTimeout(800);
  const { page: client } = await loginAs('max', 'maxpass123');
  await client.waitForSelector('.checkin-card');
  assert.match(await client.locator('.checkin-card').innerText(), /Starke Woche/);
  assert.deepEqual(errors, []);
});

test('invite link: client creates the account and gets the welcome tour', { skip }, async () => {
  const { page: coach, errors } = await loginAs('coach', 'coachpass123');
  await coach.click('#btn-new-client');
  await coach.fill('dialog input[name=displayName]', 'Ida Neu');
  await coach.click('dialog [data-submit]');
  const link = await coach.inputValue('#inv-link');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const ida = await ctx.newPage();
  await ida.goto(link);
  await ida.fill('#iv-user', 'ida');
  await ida.fill('#iv-pw', 'idapass123');
  await ida.check('input[name=consent]');
  await ida.click('#invite-form button[type=submit]');
  await ida.waitForSelector('.tour');
  await ida.click('.tour [data-skip]');
  await ida.waitForSelector('.tour', { state: 'detached' });
  assert.ok(db.prepare("SELECT onboarded_at FROM users WHERE username = 'ida'").get().onboarded_at);
  assert.deepEqual(errors, []);
});

test('privacy: client downloads own data', { skip }, async () => {
  const { page, errors } = await loginAs('max', 'maxpass123');
  await page.goto(`${base}/#/settings`);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('a[href="/api/me/export"]')]);
  const data = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  assert.equal(data.profile.username, 'max');
  assert.deepEqual(errors, []);
});

test('training: unsaved workout input survives a reload and is cleared after saving', { skip }, async () => {
  const maxId = db.prepare("SELECT id FROM users WHERE username = 'max'").get().id;
  const days = [{ id: 'd-push', name: 'Push', exercises: [{ id: 'e1', name: 'Brustpresse', sets: 2, reps: '10' }] }];
  db.prepare('INSERT OR REPLACE INTO training_plans (client_id, split, days_per_week, data, updated_by) VALUES (?, ?, ?, ?, ?)')
    .run(maxId, 'Custom', 1, JSON.stringify(days), maxId);
  const { page, errors } = await loginAs('max', 'maxpass123', { width: 420, height: 900 });
  await page.goto(`${base}/#/training`);
  await page.click('[data-start="0"]');
  const weight = page.locator('[data-f="weight"]').first();
  await weight.fill('55');
  await page.locator('[data-f="reps"]').first().fill('12');
  // the phone throws the page away while the app is in the background
  await page.reload();
  await page.waitForSelector('#app:not([data-loading="1"])');
  await page.goto(`${base}/#/training`);
  await page.waitForSelector('[data-f="weight"]');
  assert.equal(await page.locator('[data-f="weight"]').first().inputValue(), '55');
  assert.equal(await page.locator('[data-f="reps"]').first().inputValue(), '12');
  await page.click('[data-save]');
  await page.waitForTimeout(800);
  const set = db.prepare('SELECT weight, reps FROM workout_sets WHERE workout_id = (SELECT MAX(id) FROM workouts WHERE client_id = ?) ORDER BY id LIMIT 1').get(maxId);
  assert.deepEqual({ ...set }, { weight: 55, reps: 12 });
  const left = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('sot-workout-')));
  assert.deepEqual(left, []);
  assert.deepEqual(errors, []);
});

test('coach: pause a client, bring them back, delete another one', { skip }, async () => {
  const pauseId = createUser(db, { username: 'paula', displayName: 'Paula Pause', password: 'paulapass123', role: 'client' });
  const goneId = createUser(db, { username: 'gustav', displayName: 'Gustav Weg', password: 'gustavpass123', role: 'client' });
  const { page, errors } = await loginAs('coach', 'coachpass123');
  // pause for two weeks with a note
  await page.goto(`${base}/#/client/${pauseId}`);
  await page.click('[data-archive-client]');
  await page.waitForSelector('#ar-note');
  await page.click('dialog [data-days="14"]');
  await page.fill('#ar-note', 'Urlaub');
  await page.click('dialog [type=submit]');
  await page.waitForSelector('.archive-banner');
  const row = db.prepare('SELECT archived_at, archive_until, archive_note FROM users WHERE id = ?').get(pauseId);
  assert.ok(row.archived_at);
  assert.equal(row.archive_note, 'Urlaub');
  assert.match(row.archive_until, /^\d{4}-\d{2}-\d{2}$/);
  // home: no longer in the client list, but in the archive
  await page.goto(`${base}/#/`);
  await page.waitForSelector('.archive-section');
  assert.equal(await page.locator('.client-list a[href="#/client/' + pauseId + '"]').count(), 0);
  await page.click('.archive-section summary');
  await page.click(`[data-unarchive="${pauseId}"]`);
  await page.waitForSelector(`.client-list a[href="#/client/${pauseId}"]`);
  assert.equal(db.prepare('SELECT archived_at FROM users WHERE id = ?').get(pauseId).archived_at, null);
  // delete: only after typing the name
  await page.goto(`${base}/#/client/${goneId}`);
  await page.click('[data-delete-client]');
  await page.waitForSelector('#del-confirm');
  assert.equal(await page.locator('dialog [type=submit]').isDisabled(), true);
  await page.fill('#del-confirm', 'gustav weg');
  await page.click('dialog [type=submit]');
  await page.waitForTimeout(800);
  assert.equal(db.prepare('SELECT 1 FROM users WHERE id = ?').get(goneId), undefined);
  assert.deepEqual(errors, []);
});
