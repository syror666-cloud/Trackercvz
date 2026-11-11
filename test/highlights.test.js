'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { weekComparison, weekHighlights } = require('../src/weekstats');

const TODAY = '2026-11-15'; // Sunday
const day = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);

function entries({ prevWeight, curWeight, steps = [], sleep = [] }) {
  const out = [];
  for (let i = 13; i >= 0; i--) {
    const cur = i <= 6;
    const idx = 6 - (i % 7);
    out.push({
      date: day(i),
      weight: cur ? curWeight : prevWeight,
      steps: cur ? steps[idx] ?? null : null,
      sleep: cur ? sleep[idx] ?? null : null,
      note: null,
    });
  }
  return out;
}

const keys = (h) => h.map((x) => x.key);

test('weight highlight: > 0.6 % in the goal direction only', () => {
  // 80 → 79.4 = −0.75 % with a lower target weight → highlight
  let cmp = weekComparison(entries({ prevWeight: 80, curWeight: 79.4 }), TODAY, { target_weight: 75 });
  let h = weekHighlights(cmp, { target_weight: 75 }, null);
  assert.deepEqual(keys(h), ['weight']);
  assert.match(h[0].text, /−0,6 kg \(−0,7 %\)/);

  // Only −0.5 % → no highlight
  cmp = weekComparison(entries({ prevWeight: 80, curWeight: 79.6 }), TODAY, { target_weight: 75 });
  assert.deepEqual(weekHighlights(cmp, { target_weight: 75 }, null), []);

  // Wrong direction (target is higher) → nothing
  cmp = weekComparison(entries({ prevWeight: 80, curWeight: 79.4 }), TODAY, { target_weight: 85 });
  assert.deepEqual(weekHighlights(cmp, { target_weight: 85 }, null), []);

  // No target weight: category decides (Aufbau = up, Diät = down, Maintenance = none)
  cmp = weekComparison(entries({ prevWeight: 70, curWeight: 70.6 }), TODAY, {});
  assert.deepEqual(keys(weekHighlights(cmp, {}, 'build')), ['weight']);
  assert.deepEqual(weekHighlights(cmp, {}, 'diet'), []);
  assert.deepEqual(weekHighlights(cmp, {}, 'maintenance'), []);
});

test('steps (> 5 days) and sleep (≥ 5 nights) highlights', () => {
  const goals = { steps_goal: 10000, sleep_goal: 7 };
  // steps goal on 6 days, sleep goal on 5 nights
  const cmp = weekComparison(
    entries({ prevWeight: 80, curWeight: 80, steps: [10000, 11000, 12000, 10500, 10001, 13000, 4000], sleep: [7, 7.5, 8, 7, 7.2, 6, 5] }),
    TODAY,
    goals
  );
  const h = weekHighlights(cmp, goals, 'maintenance');
  assert.deepEqual(keys(h), ['steps', 'sleep']);
  assert.equal(h[0].text, 'Schrittziel an 6 von 7 Tagen erreicht');
  assert.equal(h[1].text, 'Schlafziel in 5 von 7 Nächten erreicht');

  // exactly 5 step days and 4 sleep nights → nothing
  const cmp2 = weekComparison(
    entries({ prevWeight: 80, curWeight: 80, steps: [10000, 11000, 12000, 10500, 10001, 3000, 4000], sleep: [7, 7.5, 8, 7, 6, 6, 5] }),
    TODAY,
    goals
  );
  assert.deepEqual(weekHighlights(cmp2, goals, null), []);
  // no goals set → nothing
  assert.deepEqual(weekHighlights(cmp, {}, null), []);
});
