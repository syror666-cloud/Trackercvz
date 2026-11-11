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
    days.push({ date, weight: e ? e.weight : null, steps: e ? e.steps : null, sleep: e ? e.sleep : null, note: e ? e.note : null });
  }
  return {
    current,
    previous,
    delta: { weightAvg: diff('weightAvg', 2), stepsAvg: diff('stepsAvg', 0), sleepAvg: diff('sleepAvg', 2), daysLogged: diff('daysLogged', 0) },
    days,
  };
}

module.exports = { weekComparison };
