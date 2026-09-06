import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: {
    type: String,
    enum: [
      'rpl-stage-change', 'rpl-assessor-assigned', 'rpl-decision', 'rpl-appeal-result',
      'rpl-moderation-complete', 'rpl-evidence-received', 'rpl-consent-required',
      'credential-issued', 'credential-expiring', 'credential-expired',
      'credential-submitted', 'credential-verified', 'credential-rejected',
      'credential-changes-requested', 'credential-forwarded',
      'gap-training-recommended', 'general',
    ],
    required: true,
  },
  title: { type: String, required: true, maxlength: 300 },
  message: { type: String, required: true, maxlength: 2000 },
  link: { type: String, maxlength: 500 },
  read: { type: Boolean, default: false },
  readAt: { type: Date },
  // Reference to related entities
  assessment: { type: mongoose.Schema.Types.ObjectId, ref: 'Assessment' },
  credential: { type: mongoose.Schema.Types.ObjectId, ref: 'Credential' },
  worker: { type: mongoose.Schema.Types.ObjectId, ref: 'Worker' },
  metadata: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

notificationSchema.index({ recipient: 1, read: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, type: 1 });

export default mongoose.model('Notification', notificationSchema);
