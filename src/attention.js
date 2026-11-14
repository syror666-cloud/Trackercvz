'use strict';

/**
 * "Braucht Aufmerksamkeit": every client gets a score from simple, explainable signals; the coach sees who needs
 * them most, each with the reasons. Heavier signals: the client is going quiet or the weight moves away from the
 * goal; lighter ones: open requests, a check-in that is due.
 */

const DAY = 864e5;
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const hoursSince = (iso, now) => (now - Date.parse(iso)) / 3600000;
const de = (v, d = 1) => Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Returns list(today, now): every active client with score, level and reasons (also used by the Telegram bot). */
function createAttention(db) {
  const q = {
    clients: db.prepare("SELECT id, display_name, category, created_at, deletion_requested_at, archived_at, avatar IS NOT NULL AS has_avatar, avatar_updated FROM users WHERE role = 'client'"),
    entries: db.prepare('SELECT date, weight, steps, calories_ok FROM entries WHERE user_id = ? AND date >= ? ORDER BY date'),
    lastEntry: db.prepare('SELECT MAX(date) AS d FROM entries WHERE user_id = ?'),
    goals: db.prepare('SELECT target_weight, steps_goal FROM goals WHERE user_id = ?'),
    oldestUnread: db.prepare('SELECT MIN(created_at) AS t, COUNT(*) AS n FROM messages WHERE client_id = ? AND sender_id = ? AND read_at IS NULL'),
    swaps: db.prepare("SELECT MIN(created_at) AS t, COUNT(*) AS n FROM swap_requests WHERE client_id = ? AND status = 'open'"),
    planRequest: db.prepare("SELECT updated_at AS t FROM nutrition_requests WHERE client_id = ? AND status = 'open'"),
    lastCheckin: db.prepare('SELECT * FROM checkins WHERE client_id = ? ORDER BY id DESC LIMIT 1'),
  };

  function analyse(c, today, now) {
    const reasons = [];
    const add = (key, score, text, level) => reasons.push({ key, score, text, level: level || (score >= 3 ? 'high' : score >= 1.5 ? 'medium' : 'low') });
    const ageDays = daysBetween(String(c.created_at).slice(0, 10), today);
    const entries = q.entries.all(c.id, addDays(today, -27));
    const inRange = (from, to) => entries.filter((e) => e.date >= from && e.date <= to);
    const last7 = inRange(addDays(today, -6), today);
    const prev7 = inRange(addDays(today, -13), addDays(today, -7));
    const g = q.goals.get(c.id) || {};

    // 0. the client asked for their account to be deleted (GDPR: answer within a month)
    if (c.deletion_requested_at) {
      const d = Math.floor(hoursSince(c.deletion_requested_at, now) / 24);
      add('deletion', 6, `Möchte das Konto löschen lassen${d ? ` (seit ${d} ${d === 1 ? 'Tag' : 'Tagen'})` : ''}`, 'high');
    }

    // 1. going quiet
    const last = q.lastEntry.get(c.id).d;
    if (!last) {
      if (ageDays >= 2) add('never', 3, `Hat seit ${ageDays} Tagen noch nichts eingetragen`);
    } else {
      const quiet = daysBetween(last, today);
      if (quiet >= 3) add('quiet', Math.min(5, 1.5 + quiet / 2), `Seit ${quiet} Tagen kein Eintrag`);
      else if (prev7.length >= 5 && last7.length <= prev7.length - 3) add('fewer', 2, `Trägt weniger ein: ${last7.length} statt ${prev7.length} Tage`);
    }

    // 2. weight vs. goal (weekly averages)
    const wNow = avg(last7.filter((e) => e.weight !== null).map((e) => e.weight));
    const wPrev = avg(prev7.filter((e) => e.weight !== null).map((e) => e.weight));
    let dir = 0;
    if (g.target_weight !== null && g.target_weight !== undefined && wPrev !== null) dir = Math.sign(g.target_weight - wPrev);
    else if (c.category === 'diet') dir = -1;
    else if (c.category === 'build') dir = 1;
    if (dir && wNow !== null && wPrev !== null) {
      const pct = ((wNow - wPrev) / wPrev) * 100;
      if (Math.sign(pct) === -dir && Math.abs(pct) >= 0.5) {
        add('weight-wrong', 3, `Gewicht im Wochenschnitt ${pct > 0 ? '+' : '−'}${de(Math.abs(wNow - wPrev))} kg – entgegen dem Ziel`);
      } else {
        // stalled for three weeks although the goal is to change
        const w3 = avg(inRange(addDays(today, -20), addDays(today, -14)).filter((e) => e.weight !== null).map((e) => e.weight));
        if (w3 !== null && Math.abs(((wNow - w3) / w3) * 100) < 0.3 && Math.abs(pct) < 0.3) add('weight-stall', 1.5, 'Gewicht stagniert seit drei Wochen');
      }
    }

    // 3. steps clearly down
    const sNow = avg(last7.filter((e) => e.steps !== null).map((e) => e.steps));
    const sPrev = avg(prev7.filter((e) => e.steps !== null).map((e) => e.steps));
    if (sNow !== null && sPrev !== null && sPrev >= 3000 && sNow < sPrev * 0.7) {
      add('steps', 1, `Schritte ${Math.round((1 - sNow / sPrev) * 100)} % unter der Vorwoche`);
    }

    // 4. calories: plan rarely kept this week
    const answered = last7.filter((e) => e.calories_ok === 0 || e.calories_ok === 1);
    if (answered.length >= 4 && answered.filter((e) => e.calories_ok === 1).length <= Math.floor(answered.length / 3)) {
      add('calories', 1.5, `Kalorienziel nur an ${answered.filter((e) => e.calories_ok === 1).length} von ${answered.length} Tagen`);
    }

    // 5. waiting for the coach
    const m = q.oldestUnread.get(c.id, c.id);
    if (m.n && hoursSince(m.t, now) >= 12) add('messages', 2.5, `${m.n} ${m.n === 1 ? 'Nachricht wartet' : 'Nachrichten warten'} seit ${Math.round(hoursSince(m.t, now))} Std.`);
    const sw = q.swaps.get(c.id);
    if (sw.n && hoursSince(sw.t, now) >= 48) add('swaps', 1.5, `${sw.n} ${sw.n === 1 ? 'Tauschwunsch' : 'Tauschwünsche'} seit ${Math.floor(hoursSince(sw.t, now) / 24)} Tagen offen`);
    const pr = q.planRequest.get(c.id);
    if (pr && hoursSince(pr.t, now) >= 48) add('plan', 2, `Wartet seit ${Math.floor(hoursSince(pr.t, now) / 24)} Tagen auf einen Ernährungsplan`);

    // 6. check-in due / changes not accepted
    const ci = q.lastCheckin.get(c.id);
    if (ci) {
      const since = Math.floor(hoursSince(ci.created_at, now) / 24);
      if (since >= 9) add('checkin', 1, `Letzter Check-in vor ${since} Tagen`);
      let changes = {};
      try {
        changes = JSON.parse(ci.proposal || '{}');
      } catch { /* none */ }
      if (ci.status === 'open' && Object.keys(changes).length && since >= 3) add('accept', 1, `Planänderung seit ${since} Tagen nicht angenommen`);
    } else if (ageDays >= 9) {
      add('checkin', 1, 'Noch kein Check-in');
    }

    reasons.sort((a, b) => b.score - a.score);
    const score = Math.round(reasons.reduce((s, r) => s + r.score, 0) * 10) / 10;
    return {
      id: c.id, displayName: c.display_name,
      avatar: c.has_avatar ? `/api/avatar/${c.id}?v=${encodeURIComponent(c.avatar_updated || '1')}` : null,
      score, level: score >= 4 ? 'high' : score >= 2 ? 'medium' : score > 0 ? 'low' : 'ok', reasons,
    };
  }

  function list(today, now) {
      // archived clients (on a break) are left out – unless they asked for deletion
      const all = q.clients.all().filter((c) => !c.archived_at || c.deletion_requested_at).map((c) => analyse(c, today, now));
      const list = all.filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
      return { clients: list, fine: all.length - list.length, total: all.length, archived: q.clients.all().filter((c) => c.archived_at).length };
  }
  return { list };
}

function attentionRoutes({ db, requireCoach, localDate, notifier }) {
  const attention = createAttention(db);
  return [
    ['GET', /^\/api\/attention$/, async (ctx) => {
      requireCoach(ctx);
      const now = Date.now();
      return attention.list(localDate(now, notifier.timezone), now);
    }],
  ];
}

module.exports = { attentionRoutes, createAttention };
