import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema({
  worker: { type: mongoose.Schema.Types.ObjectId, ref: 'Worker', required: true },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, maxlength: 300 },
  description: { type: String, maxlength: 1000 },
  category: {
    type: String,
    enum: ['cv-resume', 'certificate', 'experience-letter', 'reference-letter', 'identity-doc', 'training-cert', 'safety-card', 'medical-cert', 'passport', 'photo', 'work-sample', 'other'],
    default: 'other',
  },
  file: {
    name: { type: String, required: true },
    url: { type: String, required: true },
    size: { type: Number },
    mimeType: { type: String },
  },
  status: { type: String, enum: ['active', 'archived'], default: 'active' },
  expiryDate: { type: Date },
}, { timestamps: true });

documentSchema.index({ worker: 1, category: 1 });
documentSchema.index({ worker: 1, status: 1 });

export default mongoose.model('Document', documentSchema);
