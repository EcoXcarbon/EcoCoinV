/**
 * SD-JWT Selective Disclosure Service
 * Implements IETF draft-ietf-oauth-sd-jwt-vc
 * Allows holders to reveal individual credential fields cryptographically
 */
import crypto from 'crypto';
import { sign as edSign, verify as edVerify } from './keyManagement.js';

// ── Base64url encoding (URL-safe, no padding) ──────────────────────────────
const b64url = buf => Buffer.from(buf).toString('base64url');
const b64urlStr = str => Buffer.from(str, 'utf8').toString('base64url');
const b64urlDecode = str => Buffer.from(str, 'base64url').toString('utf8');

// ── Create a salted disclosure for one field ─────────────────────────────────
// Returns { disclosure, hash } where disclosure is base64url([salt, key, value])
function createDisclosure(key, value) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const disclosureArray = [salt, key, value];
  const disclosureStr = JSON.stringify(disclosureArray);
  const disclosure = b64urlStr(disclosureStr);
  const hash = b64url(crypto.createHash('sha256').update(disclosure).digest());
  return { disclosure, hash, key, value, salt };
}

// ── Issue SD-JWT: convert a credential object into SD-JWT format ──────────
/**
 * @param {object} credential - The full credential object
 * @param {string[]} selectiveFields - Fields to make selectively disclosable
 * @param {string} privateKeyHex - Issuer's Ed25519 private key
 * @param {string} issuerDid - Issuer DID
 * @returns {{ sdJwt: string, disclosures: object[] }}
 *
 * SD-JWT format: <header>.<payload>.<sig>~<disclosure1>~<disclosure2>~...
 */
export function issueSDJwt(credential, selectiveFields, privateKeyHex, issuerDid) {
  const disclosures = [];
  const sdHashes = [];
  const protectedPayload = { ...credential };

  for (const field of selectiveFields) {
    if (protectedPayload[field] !== undefined) {
      const d = createDisclosure(field, protectedPayload[field]);
      disclosures.push(d);
      sdHashes.push(d.hash);
      delete protectedPayload[field]; // remove from plain payload
    }
  }

  // Build JWT payload with _sd claim (hashes of disclosures)
  const payload = {
    ...protectedPayload,
    _sd: sdHashes,
    _sd_alg: 'sha-256',
    iss: issuerDid,
    iat: Math.floor(Date.now() / 1000),
    exp: credential.expiryDate
      ? Math.floor(new Date(credential.expiryDate).getTime() / 1000)
      : Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365 * 5,
  };

  const header = { alg: 'EdDSA', typ: 'sd+jwt' };

  const headerB64 = b64urlStr(JSON.stringify(header));
  const payloadB64 = b64urlStr(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  let sig;
  try {
    sig = edSign(signingInput, privateKeyHex);
  } catch {
    // Fallback: HMAC-SHA256 if no private key
    const hmac = crypto.createHmac('sha256', privateKeyHex || crypto.randomBytes(32).toString('hex'));
    hmac.update(signingInput);
    sig = hmac.digest('hex');
  }

  const jwt = `${signingInput}.${b64urlStr(sig)}`;
  const sdJwt = [jwt, ...disclosures.map(d => d.disclosure)].join('~');

  return {
    sdJwt,
    disclosures: disclosures.map(({ disclosure, hash, key, value }) => ({
      disclosure, hash, key, value,
    })),
  };
}

// ── Create a holder-selected presentation ────────────────────────────────────
/**
 * @param {string} sdJwt - The full SD-JWT from issuer (all disclosures appended)
 * @param {string[]} revealFields - Which fields the holder wants to reveal
 * @param {string} [holderPrivateKeyHex] - Optional: for key binding proof
 * @param {object} [kbOptions] - Key binding options (aud, nonce)
 * @returns {string} Presentation SD-JWT (subset of disclosures)
 */
export function presentSDJwt(sdJwt, revealFields, holderPrivateKeyHex, kbOptions) {
  const parts = sdJwt.split('~');
  const jwt = parts[0];
  const allDisclosures = parts.slice(1).filter(Boolean);

  // Decode disclosures to find which ones to include
  const selected = [];
  for (const d of allDisclosures) {
    try {
      const decoded = JSON.parse(b64urlDecode(d));
      const [, key] = decoded; // [salt, key, value]
      if (revealFields.includes(key)) {
        selected.push(d);
      }
    } catch { /* skip malformed */ }
  }

  let presentation = [jwt, ...selected].join('~');

  // Optional: append key binding JWT (KB-JWT)
  if (holderPrivateKeyHex && kbOptions) {
    const kbHeader = b64urlStr(JSON.stringify({ alg: 'EdDSA', typ: 'kb+jwt' }));
    const kbPayload = b64urlStr(JSON.stringify({
      iat: Math.floor(Date.now() / 1000),
      aud: kbOptions.aud,
      nonce: kbOptions.nonce,
      sd_hash: b64url(crypto.createHash('sha256').update(presentation).digest()),
    }));
    const kbInput = `${kbHeader}.${kbPayload}`;
    const kbSig = edSign(kbInput, holderPrivateKeyHex);
    presentation = `${presentation}~${kbInput}.${b64urlStr(kbSig)}`;
  }

  return presentation;
}

// ── Verify a presentation SD-JWT ─────────────────────────────────────────────
/**
 * @param {string} presentation - The presentation SD-JWT from holder
 * @param {string} issuerPublicKeyHex - Issuer's Ed25519 public key
 * @returns {{ valid: boolean, revealedClaims: object, errors: string[] }}
 */
export function verifySDJwtPresentation(presentation, issuerPublicKeyHex) {
  const errors = [];
  const revealedClaims = {};

  try {
    const parts = presentation.split('~');
    const [headerB64, payloadB64, sigB64] = parts[0].split('.');
    const disclosures = parts.slice(1).filter(d => d && !d.startsWith('eyJhbGciOiJFZERTQSIsInR5cCI6ImtiK2p3dCJ9'));

    // Decode and verify JWT signature
    const signingInput = `${headerB64}.${payloadB64}`;
    let sigValid = false;
    try {
      const sig = b64urlDecode(sigB64);
      sigValid = edVerify(signingInput, sig, issuerPublicKeyHex);
    } catch {
      errors.push('Signature verification failed');
    }

    // Decode payload
    const payload = JSON.parse(b64urlDecode(payloadB64));

    // Check expiry
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      errors.push('SD-JWT has expired');
    }

    // Verify each presented disclosure against _sd hashes
    const claimedHashes = payload._sd || [];
    for (const d of disclosures) {
      try {
        const hash = b64url(crypto.createHash('sha256').update(d).digest());
        if (claimedHashes.includes(hash)) {
          const [, key, value] = JSON.parse(b64urlDecode(d));
          revealedClaims[key] = value;
        } else {
          errors.push(`Disclosure ${d.slice(0, 10)}... not in _sd list`);
        }
      } catch {
        errors.push('Malformed disclosure');
      }
    }

    // Copy non-selective fields from payload (excluding _sd, _sd_alg, iss, iat, exp)
    const skipFields = new Set(['_sd', '_sd_alg', 'iss', 'iat', 'exp', 'nbf']);
    for (const [k, v] of Object.entries(payload)) {
      if (!skipFields.has(k)) revealedClaims[k] = v;
    }

    return {
      valid: sigValid && errors.length === 0,
      revealedClaims,
      issuer: payload.iss,
      issuedAt: payload.iat ? new Date(payload.iat * 1000) : null,
      expiresAt: payload.exp ? new Date(payload.exp * 1000) : null,
      errors,
    };
  } catch (e) {
    return { valid: false, revealedClaims: {}, errors: [e.message] };
  }
}

// ── Convert W3C VC to SD-JWT fields mapping ──────────────────────────────────
// These are the credential subject fields that should be selectively disclosable by type
export const SD_FIELDS_BY_TYPE = {
  ACADEMIC: ['degreeLevel', 'cgpa', 'rollNumber', 'faculty'],
  TVET: ['marksObtained', 'totalMarks', 'rollNumber', 'session'],
  RPL: ['assessorId', 'assessorName', 'assessmentCenter'],
  PROFESSIONAL_LICENSE: ['licenseNumber', 'firstIssuanceDate', 'cpeHoursCompleted'],
  MICRO_CREDENTIAL: ['courseName', 'platform'],
  EMPLOYER_ENDORSEMENT: ['performanceRating', 'employerName'],
  MIGRATION_RECORD: ['passportNumber', 'visaNumber', 'destinationCountry'],
  HEALTH_CLEARANCE: ['medicalCenterName', 'referenceNumber'],
  IDENTITY_VERIFICATION: ['documentNumber', 'nameMatchScore'],
  TRAINING_RECORD: ['trainingDurationHours'],
  SELF_DECLARED: ['yearsExperience', 'selfAssessmentScore'],
};

// ── Default fields always revealed ────────────────────────────────────────────
export const ALWAYS_REVEAL_FIELDS = ['credentialType', 'credentialSubtype', 'status', 'title', 'issuerName'];
