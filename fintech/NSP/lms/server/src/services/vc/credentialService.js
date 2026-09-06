// W3C Verifiable Credential Generation & Signing Service
import { CREDENTIAL_CONTEXTS, CREDENTIAL_SCHEMAS } from './credentialSchemas.js';
import { sign, verify, sha256 } from './keyManagement.js';
import { resolveDID } from './didService.js';

/**
 * Generate a W3C Verifiable Credential 2.0 document
 * @param {object} credentialData - Raw credential data from registry
 * @param {string} issuerDID - Issuer's DID
 * @param {string} holderDID - Holder's DID
 * @returns {object} W3C VC document ready for signing
 */
export function generateVerifiableCredential(credentialData, issuerDID, holderDID) {
  const schema = CREDENTIAL_SCHEMAS[credentialData.credentialType];
  if (!schema) throw new Error(`Unknown credential type: ${credentialData.credentialType}`);

  const context = schema.useOpenBadges
    ? CREDENTIAL_CONTEXTS.withOpenBadges
    : CREDENTIAL_CONTEXTS.base;

  const vc = {
    '@context': context,
    id: `urn:uuid:${credentialData.credentialId}`,
    type: schema.type,
    issuer: {
      id: issuerDID,
      name: credentialData.issuerName || 'Talent Ledger',
    },
    issuanceDate: (credentialData.issuanceDate || new Date()).toISOString(),
    credentialSubject: {
      id: holderDID,
      type: 'Person',
      ...buildCredentialSubject(credentialData),
    },
    credentialSchema: {
      id: schema.schemaUrl,
      type: 'JsonSchema',
    },
  };

  // Add expiration if applicable
  if (credentialData.expiryDate) {
    vc.expirationDate = new Date(credentialData.expiryDate).toISOString();
  }

  // Add credential status for revocation checking (StatusList2021)
  vc.credentialStatus = {
    id: `https://api.talentledger.pk/v1/registry/status-list/${credentialData.issuerId || 'default'}#${credentialData.statusListIndex || 0}`,
    type: 'StatusList2021Entry',
    statusPurpose: 'revocation',
    statusListIndex: String(credentialData.statusListIndex || 0),
    statusListCredential: `https://api.talentledger.pk/v1/registry/status-list/${credentialData.issuerId || 'default'}`,
  };

  return vc;
}

/**
 * Build the credentialSubject from type-specific metadata
 */
function buildCredentialSubject(data) {
  const typeKey = {
    ACADEMIC: 'academic', TVET: 'tvet', RPL: 'rpl',
    PROFESSIONAL_LICENSE: 'professionalLicense',
    MICRO_CREDENTIAL: 'microCredential',
    EMPLOYER_ENDORSEMENT: 'employerEndorsement',
    TRAINING_RECORD: 'trainingRecord',
    IDENTITY_VERIFICATION: 'identityVerification',
    MIGRATION_RECORD: 'migrationRecord',
    HEALTH_CLEARANCE: 'healthClearance',
    SELF_DECLARED: 'selfDeclared',
  }[data.credentialType];

  const metadata = data.metadata?.[typeKey] || {};
  return {
    credentialTitle: data.title,
    credentialType: data.credentialType,
    credentialSubtype: data.credentialSubtype,
    ...metadata,
  };
}

/**
 * Sign a VC document with Ed25519 (Data Integrity proof format)
 * @param {object} vcDocument - The unsigned VC
 * @param {string} issuerPrivateKeyHex - Issuer's Ed25519 private key
 * @param {string} verificationMethodId - DID verification method ID
 * @returns {object} Signed VC with proof
 */
export function signCredential(vcDocument, issuerPrivateKeyHex, verificationMethodId) {
  const dataToSign = JSON.stringify(vcDocument);
  const signature = sign(dataToSign, issuerPrivateKeyHex);

  const signedVc = {
    ...vcDocument,
    proof: {
      type: 'Ed25519Signature2020',
      created: new Date().toISOString(),
      verificationMethod: verificationMethodId || `${vcDocument.issuer.id}#key-1`,
      proofPurpose: 'assertionMethod',
      proofValue: signature,
    },
  };

  return signedVc;
}

/**
 * Verify a signed VC's cryptographic signature
 * @param {object} signedVC - The signed VC document
 * @param {string} publicKeyHex - Issuer's public key (optional if DID resolution works)
 * @returns {{ valid: boolean, checks: object }}
 */
export function verifyCredentialSignature(signedVC, publicKeyHex) {
  const checks = {
    signature: { passed: false },
    expiry: { passed: true },
    revocation: { passed: true, note: 'StatusList check requires network call' },
    schema: { passed: true },
  };

  try {
    // Extract proof
    const proof = signedVC.proof;
    if (!proof || !proof.proofValue) {
      checks.signature.details = 'No proof found in credential';
      return { valid: false, checks };
    }

    // Reconstruct the data that was signed (VC without proof)
    const vcWithoutProof = { ...signedVC };
    delete vcWithoutProof.proof;
    const dataToVerify = JSON.stringify(vcWithoutProof);

    // Verify signature
    if (publicKeyHex) {
      checks.signature.passed = verify(dataToVerify, proof.proofValue, publicKeyHex);
      checks.signature.algorithm = 'Ed25519';
      checks.signature.issuerDid = signedVC.issuer?.id;
    } else {
      checks.signature.details = 'Public key not provided; DID resolution needed';
    }

    // Check expiry
    if (signedVC.expirationDate) {
      checks.expiry.passed = new Date(signedVC.expirationDate) > new Date();
      checks.expiry.expires = signedVC.expirationDate;
    }

    // Schema type check
    const credType = signedVC.credentialSubject?.credentialType;
    if (credType && CREDENTIAL_SCHEMAS[credType]) {
      const expectedTypes = CREDENTIAL_SCHEMAS[credType].type;
      checks.schema.passed = expectedTypes.every(t => signedVC.type?.includes(t));
    }

    return { valid: checks.signature.passed && checks.expiry.passed, checks };
  } catch (err) {
    checks.signature.details = err.message;
    return { valid: false, checks };
  }
}

/**
 * Generate a JWT representation of the VC (alternative serialization)
 * @param {object} vcDocument - The VC document
 * @param {string} privateKeyHex - Signing key
 * @returns {string} JWT string
 */
export function generateVcJwt(vcDocument, privateKeyHex) {
  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: vcDocument.issuer?.id,
    sub: vcDocument.credentialSubject?.id,
    nbf: Math.floor(new Date(vcDocument.issuanceDate).getTime() / 1000),
    exp: vcDocument.expirationDate ? Math.floor(new Date(vcDocument.expirationDate).getTime() / 1000) : undefined,
    vc: vcDocument,
  })).toString('base64url');

  const sigInput = `${header}.${payload}`;
  const signature = sign(sigInput, privateKeyHex);
  const sig64 = Buffer.from(signature, 'hex').toString('base64url');

  return `${header}.${payload}.${sig64}`;
}

export default {
  generateVerifiableCredential,
  signCredential,
  verifyCredentialSignature,
  generateVcJwt,
};
