import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import env from '../config/env.js';

/**
 * Sign an access + refresh token pair.
 *
 * The access token carries a `tv` (token version) claim. `authenticate`
 * rejects any access token whose `tv` no longer matches the user's current
 * `tokenVersion`, which lets logout / password-change / deactivation revoke
 * already-issued access tokens (not just the refresh token).
 *
 * Centralised here so every issuer (auth login, MFA login-verify, OAuth,
 * refresh) stamps the same claims — a token minted without `tv` would be
 * treated as version 0 and could break once a user's version is bumped.
 */
export function signTokens(user) {
  const access = jwt.sign(
    { id: user._id, role: user.role, tv: user.tokenVersion ?? 0 },
    env.JWT_SECRET,
    { expiresIn: '15m' },
  );
  // `jti` keeps every refresh token distinct: without it two tokens minted for
  // the same user in the same second are byte-identical, so two devices would
  // collide on one session entry.
  const refresh = jwt.sign(
    { id: user._id, jti: crypto.randomUUID() },
    env.JWT_REFRESH_SECRET,
    { expiresIn: '7d' },
  );
  return { access, refresh };
}

export function setRefreshCookie(res, token) {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/api',
  });
}
