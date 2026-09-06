// API Gateway & Security Middleware for Talent Ledger
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import ApiKey from '../models/ApiKey.js';

// ── Standardized Error Response Format ──
export const TL_ERRORS = {
  // 1xxx: Authentication/Authorization
  'TL-1001': { status: 401, message: 'Invalid or expired token' },
  'TL-1002': { status: 401, message: 'Token required' },
  'TL-1003': { status: 403, message: 'Not authorized for this action' },
  'TL-1004': { status: 403, message: 'Account locked' },
  'TL-1005': { status: 401, message: 'Invalid API key' },
  // 2xxx: Validation
  'TL-2001': { status: 400, message: 'Invalid CNIC format' },
  'TL-2002': { status: 400, message: 'Required field missing' },
  'TL-2003': { status: 400, message: 'Invalid credential type' },
  'TL-2004': { status: 400, message: 'Invalid date format' },
  // 3xxx: Not Found
  'TL-3001': { status: 404, message: 'Holder not found' },
  'TL-3002': { status: 404, message: 'Credential not found' },
  'TL-3003': { status: 404, message: 'Issuer not found' },
  'TL-3004': { status: 404, message: 'Assessment not found' },
  // 4xxx: Business Logic
  'TL-4001': { status: 400, message: 'Invalid CNIC format' },
  'TL-4002': { status: 404, message: 'Credential not found' },
  'TL-4003': { status: 403, message: 'Issuer not authorized' },
  'TL-4004': { status: 409, message: 'Credential already revoked' },
  'TL-4005': { status: 409, message: 'Holder already registered' },
  'TL-4006': { status: 404, message: 'VC not yet generated' },
  // 5xxx: External Service
  'TL-5001': { status: 502, message: 'NADRA Verisys unavailable' },
  'TL-5002': { status: 502, message: 'Blockchain service unavailable' },
  'TL-5003': { status: 502, message: 'Email service unavailable' },
  // 9xxx: Internal
  'TL-9001': { status: 500, message: 'Internal server error' },
  'TL-9002': { status: 500, message: 'Database error' },
  // Rate limiting
  'TL-1006': { status: 429, message: 'Rate limit exceeded' },
};

export function tlErrorResponse(res, errorCode, details = {}) {
  const err = TL_ERRORS[errorCode] || TL_ERRORS['TL-9001'];
  return res.status(err.status).json({
    error_code: errorCode,
    message: err.message,
    details,
    request_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  });
}

// ── Rate Limiter Factory ───────────────────────────────────────────────────────
// All limiters use IETF-standard RateLimit headers (draft-ietf-httpapi-ratelimit-headers)
// Headers returned: RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After
function makeLimiter({ windowMs, max, keyFn, label }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: 'draft-7', // RateLimit-* headers (IETF draft-7)
    legacyHeaders: false,       // Disable X-RateLimit-* (legacy)
    keyGenerator: keyFn || ((req) => req.ip),
    handler: (req, res, next, options) => {
      const retryAfter = Math.ceil((options.windowMs - (Date.now() % options.windowMs)) / 1000);
      res.set('Retry-After', retryAfter);
      res.status(429).json({
        error_code: 'TL-1006',
        message: `Rate limit exceeded — ${label}`,
        retryAfter,
        limit: max,
        windowSeconds: windowMs / 1000,
        request_id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
      });
    },
  });
}

// ── Role-Based Rate Limiters ──────────────────────────────────────────────────
export const publicVerificationLimiter = makeLimiter({
  windowMs: 60 * 1000, max: 60,  label: '60 req/min for public verification' });

export const authenticatedApiLimiter = makeLimiter({
  windowMs: 60 * 1000, max: 200,
  keyFn: (req) => req.user?._id?.toString() || req.ip,
  label: '200 req/min for authenticated users' });

export const walletSyncLimiter = makeLimiter({
  windowMs: 60 * 1000, max: 10,
  keyFn: (req) => req.user?._id?.toString() || req.ip,
  label: '10 req/min for wallet sync' });

export const bulkOperationLimiter = makeLimiter({
  windowMs: 60 * 1000, max: 5,  label: '5 req/min for bulk operations' });

// ── PII Masking for Logs ──
export function maskPII(data) {
  if (!data) return data;
  const masked = { ...data };
  if (masked.cnic) masked.cnic = masked.cnic.replace(/\d(?=\d{4})/g, '*');
  if (masked.holderCnic) masked.holderCnic = masked.holderCnic.replace(/\d(?=\d{4})/g, '*');
  if (masked.password) masked.password = '[REDACTED]';
  if (masked.privateKey) masked.privateKey = '[REDACTED]';
  if (masked.apiKey) masked.apiKey = masked.apiKey.slice(0, 8) + '...';
  return masked;
}

// ── Request Logging Middleware ──
export function requestLogger(req, res, next) {
  const start = Date.now();
  const originalEnd = res.end;

  res.end = function (...args) {
    const duration = Date.now() - start;
    const logData = {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userId: req.user?._id?.toString(),
    };

    if (duration > 5000) {
      console.warn('[SLOW REQUEST]', logData);
    } else if (res.statusCode >= 500) {
      console.error('[ERROR]', logData);
    }

    originalEnd.apply(res, args);
  };

  next();
}

// ── API Key Authentication (MongoDB-backed, persistent) ──

export async function generateApiKey(consumerId, options = {}) {
  return ApiKey.generateKey(consumerId, options);
}

export async function revokeApiKey(rawKey, revokedBy, reason) {
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  return ApiKey.findOneAndUpdate(
    { keyHash },
    { isActive: false, revokedAt: new Date(), revokedBy, revokedReason: reason },
    { new: true },
  );
}

export function apiKeyAuth(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key) return next(); // passthrough — JWT auth still applies

  ApiKey.authenticate(key, req.ip)
    .then(record => {
      if (!record) return tlErrorResponse(res, 'TL-1005');
      req.apiConsumer = record;
      next();
    })
    .catch(() => tlErrorResponse(res, 'TL-9001'));
}

// ── IP Blacklist ──
const blacklistedIPs = new Set();

export function ipBlacklist(req, res, next) {
  if (blacklistedIPs.has(req.ip)) {
    return res.status(403).json({ error_code: 'TL-1007', message: 'Access denied' });
  }
  next();
}

export function addToBlacklist(ip) { blacklistedIPs.add(ip); }
export function removeFromBlacklist(ip) { blacklistedIPs.delete(ip); }

// ── Health Check ──
export function healthCheck(req, res) {
  res.json({
    status: 'ok',
    version: '1.0.0',
    services: {
      api: 'online',
      database: 'connected',
      blockchain: process.env.BLOCKCHAIN_CHAIN || 'simulated',
    },
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
}

export default {
  tlErrorResponse,
  publicVerificationLimiter,
  authenticatedApiLimiter,
  requestLogger,
  apiKeyAuth,
  ipBlacklist,
  healthCheck,
  maskPII,
  TL_ERRORS,
};
