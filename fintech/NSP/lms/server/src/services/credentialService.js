import { v4 as uuid } from 'uuid';
import crypto from 'crypto';
import { hashSHA256 } from '../utils/encryption.js';
import { getIssuerDID, getIssuerKeyPair, signPayload, verifySignature } from '../config/keys.js';
import env from '../config/env.js';

const LEGACY_ISSUER_DID = 'did:web:talentledger.ppmc.org.pk';

// ═══ ISCO-08 Trade Mapping ═══
const ISCO_MAP = {
  mason:'7112', electrician:'7411', welder:'7212', plumber:'7126',
  carpenter:'7115', 'steel-fixer':'7214', painter:'7131', hvac:'7127',
  'pipe-fitter':'7126', scaffolder:'7119', rigger:'7215', 'crane-operator':'8343',
  'heavy-driver':'8332', 'shuttering-carpenter':'7115', 'tile-fixer':'7122',
  'duct-fabricator':'7213', 'auto-mechanic':'7231', 'diesel-mechanic':'7233',
  fabricator:'7222', 'insulation-worker':'7124', 'heavy-equipment-operator':'8342',
  'aluminium-fabricator':'7213', 'safety-officer':'3119', cook:'5120', 'ac-technician':'7127',
};

// ═══ ISCED-F 2013 Mapping (by trade) ═══
const ISCED_MAP = {
  mason:'0732', electrician:'0713', welder:'0715', plumber:'0732',
  carpenter:'0732', 'steel-fixer':'0732', painter:'0732', hvac:'0713',
  'pipe-fitter':'0715', scaffolder:'0732', rigger:'0715', 'crane-operator':'1041',
  'heavy-driver':'1041', 'shuttering-carpenter':'0732', 'tile-fixer':'0732',
  'duct-fabricator':'0715', 'auto-mechanic':'0716', 'diesel-mechanic':'0716',
  fabricator:'0715', 'insulation-worker':'0732', 'heavy-equipment-operator':'1041',
  'aluminium-fabricator':'0715', 'safety-officer':'1022', cook:'1013', 'ac-technician':'0713',
};

// ═══ NQF to EQF Level Mapping ═══
// Pakistan NVQF Levels 1-8 map to EQF Levels 1-8 (roughly equivalent for TVET)
const NQF_TO_EQF = { 1:1, 2:2, 3:3, 4:4, 5:5, 6:6, 7:7, 8:8 };

// ═══ NQF to ISCED Level Mapping ═══
const NQF_TO_ISCED_LEVEL = {
  1:'2', 2:'253', 3:'353', 4:'354', 5:'453', 6:'554', 7:'655', 8:'756',
};

// ═══ Trade Labels ═══
const TRADE_LABELS = {
  mason:'Mason / Bricklayer', electrician:'Electrician', welder:'Welder',
  plumber:'Plumber', carpenter:'Carpenter', 'steel-fixer':'Steel Fixer / Rebar Worker',
  painter:'Painter / Decorator', hvac:'HVAC Technician', 'pipe-fitter':'Pipe Fitter',
  scaffolder:'Scaffolder', rigger:'Rigger', 'crane-operator':'Crane Operator',
  'heavy-driver':'Heavy Vehicle Driver', 'shuttering-carpenter':'Shuttering Carpenter',
  'tile-fixer':'Tile Fixer / Tiler', 'duct-fabricator':'Duct Fabricator',
  'auto-mechanic':'Auto Mechanic', 'diesel-mechanic':'Diesel Mechanic',
  fabricator:'Fabricator', 'insulation-worker':'Insulation Worker',
  'heavy-equipment-operator':'Heavy Equipment Operator',
  'aluminium-fabricator':'Aluminium Fabricator', 'safety-officer':'Safety Officer',
  cook:'Cook / Chef', 'ac-technician':'AC Technician',
};

/**
 * Generate a W3C Verifiable Credential with JWT-VC signing (Ed25519).
 * Falls back to HMAC-SHA256 if Ed25519 is unavailable.
 */
export function generateVC({ credentialId, worker, type, title, trade, nqfLevel, institution }) {
  const issuanceDate = new Date();
  const expirationDate = new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000);
  const issuerDID = getIssuerDID();
  const kp = getIssuerKeyPair();
  const vcId = `urn:uuid:${uuid()}`;

  const alignment = [
    {
      targetName: TRADE_LABELS[trade] || trade,
      targetUrl: `https://ec.europa.eu/esco/api/resource/occupation?uri=http://data.europa.eu/esco/isco/C${ISCO_MAP[trade] || '0000'}`,
      targetFramework: 'ESCO / ISCO-08',
    },
    {
      targetName: `Pakistan NQF Level ${nqfLevel}`,
      targetUrl: 'https://navttc.gov.pk/nqf',
      targetFramework: 'Pakistan National Qualifications Framework (NVQF)',
    },
    {
      targetName: `EQF Level ${NQF_TO_EQF[nqfLevel] || nqfLevel}`,
      targetUrl: 'https://europa.eu/europass/en/europass-tools/european-qualifications-framework',
      targetFramework: 'European Qualifications Framework (EQF)',
    },
    {
      targetName: `ISCED-F ${ISCED_MAP[trade] || '0000'}`,
      targetUrl: 'http://uis.unesco.org/en/topic/international-standard-classification-education-isced',
      targetFramework: 'ISCED-F 2013',
    },
  ];

  // Build VC payload for JWT signing
  const vcPayload = {
    '@context': [
      'https://www.w3.org/ns/credentials/v2',
      'https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json',
    ],
    id: vcId,
    type: ['VerifiableCredential', 'OpenBadgeCredential'],
    issuer: {
      id: issuerDID,
      type: 'Profile',
      name: institution || 'TalentLedger — PPMC Pakistan',
    },
    validFrom: issuanceDate.toISOString(),
    validUntil: expirationDate.toISOString(),
    credentialSubject: {
      id: `did:key:${worker.registrationId}`,
      type: 'AchievementSubject',
      achievement: {
        type: 'Achievement',
        name: title,
        description: `Certified in ${TRADE_LABELS[trade] || trade} at NQF Level ${nqfLevel}`,
        criteria: { narrative: `Assessed and certified in ${trade} at NQF Level ${nqfLevel}` },
        alignment,
      },
    },
    credentialStatus: {
      id: `${issuerDID}/status/${credentialId}`,
      type: 'BitstringStatusListEntry',
      statusPurpose: 'revocation',
    },
  };

  // Sign the VC as a JWT
  const header = { alg: kp.type === 'Ed25519' ? 'EdDSA' : 'HS256', typ: 'JWT' };
  const payload = {
    iss: issuerDID,
    sub: `did:key:${worker.registrationId}`,
    iat: Math.floor(issuanceDate.getTime() / 1000),
    exp: Math.floor(expirationDate.getTime() / 1000),
    jti: vcId,
    vc: vcPayload,
  };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sigInput = `${headerB64}.${payloadB64}`;
  const signature = signPayload(sigInput);
  const jwt = `${sigInput}.${signature}`;

  // Also compute credential hash for backward compat
  const credHashPayload = JSON.stringify({
    credentialId,
    worker: worker.registrationId,
    type, trade, nqfLevel,
    issuedAt: issuanceDate.toISOString(),
  });
  const credentialHash = hashSHA256(credHashPayload);

  return {
    context: vcPayload['@context'],
    id: vcId,
    issuerDID,
    subjectDID: `did:key:${worker.registrationId}`,
    issuanceDate,
    expirationDate,
    credentialHash,
    jwt,  // The signed JWT-VC
    proof: {
      type: kp.type === 'Ed25519' ? 'Ed25519Signature2020' : 'HmacSha256Signature',
      created: issuanceDate,
      verificationMethod: `${issuerDID}#key-1`,
      proofPurpose: 'assertionMethod',
      proofValue: signature,
      jws: jwt,
    },
    alignment,
  };
}

/**
 * Verify a credential's proof — supports both JWT-VC and legacy HMAC.
 */
export function verifyVCProof(credential) {
  const vc = credential?.vc;
  if (!vc) return { valid: false, reason: 'No VC data found' };

  // JWT-VC verification (new format)
  if (vc.jwt) {
    try {
      const parts = vc.jwt.split('.');
      if (parts.length !== 3) return { valid: false, reason: 'Invalid JWT format' };

      const sigInput = `${parts[0]}.${parts[1]}`;
      const isValid = verifySignature(sigInput, parts[2]);

      if (!isValid) return { valid: false, reason: 'JWT signature verification failed' };

      // Check expiration
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        return { valid: false, reason: 'Credential has expired' };
      }

      return {
        valid: true,
        reason: 'JWT-VC signature verified successfully',
        issuer: payload.iss,
        signatureType: 'JWT-VC',
      };
    } catch (e) {
      return { valid: false, reason: `JWT verification error: ${e.message}` };
    }
  }

  // Legacy HMAC verification
  if (vc.credentialHash && vc.proof?.proofValue) {
    const hmac = crypto.createHmac('sha256', env.JWT_SECRET);
    hmac.update(vc.credentialHash + LEGACY_ISSUER_DID + new Date(vc.proof.created).toISOString());
    const expectedProof = hmac.digest('hex');

    if (expectedProof !== vc.proof.proofValue) {
      return { valid: false, reason: 'Proof verification failed — credential may have been tampered with' };
    }

    if (vc.expirationDate && new Date(vc.expirationDate) < new Date()) {
      return { valid: false, reason: 'Credential has expired' };
    }

    return { valid: true, reason: 'Legacy HMAC proof verified successfully', signatureType: 'HMAC-SHA256' };
  }

  return { valid: false, reason: 'Missing credential hash or proof' };
}

/**
 * Generate W3C VC 2.0 JSON-LD representation.
 */
export function generateVCJsonLd(credential) {
  const vc = credential.vc;

  // If JWT-VC, decode and return the VC payload
  if (vc.jwt) {
    try {
      const parts = vc.jwt.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      return {
        ...payload.vc,
        proof: vc.proof,
      };
    } catch {
      // Fall through to manual construction
    }
  }

  return {
    '@context': vc.context,
    id: vc.id || `urn:uuid:${uuid()}`,
    type: ['VerifiableCredential', 'OpenBadgeCredential'],
    issuer: {
      id: vc.issuerDID,
      type: 'Profile',
      name: 'TalentLedger — PPMC Pakistan',
    },
    validFrom: vc.issuanceDate,
    validUntil: vc.expirationDate,
    credentialSubject: {
      id: vc.subjectDID,
      type: 'AchievementSubject',
      achievement: {
        type: 'Achievement',
        name: credential.title,
        criteria: { narrative: `Assessed and certified in ${credential.trade} at NQF Level ${credential.nqfLevel}` },
        alignment: vc.alignment,
      },
    },
    credentialStatus: {
      id: `${vc.issuerDID}/status/${credential.credentialId}`,
      type: 'BitstringStatusListEntry',
      statusPurpose: 'revocation',
    },
    proof: vc.proof,
  };
}

export { ISCO_MAP, ISCED_MAP, NQF_TO_EQF, TRADE_LABELS };
