import { Router } from 'express';
import { body, param, query } from 'express-validator';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import Training from '../models/Training.js';
import ExamAttempt from '../models/ExamAttempt.js';
import Worker from '../models/Worker.js';
import Credential from '../models/Credential.js';
import Counter from '../models/Counter.js';
import QRCode from 'qrcode';
import RegistryCredential from '../models/RegistryCredential.js';
import Issuer from '../models/Issuer.js';
import User from '../models/User.js';
import { LearnerProfile } from '../models/Achievement.js';
import Pathway from '../models/Pathway.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { handleValidation } from '../middleware/validate.js';
import { auditLog } from '../middleware/audit.js';
import { generateVC } from '../services/credentialService.js';
import { generateCertificatePDF, generateTrainingCertificatePDF } from '../services/pdfService.js';
import ClassLiveSession from '../models/ClassLiveSession.js';
import { jaasJoinPayload } from '../services/jaasToken.js';
import { decrypt } from '../utils/encryption.js';
import { escapeRegex } from '../middleware/sanitize.js';
import { emitModuleCompleted, emitQuizAttempted, emitCourseCompleted, emitCourseRegistered, emitCertificateEarned } from '../services/xapiService.js';
import { sendPrompt, parseAIJson } from '../services/aiService.js';
import { encrypt as encryptCnic } from '../utils/encryption.js';
import { signTokens, setRefreshCookie } from '../utils/tokens.js';
import { addSession } from '../utils/sessions.js';
import { issueCsrfCookie } from '../middleware/csrf.js';
import { PUBLIC_BASE } from '../config/identity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ───────── multer config for training evidence uploads ───────── */
const trainingUpload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '../../uploads'),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
      const safeName = `training-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
      cb(null, safeName);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(mp4|mov|avi|webm|pdf|jpg|jpeg|png|webp|doc|docx)$/;
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.test(ext)) return cb(new Error(`File extension ${ext} not allowed`), false);
    cb(null, true);
  },
});

/* ───────── multer config for Material Library uploads (broader doc types) ───────── */
const materialUpload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '../../uploads'),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
      cb(null, `material-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(mp4|mov|avi|webm|mp3|m4a|pdf|jpg|jpeg|png|gif|webp|svg|doc|docx|ppt|pptx|xls|xlsx|csv|txt|md|zip)$/;
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.test(ext)) return cb(new Error(`File extension ${ext} not allowed`), false);
    cb(null, true);
  },
});

const router = Router();

/* ───────── quiz scoring helpers (Gap 6: multi-type support) ───────── */
function scoreQuestion(question, answer) {
  const qType = question.type || 'mcq';
  switch (qType) {
    case 'mcq':
      return answer.selectedOption === question.correctOption;
    case 'true-false':
      return String(answer.answer).toLowerCase() === String(question.correctAnswer).toLowerCase();
    case 'fill-blank': {
      const userAns = String(answer.answer || '').trim();
      const acceptable = question.acceptableAnswers || [];
      if (acceptable.length === 0 && question.correctAnswer) acceptable.push(question.correctAnswer);
      return acceptable.some(a => question.caseSensitive ? userAns === a.trim() : userAns.toLowerCase() === a.trim().toLowerCase());
    }
    case 'matching': {
      const pairs = question.matchPairs || [];
      const userPairs = answer.pairs || [];
      if (pairs.length !== userPairs.length) return false;
      return pairs.every((p, i) => {
        const userPair = userPairs.find(up => up.left === p.left);
        return userPair && userPair.right === p.right;
      });
    }
    case 'ordering': {
      const correct = question.correctOrder || [];
      const userOrder = answer.order || [];
      return correct.length === userOrder.length && correct.every((item, i) => item === userOrder[i]);
    }
    case 'drag-drop': {
      const draggables = question.draggables || [];
      const userPlacements = answer.placements || {};
      return draggables.every(d => userPlacements[d.id] === d.correctZone);
    }
    case 'short-answer': {
      const userAns = String(answer.answer || '').trim().toLowerCase();
      const acceptable = (question.acceptableAnswers || []).map(a => a.trim().toLowerCase());
      if (question.correctAnswer) acceptable.push(question.correctAnswer.trim().toLowerCase());
      // Fuzzy match: Levenshtein distance <= 2
      return acceptable.some(a => {
        if (userAns === a) return true;
        if (Math.abs(userAns.length - a.length) > 2) return false;
        return levenshtein(userAns, a) <= 2;
      });
    }
    case 'essay': {
      // Keyword-based scoring fallback for essays
      const essayText = String(answer.answer || '').trim();
      if (!essayText) return false;

      if (question.essayRubric) {
        // Parse rubric for expected keywords (comma or semicolon separated)
        const keywords = question.essayRubric
          .split(/[,;]+/)
          .map(k => k.trim().toLowerCase())
          .filter(Boolean);
        if (keywords.length === 0) return { partial: true, score: essayText.length >= 200 ? 1 : essayText.length >= 50 ? 0.5 : 0.2 };

        const essayLower = essayText.toLowerCase();
        const matchedCount = keywords.filter(kw => essayLower.includes(kw)).length;
        const keywordScore = matchedCount / keywords.length; // 0-1

        // Length bonus: up to 0.2 extra for thorough answers (200+ chars)
        const lengthBonus = essayText.length >= 200 ? 0.2 : essayText.length >= 100 ? 0.1 : 0;
        const finalScore = Math.min(1, keywordScore * 0.8 + lengthBonus);
        return { partial: true, score: Math.round(finalScore * 100) / 100 };
      }

      // No rubric — minimum length check
      if (essayText.length >= 200) return { partial: true, score: 1 };
      if (essayText.length >= 50) return { partial: true, score: 0.5 };
      return { partial: true, score: 0.2 };
    }
    case 'hotspot': {
      const regions = (question.hotspotRegions || []).filter(r => r.correct);
      const click = answer.click || {};
      return regions.some(r =>
        click.x >= r.x && click.x <= r.x + r.width &&
        click.y >= r.y && click.y <= r.y + r.height
      );
    }
    default:
      return answer.selectedOption === question.correctOption;
  }
}

// Simple Levenshtein distance
function levenshtein(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return matrix[a.length][b.length];
}

/* Grade written (essay / short-answer / answer-box) responses via the AI relay.
   Batches all open questions into one call. Returns { [index]: {score0to1, feedback} }
   or null if AI is unavailable (caller falls back to scoreQuestion). */
async function gradeWrittenAnswers(program, questions, answers, userId) {
  const items = [];
  questions.forEach((q, i) => {
    const type = q.type || 'mcq';
    if (type !== 'essay' && type !== 'short-answer') return;
    const text = (answers[i]?.answer ?? '').toString().trim();
    if (!text) return;
    items.push({
      index: i,
      question: q.question || '',
      criteria: q.scoringCriteria || q.essayRubric || (q.acceptableAnswers || []).join('; ') || '',
      modelAnswer: q.modelAnswer || q.correctAnswer || '',
      response: text.slice(0, 3000),
    });
  });
  if (!items.length) return {};

  const promptText = `You are grading written answers in vocational training "${program.title}" (trade: ${program.trade}).
For each item, score the response 0-100 based on correctness, completeness and relevance to the criteria/model answer.

Items: ${JSON.stringify(items)}

Respond with ONLY a JSON array (no fences): [{ "index": <number>, "score": <0-100>, "feedback": "<one short sentence>" }]`;

  const r = await sendPrompt(promptText, userId, {
    systemPrompt: 'You are a strict but fair vocational assessor. Respond with a JSON array only.',
    maxTokens: 1500, skipCache: true,
  });
  if (r.error || !r.text) return null;
  try {
    let arr = parseAIJson(r.text);
    if (!Array.isArray(arr)) arr = arr.results || [];
    const out = {};
    for (const it of arr) {
      if (typeof it.index === 'number') {
        out[it.index] = { score: Math.max(0, Math.min(1, (Number(it.score) || 0) / 100)), feedback: it.feedback || '' };
      }
    }
    return out;
  } catch { return null; }
}

/* Grade a trainee's single written reply to an exercise, via the AI relay.
   Returns { score 0-100, feedback, wrong[] }. */
async function gradeExerciseResponse(program, set, response, userId) {
  const exercise = (set.content || set.description || set.title || '').toString().slice(0, 5000);
  const criteria = (set.scoringCriteria || '').toString().slice(0, 1500)
    || 'correctness, completeness, and relevance to the exercise';
  const prompt = `You are grading a trainee's written reply to an exercise in the vocational training "${program.title}" (trade: ${program.trade}).

EXERCISE (what the trainee was asked to do):
"""${exercise}"""

GRADING CRITERIA: ${criteria}

TRAINEE'S REPLY:
"""${response.slice(0, 5000)}"""

Respond with ONLY valid JSON (no fences):
{ "score": <integer 0-100>, "feedback": "<2-3 sentence overall comment>", "wrong": ["<specific thing that is wrong or missing>", ...] }
List up to 5 concrete points in "wrong" (empty array if the reply is fully correct).`;
  const r = await sendPrompt(prompt, userId, { systemPrompt: 'You are a fair, precise vocational assessor. Respond with valid JSON only.', maxTokens: 1200, skipCache: true });
  if (r.error || !r.text) return { score: 0, feedback: 'AI grading is unavailable right now — please try again.', wrong: [], unavailable: true };
  try {
    const j = parseAIJson(r.text);
    return { score: Math.max(0, Math.min(100, Math.round(Number(j.score) || 0))), feedback: j.feedback || '', wrong: Array.isArray(j.wrong) ? j.wrong.slice(0, 5) : [] };
  } catch { return { score: 0, feedback: 'Could not parse the AI grading. Please try again.', wrong: [] }; }
}

/* ───────── helpers ───────── */
function addNotification(program, recipientId, type, message) {
  program.notifications.push({ recipient: recipientId, type, message });
}

// Concurrency-safe credential IDs. `countDocuments()+1` collides when many learners
// finish together (a burst issues duplicate TL-LMS ids → unique-index 500s). Use the
// atomic Counter, lazily seeded past any legacy count-based ids so none is reissued.
async function nextCredentialId(prefix) {
  const seeded = await Counter.exists({ _id: 'credential' });
  if (!seeded) {
    const c = await Credential.countDocuments();
    await Counter.updateOne({ _id: 'credential' }, { $setOnInsert: { seq: c } }, { upsert: true });
  }
  const seq = await Counter.getNextSequence('credential');
  return `${prefix}${String(seq).padStart(5, '0')}`;
}

async function autoIssueCertificate(program, enrollment, worker, overrideCompetencyCheck = false) {
  if (enrollment.certificateIssued) return null;

  // ─── Competency threshold check ───
  const { calculatedGrade, breakdown } = calculateWeightedGrade(program, enrollment);
  if (breakdown) {
    enrollment.gradingBreakdown = breakdown;
  }

  const passMark = program.passMark || 70;
  const gradeCheck = calculatedGrade >= passMark;

  // If all modules are completed (100% progress) but no assessments were taken
  // (e.g. seeded/legacy enrollments), bypass grade/competency checks automatically.
  const allModulesComplete = enrollment.progress >= 100 &&
    (enrollment.completedModules?.length ?? 0) >= (program.modules?.length ?? 0);
  const noAssessmentData = !enrollment.quizAttempts?.length &&
    !enrollment.submissions?.length &&
    !enrollment.scenarioResults?.length;
  const bypassForCompletion = allModulesComplete && noAssessmentData;

  const competencyResult = checkCompetencyThresholds(program, enrollment);
  enrollment.competencyGapReport = competencyResult.gaps;
  enrollment.competencyCheckPassed = competencyResult.passed;

  // ─── Final (post) assessment gate ───
  // If the program defines a final-assessment module, the learner must have a
  // passing attempt on it before the certificate is issued. Always enforced
  // when such a module exists (not subject to the legacy completion bypass),
  // except when an admin explicitly overrides.
  // The graded gate is EVERY final assessment, plus the POST phase of any
  // pre/post instrument. All must be passed before the certificate is issued.
  const finalModules = program.modules.filter(m => m.isFinalAssessment || m.isPrePost);
  if (finalModules.length && !overrideCompetencyCheck) {
    for (const fm of finalModules) {
      const passedFinal = enrollment.quizAttempts?.some(
        a => a.moduleId?.toString() === fm._id.toString() && a.passed
          && (fm.isPrePost ? a.phase === 'post' : true)
      );
      if (!passedFinal) {
        return { blocked: true, reason: `Assessment not yet passed: ${fm.title}`, grade: calculatedGrade };
      }
    }
  }

  if (!gradeCheck && !overrideCompetencyCheck && !bypassForCompletion) {
    return { blocked: true, reason: `Grade ${calculatedGrade}% below pass mark ${passMark}%`, grade: calculatedGrade };
  }
  if (!competencyResult.passed && !overrideCompetencyCheck && !bypassForCompletion) {
    const failedSkills = competencyResult.gaps.filter(g => !g.met).map(g => g.skill).join(', ');
    return { blocked: true, reason: `Competency gaps in: ${failedSkills}`, grade: calculatedGrade, gaps: competencyResult.gaps };
  }

  const credentialId = await nextCredentialId('TL-LMS-');

  const vc = generateVC({
    credentialId,
    worker,
    type: 'micro-credential',
    title: `${program.title} — Completion Certificate`,
    trade: program.trade,
    nqfLevel: program.nqfLevel || 2,
    institution: program.institution,
  });

  const adminUser = await User.findOne({ role: 'admin' }).select('_id');
  const cred = await Credential.create({
    credentialId,
    worker: worker._id,
    issuedBy: adminUser?._id || worker.user,
    type: 'micro-credential',
    trade: program.trade,
    title: `${program.title} — Completion Certificate`,
    nqfLevel: program.nqfLevel || 2,
    institution: program.institution,
    signatory: {
      name: program.signatory?.name || '[Chief Master Trainer]',
      title: program.signatory?.title || 'Chief Master Trainer',
    },
    vc,
    validFrom: new Date(),
    validUntil: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000),
    status: 'active',
  });

  enrollment.certificateIssued = true;
  enrollment.certificateId = credentialId;

  // Snapshot letter grades onto the enrollment so the certificate can display them.
  const certGrades = computeCertificateGrades(program, enrollment);
  enrollment.certificateGrades = certGrades.domains;
  enrollment.overallGrade = certGrades.overall;

  addNotification(program, worker._id, 'certificate-issued',
    `Congratulations! Your certificate for "${program.title}" has been issued (${credentialId}).`);

  // xAPI: certificate earned
  emitCertificateEarned(worker._id, program._id, program.title, credentialId).catch(() => {});

  // ─── Sync to National Registry ───────────────────────────────────────────
  try {
    const PPMC_ISSUER_ID = 'TL-PPMC';

    // Auto-register PPMC as an issuer on first cert issuance
    await Issuer.findOneAndUpdate(
      { issuerId: PPMC_ISSUER_ID },
      {
        $setOnInsert: {
          issuerId: PPMC_ISSUER_ID,
          issuerName: 'PPMC / TalentLedger Platform',
          issuerType: 'PLATFORM',
          issuerCategory: 'FEDERAL',
          didIdentifier: `did:talentledger:issuer:${PPMC_ISSUER_ID}`,
          officialWebsite: PUBLIC_BASE,
          status: 'ACTIVE',
        },
      },
      { upsert: true }
    );

    // Decrypt worker CNIC for registry lookup (fall back to masked if key unavailable)
    let holderCnic = worker.cnicMasked || 'unknown';
    try { holderCnic = decrypt(worker.cnicEncrypted); } catch {}

    // Avoid duplicates if cert was somehow issued twice
    const alreadyInRegistry = await RegistryCredential.exists({
      legacyCredential: cred._id,
    });
    if (!alreadyInRegistry) {
      await RegistryCredential.create({
        holderCnic,
        holder: worker._id,
        credentialType: 'MICRO_CREDENTIAL',
        credentialSubtype: 'LMS_CERTIFICATE',
        title: `${program.title} — Completion Certificate`,
        issuerId: PPMC_ISSUER_ID,
        issuerName: 'PPMC / TalentLedger Platform',
        status: 'ACTIVE',
        verificationStatus: 'PLATFORM_VERIFIED',
        verificationMethod: 'API_DIRECT',
        verificationDate: new Date(),
        verifiedBy: adminUser?._id?.toString() || 'system',
        issuanceDate: new Date(),
        expiryDate: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000),
        w3cVcJson: vc,
        legacyCredential: cred._id,
        metadata: {
          microCredential: {
            platform: 'OTHER',
            courseName: program.title,
            courseId: program._id.toString(),
            completionDate: new Date(),
            // `duration` is a display string ("6 weeks"); the registry field is
            // numeric — use totalHours (Number), defaulting to 0.
            hoursCompleted: program.totalHours || 0,
            skillsTags: program.trade ? [program.trade] : [],
          },
        },
      });
    }
  } catch (syncErr) {
    // Non-fatal — LMS cert is issued; registry sync can be retried via admin endpoint
    console.warn(`[Registry] Sync failed for ${credentialId}: ${syncErr.message}`);
  }
  // ─────────────────────────────────────────────────────────────────────────

  return cred;
}

/* ───────── unit micro-credential helper ───────── */
async function autoIssueModuleCredential(program, enrollment, worker, moduleId) {
  // Don't issue if already issued for this module
  if (enrollment.moduleCredentials.some(mc => mc.moduleId.toString() === moduleId.toString())) return null;

  const mod = program.modules.id(moduleId);
  if (!mod) return null;

  const credentialId = await nextCredentialId('TL-UNIT-');
  const title = `${mod.title} — Unit Credential`;

  const vc = generateVC({
    credentialId,
    worker,
    type: 'micro-credential',
    title,
    trade: program.trade,
    nqfLevel: program.nqfLevel || 2,
    institution: program.institution,
  });

  const adminUser = await User.findOne({ role: 'admin' }).select('_id');
  await Credential.create({
    credentialId,
    worker: worker._id,
    issuedBy: adminUser?._id || worker.user,
    type: 'micro-credential',
    trade: program.trade,
    title,
    nqfLevel: program.nqfLevel || 2,
    institution: program.institution,
    vc,
    validFrom: new Date(),
    validUntil: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000),
    status: 'active',
  });

  enrollment.moduleCredentials.push({
    moduleId,
    credentialId,
    title,
  });

  return credentialId;
}

/* ───────── gamification helpers ───────── */
async function awardXpAndUpdateProfile(workerId, xpAmount, eventType, meta = {}) {
  try {
    let profile = await LearnerProfile.findOne({ worker: workerId });
    if (!profile) profile = await LearnerProfile.create({ worker: workerId });

    profile.xp += xpAmount;
    profile.calculateLevel();

    // Update analytics based on event
    if (eventType === 'module-complete') {
      profile.analytics.totalModulesCompleted += 1;
    } else if (eventType === 'quiz-passed') {
      profile.analytics.totalQuizzesPassed += 1;
      if (meta.score) {
        const total = profile.analytics.totalQuizzesPassed + profile.analytics.totalQuizzesFailed;
        profile.analytics.avgQuizScore = Math.round(
          ((profile.analytics.avgQuizScore * (total - 1)) + meta.score) / total
        );
      }
    } else if (eventType === 'quiz-failed') {
      profile.analytics.totalQuizzesFailed += 1;
    } else if (eventType === 'course-complete') {
      profile.analytics.totalCoursesCompleted += 1;
    } else if (eventType === 'certificate-issued') {
      profile.analytics.totalCertificates += 1;
    }

    // Update streak
    const today = new Date().toISOString().split('T')[0];
    const lastActive = profile.lastActiveDate?.toISOString().split('T')[0];
    if (lastActive !== today) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      profile.currentStreak = lastActive === yesterday ? profile.currentStreak + 1 : 1;
      if (profile.currentStreak > profile.longestStreak) profile.longestStreak = profile.currentStreak;
    }
    profile.lastActiveDate = new Date();

    profile.calculateEngagement();
    profile.calculateDropoutRisk();
    await profile.save();
    return profile;
  } catch (e) {
    console.error('Gamification error:', e.message);
    return null;
  }
}

/* ───────── adaptive quiz helpers ───────── */
function selectAdaptiveQuestions(questions, adaptiveData, count = null, competencyTargets = []) {
  const targetDifficulty = adaptiveData?.quizDifficultyLevel || 'medium';
  const diffOrder = { easy: 0, medium: 1, hard: 2 };
  const sorted = [...questions].sort((a, b) => {
    const targetOrder = diffOrder[targetDifficulty] || 1;
    return Math.abs((diffOrder[a.difficulty] || 1) - targetOrder) -
           Math.abs((diffOrder[b.difficulty] || 1) - targetOrder);
  });

  // Default selection count: 12 (from pool of 18+), but never more than available
  const total = Math.min(count || 12, questions.length);

  // ─── Competency coverage constraint ───
  // Ensure at least 2 questions per competency target
  const selected = [];
  if (competencyTargets && competencyTargets.length > 0) {
    for (const ct of competencyTargets) {
      const tagged = sorted.filter(q => q.competencyTag === ct.skill && !selected.includes(q));
      const needed = Math.min(2, tagged.length);
      for (let i = 0; i < needed; i++) selected.push(tagged[i]);
    }
  }

  // Mix: 60% target difficulty, 20% easier, 20% harder (from remaining)
  const remainingPool = sorted.filter(q => !selected.includes(q));
  const target = remainingPool.filter(q => q.difficulty === targetDifficulty);
  const easier = remainingPool.filter(q => (diffOrder[q.difficulty] || 1) < (diffOrder[targetDifficulty] || 1));
  const harder = remainingPool.filter(q => (diffOrder[q.difficulty] || 1) > (diffOrder[targetDifficulty] || 1));

  const remainingSlots = total - selected.length;
  if (remainingSlots > 0) {
    const targetCount = Math.ceil(remainingSlots * 0.6);
    const easierCount = Math.floor(remainingSlots * 0.2);
    const harderCount = remainingSlots - targetCount - easierCount;
    selected.push(...target.slice(0, targetCount));
    selected.push(...easier.slice(0, easierCount));
    selected.push(...harder.slice(0, harderCount));
  }

  // Fill remaining with any available
  while (selected.length < total && selected.length < questions.length) {
    const remaining = questions.filter(q => !selected.includes(q));
    if (remaining.length === 0) break;
    selected.push(remaining[0]);
  }

  // Preserve original question order so answers[i] aligns with quizQuestions[i]
  // (client receives questions in original order from GET /:id)
  const questionOrder = questions.map(q => q);
  selected.sort((a, b) => questionOrder.indexOf(a) - questionOrder.indexOf(b));

  return selected;
}

function updateAdaptiveDifficulty(adaptiveData, passed, score) {
  if (!adaptiveData) adaptiveData = { quizDifficultyLevel: 'medium', consecutiveCorrect: 0, consecutiveWrong: 0 };

  if (passed && score >= 85) {
    adaptiveData.consecutiveCorrect += 1;
    adaptiveData.consecutiveWrong = 0;
    if (adaptiveData.consecutiveCorrect >= 2) {
      if (adaptiveData.quizDifficultyLevel === 'easy') adaptiveData.quizDifficultyLevel = 'medium';
      else if (adaptiveData.quizDifficultyLevel === 'medium') adaptiveData.quizDifficultyLevel = 'hard';
      adaptiveData.consecutiveCorrect = 0;
    }
  } else if (!passed) {
    adaptiveData.consecutiveWrong += 1;
    adaptiveData.consecutiveCorrect = 0;
    if (adaptiveData.consecutiveWrong >= 2) {
      if (adaptiveData.quizDifficultyLevel === 'hard') adaptiveData.quizDifficultyLevel = 'medium';
      else if (adaptiveData.quizDifficultyLevel === 'medium') adaptiveData.quizDifficultyLevel = 'easy';
      adaptiveData.consecutiveWrong = 0;
    }
  }
  return adaptiveData;
}

/* ───────── weighted grading helpers ───────── */
// Map a 0-100 score to a letter grade.
function scoreToLetter(score) {
  const s = Number(score) || 0;
  if (s >= 90) return 'A+'; if (s >= 85) return 'A'; if (s >= 80) return 'A-';
  if (s >= 75) return 'B+'; if (s >= 70) return 'B'; if (s >= 65) return 'B-';
  if (s >= 60) return 'C+'; if (s >= 55) return 'C'; if (s >= 50) return 'C-';
  if (s >= 45) return 'D'; return 'F';
}

// Build per-domain letter grades (from competency scores, e.g. "Greening A",
// "Skills B+") plus an overall grade from the weighted calculation.
function computeCertificateGrades(program, enrollment) {
  const domains = (enrollment.competencyScores || [])
    .filter(c => c && c.skill)
    .map(c => ({ domain: c.skill, score: Math.round(c.score), letter: scoreToLetter(c.score) }))
    .sort((a, b) => a.domain.localeCompare(b.domain));
  const { calculatedGrade } = calculateWeightedGrade(program, enrollment);
  return { domains, overall: { score: Math.round(calculatedGrade), letter: scoreToLetter(calculatedGrade) } };
}

function calculateWeightedGrade(program, enrollment) {
  const cfg = program.gradingConfig || {};
  const weights = {
    quiz: cfg.weights?.quiz ?? 40,
    practical: cfg.weights?.practical ?? 35,
    scenario: cfg.weights?.scenario ?? 15,
    participation: cfg.weights?.participation ?? 10,
  };

  // Detect which module types exist in this program
  const moduleTypes = new Set(program.modules.map(m => m.type));
  const hasQuiz = moduleTypes.has('quiz');
  const hasPractical = moduleTypes.has('practical') || moduleTypes.has('assignment');
  const hasScenario = moduleTypes.has('scenario');
  const hasParticipation = moduleTypes.has('video') || moduleTypes.has('reading');

  // Redistribute weights proportionally for missing types
  const activeWeights = {};
  let totalActive = 0;
  if (hasQuiz) { activeWeights.quiz = weights.quiz; totalActive += weights.quiz; }
  if (hasPractical) { activeWeights.practical = weights.practical; totalActive += weights.practical; }
  if (hasScenario) { activeWeights.scenario = weights.scenario; totalActive += weights.scenario; }
  if (hasParticipation) { activeWeights.participation = weights.participation; totalActive += weights.participation; }

  // If no assessable content, return 0
  if (totalActive === 0) {
    return { calculatedGrade: 0, breakdown: null };
  }

  const effectiveWeights = {
    quiz: hasQuiz ? Math.round(activeWeights.quiz / totalActive * 100) : 0,
    practical: hasPractical ? Math.round(activeWeights.practical / totalActive * 100) : 0,
    scenario: hasScenario ? Math.round(activeWeights.scenario / totalActive * 100) : 0,
    participation: hasParticipation ? Math.round(activeWeights.participation / totalActive * 100) : 0,
  };
  // Ensure weights sum to 100 by adjusting largest
  const ewSum = effectiveWeights.quiz + effectiveWeights.practical + effectiveWeights.scenario + effectiveWeights.participation;
  if (ewSum !== 100) {
    const largest = Object.keys(effectiveWeights).reduce((a, b) => effectiveWeights[a] > effectiveWeights[b] ? a : b);
    effectiveWeights[largest] += (100 - ewSum);
  }

  // 1. Quiz raw score: average of best quiz attempt per module
  let quizRawScore = 0;
  if (hasQuiz) {
    const quizModules = program.modules.filter(m => m.type === 'quiz');
    const bestScores = [];
    for (const qm of quizModules) {
      const attempts = (enrollment.quizAttempts || []).filter(a => a.moduleId?.toString() === qm._id.toString());
      if (attempts.length > 0) {
        bestScores.push(Math.max(...attempts.map(a => a.score)));
      }
    }
    quizRawScore = bestScores.length > 0 ? Math.round(bestScores.reduce((s, v) => s + v, 0) / bestScores.length) : 0;
  }

  // 2. Practical raw score: average of submission grades + rubric percentages
  let practicalRawScore = 0;
  if (hasPractical) {
    const practicalModules = program.modules.filter(m => m.type === 'practical' || m.type === 'assignment');
    const scores = [];
    for (const pm of practicalModules) {
      const subs = (enrollment.submissions || []).filter(s => s.moduleId?.toString() === pm._id.toString());
      for (const sub of subs) {
        if (sub.rubricPercentage != null) {
          scores.push(sub.rubricPercentage);
        } else if (sub.grade != null) {
          scores.push(sub.grade);
        }
      }
    }
    practicalRawScore = scores.length > 0 ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : 0;
  }

  // 3. Scenario raw score: average of best scenario scores
  let scenarioRawScore = 0;
  if (hasScenario) {
    const scenarioModules = program.modules.filter(m => m.type === 'scenario');
    const bestScores = [];
    for (const sm of scenarioModules) {
      const results = (enrollment.scenarioResults || []).filter(r => r.moduleId?.toString() === sm._id.toString());
      if (results.length > 0) {
        const best = results.reduce((a, b) => {
          const aScore = a.maxScore > 0 ? (a.score / a.maxScore * 100) : 0;
          const bScore = b.maxScore > 0 ? (b.score / b.maxScore * 100) : 0;
          return aScore > bScore ? a : b;
        });
        bestScores.push(best.maxScore > 0 ? Math.round(best.score / best.maxScore * 100) : 0);
      }
    }
    scenarioRawScore = bestScores.length > 0 ? Math.round(bestScores.reduce((s, v) => s + v, 0) / bestScores.length) : 0;
  }

  // 4. Participation raw score: 60% completion rate of video/reading + 40% knowledge check scores
  let participationRawScore = 0;
  if (hasParticipation) {
    const participationModules = program.modules.filter(m => m.type === 'video' || m.type === 'reading');
    const totalParticipation = participationModules.length;
    const completedParticipation = participationModules.filter(m =>
      (enrollment.completedModules || []).some(cm => cm.toString() === m._id.toString())
    ).length;
    const completionRate = totalParticipation > 0 ? (completedParticipation / totalParticipation * 100) : 0;

    // Knowledge check scores
    let kcScore = 0;
    const kcAttempts = (enrollment.knowledgeCheckAttempts || []);
    if (kcAttempts.length > 0) {
      // Best attempt per module
      const bestKc = {};
      for (const kca of kcAttempts) {
        const key = kca.moduleId?.toString();
        if (!key) continue;
        if (!bestKc[key] || kca.score > bestKc[key]) bestKc[key] = kca.score;
      }
      const kcValues = Object.values(bestKc);
      kcScore = kcValues.length > 0 ? kcValues.reduce((s, v) => s + v, 0) / kcValues.length : 0;
    }

    // Weight: 60% completion + 40% knowledge checks (if any checks exist, otherwise 100% completion)
    const hasKnowledgeChecks = participationModules.some(m => m.knowledgeChecks && m.knowledgeChecks.length > 0);
    if (hasKnowledgeChecks) {
      participationRawScore = Math.round(completionRate * 0.6 + kcScore * 0.4);
    } else {
      participationRawScore = Math.round(completionRate);
    }
  }

  // Apply weights
  const quizWeightedScore = Math.round(quizRawScore * effectiveWeights.quiz / 100 * 100) / 100;
  const practicalWeightedScore = Math.round(practicalRawScore * effectiveWeights.practical / 100 * 100) / 100;
  const scenarioWeightedScore = Math.round(scenarioRawScore * effectiveWeights.scenario / 100 * 100) / 100;
  const participationWeightedScore = Math.round(participationRawScore * effectiveWeights.participation / 100 * 100) / 100;

  const calculatedGrade = Math.round(quizWeightedScore + practicalWeightedScore + scenarioWeightedScore + participationWeightedScore);

  const breakdown = {
    quizRawScore,
    practicalRawScore,
    scenarioRawScore,
    participationRawScore,
    quizWeightedScore,
    practicalWeightedScore,
    scenarioWeightedScore,
    participationWeightedScore,
    effectiveWeights,
    calculatedGrade,
    calculatedAt: new Date(),
  };

  return { calculatedGrade, breakdown };
}

function checkCompetencyThresholds(program, enrollment) {
  const cfg = program.gradingConfig || {};
  const thresholds = {
    foundation: cfg.competencyThresholds?.foundation ?? 40,
    intermediate: cfg.competencyThresholds?.intermediate ?? 55,
    advanced: cfg.competencyThresholds?.advanced ?? 70,
    expert: cfg.competencyThresholds?.expert ?? 85,
  };
  const enforce = cfg.enforceCompetencyThresholds !== false;

  const targets = program.competencyTargets || [];
  if (targets.length === 0) {
    return { passed: true, gaps: [] };
  }

  const gaps = [];
  for (const target of targets) {
    const existing = (enrollment.competencyScores || []).find(c => c.skill === target.skill);
    const currentScore = existing ? existing.score : 0;
    const threshold = thresholds[target.targetLevel] || thresholds.intermediate;
    const met = currentScore >= threshold;
    gaps.push({
      skill: target.skill,
      targetLevel: target.targetLevel,
      currentScore,
      threshold,
      met,
      gap: met ? 0 : Math.round(threshold - currentScore),
    });
  }

  const passed = !enforce || gaps.every(g => g.met);
  return { passed, gaps };
}

/* ═══════════════════════════════════════════════════════════
   LIST, SEARCH & FILTER PROGRAMS
   ═══════════════════════════════════════════════════════════ */
router.get('/', authenticate, [
  query('trade').optional().isLength({ max: 50 }),
  query('status').optional().isIn(['draft', 'active', 'archived']),
  query('search').optional().isLength({ max: 100 }),
  query('difficulty').optional().isIn(['beginner', 'intermediate', 'advanced']),
  query('nqfLevel').optional().isInt({ min: 1, max: 8 }),
  query('framework').optional().isIn(['navttc', 'gulf', 'custom']),
  handleValidation,
], async (req, res, next) => {
  try {
    const { trade, status = 'active', search, difficulty, nqfLevel, framework } = req.query;
    const filter = { status };
    if (trade) filter.trade = String(trade);
    if (difficulty) filter.difficulty = difficulty;
    if (nqfLevel) filter.nqfLevel = Number(nqfLevel);
    if (framework) filter.framework = framework;
    if (search) {
      const safe = escapeRegex(String(search));
      filter.$or = [
        { title: { $regex: safe, $options: 'i' } },
        { trade: { $regex: safe, $options: 'i' } },
        { tags: { $regex: safe, $options: 'i' } },
        { instructor: { $regex: safe, $options: 'i' } },
        { institution: { $regex: safe, $options: 'i' } },
      ];
    }

    // `?summary=1` returns only lightweight fields — used by pickers/managers so
    // they don't drag down the whole modules/enrollments/bank payload (fast load).
    if (String(req.query.summary) === '1') {
      const lite = await Training.find(filter)
        .sort('-createdAt')
        .select('title trade nqfLevel status duration difficulty institution tags');
      return res.json(lite);
    }

    // Catalog list: keep card fields + a module skeleton (for counts/titles) but
    // strip the heavy bodies (lesson content, questions, rubrics, resources,
    // syllabus, social) — this cut the payload from ~5.6MB to a fraction.
    const programs = await Training.find(filter)
      .sort('-createdAt')
      .select('-enrollments -notifications -discussions -syllabus -resources -questionBank -practiceSets '
        + '-modules.content -modules.quizQuestions -modules.scenario -modules.knowledgeChecks '
        + '-modules.preCheckQuestions -modules.rubricTemplate -modules.scormManifest -modules.scormData');
    res.json(programs);
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   MY ENROLLED COURSES (for "My Learning" tab)
   ═══════════════════════════════════════════════════════════ */
router.get('/my-courses', authenticate, async (req, res, next) => {
  try {
    let workerId;
    if (req.user.role === 'worker') {
      const worker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!worker) return res.json([]);
      workerId = worker._id;
    } else {
      return res.json([]);
    }

    const programs = await Training.find({ 'enrollments.worker': workerId })
      .select('title trade nqfLevel instructor institution duration modules enrollments ratings difficulty thumbnail framework tags');

    const myCourses = programs.map(p => {
      const enrollment = p.enrollments.find(e => e.worker.toString() === workerId.toString());
      const modules = (p.modules || []).sort((a, b) => (a.order || 0) - (b.order || 0));

      // Find next module to continue
      let nextModule = null;
      for (const m of modules) {
        if (!enrollment.completedModules.some(id => id.toString() === m._id.toString())) {
          nextModule = { _id: m._id, title: m.title, type: m.type };
          break;
        }
      }

      return {
        _id: p._id,
        title: p.title,
        trade: p.trade,
        nqfLevel: p.nqfLevel,
        framework: p.framework,
        instructor: p.instructor,
        institution: p.institution,
        duration: p.duration,
        difficulty: p.difficulty,
        totalModules: modules.length,
        avgRating: p.avgRating,
        tags: p.tags || [],
        // Exam/course-system items (tagged online-exam or with graded exam
        // modules) are surfaced elsewhere; the Training tab filters these out.
        isExamCourse: (p.tags || []).includes('online-exam') || modules.some(m => m.examType),
        enrollment: {
          progress: enrollment.progress,
          status: enrollment.status,
          completedModules: enrollment.completedModules.length,
          bookmarked: enrollment.bookmarked,
          lastAccessedAt: enrollment.lastAccessedAt,
          certificateIssued: enrollment.certificateIssued,
          certificateId: enrollment.certificateId,
          enrolledAt: enrollment.enrolledAt,
        },
        nextModule,
      };
    });

    // Sort: in-progress first, then by last accessed
    myCourses.sort((a, b) => {
      if (a.enrollment.status === 'in-progress' && b.enrollment.status !== 'in-progress') return -1;
      if (b.enrollment.status === 'in-progress' && a.enrollment.status !== 'in-progress') return 1;
      return new Date(b.enrollment.lastAccessedAt) - new Date(a.enrollment.lastAccessedAt);
    });

    res.json(myCourses);
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   NOTIFICATIONS (MUST be before /:id)
   ═══════════════════════════════════════════════════════════ */
router.get('/notifications/my', authenticate, async (req, res, next) => {
  try {
    let workerId;
    if (req.user.role === 'worker') {
      const worker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!worker) return res.json([]);
      workerId = worker._id;
    } else {
      return res.json([]);
    }

    const allPrograms = await Training.find(
      { 'notifications.recipient': workerId },
    ).select('title notifications');

    const notifications = [];
    for (const p of allPrograms) {
      for (const n of p.notifications) {
        if (n.recipient.toString() === workerId.toString()) {
          notifications.push({
            _id: n._id,
            programId: p._id,
            programTitle: p.title,
            type: n.type,
            message: n.message,
            read: n.read,
            createdAt: n.createdAt,
          });
        }
      }
    }

    notifications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(notifications.slice(0, 50));
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   TRAINING ANALYTICS (MUST be before /:id)
   ═══════════════════════════════════════════════════════════ */
router.get('/analytics/overview', authenticate, authorize('admin', 'institution', 'assessor'), async (req, res, next) => {
  try {
    const programs = await Training.find().select('title trade enrollments modules status ratings');

    let totalEnrollments = 0;
    let completedEnrollments = 0;
    let inProgressEnrollments = 0;
    let totalQuizAttempts = 0;
    let passedQuizAttempts = 0;
    let certificatesIssued = 0;
    let totalSubmissions = 0;
    const tradeStats = {};
    const programStats = [];

    for (const p of programs) {
      const enrolled = p.enrollments.length;
      const completed = p.enrollments.filter(e => e.status === 'completed').length;
      const inProgress = p.enrollments.filter(e => e.status === 'in-progress').length;
      const avgProgress = enrolled > 0
        ? Math.round(p.enrollments.reduce((s, e) => s + e.progress, 0) / enrolled)
        : 0;

      let quizAttempts = 0;
      let quizPassed = 0;
      let certs = 0;
      let submissions = 0;
      for (const e of p.enrollments) {
        quizAttempts += e.quizAttempts?.length || 0;
        quizPassed += e.quizAttempts?.filter(a => a.passed).length || 0;
        submissions += e.submissions?.length || 0;
        if (e.certificateIssued) certs++;
      }

      totalEnrollments += enrolled;
      completedEnrollments += completed;
      inProgressEnrollments += inProgress;
      totalQuizAttempts += quizAttempts;
      passedQuizAttempts += quizPassed;
      certificatesIssued += certs;
      totalSubmissions += submissions;

      if (!tradeStats[p.trade]) tradeStats[p.trade] = { enrolled: 0, completed: 0, programs: 0 };
      tradeStats[p.trade].enrolled += enrolled;
      tradeStats[p.trade].completed += completed;
      tradeStats[p.trade].programs += 1;

      programStats.push({
        _id: p._id,
        title: p.title,
        trade: p.trade,
        status: p.status,
        totalModules: p.modules.length,
        enrolled,
        completed,
        inProgress,
        avgProgress,
        completionRate: enrolled > 0 ? Math.round(completed / enrolled * 100) : 0,
        quizAttempts,
        quizPassRate: quizAttempts > 0 ? Math.round(quizPassed / quizAttempts * 100) : 0,
        certificatesIssued: certs,
        avgRating: p.avgRating,
        totalRatings: p.ratings?.length || 0,
      });
    }

    res.json({
      overview: {
        totalPrograms: programs.length,
        totalEnrollments,
        completedEnrollments,
        inProgressEnrollments,
        completionRate: totalEnrollments > 0 ? Math.round(completedEnrollments / totalEnrollments * 100) : 0,
        totalQuizAttempts,
        quizPassRate: totalQuizAttempts > 0 ? Math.round(passedQuizAttempts / totalQuizAttempts * 100) : 0,
        certificatesIssued,
        totalSubmissions,
      },
      byTrade: Object.entries(tradeStats).map(([trade, s]) => ({
        trade,
        ...s,
        completionRate: s.enrolled > 0 ? Math.round(s.completed / s.enrolled * 100) : 0,
      })),
      programs: programStats,
    });
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   STUDENT TRANSCRIPT (MUST be before /:id)
   ═══════════════════════════════════════════════════════════ */
router.get('/transcript/my', authenticate, async (req, res, next) => {
  try {
    let workerId;
    if (req.user.role === 'worker') {
      const worker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!worker) return res.status(400).json({ error: 'No linked worker profile' });
      workerId = worker._id;
    } else {
      return res.status(400).json({ error: 'No linked worker profile' });
    }

    const programs = await Training.find({
      'enrollments.worker': workerId
    }).select('title trade nqfLevel difficulty duration instructor institution enrollments modules');

    const transcript = [];
    let totalWeightedScore = 0, totalCredits = 0;

    for (const program of programs) {
      const enrollment = program.enrollments.find(e => e.worker?.toString() === workerId.toString());
      if (!enrollment) continue;

      // Calculate module breakdown
      const moduleResults = [];
      for (const mod of program.modules) {
        const modId = mod._id.toString();
        const isCompleted = enrollment.completedModules?.some(cm => cm.toString() === modId);

        // Find best quiz score for this module
        const quizAttempts = (enrollment.quizAttempts || []).filter(a => a.moduleId?.toString() === modId);
        const bestQuizScore = quizAttempts.length > 0 ? Math.max(...quizAttempts.map(a => a.score)) : null;

        // Find submission grade
        const submission = (enrollment.submissions || []).find(s => s.moduleId?.toString() === modId);

        moduleResults.push({
          moduleId: mod._id,
          title: mod.title,
          type: mod.type,
          completed: isCompleted,
          quizScore: bestQuizScore,
          assignmentGrade: submission?.grade ?? null,
          assignmentStatus: submission?.status ?? null,
          timeSpent: (enrollment.moduleTimeLog || []).find(t => t.moduleId?.toString() === modId)?.timeSpentMinutes ?? 0
        });
      }

      // Credits = number of modules (simple weighting)
      const credits = program.modules.length;
      const grade = enrollment.evaluationGrade ?? null;

      if (grade != null) {
        totalWeightedScore += grade * credits;
        totalCredits += credits;
      }

      transcript.push({
        programId: program._id,
        title: program.title,
        trade: program.trade,
        nqfLevel: program.nqfLevel,
        difficulty: program.difficulty,
        instructor: program.instructor,
        institution: program.institution,
        enrolledAt: enrollment.enrolledAt,
        completedAt: enrollment.completedAt,
        status: enrollment.status,
        progress: enrollment.progress,
        grade: grade,
        letterGrade: enrollment.evaluationSummary?.overallGrade ?? null,
        strengths: enrollment.evaluationSummary?.strengths ?? [],
        weaknesses: enrollment.evaluationSummary?.weaknesses ?? [],
        recommendation: enrollment.evaluationSummary?.recommendation ?? '',
        certificateId: enrollment.certificateId ?? null,
        certificateIssued: enrollment.certificateIssued ?? false,
        preAssessmentScore: enrollment.preAssessmentScore ?? null,
        moduleResults,
        totalModules: program.modules.length,
        completedModules: enrollment.completedModules?.length ?? 0
      });
    }

    // Cumulative GPA-like score
    const cumulativeScore = totalCredits > 0 ? Math.round(totalWeightedScore / totalCredits) : 0;
    const cumulativeGrade = cumulativeScore >= 90 ? 'A' : cumulativeScore >= 80 ? 'B' : cumulativeScore >= 70 ? 'C' : cumulativeScore >= 60 ? 'D' : 'F';

    res.json({
      transcript,
      summary: {
        totalCourses: transcript.length,
        completedCourses: transcript.filter(t => ['completed', 'submitted', 'evaluated'].includes(t.status)).length,
        evaluatedCourses: transcript.filter(t => t.status === 'evaluated').length,
        cumulativeScore,
        cumulativeGrade,
        totalCredits,
        certificates: transcript.filter(t => t.certificateIssued).length
      }
    });
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   TRAINING SUBMISSIONS — PENDING (for Assessor dashboard)
   ═══════════════════════════════════════════════════════════ */
router.get('/submissions/pending', authenticate, authorize('admin', 'institution', 'assessor'), async (req, res, next) => {
  try {
    const programs = await Training.find({ 'enrollments.submissions.status': 'submitted' })
      .select('title trade modules enrollments');

    const pending = [];
    for (const program of programs) {
      for (const enrollment of program.enrollments) {
        for (const sub of (enrollment.submissions || [])) {
          if (sub.status === 'submitted') {
            const mod = program.modules.id(sub.moduleId);
            const worker = await Worker.findById(enrollment.worker).select('name trade');
            pending.push({
              _id: sub._id,
              programId: program._id,
              programTitle: program.title,
              trade: program.trade,
              moduleId: sub.moduleId,
              moduleTitle: mod?.title || 'Unknown Module',
              moduleType: mod?.type || 'assignment',
              competencies: mod?.competencies || [],
              workerId: enrollment.worker,
              workerName: worker?.name || 'Worker',
              files: sub.files || [],
              notes: sub.notes || '',
              evidenceType: sub.evidenceType || 'other',
              submittedAt: sub.submittedAt,
            });
          }
        }
      }
    }

    // Sort newest first
    pending.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
    res.json(pending);
  } catch (err) { next(err); }
});

router.get('/submissions/stats', authenticate, authorize('admin', 'institution', 'assessor'), async (req, res, next) => {
  try {
    const programs = await Training.find().select('enrollments');

    let pendingReviews = 0;
    let approvedToday = 0;
    let totalApproved = 0;
    let totalRejected = 0;
    let totalReviewed = 0;
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

    for (const program of programs) {
      for (const enrollment of program.enrollments) {
        for (const sub of (enrollment.submissions || [])) {
          if (sub.status === 'submitted') pendingReviews++;
          if (sub.status === 'approved') {
            totalApproved++;
            totalReviewed++;
            if (sub.reviewedAt && new Date(sub.reviewedAt) >= todayStart) approvedToday++;
          }
          if (sub.status === 'rejected') {
            totalRejected++;
            totalReviewed++;
          }
        }
      }
    }

    res.json({
      pendingReviews,
      approvedToday,
      rejectionRate: totalReviewed > 0 ? Math.round((totalRejected / totalReviewed) * 100) : 0,
      totalReviewed,
    });
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   GET SINGLE PROGRAM
   ═══════════════════════════════════════════════════════════ */
router.get('/:id', authenticate, [
  param('id').isMongoId().withMessage('Invalid program ID'),
  handleValidation,
], async (req, res, next) => {
  try {
    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });

    // For learners, track last access with a TARGETED update (never save the
    // whole doc on a read — that was the main Training-tab slowdown).
    let ownWorkerId = null;
    if (req.user.role === 'worker') {
      const worker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (worker) {
        ownWorkerId = worker._id.toString();
        await Training.updateOne(
          { _id: program._id, 'enrollments.worker': worker._id },
          { $set: { 'enrollments.$.lastAccessedAt': new Date() } },
        ).catch(() => {});
      }
    }

    // Enrich modules that have empty content so the LMS never shows a blank lesson
    const programObj = program.toObject();

    // Privacy + payload: learners only ever need their OWN enrollment, not the
    // entire cohort's attempts/submissions. This slashes the response size.
    if (ownWorkerId) {
      programObj.enrollments = (programObj.enrollments || []).filter(
        e => String(e.worker) === ownWorkerId || String(e.worker?._id) === ownWorkerId,
      );
    }
    programObj.modules = (programObj.modules || []).map(m => {
      if (m.content && m.content.trim()) return m; // already has content
      if (m.type === 'video') return m;             // video modules use videoUrl, not content

      const typeLabels = { practical: 'Practical Exercise', assignment: 'Assignment', scenario: 'Scenario Exercise', quiz: 'Assessment', reading: 'Reading Material' };
      const label = typeLabels[m.type] || 'Module';
      const desc = m.description ? `\n\n${m.description}` : '';
      const competencyList = (m.competencies || []).map(c => `- ${c.skill} (${c.level})`).join('\n') || '- As per trade standards';

      if (m.type === 'practical') {
        m.content = `## ${m.title}\n\n**Type:** ${label}${desc}\n\n### Instructions\n1. Review the task description above.\n2. Complete the practical exercise under supervision.\n3. Record your work and submit evidence using the Upload button.\n4. Your assessor will review and grade your submission.\n\n### Competencies Assessed\n${competencyList}`;
      } else if (m.type === 'assignment') {
        m.content = `## ${m.title}\n\n**Type:** ${label}${desc}\n\n### Instructions\n1. Read the task brief carefully.\n2. Complete the assignment independently.\n3. Upload your completed work (PDF, Word, or image) using the Upload button.\n4. Ensure your submission meets the quality standards described.\n\n### Competencies Assessed\n${competencyList}`;
      } else if (m.type === 'scenario') {
        m.content = `## ${m.title}\n\n**Type:** ${label}${desc}\n\n### Instructions\n1. Read the scenario description carefully.\n2. Work through each decision point.\n3. Select the most appropriate response at each step.\n4. You will receive feedback on your choices at the end.\n\n### Learning Objective\nApply trade knowledge and HSE awareness to real-world site situations.`;
      }
      return m;
    });

    // SECURITY: never ship answer keys to non-staff. Quizzes are scored
    // server-side (POST /:id/quiz…) and the client renders correctness from that
    // response — so learners never need correctOption/correctAnswer/
    // acceptableAnswers embedded here. Leaving them in let a candidate read the
    // key for the exam they were sitting.
    const STAFF_ROLES = ['admin', 'institution', 'assessor', 'trainer'];
    if (!STAFF_ROLES.includes(req.user.role)) {
      // Recursively strip answer keys wherever they appear — quizQuestions,
      // knowledgeChecks, preCheckQuestions, scenario branches, etc.
      const stripKeys = (node) => {
        if (Array.isArray(node)) { node.forEach(stripKeys); return; }
        if (node && typeof node === 'object') {
          delete node.correctOption; delete node.correctAnswer; delete node.acceptableAnswers; delete node.examPassword; delete node.explanation;
          for (const v of Object.values(node)) stripKeys(v);
        }
      };
      stripKeys(programObj.modules);
    }

    res.json(programObj);
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   PARTICULARS OF THE TRAINEES — enrolled roster with scores
   ═══════════════════════════════════════════════════════════ */
router.get('/:id/participants', authenticate, authorize('admin', 'institution', 'assessor'), [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const program = await Training.findById(req.params.id)
      .populate({ path: 'enrollments.worker', select: 'fullName registrationId trade district phone' });
    if (!program) return res.status(404).json({ error: 'Program not found' });

    const prePost = program.modules.find(m => m.isPrePost);
    const roster = (program.enrollments || []).map(e => {
      let pre = null, post = null;
      if (prePost) {
        for (const a of (e.quizAttempts || [])) {
          if (a.moduleId?.toString() !== prePost._id.toString()) continue;
          if (a.phase === 'pre') pre = a.score;
          if (a.phase === 'post') post = a.score;
        }
      }
      const exVals = (e.exerciseResults || []).map(r => r.score);
      const exerciseAvg = exVals.length ? Math.round(exVals.reduce((s, v) => s + v, 0) / exVals.length) : null;
      return {
        workerId: e.worker?._id || e.worker,
        name: e.worker?.fullName || 'Trainee',
        registrationId: e.worker?.registrationId || '',
        trade: e.worker?.trade || program.trade,
        district: e.worker?.district || '',
        phone: e.worker?.phone || '',
        progress: e.progress || 0,
        status: e.status,
        enrolledAt: e.enrolledAt,
        pre, post, gain: (pre != null && post != null) ? post - pre : null,
        exerciseAvg,
        certified: !!e.certificateIssued,
      };
    });
    res.json({ count: roster.length, hasPrePost: !!prePost, participants: roster });
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   PUBLIC CATALOG — open-enrolment trainings, shown as join cards in the
   LMS Training tab and on the public join page. No authentication.
   ═══════════════════════════════════════════════════════════ */
router.get('/public/open', async (req, res, next) => {
  try {
    // Only genuine trainings belong in the Training-tab catalog. Academic
    // courses from the online-exam/course system (tagged 'online-exam' or with
    // graded exam modules) live in the Courses tab, so exclude them here.
    const list = await Training.find(
      {
        openEnrollment: true,
        status: { $ne: 'archived' },
        tags: { $ne: 'online-exam' },
        modules: { $not: { $elemMatch: { examType: { $ne: null } } } },
      },
      'title description startDate endDate maxEnrollment enrollments duration tags institution thumbnail'
    ).lean();
    const out = (list || []).map(t => ({
      id: t._id.toString(),
      title: t.title,
      description: t.description || '',
      startDate: t.startDate || null,
      endDate: t.endDate || null,
      duration: t.duration || '',
      tags: t.tags || [],
      institution: t.institution || '',
      thumbnail: t.thumbnail || '',
      maxEnrollment: t.maxEnrollment || 60,
      enrolledCount: (t.enrollments || []).length,
      seatsLeft: Math.max(0, (t.maxEnrollment || 60) - (t.enrollments || []).length),
    }));
    // Soonest / most-recent first
    out.sort((a, b) => new Date(b.startDate || 0) - new Date(a.startDate || 0));
    res.json(out);
  } catch (err) { next(err); }
});

router.get('/public/:id', [param('id').isMongoId(), handleValidation], async (req, res, next) => {
  try {
    const t = await Training.findById(req.params.id)
      .select('title description startDate endDate maxEnrollment enrollments openEnrollment duration institution tags')
      .lean();
    if (!t) return res.status(404).json({ error: 'Training not found' });
    res.json({
      id: t._id.toString(),
      title: t.title,
      description: t.description || '',
      startDate: t.startDate || null,
      endDate: t.endDate || null,
      duration: t.duration || '',
      institution: t.institution || '',
      tags: t.tags || [],
      openEnrollment: !!t.openEnrollment,
      maxEnrollment: t.maxEnrollment || 60,
      enrolledCount: (t.enrollments || []).length,
      seatsLeft: Math.max(0, (t.maxEnrollment || 60) - (t.enrollments || []).length),
    });
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   PUBLIC ENTRY GATE — a member enters name + Gmail, gets an account,
   is enrolled and auto-logged-in, then routed to the training tab.
   Only works on trainings with openEnrollment = true, up to maxEnrollment.
   ═══════════════════════════════════════════════════════════ */
router.post('/:id/join', [
  param('id').isMongoId(),
  body('email').isEmail().normalizeEmail().withMessage('A valid email is required'),
  body('name').trim().notEmpty().isLength({ max: 120 }).withMessage('Your name is required'),
  body('contact').optional({ checkFalsy: true }).trim().isLength({ max: 60 }),
  body('institute').optional({ checkFalsy: true }).trim().isLength({ max: 200 }),
  handleValidation,
], async (req, res, next) => {
  try {
    const training = await Training.findById(req.params.id);
    if (!training) return res.status(404).json({ error: 'Training not found' });
    if (!training.openEnrollment) return res.status(403).json({ error: 'This training is not open for self-enrolment.' });

    const email = String(req.body.email).toLowerCase().trim();
    const name = String(req.body.name).trim();
    const contact = req.body.contact ? String(req.body.contact).trim() : '';
    const institute = req.body.institute ? String(req.body.institute).trim() : '';

    let user = await User.findOne({ email });
    const justCreated = !user;
    if (!user) {
      const pw = crypto.randomBytes(12).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) + 'Aa1!';
      user = await User.create({ name, email, password: pw, role: 'worker', isVerified: true, emailVerified: true, selfEnrolled: true });
    }

    // Look up any EXISTING worker BEFORE creating a placeholder below — the
    // auto-login decision must reflect the account's prior state, not a
    // placeholder this very request is about to create.
    let worker = await Worker.findOne({ user: user._id });
    const preExistingPlaceholder = !!worker && (worker.cnicMasked === '—' || String(worker.registrationId || '').startsWith('TL-GS-'));
    if (!worker) {
      worker = await Worker.create({
        user: user._id, fullName: name,
        cnicEncrypted: encryptCnic('SELF-' + crypto.randomBytes(6).toString('hex')),
        cnicMasked: '—', district: institute || '—', phone: contact || undefined,
        trade: 'electrician', nqfLevel: training.nqfLevel || 2,
        registrationId: 'TL-GS-' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'),
      });
    } else if (contact && !worker.phone) {
      worker.phone = contact;
      await worker.save();
    }

    const existing = training.enrollments.find(e => e.worker.toString() === worker._id.toString());
    if (!existing) {
      if ((training.enrollments?.length || 0) >= (training.maxEnrollment || 60)) {
        return res.status(400).json({ error: 'This training has reached capacity.' });
      }
      training.enrollments.push({ worker: worker._id, progress: 0, status: 'in-progress', contact, institute });
      await training.save();
    } else if ((contact && !existing.contact) || (institute && !existing.institute)) {
      if (contact && !existing.contact) existing.contact = contact;
      if (institute && !existing.institute) existing.institute = institute;
      await training.save();
    }

    // SECURITY: only auto-login accounts this gate legitimately owns — ones it
    // just created, or passwordless self-enrolled learners (flagged, or legacy
    // gate accounts whose PRE-EXISTING worker was a self-enrolment placeholder).
    // A real account (admin/staff/regular signup) sharing this email must NOT be
    // handed a session, or submitting its email would take it over.
    const mayAutoLogin = justCreated || user.selfEnrolled === true || preExistingPlaceholder;

    if (!mayAutoLogin) {
      // Enrollment already recorded above; just don't mint a session.
      return res.json({
        trainingId: training._id.toString(),
        name: user.name,
        enrolled: true,
        requiresLogin: true,
        message: 'You already have an account with this email. Please log in to continue.',
      });
    }

    const tokens = signTokens(user);
    // Persist the refresh token so /auth/refresh's compare-and-swap matches —
    // without this a self-enrolled learner can't refresh and gets logged out to
    // /login the moment their 15m access token expires (e.g. mid-assessment).
    user.refreshToken = tokens.refresh;
    await user.save();
    await addSession(user._id, tokens.refresh);
    setRefreshCookie(res, tokens.refresh);
    issueCsrfCookie(res);
    res.json({ accessToken: tokens.access, trainingId: training._id.toString(), name: user.name, enrolled: true });
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   CREATE PROGRAM
   ═══════════════════════════════════════════════════════════ */
router.post('/', authenticate, authorize('admin', 'institution'), [
  body('title').trim().notEmpty().withMessage('Title is required').isLength({ max: 300 }),
  body('trade').trim().notEmpty().withMessage('Trade is required'),
  body('description').optional().trim().isLength({ max: 2000 }),
  body('nqfLevel').optional().isInt({ min: 1, max: 8 }).toInt(),
  body('maxEnrollment').optional().isInt({ min: 1, max: 500 }).toInt(),
  body('difficulty').optional().isIn(['beginner', 'intermediate', 'advanced']),
  body('startDate').optional().isISO8601(),
  body('endDate').optional().isISO8601(),
  body('prerequisites').optional().isArray(),
  body('syllabus').optional().trim().isLength({ max: 5000 }),
  handleValidation,
], auditLog('TRAINING_CREATE'), async (req, res, next) => {
  try {
    const { title, trade, description, nqfLevel, maxEnrollment, difficulty, startDate, endDate, prerequisites, syllabus, instructor, institution, duration, thumbnail, tags, passMark, gradingConfig, competencyTargets, transferableSkills, category, framework, signatory, associatedTrainers, issuers } = req.body;
    const program = await Training.create({ title, trade, description, nqfLevel, maxEnrollment, difficulty, startDate, endDate, prerequisites, syllabus, instructor, institution, duration, thumbnail, tags, passMark, gradingConfig, competencyTargets, transferableSkills, category, framework, signatory, associatedTrainers, issuers });
    res.status(201).json(program);
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   UPDATE PROGRAM
   ═══════════════════════════════════════════════════════════ */
router.put('/:id', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId().withMessage('Invalid program ID'),
  body('title').optional().trim().isLength({ max: 300 }),
  body('description').optional().trim().isLength({ max: 2000 }),
  body('difficulty').optional().isIn(['beginner', 'intermediate', 'advanced']),
  body('startDate').optional().isISO8601(),
  body('endDate').optional().isISO8601(),
  body('syllabus').optional().trim().isLength({ max: 5000 }),
  body('signatory').optional().isObject(),
  body('signatory.name').optional({ checkFalsy: true }).trim().isLength({ max: 120 }),
  body('signatory.title').optional({ checkFalsy: true }).trim().isLength({ max: 120 }),
  handleValidation,
], auditLog('TRAINING_UPDATE'), async (req, res, next) => {
  try {
    const allowed = ['title', 'trade', 'description', 'nqfLevel', 'maxEnrollment', 'difficulty', 'startDate', 'endDate', 'prerequisites', 'syllabus', 'instructor', 'institution', 'duration', 'thumbnail', 'tags', 'status', 'gradingConfig', 'competencyTargets', 'passMark', 'retakesAllowed', 'signatory', 'associatedTrainers', 'issuers', 'signatories', 'openEnrollment', 'maxEnrollment'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    const program = await Training.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
    if (!program) return res.status(404).json({ error: 'Program not found' });
    res.json(program);
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   ENROLL WORKER (with prerequisite check)
   ═══════════════════════════════════════════════════════════ */
router.post('/:id/enroll', authenticate, [
  param('id').isMongoId().withMessage('Invalid program ID'),
  body('workerId').isMongoId().withMessage('Valid worker ID required'),
  handleValidation,
], auditLog('TRAINING_ENROLL'), async (req, res, next) => {
  try {
    const { workerId } = req.body;

    const workerDoc = await Worker.findById(workerId);
    if (!workerDoc) return res.status(404).json({ error: 'Worker not found' });

    if (req.user.role === 'worker') {
      const ownWorker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!ownWorker || ownWorker._id.toString() !== workerId) {
        return res.status(403).json({ error: 'Access denied: workers can only enroll themselves' });
      }
    }

    // Check prerequisites
    const program = await Training.findById(req.params.id).select('prerequisites title');
    if (program?.prerequisites?.length > 0) {
      const prereqs = await Training.find({
        _id: { $in: program.prerequisites },
        'enrollments': { $elemMatch: { worker: workerId, status: 'completed' } },
      }).select('_id');
      if (prereqs.length < program.prerequisites.length) {
        return res.status(400).json({ error: 'Prerequisite courses not completed' });
      }
    }

    // Atomic enrollment with capacity check
    const result = await Training.findOneAndUpdate(
      {
        _id: req.params.id,
        'enrollments.worker': { $ne: workerId },
        // Guard against courses whose `enrollments`/`maxEnrollment` fields are
        // missing (seeded courses) — a bare $size on a missing field throws and
        // 500s, which blocked "Start Course" from ever enrolling.
        $expr: { $lt: [{ $size: { $ifNull: ['$enrollments', []] } }, { $ifNull: ['$maxEnrollment', 1000000] }] },
      },
      { $push: { enrollments: { worker: workerId } } },
      { new: true },
    );

    if (!result) {
      const existing = await Training.findById(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Program not found' });
      const alreadyEnrolled = existing.enrollments.find(e => e.worker.toString() === workerId);
      if (alreadyEnrolled) return res.status(409).json({ error: 'Already enrolled' });
      return res.status(400).json({ error: 'Program is full' });
    }

    // Add enrollment notification
    addNotification(result, workerId, 'enrollment',
      `You have been enrolled in "${result.title}". Start learning!`);
    await result.save();

    // xAPI: course registered
    emitCourseRegistered(workerId, result._id, result.title).catch(() => {});

    res.status(201).json({ message: 'Enrolled successfully' });
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   UPDATE PROGRESS
   ═══════════════════════════════════════════════════════════ */
router.put('/:id/progress', authenticate, [
  param('id').isMongoId().withMessage('Invalid program ID'),
  body('workerId').isMongoId().withMessage('Valid worker ID required'),
  body('progress').optional().isInt({ min: 0, max: 100 }).toInt(),
  body('preAssessmentScore').optional().isInt({ min: 0, max: 100 }).toInt(),
  handleValidation,
], async (req, res, next) => {
  try {
    const { workerId, moduleId, progress, preAssessmentScore, preAssessmentData } = req.body;

    if (req.user.role === 'worker') {
      const ownWorker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!ownWorker || ownWorker._id.toString() !== workerId) {
        return res.status(403).json({ error: 'Access denied: workers can only update own progress' });
      }
    }

    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });

    const enrollment = program.enrollments.find(e => e.worker.toString() === workerId);
    if (!enrollment) return res.status(404).json({ error: 'Not enrolled' });

    // Save pre-assessment results if provided
    if (preAssessmentScore !== undefined) {
      enrollment.preAssessmentScore = preAssessmentScore;
      if (preAssessmentData) enrollment.preAssessmentData = preAssessmentData;
    }

    if (moduleId && !enrollment.completedModules.some(id => id.toString() === String(moduleId))) {
      // Enforce sequential module order
      const sortedModules = [...program.modules].sort((a, b) => (a.order || 0) - (b.order || 0));
      const modIndex = sortedModules.findIndex(m => m._id.toString() === moduleId);
      if (modIndex > 0) {
        const prevModId = sortedModules[modIndex - 1]._id.toString();
        if (!enrollment.completedModules.map(id => id.toString()).includes(prevModId)) {
          return res.status(400).json({ error: 'Complete the previous module first' });
        }
      }

      // Enforce type-specific completion gates
      const mod = program.modules.id(moduleId);
      if (mod) {
        if (mod.type === 'quiz') {
          const passedAttempt = enrollment.quizAttempts.find(a => a.moduleId.toString() === moduleId && a.passed);
          if (!passedAttempt) {
            return res.status(400).json({ error: 'You must pass the quiz to complete this module' });
          }
        }
        if (mod.type === 'practical' || mod.type === 'assignment') {
          const approvedSub = enrollment.submissions.find(s => s.moduleId.toString() === moduleId && s.status === 'approved');
          if (!approvedSub) {
            return res.status(400).json({ error: 'Your submission must be approved to complete this module' });
          }
        }
        // ─── Knowledge check gate for video/reading modules ───
        if ((mod.type === 'video' || mod.type === 'reading') && mod.knowledgeCheckRequired && mod.knowledgeChecks?.length > 0) {
          const passedKc = enrollment.knowledgeCheckAttempts?.find(
            a => a.moduleId.toString() === moduleId && a.passed
          );
          if (!passedKc) {
            return res.status(400).json({ error: 'You must pass the knowledge check to complete this module' });
          }
        }
      }

      enrollment.completedModules.push(moduleId);
      enrollment.lastModuleId = moduleId;
      // mod already declared above at line 920
      if (mod) {
        addNotification(program, workerId, 'module-complete',
          `Module "${mod.title}" completed in "${program.title}".`);
        // Award XP for module completion
        awardXpAndUpdateProfile(workerId, 15, 'module-complete');
        // xAPI: module completed
        emitModuleCompleted(workerId, program._id, moduleId, mod.title).catch(() => {});
        // Issue unit micro-credential
        const worker = await Worker.findById(workerId);
        if (worker) autoIssueModuleCredential(program, enrollment, worker, moduleId).catch(() => {});
      }
    }
    enrollment.lastAccessedAt = new Date();
    enrollment.progress = progress || (program.modules.length > 0 ? Math.round(enrollment.completedModules.length / program.modules.length * 100) : 0);

    if (enrollment.progress >= 100 && enrollment.status !== 'completed') {
      enrollment.status = 'completed';
      enrollment.completedAt = new Date();

      addNotification(program, workerId, 'course-complete',
        `Congratulations! You have completed "${program.title}".`);
      // xAPI: course completed
      emitCourseCompleted(workerId, program._id, program.title).catch(() => {});

      // Auto-issue certificate on completion
      const worker = await Worker.findById(workerId);
      if (worker) {
        await autoIssueCertificate(program, enrollment, worker);
      }
    } else if (enrollment.progress < 100) {
      enrollment.status = 'in-progress';
    }

    await program.save();
    res.json(enrollment);
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   SUBMIT QUIZ
   ═══════════════════════════════════════════════════════════ */
router.post('/:id/quiz/:moduleId', authenticate, [
  param('id').isMongoId(),
  param('moduleId').isMongoId(),
  body('workerId').isMongoId(),
  body('answers').isArray({ min: 1 }),
  handleValidation,
], async (req, res, next) => {
  try {
    const { workerId, answers } = req.body;

    if (req.user.role === 'worker') {
      const ownWorker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!ownWorker || ownWorker._id.toString() !== workerId) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });

    const mod = program.modules.id(req.params.moduleId);
    if (!mod || mod.type !== 'quiz') return res.status(400).json({ error: 'Module is not a quiz' });

    const enrollment = program.enrollments.find(e => e.worker.toString() === workerId);
    if (!enrollment) return res.status(404).json({ error: 'Not enrolled' });

    // Pre/Post instrument: same questions taken as a blind 'pre' then a 'post'.
    const phase = mod.isPrePost ? (['pre', 'post'].includes(req.body.phase) ? req.body.phase : 'pre') : undefined;

    // Post can only be taken after the Pre baseline exists.
    if (phase === 'post') {
      const preDone = enrollment.quizAttempts?.some(x => x.moduleId?.toString() === mod._id.toString() && x.phase === 'pre');
      if (!preDone) return res.status(400).json({ error: 'Take the pre-test before the post-test.' });
    }

    // Single attempt per phase — no retry once submitted, UNLESS the training
    // allows retakes (training mode) and this is a plain quiz (not a blind pre/post).
    const retakeOk = program.retakesAllowed && !mod.isPrePost;
    const priorAttempt = enrollment.quizAttempts?.find(x => x.moduleId?.toString() === mod._id.toString() && (x.phase || null) === (phase || null));
    if (priorAttempt && !retakeOk) {
      return res.status(409).json({
        error: 'This assessment has already been submitted.', alreadySubmitted: true,
        score: priorAttempt.score, passed: priorAttempt.passed, phase,
        correctAnswers: priorAttempt.correctAnswers, totalQuestions: priorAttempt.totalQuestions,
        answers: phase === 'pre' ? undefined : priorAttempt.answers, hideAnswers: phase === 'pre', passMark: program.passMark || 70,
      });
    }

    // Adaptive quiz: select questions based on learner's difficulty level.
    // Fixed instruments (final assessment, blind pre/post, or a retake-enabled
    // training quiz) always present the full authored set in order — no subset
    // or reorder — so every learner sits the same complete assessment.
    let quizQuestions = mod.quizQuestions;
    const fixedInstrument = mod.isFinalAssessment || mod.isPrePost || program.retakesAllowed;
    if (!fixedInstrument && quizQuestions.some(q => q.difficulty)) {
      quizQuestions = selectAdaptiveQuestions(quizQuestions, enrollment.adaptiveData, null, program.competencyTargets);
    }

    // Grade written (answer-box) responses via the AI relay (batched, one call).
    const writtenGrades = await gradeWrittenAnswers(program, quizQuestions, answers, req.user._id);

    // Score the quiz — multi-type support
    const passMark = program.passMark || 70;
    const totalQuestions = quizQuestions.length;
    let totalPoints = 0;
    let earnedPoints = 0;
    const scoredAnswers = answers.map((a, i) => {
      const q = quizQuestions[i];
      if (!q) return { questionIndex: i, isCorrect: false, type: 'mcq', points: 1, difficulty: 'medium', competencyTag: null };
      const qType = q.type || 'mcq';
      const pts = q.points || 1;
      totalPoints += pts;
      let correct, aiFeedback;
      if ((qType === 'essay' || qType === 'short-answer') && writtenGrades && writtenGrades[i]) {
        const g = writtenGrades[i];
        correct = g.score >= 0.99 ? true : { partial: true, score: g.score };
        aiFeedback = g.feedback;
      } else {
        correct = scoreQuestion(q, a);
      }
      if (correct === true) {
        earnedPoints += pts;
      } else if (correct && typeof correct === 'object' && correct.partial) {
        earnedPoints += Math.round(correct.score * pts * 100) / 100;
      }
      return {
        questionIndex: i,
        selectedOption: a.selectedOption,
        correctOption: q.correctOption ?? -1,
        correctAnswer: q.correctAnswer ?? q.modelAnswer ?? (q.acceptableAnswers?.[0] ?? undefined),
        response: (qType === 'essay' || qType === 'short-answer') ? (a.answer ?? '') : undefined,
        explanation: q.explanation || '',
        aiFeedback,
        isCorrect: correct === true,
        partialScore: (correct && typeof correct === 'object' && correct.partial) ? correct.score : undefined,
        pending: correct === null, // essay with no fallback scoring
        type: qType,
        points: pts,
        difficulty: q.difficulty || 'medium',
        competencyTag: q.competencyTag || null,
      };
    });
    const correctAnswers = scoredAnswers.filter(a => a.isCorrect).length;
    const score = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0;
    const passed = score >= passMark;

    // Store quiz attempt (tagged with phase for pre/post instruments)
    enrollment.quizAttempts.push({
      moduleId: mod._id,
      score,
      correctAnswers,
      totalQuestions,
      passed,
      phase,
      answers: scoredAnswers,
    });

    // Learning gain: compare a 'post' submission to its 'pre' baseline.
    let learningGain = null;
    if (phase === 'post') {
      const pre = enrollment.quizAttempts.find(x => x.moduleId?.toString() === mod._id.toString() && x.phase === 'pre');
      if (pre) learningGain = { pre: pre.score, post: score, gain: score - pre.score };
    }

    // Update adaptive difficulty based on performance
    enrollment.adaptiveData = updateAdaptiveDifficulty(enrollment.adaptiveData, passed, score);

    // Update competency scores from quiz answers — but NOT from the pre-test
    // (competency/certificate grades must reflect post-training ability).
    if (phase !== 'pre') {
      const competencyUpdates = {};
      for (const ans of scoredAnswers) {
        if (ans.competencyTag) {
          if (!competencyUpdates[ans.competencyTag]) competencyUpdates[ans.competencyTag] = { correct: 0, total: 0 };
          competencyUpdates[ans.competencyTag].total += 1;
          if (ans.isCorrect) competencyUpdates[ans.competencyTag].correct += 1;
        }
      }
      for (const [skill, data] of Object.entries(competencyUpdates)) {
        const skillScore = Math.round(data.correct / data.total * 100);
        const existing = enrollment.competencyScores.find(c => c.skill === skill);
        if (existing) {
          existing.score = Math.round((existing.score * existing.assessments + skillScore) / (existing.assessments + 1));
          existing.assessments += 1;
        } else {
          enrollment.competencyScores.push({ skill, score: skillScore, assessments: 1 });
        }
      }
    }

    // If passed, mark module as complete (the pre-test never completes or gates —
    // it's a baseline; only the post-test / a plain quiz counts).
    if (passed && phase !== 'pre' && !enrollment.completedModules.some(id => id.toString() === mod._id.toString())) {
      enrollment.completedModules.push(mod._id);
      enrollment.progress = Math.round(enrollment.completedModules.length / program.modules.length * 100);

      addNotification(program, workerId, 'quiz-passed',
        `You passed the quiz in "${mod.title}" with ${score}%!`);

      // Award XP for passing quiz
      awardXpAndUpdateProfile(workerId, 25, 'quiz-passed', { score });

      // Issue unit micro-credential for quiz pass
      { const w = await Worker.findById(workerId); if (w) autoIssueModuleCredential(program, enrollment, w, mod._id).catch(() => {}); }

      if (enrollment.progress >= 100 && enrollment.status !== 'completed') {
        enrollment.status = 'completed';
        enrollment.completedAt = new Date();
        addNotification(program, workerId, 'course-complete',
          `Congratulations! You have completed "${program.title}".`);
        const worker = await Worker.findById(workerId);
        if (worker) {
          await autoIssueCertificate(program, enrollment, worker);
          awardXpAndUpdateProfile(workerId, 100, 'course-complete');
          awardXpAndUpdateProfile(workerId, 50, 'certificate-issued');
          // xAPI: course completed (via quiz pass)
          emitCourseCompleted(workerId, program._id, program.title).catch(() => {});
        }

        // Update pathway progress if this course belongs to a pathway
        if (program.pathway) {
          try {
            const pathway = await Pathway.findById(program.pathway);
            if (pathway) {
              const pwEnroll = pathway.enrollments.find(e => e.worker.toString() === workerId);
              if (pwEnroll && !pwEnroll.completedCourses.includes(program._id)) {
                pwEnroll.completedCourses.push(program._id);
                const reqCourses = pathway.courses.filter(c => c.required);
                const completedReq = reqCourses.filter(c =>
                  pwEnroll.completedCourses.some(cc => cc.toString() === c.training.toString())
                ).length;
                pwEnroll.progress = reqCourses.length > 0 ? Math.round(completedReq / reqCourses.length * 100) : 100;
                await pathway.save();
              }
            }
          } catch (e) { console.error('Pathway update error:', e.message); }
        }
      } else {
        enrollment.status = 'in-progress';
      }
    } else if (!passed) {
      addNotification(program, workerId, 'quiz-failed',
        `You scored ${score}% on "${mod.title}". Need ${passMark}% to pass. Try again!`);
      awardXpAndUpdateProfile(workerId, 5, 'quiz-failed', { score });
    }

    // A passing FINAL assessment is the completion gate: issue the certificate
    // directly (autoIssueCertificate still enforces the pass mark + gates), even
    // if some reading materials were not explicitly ticked complete.
    if (passed && phase !== 'pre' && (mod.isFinalAssessment || mod.isPrePost) && !enrollment.certificateIssued) {
      const w = await Worker.findById(workerId);
      if (w) {
        const r = await autoIssueCertificate(program, enrollment, w);
        if (r && !r.blocked && enrollment.status !== 'completed') {
          enrollment.status = 'completed';
          enrollment.completedAt = new Date();
          emitCourseCompleted(workerId, program._id, program.title).catch(() => {});
        }
      }
    }

    await program.save();

    // xAPI: quiz attempted + pass/fail
    emitQuizAttempted(workerId, program._id, mod._id, mod.title, score, passed).catch(() => {});

    // Relative score: percentile of this score across the cohort's attempts on this module.
    const peerScores = [];
    for (const e of program.enrollments) {
      if (e.worker.toString() === workerId) continue;
      const best = e.quizAttempts?.filter(x => x.moduleId?.toString() === mod._id.toString()).map(x => x.score);
      if (best?.length) peerScores.push(Math.max(...best));
    }
    let relative = null;
    if (peerScores.length >= 1) {
      const below = peerScores.filter(s => s < score).length;
      const avg = Math.round(peerScores.reduce((a, b) => a + b, 0) / peerScores.length);
      relative = { percentile: Math.round((below / peerScores.length) * 100), cohortAvg: avg, delta: score - avg, n: peerScores.length + 1 };
    }

    res.json({
      score,
      correctAnswers,
      totalQuestions,
      passed,
      passMark,
      relative,
      phase,
      learningGain,
      // Pre-test is blind: never reveal the answer key (prevents coaching the post-test).
      hideAnswers: phase === 'pre',
      moduleTitle: mod.title,
      answers: phase === 'pre' ? undefined : scoredAnswers,
      adaptiveDifficulty: enrollment.adaptiveData.quizDifficultyLevel,
      competencyScores: enrollment.competencyScores,
    });
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   INTERACTIVE EXERCISES (PRACTICE)
   Ungraded drills with instant per-question feedback + explanations and
   unlimited retries. Scoring never touches enrollment/progress/certificate.
   ═══════════════════════════════════════════════════════════ */

// Learner submits practice answers → instant feedback (no persistence).
router.post('/:id/practice/:practiceId/check', authenticate, [
  param('id').isMongoId(),
  param('practiceId').isMongoId(),
  body('answers').isArray({ min: 1 }),
  handleValidation,
], async (req, res, next) => {
  try {
    const program = await Training.findById(req.params.id).select('practiceSets');
    if (!program) return res.status(404).json({ error: 'Program not found' });

    const set = program.practiceSets.id(req.params.practiceId);
    if (!set) return res.status(404).json({ error: 'Practice set not found' });

    const questions = set.questions || [];
    const scored = questions.map((q, i) => {
      const a = req.body.answers[i] || {};
      const result = scoreQuestion(q, a);
      const isCorrect = result === true;
      const partialScore = (result && typeof result === 'object' && result.partial) ? result.score : undefined;
      return {
        questionIndex: i,
        isCorrect,
        partialScore,
        pending: result === null,
        type: q.type || 'mcq',
        correctOption: q.correctOption ?? undefined,
        correctAnswer: q.correctAnswer ?? (q.acceptableAnswers?.[0] ?? undefined),
        explanation: q.explanation || '',
      };
    });
    const correct = scored.filter(s => s.isCorrect).length;
    res.json({
      total: questions.length,
      correct,
      score: questions.length ? Math.round((correct / questions.length) * 100) : 0,
      answers: scored,
    });
  } catch (err) { next(err); }
});

// Learner submits an exercise for a recorded, single-attempt score (no retry).
// Scores MCQ automatically and written answers via the AI relay.
router.post('/:id/practice/:practiceId/submit', authenticate, [
  param('id').isMongoId(),
  param('practiceId').isMongoId(),
  body('response').optional().isString().isLength({ max: 12000 }),
  body('answers').optional().isArray(),
  handleValidation,
], async (req, res, next) => {
  try {
    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });
    const set = program.practiceSets.id(req.params.practiceId);
    if (!set) return res.status(404).json({ error: 'Exercise not found' });

    // Resolve the requesting worker + enrollment.
    let workerId = req.body.workerId;
    if (req.user.role === 'worker') {
      const own = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!own) return res.status(403).json({ error: 'Worker profile not found' });
      workerId = own._id.toString();
    }
    const enrollment = program.enrollments.find(e => e.worker.toString() === String(workerId));
    if (!enrollment) return res.status(404).json({ error: 'Not enrolled' });

    // Single attempt — no retry.
    const prior = enrollment.exerciseResults?.find(r => r.practiceId?.toString() === set._id.toString());
    if (prior) {
      return res.status(409).json({ error: 'This exercise has already been submitted.', alreadySubmitted: true,
        score: prior.score, response: prior.response, feedback: prior.feedback, wrong: prior.wrong,
        correctAnswers: prior.correctAnswers, totalQuestions: prior.totalQuestions, answers: prior.perQuestion });
    }

    // ── Content-based exercise: grade the single written reply via the relay ──
    const hasResponse = typeof req.body.response === 'string';
    if ((set.content && set.content.trim()) || hasResponse) {
      const response = (req.body.response || '').toString().trim();
      if (!response) return res.status(400).json({ error: 'Write a reply before submitting.' });
      const graded = await gradeExerciseResponse(program, set, response, req.user._id);
      const score = graded.score;
      enrollment.exerciseResults.push({ practiceId: set._id, score, response, feedback: graded.feedback, wrong: graded.wrong, totalQuestions: 1, correctAnswers: score >= 50 ? 1 : 0 });
      await program.save();
      const peers0 = program.enrollments.filter(e => e.worker.toString() !== String(workerId))
        .map(e => e.exerciseResults?.find(r => r.practiceId?.toString() === set._id.toString())?.score).filter(s => s != null);
      let relative0 = null;
      if (peers0.length >= 1) { const below = peers0.filter(s => s < score).length; const avg = Math.round(peers0.reduce((a, b) => a + b, 0) / peers0.length);
        relative0 = { percentile: Math.round((below / peers0.length) * 100), cohortAvg: avg, delta: score - avg, n: peers0.length + 1 }; }
      return res.json({ score, feedback: graded.feedback, wrong: graded.wrong, relative: relative0, moduleTitle: set.title, response });
    }

    // ── Legacy question-based exercise ──
    if (!Array.isArray(req.body.answers) || !req.body.answers.length) return res.status(400).json({ error: 'No answers submitted' });
    const questions = set.questions || [];
    const written = await gradeWrittenAnswers(program, questions, req.body.answers, req.user._id);
    let totalPoints = 0, earned = 0;
    const perQuestion = questions.map((q, i) => {
      const a = req.body.answers[i] || {};
      const qType = q.type || 'mcq';
      const pts = q.points || 1; totalPoints += pts;
      let result, aiFeedback;
      if ((qType === 'essay' || qType === 'short-answer') && written && written[i]) {
        result = written[i].score >= 0.99 ? true : { partial: true, score: written[i].score };
        aiFeedback = written[i].feedback;
      } else result = scoreQuestion(q, a);
      const frac = result === true ? 1 : (result && typeof result === 'object' && result.partial ? result.score : 0);
      earned += frac * pts;
      return {
        questionIndex: i, isCorrect: result === true, score: Math.round(frac * 100),
        correctText: qType === 'mcq' ? (q.options?.[q.correctOption] ?? '') : (q.correctAnswer ?? q.modelAnswer ?? q.acceptableAnswers?.[0] ?? ''),
        explanation: q.explanation || '', aiFeedback,
        response: (qType === 'essay' || qType === 'short-answer') ? (a.answer ?? '') : undefined, type: qType,
      };
    });
    const score = totalPoints > 0 ? Math.round((earned / totalPoints) * 100) : 0;
    const correctAnswers = perQuestion.filter(p => p.isCorrect).length;

    enrollment.exerciseResults.push({ practiceId: set._id, score, correctAnswers, totalQuestions: questions.length, perQuestion });
    // Feed competency scores from exercise answers (drives certificate grades).
    for (let i = 0; i < questions.length; i++) {
      const tag = questions[i].competencyTag; if (!tag) continue;
      const frac = perQuestion[i].score / 100;
      const existing = enrollment.competencyScores.find(c => c.skill === tag);
      if (existing) { existing.score = Math.round((existing.score * existing.assessments + frac * 100) / (existing.assessments + 1)); existing.assessments += 1; }
      else enrollment.competencyScores.push({ skill: tag, score: Math.round(frac * 100), assessments: 1 });
    }
    await program.save();

    // Relative percentile vs peers on this exercise.
    const peers = program.enrollments.filter(e => e.worker.toString() !== String(workerId))
      .map(e => e.exerciseResults?.find(r => r.practiceId?.toString() === set._id.toString())?.score).filter(s => s != null);
    let relative = null;
    if (peers.length >= 1) { const below = peers.filter(s => s < score).length; const avg = Math.round(peers.reduce((a, b) => a + b, 0) / peers.length);
      relative = { percentile: Math.round((below / peers.length) * 100), cohortAvg: avg, delta: score - avg, n: peers.length + 1 }; }

    res.json({ score, correctAnswers, totalQuestions: questions.length, relative, moduleTitle: set.title, answers: perQuestion });
  } catch (err) { next(err); }
});

// Staff: archive / restore a course (archived courses drop out of the active
// catalog but are kept and can be restored or deleted from the Archived tab).
router.patch('/:id/archive', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId(), handleValidation,
], async (req, res, next) => {
  try {
    const t = await Training.findById(req.params.id);
    if (!t) return res.status(404).json({ error: 'Course not found' });
    t.status = req.body.archived === false ? 'active' : 'archived';
    await t.save();
    res.json({ ok: true, status: t.status });
  } catch (err) { next(err); }
});

// Staff: permanently delete a course (and its exam attempts).
router.delete('/:id', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId(), handleValidation,
], async (req, res, next) => {
  try {
    const t = await Training.findById(req.params.id);
    if (!t) return res.status(404).json({ error: 'Course not found' });
    await ExamAttempt.deleteMany({ training: t._id }).catch(() => {});
    await Training.deleteOne({ _id: t._id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Staff: create a practice set.
router.post('/:id/practice', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId(),
  body('title').trim().notEmpty().isLength({ max: 200 }),
  body('questions').optional().isArray(),
  handleValidation,
], async (req, res, next) => {
  try {
    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });
    program.practiceSets.push({
      title: req.body.title,
      description: req.body.description || '',
      content: req.body.content || '',
      scoringCriteria: req.body.scoringCriteria || '',
      order: req.body.order ?? program.practiceSets.length,
      questions: Array.isArray(req.body.questions) ? req.body.questions : [],
    });
    await program.save();
    res.status(201).json(program.practiceSets[program.practiceSets.length - 1]);
  } catch (err) { next(err); }
});

// Staff: update a practice set (title/description/questions).
router.put('/:id/practice/:practiceId', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId(),
  param('practiceId').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });
    const set = program.practiceSets.id(req.params.practiceId);
    if (!set) return res.status(404).json({ error: 'Practice set not found' });
    if (req.body.title !== undefined) set.title = req.body.title;
    if (req.body.description !== undefined) set.description = req.body.description;
    if (req.body.content !== undefined) set.content = req.body.content;
    if (req.body.scoringCriteria !== undefined) set.scoringCriteria = req.body.scoringCriteria;
    if (req.body.order !== undefined) set.order = req.body.order;
    if (Array.isArray(req.body.questions)) set.questions = req.body.questions;
    await program.save();
    res.json(set);
  } catch (err) { next(err); }
});

// Staff: delete a practice set.
router.delete('/:id/practice/:practiceId', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId(),
  param('practiceId').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });
    const set = program.practiceSets.id(req.params.practiceId);
    if (!set) return res.status(404).json({ error: 'Practice set not found' });
    set.deleteOne();
    await program.save();
    res.json({ success: true });
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   MATERIAL LIBRARY — uploaded, downloadable course resources
   ═══════════════════════════════════════════════════════════ */

// Staff: upload one or more resource files into the training's library.
router.post('/:id/resources', authenticate, authorize('admin', 'institution'),
  materialUpload.array('files', 10), [
    param('id').isMongoId(),
    handleValidation,
  ], async (req, res, next) => {
    try {
      const program = await Training.findById(req.params.id);
      if (!program) return res.status(404).json({ error: 'Program not found' });
      const category = req.body.category || 'general';
      const added = (req.files || []).map(f => ({
        name: f.originalname,
        url: `/api/uploads/${f.filename}`,
        size: f.size,
        mimetype: f.mimetype,
        category,
      }));
      if (!added.length) return res.status(400).json({ error: 'No files uploaded' });
      program.resources.push(...added);
      await program.save();
      res.status(201).json(program.resources.slice(-added.length));
    } catch (err) { next(err); }
  });

// Staff: upload a signature image → returns its URL (for a certificate signatory).
router.post('/:id/signature', authenticate, authorize('admin', 'institution'),
  materialUpload.single('file'), [
    param('id').isMongoId(),
    handleValidation,
  ], async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      res.status(201).json({ url: `/api/uploads/${req.file.filename}` });
    } catch (err) { next(err); }
  });

// Staff: remove a resource from the library.
router.delete('/:id/resources/:resourceId', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId(),
  param('resourceId').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });
    const r = program.resources.id(req.params.resourceId);
    if (!r) return res.status(404).json({ error: 'Resource not found' });
    r.deleteOne();
    await program.save();
    res.json({ success: true });
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   QUESTION BANK — reusable pooled questions + exam assembly
   ═══════════════════════════════════════════════════════════ */

// Staff: append question(s) to the bank.
router.post('/:id/question-bank', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId(),
  body('questions').isArray({ min: 1 }),
  handleValidation,
], async (req, res, next) => {
  try {
    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });
    program.questionBank.push(...req.body.questions);
    await program.save();
    res.status(201).json(program.questionBank);
  } catch (err) { next(err); }
});

// Staff: delete a bank question.
router.delete('/:id/question-bank/:questionId', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId(),
  param('questionId').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });
    const q = program.questionBank.id(req.params.questionId);
    if (!q) return res.status(404).json({ error: 'Question not found' });
    q.deleteOne();
    await program.save();
    res.json({ success: true });
  } catch (err) { next(err); }
});

// Staff: assemble N randomly-sampled bank questions (optionally filtered by
// difficulty / competency) into a quiz module's quizQuestions.
router.post('/:id/modules/:moduleId/assemble', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId(),
  param('moduleId').isMongoId(),
  body('count').isInt({ min: 1, max: 100 }),
  handleValidation,
], async (req, res, next) => {
  try {
    const { count, difficulty, competencyTag } = req.body;
    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });
    const mod = program.modules.id(req.params.moduleId);
    if (!mod || mod.type !== 'quiz') return res.status(400).json({ error: 'Module is not a quiz' });

    let pool = program.questionBank.filter(q =>
      (!difficulty || q.difficulty === difficulty) &&
      (!competencyTag || q.competencyTag === competencyTag));
    if (!pool.length) return res.status(400).json({ error: 'No matching questions in the bank' });

    // Fisher–Yates shuffle, then take `count`.
    const shuffled = pool.map(q => (q.toObject ? q.toObject() : q));
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const picked = shuffled.slice(0, Math.min(count, shuffled.length))
      .map(({ _id, ...rest }) => rest);   // drop bank _id so module questions are standalone
    mod.quizQuestions = picked;
    await program.save();
    res.json({ assembled: picked.length, moduleId: mod._id });
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   MODULE CRUD
   ═══════════════════════════════════════════════════════════ */
router.post('/:id/modules', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId(),
  body('title').trim().notEmpty().isLength({ max: 200 }),
  body('type').isIn(['video', 'reading', 'quiz', 'practical', 'assignment', 'scenario', 'scorm']),
  body('description').optional().trim().isLength({ max: 2000 }),
  body('duration').optional().isInt({ min: 1, max: 600 }).toInt(),
  body('videoUrl').optional().trim(),
  body('content').optional().trim().isLength({ max: 10000 }),
  body('quizQuestions').optional().isArray(),
  body('deadline').optional().isISO8601(),
  handleValidation,
], auditLog('MODULE_CREATE'), async (req, res, next) => {
  try {
    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });

    const maxOrder = program.modules.reduce((m, mod) => Math.max(m, mod.order || 0), 0);
    const newModule = {
      ...req.body,
      order: req.body.order || maxOrder + 1,
    };
    program.modules.push(newModule);
    await program.save();

    const added = program.modules[program.modules.length - 1];
    res.status(201).json(added);
  } catch (err) { next(err); }
});

router.put('/:id/modules/:moduleId', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId(),
  param('moduleId').isMongoId(),
  body('title').optional().trim().isLength({ max: 200 }),
  body('type').optional().isIn(['video', 'reading', 'quiz', 'practical', 'assignment', 'scenario', 'scorm']),
  body('description').optional().trim().isLength({ max: 2000 }),
  body('duration').optional().isInt({ min: 1, max: 600 }).toInt(),
  body('videoUrl').optional().trim(),
  body('content').optional().trim().isLength({ max: 10000 }),
  body('quizQuestions').optional().isArray(),
  body('deadline').optional().isISO8601(),
  handleValidation,
], auditLog('MODULE_UPDATE'), async (req, res, next) => {
  try {
    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });

    const mod = program.modules.id(req.params.moduleId);
    if (!mod) return res.status(404).json({ error: 'Module not found' });

    const allowed = ['title', 'type', 'description', 'duration', 'videoUrl', 'content', 'quizQuestions', 'order', 'deadline', 'knowledgeChecks', 'knowledgeCheckRequired', 'knowledgeCheckPassMark', 'rubricTemplate', 'rubricRequired', 'isPreAssessment', 'isFinalAssessment', 'scenario', 'competencies'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) mod[key] = req.body[key];
    }
    await program.save();
    res.json(mod);
  } catch (err) { next(err); }
});

router.delete('/:id/modules/:moduleId', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId(),
  param('moduleId').isMongoId(),
  handleValidation,
], auditLog('MODULE_DELETE'), async (req, res, next) => {
  try {
    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });

    const mod = program.modules.id(req.params.moduleId);
    if (!mod) return res.status(404).json({ error: 'Module not found' });

    mod.deleteOne();
    await program.save();
    res.json({ message: 'Module deleted' });
  } catch (err) { next(err); }
});

router.put('/:id/modules-reorder', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId(),
  body('order').isArray({ min: 1 }),
  handleValidation,
], async (req, res, next) => {
  try {
    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });

    const { order } = req.body;
    for (let i = 0; i < order.length; i++) {
      const mod = program.modules.id(order[i]);
      if (mod) mod.order = i + 1;
    }
    await program.save();
    res.json(program.modules.sort((a, b) => (a.order || 0) - (b.order || 0)));
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   SCENARIO MODULE COMPLETION
   ═══════════════════════════════════════════════════════════ */
router.post('/:id/scenario/:moduleId', authenticate, [
  param('id').isMongoId(),
  param('moduleId').isMongoId(),
  body('workerId').isMongoId(),
  body('choices').isArray({ min: 1 }),
  handleValidation,
], async (req, res, next) => {
  try {
    const { workerId, choices } = req.body;

    if (req.user.role === 'worker') {
      const ownWorker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!ownWorker || ownWorker._id.toString() !== workerId) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });

    const mod = program.modules.id(req.params.moduleId);
    if (!mod || mod.type !== 'scenario') return res.status(400).json({ error: 'Module is not a scenario' });

    const enrollment = program.enrollments.find(e => e.worker.toString() === workerId);
    if (!enrollment) return res.status(404).json({ error: 'Not enrolled' });

    // Calculate scenario score
    let totalScore = 0;
    const maxScore = mod.scenario?.maxScore || 100;
    const feedbackList = [];

    for (const choice of choices) {
      const step = mod.scenario.steps.find(s => s.stepId === choice.stepId);
      if (step && step.choices[choice.choiceIndex]) {
        const chosenOption = step.choices[choice.choiceIndex];
        totalScore += chosenOption.scoreImpact || 0;
        feedbackList.push({
          stepId: choice.stepId,
          chosen: chosenOption.text,
          isOptimal: chosenOption.isOptimal || false,
          feedback: chosenOption.feedback || '',
        });
      }
    }

    const normalizedScore = Math.max(0, Math.min(100, Math.round((totalScore / maxScore) * 100)));
    const passed = normalizedScore >= (mod.scenario?.passingScore || 60);

    enrollment.scenarioResults.push({
      moduleId: mod._id,
      score: normalizedScore,
      maxScore,
      passed,
      choicesMade: choices,
    });

    if (passed && !enrollment.completedModules.some(id => id.toString() === mod._id.toString())) {
      enrollment.completedModules.push(mod._id);
      enrollment.progress = Math.round(enrollment.completedModules.length / program.modules.length * 100);
      enrollment.status = enrollment.progress >= 100 ? 'completed' : 'in-progress';

      addNotification(program, workerId, 'module-complete',
        `Scenario "${mod.title}" completed with ${normalizedScore}% in "${program.title}".`);
      awardXpAndUpdateProfile(workerId, 30, 'module-complete');
      // xAPI: scenario module completed
      emitModuleCompleted(workerId, program._id, mod._id, mod.title).catch(() => {});

      if (enrollment.progress >= 100 && enrollment.status === 'completed') {
        enrollment.completedAt = new Date();
        addNotification(program, workerId, 'course-complete',
          `Congratulations! You have completed "${program.title}".`);
        const worker = await Worker.findById(workerId);
        if (worker) {
          await autoIssueCertificate(program, enrollment, worker);
          awardXpAndUpdateProfile(workerId, 100, 'course-complete');
          // xAPI: course completed (via scenario)
          emitCourseCompleted(workerId, program._id, program.title).catch(() => {});
        }
      }
    }

    // Update competencies from scenario
    if (mod.competencies?.length > 0) {
      for (const comp of mod.competencies) {
        const existing = enrollment.competencyScores.find(c => c.skill === comp.skill);
        const compScore = Math.round(normalizedScore * (comp.weight || 1));
        if (existing) {
          existing.score = Math.round((existing.score * existing.assessments + compScore) / (existing.assessments + 1));
          existing.assessments += 1;
        } else {
          enrollment.competencyScores.push({ skill: comp.skill, score: compScore, assessments: 1 });
        }
      }
    }

    await program.save();

    res.json({
      score: normalizedScore,
      maxScore,
      passed,
      passingScore: mod.scenario?.passingScore || 60,
      feedback: feedbackList,
      competencyScores: enrollment.competencyScores,
    });
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   PER-MODULE PRE-CHECK (skip-test)
   ═══════════════════════════════════════════════════════════ */
router.post('/:id/pre-check/:moduleId', authenticate, [
  param('id').isMongoId(),
  param('moduleId').isMongoId(),
  body('workerId').isMongoId(),
  body('answers').isArray({ min: 1 }),
  handleValidation,
], async (req, res, next) => {
  try {
    const { workerId, answers } = req.body;

    if (req.user.role === 'worker') {
      const ownWorker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!ownWorker || ownWorker._id.toString() !== workerId) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });

    const mod = program.modules.id(req.params.moduleId);
    if (!mod || !mod.preCheckQuestions?.length) {
      return res.status(400).json({ error: 'Module has no pre-check questions' });
    }

    const enrollment = program.enrollments.find(e => e.worker.toString() === workerId);
    if (!enrollment) return res.status(404).json({ error: 'Not enrolled' });

    // Already completed this module
    if (enrollment.completedModules.map(id => id.toString()).includes(req.params.moduleId)) {
      return res.status(400).json({ error: 'Module already completed' });
    }

    // Score answers
    const passMark = program.passMark || 70;
    let correct = 0;
    const total = mod.preCheckQuestions.length;
    for (let i = 0; i < total; i++) {
      const q = mod.preCheckQuestions[i];
      if (q && answers[i] !== undefined && Number(answers[i]) === q.correctOption) {
        correct++;
      }
    }
    const score = total > 0 ? Math.round((correct / total) * 100) : 0;
    const passed = score >= passMark;

    // Store pre-check result
    enrollment.modulePreChecks.push({
      moduleId: mod._id,
      score,
      passed,
    });

    if (passed) {
      // Skip the module
      enrollment.completedModules.push(mod._id);
      enrollment.skippedViaPreCheck.push(mod._id);
      enrollment.progress = Math.round(enrollment.completedModules.length / program.modules.length * 100);

      addNotification(program, workerId, 'module-complete',
        `You skipped "${mod.title}" via pre-check with ${score}%!`);
      awardXpAndUpdateProfile(workerId, 20, 'module-complete');
      emitModuleCompleted(workerId, program._id, mod._id, mod.title).catch(() => {});

      // Issue unit micro-credential for pre-check skip
      const workerDoc = await Worker.findById(workerId);
      if (workerDoc) autoIssueModuleCredential(program, enrollment, workerDoc, mod._id).catch(() => {});

      // Check course completion
      if (enrollment.progress >= 100 && enrollment.status !== 'completed') {
        enrollment.status = 'completed';
        enrollment.completedAt = new Date();
        addNotification(program, workerId, 'course-complete',
          `Congratulations! You have completed "${program.title}".`);
        const worker = await Worker.findById(workerId);
        if (worker) {
          await autoIssueCertificate(program, enrollment, worker);
          awardXpAndUpdateProfile(workerId, 100, 'course-complete');
          emitCourseCompleted(workerId, program._id, program.title).catch(() => {});
        }
      } else if (enrollment.progress < 100) {
        enrollment.status = 'in-progress';
      }
    }

    await program.save();

    res.json({
      score,
      correct,
      total,
      passed,
      passMark,
      skipped: passed,
    });
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   LOG MODULE TIME (for time tracking)
   ═══════════════════════════════════════════════════════════ */
router.put('/:id/time-log', authenticate, [
  param('id').isMongoId(),
  body('workerId').isMongoId(),
  body('moduleId').isMongoId(),
  body('minutesSpent').isInt({ min: 1, max: 300 }).toInt(),
  handleValidation,
], async (req, res, next) => {
  try {
    const { workerId, moduleId, minutesSpent } = req.body;
    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });

    const enrollment = program.enrollments.find(e => e.worker.toString() === workerId);
    if (!enrollment) return res.status(404).json({ error: 'Not enrolled' });

    const existing = enrollment.moduleTimeLog.find(t => t.moduleId.toString() === moduleId);
    if (existing) {
      existing.timeSpentMinutes += minutesSpent;
    } else {
      enrollment.moduleTimeLog.push({ moduleId, startedAt: new Date(), timeSpentMinutes: minutesSpent });
    }
    enrollment.totalTimeSpentMinutes = (enrollment.totalTimeSpentMinutes || 0) + minutesSpent;

    await program.save();
    res.json({ totalTimeSpentMinutes: enrollment.totalTimeSpentMinutes });
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   FLAG MODULE AS STALE (instructor/admin)
   ═══════════════════════════════════════════════════════════ */
router.put('/:id/modules/:moduleId/flag-stale', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId(),
  param('moduleId').isMongoId(),
  body('flaggedStale').isBoolean(),
  body('stalenessNotes').optional().trim().isLength({ max: 500 }),
  handleValidation,
], async (req, res, next) => {
  try {
    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });
    const mod = program.modules.id(req.params.moduleId);
    if (!mod) return res.status(404).json({ error: 'Module not found' });

    mod.flaggedStale = req.body.flaggedStale;
    mod.stalenessNotes = req.body.stalenessNotes || '';
    if (!req.body.flaggedStale) mod.lastReviewedAt = new Date();

    await program.save();
    res.json(mod);
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   DISCUSSIONS
   ═══════════════════════════════════════════════════════════ */
router.post('/:id/discussions', authenticate, [
  param('id').isMongoId(),
  body('message').trim().notEmpty().isLength({ max: 2000 }),
  body('moduleId').optional().isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });

    program.discussions.push({
      author: req.user._id,
      authorName: req.user.name,
      authorRole: req.user.role,
      moduleId: req.body.moduleId || undefined,
      message: req.body.message,
    });
    await program.save();

    const added = program.discussions[program.discussions.length - 1];
    res.status(201).json(added);
  } catch (err) { next(err); }
});

router.post('/:id/discussions/:discussionId/reply', authenticate, [
  param('id').isMongoId(),
  param('discussionId').isMongoId(),
  body('message').trim().notEmpty().isLength({ max: 1000 }),
  handleValidation,
], async (req, res, next) => {
  try {
    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });

    const discussion = program.discussions.id(req.params.discussionId);
    if (!discussion) return res.status(404).json({ error: 'Discussion not found' });

    discussion.replies.push({
      author: req.user._id,
      authorName: req.user.name,
      authorRole: req.user.role,
      message: req.body.message,
    });

    // Notify the original author if different
    if (discussion.author.toString() !== req.user._id.toString()) {
      // Find the worker ID for the discussion author
      const authorWorker = await Worker.findOne({ user: discussion.author }).select('_id');
      if (authorWorker) {
        addNotification(program, authorWorker._id, 'discussion-reply',
          `${req.user.name} replied to your discussion in "${program.title}".`);
      }
    }

    await program.save();
    res.status(201).json(discussion);
  } catch (err) { next(err); }
});

// Pin/unpin discussion (admin only)
router.put('/:id/discussions/:discussionId/pin', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId(),
  param('discussionId').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });

    const discussion = program.discussions.id(req.params.discussionId);
    if (!discussion) return res.status(404).json({ error: 'Discussion not found' });

    discussion.pinned = !discussion.pinned;
    await program.save();
    res.json(discussion);
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   ANNOUNCEMENTS
   ═══════════════════════════════════════════════════════════ */
router.post('/:id/announcements', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId(),
  body('title').trim().notEmpty().isLength({ max: 200 }),
  body('message').trim().notEmpty().isLength({ max: 3000 }),
  body('priority').optional().isIn(['normal', 'important', 'urgent']),
  handleValidation,
], auditLog('ANNOUNCEMENT_CREATE'), async (req, res, next) => {
  try {
    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });

    program.announcements.push({
      author: req.user._id,
      authorName: req.user.name,
      title: req.body.title,
      message: req.body.message,
      priority: req.body.priority || 'normal',
    });

    // Notify all enrolled workers
    for (const enrollment of program.enrollments) {
      addNotification(program, enrollment.worker, 'announcement',
        `New announcement in "${program.title}": ${req.body.title}`);
    }

    await program.save();
    const added = program.announcements[program.announcements.length - 1];
    res.status(201).json(added);
  } catch (err) { next(err); }
});

router.delete('/:id/announcements/:announcementId', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId(),
  param('announcementId').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });

    const ann = program.announcements.id(req.params.announcementId);
    if (!ann) return res.status(404).json({ error: 'Announcement not found' });

    ann.deleteOne();
    await program.save();
    res.json({ message: 'Announcement deleted' });
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   RATINGS & REVIEWS
   ═══════════════════════════════════════════════════════════ */
router.post('/:id/ratings', authenticate, [
  param('id').isMongoId(),
  body('score').isInt({ min: 1, max: 5 }).toInt(),
  body('review').optional().trim().isLength({ max: 500 }),
  handleValidation,
], async (req, res, next) => {
  try {
    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });

    // Only enrolled workers can rate
    let workerId;
    if (req.user.role === 'worker') {
      const worker = await Worker.findOne({ user: req.user._id }).select('_id name');
      if (!worker) return res.status(403).json({ error: 'Worker profile not found' });
      workerId = worker._id;

      const enrollment = program.enrollments.find(e => e.worker.toString() === workerId.toString());
      if (!enrollment) return res.status(403).json({ error: 'Must be enrolled to rate' });

      // Check if already rated — update existing
      const existing = program.ratings.find(r => r.worker.toString() === workerId.toString());
      if (existing) {
        existing.score = req.body.score;
        existing.review = req.body.review || existing.review;
        existing.createdAt = new Date();
      } else {
        program.ratings.push({
          worker: workerId,
          workerName: worker.name || req.user.name,
          score: req.body.score,
          review: req.body.review,
        });
      }
    } else {
      return res.status(403).json({ error: 'Only workers can rate courses' });
    }

    await program.save();
    res.json({ avgRating: program.avgRating, totalRatings: program.ratings.length });
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   BOOKMARK TOGGLE
   ═══════════════════════════════════════════════════════════ */
router.put('/:id/bookmark', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });

    let workerId;
    if (req.user.role === 'worker') {
      const worker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!worker) return res.status(403).json({ error: 'Worker not found' });
      workerId = worker._id;
    } else {
      return res.status(403).json({ error: 'Only workers can bookmark' });
    }

    const enrollment = program.enrollments.find(e => e.worker.toString() === workerId.toString());
    if (!enrollment) return res.status(404).json({ error: 'Not enrolled' });

    enrollment.bookmarked = !enrollment.bookmarked;
    await program.save();
    res.json({ bookmarked: enrollment.bookmarked });
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   ASSIGNMENT SUBMISSION
   ═══════════════════════════════════════════════════════════ */
router.post('/:id/submit/:moduleId', authenticate, trainingUpload.array('files', 5), [
  param('id').isMongoId(),
  param('moduleId').isMongoId(),
  body('workerId').isMongoId(),
  body('notes').optional().trim().isLength({ max: 1000 }),
  body('evidenceType').optional().isIn(['photo-of-work', 'video-demonstration', 'supervisor-signoff', 'other']),
  handleValidation,
], async (req, res, next) => {
  try {
    const { workerId, notes, evidenceType } = req.body;

    if (req.user.role === 'worker') {
      const ownWorker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!ownWorker || ownWorker._id.toString() !== workerId) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });

    const mod = program.modules.id(req.params.moduleId);
    if (!mod || !['practical', 'assignment'].includes(mod.type)) {
      return res.status(400).json({ error: 'Module does not accept submissions' });
    }

    const enrollment = program.enrollments.find(e => e.worker.toString() === workerId);
    if (!enrollment) return res.status(404).json({ error: 'Not enrolled' });

    // Map uploaded files to { name, url, size }
    const files = (req.files || []).map(f => ({
      name: f.originalname,
      url: `/api/uploads/${f.filename}`,
      size: f.size,
    }));

    enrollment.submissions.push({
      worker: workerId,
      moduleId: mod._id,
      notes: notes || '',
      evidenceType: evidenceType || 'other',
      files,
    });

    await program.save();
    res.status(201).json({ message: 'Submission received', filesUploaded: files.length });
  } catch (err) { next(err); }
});

// Review submission (admin/instructor) — with rubric scoring support
router.put('/:id/submissions/:submissionId/review', authenticate, authorize('admin', 'institution', 'assessor'), [
  param('id').isMongoId(),
  param('submissionId').isMongoId(),
  body('status').isIn(['approved', 'rejected']),
  body('feedback').optional().trim().isLength({ max: 1000 }),
  body('grade').optional().isInt({ min: 0, max: 100 }).toInt(),
  body('rubricScores').optional().isArray(),
  body('rubricScores.*.criterion').optional().trim().notEmpty(),
  body('rubricScores.*.score').optional().isInt({ min: 0, max: 10 }).toInt(),
  body('rubricScores.*.notes').optional().trim().isLength({ max: 500 }),
  handleValidation,
], async (req, res, next) => {
  try {
    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });

    let foundSubmission = null;
    let foundEnrollment = null;
    for (const enrollment of program.enrollments) {
      const sub = enrollment.submissions?.id(req.params.submissionId);
      if (sub) {
        foundSubmission = sub;
        foundEnrollment = enrollment;
        break;
      }
    }

    if (!foundSubmission) return res.status(404).json({ error: 'Submission not found' });

    // ─── Rubric scoring ───
    if (req.body.rubricScores && req.body.rubricScores.length > 0) {
      foundSubmission.rubricScores = req.body.rubricScores;
      const rubricSum = req.body.rubricScores.reduce((s, r) => s + (r.score || 0), 0);
      // Get max score from module rubric template, default to 4
      const mod = program.modules.id(foundSubmission.moduleId);
      const maxPerCriterion = mod?.rubricTemplate?.[0]?.maxScore || 4;
      const rubricMax = req.body.rubricScores.length * maxPerCriterion;
      foundSubmission.rubricTotal = rubricSum;
      foundSubmission.rubricMaxTotal = rubricMax;
      foundSubmission.rubricPercentage = rubricMax > 0 ? Math.round(rubricSum / rubricMax * 100) : 0;

      // Use rubric percentage as grade if no manual grade provided
      if (req.body.grade == null) {
        foundSubmission.grade = foundSubmission.rubricPercentage;
      } else {
        foundSubmission.grade = req.body.grade;
      }
    } else {
      foundSubmission.grade = req.body.grade;
    }

    foundSubmission.status = req.body.status;
    foundSubmission.feedback = req.body.feedback || '';
    foundSubmission.reviewedAt = new Date();
    foundSubmission.reviewedBy = req.user._id;

    // Notify the worker about the review
    addNotification(program, foundEnrollment.worker, 'submission-reviewed',
      `Your submission for "${program.modules.id(foundSubmission.moduleId)?.title || 'module'}" was ${req.body.status}. ${req.body.feedback ? 'Feedback: ' + req.body.feedback : ''}`);

    // If approved, mark module as complete
    if (req.body.status === 'approved' && !foundEnrollment.completedModules.some(id => id.toString() === String(foundSubmission.moduleId))) {
      foundEnrollment.completedModules.push(foundSubmission.moduleId);
      foundEnrollment.progress = Math.round(foundEnrollment.completedModules.length / program.modules.length * 100);
      // xAPI: module completed (via assignment approval)
      { const approvedMod = program.modules.id(foundSubmission.moduleId); if (approvedMod) emitModuleCompleted(foundEnrollment.worker, program._id, foundSubmission.moduleId, approvedMod.title).catch(() => {}); }
      // Issue unit micro-credential for approved assignment
      { const w = await Worker.findById(foundEnrollment.worker); if (w) autoIssueModuleCredential(program, foundEnrollment, w, foundSubmission.moduleId).catch(() => {}); }

      if (foundEnrollment.progress >= 100 && foundEnrollment.status !== 'completed') {
        foundEnrollment.status = 'completed';
        foundEnrollment.completedAt = new Date();
        addNotification(program, foundEnrollment.worker, 'course-complete',
          `Congratulations! You have completed "${program.title}".`);
        const worker = await Worker.findById(foundEnrollment.worker);
        if (worker) await autoIssueCertificate(program, foundEnrollment, worker);
        // xAPI: course completed (via assignment approval)
        emitCourseCompleted(foundEnrollment.worker, program._id, program.title).catch(() => {});
      } else {
        foundEnrollment.status = 'in-progress';
      }
    }

    await program.save();
    res.json(foundSubmission);
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   NOTIFICATIONS
   ═══════════════════════════════════════════════════════════ */
router.put('/notifications/:programId/:notifId/read', authenticate, async (req, res, next) => {
  try {
    await Training.updateOne(
      { _id: req.params.programId, 'notifications._id': req.params.notifId },
      { $set: { 'notifications.$.read': true } },
    );
    res.json({ message: 'Marked as read' });
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   SUBMIT FOR EVALUATION
   ═══════════════════════════════════════════════════════════ */
router.post('/:id/submit-evaluation', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });

    let workerId;
    if (req.user.role === 'worker') {
      const worker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!worker) return res.status(403).json({ error: 'Worker not found' });
      workerId = worker._id;
    } else {
      return res.status(403).json({ error: 'Only workers can submit for evaluation' });
    }

    const enrollment = program.enrollments.find(e => e.worker?.toString() === workerId.toString());
    if (!enrollment) return res.status(404).json({ error: 'Not enrolled' });
    if (enrollment.status !== 'completed') return res.status(400).json({ error: 'Course must be completed before submitting for evaluation' });

    enrollment.status = 'submitted';

    // Add notification
    addNotification(program, enrollment.worker, 'course-complete',
      `Your course "${program.title}" has been submitted for evaluation.`);

    await program.save();

    res.json({ message: 'Submitted for evaluation', status: 'submitted' });
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   EVALUATE A SUBMISSION (assessor/admin)
   ═══════════════════════════════════════════════════════════ */
router.post('/:id/evaluate/:workerId', authenticate, authorize('admin', 'assessor', 'institution'), [
  param('id').isMongoId(),
  param('workerId').isMongoId(),
  body('grade').optional().isInt({ min: 0, max: 100 }).toInt(),
  body('strengths').optional().isArray(),
  body('weaknesses').optional().isArray(),
  body('recommendation').optional().trim().isLength({ max: 2000 }),
  body('overrideCompetencyCheck').optional().isBoolean().toBoolean(),
  handleValidation,
], async (req, res, next) => {
  try {
    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });

    const enrollment = program.enrollments.find(e => e.worker?.toString() === req.params.workerId);
    if (!enrollment) return res.status(404).json({ error: 'Enrollment not found' });
    if (enrollment.status !== 'submitted') return res.status(400).json({ error: 'Course must be submitted first' });

    // ─── Weighted grade calculation ───
    const { calculatedGrade: weightedGrade, breakdown } = calculateWeightedGrade(program, enrollment);
    if (breakdown) {
      enrollment.gradingBreakdown = breakdown;
    }

    // Override with manual grade if provided
    const finalGrade = req.body.grade != null ? req.body.grade : weightedGrade;

    // Competency threshold check
    const competencyResult = checkCompetencyThresholds(program, enrollment);
    enrollment.competencyGapReport = competencyResult.gaps;
    enrollment.competencyCheckPassed = competencyResult.passed;

    // Letter grade
    const letterGrade = finalGrade >= 90 ? 'A' : finalGrade >= 80 ? 'B' : finalGrade >= 70 ? 'C' : finalGrade >= 60 ? 'D' : 'F';

    enrollment.status = 'evaluated';
    enrollment.evaluationGrade = finalGrade;
    enrollment.evaluationSummary = {
      overallGrade: letterGrade,
      strengths: req.body.strengths || [],
      weaknesses: req.body.weaknesses || [],
      recommendation: req.body.recommendation || '',
      evaluatedAt: new Date(),
      evaluatedBy: req.user._id
    };

    // Issue certificate if grade meets pass mark and competency check passes
    const passMark = program.passMark || 70;
    let certificateResult = null;
    if (finalGrade >= passMark && (competencyResult.passed || req.body.overrideCompetencyCheck)) {
      const worker = await Worker.findById(req.params.workerId);
      if (worker) {
        certificateResult = await autoIssueCertificate(program, enrollment, worker, req.body.overrideCompetencyCheck);
      }
    }

    // Notification
    addNotification(program, enrollment.worker, 'course-complete',
      `Your course "${program.title}" has been evaluated. Grade: ${letterGrade} (${finalGrade}%)`);

    await program.save();

    res.json({
      message: 'Evaluation complete',
      grade: finalGrade,
      letterGrade,
      evaluationSummary: enrollment.evaluationSummary,
      gradingBreakdown: enrollment.gradingBreakdown,
      competencyCheckPassed: enrollment.competencyCheckPassed,
      competencyGapReport: enrollment.competencyGapReport,
      certificateIssued: enrollment.certificateIssued,
      certificateId: enrollment.certificateId,
    });
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   COMPETENCY CHECK (worker/assessor/admin)
   ═══════════════════════════════════════════════════════════ */
router.get('/:id/competency-check/:workerId', authenticate, [
  param('id').isMongoId(),
  param('workerId').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });

    // Authorization: worker can check self, assessor/admin can check anyone
    if (req.user.role === 'worker') {
      const ownWorker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!ownWorker || ownWorker._id.toString() !== req.params.workerId) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const enrollment = program.enrollments.find(e => e.worker?.toString() === req.params.workerId);
    if (!enrollment) return res.status(404).json({ error: 'Not enrolled' });

    const competencyResult = checkCompetencyThresholds(program, enrollment);
    const { calculatedGrade, breakdown } = calculateWeightedGrade(program, enrollment);

    res.json({
      competencyCheckPassed: competencyResult.passed,
      competencyGapReport: competencyResult.gaps,
      gradingBreakdown: breakdown,
      calculatedGrade,
      passMark: program.passMark || 70,
      gradePassCheck: calculatedGrade >= (program.passMark || 70),
      certificateEligible: calculatedGrade >= (program.passMark || 70) && competencyResult.passed,
    });
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   KNOWLEDGE CHECK for video/reading modules
   ═══════════════════════════════════════════════════════════ */
router.post('/:id/knowledge-check/:moduleId', authenticate, [
  param('id').isMongoId(),
  param('moduleId').isMongoId(),
  body('workerId').isMongoId(),
  body('answers').isArray({ min: 1 }),
  handleValidation,
], async (req, res, next) => {
  try {
    const { workerId, answers } = req.body;

    if (req.user.role === 'worker') {
      const ownWorker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!ownWorker || ownWorker._id.toString() !== workerId) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });

    const mod = program.modules.id(req.params.moduleId);
    if (!mod) return res.status(404).json({ error: 'Module not found' });
    if (!mod.knowledgeChecks || mod.knowledgeChecks.length === 0) {
      return res.status(400).json({ error: 'No knowledge checks for this module' });
    }

    const enrollment = program.enrollments.find(e => e.worker.toString() === workerId);
    if (!enrollment) return res.status(404).json({ error: 'Not enrolled' });

    // Score using existing scoreQuestion()
    const questions = mod.knowledgeChecks;
    let correctCount = 0;
    const scoredAnswers = answers.map((a, i) => {
      const q = questions[i];
      if (!q) return { questionIndex: i, isCorrect: false };
      const isCorrect = scoreQuestion(q, a);
      if (isCorrect === true) correctCount++;
      return { questionIndex: i, isCorrect: isCorrect === true, explanation: q.explanation };
    });

    const score = questions.length > 0 ? Math.round(correctCount / questions.length * 100) : 0;
    const passMark = mod.knowledgeCheckPassMark || 70;
    const passed = score >= passMark;

    enrollment.knowledgeCheckAttempts.push({
      moduleId: mod._id,
      score,
      correctAnswers: correctCount,
      totalQuestions: questions.length,
      passed,
    });

    // Update competency scores from knowledge check answers
    for (let i = 0; i < scoredAnswers.length; i++) {
      const q = questions[i];
      if (q?.competencyTag && scoredAnswers[i].isCorrect) {
        const existing = enrollment.competencyScores.find(c => c.skill === q.competencyTag);
        if (existing) {
          existing.score = Math.round((existing.score * existing.assessments + 100) / (existing.assessments + 1));
          existing.assessments += 1;
        } else {
          enrollment.competencyScores.push({ skill: q.competencyTag, score: 100, assessments: 1 });
        }
      }
    }

    await program.save();

    res.json({
      score,
      correctAnswers: correctCount,
      totalQuestions: questions.length,
      passed,
      passMark,
      answers: scoredAnswers,
      attemptNumber: enrollment.knowledgeCheckAttempts.filter(a => a.moduleId.toString() === mod._id.toString()).length,
    });
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   SELF-ASSESSMENT for practical/assignment modules
   ═══════════════════════════════════════════════════════════ */
router.post('/:id/self-assessment/:moduleId', authenticate, [
  param('id').isMongoId(),
  param('moduleId').isMongoId(),
  body('workerId').isMongoId(),
  body('rubricScores').isArray({ min: 1 }),
  body('rubricScores.*.criterion').trim().notEmpty(),
  body('rubricScores.*.score').isInt({ min: 0, max: 10 }).toInt(),
  body('rubricScores.*.notes').optional().trim().isLength({ max: 500 }),
  handleValidation,
], async (req, res, next) => {
  try {
    const { workerId, rubricScores } = req.body;

    if (req.user.role === 'worker') {
      const ownWorker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!ownWorker || ownWorker._id.toString() !== workerId) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });

    const mod = program.modules.id(req.params.moduleId);
    if (!mod) return res.status(404).json({ error: 'Module not found' });
    if (mod.type !== 'practical' && mod.type !== 'assignment') {
      return res.status(400).json({ error: 'Self-assessment only for practical/assignment modules' });
    }

    const enrollment = program.enrollments.find(e => e.worker.toString() === workerId);
    if (!enrollment) return res.status(404).json({ error: 'Not enrolled' });

    // Find or create submission for this module
    let submission = enrollment.submissions.find(s =>
      s.moduleId.toString() === mod._id.toString() && s.worker.toString() === workerId
    );

    if (!submission) {
      enrollment.submissions.push({
        worker: workerId,
        moduleId: mod._id,
        selfAssessment: rubricScores,
      });
    } else {
      submission.selfAssessment = rubricScores;
    }

    await program.save();

    res.json({ message: 'Self-assessment saved', rubricScores });
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   ADMIN: RETROACTIVE CERTIFICATE ISSUANCE (one-time utility)
   POST /api/training/admin/issue-missing-certificates
   ═══════════════════════════════════════════════════════════ */
router.post('/admin/issue-missing-certificates', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const programs = await Training.find({ 'enrollments.status': 'completed' });
    let issued = 0;
    let alreadyHad = 0;
    let blocked = 0;
    const results = [];

    for (const program of programs) {
      let changed = false;
      for (const enrollment of program.enrollments) {
        if (enrollment.status !== 'completed') continue;
        if (enrollment.certificateIssued) { alreadyHad++; continue; }

        const worker = await Worker.findById(enrollment.worker);
        if (!worker) { results.push({ status: 'no-worker', program: program.title }); continue; }

        const result = await autoIssueCertificate(program, enrollment, worker, true);
        if (result && result.blocked) {
          blocked++;
          results.push({ status: 'blocked', reason: result.reason, worker: worker._id, program: program.title });
        } else if (result) {
          issued++;
          changed = true;
          results.push({ status: 'issued', credentialId: enrollment.certificateId, worker: worker._id, program: program.title });
        }
      }
      if (changed) await program.save();
    }

    res.json({ issued, alreadyHad, blocked, results });
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * UNIFIED TRAINING TAB — certificate resolution + training-scoped live sessions
 * ═══════════════════════════════════════════════════════════════════════════ */

const TRAINING_STAFF_ROLES = ['admin', 'institution', 'assessor'];
const isTrainingStaff = (user) => TRAINING_STAFF_ROLES.includes(user.role);

// Resolve the worker whose journey we're acting on: the caller's own worker
// profile, or (for staff) an explicit ?workerId. Returns null + sends the
// response on failure.
async function resolveJourneyWorker(req, res, training) {
  const staff = isTrainingStaff(req.user);
  let worker;
  if (staff && req.query.workerId) worker = await Worker.findById(req.query.workerId);
  else worker = await Worker.findOne({ user: req.user._id });
  if (!worker) { res.status(404).json({ error: 'Worker profile not found' }); return null; }
  const enrollment = training.enrollments.find(e => e.worker?.toString() === worker._id.toString());
  return { staff, worker, enrollment };
}

// Access gate for a training's live sessions: enrolled worker or staff.
async function trainingLiveContext(req, res, { staffOnly = false } = {}) {
  const training = await Training.findById(req.params.id);
  if (!training) { res.status(404).json({ error: 'Training not found' }); return null; }
  const staff = isTrainingStaff(req.user);
  if (!staff) {
    const worker = await Worker.findOne({ user: req.user._id }).select('_id');
    const enrolled = worker && training.enrollments.some(e => e.worker?.toString() === worker._id.toString());
    if (!enrolled) { res.status(403).json({ error: 'Not enrolled in this training' }); return null; }
  }
  if (staffOnly && !staff) { res.status(403).json({ error: 'Staff access required' }); return null; }
  return { training, staff };
}

/* ───────── Certificate: resolve enrollment → credential ───────── */

// GET /:id/certificate — status + metadata (signatory, download URL)
router.get('/:id/certificate', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const training = await Training.findById(req.params.id);
    if (!training) return res.status(404).json({ error: 'Training not found' });
    const ctx = await resolveJourneyWorker(req, res, training);
    if (!ctx) return;
    const { enrollment } = ctx;
    if (!enrollment) return res.status(404).json({ error: 'Not enrolled in this training' });

    if (!enrollment.certificateIssued || !enrollment.certificateId) {
      return res.json({ issued: false, status: enrollment.status, progress: enrollment.progress });
    }
    const cred = await Credential.findOne({ credentialId: enrollment.certificateId });
    // QR to the public verification page (same target the PDF encodes).
    const verifyUrl = `${PUBLIC_BASE}/verify/${enrollment.certificateId}`;
    let qrDataUrl = null;
    try { qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 220 }); } catch { /* non-fatal */ }
    // Prefer the snapshot; fall back to a live computation for legacy certificates.
    let grades = enrollment.certificateGrades;
    let overallGrade = enrollment.overallGrade;
    if (!grades || !grades.length || !overallGrade?.letter) {
      const cg = computeCertificateGrades(training, enrollment);
      grades = cg.domains; overallGrade = cg.overall;
    }
    res.json({
      issued: true,
      certificateId: enrollment.certificateId,
      title: cred?.title || `${training.title} — Completion Certificate`,
      holderName: ctx.worker.fullName,
      trade: training.trade,
      nqfLevel: cred?.nqfLevel ?? training.nqfLevel,
      institution: cred?.institution || training.institution,
      issuers: (training.issuers && training.issuers.length) ? training.issuers : (training.institution ? [training.institution] : []),
      signatory: cred?.signatory || training.signatory,
      signatories: (training.signatories && training.signatories.length)
        ? training.signatories
        : [{ name: (cred?.signatory || training.signatory)?.name, title: (cred?.signatory || training.signatory)?.title }],
      grades,
      overallGrade,
      issuedAt: cred?.createdAt,
      validUntil: cred?.validUntil,
      status: cred?.status || 'active',
      verifyUrl,
      qrDataUrl,
      downloadUrl: cred ? `/api/v1/training/${training._id}/certificate/pdf` : null,
    });
  } catch (err) { next(err); }
});

// GET /:id/certificate/pdf — stream the designed certificate PDF
router.get('/:id/certificate/pdf', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const training = await Training.findById(req.params.id);
    if (!training) return res.status(404).json({ error: 'Training not found' });
    const ctx = await resolveJourneyWorker(req, res, training);
    if (!ctx) return;
    if (!ctx.enrollment?.certificateId) {
      return res.status(404).json({ error: 'No certificate issued for this training' });
    }
    const cred = await Credential.findOne({ credentialId: ctx.enrollment.certificateId })
      .populate('worker', 'fullName fatherName trade registrationId district cnicMasked nqfLevel photo')
      .populate('issuedBy', 'name organization');
    if (!cred) return res.status(404).json({ error: 'Certificate not found' });

    // Surface the training's certificate issuers + grades on the PDF (live from training).
    const certObj = cred.toObject ? cred.toObject() : cred;
    certObj.issuers = (training.issuers && training.issuers.length) ? training.issuers : (training.institution ? [training.institution] : []);
    certObj.signatories = (training.signatories && training.signatories.length) ? training.signatories : null;
    certObj.certGrades = ctx.enrollment.certificateGrades || [];
    certObj.overallGrade = ctx.enrollment.overallGrade || null;
    // Training-completion context for the premium certificate design.
    certObj.programTitle = training.title;
    certObj.holderName = ctx.worker.fullName;
    certObj.startDate = training.startDate || null;
    certObj.endDate = training.endDate || null;
    certObj.durationLabel = training.duration || '';
    certObj.institute = ctx.enrollment.institute || ctx.worker.district || '';
    certObj.logos = (training.logos && training.logos.length) ? training.logos : null;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${cred.credentialId}.pdf`);
    await generateTrainingCertificatePDF(certObj, res);
  } catch (err) { next(err); }
});

/* ───────── Training-scoped live sessions (reuse ClassLiveSession + JaaS) ───────── */

// GET /:id/live — list sessions (enrolled worker or staff)
router.get('/:id/live', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await trainingLiveContext(req, res);
    if (!ctx) return;
    const sessions = await ClassLiveSession.find({ training: ctx.training._id })
      .sort('-scheduledFor')
      .populate('createdBy', 'name avatar');
    res.json(sessions);
  } catch (err) { next(err); }
});

// POST /:id/live — schedule a session (staff/instructor)
router.post('/:id/live', authenticate, [
  param('id').isMongoId(),
  body('title').trim().notEmpty().isLength({ max: 200 }),
  body('description').optional().isLength({ max: 2000 }),
  body('scheduledFor').isISO8601(),
  body('durationMins').optional().isInt({ min: 5, max: 600 }).toInt(),
  body('mode').optional().isIn(['jitsi', 'link']),
  body('meetingUrl').optional({ checkFalsy: true }).isURL({ protocols: ['http', 'https'], require_protocol: true }).isLength({ max: 500 }),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await trainingLiveContext(req, res, { staffOnly: true });
    if (!ctx) return;
    const mode = req.body.mode || 'jitsi';
    if (mode === 'link' && !req.body.meetingUrl) {
      return res.status(400).json({ error: 'meetingUrl is required for link mode' });
    }
    const session = await ClassLiveSession.create({
      training: ctx.training._id,
      title: req.body.title,
      description: req.body.description,
      scheduledFor: new Date(req.body.scheduledFor),
      durationMins: req.body.durationMins ?? 60,
      mode,
      meetingUrl: mode === 'link' ? req.body.meetingUrl : undefined,
      createdBy: req.user._id,
    });
    res.status(201).json(session);
  } catch (err) { next(err); }
});

// GET /:id/live/:sessionId/token — JaaS join token (moderator for staff)
router.get('/:id/live/:sessionId/token', authenticate, [
  param('id').isMongoId(),
  param('sessionId').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await trainingLiveContext(req, res);
    if (!ctx) return;
    const session = await ClassLiveSession.findOne({ _id: req.params.sessionId, training: ctx.training._id });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.mode === 'link') return res.json({ mode: 'link', meetingUrl: session.meetingUrl });
    const payload = jaasJoinPayload({
      room: session.jitsiRoom,
      user: { id: req.user._id, name: req.user.name, email: req.user.email, avatar: req.user.avatar },
      moderator: ctx.staff,
    });
    res.json({ mode: 'jitsi', ...payload });
  } catch (err) { next(err); }
});

// POST /:id/live/:sessionId/start — mark live (staff)
router.post('/:id/live/:sessionId/start', authenticate, [
  param('id').isMongoId(),
  param('sessionId').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await trainingLiveContext(req, res, { staffOnly: true });
    if (!ctx) return;
    const session = await ClassLiveSession.findOne({ _id: req.params.sessionId, training: ctx.training._id });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    session.status = 'live';
    session.startedAt = new Date();
    await session.save();
    res.json(session);
  } catch (err) { next(err); }
});

// POST /:id/live/:sessionId/end — end session, optional recording (staff)
router.post('/:id/live/:sessionId/end', authenticate, [
  param('id').isMongoId(),
  param('sessionId').isMongoId(),
  body('recordingUrl').optional({ checkFalsy: true }).isURL({ protocols: ['http', 'https'], require_protocol: true }).isLength({ max: 500 }),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await trainingLiveContext(req, res, { staffOnly: true });
    if (!ctx) return;
    const session = await ClassLiveSession.findOne({ _id: req.params.sessionId, training: ctx.training._id });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    session.status = 'ended';
    session.endedAt = new Date();
    if (req.body.recordingUrl) session.recordingUrl = req.body.recordingUrl;
    await session.save();
    res.json(session);
  } catch (err) { next(err); }
});

// DELETE /:id/live/:sessionId — remove session (staff)
router.delete('/:id/live/:sessionId', authenticate, [
  param('id').isMongoId(),
  param('sessionId').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await trainingLiveContext(req, res, { staffOnly: true });
    if (!ctx) return;
    const session = await ClassLiveSession.findOneAndDelete({ _id: req.params.sessionId, training: ctx.training._id });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   TRAINER ASSESSMENT — participants rate each trainer 1–5 on five
   criteria; responses are stored (one per worker) and auto-averaged.
   Results (aggregates only, no identities) are staff-visible.
   ═══════════════════════════════════════════════════════════ */
const TA_CRITERIA = ['clarity', 'knowledge', 'timekeeping', 'examples', 'engagement'];

// GET the trainer list + whether the current worker has already submitted.
router.get('/:id/trainer-assessment', authenticate, [param('id').isMongoId(), handleValidation], async (req, res, next) => {
  try {
    const t = await Training.findById(req.params.id).select('trainers trainerAssessments').lean();
    if (!t) return res.status(404).json({ error: 'Training not found' });
    let submitted = false;
    if (req.user.role === 'worker') {
      const worker = await Worker.findOne({ user: req.user._id }).select('_id').lean();
      submitted = !!(worker && (t.trainerAssessments || []).some(a => a.worker?.toString() === worker._id.toString()));
    }
    const trainers = (t.trainers || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0))
      .map(tr => ({ key: tr.key, name: tr.name, topic: tr.topic }));
    res.json({ trainers, criteria: TA_CRITERIA, submitted, responses: (t.trainerAssessments || []).length });
  } catch (err) { next(err); }
});

// POST a completed assessment (one per worker).
router.post('/:id/trainer-assessment', authenticate, [
  param('id').isMongoId(),
  body('ratings').isArray({ min: 1 }),
  body('comment').optional({ checkFalsy: true }).isString().isLength({ max: 2000 }),
  handleValidation,
], async (req, res, next) => {
  try {
    const worker = await Worker.findOne({ user: req.user._id }).select('_id');
    if (!worker) return res.status(400).json({ error: 'Only enrolled participants can submit.' });

    const program = await Training.findById(req.params.id).select('trainers trainerAssessments enrollments');
    if (!program) return res.status(404).json({ error: 'Training not found' });

    const enrolled = program.enrollments.some(e => e.worker.toString() === worker._id.toString());
    if (!enrolled) return res.status(403).json({ error: 'You are not enrolled in this training.' });

    if ((program.trainerAssessments || []).some(a => a.worker?.toString() === worker._id.toString())) {
      return res.status(409).json({ error: 'You have already submitted your assessment.', alreadySubmitted: true });
    }

    const validKeys = new Set((program.trainers || []).map(tr => tr.key));
    const ratings = [];
    for (const r of req.body.ratings) {
      if (!r || !validKeys.has(r.key)) return res.status(400).json({ error: 'Invalid trainer in submission.' });
      const clean = { key: r.key };
      let sum = 0;
      for (const c of TA_CRITERIA) {
        const v = Number(r[c]);
        if (!Number.isInteger(v) || v < 1 || v > 5) return res.status(400).json({ error: `Rate every criterion 1–5 for each trainer.` });
        clean[c] = v; sum += v;
      }
      clean.overall = Math.round((sum / TA_CRITERIA.length) * 20);   // /100
      ratings.push(clean);
    }
    if (ratings.length !== validKeys.size) return res.status(400).json({ error: 'Please rate every trainer.' });

    // Atomic push — safe under concurrent submissions.
    await Training.updateOne({ _id: program._id }, {
      $push: { trainerAssessments: { worker: worker._id, submittedAt: new Date(), comment: req.body.comment || '', ratings } },
    });
    res.status(201).json({ ok: true, message: 'Thank you — your assessment was submitted.' });
  } catch (err) { next(err); }
});

// GET aggregated results (staff only) — averages per trainer, no identities.
router.get('/:id/trainer-assessment/results', authenticate, authorize('admin', 'institution', 'assessor'), [param('id').isMongoId(), handleValidation], async (req, res, next) => {
  try {
    const t = await Training.findById(req.params.id).select('trainers trainerAssessments').lean();
    if (!t) return res.status(404).json({ error: 'Training not found' });
    const responses = t.trainerAssessments || [];
    const trainers = (t.trainers || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    const results = trainers.map(tr => {
      const rows = responses.map(a => (a.ratings || []).find(x => x.key === tr.key)).filter(Boolean);
      const n = rows.length;
      const avg = (f) => n ? +(rows.reduce((s, x) => s + (x[f] || 0), 0) / n).toFixed(2) : null;
      return {
        key: tr.key, name: tr.name, topic: tr.topic, n,
        clarity: avg('clarity'), knowledge: avg('knowledge'), timekeeping: avg('timekeeping'),
        examples: avg('examples'), engagement: avg('engagement'),
        score: n ? Math.round(rows.reduce((s, x) => s + (x.overall || 0), 0) / n) : null,   // /100
      };
    }).sort((a, b) => (b.score || 0) - (a.score || 0));   // ranked
    const comments = responses.map(a => (a.comment || '').trim()).filter(Boolean);
    res.json({ totalResponses: responses.length, results, comments });
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   SURVEY ACTIVITY — a module flagged isSurvey collects single/multi
   choice + free-text answers, one submission per worker. Staff see
   aggregated counts (no identities).
   ═══════════════════════════════════════════════════════════ */

// GET a survey's questions + whether the current worker has submitted.
router.get('/:id/survey/:moduleId', authenticate, [param('id').isMongoId(), param('moduleId').isMongoId(), handleValidation], async (req, res, next) => {
  try {
    const t = await Training.findById(req.params.id).select('modules surveySubmissions').lean();
    if (!t) return res.status(404).json({ error: 'Training not found' });
    const mod = (t.modules || []).find(m => m._id.toString() === req.params.moduleId);
    if (!mod || !mod.isSurvey) return res.status(400).json({ error: 'Module is not a survey.' });
    let submitted = false;
    if (req.user.role === 'worker') {
      const worker = await Worker.findOne({ user: req.user._id }).select('_id').lean();
      submitted = !!(worker && (t.surveySubmissions || []).some(s => s.module?.toString() === mod._id.toString() && s.worker?.toString() === worker._id.toString()));
    }
    res.json({
      title: mod.title,
      questions: (mod.surveyQuestions || []).map(q => ({ section: q.section, prompt: q.prompt, options: q.options || [], multi: !!q.multi, text: !!q.text })),
      submitted,
      responses: (t.surveySubmissions || []).filter(s => s.module?.toString() === mod._id.toString()).length,
    });
  } catch (err) { next(err); }
});

// POST a survey submission (one per worker per module).
router.post('/:id/survey/:moduleId', authenticate, [
  param('id').isMongoId(), param('moduleId').isMongoId(),
  body('answers').isArray(), handleValidation,
], async (req, res, next) => {
  try {
    const worker = await Worker.findOne({ user: req.user._id }).select('_id');
    if (!worker) return res.status(400).json({ error: 'Only enrolled participants can submit.' });

    const program = await Training.findById(req.params.id).select('modules surveySubmissions enrollments');
    if (!program) return res.status(404).json({ error: 'Training not found' });
    const mod = program.modules.id(req.params.moduleId);
    if (!mod || !mod.isSurvey) return res.status(400).json({ error: 'Module is not a survey.' });

    if (!program.enrollments.some(e => e.worker.toString() === worker._id.toString()))
      return res.status(403).json({ error: 'You are not enrolled in this training.' });
    if ((program.surveySubmissions || []).some(s => s.module?.toString() === mod._id.toString() && s.worker?.toString() === worker._id.toString()))
      return res.status(409).json({ error: 'You have already submitted this survey.', alreadySubmitted: true });

    const qs = mod.surveyQuestions || [];
    const answers = (req.body.answers || []).map((a, i) => {
      const q = qs[i] || {};
      if (q.text) return { qi: i, text: (a?.text || '').toString().slice(0, 2000) };
      if (q.multi) return { qi: i, choices: Array.isArray(a?.choices) ? a.choices.filter(c => (q.options || []).includes(c)) : [] };
      return { qi: i, choice: (q.options || []).includes(a?.choice) ? a.choice : '' };
    });

    await Training.updateOne({ _id: program._id }, {
      $push: { surveySubmissions: { module: mod._id, worker: worker._id, submittedAt: new Date(), answers } },
    });
    res.status(201).json({ ok: true, message: 'Thank you — your survey was submitted.' });
  } catch (err) { next(err); }
});

// GET aggregated survey results (staff only) — counts per option + free-text list.
router.get('/:id/survey/:moduleId/results', authenticate, authorize('admin', 'institution', 'assessor'), [param('id').isMongoId(), param('moduleId').isMongoId(), handleValidation], async (req, res, next) => {
  try {
    const t = await Training.findById(req.params.id).select('modules surveySubmissions').lean();
    if (!t) return res.status(404).json({ error: 'Training not found' });
    const mod = (t.modules || []).find(m => m._id.toString() === req.params.moduleId);
    if (!mod || !mod.isSurvey) return res.status(400).json({ error: 'Module is not a survey.' });
    const subs = (t.surveySubmissions || []).filter(s => s.module?.toString() === mod._id.toString());
    const results = (mod.surveyQuestions || []).map((q, i) => {
      if (q.text) {
        const texts = subs.map(s => (s.answers.find(a => a.qi === i)?.text || '').trim()).filter(Boolean);
        return { prompt: q.prompt, section: q.section, text: true, answers: texts };
      }
      const counts = {};
      (q.options || []).forEach(o => { counts[o] = 0; });
      subs.forEach(s => {
        const a = s.answers.find(x => x.qi === i);
        if (!a) return;
        (q.multi ? (a.choices || []) : [a.choice]).filter(Boolean).forEach(c => { if (c in counts) counts[c]++; });
      });
      return { prompt: q.prompt, section: q.section, multi: !!q.multi, counts };
    });
    // Per-respondent rows (staff-only) for reporting — name + readable answers.
    const qPrompts = (mod.surveyQuestions || []).map(q => q.prompt);
    const rows = subs.map(s => ({
      name: s.respondentName || (s.worker ? 'Enrolled participant' : 'Anonymous'),
      public: !!s.isPublic,
      submittedAt: s.submittedAt,
      answers: (s.answers || []).map(a => ({
        prompt: qPrompts[a.qi] || `Q${a.qi + 1}`,
        value: a.text != null ? a.text : (a.choices ? a.choices.join(', ') : (a.choice || '')),
      })),
    }));
    res.json({ totalResponses: subs.length, results, responses: rows });
  } catch (err) { next(err); }
});

export default router;
