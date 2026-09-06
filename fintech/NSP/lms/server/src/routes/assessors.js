import { Router } from 'express';
import { body, param, query } from 'express-validator';
import User from '../models/User.js';
import Assessment from '../models/Assessment.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { handleValidation } from '../middleware/validate.js';
import { auditLog } from '../middleware/audit.js';

const router = Router();

// ====================================================================
// Gap #13: Assessor Qualification Tracking
// ====================================================================

// GET /profile — Get assessor profile (qualifications, CPD, experience)
router.get('/profile', authenticate, authorize('assessor', 'admin', 'institution'), async (req, res, next) => {
  try {
    const userId = req.query.assessorId || req.user._id;
    const user = await User.findById(userId).select(
      'name email role assessorQualifications cpdRecords cpdYearStart cpdRequiredHours assessorExperience'
    );
    if (!user) return res.status(404).json({ error: 'Assessor not found' });
    if (user.role !== 'assessor') return res.status(400).json({ error: 'User is not an assessor' });

    // Calculate CPD compliance
    const now = new Date();
    const yearStart = user.cpdYearStart || new Date(now.getFullYear(), 0, 1);
    const cpdThisYear = (user.cpdRecords || [])
      .filter(r => new Date(r.completedDate) >= yearStart)
      .reduce((sum, r) => sum + r.hours, 0);

    const requiredHours = user.cpdRequiredHours || 20;
    const cpdCompliant = cpdThisYear >= requiredHours;

    // Check qualification validity
    const activeQualifications = (user.assessorQualifications || []).filter(q =>
      !q.expiryDate || new Date(q.expiryDate) > now
    );
    const expiredQualifications = (user.assessorQualifications || []).filter(q =>
      q.expiryDate && new Date(q.expiryDate) <= now
    );

    res.json({
      assessor: {
        _id: user._id,
        name: user.name,
        email: user.email,
      },
      qualifications: {
        total: (user.assessorQualifications || []).length,
        active: activeQualifications.length,
        expired: expiredQualifications.length,
        items: user.assessorQualifications || [],
      },
      cpd: {
        hoursThisYear: cpdThisYear,
        requiredHours,
        compliant: cpdCompliant,
        deficit: cpdCompliant ? 0 : requiredHours - cpdThisYear,
        records: user.cpdRecords || [],
      },
      experience: user.assessorExperience || {},
    });
  } catch (err) { next(err); }
});

// POST /qualifications — Add a qualification
router.post('/qualifications', authenticate, authorize('assessor', 'admin', 'institution'), [
  body('qualificationName').trim().notEmpty().isLength({ max: 300 }),
  body('issuingBody').trim().notEmpty().isLength({ max: 300 }),
  body('dateObtained').isISO8601(),
  body('expiryDate').optional().isISO8601(),
  body('certificateNumber').optional().trim().isLength({ max: 100 }),
  body('trade').optional().trim(),
  body('nqfLevel').optional().isInt({ min: 1, max: 8 }).toInt(),
  body('documentUrl').optional().trim(),
  handleValidation,
], auditLog('ASSESSOR_QUALIFICATION_ADD'), async (req, res, next) => {
  try {
    const userId = req.body.assessorId || req.user._id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role !== 'assessor' && req.user._id.toString() === userId.toString()) {
      return res.status(400).json({ error: 'Only assessors can have qualifications' });
    }

    const qualification = {
      qualificationName: req.body.qualificationName,
      issuingBody: req.body.issuingBody,
      dateObtained: new Date(req.body.dateObtained),
      expiryDate: req.body.expiryDate ? new Date(req.body.expiryDate) : undefined,
      certificateNumber: req.body.certificateNumber,
      trade: req.body.trade,
      nqfLevel: req.body.nqfLevel,
      documentUrl: req.body.documentUrl,
      verified: false,
    };

    if (!user.assessorQualifications) user.assessorQualifications = [];
    user.assessorQualifications.push(qualification);
    await user.save();

    res.status(201).json({
      message: 'Qualification added',
      qualification: user.assessorQualifications[user.assessorQualifications.length - 1],
    });
  } catch (err) { next(err); }
});

// PUT /qualifications/:index/verify — Verify a qualification (admin/institution only)
router.put('/qualifications/:index/verify', authenticate, authorize('admin', 'institution'), [
  param('index').isInt({ min: 0 }).toInt(),
  body('assessorId').isMongoId(),
  handleValidation,
], auditLog('ASSESSOR_QUALIFICATION_VERIFY'), async (req, res, next) => {
  try {
    const user = await User.findById(req.body.assessorId);
    if (!user) return res.status(404).json({ error: 'Assessor not found' });

    const qual = user.assessorQualifications?.[req.params.index];
    if (!qual) return res.status(404).json({ error: 'Qualification not found' });

    qual.verified = true;
    qual.verifiedAt = new Date();
    qual.verifiedBy = req.user._id;
    await user.save();

    res.json({ message: 'Qualification verified', qualification: qual });
  } catch (err) { next(err); }
});

// ====================================================================
// Gap #17: Assessor CPD Tracking
// ====================================================================

// POST /cpd — Add a CPD record
router.post('/cpd', authenticate, authorize('assessor', 'admin', 'institution'), [
  body('title').trim().notEmpty().isLength({ max: 300 }),
  body('provider').trim().notEmpty().isLength({ max: 300 }),
  body('completedDate').isISO8601(),
  body('hours').isFloat({ min: 0.5, max: 200 }).toFloat(),
  body('category').isIn(['assessment-methodology', 'trade-technical', 'quality-assurance', 'regulatory', 'safety', 'digital-tools', 'other']),
  body('certificateUrl').optional().trim(),
  handleValidation,
], auditLog('ASSESSOR_CPD_ADD'), async (req, res, next) => {
  try {
    const userId = req.body.assessorId || req.user._id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const record = {
      title: req.body.title,
      provider: req.body.provider,
      completedDate: new Date(req.body.completedDate),
      hours: req.body.hours,
      category: req.body.category,
      certificateUrl: req.body.certificateUrl,
      verified: false,
    };

    if (!user.cpdRecords) user.cpdRecords = [];
    user.cpdRecords.push(record);
    await user.save();

    // Calculate updated CPD status
    const now = new Date();
    const yearStart = user.cpdYearStart || new Date(now.getFullYear(), 0, 1);
    const cpdThisYear = user.cpdRecords
      .filter(r => new Date(r.completedDate) >= yearStart)
      .reduce((sum, r) => sum + r.hours, 0);

    res.status(201).json({
      message: 'CPD record added',
      record: user.cpdRecords[user.cpdRecords.length - 1],
      cpdStatus: {
        hoursThisYear: cpdThisYear,
        requiredHours: user.cpdRequiredHours || 20,
        compliant: cpdThisYear >= (user.cpdRequiredHours || 20),
      },
    });
  } catch (err) { next(err); }
});

// PUT /cpd/:index/verify — Verify a CPD record (admin/institution only)
router.put('/cpd/:index/verify', authenticate, authorize('admin', 'institution'), [
  param('index').isInt({ min: 0 }).toInt(),
  body('assessorId').isMongoId(),
  handleValidation,
], auditLog('ASSESSOR_CPD_VERIFY'), async (req, res, next) => {
  try {
    const user = await User.findById(req.body.assessorId);
    if (!user) return res.status(404).json({ error: 'Assessor not found' });

    const record = user.cpdRecords?.[req.params.index];
    if (!record) return res.status(404).json({ error: 'CPD record not found' });

    record.verified = true;
    record.verifiedAt = new Date();
    record.verifiedBy = req.user._id;
    await user.save();

    res.json({ message: 'CPD record verified', record });
  } catch (err) { next(err); }
});

// GET /cpd-status — Get CPD compliance status
router.get('/cpd-status', authenticate, authorize('assessor', 'admin', 'institution'), async (req, res, next) => {
  try {
    const userId = req.query.assessorId || req.user._id;
    const user = await User.findById(userId).select('name cpdRecords cpdYearStart cpdRequiredHours role');
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role !== 'assessor') return res.status(400).json({ error: 'User is not an assessor' });

    const now = new Date();
    const yearStart = user.cpdYearStart || new Date(now.getFullYear(), 0, 1);
    const required = user.cpdRequiredHours || 20;

    const records = (user.cpdRecords || []).filter(r => new Date(r.completedDate) >= yearStart);
    const totalHours = records.reduce((sum, r) => sum + r.hours, 0);

    // Breakdown by category
    const byCategory = {};
    for (const r of records) {
      byCategory[r.category] = (byCategory[r.category] || 0) + r.hours;
    }

    res.json({
      assessor: { _id: user._id, name: user.name },
      hoursCompleted: totalHours,
      hoursRequired: required,
      compliant: totalHours >= required,
      deficit: Math.max(0, required - totalHours),
      byCategory,
      recordCount: records.length,
      yearStart,
    });
  } catch (err) { next(err); }
});

// ====================================================================
// Gap #14: Assessor Minimum Experience Validation
// ====================================================================

// GET /experience — Get assessor experience summary
router.get('/experience', authenticate, authorize('assessor', 'admin', 'institution'), async (req, res, next) => {
  try {
    const userId = req.query.assessorId || req.user._id;
    const user = await User.findById(userId).select('name role assessorExperience assessorQualifications');
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role !== 'assessor') return res.status(400).json({ error: 'User is not an assessor' });

    // Count actual assessments completed
    const completedCount = await Assessment.countDocuments({
      assessor: userId,
      status: { $in: ['approved', 'rejected'] },
    });

    // Check minimum experience requirements
    const exp = user.assessorExperience || {};
    const MIN_ASSESSMENTS_INDEPENDENT = 10;
    const MIN_YEARS_SENIOR = 3;

    const canAssessIndependently = completedCount >= MIN_ASSESSMENTS_INDEPENDENT;
    const qualifiesAsSenior = exp.yearsExperience >= MIN_YEARS_SENIOR && completedCount >= 50;

    // Trade coverage
    const tradeCoverage = await Assessment.distinct('trade', {
      assessor: userId,
      status: { $in: ['approved', 'rejected'] },
    });

    res.json({
      assessor: { _id: user._id, name: user.name },
      experience: {
        ...exp,
        actualAssessments: completedCount,
        tradeCoverage,
      },
      eligibility: {
        canAssessIndependently,
        independentThreshold: MIN_ASSESSMENTS_INDEPENDENT,
        qualifiesAsSenior,
        seniorThresholdYears: MIN_YEARS_SENIOR,
        seniorThresholdAssessments: 50,
      },
      qualificationsCount: (user.assessorQualifications || []).length,
    });
  } catch (err) { next(err); }
});

// PUT /experience — Update assessor experience (admin/institution only)
router.put('/experience', authenticate, authorize('admin', 'institution'), [
  body('assessorId').isMongoId(),
  body('yearsExperience').optional().isFloat({ min: 0, max: 50 }).toFloat(),
  body('trades').optional().isArray(),
  body('approvedDate').optional().isISO8601(),
  body('seniorAssessor').optional().isBoolean().toBoolean(),
  handleValidation,
], auditLog('ASSESSOR_EXPERIENCE_UPDATE'), async (req, res, next) => {
  try {
    const user = await User.findById(req.body.assessorId);
    if (!user) return res.status(404).json({ error: 'Assessor not found' });
    if (user.role !== 'assessor') return res.status(400).json({ error: 'User is not an assessor' });

    if (!user.assessorExperience) user.assessorExperience = {};

    if (req.body.yearsExperience !== undefined) user.assessorExperience.yearsExperience = req.body.yearsExperience;
    if (req.body.trades) user.assessorExperience.trades = req.body.trades;
    if (req.body.approvedDate) user.assessorExperience.approvedDate = new Date(req.body.approvedDate);
    if (req.body.seniorAssessor !== undefined) user.assessorExperience.seniorAssessor = req.body.seniorAssessor;

    // Update actual assessment count
    const completedCount = await Assessment.countDocuments({
      assessor: user._id,
      status: { $in: ['approved', 'rejected'] },
    });
    user.assessorExperience.totalAssessments = completedCount;

    await user.save();

    res.json({
      message: 'Assessor experience updated',
      experience: user.assessorExperience,
    });
  } catch (err) { next(err); }
});

// GET /validate/:assessorId/:trade — Check if assessor meets minimum requirements for a trade
router.get('/validate/:assessorId/:trade', authenticate, authorize('admin', 'assessor', 'institution'), [
  param('assessorId').isMongoId(),
  param('trade').trim().notEmpty(),
  handleValidation,
], async (req, res, next) => {
  try {
    const user = await User.findById(req.params.assessorId).select(
      'name role assessorQualifications assessorExperience cpdRecords cpdRequiredHours cpdYearStart'
    );
    if (!user) return res.status(404).json({ error: 'Assessor not found' });
    if (user.role !== 'assessor') return res.status(400).json({ error: 'User is not an assessor' });

    const trade = req.params.trade;
    const exp = user.assessorExperience || {};
    const now = new Date();

    // Check 1: Has valid qualification for this trade
    const tradeQualification = (user.assessorQualifications || []).find(q =>
      q.trade === trade && (!q.expiryDate || new Date(q.expiryDate) > now)
    );

    // Check 2: CPD compliant
    const yearStart = user.cpdYearStart || new Date(now.getFullYear(), 0, 1);
    const cpdHours = (user.cpdRecords || [])
      .filter(r => new Date(r.completedDate) >= yearStart)
      .reduce((sum, r) => sum + r.hours, 0);
    const cpdCompliant = cpdHours >= (user.cpdRequiredHours || 20);

    // Check 3: Trade is in their authorized list
    const tradeAuthorized = (exp.trades || []).includes(trade);

    // Check 4: Minimum assessment count
    const completedCount = await Assessment.countDocuments({
      assessor: user._id,
      status: { $in: ['approved', 'rejected'] },
    });
    const meetsMinimum = completedCount >= 10 || exp.seniorAssessor;

    const valid = !!(tradeQualification || tradeAuthorized) && cpdCompliant;
    const warnings = [];
    if (!tradeQualification && !tradeAuthorized) warnings.push(`No qualification or authorization for trade: ${trade}`);
    if (!cpdCompliant) warnings.push(`CPD not compliant: ${cpdHours}/${user.cpdRequiredHours || 20} hours`);
    if (!meetsMinimum) warnings.push(`Below minimum assessment threshold: ${completedCount}/10 completed`);

    res.json({
      valid,
      assessor: { _id: user._id, name: user.name },
      trade,
      checks: {
        hasTradeQualification: !!tradeQualification,
        tradeAuthorized,
        cpdCompliant,
        meetsMinimumExperience: meetsMinimum,
      },
      warnings,
    });
  } catch (err) { next(err); }
});

// GET /list — List all assessors with their status (admin/institution)
router.get('/list', authenticate, authorize('admin', 'institution'), [
  query('trade').optional().trim(),
  query('cpdCompliant').optional().isBoolean().toBoolean(),
  handleValidation,
], async (req, res, next) => {
  try {
    const filter = { role: 'assessor', isActive: true };
    const users = await User.find(filter).select(
      'name email assessorQualifications cpdRecords cpdYearStart cpdRequiredHours assessorExperience'
    );

    const now = new Date();
    const assessors = await Promise.all(users.map(async (user) => {
      const yearStart = user.cpdYearStart || new Date(now.getFullYear(), 0, 1);
      const cpdHours = (user.cpdRecords || [])
        .filter(r => new Date(r.completedDate) >= yearStart)
        .reduce((sum, r) => sum + r.hours, 0);
      const cpdCompliant = cpdHours >= (user.cpdRequiredHours || 20);

      const activeQuals = (user.assessorQualifications || []).filter(q =>
        !q.expiryDate || new Date(q.expiryDate) > now
      );

      const completedCount = await Assessment.countDocuments({
        assessor: user._id,
        status: { $in: ['approved', 'rejected'] },
      });

      return {
        _id: user._id,
        name: user.name,
        email: user.email,
        qualifications: activeQuals.length,
        cpdHoursThisYear: cpdHours,
        cpdCompliant,
        assessmentsCompleted: completedCount,
        trades: user.assessorExperience?.trades || [],
        seniorAssessor: user.assessorExperience?.seniorAssessor || false,
        yearsExperience: user.assessorExperience?.yearsExperience || 0,
      };
    }));

    // Apply filters
    let filtered = assessors;
    if (req.query.trade) {
      filtered = filtered.filter(a => a.trades.includes(req.query.trade));
    }
    if (req.query.cpdCompliant !== undefined) {
      filtered = filtered.filter(a => a.cpdCompliant === req.query.cpdCompliant);
    }

    res.json({
      total: filtered.length,
      assessors: filtered,
    });
  } catch (err) { next(err); }
});

export default router;
