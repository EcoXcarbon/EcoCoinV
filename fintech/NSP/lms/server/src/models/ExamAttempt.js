/**
 * ExamAttempt — timed final-exam attempts (isolated from the RPL Assessment engine).
 * One attempt per (training, worker). Question + option order are shuffled per student
 * and stored so scoring maps a student's displayed choice back to the original option.
 */
import mongoose from 'mongoose';

const examAttemptSchema = new mongoose.Schema({
  training:   { type: mongoose.Schema.Types.ObjectId, ref: 'Training', required: true, index: true },
  moduleId:   { type: mongoose.Schema.Types.ObjectId, required: true },
  worker:     { type: mongoose.Schema.Types.ObjectId, ref: 'Worker', required: true, index: true },
  user:       { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  studentName:{ type: String },     // snapshot at start
  className:  { type: String },     // snapshot of the course title at start

  // Per-student paper layout (indices into module.quizQuestions):
  order:   [{ type: Number }],                 // order[displayIdx] = originalQuestionIndex
  optPerm: [[{ type: Number }]],               // optPerm[displayIdx][displayOptPos] = originalOptionIndex

  durationSec: { type: Number, default: 1800 },
  startedAt:   { type: Date, default: Date.now },
  submittedAt: { type: Date },
  status:      { type: String, enum: ['in-progress', 'submitted'], default: 'in-progress' },
  lateSubmit:  { type: Boolean, default: false },

  answers: [{ i: Number, sel: Number }],       // i = displayIdx, sel = displayed option position chosen
  score:   { type: Number },
  total:   { type: Number },

  // Integrity monitoring (deterrence, not lockdown): counts of recorded violations.
  flags: {
    copy:           { type: Number, default: 0 },  // copy/cut/right-click/paste attempts
    tabSwitch:      { type: Number, default: 0 },  // left the exam tab / window
    fullscreenExit: { type: Number, default: 0 },  // exited fullscreen
  },
  flagEvents: [{ type: { type: String }, at: Date }],
}, { timestamps: true });

// One attempt per (course, assessment-module, student).
examAttemptSchema.index({ training: 1, moduleId: 1, worker: 1 }, { unique: true });

export default mongoose.models.ExamAttempt || mongoose.model('ExamAttempt', examAttemptSchema);
