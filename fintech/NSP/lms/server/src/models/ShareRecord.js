import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

const shareRecordSchema = new mongoose.Schema({
  shareId: { type: String, unique: true, default: () => uuidv4() },
  holderCnic: { type: String, required: true, index: true },
  holder: { type: mongoose.Schema.Types.ObjectId, ref: 'Worker' },
  // What was shared
  sharedCredentials: [{
    credentialId: { type: String, required: true },
    credentialTitle: { type: String },
    // Selective disclosure: which fields were included
    disclosedFields: [{ type: String }],
    // Snapshot of the disclosed field VALUES at share time (model-independent,
    // so the public view works for both registry and legacy credentials).
    disclosedData: { type: mongoose.Schema.Types.Mixed },
  }],
  portfolioId: { type: String },
  // Recipient info
  recipientName: { type: String, maxlength: 200 },
  recipientEmail: { type: String, maxlength: 200 },
  recipientOrganization: { type: String, maxlength: 200 },
  purpose: { type: String, maxlength: 500 },
  // Share mechanism
  shareType: {
    type: String,
    enum: ['QR_CODE', 'DIRECT_LINK', 'EMAIL', 'LINKEDIN', 'PDF_EXPORT'],
    default: 'DIRECT_LINK',
  },
  shareUrl: { type: String },
  // Access control
  expiresAt: { type: Date },
  accessCount: { type: Number, default: 0 },
  maxAccessCount: { type: Number },
  // Consent
  consentGiven: { type: Boolean, default: true },
  consentTimestamp: { type: Date, default: Date.now },
  consentDetails: { type: String },
  // Status
  status: {
    type: String,
    enum: ['ACTIVE', 'EXPIRED', 'REVOKED'],
    default: 'ACTIVE',
  },
  revokedAt: { type: Date },
  // Access log
  accessLog: [{
    accessedAt: { type: Date, default: Date.now },
    accessedBy: { type: String },
    ipAddress: { type: String },
    userAgent: { type: String },
  }],
}, { timestamps: true });

shareRecordSchema.index({ holderCnic: 1, status: 1 });
// Note: `shareId` is already indexed via `unique: true` on the field above.
shareRecordSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('ShareRecord', shareRecordSchema);
