import mongoose from 'mongoose';

const classAssignmentSchema = new mongoose.Schema({
  class: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true, index: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  title: { type: String, required: true, trim: true, maxlength: 300 },
  instructions: { type: String, maxlength: 10000 },
  // Legacy free-text topic (kept for back-compat). New code uses the managed topicId.
  topic: { type: String, trim: true, maxlength: 100 },
  // Managed topic (ClassTopic) for the structured course outline.
  topicId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClassTopic', index: true },
  // Position within its topic (lower = higher up). Maintained by the reorder endpoint.
  order: { type: Number, default: 0 },

  type: { type: String, enum: ['assignment', 'quiz', 'material', 'question'], default: 'assignment' },

  points: { type: Number, default: 100, min: 0, max: 1000 },
  dueDate: { type: Date },
  closeDate: { type: Date },

  attachments: { type: [mongoose.Schema.Types.Mixed], default: [] },

  allowLate: { type: Boolean, default: true },
  status: { type: String, enum: ['draft', 'published', 'archived'], default: 'published' },

  // Award threshold (% of points required to trigger credential)
  passMark: { type: Number, default: 70, min: 0, max: 100 },
  // If true, passing earns a blockchain credential auto-minted via the existing Credential pipeline
  awardCredential: { type: Boolean, default: false },

  // Map to your competency taxonomy so passing this triggers credential mint later
  competencyTags: [{
    skill: { type: String },
    level: { type: String, enum: ['foundation', 'intermediate', 'advanced', 'expert'], default: 'foundation' },
  }],

  // AI-generated per-lesson MCQ quiz (cached from the material's own content via
  // the Claude relay, so every learner gets the same questions for a material).
  lessonQuiz: {
    generatedAt: { type: Date },
    questions: { type: [mongoose.Schema.Types.Mixed], default: undefined },
  },
}, { timestamps: true });

classAssignmentSchema.index({ class: 1, dueDate: 1 });
classAssignmentSchema.index({ class: 1, topic: 1 });

export default mongoose.model('ClassAssignment', classAssignmentSchema);
