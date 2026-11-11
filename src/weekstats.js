'use strict';

// Week comparison for coach check-ins: last 7 days vs. the 7 days before.

const DAY_MS = 86400000;
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (v, d) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);

function periodStats(entries, from, to, goals) {
  const inRange = entries.filter((e) => e.date >= from && e.date <= to);
  const weights = inRange.filter((e) => e.weight !== null).map((e) => e.weight);
  const steps = inRange.filter((e) => e.steps !== null).map((e) => e.steps);
  const sleep = inRange.filter((e) => e.sleep !== null).map((e) => e.sleep);
  return {
    from,
    to,
    daysLogged: inRange.length,
    weightAvg: round(avg(weights), 2),
    weightMin: weights.length ? Math.min(...weights) : null,
    weightMax: weights.length ? Math.max(...weights) : null,
    weighIns: weights.length,
    stepsAvg: steps.length ? Math.round(avg(steps)) : null,
    stepsTotal: steps.reduce((a, b) => a + b, 0),
    stepsGoalDays: goals.steps_goal ? steps.filter((s) => s >= goals.steps_goal).length : null,
    sleepAvg: round(avg(sleep), 2),
    sleepGoalDays: goals.sleep_goal ? sleep.filter((s) => s >= goals.sleep_goal).length : null,
    trainingDays: inRange.filter((e) => e.training === 1).length,
    trainingAnswered: inRange.filter((e) => e.training === 0 || e.training === 1).length,
    caloriesOkDays: inRange.filter((e) => e.calories_ok === 1).length,
    caloriesAnswered: inRange.filter((e) => e.calories_ok === 0 || e.calories_ok === 1).length,
    caloriesReportedAvg: (() => {
      const kcal = inRange.filter((e) => e.calories_ok === 0 && e.calories !== null && e.calories !== undefined).map((e) => e.calories);
      return kcal.length ? Math.round(avg(kcal)) : null;
    })(),
  };
}

/** entries: all entries of a client (ascending), today: YYYY-MM-DD in the app time zone. */
function weekComparison(entries, today, goalsRow) {
  const goals = goalsRow || {};
  const current = periodStats(entries, addDays(today, -6), today, goals);
  const previous = periodStats(entries, addDays(today, -13), addDays(today, -7), goals);
  const diff = (k, d) => (current[k] === null || previous[k] === null ? null : round(current[k] - previous[k], d));
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const date = addDays(today, -i);
    const e = entries.find((x) => x.date === date);
    days.push({
      date,
      weight: e ? e.weight : null,
      steps: e ? e.steps : null,
      sleep: e ? e.sleep : null,
      note: e ? e.note : null,
      training: e && e.training !== null && e.training !== undefined ? Boolean(e.training) : null,
      caloriesOk: e && e.calories_ok !== null && e.calories_ok !== undefined ? Boolean(e.calories_ok) : null,
      calories: e ? e.calories ?? null : null,
    });
  }
  return {
    current,
    previous,
    delta: {
      weightAvg: diff('weightAvg', 2), stepsAvg: diff('stepsAvg', 0), sleepAvg: diff('sleepAvg', 2),
      daysLogged: diff('daysLogged', 0), trainingDays: diff('trainingDays', 0), caloriesOkDays: diff('caloriesOkDays', 0),
    },
    days,
  };
}

module.exports = { weekComparison };

/**
 * Positive highlights of the week for the client's check-in card.
 * - Weight: weekly average moved more than 0.6 % in the goal direction (target weight, else category).
 * - Steps goal reached on more than 5 days.
 * - Sleep goal reached on at least 5 nights.
 */
function weekHighlights(cmp, goalsRow, category) {
  const goals = goalsRow || {};
  const out = [];
  const cur = cmp.current;
  const prev = cmp.previous;
  const de = (v, d = 1) => Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

  if (cur.weightAvg !== null && prev.weightAvg !== null && prev.weightAvg > 0) {
    let dir = 0;
    if (goals.target_weight !== null && goals.target_weight !== undefined) dir = Math.sign(goals.target_weight - prev.weightAvg);
    else if (category === 'diet') dir = -1;
    else if (category === 'build') dir = 1;
    const diff = cur.weightAvg - prev.weightAvg;
    const pct = (diff / prev.weightAvg) * 100;
    if (dir !== 0 && Math.sign(diff) === dir && Math.abs(pct) > 0.6) {
      const sign = diff < 0 ? '−' : '+';
      out.push({
        key: 'weight',
        icon: dir < 0 ? '📉' : '📈',
        text: `Gewicht im Wochenschnitt ${sign}${de(Math.abs(diff))} kg (${sign}${de(Math.abs(pct))} %) – genau in Richtung Ziel`,
      });
    }
  }
  if (goals.steps_goal && cur.stepsGoalDays !== null && cur.stepsGoalDays > 5) {
    out.push({ key: 'steps', icon: '👟', text: `Schrittziel an ${cur.stepsGoalDays} von 7 Tagen erreicht` });
  }
  if (goals.sleep_goal && cur.sleepGoalDays !== null && cur.sleepGoalDays >= 5) {
    out.push({ key: 'sleep', icon: '😴', text: `Schlafziel in ${cur.sleepGoalDays} von 7 Nächten erreicht` });
  }
  return out;
}

module.exports.weekHighlights = weekHighlights;
