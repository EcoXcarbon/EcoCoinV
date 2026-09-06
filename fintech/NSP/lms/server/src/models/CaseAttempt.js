import mongoose from 'mongoose';

// The AI's grade for one of the five answers.
const perQuestionSchema = new mongoose.Schema({
  question: String,
  answer: String,                                // the student's answer (snapshot)
  score: { type: Number, default: 0 },           // 0..20 (sum of the four criteria below)
  max: { type: Number, default: 20 },
  // Numeric rubric — each criterion scored 0..5, summing to the /20 score.
  criteria: {
    relevance: { type: Number, default: 0 },     // answers the question actually asked
    accuracy: { type: Number, default: 0 },      // correct facts / correct case numbers
    reasoning: { type: Number, default: 0 },     // depth and logic of the argument
    useOfCase: { type: Number, default: 0 },     // grounded in this case's specifics
  },
  feedback: String,                              // why the answer earned that score
  modelPoints: [String],                        // key points a strong answer would make
  // AI-writing estimate (0..100): how much of this answer reads as AI-generated.
  aiLikelihood: { type: Number, default: 0 },
  aiReason: String,
}, { _id: false });

/**
 * A student's one-and-only attempt at a case. Enforced unique on
 * (student, caseStudy): once submitted it is locked — "once it is done it is
 * done" — the same account cannot re-enter. rawScore is the AI's on-merit mark
 * (0..100); the relative/percentile mark and leaderboard rank are computed at
 * read time from the pool of all attempts on the same case/course.
 */
const caseAttemptSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  studentName: { type: String },                 // display snapshot for the ladder
  caseStudy: { type: mongoose.Schema.Types.ObjectId, ref: 'CaseStudy', required: true, index: true },
  course: { type: String, enum: ['MA', 'ACF'], required: true, index: true },
  code: { type: String },                        // "MA-W01" snapshot

  answers: [{ question: String, answer: String }],

  ai: {
    perQuestion: [perQuestionSchema],
    total: Number,                               // 0..100 raw (sum of five * 20 / 100)
    band: String,                                // Distinction | Merit | Pass | Weak
    overall: String,                             // narrative assessment
    strengths: [String],
    improvements: [String],
    modelAnswer: String,                         // the AI's own on-merit answer to the case
    aiOverall: { type: Number, default: 0 },     // 0..100 average AI-writing estimate across answers
  },

  rawScore: { type: Number, default: 0, index: true },  // 0..100, on merit
  // Grading runs in the background so the student never waits on a slow relay.
  // grading → graded (success) | failed (relay error/timeout, retryable).
  status: { type: String, enum: ['grading', 'graded', 'failed'], default: 'graded', index: true },
  gradeError: { type: String },
  gradeStartedAt: { type: Date },
  gradedAt: Date,
  locked: { type: Boolean, default: true },      // attempts are always locked on submit
}, { timestamps: true });

// One attempt per student per case. This is the lock.
caseAttemptSchema.index({ student: 1, caseStudy: 1 }, { unique: true });
// Leaderboard queries: all attempts in a course ranked by score.
caseAttemptSchema.index({ course: 1, rawScore: -1 });

export default mongoose.model('CaseAttempt', caseAttemptSchema);
