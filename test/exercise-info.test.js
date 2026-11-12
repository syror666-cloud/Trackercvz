'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SPLITS, buildPlan } = require('../src/training-templates');

test('every template exercise has a how-to with both photos', () => {
  const info = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'exercises', 'info.json'), 'utf8'));
  const names = new Set(SPLITS.flatMap((s) => s.days.flatMap((d) => buildPlan(s.key, d).flatMap((day) => day.exercises.map((e) => e.name)))));
  for (const name of names) {
    const i = info[name.toLowerCase()];
    assert.ok(i, `${name}: keine Anleitung`);
    assert.ok(i.steps.length >= 3 && i.tip && i.muscles, name);
    for (const n of [0, 1]) assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'exercises', `${i.img}-${n}.jpg`)), `${name}: Foto ${n}`);
  }
});
