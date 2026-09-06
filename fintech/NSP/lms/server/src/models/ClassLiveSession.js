import mongoose from 'mongoose';
import crypto from 'crypto';

// A scheduled live session for a class (beyond the single persistent class meeting).
// Teachers schedule sessions, mark them Live, end them, and attach a recording link.
const classLiveSessionSchema = new mongoose.Schema({
  // A live session belongs to EITHER a classroom Class OR an LMS Training.
  // Exactly one is set; a pre-validate hook enforces that.
  class: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', index: true },
  training: { type: mongoose.Schema.Types.ObjectId, ref: 'Training', index: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, maxlength: 2000 },

  scheduledFor: { type: Date, required: true },
  durationMins: { type: Number, default: 60, min: 5, max: 600 },

  // jitsi : embedded private room generated here
  // link  : external meeting URL (Zoom/Meet/Teams)
  mode: { type: String, enum: ['jitsi', 'link'], default: 'jitsi' },
  meetingUrl: { type: String, maxlength: 500 },
  jitsiRoom: { type: String },

  status: { type: String, enum: ['scheduled', 'live', 'ended', 'cancelled'], default: 'scheduled', index: true },
  startedAt: { type: Date },
  endedAt: { type: Date },

  recordingUrl: { type: String, maxlength: 500 },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

classLiveSessionSchema.pre('validate', function (next) {
  if (!this.class && !this.training) {
    return next(new Error('A live session must belong to a class or a training'));
  }
  next();
});

classLiveSessionSchema.pre('save', function (next) {
  if (this.mode === 'jitsi' && !this.jitsiRoom) {
    this.jitsiRoom = 'tl-live-' + crypto.randomBytes(16).toString('base64url');
  }
  next();
});

classLiveSessionSchema.index({ class: 1, scheduledFor: -1 });
classLiveSessionSchema.index({ training: 1, scheduledFor: -1 });

export default mongoose.model('ClassLiveSession', classLiveSessionSchema);
