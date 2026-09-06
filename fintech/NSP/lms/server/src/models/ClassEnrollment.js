import mongoose from 'mongoose';

const classEnrollmentSchema = new mongoose.Schema({
  class: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  role: { type: String, enum: ['student', 'teacher', 'co-teacher'], default: 'student' },
  status: { type: String, enum: ['active', 'removed', 'left'], default: 'active' },
  joinedAt: { type: Date, default: Date.now },
}, { timestamps: true });

classEnrollmentSchema.index({ class: 1, user: 1 }, { unique: true });
classEnrollmentSchema.index({ user: 1, status: 1 });

export default mongoose.model('ClassEnrollment', classEnrollmentSchema);
