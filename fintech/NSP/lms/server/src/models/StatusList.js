import mongoose from 'mongoose';

const statusListSchema = new mongoose.Schema({
  issuerId: { type: String, required: true, unique: true },
  bitstring: { type: Buffer, required: true },
  nextIndex: { type: Number, default: 0 },
  // Public URL where verifiers can fetch the signed StatusList2021Credential
  publicUrl: { type: String },
  // Cached signed VC (refreshed on each revocation)
  signedVc: { type: mongoose.Schema.Types.Mixed },
  signedVcUpdatedAt: { type: Date },
}, { timestamps: true });

// Note: `issuerId` is already indexed via `unique: true` on the field above.

export default mongoose.model('StatusList', statusListSchema);
