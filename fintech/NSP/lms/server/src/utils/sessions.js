import User from '../models/User.js';

/**
 * Per-device refresh sessions.
 *
 * The account used to hold a single `refreshToken` string, so a second device
 * (or a re-login in another tab) overwrote it; the first device's next refresh
 * then looked like a replayed token and revoked the entire account. Every
 * issued refresh token now lives in its own `refreshSessions` entry and rotates
 * on its own — one device signing in or out never disturbs another.
 *
 * All writes go through atomic update operators, never `doc.save()`: the field
 * is `select: false`, so saving a document that never loaded it would wipe the
 * other devices' sessions.
 */

// Devices kept per account; the oldest is dropped beyond this.
export const MAX_SESSIONS = 8;

// A refresh that races another one from the SAME device (two tabs, or the case
// page's 4s poll firing as the 15m access token lapses) presents the token the
// winner has just rotated away. Anything inside this window is a race, not
// theft, and must not cost the student their session.
export const REFRESH_GRACE_MS = 2 * 60 * 1000;

/** Register a freshly-issued refresh token as this device's session. */
export async function addSession(userId, token) {
  const now = new Date();
  await User.updateOne({ _id: userId }, {
    $push: {
      refreshSessions: {
        $each: [{ token, prevToken: null, rotatedAt: now, createdAt: now, lastUsedAt: now }],
        $slice: -MAX_SESSIONS,
      },
    },
    // Legacy mirror: uploadAuth and any pre-upgrade cookie still read this.
    $set: { refreshToken: token, refreshTokenRotatedAt: now },
  });
}

/** Drop every session on the account (password change / reset / deactivation). */
export async function clearSessions(userId) {
  await User.updateOne({ _id: userId }, {
    $set: { refreshSessions: [], refreshToken: null, prevRefreshToken: null },
  });
}
