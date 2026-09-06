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
    this.mailer = opts.mailer || null;
    // Email is a fallback, never a choice the applicant makes: it proves the
    // person reads an inbox, not that they hold a biometrically-issued SIM.
    // Offering it as an option would let anyone take the weaker path.
    this.emailFallback = !!opts.emailFallback;
    this.ttlMs = num(opts.ttlMs, 10 * 60 * 1000);
    this.maxAttempts = num(opts.maxAttempts, 5);
    this.resendCooldownMs = num(opts.resendCooldownMs, 60 * 1000);
    this.perPhoneHour = num(opts.perPhoneHour, 3);
    this.tokenTtlMs = num(opts.tokenTtlMs, 30 * 60 * 1000);
    this.secret = opts.secret;
    this.sms = opts.sms;
    this.devEcho = !!opts.devEcho;
  }

  /**
   * Issue a code for a mobile number. The code goes by SMS; if the SMS
   * gateway is not live or refuses, and an email address was supplied, it goes
   * there instead so the applicant is not stranded. Which channel actually
   * carried it is recorded and returned, because the two prove different
   * things — see verify().
   */
  async request(phone, { ip, email } = {}) {
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
    const canEmail = this.emailFallback && this.mailer && this.mailer.configured && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email || ''));

    this.store.insertOtp({
      id, phone, salt,
      codeHash: hashCode(code, salt, this.secret),
      expiresAt: new Date(Date.now() + this.ttlMs).toISOString(),
      ip: ip || null
    });

    let channel = 'sms';
    let smsError = null;
    // Skip the carrier entirely when it is only a journal writer: pretending
    // to send, then reporting success, is how an outage stays invisible.
    const smsWorthTrying = this.sms && (this.sms.live !== false || !canEmail);
    if (smsWorthTrying) {
      try {
        await this.sms.send(phone, code);
      } catch (err) { smsError = err; }
    } else {
      smsError = new Error('no SMS carrier is connected');
    }

    if (smsError) {
      if (!canEmail) {
        // Nothing carried the code, so the applicant never got one. Drop the
        // challenge rather than leave it standing: otherwise a gateway outage
        // silently burns their hourly allowance and the resend cooldown, and
        // locks them out for an hour through no fault of their own.
        this.store.discardOtp(id);
        throw new OtpError('We could not send the verification code just now. Please try again in a moment.', 502);
      }
      try {
        await this.mailer.send({
          to: email,
          subject: `${code} is your National Skill Passport verification code`,
          text: [
            `Your National Skill Passport verification code is ${code}.`,
            '',
            `It expires in ${Math.round(this.ttlMs / 60000)} minutes. Enter it on the registration form to continue.`,
            '',
            'We sent this by email because SMS delivery is unavailable. Do not share this code with anyone.',
            'If you did not start a registration, ignore this message — no application has been created.'
          ].join('\n')
        });
        channel = 'email';
      } catch (mailErr) {
        this.store.discardOtp(id);
        throw new OtpError('We could not send the verification code just now. Please try again in a moment.', 502);
      }
    }

    this.store.setOtpChannel(id, channel, channel === 'email' ? email : phone);

    return {
      challengeId: id,
      channel,
      sentTo: channel === 'email' ? maskEmail(email) : maskPhone(phone),
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

    // Short-lived bearer token proving this contact was verified. Carried into
    // POST /registrations, where the payload's phone must match. The channel
    // is signed into the token: a code read out of an inbox proves the person
    // reads that inbox, and nothing whatsoever about the phone number they
    // typed, so the two cannot be allowed to look alike downstream.
    const exp = Date.now() + this.tokenTtlMs;
    const channel = row.channel || 'sms';
    const body = `${channel}.${row.phone}.${exp}`;
    const sig = crypto.createHmac('sha256', this.secret).update(body).digest('hex');
    return {
      registrationToken: `${Buffer.from(body).toString('base64url')}.${sig}`,
      phone: row.phone,
      channel,
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
    const [channel, phone, exp] = body.split('.');
    if (Number(exp) < Date.now()) throw new OtpError('contact verification expired; request a new code', 401);
    if (this.store.registrationTokenUsed(parts[1])) throw new OtpError('this verification has already been used', 401);
    return { phone, channel: channel || 'sms', signature: parts[1] };
  }

  consumeToken(signature) { this.store.useRegistrationToken(signature); }
}

/** d***r.k***l@gmail.com — enough to recognise, not enough to harvest. */
function maskEmail(e) {
  const [u, d] = String(e || '').split('@');
  if (!d) return '***';
  return `${u.slice(0, 1)}${'*'.repeat(Math.max(1, u.length - 2))}${u.slice(-1)}@${d}`;
}
function maskPhone(p) {
  const s = String(p || '');
  return s.length > 6 ? s.slice(0, 4) + '*'.repeat(s.length - 6) + s.slice(-2) : '***';
}

function hashCode(code, salt, secret) {
  return crypto.createHmac('sha256', secret).update(`${salt}.${code}`).digest('hex');
}

// Re-exported so existing callers keep working; the gateway itself lives in
// lib/sms.js, which adds retries, failover and delivery logging.
const { createSmsProvider } = require('./sms');

module.exports = { Otp, OtpError, createSmsProvider };
