import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

// ── Credential-type-specific metadata sub-schemas ──

const academicMetadata = {
  degreeLevel: String,            // Matric, Intermediate, Bachelor, Master, PhD
  degreeTitle: String,
  institutionName: String,
  institutionId: String,
  faculty: String,
  department: String,
  sessionYear: String,
  rollNumber: String,
  cgpa: Number,
  hecAttestationId: String,
  transcriptAvailable: { type: Boolean, default: false },
};

const tvetMetadata = {
  nvqLevel: { type: Number, min: 1, max: 5 },
  tradeName: String,
  tradeCode: String,
  boardName: String,              // BTE/TTB
  boardProvince: String,
  rollNumber: String,
  session: String,
  marksObtained: Number,
  totalMarks: Number,
  practicalMarks: Number,
  theoryMarks: Number,
};

const rplMetadata = {
  assessedTrade: String,
  competencyLevel: String,
  assessmentCenter: String,
  assessorId: String,
  assessorName: String,
  assessmentDate: Date,
  competencyUnitsPassed: Number,
  competencyUnitsTotal: Number,
  nsqfLevel: Number,
  nextAssessmentDate: Date,
};

const professionalLicenseMetadata = {
  licenseNumber: String,
  licensingBody: { type: String, enum: ['PEC', 'PMDC', 'ICAP', 'BAR_COUNCIL', 'PCATP', 'OTHER'] },
  licenseCategory: String,
  specialization: String,
  firstIssuanceDate: Date,
  lastRenewalDate: Date,
  nextRenewalDate: Date,
  cpeHoursCompleted: Number,
  disciplinaryStatus: { type: String, enum: ['CLEAN', 'FLAGGED', 'SUSPENDED'], default: 'CLEAN' },
};

const microCredentialMetadata = {
  platform: { type: String, enum: ['COURSERA', 'EDX', 'GOOGLE', 'LINKEDIN', 'OTHER'] },
  courseName: String,
  courseId: String,
  completionDate: Date,
  certificateUrl: String,
  skillsTags: [String],
  hoursCompleted: Number,
  badgeStandard: { type: String, enum: ['OPEN_BADGES_3', 'CUSTOM'] },
  badgeJson: mongoose.Schema.Types.Mixed,
};

const employerEndorsementMetadata = {
  employerName: String,
  employerRegistration: String,
  employerSector: String,
  jobTitle: String,
  employmentStart: Date,
  employmentEnd: Date,
  skillsEndorsed: [String],
  performanceRating: { type: Number, min: 1, max: 5 },
  endorserName: String,
  endorserDesignation: String,
};

const trainingRecordMetadata = {
  programName: { type: String, enum: ['PM_YOUTH', 'KAMYAB_JAWAN', 'NAVTTC_SHORT', 'GIZ', 'ILO', 'OTHER'] },
  programId: String,
  trainingProvider: String,
  trainingDurationHours: Number,
  completionStatus: { type: String, enum: ['COMPLETED', 'IN_PROGRESS', 'DROPPED'], default: 'COMPLETED' },
  certificateNumber: String,
};

const identityVerificationMetadata = {
  documentType: { type: String, enum: ['CNIC', 'PASSPORT', 'DRIVING_LICENSE'] },
  documentNumber: String,
  verificationSource: { type: String, enum: ['NADRA_VERISYS', 'PASSPORT_AUTHORITY', 'LICENSING_AUTHORITY'] },
  verificationResponseCode: String,
  nameMatchScore: Number,
  photoMatchScore: Number,
  documentExpiry: Date,
  nadraFamilyNumber: String,
};

const migrationRecordMetadata = {
  recordType: { type: String, enum: ['BEOE_REGISTRATION', 'OEC', 'WORK_PERMIT', 'VISA'] },
  destinationCountry: String,
  employerAbroad: String,
  contractDuration: String,
  beoeRegistrationNumber: String,
  oecNumber: String,
  protectorOffice: String,
};

const healthClearanceMetadata = {
  examinationType: { type: String, enum: ['GAMCA', 'COMPANY_MEDICAL', 'TRADE_SAFETY'] },
  medicalCenter: String,
  medicalCenterApproval: String,
  examinationDate: Date,
  fitnessCategory: { type: String, enum: ['FIT', 'UNFIT', 'CONDITIONAL'] },
  restrictions: String,
  validUntil: Date,
};

const selfDeclaredMetadata = {
  skillName: String,
  skillCategory: String,
  proficiencyLevel: { type: String, enum: ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'] },
  yearsExperience: Number,
  description: String,
  evidenceDescription: String,
  willingToAssess: { type: Boolean, default: false },
};

// ── Main Registry Credential Schema ──

const registryCredentialSchema = new mongoose.Schema({
  credentialId: { type: String, unique: true, default: () => uuidv4() },

  // Holder reference (CNIC-based)
  holderCnic: { type: String, required: true, index: true },  // encrypted or hashed
  holder: { type: mongoose.Schema.Types.ObjectId, ref: 'Worker' },

  // Credential classification
  credentialType: {
    type: String,
    required: true,
    enum: [
      'ACADEMIC', 'TVET', 'RPL', 'PROFESSIONAL_LICENSE', 'MICRO_CREDENTIAL',
      'EMPLOYER_ENDORSEMENT', 'TRAINING_RECORD', 'IDENTITY_VERIFICATION',
      'MIGRATION_RECORD', 'HEALTH_CLEARANCE', 'SELF_DECLARED',
    ],
    index: true,
  },
  credentialSubtype: { type: String, maxlength: 100 },  // HEC_DEGREE, BTE_DIPLOMA, NVQ_CERTIFICATE, etc.
  title: { type: String, required: true, maxlength: 500 },

  // Issuer
  issuerId: { type: String, index: true },
  issuer: { type: mongoose.Schema.Types.ObjectId, ref: 'Issuer' },
  issuerName: { type: String, maxlength: 300 },  // denormalized for query speed

  // Dates
  issuanceDate: { type: Date, default: Date.now },
  expiryDate: { type: Date },  // null for non-expiring credentials

  // Status
  status: {
    type: String,
    required: true,
    enum: ['ACTIVE', 'EXPIRED', 'REVOKED', 'SUSPENDED', 'PENDING_VERIFICATION', 'REJECTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED'],
    default: 'PENDING_VERIFICATION',
    index: true,
  },
  verificationStatus: {
    type: String,
    enum: ['SOURCE_VERIFIED', 'PLATFORM_VERIFIED', 'SELF_DECLARED', 'VERIFICATION_FAILED'],
    default: 'SELF_DECLARED',
  },
  verificationMethod: {
    type: String,
    enum: ['API_DIRECT', 'DASHBOARD_CONFIRM', 'MANUAL_LETTER', 'DOCUMENT_SCAN', 'BIOMETRIC_MATCH'],
  },
  verificationDate: { type: Date },
  verifiedBy: { type: String },

  // ─── Self-submission → admin verification workflow ───
  // Set when a holder submits their own already-earned credential for verification.
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  evidenceFiles: [{
    name: String, url: String, size: Number, mimeType: String,
  }],
  reviewNotes: { type: String, maxlength: 2000 },     // admin's notes on the decision
  rejectionReason: { type: String, maxlength: 1000 }, // shown to the holder if rejected
  // Review workflow: who is currently handling it (Hold), and who it was referred to (Forward).
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  assignedToName: { type: String },
  referredTo: { type: String },                       // e.g. 'Issuing institution' | 'Senior administrator' | 'Assessor panel'
  // Immutable audit trail of every review decision.
  reviewHistory: [{
    action: { type: String },                         // APPROVE | REJECT | REQUEST_CHANGES | FORWARD | HOLD
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byName: { type: String },
    note: { type: String, maxlength: 2000 },
    referredTo: { type: String },
    at: { type: Date, default: Date.now },
  }],

  // W3C Verifiable Credential
  w3cVcJson: { type: mongoose.Schema.Types.Mixed },

  // Blockchain anchoring
  blockchainTxHash: { type: String, index: true },
  blockchainAnchorDate: { type: Date },
  credentialHash: { type: String, index: true },  // SHA-256

  // QR code
  qrCodeUrl: { type: String },

  // Type-specific metadata (stored in flexible sub-doc)
  metadata: {
    academic: academicMetadata,
    tvet: tvetMetadata,
    rpl: rplMetadata,
    professionalLicense: professionalLicenseMetadata,
    microCredential: microCredentialMetadata,
    employerEndorsement: employerEndorsementMetadata,
    trainingRecord: trainingRecordMetadata,
    identityVerification: identityVerificationMetadata,
    migrationRecord: migrationRecordMetadata,
    healthClearance: healthClearanceMetadata,
    selfDeclared: selfDeclaredMetadata,
  },

  // Soft delete
  isDeleted: { type: Boolean, default: false, index: true },

  // Link to existing RPL credential model (backward compatibility)
  legacyCredential: { type: mongoose.Schema.Types.ObjectId, ref: 'Credential' },
}, { timestamps: true });

// Compound indexes
registryCredentialSchema.index({ credentialType: 1, status: 1 });
registryCredentialSchema.index({ issuerId: 1, credentialType: 1 });
registryCredentialSchema.index({ holderCnic: 1, credentialType: 1, status: 1 });
registryCredentialSchema.index({ expiryDate: 1 });

// Generate credential hash before save
registryCredentialSchema.pre('save', function (next) {
  if (this.isModified('w3cVcJson') && this.w3cVcJson) {
    this.credentialHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(this.w3cVcJson))
      .digest('hex');
  }
  next();
});

// Auto-expire: flip status to EXPIRED on save when past expiryDate
registryCredentialSchema.pre('save', function (next) {
  if (this.expiryDate && this.expiryDate < new Date() && this.status === 'ACTIVE') {
    this.status = 'EXPIRED';
  }
  next();
});

// Auto-expire check
registryCredentialSchema.methods.isExpired = function () {
  return this.expiryDate && this.expiryDate < new Date();
};

// Get the relevant metadata sub-document
registryCredentialSchema.methods.getTypeMetadata = function () {
  const typeMap = {
    ACADEMIC: 'academic',
    TVET: 'tvet',
    RPL: 'rpl',
    PROFESSIONAL_LICENSE: 'professionalLicense',
    MICRO_CREDENTIAL: 'microCredential',
    EMPLOYER_ENDORSEMENT: 'employerEndorsement',
    TRAINING_RECORD: 'trainingRecord',
    IDENTITY_VERIFICATION: 'identityVerification',
    MIGRATION_RECORD: 'migrationRecord',
    HEALTH_CLEARANCE: 'healthClearance',
    SELF_DECLARED: 'selfDeclared',
  };
  const key = typeMap[this.credentialType];
  return key ? this.metadata?.[key] : null;
};

export default mongoose.model('RegistryCredential', registryCredentialSchema);
