'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const { nameKey, similarity, scoreCandidate } = require('../server/lib/dedup');
const { Gate, GateError, leadingZeroBits } = require('../server/lib/gate');
const { Otp, OtpError, createSmsProvider } = require('../server/lib/otp');
const { Store } = require('../server/lib/store');

// ── dedup: name normalisation ────────────────────────────────────────
test('nameKey collapses Muhammad spelling variants and honorifics', () => {
  const target = nameKey('Ali', 'Khan');
  for (const g of ['Muhammad Ali', 'Mohammad Ali', 'Mohammed Ali', 'Md Ali', 'Syed Ali']) {
    assert.strictEqual(nameKey(g, 'Khan'), target, `${g} Khan should reduce to "${target}"`);
  }
});

test('nameKey drops initials and is order independent', () => {
  assert.strictEqual(nameKey('M. Ali', 'Khan'), nameKey('Ali', 'Khan'));
  assert.strictEqual(nameKey('Khan', 'Ali'), nameKey('Ali', 'Khan'));
});

test('nameKey keeps genuinely different people apart', () => {
  assert.notStrictEqual(nameKey('Ali', 'Khan'), nameKey('Bilal', 'Khan'));
  assert.notStrictEqual(nameKey('Ayesha', 'Siddiqui'), nameKey('Ayesha', 'Malik'));
});

test('similarity is 1 for identical and low for unrelated strings', () => {
  assert.strictEqual(similarity('ali khan', 'ali khan'), 1);
  assert.ok(similarity('ali khan', 'bilal ahmed') < 0.3);
});

// ── dedup: scoring ───────────────────────────────────────────────────
test('same normalised name and date of birth scores above the review threshold', () => {
  const applicant = { nameKey: nameKey('Muhammad Ali', 'Khan'), dateOfBirth: '1998-04-02', fatherKey: nameKey('Sultan Khan'), phone: '+923001234567', email: 'a@b.pk' };
  const candidate = { nameKey: nameKey('Ali', 'Khan'), dateOfBirth: '1998-04-02', fatherKey: nameKey('Sultan Khan'), phone: '+923009999999', email: 'z@b.pk' };
  const { score, reasons } = scoreCandidate(applicant, candidate);
  assert.ok(score >= 50, `expected >= 50, got ${score}`);
  assert.ok(reasons.length > 0);
});

test('different person with a shared date of birth stays below the threshold', () => {
  const applicant = { nameKey: nameKey('Ayesha', 'Siddiqui'), dateOfBirth: '1998-04-02', fatherKey: nameKey('Tariq Siddiqui'), phone: '+923001111111', email: 'x@b.pk' };
  const candidate = { nameKey: nameKey('Bilal', 'Ahmed'), dateOfBirth: '1998-04-02', fatherKey: nameKey('Nadeem Ahmed'), phone: '+923002222222', email: 'y@b.pk' };
  assert.ok(scoreCandidate(applicant, candidate).score < 50);
});

// ── proof of work ────────────────────────────────────────────────────
test('leadingZeroBits counts correctly', () => {
  assert.strictEqual(leadingZeroBits(Buffer.from([0x00, 0x00, 0xff])), 16);
  assert.strictEqual(leadingZeroBits(Buffer.from([0x0f])), 4);
  assert.strictEqual(leadingZeroBits(Buffer.from([0xff])), 0);
});

test('gate accepts a correct proof of work and rejects replay', () => {
  const store = new Store(':memory:');
  const gate = new Gate(store, { difficulty: 8, secret: 'test-secret' });
  const c = gate.challenge();
  let nonce = 0;
  while (leadingZeroBits(crypto.createHash('sha256').update(`${c.challenge}.${nonce}`).digest()) < 8) nonce++;

  assert.strictEqual(gate.verifyChallenge(c.challenge, String(nonce)), true);
  assert.throws(() => gate.verifyChallenge(c.challenge, String(nonce)), /already used/);
  store.close();
});

test('gate rejects an unsigned or insufficient proof', () => {
  const store = new Store(':memory:');
  const gate = new Gate(store, { difficulty: 20, secret: 'test-secret' });
  assert.throws(() => gate.verifyChallenge('not-a-challenge', '1'), GateError);
  const c = gate.challenge();
  assert.throws(() => gate.verifyChallenge(c.challenge, '0'), /insufficient/);
  store.close();
});

// ── velocity ─────────────────────────────────────────────────────────
test('velocity cap trips once the per-phone daily limit is reached', () => {
  const store = new Store(':memory:');
  const gate = new Gate(store, { secret: 's', perPhoneDay: 2 });
  const phone = '+923001234567';
  gate.checkVelocity({ phone });
  store.recordRegistrationEvent({ nspId: 'A', phone });
  store.recordRegistrationEvent({ nspId: 'B', phone });
  assert.throws(() => gate.checkVelocity({ phone }), /registration limit/);
  store.close();
});

// ── OTP ──────────────────────────────────────────────────────────────
function makeOtp(store, extra = {}) {
  return new Otp(store, { secret: 'test-secret', sms: createSmsProvider('log'), devEcho: true, ...extra });
}

test('OTP round trip yields a token bound to the phone', async () => {
  const store = new Store(':memory:');
  const otp = makeOtp(store);
  const req = await otp.request('+923001234567');
  const { registrationToken, phone } = otp.verify(req.challengeId, req.devCode);
  assert.strictEqual(phone, '+923001234567');
  assert.strictEqual(otp.openToken(registrationToken).phone, '+923001234567');
  store.close();
});

test('OTP rejects a wrong code and locks out after the attempt limit', async () => {
  const store = new Store(':memory:');
  const otp = makeOtp(store, { maxAttempts: 3 });
  const req = await otp.request('+923001234567');
  const wrong = String((Number(req.devCode) + 1) % 1000000).padStart(6, '0');
  for (let i = 0; i < 3; i++) assert.throws(() => otp.verify(req.challengeId, wrong), OtpError);
  assert.throws(() => otp.verify(req.challengeId, req.devCode), /too many incorrect attempts/);
  store.close();
});

test('an OTP code cannot be used twice', async () => {
  const store = new Store(':memory:');
  const otp = makeOtp(store);
  const req = await otp.request('+923001234567');
  otp.verify(req.challengeId, req.devCode);
  assert.throws(() => otp.verify(req.challengeId, req.devCode), /already been used/);
  store.close();
});

test('a registration token is single use and tamper evident', async () => {
  const store = new Store(':memory:');
  const otp = makeOtp(store);
  const req = await otp.request('+923001234567');
  const { registrationToken } = otp.verify(req.challengeId, req.devCode);

  const opened = otp.openToken(registrationToken);
  otp.consumeToken(opened.signature);
  assert.throws(() => otp.openToken(registrationToken), /already been used/);

  const forged = Buffer.from('+923339999999.' + (Date.now() + 60000)).toString('base64url') + '.' + '0'.repeat(64);
  assert.throws(() => otp.openToken(forged), /invalid/);
  store.close();
});

test('OTP resend cooldown and hourly cap are enforced', async () => {
  const store = new Store(':memory:');
  const otp = makeOtp(store, { resendCooldownMs: 60_000, perPhoneHour: 2 });
  await otp.request('+923001234567');
  await assert.rejects(() => otp.request('+923001234567'), /wait before requesting another/);

  const otp2 = makeOtp(store, { resendCooldownMs: 0, perPhoneHour: 2 });
  await otp2.request('+923001234567');
  await assert.rejects(() => otp2.request('+923001234567'), /too many codes/);
  store.close();
});

test('OTP requires E.164 format', async () => {
  const store = new Store(':memory:');
  const otp = makeOtp(store);
  await assert.rejects(() => otp.request('03001234567'), /E.164/);
  store.close();
});

// ── email fallback for the verification code ─────────────────────────
// No SMS account exists yet, so a code that only ever reaches the service
// journal strands every applicant. Email carries it instead — but proves
// something weaker, and the code says so.
function fakeMailer(sink, { fail = false } = {}) {
  return { configured: true, name: 'smtp:test', async send(m) { if (fail) throw new Error('smtp down'); sink.push(m); return { messageId: '<x@test>' }; } };
}
const deadSms = { live: false, async send() { throw new Error('no carrier'); } };
const liveSms = sink => ({ live: true, async send(phone, code) { sink.push({ phone, code }); } });

test('with no carrier connected the code goes by email, and says so', async () => {
  const store = new Store(':memory:');
  const mail = [];
  const otp = new Otp(store, { secret: 's', sms: deadSms, mailer: fakeMailer(mail), emailFallback: true, devEcho: true });

  const req = await otp.request('+923001234567', { email: 'ali@example.com' });
  assert.strictEqual(req.channel, 'email');
  assert.strictEqual(req.sentTo, 'a*i@example.com', 'the address is masked back to the caller');
  assert.strictEqual(mail.length, 1);
  assert.match(mail[0].subject, new RegExp(req.devCode));
  assert.match(mail[0].text, /expires in 10 minutes/);
  store.close();
});

test('a live carrier is used and email is never touched', async () => {
  const store = new Store(':memory:');
  const sent = [], mail = [];
  const otp = new Otp(store, { secret: 's', sms: liveSms(sent), mailer: fakeMailer(mail), emailFallback: true });

  const req = await otp.request('+923001234567', { email: 'ali@example.com' });
  assert.strictEqual(req.channel, 'sms');
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(mail.length, 0, 'the weaker channel must not be used when the stronger one works');
  store.close();
});

test('the token records which channel carried the code', async () => {
  const store = new Store(':memory:');
  const otp = new Otp(store, { secret: 's', sms: deadSms, mailer: fakeMailer([]), emailFallback: true, devEcho: true });
  const req = await otp.request('+923001234567', { email: 'ali@example.com' });
  const v = otp.verify(req.challengeId, req.devCode);

  assert.strictEqual(v.channel, 'email');
  assert.strictEqual(otp.openToken(v.registrationToken).channel, 'email');
  assert.strictEqual(otp.openToken(v.registrationToken).phone, '+923001234567',
    'the phone is still bound, so it must still match the form');
  store.close();
});

test('an email-channel token cannot be passed off as an SMS one', async () => {
  const store = new Store(':memory:');
  const otp = new Otp(store, { secret: 's', sms: deadSms, mailer: fakeMailer([]), emailFallback: true, devEcho: true });
  const req = await otp.request('+923001234567', { email: 'ali@example.com' });
  const { registrationToken } = otp.verify(req.challengeId, req.devCode);

  // Rewrite the channel in the payload and keep the original signature.
  const [payload, sig] = registrationToken.split('.');
  const forged = Buffer.from(Buffer.from(payload, 'base64url').toString('utf8').replace('email.', 'sms...')).toString('base64url') + '.' + sig;
  assert.throws(() => otp.openToken(forged), /invalid/);
  store.close();
});

test('when the fallback is off, a dead carrier fails cleanly and frees the applicant to retry', async () => {
  const store = new Store(':memory:');
  const otp = new Otp(store, { secret: 's', sms: deadSms, mailer: fakeMailer([]), emailFallback: false, resendCooldownMs: 60_000 });
  await assert.rejects(() => otp.request('+923001234567', { email: 'ali@example.com' }), /could not send/i);
  assert.strictEqual(store.countOtpRequests('+923001234567', 3600_000), 0);
  store.close();
});

test('a broken mail server is not reported as a delivered code', async () => {
  const store = new Store(':memory:');
  const otp = new Otp(store, { secret: 's', sms: deadSms, mailer: fakeMailer([], { fail: true }), emailFallback: true });
  await assert.rejects(() => otp.request('+923001234567', { email: 'ali@example.com' }), /could not send/i);
  assert.strictEqual(store.countOtpRequests('+923001234567', 3600_000), 0);
  store.close();
});

test('without an address there is nothing to fall back to', async () => {
  const store = new Store(':memory:');
  const otp = new Otp(store, { secret: 's', sms: deadSms, mailer: fakeMailer([]), emailFallback: true });
  await assert.rejects(() => otp.request('+923001234567', { email: 'not-an-address' }), /could not send/i);
  store.close();
});
