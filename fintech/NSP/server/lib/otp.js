'use strict';
/**
 * Mobile OTP proofing.
 *
 * Why a mobile number is the right first gate in Pakistan: the PTA requires
 * biometric verification against NADRA records before a SIM is issued, so a
 * live Pakistani mobile number is already weakly bound to a CNIC. Without any
 * NADRA integration of our own, proving control of a number is the strongest
 * identity signal available at zero marginal cost.
 *
 * It is a proof of CONTROL, not of identity. A verified number establishes
 * assurance tier NSP-1 only. NSP-2 still requires a registrar to sight the
 * physical document at the desk.
 *
 * Codes are stored as salted hashes with a per-challenge attempt counter, so a
 * leaked database does not yield live codes and guessing is bounded.
 */
const crypto = require('node:crypto');

const CODE_LENGTH = 6;

/** Number with a default, preserving an explicit 0 (which `||` would discard). */
function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }


class OtpError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

class Otp {
  /**
   * @param {object} store
   * @param {object} opts { ttlMs, maxAttempts, resendCooldownMs, perPhoneHour, secret, sms, devEcho }
   */
  constructor(store, opts = {}) {
    this.store = store;
    this.ttlMs = num(opts.ttlMs, 10 * 60 * 1000);
    this.maxAttempts = num(opts.maxAttempts, 5);
    this.resendCooldownMs = num(opts.resendCooldownMs, 60 * 1000);
    this.perPhoneHour = num(opts.perPhoneHour, 3);
    this.tokenTtlMs = num(opts.tokenTtlMs, 30 * 60 * 1000);
    this.secret = opts.secret;
    this.sms = opts.sms;
    this.devEcho = !!opts.devEcho;
  }

  async request(phone, { ip } = {}) {
    if (!/^\+\d{8,15}$/.test(String(phone || ''))) throw new OtpError('mobile number must be in E.164 form, e.g. +923001234567');

    const recent = this.store.countOtpRequests(phone, 60 * 60 * 1000);
    if (recent >= this.perPhoneHour) throw new OtpError('too many codes requested for this number; try again later', 429);

    const last = this.store.lastOtpRequestAt(phone);
    if (last && Date.now() - Date.parse(last) < this.resendCooldownMs) {
      throw new OtpError('a code was just sent; wait before requesting another', 429);
    }

    const code = String(crypto.randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
    const salt = crypto.randomBytes(16).toString('hex');
    const id = crypto.randomUUID();
    this.store.insertOtp({
      id, phone, salt,
      codeHash: hashCode(code, salt, this.secret),
      expiresAt: new Date(Date.now() + this.ttlMs).toISOString(),
      ip: ip || null
    });

    try {
      await this.sms.send(phone, code);
    } catch (err) {
      // The carrier refused it, so the applicant never got a code. Drop the
      // challenge rather than leave it standing: otherwise a gateway outage
      // silently burns their hourly allowance and the resend cooldown, and
      // they are locked out of registering for an hour through no fault of
      // their own.
      this.store.discardOtp(id);
      throw new OtpError('We could not send the verification code just now. Please try again in a moment.', 502);
    }

    return {
      challengeId: id,
      expiresIn: Math.floor(this.ttlMs / 1000),
      // Only ever populated when the operator has explicitly enabled echo for
      // a non-production environment. Never set when a real gateway is used.
      devCode: this.devEcho ? code : undefined
    };
  }

  verify(challengeId, code) {
    const row = this.store.getOtp(challengeId);
    if (!row) throw new OtpError('unknown or expired code request');
    if (row.consumed) throw new OtpError('this code has already been used');
    if (Date.parse(row.expiresAt) < Date.now()) throw new OtpError('code expired, request a new one');
    if (row.attempts >= this.maxAttempts) throw new OtpError('too many incorrect attempts; request a new code', 429);

    this.store.bumpOtpAttempts(challengeId);
    const expect = Buffer.from(row.codeHash, 'hex');
    const got = Buffer.from(hashCode(String(code || ''), row.salt, this.secret), 'hex');
    if (expect.length !== got.length || !crypto.timingSafeEqual(expect, got)) {
      throw new OtpError('incorrect code');
    }

    this.store.consumeOtp(challengeId);

    // Short-lived bearer token proving this phone was verified. Carried into
    // POST /registrations, where the payload's phone must match.
    const exp = Date.now() + this.tokenTtlMs;
    const body = `${row.phone}.${exp}`;
    const sig = crypto.createHmac('sha256', this.secret).update(body).digest('hex');
    return {
      registrationToken: `${Buffer.from(body).toString('base64url')}.${sig}`,
      phone: row.phone,
      expiresIn: Math.floor(this.tokenTtlMs / 1000)
    };
  }

  /** Returns the verified phone, or throws. */
  openToken(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 2) throw new OtpError('mobile verification token is malformed', 401);
    let body;
    try { body = Buffer.from(parts[0], 'base64url').toString('utf8'); }
    catch { throw new OtpError('mobile verification token is malformed', 401); }
    const expect = crypto.createHmac('sha256', this.secret).update(body).digest('hex');
    const a = Buffer.from(parts[1]), b = Buffer.from(expect);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new OtpError('mobile verification token is invalid', 401);
    const [phone, exp] = body.split('.');
    if (Number(exp) < Date.now()) throw new OtpError('mobile verification expired; verify your number again', 401);
    if (this.store.registrationTokenUsed(parts[1])) throw new OtpError('this mobile verification has already been used', 401);
    return { phone, signature: parts[1] };
  }

  consumeToken(signature) { this.store.useRegistrationToken(signature); }
}

function hashCode(code, salt, secret) {
  return crypto.createHmac('sha256', secret).update(`${salt}.${code}`).digest('hex');
}

// Re-exported so existing callers keep working; the gateway itself lives in
// lib/sms.js, which adds retries, failover and delivery logging.
const { createSmsProvider } = require('./sms');

module.exports = { Otp, OtpError, createSmsProvider };
