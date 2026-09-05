'use strict';
/**
 * Registration gate: anti-automation and velocity control.
 *
 * Two mechanisms, chosen because neither needs an external service, an API
 * key, or a round trip to a third party that may be unreachable from a rural
 * assessment centre:
 *
 *  1. Proof of work. The client must find a nonce whose SHA-256 digest with
 *     the issued prefix begins with N zero bits. One submission costs a
 *     browser well under a second; ten thousand scripted submissions cost
 *     real CPU time. Unlike a hosted CAPTCHA it works offline-first, needs no
 *     vendor, and does not exclude users on slow connections.
 *
 *  2. Velocity caps, applied per IP, per phone and per district. Bulk ghost
 *     registration shows up as volume from one origin long before it shows up
 *     in any individual record.
 *
 * A honeypot field is checked by the route: naive bots fill every input.
 */
const crypto = require('node:crypto');

const DEFAULT_TTL_MS = 15 * 60 * 1000;

/** Number with a default, preserving an explicit 0 (which `||` would discard). */
function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }


class Gate {
  /**
   * @param {object} store   registry store (for velocity counters)
   * @param {object} opts    { difficulty, ttlMs, perIpHour, perPhoneDay, perDistrictHour, enabled }
   */
  constructor(store, opts = {}) {
    this.store = store;
    this.difficulty = num(opts.difficulty, 18);      // leading zero BITS
    this.ttlMs = num(opts.ttlMs, DEFAULT_TTL_MS);
    this.perIpHour = num(opts.perIpHour, 10);
    this.perPhoneDay = num(opts.perPhoneDay, 3);
    this.perDistrictHour = num(opts.perDistrictHour, 200);
    this.enabled = opts.enabled !== false;
    this.secret = opts.secret || crypto.randomBytes(32).toString('hex');
  }

  /** Issue a proof-of-work challenge. Stateless: the prefix is self-signed. */
  challenge() {
    const issuedAt = Date.now();
    const nonce = crypto.randomBytes(12).toString('hex');
    const prefix = `${issuedAt}.${nonce}`;
    const sig = crypto.createHmac('sha256', this.secret).update(prefix).digest('hex').slice(0, 32);
    return {
      challenge: `${prefix}.${sig}`,
      difficulty: this.difficulty,
      algorithm: 'sha256-leading-zero-bits',
      expiresIn: Math.floor(this.ttlMs / 1000),
      hint: 'find an integer nonce where sha256(challenge + "." + nonce) begins with `difficulty` zero bits'
    };
  }

  /** Verify a solved challenge. Throws GateError on failure. */
  verifyChallenge(challenge, nonce) {
    if (!this.enabled) return true;
    if (typeof challenge !== 'string' || !/^\d+\.[0-9a-f]{24}\.[0-9a-f]{32}$/.test(challenge)) {
      throw new GateError('invalid challenge');
    }
    const [issuedAt, rnd, sig] = challenge.split('.');
    const expect = crypto.createHmac('sha256', this.secret).update(`${issuedAt}.${rnd}`).digest('hex').slice(0, 32);
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) throw new GateError('challenge signature invalid');
    if (Date.now() - Number(issuedAt) > this.ttlMs) throw new GateError('challenge expired, request a new one');
    if (!/^\d{1,20}$/.test(String(nonce ?? ''))) throw new GateError('nonce must be an integer');

    const digest = crypto.createHash('sha256').update(`${challenge}.${nonce}`).digest();
    if (leadingZeroBits(digest) < this.difficulty) throw new GateError('proof of work is insufficient');

    // Single use: replay of a solved challenge is refused.
    if (this.store.gateChallengeSeen(challenge)) throw new GateError('challenge already used');
    this.store.recordGateChallenge(challenge);
    return true;
  }

  /**
   * Velocity checks. Throws GateError when a cap is exceeded.
   * Caps are deliberately generous for a shared assessment-centre IP but tight
   * per phone, because a phone is the scarcer resource for a fraudster.
   */
  checkVelocity({ ip, phone, district }) {
    if (!this.enabled) return true;
    if (ip) {
      const n = this.store.countRecentRegistrations({ ip, sinceMs: 60 * 60 * 1000 });
      if (n >= this.perIpHour) throw new GateError('too many registrations from this connection in the last hour', 429);
    }
    if (phone) {
      const n = this.store.countRecentRegistrations({ phone, sinceMs: 24 * 60 * 60 * 1000 });
      if (n >= this.perPhoneDay) throw new GateError('this mobile number has reached its registration limit for today', 429);
    }
    if (district) {
      const n = this.store.countRecentRegistrations({ district, sinceMs: 60 * 60 * 1000 });
      if (n >= this.perDistrictHour) throw new GateError('registration volume for this district is unusually high; please try again shortly', 429);
    }
    return true;
  }
}

class GateError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function leadingZeroBits(buf) {
  let bits = 0;
  for (const byte of buf) {
    if (byte === 0) { bits += 8; continue; }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

module.exports = { Gate, GateError, leadingZeroBits };
