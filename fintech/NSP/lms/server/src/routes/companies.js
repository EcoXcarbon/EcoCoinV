import express from 'express';
import Company from '../models/Company.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = express.Router();

// GET /stats/overview — MUST be before /:companyId
router.get('/stats/overview', authenticate, authorize('admin', 'institution'), async (req, res) => {
  try {
    const [total, activelyHiring, verified, byCountry] = await Promise.all([
      Company.countDocuments({ isActive: true }),
      Company.countDocuments({ isActive: true, hiringStatus: 'ACTIVELY_HIRING' }),
      Company.countDocuments({ isActive: true, verificationStatus: 'VERIFIED' }),
      Company.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$location.country', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 15 },
      ]),
    ]);
    res.json({ total, activelyHiring, verified, byCountry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET / — public search
router.get('/', async (req, res) => {
  try {
    const { q, country, sector, type, hiringStatus, page = 1, limit = 20 } = req.query;
    const filter = { isActive: true };
    if (q) filter.$text = { $search: q };
    if (country) filter['location.country'] = country;
    if (sector) filter.sector = sector;
    if (type) filter.type = type;
    if (hiringStatus) filter.hiringStatus = hiringStatus;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [companies, total] = await Promise.all([
      Company.find(filter).skip(skip).limit(parseInt(limit)).lean(),
      Company.countDocuments(filter),
    ]);
    res.json({ companies, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:companyId — public
router.get('/:companyId', async (req, res) => {
  try {
    const company = await Company.findOne({ companyId: req.params.companyId, isActive: true }).lean();
    if (!company) return res.status(404).json({ error: 'Company not found' });
    res.json(company);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST / — admin or institution
router.post('/', authenticate, authorize('admin', 'institution'), async (req, res) => {
  try {
    const company = await Company.create({ ...req.body, source: 'MANUAL' });
    res.status(201).json(company);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Duplicate company ID' });
    res.status(400).json({ error: err.message });
  }
});

// PUT /:companyId — admin only
router.put('/:companyId', authenticate, authorize('admin'), async (req, res) => {
  try {
    const company = await Company.findOneAndUpdate(
      { companyId: req.params.companyId },
      { $set: req.body },
      { new: true, runValidators: true }
    );
    if (!company) return res.status(404).json({ error: 'Company not found' });
    res.json(company);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
