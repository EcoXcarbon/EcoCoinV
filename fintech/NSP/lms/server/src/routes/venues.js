import { Router } from 'express';
import { body, param, query } from 'express-validator';
import Venue from '../models/Venue.js';
import Assessment from '../models/Assessment.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { handleValidation } from '../middleware/validate.js';
import { auditLog } from '../middleware/audit.js';

const router = Router();

const VALID_TYPES = ['assessment-centre', 'workshop', 'training-centre', 'employer-site', 'field-site', 'mobile-unit', 'other'];

// POST / — Create venue
router.post('/', authenticate, authorize('admin', 'institution'), [
  body('name').trim().notEmpty().isLength({ max: 300 }),
  body('address').trim().notEmpty().isLength({ max: 500 }),
  body('city').trim().notEmpty().isLength({ max: 100 }),
  body('district').trim().notEmpty().isLength({ max: 100 }),
  body('province').optional().trim().isLength({ max: 100 }),
  body('type').isIn(VALID_TYPES),
  body('capacity').optional().isInt({ min: 1 }).toInt(),
  body('facilities').optional().isArray(),
  body('contact.name').optional().trim().isLength({ max: 200 }),
  body('contact.phone').optional().trim().isLength({ max: 20 }),
  body('contact.email').optional().isEmail().normalizeEmail(),
  body('gpsCoordinates.latitude').optional().isFloat({ min: -90, max: 90 }).toFloat(),
  body('gpsCoordinates.longitude').optional().isFloat({ min: -180, max: 180 }).toFloat(),
  handleValidation,
], auditLog('VENUE_CREATE'), async (req, res, next) => {
  try {
    const venue = await Venue.create({
      ...req.body,
      createdBy: req.user._id,
    });
    res.status(201).json(venue);
  } catch (err) { next(err); }
});

// GET / — List venues
router.get('/', authenticate, [
  query('type').optional().isIn(VALID_TYPES),
  query('district').optional().trim().isLength({ max: 100 }),
  query('active').optional().isIn(['true', 'false']),
  query('city').optional().trim().isLength({ max: 100 }),
  handleValidation,
], async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.type) filter.type = req.query.type;
    if (req.query.district) filter.district = req.query.district;
    if (req.query.city) filter.city = req.query.city;
    if (req.query.active !== undefined) filter.active = req.query.active === 'true';

    const venues = await Venue.find(filter).sort('-createdAt');
    res.json({ total: venues.length, venues });
  } catch (err) { next(err); }
});

// GET /:id — Get single venue
router.get('/:id', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const venue = await Venue.findById(req.params.id);
    if (!venue) return res.status(404).json({ error: 'Venue not found' });
    res.json(venue);
  } catch (err) { next(err); }
});

// PUT /:id — Update venue
router.put('/:id', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId(),
  body('name').optional().trim().isLength({ max: 300 }),
  body('address').optional().trim().isLength({ max: 500 }),
  body('city').optional().trim().isLength({ max: 100 }),
  body('district').optional().trim().isLength({ max: 100 }),
  body('type').optional().isIn(VALID_TYPES),
  body('capacity').optional().isInt({ min: 1 }).toInt(),
  body('facilities').optional().isArray(),
  handleValidation,
], auditLog('VENUE_UPDATE'), async (req, res, next) => {
  try {
    const venue = await Venue.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!venue) return res.status(404).json({ error: 'Venue not found' });
    res.json(venue);
  } catch (err) { next(err); }
});

// DELETE /:id — Soft-deactivate venue
router.delete('/:id', authenticate, authorize('admin'), [
  param('id').isMongoId(),
  handleValidation,
], auditLog('VENUE_DEACTIVATE'), async (req, res, next) => {
  try {
    const venue = await Venue.findByIdAndUpdate(req.params.id, { active: false }, { new: true });
    if (!venue) return res.status(404).json({ error: 'Venue not found' });
    res.json({ message: 'Venue deactivated', venue });
  } catch (err) { next(err); }
});

// GET /:id/schedule — Scheduled assessments at this venue
router.get('/:id/schedule', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const venue = await Venue.findById(req.params.id);
    if (!venue) return res.status(404).json({ error: 'Venue not found' });

    const assessments = await Assessment.find({
      'rpl.schedule.venueId': venue._id,
    }).select('worker trade title status rpl.schedule').populate('worker', 'fullName trade');

    // Extract schedule slots for this venue
    const slots = [];
    for (const a of assessments) {
      for (const slot of (a.rpl?.schedule || [])) {
        if (slot.venueId?.toString() === venue._id.toString()) {
          slots.push({
            assessmentId: a._id,
            worker: a.worker,
            trade: a.trade,
            title: a.title,
            stage: slot.stage,
            scheduledDate: slot.scheduledDate,
            scheduledEndDate: slot.scheduledEndDate,
            status: slot.status,
          });
        }
      }
    }

    slots.sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate));
    res.json({ venue: venue.name, total: slots.length, slots });
  } catch (err) { next(err); }
});

export default router;
