'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMrz, verifyMrz, checkDigit } = require('../server/lib/mrz');

test('ICAO 9303 check digit matches the specification example', () => {
  // Doc 9303 Part 3 worked example: document number "D23145890" -> check digit 7
  assert.equal(checkDigit('D23145890'), '7');
  assert.equal(checkDigit('740812'), '2'); // date example from Doc 9303
});

test('builds a three-line TD1 zone that self-verifies', () => {
  const z = buildMrz({ issuerAlpha3: 'PAK', nspId: 'NSP-PK-26-0000123-Y', familyName: 'Khan', givenNames: 'Muhammad Ali', dateOfBirth: '1998-04-12', sex: 'M', expiry: '2031-09-04', nationalityAlpha3: 'PAK', cardSerial: 'C260000123' });
  for (const l of [z.line1, z.line2, z.line3]) assert.equal(l.length, 30);
  assert.equal(z.line1.slice(0, 2), 'NS');
  assert.equal(z.line1.slice(2, 5), 'PAK');
  assert.equal(z.line3, 'KHAN<<MUHAMMAD<ALI<<<<<<<<<<<<');
  assert.equal(verifyMrz(z), true);
  assert.equal(verifyMrz({ line1: z.line1, line2: z.line2.replace('M', 'F') }), true, 'sex is not covered by a check digit');
  assert.equal(verifyMrz({ line1: z.line1.replace('123', '124'), line2: z.line2 }), false, 'document number tampering is detected');
});

test('strips diacritics and non-Latin characters from names', () => {
  const z = buildMrz({ issuerAlpha3: 'PAK', nspId: 'NSP-PK-26-0000001-H', familyName: 'Müller-Østergaard', givenNames: 'José', dateOfBirth: '1990-01-01', sex: 'F', expiry: '2030-01-01', nationalityAlpha3: 'DEU' });
  assert.equal(z.line3, 'MULLEROESTERGAARD<<JOSE<<<<<<<');
});
