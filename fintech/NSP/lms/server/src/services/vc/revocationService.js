/**
 * BitstringStatusList Revocation Service (W3C BitstringStatusList — successor to StatusList2021)
 * https://www.w3.org/TR/vc-bitstring-status-list/
 *
 * Backward compatible: existing credentials with StatusList2021Entry still verify correctly
 * via the OCSP-style /ocsp-status endpoint. New credentials use BitstringStatusListEntry.
 */
import zlib from 'zlib';
import { promisify } from 'util';
import StatusList from '../../models/StatusList.js';
import { PUBLIC_BASE } from '../../config/identity.js';

const gzip   = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const BITSTRING_SIZE = 131072; // 16KB = 131,072 bits ≈ 131K credentials per issuer

// In-memory cache (synced with DB on every write)
const statusListCache = new Map();

async function loadOrCreate(issuerId) {
  if (statusListCache.has(issuerId)) return statusListCache.get(issuerId);

  let doc = await StatusList.findOne({ issuerId });
  if (!doc) {
    doc = new StatusList({
      issuerId,
      bitstring: Buffer.alloc(BITSTRING_SIZE / 8, 0),
      nextIndex: 0,
    });
    await doc.save();
  }
  const entry = {
    bitstring: Buffer.from(doc.bitstring),
    nextIndex: doc.nextIndex,
    created: doc.createdAt?.toISOString() || new Date().toISOString(),
    updated: doc.updatedAt?.toISOString() || new Date().toISOString(),
  };
  statusListCache.set(issuerId, entry);
  return entry;
}

async function persist(issuerId, entry) {
  statusListCache.set(issuerId, entry); // keep cache hot
  await StatusList.findOneAndUpdate(
    { issuerId },
    { bitstring: entry.bitstring, nextIndex: entry.nextIndex },
    { upsert: true }
  );
}

/** Invalidate cache so next read fetches fresh from DB */
export function invalidateCache(issuerId) {
  statusListCache.delete(issuerId);
}

/** Allocate next available status list index for a new credential */
export async function allocateIndex(issuerId) {
  const entry = await loadOrCreate(issuerId);
  if (entry.nextIndex >= BITSTRING_SIZE) {
    throw new Error(`Status list for issuer ${issuerId} is full (${BITSTRING_SIZE} max)`);
  }
  const index = entry.nextIndex;
  entry.nextIndex++;
  await persist(issuerId, entry);
  return index;
}

/** Set revocation bit */
export async function revokeCredential(issuerId, index, reason = '') {
  const entry = await loadOrCreate(issuerId);
  const byteIndex = Math.floor(index / 8);
  const bitIndex  = index % 8;
  if (byteIndex >= entry.bitstring.length) throw new Error(`Index ${index} out of range`);

  entry.bitstring[byteIndex] |= (1 << bitIndex);
  entry.updated = new Date().toISOString();
  await persist(issuerId, entry);

  return { revoked: true, revocationDate: entry.updated, reason, statusListIndex: index };
}

/** Unset revocation bit (reinstate) */
export async function reinstateCredential(issuerId, index) {
  const entry = await loadOrCreate(issuerId);
  const byteIndex = Math.floor(index / 8);
  const bitIndex  = index % 8;
  if (byteIndex >= entry.bitstring.length) throw new Error(`Index ${index} out of range`);

  entry.bitstring[byteIndex] &= ~(1 << bitIndex);
  entry.updated = new Date().toISOString();
  await persist(issuerId, entry);
  return { reinstated: true, statusListIndex: index };
}

/** Check revocation status for a single index */
export async function checkRevocationStatus(issuerId, index) {
  const entry = await loadOrCreate(issuerId);
  const byteIndex = Math.floor(index / 8);
  const bitIndex  = index % 8;

  if (byteIndex >= entry.bitstring.length) {
    return { revoked: false, statusListChecked: 'index_out_of_range', checkedAt: new Date().toISOString() };
  }

  const revoked = !!(entry.bitstring[byteIndex] & (1 << bitIndex));
  return {
    revoked,
    statusListChecked: `bitstring:${issuerId}:${index}`,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Generate a W3C BitstringStatusListCredential for public hosting.
 * The encodedList is GZIP-compressed then base64url-encoded per the spec.
 *
 * Also returns a legacy StatusList2021Credential block for backward compatibility.
 */
export async function generateStatusListCredential(issuerId, baseUrl = PUBLIC_BASE) {
  const entry = await loadOrCreate(issuerId);
  const listUrl = `${baseUrl}/api/v1/registry/status-list/${issuerId}`;

  // BitstringStatusList: GZIP + base64url
  const compressed = await gzip(entry.bitstring);
  const encodedList = compressed.toString('base64url');

  return {
    // ── W3C BitstringStatusListCredential (current spec) ──────────────────
    '@context': [
      'https://www.w3.org/ns/credentials/v2',
      'https://www.w3.org/ns/credentials/status/bitstring-status-list/v1',
    ],
    id: listUrl,
    type: ['VerifiableCredential', 'BitstringStatusListCredential'],
    issuer: { id: `did:talentledger:issuer:${issuerId}` },
    validFrom: entry.created,
    credentialSubject: {
      id: `${listUrl}#list`,
      type: 'BitstringStatusList',
      statusPurpose: 'revocation',
      encodedList,
    },
    // ── Legacy StatusList2021 block (backward compat) ─────────────────────
    _legacy: {
      '@context': ['https://www.w3.org/2018/credentials/v1', 'https://w3id.org/vc/status-list/2021/v1'],
      type: ['VerifiableCredential', 'StatusList2021Credential'],
      credentialSubject: {
        type: 'StatusList2021',
        statusPurpose: 'revocation',
        encodedList: entry.bitstring.toString('base64'), // uncompressed for StatusList2021
      },
    },
  };
}

/**
 * Build the credentialStatus block to embed in an issued VC.
 * Uses BitstringStatusListEntry (new) with StatusList2021Entry in _legacy.
 */
export function buildCredentialStatus(issuerId, statusListIndex, baseUrl = PUBLIC_BASE) {
  const listUrl = `${baseUrl}/api/v1/registry/status-list/${issuerId}`;
  return {
    // Current spec
    id: `${listUrl}#${statusListIndex}`,
    type: 'BitstringStatusListEntry',
    statusPurpose: 'revocation',
    statusListIndex: String(statusListIndex),
    statusListCredential: listUrl,
    // Legacy (verifiers using StatusList2021 still work)
    _legacyType: 'StatusList2021Entry',
  };
}

/** Create an empty status list for a new issuer */
export async function createStatusList(issuerId) {
  await loadOrCreate(issuerId);
  return { statusListId: issuerId, size: BITSTRING_SIZE };
}

export default {
  createStatusList,
  allocateIndex,
  revokeCredential,
  reinstateCredential,
  checkRevocationStatus,
  generateStatusListCredential,
  buildCredentialStatus,
  invalidateCache,
};
