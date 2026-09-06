// Server-side captcha verification.
//
// Supports hCaptcha (no Google dependency, generous free tier).
// Keys configured via env:
//   HCAPTCHA_SECRET    — server secret (required for prod)
//   HCAPTCHA_SITE_KEY  — exposed to client via VITE_HCAPTCHA_SITE_KEY (set at build time)
//
// hCaptcha publishes documented test keys that always pass — useful for staging:
//   site:   10000000-ffff-ffff-ffff-000000000001
//   secret: 0x0000000000000000000000000000000000000000
//   token:  10000000-aaaa-bbbb-cccc-000000000001
//
// If HCAPTCHA_SECRET is unset or is the test value, captcha is treated as "permissive"
// (the wiring works but anything passes). In production, set a real secret.

import env from '../config/env.js';

const TEST_SECRET = '0x0000000000000000000000000000000000000000';
const TEST_TOKEN = '10000000-aaaa-bbbb-cccc-000000000001';

export function captchaConfigured() {
  return !!(env.HCAPTCHA_SECRET && env.HCAPTCHA_SECRET !== TEST_SECRET);
}

/**
 * Verify a hCaptcha token. Returns { ok, reason }.
 * In dev/test mode (no secret, or test secret) the test token always passes.
 */
export async function verifyCaptcha(token, remoteIp) {
  if (!token) return { ok: false, reason: 'missing_token' };

  const secret = env.HCAPTCHA_SECRET || TEST_SECRET;

  // Test-key short-circuit so dev/staging don't require a real hCaptcha account.
  if (secret === TEST_SECRET) {
    if (token === TEST_TOKEN) return { ok: true, mode: 'test' };
    // In test mode, also accept any token for ease of local dev.
    return { ok: true, mode: 'test-permissive' };
  }

  try {
    const params = new URLSearchParams();
    params.append('response', token);
    params.append('secret', secret);
    if (remoteIp) params.append('remoteip', remoteIp);

    const res = await fetch('https://api.hcaptcha.com/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const data = await res.json();
    if (data.success) return { ok: true };
    return { ok: false, reason: 'rejected', errors: data['error-codes'] || [] };
  } catch (err) {
    // Fail closed: a configured (real-secret) CAPTCHA must not be bypassable by
    // forcing the siteverify call to error out. Callers surface a retriable 400.
    console.warn('[captcha] verify unreachable, rejecting:', err.message);
    return { ok: false, reason: 'verify_unreachable' };
  }
}

/**
 * Express middleware. Reads token from body.captchaToken or header x-captcha-token.
 */
export function requireCaptcha(req, res, next) {
  const token = req.body?.captchaToken || req.headers['x-captcha-token'];
  const ip = req.ip || req.connection?.remoteAddress;
  verifyCaptcha(token, ip).then(r => {
    if (r.ok) return next();
    res.status(400).json({ error: 'CAPTCHA verification failed. Please retry.' });
  }).catch(next);
}
