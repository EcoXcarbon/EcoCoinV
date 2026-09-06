/**
 * Retroactive certificate issuance script
 * Run: node --experimental-vm-modules src/scripts/issueMissingCertificates.js
 *
 * Finds every enrollment with status='completed' and certificateIssued=false,
 * then issues a TL-LMS certificate credential for each one.
 */

import '../config/env.js';
import mongoose from 'mongoose';
import Training from '../models/Training.js';
import Worker from '../models/Worker.js';
import Credential from '../models/Credential.js';
import User from '../models/User.js';
import { generateVC } from '../services/credentialService.js';
import connectDB from '../config/db.js';

await connectDB();

console.log('Scanning for completed enrollments without certificates...\n');

const programs = await Training.find({ 'enrollments.status': 'completed' });
let issued = 0;
let skipped = 0;
let failed = 0;

for (const program of programs) {
  for (const enrollment of program.enrollments) {
    if (enrollment.status !== 'completed') continue;
    if (enrollment.certificateIssued) { skipped++; continue; }

    try {
      const worker = await Worker.findById(enrollment.worker);
      if (!worker) { console.warn(`  Worker not found for enrollment in "${program.title}"`); failed++; continue; }

      const count = await Credential.countDocuments();
      const credentialId = `TL-LMS-${String(count + 1).padStart(5, '0')}`;

      const vc = generateVC({
        credentialId,
        worker,
        type: 'micro-credential',
        title: `${program.title} — Completion Certificate`,
        trade: program.trade,
        nqfLevel: program.nqfLevel || 2,
        institution: program.institution,
      });

      const adminUser = await User.findOne({ role: 'admin' }).select('_id');
      await Credential.create({
        credentialId,
        worker: worker._id,
        issuedBy: adminUser?._id || worker.user,
        type: 'micro-credential',
        trade: program.trade,
        title: `${program.title} — Completion Certificate`,
        nqfLevel: program.nqfLevel || 2,
        institution: program.institution,
        vc,
        validFrom: enrollment.completedAt || new Date(),
        validUntil: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000),
        status: 'active',
      });

      enrollment.certificateIssued = true;
      enrollment.certificateId = credentialId;
      issued++;
      console.log(`  Issued ${credentialId} → Worker ${worker._id} | Course: "${program.title}"`);
    } catch (err) {
      console.error(`  FAILED for enrollment ${enrollment._id}: ${err.message}`);
      failed++;
    }
  }
  await program.save();
}

console.log(`\nDone. Issued: ${issued} | Already had cert: ${skipped} | Failed: ${failed}`);
await mongoose.disconnect();
