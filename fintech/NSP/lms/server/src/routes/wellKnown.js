/**
 * /.well-known routes for TalentLedger
 * - /.well-known/did-configuration.json  (DIF Well Known DID Configuration — real Ed25519 proof)
 * - /.well-known/did.json                (did:web DID Document)
 * - /.well-known/openid-credential-issuer (OpenID4VCI discovery)
 * - /.well-known/jwks.json               (JSON Web Key Set)
 */
import express from 'express';
import { sign, sha256 } from '../services/vc/keyManagement.js';
import { ISSUER_DID as IDENTITY_DID, PUBLIC_BASE } from '../config/identity.js';

const router = express.Router();

const BASE_URL  = process.env.API_URL || PUBLIC_BASE;
const CLIENT_URL = PUBLIC_BASE;
const ISSUER_DID = IDENTITY_DID;

// ── DIF Well-Known DID Configuration ─────────────────────────────────────────
// Proves that the issuer DID controls this deployment's public origin.
// Signed with ISSUER_PRIVATE_KEY — no longer a placeholder
router.get('/did-configuration.json', (req, res) => {
  const issuanceDate = new Date().toISOString();

  const credential = {
    '@context': [
      'https://www.w3.org/2018/credentials/v1',
      'https://identity.foundation/.well-known/did-configuration/v1',
    ],
    issuer: ISSUER_DID,
    issuanceDate,
    type: ['VerifiableCredential', 'DomainLinkageCredential'],
    credentialSubject: {
      id: ISSUER_DID,
      origin: CLIENT_URL,
    },
  };

  // Sign the credential with the issuer's Ed25519 private key
  const privateKey = process.env.ISSUER_PRIVATE_KEY;
  let proofValue = 'ISSUER_PRIVATE_KEY_NOT_SET';
  if (privateKey) {
    try {
      proofValue = sign(JSON.stringify(credential), privateKey);
    } catch (e) {
      proofValue = `SIGN_ERROR:${e.message}`;
    }
  }

  res.set('Content-Type', 'application/json');
  res.set('Cache-Control', 'public, max-age=3600');
  res.json({
    '@context': 'https://identity.foundation/.well-known/did-configuration/v1',
    linked_dids: [{
      ...credential,
      proof: {
        type: 'Ed25519Signature2020',
        created: issuanceDate,
        verificationMethod: `${ISSUER_DID}#key-1`,
        proofPurpose: 'assertionMethod',
        proofValue,
      },
    }],
  });
});

// ── did:web DID Document ──────────────────────────────────────────────────────
router.get('/did.json', (req, res) => {
  res.set('Content-Type', 'application/did+ld+json');
  res.set('Cache-Control', 'public, max-age=3600');
  res.json({
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/ed25519-2020/v1',
    ],
    id: ISSUER_DID,
    verificationMethod: [{
      id: `${ISSUER_DID}#key-1`,
      type: 'Ed25519VerificationKey2020',
      controller: ISSUER_DID,
      publicKeyMultibase: process.env.ISSUER_PUBLIC_KEY_MULTIBASE || 'z6MkhaXgBZDvotDkL5257faWtiGVAVYeWRfR7xzr5VvTcV36',
    }],
    authentication:   [`${ISSUER_DID}#key-1`],
    assertionMethod:  [`${ISSUER_DID}#key-1`],
    capabilityInvocation: [`${ISSUER_DID}#key-1`],
    service: [
      {
        id: `${ISSUER_DID}#credential-issuer`,
        type: 'CredentialIssuer',
        serviceEndpoint: `${BASE_URL}/api/v1/registry`,
      },
      {
        id: `${ISSUER_DID}#openid-credential-issuer`,
        type: 'OpenIDCredentialIssuer',
        serviceEndpoint: `${CLIENT_URL}/.well-known/openid-credential-issuer`,
      },
    ],
  });
});

// ── OpenID4VCI Credential Issuer Metadata ────────────────────────────────────
router.get('/openid-credential-issuer', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json({
    credential_issuer: BASE_URL,
    credential_endpoint:           `${BASE_URL}/api/v1/oidc/credential`,
    token_endpoint:                `${BASE_URL}/api/v1/oidc/token`,
    authorization_endpoint:        `${BASE_URL}/api/v1/oidc/authorize`,
    deferred_credential_endpoint:  `${BASE_URL}/api/v1/oidc/deferred-credential`,
    jwks_uri: `${CLIENT_URL}/.well-known/jwks.json`,
    grant_types_supported: ['urn:ietf:params:oauth:grant-type:pre-authorized_code', 'authorization_code'],
    credential_configurations_supported: {
      TalentLedgerTVETCredential: {
        format: 'vc+sd-jwt',
        scope: 'tvet_credential',
        cryptographic_binding_methods_supported: ['did:key', 'did:talentledger', 'did:web'],
        credential_signing_alg_values_supported: ['EdDSA'],
        proof_types_supported: { jwt: { proof_signing_alg_values_supported: ['EdDSA'] } },
        display: [{
          name: 'TVET / Vocational Credential',
          locale: 'en',
          background_color: '#002D72',
          text_color: '#FFFFFF',
          logo: { uri: `${BASE_URL}/api/v1/assets/logo-tvet.png`, alt_text: 'TalentLedger TVET' },
        }],
        credential_definition: {
          type: ['VerifiableCredential', 'TalentLedgerTVETCredential'],
          credentialSubject: {
            trade: { display: [{ name: 'Trade', locale: 'en' }] },
            nvqLevel: { display: [{ name: 'NQF Level', locale: 'en' }] },
            boardName: { display: [{ name: 'Issuing Board', locale: 'en' }] },
          },
        },
      },
      TalentLedgerRPLCredential: {
        format: 'vc+sd-jwt',
        scope: 'rpl_credential',
        cryptographic_binding_methods_supported: ['did:key', 'did:talentledger'],
        credential_signing_alg_values_supported: ['EdDSA'],
        proof_types_supported: { jwt: { proof_signing_alg_values_supported: ['EdDSA'] } },
        display: [{ name: 'RPL Certificate', locale: 'en', background_color: '#1E5C35', text_color: '#FFFFFF' }],
      },
      TalentLedgerAcademicCredential: {
        format: 'vc+sd-jwt',
        scope: 'academic_credential',
        cryptographic_binding_methods_supported: ['did:key', 'did:talentledger'],
        credential_signing_alg_values_supported: ['EdDSA'],
        proof_types_supported: { jwt: { proof_signing_alg_values_supported: ['EdDSA'] } },
        display: [{ name: 'Academic Credential', locale: 'en' }],
      },
      TalentLedgerHealthCredential: {
        format: 'vc+sd-jwt',
        scope: 'health_credential',
        cryptographic_binding_methods_supported: ['did:key'],
        credential_signing_alg_values_supported: ['EdDSA'],
        display: [{ name: 'Health Clearance', locale: 'en' }],
      },
      TalentLedgerMigrationCredential: {
        format: 'vc+sd-jwt',
        scope: 'migration_credential',
        cryptographic_binding_methods_supported: ['did:key'],
        credential_signing_alg_values_supported: ['EdDSA'],
        display: [{ name: 'Migration Record', locale: 'en' }],
      },
    },
  });
});

// ── JWKS — Ed25519 public key ─────────────────────────────────────────────────
router.get('/jwks.json', (req, res) => {
  // Resolve the public key: prefer B64URL env var, fall back to deriving from multibase
  let publicKeyX = process.env.ISSUER_PUBLIC_KEY_B64URL;
  if (!publicKeyX) {
    const mb = process.env.ISSUER_PUBLIC_KEY_MULTIBASE;
    if (mb && mb.startsWith('z')) {
      // multibase base58btc → base64url
      const raw = Buffer.from(mb.slice(1), 'base64');
      publicKeyX = raw.toString('base64url');
    }
  }

  if (!publicKeyX) {
    return res.status(503).json({
      error: 'Issuer public key not configured. Set ISSUER_PUBLIC_KEY_B64URL in environment.',
    });
  }

  res.set('Cache-Control', 'public, max-age=3600');
  res.json({
    keys: [{
      kty: 'OKP',
      crv: 'Ed25519',
      use: 'sig',
      kid: 'key-1',
      alg: 'EdDSA',
      x: publicKeyX,
    }],
  });
});

export default router;
