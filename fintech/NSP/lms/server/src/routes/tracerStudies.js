import { Router } from 'express';
import { body, param, query } from 'express-validator';
import TracerStudy from '../models/TracerStudy.js';
import Worker from '../models/Worker.js';
import Credential from '../models/Credential.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { handleValidation } from '../middleware/validate.js';
import { auditLog } from '../middleware/audit.js';

const router = Router();

/* ═══════════════════════════════════════════════════════════
   GAP 3: TRACER STUDY ROUTES
   Graduate tracking / tracer studies
   ═══════════════════════════════════════════════════════════ */

// List all tracer studies
router.get('/', authenticate, authorize('admin', 'institution'), [
  query('status').optional().isIn(['draft', 'active', 'closed', 'archived']),
  handleValidation,
], async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const studies = await TracerStudy.find(filter)
      .sort('-createdAt')
      .select('-responses')
      .populate('createdBy', 'name');
    res.json(studies);
  } catch (err) { next(err); }
});

// Create tracer study
router.post('/', authenticate, authorize('admin', 'institution'), [
  body('title').trim().notEmpty().isLength({ max: 300 }),
  body('type').isIn(['6-month', '2-year', 'custom']),
  body('questions').isArray({ min: 1 }),
  body('targetCriteria').isObject(),
  handleValidation,
], auditLog('TRACER_STUDY_CREATE'), async (req, res, next) => {
  try {
    const { title, type, questions, targetCriteria } = req.body;
    const study = await TracerStudy.create({
      title, type, questions, targetCriteria,
      createdBy: req.user._id,
    });
    res.status(201).json(study);
  } catch (err) { next(err); }
});

// GET /pending — active studies a worker hasn't responded to yet (must be before /:id)
router.get('/pending', authenticate, async (req, res, next) => {
  try {
    if (req.user.role !== 'worker') return res.json({ studies: [] });
    const worker = await Worker.findOne({ user: req.user._id }).select('_id');
    if (!worker) return res.json({ studies: [] });

    const studies = await TracerStudy.find({ status: 'active' })
      .select('title type createdAt analytics questions responses')
      .lean();

    const pending = studies.filter(s =>
      !s.responses?.some(r => r.worker.toString() === worker._id.toString())
    ).map(({ responses: _r, ...s }) => s);

    res.json({ studies: pending });
  } catch (err) { next(err); }
});

// GET /my-responses — studies the worker has already responded to (must be before /:id)
router.get('/my-responses', authenticate, async (req, res, next) => {
  try {
    if (req.user.role !== 'worker') return res.json({ responses: [] });
    const worker = await Worker.findOne({ user: req.user._id }).select('_id');
    if (!worker) return res.json({ responses: [] });

    const studies = await TracerStudy.find({
      'responses.worker': worker._id,
    }).select('title type createdAt responses').lean();

    const responses = studies.map(s => {
      const myResponse = s.responses.find(r => r.worker.toString() === worker._id.toString());
      return {
        studyId: s._id,
        studyTitle: s.title,
        studyType: s.type,
        respondedAt: myResponse?.answeredAt || myResponse?.createdAt,
        employmentStatus: myResponse?.employmentStatus,
        satisfactionScore: myResponse?.satisfactionScore,
      };
    });

    res.json({ responses });
  } catch (err) { next(err); }
});

// Get single study with analytics
router.get('/:id', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const study = await TracerStudy.findById(req.params.id)
      .populate('createdBy', 'name')
      .populate('responses.worker', 'fullName trade registrationId district');
    if (!study) return res.status(404).json({ error: 'Tracer study not found' });
    res.json(study);
  } catch (err) { next(err); }
});

// Update study (draft only)
router.put('/:id', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const study = await TracerStudy.findById(req.params.id);
    if (!study) return res.status(404).json({ error: 'Tracer study not found' });
    if (study.status !== 'draft') return res.status(400).json({ error: 'Can only edit draft studies' });

    const allowed = ['title', 'type', 'questions', 'targetCriteria'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) study[key] = req.body[key];
    }
    await study.save();
    res.json(study);
  } catch (err) { next(err); }
});

// Activate study — find matching graduates and set counts
router.post('/:id/activate', authenticate, authorize('admin'), [
  param('id').isMongoId(),
  handleValidation,
], auditLog('TRACER_STUDY_ACTIVATE'), async (req, res, next) => {
  try {
    const study = await TracerStudy.findById(req.params.id);
    if (!study) return res.status(404).json({ error: 'Tracer study not found' });
    if (study.status !== 'draft') return res.status(400).json({ error: 'Study must be in draft status to activate' });

    // Find matching graduates based on criteria
    const criteria = study.targetCriteria || {};
    const credFilter = { status: 'active' };
    if (criteria.trades?.length > 0) credFilter.trade = { $in: criteria.trades };
    if (criteria.completedAfter) credFilter.validFrom = { $gte: new Date(criteria.completedAfter) };
    if (criteria.completedBefore) {
      credFilter.validFrom = { ...credFilter.validFrom, $lte: new Date(criteria.completedBefore) };
    }

    const credentials = await Credential.find(credFilter).select('worker').lean();
    const workerIds = [...new Set(credentials.map(c => c.worker.toString()))];

    study.analytics.totalTargeted = workerIds.length;
    study.status = 'active';
    await study.save();

    res.json({ message: 'Study activated', totalTargeted: workerIds.length });
  } catch (err) { next(err); }
});

// Worker gets their survey form
router.get('/:id/survey', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const study = await TracerStudy.findById(req.params.id).select('title type questions status');
    if (!study) return res.status(404).json({ error: 'Tracer study not found' });
    if (study.status !== 'active') return res.status(400).json({ error: 'Survey is not active' });

    // Check if worker already responded
    const fullStudy = await TracerStudy.findById(req.params.id).select('responses');
    let workerId;
    if (req.user.role === 'worker') {
      const worker = await Worker.findOne({ user: req.user._id }).select('_id');
      workerId = worker?._id;
    }

    const alreadyResponded = workerId && fullStudy.responses.some(r => r.worker.toString() === workerId.toString());

    res.json({ study, alreadyResponded: !!alreadyResponded });
  } catch (err) { next(err); }
});

// Submit survey response
router.post('/:id/respond', authenticate, [
  param('id').isMongoId(),
  body('answers').isArray(),
  body('employmentStatus').isIn(['employed', 'self-employed', 'unemployed', 'further-study', 'other']),
  body('satisfactionScore').isInt({ min: 1, max: 5 }).toInt(),
  handleValidation,
], async (req, res, next) => {
  try {
    const study = await TracerStudy.findById(req.params.id);
    if (!study) return res.status(404).json({ error: 'Tracer study not found' });
    if (study.status !== 'active') return res.status(400).json({ error: 'Survey is not active' });

    let workerId;
    if (req.user.role === 'worker') {
      const worker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!worker) return res.status(403).json({ error: 'Worker profile not found' });
      workerId = worker._id;
    } else {
      return res.status(403).json({ error: 'Only workers can submit responses' });
    }

    // Check duplicate
    if (study.responses.some(r => r.worker.toString() === workerId.toString())) {
      return res.status(409).json({ error: 'You have already responded to this survey' });
    }

    const { answers, employmentStatus, employer, jobTitle, salaryRange, satisfactionScore, credentialUseful, feedback } = req.body;

    study.responses.push({
      worker: workerId,
      answers,
      employmentStatus,
      employer,
      jobTitle,
      salaryRange,
      satisfactionScore,
      credentialUseful,
      feedback,
    });

    // Update analytics
    const totalResponded = study.responses.length;
    const employedCount = study.responses.filter(r => ['employed', 'self-employed'].includes(r.employmentStatus)).length;
    const avgSat = study.responses.reduce((s, r) => s + (r.satisfactionScore || 0), 0) / totalResponded;

    study.analytics.totalResponded = totalResponded;
    study.analytics.responseRate = study.analytics.totalTargeted > 0
      ? Math.round((totalResponded / study.analytics.totalTargeted) * 100)
      : 0;
    study.analytics.employmentRate = totalResponded > 0
      ? Math.round((employedCount / totalResponded) * 100)
      : 0;
    study.analytics.avgSatisfaction = Math.round(avgSat * 10) / 10;

    await study.save();
    res.status(201).json({ message: 'Response submitted', analytics: study.analytics });
  } catch (err) { next(err); }
});

// Detailed analytics
router.get('/:id/analytics', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const study = await TracerStudy.findById(req.params.id)
      .populate('responses.worker', 'fullName trade district');
    if (!study) return res.status(404).json({ error: 'Tracer study not found' });

    // Employment by trade
    const byTrade = {};
    const salaryDistribution = {};
    const satisfactionBreakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const employment = {};

    for (const resp of study.responses) {
      if (resp.employmentStatus) employment[resp.employmentStatus] = (employment[resp.employmentStatus] || 0) + 1;
      const trade = resp.worker?.trade || 'unknown';
      if (!byTrade[trade]) byTrade[trade] = { total: 0, employed: 0, selfEmployed: 0, unemployed: 0 };
      byTrade[trade].total += 1;
      if (resp.employmentStatus === 'employed') byTrade[trade].employed += 1;
      if (resp.employmentStatus === 'self-employed') byTrade[trade].selfEmployed += 1;
      if (resp.employmentStatus === 'unemployed') byTrade[trade].unemployed += 1;

      if (resp.salaryRange) {
        salaryDistribution[resp.salaryRange] = (salaryDistribution[resp.salaryRange] || 0) + 1;
      }
      if (resp.satisfactionScore) {
        satisfactionBreakdown[resp.satisfactionScore] += 1;
      }
    }

    res.json({
      overview: study.analytics,
      byTrade: Object.entries(byTrade).map(([trade, data]) => ({ trade, ...data })),
      salaryDistribution,
      satisfactionBreakdown,
      employment,
      credentialUseful: {
        yes: study.responses.filter(r => r.credentialUseful === true).length,
        no: study.responses.filter(r => r.credentialUseful === false).length,
      },
    });
  } catch (err) { next(err); }
});

// Export responses as CSV
router.get('/:id/export', authenticate, authorize('admin'), [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const study = await TracerStudy.findById(req.params.id)
      .populate('responses.worker', 'fullName trade registrationId district');
    if (!study) return res.status(404).json({ error: 'Tracer study not found' });

    // CSV injection prevention
    const sanitize = (val) => {
      const str = String(val || '');
      if (/^[=+\-@\t\r]/.test(str)) return `'${str}`;
      return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
    };

    const headers = ['Worker', 'Trade', 'District', 'Employment Status', 'Employer', 'Job Title', 'Salary Range', 'Satisfaction', 'Credential Useful', 'Feedback', 'Responded At'];

    // Add question headers
    for (let i = 0; i < study.questions.length; i++) {
      headers.push(sanitize(`Q${i + 1}: ${study.questions[i].question}`));
    }

    const rows = [headers.join(',')];
    for (const resp of study.responses) {
      const row = [
        sanitize(resp.worker?.fullName),
        sanitize(resp.worker?.trade),
        sanitize(resp.worker?.district),
        sanitize(resp.employmentStatus),
        sanitize(resp.employer),
        sanitize(resp.jobTitle),
        sanitize(resp.salaryRange),
        resp.satisfactionScore || '',
        resp.credentialUseful ? 'Yes' : 'No',
        sanitize(resp.feedback),
        resp.answeredAt ? new Date(resp.answeredAt).toISOString().split('T')[0] : '',
      ];

      // Add answers
      for (let i = 0; i < study.questions.length; i++) {
        const ans = resp.answers.find(a => a.questionIndex === i);
        row.push(sanitize(ans?.answer || ''));
      }
      rows.push(row.join(','));
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="tracer-study-${study._id}.csv"`);
    res.send(rows.join('\n'));
  } catch (err) { next(err); }
});

// Export alias — client calls /export-csv
router.get('/:id/export-csv', authenticate, authorize('admin'), [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  // Delegate to the same logic as /:id/export
  req.params.exportCsv = true;
  const study = await TracerStudy.findById(req.params.id)
    .populate('responses.worker', 'fullName trade registrationId district')
    .catch(err => { next(err); return null; });
  if (!study) return res.status(404).json({ error: 'Tracer study not found' });

  const sanitize = (val) => {
    const str = String(val || '');
    if (/^[=+\-@\t\r]/.test(str)) return `'${str}`;
    return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
  };

  const headers = ['Worker', 'Trade', 'District', 'Employment Status', 'Employer', 'Job Title', 'Salary Range', 'Satisfaction', 'Credential Useful', 'Feedback', 'Responded At'];
  for (let i = 0; i < study.questions.length; i++) {
    headers.push(sanitize(`Q${i + 1}: ${study.questions[i].text || study.questions[i].question}`));
  }

  const rows = [headers.join(',')];
  for (const resp of study.responses) {
    const row = [
      sanitize(resp.worker?.fullName), sanitize(resp.worker?.trade), sanitize(resp.worker?.district),
      sanitize(resp.employmentStatus), sanitize(resp.employer), sanitize(resp.jobTitle),
      sanitize(resp.salaryRange), resp.satisfactionScore || '',
      resp.credentialUseful ? 'Yes' : 'No', sanitize(resp.feedback),
      resp.answeredAt ? new Date(resp.answeredAt).toISOString().split('T')[0] : '',
    ];
    for (let i = 0; i < study.questions.length; i++) {
      const ans = resp.answers?.find(a => a.questionIndex === i);
      row.push(sanitize(ans?.answer || ''));
    }
    rows.push(row.join(','));
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="tracer-study-${study._id}.csv"`);
  res.send(rows.join('\n'));
});

// PATCH /:id/status — change study status (activate, close, archive)
router.patch('/:id/status', authenticate, authorize('admin'), [
  param('id').isMongoId(),
  body('status').isIn(['active', 'closed', 'archived']),
  handleValidation,
], async (req, res, next) => {
  try {
    const study = await TracerStudy.findById(req.params.id);
    if (!study) return res.status(404).json({ error: 'Tracer study not found' });

    if (req.body.status === 'active' && study.status !== 'draft') {
      return res.status(400).json({ error: 'Only draft studies can be activated' });
    }

    if (req.body.status === 'active') {
      // Find matching graduates
      const criteria = study.targetCriteria || {};
      const credFilter = { status: 'active' };
      if (criteria.trades?.length > 0) credFilter.trade = { $in: criteria.trades };
      if (criteria.completedAfter) credFilter.validFrom = { $gte: new Date(criteria.completedAfter) };
      if (criteria.completedBefore) credFilter.validFrom = { ...credFilter.validFrom, $lte: new Date(criteria.completedBefore) };
      const credentials = await Credential.find(credFilter).select('worker').lean();
      study.analytics = study.analytics || {};
      study.analytics.totalTargeted = [...new Set(credentials.map(c => c.worker.toString()))].length;
    }

    study.status = req.body.status;
    await study.save();
    res.json({ message: `Study ${req.body.status}`, study });
  } catch (err) { next(err); }
});

export default router;
