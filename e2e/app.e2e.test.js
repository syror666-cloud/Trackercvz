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
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(500);
    const close = page.locator('[data-wn-ok], .tour [data-skip], [data-thanks-later], [data-design-later]');
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

test('client: ＋ in the tab bar – search a food, pick the meal, calories on the dashboard', { skip }, async () => {
  const { page, errors } = await loginAs('max', 'maxpass123', { width: 390, height: 844 });
  await page.waitForSelector('#kcal-card:not([hidden])');
  await page.click('[data-quick-add]');
  await page.fill('dialog input[name=q]', 'Skyr');
  await page.locator('dialog .add-food-list li[data-i]').first().click();
  await page.fill('#fa-amount', '200');
  await page.selectOption('#fa-meal', 'abend');
  await page.click('dialog [type=submit]');
  await page.waitForFunction(() => /^[1-9]/.test(document.querySelector('#kcal-card .kcal-card-side p')?.textContent || ''));
  const row = db.prepare("SELECT meal, amount FROM food_log WHERE client_id = (SELECT id FROM users WHERE username = 'max') ORDER BY id DESC LIMIT 1").get();
  assert.deepEqual({ ...row }, { meal: 'abend', amount: 200 });
  // strategy and more
  await page.click('.nav a[href="#/strategy"]');
  await page.waitForSelector('.tabs a[href="#/strategy/plan"]');
  await page.click('.nav a[href="#/more"]');
  await page.waitForSelector('.more-list a[href="#/chat"]');
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
  // ✓ on a set starts the rest timer
  await page.locator('[data-done-set]').first().click();
  await page.waitForSelector('.rest-time strong');
  assert.match(await page.locator('.rest-time strong').innerText(), /^1:(2|3)\d$/);
  await page.click('[data-rest-skip]');
  await page.waitForSelector('[data-rest-go]');
  await page.click('[data-save]');
  // the summary with the numbers of this workout
  await page.waitForSelector('.wo-sum-tiles');
  assert.match(await page.locator('.wo-sum-tiles').innerText(), /660\s+kg bewegt/); // 55 kg × 12
  await page.click('[data-nophoto]');
  await page.waitForFunction(() => (document.querySelector('.wo-preview') || {}).src?.startsWith('blob:'));
  await page.click('[data-done]');
  const set = db.prepare('SELECT weight, reps FROM workout_sets WHERE workout_id = (SELECT MAX(id) FROM workouts WHERE client_id = ?) ORDER BY id LIMIT 1').get(maxId);
  assert.deepEqual({ ...set }, { weight: 55, reps: 12 });
  // the monthly recap opens as a story and closes with Escape
  await page.waitForSelector('[data-recap]');
  await page.click('[data-recap]');
  await page.waitForSelector('.recap .rc-huge');
  await page.keyboard.press('ArrowRight');
  await page.waitForSelector('.recap .rc-big');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.recap'));
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

test('offline: the app opens without a connection, entries wait in the outbox and arrive exactly once', { skip }, async () => {
  const maxId = db.prepare("SELECT id FROM users WHERE username = 'max'").get().id;
  const days = [{ id: 'd-off', name: 'Offline-Push', exercises: [{ id: 'e1', name: 'Schulterdrücken', sets: 1, reps: '10' }] }];
  db.prepare('INSERT OR REPLACE INTO training_plans (client_id, split, days_per_week, data, updated_by) VALUES (?, ?, ?, ?, ?)')
    .run(maxId, 'Custom', 1, JSON.stringify(days), maxId);
  const count = (sql) => db.prepare(sql).get(maxId).n;
  const foodBefore = count('SELECT COUNT(*) AS n FROM food_log WHERE client_id = ?');
  const msgBefore = count('SELECT COUNT(*) AS n FROM messages WHERE client_id = ?');
  const woBefore = count("SELECT COUNT(*) AS n FROM workouts WHERE client_id = ? AND day_id = 'd-off'");
  const { page, errors } = await loginAs('max', 'maxpass123', { width: 390, height: 844 });
  const ctx = page.context();
  // online once: the service worker keeps the app, the app keeps the data
  await page.evaluate(() => navigator.serviceWorker.ready);
  for (const h of ['#/', '#/training', '#/nutrition/diary', '#/chat']) {
    await page.goto(`${base}/${h}`);
    await page.waitForTimeout(900);
  }
  await page.goto(`${base}/#/`);
  await page.waitForTimeout(3000); // prefetch for offline

  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('#kcal-card:not([hidden])', { timeout: 8000 });
  await page.waitForSelector('#offline-bar');
  assert.match(await page.locator('#offline-bar').innerText(), /Offline/);

  // food via ＋
  await page.click('[data-quick-add]');
  await page.fill('dialog input[name=q]', 'Skyr');
  await page.locator('dialog .add-food-list li[data-i]').first().click();
  await page.click('dialog [type=submit]');
  await page.waitForFunction(() => /wartet/.test(document.getElementById('offline-bar')?.textContent || ''));
  // weight
  if (!(await page.locator('#f-weight').isVisible())) await page.click('[data-open-sheet]');
  await page.fill('#f-weight', '79,9');
  await page.click('#entry-form button[type=submit]');
  await page.waitForTimeout(600);
  // workout with summary
  await page.goto(`${base}/#/training`);
  await page.waitForSelector('[data-start]');
  const idx = await page.locator('[data-start]').evaluateAll((els) => els.findIndex((e) => /Offline-Push/.test(e.closest('section,li,div').textContent)));
  await page.locator('[data-start]').nth(Math.max(0, idx)).click();
  await page.fill('[data-f="weight"]', '40');
  await page.fill('[data-f="reps"]', '10');
  await page.click('[data-save]');
  await page.waitForSelector('.wo-sum');
  assert.match(await page.locator('.wo-sum').innerText(), /Offline gespeichert/);
  await page.click('[data-done]');
  // chat
  await page.goto(`${base}/#/chat`);
  await page.waitForTimeout(800);
  await page.fill('.chat textarea, textarea[name=body]', 'Hab im Keller kein Netz 💪');
  await page.locator('.chat textarea, textarea[name=body]').press('Enter').catch(() => {});
  await page.locator('form button[type=submit], .chat-form button').last().click().catch(() => {});
  await page.waitForSelector('.msg.pending');
  const waiting = await page.evaluate(() => JSON.parse(localStorage.getItem('sot-outbox') || '[]').length);
  assert.ok(waiting >= 4, `outbox has ${waiting} entries`);
  // nothing reached the server yet
  assert.equal(count('SELECT COUNT(*) AS n FROM food_log WHERE client_id = ?'), foodBefore);

  // back online: everything arrives, exactly once
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('sot-outbox') || '[]').length === 0, null, { timeout: 15000 });
  await page.waitForTimeout(800);
  assert.equal(count('SELECT COUNT(*) AS n FROM food_log WHERE client_id = ?'), foodBefore + 1);
  assert.equal(count('SELECT COUNT(*) AS n FROM messages WHERE client_id = ?'), msgBefore + 1);
  assert.equal(count("SELECT COUNT(*) AS n FROM workouts WHERE client_id = ? AND day_id = 'd-off'"), woBefore + 1);
  const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  assert.equal(db.prepare('SELECT weight FROM entries WHERE user_id = ? AND date = ?').get(maxId, today).weight, 79.9);
  await page.waitForFunction(() => !document.getElementById('offline-bar'));

  // logout clears the offline data on the device
  await page.click('#avatar-btn');
  await page.click('#btn-logout');
  await page.waitForSelector('#login-form');
  const left = await page.evaluate(async () => ({ outbox: localStorage.getItem('sot-outbox'), caches: (await caches.keys()).filter((k) => k.startsWith('sot-data')) }));
  assert.deepEqual(left, { outbox: null, caches: [] });
  assert.deepEqual(errors, []);
});

test('design: announcement, switch to the classic look, vote; the coach sees the result', { skip }, async () => {
  createUser(db, { username: 'lena', displayName: 'Lena Lauf', password: 'lenapass123', role: 'client' });
  db.prepare("UPDATE users SET onboarded_at = '2026-01-01T00:00:00Z' WHERE username = 'lena'").run();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.fill('input[name=username]', 'lena');
  await page.fill('input[name=password]', 'lenapass123');
  await page.click('#login-form button[type=submit]');
  await page.waitForSelector('#app:not([data-loading="1"])');
  // the new look is on from the start; the announcement leads to the vote
  for (let i = 0; i < 4 && !(await page.locator('dialog.design-intro').count()); i++) {
    await page.waitForTimeout(500);
    const close = page.locator('[data-wn-ok], .tour [data-skip], [data-thanks-later]');
    if (await close.count()) await close.first().click();
  }
  assert.ok(await page.evaluate(() => document.documentElement.classList.contains('design-club')));
  await page.click('[data-design-go]');
  await page.waitForSelector('#design-card [data-design="classic"]');
  assert.match(page.url(), /#\/settings/);
  await page.click('#design-card [data-design="classic"]');
  await page.waitForFunction(() => !document.documentElement.classList.contains('design-club'));
  await page.fill('#dv-comment', 'Mir gefällt das alte Blau besser');
  await page.click('#design-card [data-vote]');
  await page.waitForSelector('#design-card .dv-voted');
  // after a reload the classic look and the vote are still there, the announcement does not return
  await page.reload();
  await page.waitForSelector('#design-card .dv-voted');
  assert.equal(await page.locator('dialog.design-intro').count(), 0);
  assert.ok(!(await page.evaluate(() => document.documentElement.classList.contains('design-club'))));
  await ctx.close();
  const coach = await loginAs('coach', 'coachpass123');
  await coach.page.waitForSelector('.design-votes');
  const text = await coach.page.locator('.design-votes').innerText();
  assert.match(text, /Bisheriges Design vorn/);
  assert.match(text, /alte Blau/);
  assert.deepEqual(errors, []);
  assert.deepEqual(coach.errors, []);
});
