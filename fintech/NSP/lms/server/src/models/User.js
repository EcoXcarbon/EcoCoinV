import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,128}$/;

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 200 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  password: {
    type: String,
    required: true,
    minlength: 8,
    maxlength: 128,
    validate: {
      validator: function (v) {
        // Only validate on new passwords (plain text), not already-hashed values
        if (this.isModified('password') && !v.startsWith('$2a$') && !v.startsWith('$2b$')) {
          return PASSWORD_REGEX.test(v);
        }
        return true;
      },
      message: 'Password must be 8-128 characters with at least one uppercase, one lowercase, one number, and one special character.',
    },
  },
  role: {
    type: String,
    enum: ['worker', 'assessor', 'admin', 'employer', 'institution'],
    default: 'worker',
  },
  cnic: { type: String },
  phone: { type: String, maxlength: 20 },
  organization: { type: String, maxlength: 300 },
  district: { type: String, maxlength: 100 },
  avatar: { type: String },
  isActive: { type: Boolean, default: true },
  refreshToken: { type: String, select: false },
  // The immediately-previous refresh token + when it was rotated. Lets the
  // refresh endpoint tolerate a legitimately-raced refresh (two tabs / a poll
  // firing as the 15m access token lapses) within a short grace window,
  // instead of misreading it as token theft and revoking the whole session.
  prevRefreshToken: { type: String, select: false },
  refreshTokenRotatedAt: { type: Date, select: false },
  // One refresh token per ACCOUNT made every extra device a "reuse" event: the
  // second login rotated the string, the first device's next refresh missed the
  // compare-and-swap and the whole account was revoked. Each device now owns an
  // entry here and rotates it independently (see utils/sessions.js).
  refreshSessions: {
    type: [{
      token: { type: String },
      prevToken: { type: String },
      rotatedAt: { type: Date },
      createdAt: { type: Date },
      lastUsedAt: { type: Date },
    }],
    select: false,
  },
  // Bumped on logout / password change / reset / deactivation. Access tokens
  // carry the version they were minted with; authenticate() rejects stale ones.
  tokenVersion: { type: Number, default: 0 },
  lastLogin: { type: Date },
  // Captured at login to detect new-device sign-ins
  lastLoginIp: { type: String, select: false },
  lastLoginUserAgent: { type: String, select: false, maxlength: 500 },

  // --- OAuth (Google, future: GitHub, Microsoft) ---
  googleId: { type: String, select: false },
  oauthProvider: { type: String, enum: ['google', 'github', 'microsoft', null], default: null },

  // --- Stage 1: Email verification ---
  emailVerified: { type: Boolean, default: false },
  emailVerificationToken: { type: String, select: false },
  emailVerificationExpires: { type: Date, select: false },

  // --- Stage 1: Account lockout (brute-force protection) ---
  loginAttempts: { type: Number, default: 0 },
  lockedUntil: { type: Date },

  // --- Stage 1: Terms of Service ---
  termsAcceptedAt: { type: Date },
  termsVersion: { type: String },

  // --- Stage 1: MFA (TOTP) ---
  mfaEnabled: { type: Boolean, default: false },
  mfaSecret: { type: String, select: false },
  mfaBackupCodes: { type: [String], select: false },
  // Holds the candidate secret between /mfa/setup and /mfa/enroll/verify
  mfaPendingSecret: { type: String, select: false },

  // --- Stage 1: Password change tracking ---
  passwordChangedAt: { type: Date },

  // --- Password reset (one-time use) ---
  resetPasswordToken: { type: String, select: false },
  resetPasswordExpires: { type: Date, select: false },
  resetPasswordUsedAt: { type: Date, select: false }, // one-time use tracking

  // --- Pricing / Plan ---
  plan: { type: String, enum: ['free', 'professional', 'enterprise'], default: 'free' },
  planActivatedAt: { type: Date },
  planExpiresAt: { type: Date },
  planNote: { type: String, maxlength: 500 },

  // --- Stage 2: Profile completeness ---
  profileCompleteness: { type: Number, default: 0, min: 0, max: 100 },

  // --- Stage 2: Onboarding ---
  onboardingCompleted: { type: Boolean, default: false },
  onboardingStep: { type: Number, default: 0 },

  // --- Stage 2: Data export / account deletion ---
  deletionRequestedAt: { type: Date },
  dataExportRequestedAt: { type: Date },

  // --- Phase 3 Gap #13: Assessor qualification tracking ---
  assessorQualifications: [{
    qualificationName: { type: String, required: true, maxlength: 300 },
    issuingBody: { type: String, required: true, maxlength: 300 },
    dateObtained: { type: Date, required: true },
    expiryDate: { type: Date },
    certificateNumber: { type: String, maxlength: 100 },
    trade: { type: String },
    nqfLevel: { type: Number, min: 1, max: 8 },
    verified: { type: Boolean, default: false },
    verifiedAt: { type: Date },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    documentUrl: { type: String },
  }],

  // --- Phase 3 Gap #17: Assessor CPD tracking ---
  cpdRecords: [{
    title: { type: String, required: true, maxlength: 300 },
    provider: { type: String, required: true, maxlength: 300 },
    completedDate: { type: Date, required: true },
    hours: { type: Number, required: true, min: 0.5, max: 200 },
    category: {
      type: String,
      enum: ['assessment-methodology', 'trade-technical', 'quality-assurance', 'regulatory', 'safety', 'digital-tools', 'other'],
      required: true,
    },
    certificateUrl: { type: String },
    verified: { type: Boolean, default: false },
    verifiedAt: { type: Date },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  }],
  cpdYearStart: { type: Date },
  cpdRequiredHours: { type: Number, default: 20 },

  // --- Phase 3 Gap #14: Assessor experience tracking ---
  assessorExperience: {
    totalAssessments: { type: Number, default: 0 },
    yearsExperience: { type: Number, default: 0 },
    trades: [String],
    approvedDate: { type: Date },
    seniorAssessor: { type: Boolean, default: false },
    lastAssessmentDate: { type: Date },
    averageScore: { type: Number, min: 0, max: 100 },
  },

  // --- Phase 3 Gap #26: Language preference ---
  languagePreference: { type: String, enum: ['en', 'ur', 'ar'], default: 'en' },
}, { timestamps: true });

// Indexes
userSchema.index({ googleId: 1 }, { sparse: true });

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

// --- Stage 1: Account lockout helpers ---
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

userSchema.methods.isLocked = function () {
  return !!(this.lockedUntil && this.lockedUntil > new Date());
};

// Atomic: increments the counter on the server (no stale read-modify-write) and
// returns the post-increment document so the caller can act on the true count.
// Concurrent failed logins therefore can't slip past the lockout threshold.
userSchema.methods.incrementLoginAttempts = async function () {
  const Model = this.constructor;
  const now = new Date();

  // A previous lock that has expired resets to a single fresh attempt.
  if (this.lockedUntil && this.lockedUntil < now) {
    return Model.findByIdAndUpdate(
      this._id,
      { $set: { loginAttempts: 1 }, $unset: { lockedUntil: 1 } },
      { new: true },
    );
  }

  const updated = await Model.findByIdAndUpdate(
    this._id,
    { $inc: { loginAttempts: 1 } },
    { new: true },
  );

  // Lock based on the authoritative post-increment count.
  if (updated.loginAttempts >= MAX_LOGIN_ATTEMPTS && !updated.isLocked()) {
    updated.lockedUntil = new Date(Date.now() + LOCK_DURATION_MS);
    await Model.findByIdAndUpdate(updated._id, { $set: { lockedUntil: updated.lockedUntil } });
  }
  return updated;
};

userSchema.methods.resetLoginAttempts = function () {
  return this.updateOne({ $set: { loginAttempts: 0 }, $unset: { lockedUntil: 1 } });
};

// --- Stage 2: Profile completeness calculator ---
userSchema.methods.calculateProfileCompleteness = function () {
  let score = 0;
  const checks = [
    [this.name, 10],
    [this.email, 10],
    [this.emailVerified, 10],
    [this.phone, 10],
    [this.cnic, 10],
    [this.district, 10],
    [this.avatar, 10],
    [this.organization && ['employer', 'institution'].includes(this.role), 10],
    [this.termsAcceptedAt, 5],
    [this.mfaEnabled, 5],
    [this.lastLogin, 5],
    [true, 5], // base score for having an account
  ];
  for (const [cond, pts] of checks) {
    if (cond) score += pts;
  }
  return Math.min(score, 100);
};

userSchema.methods.toSafe = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.refreshToken;
  delete obj.refreshSessions;
  delete obj.googleId;
  delete obj.mfaSecret;
  delete obj.mfaBackupCodes;
  delete obj.emailVerificationToken;
  delete obj.emailVerificationExpires;
  delete obj.resetPasswordToken;
  delete obj.resetPasswordExpires;
  delete obj.resetPasswordUsedAt;
  delete obj.loginAttempts;
  delete obj.lockedUntil;
  delete obj.tokenVersion;
  delete obj.__v;
  return obj;
};

export default mongoose.model('User', userSchema);
