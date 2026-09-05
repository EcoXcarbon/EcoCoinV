'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { formatNspId, parseNspId, isValidNspId, normaliseNspId, mod3736Check } = require('../server/lib/nspId');

test('formats and validates an NSP ID', () => {
  const id = formatNspId('PK', 2026, 123);
  assert.match(id, /^NSP-PK-26-0000123-[0-9A-Z]$/);
  assert.equal(isValidNspId(id), true);
  assert.deepEqual(parseNspId(id), { country: 'PK', year: 2026, sequence: 123, check: id.slice(-1), id });
});

test('ISO 7064 MOD 37,36 matches python-stdnum reference vectors', () => {
  // Values produced by stdnum.iso7064.mod_37_36.calc_check_digit
  assert.equal(mod3736Check('A'), 'H');
  assert.equal(mod3736Check('0'), '2');
  assert.equal(mod3736Check('XYZ123'), 'I');
  assert.equal(mod3736Check('PK260000123'), 'Y');
  assert.equal(mod3736Check('PK260000001'), 'H');
});

test('detects every single-character error and adjacent transposition', () => {
  const ALPHA = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let seq = 1; seq < 200; seq++) {
    const x = formatNspId('PK', 2026, seq).replace(/-/g, '');
    for (let i = 3; i < x.length; i++) {
      for (const c of ALPHA) {
        if (c === x[i] || (i < 12 && !/[0-9]/.test(c))) continue;
        assert.equal(normaliseNspId(x.slice(0, i) + c + x.slice(i + 1)), null, `undetected substitution at ${i} in ${x}`);
      }
    }
    for (let i = 3; i < x.length - 1; i++) {
      if (x[i] === x[i + 1]) continue;
      assert.equal(normaliseNspId(x.slice(0, i) + x[i + 1] + x[i] + x.slice(i + 2)), null, `undetected transposition at ${i} in ${x}`);
    }
  }
});

test('normalises loosely typed input', () => {
  const id = formatNspId('PK', 2026, 7);
  assert.equal(normaliseNspId(id.toLowerCase().replace(/-/g, ' ')), id);
  assert.equal(normaliseNspId('NSPPK260000007' + id.slice(-1)), id);
  assert.equal(normaliseNspId('garbage'), null);
});
