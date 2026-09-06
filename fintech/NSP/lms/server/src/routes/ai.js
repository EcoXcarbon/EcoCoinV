import { Router } from 'express';
import { param, body } from 'express-validator';
import multer from 'multer';
import Training from '../models/Training.js';
import Worker from '../models/Worker.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { handleValidation } from '../middleware/validate.js';
import { sendPrompt, parseAIJson } from '../services/aiService.js';

const router = Router();

// In-memory upload for AI source files (never persisted).
const aiUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Extract plain text from an uploaded file so the AI can work from its content.
async function extractFileText(file) {
  if (!file || !file.buffer) return '';
  const name = (file.originalname || '').toLowerCase();
  if (/\.(txt|md|markdown|csv|json|html?|xml|tsv)$/.test(name)) return file.buffer.toString('utf8');
  if (name.endsWith('.pdf')) {
    try {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: new Uint8Array(file.buffer) });
      const r = await parser.getText();
      return (typeof r === 'string' ? r : (r?.text || '')).trim();
    } catch { return ''; }
  }
  if (name.endsWith('.docx')) {
    try {
      const mammoth = (await import('mammoth')).default || (await import('mammoth'));
      // HTML preserves headings, tables, lists and bold → renders as a proper handout.
      const r = await mammoth.convertToHtml({ buffer: file.buffer });
      const html = (r.value || '').trim();
      if (html) return html;
      const raw = await mammoth.extractRawText({ buffer: file.buffer });
      return (raw.value || '').trim();
    } catch { return ''; }
  }
  // Best-effort for other types.
  try { return file.buffer.toString('utf8').replace(/[^\x09\x0A\x0D\x20-\x7E]+/g, ' ').trim(); }
  catch { return ''; }
}

/* ═══════════════════════════════════════════════════════════
   P4a: ADAPTIVE LEARNING PATHS
   ═══════════════════════════════════════════════════════════ */
router.post('/training/:id/adaptive-path', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });

    // Find worker and enrollment
    const worker = await Worker.findOne({ user: req.user._id }).select('_id name trade');
    if (!worker) return res.status(403).json({ error: 'Worker profile not found' });

    const enrollment = program.enrollments.find(e => e.worker.toString() === worker._id.toString());
    if (!enrollment) return res.status(404).json({ error: 'Not enrolled in this program' });

    const modules = (program.modules || []).sort((a, b) => (a.order || 0) - (b.order || 0));

    // Build performance context
    const completedIds = enrollment.completedModules.map(id => id.toString());
    const moduleData = modules.map(m => ({
      id: m._id.toString(),
      title: m.title,
      type: m.type,
      completed: completedIds.includes(m._id.toString()),
      duration: m.duration,
    }));

    const quizData = enrollment.quizAttempts.map(a => ({
      moduleId: a.moduleId.toString(),
      score: a.score,
      passed: a.passed,
      totalQuestions: a.totalQuestions,
    }));

    const competencies = enrollment.competencyScores.map(c => ({
      skill: c.skill,
      score: c.score,
    }));

    const timeLog = enrollment.moduleTimeLog.map(t => ({
      moduleId: t.moduleId.toString(),
      minutesSpent: t.timeSpentMinutes,
    }));

    const promptText = `You are an adaptive learning advisor for vocational training.

Course: "${program.title}" (Trade: ${program.trade}, Difficulty: ${program.difficulty})
Learner trade: ${worker.trade || program.trade}
Current progress: ${enrollment.progress}%
Adaptive quiz difficulty: ${enrollment.adaptiveData?.quizDifficultyLevel || 'medium'}

Modules: ${JSON.stringify(moduleData)}
Quiz results: ${JSON.stringify(quizData)}
Competency scores: ${JSON.stringify(competencies)}
Time spent per module: ${JSON.stringify(timeLog)}

Analyze this learner's performance and generate a personalized study plan. Respond with ONLY valid JSON (no markdown fences):
{
  "suggestedOrder": [{"moduleId": "<id>", "reason": "<why this order>"}],
  "recommendations": ["<study tip 1>", "<study tip 2>", ...],
  "weakAreas": [{"skill": "<skill name>", "suggestion": "<how to improve>"}]
}

Only include incomplete modules in suggestedOrder. Provide 2-4 recommendations and identify 1-3 weak areas based on quiz/competency data. If no data yet, give general advice for the course trade.`;

    const aiResult = await sendPrompt(promptText, req.user._id, {
      systemPrompt: 'You are an expert vocational training advisor. Always respond with valid JSON only.',
    });

    if (aiResult.error) {
      return res.status(aiResult.available ? 429 : 503).json({ error: aiResult.error });
    }

    let adaptivePath;
    try {
      adaptivePath = parseAIJson(aiResult.text);
    } catch {
      return res.status(500).json({ error: 'Failed to parse AI response' });
    }

    // Store in enrollment
    enrollment.adaptivePath = {
      suggestedOrder: (adaptivePath.suggestedOrder || []).map(s => ({
        moduleId: s.moduleId,
        reason: s.reason,
      })),
      recommendations: adaptivePath.recommendations || [],
      weakAreas: (adaptivePath.weakAreas || []).map(w => ({
        skill: w.skill,
        suggestion: w.suggestion,
      })),
      generatedAt: new Date(),
    };
    await program.save();

    res.json({
      adaptivePath: enrollment.adaptivePath,
      cached: aiResult.cached,
    });
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   P4b: AI-GRADED ASSIGNMENTS
   ═══════════════════════════════════════════════════════════ */
router.post('/training/:id/ai-grade/:submissionId', authenticate, authorize('admin', 'institution', 'assessor'), [
  param('id').isMongoId(),
  param('submissionId').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });

    // Find the submission
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

    // Find the module context
    const mod = program.modules.id(foundSubmission.moduleId);
    if (!mod) return res.status(404).json({ error: 'Module not found' });

    const promptText = `You are an expert vocational training assessor.

Course: "${program.title}" (Trade: ${program.trade})
Module: "${mod.title}" (Type: ${mod.type})
Module description: ${mod.description || 'N/A'}
Module content/rubric: ${mod.content || 'N/A'}

Student submission notes: "${foundSubmission.notes || 'No notes provided'}"
Submission status: ${foundSubmission.status}

Grade this assignment submission. Respond with ONLY valid JSON:
{
  "suggestedScore": <0-100>,
  "strengths": ["<strength 1>", "<strength 2>"],
  "weaknesses": ["<weakness 1>", "<weakness 2>"],
  "feedback": "<detailed paragraph of feedback for the student>"
}

Be fair and constructive. Consider the trade context and practical applicability.`;

    const aiResult = await sendPrompt(promptText, req.user._id, {
      systemPrompt: 'You are a fair vocational assessment grader. Always respond with valid JSON only.',
      skipCache: true,
    });

    if (aiResult.error) {
      return res.status(aiResult.available ? 429 : 503).json({ error: aiResult.error });
    }

    let grade;
    try {
      grade = parseAIJson(aiResult.text);
    } catch {
      return res.status(500).json({ error: 'Failed to parse AI response' });
    }

    // Store AI grade on submission (does NOT auto-approve)
    foundSubmission.aiGrade = {
      suggestedScore: Math.min(100, Math.max(0, grade.suggestedScore || 0)),
      strengths: grade.strengths || [],
      weaknesses: grade.weaknesses || [],
      feedback: grade.feedback || '',
      generatedAt: new Date(),
    };
    await program.save();

    res.json({
      aiGrade: foundSubmission.aiGrade,
      cached: aiResult.cached,
    });
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   P4c: AI CONTENT GENERATION
   ═══════════════════════════════════════════════════════════ */
router.post('/training/generate-module', authenticate, authorize('admin', 'institution'), [
  body('type').isIn(['quiz', 'reading', 'scenario']),
  body('topic').trim().notEmpty().isLength({ max: 200 }),
  body('trade').trim().notEmpty().isLength({ max: 100 }),
  body('difficulty').isIn(['beginner', 'intermediate', 'advanced']),
  body('count').optional().isInt({ min: 1, max: 20 }).toInt(),
  handleValidation,
], async (req, res, next) => {
  try {
    const { type, topic, trade, difficulty, count = 5 } = req.body;

    let promptText;
    if (type === 'quiz') {
      promptText = `Generate ${count} multiple-choice quiz questions about "${topic}" for ${trade} workers at ${difficulty} level.

Respond with ONLY valid JSON:
{
  "questions": [
    {
      "question": "<question text>",
      "options": ["<option A>", "<option B>", "<option C>", "<option D>"],
      "correctOption": <0-3>,
      "difficulty": "${difficulty === 'beginner' ? 'easy' : difficulty === 'advanced' ? 'hard' : 'medium'}",
      "explanation": "<why the correct answer is right>"
    }
  ]
}

Make questions practical and relevant to ${trade} work. Include safety-related questions where appropriate.`;
    } else if (type === 'reading') {
      promptText = `Generate educational reading content about "${topic}" for ${trade} workers at ${difficulty} level.

Respond with ONLY valid JSON:
{
  "title": "<module title>",
  "content": "<rich educational content, 500-800 words, with clear sections and key points>",
  "keyPoints": ["<key point 1>", "<key point 2>", ...]
}

Content should be practical, safety-conscious, and relevant to ${trade} vocational training.`;
    } else {
      promptText = `Generate a branching decision scenario about "${topic}" for ${trade} workers at ${difficulty} level.

Respond with ONLY valid JSON:
{
  "title": "<scenario title>",
  "steps": [
    {
      "stepId": "step-1",
      "narrative": "<situation description>",
      "choices": [
        {
          "text": "<choice text>",
          "nextStepId": "step-2",
          "isOptimal": true,
          "feedback": "<feedback if chosen>",
          "scoreImpact": 25
        },
        {
          "text": "<alternative choice>",
          "nextStepId": "step-3",
          "isOptimal": false,
          "feedback": "<feedback>",
          "scoreImpact": 5
        }
      ]
    }
  ],
  "startStepId": "step-1",
  "passingScore": 60,
  "maxScore": 100
}

Include 3-4 decision points with realistic trade-specific dilemmas. Last steps should have null nextStepId.`;
    }

    const aiResult = await sendPrompt(promptText, req.user._id, {
      systemPrompt: 'You are an expert vocational curriculum designer. Always respond with valid JSON only.',
      maxTokens: 4096,
    });

    if (aiResult.error) {
      return res.status(aiResult.available ? 429 : 503).json({ error: aiResult.error });
    }

    let generated;
    try {
      generated = parseAIJson(aiResult.text);
    } catch {
      return res.status(500).json({ error: 'Failed to parse AI response' });
    }

    res.json({ type, generated, cached: aiResult.cached });
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   P4d: CONTENT FRESHNESS CHECKING
   ═══════════════════════════════════════════════════════════ */
router.post('/training/:id/freshness-check', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });

    const modules = program.modules || [];
    if (modules.length === 0) return res.json({ results: [] });

    // Build a single prompt for all modules to minimize API calls
    const modulesSummary = modules.map(m => ({
      id: m._id.toString(),
      title: m.title,
      type: m.type,
      content: (m.content || m.description || '').slice(0, 500),
      quizTopics: m.type === 'quiz'
        ? (m.quizQuestions || []).slice(0, 3).map(q => q.question).join('; ')
        : undefined,
      lastReviewed: m.lastReviewedAt ? m.lastReviewedAt.toISOString().split('T')[0] : 'never',
    }));

    const promptText = `You are a vocational training content reviewer specializing in ${program.trade}.

Course: "${program.title}" (Trade: ${program.trade}, Difficulty: ${program.difficulty})
Today's date: ${new Date().toISOString().split('T')[0]}

Review these modules for content freshness and accuracy:
${JSON.stringify(modulesSummary)}

For each module, assess whether the content is current and accurate. Flag outdated safety regulations, deprecated practices, or stale information.

Respond with ONLY valid JSON:
{
  "results": [
    {
      "moduleId": "<id>",
      "title": "<module title>",
      "isFresh": <true/false>,
      "issues": ["<issue 1>", ...],
      "recommendations": ["<recommendation 1>", ...]
    }
  ]
}

If a module has minimal content to review, mark it as fresh with no issues. Be specific about what might be outdated.`;

    const aiResult = await sendPrompt(promptText, req.user._id, {
      systemPrompt: 'You are an expert vocational content reviewer. Always respond with valid JSON only.',
      maxTokens: 4096,
    });

    if (aiResult.error) {
      return res.status(aiResult.available ? 429 : 503).json({ error: aiResult.error });
    }

    let parsed;
    try {
      parsed = parseAIJson(aiResult.text);
    } catch {
      return res.status(500).json({ error: 'Failed to parse AI response' });
    }

    // Update modules with freshness data
    for (const result of parsed.results || []) {
      const mod = program.modules.id(result.moduleId);
      if (mod) {
        mod.flaggedStale = !result.isFresh;
        mod.stalenessNotes = result.issues?.length > 0 ? result.issues.join('; ') : '';
        mod.lastReviewedAt = new Date();
      }
    }
    await program.save();

    res.json({ results: parsed.results || [], cached: aiResult.cached });
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   P4e: REAL-TIME CONTENT ADAPTATION
   ═══════════════════════════════════════════════════════════ */
router.post('/training/:id/adapt/:moduleId', authenticate, [
  param('id').isMongoId(),
  param('moduleId').isMongoId(),
  body('request').trim().notEmpty().isLength({ max: 500 }),
  body('language').optional().isIn(['en', 'ur', 'ps']),
  handleValidation,
], async (req, res, next) => {
  try {
    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });

    const worker = await Worker.findOne({ user: req.user._id }).select('_id trade');
    if (!worker) return res.status(403).json({ error: 'Worker profile not found' });

    const enrollment = program.enrollments.find(e => e.worker.toString() === worker._id.toString());
    if (!enrollment) return res.status(404).json({ error: 'Not enrolled' });

    const mod = program.modules.id(req.params.moduleId);
    if (!mod) return res.status(404).json({ error: 'Module not found' });

    const { request: userRequest, language = 'en' } = req.body;

    const langNames = { en: 'English', ur: 'Urdu', ps: 'Pashto' };
    const langName = langNames[language] || 'English';

    const competencies = enrollment.competencyScores.map(c => `${c.skill}: ${c.score}%`).join(', ') || 'No data yet';

    const languageInstruction = language !== 'en'
      ? `\n\nIMPORTANT: You MUST respond entirely in ${langName}. All text in the "text" field and "relatedConcepts" must be in ${langName}.`
      : '';

    const promptText = `You are a helpful vocational training tutor.

Context:
- Course: "${program.title}" (Trade: ${program.trade}, Level: ${program.difficulty})
- Module: "${mod.title}" (Type: ${mod.type})
- Module content: ${(mod.content || mod.description || 'No content available').slice(0, 2000)}
- Learner's trade: ${worker.trade || program.trade}
- Learner competency scores: ${competencies}
- Quiz difficulty level: ${enrollment.adaptiveData?.quizDifficultyLevel || 'medium'}

The learner asks: "${userRequest}"

Provide a helpful, personalized response. Respond with ONLY valid JSON:
{
  "text": "<your detailed response, 2-4 paragraphs>",
  "relatedConcepts": ["<concept 1>", "<concept 2>"]
}

Be practical, use trade-specific examples, and adapt complexity to the learner's level.${languageInstruction}`;

    const aiResult = await sendPrompt(promptText, req.user._id, {
      systemPrompt: `You are a patient, knowledgeable vocational training tutor.${language !== 'en' ? ` You MUST respond entirely in ${langName}.` : ''} Always respond with valid JSON only.`,
    });

    if (aiResult.error) {
      return res.status(aiResult.available ? 429 : 503).json({ error: aiResult.error });
    }

    let adaptation;
    try {
      adaptation = parseAIJson(aiResult.text);
    } catch {
      // If JSON parsing fails, return raw text as the adaptation
      adaptation = { text: aiResult.text, relatedConcepts: [] };
    }

    res.json({ adaptation, cached: aiResult.cached });
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   P4f: AI PRE-ASSESSMENT
   ═══════════════════════════════════════════════════════════ */
router.post('/training/:id/pre-assess', authenticate, [
  param('id').isMongoId(),
  body('language').optional().isIn(['en', 'ur', 'ps']),
  handleValidation,
], async (req, res, next) => {
  try {
    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });

    const language = req.body.language || 'en';
    const langName = { en: 'English', ur: 'Urdu', ps: 'Pashto' }[language] || 'English';

    const moduleTopics = program.modules.map(m => `${m.title} (${m.type})`).join(', ');

    const promptText = `You are assessing a TVET student's prior knowledge before they start the course "${program.title}" (Trade: ${program.trade}, Difficulty: ${program.difficulty}).

The course covers these modules: ${moduleTopics}

Generate exactly 6 pre-assessment questions to gauge the student's existing knowledge. Mix easy and hard questions.

IMPORTANT: Respond entirely in ${langName}.

Return JSON only:
{
  "questions": [
    {
      "question": "question text",
      "options": ["A", "B", "C", "D"],
      "correctIndex": 0,
      "topic": "which module topic this relates to",
      "difficulty": "easy|medium|hard"
    }
  ]
}`;

    const aiResult = await sendPrompt(promptText, req.user._id, {
      systemPrompt: 'You are a TVET assessment expert. Always respond with valid JSON only.',
    });

    if (aiResult.error) {
      return res.status(aiResult.available ? 429 : 503).json({ error: aiResult.error });
    }

    let parsed;
    try {
      parsed = parseAIJson(aiResult.text);
    } catch {
      return res.status(500).json({ error: 'Failed to parse AI response' });
    }

    res.json(parsed);
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   P4g: AI EVALUATION SUMMARY
   ═══════════════════════════════════════════════════════════ */
router.post('/training/:id/evaluation-summary', authenticate, [
  param('id').isMongoId(),
  body('language').optional().isIn(['en', 'ur', 'ps']),
  handleValidation,
], async (req, res, next) => {
  try {
    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });

    const worker = await Worker.findOne({ user: req.user._id }).select('_id');
    if (!worker) return res.status(403).json({ error: 'Worker profile not found' });

    const enrollment = program.enrollments.find(e => e.worker?.toString() === worker._id.toString());
    if (!enrollment) return res.status(404).json({ error: 'Not enrolled' });

    const language = req.body.language || 'en';
    const langName = { en: 'English', ur: 'Urdu', ps: 'Pashto' }[language] || 'English';

    // Gather performance data
    const quizData = (enrollment.quizAttempts || []).map(a => ({
      module: a.moduleId,
      score: a.score,
      passed: a.passed,
      total: a.totalQuestions,
      correct: a.correctAnswers
    }));

    const assignmentData = (enrollment.submissions || []).map(s => ({
      module: s.moduleId,
      grade: s.grade,
      status: s.status
    }));

    const competencies = (enrollment.competencyScores || []).map(c => ({
      skill: c.skill,
      score: c.score
    }));

    const promptText = `You are evaluating a TVET student who completed the course "${program.title}" (Trade: ${program.trade}).

Student Performance Data:
- Overall Progress: ${enrollment.progress}%
- Quiz Results: ${JSON.stringify(quizData)}
- Assignment Results: ${JSON.stringify(assignmentData)}
- Competency Scores: ${JSON.stringify(competencies)}
- Pre-Assessment Score: ${enrollment.preAssessmentScore ?? 'Not taken'}
- Total Modules: ${program.modules.length}
- Completed Modules: ${enrollment.completedModules?.length ?? 0}

IMPORTANT: Respond entirely in ${langName}.

Provide an evaluation summary as JSON:
{
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "weaknesses": ["weakness 1", "weakness 2"],
  "overallAssessment": "paragraph summarizing the student's performance",
  "recommendedNextCourses": ["course suggestion 1", "course suggestion 2"],
  "skillGaps": ["gap 1", "gap 2"],
  "improvementPlan": "specific advice for improvement"
}`;

    const aiResult = await sendPrompt(promptText, req.user._id, {
      systemPrompt: `You are a TVET evaluation expert.${language !== 'en' ? ` You MUST respond entirely in ${langName}.` : ''} Always respond with valid JSON only.`,
    });

    if (aiResult.error) {
      return res.status(aiResult.available ? 429 : 503).json({ error: aiResult.error });
    }

    let parsed;
    try {
      parsed = parseAIJson(aiResult.text);
    } catch {
      return res.status(500).json({ error: 'Failed to parse AI response' });
    }

    res.json(parsed);
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   FEEDBACK ANALYSIS — AI coaching summary of a learner's performance.
   Routes through the configured AI provider (VPS Claude relay when
   AI_PROVIDER=relay). Learners analyse their own enrollment; staff may
   pass ?workerId to analyse a specific learner.
   ═══════════════════════════════════════════════════════════ */
router.post('/training/:id/feedback-analysis', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const program = await Training.findById(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });

    const isStaff = ['admin', 'institution', 'assessor'].includes(req.user.role);
    let workerId;
    if (isStaff && req.body.workerId) {
      workerId = req.body.workerId;
    } else {
      const worker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!worker) return res.status(403).json({ error: 'Worker profile not found' });
      workerId = worker._id.toString();
    }

    const enrollment = program.enrollments.find(e => e.worker.toString() === workerId.toString());
    if (!enrollment) return res.status(404).json({ error: 'Not enrolled in this program' });

    // Per-module quiz performance (best attempt each).
    const moduleTitle = (id) => program.modules.id(id)?.title || 'module';
    const bestByModule = {};
    for (const a of (enrollment.quizAttempts || [])) {
      const k = a.moduleId.toString();
      if (!bestByModule[k] || a.score > bestByModule[k].score) {
        bestByModule[k] = { title: moduleTitle(a.moduleId), score: a.score, passed: a.passed, attempts: 0 };
      }
    }
    for (const a of (enrollment.quizAttempts || [])) {
      const k = a.moduleId.toString();
      if (bestByModule[k]) bestByModule[k].attempts += 1;
    }
    const quizPerf = Object.values(bestByModule);
    const competencies = (enrollment.competencyScores || []).map(c => ({ skill: c.skill, score: c.score }));
    const submissions = (enrollment.submissions || []).map(s => ({
      module: moduleTitle(s.moduleId), grade: s.grade ?? null, status: s.status,
    }));

    if (!quizPerf.length && !competencies.length && !submissions.length) {
      return res.status(400).json({ error: 'Not enough activity yet to analyse. Complete some assessments first.' });
    }

    const promptText = `You are a vocational training coach. Analyse this learner's performance in the course "${program.title}" (trade: ${program.trade}).

Overall progress: ${enrollment.progress}%  ·  Pass mark: ${program.passMark || 70}%
Quiz/assessment performance (best score per module): ${JSON.stringify(quizPerf)}
Competency scores (0-100): ${JSON.stringify(competencies)}
Practical/assignment grades: ${JSON.stringify(submissions)}

Respond with ONLY valid JSON (no markdown fences):
{
  "summary": "<2-3 sentence plain-language overview of how the learner is doing>",
  "strengths": ["<specific strength grounded in the data>", ...],
  "weaknesses": ["<specific weakness/gap grounded in the data>", ...],
  "recommendations": ["<concrete, actionable next step>", ...],
  "focusAreas": ["<skill or topic to prioritise>", ...],
  "readiness": "<one of: on-track | needs-support | at-risk>"
}
Give 2-4 items per list, specific to this learner's data (cite modules/skills/scores). Keep it encouraging and practical.`;

    const aiResult = await sendPrompt(promptText, req.user._id, {
      systemPrompt: 'You are an expert vocational training coach. Always respond with valid JSON only.',
      maxTokens: 1500,
    });

    if (aiResult.error) {
      return res.status(aiResult.available ? 429 : 503).json({ error: aiResult.error });
    }

    let analysis;
    try {
      analysis = parseAIJson(aiResult.text);
    } catch {
      return res.status(500).json({ error: 'Failed to parse AI response' });
    }

    res.json({ analysis, cached: aiResult.cached, generatedAt: new Date() });
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   PARTICIPANT ANALYSIS — staff-facing cohort analysis of the replies
   participants submitted on quizzes, exercises/cases and assignments.
   ═══════════════════════════════════════════════════════════ */
router.post('/training/:id/participant-analysis', authenticate, authorize('admin', 'institution', 'assessor'), [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const training = await Training.findById(req.params.id)
      .populate({ path: 'enrollments.worker', select: 'fullName' });
    if (!training) return res.status(404).json({ error: 'Program not found' });

    const modTitle = (id) => training.modules.id(id)?.title || 'item';
    const enrollments = training.enrollments || [];
    if (!enrollments.length) return res.status(400).json({ error: 'No participants enrolled yet.' });

    // Per-participant roll-up.
    const participants = enrollments.map(e => {
      const best = {};
      for (const a of (e.quizAttempts || [])) {
        const k = a.moduleId?.toString();
        if (!best[k] || a.score > best[k]) best[k] = a.score;
      }
      const quizAvg = Object.values(best).length
        ? Math.round(Object.values(best).reduce((s, v) => s + v, 0) / Object.values(best).length) : null;
      return {
        name: e.worker?.fullName || 'Participant',
        progress: e.progress,
        quizAvg,
        scenarios: (e.scenarioResults || []).map(s => ({ item: modTitle(s.moduleId), score: s.score, passed: s.passed })),
        submissions: (e.submissions || []).map(s => ({ item: modTitle(s.moduleId), grade: s.grade ?? null, status: s.status })),
        competencies: (e.competencyScores || []).map(c => ({ skill: c.skill, score: c.score })),
        certificateIssued: !!e.certificateIssued,
      };
    });

    // Per-quiz-question difficulty (how often each question was answered wrong).
    const questionMiss = {};
    for (const e of enrollments) {
      for (const a of (e.quizAttempts || [])) {
        const mt = modTitle(a.moduleId);
        for (const ans of (a.answers || [])) {
          const key = `${mt} · Q${(ans.questionIndex ?? 0) + 1}`;
          questionMiss[key] = questionMiss[key] || { seen: 0, wrong: 0 };
          questionMiss[key].seen += 1;
          if (!ans.isCorrect) questionMiss[key].wrong += 1;
        }
      }
    }
    const hardest = Object.entries(questionMiss)
      .map(([q, d]) => ({ q, missRate: d.seen ? Math.round((d.wrong / d.seen) * 100) : 0, seen: d.seen }))
      .filter(x => x.seen >= 1).sort((a, b) => b.missRate - a.missRate).slice(0, 8);

    const summaryStats = {
      participants: participants.length,
      avgProgress: Math.round(participants.reduce((s, p) => s + (p.progress || 0), 0) / participants.length),
      certified: participants.filter(p => p.certificateIssued).length,
    };

    const promptText = `You are a training-quality analyst reviewing how participants performed on the assessments in "${training.title}" (trade: ${training.trade}).

Cohort stats: ${JSON.stringify(summaryStats)}
Per-participant results: ${JSON.stringify(participants).slice(0, 6000)}
Hardest questions (highest miss rate): ${JSON.stringify(hardest)}

Respond with ONLY valid JSON (no markdown fences):
{
  "overview": "<2-3 sentence read on how the cohort is doing>",
  "commonWeaknesses": ["<recurring gap grounded in the data>", ...],
  "hardestItems": ["<question/topic many got wrong, with the miss rate>", ...],
  "atRiskParticipants": ["<name — why they're at risk>", ...],
  "teachingRecommendations": ["<what the trainer should reinforce or re-teach>", ...],
  "assessmentImprovements": ["<how to improve a confusing/too-easy/too-hard item>", ...]
}
Give 2-5 specific, data-grounded items per list. If data is thin, say so honestly.`;

    const aiResult = await sendPrompt(promptText, req.user._id, {
      systemPrompt: 'You are an expert training-assessment analyst. Always respond with valid JSON only.',
      maxTokens: 1800,
    });
    if (aiResult.error) return res.status(aiResult.available ? 429 : 503).json({ error: aiResult.error });

    let analysis;
    try { analysis = parseAIJson(aiResult.text); }
    catch { return res.status(500).json({ error: 'Failed to parse AI response' }); }

    res.json({ analysis, stats: summaryStats, hardest, cached: aiResult.cached, generatedAt: new Date() });
  } catch (err) { next(err); }
});

// Extract plain text from an uploaded file (for filling an exercise's content box).
router.post('/extract-text', authenticate, authorize('admin', 'institution'), aiUpload.single('file'), async (req, res, next) => {
  try {
    const text = await extractFileText(req.file);
    res.json({ text: (text || '').slice(0, 20000), chars: (text || '').length });
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   AI QUESTION GENERATION — from an uploaded file + an instruction
   ("make MCQs from the uploaded file"). Runs through the AI relay.
   Reused for quizzes, exercises and the question bank.
   ═══════════════════════════════════════════════════════════ */
router.post('/training/:id/generate-questions', authenticate, authorize('admin', 'institution'),
  aiUpload.array('files', 10), [
    param('id').isMongoId(),
    handleValidation,
  ], async (req, res, next) => {
    try {
      const training = await Training.findById(req.params.id).select('title trade nqfLevel');
      if (!training) return res.status(404).json({ error: 'Program not found' });

      const instruction = (req.body.instruction || '').toString().slice(0, 1500);
      const count = Math.min(Math.max(parseInt(req.body.count, 10) || 5, 1), 40);
      const qType = ['mcq', 'true-false', 'short-answer', 'answer-box'].includes(req.body.type) ? req.body.type : 'mcq';
      const pastedText = (req.body.sourceText || '').toString();
      // Bulk: concatenate text from every uploaded file.
      const files = req.files || [];
      const texts = await Promise.all(files.map(f => extractFileText(f)));
      const fileText = texts.filter(Boolean).join('\n\n---\n\n');
      const source = `${fileText}\n${pastedText}`.trim().slice(0, 16000);

      if (!source && !instruction) {
        return res.status(400).json({ error: 'Provide an instruction and/or upload a file to generate from.' });
      }

      const shape = qType === 'mcq'
        ? '{ "question": "...", "type": "mcq", "options": ["a","b","c","d"], "correctOption": 0, "explanation": "...", "competencyTag": "..." }'
        : qType === 'true-false'
          ? '{ "question": "...", "type": "true-false", "correctAnswer": "true", "explanation": "...", "competencyTag": "..." }'
          : qType === 'answer-box'
            ? '{ "question": "...", "type": "essay", "modelAnswer": "<a full ideal answer>", "scoringCriteria": "<what a good answer must cover, so it can be graded>", "explanation": "...", "competencyTag": "..." }'
            : '{ "question": "...", "type": "short-answer", "acceptableAnswers": ["..."], "modelAnswer": "...", "scoringCriteria": "...", "explanation": "...", "competencyTag": "..." }';

      const promptText = `You are an assessment author for vocational training "${training.title}" (trade: ${training.trade}, NQF ${training.nqfLevel || 2}).

Instruction from the trainer: ${instruction || `Create ${count} ${qType} questions.`}

Source material to base the questions on:
"""
${source || '(no file provided — use the instruction and the trade context)'}
"""

Generate exactly ${count} ${qType} questions. Respond with ONLY a JSON array (no markdown fences), each item shaped like:
${shape}
Rules: questions must be answerable from the material/trade; for mcq exactly 4 options with correctOption as the 0-based index of the right one; keep a short "competencyTag" (a skill/domain like "Safety" or "Greening"); include a one-line "explanation".`;

      const aiResult = await sendPrompt(promptText, req.user._id, {
        systemPrompt: 'You are an expert vocational assessment author. Always respond with a valid JSON array only.',
        maxTokens: 3000, skipCache: true,
      });
      if (aiResult.error) return res.status(aiResult.available ? 429 : 503).json({ error: aiResult.error });

      let questions;
      try {
        questions = parseAIJson(aiResult.text);
        if (!Array.isArray(questions)) questions = questions.questions || [];
      } catch { return res.status(500).json({ error: 'Could not parse the generated questions. Try again.' }); }

      // Normalise.
      questions = questions.slice(0, count).map(q => ({
        question: q.question || '',
        type: q.type || (qType === 'answer-box' ? 'essay' : qType),
        options: Array.isArray(q.options) ? q.options.slice(0, 4) : undefined,
        correctOption: typeof q.correctOption === 'number' ? q.correctOption : (qType === 'mcq' ? 0 : undefined),
        correctAnswer: q.correctAnswer,
        acceptableAnswers: q.acceptableAnswers,
        modelAnswer: q.modelAnswer,
        scoringCriteria: q.scoringCriteria,
        explanation: q.explanation || '',
        competencyTag: q.competencyTag || undefined,
      })).filter(q => q.question);

      res.json({ questions, sourceChars: source.length, cached: false });
    } catch (err) { next(err); }
  });

/* ═══════════════════════════════════════════════════════════
   RESPONSE ANALYSIS — a respondent writes an answer; the AI scores it.
   Returns an ABSOLUTE score (%) and a RELATIVE score (percentile vs the
   cohort's assessment scores for this training). Both in percentage terms.
   ═══════════════════════════════════════════════════════════ */
router.post('/training/:id/analyze-response', authenticate, [
  param('id').isMongoId(),
  body('response').trim().notEmpty().withMessage('A response is required').isLength({ max: 8000 }),
  handleValidation,
], async (req, res, next) => {
  try {
    const training = await Training.findById(req.params.id);
    if (!training) return res.status(404).json({ error: 'Program not found' });

    const question = (req.body.question || '').toString().slice(0, 2000);
    const response = req.body.response.toString();
    const rubric = Array.isArray(req.body.rubric) ? req.body.rubric : [];

    const rubricText = rubric.length
      ? `Grade against this rubric (weights in %): ${JSON.stringify(rubric.map(r => ({ criterion: r.criterion, weightPct: r.weightPct ?? r.maxScore })))}`
      : 'Grade on correctness, completeness, and relevance to the trade.';

    const promptText = `You are grading a participant's free-text response in vocational training "${training.title}" (trade: ${training.trade}).

Question/prompt: ${question || '(general response for this training)'}
Participant's response:
"""
${response}
"""
${rubricText}

Respond with ONLY valid JSON (no markdown fences):
{
  "absolute": <integer 0-100, the quality/correctness score as a percentage>,
  "perCriterion": [{ "criterion": "<name>", "score": <0-100> }],
  "strengths": ["..."],
  "gaps": ["..."],
  "feedback": "<2-3 sentence actionable feedback>"
}`;

    const aiResult = await sendPrompt(promptText, req.user._id, {
      systemPrompt: 'You are a strict but fair vocational assessor. Always respond with valid JSON only.',
      maxTokens: 1200, skipCache: true,
    });
    if (aiResult.error) return res.status(aiResult.available ? 429 : 503).json({ error: aiResult.error });

    let graded;
    try { graded = parseAIJson(aiResult.text); }
    catch { return res.status(500).json({ error: 'Failed to parse AI response' }); }

    const absolute = Math.max(0, Math.min(100, Math.round(Number(graded.absolute) || 0)));

    // Relative = percentile of this absolute score within the cohort's grades.
    const cohortScores = (training.enrollments || []).map(e => {
      const best = {};
      for (const a of (e.quizAttempts || [])) {
        const k = a.moduleId?.toString();
        if (!best[k] || a.score > best[k]) best[k] = a.score;
      }
      const vals = Object.values(best);
      if (vals.length) return Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
      if (e.gradingBreakdown?.calculatedGrade != null) return Math.round(e.gradingBreakdown.calculatedGrade);
      return null;
    }).filter(v => v != null);

    let relative = null;
    if (cohortScores.length >= 2) {
      const below = cohortScores.filter(s => s < absolute).length;
      const cohortAvg = Math.round(cohortScores.reduce((s, v) => s + v, 0) / cohortScores.length);
      relative = {
        percentile: Math.round((below / cohortScores.length) * 100),
        cohortAvg,
        delta: absolute - cohortAvg,
        n: cohortScores.length,
      };
    }

    res.json({ absolute, relative, perCriterion: graded.perCriterion || [], strengths: graded.strengths || [], gaps: graded.gaps || [], feedback: graded.feedback || '', cached: false });
  } catch (err) { next(err); }
});

export default router;
