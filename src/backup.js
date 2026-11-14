'use strict';

/**
 * Automatic backups of the database.
 *
 * - Once a day (BACKUP_HOUR, default 3 o'clock in the app's time zone) and on demand from the admin tool.
 * - A consistent copy via `VACUUM INTO` (safe while the app is running), gzip-compressed.
 * - Encrypted with AES-256-GCM when BACKUP_KEY is set (key derived with scrypt); the file starts with "SOTBK1".
 * - Kept in DATA_DIR/backups for 14 days (protects against mistakes and a damaged database).
 * - Sent by e-mail to BACKUP_EMAIL as an attachment – only encrypted, health data never travels in the clear.
 *   That copy lives outside the server, so it survives even if the disk is lost.
 * Restore: `node scripts/restore-backup.js <file> <target.db>` with the same BACKUP_KEY.
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const MAGIC = Buffer.from('SOTBK1');
const KEEP_DAYS = 14;
const MAX_MAIL_BYTES = 30 * 1024 * 1024; // e-mail providers take ~40 MB in total

function deriveKey(secret, salt) {
  return crypto.scryptSync(String(secret), salt, 32);
}

function encrypt(buf, secret) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', deriveKey(secret, salt), iv);
  const enc = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), enc]);
}

function decrypt(buf, secret) {
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Keine verschlüsselte StayOnTrack-Sicherung');
  let o = MAGIC.length;
  const salt = buf.subarray(o, (o += 16));
  const iv = buf.subarray(o, (o += 12));
  const tag = buf.subarray(o, (o += 16));
  const d = crypto.createDecipheriv('aes-256-gcm', deriveKey(secret, salt), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(buf.subarray(o)), d.final()]);
}

/** Backup file → plain SQLite bytes (decrypts when needed, then gunzips). */
function unpack(buf, secret) {
  const gz = buf.subarray(0, MAGIC.length).equals(MAGIC) ? decrypt(buf, secret) : buf;
  return zlib.gunzipSync(gz);
}

function createBackups({ db, dataDir, mailer, localDate, timezone, env = process.env, log = console, now = () => Date.now() }) {
  const dir = path.join(dataDir, 'backups');
  const key = env.BACKUP_KEY || '';
  const to = (env.BACKUP_EMAIL || '').trim();
  const hour = Number.isInteger(Number(env.BACKUP_HOUR)) ? Number(env.BACKUP_HOUR) : 3;
  const q = {
    get: db.prepare('SELECT value FROM settings WHERE key = ?'),
    set: db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
  };
  const state = () => {
    try {
      return JSON.parse((q.get.get('backup_state') || {}).value || '{}');
    } catch {
      return {};
    }
  };

  function files() {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => /^stayontrack-.*\.db\.gz(\.enc)?$/.test(f)).sort().reverse()
      .map((f) => ({ name: f, size: fs.statSync(path.join(dir, f)).size }));
  }

  /** Age from the time stamp in the file name (stayontrack-2026-11-14T02-05-00Z.db.gz…). */
  const madeAt = (name) => {
    const m = name.match(/^stayontrack-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z/);
    return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`) : NaN;
  };
  function prune() {
    const cutoff = now() - KEEP_DAYS * 864e5;
    for (const f of files()) {
      const t = madeAt(f.name);
      if (Number.isFinite(t) && t < cutoff) fs.rmSync(path.join(dir, f.name), { force: true });
    }
  }

  /** Makes a backup now; returns the status. */
  async function run(reason = 'manual') {
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date(now()).toISOString().replace(/[:]/g, '-').replace(/\.\d+Z$/, 'Z');
    const tmp = path.join(dir, `.tmp-${stamp}.db`);
    fs.rmSync(tmp, { force: true });
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    const raw = fs.readFileSync(tmp);
    fs.rmSync(tmp, { force: true });
    const gz = zlib.gzipSync(raw, { level: 9 });
    const out = key ? encrypt(gz, key) : gz;
    const name = `stayontrack-${stamp}.db.gz${key ? '.enc' : ''}`;
    fs.writeFileSync(path.join(dir, name), out, { mode: 0o600 });
    prune();

    let mailed = null;
    let mailError = null;
    if (to && key && mailer && mailer.enabled) {
      if (out.length > MAX_MAIL_BYTES) {
        mailError = `Sicherung zu groß für eine E-Mail (${Math.round(out.length / 1048576)} MB)`;
      } else {
        try {
          await mailer.send({
            to,
            subject: `StayOnTrack Sicherung ${new Date(now()).toISOString().slice(0, 10)}`,
            text: `Automatische Datensicherung von StayOnTrack (${reason === 'schedule' ? 'nächtlich' : 'manuell'}).\n\nDie angehängte Datei ist mit deinem BACKUP_KEY verschlüsselt. Wiederherstellen: node scripts/restore-backup.js ${name} tracker.db\n\nBewahre diese Mails auf – sie sind deine Sicherung außerhalb des Servers.`,
            html: `<p>Automatische Datensicherung von StayOnTrack (${reason === 'schedule' ? 'nächtlich' : 'manuell'}).</p><p>Die angehängte Datei ist mit deinem <code>BACKUP_KEY</code> verschlüsselt. Wiederherstellen:<br><code>node scripts/restore-backup.js ${name} tracker.db</code></p><p>Bewahre diese Mails auf – sie sind deine Sicherung außerhalb des Servers.</p>`,
            attachments: [{ filename: name, content: out, contentType: 'application/octet-stream' }],
          });
          mailed = to;
        } catch (err) {
          mailError = String(err.message).slice(0, 200);
        }
      }
    }
    const st = { at: new Date(now()).toISOString(), file: name, size: out.length, encrypted: Boolean(key), mailed, mailError, reason };
    q.set.run('backup_state', JSON.stringify(st));
    if (mailError) log.error('Sicherung: E-Mail fehlgeschlagen –', mailError);
    else log.log(`Sicherung erstellt: ${name} (${Math.round(out.length / 1024)} KB)${mailed ? `, an ${mailed} gesendet` : ''}`);
    return status();
  }

  function status() {
    const list = files();
    return {
      last: state(),
      local: list.length,
      localBytes: list.reduce((a, f) => a + f.size, 0),
      encrypted: Boolean(key),
      email: to || null,
      mailReady: Boolean(to && key && mailer && mailer.enabled),
      hour,
      keepDays: KEEP_DAYS,
    };
  }

  /** Called regularly: makes the daily backup once the backup hour has come. */
  async function tick() {
    const d = new Date(now());
    const today = localDate(now(), timezone);
    const localHour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: timezone })
      .formatToParts(d).find((p) => p.type === 'hour').value);
    const last = state().at ? localDate(Date.parse(state().at), timezone) : null;
    if (localHour >= hour && last !== today) return run('schedule');
    return null;
  }

  function latestPath() {
    const f = files()[0];
    return f ? path.join(dir, f.name) : null;
  }

  return { run, tick, status, latestPath };
}

module.exports = { createBackups, encrypt, decrypt, unpack };
