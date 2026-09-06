import mongoose from 'mongoose';

/* ═══════════════════════════════════════════════════════════
   LEARNING PATHWAY MODEL
   Structured learning programs grouping courses into tracks
   with defined timelines, competency targets, and pacing.
   ═══════════════════════════════════════════════════════════ */

const pathwayCourseSchema = new mongoose.Schema({
  training: { type: mongoose.Schema.Types.ObjectId, ref: 'Training', required: true },
  order: { type: Number, required: true },
  required: { type: Boolean, default: true },             // required vs elective
  estimatedWeeks: { type: Number, default: 4 },
}, { _id: true });

const pathwayEnrollmentSchema = new mongoose.Schema({
  worker: { type: mongoose.Schema.Types.ObjectId, ref: 'Worker', required: true },
  enrolledAt: { type: Date, default: Date.now },
  status: { type: String, enum: ['active', 'completed', 'dropped', 'paused'], default: 'active' },
  completedCourses: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Training' }],
  progress: { type: Number, default: 0, min: 0, max: 100 },
  currentCourseIndex: { type: Number, default: 0 },
  completedAt: { type: Date },
  certificateId: { type: String },
  // Pacing
  cohortStartDate: { type: Date },
  dailyTargetMinutes: { type: Number, default: 60 },
  streak: { type: Number, default: 0 },
  longestStreak: { type: Number, default: 0 },
  lastActiveDate: { type: Date },
  totalTimeSpentMinutes: { type: Number, default: 0 },
}, { _id: true });

const pathwaySchema = new mongoose.Schema({
  title: { type: String, required: true, maxlength: 300 },
  description: { type: String, maxlength: 3000 },
  category: {
    type: String,
    enum: [
      'trade-mastery',         // e.g., Master Electrician Track
      'safety-compliance',     // Safety & compliance courses
      'gulf-readiness',        // Gulf market preparation
      'leadership',            // Supervisory/foreman skills
      'digital-skills',        // Digital literacy for trades
      'specialization',        // Niche specializations
    ],
    required: true,
  },
  trade: { type: String },
  framework: { type: String, enum: ['navttc', 'gulf', 'custom'], default: 'navttc' },
  nqfLevelRange: {
    min: { type: Number, min: 1, max: 8, default: 1 },
    max: { type: Number, min: 1, max: 8, default: 4 },
  },
  courses: [pathwayCourseSchema],
  enrollments: [pathwayEnrollmentSchema],

  // Program structure
  totalDurationWeeks: { type: Number },
  totalHours: { type: Number },
  dailyTargetMinutes: { type: Number, default: 60 },     // Default pacing: 1hr/day

  // Competency targets
  competencyTargets: [{
    skill: { type: String, required: true },
    targetLevel: { type: String, enum: ['foundation', 'intermediate', 'advanced', 'expert'], default: 'intermediate' },
  }],

  // Transferable skills emphasis
  transferableSkills: [{
    name: { type: String },    // e.g., "Problem Solving", "Safety Reasoning", "Quality Assessment"
    description: { type: String },
  }],

  // Credential on completion
  credentialTitle: { type: String },                       // e.g., "Master Electrician Certificate"
  credentialType: { type: String, default: 'trade-certificate' },

  thumbnail: { type: String },
  status: { type: String, enum: ['draft', 'active', 'archived'], default: 'active' },
  maxEnrollment: { type: Number, default: 100 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

pathwaySchema.index({ category: 1, status: 1 });
pathwaySchema.index({ trade: 1 });
pathwaySchema.index({ framework: 1 });
pathwaySchema.index({ 'enrollments.worker': 1 });

export default mongoose.model('Pathway', pathwaySchema);
