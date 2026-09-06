import crypto from 'crypto';
import env from '../config/env.js';

const ALGO = 'aes-256-gcm';
const KEY = Buffer.from(env.ENCRYPTION_KEY, 'hex');
const IV_LENGTH = 12;       // GCM recommended IV length
const AUTH_TAG_LENGTH = 16;  // 128-bit auth tag

/**
 * Encrypt using AES-256-GCM (authenticated encryption).
 * Format: iv(hex):authTag(hex):ciphertext(hex)
 * Falls back to decrypting legacy CBC payloads on read.
 */
export function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv, { authTagLength: AUTH_TAG_LENGTH });
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return iv.toString('hex') + ':' + authTag + ':' + encrypted;
}

/**
 * Decrypt AES-256-GCM payload.
 * Supports legacy CBC format (iv:ciphertext — 2 parts) for backward compatibility.
 */
export function decrypt(payload) {
  const parts = payload.split(':');

  // Legacy CBC format: iv:ciphertext (2 parts, iv is 32 hex chars = 16 bytes)
  if (parts.length === 2) {
    const [ivHex, encrypted] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', KEY, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  // GCM format: iv:authTag:ciphertext (3 parts)
  const [ivHex, authTagHex, encrypted] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGO, KEY, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function maskCNIC(cnic) {
  if (!cnic || cnic.length < 5) return '***';
  return '*'.repeat(cnic.length - 4) + cnic.slice(-4);
}

export function hashSHA256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}
