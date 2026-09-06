import mongoose from 'mongoose';

/**
 * A certificate awarded when a student completes all case studies in one of the
 * two graduate-level courses (Mergers & Acquisitions, Advanced Corporate
 * Finance). One certificate per student per course (unique index). Purely
 * additive — issuing a certificate never touches attempt data.
 */
const caseCertificateSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  course: { type: String, enum: ['MA', 'ACF'], required: true },
  courseTitle: { type: String },                 // "Mergers & Acquisitions"
  level: { type: String, default: 'Graduate-Level Course' },
  certificateId: { type: String, required: true, unique: true }, // TLC-MA-A1B2C3
  studentName: { type: String },
  studentId: { type: String },                   // roll / registration no
  casesCompleted: { type: Number },
  totalCases: { type: Number },
  cumulativeScore: { type: Number },
  averageScore: { type: Number },
  band: { type: String },                         // Distinction | Merit | Pass
  issuedAt: { type: Date, default: Date.now },
}, { timestamps: true });

caseCertificateSchema.index({ student: 1, course: 1 }, { unique: true });

export default mongoose.model('CaseCertificate', caseCertificateSchema);
