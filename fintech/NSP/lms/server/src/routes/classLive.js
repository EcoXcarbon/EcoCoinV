import { Router } from 'express';
import { body, param } from 'express-validator';
import Class from '../models/Class.js';
import ClassEnrollment from '../models/ClassEnrollment.js';
import ClassLiveSession from '../models/ClassLiveSession.js';
import ClassAnnouncement from '../models/ClassAnnouncement.js';
import { authenticate, requireVerifiedEmail } from '../middleware/auth.js';
import { handleValidation } from '../middleware/validate.js';
import { jaasJoinPayload } from '../services/jaasToken.js';

const router = Router({ mergeParams: true });

async function getMembership(classId, userId) {
  return ClassEnrollment.findOne({ class: classId, user: userId, status: 'active' });
}
const isTeacher = (role) => role === 'teacher' || role === 'co-teacher';

async function requireMember(req, res, opts = {}) {
  const cls = await Class.findById(req.params.classId);
  if (!cls) { res.status(404).json({ error: 'Class not found' }); return null; }
  const m = await getMembership(cls._id, req.user._id);
  if (!m) { res.status(403).json({ error: 'Not a member' }); return null; }
  if (opts.teacherOnly && !isTeacher(m.role)) {
    res.status(403).json({ error: 'Teacher access required' }); return null;
  }
  return { cls, m };
}

/* ────────── LIST SESSIONS ────────── */
router.get('/', authenticate, [
  param('classId').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMember(req, res);
    if (!ctx) return;
    const sessions = await ClassLiveSession.find({ class: ctx.cls._id })
      .sort('-scheduledFor')
      .populate('createdBy', 'name avatar');
    res.json(sessions);
  } catch (err) { next(err); }
});

/* ────────── CREATE SESSION (teacher) ────────── */
router.post('/', authenticate, requireVerifiedEmail, [
  param('classId').isMongoId(),
  body('title').trim().notEmpty().isLength({ max: 200 }),
  body('description').optional().isLength({ max: 2000 }),
  body('scheduledFor').isISO8601(),
  body('durationMins').optional().isInt({ min: 5, max: 600 }).toInt(),
  body('mode').optional().isIn(['jitsi', 'link']),
  body('meetingUrl').optional({ checkFalsy: true }).isURL({ protocols: ['http', 'https'], require_protocol: true }).isLength({ max: 500 }),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMember(req, res, { teacherOnly: true });
    if (!ctx) return;

    const mode = req.body.mode || 'jitsi';
    if (mode === 'link' && !req.body.meetingUrl) {
      return res.status(400).json({ error: 'meetingUrl is required for link mode' });
    }

    const session = await ClassLiveSession.create({
      class: ctx.cls._id,
      title: req.body.title,
      description: req.body.description,
      scheduledFor: new Date(req.body.scheduledFor),
      durationMins: req.body.durationMins ?? 60,
      mode,
      meetingUrl: mode === 'link' ? req.body.meetingUrl : undefined,
      createdBy: req.user._id,
    });

    // Surface in the Stream so members see the scheduled session.
    await ClassAnnouncement.create({
      class: ctx.cls._id,
      author: req.user._id,
      body: `Scheduled a live session: ${session.title} — ${new Date(session.scheduledFor).toLocaleString()}`,
      kind: 'announcement',
    });

    res.status(201).json(session);
  } catch (err) { next(err); }
});

/* ────────── UPDATE SESSION (teacher) ────────── */
router.put('/:sessionId', authenticate, [
  param('classId').isMongoId(),
  param('sessionId').isMongoId(),
  body('title').optional().trim().isLength({ max: 200 }),
  body('description').optional().isLength({ max: 2000 }),
  body('scheduledFor').optional().isISO8601(),
  body('durationMins').optional().isInt({ min: 5, max: 600 }).toInt(),
  body('mode').optional().isIn(['jitsi', 'link']),
  body('meetingUrl').optional({ checkFalsy: true }).isURL({ protocols: ['http', 'https'], require_protocol: true }).isLength({ max: 500 }),
  body('status').optional().isIn(['scheduled', 'live', 'ended', 'cancelled']),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMember(req, res, { teacherOnly: true });
    if (!ctx) return;
    const session = await ClassLiveSession.findOne({ _id: req.params.sessionId, class: ctx.cls._id });
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const allowed = ['title', 'description', 'durationMins', 'mode', 'meetingUrl', 'status'];
    for (const k of allowed) if (req.body[k] !== undefined) session[k] = req.body[k];
    if (req.body.scheduledFor !== undefined) session.scheduledFor = new Date(req.body.scheduledFor);
    await session.save();
    res.json(session);
  } catch (err) { next(err); }
});

/* ────────── JOIN TOKEN (JaaS moderator JWT for teachers) ────────── */
router.get('/:sessionId/token', authenticate, [
  param('classId').isMongoId(),
  param('sessionId').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMember(req, res);
    if (!ctx) return;
    const session = await ClassLiveSession.findOne({ _id: req.params.sessionId, class: ctx.cls._id });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.mode === 'link') return res.json({ mode: 'link', meetingUrl: session.meetingUrl });

    const payload = jaasJoinPayload({
      room: session.jitsiRoom,
      user: { id: req.user._id, name: req.user.name, email: req.user.email, avatar: req.user.avatar },
      moderator: isTeacher(ctx.m.role),
    });
    res.json({ mode: 'jitsi', ...payload });
  } catch (err) { next(err); }
});

/* ────────── START (Live now) ────────── */
router.post('/:sessionId/start', authenticate, [
  param('classId').isMongoId(),
  param('sessionId').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMember(req, res, { teacherOnly: true });
    if (!ctx) return;
    const session = await ClassLiveSession.findOne({ _id: req.params.sessionId, class: ctx.cls._id });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    session.status = 'live';
    session.startedAt = new Date();
    await session.save();
    res.json(session);
  } catch (err) { next(err); }
});

/* ────────── END (with optional recording link) ────────── */
router.post('/:sessionId/end', authenticate, [
  param('classId').isMongoId(),
  param('sessionId').isMongoId(),
  body('recordingUrl').optional({ checkFalsy: true }).isURL({ protocols: ['http', 'https'], require_protocol: true }).isLength({ max: 500 }),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMember(req, res, { teacherOnly: true });
    if (!ctx) return;
    const session = await ClassLiveSession.findOne({ _id: req.params.sessionId, class: ctx.cls._id });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    session.status = 'ended';
    session.endedAt = new Date();
    if (req.body.recordingUrl) session.recordingUrl = req.body.recordingUrl;
    await session.save();
    res.json(session);
  } catch (err) { next(err); }
});

/* ────────── DELETE (teacher) ────────── */
router.delete('/:sessionId', authenticate, [
  param('classId').isMongoId(),
  param('sessionId').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMember(req, res, { teacherOnly: true });
    if (!ctx) return;
    const session = await ClassLiveSession.findOneAndDelete({ _id: req.params.sessionId, class: ctx.cls._id });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
