'use strict';

/**
 * Google Health API: steps and sleep flow into the tracker automatically.
 *
 * - OAuth 2.0 (authorization code + PKCE) with only the two read scopes we need.
 * - The refresh token is stored encrypted (AES-256-GCM); the key comes from GOOGLE_TOKEN_KEY or is derived from
 *   the client secret. Access tokens live only in memory.
 * - Steps: daily totals via dataPoints:dailyRollUp. Sleep: sleep sessions, minutes asleep summed per wake-up date,
 *   naps left out. Data from all sources Google knows (Fitbit, Pixel Watch, Health Connect apps).
 * - Synced on connect (last 14 days), every 2 hours (last 3 days) and on demand.
 *
 * Setup: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET; redirect URI = <APP_URL>/api/google/callback.
 * Unverified apps can serve up to 100 users – enough for a coaching practice.
 */

const crypto = require('node:crypto');

const SCOPES = {
  steps: 'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  sleep: 'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
};
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://health.googleapis.com/v4/users/me/dataTypes';
const STATE_MS = 10 * 60 * 1000;
const DAY = 864e5;

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const dayStr = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (date, n) => dayStr(Date.parse(`${date}T00:00:00Z`) + n * DAY);
const civil = (date) => {
  const [year, month, day] = date.split('-').map(Number);
  return { date: { year, month, day } };
};
const fromCivil = (c) => (c && c.date ? `${c.date.year}-${String(c.date.month).padStart(2, '0')}-${String(c.date.day).padStart(2, '0')}` : null);

function googleHealth({ db, HttpError, requireUser, targetClient, localDate, notifier, appUrl, reconcileFor,
  env = process.env, fetchImpl = fetch, log = console }) {
  const clientId = env.GOOGLE_CLIENT_ID || '';
  const clientSecret = env.GOOGLE_CLIENT_SECRET || '';
  const base = appUrl ? appUrl.replace(/\/+$/, '') : '';
  const enabled = Boolean(clientId && clientSecret && base);
  const redirectUri = `${base}/api/google/callback`;
  const key = crypto.createHash('sha256').update(env.GOOGLE_TOKEN_KEY || `stayontrack-google-token:${clientSecret}`).digest();

  // tables: google_links, google_oauth_states (src/db.js)
  const q = {
    link: db.prepare('SELECT * FROM google_links WHERE user_id = ?'),
    links: db.prepare('SELECT * FROM google_links'),
    save: db.prepare(`INSERT INTO google_links (user_id, refresh_token, scopes) VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET refresh_token = excluded.refresh_token, scopes = excluded.scopes,
        connected_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), last_error = NULL`),
    synced: db.prepare("UPDATE google_links SET last_sync_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), last_error = NULL WHERE user_id = ?"),
    // 'revoked' is final until the person reconnects – a later error message must not hide it
    failed: db.prepare("UPDATE google_links SET last_error = ? WHERE user_id = ? AND COALESCE(last_error, '') <> 'revoked'"),
    markRevoked: db.prepare("UPDATE google_links SET last_error = 'revoked' WHERE user_id = ?"),
    drop: db.prepare('DELETE FROM google_links WHERE user_id = ?'),
    putState: db.prepare('INSERT INTO google_oauth_states (state_hash, user_id, verifier, expires_at) VALUES (?, ?, ?, ?)'),
    takeState: db.prepare('DELETE FROM google_oauth_states WHERE state_hash = ? RETURNING *'),
    pruneStates: db.prepare('DELETE FROM google_oauth_states WHERE expires_at < ?'),
    entry: db.prepare('SELECT * FROM entries WHERE user_id = ? AND date = ?'),
    upsertSteps: db.prepare(`INSERT INTO entries (user_id, date, steps) VALUES (?, ?, ?)
      ON CONFLICT(user_id, date) DO UPDATE SET steps = excluded.steps, updated_at = datetime('now')`),
    upsertSleep: db.prepare(`INSERT INTO entries (user_id, date, sleep) VALUES (?, ?, ?)
      ON CONFLICT(user_id, date) DO UPDATE SET sleep = excluded.sleep, updated_at = datetime('now')`),
    clientRole: db.prepare('SELECT role FROM users WHERE id = ?'),
  };
  const tokens = new Map(); // userId → { access, expires }

  // ---- token storage ----
  function seal(text) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
    return `v1:${b64url(iv)}:${b64url(c.getAuthTag())}:${b64url(enc)}`;
  }
  function open(sealed) {
    const [v, iv, tag, enc] = String(sealed).split(':');
    if (v !== 'v1') throw new Error('unknown token format');
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(enc, 'base64url')), d.final()]).toString('utf8');
  }

  // ---- OAuth ----
  async function tokenRequest(params) {
    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }).toString(),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error_description || data.error || `HTTP ${res.status}`);
      err.code = data.error;
      throw err;
    }
    return data;
  }

  async function accessToken(userId) {
    const t = tokens.get(userId);
    if (t && t.expires > Date.now() + 60000) return t.access;
    const link = q.link.get(userId);
    if (!link) throw new Error('not connected');
    let data;
    try {
      data = await tokenRequest({ grant_type: 'refresh_token', refresh_token: open(link.refresh_token) });
    } catch (err) {
      if (err.code === 'invalid_grant') {
        // the person revoked access in their Google account (or the token expired): show it, don't keep trying
        q.markRevoked.run(userId);
      }
      throw err;
    }
    tokens.set(userId, { access: data.access_token, expires: Date.now() + (data.expires_in || 3600) * 1000 });
    return data.access_token;
  }

  async function call(userId, url, init = {}) {
    const res = await fetchImpl(url, {
      ...init,
      headers: { Authorization: `Bearer ${await accessToken(userId)}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
      signal: AbortSignal.timeout(20000),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 403) {
      const err = new Error('permission');
      err.permission = true;
      throw err;
    }
    if (!res.ok) throw new Error((data.error && data.error.message) || `HTTP ${res.status}`);
    return data;
  }

  // ---- sync ----
  /** Daily step totals for [from, to] (inclusive). */
  async function fetchSteps(userId, from, to) {
    const out = new Map();
    let pageToken;
    do {
      const data = await call(userId, `${API}/steps/dataPoints:dailyRollUp`, {
        method: 'POST',
        body: JSON.stringify({ range: { start: civil(from), end: civil(addDays(to, 1)) }, windowSizeDays: 1, ...(pageToken ? { pageToken } : {}) }),
      });
      for (const p of data.rollupDataPoints || []) {
        const date = fromCivil(p.civilStartTime);
        const n = p.steps && Number(p.steps.countSum);
        if (date && Number.isFinite(n)) out.set(date, n);
      }
      pageToken = data.nextPageToken;
    } while (pageToken);
    return out;
  }

  /** Hours asleep per wake-up date for [from, to] (inclusive); naps don't count. */
  async function fetchSleep(userId, from, to) {
    const out = new Map();
    let pageToken;
    const filter = `sleep.interval.civil_end_time >= "${from}" AND sleep.interval.civil_end_time < "${addDays(to, 1)}"`;
    do {
      const params = new URLSearchParams({ filter, pageSize: '25', ...(pageToken ? { pageToken } : {}) });
      const data = await call(userId, `${API}/sleep/dataPoints?${params}`);
      for (const p of data.dataPoints || []) {
        const s = p.sleep;
        if (!s || (s.metadata && s.metadata.nap)) continue;
        const date = fromCivil(s.interval && s.interval.civilEndTime) || (s.interval && s.interval.endTime ? localDate(Date.parse(s.interval.endTime), notifier.timezone) : null);
        const minutes = s.summary ? Number(s.summary.minutesAsleep) : NaN;
        if (!date || !Number.isFinite(minutes) || minutes <= 0) continue;
        out.set(date, (out.get(date) || 0) + minutes);
      }
      pageToken = data.nextPageToken;
    } while (pageToken);
    for (const [d, m] of out) out.set(d, Math.round((m / 60) * 100) / 100);
    return out;
  }

  /** Pulls steps and sleep for the last `days` days into the tracker. Returns what was written. */
  async function syncUser(userId, days = 3) {
    const link = q.link.get(userId);
    if (!link) throw new Error('not connected');
    const to = localDate(Date.now(), notifier.timezone);
    const from = addDays(to, -(days - 1));
    const granted = link.scopes.split(' ');
    const result = { steps: 0, sleep: 0, missing: [] };
    let steps = new Map();
    let sleep = new Map();
    try {
      if (granted.includes(SCOPES.steps)) steps = await fetchSteps(userId, from, to);
      else result.missing.push('steps');
    } catch (err) {
      if (!err.permission) throw err;
      result.missing.push('steps');
    }
    try {
      if (granted.includes(SCOPES.sleep)) sleep = await fetchSleep(userId, from, to);
      else result.missing.push('sleep');
    } catch (err) {
      if (!err.permission) throw err;
      result.missing.push('sleep');
    }
    db.exec('BEGIN');
    try {
      for (const [date, n] of steps) {
        if (n <= 0 || n > 200000) continue;
        const e = q.entry.get(userId, date);
        if (!e || e.steps !== n) q.upsertSteps.run(userId, date, n);
        result.steps++;
      }
      for (const [date, h] of sleep) {
        if (h <= 0 || h > 24) continue;
        const e = q.entry.get(userId, date);
        if (!e || e.sleep !== h) q.upsertSleep.run(userId, date, h);
        result.sleep++;
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    q.synced.run(userId);
    if (reconcileFor) reconcileFor(userId);
    return result;
  }

  async function syncAll() {
    if (!enabled) return;
    for (const link of q.links.all()) {
      if (link.last_error === 'revoked') continue;
      try {
        await syncUser(link.user_id, 3);
      } catch (err) {
        q.failed.run(String(err.message).slice(0, 200), link.user_id);
        log.error(`Google Health: Sync für Nutzer ${link.user_id} fehlgeschlagen:`, err.message);
      }
    }
  }

  function status(userId) {
    const link = q.link.get(userId);
    const granted = link ? link.scopes.split(' ') : [];
    return {
      configured: enabled,
      connected: Boolean(link) && link.last_error !== 'revoked',
      revoked: Boolean(link) && link.last_error === 'revoked',
      steps: granted.includes(SCOPES.steps),
      sleep: granted.includes(SCOPES.sleep),
      connectedAt: link ? link.connected_at : null,
      lastSyncAt: link ? link.last_sync_at : null,
      lastError: link && link.last_error && link.last_error !== 'revoked' ? link.last_error : null,
    };
  }

  function requireClient(ctx) {
    const u = requireUser(ctx);
    if (u.role !== 'client') throw new HttpError(403, 'Google Health ist für Klienten');
    return u;
  }
  const redirect = (ctx, hash) => {
    ctx.res.writeHead(302, { Location: `/#/settings/${hash}`, 'Cache-Control': 'no-store' });
    ctx.res.end();
  };

  const routes = [
    ['GET', /^\/api\/google$/, async (ctx) => status(targetClient(ctx).id)],

    // start: a one-time state (CSRF) bound to the logged-in client, PKCE verifier kept on the server
    ['POST', /^\/api\/google\/connect$/, async (ctx) => {
      const u = requireClient(ctx);
      if (!enabled) throw new HttpError(503, 'Google Health ist noch nicht eingerichtet.');
      q.pruneStates.run(Date.now());
      const state = b64url(crypto.randomBytes(24));
      const verifier = b64url(crypto.randomBytes(48));
      q.putState.run(sha256(state), u.id, verifier, Date.now() + STATE_MS);
      const url = `${AUTH_URL}?${new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: `${SCOPES.steps} ${SCOPES.sleep}`,
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state,
        code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()),
        code_challenge_method: 'S256',
      })}`;
      return { url };
    }],

    // Google sends the browser back here
    ['GET', /^\/api\/google\/callback$/, async (ctx) => {
      const p = ctx.url.searchParams;
      const row = p.get('state') ? q.takeState.get(sha256(p.get('state'))) : null;
      if (!row || row.expires_at < Date.now()) return redirect(ctx, 'google-error/state');
      if (p.get('error')) return redirect(ctx, `google-error/${p.get('error') === 'access_denied' ? 'denied' : 'google'}`);
      if (q.clientRole.get(row.user_id)?.role !== 'client') return redirect(ctx, 'google-error/state');
      let data;
      try {
        data = await tokenRequest({ grant_type: 'authorization_code', code: p.get('code') || '', redirect_uri: redirectUri, code_verifier: row.verifier });
      } catch (err) {
        log.error('Google Health: Token-Tausch fehlgeschlagen:', err.message);
        return redirect(ctx, 'google-error/token');
      }
      const scopes = String(data.scope || '').split(' ').filter((s) => s === SCOPES.steps || s === SCOPES.sleep);
      if (!scopes.length) return redirect(ctx, 'google-error/scopes');
      if (!data.refresh_token) {
        const old = q.link.get(row.user_id);
        if (!old) return redirect(ctx, 'google-error/token');
        q.save.run(row.user_id, old.refresh_token, scopes.join(' '));
      } else {
        q.save.run(row.user_id, seal(data.refresh_token), scopes.join(' '));
      }
      tokens.set(row.user_id, { access: data.access_token, expires: Date.now() + (data.expires_in || 3600) * 1000 });
      // the first sync fetches two weeks
      syncUser(row.user_id, 14).catch((err) => {
        q.failed.run(String(err.message).slice(0, 200), row.user_id);
        log.error('Google Health: erster Sync fehlgeschlagen:', err.message);
      });
      return redirect(ctx, scopes.length === 2 ? 'google-ok' : 'google-partial');
    }],

    ['POST', /^\/api\/google\/sync$/, async (ctx) => {
      const u = requireClient(ctx);
      if (!q.link.get(u.id)) throw new HttpError(409, 'Google Health ist nicht verbunden.');
      try {
        const r = await syncUser(u.id, 7);
        return { ...r, status: status(u.id) };
      } catch (err) {
        q.failed.run(String(err.message).slice(0, 200), u.id);
        const revoked = q.link.get(u.id)?.last_error === 'revoked';
        throw new HttpError(502, revoked ? 'Der Zugriff wurde in deinem Google-Konto entfernt. Verbinde Google Health neu.' : 'Google Health antwortet gerade nicht. Versuch es später nochmal.');
      }
    }],

    ['DELETE', /^\/api\/google$/, async (ctx) => {
      const u = requireClient(ctx);
      const link = q.link.get(u.id);
      if (link) {
        try {
          await fetchImpl(REVOKE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: open(link.refresh_token) }).toString(),
            signal: AbortSignal.timeout(10000),
          });
        } catch { /* removed here anyway */ }
        q.drop.run(u.id);
        tokens.delete(u.id);
      }
      return status(u.id);
    }],
  ];

  if (enabled) {
    // every 2 hours: last 3 days for everyone connected (first run shortly after start)
    setTimeout(() => syncAll().catch(() => {}), 60 * 1000).unref();
    setInterval(() => syncAll().catch(() => {}), 2 * 60 * 60 * 1000).unref();
  }

  return { routes, syncAll, syncUser, status, enabled, SCOPES, _seal: seal, _open: open };
}

module.exports = { googleHealth, SCOPES };
