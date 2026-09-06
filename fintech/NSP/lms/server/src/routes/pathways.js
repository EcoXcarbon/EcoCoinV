import { Router } from 'express';
import { body, param, query } from 'express-validator';
import Pathway from '../models/Pathway.js';
import Training from '../models/Training.js';
import Worker from '../models/Worker.js';
import Credential from '../models/Credential.js';
import User from '../models/User.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { handleValidation } from '../middleware/validate.js';
import { auditLog } from '../middleware/audit.js';
import { generateVC } from '../services/credentialService.js';

const router = Router();

/* ═══════════════════════════════════════════════════════════
   LIST PATHWAYS (with filters)
   ═══════════════════════════════════════════════════════════ */
router.get('/', authenticate, [
  query('category').optional().isLength({ max: 50 }),
  query('trade').optional().isLength({ max: 50 }),
  query('status').optional().isIn(['draft', 'active', 'archived']),
  handleValidation,
], async (req, res, next) => {
  try {
    const filter = { status: req.query.status || 'active' };
    if (req.query.category) filter.category = req.query.category;
    if (req.query.trade) filter.trade = req.query.trade;

    const pathways = await Pathway.find(filter)
      .populate('courses.training', 'title trade nqfLevel difficulty duration modules thumbnail avgRating')
      .sort('-createdAt');
    res.json(pathways);
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   MY PATHWAY ENROLLMENTS
   ═══════════════════════════════════════════════════════════ */
router.get('/my-pathways', authenticate, async (req, res, next) => {
  try {
    if (req.user.role !== 'worker') return res.json([]);
    const worker = await Worker.findOne({ user: req.user._id }).select('_id');
    if (!worker) return res.json([]);

    const pathways = await Pathway.find({ 'enrollments.worker': worker._id })
      .populate('courses.training', 'title trade nqfLevel difficulty duration modules thumbnail');

    const result = pathways.map(p => {
      const enrollment = p.enrollments.find(e => e.worker.toString() === worker._id.toString());
      return {
        _id: p._id,
        title: p.title,
        category: p.category,
        trade: p.trade,
        totalCourses: p.courses.length,
        courses: p.courses.map(c => ({
          _id: c.training?._id,
          title: c.training?.title,
          order: c.order,
          required: c.required,
          completed: enrollment.completedCourses.some(cc => cc.toString() === c.training?._id?.toString()),
        })),
        enrollment: {
          status: enrollment.status,
          progress: enrollment.progress,
          completedCourses: enrollment.completedCourses.length,
          currentCourseIndex: enrollment.currentCourseIndex,
          streak: enrollment.streak,
          longestStreak: enrollment.longestStreak,
          dailyTargetMinutes: enrollment.dailyTargetMinutes,
          totalTimeSpentMinutes: enrollment.totalTimeSpentMinutes,
          enrolledAt: enrollment.enrolledAt,
          certificateId: enrollment.certificateId,
        },
        competencyTargets: p.competencyTargets,
        transferableSkills: p.transferableSkills,
      };
    });

    res.json(result);
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   GET SINGLE PATHWAY
   ═══════════════════════════════════════════════════════════ */
router.get('/:id', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const pathway = await Pathway.findById(req.params.id)
      .populate('courses.training', 'title trade nqfLevel difficulty duration modules thumbnail instructor institution ratings enrollments');
    if (!pathway) return res.status(404).json({ error: 'Pathway not found' });
    res.json(pathway);
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   CREATE PATHWAY (admin/institution)
   ═══════════════════════════════════════════════════════════ */
router.post('/', authenticate, authorize('admin', 'institution'), [
  body('title').trim().notEmpty().isLength({ max: 300 }),
  body('category').isIn(['trade-mastery', 'safety-compliance', 'gulf-readiness', 'leadership', 'digital-skills', 'specialization']),
  body('description').optional().trim().isLength({ max: 3000 }),
  body('courses').optional().isArray(),
  handleValidation,
], auditLog('PATHWAY_CREATE'), async (req, res, next) => {
  try {
    const pathway = await Pathway.create({
      ...req.body,
      createdBy: req.user._id,
    });
    res.status(201).json(pathway);
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   UPDATE PATHWAY
   ═══════════════════════════════════════════════════════════ */
router.put('/:id', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId(),
  handleValidation,
], auditLog('PATHWAY_UPDATE'), async (req, res, next) => {
  try {
    const allowed = ['title', 'description', 'category', 'trade', 'courses', 'nqfLevelRange',
      'totalDurationWeeks', 'totalHours', 'dailyTargetMinutes', 'competencyTargets',
      'transferableSkills', 'credentialTitle', 'credentialType', 'thumbnail', 'status', 'maxEnrollment'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    const pathway = await Pathway.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
    if (!pathway) return res.status(404).json({ error: 'Pathway not found' });
    res.json(pathway);
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   ENROLL IN PATHWAY
   ═══════════════════════════════════════════════════════════ */
router.post('/:id/enroll', authenticate, [
  param('id').isMongoId(),
  body('workerId').optional().isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    let workerId = req.body.workerId;

    // Auto-resolve workerId for worker users
    if (req.user.role === 'worker') {
      const ownWorker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!ownWorker) return res.status(404).json({ error: 'Worker profile not found' });
      if (workerId && ownWorker._id.toString() !== workerId) {
        return res.status(403).json({ error: 'Workers can only enroll themselves' });
      }
      workerId = ownWorker._id.toString();
    }

    if (!workerId) return res.status(400).json({ error: 'workerId is required' });

    const pathway = await Pathway.findById(req.params.id);
    if (!pathway) return res.status(404).json({ error: 'Pathway not found' });

    const already = pathway.enrollments.find(e => e.worker.toString() === workerId);
    if (already) return res.status(409).json({ error: 'Already enrolled in this pathway' });

    if (pathway.enrollments.length >= pathway.maxEnrollment) {
      return res.status(400).json({ error: 'Pathway is full' });
    }

    pathway.enrollments.push({
      worker: workerId,
      cohortStartDate: new Date(),
      dailyTargetMinutes: pathway.dailyTargetMinutes || 60,
    });
    await pathway.save();

    res.status(201).json({ message: 'Enrolled in pathway successfully' });
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   UPDATE PATHWAY PROGRESS (called when a course is completed)
   ═══════════════════════════════════════════════════════════ */
router.put('/:id/progress', authenticate, [
  param('id').isMongoId(),
  body('workerId').optional().isMongoId(),
  body('completedCourseId').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    let workerId = req.body.workerId;
    if (req.user.role === 'worker' && !workerId) {
      const ownWorker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (ownWorker) workerId = ownWorker._id.toString();
    }
    if (!workerId) return res.status(400).json({ error: 'workerId is required' });
    const { completedCourseId } = req.body;
    const pathway = await Pathway.findById(req.params.id);
    if (!pathway) return res.status(404).json({ error: 'Pathway not found' });

    const enrollment = pathway.enrollments.find(e => e.worker.toString() === workerId);
    if (!enrollment) return res.status(404).json({ error: 'Not enrolled in pathway' });

    if (!enrollment.completedCourses.includes(completedCourseId)) {
      enrollment.completedCourses.push(completedCourseId);
    }

    const requiredCourses = pathway.courses.filter(c => c.required);
    const completedRequired = requiredCourses.filter(c =>
      enrollment.completedCourses.some(cc => cc.toString() === c.training.toString())
    ).length;

    enrollment.progress = requiredCourses.length > 0
      ? Math.round(completedRequired / requiredCourses.length * 100)
      : 100;
    enrollment.currentCourseIndex = enrollment.completedCourses.length;

    // Pathway completion
    if (enrollment.progress >= 100 && enrollment.status !== 'completed') {
      enrollment.status = 'completed';
      enrollment.completedAt = new Date();

      // Auto-issue pathway-level credential
      if (pathway.credentialTitle) {
        const count = await Credential.countDocuments();
        const credentialId = `TL-PTH-${String(count + 1).padStart(5, '0')}`;

        const worker = await Worker.findById(workerId);
        const adminUser = await User.findOne({ role: 'admin' }).select('_id');

        if (worker) {
          const vc = generateVC({
            credentialId,
            worker,
            type: pathway.credentialType || 'trade-certificate',
            title: pathway.credentialTitle,
            trade: pathway.trade || 'general',
            nqfLevel: pathway.nqfLevelRange?.max || 4,
            institution: 'TalentLedger Pathways',
          });

          await Credential.create({
            credentialId,
            worker: worker._id,
            issuedBy: adminUser?._id || worker.user,
            type: pathway.credentialType || 'trade-certificate',
            trade: pathway.trade || 'general',
            title: pathway.credentialTitle,
            nqfLevel: pathway.nqfLevelRange?.max || 4,
            institution: 'TalentLedger Pathways',
            vc,
            validFrom: new Date(),
            validUntil: new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000),
            status: 'active',
          });

          enrollment.certificateId = credentialId;
        }
      }
    }

    await pathway.save();
    res.json(enrollment);
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   UPDATE STREAK & DAILY PACING
   ═══════════════════════════════════════════════════════════ */
router.put('/:id/activity', authenticate, [
  param('id').isMongoId(),
  body('workerId').optional().isMongoId(),
  body('minutesSpent').isInt({ min: 1, max: 600 }).toInt(),
  handleValidation,
], async (req, res, next) => {
  try {
    let workerId = req.body.workerId;
    if (req.user.role === 'worker' && !workerId) {
      const ownWorker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (ownWorker) workerId = ownWorker._id.toString();
    }
    if (!workerId) return res.status(400).json({ error: 'workerId is required' });
    const { minutesSpent } = req.body;
    const pathway = await Pathway.findById(req.params.id);
    if (!pathway) return res.status(404).json({ error: 'Pathway not found' });

    const enrollment = pathway.enrollments.find(e => e.worker.toString() === workerId);
    if (!enrollment) return res.status(404).json({ error: 'Not enrolled' });

    const today = new Date().toISOString().split('T')[0];
    const lastActive = enrollment.lastActiveDate
      ? enrollment.lastActiveDate.toISOString().split('T')[0]
      : null;

    enrollment.totalTimeSpentMinutes = (enrollment.totalTimeSpentMinutes || 0) + minutesSpent;

    // Streak logic
    if (lastActive === today) {
      // Same day, just add time
    } else {
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      if (lastActive === yesterday) {
        enrollment.streak = (enrollment.streak || 0) + 1;
      } else {
        enrollment.streak = 1;
      }
      if (enrollment.streak > (enrollment.longestStreak || 0)) {
        enrollment.longestStreak = enrollment.streak;
      }
    }
    enrollment.lastActiveDate = new Date();

    await pathway.save();
    res.json({
      streak: enrollment.streak,
      longestStreak: enrollment.longestStreak,
      totalTimeSpentMinutes: enrollment.totalTimeSpentMinutes,
    });
  } catch (err) { next(err); }
});

export default router;
