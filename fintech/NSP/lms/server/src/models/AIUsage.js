import mongoose from 'mongoose';

const aiUsageSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: String, required: true },
  requests: { type: Number, default: 0 },
  inputTokens: { type: Number, default: 0 },
  outputTokens: { type: Number, default: 0 },
});

aiUsageSchema.index({ user: 1, date: 1 }, { unique: true });

export default mongoose.model('AIUsage', aiUsageSchema);
