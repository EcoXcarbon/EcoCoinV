// 8x8 JaaS (Jitsi as a Service) token minting.
// Produces an RS256 JWT that authorises a user to join a specific room, and —
// for teachers — to join AS MODERATOR so the meeting actually starts (public
// meet.jit.si refuses to start a room for anonymous users).
//
// Docs: https://developer.8x8.com/jaas/docs/api-keys-jwt
import jwt from 'jsonwebtoken';
import env from '../config/env.js';

export const JAAS_DOMAIN = '8x8.vc';

export function jaasConfigured() {
  return !!(env.JAAS_APP_ID && env.JAAS_KID && env.JAAS_PRIVATE_KEY);
}

/**
 * Mint a JaaS JWT for one room.
 * @param {object}  o
 * @param {string}  o.room       exact room name (must match what the client joins)
 * @param {object}  o.user       { id, name, email?, avatar? }
 * @param {boolean} o.moderator  grant moderator (teachers) — lets the meeting start
 * @param {number}  o.expSeconds token lifetime (default 2h)
 */
export function mintJaasToken({ room, user, moderator = false, expSeconds = 7200 }) {
  if (!jaasConfigured()) throw new Error('JaaS is not configured');
  if (!room) throw new Error('room is required');

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: 'jitsi',
    iss: 'chat',
    sub: env.JAAS_APP_ID,
    room,
    iat: now,
    nbf: now - 10,
    exp: now + expSeconds,
    context: {
      user: {
        id: String(user?.id ?? 'anonymous'),
        name: user?.name || 'Guest',
        email: user?.email || undefined,
        avatar: user?.avatar || undefined,
        moderator,                 // boolean — JaaS grants moderator rights
      },
      features: {
        livestreaming: false,
        recording: moderator,      // only moderators may record
        transcription: false,
        'outbound-call': false,
        'sip-outbound-call': false,
      },
    },
  };

  return jwt.sign(payload, env.JAAS_PRIVATE_KEY, {
    algorithm: 'RS256',
    header: { kid: env.JAAS_KID, typ: 'JWT' },
  });
}

/**
 * Build the full payload the client needs to embed/open a JaaS room.
 * Returns { configured, domain, appId, room, token } — or { configured:false,
 * room } so the client can fall back to public meet.jit.si.
 */
export function jaasJoinPayload({ room, user, moderator }) {
  if (!jaasConfigured()) return { configured: false, room };
  return {
    configured: true,
    domain: JAAS_DOMAIN,
    appId: env.JAAS_APP_ID,
    room,
    token: mintJaasToken({ room, user, moderator }),
  };
}
