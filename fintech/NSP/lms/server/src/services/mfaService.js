import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

const ISSUER = 'TalentLedger';

// Standard 30-second TOTP window with ±1 step tolerance (90s total) — accounts for clock drift.
authenticator.options = { window: 1 };

export function generateSecret() {
  return authenticator.generateSecret();
}

export function buildOtpAuthUrl(email, secret) {
  return authenticator.keyuri(email, ISSUER, secret);
}

export async function buildQrDataUrl(otpauthUrl) {
  return QRCode.toDataURL(otpauthUrl, { errorCorrectionLevel: 'M', margin: 1, width: 240 });
}

export function verifyToken(token, secret) {
  if (!token || !secret) return false;
  // Strip whitespace + accept 6-digit code
  const clean = String(token).replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  try {
    return authenticator.verify({ token: clean, secret });
  } catch { return false; }
}

// Recovery codes: 10 single-use codes, displayed once at enrollment.
// Stored as bcrypt hashes so the DB compromise alone doesn't expose them.
export function generateRecoveryCodes(count = 10) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(5).toString('hex'); // 10 chars
    codes.push(raw.match(/.{1,5}/g).join('-')); // "a1b2c-d3e4f"
  }
  return codes;
}

export async function hashRecoveryCodes(codes) {
  return Promise.all(codes.map(c => bcrypt.hash(c, 10)));
}

// Verify a recovery code against the stored hashed list.
// Returns the index of the matched code (or -1) so caller can consume (remove) it.
export async function verifyAndConsumeRecoveryCode(code, hashedList) {
  if (!code) return -1;
  const clean = String(code).replace(/\s+/g, '').toLowerCase();
  for (let i = 0; i < hashedList.length; i++) {
    const ok = await bcrypt.compare(clean, hashedList[i]);
    if (ok) return i;
  }
  return -1;
}
