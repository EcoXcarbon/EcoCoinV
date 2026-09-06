// QR Code Generation Service for Talent Ledger
import QRCode from 'qrcode';
import { sha256 } from './keyManagement.js';

const VERIFY_BASE_URL = process.env.VERIFY_BASE_URL || 'https://verify.talentledger.pk';

/**
 * Generate a QR code for a single credential verification
 * @param {string} credentialId - Credential UUID
 * @returns {{ png: Buffer, svg: string, url: string }}
 */
export async function generateCredentialQR(credentialId) {
  const url = `${VERIFY_BASE_URL}/v/${credentialId}`;

  const [png, svg] = await Promise.all([
    QRCode.toBuffer(url, {
      type: 'png',
      width: 400,
      margin: 2,
      color: { dark: '#1a365d', light: '#ffffff' },
      errorCorrectionLevel: 'H',
    }),
    QRCode.toString(url, {
      type: 'svg',
      width: 400,
      margin: 2,
      color: { dark: '#1a365d', light: '#ffffff' },
      errorCorrectionLevel: 'H',
    }),
  ]);

  return { png, svg, url };
}

/**
 * Generate a QR code for a holder's complete profile
 * @param {string} holderCnic - Holder's CNIC (will be hashed for privacy)
 * @returns {{ png: Buffer, svg: string, url: string }}
 */
export async function generateProfileQR(holderCnic) {
  const profileHash = sha256(holderCnic);
  const url = `${VERIFY_BASE_URL}/p/${profileHash}`;

  const [png, svg] = await Promise.all([
    QRCode.toBuffer(url, {
      type: 'png',
      width: 400,
      margin: 2,
      color: { dark: '#1a365d', light: '#ffffff' },
      errorCorrectionLevel: 'H',
    }),
    QRCode.toString(url, {
      type: 'svg',
      width: 400,
      margin: 2,
      color: { dark: '#1a365d', light: '#ffffff' },
      errorCorrectionLevel: 'H',
    }),
  ]);

  return { png, svg, url, profileHash };
}

export default { generateCredentialQR, generateProfileQR };
