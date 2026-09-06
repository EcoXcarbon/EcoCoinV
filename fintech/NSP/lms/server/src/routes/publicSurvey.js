/**
 * Public (no-login) survey access for surveys flagged { isSurvey, publicSurvey }.
 * Mounted BEFORE CSRF/auth so a direct link can open and submit the form.
 *   GET  /api/v1/public-survey/:tid/:mid   → { title, questions }
 *   POST /api/v1/public-survey/:tid/:mid   → { name, answers } → stored
 */
import { Router } from 'express';
import mongoose from 'mongoose';
import Training from '../models/Training.js';

const router = Router();
const isId = (s) => mongoose.Types.ObjectId.isValid(s);

function findPublicSurvey(t, mid) {
  if (!t) return null;
  const mod = (t.modules || []).find(m => m._id.toString() === mid);
  if (!mod || !mod.isSurvey || !mod.publicSurvey) return null;
  return mod;
}

// GET the questions for a public survey.
router.get('/:tid/:mid', async (req, res, next) => {
  try {
    const { tid, mid } = req.params;
    if (!isId(tid) || !isId(mid)) return res.status(400).json({ error: 'Invalid link.' });
    const t = await Training.findById(tid).select('title modules').lean();
    const mod = findPublicSurvey(t, mid);
    if (!mod) return res.status(404).json({ error: 'This survey is not available.' });
    res.json({
      trainingTitle: t.title,
      title: mod.title,
      questions: (mod.surveyQuestions || []).map(q => ({
        section: q.section, prompt: q.prompt, options: q.options || [], multi: !!q.multi, text: !!q.text,
      })),
    });
  } catch (err) { next(err); }
});

// POST a public submission (name + answers). No login; no dedupe (event use).
router.post('/:tid/:mid', async (req, res, next) => {
  try {
    const { tid, mid } = req.params;
    if (!isId(tid) || !isId(mid)) return res.status(400).json({ error: 'Invalid link.' });
    const program = await Training.findById(tid).select('modules');
    const mod = findPublicSurvey(program, mid);
    if (!mod) return res.status(404).json({ error: 'This survey is not available.' });

    const name = String(req.body.name || '').trim().slice(0, 120);
    if (!name) return res.status(400).json({ error: 'Please enter your name.' });

    const qs = mod.surveyQuestions || [];
    const answers = (req.body.answers || []).map((a, i) => {
      const q = qs[i] || {};
      if (q.text) return { qi: i, text: String(a?.text || '').slice(0, 2000) };
      if (q.multi) return { qi: i, choices: Array.isArray(a?.choices) ? a.choices.filter(c => (q.options || []).includes(c)) : [] };
      return { qi: i, choice: (q.options || []).includes(a?.choice) ? a.choice : '' };
    });

    await Training.updateOne({ _id: tid }, {
      $push: { surveySubmissions: { module: mod._id, respondentName: name, isPublic: true, submittedAt: new Date(), answers } },
    });
    res.status(201).json({ ok: true, message: 'Thank you — your response was recorded.' });
  } catch (err) { next(err); }
});

export default router;
