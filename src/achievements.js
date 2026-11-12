'use strict';

// Hall of Fame: tiered achievements (bronze / silver / gold) computed from a client's data.
// To add one: append an entry to ACHIEVEMENTS. `series(data)` returns [{ date, value }] in date order,
// where value is the running total (or the streak on that day); a tier counts as reached on the first
// date whose value meets its goal.

const DAY = 86400000;
const dayNum = (s) => Math.round(Date.parse(`${s}T00:00:00Z`) / DAY);
const TIERS = ['bronze', 'silver', 'gold'];
const TOKENS = [1, 2, 3]; // token value of a bronze, silver and gold medal

/** Running total over the entries for which `fn` returns a number. */
const cumulative = (rows, fn) => {
  let sum = 0;
  const out = [];
  for (const r of rows) {
    const v = fn(r);
    if (!v) continue;
    sum += v;
    out.push({ date: r.date, value: sum });
  }
  return out;
};

/** Current streak of consecutive days (by date) for which `fn` is true. */
const streak = (rows, fn) => {
  let run = 0;
  let prev = null;
  const out = [];
  for (const r of rows) {
    if (!fn(r)) {
      run = 0;
      prev = null;
      continue;
    }
    const n = dayNum(r.date);
    run = prev !== null && n === prev + 1 ? run + 1 : 1;
    prev = n;
    out.push({ date: r.date, value: run });
  }
  return out;
};

const tracked = (e) => e.weight !== null || e.steps !== null || e.sleep !== null || e.training !== null || e.calories_ok !== null;

const ACHIEVEMENTS = [
  {
    key: 'streak', icon: 'flame', title: 'Dranbleiber', unit: 'Tage in Folge',
    text: (g) => `${g} Tage in Folge etwas eintragen`, goals: [7, 14, 30], best: true,
    series: (d) => streak(d.entries, tracked),
  },
  {
    key: 'steps_total', icon: 'steps', title: 'Kilometerfresser', unit: 'Schritte',
    text: (g) => `Insgesamt ${g.toLocaleString('de-DE')} Schritte gehen`, goals: [100000, 250000, 750000],
    series: (d) => cumulative(d.entries, (e) => e.steps),
  },
  {
    key: 'step_goal', icon: 'target', title: 'Zielläufer', unit: 'Tage',
    text: (g, d) => `An ${g} Tagen dein Schrittziel (${d.stepsGoal.toLocaleString('de-DE')}) schaffen`, goals: [10, 30, 75],
    series: (d) => cumulative(d.entries, (e) => (e.steps !== null && e.steps >= d.stepsGoal ? 1 : 0)),
  },
  {
    key: 'sleep_goal', icon: 'moon', title: 'Schlafprofi', unit: 'Nächte',
    text: (g, d) => `In ${g} Nächten dein Schlafziel (${String(d.sleepGoal).replace('.', ',')} h) erreichen`, goals: [10, 30, 75],
    series: (d) => cumulative(d.entries, (e) => (e.sleep !== null && e.sleep >= d.sleepGoal ? 1 : 0)),
  },
  {
    key: 'weigh_ins', icon: 'scale', title: 'Waagen-Routine', unit: 'Tage',
    text: (g) => `An ${g} Tagen dein Gewicht eintragen`, goals: [30, 90, 180],
    series: (d) => cumulative(d.entries, (e) => (e.weight !== null ? 1 : 0)),
  },
  {
    key: 'calories', icon: 'apple', title: 'Plantreue', unit: 'Tage',
    text: (g) => `An ${g} Tagen deine Kalorien einhalten`, goals: [7, 21, 50],
    series: (d) => cumulative(d.entries, (e) => (e.calories_ok === 1 ? 1 : 0)),
  },
  {
    key: 'trainings', icon: 'dumbbell', title: 'Eisenfreund', unit: 'Trainings',
    text: (g) => `${g} Trainings absolvieren`, goals: [10, 25, 50],
    series: (d) => cumulative(d.trainingDays, () => 1),
  },
  {
    key: 'volume', icon: 'plate', title: 'Tonnenstemmer', unit: 'kg bewegt',
    text: (g) => `Insgesamt ${(g / 1000).toLocaleString('de-DE')} Tonnen bewegen (Gewicht × Wiederholungen)`, goals: [10000, 50000, 150000],
    series: (d) => cumulative(d.workouts, (w) => w.volume),
  },
  {
    key: 'prs', icon: 'trophy', title: 'Rekordjäger', unit: 'Bestleistungen',
    text: (g) => `${g}× eine neue Bestleistung bei einer Übung aufstellen`, goals: [5, 15, 40],
    series: (d) => cumulative(d.prDays, (p) => p.count),
  },
  {
    key: 'checkins', icon: 'check', title: 'Teamplayer', unit: 'Check-ins',
    text: (g) => `${g} Check-ins deines Coaches annehmen`, goals: [4, 12, 26],
    series: (d) => cumulative(d.checkins, () => 1),
  },
];

function achievementsModule({ db, targetClient }) {
  const q = {
    entries: db.prepare('SELECT date, weight, steps, sleep, training, calories_ok FROM entries WHERE user_id = ? ORDER BY date'),
    goals: db.prepare('SELECT steps_goal, sleep_goal FROM goals WHERE user_id = ?'),
    workouts: db.prepare(
      `SELECT w.id, w.date, s.exercise_key, s.weight, s.reps FROM workouts w JOIN workout_sets s ON s.workout_id = w.id
       WHERE w.client_id = ? ORDER BY w.date, w.id`
    ),
    checkins: db.prepare(
      "SELECT substr(accepted_at, 1, 10) AS date FROM checkins WHERE client_id = ? AND status = 'accepted' AND accepted_at IS NOT NULL ORDER BY accepted_at"
    ),
  };

  function collect(clientId) {
    const entries = q.entries.all(clientId);
    const g = q.goals.get(clientId) || {};
    // workouts: volume per workout, and new personal bests per exercise (the first session is not a record)
    const byWorkout = new Map();
    const bestOf = new Map();
    const prByDate = new Map();
    const topPerWorkout = new Map();
    for (const s of q.workouts.all(clientId)) {
      if (!byWorkout.has(s.id)) byWorkout.set(s.id, { date: s.date, volume: 0 });
      byWorkout.get(s.id).volume += (s.weight || 0) * (s.reps || 0);
      const k = `${s.id}|${s.exercise_key}`;
      if (s.weight !== null && (!topPerWorkout.has(k) || s.weight > topPerWorkout.get(k).weight)) {
        topPerWorkout.set(k, { date: s.date, key: s.exercise_key, weight: s.weight });
      }
    }
    for (const t of topPerWorkout.values()) {
      const best = bestOf.get(t.key);
      if (best !== undefined && t.weight > best) prByDate.set(t.date, (prByDate.get(t.date) || 0) + 1);
      if (best === undefined || t.weight > best) bestOf.set(t.key, t.weight);
    }
    const workouts = [...byWorkout.values()];
    // a training day = training ticked in the daily entry or a logged workout
    const days = new Set([...entries.filter((e) => e.training === 1).map((e) => e.date), ...workouts.map((w) => w.date)]);
    return {
      entries,
      stepsGoal: g.steps_goal || 10000,
      sleepGoal: g.sleep_goal || 7,
      workouts,
      trainingDays: [...days].sort().map((date) => ({ date })),
      prDays: [...prByDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count })),
      checkins: q.checkins.all(clientId),
    };
  }

  function evaluate(clientId) {
    const data = collect(clientId);
    const list = ACHIEVEMENTS.map((a) => {
      const series = a.series(data);
      const current = a.best ? series.reduce((m, p) => Math.max(m, p.value), 0) : series.length ? series[series.length - 1].value : 0;
      // for streaks also report the running one, so "x in a row right now" can be shown
      const running = a.best && series.length && dayNum(series[series.length - 1].date) >= dayNum(new Date().toISOString().slice(0, 10)) - 1
        ? series[series.length - 1].value : 0;
      const tiers = a.goals.map((goal, i) => {
        const hit = series.find((p) => p.value >= goal);
        return {
          level: TIERS[i], goal, text: a.text(goal, data),
          achievedAt: hit ? hit.date : null,
          progress: Math.min(100, Math.floor((current / goal) * 100)),
        };
      });
      return { key: a.key, icon: a.icon, title: a.title, unit: a.unit, current, running: a.best ? running : undefined, tiers };
    });
    const all = list.flatMap((a) => a.tiers);
    return {
      achievements: list,
      summary: {
        earned: all.filter((t) => t.achievedAt).length,
        total: all.length,
        bronze: list.filter((a) => a.tiers[0].achievedAt).length,
        silver: list.filter((a) => a.tiers[1].achievedAt).length,
        gold: list.filter((a) => a.tiers[2].achievedAt).length,
        // shop currency: bronze 1, silver 2, gold 3 tokens
        tokens: list.reduce((sum, a) => sum + a.tiers.reduce((t, tier, i) => t + (tier.achievedAt ? TOKENS[i] : 0), 0), 0),
      },
    };
  }

  return {
    evaluate,
    routes: [['GET', /^\/api\/achievements$/, async (ctx) => evaluate(targetClient(ctx).id)]],
  };
}

module.exports = { achievementsModule, ACHIEVEMENTS, TOKENS };
