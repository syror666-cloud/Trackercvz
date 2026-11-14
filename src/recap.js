'use strict';

/**
 * Monthly recap ("Wrapped"): the numbers of one month as a story – workouts, weight moved, favourite exercise,
 * personal bests, steps, sleep, weight, consistency, and a fun "type". Computed on request from the stored data.
 *
 *  GET /api/recap/months           months that have data (newest first)
 *  GET /api/recap?month=YYYY-MM    the recap of that month (also the running month, marked `partial`)
 * Coaches add ?userId= to see a client's recap.
 */

const DAY = 864e5;
const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r1 = (v) => (v === null || v === undefined ? null : Math.round(v * 10) / 10);
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

function monthBounds(month) {
  const [y, m] = month.split('-').map(Number);
  const from = `${month}-01`;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from, to: `${month}-${String(days).padStart(2, '0')}`, days, y, m };
}
const prevMonth = (month) => {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

function longestStreak(dates) {
  let best = 0;
  let cur = 0;
  let prev = null;
  for (const d of dates) {
    cur = prev && addDays(prev, 1) === d ? cur + 1 : 1;
    best = Math.max(best, cur);
    prev = d;
  }
  return best;
}

function recapRoutes({ db, HttpError, targetClient, localDate, notifier }) {
  const q = {
    workouts: db.prepare('SELECT id, date, day_name, duration_min, created_at FROM workouts WHERE client_id = ? AND date BETWEEN ? AND ? ORDER BY date'),
    sets: db.prepare(`SELECT s.exercise_key, s.exercise_name, s.weight, s.reps, w.date FROM workout_sets s JOIN workouts w ON w.id = s.workout_id
      WHERE w.client_id = ? AND w.date BETWEEN ? AND ?`),
    bestBefore: db.prepare(`SELECT s.exercise_key, MAX(s.weight) AS best FROM workout_sets s JOIN workouts w ON w.id = s.workout_id
      WHERE w.client_id = ? AND w.date < ? AND s.weight IS NOT NULL GROUP BY s.exercise_key`),
    entries: db.prepare('SELECT date, weight, steps, sleep, calories_ok FROM entries WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date'),
    months: db.prepare(`SELECT m FROM (
        SELECT substr(date, 1, 7) AS m FROM entries WHERE user_id = ?
        UNION SELECT substr(date, 1, 7) FROM workouts WHERE client_id = ?
      ) ORDER BY m DESC LIMIT 24`),
    goals: db.prepare('SELECT steps_goal, sleep_goal, target_weight FROM goals WHERE user_id = ?'),
    h2hWins: db.prepare("SELECT COUNT(*) AS n FROM h2h_challenges WHERE winner_id = ? AND substr(COALESCE(frozen_at, ''), 1, 7) = ?"),
  };

  function volumeOf(sets) {
    return sets.reduce((a, s) => a + (s.weight !== null && s.reps !== null ? s.weight * s.reps : 0), 0);
  }

  function trainingStats(clientId, from, to) {
    const workouts = q.workouts.all(clientId, from, to);
    const sets = q.sets.all(clientId, from, to);
    return { workouts, sets, volume: Math.round(volumeOf(sets)) };
  }

  function recap(client, month, today) {
    const { from, to, days, y, m } = monthBounds(month);
    const partial = today >= from && today <= to;
    const until = partial ? today : to;
    const { workouts, sets, volume } = trainingStats(client.id, from, until);
    const prev = monthBounds(prevMonth(month));
    const before = trainingStats(client.id, prev.from, prev.to);

    // favourite exercise (most sets) and heaviest lift
    const byEx = new Map();
    for (const s of sets) {
      const e = byEx.get(s.exercise_key) || { name: s.exercise_name, sets: 0, volume: 0, top: null };
      e.sets++;
      if (s.weight !== null && s.reps !== null) e.volume += s.weight * s.reps;
      if (s.weight !== null && (e.top === null || s.weight > e.top)) e.top = s.weight;
      byEx.set(s.exercise_key, e);
    }
    const exList = [...byEx.entries()].map(([key, e]) => ({ key, ...e }));
    const favourite = exList.sort((a, b) => b.sets - a.sets || b.volume - a.volume)[0] || null;
    const heaviest = [...exList].filter((e) => e.top !== null).sort((a, b) => b.top - a.top)[0] || null;

    // personal bests: this month's top weight beats everything before the month
    const best = new Map(q.bestBefore.all(client.id, from).map((r) => [r.exercise_key, r.best]));
    const prs = exList.filter((e) => e.top !== null && best.has(e.key) && e.top > best.get(e.key))
      .map((e) => ({ name: e.name, weight: e.top, previous: best.get(e.key), gain: r1(e.top - best.get(e.key)) }))
      .sort((a, b) => b.gain - a.gain);

    // when they train
    const dayCount = new Array(7).fill(0);
    for (const w of workouts) dayCount[new Date(`${w.date}T12:00:00Z`).getUTCDay()]++;
    const favDay = workouts.length ? dayCount.indexOf(Math.max(...dayCount)) : null;
    const hours = workouts.map((w) => Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: notifier.timezone })
      .formatToParts(new Date(w.created_at)).find((p) => p.type === 'hour').value));
    const minutes = workouts.reduce((a, w) => a + (w.duration_min || 0), 0);

    // daily entries
    const entries = q.entries.all(client.id, from, until);
    const steps = entries.filter((e) => e.steps !== null);
    const sleep = entries.filter((e) => e.sleep !== null);
    const weights = entries.filter((e) => e.weight !== null);
    const goals = q.goals.get(client.id) || {};
    const bestSteps = steps.reduce((b, e) => (!b || e.steps > b.steps ? e : b), null);
    const firstW = avg(weights.slice(0, Math.min(5, weights.length)).map((e) => e.weight));
    const lastW = avg(weights.slice(-Math.min(5, weights.length)).map((e) => e.weight));
    const loggedDates = entries.map((e) => e.date);
    const activeDates = [...new Set([...loggedDates, ...workouts.map((w) => w.date)])].sort();
    const calAnswered = entries.filter((e) => e.calories_ok === 0 || e.calories_ok === 1);

    const stats = {
      month, monthName: MONTHS[m - 1], year: y, partial, daysInMonth: days, daysSoFar: partial ? Number(today.slice(8, 10)) : days,
      training: {
        workouts: workouts.length,
        minutes,
        volume,
        sets: sets.length,
        reps: sets.reduce((a, s) => a + (s.reps || 0), 0),
        prevWorkouts: before.workouts.length,
        prevVolume: before.volume,
        favourite: favourite ? { name: favourite.name, sets: favourite.sets, volume: Math.round(favourite.volume) } : null,
        heaviest: heaviest ? { name: heaviest.name, weight: heaviest.top } : null,
        prs: prs.slice(0, 5),
        prCount: prs.length,
        favDay: favDay === null ? null : WEEKDAYS[favDay],
        early: hours.filter((h) => h < 9).length,
        late: hours.filter((h) => h >= 20).length,
      },
      steps: steps.length ? {
        total: steps.reduce((a, e) => a + e.steps, 0),
        avg: Math.round(avg(steps.map((e) => e.steps))),
        best: { date: bestSteps.date, steps: bestSteps.steps },
        goalDays: goals.steps_goal ? steps.filter((e) => e.steps >= goals.steps_goal).length : null,
        goal: goals.steps_goal || null,
      } : null,
      sleep: sleep.length ? { avg: r1(avg(sleep.map((e) => e.sleep))), nights: sleep.length, goal: goals.sleep_goal || null } : null,
      weight: weights.length >= 2 ? { start: r1(firstW), end: r1(lastW), change: r1(lastW - firstW), target: goals.target_weight ?? null } : null,
      consistency: {
        daysLogged: loggedDates.length,
        activeDays: activeDates.length,
        streak: longestStreak(activeDates),
        caloriesKept: calAnswered.length ? calAnswered.filter((e) => e.calories_ok === 1).length : null,
        caloriesAnswered: calAnswered.length,
      },
      h2hWins: q.h2hWins.get(client.id, month).n,
    };
    stats.persona = persona(stats);
    stats.hasData = Boolean(workouts.length || entries.length);
    return stats;
  }

  /** A fun "type" for the month – the strongest signal wins. */
  function persona(s) {
    const t = s.training;
    const daysSoFar = s.daysSoFar;
    const list = [];
    if (t.prCount >= 3) list.push([5, '🚀', 'Der Rekordjäger', `${t.prCount} neue Bestleistungen in einem Monat.`]);
    if (t.workouts >= Math.max(4, daysSoFar * 0.4)) list.push([4.5, '🤖', 'Die Maschine', `${t.workouts} Trainings – fast jeden zweiten Tag.`]);
    if (t.workouts >= 3 && t.early >= t.workouts * 0.6) list.push([4, '🐓', 'Der Frühaufsteher', 'Die meisten Trainings vor 9 Uhr erledigt.']);
    if (t.workouts >= 3 && t.late >= t.workouts * 0.6) list.push([4, '🦉', 'Die Nachteule', 'Am liebsten nach 20 Uhr unter der Hantel.']);
    if (s.steps && s.steps.avg >= 10000) list.push([3.5, '👟', 'Der Dauerläufer', `Im Schnitt ${s.steps.avg.toLocaleString('de-DE')} Schritte am Tag.`]);
    if (s.consistency.streak >= 14) list.push([3.5, '🔥', 'Die Konstante', `${s.consistency.streak} Tage am Stück dabei.`]);
    if (s.sleep && s.sleep.avg >= 7.5) list.push([3, '😴', 'Der Regenerationsprofi', `Im Schnitt ${String(s.sleep.avg).replace('.', ',')} Stunden Schlaf.`]);
    if (t.volume >= 50000) list.push([3, '🏗️', 'Der Schwerlastkran', 'So viel Gewicht bewegt wie ein Kran.']);
    if (!list.length) list.push([1, '🌱', 'Der Durchstarter', 'Jeder Monat ist ein neuer Anfang – weiter so!']);
    const [, emoji, title, text] = list.sort((a, b) => b[0] - a[0])[0];
    return { emoji, title, text };
  }

  return [
    ['GET', /^\/api\/recap\/months$/, async (ctx) => {
      const c = targetClient(ctx);
      return { months: q.months.all(c.id, c.id).map((r) => r.m) };
    }],
    ['GET', /^\/api\/recap$/, async (ctx) => {
      const c = targetClient(ctx);
      const today = localDate(Date.now(), notifier.timezone);
      let month = ctx.url.searchParams.get('month');
      if (!month) month = prevMonth(today.slice(0, 7));
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month > today.slice(0, 7)) throw new HttpError(400, 'Ungültiger Monat');
      return recap(c, month, today);
    }],
  ];
}

module.exports = { recapRoutes, longestStreak };
