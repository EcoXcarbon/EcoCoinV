import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

const verificationLogSchema = new mongoose.Schema({
  logId: { type: String, unique: true, default: () => uuidv4() },
  credentialId: { type: String, required: true, index: true },
  credential: { type: mongoose.Schema.Types.ObjectId, ref: 'RegistryCredential' },

  verifierType: {
    type: String,
    required: true,
    enum: ['EMPLOYER', 'GOVERNMENT', 'INSTITUTION', 'PUBLIC_PORTAL', 'API_CLIENT'],
  },
  verifierIdentifier: { type: String, maxlength: 300 },   // company name, API key ref
  verifierCountry: { type: String, maxlength: 100 },

  verificationResult: {
    type: String,
    required: true,
    enum: ['VALID', 'INVALID', 'EXPIRED', 'REVOKED', 'NOT_FOUND'],
  },
  verificationMethodUsed: {
    type: String,
    required: true,
    enum: ['QR_SCAN', 'PORTAL_LOOKUP', 'API_QUERY'],
  },

  // Detailed check results
  checks: {
    existence: { passed: Boolean, details: String },
    signature: { passed: Boolean, algorithm: String, issuerDid: String },
    blockchain: { passed: Boolean, txHash: String, blockNumber: Number, network: String },
    revocation: { passed: Boolean, statusListChecked: String },
    expiry: { passed: Boolean, expires: Date },
  },

  ipAddress: { type: String, maxlength: 45 },
  deviceInfo: { type: String, maxlength: 500 },
  geolocation: {
    country: String,
    region: String,
    city: String,
    lat: Number,
    lng: Number,
  },
}, { timestamps: true });

verificationLogSchema.index({ credentialId: 1, createdAt: -1 });
verificationLogSchema.index({ verifierType: 1, createdAt: -1 });
verificationLogSchema.index({ verificationResult: 1 });
verificationLogSchema.index({ verifierCountry: 1 });
// GDPR/NIST SP 800-92: auto-delete verification logs after 3 years
verificationLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 365 * 3 });

// Resolve IP to geolocation using ip-api.com (free, no key, async)
verificationLogSchema.statics.resolveGeoLocation = async function (ip) {
  if (!ip || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('::ffff:127') ||
      ip.startsWith('192.168') || ip.startsWith('10.') || ip.startsWith('172.')) {
    return { country: 'Local', region: 'Local', city: 'Localhost' };
  }
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=country,regionName,city,lat,lon,status`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return {};
    const data = await res.json();
    if (data.status !== 'success') return {};
    return { country: data.country, region: data.regionName, city: data.city, lat: data.lat, lng: data.lon };
  } catch {
    return {};
  }
};

export default mongoose.model('VerificationLog', verificationLogSchema);
