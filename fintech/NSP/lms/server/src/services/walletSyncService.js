// Wallet Credential Import & Sync Service
import RegistryCredential from '../models/RegistryCredential.js';

/**
 * Sync credentials for a holder — differential sync
 * @param {string} holderCnic - CNIC of the holder
 * @param {Date} lastSyncAt - Last sync timestamp (only fetch newer)
 * @returns {{ credentials: object[], syncedAt: string, newCount: number }}
 */
export async function syncCredentials(holderCnic, lastSyncAt) {
  const filter = { holderCnic, isDeleted: false };
  if (lastSyncAt) {
    filter.updatedAt = { $gt: new Date(lastSyncAt) };
  }

  const credentials = await RegistryCredential.find(filter)
    .sort({ updatedAt: -1 })
    .lean();

  return {
    credentials,
    syncedAt: new Date().toISOString(),
    newCount: credentials.length,
  };
}

/**
 * Import an Open Badges 3.0 credential from URL
 * @param {string} badgeUrl - URL to the Open Badge JSON
 * @param {string} holderCnic - CNIC of the holder importing
 * @returns {object} Created registry credential
 */
export async function importOpenBadge(badgeUrl, holderCnic) {
  // Fetch badge JSON from URL
  const response = await fetch(badgeUrl);
  if (!response.ok) throw new Error(`Failed to fetch badge: ${response.status}`);
  const badgeJson = await response.json();

  // Parse Open Badge 3.0 fields
  const credential = new RegistryCredential({
    holderCnic,
    credentialType: 'MICRO_CREDENTIAL',
    credentialSubtype: 'OPEN_BADGE',
    title: badgeJson.name || badgeJson.achievement?.name || 'Imported Badge',
    issuerName: badgeJson.issuer?.name || badgeJson.badge?.issuer?.name || 'External Issuer',
    issuanceDate: badgeJson.issuedOn || badgeJson.issuanceDate || new Date(),
    expiryDate: badgeJson.expires || badgeJson.expirationDate,
    status: 'PENDING_VERIFICATION',
    verificationStatus: 'PLATFORM_VERIFIED',
    metadata: {
      microCredential: {
        platform: 'OTHER',
        courseName: badgeJson.achievement?.name || badgeJson.name,
        certificateUrl: badgeUrl,
        skillsTags: badgeJson.achievement?.tag?.map(t => t.name) || [],
        badgeStandard: 'OPEN_BADGES_3',
        badgeJson,
      },
    },
    w3cVcJson: badgeJson,
  });

  await credential.save();
  return credential;
}

/**
 * Create a self-declared skill credential
 * @param {object} skillData - { skillName, skillCategory, proficiencyLevel, yearsExperience, description }
 * @param {string} holderCnic
 * @returns {object} Created credential
 */
export async function createSelfDeclaration(skillData, holderCnic) {
  const credential = new RegistryCredential({
    holderCnic,
    credentialType: 'SELF_DECLARED',
    title: `Self-Declared: ${skillData.skillName}`,
    issuerId: 'talentledger-platform',
    issuerName: 'TalentLedger Self-Declared',
    status: 'ACTIVE',
    verificationStatus: 'SELF_DECLARED',
    metadata: {
      selfDeclared: {
        skillName: skillData.skillName,
        skillCategory: skillData.skillCategory,
        proficiencyLevel: skillData.proficiencyLevel,
        yearsExperience: skillData.yearsExperience,
        description: skillData.description,
        evidenceDescription: skillData.evidenceDescription,
        willingToAssess: skillData.willingToAssess || false,
      },
    },
  });

  await credential.save();
  return credential;
}

export default { syncCredentials, importOpenBadge, createSelfDeclaration };
