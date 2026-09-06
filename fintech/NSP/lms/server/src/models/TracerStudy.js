import mongoose from 'mongoose';

/* ═══════════════════════════════════════════════════════════
   GAP 3: TRACER STUDY MODEL
   Graduate tracking at 6-month and 2-year intervals
   ═══════════════════════════════════════════════════════════ */

const tracerResponseSchema = new mongoose.Schema({
  worker: { type: mongoose.Schema.Types.ObjectId, ref: 'Worker', required: true },
  answeredAt: { type: Date, default: Date.now },
  answers: [{
    questionIndex: { type: Number },
    answer: { type: mongoose.Schema.Types.Mixed },
  }],
  employmentStatus: {
    type: String,
    enum: ['employed', 'self-employed', 'unemployed', 'further-study', 'other'],
  },
  employer: { type: String, maxlength: 300 },
  jobTitle: { type: String, maxlength: 200 },
  salaryRange: { type: String },
  satisfactionScore: { type: Number, min: 1, max: 5 },
  credentialUseful: { type: Boolean },
  feedback: { type: String, maxlength: 2000 },
}, { _id: true });

const tracerQuestionSchema = new mongoose.Schema({
  question: { type: String, required: true },
  type: { type: String, enum: ['text', 'single-choice', 'multi-choice', 'rating', 'salary-range'], default: 'text' },
  options: [String],
  required: { type: Boolean, default: false },
}, { _id: false });

const tracerStudySchema = new mongoose.Schema({
  title: { type: String, required: true, maxlength: 300 },
  type: { type: String, enum: ['6-month', '2-year', 'custom'], default: '6-month' },
  status: { type: String, enum: ['draft', 'active', 'closed', 'archived'], default: 'draft' },
  targetCriteria: {
    completedAfter: { type: Date },
    completedBefore: { type: Date },
    trades: [String],
    nqfLevels: [Number],
  },
  questions: [tracerQuestionSchema],
  responses: [tracerResponseSchema],
  analytics: {
    totalTargeted: { type: Number, default: 0 },
    totalResponded: { type: Number, default: 0 },
    responseRate: { type: Number, default: 0 },
    employmentRate: { type: Number, default: 0 },
    avgSatisfaction: { type: Number, default: 0 },
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

tracerStudySchema.index({ status: 1 });
tracerStudySchema.index({ 'responses.worker': 1 });

export default mongoose.model('TracerStudy', tracerStudySchema);
