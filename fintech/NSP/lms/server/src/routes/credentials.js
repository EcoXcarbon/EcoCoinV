import { Router } from 'express';
import { body, param, query } from 'express-validator';
import crypto from 'crypto';
import Credential from '../models/Credential.js';
import RegistryCredential from '../models/RegistryCredential.js';
import Worker from '../models/Worker.js';
import Counter from '../models/Counter.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { handleValidation } from '../middleware/validate.js';
import { auditLog } from '../middleware/audit.js';
import { generateVC, generateVCJsonLd, ISCO_MAP, ISCED_MAP, NQF_TO_EQF } from '../services/credentialService.js';
import { generateCertificatePDF, generateCardPDF } from '../services/pdfService.js';
import { generateQR } from '../services/qrService.js';
import env from '../config/env.js';

const router = Router();

const VALID_TYPES = ['trade-certificate', 'micro-credential', 'rpl-certificate', 'safety-card', 'gulf-readiness'];
const VALID_STATUSES = ['active', 'revoked', 'expired', 'suspended'];
const VALID_TRADES = [
  'mason', 'electrician', 'welder', 'plumber', 'carpenter', 'steel-fixer', 'painter', 'hvac',
  'pipe-fitter', 'scaffolder', 'rigger', 'crane-operator', 'heavy-driver', 'shuttering-carpenter',
  'tile-fixer', 'duct-fabricator', 'auto-mechanic', 'diesel-mechanic', 'fabricator',
  'insulation-worker', 'heavy-equipment-operator', 'aluminium-fabricator', 'safety-officer',
  'cook', 'ac-technician',
];

// List credentials
router.get('/', authenticate, [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('status').optional().isIn(VALID_STATUSES),
  query('type').optional().isIn(VALID_TYPES),
  query('worker').optional().isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, type, worker } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (type) filter.type = type;
    if (worker) filter.worker = worker;

    // Workers can only see their own credentials
    if (req.user.role === 'worker') {
      const ownWorker = await Worker.findOne({ user: req.user._id }).select('_id');
      // Guard: a worker with no profile must see nothing, not everything.
      // (filter.worker = undefined would be stripped by Mongoose → returns all.)
      filter.worker = ownWorker ? ownWorker._id : null;
    }

    const total = await Credential.countDocuments(filter);
    const credentials = await Credential.find(filter)
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .populate('worker', 'fullName trade registrationId cnicMasked district')
      .populate('issuedBy', 'name');

    res.json({
      credentials,
      pagination: { total, page: Number(page), pages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
});

// Issue credential
router.post('/', authenticate, authorize('admin', 'assessor', 'institution'), [
  body('workerId').isMongoId().withMessage('Valid worker ID required'),
  body('type').isIn(VALID_TYPES).withMessage('Invalid credential type'),
  body('title').trim().notEmpty().withMessage('Title is required').isLength({ max: 300 }),
  body('trade').isIn(VALID_TRADES).withMessage('Invalid trade'),
  body('nqfLevel').isInt({ min: 1, max: 8 }).withMessage('NQF level must be 1-8').toInt(),
  body('institution').optional().trim().isLength({ max: 300 }),
  body('validUntil').optional().isISO8601().withMessage('Valid ISO date required'),
  handleValidation,
], auditLog('CREDENTIAL_ISSUE'), async (req, res, next) => {
  try {
    const { workerId, type, title, trade, nqfLevel, institution, validUntil } = req.body;
    const worker = await Worker.findById(workerId);
    if (!worker) return res.status(404).json({ error: 'Worker not found' });

    const seq = await Counter.getNextSequence('credential');
    const credentialId = `TL-${new Date().getFullYear()}-${String(seq).padStart(5, '0')}`;

    const vc = generateVC({ credentialId, worker, type, title, trade, nqfLevel, institution });

    const iscoCode = ISCO_MAP[trade];
    const iscedCode = ISCED_MAP[trade];
    const eqfLevel = NQF_TO_EQF[nqfLevel];

    const verifyUrl = `${env.CLIENT_URL}/verify/${credentialId}`;
    const qrData = await generateQR(verifyUrl);

    const credential = await Credential.create({
      credentialId, worker: workerId, issuedBy: req.user._id,
      type, title, trade, nqfLevel, institution,
      iscoCode, iscedCode, eqfLevel,
      vc, qrData, validFrom: new Date(),
      validUntil: validUntil || new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000),
    });

    if (worker.status === 'assessed') {
      worker.status = 'certified';
      await worker.save();
    }

    // Mirror to unified RegistryCredential (async, non-blocking — does not fail the response)
    const LEGACY_TYPE_MAP = {
      'trade-certificate': 'TVET',
      'rpl-certificate': 'RPL',
      'micro-credential': 'MICRO_CREDENTIAL',
      'safety-card': 'TRAINING_RECORD',
      'gulf-readiness': 'MIGRATION_RECORD',
    };
    const registryType = LEGACY_TYPE_MAP[type] || 'TVET';
    RegistryCredential.create({
      credentialId: credentialId,
      holderCnic: worker.cnicMasked || 'UNKNOWN',
      holder: worker._id,
      credentialType: registryType,
      title,
      issuerId: req.user._id.toString(),
      issuerName: req.user.organization || req.user.name || 'TalentLedger',
      issuanceDate: credential.validFrom,
      expiryDate: credential.validUntil,
      status: 'ACTIVE',
      verificationStatus: 'PLATFORM_VERIFIED',
      verificationMethod: 'DASHBOARD_CONFIRM',
      verificationDate: new Date(),
      verifiedBy: req.user._id.toString(),
      w3cVcJson: credential.vc || null,
      legacyCredential: credential._id,
      metadata: {
        tvet: registryType === 'TVET' ? { tradeName: trade, nvqLevel: nqfLevel } : undefined,
        rpl: registryType === 'RPL' ? { assessedTrade: trade } : undefined,
      },
    }).catch(err => console.warn('[Registry mirror]', err.message));

    res.status(201).json(credential);
  } catch (err) { next(err); }
});

// Get single credential
router.get('/:id', authenticate, [
  param('id').isMongoId().withMessage('Invalid credential ID'),
  handleValidation,
], async (req, res, next) => {
  try {
    const credential = await Credential.findById(req.params.id)
      .populate('worker', 'fullName trade registrationId district cnicMasked nqfLevel')
      .populate('issuedBy', 'name organization');
    if (!credential) return res.status(404).json({ error: 'Credential not found' });

    // Ownership check: workers can only view their own credentials
    if (req.user.role === 'worker') {
      const ownWorker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!ownWorker || credential.worker._id.toString() !== ownWorker._id.toString()) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    res.json(credential);
  } catch (err) { next(err); }
});

// Get JWT-VC string (compact JWT format)
router.get('/:id/vc', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const credential = await Credential.findById(req.params.id);
    if (!credential) return res.status(404).json({ error: 'Credential not found' });
    if (!credential.vc?.jwt) {
      return res.status(404).json({ error: 'No JWT-VC available (legacy credential)' });
    }
    res.type('text/plain').send(credential.vc.jwt);
  } catch (err) { next(err); }
});

// Get decoded VC as JSON-LD
router.get('/:id/vc.json', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const credential = await Credential.findById(req.params.id)
      .populate('worker', 'fullName trade registrationId');
    if (!credential) return res.status(404).json({ error: 'Credential not found' });
    res.json(generateVCJsonLd(credential));
  } catch (err) { next(err); }
});

// Download PDF
router.get('/:id/pdf', authenticate, [
  param('id').isMongoId().withMessage('Invalid credential ID'),
  handleValidation,
], async (req, res, next) => {
  try {
    const credential = await Credential.findById(req.params.id)
      .populate('worker', 'fullName fatherName trade registrationId district cnicMasked nqfLevel photo')
      .populate('issuedBy', 'name organization');
    if (!credential) return res.status(404).json({ error: 'Credential not found' });

    // Ownership check for workers
    if (req.user.role === 'worker') {
      const ownWorker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!ownWorker || credential.worker._id.toString() !== ownWorker._id.toString()) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${credential.credentialId}.pdf`);
    await generateCertificatePDF(credential, res);
  } catch (err) { next(err); }
});

// Download PVC Card (CR80 — front + back)
router.get('/:id/card', authenticate, [
  param('id').isMongoId().withMessage('Invalid credential ID'),
  handleValidation,
], async (req, res, next) => {
  try {
    const credential = await Credential.findById(req.params.id)
      .populate('worker', 'fullName fatherName trade registrationId district cnicMasked nqfLevel photo competencies')
      .populate('issuedBy', 'name organization');
    if (!credential) return res.status(404).json({ error: 'Credential not found' });

    if (req.user.role === 'worker') {
      const ownWorker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!ownWorker || credential.worker._id.toString() !== ownWorker._id.toString()) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${credential.credentialId}-card.pdf`);
    await generateCardPDF(credential, res);
  } catch (err) { next(err); }
});

// Revoke credential
router.post('/:id/revoke', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId().withMessage('Invalid credential ID'),
  body('reason').trim().notEmpty().withMessage('Revocation reason is required').isLength({ max: 500 }),
  handleValidation,
], auditLog('CREDENTIAL_REVOKE'), async (req, res, next) => {
  try {
    const credential = await Credential.findById(req.params.id);
    if (!credential) return res.status(404).json({ error: 'Credential not found' });
    if (credential.status === 'revoked') return res.status(400).json({ error: 'Already revoked' });

    credential.status = 'revoked';
    credential.revokedAt = new Date();
    credential.revokedBy = req.user._id;
    credential.revokedReason = req.body.reason;
    await credential.save();
    res.json({ message: 'Credential revoked', credential });
  } catch (err) { next(err); }
});

// ──────────────────────────────────────────────
// Gap #18: Blockchain anchoring
// ──────────────────────────────────────────────

// Helper: generate SHA-256 hash of credential payload
function hashCredential(credential) {
  const payload = JSON.stringify({
    credentialId: credential.credentialId,
    worker: credential.worker.toString(),
    type: credential.type,
    trade: credential.trade,
    title: credential.title,
    nqfLevel: credential.nqfLevel,
    issuedBy: credential.issuedBy.toString(),
    validFrom: credential.validFrom,
    validUntil: credential.validUntil,
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

// Anchor credential on blockchain (simulated)
router.post('/:id/blockchain/anchor', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId(),
  body('chain').optional().isIn(['ethereum', 'polygon', 'simulated']),
  handleValidation,
], auditLog('BLOCKCHAIN_ANCHOR'), async (req, res, next) => {
  try {
    const credential = await Credential.findById(req.params.id);
    if (!credential) return res.status(404).json({ error: 'Credential not found' });
    if (credential.status !== 'active') return res.status(400).json({ error: 'Only active credentials can be anchored' });
    if (credential.blockchain?.anchored) return res.status(400).json({ error: 'Credential already anchored' });

    const chain = req.body.chain || 'simulated';
    const contentHash = hashCredential(credential);

    // Find previous credential for hash chain
    const previousCred = await Credential.findOne({
      'blockchain.anchored': true,
      _id: { $ne: credential._id },
    }).sort('-blockchain.anchoredAt').select('blockchain.contentHash');

    const previousHash = previousCred?.blockchain?.contentHash || '0'.repeat(64);

    // Simulated blockchain transaction
    const txHash = '0x' + crypto.randomBytes(32).toString('hex');
    const blockNumber = Math.floor(Date.now() / 1000);
    const merkleRoot = crypto.createHash('sha256')
      .update(contentHash + previousHash)
      .digest('hex');

    credential.blockchain = {
      anchored: true,
      anchoredAt: new Date(),
      txHash,
      blockNumber,
      chain,
      contentHash,
      previousHash,
      merkleRoot,
      verified: true,
      lastVerifiedAt: new Date(),
    };
    await credential.save();

    res.json({
      message: 'Credential anchored on blockchain',
      blockchain: credential.blockchain,
    });
  } catch (err) { next(err); }
});

// Verify blockchain anchor
router.get('/:id/blockchain/verify', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const credential = await Credential.findById(req.params.id);
    if (!credential) return res.status(404).json({ error: 'Credential not found' });
    if (!credential.blockchain?.anchored) {
      return res.status(400).json({ error: 'Credential not anchored on blockchain' });
    }

    // Re-compute hash and compare
    const currentHash = hashCredential(credential);
    const hashValid = currentHash === credential.blockchain.contentHash;

    // Verify merkle root
    const expectedMerkle = crypto.createHash('sha256')
      .update(credential.blockchain.contentHash + credential.blockchain.previousHash)
      .digest('hex');
    const merkleValid = expectedMerkle === credential.blockchain.merkleRoot;

    const verified = hashValid && merkleValid;

    credential.blockchain.verified = verified;
    credential.blockchain.lastVerifiedAt = new Date();
    await credential.save();

    credential.verificationCount = (credential.verificationCount || 0) + 1;
    credential.lastVerifiedAt = new Date();
    await credential.save();

    res.json({
      verified,
      hashValid,
      merkleValid,
      contentHash: currentHash,
      storedHash: credential.blockchain.contentHash,
      chain: credential.blockchain.chain,
      txHash: credential.blockchain.txHash,
      blockNumber: credential.blockchain.blockNumber,
      anchoredAt: credential.blockchain.anchoredAt,
    });
  } catch (err) { next(err); }
});

// Get blockchain status
router.get('/:id/blockchain', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const credential = await Credential.findById(req.params.id).select('credentialId blockchain verificationCount lastVerifiedAt');
    if (!credential) return res.status(404).json({ error: 'Credential not found' });
    res.json({
      credentialId: credential.credentialId,
      blockchain: credential.blockchain || { anchored: false },
      verificationCount: credential.verificationCount || 0,
      lastVerifiedAt: credential.lastVerifiedAt,
    });
  } catch (err) { next(err); }
});

// ──────────────────────────────────────────────
// Gap #19: Digital wallet / portable credentials
// ──────────────────────────────────────────────

// Generate portable JWT credential for wallet
router.post('/:id/wallet/generate', authenticate, [
  param('id').isMongoId(),
  body('expiresInDays').optional().isInt({ min: 1, max: 365 }).toInt(),
  handleValidation,
], async (req, res, next) => {
  try {
    const credential = await Credential.findById(req.params.id)
      .populate('worker', 'fullName trade registrationId')
      .populate('issuedBy', 'name organization');
    if (!credential) return res.status(404).json({ error: 'Credential not found' });
    if (credential.status !== 'active') return res.status(400).json({ error: 'Only active credentials can be added to wallet' });

    // Ownership check for workers
    if (req.user.role === 'worker') {
      const ownWorker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!ownWorker || credential.worker._id.toString() !== ownWorker._id.toString()) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const expiresInDays = req.body.expiresInDays || 90;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresInDays * 86400000);

    // Build JWT-like portable token (base64 encoded credential summary)
    const walletPayload = {
      iss: 'TalentLedger',
      sub: credential.worker?.registrationId || credential.worker.toString(),
      credentialId: credential.credentialId,
      type: credential.type,
      trade: credential.trade,
      title: credential.title,
      nqfLevel: credential.nqfLevel,
      issuedBy: credential.issuedBy?.name || credential.issuedBy.toString(),
      validFrom: credential.validFrom,
      validUntil: credential.validUntil,
      iat: Math.floor(now.getTime() / 1000),
      exp: Math.floor(expiresAt.getTime() / 1000),
    };

    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify(walletPayload)).toString('base64url');
    const signature = crypto.createHmac('sha256', env.JWT_SECRET || 'talentledger-secret')
      .update(`${header}.${payload}`)
      .digest('base64url');
    const jwtToken = `${header}.${payload}.${signature}`;

    // Generate shareable link
    const shareToken = crypto.randomBytes(16).toString('hex');
    const shareableLink = `${env.CLIENT_URL || 'https://talentledger.pk'}/verify/share/${shareToken}`;

    // Generate QR code for wallet credential
    const qrCodeUrl = await generateQR(shareableLink);

    credential.wallet = {
      jwtToken,
      jwtIssuedAt: now,
      jwtExpiresAt: expiresAt,
      qrCodeUrl,
      shareableLink,
      shareLinkExpiry: expiresAt,
      downloads: credential.wallet?.downloads || 0,
      sharedWith: credential.wallet?.sharedWith || [],
    };
    await credential.save();

    res.json({
      message: 'Wallet credential generated',
      wallet: {
        jwtToken,
        qrCodeUrl,
        shareableLink,
        expiresAt,
      },
    });
  } catch (err) { next(err); }
});

// Get wallet credential
router.get('/:id/wallet', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const credential = await Credential.findById(req.params.id).select('credentialId wallet status');
    if (!credential) return res.status(404).json({ error: 'Credential not found' });
    if (!credential.wallet?.jwtToken) {
      return res.status(404).json({ error: 'No wallet credential generated yet' });
    }

    // Check expiry
    const expired = credential.wallet.jwtExpiresAt && new Date() > credential.wallet.jwtExpiresAt;

    res.json({
      credentialId: credential.credentialId,
      wallet: credential.wallet,
      expired,
    });
  } catch (err) { next(err); }
});

// Share credential via email
router.post('/:id/wallet/share', authenticate, [
  param('id').isMongoId(),
  body('email').isEmail().withMessage('Valid email required'),
  handleValidation,
], async (req, res, next) => {
  try {
    const credential = await Credential.findById(req.params.id);
    if (!credential) return res.status(404).json({ error: 'Credential not found' });
    if (!credential.wallet?.shareableLink) {
      return res.status(400).json({ error: 'Generate wallet credential first' });
    }

    // Ownership check for workers
    if (req.user.role === 'worker') {
      const ownWorker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!ownWorker || credential.worker.toString() !== ownWorker._id.toString()) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    credential.wallet.sharedWith.push({
      email: req.body.email,
      sharedAt: new Date(),
    });
    await credential.save();

    res.json({
      message: `Credential shared with ${req.body.email}`,
      shareableLink: credential.wallet.shareableLink,
      totalShares: credential.wallet.sharedWith.length,
    });
  } catch (err) { next(err); }
});

// Download wallet credential (increments counter)
router.post('/:id/wallet/download', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const credential = await Credential.findById(req.params.id);
    if (!credential) return res.status(404).json({ error: 'Credential not found' });
    if (!credential.wallet?.jwtToken) {
      return res.status(400).json({ error: 'Generate wallet credential first' });
    }

    credential.wallet.downloads = (credential.wallet.downloads || 0) + 1;
    await credential.save();

    res.json({
      jwtToken: credential.wallet.jwtToken,
      qrCodeUrl: credential.wallet.qrCodeUrl,
      downloads: credential.wallet.downloads,
    });
  } catch (err) { next(err); }
});

// ──────────────────────────────────────────────
// Gap #25: MRA recognition on credentials
// ──────────────────────────────────────────────

// Add MRA recognition to credential
router.post('/:id/mra', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId(),
  body('country').trim().notEmpty().withMessage('Country required'),
  body('framework').trim().notEmpty().withMessage('Framework required'),
  body('level').trim().notEmpty().withMessage('Level required'),
  body('status').optional().isIn(['recognized', 'pending', 'rejected']),
  handleValidation,
], async (req, res, next) => {
  try {
    const credential = await Credential.findById(req.params.id);
    if (!credential) return res.status(404).json({ error: 'Credential not found' });

    if (!credential.mra) credential.mra = { recognizedIn: [] };
    credential.mra.recognizedIn.push({
      country: req.body.country,
      framework: req.body.framework,
      level: req.body.level,
      status: req.body.status || 'recognized',
    });
    await credential.save();

    res.json({
      message: 'MRA recognition added',
      mra: credential.mra,
    });
  } catch (err) { next(err); }
});

// Get MRA recognitions for credential
router.get('/:id/mra', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const credential = await Credential.findById(req.params.id).select('credentialId mra');
    if (!credential) return res.status(404).json({ error: 'Credential not found' });
    res.json({
      credentialId: credential.credentialId,
      mra: credential.mra || { recognizedIn: [] },
    });
  } catch (err) { next(err); }
});

export default router;
