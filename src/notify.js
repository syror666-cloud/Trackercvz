'use strict';

const { generateVapidKeys, sendPush } = require('./push');
const { nextRecurringRun } = require('./schedule');

/**
 * Delivers push messages to users' registered devices and runs scheduled coach notifications.
 * options: { subject, timezone, fetchImpl }
 */
function createNotifier(db, { subject, timezone = 'Europe/Berlin', fetchImpl } = {}) {
  const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
  const setSetting = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
  );

  let keys = getSetting.get('vapid_keys');
  if (keys) {
    keys = JSON.parse(keys.value);
  } else {
    keys = generateVapidKeys();
    setSetting.run('vapid_keys', JSON.stringify(keys));
  }

  const q = {
    subsForUser: db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?'),
    deleteSub: db.prepare('DELETE FROM push_subscriptions WHERE id = ?'),
    markSuccess: db.prepare(
      "UPDATE push_subscriptions SET last_success_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?"
    ),
    consentingClients: db.prepare(
      `SELECT u.id FROM users u JOIN push_consent c ON c.user_id = u.id
       WHERE u.role = 'client' AND u.archived_at IS NULL AND c.status = 'granted'`
    ),
    consentOf: db.prepare('SELECT status FROM push_consent WHERE user_id = ?'),
    coaches: db.prepare("SELECT id FROM users WHERE role = 'coach'"),
    due: db.prepare('SELECT * FROM notifications WHERE active = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?'),
    byId: db.prepare('SELECT * FROM notifications WHERE id = ?'),
    afterRun: db.prepare(
      'UPDATE notifications SET last_sent_at = ?, last_result = ?, next_run_at = ?, active = ? WHERE id = ?'
    ),
  };

  function pushSubject() {
    if (subject) return subject;
    const stored = getSetting.get('push_subject');
    return stored ? stored.value : 'mailto:push@thabstracker.invalid';
  }

  function rememberOrigin(origin) {
    if (!subject && origin && origin.startsWith('https://') && !getSetting.get('push_subject')) {
      setSetting.run('push_subject', origin);
    }
  }

  /** Sends `payload` ({title, body, url}) to every device of the given users. */
  async function sendToUsers(userIds, payload) {
    const result = { devices: 0, delivered: 0, failed: 0 };
    for (const userId of new Set(userIds)) {
      for (const sub of q.subsForUser.all(userId)) {
        result.devices++;
        try {
          const status = await sendPush(sub, payload, { keys, subject: pushSubject(), fetchImpl });
          if (status >= 200 && status < 300) {
            result.delivered++;
            q.markSuccess.run(sub.id);
          } else {
            result.failed++;
            // 404/410: the browser dropped this subscription, so forget it.
            if (status === 404 || status === 410) q.deleteSub.run(sub.id);
          }
        } catch (err) {
          result.failed++;
          console.error('Push fehlgeschlagen:', err.message);
        }
      }
    }
    return result;
  }

  /** Clients a coach notification goes to: only those who agreed to push messages. */
  function recipientsOf(n) {
    if (n.audience === 'all') return q.consentingClients.all().map((r) => r.id);
    return JSON.parse(n.recipient_ids).filter((id) => {
      const c = q.consentOf.get(id);
      return c && c.status === 'granted';
    });
  }

  function describeResult(recipients, r) {
    if (!recipients.length) return 'Keine Empfänger mit Zustimmung';
    if (!r.devices) return `${recipients.length} Empfänger, aber keine aktiven Geräte`;
    return `An ${r.delivered} von ${r.devices} Geräten zugestellt`;
  }

  async function runNotification(n, now = Date.now()) {
    const recipients = recipientsOf(n);
    const r = await sendToUsers(recipients, { title: n.title, body: n.body, url: '/' });
    const recurring = n.schedule !== 'once';
    const next = recurring
      ? nextRecurringRun({ schedule: n.schedule, time: n.time, weekdays: JSON.parse(n.weekdays) }, now, timezone)
      : null;
    q.afterRun.run(now, describeResult(recipients, r), next, recurring ? n.active : 0, n.id);
    return r;
  }

  let running = false;
  async function runDue(now = Date.now()) {
    if (running) return;
    running = true;
    try {
      for (const n of q.due.all(now)) await runNotification(n, now);
    } finally {
      running = false;
    }
  }

  /** Sends now, without changing the schedule of recurring messages. */
  async function sendNow(id) {
    const n = q.byId.get(id);
    if (!n) return null;
    if (n.schedule === 'once') return runNotification(n);
    const recipients = recipientsOf(n);
    const r = await sendToUsers(recipients, { title: n.title, body: n.body, url: '/' });
    db.prepare('UPDATE notifications SET last_sent_at = ?, last_result = ? WHERE id = ?').run(
      Date.now(), describeResult(recipients, r), n.id
    );
    return r;
  }

  function coachIds() {
    return q.coaches.all().map((r) => r.id);
  }

  return { publicKey: keys.publicKey, timezone, sendToUsers, runDue, sendNow, rememberOrigin, coachIds };
}

module.exports = { createNotifier };
