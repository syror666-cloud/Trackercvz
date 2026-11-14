'use strict';

/**
 * Head2Head: two clients challenge each other in one discipline for 1, 2 or 4 weeks and compare progress.
 *
 * Privacy: only clients who switched Head2Head on can see each other (name and picture), and a duel shows
 * nothing but the chosen discipline within its own time window. Weight is compared as a percentage of the
 * starting weight, never in kilograms.
 */

const METRICS = {
  steps: { label: 'Schritte', unit: 'Schritte', decimals: 0, hint: 'Wer geht mehr Schritte?' },
  training: { label: 'Trainingstage', unit: 'Tage', decimals: 0, hint: 'Wer trainiert an mehr Tagen?' },
  volume: { label: 'Bewegtes Gewicht', unit: 't', decimals: 1, hint: 'Gewicht × Wiederholungen aus dem Trainingsplan' },
  consistency: { label: 'Dranbleiben', unit: 'Tage', decimals: 0, hint: 'Wer trägt an mehr Tagen etwas ein?' },
  weight_loss: { label: 'Gewicht verlieren', unit: '%', decimals: 1, hint: 'Prozent vom Startgewicht – Kilos sieht niemand' },
  sleep: { label: 'Schlafziel', unit: 'Nächte', decimals: 0, hint: 'Nächte, in denen du dein Schlafziel erreichst' },
  calories: { label: 'Kalorienziel', unit: 'Tage', decimals: 0, hint: 'Tage, an denen du im Kalorienziel bleibst' },
};
const DURATIONS = [7, 14, 28];
const PENDING_DAYS = 7; // an unanswered challenge expires
const MAX_OPEN = 5;
const GRACE_DAYS = 1; // the last day can still be logged the next day; then the result is final

const dayNum = (s) => Math.round(Date.parse(`${s}T00:00:00Z`) / 864e5);
const dayStr = (n) => new Date(n * 864e5).toISOString().slice(0, 10);

function h2hRoutes({ db, notifier, HttpError, readBody, textField, requireUser, targetClient, localDate, publicUser, achievements }) {
  const q = {
    user: db.prepare('SELECT * FROM users WHERE id = ?'),
    players: db.prepare("SELECT * FROM users WHERE role = 'client' AND h2h_visible = 1 AND id <> ? ORDER BY display_name COLLATE NOCASE"),
    setVisible: db.prepare('UPDATE users SET h2h_visible = ? WHERE id = ?'),
    mine: db.prepare('SELECT * FROM h2h_challenges WHERE challenger_id = ? OR opponent_id = ? ORDER BY id DESC LIMIT 100'),
    one: db.prepare('SELECT * FROM h2h_challenges WHERE id = ?'),
    openPair: db.prepare(`SELECT 1 FROM h2h_challenges WHERE ((challenger_id = ? AND opponent_id = ?) OR (challenger_id = ? AND opponent_id = ?))
      AND (status = 'pending' AND created_at > ? OR status = 'active' AND end_date >= ?)`),
    openOut: db.prepare("SELECT COUNT(*) AS n FROM h2h_challenges WHERE challenger_id = ? AND status = 'pending' AND created_at > ?"),
    insert: db.prepare('INSERT INTO h2h_challenges (challenger_id, opponent_id, metric, days, message) VALUES (?, ?, ?, ?, ?)'),
    accept: db.prepare("UPDATE h2h_challenges SET status = 'active', start_date = ?, end_date = ?, responded_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?"),
    setStatus: db.prepare("UPDATE h2h_challenges SET status = ?, responded_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?"),
    cancelPendingOf: db.prepare("UPDATE h2h_challenges SET status = 'cancelled' WHERE status = 'pending' AND (challenger_id = ? OR opponent_id = ?)"),
    toFreeze: db.prepare("SELECT * FROM h2h_challenges WHERE status = 'active' AND end_date < ? AND frozen_at IS NULL"),
    freeze: db.prepare(`UPDATE h2h_challenges SET final_challenger = ?, final_opponent = ?, winner_id = ?, ended_notified = 1,
      frozen_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ? AND frozen_at IS NULL`),
    // data for the disciplines
    entries: db.prepare('SELECT * FROM entries WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date'),
    weightBefore: db.prepare('SELECT weight FROM entries WHERE user_id = ? AND weight IS NOT NULL AND date < ? AND date >= ? ORDER BY date DESC LIMIT 1'),
    goals: db.prepare('SELECT * FROM goals WHERE user_id = ?'),
    workouts: db.prepare(`SELECT w.date, SUM(COALESCE(s.weight, 0) * COALESCE(s.reps, 0)) AS volume FROM workouts w
      LEFT JOIN workout_sets s ON s.workout_id = w.id WHERE w.client_id = ? AND w.date BETWEEN ? AND ? GROUP BY w.date`),
  };
  const today = () => localDate(Date.now(), notifier.timezone);
  const pendingCutoff = () => new Date(Date.now() - PENDING_DAYS * 864e5).toISOString().replace(/\.\d+Z$/, 'Z');

  /** Day-by-day standing of one player: cumulative count/sum, or the current weight change in %. */
  function series(userId, metric, start, end) {
    const last = end < today() ? end : today();
    if (last < start) return [];
    const byDate = new Map(q.entries.all(userId, start, last).map((e) => [e.date, e]));
    const g = q.goals.get(userId) || {};
    const work = metric === 'training' || metric === 'volume' ? new Map(q.workouts.all(userId, start, last).map((w) => [w.date, w.volume])) : null;
    const out = [];
    let acc = 0;
    let base = null;
    let cur = null;
    if (metric === 'weight_loss') {
      const before = q.weightBefore.get(userId, start, dayStr(dayNum(start) - 14));
      base = before ? before.weight : null;
    }
    for (let d = dayNum(start); d <= dayNum(last); d++) {
      const date = dayStr(d);
      const e = byDate.get(date);
      switch (metric) {
        case 'steps': acc += (e && e.steps) || 0; break;
        case 'consistency': acc += e ? 1 : 0; break;
        case 'training': acc += (e && e.training === 1) || (work && work.has(date)) ? 1 : 0; break;
        case 'volume': acc += work && work.has(date) ? work.get(date) / 1000 : 0; break;
        case 'sleep': acc += e && e.sleep !== null && e.sleep >= (g.sleep_goal || 7) ? 1 : 0; break;
        case 'calories': {
          const ok = e && (e.calories_ok === 1 || (e.calories !== null && g.calories_min && g.calories_max && e.calories >= g.calories_min && e.calories <= g.calories_max));
          acc += ok ? 1 : 0;
          break;
        }
        case 'weight_loss':
          if (e && e.weight !== null) {
            if (base === null) base = e.weight;
            cur = e.weight;
          }
          acc = base !== null && cur !== null ? ((base - cur) / base) * 100 : null;
          break;
        default: break;
      }
      const dec = METRICS[metric].decimals;
      out.push({ date, value: acc === null ? null : Math.round(acc * 10 ** dec) / 10 ** dec });
    }
    return out;
  }

  /** What other players see of someone: name, picture and the medals they put in their showcase. */
  const showcaseCache = new Map(); // userId → { at, list } – medals are evaluated at most every few seconds per person
  const showcaseFor = (id) => {
    if (!achievements) return [];
    const c = showcaseCache.get(id);
    if (c && Date.now() - c.at < 5000) return c.list;
    const list = achievements.showcaseOf(id).map(({ key, level, icon, title, text }) => ({ key, level, icon, title, text }));
    showcaseCache.set(id, { at: Date.now(), list });
    if (showcaseCache.size > 500) showcaseCache.delete(showcaseCache.keys().next().value);
    return list;
  };
  const player = (u) => {
    const p = publicUser(u);
    return { id: p.id, displayName: p.displayName, avatar: p.avatar, showcase: showcaseFor(u.id) };
  };

  function statusOf(c) {
    if (c.status === 'pending') return c.created_at <= pendingCutoff() ? 'expired' : 'pending';
    if (c.status === 'active') return c.end_date < today() ? 'finished' : 'running';
    return c.status;
  }

  /** A challenge from the point of view of one of its players (or of the coach looking at one client). */
  function view(c, viewerId, withSeries) {
    const meId = viewerId === c.opponent_id ? c.opponent_id : c.challenger_id;
    const themId = meId === c.challenger_id ? c.opponent_id : c.challenger_id;
    const status = statusOf(c);
    const out = {
      id: c.id, metric: c.metric, days: c.days, message: c.message, status,
      role: meId === c.challenger_id ? 'challenger' : 'opponent',
      startDate: c.start_date, endDate: c.end_date, createdAt: c.created_at,
      me: player(q.user.get(meId)), them: player(q.user.get(themId)),
    };
    if (status === 'running' || status === 'finished') {
      const a = series(meId, c.metric, c.start_date, c.end_date);
      const b = series(themId, c.metric, c.start_date, c.end_date);
      out.me.value = a.length ? a[a.length - 1].value : 0;
      out.them.value = b.length ? b[b.length - 1].value : 0;
      if (c.frozen_at) {
        // the final score, no longer changed by corrected entries
        out.me.value = meId === c.challenger_id ? c.final_challenger : c.final_opponent;
        out.them.value = meId === c.challenger_id ? c.final_opponent : c.final_challenger;
      }
      const mv = out.me.value ?? -Infinity;
      const tv = out.them.value ?? -Infinity;
      out.leader = mv === tv ? 'tie' : mv > tv ? 'me' : 'them';
      if (status === 'finished') {
        out.result = out.leader === 'tie' ? 'draw' : out.leader === 'me' ? 'won' : 'lost';
        out.final = Boolean(c.frozen_at);
        out.token = out.final && out.result === 'won';
      }
      out.dayOf = Math.min(c.days, dayNum(today()) - dayNum(c.start_date) + 1);
      if (withSeries) out.series = { me: a, them: b };
    }
    return out;
  }

  function record(userId) {
    notifyEnded();
    const r = { won: 0, lost: 0, draw: 0 };
    for (const c of q.mine.all(userId, userId)) {
      if (statusOf(c) !== 'finished') continue;
      r[view(c, userId).result] += 1;
    }
    return r;
  }

  /**
   * One day after a duel ends its score is written down for good: the winner gets 1 token for the shop,
   * and both players get a push with the result. Checked regularly and on every visit.
   */
  function notifyEnded() {
    const cutoff = dayStr(dayNum(today()) - GRACE_DAYS);
    for (const c of q.toFreeze.all(cutoff)) {
      const v = view(c, c.challenger_id);
      const winner = v.leader === 'me' ? c.challenger_id : v.leader === 'them' ? c.opponent_id : null;
      if (!q.freeze.run(v.me.value, v.them.value, winner, c.id).changes) continue;
      for (const uid of [c.challenger_id, c.opponent_id]) {
        const w = view(q.one.get(c.id), uid);
        const title = w.result === 'won' ? '🏆 Head2Head gewonnen – +1 Token!' : w.result === 'draw' ? '🤝 Head2Head unentschieden' : '⚔️ Head2Head vorbei';
        notifier.sendToUsers([uid], {
          title,
          body: `${METRICS[c.metric].label} gegen ${w.them.displayName}: ${w.me.value ?? '–'} zu ${w.them.value ?? '–'}`,
          url: `/#/account/h2h/${c.id}`,
        }).catch(() => {});
      }
    }
  }
  setInterval(() => {
    try {
      notifyEnded();
    } catch { /* next round */ }
  }, 15 * 60 * 1000).unref();

  function requireClient(ctx) {
    const u = requireUser(ctx);
    if (u.role !== 'client') throw new HttpError(403, 'Head2Head ist für Klienten');
    return u;
  }
  function ownChallenge(u, id) {
    const c = q.one.get(Number(id));
    if (!c || (c.challenger_id !== u.id && c.opponent_id !== u.id)) throw new HttpError(404, 'Herausforderung nicht gefunden');
    return c;
  }
  const push = (uid, payload) => notifier.sendToUsers([uid], payload).catch(() => {});

  return [
    ['GET', /^\/api\/h2h$/, async (ctx) => {
      notifyEnded();
      const u = targetClient(ctx); // a client sees their own; the coach any client's (read-only)
      const fresh = q.user.get(u.id);
      return {
        visible: Boolean(fresh.h2h_visible),
        metrics: METRICS,
        durations: DURATIONS,
        players: fresh.h2h_visible && ctx.user.role === 'client' ? q.players.all(u.id).map((p) => ({ ...player(p), record: record(p.id) })) : [],
        record: record(u.id),
        challenges: q.mine.all(u.id, u.id).map((c) => view(c, u.id, false)),
      };
    }],

    ['GET', /^\/api\/h2h\/(\d+)$/, async (ctx, [, id]) => {
      const u = ctx.user && ctx.user.role === 'coach' ? targetClient(ctx) : requireClient(ctx);
      const c = ownChallenge(u, id);
      return { challenge: view(c, u.id, true), metrics: METRICS };
    }],

    ['PUT', /^\/api\/h2h\/visible$/, async (ctx) => {
      const u = requireClient(ctx);
      const { visible } = await readBody(ctx.req);
      if (typeof visible !== 'boolean') throw new HttpError(400, 'Sichtbarkeit: ja oder nein');
      q.setVisible.run(visible ? 1 : 0, u.id);
      if (!visible) q.cancelPendingOf.run(u.id, u.id); // open challenges go away; running duels finish normally
      return { visible };
    }],

    ['POST', /^\/api\/h2h$/, async (ctx) => {
      const u = requireClient(ctx);
      if (!u.h2h_visible) throw new HttpError(409, 'Schalte Head2Head zuerst für dich ein');
      const b = await readBody(ctx.req);
      const opp = q.user.get(Number(b.opponentId));
      if (!opp || opp.role !== 'client' || opp.id === u.id || !opp.h2h_visible) throw new HttpError(404, 'Gegner nicht gefunden');
      if (!METRICS[b.metric]) throw new HttpError(400, 'Unbekannte Disziplin');
      if (!DURATIONS.includes(Number(b.days))) throw new HttpError(400, 'Dauer: 1, 2 oder 4 Wochen');
      const message = textField(b.message, { name: 'Nachricht', max: 140 }) ?? null;
      const cutoff = pendingCutoff();
      if (q.openPair.get(u.id, opp.id, opp.id, u.id, cutoff, today())) throw new HttpError(409, `Mit ${opp.display_name} läuft schon eine Herausforderung`);
      if (q.openOut.get(u.id, cutoff).n >= MAX_OPEN) throw new HttpError(409, `Höchstens ${MAX_OPEN} offene Herausforderungen gleichzeitig`);
      const id = Number(q.insert.run(u.id, opp.id, b.metric, Number(b.days), message).lastInsertRowid);
      push(opp.id, {
        title: '⚔️ Head2Head-Herausforderung',
        body: `${u.display_name} fordert dich heraus: ${METRICS[b.metric].label}, ${Number(b.days) / 7} ${Number(b.days) === 7 ? 'Woche' : 'Wochen'}`,
        url: `/#/account/h2h/${id}`,
      });
      ctx.res.statusCode = 201;
      return { challenge: view(q.one.get(id), u.id, false) };
    }],

    ['POST', /^\/api\/h2h\/(\d+)\/(accept|decline|cancel)$/, async (ctx, [, id, action]) => {
      const u = requireClient(ctx);
      const c = ownChallenge(u, id);
      if (statusOf(c) !== 'pending') throw new HttpError(409, 'Diese Herausforderung ist nicht mehr offen');
      if (action === 'cancel') {
        if (c.challenger_id !== u.id) throw new HttpError(403, 'Nur wer herausfordert, kann zurückziehen');
        q.setStatus.run('cancelled', c.id);
      } else {
        if (c.opponent_id !== u.id) throw new HttpError(403, 'Nur die herausgeforderte Person kann antworten');
        if (action === 'accept') {
          if (!u.h2h_visible) throw new HttpError(409, 'Schalte Head2Head zuerst für dich ein');
          const start = today();
          q.accept.run(start, dayStr(dayNum(start) + c.days - 1), c.id);
          push(c.challenger_id, { title: '⚔️ Herausforderung angenommen', body: `${u.display_name} nimmt an: ${METRICS[c.metric].label} – los geht's ab heute!`, url: `/#/account/h2h/${c.id}` });
        } else {
          q.setStatus.run('declined', c.id);
          push(c.challenger_id, { title: 'Head2Head', body: `${u.display_name} hat diesmal abgelehnt.`, url: '/#/account/h2h' });
        }
      }
      return { challenge: view(q.one.get(c.id), u.id, true) };
    }],
  ];
}

module.exports = { h2hRoutes, METRICS, DURATIONS };
