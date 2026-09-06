/**
 * One-time backfill: sync all existing LMS Credentials → RegistryCredential
 * Run: node --experimental-vm-modules src/scripts/syncCredentialsToRegistry.js
 *
 * Safe to re-run: duplicate guard via legacyCredential field.
 */

import '../config/env.js';
import mongoose from 'mongoose';
import Credential from '../models/Credential.js';
import RegistryCredential from '../models/RegistryCredential.js';
import Issuer from '../models/Issuer.js';
import Worker from '../models/Worker.js';
import { decrypt } from '../utils/encryption.js';
import connectDB from '../config/db.js';
import { PUBLIC_BASE } from '../config/identity.js';

await connectDB();

const PPMC_ISSUER_ID = 'TL-PPMC';

// Auto-register PPMC issuer
await Issuer.findOneAndUpdate(
  { issuerId: PPMC_ISSUER_ID },
  {
    $setOnInsert: {
      issuerId: PPMC_ISSUER_ID,
      issuerName: 'PPMC / TalentLedger Platform',
      issuerType: 'PLATFORM',
      issuerCategory: 'FEDERAL',
      didIdentifier: `did:talentledger:issuer:${PPMC_ISSUER_ID}`,
      officialWebsite: PUBLIC_BASE,
      status: 'ACTIVE',
    },
  },
  { upsert: true }
);
console.log('Issuer TL-PPMC ensured.\n');

const credentials = await Credential.find({ status: 'active' });
console.log(`Found ${credentials.length} active LMS credentials.\n`);

let synced = 0;
let skipped = 0;
let failed = 0;

for (const cred of credentials) {
  try {
    // Skip if already in registry
    const exists = await RegistryCredential.exists({ legacyCredential: cred._id });
    if (exists) { skipped++; continue; }

    const worker = await Worker.findById(cred.worker).select('cnicEncrypted cnicMasked');
    if (!worker) { console.warn(`  Worker not found for cred ${cred.credentialId}`); failed++; continue; }

    let holderCnic = worker.cnicMasked || 'unknown';
    try { holderCnic = decrypt(worker.cnicEncrypted); } catch {}

    await RegistryCredential.create({
      holderCnic,
      holder: worker._id,
      credentialType: 'MICRO_CREDENTIAL',
      credentialSubtype: 'LMS_CERTIFICATE',
      title: cred.title || `${cred.trade} Completion Certificate`,
      issuerId: PPMC_ISSUER_ID,
      issuerName: 'PPMC / TalentLedger Platform',
      status: 'ACTIVE',
      verificationStatus: 'PLATFORM_VERIFIED',
      verificationMethod: 'API_DIRECT',
      verificationDate: cred.createdAt || new Date(),
      verifiedBy: 'system',
      issuanceDate: cred.validFrom || cred.createdAt || new Date(),
      expiryDate: cred.validUntil || new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000),
      w3cVcJson: cred.vc || null,
      legacyCredential: cred._id,
      metadata: {
        microCredential: {
          platform: 'OTHER',
          courseName: cred.title,
          skillsTags: cred.trade ? [cred.trade] : [],
        },
      },
    });

    synced++;
    console.log(`  Synced ${cred.credentialId} → Registry`);
  } catch (err) {
    console.error(`  FAILED ${cred.credentialId}: ${err.message}`);
    failed++;
  }
}

console.log(`\nDone. Synced: ${synced} | Already in registry: ${skipped} | Failed: ${failed}`);
await mongoose.disconnect();
