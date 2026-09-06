import mongoose from 'mongoose';

const commentSchema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  body: { type: String, required: true, maxlength: 2000 },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

const classAnnouncementSchema = new mongoose.Schema({
  class: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true, index: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  body: { type: String, required: true, maxlength: 5000 },
  attachments: { type: [mongoose.Schema.Types.Mixed], default: [] },
  pinned: { type: Boolean, default: false },
  // Per-post comment lock (teachers can disable comments on a single announcement)
  commentsLocked: { type: Boolean, default: false },
  // If set + in the future, post is hidden from non-author non-teachers until then
  scheduledFor: { type: Date },
  // Activity-feed entries (when an assignment is posted, system emits an entry here)
  kind: { type: String, enum: ['announcement', 'assignment-posted', 'assignment-graded'], default: 'announcement' },
  refAssignment: { type: mongoose.Schema.Types.ObjectId, ref: 'ClassAssignment' },
  comments: [commentSchema],
}, { timestamps: true });

classAnnouncementSchema.index({ class: 1, createdAt: -1 });
classAnnouncementSchema.index({ class: 1, scheduledFor: 1 });

export default mongoose.model('ClassAnnouncement', classAnnouncementSchema);
