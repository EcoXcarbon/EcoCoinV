// Load .env file in local dev; on Netlify/serverless, env vars come from dashboard
try { await import('dotenv/config'); } catch {}

// ── Required secrets ──────────────────────────────────────────────────────────
const required = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY'];
const missing = required.filter(key => !process.env[key]);

if (process.env.NODE_ENV === 'production' && missing.length) {
  // Hard-fail in production if critical secrets are absent
  console.error(`FATAL: Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
} else if (missing.length) {
  console.warn(`WARNING: Missing environment variables: ${missing.join(', ')}`);
}

// ── Production hardening checks ───────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    console.error('FATAL: JWT_SECRET must be at least 32 characters in production');
    process.exit(1);
  }
  if (process.env.JWT_REFRESH_SECRET && process.env.JWT_REFRESH_SECRET.length < 32) {
    console.error('FATAL: JWT_REFRESH_SECRET must be at least 32 characters in production');
    process.exit(1);
  }
  if (process.env.ENCRYPTION_KEY && !/^[0-9a-fA-F]{64}$/.test(process.env.ENCRYPTION_KEY)) {
    console.error('FATAL: ENCRYPTION_KEY must be a 64-char hex string (32 bytes) in production');
    process.exit(1);
  }
  if (!process.env.MONGODB_URI || process.env.MONGODB_URI.includes('127.0.0.1')) {
    console.warn('WARNING: MONGODB_URI appears to be pointing to localhost in production');
  }
}

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT, 10) || 5000,
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/talentledger',
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  // Dedicated CSRF signing secret; falls back to JWT_SECRET in csrf middleware.
  CSRF_SECRET: process.env.CSRF_SECRET || '',
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173',
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: parseInt(process.env.SMTP_PORT, 10) || 587,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  isProd: process.env.NODE_ENV === 'production',

  // Google OAuth
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
  GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL || '',

  // AI (Anthropic Claude) — optional, degrades gracefully
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
  AI_DAILY_LIMIT: parseInt(process.env.AI_DAILY_LIMIT, 10) || 50,
  AI_MODEL: process.env.AI_MODEL || 'claude-sonnet-4-20250514',
  // Provider: 'anthropic' (direct API key) or 'relay' (VPS Claude-Code relay,
  // subscription-billed via POST <AI_RELAY_URL>/v1/run). Relay needs no API key.
  AI_PROVIDER: (process.env.AI_PROVIDER || 'anthropic').toLowerCase(),
  AI_RELAY_URL: process.env.AI_RELAY_URL || '',        // e.g. http://127.0.0.1:8787
  AI_RELAY_SECRET: process.env.AI_RELAY_SECRET || '',

  // Blockchain — optional, falls back to simulated if not configured
  BLOCKCHAIN_CHAIN: process.env.BLOCKCHAIN_CHAIN || 'simulated',
  BLOCKCHAIN_RPC_URL: process.env.BLOCKCHAIN_RPC_URL || 'https://polygon-rpc.com',
  BLOCKCHAIN_CONTRACT_ADDRESS: process.env.BLOCKCHAIN_CONTRACT_ADDRESS || '',
  BLOCKCHAIN_PRIVATE_KEY: process.env.BLOCKCHAIN_PRIVATE_KEY || '',
  BLOCKCHAIN_MAX_GAS_COST: process.env.BLOCKCHAIN_MAX_GAS_COST || '0.01',

  // hCaptcha — optional; when secret is unset or the published test value,
  // captcha middleware is permissive (wiring works but anything passes).
  HCAPTCHA_SECRET: process.env.HCAPTCHA_SECRET || '',

  // 8x8 JaaS (Jitsi as a Service) — embedded live video. When configured, the
  // server mints a per-room RS256 JWT so teachers join AS moderator and the
  // meeting starts instantly. When UNSET, the client falls back to public
  // meet.jit.si (anonymous — cannot start a meeting; "waiting for moderator").
  //   JAAS_APP_ID      : tenant, e.g. vpaas-magic-cookie-xxxxxxxx
  //   JAAS_KID         : API key id, e.g. vpaas-magic-cookie-xxxxxxxx/abc123
  //   JAAS_PRIVATE_KEY : RSA private key (PEM). Newlines may be escaped as \n,
  //                      or the whole PEM may be base64-encoded.
  JAAS_APP_ID: process.env.JAAS_APP_ID || '',
  JAAS_KID: process.env.JAAS_KID || '',
  JAAS_PRIVATE_KEY: decodePrivateKey(process.env.JAAS_PRIVATE_KEY || ''),
};

// Accept a PEM with literal "\n" escapes, or a base64-encoded PEM blob.
function decodePrivateKey(raw) {
  if (!raw) return '';
  if (raw.includes('BEGIN')) return raw.replace(/\\n/g, '\n');
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    if (decoded.includes('BEGIN')) return decoded;
  } catch { /* fall through */ }
  return raw.replace(/\\n/g, '\n');
}

if (!env.JAAS_APP_ID) {
  console.info('INFO: JAAS_APP_ID not set — live video falls back to public meet.jit.si (anonymous, cannot start meetings)');
}

// Warn if AI key is missing (not fatal — degrades gracefully)
if (!env.ANTHROPIC_API_KEY) {
  console.info('INFO: ANTHROPIC_API_KEY not set — AI features will be disabled');
}

// Warn if blockchain is in simulated mode
if (env.BLOCKCHAIN_CHAIN === 'simulated') {
  console.warn('WARNING: BLOCKCHAIN_CHAIN=simulated — credentials will NOT be anchored on Polygon.');
  if (env.isProd) {
    console.warn('  To enable live anchoring, set BLOCKCHAIN_CHAIN=polygon, BLOCKCHAIN_CONTRACT_ADDRESS, and BLOCKCHAIN_PRIVATE_KEY in .env');
  }
}

// Warn if Google OAuth not configured
if (!env.GOOGLE_CLIENT_ID) {
  console.info('INFO: GOOGLE_CLIENT_ID not set — Google OAuth will be disabled');
}

export default env;
