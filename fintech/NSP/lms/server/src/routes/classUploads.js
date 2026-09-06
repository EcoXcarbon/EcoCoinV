import { Router } from 'express';
import { param } from 'express-validator';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import Class from '../models/Class.js';
import ClassEnrollment from '../models/ClassEnrollment.js';
import { authenticate } from '../middleware/auth.js';
import { handleValidation } from '../middleware/validate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ALLOWED = /\.(jpg|jpeg|png|webp|pdf|doc|docx|xls|xlsx|ppt|pptx|mp4|webm|mov|txt|zip)$/i;

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '../../uploads'),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
      cb(null, `class-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED.test(file.originalname)) {
      return cb(new Error(`File type not allowed: ${path.extname(file.originalname)}`));
    }
    cb(null, true);
  },
});

const router = Router({ mergeParams: true });

router.post('/', authenticate, [
  param('classId').isMongoId(),
  handleValidation,
], (req, res, next) => {
  upload.array('files', 5)(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    try {
      const cls = await Class.findById(req.params.classId);
      if (!cls) return res.status(404).json({ error: 'Class not found' });
      const member = await ClassEnrollment.findOne({ class: cls._id, user: req.user._id, status: 'active' });
      if (!member) return res.status(403).json({ error: 'Not a member' });

      const files = (req.files || []).map(f => ({
        name: f.originalname,
        url: `/api/uploads/${f.filename}`,
        size: f.size,
        type: f.mimetype,
      }));
      res.status(201).json({ files });
    } catch (e) { next(e); }
  });
});

export default router;
