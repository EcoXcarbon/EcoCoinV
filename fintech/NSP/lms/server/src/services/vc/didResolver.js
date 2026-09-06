/**
 * DID Resolver for TalentLedger
 * Supports: did:talentledger (native), did:key, did:web
 * Compatible with W3C DID Core 1.0 and Universal Resolver interface
 */
import crypto from 'crypto';
import { PUBLIC_BASE } from '../../config/identity.js';

// ── did:talentledger resolver ──────────────────────────────────────────────────
// Looks up issuer/worker in MongoDB and constructs DID Document
export async function resolveTalentLedgerDID(did) {
  const [, , entityType, entityId] = did.split(':'); // did:talentledger:<type>:<id>

  if (!entityType || !entityId) {
    return { didDocument: null, didDocumentMetadata: { error: 'invalidDid' } };
  }

  let publicKey = null;
  let serviceEndpoint = null;
  let name = null;

  try {
    if (entityType === 'issuer') {
      const { default: Issuer } = await import('../../models/Issuer.js');
      const issuer = await Issuer.findOne({ issuerId: entityId, status: 'ACTIVE' });
      if (!issuer) return { didDocument: null, didDocumentMetadata: { error: 'notFound' } };
      publicKey = issuer.publicKey;
      serviceEndpoint = issuer.verificationApiEndpoint || `${PUBLIC_BASE}/api/v1/registry/issuers/${entityId}`;
      name = issuer.issuerName;
    } else if (entityType === 'holder' || entityType === 'worker') {
      const { default: Worker } = await import('../../models/Worker.js');
      const worker = await Worker.findOne({ _id: entityId }).select('walletPublicKey fullName');
      if (!worker) return { didDocument: null, didDocumentMetadata: { error: 'notFound' } };
      publicKey = worker.walletPublicKey;
      serviceEndpoint = `${PUBLIC_BASE}/api/v1/registry/holders/${entityId}/profile-card`;
      name = worker.fullName;
    }
  } catch (e) {
    return { didDocument: null, didDocumentMetadata: { error: 'internalError', message: e.message } };
  }

  const vmId = `${did}#key-1`;

  const didDocument = {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/ed25519-2020/v1',
    ],
    id: did,
    verificationMethod: publicKey ? [{
      id: vmId,
      type: 'Ed25519VerificationKey2020',
      controller: did,
      publicKeyMultibase: publicKey.startsWith('z') ? publicKey : `z${publicKey}`,
    }] : [],
    authentication: publicKey ? [vmId] : [],
    assertionMethod: publicKey ? [vmId] : [],
    service: serviceEndpoint ? [{
      id: `${did}#credential-service`,
      type: 'TalentLedgerCredentialService',
      serviceEndpoint,
    }] : [],
    ...(name ? { alsoKnownAs: [name] } : {}),
  };

  return {
    didDocument,
    didDocumentMetadata: {
      created: new Date().toISOString(),
      method: 'talentledger',
    },
  };
}

// ── did:key resolver ──────────────────────────────────────────────────────────
// did:key:z<multibase-encoded-public-key>
export function resolveKeyDID(did) {
  const [, , keyId] = did.split(':'); // did:key:<keyId>
  if (!keyId || !keyId.startsWith('z')) {
    return { didDocument: null, didDocumentMetadata: { error: 'invalidDid' } };
  }

  const vmId = `${did}#${keyId}`;

  return {
    didDocument: {
      '@context': [
        'https://www.w3.org/ns/did/v1',
        'https://w3id.org/security/suites/ed25519-2020/v1',
      ],
      id: did,
      verificationMethod: [{
        id: vmId,
        type: 'Ed25519VerificationKey2020',
        controller: did,
        publicKeyMultibase: keyId,
      }],
      authentication: [vmId],
      assertionMethod: [vmId],
      capabilityInvocation: [vmId],
      capabilityDelegation: [vmId],
    },
    didDocumentMetadata: { method: 'key' },
  };
}

// ── did:web resolver ──────────────────────────────────────────────────────────
// did:web:hec.gov.pk → fetches https://hec.gov.pk/.well-known/did.json
export async function resolveWebDID(did) {
  const [, , ...domainParts] = did.split(':');
  const domain = domainParts.join('/').replace(/%3A/g, ':');
  const url = domainParts.length > 1
    ? `https://${domain}/did.json`
    : `https://${domain}/.well-known/did.json`;

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { Accept: 'application/did+ld+json, application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const didDocument = await response.json();
    return {
      didDocument,
      didDocumentMetadata: { method: 'web', fetchedFrom: url },
    };
  } catch (e) {
    return {
      didDocument: null,
      didDocumentMetadata: { error: 'fetchFailed', message: e.message, url },
    };
  }
}

// ── Universal resolver ────────────────────────────────────────────────────────
export async function resolveDID(did) {
  if (!did || typeof did !== 'string') {
    return { didDocument: null, didDocumentMetadata: { error: 'invalidDid' } };
  }

  const method = did.split(':')[1];

  switch (method) {
    case 'talentledger': return resolveTalentLedgerDID(did);
    case 'key': return resolveKeyDID(did);
    case 'web': return resolveWebDID(did);
    default:
      return {
        didDocument: null,
        didDocumentMetadata: {
          error: 'methodNotSupported',
          supportedMethods: ['talentledger', 'key', 'web'],
        },
      };
  }
}

// ── Generate did:key from Ed25519 public key ──────────────────────────────────
export function publicKeyToDIDKey(publicKeyHex) {
  const publicKeyBytes = Buffer.from(publicKeyHex, 'hex');
  // ed25519 multicodec prefix: 0xed01
  const prefixed = Buffer.concat([Buffer.from([0xed, 0x01]), publicKeyBytes]);
  const multibase = 'z' + prefixed.toString('base64url').replace(/=/g, '');
  return `did:key:${multibase}`;
}
