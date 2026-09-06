import AuditLog from '../models/AuditLog.js';

/**
 * Audit logging middleware for sensitive operations.
 * Persists to MongoDB with TTL auto-cleanup (1 year).
 */
const SENSITIVE_PARAMS = new Set(['password', 'token', 'secret', 'cnic', 'refreshToken', 'mfaSecret', 'mfaBackupCodes', 'resetPasswordToken', 'emailVerificationToken']);

function redactParams(params) {
  if (!params || typeof params !== 'object') return params;
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    out[k] = SENSITIVE_PARAMS.has(k) ? '[REDACTED]' : v;
  }
  return out;
}

export function auditLog(action) {
  return (req, res, next) => {
    const entry = {
      action,
      userId: req.user?._id?.toString() || 'anonymous',
      userRole: req.user?.role || 'unknown',
      userEmail: req.user?.email || 'unknown',
      method: req.method,
      path: req.originalUrl,
      ip: req.ip || req.connection?.remoteAddress,
      params: redactParams(req.params),
      timestamp: new Date(),
    };

    // Persist to MongoDB (fire-and-forget, don't block the request)
    AuditLog.create(entry).catch(err => {
      console.error('[AUDIT] Failed to persist audit log:', err.message);
    });

    console.log(`[AUDIT] ${entry.timestamp.toISOString()} | ${entry.action} | ${entry.userEmail} (${entry.userRole}) | ${entry.method} ${entry.path} | IP: ${entry.ip}`);

    next();
  };
}

/**
 * Query audit logs from MongoDB.
 */
export async function getAuditLogs({ limit = 100, action, userId, from, to } = {}) {
  const filter = {};
  if (action) filter.action = action;
  if (userId) filter.userId = userId;
  if (from || to) {
    filter.timestamp = {};
    if (from) filter.timestamp.$gte = new Date(from);
    if (to) filter.timestamp.$lte = new Date(to);
  }
  return AuditLog.find(filter).sort({ timestamp: -1 }).limit(limit).lean();
}
