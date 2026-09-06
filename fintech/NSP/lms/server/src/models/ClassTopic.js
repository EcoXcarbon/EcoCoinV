import mongoose from 'mongoose';

// A managed Topic (Google-Classroom-style) used to build a course outline.
// Classwork items reference a topic via ClassAssignment.topicId.
const classTopicSchema = new mongoose.Schema({
  class: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 150 },
  // Position in the outline (lower = higher up). Maintained by the reorder endpoint.
  order: { type: Number, default: 0 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

classTopicSchema.index({ class: 1, order: 1 });

export default mongoose.model('ClassTopic', classTopicSchema);
