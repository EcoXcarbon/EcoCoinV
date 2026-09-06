import { Router } from 'express';
import { body, param, query } from 'express-validator';
import Worker from '../models/Worker.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { handleValidation } from '../middleware/validate.js';
import { auditLog } from '../middleware/audit.js';
import { escapeRegex } from '../middleware/sanitize.js';
import { encrypt, maskCNIC, decrypt } from '../utils/encryption.js';
import Counter from '../models/Counter.js';

const router = Router();

const VALID_TRADES = [
  'mason', 'electrician', 'welder', 'plumber', 'carpenter', 'steel-fixer', 'painter', 'hvac',
  'pipe-fitter', 'scaffolder', 'rigger', 'crane-operator', 'heavy-driver', 'shuttering-carpenter',
  'tile-fixer', 'duct-fabricator', 'auto-mechanic', 'diesel-mechanic', 'fabricator',
  'insulation-worker', 'heavy-equipment-operator', 'aluminium-fabricator', 'safety-officer',
  'cook', 'ac-technician',
];
const VALID_STATUSES = ['registered', 'assessed', 'certified', 'employed', 'inactive'];

// List workers with search, filter, sort, paginate
router.get('/', authenticate, [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('trade').optional().isIn(VALID_TRADES),
  query('status').optional().isIn(VALID_STATUSES),
  query('district').optional().isLength({ max: 100 }),
  query('search').optional().isLength({ max: 200 }),
  handleValidation,
], async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search, trade, district, status, sort = '-createdAt' } = req.query;
    const filter = {};
    if (trade) filter.trade = trade;
    if (district) filter.district = String(district);
    if (status) filter.status = status;
    if (search) {
      const safe = escapeRegex(String(search));
      filter.$or = [
        { fullName: { $regex: safe, $options: 'i' } },
        { registrationId: { $regex: safe, $options: 'i' } },
      ];
    }

    // Workers can only see their own profile
    if (req.user.role === 'worker') {
      filter.user = req.user._id;
    }

    // Employers can only see certified/assessed workers
    if (req.user.role === 'employer') {
      filter.status = { $in: ['assessed', 'certified', 'employed'] };
    }

    const total = await Worker.countDocuments(filter);
    const workers = await Worker.find(filter)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .select('-cnicEncrypted')
      .populate('user', 'name email');

    res.json({
      workers,
      pagination: { total, page: Number(page), pages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
});

// Get single worker
router.get('/:id', authenticate, [
  param('id').isMongoId().withMessage('Invalid worker ID'),
  handleValidation,
], async (req, res, next) => {
  try {
    const worker = await Worker.findById(req.params.id).populate('user', 'name email role');
    if (!worker) return res.status(404).json({ error: 'Worker not found' });

    // Ownership check: workers can only view their own profile
    if (req.user.role === 'worker' && worker.user?._id?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Employers can only view assessed/certified/employed workers
    if (req.user.role === 'employer' && !['assessed', 'certified', 'employed'].includes(worker.status)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const data = worker.toObject();
    // Only admin/assessor can see full CNIC
    if (['admin', 'assessor'].includes(req.user.role) && worker.cnicEncrypted) {
      data.cnic = decrypt(worker.cnicEncrypted);
    }
    delete data.cnicEncrypted;
    res.json(data);
  } catch (err) { next(err); }
});

// Create worker
router.post('/', authenticate, authorize('admin', 'institution'), [
  body('fullName').trim().notEmpty().withMessage('Full name is required').isLength({ max: 200 }),
  body('cnic').matches(/^\d{5}-\d{7}-\d{1}$/).withMessage('CNIC format: 12345-1234567-1'),
  body('trade').isIn(VALID_TRADES).withMessage('Invalid trade'),
  body('district').trim().notEmpty().withMessage('District is required').isLength({ max: 100 }),
  body('user').optional().isMongoId().withMessage('Invalid user ID'),
  body('email').optional().isEmail().withMessage('Invalid email'),
  body('fatherName').optional().trim().isLength({ max: 200 }),
  body('phone').optional().isLength({ max: 20 }),
  body('gender').optional().isIn(['male', 'female', 'other']),
  body('nqfLevel').optional().isInt({ min: 1, max: 8 }).toInt(),
  handleValidation,
], auditLog('WORKER_CREATE'), async (req, res, next) => {
  try {
    const { cnic, email, ...rest } = req.body;
    const seq = await Counter.getNextSequence('worker');
    const regId = `TL-${new Date().getFullYear()}-${String(seq).padStart(5, '0')}`;

    // Auto-create user account if no user ID provided
    if (!rest.user) {
      const User = (await import('../models/User.js')).default;
      const { randomBytes } = await import('crypto');
      const tmpPass = randomBytes(12).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) + 'Aa1!';
      const userEmail = email || `worker-${regId.toLowerCase()}@talentledger.pk`;
      const existing = email ? await User.findOne({ email }) : null;
      const userDoc = existing || await User.create({
        name: rest.fullName,
        email: userEmail,
        password: tmpPass,
        role: 'worker',
        district: rest.district,
      });
      rest.user = userDoc._id;
    }

    const worker = await Worker.create({
      ...rest,
      registrationId: regId,
      cnicEncrypted: encrypt(cnic),
      cnicMasked: maskCNIC(cnic),
    });
    res.status(201).json(worker);
  } catch (err) { next(err); }
});

// Update worker
router.put('/:id', authenticate, [
  param('id').isMongoId().withMessage('Invalid worker ID'),
  body('fullName').optional().trim().isLength({ max: 200 }),
  body('cnic').optional().matches(/^\d{5}-\d{7}-\d{1}$/).withMessage('CNIC format: 12345-1234567-1'),
  body('trade').optional().isIn(VALID_TRADES),
  body('district').optional().trim().isLength({ max: 100 }),
  body('nqfLevel').optional().isInt({ min: 1, max: 8 }).toInt(),
  body('status').optional().isIn(VALID_STATUSES),
  body('phone').optional().isLength({ max: 20 }),
  body('gender').optional().isIn(['male', 'female', 'other']),
  body('fatherName').optional().trim().isLength({ max: 200 }),
  body('dateOfBirth').optional().isISO8601(),
  body('gulfReadiness.safetyTraining').optional().isBoolean(),
  body('gulfReadiness.languageTest').optional().isBoolean(),
  body('gulfReadiness.medicalClearance').optional().isBoolean(),
  body('gulfReadiness.passportValid').optional().isBoolean(),
  handleValidation,
], auditLog('WORKER_UPDATE'), async (req, res, next) => {
  try {
    const worker = await Worker.findById(req.params.id);
    if (!worker) return res.status(404).json({ error: 'Worker not found' });

    // Worker self-update: only allowed for own profile, restricted fields
    if (req.user.role === 'worker') {
      if (worker.user.toString() !== req.user._id.toString()) {
        return res.status(403).json({ error: 'Access denied' });
      }
      // Workers can only update these fields (expanded for Stage 2 Gulf migration)
      const WORKER_ALLOWED = [
        'fullName', 'fatherName', 'phone', 'gender', 'dateOfBirth', 'photo', 'gulfReadiness',
        'nextOfKin', 'passport', 'visa', 'medicalClearance', 'preDeparture',
        'selfAssessedSkills', 'portfolio',
      ];
      const { cnic, ...updates } = req.body;
      const filtered = {};
      for (const key of Object.keys(updates)) {
        if (WORKER_ALLOWED.includes(key)) filtered[key] = updates[key];
      }
      // Gulf readiness score auto-calculation
      if (filtered.gulfReadiness) {
        const gr = { ...worker.gulfReadiness?.toObject?.() || worker.gulfReadiness || {}, ...filtered.gulfReadiness };
        let score = 0;
        if (gr.safetyTraining) score += 25;
        if (gr.languageTest) score += 25;
        if (gr.medicalClearance) score += 25;
        if (gr.passportValid) score += 25;
        gr.score = score;
        filtered.gulfReadiness = gr;
      }
      const updated = await Worker.findByIdAndUpdate(req.params.id, filtered, { new: true, runValidators: true }).select('-cnicEncrypted');
      return res.json(updated);
    }

    // Admin/assessor/institution update
    if (req.user.role === 'assessor') {
      const Assessment = (await import('../models/Assessment.js')).default;
      const assigned = await Assessment.exists({ worker: worker._id, assessor: req.user._id });
      if (!assigned) return res.status(403).json({ error: 'Access denied: not assigned to this worker' });
    }

    const { cnic, ...updates } = req.body;
    if (cnic) {
      updates.cnicEncrypted = encrypt(cnic);
      updates.cnicMasked = maskCNIC(cnic);
    }
    const updated = await Worker.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true }).select('-cnicEncrypted');
    res.json(updated);
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// Stage 2: Get worker profile completeness
// ------------------------------------------------------------------
router.get('/:id/completeness', authenticate, [
  param('id').isMongoId().withMessage('Invalid worker ID'),
  handleValidation,
], async (req, res, next) => {
  try {
    const worker = await Worker.findById(req.params.id);
    if (!worker) return res.status(404).json({ error: 'Worker not found' });

    if (req.user.role === 'worker' && worker.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const completeness = worker.calculateProfileCompleteness();
    const missing = [];
    if (!worker.fatherName) missing.push('Father name');
    if (!worker.dateOfBirth) missing.push('Date of birth');
    if (!worker.gender) missing.push('Gender');
    if (!worker.phone) missing.push('Phone number');
    if (!worker.photo) missing.push('Profile photo');
    if (!worker.cnicEncrypted || worker.cnicEncrypted === 'N/A') missing.push('CNIC');
    if (!worker.nextOfKin?.name) missing.push('Next-of-kin details');
    if (!worker.passport?.number) missing.push('Passport number');
    if (!worker.passport?.expiryDate) missing.push('Passport expiry date');
    if (!worker.medicalClearance?.result || worker.medicalClearance.result === 'none') missing.push('Medical clearance');
    if (!worker.preDeparture?.briefingCompleted) missing.push('Pre-departure briefing');
    if (!worker.experience?.years) missing.push('Work experience');
    if (!worker.employmentHistory?.length) missing.push('Employment history');
    if (!worker.selfAssessedSkills?.length) missing.push('Self-assessed skills');
    if (!worker.competencies?.length) missing.push('Competency assessments');
    if (!worker.portfolio?.length) missing.push('Portfolio / work samples');

    res.json({ completeness, missing, total: 100 });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// Stage 2: Add employment history entry
// ------------------------------------------------------------------
router.post('/:id/employment', authenticate, [
  param('id').isMongoId().withMessage('Invalid worker ID'),
  body('employer').trim().notEmpty().withMessage('Employer name is required').isLength({ max: 200 }),
  body('country').trim().notEmpty().withMessage('Country is required').isLength({ max: 100 }),
  body('position').trim().notEmpty().withMessage('Position is required').isLength({ max: 200 }),
  body('startDate').isISO8601().withMessage('Valid start date is required'),
  body('endDate').optional().isISO8601(),
  body('trade').optional().isIn(VALID_TRADES),
  body('feedback').optional().trim().isLength({ max: 500 }),
  handleValidation,
], async (req, res, next) => {
  try {
    const worker = await Worker.findById(req.params.id);
    if (!worker) return res.status(404).json({ error: 'Worker not found' });

    // Only worker themselves or admin can add employment history
    if (req.user.role === 'worker' && worker.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (!['worker', 'admin', 'institution'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    worker.employmentHistory.push(req.body);
    await worker.save();
    res.status(201).json({ message: 'Employment record added', employmentHistory: worker.employmentHistory });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// Stage 2: Bulk registration via CSV (Pearson model)
// ------------------------------------------------------------------
router.post('/bulk-register', authenticate, authorize('admin', 'institution'), [
  body('workers').isArray({ min: 1, max: 500 }).withMessage('Workers array required (max 500)'),
  body('workers.*.fullName').trim().notEmpty().withMessage('Full name is required'),
  body('workers.*.cnic').matches(/^\d{5}-\d{7}-\d{1}$/).withMessage('CNIC format: 12345-1234567-1'),
  body('workers.*.trade').isIn(VALID_TRADES).withMessage('Invalid trade'),
  body('workers.*.district').trim().notEmpty().withMessage('District is required'),
  body('workers.*.phone').optional().isLength({ max: 20 }),
  body('workers.*.email').optional().isEmail(),
  handleValidation,
], auditLog('WORKER_BULK_REGISTER'), async (req, res, next) => {
  try {
    const { workers: workerData } = req.body;
    const results = { created: [], errors: [] };

    for (let i = 0; i < workerData.length; i++) {
      try {
        const w = workerData[i];
        const seq = await Counter.getNextSequence('worker');
        const regId = `TL-${new Date().getFullYear()}-${String(seq).padStart(5, '0')}`;

        // Create or find user account
        let userId = null;
        const User = (await import('../models/User.js')).default;
        if (w.email) {
          const existing = await User.findOne({ email: w.email });
          if (existing) {
            userId = existing._id;
          } else {
            const { randomBytes } = await import('crypto');
            const tmpPass = randomBytes(12).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) + 'Aa1!';
            const newUser = await User.create({
              name: w.fullName,
              email: w.email,
              password: tmpPass,
              role: 'worker',
              district: w.district,
            });
            userId = newUser._id;
          }
        } else {
          // No email: create placeholder user with generated email
          const placeholderEmail = `bulk-${regId.toLowerCase()}@talentledger.pk`;
          const { randomBytes } = await import('crypto');
          const tmpPass2 = randomBytes(12).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) + 'Aa1!';
          const newUser = await User.create({
            name: w.fullName,
            email: placeholderEmail,
            password: tmpPass2,
            role: 'worker',
            district: w.district,
          });
          userId = newUser._id;
        }

        const worker = await Worker.create({
          user: userId,
          registrationId: regId,
          fullName: w.fullName,
          cnicEncrypted: encrypt(w.cnic),
          cnicMasked: maskCNIC(w.cnic),
          district: w.district,
          trade: w.trade,
          phone: w.phone,
          fatherName: w.fatherName,
          gender: w.gender,
        });
        results.created.push({ index: i, registrationId: regId, workerId: worker._id });
      } catch (err) {
        results.errors.push({ index: i, name: workerData[i].fullName, error: err.message });
      }
    }

    res.status(201).json({
      message: `Bulk registration complete: ${results.created.length} created, ${results.errors.length} errors`,
      ...results,
    });
  } catch (err) { next(err); }
});

// Delete worker (soft: set inactive)
router.delete('/:id', authenticate, authorize('admin'), [
  param('id').isMongoId().withMessage('Invalid worker ID'),
  handleValidation,
], auditLog('WORKER_DELETE'), async (req, res, next) => {
  try {
    const worker = await Worker.findByIdAndUpdate(req.params.id, { status: 'inactive' }, { new: true });
    if (!worker) return res.status(404).json({ error: 'Worker not found' });
    res.json({ message: 'Worker deactivated' });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════
// GAP #21: E-Portfolio System
// ═══════════════════════════════════════════════════════════════

// Add portfolio item
router.post('/:id/portfolio', authenticate, [
  param('id').isMongoId().withMessage('Invalid worker ID'),
  body('title').trim().notEmpty().withMessage('Title required').isLength({ max: 200 }),
  body('description').optional().trim().isLength({ max: 500 }),
  body('fileUrl').optional().trim(),
  body('type').isIn(['photo', 'video', 'document', 'certificate', 'other']).withMessage('Invalid type'),
  body('competencyArea').optional().trim().isLength({ max: 200 }),
  body('collection').optional().trim().isLength({ max: 100 }),
  body('tags').optional().isArray({ max: 10 }),
  body('visibility').optional().isIn(['private', 'assessor', 'public']),
  handleValidation,
], async (req, res, next) => {
  try {
    const worker = await Worker.findById(req.params.id);
    if (!worker) return res.status(404).json({ error: 'Worker not found' });

    // Ownership check
    if (req.user.role === 'worker' && worker.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const item = {
      title: req.body.title,
      description: req.body.description,
      fileUrl: req.body.fileUrl,
      type: req.body.type,
      competencyArea: req.body.competencyArea,
      collection: req.body.collection,
      tags: req.body.tags,
      visibility: req.body.visibility || 'private',
      uploadedAt: new Date(),
    };

    worker.portfolio.push(item);
    await worker.save();

    res.status(201).json({
      message: 'Portfolio item added',
      item: worker.portfolio[worker.portfolio.length - 1],
      totalItems: worker.portfolio.length,
    });
  } catch (err) { next(err); }
});

// Update portfolio item
router.put('/:id/portfolio/:index', authenticate, [
  param('id').isMongoId().withMessage('Invalid worker ID'),
  param('index').isInt({ min: 0 }).toInt(),
  body('title').optional().trim().isLength({ max: 200 }),
  body('description').optional().trim().isLength({ max: 500 }),
  body('competencyArea').optional().trim().isLength({ max: 200 }),
  body('collection').optional().trim().isLength({ max: 100 }),
  body('tags').optional().isArray({ max: 10 }),
  body('visibility').optional().isIn(['private', 'assessor', 'public']),
  handleValidation,
], async (req, res, next) => {
  try {
    const worker = await Worker.findById(req.params.id);
    if (!worker) return res.status(404).json({ error: 'Worker not found' });

    if (req.user.role === 'worker' && worker.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const idx = req.params.index;
    if (!worker.portfolio[idx]) return res.status(404).json({ error: 'Portfolio item not found' });

    const fields = ['title', 'description', 'competencyArea', 'collection', 'tags', 'visibility'];
    for (const f of fields) {
      if (req.body[f] !== undefined) worker.portfolio[idx][f] = req.body[f];
    }
    await worker.save();

    res.json({ message: 'Portfolio item updated', item: worker.portfolio[idx] });
  } catch (err) { next(err); }
});

// Delete portfolio item
router.delete('/:id/portfolio/:index', authenticate, [
  param('id').isMongoId().withMessage('Invalid worker ID'),
  param('index').isInt({ min: 0 }).toInt(),
  handleValidation,
], async (req, res, next) => {
  try {
    const worker = await Worker.findById(req.params.id);
    if (!worker) return res.status(404).json({ error: 'Worker not found' });

    if (req.user.role === 'worker' && worker.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const idx = req.params.index;
    if (!worker.portfolio[idx]) return res.status(404).json({ error: 'Portfolio item not found' });

    worker.portfolio.splice(idx, 1);
    await worker.save();

    res.json({ message: 'Portfolio item deleted', totalItems: worker.portfolio.length });
  } catch (err) { next(err); }
});

// Create portfolio collection
router.post('/:id/portfolio/collections', authenticate, [
  param('id').isMongoId().withMessage('Invalid worker ID'),
  body('name').trim().notEmpty().withMessage('Collection name required').isLength({ max: 100 }),
  body('description').optional().trim().isLength({ max: 500 }),
  handleValidation,
], async (req, res, next) => {
  try {
    const worker = await Worker.findById(req.params.id);
    if (!worker) return res.status(404).json({ error: 'Worker not found' });

    if (req.user.role === 'worker' && worker.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!worker.portfolioCollections) worker.portfolioCollections = [];

    // Check duplicate name
    if (worker.portfolioCollections.some(c => c.name === req.body.name)) {
      return res.status(409).json({ error: 'Collection with this name already exists' });
    }

    worker.portfolioCollections.push({
      name: req.body.name,
      description: req.body.description,
      createdAt: new Date(),
    });
    await worker.save();

    res.status(201).json({
      message: 'Collection created',
      collection: worker.portfolioCollections[worker.portfolioCollections.length - 1],
      totalCollections: worker.portfolioCollections.length,
    });
  } catch (err) { next(err); }
});

// Get portfolio with collections view
router.get('/:id/portfolio', authenticate, [
  param('id').isMongoId().withMessage('Invalid worker ID'),
  query('collection').optional().trim(),
  query('competencyArea').optional().trim(),
  query('visibility').optional().isIn(['private', 'assessor', 'public']),
  handleValidation,
], async (req, res, next) => {
  try {
    const worker = await Worker.findById(req.params.id);
    if (!worker) return res.status(404).json({ error: 'Worker not found' });

    // Non-owners can only see public or assessor-visible items
    const isOwner = req.user.role === 'worker' && worker.user.toString() === req.user._id.toString();
    const isAssessor = ['admin', 'assessor', 'institution'].includes(req.user.role);

    let items = worker.portfolio || [];
    if (!isOwner && !isAssessor) {
      items = items.filter(i => i.visibility === 'public');
    } else if (isAssessor && !isOwner) {
      items = items.filter(i => ['public', 'assessor'].includes(i.visibility));
    }

    // Apply filters
    if (req.query.collection) {
      items = items.filter(i => i.collection === req.query.collection);
    }
    if (req.query.competencyArea) {
      items = items.filter(i => i.competencyArea === req.query.competencyArea);
    }
    if (req.query.visibility) {
      items = items.filter(i => i.visibility === req.query.visibility);
    }

    // Group by collection
    const collections = {};
    const uncategorized = [];
    for (const item of items) {
      if (item.collection) {
        if (!collections[item.collection]) collections[item.collection] = [];
        collections[item.collection].push(item);
      } else {
        uncategorized.push(item);
      }
    }

    res.json({
      totalItems: items.length,
      collections,
      uncategorized,
      portfolioCollections: worker.portfolioCollections || [],
      allItems: items,
    });
  } catch (err) { next(err); }
});

// Generate portfolio share link
router.post('/:id/portfolio/share', authenticate, [
  param('id').isMongoId().withMessage('Invalid worker ID'),
  handleValidation,
], async (req, res, next) => {
  try {
    const worker = await Worker.findById(req.params.id);
    if (!worker) return res.status(404).json({ error: 'Worker not found' });

    if (req.user.role === 'worker' && worker.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const crypto = await import('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    worker.portfolioShareToken = token;
    worker.portfolioShareExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    await worker.save();

    res.json({
      message: 'Share link generated (valid for 30 days)',
      shareToken: token,
      expiresAt: worker.portfolioShareExpiry,
    });
  } catch (err) { next(err); }
});

// ====================================================================
// Gap #28: Work Permit Management
// ====================================================================

// PUT /:id/work-permit — Update work permit directly
router.put('/:id/work-permit', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId(),
  body('permitNumber').optional().trim().isLength({ max: 100 }),
  body('issuingAuthority').optional().trim().isLength({ max: 200 }),
  body('issuingCountry').optional().trim().isLength({ max: 100 }),
  body('status').optional().isIn(['not-applied', 'applied', 'approved', 'active', 'expired', 'cancelled']),
  body('issueDate').optional().isISO8601(),
  body('expiryDate').optional().isISO8601(),
  body('occupation').optional().trim().isLength({ max: 200 }),
  body('sponsorName').optional().trim().isLength({ max: 200 }),
  handleValidation,
], auditLog('WORKER_WORK_PERMIT_UPDATE'), async (req, res, next) => {
  try {
    const worker = await Worker.findById(req.params.id);
    if (!worker) return res.status(404).json({ error: 'Worker not found' });

    if (!worker.workPermit) worker.workPermit = {};
    const fields = ['permitNumber', 'issuingAuthority', 'issuingCountry', 'status', 'occupation', 'sponsorName'];
    for (const f of fields) {
      if (req.body[f] !== undefined) worker.workPermit[f] = req.body[f];
    }
    if (req.body.issueDate) worker.workPermit.issueDate = new Date(req.body.issueDate);
    if (req.body.expiryDate) worker.workPermit.expiryDate = new Date(req.body.expiryDate);

    await worker.save();
    res.json({ message: 'Work permit updated', workPermit: worker.workPermit });
  } catch (err) { next(err); }
});

// GET /:id/work-permit — Get worker's work permit
router.get('/:id/work-permit', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const worker = await Worker.findById(req.params.id).select('workPermit fullName trade');
    if (!worker) return res.status(404).json({ error: 'Worker not found' });
    res.json({
      worker: { fullName: worker.fullName, trade: worker.trade },
      workPermit: worker.workPermit || { status: 'not-applied' },
    });
  } catch (err) { next(err); }
});

export default router;
