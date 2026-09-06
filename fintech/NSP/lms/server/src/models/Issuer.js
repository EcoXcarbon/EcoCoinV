import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

const issuerSchema = new mongoose.Schema({
  issuerId: { type: String, unique: true, default: () => uuidv4() },
  issuerName: { type: String, required: true, maxlength: 300 },
  issuerType: {
    type: String,
    required: true,
    enum: [
      'GOVERNMENT_BODY', 'UNIVERSITY', 'BTE', 'TTB',
      'PROFESSIONAL_BODY', 'TRAINING_PROVIDER', 'EMPLOYER',
      'PLATFORM', 'TALENT_LEDGER_RPL',
    ],
  },
  issuerCategory: {
    type: String,
    required: true,
    enum: [
      'FEDERAL', 'PROVINCIAL_KP', 'PROVINCIAL_PUNJAB',
      'PROVINCIAL_SINDH', 'PROVINCIAL_BALOCHISTAN', 'INTERNATIONAL',
    ],
  },
  officialWebsite: { type: String, maxlength: 500 },
  verificationApiEndpoint: { type: String, maxlength: 500 },
  verificationMethodSupported: [{
    type: String,
    enum: ['API_DIRECT', 'DASHBOARD_CONFIRM', 'MANUAL_LETTER', 'DOCUMENT_SCAN', 'BIOMETRIC_MATCH'],
  }],

  // Cryptographic identity
  publicKey: { type: String },           // Ed25519 public key (multibase)
  didIdentifier: { type: String },       // did:talentledger:issuer:<id>

  // Authorization
  authorizationDate: { type: Date },
  authorizationDocumentRef: { type: String, maxlength: 500 },
  status: {
    type: String,
    enum: ['ACTIVE', 'SUSPENDED', 'REVOKED'],
    default: 'ACTIVE',
  },

  // Contact
  contactFocalPerson: { type: String, maxlength: 200 },
  contactEmail: { type: String, maxlength: 254 },
  contactPhone: { type: String, maxlength: 20 },
  logoUrl: { type: String, maxlength: 500 },

  // Linked user account (if issuer logs in)
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

issuerSchema.index({ issuerType: 1, status: 1 });
issuerSchema.index({ issuerCategory: 1 });
issuerSchema.index({ issuerName: 'text' });

export default mongoose.model('Issuer', issuerSchema);
