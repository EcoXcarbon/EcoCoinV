import mongoose from 'mongoose';

/**
 * A student's registration for the case-study programme. Captured once, up front,
 * via a small form before they can begin any case. The registered full name is
 * what appears on the leaderboard, so identity on the ladder is deliberate.
 */
const caseParticipantSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  fullName: { type: String, required: true, trim: true, maxlength: 120 },
  studentId: { type: String, trim: true, maxlength: 60 },   // roll no / registration no
  program: { type: String, trim: true, maxlength: 120 },    // degree / batch
  email: { type: String, trim: true, lowercase: true, maxlength: 254 },
  registeredAt: { type: Date, default: Date.now },
}, { timestamps: true });

export default mongoose.model('CaseParticipant', caseParticipantSchema);
