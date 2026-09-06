/**
 * Timed online exam engine (IMSciences assessment system).
 * A course (Training) can hold several graded assessments (quiz modules: pre/mid/final/quiz).
 * Each is single-attempt, server-clocked, auto-closing, with optional open/close schedule.
 *
 * Routes are registered both course-level (default assessment) and per-assessment:
 *   GET  /:id[/a/:mid]                meta + this student's status
 *   POST /:id[/a/:mid]/start          begin/resume — shuffled questions, no answers
 *   POST /:id[/a/:mid]/submit         server scoring (points-weighted), returns marks only
 *   GET  /:id[/a/:mid]/result.pdf     this student's result slip
 *   GET  /:id[/a/:mid]/class-sheet.pdf  staff class results
 *   GET  /:id[/a/:mid]/results        staff JSON results
 *   GET  /:id/assessments             student's list of the course's assessments + status
 */
import express from 'express';
import { timingSafeEqual as cryptoTimingSafeEqual } from 'crypto';
import mongoose from 'mongoose';
import Training from '../models/Training.js';
import Worker from '../models/Worker.js';
import ExamAttempt from '../models/ExamAttempt.js';
import { authenticate } from '../middleware/auth.js';
import { generateExamResultPDF, generateClassSheetPDF } from '../services/resultsService.js';

const router = express.Router();
const STAFF = ['admin', 'institution', 'assessor', 'trainer'];
const isStaff = (u) => u && STAFF.includes(u.role);

function shuffle(n) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function shuffleArr(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const tagOf = (q) => ((q.competencyTag || 'General').trim() || 'General');
/**
 * Section-blocked randomised order: sections appear in random order, and the
 * questions inside each section are randomised, but a section's questions
 * always run together in one block.
 */
function sectionBlockedOrder(module) {
  const groups = new Map();
  module.quizQuestions.forEach((q, idx) => {
    const t = tagOf(q);
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t).push(idx);
  });
  const order = [];
  for (const tag of shuffleArr([...groups.keys()])) order.push(...shuffleArr(groups.get(tag)));
  return order;
}
function quizModules(training) {
  return (training.modules || []).filter(m => m.type === 'quiz' && (m.quizQuestions || []).length);
}
/** module by id, else the default assessment (final, else the only/first). */
function resolveModule(training, mid) {
  const mods = quizModules(training);
  if (mid) return mods.find(m => String(m._id) === String(mid)) || null;
  return mods.find(m => m.isFinalAssessment) || mods[0] || null;
}
function moduleDurationSec(module) {
  const min = (module && module.duration > 0) ? module.duration : 30;
  return Math.round(min * 60);
}
function moduleMarks(module) {
  return (module.quizQuestions || []).reduce((s, q) => s + (q.points > 0 ? q.points : 1), 0);
}
function remainingSec(attempt) {
  const elapsed = (Date.now() - new Date(attempt.startedAt).getTime()) / 1000;
  return Math.max(0, Math.round(attempt.durationSec - elapsed));
}
function scheduleState(module) {
  const now = Date.now();
  const opensAt = module.opensAt ? new Date(module.opensAt) : null;
  const closesAt = module.closesAt ? new Date(module.closesAt) : null;
  if (opensAt && opensAt.getTime() > now) return { state: 'upcoming', opensAt, closesAt };
  if (closesAt && closesAt.getTime() < now) return { state: 'closed', opensAt, closesAt };
  return { state: 'open', opensAt, closesAt };
}

/** resolve {training, module, worker}; auto-enrol if open & under cap. */
async function ctx(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) { res.status(400).json({ error: 'Invalid id' }); return null; }
  const training = await Training.findById(req.params.id);
  if (!training) { res.status(404).json({ error: 'Course not found' }); return null; }
  const module = resolveModule(training, req.params.mid);
  if (!module) { res.status(404).json({ error: 'No assessment configured for this course' }); return null; }
  const worker = await Worker.findOne({ user: req.user._id });
  if (!worker) { res.status(404).json({ error: 'Student profile not found' }); return null; }
  let enrolled = training.enrollments.some(e => e.worker?.toString() === worker._id.toString());
  if (!enrolled) {
    const upd = await Training.findOneAndUpdate(
      { _id: training._id, openEnrollment: true, $expr: { $lt: [{ $size: '$enrollments' }, { $ifNull: ['$maxEnrollment', 30] }] } },
      { $push: { enrollments: { worker: worker._id, progress: 0, status: 'in-progress' } } },
      { new: true },
    );
    if (!upd) { res.status(403).json({ error: 'You are not enrolled and the class is full or closed.' }); return null; }
  }
  return { training, module, worker };
}

/** Per learning-outcome (competencyTag) achievement for a submitted attempt. */
function topicStats(attempt, module) {
  const byDisplay = new Map((attempt.answers || []).filter(a => a && Number.isInteger(a.i)).map(a => [a.i, a.sel]));
  const acc = new Map();
  let correctCount = 0;
  for (let i = 0; i < attempt.order.length; i++) {
    const q = module.quizQuestions[attempt.order[i]];
    const tag = (q.competencyTag || 'General').trim() || 'General';
    if (!acc.has(tag)) acc.set(tag, { tag, correct: 0, total: 0 });
    const t = acc.get(tag);
    t.total += 1;
    const sel = byDisplay.get(i);
    if (sel != null && sel >= 0 && sel <= 3 && attempt.optPerm[i][sel] === q.correctOption) { t.correct += 1; correctCount += 1; }
  }
  const topics = [...acc.values()]
    .map(t => ({ ...t, pct: t.total ? Math.round((t.correct / t.total) * 100) : 0 }))
    .sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true }));
  return { topics, correctCount, answered: (attempt.answers || []).length };
}

async function scoreAndStore(attempt, module, answers, late) {
  const byDisplay = new Map((answers || []).filter(a => a && Number.isInteger(a.i)).map(a => [a.i, a.sel]));
  let score = 0, total = 0;
  for (let i = 0; i < attempt.order.length; i++) {
    const q = module.quizQuestions[attempt.order[i]];
    const pts = q.points > 0 ? q.points : 1;
    total += pts;
    const sel = byDisplay.get(i);
    if (sel != null && sel >= 0 && sel <= 3 && attempt.optPerm[i][sel] === q.correctOption) score += pts;
  }
  score = Math.round(score * 100) / 100; total = Math.round(total * 100) / 100;
  attempt.answers = (answers || []).filter(a => a && Number.isInteger(a.i)).map(a => ({ i: a.i, sel: a.sel }));
  attempt.score = score; attempt.total = total;
  attempt.status = 'submitted'; attempt.submittedAt = new Date(); attempt.lateSubmit = !!late;
  await attempt.save();
  return { score, total };
}

/* ── student handlers ─────────────────────────────────────────── */
async function metaHandler(req, res, next) {
  try {
    const c = await ctx(req, res); if (!c) return;
    const { training, module, worker } = c;
    const attempt = await ExamAttempt.findOne({ training: training._id, moduleId: module._id, worker: worker._id });
    const sched = scheduleState(module);
    const out = {
      courseId: training._id, assessmentId: module._id,
      className: training.title, institution: training.institution || '', title: module.title || 'Assessment',
      examType: module.examType || null, weightPct: module.weightPct || 0,
      totalQuestions: module.quizQuestions.length, totalMarks: moduleMarks(module),
      durationSec: moduleDurationSec(module),
      schedule: { state: sched.state, opensAt: sched.opensAt, closesAt: sched.closesAt },
      staff: isStaff(req.user),
      requiresPassword: !!(module.examPassword && module.examPassword.trim()),
      status: attempt ? attempt.status : 'not-started',
    };
    if (attempt) {
      out.remainingSec = attempt.status === 'submitted' ? 0 : remainingSec(attempt);
      if (attempt.status === 'submitted') { out.score = attempt.score; out.total = attempt.total; }
    }
    res.json(out);
  } catch (e) { next(e); }
}

async function startHandler(req, res, next) {
  try {
    const c = await ctx(req, res); if (!c) return;
    const { training, module, worker } = c;
    let attempt = await ExamAttempt.findOne({ training: training._id, moduleId: module._id, worker: worker._id });
    if (attempt && attempt.status === 'submitted') {
      return res.status(409).json({ error: 'You have already completed this assessment.', score: attempt.score, total: attempt.total });
    }
    // Password gate: required on every start/resume while the attempt is live.
    const requiredPwd = (module.examPassword || '').trim();
    if (requiredPwd) {
      const given = String(req.body?.password ?? '').trim();
      const a = Buffer.from(given), b = Buffer.from(requiredPwd);
      const ok = a.length === b.length && cryptoTimingSafeEqual(a, b);
      if (!ok) {
        return res.status(403).json({
          error: given ? 'Incorrect exam password.' : 'This exam is password protected. Enter the exam password to begin.',
          requiresPassword: true,
        });
      }
    }
    if (!attempt) {
      const sched = scheduleState(module);
      if (sched.state === 'upcoming') return res.status(403).json({ error: `This assessment opens ${new Date(sched.opensAt).toLocaleString()}.`, schedule: sched });
      if (sched.state === 'closed') return res.status(403).json({ error: `This assessment closed ${new Date(sched.closesAt).toLocaleString()}.`, schedule: sched });
      const order = sectionBlockedOrder(module);
      const optPerm = order.map(() => shuffle(4));
      attempt = await ExamAttempt.create({
        training: training._id, moduleId: module._id, worker: worker._id, user: req.user._id,
        studentName: worker.fullName, className: training.title,
        order, optPerm, durationSec: moduleDurationSec(module), startedAt: new Date(), status: 'in-progress', answers: [],
      });
    }
    if (remainingSec(attempt) <= 0) {
      await scoreAndStore(attempt, module, attempt.answers || [], true);
      return res.status(409).json({ error: 'Time is up for this assessment.', score: attempt.score, total: attempt.total });
    }
    const questions = attempt.order.map((origQ, i) => {
      const q = module.quizQuestions[origQ];
      return { i, question: q.question, options: attempt.optPerm[i].map(pos => q.options[pos]), section: tagOf(q) };
    });
    // sections in this student's display order, with case overview + counts
    const ovByTag = new Map((module.sections || []).map(s => [s.tag, s.overview || '']));
    const sections = [];
    for (const q of questions) {
      const last = sections[sections.length - 1];
      if (!last || last.tag !== q.section) sections.push({ tag: q.section, overview: ovByTag.get(q.section) || '', count: 1, startIndex: q.i });
      else last.count += 1;
    }
    res.json({
      className: training.title, title: module.title || 'Assessment', examType: module.examType || null,
      durationSec: attempt.durationSec, remainingSec: remainingSec(attempt), startedAt: attempt.startedAt,
      total: questions.length, questions, sections, maxSkips: 10,
      savedAnswers: (attempt.answers || []).map(a => ({ i: a.i, sel: a.sel })),
    });
  } catch (e) { next(e); }
}

/** Live answer autosave — answers are preserved server-side as the student works,
 *  so a crash or disconnection can no longer destroy an unfinished attempt. */
async function progressHandler(req, res, next) {
  try {
    const c = await ctx(req, res); if (!c) return;
    const { training, module, worker } = c;
    const attempt = await ExamAttempt.findOne({ training: training._id, moduleId: module._id, worker: worker._id });
    if (!attempt || attempt.status === 'submitted') return res.json({ ok: false });
    if (remainingSec(attempt) <= 0) return res.json({ ok: false, expired: true });
    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    attempt.answers = answers.filter(a => a && Number.isInteger(a.i)).map(a => ({ i: a.i, sel: a.sel })).slice(0, 500);
    await attempt.save();
    res.json({ ok: true, saved: attempt.answers.length, remainingSec: remainingSec(attempt) });
  } catch (e) { next(e); }
}

async function submitHandler(req, res, next) {
  try {
    const c = await ctx(req, res); if (!c) return;
    const { training, module, worker } = c;
    const attempt = await ExamAttempt.findOne({ training: training._id, moduleId: module._id, worker: worker._id });
    if (!attempt) return res.status(400).json({ error: 'No assessment in progress.' });
    if (attempt.status === 'submitted') return res.json({ score: attempt.score, total: attempt.total });
    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    const clamp = (n) => Math.max(0, Math.min(9999, Math.floor(Number(n) || 0)));
    const f = req.body?.flags || {};
    attempt.flags = { copy: clamp(f.copy), tabSwitch: clamp(f.tabSwitch), fullscreenExit: clamp(f.fullscreenExit) };
    if (Array.isArray(req.body?.flagEvents)) {
      attempt.flagEvents = req.body.flagEvents.slice(0, 200).filter(e => e && e.type)
        .map(e => ({ type: String(e.type).slice(0, 20), at: e.at ? new Date(e.at) : new Date() }));
    }
    const late = remainingSec(attempt) <= 0;
    const { score, total } = await scoreAndStore(attempt, module, answers, late);
    res.json({ score, total });
  } catch (e) { next(e); }
}

async function resultPdfHandler(req, res, next) {
  try {
    const c = await ctx(req, res); if (!c) return;
    const { training, module, worker } = c;
    const attempt = await ExamAttempt.findOne({ training: training._id, moduleId: module._id, worker: worker._id });
    if (!attempt || attempt.status !== 'submitted') return res.status(404).json({ error: 'No completed assessment to report.' });
    const stats = topicStats(attempt, module);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=result-${worker._id}.pdf`);
    generateExamResultPDF(res, {
      studentName: attempt.studentName || worker.fullName,
      className: `${training.title} — ${module.title || 'Assessment'}`,
      score: attempt.score, total: attempt.total,
      correctCount: stats.correctCount, answered: stats.answered,
      totalQuestions: module.quizQuestions.length, topics: stats.topics,
      submittedAt: attempt.submittedAt, credentialId: String(attempt._id),
      flags: attempt.flags || {}, org: training.institution || '',
    });
  } catch (e) { next(e); }
}

/* ── staff handlers (per assessment) ──────────────────────────── */
async function attemptRows(training, module) {
  const attempts = await ExamAttempt.find({ training: training._id, moduleId: module._id }).populate({ path: 'worker', select: 'fullName user', populate: { path: 'user', select: 'email' } });
  return attempts.map(a => {
    const fl = a.flags || {};
    const flags = { copy: fl.copy || 0, tabSwitch: fl.tabSwitch || 0, fullscreenExit: fl.fullscreenExit || 0 };
    const stats = a.status === 'submitted' ? topicStats(a, module) : { topics: [], correctCount: 0, answered: (a.answers || []).length };
    return {
      name: a.studentName || a.worker?.fullName || '—',
      email: a.worker?.user?.email || '',
      score: a.score, total: a.total,
      pct: a.total ? Math.round((a.score / a.total) * 100) : 0,
      correctCount: stats.correctCount, answered: stats.answered,
      totalQuestions: module.quizQuestions.length, topics: stats.topics,
      submittedAt: a.submittedAt, status: a.status,
      flags, violations: flags.copy + flags.tabSwitch + flags.fullscreenExit,
    };
  }).sort((x, y) => (x.name || '').localeCompare(y.name || ''));
}
async function staffCtx(req, res) {
  if (!isStaff(req.user)) { res.status(403).json({ error: 'Staff access required.' }); return null; }
  if (!mongoose.isValidObjectId(req.params.id)) { res.status(400).json({ error: 'Invalid id' }); return null; }
  const training = await Training.findById(req.params.id);
  if (!training) { res.status(404).json({ error: 'Course not found' }); return null; }
  const module = resolveModule(training, req.params.mid);
  if (!module) { res.status(404).json({ error: 'No assessment configured' }); return null; }
  return { training, module };
}
async function resultsJsonHandler(req, res, next) {
  try {
    const s = await staffCtx(req, res); if (!s) return;
    const rows = await attemptRows(s.training, s.module);
    res.json({ className: `${s.training.title} — ${s.module.title || 'Assessment'}`, count: rows.length, submitted: rows.filter(r => r.status === 'submitted').length, rows });
  } catch (e) { next(e); }
}
async function resultsXlsxHandler(req, res, next) {
  try {
    const s = await staffCtx(req, res); if (!s) return;
    const rows = await attemptRows(s.training, s.module);
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = s.training.institution || 'TalentLedger';
    const ws = wb.addWorksheet('Results');
    // union of learning-outcome tags in bank order
    const tagSet = [];
    for (const q of s.module.quizQuestions) {
      const t = (q.competencyTag || 'General').trim() || 'General';
      if (!tagSet.includes(t)) tagSet.push(t);
    }
    const totalMarks = moduleMarks(s.module);
    ws.columns = [
      { header: '#', key: 'idx', width: 5 },
      { header: 'Student', key: 'name', width: 28 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Answered', key: 'answered', width: 10 },
      { header: 'Correct', key: 'correct', width: 9 },
      { header: `Marks (of ${totalMarks})`, key: 'marks', width: 14 },
      { header: '%', key: 'pct', width: 8 },
      ...tagSet.map((t, i) => ({ header: t, key: `slo${i}`, width: 22 })),
      { header: 'Integrity flags', key: 'flags', width: 13 },
      { header: 'Submitted at', key: 'when', width: 20 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).alignment = { wrapText: true, vertical: 'middle' };
    rows.forEach((r, i) => {
      const rec = {
        idx: i + 1, name: r.name, email: r.email,
        status: r.status === 'submitted' ? 'Submitted' : (r.status === 'in-progress' ? 'In progress' : 'Not taken'),
        answered: r.status === 'submitted' ? `${r.answered}/${r.totalQuestions}` : '',
        correct: r.status === 'submitted' ? r.correctCount : '',
        marks: r.status === 'submitted' ? r.score : '',
        pct: r.status === 'submitted' ? r.pct / 100 : '',
        flags: r.status === 'submitted' ? r.violations : '',
        when: r.submittedAt ? new Date(r.submittedAt) : '',
      };
      tagSet.forEach((t, ti) => {
        const tp = r.topics.find(x => x.tag === t);
        rec[`slo${ti}`] = tp ? `${tp.correct}/${tp.total} (${tp.pct}%)` : '';
      });
      ws.addRow(rec);
    });
    ws.getColumn('pct').numFmt = '0%';
    // summary row
    const done = rows.filter(r => r.status === 'submitted');
    const sum = ws.addRow({
      name: `Submitted ${done.length}/${rows.length}`,
      marks: done.length ? Math.round((done.reduce((a, r) => a + r.score, 0) / done.length) * 100) / 100 : '',
      pct: done.length ? Math.round(done.reduce((a, r) => a + r.pct, 0) / done.length) / 100 : '',
    });
    sum.font = { bold: true };
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=results-${s.training._id}.xlsx`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { next(e); }
}

async function classSheetHandler(req, res, next) {
  try {
    const s = await staffCtx(req, res); if (!s) return;
    const rows = await attemptRows(s.training, s.module);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=results-${s.training._id}.pdf`);
    generateClassSheetPDF(res, { className: `${s.training.title} — ${s.module.title || 'Assessment'}`, generatedAt: new Date(), rows, org: s.training.institution || '' });
  } catch (e) { next(e); }
}

// list all active exam courses (for the LMS "Exams" tab)
router.get('/', authenticate, async (req, res, next) => {
  try {
    const worker = await Worker.findOne({ user: req.user._id });
    const list = await Training.find({ tags: 'online-exam', status: 'active' }).sort({ createdAt: -1 });
    const courses = list.map(t => {
      const mods = quizModules(t);
      return {
        courseId: t._id, title: t.title, subject: t.trade, institution: t.institution || '',
        assessments: mods.map(m => {
          const sched = scheduleState(m);
          return {
            assessmentId: m._id, title: m.title || 'Assessment', examType: m.examType || null,
            totalQuestions: (m.quizQuestions || []).length, durationMin: m.duration || 30,
            requiresPassword: !!(m.examPassword && m.examPassword.trim()),
            schedule: { state: sched.state, opensAt: sched.opensAt, closesAt: sched.closesAt },
          };
        }),
        enrolled: !!(worker && (t.enrollments || []).some(e => e.worker?.toString() === worker._id.toString())),
        enrolledCount: (t.enrollments || []).length, maxEnrollment: t.maxEnrollment || 30,
        openEnrollment: !!t.openEnrollment,
      };
    });
    res.json({ count: courses.length, courses, staff: isStaff(req.user) });
  } catch (e) { next(e); }
});

// student list of a course's assessments + their status
router.get('/:id/assessments', authenticate, async (req, res, next) => {
  try {
    const c = await ctx(req, res); if (!c) return;
    const { training, worker } = c;
    const mods = quizModules(training);
    const attempts = await ExamAttempt.find({ training: training._id, worker: worker._id });
    const byMod = new Map(attempts.map(a => [String(a.moduleId), a]));
    const items = mods.map(m => {
      const sched = scheduleState(m);
      const at = byMod.get(String(m._id));
      return {
        assessmentId: m._id, title: m.title || 'Assessment', examType: m.examType || null,
        totalQuestions: (m.quizQuestions || []).length, totalMarks: moduleMarks(m),
        durationMin: m.duration || 30, weightPct: m.weightPct || 0,
        requiresPassword: !!(m.examPassword && m.examPassword.trim()),
        schedule: { state: sched.state, opensAt: sched.opensAt, closesAt: sched.closesAt },
        status: at ? at.status : 'not-started',
        score: at && at.status === 'submitted' ? at.score : null,
        total: at && at.status === 'submitted' ? at.total : null,
      };
    });
    const materials = (training.materials || []).map(m => ({ name: m.name, url: m.url }));
    res.json({ courseId: training._id, className: training.title, institution: training.institution || '', subject: training.trade, staff: isStaff(req.user), assessments: items, materials });
  } catch (e) { next(e); }
});

/* register both course-level (default assessment) and per-assessment routes */
for (const p of ['/:id', '/:id/a/:mid']) {
  router.get(p, authenticate, metaHandler);
  router.post(`${p}/start`, authenticate, startHandler);
  router.post(`${p}/progress`, authenticate, progressHandler);
  router.post(`${p}/submit`, authenticate, submitHandler);
  router.get(`${p}/result.pdf`, authenticate, resultPdfHandler);
  router.get(`${p}/results`, authenticate, resultsJsonHandler);
  router.get(`${p}/results.xlsx`, authenticate, resultsXlsxHandler);
  router.get(`${p}/class-sheet.pdf`, authenticate, classSheetHandler);
}

export default router;
