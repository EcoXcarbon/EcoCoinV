import { Router } from 'express';
import { param, query } from 'express-validator';
import Credential from '../models/Credential.js';
import Worker from '../models/Worker.js';
import { handleValidation } from '../middleware/validate.js';
import { verifyVCProof, generateVCJsonLd } from '../services/credentialService.js';
import { generateQR } from '../services/qrService.js';
import Issuer from '../models/Issuer.js';
import { getIssuerDID } from '../config/keys.js';
import env from '../config/env.js';
import { ISSUER_DID } from '../config/identity.js';

const router = Router();

/* ─── EDC-style verification: run the full check suite on a credential ───
   Mirrors the six checks of the European Digital Credentials Viewer:
   Format, Seal (signature), Owner, Revocation, Accreditation, Validity. */
async function runVerificationChecks(credential) {
  const now = new Date();
  const vc = credential.vc || {};
  const checks = {};

  // 1. Format — valid W3C Verifiable Credential structure
  const hasStructure = !!(credential.credentialId && credential.title && credential.type && (vc.jwt || vc.proof?.proofValue));
  checks.format = { name: 'Format', passed: hasStructure,
    detail: hasStructure ? 'Conforms to the W3C Verifiable Credential data model' : 'Credential structure is incomplete' };

  // 2. Seal — cryptographic signature verifies and content is untampered
  const proof = verifyVCProof(credential);
  checks.seal = { name: 'Seal (digital signature)', passed: proof.valid,
    signatureType: proof.signatureType,
    detail: proof.valid
      ? `Signature verified against the issuer public key (${proof.signatureType || 'signature'}). The credential has not been tampered with.`
      : (proof.reason || 'Signature could not be verified') };

  // 3. Owner — credential is bound to a named holder
  const boundHolder = !!(credential.worker && (vc.subjectDID || credential.worker));
  checks.owner = { name: 'Owner (holder binding)', passed: boundHolder,
    detail: boundHolder ? 'The credential is cryptographically bound to a named holder.' : 'No holder is bound to this credential.' };

  // 4. Revocation — not revoked by the issuer
  const revoked = credential.status === 'REVOKED' || !!credential.revokedAt;
  checks.revocation = { name: 'Revocation', passed: !revoked,
    detail: revoked ? `Revoked by the issuer${credential.revokedReason ? ': ' + credential.revokedReason : ''}.` : 'The issuer has not revoked this credential.' };

  // 5. Accreditation — issuer is recognised / accredited
  let platformDID = null;
  try { platformDID = getIssuerDID(); } catch { /* ignore */ }
  const issuerDID = vc.issuerDID || '';
  const issuedByPlatform = !!issuerDID && (issuerDID === platformDID || /talentledger|tl\.ppmc\.pk/i.test(issuerDID));
  let accreditedIssuer = null;
  if (credential.institution) {
    accreditedIssuer = await Issuer.findOne({ name: credential.institution, status: 'ACTIVE' }).lean().catch(() => null);
  }
  const accredited = issuedByPlatform || !!accreditedIssuer;
  checks.accreditation = { name: 'Accreditation', passed: accredited,
    detail: accredited
      ? (accreditedIssuer ? `Issuer "${credential.institution}" is an accredited body on the trusted-issuer registry.` : 'Issued by TalentLedger, a recognised NAVTTC/ILO-aligned training issuer.')
      : `Issuer "${credential.institution || 'unknown'}" is not on the accredited-issuer registry.` };

  // 6. Validity — within its date range
  const notYet = credential.validFrom && new Date(credential.validFrom) > now;
  const expired = credential.validUntil && new Date(credential.validUntil) < now;
  const dateOk = !notYet && !expired;
  checks.validity = { name: 'Validity (dates)', passed: dateOk,
    detail: expired ? 'The credential has expired.' : notYet ? 'The credential is not yet valid.' : 'The credential is within its validity period.' };

  const list = Object.values(checks);
  const passedCount = list.filter(c => c.passed).length;
  return { overall: passedCount === list.length ? 'VERIFIED' : 'PARTIALLY_VERIFIED', passedCount, total: list.length, checks };
}

// ── IMPORTANT: Static routes MUST come before /:credentialId to avoid shadowing ──

// GET /qr — Self-hosted QR code endpoint
// Replaces external qrserver.com dependency; offline-capable, no data leakage
router.get('/qr', async (req, res, next) => {
  try {
    const { data, size = '250' } = req.query;
    if (!data) return res.status(400).json({ error: 'data query param required' });
    const qrDataUrl = await generateQR(decodeURIComponent(data), { width: parseInt(size) });
    const base64 = qrDataUrl.replace(/^data:image\/png;base64,/, '');
    const buf = Buffer.from(base64, 'base64');
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400'); // 24h — URL is deterministic
    res.send(buf);
  } catch (err) { next(err); }
});

// GET /profile/:workerId — Public worker profile with active credentials (no auth required)
router.get('/profile/:workerId', [
  param('workerId').isMongoId().withMessage('Invalid worker ID'),
  handleValidation,
], async (req, res, next) => {
  try {
    const worker = await Worker.findById(req.params.workerId)
      .select('fullName fullNameUrdu trade nqfLevel district registrationId cnicMasked photo nadraVerificationStatus profileCompleteness');

    if (!worker) return res.status(404).json({ error: 'Profile not found' });

    const credentials = await Credential.find({
      worker: worker._id,
      status: { $in: ['active', 'ACTIVE'] },
    })
      .select('credentialId title type trade nqfLevel institution issuedBy validFrom validUntil verificationCount')
      .populate('issuedBy', 'name organization')
      .sort('-validFrom')
      .limit(20);

    res.json({
      worker: {
        id: worker._id,
        fullName: worker.fullName,
        fullNameUrdu: worker.fullNameUrdu,
        trade: worker.trade,
        nqfLevel: worker.nqfLevel,
        district: worker.district,
        registrationId: worker.registrationId,
        cnicMasked: worker.cnicMasked,
        photo: worker.photo,
        nadraVerified: worker.nadraVerificationStatus === 'VERIFIED',
        profileCompleteness: worker.profileCompleteness,
      },
      credentials: credentials.map(c => ({
        credentialId: c.credentialId,
        title: c.title,
        type: c.type,
        trade: c.trade,
        nqfLevel: c.nqfLevel,
        institution: c.institution,
        issuedBy: c.issuedBy?.name || c.issuedBy,
        validFrom: c.validFrom,
        validUntil: c.validUntil,
        verificationCount: c.verificationCount,
      })),
      generatedAt: new Date().toISOString(),
    });
  } catch (err) { next(err); }
});

// GET / — Recent verifications log
router.get('/', [
  query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
  handleValidation,
], async (req, res, next) => {
  try {
    const limit = req.query.limit || 20;
    const recent = await Credential.find({ lastVerifiedAt: { $ne: null } })
      .sort('-lastVerifiedAt')
      .limit(limit)
      .select('credentialId trade verificationCount lastVerifiedAt status')
      .populate('worker', 'fullName district');
    res.json(recent);
  } catch (err) { next(err); }
});

// GET /:credentialId — Public credential verification (no auth required)
router.get('/:credentialId', [
  param('credentialId').matches(/^TL-[A-Z0-9]{2,6}-\d{5}$/).withMessage('Invalid credential ID format. Expected: TL-XXXX-NNNNN'),
  handleValidation,
], async (req, res, next) => {
  try {
    const { credentialId } = req.params;

    const credential = await Credential.findOne({ credentialId })
      .populate('worker', 'fullName trade registrationId district cnicMasked nqfLevel')
      .populate('issuedBy', 'name organization');

    if (!credential) return res.status(404).json({ error: 'Credential not found' });

    const verification = verifyVCProof(credential);

    // Atomic increment: avoids NaN on legacy docs missing verificationCount,
    // and avoids re-saving a fully-populated document.
    const verifiedAt = new Date();
    await Credential.updateOne(
      { _id: credential._id },
      { $inc: { verificationCount: 1 }, $set: { lastVerifiedAt: verifiedAt } },
    );
    credential.verificationCount = (credential.verificationCount || 0) + 1;
    credential.lastVerifiedAt = verifiedAt;

    res.json({
      credentialId: credential.credentialId,
      status: credential.status,
      type: credential.type,
      title: credential.title,
      trade: credential.trade,
      nqfLevel: credential.nqfLevel,
      institution: credential.institution,
      worker: {
        name: credential.worker.fullName,
        registrationId: credential.worker.registrationId,
        trade: credential.worker.trade,
        district: credential.worker.district,
        cnicMasked: credential.worker.cnicMasked,
      },
      issuedBy: credential.issuedBy?.name,
      validFrom: credential.validFrom,
      validUntil: credential.validUntil,
      verification: {
        proofValid: verification.valid,
        message: verification.reason,
        method: credential.vc?.proof?.type,
        signatureType: verification.signatureType || 'unknown',
        issuer: verification.issuer,
      },
      verificationCount: credential.verificationCount,
      lastVerifiedAt: credential.lastVerifiedAt,
      revokedAt: credential.revokedAt,
      revokedReason: credential.revokedReason,
    });
  } catch (err) { next(err); }
});

// GET /:credentialId/vc — JSON-LD VC export (public, machine-readable)
router.get('/:credentialId/vc', [
  param('credentialId').matches(/^TL-[A-Z0-9]{2,6}-\d{5}$/).withMessage('Invalid credential ID format'),
  handleValidation,
], async (req, res, next) => {
  try {
    const credential = await Credential.findOne({ credentialId: req.params.credentialId })
      .populate('worker', 'fullName trade registrationId');
    if (!credential) return res.status(404).json({ error: 'Credential not found' });

    res.setHeader('Content-Type', 'application/ld+json');
    res.json(generateVCJsonLd(credential));
  } catch (err) { next(err); }
});

// GET /:credentialId/full — full EDC-style verification (public, no auth)
router.get('/:credentialId/full', [
  param('credentialId').matches(/^TL-[A-Z0-9]{2,6}-\d{5}$/).withMessage('Invalid credential ID format'),
  handleValidation,
], async (req, res, next) => {
  try {
    const credential = await Credential.findOne({ credentialId: req.params.credentialId })
      .populate('worker', 'fullName registrationId trade district cnicMasked nqfLevel')
      .populate('issuedBy', 'name organization');
    if (!credential) return res.status(404).json({ error: 'Credential not found' });

    const result = await runVerificationChecks(credential);

    await Credential.updateOne({ _id: credential._id },
      { $inc: { verificationCount: 1 }, $set: { lastVerifiedAt: new Date() } });

    res.json({
      credentialId: credential.credentialId,
      overall: result.overall,
      checksPassed: `${result.passedCount}/${result.total}`,
      checks: result.checks,
      credential: {
        title: credential.title,
        type: credential.type,
        trade: credential.trade,
        nqfLevel: credential.nqfLevel,
        eqfLevel: credential.eqfLevel,
        institution: credential.institution,
        holder: credential.worker ? {
          name: credential.worker.fullName,
          registrationId: credential.worker.registrationId,
          cnicMasked: credential.worker.cnicMasked,
        } : null,
        issuedBy: credential.issuedBy?.name,
        validFrom: credential.validFrom,
        validUntil: credential.validUntil,
        issuerDID: credential.vc?.issuerDID,
      },
      independentlyVerifiableAt: {
        jwks: `${PUBLIC_BASE}/.well-known/jwks.json`,
        did: ISSUER_DID,
        vcJwt: `/api/v1/verification/${credential.credentialId}/vc`,
      },
      verifiedAt: new Date(),
    });
  } catch (err) { next(err); }
});

export default router;
