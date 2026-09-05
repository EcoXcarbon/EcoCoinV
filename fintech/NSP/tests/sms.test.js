'use strict';
/**
 * SMS gateway coverage. A stub HTTP server stands in for a Pakistani
 * aggregator so the declarative `http` driver, the retry/failover behaviour
 * and the delivery log are all exercised without sending a real message.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { SmsGateway, SmsError, formatNumber, maskPhone, buildDriver } = require('../server/lib/sms');
const { Store } = require('../server/lib/store');
const { Otp } = require('../server/lib/otp');

// ── stub aggregator ──────────────────────────────────────────────────
let server, base;
const seen = [];
let behaviour = { status: 200, body: 'OK: queued id=1' };

test.before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      const b = typeof behaviour === 'function' ? behaviour(seen.length) : behaviour;
      res.writeHead(b.status, { 'content-type': 'text/plain' });
      res.end(b.body);
    });
  });
  await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test.beforeEach(() => { seen.length = 0; behaviour = { status: 200, body: 'OK: queued id=1' }; });

const httpCfg = (over = {}) => ({
  provider: 'http', url: `${base}/api/sendsms?id=acct&pass=secret&to={to}&mask={sender}&msg={message}`,
  sender: 'NSP-PK', attempts: 3, retryDelayMs: 1, timeoutMs: 2000, ...over
});

// ── number shapes ────────────────────────────────────────────────────
test('numbers are reshaped for gateways that will not take E.164', () => {
  assert.equal(formatNumber('+923001234567', 'e164'), '+923001234567');
  assert.equal(formatNumber('+923001234567', 'plain'), '923001234567');
  assert.equal(formatNumber('+923001234567', 'local'), '03001234567');
});

test('masking keeps enough of a number to match a complaint, not enough to dial it', () => {
  const m = maskPhone('+923001234567');
  assert.equal(m, '+923*******67');
  assert.ok(!m.includes('0012345'));
});

// ── the declarative http driver ──────────────────────────────────────
test('http driver builds the aggregator URL and percent-encodes the text', async () => {
  const sms = new SmsGateway(httpCfg({ numberFormat: 'plain' }));
  const out = await sms.send('+923001234567', '123456');

  assert.equal(out.provider, 'http');
  assert.equal(seen.length, 1);
  const url = new URL(base + seen[0].url);
  assert.equal(url.searchParams.get('to'), '923001234567');
  assert.equal(url.searchParams.get('mask'), 'NSP-PK');
  assert.match(url.searchParams.get('msg'), /^123456 is your National Skill Passport verification code/);
  assert.match(url.searchParams.get('msg'), /Do not share it with anyone\.$/);
});

test('a POST gateway sends the configured body with the right content type', async () => {
  const sms = new SmsGateway(httpCfg({
    url: `${base}/send`, method: 'POST',
    contentType: 'application/json',
    body: '{"username":"acct","password":"secret","recipient":"{to}","text":"{message}"}'
  }));
  await sms.send('+923001234567', '654321');
  assert.equal(seen[0].method, 'POST');
  assert.match(seen[0].headers['content-type'], /application\/json/);
  const sent = JSON.parse(seen[0].body);
  assert.equal(sent.recipient, '+923001234567');
  assert.match(sent.text, /654321/);
});

test('custom headers reach the gateway', async () => {
  const sms = new SmsGateway(httpCfg({ headers: { apikey: 'k-123', 'x-account': 'ppmc' } }));
  await sms.send('+923001234567', '111111');
  assert.equal(seen[0].headers.apikey, 'k-123');
  assert.equal(seen[0].headers['x-account'], 'ppmc');
});

test('an HTTP 200 that does not match the success pattern is still a failure', async () => {
  // Pakistani gateways routinely answer 200 with "ERROR: invalid mask".
  behaviour = { status: 200, body: 'ERROR: 105 invalid sender mask' };
  const sms = new SmsGateway(httpCfg({ successPattern: '^OK' }));
  await assert.rejects(() => sms.send('+923001234567', '222222'), SmsError);
  assert.equal(seen.length, 1, 'a rejection the gateway will repeat must not be retried');
});

// ── retries and failover ─────────────────────────────────────────────
test('a 5xx is retried and can succeed on a later attempt', async () => {
  behaviour = n => (n < 3 ? { status: 502, body: 'upstream down' } : { status: 200, body: 'OK: sent' });
  const sms = new SmsGateway(httpCfg({ successPattern: '^OK' }));
  const out = await sms.send('+923001234567', '333333');
  assert.equal(out.attempts, 3);
  assert.equal(seen.length, 3);
});

test('a 4xx is not retried, because the gateway will refuse it again', async () => {
  behaviour = { status: 400, body: 'bad number' };
  const sms = new SmsGateway(httpCfg());
  await assert.rejects(() => sms.send('+923001234567', '444444'), SmsError);
  assert.equal(seen.length, 1);
});

test('failover hands the message to the second provider when the first is exhausted', async () => {
  behaviour = { status: 503, body: 'down' };
  const store = new Store(':memory:');
  const sms = new SmsGateway(httpCfg({ attempts: 2, fallbackProvider: 'log' }), store);
  const out = await sms.send('+923001234567', '555555');
  assert.equal(out.provider, 'log', 'fell back');
  assert.equal(seen.length, 2, 'the primary was tried twice first');

  const health = store.smsHealth();
  assert.equal(health.failed, 2);
  assert.equal(health.sent, 1);
  store.close();
});

// ── the delivery log ─────────────────────────────────────────────────
test('the delivery log records the outcome and never the code', async () => {
  const store = new Store(':memory:');
  const sms = new SmsGateway(httpCfg({ successPattern: '^OK' }), store);
  await sms.send('+923001234567', '999999');

  const health = store.smsHealth();
  assert.equal(health.sent, 1);
  assert.equal(health.successRate, 1);
  assert.equal(health.recent[0].phone, '+923*******67');
  assert.equal(health.recent[0].status, 'SENT');

  const dump = JSON.stringify(store.smsHealth());
  assert.ok(!dump.includes('999999'), 'the verification code must never be persisted');
  assert.ok(!dump.includes('+923001234567'), 'the full number must never be persisted');
  store.close();
});

// ── the message ──────────────────────────────────────────────────────
test('the message template is overridable and stays inside one SMS segment', async () => {
  const sms = new SmsGateway(httpCfg({ template: 'NSP code {code}. Valid {minutes} min.', ttlMinutes: 7 }));
  assert.equal(sms.message('123456'), 'NSP code 123456. Valid 7 min.');
  // The default must fit 160 GSM-7 characters or it is billed as two messages.
  assert.ok(new SmsGateway(httpCfg()).message('123456').length <= 160);
});

// ── misconfiguration is caught at startup, not at 2am ────────────────
test('an incomplete provider configuration fails loudly when it is built', () => {
  assert.throws(() => buildDriver('twilio', {}), /NSP_SMS_TWILIO_SID/);
  assert.throws(() => buildDriver('http', {}), /NSP_SMS_URL/);
  assert.throws(() => buildDriver('webhook', {}), /NSP_SMS_WEBHOOK_URL/);
  assert.throws(() => buildDriver('nonsense', {}), /unknown SMS provider/);
});

// ── the applicant is not punished for our outage ─────────────────────
test('a failed send does not consume the applicant\'s cooldown or hourly cap', async () => {
  behaviour = { status: 503, body: 'down' };
  const store = new Store(':memory:');
  const otp = new Otp(store, {
    secret: 's', perPhoneHour: 3, resendCooldownMs: 60_000,
    sms: new SmsGateway(httpCfg({ attempts: 1 }), store)
  });

  await assert.rejects(() => otp.request('+923001234567'), /could not send the verification code/i);
  assert.equal(store.countOtpRequests('+923001234567', 60 * 60 * 1000), 0,
    'a message that never arrived must not count against the applicant');

  // ...and they can immediately try again, which now works.
  behaviour = { status: 200, body: 'OK' };
  const req = await otp.request('+923001234567');
  assert.ok(req.challengeId);
  store.close();
});
