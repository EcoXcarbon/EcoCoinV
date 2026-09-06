import mongoose from 'mongoose';

const privateCommentSchema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  body: { type: String, required: true, maxlength: 2000 },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

const classSubmissionSchema = new mongoose.Schema({
  assignment: { type: mongoose.Schema.Types.ObjectId, ref: 'ClassAssignment', required: true, index: true },
  class: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true, index: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

  text: { type: String, maxlength: 20000 },
  links: [{ url: String, label: String }],
  attachments: [{
    name: String,
    url: String,
    size: Number,
    type: String,
  }],

  status: {
    type: String,
    enum: ['draft', 'turned-in', 'returned', 'resubmitted'],
    default: 'draft',
  },
  turnedInAt: { type: Date },
  late: { type: Boolean, default: false },

  grade: { type: Number, min: 0, max: 1000 },
  feedback: { type: String, maxlength: 5000 },
  returnedAt: { type: Date },
  gradedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  privateComments: [privateCommentSchema],

  // Set when credential auto-mint succeeds after grading
  credentialId: { type: String },
  credentialMintedAt: { type: Date },

  // Per-lesson MCQ quiz result (for `material` classwork with a generated quiz).
  lessonResult: {
    score: { type: Number },       // percentage 0-100
    correct: { type: Number },
    total: { type: Number },
    answers: { type: [Number], default: undefined },
    submittedAt: { type: Date },
    attempts: { type: Number, default: 0 },
  },
}, { timestamps: true });

classSubmissionSchema.index({ assignment: 1, student: 1 }, { unique: true });
classSubmissionSchema.index({ class: 1, student: 1 });

export default mongoose.model('ClassSubmission', classSubmissionSchema);
