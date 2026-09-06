import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import User from '../models/User.js';

export async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const decoded = jwt.verify(header.split(' ')[1], env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    if (!user) return res.status(401).json({ error: 'User not found' });

    // Reject access tokens minted before a logout / password change / reset /
    // deactivation (each of those bumps tokenVersion).
    if ((decoded.tv ?? 0) !== (user.tokenVersion ?? 0)) {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }

    // Stage 1: Check if account is active
    if (!user.isActive) {
      return res.status(403).json({ error: 'Account is deactivated. Contact support.' });
    }

    // Stage 1: Check if account is locked
    if (user.isLocked()) {
      return res.status(423).json({ error: 'Account is temporarily locked due to multiple failed login attempts.' });
    }

    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Require email verification for certain routes
export function requireVerifiedEmail(req, res, next) {
  if (!req.user.emailVerified) {
    return res.status(403).json({
      error: 'Email verification required',
      code: 'EMAIL_NOT_VERIFIED',
      message: 'Please verify your email address to access this feature.',
    });
  }
  next();
}

export function authorize(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}
