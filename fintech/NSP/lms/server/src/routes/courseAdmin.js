/**
 * course-admin — staff manage courses, their weighted assessments, materials,
 * gradebook, attendance and downloadable marksheets. Mounted /api/v1/courses.
 */
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import Training from '../models/Training.js';
import ExamAttempt from '../models/ExamAttempt.js';
import { authenticate } from '../middleware/auth.js';
import { parseMcqFile } from '../services/mcqParser.js';
import { computeGradebook, generateGradebookPDF, generateTranscriptPDF, gradebookCsv, attendanceCsv } from '../services/gradebookService.js';
import { PUBLIC_BASE } from '../config/identity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Course materials live in a dedicated PUBLIC subfolder served at /course-materials
// (handouts for enrolled students — no auth on the file itself).
const MAT_DIR = path.join(__dirname, '../../uploads/course-materials');
try { fs.mkdirSync(MAT_DIR, { recursive: true }); } catch { /* ignore */ }

const router = express.Router();
const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
// Course-material types only — never .html/.svg/.js/.htm etc., which would be
// served same-origin and could run script against logged-in users.
const MAT_ALLOWED = /\.(pdf|docx?|xlsx?|pptx?|txt|csv|jpe?g|png|webp|gif|mp4|webm|mov|mp3|zip)$/i;
const diskUpload = multer({
  storage: multer.diskStorage({
    destination: MAT_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
      cb(null, `mat-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!MAT_ALLOWED.test(file.originalname)) return cb(new Error(`File type not allowed: ${path.extname(file.originalname)}`));
    cb(null, true);
  },
});

const STAFF = ['admin', 'institution', 'assessor', 'trainer'];
const isStaff = (u) => u && STAFF.includes(u.role);
const TAG = 'online-exam';
const INST = 'Institute of Management Sciences (IMSciences)';
const TYPES = ['pre', 'mid', 'final', 'quiz', 'assignment'];
const TYPE_TITLE = { pre: 'Pre-test', mid: 'Mid-term', final: 'Final', quiz: 'Quiz', assignment: 'Assignment' };
const clamp = (v, lo, hi, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const parseDate = (v) => { if (!v) return undefined; const d = new Date(v); return isNaN(d) ? undefined : d; };
const gate = (req, res) => { if (!isStaff(req.user)) { res.status(403).json({ error: 'Staff access required.' }); return false; } return true; };
const B = () => PUBLIC_BASE;
const links = (id) => ({ join: `${B()}/join/${id}?next=/course/${id}`, course: `${B()}/course/${id}`, results: `${B()}/course/${id}/results` });
const qmods = (t) => (t.modules || []).filter(m => m.type === 'quiz' && (m.quizQuestions || []).length);
const marksOf = (m) => (m.quizQuestions || []).reduce((s, q) => s + (q.points > 0 ? q.points : 1), 0);
const dto = (m) => ({ assessmentId: String(m._id), title: m.title, examType: m.examType || 'quiz', weightPct: m.weightPct || 0, durationMin: m.duration || 30, questionCount: (m.quizQuestions || []).length, totalMarks: marksOf(m), opensAt: m.opensAt || null, closesAt: m.closesAt || null, examPassword: m.examPassword || '', hasPassword: !!(m.examPassword && m.examPassword.trim()), examLink: `${B()}/exam/${'CID'}/a/${m._id}` });

/* ── courses ──────────────────────────────────────────────────── */
router.get('/', authenticate, async (req, res, next) => {
  try {
    if (!gate(req, res)) return;
    const list = await Training.find({ tags: TAG }).sort({ createdAt: -1 });
    const out = [];
    for (const t of list) {
      const submitted = await ExamAttempt.countDocuments({ training: t._id, status: 'submitted' });
      out.push({ courseId: t._id, title: t.title, subject: t.trade, institution: t.institution || '', assessments: qmods(t).length, enrolled: (t.enrollments || []).length, maxEnrollment: t.maxEnrollment, submitted, materials: (t.materials || []).length, createdAt: t.createdAt, links: links(t._id) });
    }
    res.json({ count: out.length, courses: out });
  } catch (e) { next(e); }
});

router.post('/', authenticate, async (req, res, next) => {
  try {
    if (!gate(req, res)) return;
    const title = (req.body.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Enter a course / class name.' });
    const institution = (req.body.institution || '').trim().slice(0, 120);
    const t = await Training.create({
      title, trade: (req.body.subject || 'Assessment').trim(), description: (req.body.description || '').slice(0, 2000),
      nqfLevel: clamp(req.body.nqfLevel, 1, 8, 6), institution, issuers: institution ? [institution] : [], category: 'general', difficulty: 'advanced',
      maxEnrollment: clamp(req.body.maxEnrollment, 1, 1000, 30), openEnrollment: true, status: 'active', tags: [TAG], duration: 30, modules: [], materials: [],
    });
    res.json({ courseId: t._id, title, links: links(t._id) });
  } catch (e) { next(e); }
});

router.get('/:id', authenticate, async (req, res, next) => {
  try {
    if (!gate(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const t = await Training.findById(req.params.id);
    if (!t) return res.status(404).json({ error: 'Course not found' });
    const mods = qmods(t);
    const assessments = [];
    for (const m of mods) {
      const submitted = await ExamAttempt.countDocuments({ training: t._id, moduleId: m._id, status: 'submitted' });
      assessments.push({ ...dto(m), examLink: `${B()}/exam/${t._id}/a/${m._id}`, submitted });
    }
    res.json({
      courseId: t._id, title: t.title, subject: t.trade, institution: t.institution || '', enrolled: (t.enrollments || []).length, maxEnrollment: t.maxEnrollment,
      totalWeight: mods.reduce((s, m) => s + (m.weightPct || 0), 0),
      assessments, materials: (t.materials || []).map((x, i) => ({ idx: i, name: x.name, url: x.url, size: x.size, uploadedAt: x.uploadedAt })),
      links: links(t._id),
    });
  } catch (e) { next(e); }
});

router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    if (!gate(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const t = await Training.findById(req.params.id);
    if (!t || !(t.tags || []).includes(TAG)) return res.status(404).json({ error: 'Course not found' });
    await ExamAttempt.deleteMany({ training: t._id });
    await Training.deleteOne({ _id: t._id });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.patch('/:id', authenticate, async (req, res, next) => {
  try {
    if (!gate(req, res)) return;
    const t = await Training.findById(req.params.id);
    if (!t || !(t.tags || []).includes(TAG)) return res.status(404).json({ error: 'Course not found' });
    if (req.body.title != null) t.title = String(req.body.title).slice(0, 300);
    if (req.body.subject != null) t.trade = String(req.body.subject).slice(0, 120);
    if (req.body.institution != null) { t.institution = String(req.body.institution).slice(0, 120); t.issuers = t.institution ? [t.institution] : []; }
    if (req.body.maxEnrollment != null) t.maxEnrollment = clamp(req.body.maxEnrollment, 1, 1000, t.maxEnrollment);
    await t.save();
    res.json({ ok: true, institution: t.institution || '' });
  } catch (e) { next(e); }
});

/* ── assessments ──────────────────────────────────────────────── */
router.post('/:id/assessment', authenticate, memUpload.single('file'), async (req, res, next) => {
  try {
    if (!gate(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const t = await Training.findById(req.params.id);
    if (!t) return res.status(404).json({ error: 'Course not found' });
    if (!req.file) return res.status(400).json({ error: 'Upload an MCQ file (.docx, .txt or .csv).' });
    let bank;
    try { bank = await parseMcqFile(req.file.buffer, req.file.originalname || '', req.file.mimetype || ''); }
    catch (e) { return res.status(422).json({ error: 'Could not read the file: ' + e.message }); }
    const examType = TYPES.includes(req.body.examType) ? req.body.examType : 'quiz';
    const marksPerQ = num(req.body.marksPerQuestion, 1) > 0 ? num(req.body.marksPerQuestion, 1) : 1;
    const durationMin = clamp(req.body.durationMin, 1, 240, 30);
    const weightPct = Math.max(0, Math.min(100, num(req.body.weightPct, 0)));
    const title = (req.body.title || '').trim() || TYPE_TITLE[examType];
    t.modules.push({
      title, description: `${bank.length} questions · ${durationMin} min · single attempt · random order`,
      type: 'quiz', order: (t.modules || []).length + 1, isFinalAssessment: examType === 'final', isPreAssessment: examType === 'pre',
      examType, weightPct, duration: durationMin, opensAt: parseDate(req.body.opensAt), closesAt: parseDate(req.body.closesAt),
      examPassword: String(req.body.examPassword || '').trim().slice(0, 64),
      sections: (bank.sections || []).filter(s => s && s.tag),
      quizQuestions: bank.map(q => ({ question: q.question, type: 'mcq', options: q.options, correctOption: q.correctOption, points: marksPerQ, competencyTag: q.topic || '' })),
    });
    await t.save();
    const saved = t.modules[t.modules.length - 1];
    res.json({ ...dto(saved), examLink: `${B()}/exam/${t._id}/a/${saved._id}`, submitted: 0 });
  } catch (e) { next(e); }
});

router.patch('/:id/assessment/:mid', authenticate, async (req, res, next) => {
  try {
    if (!gate(req, res)) return;
    const t = await Training.findById(req.params.id);
    if (!t) return res.status(404).json({ error: 'Course not found' });
    const m = t.modules.id(req.params.mid);
    if (!m) return res.status(404).json({ error: 'Assessment not found' });
    if (req.body.title != null) m.title = String(req.body.title).slice(0, 200);
    if (TYPES.includes(req.body.examType)) { m.examType = req.body.examType; m.isFinalAssessment = req.body.examType === 'final'; m.isPreAssessment = req.body.examType === 'pre'; }
    if (req.body.weightPct != null) m.weightPct = Math.max(0, Math.min(100, num(req.body.weightPct, m.weightPct)));
    if (req.body.durationMin != null) m.duration = clamp(req.body.durationMin, 1, 240, m.duration);
    if ('opensAt' in req.body) m.opensAt = parseDate(req.body.opensAt) || null;
    if ('closesAt' in req.body) m.closesAt = parseDate(req.body.closesAt) || null;
    if ('examPassword' in req.body) m.examPassword = String(req.body.examPassword || '').trim().slice(0, 64);
    await t.save();
    res.json(dto(m));
  } catch (e) { next(e); }
});

router.delete('/:id/assessment/:mid', authenticate, async (req, res, next) => {
  try {
    if (!gate(req, res)) return;
    const t = await Training.findById(req.params.id);
    if (!t) return res.status(404).json({ error: 'Course not found' });
    const m = t.modules.id(req.params.mid);
    if (!m) return res.status(404).json({ error: 'Assessment not found' });
    await ExamAttempt.deleteMany({ training: t._id, moduleId: m._id });
    t.modules.pull(req.params.mid);
    await t.save();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ── materials ────────────────────────────────────────────────── */
router.post('/:id/material', authenticate, diskUpload.single('file'), async (req, res, next) => {
  try {
    if (!gate(req, res)) { if (req.file) fs.unlink(req.file.path, () => {}); return; }
    const t = await Training.findById(req.params.id);
    if (!t) { if (req.file) fs.unlink(req.file.path, () => {}); return res.status(404).json({ error: 'Course not found' }); }
    if (!req.file) return res.status(400).json({ error: 'Choose a file to upload.' });
    const mat = { name: (req.body.name || req.file.originalname).slice(0, 200), url: `/api/uploads/course-materials/${req.file.filename}`, size: req.file.size, uploadedAt: new Date() };
    t.materials.push(mat);
    await t.save();
    res.json(mat);
  } catch (e) { next(e); }
});

router.delete('/:id/material/:idx', authenticate, async (req, res, next) => {
  try {
    if (!gate(req, res)) return;
    const t = await Training.findById(req.params.id);
    if (!t) return res.status(404).json({ error: 'Course not found' });
    const i = parseInt(req.params.idx, 10);
    if (!(i >= 0 && i < (t.materials || []).length)) return res.status(404).json({ error: 'Material not found' });
    t.materials.splice(i, 1);
    await t.save();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ── gradebook / attendance / marksheets ──────────────────────── */
router.get('/:id/gradebook', authenticate, async (req, res, next) => {
  try { if (!gate(req, res)) return; const gb = await computeGradebook(req.params.id); if (!gb) return res.status(404).json({ error: 'Course not found' }); res.json(gb); } catch (e) { next(e); }
});
router.get('/:id/gradebook.pdf', authenticate, async (req, res, next) => {
  try { if (!gate(req, res)) return; const gb = await computeGradebook(req.params.id); if (!gb) return res.status(404).json({ error: 'Course not found' }); res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename=gradebook-${gb.courseId}.pdf`); generateGradebookPDF(res, gb); } catch (e) { next(e); }
});
router.get('/:id/gradebook.csv', authenticate, async (req, res, next) => {
  try { if (!gate(req, res)) return; const gb = await computeGradebook(req.params.id); if (!gb) return res.status(404).json({ error: 'Course not found' }); res.setHeader('Content-Type', 'text/csv'); res.setHeader('Content-Disposition', `attachment; filename=gradebook-${gb.courseId}.csv`); res.send(gradebookCsv(gb)); } catch (e) { next(e); }
});
router.get('/:id/attendance.csv', authenticate, async (req, res, next) => {
  try { if (!gate(req, res)) return; const gb = await computeGradebook(req.params.id); if (!gb) return res.status(404).json({ error: 'Course not found' }); res.setHeader('Content-Type', 'text/csv'); res.setHeader('Content-Disposition', `attachment; filename=attendance-${gb.courseId}.csv`); res.send(attendanceCsv(gb)); } catch (e) { next(e); }
});
router.get('/:id/transcript/:wid', authenticate, async (req, res, next) => {
  try {
    if (!gate(req, res)) return;
    const gb = await computeGradebook(req.params.id); if (!gb) return res.status(404).json({ error: 'Course not found' });
    const st = gb.students.find(s => s.workerId === req.params.wid); if (!st) return res.status(404).json({ error: 'Student not found' });
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename=transcript-${st.workerId}.pdf`);
    generateTranscriptPDF(res, gb, st);
  } catch (e) { next(e); }
});

export default router;
