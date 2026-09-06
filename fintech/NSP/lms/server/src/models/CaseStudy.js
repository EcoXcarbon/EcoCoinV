import mongoose from 'mongoose';

/**
 * A single case study a student reads and then answers five short questions on.
 * Cases belong to one of the two case-method courses (M&A or ACF) and are open
 * to every registered student. Grading is done by the Claude relay and each
 * student may attempt a case exactly once (see CaseAttempt's unique index).
 */
const caseStudySchema = new mongoose.Schema({
  // Which case-method course this belongs to.
  course: { type: String, enum: ['MA', 'ACF'], required: true, index: true },
  courseTitle: { type: String },                 // "Mergers & Acquisitions"
  week: { type: Number },
  code: { type: String, required: true, unique: true }, // "MA-W01", "ACF-W15A"
  title: { type: String, required: true },
  subtitle: { type: String },
  // The case reading, pre-rendered as sanitised HTML.
  contentHtml: { type: String, required: true },
  // Exactly five short-answer questions (≤100 words each expected).
  questions: { type: [String], validate: v => v.length >= 3 && v.length <= 6 },
  order: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
}, { timestamps: true });

caseStudySchema.index({ course: 1, order: 1 });

export default mongoose.model('CaseStudy', caseStudySchema);
