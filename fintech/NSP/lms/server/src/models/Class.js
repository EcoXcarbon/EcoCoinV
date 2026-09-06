import mongoose from 'mongoose';
import crypto from 'crypto';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateJoinCode(len = 6) {
  let out = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

const classSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 200 },
  section: { type: String, trim: true, maxlength: 100 },
  subject: { type: String, trim: true, maxlength: 100 },
  room: { type: String, trim: true, maxlength: 50 },
  description: { type: String, maxlength: 2000 },
  banner: { type: String },
  theme: { type: String, default: 'blue' },

  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  joinCode: { type: String, unique: true, index: true },

  // Optional link to existing Training program (your competency curriculum)
  linkedTraining: { type: mongoose.Schema.Types.ObjectId, ref: 'Training' },
  pathway: { type: mongoose.Schema.Types.ObjectId, ref: 'Pathway' },

  status: { type: String, enum: ['active', 'archived'], default: 'active' },
  term: { type: String, maxlength: 50 },

  // Who can post / comment in Stream (Google-Classroom-style)
  // post-and-comment : students can both post new entries and comment
  // comment-only     : students can only comment on teacher posts
  // teacher-only     : students can read; only teachers post and comment
  streamPermission: {
    type: String,
    enum: ['post-and-comment', 'comment-only', 'teacher-only'],
    default: 'post-and-comment',
  },

  // Video / live-meeting integration
  //   none  : no meeting configured
  //   link  : meetingUrl is an external link (Zoom/Meet/Teams) — students open in new tab
  //   jitsi : embedded Jitsi room (meet.jit.si) joined inside the class page
  videoMode: { type: String, enum: ['none', 'link', 'jitsi'], default: 'none' },
  meetingUrl: { type: String, maxlength: 500 },
  // Auto-generated random room name for jitsi mode (hard to guess)
  jitsiRoom: { type: String },
}, { timestamps: true });

classSchema.pre('validate', async function (next) {
  if (this.joinCode) return next();
  for (let i = 0; i < 5; i++) {
    const code = generateJoinCode();
    const exists = await mongoose.model('Class').exists({ joinCode: code });
    if (!exists) { this.joinCode = code; return next(); }
  }
  this.joinCode = generateJoinCode(8);
  next();
});

classSchema.pre('save', function (next) {
  if (this.videoMode === 'jitsi' && !this.jitsiRoom) {
    // Hard-to-guess room name so randoms can't drop in via meet.jit.si/<commonName>
    this.jitsiRoom = 'tl-' + crypto.randomBytes(20).toString('base64url');
  }
  next();
});

classSchema.index({ status: 1, owner: 1 });

export default mongoose.model('Class', classSchema);
