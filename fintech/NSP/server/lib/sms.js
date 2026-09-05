'use strict';
/**
 * SMS delivery for the registration gate.
 *
 * Four drivers, chosen to cover how SMS is actually bought in Pakistan:
 *
 *   log       writes the code to the service journal. Development, and a
 *             supervised desk where the operator reads the journal.
 *   twilio    the international fallback. Reliable, but A2P delivery into
 *             Pakistan is restricted and priced per message.
 *   http      a fully declarative driver for local aggregators. Almost every
 *             Pakistani provider — Veevo Tech, BulkSMS.pk, Telenor and Jazz
 *             corporate gateways, the smaller resellers — is a single GET or
 *             POST carrying an id, a password, a sender mask, the number and
 *             the text. Rather than guess at each vendor's exact endpoint and
 *             ship drivers that rot, the URL, method, body and success test
 *             are configuration. See .env.example for worked shapes.
 *   webhook   POSTs {to, message} as JSON to something you already run.
 *
 * Everything a driver does is wrapped by send(): a timeout, bounded retries
 * with backoff, optional failover to a second provider, and a delivery record.
 * The verification code itself is NEVER written to the delivery log or to the
 * journal by anything other than the log driver — the log is about whether the
 * carrier accepted the message, not what was in it.
 */
const crypto = require('node:crypto');

class SmsError extends Error {
  constructor(message, status = 502, { retryable = true } = {}) {
    super(message); this.status = status; this.retryable = retryable;
  }
}

/** +923001234567 → 923001234567 / 03001234567, for gateways that reject "+". */
function formatNumber(e164, format) {
  const digits = String(e164).replace(/\D/g, '');
  switch (format) {
    case 'plain': return digits;                                  // 923001234567
    case 'local': return digits.replace(/^92/, '0');              // 03001234567
    case 'e164':
    default: return '+' + digits;
  }
}

/** Never put a subscriber's full number in a log line. */
function maskPhone(e164) {
  const s = String(e164 || '');
  return s.length > 6 ? s.slice(0, 4) + '*'.repeat(s.length - 6) + s.slice(-2) : '***';
}

/** Substitute {to}, {message}, {sender} — URL-encoded unless the field is a raw body. */
function fill(template, vars, encode) {
  return String(template).replace(/\{(to|message|sender)\}/g, (_, k) => {
    const v = vars[k] ?? '';
    return encode ? encodeURIComponent(v) : v;
  });
}

// ── drivers ──────────────────────────────────────────────────────────
// Each returns { name, async deliver(to, message) -> { id, raw } } and throws
// SmsError on refusal. They know nothing about retries or logging.

function logDriver() {
  return {
    name: 'log',
    live: false,
    async deliver(to, message) {
      console.log(`[sms:log] ${to} :: ${message}`);
      return { id: 'log-' + crypto.randomBytes(6).toString('hex') };
    }
  };
}

function twilioDriver(cfg) {
  if (!cfg.twilioSid || !cfg.twilioToken || !cfg.sender) {
    throw new Error('twilio driver needs NSP_SMS_TWILIO_SID, NSP_SMS_TWILIO_TOKEN and NSP_SMS_SENDER');
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.twilioSid)}/Messages.json`;
  const auth = 'Basic ' + Buffer.from(`${cfg.twilioSid}:${cfg.twilioToken}`).toString('base64');
  return {
    name: 'twilio',
    live: true,
    async deliver(to, message) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { authorization: auth, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: to, From: cfg.sender, Body: message }),
        signal: AbortSignal.timeout(cfg.timeoutMs)
      });
      const body = await res.text();
      if (!res.ok) {
        // 4xx from Twilio is a bad number, a bad key or an unfunded account:
        // retrying cannot help, and would burn the applicant's cooldown.
        throw new SmsError(`twilio rejected the message (${res.status})`, 502, { retryable: res.status >= 500 || res.status === 429 });
      }
      let id = null;
      try { id = JSON.parse(body).sid; } catch { /* keep the raw body instead */ }
      return { id, raw: body.slice(0, 500) };
    }
  };
}

function httpDriver(cfg) {
  if (!cfg.url) throw new Error('http driver needs NSP_SMS_URL');
  const method = (cfg.method || 'GET').toUpperCase();
  if (method !== 'GET' && !cfg.body) throw new Error('http driver with a non-GET method needs NSP_SMS_BODY');
  const ok = cfg.successPattern ? new RegExp(cfg.successPattern, 'i') : null;
  return {
    name: 'http',
    live: true,
    async deliver(to, message) {
      const vars = { to, message, sender: cfg.sender || '' };
      // The URL is always percent-encoded; a body is encoded only when it is
      // being sent as a query string, since JSON needs its own escaping.
      const isForm = /x-www-form-urlencoded/i.test(cfg.contentType || '');
      const url = fill(cfg.url, vars, true);
      const init = { method, headers: { ...cfg.headers }, signal: AbortSignal.timeout(cfg.timeoutMs) };
      if (method !== 'GET') {
        init.headers['content-type'] = cfg.contentType || 'application/x-www-form-urlencoded';
        init.body = isForm ? fill(cfg.body, vars, true) : fill(cfg.body, vars, false);
      }
      const res = await fetch(url, init);
      const text = (await res.text()).slice(0, 1000);
      if (!res.ok) throw new SmsError(`SMS gateway returned ${res.status}`, 502, { retryable: res.status >= 500 || res.status === 429 });
      // Most Pakistani gateways answer 200 with a status word in the body, so
      // an HTTP 200 alone does not mean the message was accepted.
      if (ok && !ok.test(text)) throw new SmsError('SMS gateway did not report success', 502, { retryable: false });
      return { id: null, raw: text.slice(0, 500) };
    }
  };
}

function webhookDriver(cfg) {
  if (!cfg.webhookUrl) throw new Error('webhook driver needs NSP_SMS_WEBHOOK_URL');
  return {
    name: 'webhook',
    live: true,
    async deliver(to, message) {
      const res = await fetch(cfg.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cfg.webhookAuth ? { authorization: cfg.webhookAuth } : {}) },
        body: JSON.stringify({ to, message }),
        signal: AbortSignal.timeout(cfg.timeoutMs)
      });
      const text = (await res.text()).slice(0, 500);
      if (!res.ok) throw new SmsError(`SMS webhook returned ${res.status}`, 502, { retryable: res.status >= 500 || res.status === 429 });
      return { id: null, raw: text };
    }
  };
}

const DRIVERS = { log: logDriver, twilio: twilioDriver, http: httpDriver, webhook: webhookDriver };

function buildDriver(name, cfg) {
  const make = DRIVERS[String(name || 'log').toLowerCase()];
  if (!make) throw new Error(`unknown SMS provider "${name}" (expected one of ${Object.keys(DRIVERS).join(', ')})`);
  return make(cfg);
}

/**
 * The gateway the OTP service talks to: one driver, an optional fallback, and
 * the operational behaviour around both.
 */
class SmsGateway {
  /**
   * @param {object} cfg   config.sms
   * @param {object} store optional; when present every attempt is recorded
   */
  constructor(cfg = {}, store = null) {
    this.cfg = { timeoutMs: 15_000, retryDelayMs: 750, ttlMinutes: 10, ...cfg };
    this.cfg.timeoutMs = Number(this.cfg.timeoutMs) || 15_000;
    this.cfg.retryDelayMs = Number(this.cfg.retryDelayMs) || 750;
    cfg = this.cfg;
    this.store = store;
    this.driver = buildDriver(cfg.provider, cfg);
    this.fallback = cfg.fallbackProvider ? buildDriver(cfg.fallbackProvider, cfg) : null;
    this.attempts = Math.max(1, Number(cfg.attempts) || 3);
    this.numberFormat = cfg.numberFormat || 'e164';
  }

  /** True when a real carrier is behind this, i.e. codes are not readable locally. */
  get live() { return this.driver.live; }
  get name() { return this.fallback ? `${this.driver.name}+${this.fallback.name}` : this.driver.name; }

  message(code) {
    return fill(this.cfg.template || '{code} is your National Skill Passport verification code. It expires in {minutes} minutes. Do not share it with anyone.',
      {}, false)
      .replace(/\{code\}/g, code)
      .replace(/\{minutes\}/g, String(this.cfg.ttlMinutes || 10));
  }

  /**
   * Send a verification code. Resolves on acceptance, throws SmsError when
   * every attempt against every configured driver has failed.
   */
  async send(phone, code) {
    const to = formatNumber(phone, this.numberFormat);
    const text = this.message(code);
    const drivers = this.fallback ? [this.driver, this.fallback] : [this.driver];
    let last = null;

    for (const driver of drivers) {
      for (let attempt = 1; attempt <= this.attempts; attempt++) {
        const t0 = Date.now();
        try {
          const out = await driver.deliver(to, text);
          this.record({ phone, provider: driver.name, status: 'SENT', attempt, ms: Date.now() - t0, messageId: out.id || null });
          return { provider: driver.name, messageId: out.id || null, attempts: attempt };
        } catch (err) {
          last = err;
          const retryable = !(err instanceof SmsError) || err.retryable !== false;
          this.record({
            phone, provider: driver.name, status: 'FAILED', attempt, ms: Date.now() - t0,
            error: (err.name === 'TimeoutError' ? 'timed out' : err.message || String(err)).slice(0, 300)
          });
          if (!retryable || attempt === this.attempts) break;
          await new Promise(r => setTimeout(r, this.cfg.retryDelayMs * attempt));
        }
      }
    }
    throw new SmsError(
      `could not send the verification code (${maskPhone(phone)}): ${last ? last.message : 'no provider configured'}`,
      502
    );
  }

  record(row) {
    if (!this.store || typeof this.store.recordSmsDelivery !== 'function') return;
    try { this.store.recordSmsDelivery(row); } catch (e) { console.error('[sms] could not record delivery:', e.message); }
  }
}

/**
 * Backwards-compatible shim for the original two-provider helper. New code
 * should construct SmsGateway, which adds retries, failover and logging.
 */
function createSmsProvider(name, cfg = {}) {
  const gateway = new SmsGateway({ ...cfg, provider: name, fallbackProvider: null }, cfg.store || null);
  return { name: gateway.driver.name, send: (phone, code) => gateway.send(phone, code) };
}

module.exports = { SmsGateway, SmsError, createSmsProvider, formatNumber, maskPhone, buildDriver };
