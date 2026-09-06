/**
 * exam-admin — staff create/manage timed online assessments by uploading an MCQ file.
 * Mounted at /api/v1/exam-admin (+ /api/exam-admin). Staff only.
 *
 *   POST /        multipart (file + title, subject, durationMin, maxEnrollment) → creates a course+exam
 *   GET  /        list all upload-created assessments with links + counts
 *   DELETE /:id   remove an assessment course and its attempts
 */
import express from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import Training from '../models/Training.js';
import ExamAttempt from '../models/ExamAttempt.js';
import { authenticate } from '../middleware/auth.js';
import { parseMcqFile } from '../services/mcqParser.js';
import { PUBLIC_BASE } from '../config/identity.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const STAFF = ['admin', 'institution', 'assessor', 'trainer'];
const isStaff = (u) => u && STAFF.includes(u.role);
const TAG = 'online-exam';
const INST = 'Institute of Management Sciences (IMSciences)';
const clamp = (v, lo, hi, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

function base() { return PUBLIC_BASE; }
function links(id) {
  const b = base();
  return { join: `${b}/join/${id}?next=/exam/${id}`, exam: `${b}/exam/${id}`, results: `${b}/exam/${id}/results` };
}
function staffGate(req, res) {
  if (!isStaff(req.user)) { res.status(403).json({ error: 'Staff access required.' }); return false; }
  return true;
}

// POST / — create an assessment from an uploaded MCQ file
router.post('/', authenticate, upload.single('file'), async (req, res, next) => {
  try {
    if (!staffGate(req, res)) return;
    const title = (req.body.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Please enter a class / course name.' });
    if (!req.file) return res.status(400).json({ error: 'Please upload an MCQ file (.docx, .txt or .csv).' });

    let bank;
    try { bank = await parseMcqFile(req.file.buffer, req.file.originalname || '', req.file.mimetype || ''); }
    catch (e) { return res.status(422).json({ error: 'Could not read the file: ' + e.message }); }

    const durationMin = clamp(req.body.durationMin, 1, 240, 30);
    const maxEnrollment = clamp(req.body.maxEnrollment, 1, 1000, 30);
    const nqfLevel = clamp(req.body.nqfLevel, 1, 8, 6);
    const subject = (req.body.subject || 'Assessment').trim();

    const training = await Training.create({
      title, trade: subject,
      description: (req.body.description || `Online class assessment — ${bank.length} MCQs, ${durationMin} minutes, single attempt, questions in random order.`).slice(0, 2000),
      nqfLevel, institution: INST, issuers: [INST], category: 'general', difficulty: 'advanced',
      maxEnrollment, openEnrollment: true, status: 'active', tags: [TAG, 'IMSciences'],
      duration: durationMin,
      modules: [{
        title: 'Online Class Assessment',
        description: `${bank.length} questions · 1 mark each · ${durationMin} minutes · single attempt · random order`,
        type: 'quiz', order: 1, isFinalAssessment: true, duration: durationMin,
        quizQuestions: bank.map(q => ({ question: q.question, type: 'mcq', options: q.options, correctOption: q.correctOption, points: 1 })),
      }],
    });

    res.json({ courseId: training._id, title, subject, questionCount: bank.length, durationMin, maxEnrollment, links: links(training._id) });
  } catch (e) { next(e); }
});

// GET / — list upload-created assessments
router.get('/', authenticate, async (req, res, next) => {
  try {
    if (!staffGate(req, res)) return;
    const list = await Training.find({ tags: TAG }).sort({ createdAt: -1 });
    const out = [];
    for (const t of list) {
      const mod = (t.modules || []).find(m => m.isFinalAssessment && m.type === 'quiz');
      const submitted = await ExamAttempt.countDocuments({ training: t._id, status: 'submitted' });
      const started = await ExamAttempt.countDocuments({ training: t._id });
      out.push({
        courseId: t._id, title: t.title, subject: t.trade,
        questionCount: mod ? (mod.quizQuestions || []).length : 0,
        durationMin: mod?.duration || 30,
        maxEnrollment: t.maxEnrollment, enrolled: (t.enrollments || []).length,
        started, submitted, createdAt: t.createdAt, links: links(t._id),
      });
    }
    res.json({ count: out.length, courses: out });
  } catch (e) { next(e); }
});

// DELETE /:id — remove an assessment + its attempts
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    if (!staffGate(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const t = await Training.findById(req.params.id);
    if (!t || !(t.tags || []).includes(TAG)) return res.status(404).json({ error: 'Assessment not found.' });
    await ExamAttempt.deleteMany({ training: t._id });
    await Training.deleteOne({ _id: t._id });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
