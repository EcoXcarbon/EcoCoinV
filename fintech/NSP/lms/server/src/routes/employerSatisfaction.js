import { Router } from 'express';
import { body, param, query } from 'express-validator';
import EmployerSatisfaction from '../models/EmployerSatisfaction.js';
import Worker from '../models/Worker.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { handleValidation } from '../middleware/validate.js';
import { auditLog } from '../middleware/audit.js';

const router = Router();

const RATING_FIELDS = ['overallPerformance', 'skillsMatch', 'safetyCompliance', 'communication', 'attitude', 'productivity', 'adaptability'];

// POST / — Employer submits rating
router.post('/', authenticate, authorize('employer', 'admin'), [
  body('workerId').isMongoId().withMessage('Valid worker ID required'),
  body('credentialId').optional().isMongoId(),
  ...RATING_FIELDS.map(f => body(`ratings.${f}`).isInt({ min: 1, max: 5 }).toInt()),
  body('rehireIntent').optional().isBoolean().toBoolean(),
  body('wouldRecommend').optional().isBoolean().toBoolean(),
  body('rplCertificateAccurate').optional().isBoolean().toBoolean(),
  body('rplCertificateUseful').optional().isBoolean().toBoolean(),
  body('strengths').optional().trim().isLength({ max: 2000 }),
  body('areasForImprovement').optional().trim().isLength({ max: 2000 }),
  body('trade').optional().trim(),
  body('country').optional().trim().isLength({ max: 100 }),
  handleValidation,
], auditLog('EMPLOYER_SATISFACTION_SUBMIT'), async (req, res, next) => {
  try {
    const worker = await Worker.findById(req.body.workerId);
    if (!worker) return res.status(404).json({ error: 'Worker not found' });

    const rating = await EmployerSatisfaction.create({
      worker: req.body.workerId,
      credential: req.body.credentialId,
      employer: req.user._id,
      ratings: req.body.ratings,
      rehireIntent: req.body.rehireIntent,
      wouldRecommend: req.body.wouldRecommend,
      rplCertificateAccurate: req.body.rplCertificateAccurate,
      rplCertificateUseful: req.body.rplCertificateUseful,
      strengths: req.body.strengths,
      areasForImprovement: req.body.areasForImprovement,
      trade: req.body.trade || worker.trade,
      country: req.body.country,
    });

    res.status(201).json(rating);
  } catch (err) { next(err); }
});

// GET / — List all ratings (admin, institution)
router.get('/', authenticate, authorize('admin', 'institution'), [
  query('trade').optional().trim(),
  query('status').optional().isIn(['submitted', 'verified', 'disputed']),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  handleValidation,
], async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const filter = {};
    if (req.query.trade) filter.trade = req.query.trade;
    if (req.query.status) filter.status = req.query.status;

    const total = await EmployerSatisfaction.countDocuments(filter);
    const ratings = await EmployerSatisfaction.find(filter)
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .populate('worker', 'fullName trade district')
      .populate('employer', 'name email');

    res.json({ total, page: Number(page), pages: Math.ceil(total / limit), ratings });
  } catch (err) { next(err); }
});

// GET /my-submissions — Employer's own submissions
router.get('/my-submissions', authenticate, authorize('employer', 'admin'), async (req, res, next) => {
  try {
    const ratings = await EmployerSatisfaction.find({ employer: req.user._id })
      .sort('-createdAt')
      .populate('worker', 'fullName trade district');
    res.json({ total: ratings.length, ratings });
  } catch (err) { next(err); }
});

// GET /analytics/summary — Aggregate analytics
router.get('/analytics/summary', authenticate, authorize('admin', 'institution'), async (req, res, next) => {
  try {
    const all = await EmployerSatisfaction.find({});
    if (all.length === 0) {
      return res.json({
        totalRatings: 0, avgSatisfaction: 0, rehireRate: 0,
        recommendRate: 0, rplAccuracyRate: 0, rplUsefulnessRate: 0,
        byTrade: [], byCountry: [], ratingDistribution: {},
      });
    }

    const totalRatings = all.length;
    const avgSatisfaction = Math.round((all.reduce((sum, r) => sum + (r.overallScore || 0), 0) / totalRatings) * 10) / 10;
    const rehireCount = all.filter(r => r.rehireIntent === true).length;
    const rehireTotal = all.filter(r => r.rehireIntent != null).length;
    const rehireRate = rehireTotal ? Math.round(rehireCount / rehireTotal * 100) : 0;
    const recommendCount = all.filter(r => r.wouldRecommend === true).length;
    const recommendTotal = all.filter(r => r.wouldRecommend != null).length;
    const recommendRate = recommendTotal ? Math.round(recommendCount / recommendTotal * 100) : 0;
    const accuracyCount = all.filter(r => r.rplCertificateAccurate === true).length;
    const accuracyTotal = all.filter(r => r.rplCertificateAccurate != null).length;
    const rplAccuracyRate = accuracyTotal ? Math.round(accuracyCount / accuracyTotal * 100) : 0;
    const usefulCount = all.filter(r => r.rplCertificateUseful === true).length;
    const usefulTotal = all.filter(r => r.rplCertificateUseful != null).length;
    const rplUsefulnessRate = usefulTotal ? Math.round(usefulCount / usefulTotal * 100) : 0;

    // By trade
    const tradeMap = {};
    for (const r of all) {
      const t = r.trade || 'unknown';
      if (!tradeMap[t]) tradeMap[t] = { trade: t, count: 0, totalScore: 0 };
      tradeMap[t].count++;
      tradeMap[t].totalScore += r.overallScore || 0;
    }
    const byTrade = Object.values(tradeMap).map(t => ({
      trade: t.trade, count: t.count, avgScore: Math.round((t.totalScore / t.count) * 10) / 10,
    })).sort((a, b) => b.count - a.count);

    // By country
    const countryMap = {};
    for (const r of all) {
      const c = r.country || 'unknown';
      if (!countryMap[c]) countryMap[c] = { country: c, count: 0, totalScore: 0 };
      countryMap[c].count++;
      countryMap[c].totalScore += r.overallScore || 0;
    }
    const byCountry = Object.values(countryMap).map(c => ({
      country: c.country, count: c.count, avgScore: Math.round((c.totalScore / c.count) * 10) / 10,
    })).sort((a, b) => b.count - a.count);

    // Rating distribution (1-5)
    const ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of all) {
      const rounded = Math.round(r.overallScore || 0);
      if (rounded >= 1 && rounded <= 5) ratingDistribution[rounded]++;
    }

    res.json({
      totalRatings, avgSatisfaction, rehireRate, recommendRate,
      rplAccuracyRate, rplUsefulnessRate, byTrade, byCountry, ratingDistribution,
    });
  } catch (err) { next(err); }
});

// GET /worker/:workerId — Ratings for a specific worker
router.get('/worker/:workerId', authenticate, [
  param('workerId').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const ratings = await EmployerSatisfaction.find({ worker: req.params.workerId })
      .sort('-createdAt')
      .populate('employer', 'name email');
    const avgScore = ratings.length
      ? Math.round((ratings.reduce((sum, r) => sum + (r.overallScore || 0), 0) / ratings.length) * 10) / 10
      : 0;
    res.json({ total: ratings.length, avgScore, ratings });
  } catch (err) { next(err); }
});

// GET /:id — Get single rating
router.get('/:id', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const rating = await EmployerSatisfaction.findById(req.params.id)
      .populate('worker', 'fullName trade district')
      .populate('employer', 'name email');
    if (!rating) return res.status(404).json({ error: 'Rating not found' });
    res.json(rating);
  } catch (err) { next(err); }
});

// PUT /:id/verify — Verify a rating (admin, institution)
router.put('/:id/verify', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId(),
  handleValidation,
], auditLog('EMPLOYER_SATISFACTION_VERIFY'), async (req, res, next) => {
  try {
    const rating = await EmployerSatisfaction.findById(req.params.id);
    if (!rating) return res.status(404).json({ error: 'Rating not found' });

    rating.status = 'verified';
    rating.verifiedBy = req.user._id;
    rating.verifiedAt = new Date();
    await rating.save();

    res.json({ message: 'Rating verified', rating });
  } catch (err) { next(err); }
});

export default router;
