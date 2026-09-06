// Ed25519 Key Management Service for Talent Ledger
import crypto from 'crypto';

/**
 * Generate an Ed25519 key pair
 * @returns {{ publicKey: string, privateKey: string }} Keys in hex encoding
 */
export function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });
  return {
    publicKey: publicKey.toString('hex'),
    privateKey: privateKey.toString('hex'),
    publicKeyMultibase: 'z' + Buffer.from(publicKey).toString('base64url'),
    privateKeyMultibase: 'z' + Buffer.from(privateKey).toString('base64url'),
  };
}

/**
 * Sign data with Ed25519 private key
 * @param {string|Buffer} data - Data to sign
 * @param {string} privateKeyHex - Private key in hex
 * @returns {string} Signature in hex
 */
export function sign(data, privateKeyHex) {
  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(privateKeyHex, 'hex'),
    format: 'der',
    type: 'pkcs8',
  });
  const signature = crypto.sign(null, Buffer.from(typeof data === 'string' ? data : data), privateKey);
  return signature.toString('hex');
}

/**
 * Verify Ed25519 signature
 * @param {string|Buffer} data - Original data
 * @param {string} signatureHex - Signature in hex
 * @param {string} publicKeyHex - Public key in hex
 * @returns {boolean} Whether signature is valid
 */
export function verify(data, signatureHex, publicKeyHex) {
  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(publicKeyHex, 'hex'),
      format: 'der',
      type: 'spki',
    });
    return crypto.verify(null, Buffer.from(typeof data === 'string' ? data : data), publicKey, Buffer.from(signatureHex, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Generate a SHA-256 hash of data
 * @param {string|object} data - Data to hash (objects are JSON.stringified)
 * @returns {string} Hex hash
 */
export function sha256(data) {
  const input = typeof data === 'string' ? data : JSON.stringify(data);
  return crypto.createHash('sha256').update(input).digest('hex');
}

export default { generateKeyPair, sign, verify, sha256 };
