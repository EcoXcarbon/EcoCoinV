import { Router } from 'express';
import { body } from 'express-validator';
import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import User from '../models/User.js';
import { authenticate } from '../middleware/auth.js';
import { handleValidation } from '../middleware/validate.js';
import { auditLog } from '../middleware/audit.js';
import { signTokens, setRefreshCookie } from '../utils/tokens.js';
import { addSession } from '../utils/sessions.js';
import { issueCsrfCookie } from '../middleware/csrf.js';
import {
  generateSecret, buildOtpAuthUrl, buildQrDataUrl, verifyToken,
  generateRecoveryCodes, hashRecoveryCodes, verifyAndConsumeRecoveryCode,
} from '../services/mfaService.js';

const router = Router();

// Short-lived (5min) token issued by /login when the user has MFA enabled.
// Carries an `mfa:'pending'` claim so it cannot be used as a real access token.
export function signMfaChallenge(userId) {
  return jwt.sign({ id: userId, mfa: 'pending' }, env.JWT_SECRET, { expiresIn: '5m' });
}

function verifyMfaChallenge(token) {
  try {
    const d = jwt.verify(token, env.JWT_SECRET);
    if (d.mfa !== 'pending') return null;
    return d.id;
  } catch { return null; }
}

/* ────────────────────────────────────────────────────────────────────
 *  Step 1: Start MFA enrollment
 *  Generates a fresh secret + QR code. Stores the secret in pendingSecret
 *  (not mfaSecret) until the user successfully verifies a code.
 *  ────────────────────────────────────────────────────────────────────*/
router.post('/setup', authenticate, auditLog('MFA_SETUP_START'), async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('+mfaSecret +mfaPendingSecret');
    if (user.mfaEnabled) {
      return res.status(409).json({ error: 'MFA already enabled. Disable it first to re-enroll.' });
    }
    const secret = generateSecret();
    user.mfaPendingSecret = secret;
    await user.save();
    const otpauth = buildOtpAuthUrl(user.email, secret);
    const qrDataUrl = await buildQrDataUrl(otpauth);
    res.json({
      secret,                 // shown to the user as fallback (manual key entry)
      otpauthUrl: otpauth,
      qrDataUrl,
    });
  } catch (err) { next(err); }
});

/* ────────────────────────────────────────────────────────────────────
 *  Step 2: Verify enrollment code, enable MFA, return recovery codes
 *  ────────────────────────────────────────────────────────────────────*/
router.post('/enroll/verify', authenticate, [
  body('code').isLength({ min: 6, max: 8 }),
  handleValidation,
], auditLog('MFA_ENROLL_VERIFY'), async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('+mfaPendingSecret +mfaSecret +mfaBackupCodes');
    if (user.mfaEnabled) return res.status(409).json({ error: 'MFA already enabled' });
    if (!user.mfaPendingSecret) return res.status(400).json({ error: 'No pending MFA setup. Start setup first.' });
    if (!verifyToken(req.body.code, user.mfaPendingSecret)) {
      return res.status(401).json({ error: 'Invalid code. Check your authenticator app.' });
    }

    const recoveryCodes = generateRecoveryCodes(10);
    const hashed = await hashRecoveryCodes(recoveryCodes);

    user.mfaSecret = user.mfaPendingSecret;
    user.mfaPendingSecret = undefined;
    user.mfaBackupCodes = hashed;
    user.mfaEnabled = true;
    await user.save();

    // Recovery codes are returned ONCE here. User must save them.
    res.json({
      enabled: true,
      recoveryCodes,
      message: 'MFA enabled. Save these recovery codes — they will not be shown again.',
    });
  } catch (err) { next(err); }
});

/* ────────────────────────────────────────────────────────────────────
 *  Disable MFA — requires current TOTP code (or recovery code) AND password
 *  ────────────────────────────────────────────────────────────────────*/
router.post('/disable', authenticate, [
  body('password').notEmpty(),
  body('code').isLength({ min: 5, max: 12 }),
  handleValidation,
], auditLog('MFA_DISABLE'), async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('+password +mfaSecret +mfaBackupCodes');
    if (!user.mfaEnabled) return res.status(400).json({ error: 'MFA is not enabled' });

    if (!(await user.comparePassword(req.body.password))) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    const totpOk = verifyToken(req.body.code, user.mfaSecret);
    const recoveryIdx = totpOk ? -1 : await verifyAndConsumeRecoveryCode(req.body.code, user.mfaBackupCodes || []);
    if (!totpOk && recoveryIdx < 0) {
      return res.status(401).json({ error: 'Invalid MFA code' });
    }

    user.mfaEnabled = false;
    user.mfaSecret = undefined;
    user.mfaPendingSecret = undefined;
    user.mfaBackupCodes = [];
    await user.save();
    res.json({ disabled: true });
  } catch (err) { next(err); }
});

/* ────────────────────────────────────────────────────────────────────
 *  Verify during login — completes the MFA challenge issued by /auth/login
 *  Public endpoint (no auth header) — uses the short-lived challenge token.
 *  ────────────────────────────────────────────────────────────────────*/
router.post('/login-verify', [
  body('challengeToken').isString().notEmpty(),
  body('code').isLength({ min: 5, max: 12 }),
  handleValidation,
], auditLog('MFA_LOGIN_VERIFY'), async (req, res, next) => {
  try {
    const userId = verifyMfaChallenge(req.body.challengeToken);
    if (!userId) return res.status(401).json({ error: 'Challenge expired. Please log in again.' });

    const user = await User.findById(userId).select('+mfaSecret +mfaBackupCodes +refreshToken');
    if (!user || !user.mfaEnabled) return res.status(400).json({ error: 'MFA not enabled' });

    const totpOk = verifyToken(req.body.code, user.mfaSecret);
    const recoveryIdx = totpOk ? -1 : await verifyAndConsumeRecoveryCode(req.body.code, user.mfaBackupCodes || []);

    if (!totpOk && recoveryIdx < 0) {
      return res.status(401).json({ error: 'Invalid code' });
    }

    // If a recovery code was used, consume it (one-time use)
    if (recoveryIdx >= 0) {
      const remaining = [...user.mfaBackupCodes];
      remaining.splice(recoveryIdx, 1);
      user.mfaBackupCodes = remaining;
    }

    // ─── New-device sign-in alert ───────────────────────────────────────
    const ip = req.ip || req.connection?.remoteAddress;
    const ua = (req.headers['user-agent'] || '').slice(0, 500);
    const ipChanged = await User.findById(user._id).select('+lastLoginIp');
    const isNewDevice = ipChanged.lastLoginIp && ipChanged.lastLoginIp !== ip;
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
      recoveryCodeUsed: recoveryIdx >= 0,
      recoveryCodesRemaining: user.mfaBackupCodes?.length || 0,
    });
  } catch (err) { next(err); }
});

/* ────────────────────────────────────────────────────────────────────
 *  Status — quick check the UI can call
 *  ────────────────────────────────────────────────────────────────────*/
router.get('/status', authenticate, async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('mfaEnabled +mfaBackupCodes');
    res.json({
      enabled: !!user.mfaEnabled,
      recoveryCodesRemaining: user.mfaBackupCodes?.length || 0,
    });
  } catch (err) { next(err); }
});

export default router;
