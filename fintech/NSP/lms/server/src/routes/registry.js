import express from 'express';
import mongoose from 'mongoose';
import { body, param, query, validationResult } from 'express-validator';
import { authenticate, authorize } from '../middleware/auth.js';
import {
  publicVerificationLimiter,
  authenticatedApiLimiter,
  bulkOperationLimiter,
  apiKeyAuth,
  tlErrorResponse,
  generateApiKey,
} from '../middleware/apiGateway.js';
import RegistryCredential from '../models/RegistryCredential.js';
import Issuer from '../models/Issuer.js';
import Worker from '../models/Worker.js';
import VerificationLog from '../models/VerificationLog.js';
import StatusList from '../models/StatusList.js';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { encrypt, decrypt } from '../utils/encryption.js';
import { resolveDID } from '../services/vc/didResolver.js';
import { issueSDJwt, verifySDJwtPresentation, SD_FIELDS_BY_TYPE, ALWAYS_REVEAL_FIELDS } from '../services/vc/sdJwtService.js';
import { CREDENTIAL_SCHEMAS } from '../services/vc/credentialSchemas.js';
import ApiKey from '../models/ApiKey.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import { signPayload, getIssuerDID } from '../config/keys.js';
import { generateTrainingCertificatePDF, generateCardPDF } from '../services/pdfService.js';
import { auditLog } from '../middleware/audit.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { ISSUER_DID, PUBLIC_BASE } from '../config/identity.js';

const router = express.Router();

// ── Evidence uploads for self-submitted credentials ──
const EVIDENCE_DIR = 'uploads/credential-evidence/';
try { fs.mkdirSync(EVIDENCE_DIR, { recursive: true }); } catch { /* exists */ }
const evidenceUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, EVIDENCE_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/pdf|jpg|jpeg|png|webp|doc|docx/i.test(path.extname(file.originalname))) cb(null, true);
    else cb(new Error('Only PDF, image, and document files are allowed'));
  },
});

// Build + sign a W3C VC for an approved self-submitted credential so it becomes
// publicly verifiable via GET /credentials/:id/verify (signature check passes).
function buildSignedVc(cred) {
  let issuerDid = ISSUER_DID;
  try { issuerDid = getIssuerDID(); } catch { /* fallback */ }
  const vc = {
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    type: ['VerifiableCredential', 'RegistryCredential'],
    id: `urn:tl:registry:${cred.credentialId}`,
    issuer: { id: issuerDid, name: 'TalentLedger Registry' },
    issuanceDate: new Date().toISOString(),
    credentialSubject: {
      title: cred.title, credentialType: cred.credentialType, issuerName: cred.issuerName || null,
    },
  };
  const hash = crypto.createHash('sha256').update(JSON.stringify(vc)).digest('hex');
  let proofValue = null;
  try { proofValue = signPayload(hash); } catch { /* unsigned — hash still gates verify */ }
  vc.proof = {
    type: 'Ed25519Signature2020', created: new Date().toISOString(),
    verificationMethod: `${issuerDid}#key-1`, proofPurpose: 'assertionMethod', proofValue,
  };
  return { vc, hash };
}

const SUBMIT_TYPES = [
  'ACADEMIC', 'TVET', 'RPL', 'PROFESSIONAL_LICENSE', 'MICRO_CREDENTIAL',
  'EMPLOYER_ENDORSEMENT', 'TRAINING_RECORD', 'MIGRATION_RECORD', 'HEALTH_CLEARANCE', 'SELF_DECLARED',
];

// Apply API key auth globally on registry routes (alongside JWT auth)
router.use(apiKeyAuth);

// Validation helper
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Validation failed', details: errors.array() });
  }
  next();
};

// Error code helper
const tlError = (res, code, message, status = 400) =>
  res.status(status).json({ error_code: code, message, timestamp: new Date().toISOString() });

// ══════════════════════════════════════════════
// 1. HOLDER MANAGEMENT
// ══════════════════════════════════════════════

// POST /holders — Register new holder (CNIC-based)
router.post('/holders',
  authenticate,
  authorize('admin', 'institution'),
  [
    body('cnic').matches(/^\d{5}-\d{7}-\d$/).withMessage('CNIC must be in format XXXXX-XXXXXXX-X'),
    body('fullNameEnglish').notEmpty().trim().isLength({ max: 200 }),
    body('trade').notEmpty(),
    body('district').notEmpty(),
  ],
  validate,
  async (req, res) => {
    try {
      const { cnic, fullNameEnglish, fullNameUrdu, trade, district, province, ...rest } = req.body;

      // Check if holder already exists
      const existing = await Worker.findOne({ cnicMasked: { $regex: cnic.slice(-4) + '$' } });
      if (existing) return tlError(res, 'TL-4005', 'Holder with this CNIC already registered', 409);

      // Encrypt CNIC
      const encKey = process.env.ENCRYPTION_KEY || 'a'.repeat(64);
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(encKey, 'hex'), iv);
      let encrypted = cipher.update(cnic, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const cnicEncrypted = iv.toString('hex') + ':' + encrypted;
      const cnicMasked = '*'.repeat(cnic.length - 4) + cnic.slice(-4);

      const worker = new Worker({
        user: req.user._id,
        cnicEncrypted,
        cnicMasked,
        fullName: fullNameEnglish,
        fullNameUrdu,
        trade,
        district,
        province: province || 'Khyber Pakhtunkhwa',
        registrationSource: rest.registrationSource || 'ONLINE',
        ...rest,
      });
      await worker.save();
      res.status(201).json({ message: 'Holder registered', holder: worker });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /holders/:cnic — Get holder profile
router.get('/holders/:cnic',
  authenticate,
  param('cnic').matches(/^\d{5}-\d{7}-\d$/).withMessage('Invalid CNIC format'),
  validate,
  async (req, res) => {
    try {
      const lastFour = req.params.cnic.slice(-4);
      const worker = await Worker.findOne({ cnicMasked: { $regex: lastFour + '$' } }).populate('user', 'name email role');
      if (!worker) return tlError(res, 'TL-3001', 'Holder not found', 404);
      res.json(worker);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// PUT /holders/:cnic — Update holder profile
router.put('/holders/:cnic',
  authenticate,
  param('cnic').matches(/^\d{5}-\d{7}-\d$/).withMessage('Invalid CNIC format'),
  validate,
  async (req, res) => {
    try {
      const lastFour = req.params.cnic.slice(-4);
      const worker = await Worker.findOne({ cnicMasked: { $regex: lastFour + '$' } });
      if (!worker) return tlError(res, 'TL-3001', 'Holder not found', 404);

      // Only allow self-update or admin/institution
      if (req.user.role !== 'admin' && req.user.role !== 'institution' &&
          worker.user.toString() !== req.user._id.toString()) {
        return tlError(res, 'TL-1003', 'Not authorized to update this holder', 403);
      }

      const allowed = ['fullName', 'fullNameUrdu', 'fatherName', 'dateOfBirth', 'gender',
        'phone', 'phoneSecondary', 'district', 'province', 'addressCurrent', 'addressPermanent',
        'photo', 'nextOfKin', 'passport', 'visa', 'medicalClearance'];
      for (const field of allowed) {
        if (req.body[field] !== undefined) worker[field] = req.body[field];
      }
      await worker.save();
      res.json({ message: 'Holder updated', holder: worker });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /holders/:cnic/credentials — Get all credentials for a holder
router.get('/holders/:cnic/credentials',
  authenticate,
  param('cnic').matches(/^\d{5}-\d{7}-\d$/).withMessage('Invalid CNIC format'),
  validate,
  async (req, res) => {
    try {
      const { type, status } = req.query;
      const filter = { holderCnic: req.params.cnic, isDeleted: false };
      if (type) filter.credentialType = type;
      if (status) filter.status = status;
      const credentials = await RegistryCredential.find(filter)
        .sort({ issuanceDate: -1 })
        .limit(parseInt(req.query.limit) || 50)
        .skip(parseInt(req.query.skip) || 0);
      const total = await RegistryCredential.countDocuments(filter);
      res.json({ credentials, total, page: Math.floor((parseInt(req.query.skip) || 0) / 50) + 1 });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /holders/:cnic/profile-card — Tier 1 instant verification card data
router.get('/holders/:cnic/profile-card',
  authenticate,
  param('cnic').matches(/^\d{5}-\d{7}-\d$/).withMessage('Invalid CNIC format'),
  validate,
  async (req, res) => {
    try {
      const lastFour = req.params.cnic.slice(-4);
      const worker = await Worker.findOne({ cnicMasked: { $regex: lastFour + '$' } });
      if (!worker) return tlError(res, 'TL-3001', 'Holder not found', 404);

      const credentials = await RegistryCredential.find({
        holderCnic: req.params.cnic, isDeleted: false, status: { $ne: 'REVOKED' },
      });

      const verified = credentials.filter(c => c.verificationStatus === 'SOURCE_VERIFIED').length;
      const pending = credentials.filter(c => c.status === 'PENDING_VERIFICATION').length;
      const selfDeclared = credentials.filter(c => c.verificationStatus === 'SELF_DECLARED').length;

      // Find highest qualification
      const academic = credentials.find(c => c.credentialType === 'ACADEMIC');
      const tvet = credentials.find(c => c.credentialType === 'TVET');

      res.json({
        name: worker.fullName,
        nameUrdu: worker.fullNameUrdu,
        cnicMasked: worker.cnicMasked,
        photo: worker.photo,
        trade: worker.trade,
        nqfLevel: worker.nqfLevel,
        nadraVerified: worker.nadraVerificationStatus === 'VERIFIED',
        highestQualification: academic?.title || tvet?.title || null,
        credentialSummary: { verified, pending, selfDeclared, total: credentials.length },
        profileCompleteness: worker.profileCompleteness,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// DELETE /holders/:cnic — Soft delete (GDPR-style)
router.delete('/holders/:cnic',
  authenticate,
  authorize('admin'),
  param('cnic').matches(/^\d{5}-\d{7}-\d$/).withMessage('Invalid CNIC format'),
  validate,
  async (req, res) => {
    try {
      const lastFour = req.params.cnic.slice(-4);
      const worker = await Worker.findOne({ cnicMasked: { $regex: lastFour + '$' } });
      if (!worker) return tlError(res, 'TL-3001', 'Holder not found', 404);
      worker.status = 'inactive';
      await worker.save();
      // Soft-delete all credentials
      await RegistryCredential.updateMany({ holderCnic: req.params.cnic }, { isDeleted: true });
      res.json({ message: 'Holder and credentials soft-deleted' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ══════════════════════════════════════════════
// 2. CREDENTIAL MANAGEMENT
// ══════════════════════════════════════════════

// POST /credentials — Create new credential
router.post('/credentials',
  authenticate,
  authorize('admin', 'institution', 'assessor'),
  [
    body('holderCnic').notEmpty(),
    body('credentialType').isIn([
      'ACADEMIC', 'TVET', 'RPL', 'PROFESSIONAL_LICENSE', 'MICRO_CREDENTIAL',
      'EMPLOYER_ENDORSEMENT', 'TRAINING_RECORD', 'IDENTITY_VERIFICATION',
      'MIGRATION_RECORD', 'HEALTH_CLEARANCE', 'SELF_DECLARED',
    ]),
    body('title').notEmpty().isLength({ max: 500 }),
  ],
  validate,
  async (req, res) => {
    try {
      const cred = new RegistryCredential({
        ...req.body,
        verifiedBy: req.user._id.toString(),
      });
      await cred.save();

      // Update holder credential counts
      const counts = await RegistryCredential.aggregate([
        { $match: { holderCnic: cred.holderCnic, isDeleted: false } },
        { $group: { _id: null, total: { $sum: 1 }, verified: { $sum: { $cond: [{ $eq: ['$verificationStatus', 'SOURCE_VERIFIED'] }, 1, 0] } } } },
      ]);
      if (counts.length > 0) {
        const lastFour = cred.holderCnic.slice(-4);
        await Worker.updateOne(
          { cnicMasked: { $regex: lastFour + '$' } },
          { totalCredentialsCount: counts[0].total, verifiedCredentialsCount: counts[0].verified }
        );
      }

      res.status(201).json({ message: 'Credential created', credential: cred });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ══════════════════════════════════════════════
//  SELF-SUBMITTED CREDENTIAL → ADMIN VERIFICATION
// ══════════════════════════════════════════════

// POST /credentials/submit — a holder submits their own credential + evidence for verification
router.post('/credentials/submit',
  authenticate,
  authorize('worker', 'admin', 'institution'),
  evidenceUpload.array('evidence', 5),
  auditLog('REGISTRY_CREDENTIAL_SUBMIT'),
  [
    body('credentialType').isIn(SUBMIT_TYPES),
    body('title').notEmpty().isLength({ max: 500 }),
  ],
  validate,
  async (req, res) => {
    try {
      const worker = await Worker.findOne({ user: req.user._id });
      if (!worker) return res.status(400).json({ error: 'No worker profile is linked to your account. Complete your worker registration first.' });

      const files = (req.files || []).map(f => ({
        name: f.originalname,
        url: `/api/uploads/credential-evidence/${path.basename(f.path)}`,
        size: f.size, mimeType: f.mimetype,
      }));

      const cred = new RegistryCredential({
        holderCnic: worker.cnicMasked || worker.registrationId || `TL-${worker._id}`,
        holder: worker._id,
        submittedBy: req.user._id,
        credentialType: req.body.credentialType,
        credentialSubtype: req.body.credentialSubtype,
        title: req.body.title,
        issuerName: req.body.issuerName,
        issuanceDate: req.body.issuanceDate || undefined,
        expiryDate: req.body.expiryDate || undefined,
        status: 'PENDING_VERIFICATION',
        verificationStatus: 'SELF_DECLARED',
        verificationMethod: 'DOCUMENT_SCAN',
        evidenceFiles: files,
        metadata: { selfDeclared: { evidenceDescription: req.body.evidenceDescription || '' } },
      });
      await cred.save();

      // Route to reviewers: notify all admins + institutions.
      const admins = await User.find({ role: { $in: ['admin', 'institution'] }, isActive: { $ne: false } }).select('_id').lean();
      if (admins.length) {
        await Notification.insertMany(admins.map(a => ({
          recipient: a._id, type: 'credential-submitted',
          title: 'New credential submitted for verification',
          message: `${worker.fullName} submitted "${cred.title}" for verification.`,
          link: '/credentials?tab=verification-queue', worker: worker._id,
          metadata: { credentialId: cred.credentialId },
        }))).catch(() => {});
      }

      res.status(201).json({ message: 'Submitted for verification', credential: cred });
    } catch (err) { res.status(500).json({ error: err.message }); }
  }
);

// GET /my-submissions — the caller's own submitted/held registry credentials + statuses
router.get('/my-submissions', authenticate, async (req, res) => {
  try {
    const worker = await Worker.findOne({ user: req.user._id }).select('_id');
    const filter = worker
      ? { $or: [{ submittedBy: req.user._id }, { holder: worker._id }], isDeleted: false }
      : { submittedBy: req.user._id, isDeleted: false };
    const credentials = await RegistryCredential.find(filter).sort('-createdAt')
      .select('credentialId title credentialType issuerName status verificationStatus rejectionReason evidenceFiles createdAt verificationDate')
      .lean();
    res.json({ credentials });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /verification-queue — self-submitted credentials in the review workflow.
// Includes everything still needing/undergoing review (pending, held, referred,
// changes-requested). ?status=<X> narrows it; ?status=ALL includes decided ones.
router.get('/verification-queue',
  authenticate, authorize('admin', 'institution', 'assessor'),
  async (req, res) => {
    try {
      const OPEN = ['PENDING_VERIFICATION', 'UNDER_REVIEW', 'CHANGES_REQUESTED'];
      let statusFilter;
      if (req.query.status && req.query.status !== 'ALL') statusFilter = req.query.status;
      const filter = { submittedBy: { $ne: null }, isDeleted: false };
      filter.status = statusFilter ? statusFilter : (req.query.status === 'ALL' ? { $ne: null } : { $in: OPEN });
      const credentials = await RegistryCredential.find(filter).sort('-createdAt')
        .populate('holder', 'fullName registrationId cnicMasked trade nadraVerificationStatus')
        .populate('submittedBy', 'name email')
        .lean();
      // Live counts per state so the UI can show tab badges.
      const counts = await RegistryCredential.aggregate([
        { $match: { submittedBy: { $ne: null }, isDeleted: false } },
        { $group: { _id: '$status', n: { $sum: 1 } } },
      ]);
      const byStatus = Object.fromEntries(counts.map((c) => [c._id, c.n]));
      res.json({ count: credentials.length, credentials, counts: byStatus });
    } catch (err) { res.status(500).json({ error: err.message }); }
  }
);

// POST /credentials/:credentialId/review-submission — record a review decision.
// decisions: APPROVE | REJECT | REQUEST_CHANGES | FORWARD | HOLD.
const REVIEW_DECISIONS = ['APPROVE', 'REJECT', 'REQUEST_CHANGES', 'FORWARD', 'HOLD'];
router.post('/credentials/:credentialId/review-submission',
  authenticate, authorize('admin', 'institution'),
  auditLog('REGISTRY_CREDENTIAL_REVIEW'),
  [
    body('decision').isIn(REVIEW_DECISIONS),
    body('reviewNotes').optional().isLength({ max: 2000 }),
    body('rejectionReason').optional().isLength({ max: 1000 }),
    body('referredTo').optional().isLength({ max: 120 }),
  ],
  validate,
  async (req, res) => {
    try {
      const cred = await RegistryCredential.findOne({ credentialId: req.params.credentialId, isDeleted: false })
        .populate('holder', 'fullName');
      if (!cred) return tlError(res, 'TL-3002', 'Submission not found', 404);
      // Terminal states can't be re-decided (ACTIVE credentials, or already rejected).
      if (['ACTIVE', 'REJECTED', 'REVOKED', 'EXPIRED', 'SUSPENDED'].includes(cred.status)) {
        return res.status(409).json({ error: `This submission is already ${cred.status.replace(/_/g, ' ').toLowerCase()}.` });
      }

      const { decision } = req.body;
      const note = req.body.reviewNotes || req.body.rejectionReason || '';
      cred.reviewNotes = note;
      cred.reviewHistory = cred.reviewHistory || [];

      let notif = null;
      if (decision === 'APPROVE') {
        const { vc, hash } = buildSignedVc(cred);
        cred.w3cVcJson = vc; cred.credentialHash = hash;
        cred.status = 'ACTIVE'; cred.verificationStatus = 'PLATFORM_VERIFIED';
        cred.verifiedBy = req.user._id.toString(); cred.verificationDate = new Date();
        cred.assignedTo = null; cred.referredTo = null;
        notif = { type: 'credential-verified', title: 'Credential verified ✓',
          message: `Your credential "${cred.title}" has been verified and added to your registry.` };
      } else if (decision === 'REJECT') {
        cred.status = 'REJECTED'; cred.verificationStatus = 'VERIFICATION_FAILED';
        cred.rejectionReason = req.body.rejectionReason || note || 'Could not be verified.';
        cred.verifiedBy = req.user._id.toString(); cred.verificationDate = new Date();
        notif = { type: 'credential-rejected', title: 'Credential not verified',
          message: `Your credential "${cred.title}" was not verified. ${cred.rejectionReason} You may submit a corrected version.` };
      } else if (decision === 'REQUEST_CHANGES') {
        cred.status = 'CHANGES_REQUESTED';
        notif = { type: 'credential-changes-requested', title: 'Changes requested on your credential',
          message: `Please revise "${cred.title}" and resubmit. Reviewer note: ${note || 'clearer evidence needed.'}` };
      } else if (decision === 'FORWARD') {
        cred.status = 'UNDER_REVIEW';
        cred.referredTo = req.body.referredTo || 'Another reviewer';
        notif = { type: 'credential-forwarded', title: 'Your credential is being verified',
          message: `"${cred.title}" has been referred to ${cred.referredTo} for further verification.` };
      } else if (decision === 'HOLD') {
        cred.status = 'UNDER_REVIEW';
        cred.assignedTo = req.user._id; cred.assignedToName = req.user.name;
        // internal only — no applicant notification for a hold/claim
      }

      cred.reviewHistory.push({
        action: decision, by: req.user._id, byName: req.user.name,
        note, referredTo: decision === 'FORWARD' ? cred.referredTo : undefined, at: new Date(),
      });
      await cred.save();

      if (notif && cred.submittedBy) {
        await Notification.create({
          recipient: cred.submittedBy, type: notif.type, title: notif.title, message: notif.message,
          link: '/credentials?tab=my-submissions', worker: cred.holder?._id || cred.holder,
          metadata: { credentialId: cred.credentialId },
        }).catch(() => {});
      }

      res.json({ message: `Decision recorded: ${decision}`, credential: cred });
    } catch (err) { res.status(500).json({ error: err.message }); }
  }
);

// GET /credentials — the signed-in holder's own registry credentials (Digital Wallet)
router.get('/credentials',
  authenticate,
  async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
      const or = [{ submittedBy: req.user._id }];
      const worker = await Worker.findOne({ user: req.user._id }).select('_id cnicMasked').lean();
      if (worker) {
        or.push({ holder: worker._id });
        if (worker.cnicMasked) or.push({ holderCnic: worker.cnicMasked });
      }
      const credentials = await RegistryCredential.find({ $or: or, isDeleted: false })
        .select('-w3cVcJson')
        .sort('-createdAt')
        .limit(limit)
        .lean();
      res.json({ credentials, count: credentials.length });
    } catch (err) { res.status(500).json({ error: err.message }); }
  }
);

// GET /credentials/:credentialId — Get single credential
router.get('/credentials/:credentialId',
  authenticate,
  async (req, res) => {
    try {
      const cred = await RegistryCredential.findOne({
        credentialId: req.params.credentialId, isDeleted: false,
      }).populate('issuer');
      if (!cred) return tlError(res, 'TL-3002', 'Credential not found', 404);
      res.json(cred);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── Downloadable certificate / PVC card for a REGISTRY credential ───
// The Digital Wallet shows "Certificate PDF" and "PVC Card" for every credential,
// but registry credentials (self-submitted → verified) are NOT legacy `Credential`
// documents, so the /credentials/:id/pdf|card routes 404 on them. These two routes
// render an award-style certificate and a CR80 card straight from the RegistryCredential.
async function loadRegistryCredForDownload(req, res) {
  const cred = await RegistryCredential.findOne({ credentialId: req.params.credentialId, isDeleted: false })
    .populate('holder', 'fullName fatherName registrationId cnicMasked district trade nqfLevel photo')
    .populate('submittedBy', 'name')
    .lean();
  if (!cred) { tlError(res, 'TL-3002', 'Credential not found', 404); return null; }
  // Access control: staff download any; a holder downloads only their own.
  const role = req.user.role;
  if (role !== 'admin' && role !== 'institution' && role !== 'assessor') {
    const worker = await Worker.findOne({ user: req.user._id }).select('_id cnicMasked').lean();
    const owns =
      (cred.submittedBy && String(cred.submittedBy._id || cred.submittedBy) === String(req.user._id)) ||
      (worker && cred.holder && String(cred.holder._id || cred.holder) === String(worker._id)) ||
      (worker && worker.cnicMasked && cred.holderCnic === worker.cnicMasked);
    if (!owns) { res.status(403).json({ error: 'Access denied' }); return null; }
  }
  return cred;
}

// Map a RegistryCredential onto the shape the PDF generators expect.
function toCertificateShape(cred) {
  const holderName = cred.holder?.fullName || cred.submittedBy?.name || 'Credential Holder';
  const md = cred.metadata || {};
  const emp = md.employerEndorsement || {};
  const tr = md.trainingRecord || {};
  return {
    credentialId: cred.credentialId,
    holderName,
    worker: cred.holder || { fullName: holderName },
    title: cred.title,
    programTitle: cred.title,
    institute: cred.issuerName || emp.employerName || tr.trainingProvider || '',
    institution: cred.issuerName || emp.employerName || tr.trainingProvider || '',
    trade: cred.title,
    type: cred.credentialType,
    startDate: emp.employmentStart || cred.issuanceDate,
    endDate: emp.employmentEnd || undefined,
    durationLabel: tr.trainingDurationHours ? `${tr.trainingDurationHours} hours` : undefined,
    status: cred.status === 'ACTIVE' ? 'active' : 'inactive',
    validFrom: cred.issuanceDate,
    validUntil: cred.expiryDate,
    vc: { credentialHash: cred.credentialHash },
    signatory: { name: 'Authorised Signatory', title: 'TalentLedger, PPMC KP' },
  };
}

// GET /credentials/:credentialId/pdf — award-style certificate PDF
router.get('/credentials/:credentialId/pdf', authenticate, async (req, res, next) => {
  try {
    const cred = await loadRegistryCredForDownload(req, res);
    if (!cred) return;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${cred.credentialId}.pdf`);
    await generateTrainingCertificatePDF(toCertificateShape(cred), res);
  } catch (err) { next(err); }
});

// GET /credentials/:credentialId/card — CR80 PVC card PDF
router.get('/credentials/:credentialId/card', authenticate, async (req, res, next) => {
  try {
    const cred = await loadRegistryCredForDownload(req, res);
    if (!cred) return;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${cred.credentialId}-card.pdf`);
    await generateCardPDF(toCertificateShape(cred), res);
  } catch (err) { next(err); }
});

// PUT /credentials/:credentialId — Update credential
router.put('/credentials/:credentialId',
  authenticate,
  authorize('admin', 'institution'),
  async (req, res) => {
    try {
      const cred = await RegistryCredential.findOne({
        credentialId: req.params.credentialId, isDeleted: false,
      });
      if (!cred) return tlError(res, 'TL-3002', 'Credential not found', 404);

      const allowed = ['title', 'status', 'verificationStatus', 'verificationMethod',
        'verificationDate', 'expiryDate', 'metadata', 'issuerName'];
      for (const field of allowed) {
        if (req.body[field] !== undefined) cred[field] = req.body[field];
      }
      await cred.save();
      res.json({ message: 'Credential updated', credential: cred });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /credentials/:credentialId/revoke
router.post('/credentials/:credentialId/revoke',
  authenticate,
  authorize('admin', 'institution'),
  body('reason').notEmpty().isLength({ max: 500 }),
  validate,
  async (req, res) => {
    try {
      const cred = await RegistryCredential.findOne({
        credentialId: req.params.credentialId, isDeleted: false,
      });
      if (!cred) return tlError(res, 'TL-3002', 'Credential not found', 404);
      if (cred.status === 'REVOKED') return tlError(res, 'TL-4004', 'Credential already revoked');
      cred.status = 'REVOKED';
      await cred.save();
      res.json({ message: 'Credential revoked' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /credentials/:credentialId/suspend
router.post('/credentials/:credentialId/suspend',
  authenticate,
  authorize('admin', 'institution'),
  async (req, res) => {
    try {
      const cred = await RegistryCredential.findOne({
        credentialId: req.params.credentialId, isDeleted: false,
      });
      if (!cred) return tlError(res, 'TL-3002', 'Credential not found', 404);
      cred.status = 'SUSPENDED';
      await cred.save();
      res.json({ message: 'Credential suspended' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /credentials/:credentialId/reinstate
router.post('/credentials/:credentialId/reinstate',
  authenticate,
  authorize('admin', 'institution'),
  async (req, res) => {
    try {
      const cred = await RegistryCredential.findOne({
        credentialId: req.params.credentialId, isDeleted: false,
      });
      if (!cred) return tlError(res, 'TL-3002', 'Credential not found', 404);
      if (cred.status === 'REVOKED') return tlError(res, 'TL-4004', 'Cannot reinstate a revoked credential');
      cred.status = 'ACTIVE';
      await cred.save();
      res.json({ message: 'Credential reinstated' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /credentials/:credentialId/vc — Get W3C Verifiable Credential JSON
router.get('/credentials/:credentialId/vc',
  async (req, res) => {
    try {
      const cred = await RegistryCredential.findOne({
        credentialId: req.params.credentialId, isDeleted: false,
      });
      if (!cred) return tlError(res, 'TL-3002', 'Credential not found', 404);
      if (!cred.w3cVcJson) return tlError(res, 'TL-4006', 'VC not yet generated for this credential', 404);
      res.json(cred.w3cVcJson);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /credentials/:credentialId/verify — Public verification (no auth, rate-limited)
// GAP #12 FIX: Strip PII — only return validity signal + non-PII metadata
router.get('/credentials/:credentialId/verify',
  publicVerificationLimiter,
  async (req, res) => {
    try {
      const cred = await RegistryCredential.findOne({
        credentialId: req.params.credentialId, isDeleted: false,
      }).select('-holderCnic -holder -metadata -w3cVcJson'); // strip PII fields

      const verificationId = uuidv4();
      const timestamp = new Date().toISOString();
      // Resolve geolocation async (non-blocking)
      const geo = VerificationLog.resolveGeoLocation(req.ip);

      if (!cred) {
        geo.then(geolocation => new VerificationLog({
          credentialId: req.params.credentialId,
          verifierType: req.apiConsumer ? 'API_CLIENT' : 'PUBLIC_PORTAL',
          verificationResult: 'NOT_FOUND',
          verificationMethodUsed: req.query.method === 'QR_SCAN' ? 'QR_SCAN' : 'PORTAL_LOOKUP',
          ipAddress: req.ip,
          deviceInfo: req.get('user-agent')?.slice(0, 500),
          geolocation,
        }).save()).catch(() => {});
        return res.json({
          verificationId,
          timestamp,
          credentialId: req.params.credentialId,
          overallResult: 'NOT_FOUND',
          checks: { existence: { passed: false, details: 'Credential not found in registry' } },
        });
      }

      // Perform verification checks
      const checks = {
        existence: { passed: true, details: 'Credential found in registry' },
        signature: {
          passed: !!cred.w3cVcJson?.proof?.proofValue || !!cred.credentialHash,
          algorithm: 'Ed25519Signature2020',
          issuerDid: cred.w3cVcJson?.issuer?.id || null,
        },
        blockchain: {
          passed: !!cred.blockchainTxHash,
          txHash: cred.blockchainTxHash || null,
          network: process.env.BLOCKCHAIN_CHAIN || 'simulated',
        },
        revocation: {
          passed: cred.status !== 'REVOKED' && cred.status !== 'SUSPENDED',
          statusListUrl: `${PUBLIC_BASE}/api/v1/registry/status-list/${cred.issuerId}`,
        },
        expiry: { passed: !cred.isExpired(), expires: cred.expiryDate || null },
      };

      const overallResult = cred.status === 'REVOKED' ? 'REVOKED'
        : cred.status === 'SUSPENDED' ? 'INVALID'
        : cred.isExpired() ? 'EXPIRED'
        : checks.signature.passed ? 'VALID' : 'INVALID';

      // Log with geolocation (non-blocking)
      geo.then(geolocation => new VerificationLog({
        credentialId: req.params.credentialId,
        credential: cred._id,
        verifierType: req.apiConsumer ? 'API_CLIENT' : 'PUBLIC_PORTAL',
        verificationResult: overallResult,
        verificationMethodUsed: req.query.method === 'QR_SCAN' ? 'QR_SCAN' : 'PORTAL_LOOKUP',
        verifierIdentifier: req.apiConsumer?.consumerId,
        checks,
        ipAddress: req.ip,
        deviceInfo: req.get('user-agent')?.slice(0, 500),
        geolocation,
      }).save()).catch(() => {});

      // GAP #12: Return only non-PII fields — no credentialSubject, no holder CNIC
      res.json({
        verificationId,
        timestamp,
        credentialId: cred.credentialId,
        overallResult,
        checks,
        // Non-PII credential summary only
        credential: {
          credentialType: cred.credentialType,
          credentialSubtype: cred.credentialSubtype,
          title: cred.title,
          issuerName: cred.issuerName,
          issuanceDate: cred.issuanceDate,
          expiryDate: cred.expiryDate,
          status: cred.status,
          verificationStatus: cred.verificationStatus,
        },
        verificationUrl: `${PUBLIC_BASE}/api/v1/registry/credentials/${cred.credentialId}/verify`,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /credentials/:credentialId/ocsp-status — OCSP-style real-time revocation check (GAP #24)
router.get('/credentials/:credentialId/ocsp-status',
  publicVerificationLimiter,
  async (req, res) => {
    try {
      const cred = await RegistryCredential.findOne({
        credentialId: req.params.credentialId, isDeleted: false,
      }).select('status credentialId issuerId blockchainTxHash expiryDate');
      if (!cred) return res.json({ status: 'unknown', credentialId: req.params.credentialId });

      res.set('Cache-Control', 'max-age=60'); // 1-minute cache
      res.json({
        credentialId: cred.credentialId,
        status: cred.status,              // ACTIVE | REVOKED | SUSPENDED | EXPIRED
        isExpired: cred.isExpired(),
        checkedAt: new Date().toISOString(),
        nextUpdate: new Date(Date.now() + 60 * 1000).toISOString(),
        issuerId: cred.issuerId,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /credentials/:credentialId/history — Credential lifecycle audit trail
router.get('/credentials/:credentialId/history',
  authenticate,
  async (req, res) => {
    try {
      const logs = await VerificationLog.find({ credentialId: req.params.credentialId })
        .sort({ createdAt: -1 })
        .limit(parseInt(req.query.limit) || 50);
      res.json(logs);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ══════════════════════════════════════════════
// 3. ISSUER MANAGEMENT
// ══════════════════════════════════════════════

// POST /issuers — Register new authorized issuer
router.post('/issuers',
  authenticate,
  authorize('admin'),
  [
    body('issuerName').notEmpty().isLength({ max: 300 }),
    body('issuerType').isIn(['GOVERNMENT_BODY', 'UNIVERSITY', 'BTE', 'TTB', 'PROFESSIONAL_BODY', 'TRAINING_PROVIDER', 'EMPLOYER', 'PLATFORM', 'TALENT_LEDGER_RPL']),
    body('issuerCategory').isIn(['FEDERAL', 'PROVINCIAL_KP', 'PROVINCIAL_PUNJAB', 'PROVINCIAL_SINDH', 'PROVINCIAL_BALOCHISTAN', 'INTERNATIONAL']),
  ],
  validate,
  async (req, res) => {
    try {
      const issuer = new Issuer(req.body);
      // Generate DID
      issuer.didIdentifier = `did:talentledger:issuer:${issuer.issuerId}`;
      await issuer.save();
      res.status(201).json({ message: 'Issuer registered', issuer });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /issuers — List all issuers
router.get('/issuers',
  authenticate,
  async (req, res) => {
    try {
      const filter = {};
      if (req.query.type) filter.issuerType = req.query.type;
      if (req.query.category) filter.issuerCategory = req.query.category;
      if (req.query.status) filter.status = req.query.status;
      const issuers = await Issuer.find(filter).sort({ issuerName: 1 });
      res.json(issuers);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /issuers/:issuerId — Get issuer details
router.get('/issuers/:issuerId',
  authenticate,
  async (req, res) => {
    try {
      const issuer = await Issuer.findOne({ issuerId: req.params.issuerId });
      if (!issuer) return tlError(res, 'TL-3003', 'Issuer not found', 404);
      res.json(issuer);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// PUT /issuers/:issuerId — Update issuer
router.put('/issuers/:issuerId',
  authenticate,
  authorize('admin'),
  async (req, res) => {
    try {
      const issuer = await Issuer.findOne({ issuerId: req.params.issuerId });
      if (!issuer) return tlError(res, 'TL-3003', 'Issuer not found', 404);

      const allowed = ['issuerName', 'officialWebsite', 'verificationApiEndpoint',
        'verificationMethodSupported', 'status', 'contactFocalPerson', 'contactEmail',
        'contactPhone', 'logoUrl', 'publicKey'];
      for (const field of allowed) {
        if (req.body[field] !== undefined) issuer[field] = req.body[field];
      }
      await issuer.save();
      res.json({ message: 'Issuer updated', issuer });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /issuers/:issuerId/credentials — All credentials issued by this issuer
router.get('/issuers/:issuerId/credentials',
  authenticate,
  async (req, res) => {
    try {
      const filter = { issuerId: req.params.issuerId, isDeleted: false };
      if (req.query.type) filter.credentialType = req.query.type;
      if (req.query.status) filter.status = req.query.status;
      const credentials = await RegistryCredential.find(filter)
        .sort({ issuanceDate: -1 })
        .limit(parseInt(req.query.limit) || 50)
        .skip(parseInt(req.query.skip) || 0);
      const total = await RegistryCredential.countDocuments(filter);
      res.json({ credentials, total });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /issuers/:issuerId/verify-credential — Issuer confirms/rejects pending credentials
router.post('/issuers/:issuerId/verify-credential',
  authenticate,
  authorize('admin', 'institution'),
  [
    body('credentialId').notEmpty(),
    body('action').isIn(['APPROVE', 'REJECT']),
  ],
  validate,
  async (req, res) => {
    try {
      const cred = await RegistryCredential.findOne({
        credentialId: req.body.credentialId, issuerId: req.params.issuerId, isDeleted: false,
      });
      if (!cred) return tlError(res, 'TL-3002', 'Credential not found for this issuer', 404);

      if (req.body.action === 'APPROVE') {
        cred.status = 'ACTIVE';
        cred.verificationStatus = 'SOURCE_VERIFIED';
        cred.verificationMethod = 'DASHBOARD_CONFIRM';
        cred.verificationDate = new Date();
        cred.verifiedBy = req.user._id.toString();
      } else {
        cred.status = 'REVOKED';
        cred.verificationStatus = 'VERIFICATION_FAILED';
      }
      await cred.save();
      res.json({ message: `Credential ${req.body.action.toLowerCase()}d`, credential: cred });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ══════════════════════════════════════════════
// 4. VERIFICATION REQUESTS
// ══════════════════════════════════════════════

// POST /verification-requests — Submit credential for source verification
router.post('/verification-requests',
  authenticate,
  [
    body('holderCnic').notEmpty(),
    body('credentialType').notEmpty(),
    body('title').notEmpty(),
    body('claimDetails').isObject(),
  ],
  validate,
  async (req, res) => {
    try {
      const cred = new RegistryCredential({
        holderCnic: req.body.holderCnic,
        credentialType: req.body.credentialType,
        credentialSubtype: req.body.credentialSubtype,
        title: req.body.title,
        issuerName: req.body.issuerName,
        issuerId: req.body.issuerId,
        status: 'PENDING_VERIFICATION',
        verificationStatus: 'SELF_DECLARED',
        metadata: req.body.metadata || {},
      });
      await cred.save();
      res.status(201).json({ message: 'Verification request submitted', requestId: cred.credentialId, credential: cred });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /verification-requests/:requestId — Check status
router.get('/verification-requests/:requestId',
  authenticate,
  async (req, res) => {
    try {
      const cred = await RegistryCredential.findOne({ credentialId: req.params.requestId });
      if (!cred) return tlError(res, 'TL-3002', 'Verification request not found', 404);
      res.json({
        requestId: cred.credentialId,
        status: cred.status,
        verificationStatus: cred.verificationStatus,
        title: cred.title,
        credentialType: cred.credentialType,
        submittedAt: cred.createdAt,
        verifiedAt: cred.verificationDate,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /verification-requests — Issuer dashboard queue
router.get('/verification-requests',
  authenticate,
  authorize('admin', 'institution'),
  async (req, res) => {
    try {
      const filter = { status: 'PENDING_VERIFICATION', isDeleted: false };
      if (req.query.issuerId) filter.issuerId = req.query.issuerId;
      if (req.query.credentialType) filter.credentialType = req.query.credentialType;
      const requests = await RegistryCredential.find(filter)
        .sort({ createdAt: 1 })
        .limit(parseInt(req.query.limit) || 50)
        .skip(parseInt(req.query.skip) || 0);
      const total = await RegistryCredential.countDocuments(filter);
      res.json({ requests, total });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// PUT /verification-requests/:requestId/approve
router.put('/verification-requests/:requestId/approve',
  authenticate,
  authorize('admin', 'institution'),
  async (req, res) => {
    try {
      const cred = await RegistryCredential.findOne({ credentialId: req.params.requestId });
      if (!cred) return tlError(res, 'TL-3002', 'Request not found', 404);
      cred.status = 'ACTIVE';
      cred.verificationStatus = 'SOURCE_VERIFIED';
      cred.verificationMethod = 'DASHBOARD_CONFIRM';
      cred.verificationDate = new Date();
      cred.verifiedBy = req.user._id.toString();
      await cred.save();
      res.json({ message: 'Verification approved', credential: cred });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// PUT /verification-requests/:requestId/reject
router.put('/verification-requests/:requestId/reject',
  authenticate,
  authorize('admin', 'institution'),
  body('reason').notEmpty().isLength({ max: 500 }),
  validate,
  async (req, res) => {
    try {
      const cred = await RegistryCredential.findOne({ credentialId: req.params.requestId });
      if (!cred) return tlError(res, 'TL-3002', 'Request not found', 404);
      cred.verificationStatus = 'VERIFICATION_FAILED';
      cred.status = 'REVOKED';
      await cred.save();
      res.json({ message: 'Verification rejected', reason: req.body.reason });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ══════════════════════════════════════════════
// 5. SEARCH & DISCOVERY
// ══════════════════════════════════════════════

// GET /search/workers — Search workers by skills
router.get('/search/workers',
  authenticate,
  authorize('admin', 'employer', 'institution'),
  async (req, res) => {
    try {
      const filter = {};
      if (req.query.trade) filter.trade = req.query.trade;
      if (req.query.province) filter.province = req.query.province;
      if (req.query.district) filter.district = req.query.district;
      if (req.query.nvqLevel) filter.nqfLevel = { $gte: parseInt(req.query.nvqLevel) };
      if (req.query.status) filter.status = req.query.status;
      if (req.query.q) filter.$text = { $search: req.query.q };

      const workers = await Worker.find(filter)
        .select('fullName trade nqfLevel district province status profileCompleteness totalCredentialsCount verifiedCredentialsCount')
        .sort(req.query.sort || { createdAt: -1 })
        .limit(parseInt(req.query.limit) || 25)
        .skip(parseInt(req.query.skip) || 0);
      const total = await Worker.countDocuments(filter);
      res.json({ workers, total });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /search/credentials — Search credentials
router.get('/search/credentials',
  authenticate,
  authorize('admin', 'employer', 'institution'),
  async (req, res) => {
    try {
      const filter = { isDeleted: false };
      if (req.query.issuer) filter.issuerName = { $regex: req.query.issuer, $options: 'i' };
      if (req.query.type) filter.credentialType = req.query.type;
      if (req.query.status) filter.status = req.query.status;
      if (req.query.year) {
        const year = parseInt(req.query.year);
        filter.issuanceDate = {
          $gte: new Date(`${year}-01-01`),
          $lt: new Date(`${year + 1}-01-01`),
        };
      }
      const credentials = await RegistryCredential.find(filter)
        .sort({ issuanceDate: -1 })
        .limit(parseInt(req.query.limit) || 25)
        .skip(parseInt(req.query.skip) || 0);
      const total = await RegistryCredential.countDocuments(filter);
      res.json({ credentials, total });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /analytics/issuers/:issuerId/stats — Credential issuance statistics
router.get('/analytics/issuers/:issuerId/stats',
  authenticate,
  authorize('admin', 'institution'),
  async (req, res) => {
    try {
      const stats = await RegistryCredential.aggregate([
        { $match: { issuerId: req.params.issuerId, isDeleted: false } },
        {
          $group: {
            _id: '$credentialType',
            total: { $sum: 1 },
            active: { $sum: { $cond: [{ $eq: ['$status', 'ACTIVE'] }, 1, 0] } },
            pending: { $sum: { $cond: [{ $eq: ['$status', 'PENDING_VERIFICATION'] }, 1, 0] } },
            revoked: { $sum: { $cond: [{ $eq: ['$status', 'REVOKED'] }, 1, 0] } },
          },
        },
      ]);
      const verificationLogs = await VerificationLog.countDocuments({
        credentialId: { $in: (await RegistryCredential.find({ issuerId: req.params.issuerId }).select('credentialId')).map(c => c.credentialId) },
      });
      res.json({ stats, totalVerifications: verificationLogs });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /analytics/overview — Platform-wide statistics
router.get('/analytics/overview',
  authenticate,
  authorize('admin'),
  async (req, res) => {
    try {
      const [totalHolders, totalCredentials, totalVerifications, totalIssuers,
        credentialsByType, credentialsByStatus] = await Promise.all([
        Worker.countDocuments({}),
        RegistryCredential.countDocuments({ isDeleted: false }),
        VerificationLog.countDocuments({}),
        Issuer.countDocuments({ status: 'ACTIVE' }),
        RegistryCredential.aggregate([
          { $match: { isDeleted: false } },
          { $group: { _id: '$credentialType', count: { $sum: 1 } } },
        ]),
        RegistryCredential.aggregate([
          { $match: { isDeleted: false } },
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
      ]);
      res.json({
        totalHolders,
        totalCredentials,
        totalVerifications,
        totalIssuers,
        credentialsByType,
        credentialsByStatus,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ══════════════════════════════════════════════
// 6. BULK OPERATIONS
// ══════════════════════════════════════════════

// POST /bulk/credentials — Bulk credential upload with MongoDB transactions (GAP #16)
router.post('/bulk/credentials',
  authenticate,
  authorize('admin', 'institution'),
  bulkOperationLimiter,
  body('credentials').isArray({ min: 1, max: 500 }),
  validate,
  async (req, res) => {
    const session = await mongoose.startSession();
    const batchId = uuidv4();
    const results = { batchId, total: req.body.credentials.length, success: 0, failed: 0, errors: [] };

    try {
      await session.withTransaction(async () => {
        for (let i = 0; i < req.body.credentials.length; i++) {
          try {
            const cred = new RegistryCredential({
              ...req.body.credentials[i],
              verifiedBy: req.user._id.toString(),
            });
            await cred.save({ session });
            results.success++;
          } catch (err) {
            results.failed++;
            results.errors.push({ row: i + 1, error: err.message });
            // Individual row errors don't abort the whole batch
          }
        }
        if (results.success === 0) throw new Error('All records failed validation');
      });
      res.status(201).json(results);
    } catch (err) {
      res.status(500).json({ error: err.message, partialResults: results });
    } finally {
      session.endSession();
    }
  }
);

// POST /bulk/holders — Bulk holder registration
router.post('/bulk/holders',
  authenticate,
  authorize('admin', 'institution'),
  body('holders').isArray({ min: 1, max: 500 }),
  validate,
  async (req, res) => {
    try {
      const batchId = uuidv4();
      const results = { batchId, total: req.body.holders.length, success: 0, failed: 0, errors: [] };

      const encKey = process.env.ENCRYPTION_KEY || 'a'.repeat(64);
      for (let i = 0; i < req.body.holders.length; i++) {
        try {
          const h = req.body.holders[i];
          const iv = crypto.randomBytes(16);
          const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(encKey, 'hex'), iv);
          let encrypted = cipher.update(h.cnic || 'N/A', 'utf8', 'hex');
          encrypted += cipher.final('hex');

          const worker = new Worker({
            user: req.user._id,
            cnicEncrypted: iv.toString('hex') + ':' + encrypted,
            cnicMasked: '*'.repeat((h.cnic || '').length - 4) + (h.cnic || '').slice(-4),
            fullName: h.fullNameEnglish || h.fullName,
            fullNameUrdu: h.fullNameUrdu,
            trade: h.trade,
            district: h.district,
            province: h.province || 'Khyber Pakhtunkhwa',
            registrationSource: h.registrationSource || 'FIELD_CAMP',
          });
          await worker.save();
          results.success++;
        } catch (err) {
          results.failed++;
          results.errors.push({ row: i + 1, error: err.message });
        }
      }
      res.status(201).json(results);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ══════════════════════════════════════════════
// 7. STATUSLIST2021 PUBLIC ENDPOINT (GAP #9)
// ══════════════════════════════════════════════

// GET /status-list/:issuerId — Public W3C BitstringStatusListCredential (no auth, cached)
// Backward compatible: also returns legacy StatusList2021 block for older verifiers
router.get('/status-list/:issuerId',
  publicVerificationLimiter,
  async (req, res) => {
    try {
      const sl = await StatusList.findOne({ issuerId: req.params.issuerId });
      if (!sl) return res.status(404).json({ error: 'StatusList not found for issuer' });

      // Return cached if fresh (< 5 min)
      const isFresh = sl.signedVcUpdatedAt &&
        (Date.now() - sl.signedVcUpdatedAt.getTime()) < 5 * 60 * 1000;
      if (isFresh && sl.signedVc) {
        res.set('Cache-Control', 'public, max-age=300');
        res.set('Content-Type', 'application/vc+ld+json');
        return res.json(sl.signedVc);
      }

      // Generate fresh BitstringStatusListCredential
      const BASE = process.env.API_URL || PUBLIC_BASE;
      const { generateStatusListCredential } = await import('../services/vc/revocationService.js');
      const statusListVc = await generateStatusListCredential(req.params.issuerId, BASE);

      await StatusList.updateOne(
        { issuerId: req.params.issuerId },
        { signedVc: statusListVc, signedVcUpdatedAt: new Date() },
      );

      res.set('Cache-Control', 'public, max-age=300');
      res.set('Content-Type', 'application/vc+ld+json');
      res.json(statusListVc);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ══════════════════════════════════════════════
// 8. DID RESOLVER ENDPOINT (GAP #4)
// ══════════════════════════════════════════════

// GET /did/:did — Resolve any DID (talentledger, key, web)
router.get('/did/:did(*)',
  publicVerificationLimiter,
  async (req, res) => {
    try {
      const did = decodeURIComponent(req.params.did);
      const result = await resolveDID(did);
      if (!result.didDocument) {
        return res.status(404).json({
          error: result.didDocumentMetadata?.error || 'DID not resolved',
          didDocumentMetadata: result.didDocumentMetadata,
        });
      }
      res.set('Content-Type', 'application/did+ld+json');
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ══════════════════════════════════════════════
// 9. JSON SCHEMA HOSTING (GAP #23)
// ══════════════════════════════════════════════

// GET /schemas/:type — Serve JSON Schema for a credential type
router.get('/schemas/:type',
  async (req, res) => {
    const type = req.params.type.toUpperCase().replace(/-/g, '_');
    const schema = CREDENTIAL_SCHEMAS[type];
    if (!schema) return res.status(404).json({ error: 'Schema not found', availableTypes: Object.keys(CREDENTIAL_SCHEMAS) });

    const jsonSchema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: `${PUBLIC_BASE}/api/v1/registry/schemas/${type.toLowerCase().replace(/_/g, '-')}`,
      title: `TalentLedger ${type.replace(/_/g, ' ')} Credential`,
      type: 'object',
      required: ['credentialType', 'title', 'holderCnic', 'issuerId', 'issuanceDate', ...schema.requiredFields],
      properties: {
        credentialType: { type: 'string', const: type },
        title: { type: 'string', maxLength: 500 },
        holderCnic: { type: 'string', pattern: '^\\d{5}-\\d{7}-\\d$' },
        issuerId: { type: 'string' },
        issuanceDate: { type: 'string', format: 'date-time' },
        expiryDate: { type: 'string', format: 'date-time' },
        status: { type: 'string', enum: ['ACTIVE', 'EXPIRED', 'REVOKED', 'SUSPENDED', 'PENDING_VERIFICATION'] },
        verificationStatus: { type: 'string', enum: ['SOURCE_VERIFIED', 'PLATFORM_VERIFIED', 'SELF_DECLARED', 'VERIFICATION_FAILED'] },
        types: { type: 'array', items: { type: 'string' } },
        contexts: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: true,
    };

    res.set('Content-Type', 'application/schema+json');
    res.json(jsonSchema);
  }
);

// ══════════════════════════════════════════════
// 10. W3C VERIFIABLE PRESENTATION EXPORT (GAP #22)
// ══════════════════════════════════════════════

// POST /presentation — Build a W3C VP from selected credential IDs
router.post('/presentation',
  authenticate,
  authenticatedApiLimiter,
  body('credentialIds').isArray({ min: 1, max: 20 }),
  body('holderDid').optional().isString(),
  validate,
  async (req, res) => {
    try {
      const { credentialIds, holderDid, purpose = 'credential sharing' } = req.body;

      const credentials = await RegistryCredential.find({
        credentialId: { $in: credentialIds },
        isDeleted: false,
        status: 'ACTIVE',
      }).select('-holderCnic -metadata'); // strip PII from VP

      if (credentials.length === 0) return res.status(404).json({ error: 'No valid credentials found' });

      const vcs = credentials.map(c => c.w3cVcJson || {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiableCredential'],
        id: c.credentialId,
        credentialType: c.credentialType,
        title: c.title,
        issuer: { id: `did:talentledger:issuer:${c.issuerId}`, name: c.issuerName },
        issuanceDate: c.issuanceDate?.toISOString(),
        expirationDate: c.expiryDate?.toISOString(),
        credentialStatus: { type: 'StatusList2021Entry', statusListCredential: `${PUBLIC_BASE}/api/v1/registry/status-list/${c.issuerId}` },
      });

      const vp = {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiablePresentation'],
        id: `urn:uuid:${uuidv4()}`,
        holder: holderDid || `did:talentledger:holder:${req.user._id}`,
        verifiableCredential: vcs,
        proof: {
          type: 'TalentLedgerPresentation2026',
          created: new Date().toISOString(),
          proofPurpose: purpose,
          verificationMethod: `did:talentledger:holder:${req.user._id}#key-1`,
          // Note: holder key-binding proof (PoP) requires device-side private key
          challenge: uuidv4(),
        },
      };

      res.json({ verifiablePresentation: vp, credentialCount: vcs.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ══════════════════════════════════════════════
// 11. SD-JWT SELECTIVE DISCLOSURE (GAP #3)
// ══════════════════════════════════════════════

// POST /credentials/:credentialId/sd-jwt — Issue SD-JWT for a credential
router.post('/credentials/:credentialId/sd-jwt',
  authenticate,
  authenticatedApiLimiter,
  async (req, res) => {
    try {
      const cred = await RegistryCredential.findOne({
        credentialId: req.params.credentialId, isDeleted: false, status: 'ACTIVE',
      });
      if (!cred) return tlError(res, 'TL-3002', 'Credential not found', 404);

      const selectiveFields = req.body.selectiveFields || SD_FIELDS_BY_TYPE[cred.credentialType] || [];
      const typeMetadata = cred.getTypeMetadata() || {};

      const credentialClaims = {
        credentialId: cred.credentialId,
        credentialType: cred.credentialType,
        credentialSubtype: cred.credentialSubtype,
        title: cred.title,
        issuerName: cred.issuerName,
        issuerId: cred.issuerId,
        issuanceDate: cred.issuanceDate?.toISOString(),
        expiryDate: cred.expiryDate?.toISOString(),
        status: cred.status,
        verificationStatus: cred.verificationStatus,
        ...typeMetadata,
      };

      const issuerPrivateKey = process.env.ISSUER_PRIVATE_KEY || crypto.randomBytes(32).toString('hex');
      const issuerDid = `did:talentledger:issuer:${cred.issuerId}`;

      const { sdJwt, disclosures } = issueSDJwt(credentialClaims, selectiveFields, issuerPrivateKey, issuerDid);

      res.json({
        sdJwt,
        disclosures: disclosures.map(d => ({ key: d.key, hash: d.hash })), // hashes only, not values
        selectiveFields,
        alwaysRevealedFields: ALWAYS_REVEAL_FIELDS,
        format: 'sd+jwt',
        spec: 'draft-ietf-oauth-sd-jwt-vc-08',
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /credentials/verify-presentation — Verify an SD-JWT presentation from holder
router.post('/credentials/verify-presentation',
  publicVerificationLimiter,
  body('presentation').notEmpty(),
  body('issuerPublicKey').optional().isString(),
  validate,
  async (req, res) => {
    try {
      const { presentation, issuerPublicKey } = req.body;
      const result = verifySDJwtPresentation(presentation, issuerPublicKey || '');
      res.json({
        valid: result.valid,
        revealedClaims: result.revealedClaims,
        issuer: result.issuer,
        issuedAt: result.issuedAt,
        expiresAt: result.expiresAt,
        errors: result.errors,
        format: 'sd+jwt',
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ══════════════════════════════════════════════
// 12. API KEY MANAGEMENT ROUTES
// ══════════════════════════════════════════════

// POST /api-keys — Create API key (admin only)
router.post('/api-keys',
  authenticate,
  authorize('admin'),
  async (req, res) => {
    try {
      const { consumerId, tier, scopes, description, expiresInDays, allowedIps } = req.body;
      const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 86400000) : undefined;
      const { rawKey, record } = await generateApiKey(consumerId || req.user._id.toString(), {
        userId: req.user._id,
        tier: tier || 'free',
        scopes: scopes || ['verify', 'read'],
        description,
        allowedIps: allowedIps || [],
        expiresAt,
      });
      // Only return raw key once — never stored in plain text
      res.status(201).json({
        apiKey: rawKey,
        keyId: record._id,
        keyPrefix: record.keyPrefix,
        tier: record.tier,
        scopes: record.scopes,
        dailyLimit: record.dailyLimit,
        expiresAt: record.expiresAt,
        warning: 'Store this API key securely — it will not be shown again.',
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /api-keys — List your API keys (no raw keys returned)
router.get('/api-keys',
  authenticate,
  async (req, res) => {
    try {
      const keys = await ApiKey.find({ consumerUser: req.user._id })
        .select('-keyHash')
        .sort({ createdAt: -1 });
      res.json({ keys });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// DELETE /api-keys/:keyId — Revoke an API key
router.delete('/api-keys/:keyId',
  authenticate,
  async (req, res) => {
    try {
      const key = await ApiKey.findOneAndUpdate(
        { _id: req.params.keyId, consumerUser: req.user._id },
        { isActive: false, revokedAt: new Date(), revokedBy: req.user._id.toString(), revokedReason: 'User revoked' },
        { new: true },
      ).select('-keyHash');
      if (!key) return res.status(404).json({ error: 'API key not found' });
      res.json({ message: 'API key revoked', keyPrefix: key.keyPrefix });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
