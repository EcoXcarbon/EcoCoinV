'use strict';
/**
 * End-to-end coverage of the registration gate over HTTP, with the gate ON.
 * Proves that an ungated submission is refused and that the intended path —
 * OTP, then proof of work — succeeds, and that four-eyes separates the officer
 * who verifies from the officer who issues.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');

process.env.NSP_REGISTRY_KEYS = 'alice:key-alice,bob:key-bob';
process.env.NSP_PUBLIC_URL = 'https://nsp.example.org';
process.env.NSP_GATE_ENABLED = '1';
process.env.NSP_FOUR_EYES = '1';
process.env.NSP_OTP_DEV_ECHO = '1';       // log provider echoes the code back
process.env.NSP_SMS_PROVIDER = 'log';
process.env.NSP_POW_DIFFICULTY = '8';     // keep the suite fast
process.env.NSP_OTP_RESEND_COOLDOWN_SEC = '0';
process.env.NSP_GATE_SECRET = 'test-gate-secret';
process.env.NSP_RATE_LIMIT = '500';        // the suite makes many calls from one IP

const config = require('../server/config');
config.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nsp-gate-'));
const { createApp } = require('../server/app');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const sample = (over = {}) => ({
  type: 'WORKER',
  identity: { givenNames: 'Muhammad Ali', familyName: 'Khan', dateOfBirth: '1998-04-12', sex: 'M', nationality: 'PK',
    idDocumentType: 'CNIC', idDocumentNumber: '17301-1234567-1', fatherOrGuardianName: 'Sultan Khan', photo: PNG },
  contact: { email: 'ali@example.com', phone: '+923001234567', address: { line1: 'H-12', city: 'Peshawar', region: 'Peshawar', country: 'PK' } },
  education: { highestLevel: '4' },
  skills: [{ iscoCode: '7126', title: 'Plumber', sector: 'construction', nvqfLevel: 3, evidenceType: 'CERTIFICATE', certifyingBody: 'NAVTTC', primary: true }],
  languages: [{ code: 'ur', level: 'NATIVE' }],
  consent: { dataProcessing: true, declarationTruthful: true },
  ...over
});

let server, base;
const J = { 'Content-Type': 'application/json' };
const asAlice = { ...J, 'X-Registry-Key': 'key-alice' };
const asBob = { ...J, 'X-Registry-Key': 'key-bob' };
const j = async (u, o = {}) => { const r = await fetch(base + u, o); return [r.status, await r.json()]; };

test.before(async () => {
  const app = createApp(config, { dbFile: ':memory:' });
  await new Promise(res => { server = app.listen(0, res); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

/** Solve the server's proof of work the way the browser does. */
async function solvePow() {
  const [, c] = await j('/api/v1/gate/challenge');
  let nonce = 0;
  for (;;) {
    const d = crypto.createHash('sha256').update(`${c.challenge}.${nonce}`).digest();
    let bits = 0;
    for (const b of d) { if (b === 0) { bits += 8; continue; } bits += Math.clz32(b) - 24; break; }
    if (bits >= c.difficulty) return { gateChallenge: c.challenge, gateNonce: String(nonce) };
    nonce++;
  }
}

async function verifiedToken(phone) {
  const [, req] = await j('/api/v1/otp/request', { method: 'POST', headers: J, body: JSON.stringify({ phone }) });
  const [, ver] = await j('/api/v1/otp/verify', { method: 'POST', headers: J, body: JSON.stringify({ challengeId: req.challengeId, code: req.devCode }) });
  return ver.registrationToken;
}

test('a bare submission with no gate evidence is refused', async () => {
  const [status] = await j('/api/v1/registrations', { method: 'POST', headers: J, body: JSON.stringify(sample()) });
  assert.equal(status, 400);
});

test('a submission without a verified mobile is refused even with valid proof of work', async () => {
  const pow = await solvePow();
  const [status, body] = await j('/api/v1/registrations', {
    method: 'POST', headers: J, body: JSON.stringify({ ...sample(), ...pow })
  });
  assert.equal(status, 401);
  assert.match(body.error, /mobile verification/i);
});

test('the honeypot field rejects the submission', async () => {
  const pow = await solvePow();
  const token = await verifiedToken('+923004444444');
  const [status] = await j('/api/v1/registrations', {
    method: 'POST', headers: J,
    body: JSON.stringify({ ...sample({ contact: { ...sample().contact, phone: '+923004444444' } }), ...pow, registrationToken: token, website: 'http://spam.example' })
  });
  assert.equal(status, 400);
});

test('the full gated path succeeds and records assurance tier NSP-1', async () => {
  const phone = '+923001234567';
  const token = await verifiedToken(phone);
  const pow = await solvePow();
  const [status, body] = await j('/api/v1/registrations', {
    method: 'POST', headers: J, body: JSON.stringify({ ...sample(), ...pow, registrationToken: token })
  });
  assert.equal(status, 201);
  assert.equal(body.status, 'SUBMITTED');

  const [, rec] = await j(`/api/v1/registrations/${body.nspId}`, { headers: asAlice });
  assert.equal(rec.assurance.tier, 'NSP-1');
  assert.equal(rec.assurance.phoneVerified, true);
});

test('the phone on the form must match the number that was verified', async () => {
  const token = await verifiedToken('+923005555555');
  const pow = await solvePow();
  const [status, body] = await j('/api/v1/registrations', {
    method: 'POST', headers: J,
    body: JSON.stringify({ ...sample({ identity: { ...sample().identity, idDocumentNumber: '17301-7654321-9' } }), ...pow, registrationToken: token })
  });
  assert.equal(status, 400);
  assert.match(body.error, /does not match/i);
});

test('a solved challenge cannot be replayed', async () => {
  const pow = await solvePow();
  const t1 = await verifiedToken('+923006666666');
  const base1 = sample({
    identity: { ...sample().identity, idDocumentNumber: '17301-1111111-1' },
    contact: { ...sample().contact, phone: '+923006666666', email: 'a1@example.com' }
  });
  const [s1] = await j('/api/v1/registrations', { method: 'POST', headers: J, body: JSON.stringify({ ...base1, ...pow, registrationToken: t1 }) });
  assert.equal(s1, 201);

  const t2 = await verifiedToken('+923007777777');
  const base2 = sample({
    identity: { ...sample().identity, idDocumentNumber: '17301-2222222-2' },
    contact: { ...sample().contact, phone: '+923007777777', email: 'a2@example.com' }
  });
  const [s2, b2] = await j('/api/v1/registrations', { method: 'POST', headers: J, body: JSON.stringify({ ...base2, ...pow, registrationToken: t2 }) });
  assert.equal(s2, 400);
  assert.match(b2.error, /already used/i);
});

test('a near-duplicate person is flagged for review but not refused', async () => {
  // Same person, different CNIC and spelling: "Mohammad Ali Khan" vs the
  // "Muhammad Ali Khan" registered above, same date of birth and father.
  const phone = '+923008888888';
  const token = await verifiedToken(phone);
  const pow = await solvePow();
  const dupe = sample({
    identity: { ...sample().identity, givenNames: 'Mohammad Ali', idDocumentNumber: '17301-9999999-9' },
    contact: { ...sample().contact, phone, email: 'dupe@example.com' }
  });
  const [status, body] = await j('/api/v1/registrations', { method: 'POST', headers: J, body: JSON.stringify({ ...dupe, ...pow, registrationToken: token }) });
  assert.equal(status, 201, 'a possible duplicate must still be accepted for a human to judge');

  const [, rec] = await j(`/api/v1/registrations/${body.nspId}`, { headers: asAlice });
  assert.ok(rec.assurance.dedupFlags.length > 0, 'expected at least one duplicate flag');
  assert.ok(rec.assurance.dedupFlags[0].score >= 50);
});

test('four eyes: the officer who verifies cannot also issue', async () => {
  const phone = '+923009999999';
  const token = await verifiedToken(phone);
  const pow = await solvePow();
  const app = sample({
    identity: { ...sample().identity, givenNames: 'Hassan', familyName: 'Raza', dateOfBirth: '1995-01-01', idDocumentNumber: '17301-3333333-3' },
    contact: { ...sample().contact, phone, email: 'hassan@example.com' }
  });
  const [, created] = await j('/api/v1/registrations', { method: 'POST', headers: J, body: JSON.stringify({ ...app, ...pow, registrationToken: token }) });

  const [vs, verified] = await j(`/api/v1/registrations/${created.nspId}/transition`, {
    method: 'POST', headers: asAlice, body: JSON.stringify({ action: 'VERIFY' })
  });
  assert.equal(vs, 200);
  assert.equal(verified.assurance.tier, 'NSP-2', 'sighting the document lifts the record to NSP-2');

  const [blocked, err] = await j(`/api/v1/registrations/${created.nspId}/transition`, {
    method: 'POST', headers: asAlice, body: JSON.stringify({ action: 'ISSUE' })
  });
  assert.equal(blocked, 409);
  assert.match(err.error, /four-eyes/i);

  const [ok, issued] = await j(`/api/v1/registrations/${created.nspId}/transition`, {
    method: 'POST', headers: asBob, body: JSON.stringify({ action: 'ISSUE' })
  });
  assert.equal(ok, 200);
  assert.equal(issued.status, 'ISSUED');
  assert.equal(issued.registry.issuedBy, 'bob');
});

test('the audit trail records the gate events', async () => {
  const [status, log] = await j('/api/v1/audit?limit=200', { headers: asAlice });
  assert.equal(status, 200);
  const actions = new Set(log.items.map(i => i.action));
  for (const a of ['OTP_REQUEST', 'OTP_VERIFIED', 'REGISTER', 'DEDUP_FLAG', 'VERIFY', 'ISSUE']) {
    assert.ok(actions.has(a), `audit log should contain ${a}`);
  }
});
