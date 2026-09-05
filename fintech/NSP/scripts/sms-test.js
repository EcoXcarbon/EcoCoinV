#!/usr/bin/env node
'use strict';
/**
 * Prove the SMS gateway before trusting the registration gate to it.
 *
 *   npm run sms:test -- +923001234567
 *
 * Reads the same .env the service does, sends one real message through the
 * configured provider, and prints what the carrier said. Nothing is written to
 * the registry; the delivery attempt is recorded in the SMS log like any other.
 */
const config = require('../server/config');
const { SmsGateway, maskPhone } = require('../server/lib/sms');
const { Store } = require('../server/lib/store');
const crypto = require('node:crypto');

const phone = (process.argv[2] || '').replace(/[\s()-]/g, '');

if (!/^\+\d{8,15}$/.test(phone)) {
  console.error('Usage: npm run sms:test -- +923001234567   (E.164, with the country code)');
  process.exit(2);
}

(async () => {
  const store = new Store(config.dbFile);
  const sms = new SmsGateway(config.sms, store);
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');

  console.log(`provider      ${sms.name}${sms.live ? '' : '   (not a real carrier — codes go to the journal only)'}`);
  console.log(`number format ${sms.numberFormat}`);
  console.log(`sending to    ${maskPhone(phone)}`);
  console.log(`message       ${sms.message(code)}`);
  console.log('');

  const t0 = Date.now();
  try {
    const out = await sms.send(phone, code);
    console.log(`✓ accepted by ${out.provider} in ${Date.now() - t0} ms after ${out.attempts} attempt(s)`);
    if (out.messageId) console.log(`  message id  ${out.messageId}`);
    console.log('');
    console.log(`The handset should show code ${code}. If it does not arrive within a minute the`);
    console.log('gateway accepted it but the carrier dropped it — check your sender mask/brand');
    console.log('registration with the aggregator, which is the usual cause in Pakistan.');
  } catch (err) {
    console.error(`✗ ${err.message}`);
    const health = store.smsHealth({ limit: 5 });
    if (health.lastFailures.length) {
      console.error('\nrecent failures:');
      for (const f of health.lastFailures) console.error(`  ${f.at}  ${f.provider}  attempt ${f.attempt}  ${f.error}`);
    }
    process.exitCode = 1;
  } finally {
    store.close();
  }
})();
