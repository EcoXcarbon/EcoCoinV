'use strict';
const path = require('node:path');
const root = path.join(__dirname, '..');

// Load <NSP root>/.env before any process.env read below. The path is resolved
// from __dirname rather than the working directory so `npm start`, `npm run
// seed` and the scripts in scripts/ all behave the same wherever they are run
// from. Nothing happens if the file is absent.
//
// override is left off (the default) on purpose: values already present in the
// environment win. On the VPS systemd injects /opt/nsp/.env via EnvironmentFile
// before node starts, so this call is a harmless no-op there and cannot quietly
// replace production configuration.
require('dotenv').config({ path: path.join(root, '.env'), quiet: true });

// Number from the environment with a fallback, preserving an explicit 0 —
// which `Number(x) || default` would silently discard.
function num(v, d) { const n = Number(v); return Number.isFinite(n) && String(v ?? '').trim() !== '' ? n : d; }

/** NSP_SMS_HEADERS='{"apikey":"..."}' or 'apikey: x, x-token: y' */
function parseHeaders(v) {
  const raw = String(v || '').trim();
  if (!raw) return {};
  if (raw.startsWith('{')) { try { return JSON.parse(raw); } catch { return {}; } }
  const out = {};
  for (const part of raw.split(',')) {
    const i = part.indexOf(':');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function parseKeys(s) {
  // "registrar:abc123,printer:def456"  ->  Map(key -> actor)
  const m = new Map();
  for (const pair of String(s || '').split(',')) {
    const [name, key] = pair.split(':').map(x => (x || '').trim());
    if (name && key) m.set(key, name);
  }
  return m;
}

const config = {
  port: num(process.env.PORT, 4100),
  host: process.env.HOST || '0.0.0.0',
  publicUrl: (process.env.NSP_PUBLIC_URL || 'http://localhost:4100').replace(/\/$/, ''),
  dbFile: process.env.NSP_DB_FILE || path.join(root, 'data', 'nsp-registry.db'),
  dataDir: path.join(root, 'data'),
  issuer: {
    country: (process.env.NSP_ISSUER_COUNTRY || 'PK').toUpperCase(),
    name: process.env.NSP_ISSUER_NAME || 'National Skill Passport Registry',
    shortName: process.env.NSP_ISSUER_SHORT || 'NSP Registry',
    authority: process.env.NSP_ISSUER_AUTHORITY || 'Power Planning & Monitoring Company (PPMC) — TalentLedger',
    did: process.env.NSP_ISSUER_DID || 'did:web:tl.ppmc.pk',
    registrar: process.env.NSP_REGISTRAR_TITLE || 'Registrar, National Skill Passport'
  },
  cardValidityYears: num(process.env.NSP_CARD_VALIDITY_YEARS, 5),
  registryKeys: parseKeys(process.env.NSP_REGISTRY_KEYS || 'registrar:dev-registrar-key'),
  corsOrigins: (process.env.NSP_CORS_ORIGINS || '*').split(',').map(s => s.trim()),
  rateLimit: { windowMs: 60_000, max: num(process.env.NSP_RATE_LIMIT, 60) },

  // ── registration gate ────────────────────────────────────────────
  // Secret for OTP code hashing, mobile-verification tokens and proof-of-work
  // signatures. Falls back to a per-process random value, which is fine for a
  // single instance but must be set explicitly before running more than one.
  gateSecret: process.env.NSP_GATE_SECRET || require('node:crypto').randomBytes(32).toString('hex'),
  // Master switch. Turning this off leaves registration wide open; intended
  // only for local development.
  gateEnabled: process.env.NSP_GATE_ENABLED !== '0',
  // Four-eyes: the officer who verifies a record cannot also issue it.
  fourEyes: process.env.NSP_FOUR_EYES !== '0',
  // Possible-duplicate score (0-100) at or above which a record is flagged
  // for registrar review. Flagging never blocks registration.
  dedupThreshold: num(process.env.NSP_DEDUP_THRESHOLD, 50),
  pow: {
    difficulty: num(process.env.NSP_POW_DIFFICULTY, 16),   // leading zero bits
    ttlMs: num(process.env.NSP_POW_TTL_MIN, 15) * 60_000
  },
  velocity: {
    perIpHour: num(process.env.NSP_MAX_REG_PER_IP_HOUR, 10),
    perPhoneDay: num(process.env.NSP_MAX_REG_PER_PHONE_DAY, 3),
    perDistrictHour: num(process.env.NSP_MAX_REG_PER_DISTRICT_HOUR, 200)
  },
  otp: {
    ttlMs: num(process.env.NSP_OTP_TTL_MIN, 10) * 60_000,
    tokenTtlMs: num(process.env.NSP_OTP_TOKEN_TTL_MIN, 30) * 60_000,
    maxAttempts: num(process.env.NSP_OTP_MAX_ATTEMPTS, 5),
    resendCooldownMs: num(process.env.NSP_OTP_RESEND_COOLDOWN_SEC, 60) * 1000,
    perPhoneHour: num(process.env.NSP_OTP_PER_PHONE_HOUR, 3),
    // Returns the OTP in the API response. Development only, and it refuses to
    // take effect once a real gateway is configured — see below.
    devEcho: process.env.NSP_OTP_DEV_ECHO === '1' && (process.env.NSP_SMS_PROVIDER || 'log') === 'log'
  },

  // ── SMS gateway ──────────────────────────────────────────────────
  // provider: log | twilio | http | webhook.  "http" is the declarative
  // driver for Pakistani aggregators (Veevo Tech, BulkSMS.pk, Telenor and
  // Jazz corporate gateways): give it the URL, method, body and a pattern
  // that identifies a successful response. See .env.example.
  sms: {
    provider: process.env.NSP_SMS_PROVIDER || 'log',
    fallbackProvider: process.env.NSP_SMS_FALLBACK_PROVIDER || '',
    sender: process.env.NSP_SMS_SENDER || '',
    // Gateways vary: some want +923001234567, some 923001234567, some 03001234567.
    numberFormat: (process.env.NSP_SMS_NUMBER_FORMAT || 'e164').toLowerCase(),
    template: process.env.NSP_SMS_TEMPLATE || '',
    ttlMinutes: num(process.env.NSP_OTP_TTL_MIN, 10),
    attempts: num(process.env.NSP_SMS_ATTEMPTS, 3),
    timeoutMs: num(process.env.NSP_SMS_TIMEOUT_MS, 15_000),
    retryDelayMs: num(process.env.NSP_SMS_RETRY_DELAY_MS, 750),
    // http driver
    url: process.env.NSP_SMS_URL || '',
    method: process.env.NSP_SMS_METHOD || 'GET',
    body: process.env.NSP_SMS_BODY || '',
    contentType: process.env.NSP_SMS_CONTENT_TYPE || '',
    successPattern: process.env.NSP_SMS_SUCCESS_PATTERN || '',
    headers: parseHeaders(process.env.NSP_SMS_HEADERS),
    // twilio driver
    twilioSid: process.env.NSP_SMS_TWILIO_SID || '',
    twilioToken: process.env.NSP_SMS_TWILIO_TOKEN || '',
    // webhook driver
    webhookUrl: process.env.NSP_SMS_WEBHOOK_URL || '',
    webhookAuth: process.env.NSP_SMS_WEBHOOK_AUTH || ''
  }
};

// A live gateway and a code echoed back in the API response are mutually
// exclusive: echoing would hand every caller the OTP and reduce the gate to
// decoration. The refusal is loud rather than silent, because someone who set
// NSP_OTP_DEV_ECHO=1 in production needs to know it did not take effect.
if (process.env.NSP_OTP_DEV_ECHO === '1' && config.sms.provider !== 'log') {
  console.warn(`[config] NSP_OTP_DEV_ECHO=1 ignored: a live SMS provider (${config.sms.provider}) is configured. Codes will only be sent by SMS.`);
}

module.exports = config;
