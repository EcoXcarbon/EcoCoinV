import { Router } from 'express';
import { body } from 'express-validator';
import jwt from 'jsonwebtoken';
import passport from 'passport';
import env from '../config/env.js';
import User from '../models/User.js';
import { authenticate } from '../middleware/auth.js';
import { handleValidation } from '../middleware/validate.js';
import { auditLog } from '../middleware/audit.js';
import { signMfaChallenge } from './mfa.js';
import { requireCaptcha } from '../services/captchaService.js';
import { encrypt, maskCNIC } from '../utils/encryption.js';
import { signTokens, setRefreshCookie } from '../utils/tokens.js';
import { addSession, clearSessions, REFRESH_GRACE_MS, MAX_SESSIONS } from '../utils/sessions.js';
import { issueCsrfCookie } from '../middleware/csrf.js';
import Worker from '../models/Worker.js';
import Counter from '../models/Counter.js';

const router = Router();

// Generate cryptographically secure token
async function generateToken(bytes = 32) {
  const crypto = await import('crypto');
  return crypto.randomBytes(bytes).toString('hex');
}

async function hashToken(token) {
  const crypto = await import('crypto');
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ------------------------------------------------------------------
// Register
// ------------------------------------------------------------------
router.post('/register', requireCaptcha, [
  body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 200 }),
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('password').isLength({ min: 8, max: 128 }).withMessage('Password must be 8-128 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?])/)
    .withMessage('Password requires uppercase, lowercase, number, and special character'),
  body('role').optional().isIn(['worker', 'assessor', 'employer', 'institution']),
  body('cnic').optional().matches(/^\d{5}-\d{7}-\d{1}$/).withMessage('CNIC format: 12345-1234567-1'),
  body('phone').optional().trim().isLength({ max: 20 }),
  body('organization').optional().trim().isLength({ max: 300 }).withMessage('Organization max 300 characters'),
  body('district').optional().trim().isLength({ max: 100 }),
  body('trade').optional().trim().isLength({ max: 50 }),
  body('termsAccepted').optional().isBoolean(),
  handleValidation,
], async (req, res, next) => {
  try {
    const { name, email, password, role, cnic, phone, organization, district, trade, termsAccepted } = req.body;

    if (await User.findOne({ email })) {
      return res.status(409).json({ error: 'Registration could not be completed. If you already have an account, try logging in or resetting your password.' });
    }

    const finalRole = role || 'worker';

    const verificationToken = await generateToken();
    const hashedVerification = await hashToken(verificationToken);

    const user = await User.create({
      name, email, password,
      role: finalRole,
      cnic: cnic ? encrypt(cnic) : undefined,
      phone, organization, district,
      emailVerified: false,
      emailVerificationToken: hashedVerification,
      emailVerificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
      termsAcceptedAt: termsAccepted ? new Date() : undefined,
      termsVersion: termsAccepted ? '1.0' : undefined,
    });
    const tokens = signTokens(user);
    user.refreshToken = tokens.refresh;
    await user.save();
    await addSession(user._id, tokens.refresh);

    let worker = null;
    if (finalRole === 'worker') {
      const seq = await Counter.getNextSequence('worker');
      const regId = `TL-${new Date().getFullYear()}-${String(seq).padStart(5, '0')}`;
      worker = await Worker.create({
        user: user._id,
        fullName: name,
        registrationId: regId,
        cnicEncrypted: cnic ? encrypt(cnic) : 'N/A',
        cnicMasked: cnic ? maskCNIC(cnic) : 'N/A',
        district: district || 'Not specified',
        trade: trade || 'mason',
        phone,
      });
    }

    try {
      const { sendEmailVerification } = await import('../services/emailService.js');
      await sendEmailVerification(user, verificationToken);
    } catch (emailErr) {
      console.error('Failed to send verification email:', emailErr.message);
    }

    try {
      const { sendWelcomeEmail } = await import('../services/emailService.js');
      await sendWelcomeEmail(user);
    } catch (emailErr) {
      console.error('Failed to send welcome email:', emailErr.message);
    }

    setRefreshCookie(res, tokens.refresh);
    res.status(201).json({
      user: user.toSafe(),
      accessToken: tokens.access,
      workerId: worker?._id,
      emailVerificationRequired: true,
    });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// Verify email
// ------------------------------------------------------------------
router.post('/verify-email', [
  body('token').notEmpty().withMessage('Verification token is required'),
  handleValidation,
], async (req, res, next) => {
  try {
    const { token } = req.body;
    const hashedToken = await hashToken(token);

    const user = await User.findOne({
      emailVerificationToken: hashedToken,
      emailVerificationExpires: { $gt: new Date() },
    }).select('+emailVerificationToken +emailVerificationExpires');

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired verification token' });
    }

    user.emailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();

    res.json({ message: 'Email verified successfully' });
  } catch (err) { next(err); }
});

// Resend email verification
router.post('/resend-verification', requireCaptcha, [
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  handleValidation,
], async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email }).select('+emailVerificationToken +emailVerificationExpires');

    if (!user || user.emailVerified) {
      return res.json({ message: 'If that email is registered and unverified, a verification link has been sent.' });
    }

    const verificationToken = await generateToken();
    const hashedVerification = await hashToken(verificationToken);

    user.emailVerificationToken = hashedVerification;
    user.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await user.save();

    const { sendEmailVerification } = await import('../services/emailService.js');
    await sendEmailVerification(user, verificationToken);

    res.json({ message: 'If that email is registered and unverified, a verification link has been sent.' });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// Login — with account lockout
// ------------------------------------------------------------------
router.post('/login', [
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required'),
  handleValidation,
], auditLog('USER_LOGIN'), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).select('+refreshToken +loginAttempts +lockedUntil');

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.isLocked()) {
      const minutesLeft = Math.ceil((user.lockedUntil - Date.now()) / 60000);
      return res.status(423).json({
        error: `Account is temporarily locked. Try again in ${minutesLeft} minute(s).`,
        lockedUntil: user.lockedUntil,
      });
    }

    if (!user.isActive) {
      return res.status(403).json({ error: 'Account is deactivated' });
    }

    const passwordValid = await user.comparePassword(password);
    if (!passwordValid) {
      // Atomic increment-and-lock (returns the post-increment doc) so parallel
      // failed logins can't race past the threshold without locking.
      const updatedUser = await user.incrementLoginAttempts();
      if (updatedUser.isLocked()) {
        try {
          const { sendAccountLockedEmail } = await import('../services/emailService.js');
          await sendAccountLockedEmail(user);
        } catch (e) { console.error('Failed to send lockout email:', e.message); }
      }

      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.loginAttempts > 0) {
      await user.resetLoginAttempts();
    }

    // If MFA is enabled, do NOT issue access tokens yet — return a short-lived
    // challenge the client uses to call /api/auth/mfa/login-verify with a TOTP.
    // (The new-device check fires after MFA verify, not here.)
    if (user.mfaEnabled) {
      const challengeToken = signMfaChallenge(user._id);
      return res.json({
        mfaRequired: true,
        challengeToken,
        message: 'Enter the 6-digit code from your authenticator app.',
      });
    }

    // ─── New-device sign-in alert ───────────────────────────────────────
    const ip = req.ip || req.connection?.remoteAddress;
    const ua = (req.headers['user-agent'] || '').slice(0, 500);
    const fullUser = await User.findById(user._id).select('+lastLoginIp +lastLoginUserAgent');
    const isNewDevice = fullUser.lastLoginIp && fullUser.lastLoginIp !== ip;
    if (isNewDevice) {
      try {
        const { sendNewSignInAlert } = await import('../services/emailService.js');
        await sendNewSignInAlert(user, { ip, userAgent: ua, when: new Date() });
      } catch (e) { console.error('Failed to send new-sign-in alert:', e.message); }
    }

    const tokens = signTokens(user);
    user.refreshToken = tokens.refresh;
    user.lastLogin = new Date();
    user.lastLoginIp = ip;
    user.lastLoginUserAgent = ua;
    await user.save();
    await addSession(user._id, tokens.refresh);

    setRefreshCookie(res, tokens.refresh);
    issueCsrfCookie(res);
    res.json({
      user: user.toSafe(),
      accessToken: tokens.access,
      emailVerified: user.emailVerified,
    });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// Google OAuth — initiate
// ------------------------------------------------------------------
router.get('/google',
  (req, res, next) => {
    if (!env.GOOGLE_CLIENT_ID) {
      return res.status(503).json({ error: 'Google OAuth is not configured' });
    }
    next();
  },
  passport.authenticate('google', { scope: ['profile', 'email'], session: false })
);

// ------------------------------------------------------------------
// Google OAuth — callback
// ------------------------------------------------------------------
router.get('/google/callback',
  (req, res, next) => {
    if (!env.GOOGLE_CLIENT_ID) {
      return res.redirect(`${env.CLIENT_URL}/login?error=oauth_disabled`);
    }
    next();
  },
  passport.authenticate('google', { session: false, failureRedirect: `${env.CLIENT_URL}/login?error=google_auth_failed` }),
  auditLog('USER_LOGIN_GOOGLE'),
  async (req, res) => {
    try {
      const user = req.user;
      const tokens = signTokens(user);
      user.refreshToken = tokens.refresh;
      user.lastLogin = new Date();
      await user.save();
      await addSession(user._id, tokens.refresh);

      setRefreshCookie(res, tokens.refresh);
      issueCsrfCookie(res);

      // Redirect to client with access token in URL fragment (never in query string)
      res.redirect(`${env.CLIENT_URL}/auth/callback#token=${tokens.access}`);
    } catch (err) {
      console.error('[OAuth] Callback error:', err.message);
      res.redirect(`${env.CLIENT_URL}/login?error=server_error`);
    }
  }
);

// ------------------------------------------------------------------
// Change password
// ------------------------------------------------------------------
router.post('/change-password', authenticate, [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 8, max: 128 }).withMessage('Password must be 8-128 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?])/)
    .withMessage('Password requires uppercase, lowercase, number, and special character'),
  handleValidation,
], auditLog('PASSWORD_CHANGE'), async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user._id).select('+password');

    if (!(await user.comparePassword(currentPassword))) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({ error: 'New password must be different from current password' });
    }

    user.password = newPassword;
    user.passwordChangedAt = new Date();
    user.refreshToken = null;
    // Invalidate every previously-issued access token for this account.
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();
    await clearSessions(user._id);

    // Issued after the bump, so this fresh token carries the new version.
    const tokens = signTokens(user);
    user.refreshToken = tokens.refresh;
    await user.save();
    await addSession(user._id, tokens.refresh);

    setRefreshCookie(res, tokens.refresh);
    res.json({ message: 'Password changed successfully', accessToken: tokens.access });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// Account self-deactivation (GDPR right to erasure)
// ------------------------------------------------------------------
router.post('/deactivate-account', authenticate, [
  body('password').notEmpty().withMessage('Password is required to confirm deactivation'),
  body('reason').optional().trim().isLength({ max: 500 }),
  handleValidation,
], auditLog('ACCOUNT_DEACTIVATE'), async (req, res, next) => {
  try {
    const { password, reason } = req.body;
    const user = await User.findById(req.user._id).select('+password');

    if (!(await user.comparePassword(password))) {
      return res.status(401).json({ error: 'Password is incorrect' });
    }

    user.isActive = false;
    user.deletionRequestedAt = new Date();
    user.refreshToken = null;
    user.tokenVersion = (user.tokenVersion || 0) + 1; // invalidate outstanding access tokens
    await user.save();
    await clearSessions(user._id);

    if (user.role === 'worker') {
      await Worker.findOneAndUpdate({ user: user._id }, { status: 'inactive' });
    }

    res.clearCookie('refreshToken', { path: '/api' });
    res.json({ message: 'Account has been deactivated. Contact support within 30 days to reactivate.' });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// Data export request (GDPR right to data portability)
// ------------------------------------------------------------------
router.post('/export-data', authenticate, async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    const data = { user: user.toSafe() };

    if (user.role === 'worker') {
      const worker = await Worker.findOne({ user: user._id }).select('-cnicEncrypted');
      if (worker) data.worker = worker.toObject();
    }

    try {
      const Credential = (await import('../models/Credential.js')).default;
      const credentials = await Credential.find({ 'subject.id': user._id });
      if (credentials.length) data.credentials = credentials;
    } catch { /* Credential model may not exist yet */ }

    try {
      const Enrollment = (await import('../models/Enrollment.js')).default;
      const enrollments = await Enrollment.find({ user: user._id });
      if (enrollments.length) data.enrollments = enrollments;
    } catch { /* Enrollment model may not exist yet */ }

    user.dataExportRequestedAt = new Date();
    await user.save();

    res.json({
      message: 'Data export generated',
      exportedAt: new Date().toISOString(),
      data,
    });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// Refresh token
// ------------------------------------------------------------------
router.post('/refresh', async (req, res, next) => {
  try {
    const token = req.cookies.refreshToken;
    if (!token) return res.status(401).json({ error: 'No refresh token' });

    const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET);
    const user = await User.findById(decoded.id)
      .select('+refreshToken +prevRefreshToken +refreshTokenRotatedAt +refreshSessions');
    if (!user) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const tokens = signTokens(user);
    const now = new Date();

    const grant = (refreshToken, accessToken) => {
      setRefreshCookie(res, refreshToken);
      issueCsrfCookie(res); // keep the CSRF cookie alive for the next refresh
      return res.json({ accessToken });
    };

    // 1. Normal path — rotate THIS device's session, atomically. The positional
    //    match doubles as a compare-and-swap: only the request holding the
    //    session's current token wins.
    const rotated = await User.findOneAndUpdate(
      { _id: user._id, 'refreshSessions.token': token },
      {
        $set: {
          'refreshSessions.$.token': tokens.refresh,
          'refreshSessions.$.prevToken': token,
          'refreshSessions.$.rotatedAt': now,
          'refreshSessions.$.lastUsedAt': now,
          refreshToken: tokens.refresh,
          refreshTokenRotatedAt: now,
        },
      },
      { new: true },
    );
    if (rotated) return grant(tokens.refresh, tokens.access);

    // 2. Pre-upgrade cookie: the account still carries the single legacy
    //    refresh token. Adopt it as a session instead of logging the user out.
    if (user.refreshToken === token) {
      const migrated = await User.findOneAndUpdate(
        { _id: user._id, refreshToken: token },
        {
          $push: {
            refreshSessions: {
              $each: [{ token: tokens.refresh, prevToken: token, rotatedAt: now, createdAt: now, lastUsedAt: now }],
              $slice: -MAX_SESSIONS,
            },
          },
          $set: { refreshToken: tokens.refresh, refreshTokenRotatedAt: now },
        },
        { new: true },
      );
      if (migrated) return grant(tokens.refresh, tokens.access);
    }

    // 3. Raced rotation — a second tab (or the case-page poll) fired with the
    //    same cookie in the instant before the winner's rotation landed. Re-read
    //    the record the winner just wrote and converge on its token.
    const fresh = await User.findById(user._id)
      .select('+refreshToken +prevRefreshToken +refreshTokenRotatedAt +refreshSessions');
    const withinGrace = at => at && (Date.now() - new Date(at).getTime()) < REFRESH_GRACE_MS;
    const racedSession = (fresh?.refreshSessions || [])
      .find(sess => sess.prevToken === token && withinGrace(sess.rotatedAt));
    const racedLegacy = fresh?.prevRefreshToken === token && withinGrace(fresh.refreshTokenRotatedAt);

    if (racedSession || racedLegacy) {
      const current = racedSession ? racedSession.token : fresh.refreshToken;
      return grant(current, signTokens(fresh).access);
    }

    // 4. The token belongs to no live session (already rotated past the grace
    //    window, signed out, or expired). Refuse THIS request only — the old
    //    behaviour bumped tokenVersion, which signed the student out of every
    //    device they had open, and that fired on ordinary multi-tab use.
    console.warn(`[auth] stale refresh token presented for user ${user._id}`);
    return res.status(401).json({ error: 'Your session has expired. Please log in again.' });
  } catch {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// ------------------------------------------------------------------
// Logout
// ------------------------------------------------------------------
router.post('/logout', authenticate, auditLog('USER_LOGOUT'), async (req, res) => {
  // Sign out THIS device only. Bumping tokenVersion invalidated every access
  // token on the account, so signing out on a phone also kicked the student out
  // of the tab they were working in.
  const presented = req.cookies?.refreshToken;
  if (presented) {
    await User.updateOne({ _id: req.user._id }, { $pull: { refreshSessions: { token: presented } } });
    await User.updateOne({ _id: req.user._id, refreshToken: presented }, { $set: { refreshToken: null } });
  } else {
    await User.findByIdAndUpdate(req.user._id, { $set: { refreshToken: null, refreshSessions: [] }, $inc: { tokenVersion: 1 } });
  }
  res.clearCookie('refreshToken', { path: '/api' });
  res.json({ message: 'Logged out' });
});

// ------------------------------------------------------------------
// Get current user
// ------------------------------------------------------------------
router.get('/me', authenticate, async (req, res) => {
  const user = req.user;
  const safe = user.toSafe();
  safe.profileCompleteness = user.calculateProfileCompleteness();

  if (user.role === 'worker') {
    const worker = await Worker.findOne({ user: user._id }).select('profileCompleteness onboardingCompleted');
    if (worker) {
      safe.workerProfileCompleteness = worker.profileCompleteness;
    }
  }

  res.json({ user: safe });
});

// ------------------------------------------------------------------
// Update onboarding step
// ------------------------------------------------------------------
router.put('/onboarding', authenticate, [
  body('step').isInt({ min: 0, max: 10 }).withMessage('Valid step number required'),
  body('completed').optional().isBoolean(),
  handleValidation,
], async (req, res, next) => {
  try {
    const { step, completed } = req.body;
    const updates = { onboardingStep: step };
    if (completed) updates.onboardingCompleted = true;
    await User.findByIdAndUpdate(req.user._id, updates);
    res.json({ message: 'Onboarding progress saved', step, completed: completed || false });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// Forgot password
// ------------------------------------------------------------------
router.post('/forgot-password', requireCaptcha, [
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  handleValidation,
], async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email }).select('+resetPasswordToken +resetPasswordExpires +resetPasswordUsedAt');
    if (!user) {
      return res.json({ message: 'If that email is registered, a reset link has been sent.' });
    }

    const resetToken = await generateToken();
    const hashedToken = await hashToken(resetToken);

    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    user.resetPasswordUsedAt = undefined; // clear any previous usage
    await user.save();

    const { sendPasswordResetEmail } = await import('../services/emailService.js');
    await sendPasswordResetEmail(user, resetToken);

    res.json({ message: 'If that email is registered, a reset link has been sent.' });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// Reset password — one-time use ✅ FIX
// ------------------------------------------------------------------
router.post('/reset-password', [
  body('token').notEmpty().withMessage('Reset token is required'),
  body('password').isLength({ min: 8, max: 128 }).withMessage('Password must be 8-128 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?])/)
    .withMessage('Password requires uppercase, lowercase, number, and special character'),
  handleValidation,
], async (req, res, next) => {
  try {
    const { token, password } = req.body;
    const hashedToken = await hashToken(token);

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: new Date() },
    }).select('+resetPasswordToken +resetPasswordExpires +resetPasswordUsedAt');

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    // ✅ One-time use: reject if already used
    if (user.resetPasswordUsedAt) {
      return res.status(400).json({ error: 'This reset link has already been used. Please request a new one.' });
    }

    user.password = password;
    user.passwordChangedAt = new Date();
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    user.resetPasswordUsedAt = new Date(); // ✅ Mark as used
    user.refreshToken = null;
    user.tokenVersion = (user.tokenVersion || 0) + 1; // invalidate outstanding access tokens
    user.loginAttempts = 0;
    user.lockedUntil = undefined;
    await user.save();
    await clearSessions(user._id);

    res.json({ message: 'Password has been reset successfully. Please log in.' });
  } catch (err) { next(err); }
});

export default router;
