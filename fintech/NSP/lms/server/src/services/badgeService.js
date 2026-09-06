import { v4 as uuid } from 'uuid';
import { getIssuerDID, signPayload } from '../config/keys.js';

/* ═══════════════════════════════════════════════════════════
   GAP 2: OPEN BADGES 3.0 SERVICE
   Generates OB 3.0 JSON-LD compliant badge credentials
   ═══════════════════════════════════════════════════════════ */

/**
 * Generate an Open Badges 3.0 JSON-LD credential for an earned badge.
 * @param {Object} badgeDefinition - BadgeDefinition document (code, title, description, criteria)
 * @param {Object} worker - Worker document (fullName, registrationId)
 * @param {Date} earnedAt - When the badge was earned
 * @returns {{ ob3json: Object, ob3jwt: String }} OB3 JSON-LD and signed JWT
 */
export function generateOB3Badge(badgeDefinition, worker, earnedAt) {
  const issuerDID = getIssuerDID();
  const badgeId = `urn:uuid:${uuid()}`;
  const issuanceDate = earnedAt || new Date();

  const ob3json = {
    '@context': [
      'https://www.w3.org/ns/credentials/v2',
      'https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json',
    ],
    id: badgeId,
    type: ['VerifiableCredential', 'OpenBadgeCredential'],
    issuer: {
      id: issuerDID,
      type: ['Profile'],
      name: 'TalentLedger / PPMC Pakistan',
      url: 'https://talentledger.ppmc.org.pk',
    },
    validFrom: issuanceDate.toISOString(),
    name: badgeDefinition.title,
    credentialSubject: {
      id: `did:key:${worker.registrationId || worker._id}`,
      type: ['AchievementSubject'],
      achievement: {
        id: `https://talentledger.ppmc.org.pk/badges/${badgeDefinition.code}`,
        type: ['Achievement'],
        name: badgeDefinition.title,
        description: badgeDefinition.description || '',
        criteria: {
          narrative: badgeDefinition.criteria?.type
            ? `${badgeDefinition.criteria.type}: threshold ${badgeDefinition.criteria.threshold}`
            : 'Earned through TalentLedger learning activities',
        },
        image: badgeDefinition.icon ? {
          id: `https://talentledger.ppmc.org.pk/badge-icons/${badgeDefinition.icon}.png`,
          type: 'Image',
        } : undefined,
      },
    },
  };

  // Sign the badge as a compact JWT
  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: issuerDID,
    sub: ob3json.credentialSubject.id,
    iat: Math.floor(issuanceDate.getTime() / 1000),
    vc: ob3json,
  })).toString('base64url');

  const signature = signPayload(`${header}.${payload}`);
  const ob3jwt = `${header}.${payload}.${signature}`;

  return { ob3json, ob3jwt };
}

/**
 * Verify an OB3 badge JWT.
 * @param {String} jwt - The signed JWT
 * @returns {{ valid: Boolean, payload: Object|null, reason: String }}
 */
export function verifyOB3Badge(jwt) {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return { valid: false, payload: null, reason: 'Invalid JWT format' };

    const { verifySignature } = require('../config/keys.js');
    const isValid = verifySignature(`${parts[0]}.${parts[1]}`, parts[2]);
    if (!isValid) return { valid: false, payload: null, reason: 'Signature verification failed' };

    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return { valid: true, payload, reason: 'Verified' };
  } catch (err) {
    return { valid: false, payload: null, reason: err.message };
  }
}
