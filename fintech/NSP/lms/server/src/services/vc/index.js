// W3C Verifiable Credential Engine — unified export
export { generateKeyPair, sign, verify, sha256 } from './keyManagement.js';
export { createDID, resolveDID, rotateKeys } from './didService.js';
export {
  generateVerifiableCredential,
  signCredential,
  verifyCredentialSignature,
  generateVcJwt,
} from './credentialService.js';
export {
  createStatusList,
  allocateIndex,
  revokeCredential,
  checkRevocationStatus,
  generateStatusListCredential,
} from './revocationService.js';
export {
  anchorToBlockchain,
  verifyBlockchainAnchor,
  batchAnchor,
} from './blockchainService.js';
export { generateCredentialQR, generateProfileQR } from './qrService.js';
export { CREDENTIAL_CONTEXTS, CREDENTIAL_SCHEMAS } from './credentialSchemas.js';
