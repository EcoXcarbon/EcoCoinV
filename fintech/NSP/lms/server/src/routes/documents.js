import { Router } from 'express';
import { body, param, query } from 'express-validator';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import Document from '../models/Document.js';
import Worker from '../models/Worker.js';
import { authenticate } from '../middleware/auth.js';
import { handleValidation } from '../middleware/validate.js';
import { auditLog } from '../middleware/audit.js';

const router = Router();

// Ensure the upload target exists — multer's diskStorage does NOT create it,
// so a missing dir makes every upload 500 with an ENOENT.
const DOC_DIR = 'uploads/documents/';
try { fs.mkdirSync(DOC_DIR, { recursive: true }); } catch { /* already exists */ }

const storage = multer.diskStorage({
  destination: (req, file, cb) => { try { fs.mkdirSync(DOC_DIR, { recursive: true }); } catch { /* exists */ } cb(null, DOC_DIR); },
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },  // 20MB
  fileFilter: (req, file, cb) => {
    const allowed = /pdf|jpg|jpeg|png|webp|doc|docx/i;
    if (allowed.test(path.extname(file.originalname))) cb(null, true);
    else cb(new Error('Only PDF, image, and document files are allowed'));
  },
});

const VALID_CATEGORIES = ['cv-resume', 'certificate', 'experience-letter', 'reference-letter', 'identity-doc', 'training-cert', 'safety-card', 'medical-cert', 'passport', 'photo', 'work-sample', 'other'];

// List documents for current worker
router.get('/', authenticate, [
  query('category').optional().isIn(VALID_CATEGORIES),
  handleValidation,
], async (req, res, next) => {
  try {
    const worker = await Worker.findOne({ user: req.user._id }).select('_id');
    if (!worker) return res.json({ documents: [] });

    const filter = { worker: worker._id, status: 'active' };
    if (req.query.category) filter.category = req.query.category;

    const documents = await Document.find(filter).sort('-createdAt').limit(100);
    res.json({ documents });
  } catch (err) { next(err); }
});

// Upload document
router.post('/', authenticate, upload.single('file'), [
  body('title').trim().notEmpty().isLength({ max: 300 }),
  body('description').optional().isLength({ max: 1000 }),
  body('category').optional().isIn(VALID_CATEGORIES),
  body('expiryDate').optional().isISO8601(),
  handleValidation,
], auditLog('DOCUMENT_UPLOAD'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'File is required' });

    const worker = await Worker.findOne({ user: req.user._id });
    if (!worker) return res.status(400).json({ error: 'Worker profile not found' });

    const doc = await Document.create({
      worker: worker._id,
      uploadedBy: req.user._id,
      title: req.body.title,
      description: req.body.description,
      category: req.body.category || 'other',
      file: {
        name: req.file.originalname,
        url: `/uploads/documents/${req.file.filename}`,
        size: req.file.size,
        mimeType: req.file.mimetype,
      },
      expiryDate: req.body.expiryDate,
    });
    res.status(201).json(doc);
  } catch (err) { next(err); }
});

// Delete (archive) document
router.delete('/:id', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], auditLog('DOCUMENT_DELETE'), async (req, res, next) => {
  try {
    const worker = await Worker.findOne({ user: req.user._id }).select('_id');
    const doc = await Document.findOne({ _id: req.params.id, worker: worker?._id });
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    doc.status = 'archived';
    await doc.save();
    res.json({ message: 'Document archived' });
  } catch (err) { next(err); }
});

export default router;
