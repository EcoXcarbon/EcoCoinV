import mongoose from 'mongoose';

const aiCacheSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  response: { type: String, required: true },
  model: String,
  inputTokens: Number,
  outputTokens: Number,
  createdAt: { type: Date, default: Date.now, expires: 86400 },  // 24h TTL
});

export default mongoose.model('AICache', aiCacheSchema);
