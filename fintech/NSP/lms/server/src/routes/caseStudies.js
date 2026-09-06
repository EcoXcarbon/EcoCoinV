import { Router } from 'express';
import { body, param } from 'express-validator';
import crypto from 'crypto';
import CaseStudy from '../models/CaseStudy.js';
import CaseAttempt from '../models/CaseAttempt.js';
import CaseParticipant from '../models/CaseParticipant.js';
import CaseCertificate from '../models/CaseCertificate.js';
import { authenticate } from '../middleware/auth.js';
import { handleValidation } from '../middleware/validate.js';
import { sendPrompt, parseAIJson } from '../services/aiService.js';

const router = Router();

// The two graduate-level courses. Titles are the proper course names and are
// used verbatim on the leaderboard and the completion certificate.
const COURSES = {
  MA: 'Mergers & Acquisitions',
  ACF: 'Advanced Corporate Finance',
};
const COURSE_LEVEL = 'Graduate-Level Course';

const WORD_LIMIT = 100;
const STALE_GRADE_MS = 4 * 60 * 1000;   // a grade still 'grading' after this is re-kicked
const GRADE_TIMEOUT_MS = 175000;        // background grading may wait longer than a sync request
const GRADE_MODEL = 'haiku';            // fast tier for grading — see gradeAttempt
const GRADE_MAX_TRIES = 10;             // retry a busy/transient relay before failing (~class-sized queue)
const GRADE_RETRY_MS = 18000;           // base backoff between grade attempts (+ jitter)
const VALID_BANDS = ['Distinction', 'Merit', 'Pass', 'Developing'];
const wordCount = (s) => (s || '').trim().split(/\s+/).filter(Boolean).length;
const stripHtml = (h) => (h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const bandFor = (score) =>
  score >= 80 ? 'Distinction' : score >= 65 ? 'Merit' : score >= 50 ? 'Pass' : 'Developing';

/* ─── Relative marking helpers ─────────────────────────────────────────────
   The AI marks each attempt on merit (rawScore 0..100). The *relative* mark is
   this attempt's percentile within the pool of all attempts on the same case:
   percentile = share of peers scoring at or below you. */
function percentileOf(score, pool) {
  if (!pool.length) return 100;
  const atOrBelow = pool.filter((s) => s <= score).length;
  return Math.round((atOrBelow / pool.length) * 100);
}

/* ─── Course completion → certificate ──────────────────────────────────────
   A course is "completed" when the student has a graded attempt for every
   active case in it. Completing it awards a certificate (one per student per
   course). Read-only for attempt data — only ever inserts a certificate. */
async function courseProgress(userId, course) {
  const [totalCases, graded] = await Promise.all([
    CaseStudy.countDocuments({ course, active: true }),
    CaseAttempt.find({ student: userId, course, status: 'graded' }).select('rawScore').lean(),
  ]);
  const casesCompleted = graded.length;
  const cumulativeScore = graded.reduce((s, a) => s + (a.rawScore || 0), 0);
  const averageScore = casesCompleted ? Math.round(cumulativeScore / casesCompleted) : 0;
  return { totalCases, casesCompleted, cumulativeScore, averageScore, completed: totalCases > 0 && casesCompleted >= totalCases };
}

async function issueCertificateIfComplete(user, participant, course) {
  const p = await courseProgress(user._id, course);
  if (!p.completed) return { eligible: false, ...p };
  const band = p.averageScore >= 80 ? 'Distinction' : p.averageScore >= 65 ? 'Merit' : 'Pass';
  // Idempotent: only inserts on first completion; never overwrites an issued cert.
  const cert = await CaseCertificate.findOneAndUpdate(
    { student: user._id, course },
    { $setOnInsert: {
      certificateId: `TLC-${course}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
      courseTitle: COURSES[course], level: COURSE_LEVEL,
      studentName: participant?.fullName || user.name, studentId: participant?.studentId || '',
      casesCompleted: p.casesCompleted, totalCases: p.totalCases,
      cumulativeScore: p.cumulativeScore, averageScore: p.averageScore, band, issuedAt: new Date(),
    } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return { eligible: true, certificate: cert, ...p };
}

// ── Public certificate verification (no auth). 3-segment path — no route clash. ──
router.get('/certificate/verify/:certificateId', async (req, res, next) => {
  try {
    const cert = await CaseCertificate.findOne({ certificateId: req.params.certificateId }).lean();
    if (!cert) return res.status(404).json({ valid: false, error: 'Certificate not found' });
    res.json({
      valid: true,
      certificateId: cert.certificateId,
      studentName: cert.studentName,
      course: COURSES[cert.course] || cert.courseTitle,
      level: cert.level || COURSE_LEVEL,
      band: cert.band, averageScore: cert.averageScore,
      casesCompleted: cert.casesCompleted, totalCases: cert.totalCases,
      issuedAt: cert.issuedAt,
    });
  } catch (err) { next(err); }
});

// ── Everything below requires a registered, logged-in student ──
router.use(authenticate);

// GET /api/v1/cases — overview of both case courses + my accumulative progress
router.get('/', async (req, res, next) => {
  try {
    const [cases, myAttempts, participant, myCerts] = await Promise.all([
      CaseStudy.find({ active: true }).select('course code').lean(),
      CaseAttempt.find({ student: req.user._id }).select('course rawScore status').lean(),
      CaseParticipant.findOne({ user: req.user._id }).lean(),
      CaseCertificate.find({ student: req.user._id }).select('course certificateId band averageScore issuedAt').lean(),
    ]);
    const certByCourse = new Map(myCerts.map((c) => [c.course, c]));
    const out = [];
    for (const [key, title] of Object.entries(COURSES)) {
      const total = cases.filter((c) => c.course === key).length;
      const mine = myAttempts.filter((a) => a.course === key);
      const graded = mine.filter((a) => a.status === 'graded');
      const cumScore = graded.reduce((s, a) => s + (a.rawScore || 0), 0);
      const completed = total > 0 && graded.length >= total;
      // Auto-issue the certificate the moment a course is fully completed.
      let cert = certByCourse.get(key);
      if (completed && !cert && participant) {
        const r = await issueCertificateIfComplete(req.user, participant, key);
        cert = r.certificate;
      }
      out.push({
        course: key,
        title,
        level: COURSE_LEVEL,
        totalCases: total,
        attempted: mine.length,
        completedCases: graded.length,
        remaining: total - graded.length,
        cumulativeScore: cumScore,
        averageScore: graded.length ? Math.round(cumScore / graded.length) : null,
        completed,
        certificate: cert ? { certificateId: cert.certificateId, band: cert.band, averageScore: cert.averageScore, issuedAt: cert.issuedAt } : null,
      });
    }
    res.json({
      registered: !!participant,
      participant: participant ? { fullName: participant.fullName, studentId: participant.studentId, program: participant.program } : null,
      courses: out,
    });
  } catch (err) { next(err); }
});

// GET /api/v1/cases/me/registration — my case-programme registration (or null)
router.get('/me/registration', async (req, res, next) => {
  try {
    const p = await CaseParticipant.findOne({ user: req.user._id }).lean();
    res.json({ registered: !!p, participant: p || null });
  } catch (err) { next(err); }
});

// POST /api/v1/cases/register — one-time registration before starting cases
router.post('/register', [
  body('fullName').trim().isLength({ min: 2, max: 120 }).withMessage('Please enter your full name.'),
  body('studentId').optional().trim().isLength({ max: 60 }),
  body('program').optional().trim().isLength({ max: 120 }),
  handleValidation,
], async (req, res, next) => {
  try {
    const { fullName, studentId, program } = req.body;
    const p = await CaseParticipant.findOneAndUpdate(
      { user: req.user._id },
      { $set: { fullName, studentId: studentId || '', program: program || '', email: req.user.email },
        $setOnInsert: { registeredAt: new Date() } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    res.status(201).json({ registered: true, participant: { fullName: p.fullName, studentId: p.studentId, program: p.program } });
  } catch (err) { next(err); }
});

// GET /api/v1/cases/me/progress — my accumulative record across both courses
router.get('/me/progress', async (req, res, next) => {
  try {
    const attempts = await CaseAttempt.find({ student: req.user._id })
      .sort('-createdAt')
      .select('course code caseStudy rawScore ai.band gradedAt status')
      .populate('caseStudy', 'title week')
      .lean();
    const byCourse = {};
    for (const a of attempts) {
      const k = a.course;
      byCourse[k] = byCourse[k] || { course: k, title: COURSES[k], cumulativeScore: 0, casesDone: 0, attempts: [] };
      if (a.status === 'graded') {
        byCourse[k].cumulativeScore += a.rawScore || 0;
        byCourse[k].casesDone += 1;
      }
      byCourse[k].attempts.push({
        code: a.code, title: a.caseStudy?.title, week: a.caseStudy?.week, status: a.status,
        rawScore: a.status === 'graded' ? a.rawScore : null, band: a.status === 'graded' ? a.ai?.band : null, gradedAt: a.gradedAt,
      });
    }
    res.json({ courses: Object.values(byCourse) });
  } catch (err) { next(err); }
});

// GET /api/v1/cases/:course/leaderboard — accumulative student ladder
// (defined before /:course/:code so "leaderboard" isn't read as a case code)
router.get('/:course/leaderboard', [
  param('course').isIn(Object.keys(COURSES)),
  handleValidation,
], async (req, res, next) => {
  try {
    const { course } = req.params;
    const rows = await CaseAttempt.aggregate([
      { $match: { course, status: 'graded' } },
      { $group: {
        _id: '$student',
        studentName: { $last: '$studentName' },
        cumulativeScore: { $sum: '$rawScore' },
        casesDone: { $sum: 1 },
        bestScore: { $max: '$rawScore' },
      } },
      { $sort: { cumulativeScore: -1, casesDone: -1 } },
      { $limit: 100 },
    ]);
    const ladder = rows.map((r, i) => ({
      rank: i + 1,
      student: r._id,
      studentName: r.studentName || 'Student',
      cumulativeScore: Math.round(r.cumulativeScore),
      casesDone: r.casesDone,
      averageScore: Math.round(r.cumulativeScore / r.casesDone),
      bestScore: Math.round(r.bestScore),
      isMe: String(r._id) === String(req.user._id),
    }));
    res.json({ course, title: COURSES[course], ladder });
  } catch (err) { next(err); }
});

// GET /api/v1/cases/:course/certificate — completion status + certificate (issues on completion)
// Defined before /:course/:code so "certificate" isn't read as a case code.
router.get('/:course/certificate', [
  param('course').isIn(Object.keys(COURSES)),
  handleValidation,
], async (req, res, next) => {
  try {
    const { course } = req.params;
    const participant = await CaseParticipant.findOne({ user: req.user._id }).lean();
    const result = await issueCertificateIfComplete(req.user, participant, course);
    res.json({
      course, title: COURSES[course], level: COURSE_LEVEL,
      eligible: result.eligible,
      totalCases: result.totalCases, casesCompleted: result.casesCompleted,
      remaining: result.totalCases - result.casesCompleted,
      averageScore: result.averageScore, cumulativeScore: result.cumulativeScore,
      certificate: result.certificate ? {
        certificateId: result.certificate.certificateId,
        studentName: result.certificate.studentName,
        studentId: result.certificate.studentId,
        band: result.certificate.band,
        averageScore: result.certificate.averageScore,
        casesCompleted: result.certificate.casesCompleted,
        totalCases: result.certificate.totalCases,
        issuedAt: result.certificate.issuedAt,
      } : null,
    });
  } catch (err) { next(err); }
});

// GET /api/v1/cases/:course — list cases in a course with my lock/score status
router.get('/:course', [
  param('course').isIn(Object.keys(COURSES)),
  handleValidation,
], async (req, res, next) => {
  try {
    const { course } = req.params;
    const [cases, mine] = await Promise.all([
      CaseStudy.find({ course, active: true }).sort('order').select('code week title subtitle').lean(),
      CaseAttempt.find({ student: req.user._id, course }).select('caseStudy rawScore ai.band gradedAt status').lean(),
    ]);
    const byCase = new Map(mine.map((a) => [String(a.caseStudy), a]));
    const list = cases.map((c) => {
      const a = byCase.get(String(c._id));
      return {
        id: c._id, code: c.code, week: c.week, title: c.title, subtitle: c.subtitle,
        locked: !!a,                              // attempted → locked, no re-entry
        status: a ? a.status : null,              // grading | graded | failed
        rawScore: a && a.status === 'graded' ? a.rawScore : null,
        band: a && a.status === 'graded' ? a.ai?.band : null,
        gradedAt: a ? a.gradedAt : null,
      };
    });
    res.json({ course, title: COURSES[course], cases: list });
  } catch (err) { next(err); }
});

// GET /api/v1/cases/:course/:code — read a case, or (if already attempted) my locked result
router.get('/:course/:code', [
  param('course').isIn(Object.keys(COURSES)),
  handleValidation,
], async (req, res, next) => {
  try {
    const { course, code } = req.params;
    const cs = await CaseStudy.findOne({ course, code, active: true }).lean();
    if (!cs) return res.status(404).json({ error: 'Case not found' });

    const attempt = await CaseAttempt.findOne({ student: req.user._id, caseStudy: cs._id }).lean();
    if (attempt) {
      // A grade that got stuck (server restart mid-grade, transient relay error)
      // is auto-recovered when the student re-opens the case.
      const stale = attempt.status === 'grading' && attempt.gradeStartedAt &&
        (Date.now() - new Date(attempt.gradeStartedAt).getTime() > STALE_GRADE_MS);
      if (stale || attempt.status === 'failed') gradeAttempt(attempt._id).catch(() => {});

      // Locked — return the graded result (or its grading/failed status), never the blank form again.
      const pool = (await CaseAttempt.find({ caseStudy: cs._id, status: 'graded' }).select('rawScore').lean()).map((x) => x.rawScore);
      return res.json({
        locked: true,
        case: { id: cs._id, code: cs.code, week: cs.week, title: cs.title, subtitle: cs.subtitle, contentHtml: cs.contentHtml, questions: cs.questions },
        attempt: {
          ...attempt,
          relativeScore: attempt.status === 'graded' ? percentileOf(attempt.rawScore, pool) : null,
          peers: pool.length,
        },
      });
    }
    res.json({
      locked: false,
      case: {
        id: cs._id, code: cs.code, week: cs.week, title: cs.title, subtitle: cs.subtitle,
        contentHtml: cs.contentHtml, questions: cs.questions,
      },
      wordLimit: WORD_LIMIT,
    });
  } catch (err) { next(err); }
});

// POST /api/v1/cases/:course/:code/submit — grade on merit via Claude relay, then lock
router.post('/:course/:code/submit', [
  param('course').isIn(Object.keys(COURSES)),
  body('answers').isArray({ min: 3, max: 6 }),
  handleValidation,
], async (req, res, next) => {
  try {
    const { course, code } = req.params;
    const cs = await CaseStudy.findOne({ course, code, active: true });
    if (!cs) return res.status(404).json({ error: 'Case not found' });

    // Must be registered for the case programme before submitting.
    const participant = await CaseParticipant.findOne({ user: req.user._id }).lean();
    if (!participant) return res.status(403).json({ error: 'Please complete your registration before submitting.', code: 'NOT_REGISTERED' });

    // Hard lock: one attempt per student per case.
    const existing = await CaseAttempt.findOne({ student: req.user._id, caseStudy: cs._id }).lean();
    if (existing) return res.status(409).json({ error: 'You have already completed this case. It is locked.', locked: true });

    // Normalise answers to strings aligned with the questions.
    const raw = req.body.answers.map((a) => (typeof a === 'string' ? a : a?.answer || ''));
    if (raw.length !== cs.questions.length) {
      return res.status(400).json({ error: `Please answer all ${cs.questions.length} questions.` });
    }
    const blanks = raw.map((a, i) => (a.trim().length < 3 ? i + 1 : null)).filter(Boolean);
    if (blanks.length) return res.status(400).json({ error: `Answer(s) ${blanks.join(', ')} are empty.` });
    const overLimit = raw.map((a, i) => (wordCount(a) > WORD_LIMIT ? i + 1 : null)).filter(Boolean);
    if (overLimit.length) return res.status(400).json({ error: `Answer(s) ${overLimit.join(', ')} exceed the ${WORD_LIMIT}-word limit.` });

    // Persist the attempt in 'grading' state FIRST — this locks the case instantly
    // (one attempt per student) and means the student never waits on the slow relay.
    let attempt;
    try {
      attempt = await CaseAttempt.create({
        student: req.user._id,
        studentName: participant.fullName || req.user.name,
        caseStudy: cs._id,
        course,
        code: cs.code,
        answers: cs.questions.map((q, i) => ({ question: q, answer: raw[i] })),
        status: 'grading',
        gradeStartedAt: new Date(),
        rawScore: 0,
        locked: true,
      });
    } catch (err) {
      if (err?.code === 11000) return res.status(409).json({ error: 'You have already completed this case. It is locked.', locked: true });
      throw err;
    }

    // Grade in the background — do NOT await, so the request returns immediately.
    gradeAttempt(attempt._id).catch(() => {});

    res.status(202).json({ locked: true, status: 'grading', attempt: { _id: attempt._id, status: 'grading' } });
  } catch (err) { next(err); }
});

// POST /api/v1/cases/:course/:code/regrade — retry grading a stuck/failed attempt
// (re-runs the AI on the SAME submitted answers; the student does not re-answer).
router.post('/:course/:code/regrade', [
  param('course').isIn(Object.keys(COURSES)),
  handleValidation,
], async (req, res, next) => {
  try {
    const cs = await CaseStudy.findOne({ course: req.params.course, code: req.params.code, active: true });
    if (!cs) return res.status(404).json({ error: 'Case not found' });
    const attempt = await CaseAttempt.findOne({ student: req.user._id, caseStudy: cs._id });
    if (!attempt) return res.status(404).json({ error: 'No submission to grade for this case.' });
    if (attempt.status === 'graded') return res.json({ status: 'graded' });
    gradeAttempt(attempt._id).catch(() => {});
    res.status(202).json({ status: 'grading' });
  } catch (err) { next(err); }
});

/* ─── Background grading ───────────────────────────────────────────────────
   Runs detached from the HTTP request. Loads the attempt, calls the relay with
   a generous timeout, and writes back graded/failed. Failures are retryable via
   the /regrade endpoint or auto-recovered when the student re-opens the case.
   A tiny in-process guard prevents double-grading the same attempt at once. */
const gradingInFlight = new Set();
async function gradeAttempt(attemptId) {
  const key = String(attemptId);
  if (gradingInFlight.has(key)) return;
  gradingInFlight.add(key);
  try {
    const attempt = await CaseAttempt.findById(attemptId);
    if (!attempt || attempt.status === 'graded') return;
    const cs = await CaseStudy.findById(attempt.caseStudy);
    if (!cs) { await CaseAttempt.updateOne({ _id: attemptId }, { $set: { status: 'failed', gradeError: 'Case not found' } }); return; }

    await CaseAttempt.updateOne({ _id: attemptId }, { $set: { status: 'grading', gradeStartedAt: new Date(), gradeError: null } });
    const raw = attempt.answers.map((a) => a.answer);
    const prompt = buildGradingPrompt(cs, raw);

    // The relay caps concurrent grades (busy → 429), so when a whole class submits
    // together the first few win and the rest would otherwise fail instantly. Retry
    // with backoff so a busy/transient relay just queues the grade instead of failing.
    // Grading is async (student isn't waiting), so patient retries are free.
    let graded = null, lastErr = 'The AI grader is temporarily unavailable.';
    for (let t = 1; t <= GRADE_MAX_TRIES; t++) {
      const ai = await sendPrompt(prompt, attempt.student, { maxTokens: 2600, skipCache: true, timeoutMs: GRADE_TIMEOUT_MS, model: GRADE_MODEL });
      if (ai && ai.text && !ai.error) {
        try { graded = normaliseGrade(parseAIJson(ai.text), cs, raw); break; }
        catch { lastErr = 'The AI grader returned an unreadable result.'; }
      } else {
        lastErr = ai?.error || lastErr;
      }
      // Jittered backoff so a whole class retrying at once doesn't stampede the relay's freed slot.
      if (t < GRADE_MAX_TRIES) await new Promise((r) => setTimeout(r, GRADE_RETRY_MS + Math.floor(Math.random() * 10000)));
    }

    if (!graded) {
      await CaseAttempt.updateOne({ _id: attemptId }, { $set: { status: 'failed', gradeError: lastErr } });
      return;
    }

    await CaseAttempt.updateOne({ _id: attemptId },
      { $set: { ai: graded, rawScore: graded.total, status: 'graded', gradedAt: new Date(), gradeError: null } });
  } catch (err) {
    await CaseAttempt.updateOne({ _id: attemptId }, { $set: { status: 'failed', gradeError: 'Grading error. Please retry.' } }).catch(() => {});
  } finally {
    gradingInFlight.delete(key);
  }
}

/* ─── AI grading ───────────────────────────────────────────────────────── */
function buildGradingPrompt(cs, answers) {
  const caseText = stripHtml(cs.contentHtml).slice(0, 6000);
  const qa = cs.questions.map((q, i) =>
    `Q${i + 1}. ${q}\nStudent answer ${i + 1}: ${answers[i].trim()}`).join('\n\n');
  return `You are a senior finance professor grading a student's written responses to a case study, strictly on merit. Be rigorous, fair, and specific. Reward correct reasoning, correct use of the case's own facts and numbers, and genuine insight; penalise vagueness, factual errors, and answers that ignore the case.

CASE (${cs.course === 'MA' ? 'Mergers & Acquisitions' : 'Advanced Corporate Finance'} — ${cs.title}):
"""
${caseText}
"""

QUESTIONS AND THE STUDENT'S ANSWERS:
${qa}

Grade each answer using a NUMERIC rubric of four criteria, each scored as an INTEGER 0-5:
  - relevance: does it answer the exact question asked?
  - accuracy: are the facts and the case's own numbers correct?
  - reasoning: is the argument logically developed, not just asserted?
  - useOfCase: is it grounded in THIS case's specific facts (not generic)?
The answer's score out of 20 is the sum of the four criteria.

ALSO estimate, for each answer, aiLikelihood: an INTEGER 0-100 for how likely the answer was written by an AI / language model rather than the student. Judge on hallmarks of AI writing: generic polish, hedging, list-like balance, textbook phrasing, absence of a personal voice, over-perfect structure. Give a brief aiReason.

Respond with STRICT JSON only, no prose, no markdown fences, in exactly this shape:
{
  "perQuestion": [
    { "criteria": { "relevance": <0-5>, "accuracy": <0-5>, "reasoning": <0-5>, "useOfCase": <0-5> },
      "feedback": "<1-2 sentences, specific to this answer>",
      "modelPoints": ["<key point a strong answer makes>", "<another>"],
      "aiLikelihood": <0-100 integer>, "aiReason": "<brief, why it does or doesn't read as AI-written>" }
    // one object per question, in order
  ],
  "band": "<Distinction|Merit|Pass|Developing>",
  "overall": "<2-3 sentence overall assessment of this student's grasp of the case>",
  "strengths": ["<short>", "<short>"],
  "improvements": ["<short, actionable>", "<short, actionable>"],
  "modelAnswer": "<~150 word expert answer to the core of this case, on merit>"
}
The number of perQuestion objects MUST equal ${cs.questions.length}. Scores must reflect real quality — do not inflate.`;
}

// Coerce the AI output into our schema and compute the 0..100 total from the
// per-question scores (authoritative, so the total can't disagree with the parts).
function normaliseGrade(obj, cs, answers) {
  const n = cs.questions.length;
  const clamp5 = (v) => Math.max(0, Math.min(5, Math.round(Number(v) || 0)));
  const clamp100 = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
  const pq = Array.isArray(obj.perQuestion) ? obj.perQuestion.slice(0, n) : [];
  while (pq.length < n) pq.push({});
  const perQuestion = pq.map((p, i) => {
    const c = p.criteria || {};
    const criteria = {
      relevance: clamp5(c.relevance), accuracy: clamp5(c.accuracy),
      reasoning: clamp5(c.reasoning), useOfCase: clamp5(c.useOfCase),
    };
    // Prefer the summed rubric; fall back to a flat score if the model gave one.
    const rubricSum = criteria.relevance + criteria.accuracy + criteria.reasoning + criteria.useOfCase;
    const score = rubricSum > 0 ? rubricSum : Math.max(0, Math.min(20, Math.round(Number(p.score) || 0)));
    return {
      question: cs.questions[i],
      answer: answers[i].trim(),
      score,
      max: 20,
      criteria,
      feedback: String(p.feedback || 'No assessment returned.').slice(0, 800),
      modelPoints: Array.isArray(p.modelPoints) ? p.modelPoints.map(String).slice(0, 4) : [],
      aiLikelihood: clamp100(p.aiLikelihood),
      aiReason: String(p.aiReason || '').slice(0, 400),
    };
  });
  const sum = perQuestion.reduce((s, p) => s + p.score, 0);
  const total = Math.round((sum / (n * 20)) * 100);
  const aiOverall = Math.round(perQuestion.reduce((s, p) => s + p.aiLikelihood, 0) / n);
  return {
    perQuestion,
    total,
    // Always derive the band from the numeric total — models tend to return
    // freeform grades ("B+", "72/100") that would otherwise leak into the UI.
    band: VALID_BANDS.includes(obj.band) ? obj.band : bandFor(total),
    overall: String(obj.overall || '').slice(0, 1500),
    strengths: Array.isArray(obj.strengths) ? obj.strengths.map(String).slice(0, 5) : [],
    improvements: Array.isArray(obj.improvements) ? obj.improvements.map(String).slice(0, 5) : [],
    modelAnswer: String(obj.modelAnswer || '').slice(0, 2500),
    aiOverall,
  };
}

export default router;
