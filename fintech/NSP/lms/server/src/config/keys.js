import crypto from 'crypto';
import env from './env.js';

/* ═══════════════════════════════════════════════════════════
   GAP 1: ED25519 KEYPAIR FOR W3C VC SIGNING
   Generates deterministic keypair from CREDENTIAL_SIGNING_KEY
   or derives from JWT_SECRET hash.
   ═══════════════════════════════════════════════════════════ */

let _keyPair = null;
let _issuerDID = null;

function getOrCreateKeyPair() {
  if (_keyPair) return _keyPair;

  // Use CREDENTIAL_SIGNING_KEY env var if available, else derive from JWT_SECRET
  const seed = env.CREDENTIAL_SIGNING_KEY || crypto.createHash('sha256').update(env.JWT_SECRET + ':vc-signing').digest('hex').slice(0, 64);

  // Generate Ed25519 keypair deterministically from seed
  const seedBuffer = Buffer.from(seed, 'hex').slice(0, 32);
  _keyPair = crypto.sign ? generateEd25519FromSeed(seedBuffer) : generateFallbackKey(seedBuffer);

  return _keyPair;
}

function generateEd25519FromSeed(seedBuffer) {
  try {
    const privateKey = crypto.createPrivateKey({
      key: Buffer.concat([
        Buffer.from('302e020100300506032b657004220420', 'hex'), // Ed25519 PKCS8 prefix
        seedBuffer,
      ]),
      format: 'der',
      type: 'pkcs8',
    });
    const publicKey = crypto.createPublicKey(privateKey);

    // Export raw public key for DID
    const pubRaw = publicKey.export({ type: 'spki', format: 'der' });
    const pubBytes = pubRaw.slice(-32); // last 32 bytes is the raw key

    return { privateKey, publicKey, publicKeyBytes: pubBytes, type: 'Ed25519' };
  } catch (e) {
    console.warn('Ed25519 key generation failed, using HMAC fallback:', e.message);
    return generateFallbackKey(seedBuffer);
  }
}

function generateFallbackKey(seedBuffer) {
  // Fallback: use HMAC-based signing if Ed25519 not available
  return {
    privateKey: seedBuffer,
    publicKey: seedBuffer,
    publicKeyBytes: seedBuffer,
    type: 'HMAC-SHA256',
  };
}

export function getIssuerKeyPair() {
  return getOrCreateKeyPair();
}

export function getIssuerDID() {
  if (_issuerDID) return _issuerDID;

  const kp = getOrCreateKeyPair();
  const pubHex = kp.publicKeyBytes.toString('hex');

  // Multicodec prefix for Ed25519 public key: 0xed01
  const multicodec = Buffer.concat([Buffer.from('ed01', 'hex'), kp.publicKeyBytes]);
  // Base58btc encoding (simplified: use hex for reliability)
  const encoded = 'z' + multicodec.toString('base64url');

  _issuerDID = `did:key:${encoded}`;
  return _issuerDID;
}

export function signPayload(payload) {
  const kp = getOrCreateKeyPair();
  if (kp.type === 'Ed25519') {
    return crypto.sign(null, Buffer.from(payload), kp.privateKey).toString('base64url');
  }
  // HMAC fallback
  return crypto.createHmac('sha256', kp.privateKey).update(payload).digest('base64url');
}

export function verifySignature(payload, signature) {
  const kp = getOrCreateKeyPair();
  if (kp.type === 'Ed25519') {
    try {
      return crypto.verify(null, Buffer.from(payload), kp.publicKey, Buffer.from(signature, 'base64url'));
    } catch {
      return false;
    }
  }
  // HMAC fallback
  const expected = crypto.createHmac('sha256', kp.privateKey).update(payload).digest('base64url');
  const expBuf = Buffer.from(expected);
  const sigBuf = Buffer.from(signature);
  // timingSafeEqual throws on length mismatch — guard first.
  return expBuf.length === sigBuf.length && crypto.timingSafeEqual(expBuf, sigBuf);
}
