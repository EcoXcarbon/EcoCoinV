// DID (Decentralized Identifier) Service for Talent Ledger
// Format: did:talentledger:<entityType>:<entityId>

import { generateKeyPair } from './keyManagement.js';

/**
 * Create a DID for an entity (issuer or holder)
 * @param {'issuer'|'holder'} entityType
 * @param {string} entityId - UUID or unique identifier
 * @returns {{ did: string, didDocument: object, keyPair: object }}
 */
export function createDID(entityType, entityId) {
  const did = `did:talentledger:${entityType}:${entityId}`;
  const keyPair = generateKeyPair();
  const verificationMethodId = `${did}#key-1`;

  const didDocument = {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/ed2020/v1',
    ],
    id: did,
    controller: did,
    verificationMethod: [{
      id: verificationMethodId,
      type: 'Ed25519VerificationKey2020',
      controller: did,
      publicKeyMultibase: keyPair.publicKeyMultibase,
    }],
    authentication: [verificationMethodId],
    assertionMethod: [verificationMethodId],
    service: [{
      id: `${did}#credential-service`,
      type: 'TalentLedgerCredentialService',
      serviceEndpoint: `https://api.talentledger.pk/v1/registry/credentials`,
    }],
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };

  return { did, didDocument, keyPair };
}

/**
 * Resolve a DID to its DID Document
 * For now, this returns a constructed DID document from stored data.
 * In production, this would query a DID registry or blockchain.
 * @param {string} did - The DID to resolve
 * @param {object} storedData - Stored entity data with publicKey, etc.
 * @returns {object} DID Document
 */
export function resolveDID(did, storedData = {}) {
  const parts = did.split(':');
  if (parts.length !== 4 || parts[0] !== 'did' || parts[1] !== 'talentledger') {
    throw new Error(`Invalid Talent Ledger DID format: ${did}`);
  }

  const verificationMethodId = `${did}#key-1`;
  return {
    '@context': ['https://www.w3.org/ns/did/v1'],
    id: did,
    controller: did,
    verificationMethod: [{
      id: verificationMethodId,
      type: 'Ed25519VerificationKey2020',
      controller: did,
      publicKeyMultibase: storedData.publicKeyMultibase || storedData.publicKey || '',
    }],
    authentication: [verificationMethodId],
    assertionMethod: [verificationMethodId],
  };
}

/**
 * Rotate keys for an entity
 * @param {string} did - Entity DID
 * @returns {{ newKeyPair: object, didDocument: object, oldKeyRevoked: boolean }}
 */
export function rotateKeys(did) {
  const newKeyPair = generateKeyPair();
  const newVerificationMethodId = `${did}#key-${Date.now()}`;

  const updatedDidDocument = {
    '@context': ['https://www.w3.org/ns/did/v1'],
    id: did,
    controller: did,
    verificationMethod: [{
      id: newVerificationMethodId,
      type: 'Ed25519VerificationKey2020',
      controller: did,
      publicKeyMultibase: newKeyPair.publicKeyMultibase,
    }],
    authentication: [newVerificationMethodId],
    assertionMethod: [newVerificationMethodId],
    updated: new Date().toISOString(),
  };

  return { newKeyPair, didDocument: updatedDidDocument, oldKeyRevoked: true };
}

export default { createDID, resolveDID, rotateKeys };
