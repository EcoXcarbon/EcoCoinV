'use strict';
/**
 * The registry desk's dashboard: the work queues an officer acts on, the
 * aggregate figures, and the duplicate comparison. These are the numbers the
 * desk makes decisions from, so they are asserted against a registry whose
 * exact shape is built here rather than sampled.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

process.env.NSP_REGISTRY_KEYS = 'alice:key-alice,bob:key-bob';
process.env.NSP_PUBLIC_URL = 'https://nsp.example.org';
process.env.NSP_GATE_ENABLED = '0';   // applications are posted directly here
process.env.NSP_FOUR_EYES = '1';      // …but four-eyes stays on: the queue depends on it

const config = require('../server/config');
config.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nsp-dash-'));
const { createApp } = require('../server/app');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// Distinct people by default. They must genuinely differ, or the duplicate
// detector correctly flags the whole fixture and the queue counts below
// stop meaning what they say.
const NAMES = ['Bilal', 'Ayesha', 'Hassan', 'Fatima', 'Usman', 'Zainab', 'Imran', 'Sana'];
const FATHERS = ['Sultan Khan', 'Rashid Ahmed', 'Nazir Malik', 'Tariq Siddiqui', 'Ghulam Raza', 'Anwar Shah'];
let n = 0;
const person = (over = {}) => {
  const i = n++;
  const identity = {
    givenNames: NAMES[i % NAMES.length], familyName: 'Khan',
    dateOfBirth: `199${i % 9}-0${(i % 9) + 1}-1${i % 9}`,
    sex: 'M', nationality: 'PK', idDocumentType: 'CNIC',
    idDocumentNumber: `17301-${1000000 + i}-1`,
    fatherOrGuardianName: FATHERS[i % FATHERS.length], photo: PNG,
    ...(over.identity || {})
  };
  return {
    type: 'WORKER', identity,
    contact: {
      email: `p${i}@example.com`, phone: `+92300120${String(1000 + i).slice(-4)}`,
      address: { line1: 'H-1', city: 'Peshawar', region: 'Mardan', country: 'PK' },
      ...(over.contact || {})
    },
    education: { highestLevel: '4' },
    skills: [{ iscoCode: '7126', title: 'Plumber', sector: 'construction', nvqfLevel: 3, evidenceType: 'CERTIFICATE', certifyingBody: 'NAVTTC', primary: true }],
    languages: [{ code: 'ur', level: 'NATIVE' }],
    consent: { dataProcessing: true, declarationTruthful: true }
  };
};

let server, base;
const J = { 'Content-Type': 'application/json' };
const alice = { ...J, 'X-Registry-Key': 'key-alice' };
const bob = { ...J, 'X-Registry-Key': 'key-bob' };
const j = async (u, o = {}) => { const r = await fetch(base + u, o); return [r.status, await r.json()]; };
const add = async (over) => (await j('/api/v1/registrations', { method: 'POST', headers: J, body: JSON.stringify(person(over)) }))[1].nspId;
const move = (id, action, headers, reason) => j(`/api/v1/registrations/${id}/transition`, { method: 'POST', headers, body: JSON.stringify({ action, reason }) });

let ids = {};
test.before(async () => {
  const app = createApp(config, { dbFile: ':memory:' });
  await new Promise(res => { server = app.listen(0, res); });
  base = `http://127.0.0.1:${server.address().port}`;

  // A registry with one record in each interesting state.
  ids.submitted = await add();
  ids.reviewing = await add(); await move(ids.reviewing, 'REVIEW', alice);

  ids.verifiedByAlice = await add(); await move(ids.verifiedByAlice, 'VERIFY', alice);
  ids.verifiedByBob = await add(); await move(ids.verifiedByBob, 'VERIFY', bob);

  ids.issued = await add();
  await move(ids.issued, 'VERIFY', alice);
  await move(ids.issued, 'ISSUE', bob);

  // A near-duplicate of the first record: the same person under a second
  // document, with the Muhammad/Mohammad spelling that trips up exact matching.
  const [, first] = await j(`/api/v1/registrations/${ids.submitted}`, { headers: alice });
  ids.dupe = await add({
    identity: {
      givenNames: 'Muhammad ' + first.identity.givenNames,
      familyName: first.identity.familyName,
      dateOfBirth: first.identity.dateOfBirth,
      fatherOrGuardianName: first.identity.fatherOrGuardianName,
      idDocumentNumber: '17301-9999999-9'
    },
    contact: { email: 'dupe@example.com', phone: '+923004445555', address: { line1: 'H-2', city: 'Peshawar', region: 'Mardan', country: 'PK' } }
  });
});
test.after(() => server.close());

const dashboard = headers => j('/api/v1/dashboard', { headers }).then(([, d]) => d);

test('the queues count the work each state actually implies', async () => {
  const d = await dashboard(alice);
  assert.equal(d.queues.needsVerification, 3, 'two SUBMITTED (one of them the duplicate) and one UNDER_REVIEW');
  assert.equal(d.queues.awaitingIssue, 2, 'both VERIFIED records are ready to issue');
  assert.equal(d.queues.flagged, 1, 'the near-duplicate is flagged');
  assert.equal(d.queues.unverifiedPhone, 6, 'nothing here passed the mobile check');
});

test('the four-eyes queue is the caller’s own, not a global count', async () => {
  const forAlice = await dashboard(alice);
  const forBob = await dashboard(bob);
  // Alice verified two records that are still awaiting issue; Bob verified one.
  assert.equal(forAlice.queues.secondOfficer, 1, 'the record Alice verified and cannot issue');
  assert.equal(forBob.queues.secondOfficer, 1, 'the record Bob verified and cannot issue');
  assert.equal(forAlice.actor, 'alice');
  assert.equal(forBob.actor, 'bob');
});

test('totals and assurance reflect what the registry holds', async () => {
  const d = await dashboard(alice);
  assert.equal(d.totals.registrants, 6);
  assert.equal(d.totals.issued, 1);
  assert.equal(d.byStatus.SUBMITTED, 2, 'the plain submission and the duplicate');
  assert.equal(d.byAssurance['NSP-1'] + d.byAssurance['NSP-2'], 6);
  assert.equal(d.byAssurance['NSP-2'], 3, 'verifying lifts a record to NSP-2; the three unverified stay NSP-1');
  assert.equal(d.byAssurance['NSP-1'], 3);
});

test('the activity series covers every day in the window, including empty ones', async () => {
  const d = await dashboard(alice);
  assert.equal(d.trend.registrations.length, d.windowDays);
  assert.equal(d.trend.issuances.length, d.windowDays);
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(d.trend.registrations.at(-1).date, today, 'the series ends today');
  assert.equal(d.trend.registrations.at(-1).count, 6, 'all six were created just now');
  assert.ok(d.trend.registrations.every(p => typeof p.count === 'number'), 'no gaps');
});

test('service levels are reported with their sample size', async () => {
  const d = await dashboard(alice);
  assert.equal(d.serviceLevel.submittedToVerified.n, 3, 'the three records that have been verified');
  assert.ok(d.serviceLevel.submittedToVerified.medianHours >= 0);
  assert.equal(d.serviceLevel.verifiedToIssued.n, 1);
});

test('officer activity separates who verified from who issued', async () => {
  const d = await dashboard(alice);
  const byName = Object.fromEntries(d.officers.map(o => [o.actor, o]));
  assert.equal(byName.alice.verified, 2, 'Alice verified one still awaiting issue, and the one Bob issued');
  assert.equal(byName.alice.issued, 0, 'Alice has issued nothing — Bob did the issuing');
  assert.equal(byName.bob.issued, 1);
});

test('the queue filter returns the same records the queue counted', async () => {
  const [, q] = await j('/api/v1/registrations?queue=needsVerification', { headers: alice });
  assert.equal(q.total, 3);
  assert.ok(q.items.every(i => ['SUBMITTED', 'UNDER_REVIEW'].includes(i.status)));

  const [, mine] = await j('/api/v1/registrations?queue=secondOfficer', { headers: alice });
  assert.equal(mine.total, 1);
  assert.equal(mine.items[0].verifiedBy, 'alice');

  const [, flagged] = await j('/api/v1/registrations?queue=flagged', { headers: alice });
  assert.equal(flagged.total, 1);
  assert.equal(flagged.items[0].flags, 1);
});

test('a queue is ordered oldest first, so the longest wait is served next', async () => {
  const [, q] = await j('/api/v1/registrations?queue=needsVerification', { headers: alice });
  const times = q.items.map(i => Date.parse(i.submittedAt || i.createdAt));
  assert.deepEqual(times, [...times].sort((a, b) => a - b), 'ascending by wait');
  // …while the plain records list stays newest first.
  const [, list] = await j('/api/v1/registrations', { headers: alice });
  const created = list.items.map(i => Date.parse(i.createdAt));
  assert.deepEqual(created, [...created].sort((a, b) => b - a), 'descending by creation');
});

test('list filters do not silently match a literal "undefined"', async () => {
  const [, all] = await j('/api/v1/registrations', { headers: alice });
  const [, bogus] = await j('/api/v1/registrations?assurance=undefined', { headers: alice });
  assert.equal(all.total, 6);
  assert.equal(bogus.total, 0, 'a junk filter value must return nothing, not everything');
});

test('the duplicate view resolves candidates into comparable records', async () => {
  const [status, d] = await j(`/api/v1/registrations/${ids.dupe}/duplicates`, { headers: alice });
  assert.equal(status, 200);
  assert.equal(d.subject.nspId, ids.dupe);
  assert.equal(d.candidates.length, 1);

  const c = d.candidates[0];
  assert.equal(c.nspId, ids.submitted);
  assert.ok(c.score >= 50);
  assert.ok(c.reasons.length, 'the officer is told why it was flagged');
  // The fields an officer compares must all be present on both sides.
  for (const f of ['givenNames', 'familyName', 'dateOfBirth', 'fatherOrGuardianName', 'idDocumentNumber', 'phone', 'district']) {
    assert.ok(f in c, `candidate is missing ${f}`);
    assert.ok(f in d.subject, `subject is missing ${f}`);
  }
  assert.equal(c.dateOfBirth, d.subject.dateOfBirth, 'the match this flag was raised on');
  assert.notEqual(c.idDocumentNumber, d.subject.idDocumentNumber, 'different documents, or it would have been a hard block');
});

test('a record with no flags returns an empty candidate list rather than an error', async () => {
  const [status, d] = await j(`/api/v1/registrations/${ids.issued}/duplicates`, { headers: alice });
  assert.equal(status, 200);
  assert.deepEqual(d.candidates, []);
});

test('the dashboard and the duplicate view both require a registry key', async () => {
  assert.equal((await j('/api/v1/dashboard'))[0], 401);
  assert.equal((await j(`/api/v1/registrations/${ids.dupe}/duplicates`))[0], 401);
});

test('/me tells the desk which controls are live', async () => {
  const [, m] = await j('/api/v1/me', { headers: alice });
  assert.equal(m.actor, 'alice');
  assert.equal(m.controls.fourEyes, true);
  assert.equal(m.controls.gate, false);
  assert.ok(m.issuer.shortName);
});
