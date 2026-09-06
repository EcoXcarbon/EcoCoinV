/**
 * DB cleanup script — removes fake seeded data
 * Run: node src/scripts/cleanFakeData.js
 *
 * Deletes:
 *   - User records with email matching worker\d+@talentledger\.pk
 *   - Worker records linked to those users
 *   - Credential records with seeded IDs TL-2026-00001 to TL-2026-00029
 *   - Assessment records linked to deleted workers
 *   - Stale enrollments in Training programs (worker no longer in DB)
 */

import '../config/env.js';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Worker from '../models/Worker.js';
import Credential from '../models/Credential.js';
import Assessment from '../models/Assessment.js';
import Training from '../models/Training.js';
import connectDB from '../config/db.js';

await connectDB();

console.log('Starting fake data cleanup...\n');

// ── 1. Find fake worker users ────────────────────────────────────────────────
const fakeUsers = await User.find({ email: /^worker\d+@talentledger\.pk$/ }).select('_id email');
const fakeUserIds = fakeUsers.map(u => u._id);
console.log(`Found ${fakeUsers.length} fake worker user(s):`, fakeUsers.map(u => u.email));

// ── 2. Find Worker records linked to those users ─────────────────────────────
const fakeWorkers = await Worker.find({ user: { $in: fakeUserIds } }).select('_id user');
const fakeWorkerIds = fakeWorkers.map(w => w._id);
console.log(`Found ${fakeWorkers.length} fake Worker record(s).`);

// ── 3. Delete fake Credentials (seeded IDs TL-2026-00001 to TL-2026-00029) ───
const credentialResult = await Credential.deleteMany({
  credentialId: /^TL-2026-000(0[1-9]|[12][0-9])$/,
});
console.log(`Deleted ${credentialResult.deletedCount} fake Credential record(s).`);

// ── 4. Delete Assessment records linked to fake workers ───────────────────────
const assessmentResult = await Assessment.deleteMany({ worker: { $in: fakeWorkerIds } });
console.log(`Deleted ${assessmentResult.deletedCount} fake Assessment record(s).`);

// ── 5. Remove stale enrollments from Training programs ────────────────────────
// Collect all valid (still existing) worker IDs
const allValidWorkerIds = new Set(
  (await Worker.find().select('_id')).map(w => w._id.toString())
);

const programs = await Training.find({ 'enrollments.0': { $exists: true } });
let totalEnrollmentsRemoved = 0;

for (const program of programs) {
  const before = program.enrollments.length;
  program.enrollments = program.enrollments.filter(
    e => allValidWorkerIds.has(e.worker?.toString())
  );
  const removed = before - program.enrollments.length;
  if (removed > 0) {
    await program.save();
    totalEnrollmentsRemoved += removed;
    console.log(`  Removed ${removed} stale enrollment(s) from "${program.title}"`);
  }
}
console.log(`Removed ${totalEnrollmentsRemoved} stale enrollment(s) total across all Training programs.`);

// ── 6. Delete fake Worker records ─────────────────────────────────────────────
const workerResult = await Worker.deleteMany({ _id: { $in: fakeWorkerIds } });
console.log(`Deleted ${workerResult.deletedCount} fake Worker record(s).`);

// ── 7. Delete fake User records ────────────────────────────────────────────────
const userResult = await User.deleteMany({ _id: { $in: fakeUserIds } });
console.log(`Deleted ${userResult.deletedCount} fake User record(s).`);

// ── Summary ────────────────────────────────────────────────────────────────────
console.log('\n── Cleanup Summary ──────────────────────────────');
console.log(`  Users deleted:        ${userResult.deletedCount}`);
console.log(`  Workers deleted:      ${workerResult.deletedCount}`);
console.log(`  Credentials deleted:  ${credentialResult.deletedCount}`);
console.log(`  Assessments deleted:  ${assessmentResult.deletedCount}`);
console.log(`  Enrollments removed:  ${totalEnrollmentsRemoved}`);
console.log('─────────────────────────────────────────────────\n');

await mongoose.disconnect();
