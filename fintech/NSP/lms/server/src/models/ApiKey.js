import mongoose from 'mongoose';
import crypto from 'crypto';

const apiKeySchema = new mongoose.Schema({
  keyHash: { type: String, required: true, unique: true }, // SHA-256 of raw key — never store raw
  keyPrefix: { type: String, required: true },             // first 12 chars for lookup hint
  consumerId: { type: String, required: true },            // user id or org name
  consumerUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  tier: { type: String, enum: ['free', 'premium', 'gov'], default: 'free' },
  scopes: [{ type: String, enum: ['verify', 'read', 'write', 'bulk', 'admin'] }],
  dailyLimit: { type: Number, default: 100 },              // free: 100, premium: 10000, gov: unlimited
  dailyCount: { type: Number, default: 0 },
  dailyReset: { type: Date, default: Date.now },
  totalRequests: { type: Number, default: 0 },
  lastUsedAt: { type: Date },
  lastUsedIp: { type: String },
  isActive: { type: Boolean, default: true },
  revokedAt: { type: Date },
  revokedBy: { type: String },
  revokedReason: { type: String },
  description: { type: String, maxlength: 300 },
  allowedIps: [String],    // empty = all allowed
  expiresAt: { type: Date }, // null = never expires
}, { timestamps: true });

apiKeySchema.index({ keyPrefix: 1 });
apiKeySchema.index({ consumerId: 1 });
apiKeySchema.index({ consumerUser: 1 });
apiKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, sparse: true });

// Generate a new key — returns { rawKey, record }
apiKeySchema.statics.generateKey = async function (consumerId, options = {}) {
  const rawKey = `tl_${crypto.randomBytes(32).toString('hex')}`;
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.slice(0, 12);

  const TIER_LIMITS = { free: 100, premium: 10000, gov: 0 }; // 0 = unlimited
  const tier = options.tier || 'free';

  const record = await new this({
    keyHash,
    keyPrefix,
    consumerId,
    consumerUser: options.userId,
    tier,
    scopes: options.scopes || ['verify', 'read'],
    dailyLimit: TIER_LIMITS[tier] ?? 100,
    description: options.description,
    allowedIps: options.allowedIps || [],
    expiresAt: options.expiresAt,
  }).save();

  return { rawKey, record };
};

// Look up by raw key — resets daily counter if new day
apiKeySchema.statics.authenticate = async function (rawKey, ip) {
  if (!rawKey || !rawKey.startsWith('tl_')) return null;

  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const record = await this.findOne({ keyHash, isActive: true });
  if (!record) return null;

  // Expiry check
  if (record.expiresAt && record.expiresAt < new Date()) return null;

  // IP allowlist check
  if (record.allowedIps.length > 0 && ip && !record.allowedIps.includes(ip)) return null;

  // Daily reset
  const today = new Date().toDateString();
  if (record.dailyReset.toDateString() !== today) {
    record.dailyCount = 0;
    record.dailyReset = new Date();
  }

  // Quota check (0 = unlimited)
  if (record.dailyLimit > 0 && record.dailyCount >= record.dailyLimit) return null;

  record.dailyCount += 1;
  record.totalRequests += 1;
  record.lastUsedAt = new Date();
  record.lastUsedIp = ip;
  await record.save();

  return record;
};

export default mongoose.model('ApiKey', apiKeySchema);
