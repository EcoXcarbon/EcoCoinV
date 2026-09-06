import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

const portfolioSchema = new mongoose.Schema({
  portfolioId: { type: String, unique: true, default: () => uuidv4() },
  holderCnic: { type: String, required: true, index: true },
  holder: { type: mongoose.Schema.Types.ObjectId, ref: 'Worker' },
  name: { type: String, required: true, maxlength: 200 },
  description: { type: String, maxlength: 1000 },
  category: {
    type: String,
    enum: ['GULF_DEPLOYMENT', 'EDUCATION', 'TRADE_SKILLS', 'PROFESSIONAL', 'GENERAL', 'CUSTOM'],
    default: 'CUSTOM',
  },
  credentials: [{
    credentialId: { type: String, required: true },
    addedAt: { type: Date, default: Date.now },
  }],
  shareSettings: {
    isPublic: { type: Boolean, default: false },
    shareUrl: { type: String },
    expiresAt: { type: Date },
  },
  isDeleted: { type: Boolean, default: false },
}, { timestamps: true });

portfolioSchema.index({ holderCnic: 1, isDeleted: 1 });

export default mongoose.model('Portfolio', portfolioSchema);
