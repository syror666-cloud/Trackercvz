'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// fridgeOwner lives in the frontend; load just that function from public/app.js
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const fridgeOwner = new Function(`${src.slice(src.indexOf('function fridgeOwner'), src.indexOf('/** Freezer door'))}; return fridgeOwner;`)();

test('fridge name plate: English possessive of the first name, drawable letters only', () => {
  assert.equal(fridgeOwner('Claude'), "CLAUDE'S");
  assert.equal(fridgeOwner('Max Mustermann'), "MAX'S");
  assert.equal(fridgeOwner('James'), "JAMES'");
  assert.equal(fridgeOwner('Jürgen Weber'), "JÜRGEN'S");
  assert.equal(fridgeOwner('Ángel'), "ANGEL'S");
  assert.equal(fridgeOwner('Maximilian-Alexander'), "MAXIMILIAN'S");
  assert.equal(fridgeOwner('Anna-Lena'), "ANNA-LENA'S");
  assert.equal(fridgeOwner(''), '');
  assert.equal(fridgeOwner('李'), ''); // no drawable letters: the door just says FRIDGE
});
