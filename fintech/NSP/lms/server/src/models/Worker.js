import mongoose from 'mongoose';

const competencySchema = new mongoose.Schema({
  code: { type: String, required: true },       // CU-01, CU-02, etc.
  title: { type: String, required: true },
  nqfLevel: { type: Number, min: 1, max: 8 },
  proficiency: { type: String, enum: ['novice', 'competent', 'proficient', 'expert'] },
  assessedDate: { type: Date },
  assessedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { _id: false });

const workerSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  registrationId: { type: String, unique: true },      // TL-2026-00001
  cnicEncrypted: { type: String, required: true },      // AES-256-CBC
  cnicMasked: { type: String },                         // *************4567
  fullName: { type: String, required: true },
  fatherName: { type: String },
  dateOfBirth: { type: Date },
  gender: { type: String, enum: ['male', 'female', 'other'] },
  phone: { type: String },
  district: { type: String, required: true },
  province: { type: String, default: 'Khyber Pakhtunkhwa' },
  trade: {
    type: String,
    required: true,
    enum: [
      'mason', 'electrician', 'welder', 'plumber', 'carpenter', 'steel-fixer', 'painter', 'hvac',
      'pipe-fitter', 'scaffolder', 'rigger', 'crane-operator', 'heavy-driver', 'shuttering-carpenter',
      'tile-fixer', 'duct-fabricator', 'auto-mechanic', 'diesel-mechanic', 'fabricator',
      'insulation-worker', 'heavy-equipment-operator', 'aluminium-fabricator', 'safety-officer',
      'cook', 'ac-technician',
    ],
  },
  iscoCode: { type: String },                           // ISCO-08 code (7112, 7411, etc.)
  nqfLevel: { type: Number, min: 1, max: 8, default: 1 },
  competencies: [competencySchema],
  experience: {
    years: { type: Number, default: 0 },
    countries: [String],                                 // Gulf countries worked in
    employers: [String],
  },
  gulfReadiness: {
    score: { type: Number, min: 0, max: 100, default: 0 },
    safetyTraining: { type: Boolean, default: false },
    languageTest: { type: Boolean, default: false },
    medicalClearance: { type: Boolean, default: false },
    passportValid: { type: Boolean, default: false },
  },

  // --- Stage 2: Next-of-kin / Emergency contact (BEOE requirement) ---
  nextOfKin: {
    name: { type: String, maxlength: 200 },
    cnic: { type: String },
    phone: { type: String, maxlength: 20 },
    relationship: { type: String, enum: ['father', 'mother', 'spouse', 'brother', 'sister', 'son', 'daughter', 'other'] },
    address: { type: String, maxlength: 500 },
  },

  // --- Stage 2: Passport tracking (MOHRE/Qiwa requirement) ---
  passport: {
    number: { type: String },
    country: { type: String, default: 'Pakistan' },
    issueDate: { type: Date },
    expiryDate: { type: Date },
    placeOfIssue: { type: String, maxlength: 100 },
  },

  // --- Stage 2: Visa tracking ---
  visa: {
    type: { type: String, enum: ['work', 'visit', 'transit', 'none'], default: 'none' },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'expired', 'none'], default: 'none' },
    country: { type: String },
    expiryDate: { type: Date },
    sponsorName: { type: String, maxlength: 200 },
  },

  // --- Stage 2: Detailed medical clearance (replacing boolean) ---
  medicalClearance: {
    date: { type: Date },
    provider: { type: String, maxlength: 200 },
    result: { type: String, enum: ['fit', 'unfit', 'conditional', 'pending', 'none'], default: 'none' },
    expiryDate: { type: Date },
    certificateNumber: { type: String },
    notes: { type: String, maxlength: 500 },
  },

  // --- Stage 2: Pre-departure orientation (BEOE Briefing Hall) ---
  preDeparture: {
    orientationDate: { type: Date },
    briefingCompleted: { type: Boolean, default: false },
    registrationNumber: { type: String },
    culturalTraining: { type: Boolean, default: false },
    languageProficiency: { type: String, enum: ['none', 'basic', 'intermediate', 'advanced'], default: 'none' },
    contractReviewed: { type: Boolean, default: false },
  },

  // --- Stage 2: Employment history tracking ---
  employmentHistory: [{
    employer: { type: String, maxlength: 200 },
    country: { type: String, maxlength: 100 },
    position: { type: String, maxlength: 200 },
    startDate: { type: Date },
    endDate: { type: Date },
    trade: { type: String },
    feedback: { type: String, maxlength: 500 },
    verified: { type: Boolean, default: false },
  }],

  // --- Stage 2: Self-assessed skill strengths (Scotland MyWoW) ---
  selfAssessedSkills: [{
    skill: { type: String, maxlength: 100 },
    rating: { type: Number, min: 1, max: 5 },   // Star rating 1-5
    notes: { type: String, maxlength: 200 },
  }],

  // --- Stage 2 + Gap #21: E-Portfolio system ---
  portfolio: [{
    title: { type: String, maxlength: 200 },
    description: { type: String, maxlength: 500 },
    fileUrl: { type: String },
    type: { type: String, enum: ['photo', 'video', 'document', 'certificate', 'other'] },
    uploadedAt: { type: Date, default: Date.now },
    // Gap #21: Enhanced e-portfolio fields
    competencyArea: { type: String, maxlength: 200 },
    collection: { type: String, maxlength: 100 },      // Group items into collections
    tags: [{ type: String, maxlength: 50 }],
    visibility: { type: String, enum: ['private', 'assessor', 'public'], default: 'private' },
    linkedAssessment: { type: mongoose.Schema.Types.ObjectId, ref: 'Assessment' },
  }],

  // Gap #21: Portfolio collections
  portfolioCollections: [{
    name: { type: String, required: true, maxlength: 100 },
    description: { type: String, maxlength: 500 },
    coverImage: { type: String },
    createdAt: { type: Date, default: Date.now },
  }],

  // Gap #21: Portfolio share tokens
  portfolioShareToken: { type: String },
  portfolioShareExpiry: { type: Date },

  // Gap #28: RPL-to-Work-Permit Linkage
  workPermit: {
    permitNumber: { type: String, maxlength: 100 },
    issuingAuthority: { type: String, maxlength: 200 },
    issuingCountry: { type: String, maxlength: 100 },
    status: {
      type: String,
      enum: ['not-applied', 'applied', 'approved', 'active', 'expired', 'cancelled'],
      default: 'not-applied',
    },
    issueDate: { type: Date },
    expiryDate: { type: Date },
    occupation: { type: String, maxlength: 200 },
    sponsorName: { type: String, maxlength: 200 },
    linkedCredentials: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Credential' }],
    linkedAssessment: { type: mongoose.Schema.Types.ObjectId, ref: 'Assessment' },
  },

  // --- Registry: Holder identity fields ---
  fullNameUrdu: { type: String, maxlength: 200 },
  addressCurrent: { type: String, maxlength: 500 },
  addressPermanent: { type: String, maxlength: 500 },
  phoneSecondary: { type: String, maxlength: 20 },
  nadraVerificationStatus: {
    type: String,
    enum: ['UNVERIFIED', 'VERIFIED', 'FAILED', 'PENDING'],
    default: 'UNVERIFIED',
  },
  nadraVerificationDate: { type: Date },
  walletDid: { type: String },                           // did:talentledger:holder:<id>
  walletPublicKey: { type: String },                     // Ed25519 multibase
  registrationSource: {
    type: String,
    enum: ['ONLINE', 'FIELD_CAMP', 'INSTITUTION_REFERRAL', 'EMPLOYER_REFERRAL'],
    default: 'ONLINE',
  },
  totalCredentialsCount: { type: Number, default: 0 },
  verifiedCredentialsCount: { type: Number, default: 0 },
  lastActive: { type: Date },

  // --- Stage 2: Profile completeness percentage ---
  profileCompleteness: { type: Number, default: 0, min: 0, max: 100 },

  status: {
    type: String,
    enum: ['registered', 'assessed', 'certified', 'employed', 'inactive'],
    default: 'registered',
  },
  photo: { type: String },
}, { timestamps: true });

// --- Stage 2: Profile completeness calculator ---
workerSchema.methods.calculateProfileCompleteness = function () {
  let score = 0;
  const checks = [
    [this.fullName, 5],
    [this.fatherName, 5],
    [this.dateOfBirth, 5],
    [this.gender, 5],
    [this.phone, 5],
    [this.district, 5],
    [this.trade, 5],
    [this.photo, 5],
    [this.cnicEncrypted && this.cnicEncrypted !== 'N/A', 5],
    [this.nextOfKin?.name && this.nextOfKin?.phone, 5],
    [this.passport?.number, 5],
    [this.passport?.expiryDate, 5],
    [this.medicalClearance?.result && this.medicalClearance.result !== 'none', 5],
    [this.preDeparture?.briefingCompleted, 5],
    [this.experience?.years > 0, 5],
    [this.employmentHistory?.length > 0, 5],
    [this.selfAssessedSkills?.length > 0, 5],
    [this.competencies?.length > 0, 5],
    [this.gulfReadiness?.score >= 50, 5],
    [this.portfolio?.length > 0, 5],
  ];
  for (const [cond, pts] of checks) {
    if (cond) score += pts;
  }
  return Math.min(score, 100);
};

// Auto-calculate profile completeness before save
workerSchema.pre('save', function (next) {
  this.profileCompleteness = this.calculateProfileCompleteness();
  next();
});

workerSchema.index({ trade: 1, district: 1 });
workerSchema.index({ status: 1 });
workerSchema.index({ fullName: 'text' });
workerSchema.index({ 'passport.expiryDate': 1 });
workerSchema.index({ 'visa.expiryDate': 1 });
workerSchema.index({ 'medicalClearance.expiryDate': 1 });
workerSchema.index({ 'workPermit.status': 1 });               // Gap #28
workerSchema.index({ 'workPermit.expiryDate': 1 });           // Gap #28

export default mongoose.model('Worker', workerSchema);
