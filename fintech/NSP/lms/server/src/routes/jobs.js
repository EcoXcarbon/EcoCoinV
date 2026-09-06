import { Router } from 'express';
import { body, param, query } from 'express-validator';
import Job from '../models/Job.js';
import Worker from '../models/Worker.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { handleValidation } from '../middleware/validate.js';
import { auditLog } from '../middleware/audit.js';
import { escapeRegex } from '../middleware/sanitize.js';

const router = Router();

const VALID_TRADES = [
  'mason','electrician','welder','plumber','carpenter','steel-fixer','painter','hvac',
  'pipe-fitter','scaffolder','rigger','crane-operator','heavy-driver','shuttering-carpenter',
  'tile-fixer','duct-fabricator','auto-mechanic','diesel-mechanic','fabricator',
  'insulation-worker','heavy-equipment-operator','aluminium-fabricator','safety-officer',
  'cook','ac-technician',
];

// List jobs — workers see active jobs, employers see their own
router.get('/', authenticate, [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
  query('trade').optional().isIn(VALID_TRADES),
  query('search').optional().isLength({ max: 200 }),
  query('district').optional().isLength({ max: 100 }),
  query('isGulf').optional().isBoolean(),
  handleValidation,
], async (req, res, next) => {
  try {
    const { page = 1, limit = 20, trade, search, district, isGulf } = req.query;
    const filter = {};

    if (req.user.role === 'employer') {
      filter.employer = req.user._id;
    } else {
      filter.status = 'active';
      filter.deadline = { $gte: new Date() };
    }

    if (trade) filter.trade = trade;
    if (district) filter['location.district'] = String(district);
    if (isGulf === 'true') filter['location.isGulf'] = true;
    if (search) {
      const safe = escapeRegex(String(search));
      filter.$or = [
        { title: { $regex: safe, $options: 'i' } },
        { employerName: { $regex: safe, $options: 'i' } },
      ];
    }

    const total = await Job.countDocuments(filter);
    const jobs = await Job.find(filter)
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .select('-applications')
      .populate('employer', 'name organization');

    // For workers, add application status
    if (req.user.role === 'worker') {
      const worker = await Worker.findOne({ user: req.user._id }).select('_id');
      const jobIds = jobs.map(j => j._id);
      const applied = await Job.find({ _id: { $in: jobIds }, 'applications.worker': worker?._id }).select('_id applications.worker applications.status');
      const appliedMap = {};
      for (const j of applied) {
        const app = j.applications.find(a => a.worker?.toString() === worker?._id?.toString());
        if (app) appliedMap[j._id.toString()] = app.status;
      }
      const jobsWithStatus = jobs.map(j => ({ ...j.toObject(), myApplicationStatus: appliedMap[j._id.toString()] || null }));
      return res.json({ jobs: jobsWithStatus, pagination: { total, page: Number(page), pages: Math.ceil(total / limit) } });
    }

    res.json({ jobs, pagination: { total, page: Number(page), pages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
});

// Get single job with applications (employer) or without (worker)
router.get('/:id', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    let q = Job.findById(req.params.id).populate('employer', 'name organization');
    if (['admin', 'employer'].includes(req.user.role)) {
      q = q.populate('applications.worker', 'fullName trade registrationId district nqfLevel');
    }
    const job = await q;
    if (!job) return res.status(404).json({ error: 'Job not found' });

    // Workers can only see their own application
    if (req.user.role === 'worker') {
      const worker = await Worker.findOne({ user: req.user._id }).select('_id');
      const myApp = job.applications.find(a => a.worker?.toString() === worker?._id?.toString());
      const obj = job.toObject();
      obj.applications = myApp ? [myApp] : [];
      obj.applicationCount = job.applications.length;
      return res.json(obj);
    }

    res.json(job);
  } catch (err) { next(err); }
});

// Create job posting (employer/admin)
router.post('/', authenticate, authorize('employer', 'admin'), [
  body('title').trim().notEmpty().isLength({ max: 300 }),
  body('description').trim().notEmpty().isLength({ max: 5000 }),
  body('trade').isIn(VALID_TRADES),
  body('location.city').optional().isLength({ max: 100 }),
  body('location.district').optional().isLength({ max: 100 }),
  body('location.country').optional().isLength({ max: 100 }),
  body('location.isGulf').optional().isBoolean(),
  body('requirements.minNqfLevel').optional().isInt({ min: 1, max: 8 }).toInt(),
  body('requirements.minExperienceYears').optional().isInt({ min: 0 }).toInt(),
  body('requirements.gulfReadinessRequired').optional().isBoolean(),
  body('requirements.certifiedOnly').optional().isBoolean(),
  body('salary.min').optional().isInt({ min: 0 }).toInt(),
  body('salary.max').optional().isInt({ min: 0 }).toInt(),
  body('salary.currency').optional().isLength({ max: 10 }),
  body('salary.period').optional().isIn(['monthly', 'daily', 'hourly', 'contract']),
  body('positions').optional().isInt({ min: 1, max: 1000 }).toInt(),
  body('deadline').optional().isISO8601(),
  handleValidation,
], auditLog('JOB_CREATE'), async (req, res, next) => {
  try {
    const job = await Job.create({
      ...req.body,
      employer: req.user._id,
      employerName: req.user.organization || req.user.name,
    });
    res.status(201).json(job);
  } catch (err) { next(err); }
});

// Apply to job (worker)
router.post('/:id/apply', authenticate, authorize('worker'), [
  param('id').isMongoId(),
  body('coverNote').optional().isLength({ max: 1000 }),
  handleValidation,
], auditLog('JOB_APPLY'), async (req, res, next) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'active') return res.status(400).json({ error: 'Job is no longer accepting applications' });
    if (job.deadline && job.deadline < new Date()) return res.status(400).json({ error: 'Application deadline has passed' });

    const worker = await Worker.findOne({ user: req.user._id });
    if (!worker) return res.status(400).json({ error: 'Worker profile not found' });

    if (job.applications.some(a => a.worker.toString() === worker._id.toString())) {
      return res.status(400).json({ error: 'Already applied to this job' });
    }

    // Check requirements
    if (job.requirements?.certifiedOnly && !['certified', 'employed'].includes(worker.status)) {
      return res.status(400).json({ error: 'This job requires certified workers' });
    }
    if (job.requirements?.minNqfLevel && (worker.nqfLevel || 1) < job.requirements.minNqfLevel) {
      return res.status(400).json({ error: `Minimum NQF Level ${job.requirements.minNqfLevel} required` });
    }

    job.applications.push({ worker: worker._id, coverNote: req.body.coverNote });
    await job.save();
    res.status(201).json({ message: 'Application submitted successfully' });
  } catch (err) { next(err); }
});

// Update application status (employer/admin)
router.put('/:id/applications/:appId', authenticate, authorize('employer', 'admin'), [
  param('id').isMongoId(),
  param('appId').isMongoId(),
  body('status').isIn(['shortlisted', 'interviewed', 'offered', 'rejected']),
  body('feedback').optional().isLength({ max: 500 }),
  handleValidation,
], auditLog('APPLICATION_UPDATE'), async (req, res, next) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (req.user.role === 'employer' && job.employer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const app = job.applications.id(req.params.appId);
    if (!app) return res.status(404).json({ error: 'Application not found' });

    app.status = req.body.status;
    app.feedback = req.body.feedback || app.feedback;
    app.statusUpdatedAt = new Date();
    app.statusUpdatedBy = req.user._id;
    await job.save();
    res.json({ message: 'Application status updated', application: app });
  } catch (err) { next(err); }
});

// Update job (employer/admin)
router.put('/:id', authenticate, authorize('employer', 'admin'), [
  param('id').isMongoId(),
  body('title').optional().trim().isLength({ max: 300 }),
  body('description').optional().trim().isLength({ max: 5000 }),
  body('status').optional().isIn(['draft', 'active', 'closed', 'filled']),
  handleValidation,
], auditLog('JOB_UPDATE'), async (req, res, next) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (req.user.role === 'employer' && job.employer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }
    Object.assign(job, req.body);
    await job.save();
    res.json(job);
  } catch (err) { next(err); }
});

// My applications (worker)
router.get('/my/applications', authenticate, authorize('worker'), async (req, res, next) => {
  try {
    const worker = await Worker.findOne({ user: req.user._id }).select('_id');
    if (!worker) return res.json({ applications: [] });

    const jobs = await Job.find({ 'applications.worker': worker._id })
      .select('title trade employerName location deadline applications.$')
      .sort('-createdAt');

    const applications = jobs.map(j => ({
      jobId: j._id,
      jobTitle: j.title,
      trade: j.trade,
      employer: j.employerName,
      location: j.location,
      deadline: j.deadline,
      ...j.applications[0]?.toObject(),
    }));

    res.json({ applications });
  } catch (err) { next(err); }
});

export default router;
