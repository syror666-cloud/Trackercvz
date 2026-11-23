'use strict';

/**
 * Two-factor sign-in with one-time codes (TOTP, RFC 6238) – works with Authy, Google Authenticator,
 * Microsoft Authenticator, 1Password, Apple Passwords and any other authenticator app.
 *
 * - Setup: password again → secret + QR code → first code from the app confirms it → 10 one-time recovery codes.
 * - Login: password first; with 2FA on, the server answers with a short-lived ticket instead of a session and the
 *   session only starts after a valid code (or a recovery code). 5 tries per ticket, 5 minutes.
 * - The secret is stored encrypted (AES-256-GCM; key from TWOFA_KEY, else GOOGLE_TOKEN_KEY, else a random key kept
 *   in the database). A code can be used only once (replay protection), recovery codes only as salted hashes.
 */

const crypto = require('node:crypto');
const qrcode = require('./vendor/qrcode-generator');

const ISSUER = 'StayOnTrack';
const STEP = 30;
const TICKET_MS = 5 * 60 * 1000;
const TICKET_TRIES = 5;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 6-digit code for a time step. */
function totp(secretB32, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secretB32)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, '0');
}
const counterAt = (ms) => Math.floor(ms / 1000 / STEP);
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The time step a code belongs to (now ± 1 step for clock drift), only if newer than `last`; else null. */
function checkCode(secretB32, code, last, now = Date.now()) {
  const c = String(code || '').replace(/\D/g, '');
  if (c.length !== 6) return null;
  const at = counterAt(now);
  for (const step of [at, at - 1, at + 1]) {
    if (step > (last ?? -1) && same(totp(secretB32, step), c)) return step;
  }
  return null;
}

function createTwoFactor({ db, env = process.env }) {
  // encryption key for the stored secrets
  let key;
  if (env.TWOFA_KEY || env.GOOGLE_TOKEN_KEY) {
    key = crypto.createHash('sha256').update(`stayontrack-2fa:${env.TWOFA_KEY || env.GOOGLE_TOKEN_KEY}`).digest();
  } else {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'twofa_key'").get();
    if (row) key = Buffer.from(row.value, 'base64');
    else {
      key = crypto.randomBytes(32);
      db.prepare("INSERT INTO settings (key, value) VALUES ('twofa_key', ?)").run(key.toString('base64'));
    }
  }
  const seal = (plain) => {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return `v1:${iv.toString('base64url')}:${c.getAuthTag().toString('base64url')}:${enc.toString('base64url')}`;
  };
  const open = (sealed) => {
    const [v, iv, tag, enc] = String(sealed || '').split(':');
    if (v !== 'v1') return null;
    try {
      const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      d.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([d.update(Buffer.from(enc, 'base64url')), d.final()]).toString('utf8');
    } catch {
      return null;
    }
  };
  const hashRecovery = (code, salt) => crypto.scryptSync(code.replace(/[^a-z0-9]/gi, '').toLowerCase(), salt, 32).toString('hex');

  const q = {
    get: db.prepare('SELECT id, username, totp_secret, totp_pending, totp_enabled_at, totp_last_counter, recovery_codes FROM users WHERE id = ?'),
    pending: db.prepare('UPDATE users SET totp_pending = ? WHERE id = ?'),
    enable: db.prepare("UPDATE users SET totp_secret = ?, totp_pending = NULL, totp_enabled_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), totp_last_counter = ?, recovery_codes = ? WHERE id = ?"),
    disable: db.prepare('UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_enabled_at = NULL, totp_last_counter = NULL, recovery_codes = NULL WHERE id = ?'),
    used: db.prepare('UPDATE users SET totp_last_counter = ? WHERE id = ?'),
    recovery: db.prepare('UPDATE users SET recovery_codes = ? WHERE id = ?'),
  };

  function newRecoveryCodes() {
    const salt = crypto.randomBytes(16).toString('hex');
    const codes = Array.from({ length: 10 }, () => {
      const raw = base32Encode(crypto.randomBytes(5)).toLowerCase().slice(0, 8);
      return `${raw.slice(0, 4)}-${raw.slice(4)}`;
    });
    return { codes, stored: JSON.stringify({ salt, hashes: codes.map((c) => hashRecovery(c, salt)) }) };
  }

  function status(userId) {
    const u = q.get.get(userId);
    if (!u || !u.totp_enabled_at) return { enabled: false };
    let left = 0;
    try {
      left = JSON.parse(u.recovery_codes || '{}').hashes.filter(Boolean).length;
    } catch { /* none */ }
    return { enabled: true, enabledAt: u.totp_enabled_at, recoveryLeft: left };
  }
  const isEnabled = (userId) => Boolean((q.get.get(userId) || {}).totp_enabled_at);

  /** Start setup: a new secret (not active until confirmed) with its QR code. */
  function begin(user) {
    const secret = base32Encode(crypto.randomBytes(20));
    q.pending.run(seal(secret), user.id);
    const label = `${encodeURIComponent(ISSUER)}:${encodeURIComponent(user.username)}`;
    const otpauth = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=6&period=${STEP}`;
    const qr = qrcode(0, 'M');
    qr.addData(otpauth);
    qr.make();
    return { secret: secret.replace(/(.{4})/g, '$1 ').trim(), otpauth, qr: qr.createDataURL(5, 2) };
  }

  /** Confirm setup with the first code; returns the recovery codes (shown once) or null. */
  function confirm(userId, code) {
    const u = q.get.get(userId);
    const secret = u && open(u.totp_pending);
    if (!secret) return null;
    const step = checkCode(secret, code, -1);
    if (step === null) return null;
    const { codes, stored } = newRecoveryCodes();
    q.enable.run(seal(secret), step, stored, userId);
    return codes;
  }

  /** A login/confirmation code: authenticator code or one of the recovery codes. Returns 'totp' | 'recovery' | null. */
  function verify(userId, code) {
    const u = q.get.get(userId);
    if (!u || !u.totp_enabled_at) return null;
    const secret = open(u.totp_secret);
    const digits = String(code || '').replace(/\D/g, '');
    if (secret && digits.length === 6 && /^\s*[\d\s]+\s*$/.test(String(code))) {
      const step = checkCode(secret, digits, u.totp_last_counter);
      if (step !== null) {
        q.used.run(step, userId);
        return 'totp';
      }
      return null;
    }
    // recovery code (8 letters/digits, e.g. "ab12-cd34")
    let rec;
    try {
      rec = JSON.parse(u.recovery_codes || '{}');
    } catch {
      return null;
    }
    if (!rec.salt || !Array.isArray(rec.hashes)) return null;
    const h = hashRecovery(String(code || ''), rec.salt);
    const i = rec.hashes.findIndex((x) => x && same(x, h));
    if (i === -1) return null;
    rec.hashes[i] = null; // one-time
    q.recovery.run(JSON.stringify(rec), userId);
    return 'recovery';
  }

  function regenerate(userId) {
    const { codes, stored } = newRecoveryCodes();
    q.recovery.run(stored, userId);
    return codes;
  }
  const disable = (userId) => q.disable.run(userId);

  // ---- login tickets: password was right, the code is still missing ----
  const tickets = new Map(); // sha256(ticket) -> { userId, exp, tries, keys }
  const h256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
  function ticketFor(userId, keys) {
    const now = Date.now();
    for (const [k, t] of tickets) if (t.exp < now) tickets.delete(k);
    const ticket = crypto.randomBytes(32).toString('base64url');
    tickets.set(h256(ticket), { userId, exp: now + TICKET_MS, tries: 0, keys });
    return ticket;
  }
  /** { userId } when the code fits; { error } otherwise. The ticket dies after success or too many tries. */
  function redeem(ticket, code) {
    const k = h256(ticket);
    const t = tickets.get(k);
    if (!t || t.exp < Date.now()) {
      tickets.delete(k);
      return { error: 'expired' };
    }
    const how = verify(t.userId, code);
    if (how) {
      tickets.delete(k);
      return { userId: t.userId, how, keys: t.keys };
    }
    t.tries += 1;
    if (t.tries >= TICKET_TRIES) tickets.delete(k);
    return { error: 'wrong', left: TICKET_TRIES - t.tries, keys: t.keys };
  }

  return { status, isEnabled, begin, confirm, verify, regenerate, disable, ticketFor, redeem };
}

module.exports = { createTwoFactor, totp, checkCode, base32Encode, base32Decode };
