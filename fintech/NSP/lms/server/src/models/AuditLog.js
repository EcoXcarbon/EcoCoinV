import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema({
  action: { type: String, required: true, index: true },
  userId: { type: String, default: 'anonymous' },
  userRole: { type: String, default: 'unknown' },
  userEmail: { type: String, default: 'unknown' },
  method: { type: String },
  path: { type: String },
  ip: { type: String },
  params: { type: mongoose.Schema.Types.Mixed },
  timestamp: { type: Date, default: Date.now },
}, { timestamps: false });

// TTL index: auto-delete logs older than 1 year
auditLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

// Compound index for querying by user + action
auditLogSchema.index({ userId: 1, action: 1 });

export default mongoose.model('AuditLog', auditLogSchema);
