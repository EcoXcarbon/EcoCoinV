import { Router } from 'express';
import { query } from 'express-validator';
import Worker from '../models/Worker.js';
import Credential from '../models/Credential.js';
import Assessment from '../models/Assessment.js';
import Training from '../models/Training.js';
import User from '../models/User.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { handleValidation } from '../middleware/validate.js';

const router = Router();

// Dashboard KPIs (includes training stats)
router.get('/dashboard', authenticate, async (req, res, next) => {
  try {
    const [totalWorkers, certifiedWorkers, activeCredentials, pendingAssessments, trainingPrograms] = await Promise.all([
      Worker.countDocuments({ status: { $ne: 'inactive' } }),
      Worker.countDocuments({ status: 'certified' }),
      Credential.countDocuments({ status: 'active' }),
      Assessment.countDocuments({ status: { $in: ['pending', 'in-review'] } }),
      Training.find({ status: 'active' }).select('enrollments'),
    ]);

    const gulfReady = await Worker.countDocuments({
      'gulfReadiness.score': { $gte: 70 },
      status: { $ne: 'inactive' },
    });

    // Training KPIs
    let totalEnrollments = 0;
    let completedTraining = 0;
    for (const p of trainingPrograms) {
      totalEnrollments += p.enrollments.length;
      completedTraining += p.enrollments.filter(e => e.status === 'completed').length;
    }

    res.json({
      totalWorkers,
      certifiedWorkers,
      certificationRate: totalWorkers ? Math.round(certifiedWorkers / totalWorkers * 100) : 0,
      activeCredentials,
      pendingAssessments,
      gulfReadiness: totalWorkers ? Math.round(gulfReady / totalWorkers * 100) : 0,
      trainingPrograms: trainingPrograms.length,
      totalEnrollments,
      completedTraining,
      trainingCompletionRate: totalEnrollments ? Math.round(completedTraining / totalEnrollments * 100) : 0,
    });
  } catch (err) { next(err); }
});

// Registration trend (monthly)
router.get('/registrations', authenticate, [
  query('months').optional().isInt({ min: 1, max: 24 }).toInt(),
  handleValidation,
], async (req, res, next) => {
  try {
    const months = req.query.months || 6;
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    const data = await Worker.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
        count: { $sum: 1 },
      }},
      { $sort: { _id: 1 } },
    ]);
    res.json(data);
  } catch (err) { next(err); }
});

// Trade distribution
router.get('/trades', authenticate, async (req, res, next) => {
  try {
    const data = await Worker.aggregate([
      { $match: { status: { $ne: 'inactive' } } },
      { $group: { _id: '$trade', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);
    res.json(data);
  } catch (err) { next(err); }
});

// District distribution
router.get('/districts', authenticate, async (req, res, next) => {
  try {
    const data = await Worker.aggregate([
      { $match: { status: { $ne: 'inactive' } } },
      { $group: { _id: '$district', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);
    res.json(data);
  } catch (err) { next(err); }
});

// Skills gap analysis
router.get('/skills-gap', authenticate, async (req, res, next) => {
  try {
    const supply = await Worker.aggregate([
      { $match: { status: { $ne: 'inactive' } } },
      { $group: { _id: '$trade', supply: { $sum: 1 } } },
    ]);

    const demandMultiplier = {
      mason: 1.25, electrician: 1.35, welder: 1.30, plumber: 1.20,
      carpenter: 1.15, 'steel-fixer': 1.40, painter: 1.10, hvac: 1.50,
      'pipe-fitter': 1.45, scaffolder: 1.35, rigger: 1.40, 'crane-operator': 1.55,
      'heavy-driver': 1.30, 'shuttering-carpenter': 1.25, 'tile-fixer': 1.20,
      'duct-fabricator': 1.40, 'auto-mechanic': 1.20, 'diesel-mechanic': 1.25,
      fabricator: 1.35, 'insulation-worker': 1.30, 'heavy-equipment-operator': 1.50,
      'aluminium-fabricator': 1.35, 'safety-officer': 1.60, cook: 1.15,
      'ac-technician': 1.45,
    };

    const gap = supply.map(s => ({
      trade: s._id,
      supply: s.supply,
      demand: Math.round(s.supply * (demandMultiplier[s._id] || 1.2)),
      gap: -Math.round(s.supply * ((demandMultiplier[s._id] || 1.2) - 1)),
      gapPercent: -Math.round(((demandMultiplier[s._id] || 1.2) - 1) * 100),
    }));
    res.json(gap);
  } catch (err) { next(err); }
});

// Assessor stats
router.get('/assessor', authenticate, authorize('admin', 'assessor'), async (req, res, next) => {
  try {
    const assessorId = req.user.role === 'assessor' ? req.user._id : undefined;
    const filter = assessorId ? { assessor: assessorId } : {};

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [pendingVideos, pendingChecklists, reviewedToday, totalApproved, totalReviewed] = await Promise.all([
      Assessment.countDocuments({ ...filter, type: 'video', status: { $in: ['pending', 'in-review'] } }),
      Assessment.countDocuments({ ...filter, type: 'checklist', status: { $in: ['pending', 'in-review'] } }),
      Assessment.countDocuments({ ...filter, completedAt: { $gte: today } }),
      Assessment.countDocuments({ ...filter, status: 'approved' }),
      Assessment.countDocuments({ ...filter, status: { $in: ['approved', 'rejected'] } }),
    ]);

    res.json({
      pendingVideos,
      pendingChecklists,
      reviewedToday,
      approvalRate: totalReviewed ? Math.round(totalApproved / totalReviewed * 100) : 0,
    });
  } catch (err) { next(err); }
});

// Employer workforce overview
router.get('/employer', authenticate, authorize('admin', 'employer'), async (req, res, next) => {
  try {
    const availableFilter = { status: { $in: ['assessed', 'certified', 'employed'] } };

    const [totalAvailable, certified, byTrade, byDistrict, gulfReady, activeCredentials] = await Promise.all([
      Worker.countDocuments(availableFilter),
      Worker.countDocuments({ ...availableFilter, status: 'certified' }),
      Worker.aggregate([
        { $match: availableFilter },
        { $group: { _id: '$trade', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Worker.aggregate([
        { $match: availableFilter },
        { $group: { _id: '$district', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      Worker.countDocuments({ ...availableFilter, 'gulfReadiness.score': { $gte: 70 } }),
      Credential.countDocuments({ status: 'active' }),
    ]);

    // NQF level distribution
    const byNqf = await Worker.aggregate([
      { $match: availableFilter },
      { $group: { _id: '$nqfLevel', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);

    res.json({
      totalAvailable,
      certified,
      certificationRate: totalAvailable ? Math.round(certified / totalAvailable * 100) : 0,
      gulfReady,
      gulfReadyRate: totalAvailable ? Math.round(gulfReady / totalAvailable * 100) : 0,
      activeCredentials,
      byTrade,
      byDistrict,
      byNqf,
    });
  } catch (err) { next(err); }
});

// Time-series trends (also available to employers)
router.get('/trends', authenticate, async (req, res, next) => {
  try {
    const months = 6;
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    const [workers, credentials, assessments] = await Promise.all([
      Worker.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Credential.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Assessment.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
    ]);

    // Merge into unified timeline
    const months_set = new Set([
      ...workers.map(d => d._id),
      ...credentials.map(d => d._id),
      ...assessments.map(d => d._id),
    ]);
    const sorted = [...months_set].sort();
    const result = sorted.map(month => ({
      month,
      workers: workers.find(d => d._id === month)?.count || 0,
      credentials: credentials.find(d => d._id === month)?.count || 0,
      assessments: assessments.find(d => d._id === month)?.count || 0,
    }));

    res.json(result);
  } catch (err) { next(err); }
});

// Assessment pipeline (also available to employers)
router.get('/pipeline', authenticate, async (req, res, next) => {
  try {
    const statuses = await Assessment.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const byStatus = {};
    statuses.forEach(s => { byStatus[s._id] = s.count; });

    res.json({
      scheduled: byStatus['pending'] || 0,
      inProgress: byStatus['in-review'] || 0,
      completed: (byStatus['approved'] || 0) + (byStatus['rejected'] || 0),
      failed: byStatus['rejected'] || 0,
    });
  } catch (err) { next(err); }
});

// ====================================================================
// Gap #35: RPL Analytics Dashboard
// ====================================================================
router.get('/rpl-dashboard', authenticate, authorize('admin', 'institution', 'assessor'), async (req, res, next) => {
  try {
    const rplFilter = { type: 'rpl' };

    const [
      totalRpl, rplApproved, rplRejected, rplPending, rplInReview,
      rplAwaitingMod, rplAwaitingExtMod, rplAppealed,
    ] = await Promise.all([
      Assessment.countDocuments(rplFilter),
      Assessment.countDocuments({ ...rplFilter, status: 'approved' }),
      Assessment.countDocuments({ ...rplFilter, status: 'rejected' }),
      Assessment.countDocuments({ ...rplFilter, status: 'pending' }),
      Assessment.countDocuments({ ...rplFilter, status: 'in-review' }),
      Assessment.countDocuments({ ...rplFilter, status: 'awaiting-moderation' }),
      Assessment.countDocuments({ ...rplFilter, status: 'awaiting-external-moderation' }),
      Assessment.countDocuments({ ...rplFilter, status: 'appealed' }),
    ]);

    // Pass rate
    const completed = rplApproved + rplRejected;
    const passRate = completed ? Math.round(rplApproved / completed * 100) : 0;

    // By trade
    const byTrade = await Assessment.aggregate([
      { $match: rplFilter },
      { $group: {
        _id: '$trade',
        total: { $sum: 1 },
        approved: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } },
        rejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
      }},
      { $addFields: {
        passRate: { $cond: [
          { $gt: [{ $add: ['$approved', '$rejected'] }, 0] },
          { $round: [{ $multiply: [{ $divide: ['$approved', { $add: ['$approved', '$rejected'] }] }, 100] }, 0] },
          0,
        ]},
      }},
      { $sort: { total: -1 } },
    ]);

    // Credential tier distribution
    const byTier = await Assessment.aggregate([
      { $match: { ...rplFilter, 'rpl.credentialTier': { $exists: true, $ne: null } } },
      { $group: { _id: '$rpl.credentialTier', count: { $sum: 1 } } },
    ]);

    // Challenge exam stats
    const examStats = await Assessment.aggregate([
      { $match: { ...rplFilter, 'rpl.challengeExam.completed': true } },
      { $group: {
        _id: null,
        total: { $sum: 1 },
        passed: { $sum: { $cond: ['$rpl.challengeExam.passed', 1, 0] } },
        avgScore: { $avg: '$rpl.challengeExam.score' },
      }},
    ]);

    // Average processing time (from creation to completion)
    const avgTimeData = await Assessment.aggregate([
      { $match: { ...rplFilter, completedAt: { $exists: true } } },
      { $project: {
        processingDays: { $divide: [{ $subtract: ['$completedAt', '$createdAt'] }, 1000 * 60 * 60 * 24] },
      }},
      { $group: { _id: null, avgDays: { $avg: '$processingDays' } } },
    ]);

    // Witness testimony stats
    const witnessStats = await Assessment.aggregate([
      { $match: { ...rplFilter, 'rpl.witnessTestimonies': { $exists: true, $ne: [] } } },
      { $project: { testimonies: { $size: '$rpl.witnessTestimonies' } } },
      { $group: { _id: null, total: { $sum: '$testimonies' }, assessmentsWithTestimony: { $sum: 1 } } },
    ]);

    // Monthly trend
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const monthlyTrend = await Assessment.aggregate([
      { $match: { ...rplFilter, createdAt: { $gte: sixMonthsAgo } } },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
        total: { $sum: 1 },
        approved: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } },
        rejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
      }},
      { $sort: { _id: 1 } },
    ]);

    res.json({
      overview: {
        total: totalRpl,
        approved: rplApproved,
        rejected: rplRejected,
        pending: rplPending,
        inReview: rplInReview,
        awaitingModeration: rplAwaitingMod,
        awaitingExternalModeration: rplAwaitingExtMod,
        appealed: rplAppealed,
        passRate,
        completed,
      },
      byTrade,
      byTier: byTier.reduce((acc, t) => { acc[t._id] = t.count; return acc; }, {}),
      challengeExam: examStats[0] ? {
        total: examStats[0].total,
        passed: examStats[0].passed,
        passRate: Math.round(examStats[0].passed / examStats[0].total * 100),
        avgScore: Math.round(examStats[0].avgScore),
      } : { total: 0, passed: 0, passRate: 0, avgScore: 0 },
      avgProcessingDays: avgTimeData[0] ? Math.round(avgTimeData[0].avgDays * 10) / 10 : null,
      witnessTestimonies: witnessStats[0] || { total: 0, assessmentsWithTestimony: 0 },
      monthlyTrend,
    });
  } catch (err) { next(err); }
});

// ====================================================================
// Gap #36: RPL Pipeline / Funnel Visualization
// ====================================================================
router.get('/rpl-pipeline', authenticate, authorize('admin', 'institution', 'assessor'), [
  query('trade').optional().trim(),
  query('months').optional().isInt({ min: 1, max: 24 }).toInt(),
  handleValidation,
], async (req, res, next) => {
  try {
    const filter = { type: 'rpl' };
    if (req.query.trade) filter.trade = req.query.trade;
    if (req.query.months) {
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - req.query.months);
      filter.createdAt = { $gte: startDate };
    }

    // Stage-by-stage funnel — count how many assessments have completed each stage
    const stageData = await Assessment.aggregate([
      { $match: filter },
      { $group: {
        _id: null,
        total: { $sum: 1 },
        preScreening: { $sum: { $cond: ['$rpl.stageCompleted.preScreening', 1, 0] } },
        evidenceSubmission: { $sum: { $cond: ['$rpl.stageCompleted.evidenceSubmission', 1, 0] } },
        challengeExam: { $sum: { $cond: ['$rpl.stageCompleted.challengeExam', 1, 0] } },
        documentReview: { $sum: { $cond: ['$rpl.stageCompleted.documentReview', 1, 0] } },
        interview: { $sum: { $cond: ['$rpl.stageCompleted.interview', 1, 0] } },
        practicalDemo: { $sum: { $cond: ['$rpl.stageCompleted.practicalDemo', 1, 0] } },
        finalDecision: { $sum: { $cond: ['$rpl.stageCompleted.finalDecision', 1, 0] } },
        // Status-based stages
        moderated: { $sum: { $cond: [{ $ne: [{ $ifNull: ['$rpl.moderation.decision', null] }, null] }, 1, 0] } },
        externalModerated: { $sum: { $cond: [{ $eq: ['$rpl.externalModeration.status', 'completed'] }, 1, 0] } },
        approved: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } },
        rejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
      }},
    ]);

    const s = stageData[0] || {};
    const total = s.total || 0;

    // Build funnel with conversion rates
    const stages = [
      { stage: 'Created', count: total, rate: 100 },
      { stage: 'Pre-Screening', count: s.preScreening || 0, rate: total ? Math.round((s.preScreening || 0) / total * 100) : 0 },
      { stage: 'Evidence Submission', count: s.evidenceSubmission || 0, rate: total ? Math.round((s.evidenceSubmission || 0) / total * 100) : 0 },
      { stage: 'Challenge Exam', count: s.challengeExam || 0, rate: total ? Math.round((s.challengeExam || 0) / total * 100) : 0 },
      { stage: 'Document Review', count: s.documentReview || 0, rate: total ? Math.round((s.documentReview || 0) / total * 100) : 0 },
      { stage: 'Interview', count: s.interview || 0, rate: total ? Math.round((s.interview || 0) / total * 100) : 0 },
      { stage: 'Practical Demo', count: s.practicalDemo || 0, rate: total ? Math.round((s.practicalDemo || 0) / total * 100) : 0 },
      { stage: 'Final Decision', count: s.finalDecision || 0, rate: total ? Math.round((s.finalDecision || 0) / total * 100) : 0 },
      { stage: 'Moderated', count: s.moderated || 0, rate: total ? Math.round((s.moderated || 0) / total * 100) : 0 },
      { stage: 'External Moderated', count: s.externalModerated || 0, rate: total ? Math.round((s.externalModerated || 0) / total * 100) : 0 },
      { stage: 'Approved', count: s.approved || 0, rate: total ? Math.round((s.approved || 0) / total * 100) : 0 },
    ];

    // Drop-off analysis: where are candidates getting stuck?
    const dropoffs = [];
    for (let i = 1; i < stages.length; i++) {
      const prev = stages[i - 1];
      const curr = stages[i];
      if (prev.count > 0) {
        const dropoff = prev.count - curr.count;
        const dropoffRate = Math.round(dropoff / prev.count * 100);
        if (dropoff > 0) {
          dropoffs.push({ from: prev.stage, to: curr.stage, dropped: dropoff, dropoffRate });
        }
      }
    }

    // Current status distribution (where assessments are right now)
    const currentStatus = await Assessment.aggregate([
      { $match: filter },
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // Average time at each stage (using timeline data)
    const avgStageTimes = await Assessment.aggregate([
      { $match: { ...filter, 'rpl.timeline': { $exists: true, $ne: [] } } },
      { $unwind: '$rpl.timeline' },
      { $match: { 'rpl.timeline.actualDurationDays': { $exists: true, $gt: 0 } } },
      { $group: {
        _id: '$rpl.timeline.stage',
        avgDays: { $avg: '$rpl.timeline.actualDurationDays' },
        count: { $sum: 1 },
      }},
      { $sort: { _id: 1 } },
    ]);

    // Trade breakdown within pipeline
    const byTrade = await Assessment.aggregate([
      { $match: filter },
      { $group: {
        _id: '$trade',
        total: { $sum: 1 },
        preScreening: { $sum: { $cond: ['$rpl.stageCompleted.preScreening', 1, 0] } },
        approved: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } },
        rejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
      }},
      { $addFields: {
        conversionRate: { $cond: [
          { $gt: ['$total', 0] },
          { $round: [{ $multiply: [{ $divide: ['$approved', '$total'] }, 100] }, 0] },
          0,
        ]},
      }},
      { $sort: { total: -1 } },
    ]);

    res.json({
      total,
      funnel: stages,
      dropoffs,
      currentStatus: currentStatus.reduce((acc, s) => { acc[s._id] = s.count; return acc; }, {}),
      avgStageTimes: avgStageTimes.map(s => ({ stage: s._id, avgDays: Math.round(s.avgDays * 10) / 10, sampleSize: s.count })),
      byTrade,
      rejected: s.rejected || 0,
    });
  } catch (err) { next(err); }
});

// ====================================================================
// Gap #32: Fee Summary Analytics
// ====================================================================
router.get('/fee-summary', authenticate, authorize('admin', 'institution'), async (req, res, next) => {
  try {
    const assessments = await Assessment.find({
      type: 'rpl',
      'rpl.fees.items': { $exists: true, $ne: [] },
    }).select('rpl.fees trade');

    let totalRevenue = 0, totalPaid = 0, totalWaived = 0, totalOutstanding = 0;
    const byFeeType = {};
    const byTrade = {};

    for (const a of assessments) {
      const fees = a.rpl?.fees;
      if (!fees) continue;
      totalRevenue += fees.totalAmount || 0;
      totalPaid += fees.totalPaid || 0;
      totalWaived += fees.totalWaived || 0;
      totalOutstanding += fees.totalOutstanding || 0;

      for (const item of (fees.items || [])) {
        if (!byFeeType[item.feeType]) byFeeType[item.feeType] = { feeType: item.feeType, total: 0, paid: 0, waived: 0, count: 0 };
        byFeeType[item.feeType].total += item.amount;
        byFeeType[item.feeType].count++;
        if (item.status === 'paid') byFeeType[item.feeType].paid += item.amount;
        if (item.status === 'waived') byFeeType[item.feeType].waived += item.amount;
      }

      const t = a.trade || 'unknown';
      if (!byTrade[t]) byTrade[t] = { trade: t, total: 0, paid: 0, count: 0 };
      byTrade[t].total += fees.totalAmount || 0;
      byTrade[t].paid += fees.totalPaid || 0;
      byTrade[t].count++;
    }

    res.json({
      totalRevenue, totalPaid, totalWaived, totalOutstanding,
      assessmentsWithFees: assessments.length,
      byFeeType: Object.values(byFeeType).sort((a, b) => b.total - a.total),
      byTrade: Object.values(byTrade).sort((a, b) => b.total - a.total),
    });
  } catch (err) { next(err); }
});

// ====================================================================
// Gap #37: RPL Outcome Comparison Reports
// ====================================================================
router.get('/rpl-outcome-reports', authenticate, authorize('admin', 'institution'), [
  query('groupBy').isIn(['trade', 'district', 'nqfLevel', 'month']).withMessage('groupBy required: trade|district|nqfLevel|month'),
  query('compareBy').optional().isIn(['passRate', 'avgScore', 'processingTime', 'volume']),
  query('dateFrom').optional().isISO8601(),
  query('dateTo').optional().isISO8601(),
  query('months').optional().isInt({ min: 1, max: 24 }).toInt(),
  query('trade').optional().trim(),
  query('district').optional().trim(),
  handleValidation,
], async (req, res, next) => {
  try {
    const { groupBy, compareBy = 'passRate', dateFrom, dateTo, months, trade, district } = req.query;

    // Build match filter
    const match = { type: 'rpl' };
    if (trade) match.trade = trade;
    if (dateFrom || dateTo || months) {
      match.createdAt = {};
      if (dateFrom) match.createdAt.$gte = new Date(dateFrom);
      if (dateTo) match.createdAt.$lte = new Date(dateTo);
      if (months && !dateFrom) {
        const d = new Date();
        d.setMonth(d.getMonth() - months);
        match.createdAt.$gte = d;
      }
    }

    // For district grouping, join with Worker
    let pipeline;
    if (groupBy === 'district') {
      pipeline = [
        { $match: match },
        { $lookup: { from: 'workers', localField: 'worker', foreignField: '_id', as: 'w' } },
        { $unwind: { path: '$w', preserveNullAndEmptyArrays: true } },
      ];
      if (district) pipeline.push({ $match: { 'w.district': district } });
      pipeline.push({
        $group: {
          _id: '$w.district',
          total: { $sum: 1 },
          approved: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } },
          rejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
          totalScore: { $sum: { $ifNull: ['$score', 0] } },
          scoreCount: { $sum: { $cond: [{ $gt: ['$score', null] }, 1, 0] } },
          completedDates: { $push: { completedAt: '$completedAt', createdAt: '$createdAt' } },
        },
      });
    } else if (groupBy === 'nqfLevel') {
      pipeline = [
        { $match: match },
        { $lookup: { from: 'workers', localField: 'worker', foreignField: '_id', as: 'w' } },
        { $unwind: { path: '$w', preserveNullAndEmptyArrays: true } },
        { $group: {
          _id: '$w.nqfLevel',
          total: { $sum: 1 },
          approved: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } },
          rejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
          totalScore: { $sum: { $ifNull: ['$score', 0] } },
          scoreCount: { $sum: { $cond: [{ $gt: ['$score', null] }, 1, 0] } },
          completedDates: { $push: { completedAt: '$completedAt', createdAt: '$createdAt' } },
        }},
      ];
    } else if (groupBy === 'month') {
      pipeline = [
        { $match: match },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
          total: { $sum: 1 },
          approved: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } },
          rejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
          totalScore: { $sum: { $ifNull: ['$score', 0] } },
          scoreCount: { $sum: { $cond: [{ $gt: ['$score', null] }, 1, 0] } },
          completedDates: { $push: { completedAt: '$completedAt', createdAt: '$createdAt' } },
        }},
        { $sort: { _id: 1 } },
      ];
    } else {
      // trade
      pipeline = [
        { $match: match },
        { $group: {
          _id: '$trade',
          total: { $sum: 1 },
          approved: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } },
          rejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
          totalScore: { $sum: { $ifNull: ['$score', 0] } },
          scoreCount: { $sum: { $cond: [{ $gt: ['$score', null] }, 1, 0] } },
          completedDates: { $push: { completedAt: '$completedAt', createdAt: '$createdAt' } },
        }},
      ];
    }

    const raw = await Assessment.aggregate(pipeline);

    // Process groups
    const groups = raw.map(g => {
      const completed = g.approved + g.rejected;
      const passRate = completed ? Math.round(g.approved / completed * 100) : 0;
      const avgScore = g.scoreCount ? Math.round((g.totalScore / g.scoreCount) * 10) / 10 : 0;
      // Calculate avg processing days
      const durations = (g.completedDates || [])
        .filter(d => d.completedAt && d.createdAt)
        .map(d => (new Date(d.completedAt) - new Date(d.createdAt)) / (1000 * 60 * 60 * 24));
      const avgProcessingDays = durations.length ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10 : null;

      return {
        group: g._id || 'unknown',
        total: g.total,
        approved: g.approved,
        rejected: g.rejected,
        passRate,
        avgScore,
        processingDays: avgProcessingDays,
      };
    });

    // Sort by compareBy metric
    groups.sort((a, b) => {
      if (compareBy === 'volume') return b.total - a.total;
      if (compareBy === 'avgScore') return b.avgScore - a.avgScore;
      if (compareBy === 'processingTime') return (a.processingDays || 999) - (b.processingDays || 999);
      return b.passRate - a.passRate;
    });

    // Comparison stats
    const passRates = groups.map(g => g.passRate);
    const comparison = groups.length ? {
      highest: { group: groups[0].group, value: groups[0][compareBy === 'volume' ? 'total' : compareBy] },
      lowest: { group: groups[groups.length - 1].group, value: groups[groups.length - 1][compareBy === 'volume' ? 'total' : compareBy] },
      average: compareBy === 'passRate' ? (passRates.length ? Math.round(passRates.reduce((a, b) => a + b, 0) / passRates.length) : 0) : null,
      spread: passRates.length >= 2 ? Math.max(...passRates) - Math.min(...passRates) : 0,
    } : {};

    // Period comparison — auto half-split
    let periodComparison = null;
    if (groups.length >= 2 && groupBy === 'month') {
      const mid = Math.floor(groups.length / 2);
      const firstHalf = groups.slice(0, mid);
      const secondHalf = groups.slice(mid);
      const avgFirst = firstHalf.length ? Math.round(firstHalf.reduce((s, g) => s + g.passRate, 0) / firstHalf.length) : 0;
      const avgSecond = secondHalf.length ? Math.round(secondHalf.reduce((s, g) => s + g.passRate, 0) / secondHalf.length) : 0;
      periodComparison = {
        firstPeriod: { from: firstHalf[0].group, to: firstHalf[firstHalf.length - 1].group, avgPassRate: avgFirst, volume: firstHalf.reduce((s, g) => s + g.total, 0) },
        secondPeriod: { from: secondHalf[0].group, to: secondHalf[secondHalf.length - 1].group, avgPassRate: avgSecond, volume: secondHalf.reduce((s, g) => s + g.total, 0) },
        trend: avgSecond > avgFirst ? 'improving' : avgSecond < avgFirst ? 'declining' : 'stable',
      };
    }

    res.json({ groupBy, compareBy, totalGroups: groups.length, groups, comparison, periodComparison });
  } catch (err) { next(err); }
});

// ====================================================================
// Gap #35: Assessor Performance Analytics
// ====================================================================
router.get('/rpl-assessor-performance', authenticate, authorize('admin', 'institution'), async (req, res, next) => {
  try {
    // Per-assessor RPL statistics
    const assessorStats = await Assessment.aggregate([
      { $match: { type: 'rpl', status: { $in: ['approved', 'rejected'] } } },
      { $group: {
        _id: '$assessor',
        total: { $sum: 1 },
        approved: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } },
        rejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
        avgScore: { $avg: '$score' },
        trades: { $addToSet: '$trade' },
        lastAssessment: { $max: '$completedAt' },
      }},
      { $addFields: {
        passRate: { $round: [{ $multiply: [{ $divide: ['$approved', '$total'] }, 100] }, 0] },
      }},
      { $sort: { total: -1 } },
    ]);

    // Enrich with user names and CPD status
    const enriched = await Promise.all(assessorStats.map(async (stat) => {
      const user = await User.findById(stat._id).select('name email assessorExperience cpdRecords cpdRequiredHours cpdYearStart');
      const now = new Date();
      const yearStart = user?.cpdYearStart || new Date(now.getFullYear(), 0, 1);
      const cpdHours = (user?.cpdRecords || [])
        .filter(r => new Date(r.completedDate) >= yearStart)
        .reduce((sum, r) => sum + r.hours, 0);

      return {
        assessorId: stat._id,
        name: user?.name || 'Unknown',
        email: user?.email,
        total: stat.total,
        approved: stat.approved,
        rejected: stat.rejected,
        passRate: stat.passRate,
        avgScore: stat.avgScore ? Math.round(stat.avgScore) : null,
        trades: stat.trades,
        lastAssessment: stat.lastAssessment,
        cpdHoursThisYear: cpdHours,
        cpdCompliant: cpdHours >= (user?.cpdRequiredHours || 20),
        seniorAssessor: user?.assessorExperience?.seniorAssessor || false,
      };
    }));

    // Moderation override rate per assessor
    const overrideStats = await Assessment.aggregate([
      { $match: { type: 'rpl', 'rpl.moderation.decision': { $exists: true } } },
      { $group: {
        _id: '$assessor',
        moderated: { $sum: 1 },
        overturned: { $sum: { $cond: [{ $eq: ['$rpl.moderation.decision', 'overturned'] }, 1, 0] } },
      }},
    ]);
    const overrideMap = {};
    overrideStats.forEach(o => {
      overrideMap[o._id.toString()] = {
        moderated: o.moderated,
        overturned: o.overturned,
        overrideRate: Math.round(o.overturned / o.moderated * 100),
      };
    });

    res.json({
      assessors: enriched.map(a => ({
        ...a,
        moderation: overrideMap[a.assessorId.toString()] || { moderated: 0, overturned: 0, overrideRate: 0 },
      })),
    });
  } catch (err) { next(err); }
});

export default router;
