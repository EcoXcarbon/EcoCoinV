// Verification Orchestrator — coordinates source verification workflow
import { getAdapter } from './adapters.js';
import RegistryCredential from '../../models/RegistryCredential.js';
import VerificationLog from '../../models/VerificationLog.js';
import {
  generateVerifiableCredential,
  signCredential,
  anchorToBlockchain,
  sha256,
} from '../vc/index.js';

// Map credential types to issuer adapter codes
const TYPE_TO_ADAPTER = {
  ACADEMIC: 'HEC',
  TVET: null, // Determined by metadata.tvet.boardProvince
  RPL: 'MANUAL',
  PROFESSIONAL_LICENSE: null, // Determined by metadata.professionalLicense.licensingBody
  MICRO_CREDENTIAL: 'OPEN_BADGES',
  IDENTITY_VERIFICATION: 'NADRA',
  MIGRATION_RECORD: 'BEOE',
  HEALTH_CLEARANCE: 'GAMCA',
  TRAINING_RECORD: 'NAVTTC',
  EMPLOYER_ENDORSEMENT: 'MANUAL',
  SELF_DECLARED: null, // No verification needed
};

/**
 * Determine which adapter to use for a credential
 */
function resolveAdapter(credential) {
  const type = credential.credentialType;
  let code = TYPE_TO_ADAPTER[type];

  if (!code && type === 'TVET') {
    const province = credential.metadata?.tvet?.boardProvince?.toUpperCase();
    code = province ? `${province}_BTE` : 'KP_BTE';
  }
  if (!code && type === 'PROFESSIONAL_LICENSE') {
    code = credential.metadata?.professionalLicense?.licensingBody || 'MANUAL';
  }
  if (!code) code = 'MANUAL';

  return getAdapter(code);
}

/**
 * Execute full verification workflow for a credential
 * @param {string} credentialId - Registry credential ID
 * @param {object} options - { autoAnchor, issuerPrivateKey }
 * @returns {{ success: boolean, result: object }}
 */
export async function verifyCredential(credentialId, options = {}) {
  const credential = await RegistryCredential.findOne({ credentialId });
  if (!credential) throw new Error(`Credential not found: ${credentialId}`);

  const adapter = resolveAdapter(credential);

  // 1. Check adapter availability (circuit breaker)
  const available = await adapter.checkAvailability();
  if (!available) {
    return {
      success: false,
      result: { status: 'ADAPTER_UNAVAILABLE', adapter: adapter.issuerCode, message: 'Source verification service temporarily unavailable' },
    };
  }

  // 2. Execute verification
  try {
    const verificationResult = await adapter.verifyCredential({
      credentialId: credential.credentialId,
      holderCnic: credential.holderCnic,
      title: credential.title,
      ...credential.getTypeMetadata(),
    });

    // 3. Update credential based on result
    if (verificationResult.verified) {
      credential.status = 'ACTIVE';
      credential.verificationStatus = 'SOURCE_VERIFIED';
      credential.verificationMethod = adapter.supportedMethods[0];
      credential.verificationDate = new Date();
      credential.verifiedBy = `adapter:${adapter.issuerCode}`;

      // 4. Generate W3C VC if not already generated
      if (!credential.w3cVcJson) {
        const issuerDID = `did:talentledger:issuer:${credential.issuerId || 'default'}`;
        const holderDID = `did:talentledger:holder:${credential.holderCnic}`;
        const vc = generateVerifiableCredential(credential.toObject(), issuerDID, holderDID);

        if (options.issuerPrivateKey) {
          const signed = signCredential(vc, options.issuerPrivateKey);
          credential.w3cVcJson = signed;
        } else {
          credential.w3cVcJson = vc;
        }
      }

      // 5. Anchor to blockchain
      if (options.autoAnchor !== false && credential.credentialHash) {
        try {
          const anchorResult = await anchorToBlockchain(credential.credentialHash);
          credential.blockchainTxHash = anchorResult.txHash;
          credential.blockchainAnchorDate = new Date();
        } catch (err) {
          console.warn('Blockchain anchoring deferred:', err.message);
        }
      }

      await credential.save();
    } else if (verificationResult.ticketCreated) {
      // Manual verification queued
      credential.status = 'PENDING_VERIFICATION';
      await credential.save();
    } else {
      credential.verificationStatus = 'VERIFICATION_FAILED';
      await credential.save();
    }

    // 6. Log verification
    await new VerificationLog({
      credentialId: credential.credentialId,
      credential: credential._id,
      verifierType: 'INSTITUTION',
      verifierIdentifier: adapter.issuerCode,
      verificationResult: verificationResult.verified ? 'VALID' : 'INVALID',
      verificationMethodUsed: 'API_QUERY',
      checks: {
        existence: { passed: true },
        signature: { passed: !!credential.w3cVcJson?.proof },
        blockchain: { passed: !!credential.blockchainTxHash },
        revocation: { passed: credential.status !== 'REVOKED' },
        expiry: { passed: !credential.isExpired() },
      },
    }).save();

    return { success: verificationResult.verified, result: verificationResult };
  } catch (err) {
    return {
      success: false,
      result: { status: 'ERROR', adapter: adapter.issuerCode, error: err.message },
    };
  }
}

/**
 * Get verification queue for an adapter
 */
export async function getVerificationQueue(adapterCode) {
  const pendingCredentials = await RegistryCredential.find({
    status: 'PENDING_VERIFICATION',
    isDeleted: false,
  }).sort({ createdAt: 1 });

  // Filter to credentials that should use this adapter
  return pendingCredentials.filter(c => {
    const adapter = resolveAdapter(c);
    return adapter.issuerCode === adapterCode;
  });
}

export default { verifyCredential, getVerificationQueue };
