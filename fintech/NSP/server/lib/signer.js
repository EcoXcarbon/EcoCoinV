'use strict';
/**
 * Registry signing key (Ed25519) used for:
 *   - QR verification tokens on cards and certificates (compact, offline-checkable)
 *   - W3C Verifiable Credential proofs exported from the registry
 *
 * Key material: NSP_SIGNING_KEY_PEM (PKCS#8) in the environment. If absent a
 * key pair is generated once and persisted under data/ so that tokens remain
 * valid across restarts in development. In production put the PEM in a secret
 * manager and set NSP_SIGNING_KEY_PEM.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

let privateKey = null;
let publicKey = null;

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

function loadKeys(dataDir) {
  if (privateKey) return;
  let pem = process.env.NSP_SIGNING_KEY_PEM;
  const keyFile = path.join(dataDir, 'signing-key.pem');
  if (!pem && fs.existsSync(keyFile)) pem = fs.readFileSync(keyFile, 'utf8');
  if (!pem) {
    const { privateKey: pk } = crypto.generateKeyPairSync('ed25519');
    pem = pk.export({ type: 'pkcs8', format: 'pem' });
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(keyFile, pem, { mode: 0o600 });
  }
  privateKey = crypto.createPrivateKey(pem);
  publicKey = crypto.createPublicKey(privateKey);
}

function publicKeyMultibase() {
  // raw 32-byte Ed25519 public key, base58btc with multicodec prefix 0xed01 => "z6Mk..."
  const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  const prefixed = Buffer.concat([Buffer.from([0xed, 0x01]), raw]);
  return 'z' + base58(prefixed);
}
function publicKeyJwk() {
  return publicKey.export({ format: 'jwk' });
}
function keyId() {
  const raw = publicKey.export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(buf) {
  let x = BigInt('0x' + buf.toString('hex'));
  let out = '';
  while (x > 0n) { out = B58[Number(x % 58n)] + out; x /= 58n; }
  for (const b of buf) { if (b === 0) out = '1' + out; else break; }
  return out;
}

/** Canonical JSON: keys sorted recursively, no whitespace (JCS-compatible for our value types). */
function canonicalize(v) {
  if (Array.isArray(v)) return '[' + v.map(canonicalize).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonicalize(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

function signBytes(bytes) {
  return crypto.sign(null, bytes, privateKey);
}
function verifyBytes(bytes, sig, pub) {
  try { return crypto.verify(null, bytes, pub || publicKey, sig); } catch { return false; }
}

/**
 * Compact verification token placed inside the QR code:
 *   <base64url(payload json)>.<base64url(signature)>
 * Payload is intentionally small so the QR stays at version <= 10.
 */
function issueToken(payload) {
  const body = Buffer.from(canonicalize(payload));
  const sig = signBytes(body);
  return `${b64url(body)}.${b64url(sig)}`;
}
function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return { valid: false, reason: 'malformed' };
  const [p, s] = token.split('.');
  let payload;
  try { payload = JSON.parse(unb64url(p).toString('utf8')); } catch { return { valid: false, reason: 'payload' }; }
  const ok = verifyBytes(Buffer.from(canonicalize(payload)), unb64url(s));
  if (!ok) return { valid: false, reason: 'signature' };
  return { valid: true, payload };
}

/** Attach a Data-Integrity style proof (eddsa over canonical JSON) to a VC document. */
function signCredential(vc, verificationMethod) {
  const doc = { ...vc };
  delete doc.proof;
  const bytes = Buffer.from(canonicalize(doc));
  const sig = signBytes(bytes);
  return {
    ...doc,
    proof: {
      type: 'DataIntegrityProof',
      cryptosuite: 'eddsa-jcs-2022',
      created: new Date().toISOString(),
      verificationMethod,
      proofPurpose: 'assertionMethod',
      proofValue: 'z' + base58(sig)
    }
  };
}

module.exports = { loadKeys, issueToken, verifyToken, signCredential, canonicalize, publicKeyMultibase, publicKeyJwk, keyId, b64url };
