import express from 'express';
import mongoose from 'mongoose';
import { body, param, query, validationResult } from 'express-validator';
import { authenticate } from '../middleware/auth.js';
import RegistryCredential from '../models/RegistryCredential.js';
import Credential from '../models/Credential.js';
import Portfolio from '../models/Portfolio.js';
import ShareRecord from '../models/ShareRecord.js';
import VerificationLog from '../models/VerificationLog.js';
import Worker from '../models/Worker.js';
import { syncCredentials, importOpenBadge, createSelfDeclaration } from '../services/walletSyncService.js';
import { decrypt } from '../utils/encryption.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

// ── Cross-model share helpers ────────────────────────────────────────────────
// The wallet lists BOTH registry credentials (self-submitted→verified) and
// legacy issued credentials, so sharing must resolve either. We snapshot the
// disclosed field VALUES into the ShareRecord at creation time, so the public
// view is independent of which model the credential lives in (and immune to
// later edits/deletes).
const cap = (s) => (s ? String(s).replace(/(^|\s|-)\w/g, m => m.toUpperCase()).replace(/-/g, ' ') : s);

function normalizeShareable(cred) {
  return {
    title: cred.title || cap(cred.trade) || cred.type || cred.credentialType || 'Credential',
    credentialType: cred.credentialType || cred.type,
    issuerName: cred.issuerName || cred.institution || (Array.isArray(cred.issuers) && cred.issuers[0]) || 'TalentLedger',
    status: cred.status,
    issuanceDate: cred.issuanceDate || cred.validFrom || cred.vc?.issuanceDate,
    expiryDate: cred.expiryDate || cred.validUntil || cred.vc?.expirationDate,
    nqfLevel: cred.nqfLevel,
    trade: cred.trade,
    credentialId: cred.credentialId,
    blockchainTxHash: cred.blockchainTxHash || cred.blockchain?.txHash,
  };
}

// Resolve a share target from either model. Accepts a registry credentialId, a
// legacy credentialId (TL-YYYY-NNNNN), or a legacy Mongo _id.
async function resolveShareable(idOrCredId) {
  if (!idOrCredId) return null;
  let cred = await RegistryCredential.findOne({ credentialId: idOrCredId, isDeleted: false }).lean();
  if (cred) return { credentialId: cred.credentialId, norm: normalizeShareable(cred) };
  if (mongoose.isValidObjectId(idOrCredId)) {
    cred = await Credential.findById(idOrCredId).lean();
    if (cred) return { credentialId: cred.credentialId || String(cred._id), norm: normalizeShareable(cred) };
  }
  cred = await Credential.findOne({ credentialId: idOrCredId }).lean();
  if (cred) return { credentialId: cred.credentialId, norm: normalizeShareable(cred) };
  return null;
}

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errors.array() });
  next();
};

// All wallet routes require authentication
router.use(authenticate);

// ── Auto-derive holderCnic for logged-in workers ──────────────────────────
// Workers don't need to pass holderCnic explicitly; it is resolved from their
// Worker document and stored on req.holderCnic.  Admin/institution users can
// still pass an explicit holderCnic in the body or query string to act on
// behalf of a specific holder.
router.use(async (req, res, next) => {
  if (req.user?.role === 'worker') {
    try {
      const worker = await Worker.findOne({ user: req.user._id }).select('cnicEncrypted cnicMasked');
      if (worker?.cnicEncrypted) {
        try { req.holderCnic = decrypt(worker.cnicEncrypted); }
        catch { req.holderCnic = worker.cnicMasked; }  // fallback to masked if key unavailable
      }
    } catch {
      // Non-fatal — holderCnic can still be supplied explicitly
    }
  }
  next();
});

// Helper: resolve holderCnic from middleware, body, or query (in that precedence order for workers)
function getHolderCnic(req) {
  return req.holderCnic || req.body?.holderCnic || req.query?.holderCnic || null;
}

// Ownership scope for resources addressed by their own id (portfolioId/shareId).
// Admins may act on any holder's resource; everyone else is restricted to their
// own resolved holderCnic. Returns null when the caller has no holder identity
// (→ caller should respond 403), preventing IDOR across holders.
function ownershipScope(req) {
  if (req.user?.role === 'admin') return {};
  const holderCnic = getHolderCnic(req);
  return holderCnic ? { holderCnic } : null;
}

// ══════════════════════════════════════════════
// 1. CREDENTIAL SYNC
// ══════════════════════════════════════════════

// POST /sync — Differential credential sync for wallet
router.post('/sync',
  async (req, res) => {
    try {
      const holderCnic = getHolderCnic(req);
      if (!holderCnic) return res.status(400).json({ error: 'holderCnic required' });
      const result = await syncCredentials(holderCnic, req.body.lastSyncAt);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ══════════════════════════════════════════════
// 2. SELF-DECLARATION
// ══════════════════════════════════════════════

// POST /self-declare — Create self-declared skill
router.post('/self-declare',
  [
    body('skillName').notEmpty().isLength({ max: 200 }),
    body('proficiencyLevel').isIn(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT']),
  ],
  validate,
  async (req, res) => {
    try {
      const holderCnic = getHolderCnic(req);
      if (!holderCnic) return res.status(400).json({ error: 'holderCnic required' });
      const credential = await createSelfDeclaration(req.body, holderCnic);
      res.status(201).json({ message: 'Self-declaration created', credential });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ══════════════════════════════════════════════
// 3. OPEN BADGE IMPORT
// ══════════════════════════════════════════════

// POST /import-badge — Import Open Badges 3.0 credential
router.post('/import-badge',
  body('badgeUrl').isURL(),
  validate,
  async (req, res) => {
    try {
      const holderCnic = getHolderCnic(req);
      if (!holderCnic) return res.status(400).json({ error: 'holderCnic required' });
      const credential = await importOpenBadge(req.body.badgeUrl, holderCnic);
      res.status(201).json({ message: 'Badge imported', credential });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ══════════════════════════════════════════════
// 4. SELECTIVE DISCLOSURE & SHARING
// ══════════════════════════════════════════════

// POST /share — Create a share with selective disclosure + consent
router.post('/share',
  [
    body('credentials').isArray({ min: 1 }),
    body('credentials.*.credentialId').notEmpty(),
  ],
  validate,
  async (req, res) => {
    try {
      // Holder identity: workers get it derived; fall back to a stable id so a
      // worker without a stored CNIC can still share.
      let holderCnic = getHolderCnic(req);
      if (!holderCnic) {
        const w = await Worker.findOne({ user: req.user._id }).select('registrationId cnicMasked').lean();
        holderCnic = w?.cnicMasked || w?.registrationId || `TL-${req.user._id}`;
      }
      const { credentials, recipientName, recipientEmail, recipientOrganization,
              purpose, shareType, expiresIn, maxAccessCount } = req.body;

      const DEFAULT_FIELDS = ['title', 'credentialType', 'issuerName', 'status', 'issuanceDate'];

      // Build shared credentials with selective disclosure — resolve from either
      // model and SNAPSHOT the disclosed values so the public view is self-contained.
      const sharedCredentials = [];
      for (const c of credentials) {
        const r = await resolveShareable(c.credentialId);
        if (!r) continue;
        const fields = (Array.isArray(c.disclosedFields) && c.disclosedFields.length) ? c.disclosedFields : DEFAULT_FIELDS;
        const disclosedData = {};
        for (const f of fields) {
          if (r.norm[f] !== undefined && r.norm[f] !== null) disclosedData[f] = r.norm[f];
        }
        sharedCredentials.push({
          credentialId: r.credentialId,
          credentialTitle: r.norm.title,
          disclosedFields: fields,
          disclosedData,
        });
      }

      if (sharedCredentials.length === 0) {
        return res.status(400).json({ error: 'No valid credentials to share' });
      }

      // Calculate expiry
      const expiryMap = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 };
      const days = expiryMap[expiresIn] || 7;
      const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

      const shareId = uuidv4();
      const shareUrl = `/verify/shared/${shareId}`;

      const record = new ShareRecord({
        shareId,
        holderCnic,
        sharedCredentials,
        recipientName,
        recipientEmail,
        recipientOrganization,
        purpose,
        shareType: shareType || 'DIRECT_LINK',
        shareUrl,
        expiresAt,
        maxAccessCount: maxAccessCount || null,
        consentGiven: true,
        consentTimestamp: new Date(),
        consentDetails: `Shared ${sharedCredentials.length} credential(s) with ${recipientName || 'public'} for ${purpose || 'verification'}`,
      });
      await record.save();

      res.status(201).json({
        message: 'Share created',
        shareId,
        shareUrl,
        expiresAt,
        credentialCount: sharedCredentials.length,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /shares — Holder's sharing history
router.get('/shares',
  async (req, res) => {
    try {
      const holderCnic = getHolderCnic(req);
      if (!holderCnic) return res.status(400).json({ error: 'holderCnic required' });
      const records = await ShareRecord.find({
        holderCnic,
      }).sort({ createdAt: -1 }).limit(50);
      res.json({ shares: records, total: records.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /shares/:shareId/revoke — Revoke a share
router.post('/shares/:shareId/revoke',
  async (req, res, next) => {
    try {
      const scope = ownershipScope(req);
      if (scope === null) return res.status(403).json({ error: 'Not authorized for this resource' });
      const record = await ShareRecord.findOne({ shareId: req.params.shareId, ...scope });
      if (!record) return res.status(404).json({ error: 'Share not found' });
      record.status = 'REVOKED';
      record.revokedAt = new Date();
      await record.save();
      res.json({ message: 'Share revoked' });
    } catch (err) {
      next(err);
    }
  }
);

// GET /consent-log — Full consent/sharing audit log for holder
router.get('/consent-log',
  async (req, res) => {
    try {
      const holderCnic = getHolderCnic(req);
      if (!holderCnic) return res.status(400).json({ error: 'holderCnic required' });
      const shares = await ShareRecord.find({ holderCnic })
        .select('shareId sharedCredentials recipientName recipientOrganization purpose shareType consentTimestamp consentDetails status expiresAt accessCount createdAt')
        .sort({ createdAt: -1 })
        .limit(100);
      res.json({ consentLog: shares, total: shares.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ══════════════════════════════════════════════
// 5. CREDENTIAL PORTFOLIOS
// ══════════════════════════════════════════════

// POST /portfolios — Create portfolio
router.post('/portfolios',
  body('name').notEmpty().isLength({ max: 200 }),
  validate,
  async (req, res) => {
    try {
      const holderCnic = getHolderCnic(req);
      if (!holderCnic) return res.status(400).json({ error: 'holderCnic required' });
      const portfolio = new Portfolio({
        holderCnic,
        name: req.body.name,
        description: req.body.description,
        category: req.body.category || 'CUSTOM',
        credentials: (req.body.credentials || []).map(id => ({ credentialId: id })),
      });
      await portfolio.save();
      res.status(201).json({ message: 'Portfolio created', portfolio });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /portfolios — List holder's portfolios
router.get('/portfolios',
  async (req, res) => {
    try {
      const holderCnic = getHolderCnic(req);
      if (!holderCnic) return res.status(400).json({ error: 'holderCnic required' });
      const portfolios = await Portfolio.find({
        holderCnic, isDeleted: false,
      }).sort({ updatedAt: -1 });
      res.json({ portfolios, total: portfolios.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /portfolios/:portfolioId — Get single portfolio with credential details
router.get('/portfolios/:portfolioId',
  async (req, res, next) => {
    try {
      const scope = ownershipScope(req);
      if (scope === null) return res.status(403).json({ error: 'Not authorized for this resource' });
      const portfolio = await Portfolio.findOne({
        portfolioId: req.params.portfolioId, isDeleted: false, ...scope,
      });
      if (!portfolio) return res.status(404).json({ error: 'Portfolio not found' });

      // Resolve credentials
      const credIds = portfolio.credentials.map(c => c.credentialId);
      const creds = await RegistryCredential.find({
        credentialId: { $in: credIds }, isDeleted: false,
      }).select('credentialId title credentialType issuerName status verificationStatus issuanceDate expiryDate');

      res.json({ portfolio, credentials: creds });
    } catch (err) {
      next(err);
    }
  }
);

// PUT /portfolios/:portfolioId — Update portfolio
router.put('/portfolios/:portfolioId',
  async (req, res, next) => {
    try {
      const scope = ownershipScope(req);
      if (scope === null) return res.status(403).json({ error: 'Not authorized for this resource' });
      const portfolio = await Portfolio.findOne({
        portfolioId: req.params.portfolioId, isDeleted: false, ...scope,
      });
      if (!portfolio) return res.status(404).json({ error: 'Portfolio not found' });

      if (req.body.name) portfolio.name = req.body.name;
      if (req.body.description !== undefined) portfolio.description = req.body.description;
      if (req.body.category) portfolio.category = req.body.category;
      if (req.body.credentials) {
        portfolio.credentials = req.body.credentials.map(id => ({ credentialId: id }));
      }
      if (req.body.addCredential) {
        portfolio.credentials.push({ credentialId: req.body.addCredential });
      }
      if (req.body.removeCredential) {
        portfolio.credentials = portfolio.credentials.filter(
          c => c.credentialId !== req.body.removeCredential
        );
      }
      await portfolio.save();
      res.json({ message: 'Portfolio updated', portfolio });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /portfolios/:portfolioId — Soft-delete portfolio
router.delete('/portfolios/:portfolioId',
  async (req, res, next) => {
    try {
      const scope = ownershipScope(req);
      if (scope === null) return res.status(403).json({ error: 'Not authorized for this resource' });
      const portfolio = await Portfolio.findOne({
        portfolioId: req.params.portfolioId, isDeleted: false, ...scope,
      });
      if (!portfolio) return res.status(404).json({ error: 'Portfolio not found' });
      portfolio.isDeleted = true;
      await portfolio.save();
      res.json({ message: 'Portfolio deleted' });
    } catch (err) {
      next(err);
    }
  }
);

// ══════════════════════════════════════════════
// 6. HOLDER ANALYTICS & INSIGHTS
// ══════════════════════════════════════════════

// GET /analytics — Holder's credential analytics
router.get('/analytics',
  async (req, res) => {
    try {
      const holderCnic = getHolderCnic(req);
      if (!holderCnic) return res.status(400).json({ error: 'holderCnic required' });

      // Credential counts by type and status
      const [byType, byStatus, verificationCount, shareCount, credentials] = await Promise.all([
        RegistryCredential.aggregate([
          { $match: { holderCnic, isDeleted: false } },
          { $group: { _id: '$credentialType', count: { $sum: 1 } } },
        ]),
        RegistryCredential.aggregate([
          { $match: { holderCnic, isDeleted: false } },
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
        VerificationLog.countDocuments({
          credentialId: {
            $in: (await RegistryCredential.find({ holderCnic, isDeleted: false }).select('credentialId')).map(c => c.credentialId),
          },
        }),
        ShareRecord.countDocuments({ holderCnic }),
        RegistryCredential.find({ holderCnic, isDeleted: false })
          .select('credentialId title expiryDate status credentialType issuanceDate')
          .sort({ issuanceDate: -1 }),
      ]);

      // Upcoming expirations
      const now = new Date();
      const in90Days = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
      const expiring = credentials.filter(c =>
        c.expiryDate && c.expiryDate > now && c.expiryDate <= in90Days
      ).map(c => ({
        credentialId: c.credentialId,
        title: c.title,
        expiryDate: c.expiryDate,
        daysLeft: Math.ceil((c.expiryDate - now) / (1000 * 60 * 60 * 24)),
      }));

      // Credential timeline (last 12 months)
      const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
      const timeline = await RegistryCredential.aggregate([
        { $match: { holderCnic, isDeleted: false, issuanceDate: { $gte: twelveMonthsAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$issuanceDate' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]);

      res.json({
        summary: {
          totalCredentials: credentials.length,
          active: byStatus.find(s => s._id === 'ACTIVE')?.count || 0,
          pending: byStatus.find(s => s._id === 'PENDING_VERIFICATION')?.count || 0,
          revoked: byStatus.find(s => s._id === 'REVOKED')?.count || 0,
          totalVerifications: verificationCount,
          totalShares: shareCount,
        },
        byType,
        byStatus,
        expiring,
        timeline,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /skills-gap — AI-powered skills gap analysis
router.get('/skills-gap',
  async (req, res) => {
    try {
      const holderCnic = getHolderCnic(req);
      if (!holderCnic) return res.status(400).json({ error: 'holderCnic required' });
      const targetMarket = req.query.market || 'UAE';

      // Get holder's credentials
      const credentials = await RegistryCredential.find({
        holderCnic, isDeleted: false, status: { $ne: 'REVOKED' },
      }).select('credentialType title metadata').lean();

      // Get worker's trade and profile
      const lastFour = holderCnic.slice(-4);
      const worker = await Worker.findOne({ cnicMasked: { $regex: lastFour + '$' } })
        .select('trade nqfLevel competencies selfAssessedSkills');

      const trade = worker?.trade || 'general';

      // Gulf market requirements by trade
      const gulfRequirements = {
        electrician: {
          required: ['BTE/TVET Certificate (NQF 3+)', 'PEC License (if applicable)', 'GAMCA Medical', 'BEOE Registration', 'Safety Card (NEBOSH/IOSH)'],
          preferred: ['IEC 60364 Knowledge', 'Solar PV Installation', 'BMS/Building Automation', 'First Aid Certificate'],
          salary_range: 'AED 2,500-5,000/month',
        },
        plumber: {
          required: ['BTE/TVET Certificate (NQF 3+)', 'GAMCA Medical', 'BEOE Registration', 'Safety Card'],
          preferred: ['HVAC Basic Knowledge', 'Fire Protection Systems', 'Green Plumbing Certificate', 'First Aid Certificate'],
          salary_range: 'AED 2,000-4,000/month',
        },
        welder: {
          required: ['BTE/TVET Certificate (NQF 3+)', 'Welding Certification (AWS/CSWIP)', 'GAMCA Medical', 'BEOE Registration', 'Safety Card'],
          preferred: ['6G Welding Qualification', 'TIG/MIG Specialization', 'Pipe Welding', 'NDT Knowledge'],
          salary_range: 'AED 3,000-6,000/month',
        },
        'mason': {
          required: ['BTE/TVET Certificate (NQF 2+)', 'GAMCA Medical', 'BEOE Registration'],
          preferred: ['Tile Setting Specialization', 'Plastering Certification', 'Safety Card', 'First Aid Certificate'],
          salary_range: 'AED 1,800-3,500/month',
        },
        carpenter: {
          required: ['BTE/TVET Certificate (NQF 2+)', 'GAMCA Medical', 'BEOE Registration'],
          preferred: ['Furniture Making Specialization', 'CNC Operation', 'AutoCAD Basics', 'Safety Card'],
          salary_range: 'AED 2,000-4,000/month',
        },
        'heavy-equipment-operator': {
          required: ['BTE/TVET Certificate', 'Valid License (Category)', 'GAMCA Medical', 'BEOE Registration', 'Safety Card'],
          preferred: ['Crane Operation Certification', 'Forklift License', 'GPS Grade Control', 'First Aid Certificate'],
          salary_range: 'AED 3,500-7,000/month',
        },
        general: {
          required: ['TVET or Academic Certificate', 'GAMCA Medical', 'BEOE Registration'],
          preferred: ['Trade-Specific Certification', 'Safety Card', 'English Language Certificate', 'First Aid Certificate'],
          salary_range: 'AED 1,500-3,000/month',
        },
      };

      const requirements = gulfRequirements[trade.toLowerCase().replace(/\s+/g, '-')] || gulfRequirements.general;

      // Map holder's credentials to categories
      const holderHas = {
        tvet: credentials.some(c => ['TVET', 'ACADEMIC'].includes(c.credentialType)),
        medical: credentials.some(c => c.credentialType === 'HEALTH_CLEARANCE'),
        migration: credentials.some(c => c.credentialType === 'MIGRATION_RECORD'),
        license: credentials.some(c => c.credentialType === 'PROFESSIONAL_LICENSE'),
        safety: credentials.some(c => c.title?.toLowerCase().includes('safety') || c.title?.toLowerCase().includes('nebosh')),
        micro: credentials.filter(c => c.credentialType === 'MICRO_CREDENTIAL').length,
      };

      // Identify gaps
      const gaps = [];
      if (!holderHas.tvet) gaps.push({ gap: 'Trade Certificate (BTE/TVET)', priority: 'CRITICAL', action: 'Enroll in nearest TVET institution or apply for RPL assessment' });
      if (!holderHas.medical) gaps.push({ gap: 'GAMCA Medical Clearance', priority: 'CRITICAL', action: 'Visit GAMCA-approved medical center for fitness examination' });
      if (!holderHas.migration) gaps.push({ gap: 'BEOE Registration', priority: 'CRITICAL', action: 'Register with Bureau of Emigration & Overseas Employment' });
      if (!holderHas.safety) gaps.push({ gap: 'Safety Certification', priority: 'HIGH', action: 'Complete NEBOSH IGC, IOSH Working Safely, or equivalent safety course' });
      if (!holderHas.license && trade.toLowerCase().includes('electri')) {
        gaps.push({ gap: 'PEC Professional License', priority: 'HIGH', action: 'Apply for Pakistan Engineering Council registration' });
      }

      // Recommendations
      const recommendations = [];
      if (holderHas.micro < 2) recommendations.push('Complete 2-3 online micro-credentials (Coursera/edX) to strengthen your profile');
      if (!worker?.nqfLevel || worker.nqfLevel < 3) recommendations.push('Consider NQF Level 3+ qualification for higher salary band');
      recommendations.push(`Target market: ${targetMarket} — ${requirements.salary_range}`);

      const readiness = gaps.filter(g => g.priority === 'CRITICAL').length === 0 ? 'READY' :
        gaps.filter(g => g.priority === 'CRITICAL').length <= 1 ? 'ALMOST_READY' : 'NOT_READY';

      res.json({
        trade,
        targetMarket,
        readiness,
        readinessScore: Math.max(0, 100 - gaps.length * 20),
        requirements,
        holderCredentials: credentials.length,
        gaps,
        recommendations,
        salary_range: requirements.salary_range,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ══════════════════════════════════════════════
// 7. VERIFICATION HISTORY (who verified my credentials)
// ══════════════════════════════════════════════

// GET /verification-history — Holder's credential verification audit log
router.get('/verification-history',
  async (req, res) => {
    try {
      const holderCnic = getHolderCnic(req);
      if (!holderCnic) return res.status(400).json({ error: 'holderCnic required' });

      // Find all credential IDs belonging to this holder in the registry
      const holderCreds = await RegistryCredential.find({
        holderCnic, isDeleted: false,
      }).select('credentialId title credentialType').lean();

      const credIds = holderCreds.map(c => c.credentialId);

      if (credIds.length === 0) {
        return res.json({ verifications: [], total: 0 });
      }

      // Fetch verification logs for those credentials
      const logs = await VerificationLog.find({
        credentialId: { $in: credIds },
      })
        .select('credentialId verifierType verificationResult verificationMethodUsed ipAddress geolocation createdAt verifierIdentifier')
        .sort({ createdAt: -1 })
        .limit(parseInt(req.query.limit) || 50)
        .lean();

      // Enrich with credential title
      const credMap = Object.fromEntries(holderCreds.map(c => [c.credentialId, c]));
      const enriched = logs.map(log => ({
        ...log,
        credentialTitle: credMap[log.credentialId]?.title || log.credentialId,
        credentialType: credMap[log.credentialId]?.credentialType,
        // Anonymise IP: show only country/city from geolocation
        ipAddress: undefined,
        location: log.geolocation?.city
          ? `${log.geolocation.city}, ${log.geolocation.country}`
          : log.geolocation?.country || 'Unknown',
      }));

      res.json({ verifications: enriched, total: enriched.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ══════════════════════════════════════════════
// 8. BLOCKCHAIN STATUS
// ══════════════════════════════════════════════

// GET /blockchain-status — Current blockchain mode and config
router.get('/blockchain-status', async (req, res) => {
  try {
    const chain = process.env.BLOCKCHAIN_CHAIN || 'simulated';
    const contractAddress = process.env.BLOCKCHAIN_CONTRACT_ADDRESS || null;
    const rawRpc = process.env.BLOCKCHAIN_RPC_URL || '';
    const chainId = process.env.BLOCKCHAIN_CHAIN_ID || null;

    // Mask RPC URL — show only protocol + host, hide key
    let maskedRpc = '';
    if (rawRpc) {
      try {
        const url = new URL(rawRpc);
        maskedRpc = `${url.protocol}//${url.hostname}`;
      } catch {
        maskedRpc = rawRpc.slice(0, 20) + '...';
      }
    }

    res.json({
      mode: chain === 'simulated' ? 'simulated' : 'polygon',
      contractAddress: contractAddress || null,
      rpcUrl: maskedRpc || null,
      chainId: chainId ? parseInt(chainId) : null,
      networkName: chain === 'simulated' ? 'Simulated (Local)' :
        chainId === '137' ? 'Polygon Mainnet' :
        chainId === '80001' ? 'Polygon Mumbai Testnet' : 'Custom EVM',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════
// 8. PUBLIC SHARED CREDENTIAL ACCESS (no auth)
// ══════════════════════════════════════════════

export const publicShareRouter = express.Router();

// GET /api/public/shared/:shareId — Access shared credentials (public, no auth).
// Under /api so nginx proxies it to the server (the SPA owns the /verify/shared
// path for display). Returns the snapshotted disclosed values.
publicShareRouter.get('/api/public/shared/:shareId', async (req, res) => {
  try {
    const record = await ShareRecord.findOne({ shareId: req.params.shareId });
    if (!record) return res.status(404).json({ error: 'Share not found or expired' });
    if (record.expiresAt && record.expiresAt < new Date()) {
      record.status = 'EXPIRED'; await record.save();
      return res.status(410).json({ error: 'Share link has expired' });
    }
    if (record.maxAccessCount && record.accessCount >= record.maxAccessCount) {
      return res.status(410).json({ error: 'Share link access limit reached' });
    }
    if (record.status !== 'ACTIVE') {
      return res.status(410).json({ error: `Share is ${record.status.toLowerCase()}` });
    }
    record.accessCount++;
    record.accessLog.push({ accessedAt: new Date(), ipAddress: req.ip, userAgent: req.get('user-agent') });
    await record.save();

    const credentials = (record.sharedCredentials || []).map(sc => ({
      credentialId: sc.credentialId,
      title: sc.credentialTitle,
      ...(sc.disclosedData || {}),
      _disclosedFields: sc.disclosedFields,
    }));

    res.json({
      shareId: record.shareId,
      sharedBy: record.holderCnic ? `****${String(record.holderCnic).slice(-4)}` : 'Anonymous',
      purpose: record.purpose,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      credentials,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /verify/shared/:shareId — legacy public endpoint (kept for back-compat)
publicShareRouter.get('/verify/shared/:shareId', async (req, res) => {
  try {
    const record = await ShareRecord.findOne({ shareId: req.params.shareId });
    if (!record) return res.status(404).json({ error: 'Share not found or expired' });

    // Check expiry
    if (record.expiresAt && record.expiresAt < new Date()) {
      record.status = 'EXPIRED';
      await record.save();
      return res.status(410).json({ error: 'Share link has expired' });
    }
    // Check max access
    if (record.maxAccessCount && record.accessCount >= record.maxAccessCount) {
      return res.status(410).json({ error: 'Share link access limit reached' });
    }
    if (record.status !== 'ACTIVE') {
      return res.status(410).json({ error: `Share is ${record.status.toLowerCase()}` });
    }

    // Log access
    record.accessCount++;
    record.accessLog.push({
      accessedAt: new Date(),
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });
    await record.save();

    // Fetch credentials with selective disclosure
    const disclosed = [];
    for (const sc of record.sharedCredentials) {
      const cred = await RegistryCredential.findOne({
        credentialId: sc.credentialId, isDeleted: false,
      }).lean();
      if (!cred) continue;

      // Apply selective disclosure — only include disclosed fields
      const filtered = { credentialId: cred.credentialId };
      for (const field of sc.disclosedFields) {
        if (cred[field] !== undefined) filtered[field] = cred[field];
      }
      filtered._disclosedFields = sc.disclosedFields;
      disclosed.push(filtered);
    }

    res.json({
      shareId: record.shareId,
      sharedBy: record.holderCnic ? `****${record.holderCnic.slice(-4)}` : 'Anonymous',
      purpose: record.purpose,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      credentials: disclosed,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
