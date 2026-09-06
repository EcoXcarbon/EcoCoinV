import crypto from 'crypto';
import env from '../config/env.js';

/**
 * CSRF protection strategy:
 *
 * 1. Routes with a JWT Authorization header are inherently CSRF-safe because
 *    browsers cannot set custom headers on cross-origin requests.
 * 2. Cookie-only routes (e.g. /auth/refresh) use a double-submit token that is
 *    ALSO HMAC-signed with a server secret. Signing makes the token
 *    tamper-resistant: an attacker who can plant a cookie (e.g. via a
 *    subdomain) still can't forge a value that passes verification without the
 *    secret, closing the classic double-submit cookie-injection gap.
 * 3. Auth routes (login/register/etc.) are exempt — protected by rate limiting.
 */

const COOKIE_NAME = 'csrf-token';
const HEADER_NAME = 'x-csrf-token';
// Dedicated secret if provided, else fall back to the JWT secret so the
// mechanism still works out of the box.
const CSRF_SECRET = env.CSRF_SECRET || env.JWT_SECRET || 'talentledger-csrf-dev-secret';

function sign(raw) {
  return crypto.createHmac('sha256', CSRF_SECRET).update(raw).digest('hex');
}

function issueToken() {
  const raw = crypto.randomBytes(32).toString('hex');
  return `${raw}.${sign(raw)}`;
}

// Constant-time verification that a token was minted by this server.
function isWellFormed(token) {
  if (typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const raw = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(raw);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Mint a CSRF token and set its cookie.
 *
 * The cookie used to expire after 1h while the refresh token lives 7d, so a
 * student who kept the tab open past the hour hit "CSRF token missing" on the
 * next /auth/refresh — a 403 the client turned into a forced logout. It now
 * tracks the refresh-token lifetime, and every refresh re-issues it.
 */
export function issueCsrfCookie(res) {
  const token = issueToken();
  res.cookie(COOKIE_NAME, token, {
    httpOnly: false, // must be readable by JS to echo back in the header
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
  return token;
}

export function csrfTokenRoute(req, res) {
  res.json({ csrfToken: issueCsrfCookie(res) });
}

// Exact relative paths (the '/api' mount prefix is stripped before this
// middleware runs). Exact matching — never suffix matching — so a route that
// merely *ends with* one of these can't be silently exempted.
const EXEMPT_PATHS = new Set([
  '/auth/login', '/auth/register', '/auth/verify-email', '/auth/resend-verification',
  '/auth/forgot-password', '/auth/reset-password', '/auth/mfa/login-verify',
  '/v1/auth/login', '/v1/auth/register', '/v1/auth/verify-email', '/v1/auth/resend-verification',
  '/v1/auth/forgot-password', '/v1/auth/reset-password', '/v1/auth/mfa/login-verify',
]);

export function csrfProtection(req, res, next) {
  // Skip safe methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  // Skip auth routes (login/register/verify are rate-limited, not cookie-based)
  if (EXEMPT_PATHS.has(req.path)) return next();

  // Public training self-enrolment gate (like register — a public form).
  if (/\/training\/[a-f0-9]{24}\/join$/.test(req.path)) return next();

  // If request has a JWT Authorization header, it's already CSRF-safe
  // (browsers can't set custom Authorization headers cross-origin)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) return next();

  // For cookie-only authenticated routes (e.g. /auth/refresh), verify CSRF token
  const cookieToken = req.cookies?.[COOKIE_NAME];
  // A duplicated header arrives as an array; coerce to the first value.
  const rawHeader = req.headers[HEADER_NAME];
  const headerToken = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

  if (!cookieToken || !headerToken) {
    return res.status(403).json({ error: 'CSRF token missing' });
  }

  // Double-submit: header must equal cookie.
  if (cookieToken.length !== headerToken.length) {
    return res.status(403).json({ error: 'CSRF token invalid' });
  }
  const equal = crypto.timingSafeEqual(
    Buffer.from(cookieToken, 'utf8'),
    Buffer.from(headerToken, 'utf8'),
  );

  // ...and the token must carry a valid server signature (anti-injection).
  if (!equal || !isWellFormed(cookieToken)) {
    return res.status(403).json({ error: 'CSRF token invalid' });
  }

  next();
}
