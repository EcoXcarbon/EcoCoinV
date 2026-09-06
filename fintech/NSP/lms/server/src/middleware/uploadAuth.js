import jwt from 'jsonwebtoken';
import env from '../config/env.js';

// Allow file downloads via Bearer access token OR the session refresh cookie
// (cookie path is /api, so download URLs must live under /api/uploads). This lets
// plain <a href> links from a logged-in browser work while keeping files private.
export function uploadAuth(req, res, next) {
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) {
    try { jwt.verify(h.slice(7), env.JWT_SECRET); return next(); } catch (e) {}
  }
  const c = req.cookies && req.cookies.refreshToken;
  if (c) {
    try { jwt.verify(c, env.JWT_REFRESH_SECRET); return next(); } catch (e) {}
  }
  return res.status(401).json({ error: 'Authentication required to download files' });
}
