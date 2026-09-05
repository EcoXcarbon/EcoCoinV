'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

process.env.NSP_REGISTRY_KEYS = 'tester:test-key';
process.env.NSP_PUBLIC_URL = 'https://nsp.example.org';
// These tests exercise the registry lifecycle, not the registration gate: they
// post applications directly and drive verify/issue as a single officer. The
// gate and the four-eyes control have their own coverage in gate.test.js and
// gate-http.test.js.
process.env.NSP_GATE_ENABLED = '0';
process.env.NSP_FOUR_EYES = '0';
const config = require('../server/config');
config.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nsp-test-'));
const { createApp } = require('../server/app');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const sample = (over = {}) => ({
  type: 'WORKER',
  identity: { givenNames: 'Muhammad Ali', familyName: 'Khan', dateOfBirth: '1998-04-12', sex: 'M', nationality: 'PK', idDocumentType: 'CNIC', idDocumentNumber: '17301-1234567-1', photo: PNG },
  contact: { email: 'ali@example.com', phone: '+923001234567', address: { line1: 'H-12', city: 'Peshawar', country: 'PK' } },
  education: { highestLevel: '4' },
  skills: [{ iscoCode: '7126', title: 'Plumber', sector: 'construction', nvqfLevel: 3, evidenceType: 'CERTIFICATE', certifyingBody: 'NAVTTC', primary: true }],
  languages: [{ code: 'ur', level: 'NATIVE' }],
  consent: { dataProcessing: true, declarationTruthful: true },
  ...over
});

let server, base;
const H = { 'Content-Type': 'application/json', 'X-Registry-Key': 'test-key' };
const j = async (u, o = {}) => { const r = await fetch(base + u, o); return [r.status, await r.json()]; };

test.before(async () => {
  const app = createApp(config, { dbFile: ':memory:' });
  await new Promise(res => { server = app.listen(0, res); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('rejects an invalid registration with field-level errors', async () => {
  const [s, r] = await j('/api/v1/registrations', { method: 'POST', headers: H, body: JSON.stringify(sample({ identity: { givenNames: 'X', familyName: 'Y', dateOfBirth: '2020-01-01', sex: 'Q', nationality: 'ZZ', idDocumentType: 'CNIC', idDocumentNumber: 'bad' } })) });
  assert.equal(s, 422);
  const paths = r.details.map(d => d.path);
  assert.ok(paths.includes('identity.dateOfBirth'), 'minimum age');
  assert.ok(paths.includes('identity.sex'));
  assert.ok(paths.includes('identity.nationality'));
  assert.ok(paths.includes('identity.idDocumentNumber'));
  assert.ok(paths.includes('identity.photo'));
});

test('full lifecycle: register → verify → issue card & certificate → public verification → suspend → revoke', async () => {
  let [s, r] = await j('/api/v1/registrations', { method: 'POST', headers: H, body: JSON.stringify(sample()) });
  assert.equal(s, 201); const id = r.nspId; assert.match(id, /^NSP-PK-\d{2}-\d{7}-[0-9A-Z]$/);

  [s, r] = await j('/api/v1/registrations', { method: 'POST', headers: H, body: JSON.stringify(sample()) });
  assert.equal(s, 409, 'duplicate identity document');

  [s, r] = await j(`/api/v1/verify/${id}`); assert.equal(r.result, 'NOT_ISSUED');
  [s] = await j(`/api/v1/registrations/${id}`); assert.equal(s, 401, 'desk endpoints need a key');

  [s, r] = await j(`/api/v1/registrations/${id}/transition`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'ISSUE' }) });
  assert.equal(s, 409, 'cannot issue before verification');
  [s, r] = await j(`/api/v1/registrations/${id}/transition`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'VERIFY' }) });
  assert.equal(r.status, 'VERIFIED');

  [s, r] = await j(`/api/v1/registrations/${id}/credentials/card`, { method: 'POST', headers: H });
  assert.equal(s, 201); const card = r;
  assert.match(card.serial, /^C\d{9}$/);
  assert.equal(card.payload.mrz.line1.length, 30);
  assert.ok(card.payload.verifyUrl.startsWith(`https://nsp.example.org/verify/${id}?t=`));
  assert.ok(card.payload.verifyUrl.length < 300, 'QR payload stays compact');
  assert.ok(!card.token.includes('1998'), 'no date of birth inside the QR token');

  [s, r] = await j(`/api/v1/registrations/${id}/credentials/certificate`, { method: 'POST', headers: H });
  assert.equal(s, 201); assert.match(r.serial, /^NSP-CERT-\d{2}-\d{7}$/); assert.equal(r.payload.cardSerial, card.serial);

  [s, r] = await j(`/api/v1/registrations/${id}`, { headers: H }); assert.equal(r.status, 'ISSUED'); assert.equal(r.credentials.length, 2);

  const token = card.token;
  [s, r] = await j(`/api/v1/verify/${id}?t=${token}`); assert.equal(r.result, 'VALID'); assert.equal(r.record.signatureChecked, true);
  assert.equal(r.record.holder.dateOfBirthYear, '1998'); assert.equal(r.record.holder.idDocumentNumber, undefined, 'public view hides ID numbers');
  [s, r] = await j(`/api/v1/verify/${id}?t=${token.slice(0, -4)}AAAA`); assert.equal(r.result, 'INVALID_SIGNATURE');
  [s, r] = await j(`/api/v1/verify/serial/${card.serial}`); assert.equal(r.result, 'VALID');
  [s, r] = await j(`/api/v1/verify/NSP-PK-26-0000001-0`); assert.equal(r.result, 'MALFORMED_ID');

  // reprint replaces the previous card; the old card's QR now reports REPLACED
  [s, r] = await j(`/api/v1/registrations/${id}/credentials/card`, { method: 'POST', headers: H });
  [s, r] = await j(`/api/v1/verify/serial/${card.serial}`); assert.equal(r.result, 'CREDENTIAL_REPLACED');

  [s, r] = await j(`/api/v1/registrations/${id}/credential.json`, { headers: H });
  assert.deepEqual(r.type, ['VerifiableCredential', 'SkillsPassportCredential']); assert.equal(r.proof.cryptosuite, 'eddsa-jcs-2022');

  [s, r] = await j(`/api/v1/registrations/${id}/transition`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'SUSPEND' }) });
  assert.equal(s, 400, 'reason required');
  [s, r] = await j(`/api/v1/registrations/${id}/transition`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'SUSPEND', reason: 'complaint' }) });
  [s, r] = await j(`/api/v1/verify/${id}`); assert.equal(r.result, 'SUSPENDED');
  [s, r] = await j(`/api/v1/registrations/${id}/transition`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'REVOKE', reason: 'fraud' }) });
  [s, r] = await j(`/api/v1/verify/${id}`); assert.equal(r.result, 'REVOKED');
  [s, r] = await j(`/api/v1/registrations/${id}/status?dob=1998-04-12`); assert.equal(r.status, 'REVOKED');
  [s, r] = await j(`/api/v1/registrations/${id}/status?dob=1998-04-13`); assert.equal(s, 403);
  [s, r] = await j('/api/v1/stats', { headers: H }); assert.equal(r.byStatus.REVOKED, 1);
});

test('students must provide enrollment details', async () => {
  const [s, r] = await j('/api/v1/registrations', { method: 'POST', headers: H, body: JSON.stringify(sample({ type: 'STUDENT', identity: { givenNames: 'Ayesha', familyName: 'Siddiqui', dateOfBirth: '2005-09-30', sex: 'F', nationality: 'PK', idDocumentType: 'CNIC', idDocumentNumber: '42201-7654321-2', photo: PNG } })) });
  assert.equal(s, 422);
  assert.ok(r.details.some(d => d.path === 'education.enrollmentNumber'));
});

test('issuer document exposes the Ed25519 key', async () => {
  const [, r] = await j('/.well-known/did.json');
  assert.equal(r.verificationMethod[0].type, 'Multikey');
  assert.match(r.verificationMethod[0].publicKeyMultibase, /^z6Mk/);
});
