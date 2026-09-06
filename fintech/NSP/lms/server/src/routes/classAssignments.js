import { Router } from 'express';
import { body, param } from 'express-validator';
import Class from '../models/Class.js';
import ClassEnrollment from '../models/ClassEnrollment.js';
import ClassAssignment from '../models/ClassAssignment.js';
import ClassSubmission from '../models/ClassSubmission.js';
import ClassAnnouncement from '../models/ClassAnnouncement.js';
import { authenticate, requireVerifiedEmail } from '../middleware/auth.js';
import { handleValidation } from '../middleware/validate.js';
import Worker from '../models/Worker.js';
import User from '../models/User.js';
import Credential from '../models/Credential.js';
import { generateVC } from '../services/credentialService.js';
import { sendPrompt, parseAIJson } from '../services/aiService.js';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '../../uploads');

// Extract plain text from a stored attachment (pdf / docx / txt) so the AI can
// build a quiz from the material's own content.
async function extractStoredText(url) {
  try {
    const base = String(url || '').split('/').pop();
    if (!base) return '';
    const full = path.join(UPLOADS_DIR, base);
    if (!full.startsWith(UPLOADS_DIR)) return '';
    const buffer = await fs.readFile(full);
    const name = base.toLowerCase();
    if (/\.(txt|md|markdown|csv|json|html?|xml|tsv)$/.test(name)) return buffer.toString('utf8');
    if (name.endsWith('.pdf')) {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const r = await parser.getText();
      return (typeof r === 'string' ? r : (r?.text || '')).trim();
    }
    if (name.endsWith('.docx')) {
      const mammoth = (await import('mammoth')).default || (await import('mammoth'));
      const r = await mammoth.extractRawText({ buffer });
      return (r.value || '').trim();
    }
    return '';
  } catch { return ''; }
}

const router = Router({ mergeParams: true });

// Auto-mint a blockchain credential when a class assignment is passed.
// Returns the credentialId on success, or null if not minted (no Worker, no opt-in, etc.).
async function maybeMintCredential({ cls, assignment, submission }) {
  if (!assignment.awardCredential) return null;
  if (submission.credentialId) return submission.credentialId; // already minted
  if (submission.grade == null || !assignment.points) return null;

  const pct = (submission.grade / assignment.points) * 100;
  if (pct < (assignment.passMark ?? 70)) return null;

  // Student needs a Worker record to mint a credential
  const worker = await Worker.findOne({ user: submission.student });
  if (!worker) return null;

  const count = await Credential.countDocuments();
  const credentialId = `TL-CLS-${String(count + 1).padStart(5, '0')}`;
  const title = `${cls.name} — ${assignment.title}`;
  const trade = worker.trade || 'general';
  const nqfLevel = worker.nqfLevel || 2;

  const vc = generateVC({
    credentialId, worker, type: 'micro-credential',
    title, trade, nqfLevel, institution: cls.subject || 'TalentLedger Classroom',
  });

  const adminUser = await User.findOne({ role: 'admin' }).select('_id');
  await Credential.create({
    credentialId,
    worker: worker._id,
    issuedBy: adminUser?._id || worker.user,
    type: 'micro-credential',
    trade,
    title,
    nqfLevel,
    institution: cls.subject || 'TalentLedger Classroom',
    vc,
    validFrom: new Date(),
    validUntil: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000),
    status: 'active',
  });

  submission.credentialId = credentialId;
  submission.credentialMintedAt = new Date();
  return credentialId;
}

async function getMembership(classId, userId) {
  return ClassEnrollment.findOne({ class: classId, user: userId, status: 'active' });
}
const isTeacher = (role) => role === 'teacher' || role === 'co-teacher';

async function requireMember(req, res, opts = {}) {
  const cls = await Class.findById(req.params.classId);
  if (!cls) { res.status(404).json({ error: 'Class not found' }); return null; }
  const m = await getMembership(cls._id, req.user._id);
  if (!m) { res.status(403).json({ error: 'Not a member' }); return null; }
  if (opts.teacherOnly && !isTeacher(m.role)) {
    res.status(403).json({ error: 'Teacher access required' }); return null;
  }
  return { cls, m };
}

/* ────────── LIST CLASSWORK ────────── */
router.get('/', authenticate, [
  param('classId').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMember(req, res);
    if (!ctx) return;

    const filter = { class: ctx.cls._id };
    if (!isTeacher(ctx.m.role)) filter.status = 'published';

    const items = await ClassAssignment.find(filter)
      .sort('-createdAt')
      .populate('author', 'name avatar');

    // Attach my submission summary
    const ids = items.map(i => i._id);
    const mySubs = await ClassSubmission.find({
      assignment: { $in: ids },
      student: req.user._id,
    }).select('assignment status grade turnedInAt late');
    const subMap = Object.fromEntries(mySubs.map(s => [s.assignment.toString(), s]));

    const enriched = items.map(it => ({
      ...it.toObject(),
      mySubmission: subMap[it._id.toString()] || null,
    }));
    res.json(enriched);
  } catch (err) { next(err); }
});

/* ────────── CREATE ASSIGNMENT (teacher only) ────────── */
router.post('/', authenticate, requireVerifiedEmail, [
  param('classId').isMongoId(),
  body('title').trim().notEmpty().isLength({ max: 300 }),
  body('instructions').optional().isLength({ max: 10000 }),
  body('topic').optional().trim().isLength({ max: 100 }),
  body('topicId').optional({ checkFalsy: true }).isMongoId(),
  body('order').optional().isInt({ min: 0 }).toInt(),
  body('type').optional().isIn(['assignment', 'quiz', 'material', 'question']),
  body('points').optional().isInt({ min: 0, max: 1000 }).toInt(),
  body('dueDate').optional().isISO8601(),
  body('closeDate').optional().isISO8601(),
  body('allowLate').optional().isBoolean(),
  body('attachments').optional().isArray(),
  body('competencyTags').optional().isArray(),
  body('passMark').optional().isInt({ min: 0, max: 100 }).toInt(),
  body('awardCredential').optional().isBoolean(),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMember(req, res, { teacherOnly: true });
    if (!ctx) return;

    const payload = { ...req.body };
    if (!payload.topicId) delete payload.topicId; // avoid casting '' → ObjectId
    // Append to the end of its topic group if no explicit order given.
    if (payload.order === undefined) {
      const last = await ClassAssignment.findOne({ class: ctx.cls._id, topicId: payload.topicId || null })
        .sort('-order').select('order');
      payload.order = (last?.order ?? -1) + 1;
    }

    const assignment = await ClassAssignment.create({
      ...payload,
      class: ctx.cls._id,
      author: req.user._id,
    });

    // Emit a stream entry so it shows in Stream alongside announcements
    await ClassAnnouncement.create({
      class: ctx.cls._id,
      author: req.user._id,
      body: `Posted ${assignment.type === 'material' ? 'material' : 'assignment'}: ${assignment.title}`,
      kind: assignment.type === 'material' ? 'announcement' : 'assignment-posted',
      refAssignment: assignment._id,
    });

    res.status(201).json(assignment);
  } catch (err) { next(err); }
});

/* ────────── REORDER CLASSWORK within/across topics (teacher) ────────── */
// Declared before /:assignmentId so "reorder" isn't captured as an assignment id.
router.put('/reorder', authenticate, [
  param('classId').isMongoId(),
  body('items').isArray({ min: 1 }),
  body('items.*.id').isMongoId(),
  body('items.*.order').isInt({ min: 0 }).toInt(),
  body('items.*.topicId').optional({ nullable: true }),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMember(req, res, { teacherOnly: true });
    if (!ctx) return;
    const ops = req.body.items.map(it => {
      const update = { order: it.order };
      if (it.topicId) update.topicId = it.topicId;
      else update.$unset = { topicId: '' };
      return { updateOne: { filter: { _id: it.id, class: ctx.cls._id }, update } };
    });
    if (ops.length) await ClassAssignment.bulkWrite(ops);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ────────── GET ASSIGNMENT (with my submission) ────────── */
router.get('/:assignmentId', authenticate, [
  param('classId').isMongoId(),
  param('assignmentId').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMember(req, res);
    if (!ctx) return;
    const assignment = await ClassAssignment.findOne({ _id: req.params.assignmentId, class: ctx.cls._id })
      .populate('author', 'name avatar');
    if (!assignment) return res.status(404).json({ error: 'Not found' });

    let mySubmission = null;
    if (!isTeacher(ctx.m.role)) {
      mySubmission = await ClassSubmission.findOne({ assignment: assignment._id, student: req.user._id });
    }
    res.json({ assignment, mySubmission });
  } catch (err) { next(err); }
});

/* ────────── UPDATE ASSIGNMENT (teacher) ────────── */
router.put('/:assignmentId', authenticate, [
  param('classId').isMongoId(),
  param('assignmentId').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMember(req, res, { teacherOnly: true });
    if (!ctx) return;
    const allowed = ['title', 'instructions', 'topic', 'topicId', 'order', 'type', 'points', 'dueDate', 'closeDate', 'allowLate', 'attachments', 'status', 'competencyTags', 'passMark', 'awardCredential'];
    const updates = {};
    for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
    if (updates.topicId === '' || updates.topicId === null) { delete updates.topicId; updates.$unset = { topicId: '' }; }
    const assignment = await ClassAssignment.findOneAndUpdate(
      { _id: req.params.assignmentId, class: ctx.cls._id },
      updates, { new: true, runValidators: true }
    );
    if (!assignment) return res.status(404).json({ error: 'Not found' });
    res.json(assignment);
  } catch (err) { next(err); }
});

/* ────────── DELETE ASSIGNMENT (teacher) ────────── */
router.delete('/:assignmentId', authenticate, [
  param('classId').isMongoId(),
  param('assignmentId').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMember(req, res, { teacherOnly: true });
    if (!ctx) return;
    const assignment = await ClassAssignment.findOneAndDelete({ _id: req.params.assignmentId, class: ctx.cls._id });
    if (!assignment) return res.status(404).json({ error: 'Not found' });
    await ClassSubmission.deleteMany({ assignment: assignment._id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ────────── TURN IN / SUBMIT (student) ────────── */
router.post('/:assignmentId/submit', authenticate, requireVerifiedEmail, [
  param('classId').isMongoId(),
  param('assignmentId').isMongoId(),
  body('text').optional().isLength({ max: 20000 }),
  body('links').optional().isArray(),
  body('attachments').optional().isArray(),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMember(req, res);
    if (!ctx) return;
    const assignment = await ClassAssignment.findOne({ _id: req.params.assignmentId, class: ctx.cls._id });
    if (!assignment) return res.status(404).json({ error: 'Not found' });
    if (assignment.status !== 'published') return res.status(400).json({ error: 'Assignment not open' });
    if (assignment.type === 'material') return res.status(400).json({ error: 'Materials cannot be turned in' });

    const now = new Date();
    if (assignment.closeDate && now > assignment.closeDate) {
      return res.status(400).json({ error: 'Assignment closed' });
    }
    const isLate = !!(assignment.dueDate && now > assignment.dueDate);
    if (isLate && !assignment.allowLate) {
      return res.status(400).json({ error: 'Late submissions not allowed' });
    }

    let sub = await ClassSubmission.findOne({ assignment: assignment._id, student: req.user._id });
    if (!sub) {
      sub = await ClassSubmission.create({
        assignment: assignment._id,
        class: ctx.cls._id,
        student: req.user._id,
        text: req.body.text || '',
        links: req.body.links || [],
        attachments: req.body.attachments || [],
        status: 'turned-in',
        turnedInAt: now,
        late: isLate,
      });
    } else {
      if (req.body.text !== undefined) sub.text = req.body.text;
      if (req.body.links !== undefined) sub.links = req.body.links;
      if (req.body.attachments !== undefined) sub.attachments = req.body.attachments;
      sub.status = sub.status === 'returned' ? 'resubmitted' : 'turned-in';
      sub.turnedInAt = now;
      sub.late = isLate;
      await sub.save();
    }
    res.json(sub);
  } catch (err) { next(err); }
});

/* ────────── UNSUBMIT (student) ────────── */
router.post('/:assignmentId/unsubmit', authenticate, [
  param('classId').isMongoId(),
  param('assignmentId').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMember(req, res);
    if (!ctx) return;
    const sub = await ClassSubmission.findOne({
      assignment: req.params.assignmentId,
      class: ctx.cls._id,
      student: req.user._id,
    });
    if (!sub) return res.status(404).json({ error: 'No submission' });
    if (sub.status === 'returned') return res.status(400).json({ error: 'Cannot unsubmit a returned submission' });
    sub.status = 'draft';
    sub.turnedInAt = undefined;
    await sub.save();
    res.json(sub);
  } catch (err) { next(err); }
});

/* ────────── LIST SUBMISSIONS (teacher) ────────── */
router.get('/:assignmentId/submissions', authenticate, [
  param('classId').isMongoId(),
  param('assignmentId').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMember(req, res, { teacherOnly: true });
    if (!ctx) return;
    const assignment = await ClassAssignment.findOne({ _id: req.params.assignmentId, class: ctx.cls._id });
    if (!assignment) return res.status(404).json({ error: 'Not found' });

    const students = await ClassEnrollment.find({ class: ctx.cls._id, role: 'student', status: 'active' })
      .populate('user', 'name email avatar');

    const subs = await ClassSubmission.find({ assignment: assignment._id })
      .populate('student', 'name email avatar')
      .populate('gradedBy', 'name');
    const subMap = Object.fromEntries(subs.map(s => [s.student._id.toString(), s]));

    const rows = students.map(s => {
      const sub = subMap[s.user._id.toString()];
      return {
        student: s.user,
        submission: sub || null,
        status: sub?.status || 'missing',
      };
    });
    res.json({ assignment, rows });
  } catch (err) { next(err); }
});

/* ────────── GRADE & RETURN SUBMISSION (teacher) ────────── */
router.put('/:assignmentId/submissions/:submissionId/grade', authenticate, requireVerifiedEmail, [
  param('classId').isMongoId(),
  param('assignmentId').isMongoId(),
  param('submissionId').isMongoId(),
  body('grade').optional().isFloat({ min: 0, max: 1000 }),
  body('feedback').optional().isLength({ max: 5000 }),
  body('return').optional().isBoolean(),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMember(req, res, { teacherOnly: true });
    if (!ctx) return;
    const sub = await ClassSubmission.findOne({
      _id: req.params.submissionId,
      assignment: req.params.assignmentId,
      class: ctx.cls._id,
    });
    if (!sub) return res.status(404).json({ error: 'Submission not found' });

    if (req.body.grade !== undefined) sub.grade = Number(req.body.grade);
    if (req.body.feedback !== undefined) sub.feedback = req.body.feedback;
    sub.gradedBy = req.user._id;

    if (req.body.return) {
      sub.status = 'returned';
      sub.returnedAt = new Date();
    }

    // Auto-mint blockchain credential if returned and passing threshold met
    let mintedId = null;
    if (req.body.return) {
      const assignment = await ClassAssignment.findById(sub.assignment);
      if (assignment) {
        try {
          mintedId = await maybeMintCredential({ cls: ctx.cls, assignment, submission: sub });
        } catch (mintErr) {
          // Non-fatal: log and continue. Grading itself succeeds.
          console.warn(`[ClassroomCredential] Mint failed: ${mintErr.message}`);
        }
      }
    }
    await sub.save();
    res.json({ ...sub.toObject(), mintedCredentialId: mintedId });
  } catch (err) { next(err); }
});

/* ────────── PRIVATE COMMENT on a submission ────────── */
router.post('/:assignmentId/submissions/:submissionId/comments', authenticate, [
  param('classId').isMongoId(),
  param('assignmentId').isMongoId(),
  param('submissionId').isMongoId(),
  body('body').trim().notEmpty().isLength({ max: 2000 }),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMember(req, res);
    if (!ctx) return;
    const sub = await ClassSubmission.findOne({
      _id: req.params.submissionId,
      assignment: req.params.assignmentId,
      class: ctx.cls._id,
    });
    if (!sub) return res.status(404).json({ error: 'Submission not found' });
    if (sub.student.toString() !== req.user._id.toString() && !isTeacher(ctx.m.role)) {
      return res.status(403).json({ error: 'Only the student or a teacher can comment' });
    }
    sub.privateComments.push({ author: req.user._id, body: req.body.body });
    await sub.save();
    const populated = await ClassSubmission.findById(sub._id).populate('privateComments.author', 'name avatar');
    res.status(201).json(populated);
  } catch (err) { next(err); }
});

/* ────────── GRADEBOOK (teacher) ────────── */
router.get('/gradebook/all', authenticate, [
  param('classId').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMember(req, res, { teacherOnly: true });
    if (!ctx) return;

    const assignments = await ClassAssignment.find({
      class: ctx.cls._id,
      type: { $in: ['assignment', 'quiz'] },
      status: 'published',
    }).sort('createdAt').select('title points dueDate type');

    const students = await ClassEnrollment.find({ class: ctx.cls._id, role: 'student', status: 'active' })
      .populate('user', 'name email avatar')
      .sort('user.name');

    const allSubs = await ClassSubmission.find({
      class: ctx.cls._id,
      assignment: { $in: assignments.map(a => a._id) },
    }).select('assignment student grade status late');

    const subIndex = {};
    for (const s of allSubs) {
      const key = `${s.assignment.toString()}|${s.student.toString()}`;
      subIndex[key] = s;
    }

    const rows = students.map(s => {
      const cells = assignments.map(a => {
        const sub = subIndex[`${a._id.toString()}|${s.user._id.toString()}`];
        return {
          assignmentId: a._id,
          grade: sub?.grade ?? null,
          status: sub?.status || 'missing',
          late: sub?.late || false,
        };
      });

      // Average across graded items
      const graded = cells.filter(c => c.grade != null);
      const totalEarned = graded.reduce((s, c) => s + c.grade, 0);
      const totalPossible = graded.reduce((sum, c) => {
        const a = assignments.find(a => a._id.toString() === c.assignmentId.toString());
        return sum + (a?.points || 100);
      }, 0);
      const avg = totalPossible > 0 ? Math.round((totalEarned / totalPossible) * 1000) / 10 : null;

      return { student: s.user, cells, average: avg };
    });

    res.json({ assignments, rows });
  } catch (err) { next(err); }
});

/* ────────── IN-APP DOCX RENDER ──────────
   Word documents can't be shown in a browser <iframe>. Convert a material's
   .docx attachment to sanitized HTML server-side so it renders inside the LMS
   (PDFs/images are fetched as blobs client-side and don't need this). */
router.get('/:assignmentId/material-html', authenticate, [
  param('assignmentId').isMongoId(), handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMember(req, res); if (!ctx) return;
    const a = await ClassAssignment.findOne({ _id: req.params.assignmentId, class: ctx.cls._id });
    if (!a) return res.status(404).json({ error: 'Not found' });
    const idx = parseInt(req.query.index, 10) || 0;
    const att = (a.attachments || [])[idx];
    if (!att?.url) return res.status(404).json({ error: 'Attachment not found' });
    const base = String(att.url).split('/').pop();
    const full = path.join(UPLOADS_DIR, base);
    if (!full.startsWith(UPLOADS_DIR) || !/\.docx?$/i.test(base)) {
      return res.status(400).json({ error: 'Not a Word document' });
    }
    const buffer = await fs.readFile(full);
    const mammoth = (await import('mammoth')).default || (await import('mammoth'));
    const r = await mammoth.convertToHtml({ buffer });
    res.json({ name: att.name, html: r.value || '' });
  } catch (e) { next(e); }
});

/* ────────── AI LESSON QUIZ (for `material` classwork) ──────────
   Generates an MCQ quiz from the material's own attachments/instructions via the
   Claude relay, caches it on the material, and scores attempts server-side. */
router.post('/:assignmentId/lesson-quiz', authenticate, [
  param('assignmentId').isMongoId(), handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMember(req, res); if (!ctx) return;
    const a = await ClassAssignment.findOne({ _id: req.params.assignmentId, class: ctx.cls._id });
    if (!a) return res.status(404).json({ error: 'Not found' });
    if (a.type !== 'material') return res.status(400).json({ error: 'Quizzes are generated for materials only.' });

    const forStudent = (qs) => qs.map((q, i) => ({ i, question: q.question, options: q.options }));

    // Serve cached quiz unless a teacher explicitly regenerates.
    if (a.lessonQuiz?.questions?.length && !(req.body.regenerate && isTeacher(ctx.m.role))) {
      return res.json({ questions: forStudent(a.lessonQuiz.questions), cached: true });
    }

    const count = Math.min(Math.max(parseInt(req.body.count, 10) || 5, 3), 10);
    const parts = await Promise.all((a.attachments || []).map(att => extractStoredText(att.url)));
    const source = [a.instructions || '', ...parts].filter(Boolean).join('\n\n---\n\n').trim().slice(0, 16000);
    if (source.length < 40) {
      return res.status(422).json({ error: 'This material has no readable text (PDF/DOCX/TXT) to build a quiz from.' });
    }

    const prompt = `You are an assessment author for a vocational lesson titled "${a.title}" in the class "${ctx.cls.name || ''}".
Read the lesson material below and write exactly ${count} multiple-choice questions that check understanding of THIS material.
Source material:
"""
${source}
"""
Respond with ONLY a JSON array (no markdown fences), each item shaped exactly like:
{ "question": "...", "options": ["a","b","c","d"], "correctOption": 0, "explanation": "one line why" }
Rules: exactly 4 options each; correctOption is the 0-based index of the correct option; questions must be answerable from the material.`;

    const ai = await sendPrompt(prompt, req.user._id, {
      systemPrompt: 'You are an expert vocational assessment author. Respond with a valid JSON array only.',
      maxTokens: 3000, skipCache: true,
    });
    if (ai.error) return res.status(ai.available ? 429 : 503).json({ error: ai.error });

    let raw;
    try { raw = parseAIJson(ai.text); if (!Array.isArray(raw)) raw = raw.questions || []; }
    catch { return res.status(502).json({ error: 'Could not parse the generated quiz. Try again.' }); }

    const questions = raw.slice(0, count).map(q => {
      const options = Array.isArray(q.options) ? q.options.slice(0, 4).map(String) : [];
      let correct = Number(q.correctOption);
      if (!Number.isInteger(correct) || correct < 0 || correct > 3) correct = 0;
      return { question: String(q.question || '').slice(0, 500), options, correctOption: correct, explanation: String(q.explanation || '').slice(0, 300) };
    }).filter(q => q.question && q.options.length === 4);

    if (!questions.length) return res.status(502).json({ error: 'The quiz came back empty. Try again.' });

    a.lessonQuiz = { generatedAt: new Date(), questions };
    await a.save();
    res.json({ questions: forStudent(questions), cached: false });
  } catch (e) { next(e); }
});

router.post('/:assignmentId/lesson-quiz/submit', authenticate, [
  param('assignmentId').isMongoId(),
  body('answers').isArray(),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMember(req, res); if (!ctx) return;
    const a = await ClassAssignment.findOne({ _id: req.params.assignmentId, class: ctx.cls._id });
    if (!a) return res.status(404).json({ error: 'Not found' });
    const questions = a.lessonQuiz?.questions || [];
    if (!questions.length) return res.status(400).json({ error: 'Generate the quiz first.' });

    const answers = req.body.answers.map(n => (Number.isInteger(n) ? n : -1)).slice(0, questions.length);
    const results = questions.map((q, i) => ({
      question: q.question, options: q.options, correctOption: q.correctOption,
      selected: answers[i] ?? -1, isCorrect: (answers[i] ?? -1) === q.correctOption, explanation: q.explanation,
    }));
    const correct = results.filter(r => r.isCorrect).length;
    const total = questions.length;
    const score = Math.round((correct / total) * 100);

    // Upsert the learner's result (materials aren't "turned in", so we store it
    // on their ClassSubmission record for this material).
    const sub = await ClassSubmission.findOneAndUpdate(
      { assignment: a._id, student: req.user._id },
      {
        // Set sub-fields individually — $set of the whole lessonResult object
        // would conflict with $inc on lessonResult.attempts.
        $set: {
          class: ctx.cls._id,
          'lessonResult.score': score,
          'lessonResult.correct': correct,
          'lessonResult.total': total,
          'lessonResult.answers': answers,
          'lessonResult.submittedAt': new Date(),
        },
        $inc: { 'lessonResult.attempts': 1 },
        $setOnInsert: { status: 'draft' },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    res.json({ score, correct, total, passed: score >= (a.passMark ?? 70), results, attempts: sub.lessonResult?.attempts || 1 });
  } catch (e) { next(e); }
});

export default router;
