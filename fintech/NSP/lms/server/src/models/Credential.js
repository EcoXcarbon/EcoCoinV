import mongoose from 'mongoose';

const credentialSchema = new mongoose.Schema({
  credentialId: { type: String, unique: true, required: true },  // TL-2026-00001
  worker: { type: mongoose.Schema.Types.ObjectId, ref: 'Worker', required: true },
  issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: {
    type: String,
    enum: ['trade-certificate', 'micro-credential', 'rpl-certificate', 'safety-card', 'gulf-readiness'],
    required: true,
  },
  trade: { type: String, required: true },
  title: { type: String, required: true, maxlength: 300 },
  nqfLevel: { type: Number, min: 1, max: 8 },
  iscoCode: { type: String },
  iscedCode: { type: String },                           // ISCED-F 2013 code
  eqfLevel: { type: Number, min: 1, max: 8 },           // EQF level
  institution: { type: String, maxlength: 300 },
  // Signatory printed on the certificate PDF signature line (e.g. Chief Master
  // Trainer). Captured at issue time from the training so the cert is self-contained.
  signatory: {
    name: { type: String, maxlength: 120 },
    title: { type: String, maxlength: 120 },
  },
  // W3C Verifiable Credential v2.0 fields
  vc: {
    context: { type: [String], default: ['https://www.w3.org/2018/credentials/v1', 'https://www.w3.org/2018/credentials/v2'] },
    id: { type: String },
    issuerDID: { type: String },
    subjectDID: { type: String },
    issuanceDate: { type: Date, default: Date.now },
    expirationDate: { type: Date },
    credentialHash: { type: String },
    jwt: { type: String },                     // Signed JWT-VC (W3C VC-JWT) — served by GET /credentials/:id/vc
    proof: {
      type: { type: String, default: 'Ed25519Signature2020' },
      created: { type: Date },
      verificationMethod: { type: String },
      proofPurpose: { type: String, default: 'assertionMethod' },
      proofValue: { type: String },
      jws: { type: String },                   // Detached JWS (mirrors jwt) for proof-based verification
    },
    alignment: [{
      targetName: String,
      targetUrl: String,
      targetFramework: String,  // ESCO, O*NET, ISCO-08
    }],
  },
  status: {
    type: String,
    enum: ['active', 'revoked', 'expired', 'suspended'],
    default: 'active',
  },
  revokedAt: { type: Date },
  revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  revokedReason: { type: String, maxlength: 500 },
  validFrom: {
    type: Date,
    default: Date.now,
    validate: {
      validator: function (v) { return v <= new Date(Date.now() + 86400000); }, // no more than 1 day in future
      message: 'validFrom cannot be in the future',
    },
  },
  validUntil: {
    type: Date,
    validate: {
      validator: function (v) { return !this.validFrom || v > this.validFrom; },
      message: 'validUntil must be after validFrom',
    },
  },
  pdfUrl: { type: String },
  qrData: { type: String },
  verificationCount: { type: Number, default: 0 },
  lastVerifiedAt: { type: Date },
  // Gap #18: Blockchain anchoring
  blockchain: {
    anchored: { type: Boolean, default: false },
    anchoredAt: { type: Date },
    txHash: { type: String },
    blockNumber: { type: Number },
    chain: { type: String, enum: ['ethereum', 'polygon', 'simulated'], default: 'simulated' },
    contentHash: { type: String },           // SHA-256 of credential payload
    previousHash: { type: String },          // Hash chain link
    merkleRoot: { type: String },
    verified: { type: Boolean, default: false },
    lastVerifiedAt: { type: Date },
  },
  // Gap #19: Digital wallet / portable credentials
  wallet: {
    jwtToken: { type: String },              // Portable JWT credential
    jwtIssuedAt: { type: Date },
    jwtExpiresAt: { type: Date },
    qrCodeUrl: { type: String },
    shareableLink: { type: String },
    shareLinkExpiry: { type: Date },
    downloads: { type: Number, default: 0 },
    sharedWith: [{ email: String, sharedAt: Date }],
  },
  // Gap #25: MRA recognition
  mra: {
    recognizedIn: [{ country: String, framework: String, level: String, status: String }],
    equivalencyNotes: { type: String, maxlength: 500 },
  },
}, { timestamps: true });

// credentialId index already created by `unique: true`
credentialSchema.index({ worker: 1, status: 1 });
credentialSchema.index({ status: 1, type: 1 });
credentialSchema.index({ validUntil: 1 }); // For expiration queries

export default mongoose.model('Credential', credentialSchema);
