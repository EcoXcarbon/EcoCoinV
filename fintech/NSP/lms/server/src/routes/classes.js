import { Router } from 'express';
import { body, param } from 'express-validator';
import Class from '../models/Class.js';
import ClassEnrollment from '../models/ClassEnrollment.js';
import User from '../models/User.js';
import { authenticate, requireVerifiedEmail } from '../middleware/auth.js';
import { handleValidation } from '../middleware/validate.js';
import { jaasJoinPayload } from '../services/jaasToken.js';

const router = Router();

/* ───── helpers ───── */
async function getMembership(classId, userId) {
  return ClassEnrollment.findOne({ class: classId, user: userId, status: 'active' });
}

function isTeacherRole(role) {
  return role === 'teacher' || role === 'co-teacher';
}

async function loadClassOrFail(req, res) {
  const cls = await Class.findById(req.params.id);
  if (!cls) { res.status(404).json({ error: 'Class not found' }); return null; }
  return cls;
}

async function requireMembership(req, res, opts = {}) {
  const cls = await loadClassOrFail(req, res);
  if (!cls) return null;
  const membership = await getMembership(cls._id, req.user._id);
  if (!membership) {
    res.status(403).json({ error: 'Not a member of this class' });
    return null;
  }
  if (opts.teacherOnly && !isTeacherRole(membership.role)) {
    res.status(403).json({ error: 'Teacher access required' });
    return null;
  }
  return { cls, membership };
}

/* ═════════════ LIST MY CLASSES ═════════════ */
router.get('/', authenticate, async (req, res, next) => {
  try {
    const enrollments = await ClassEnrollment.find({ user: req.user._id, status: 'active' })
      .populate({ path: 'class', match: { status: { $ne: 'archived' } } })
      .sort('-createdAt');

    const list = enrollments
      .filter(e => e.class)
      .map(e => ({
        _id: e.class._id,
        name: e.class.name,
        section: e.class.section,
        subject: e.class.subject,
        room: e.class.room,
        banner: e.class.banner,
        theme: e.class.theme,
        joinCode: isTeacherRole(e.role) ? e.class.joinCode : undefined,
        myRole: e.role,
        owner: e.class.owner,
        term: e.class.term,
        createdAt: e.class.createdAt,
      }));

    res.json(list);
  } catch (err) { next(err); }
});

/* ═════════════ CREATE CLASS ═════════════ */
router.post('/', authenticate, requireVerifiedEmail, [
  body('name').trim().notEmpty().isLength({ max: 200 }),
  body('section').optional().trim().isLength({ max: 100 }),
  body('subject').optional().trim().isLength({ max: 100 }),
  body('room').optional().trim().isLength({ max: 50 }),
  body('description').optional().trim().isLength({ max: 2000 }),
  body('term').optional().trim().isLength({ max: 50 }),
  body('linkedTraining').optional().isMongoId(),
  body('pathway').optional().isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const { name, section, subject, room, description, term, linkedTraining, pathway, theme } = req.body;
    const cls = await Class.create({
      name, section, subject, room, description, term, linkedTraining, pathway, theme,
      owner: req.user._id,
    });
    await ClassEnrollment.create({
      class: cls._id,
      user: req.user._id,
      role: 'teacher',
    });
    res.status(201).json(cls);
  } catch (err) { next(err); }
});

/* ═════════════ JOIN BY CODE ═════════════ */
router.post('/join', authenticate, requireVerifiedEmail, [
  body('code').trim().isLength({ min: 4, max: 12 }),
  handleValidation,
], async (req, res, next) => {
  try {
    const code = String(req.body.code).toUpperCase().trim();
    const cls = await Class.findOne({ joinCode: code, status: 'active' });
    if (!cls) return res.status(404).json({ error: 'Invalid class code' });

    const existing = await ClassEnrollment.findOne({ class: cls._id, user: req.user._id });
    if (existing) {
      if (existing.status === 'active') {
        return res.status(409).json({ error: 'Already a member', classId: cls._id });
      }
      existing.status = 'active';
      existing.joinedAt = new Date();
      await existing.save();
      return res.json({ classId: cls._id, name: cls.name });
    }

    await ClassEnrollment.create({
      class: cls._id,
      user: req.user._id,
      role: 'student',
    });
    res.json({ classId: cls._id, name: cls.name });
  } catch (err) { next(err); }
});

/* ═════════════ GET ONE CLASS ═════════════ */
router.get('/:id', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMembership(req, res);
    if (!ctx) return;
    const { cls, membership } = ctx;

    const counts = await ClassEnrollment.aggregate([
      { $match: { class: cls._id, status: 'active' } },
      { $group: { _id: '$role', count: { $sum: 1 } } },
    ]);
    const roleCounts = counts.reduce((acc, c) => ({ ...acc, [c._id]: c.count }), {});

    res.json({
      _id: cls._id,
      name: cls.name,
      section: cls.section,
      subject: cls.subject,
      room: cls.room,
      description: cls.description,
      banner: cls.banner,
      theme: cls.theme,
      term: cls.term,
      owner: cls.owner,
      linkedTraining: cls.linkedTraining,
      pathway: cls.pathway,
      status: cls.status,
      streamPermission: cls.streamPermission,
      videoMode: cls.videoMode,
      meetingUrl: cls.meetingUrl,
      jitsiRoom: cls.jitsiRoom,
      joinCode: isTeacherRole(membership.role) ? cls.joinCode : undefined,
      myRole: membership.role,
      counts: {
        students: roleCounts.student || 0,
        teachers: (roleCounts.teacher || 0) + (roleCounts['co-teacher'] || 0),
      },
      createdAt: cls.createdAt,
    });
  } catch (err) { next(err); }
});

/* ═════════════ UPDATE CLASS (teacher only) ═════════════ */
router.put('/:id', authenticate, [
  param('id').isMongoId(),
  body('name').optional().trim().isLength({ max: 200 }),
  body('section').optional().trim().isLength({ max: 100 }),
  body('subject').optional().trim().isLength({ max: 100 }),
  body('room').optional().trim().isLength({ max: 50 }),
  body('description').optional().trim().isLength({ max: 2000 }),
  body('term').optional().trim().isLength({ max: 50 }),
  body('status').optional().isIn(['active', 'archived']),
  body('theme').optional().trim().isLength({ max: 30 }),
  body('streamPermission').optional().isIn(['post-and-comment', 'comment-only', 'teacher-only']),
  body('videoMode').optional().isIn(['none', 'link', 'jitsi']),
  body('meetingUrl').optional({ checkFalsy: true }).isURL({ protocols: ['http', 'https'], require_protocol: true }).isLength({ max: 500 }),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMembership(req, res, { teacherOnly: true });
    if (!ctx) return;

    const allowed = ['name', 'section', 'subject', 'room', 'description', 'term', 'status', 'theme', 'banner', 'linkedTraining', 'pathway', 'streamPermission', 'videoMode', 'meetingUrl'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) ctx.cls[key] = req.body[key];
    }
    await ctx.cls.save();
    res.json(ctx.cls);
  } catch (err) { next(err); }
});

/* ═════════════ REGENERATE JOIN CODE (teacher only) ═════════════ */
router.post('/:id/reset-code', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMembership(req, res, { teacherOnly: true });
    if (!ctx) return;
    ctx.cls.joinCode = undefined;
    await ctx.cls.save();
    res.json({ joinCode: ctx.cls.joinCode });
  } catch (err) { next(err); }
});

/* ═════════════ PEOPLE LIST ═════════════ */
router.get('/:id/people', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMembership(req, res);
    if (!ctx) return;

    const members = await ClassEnrollment.find({ class: ctx.cls._id, status: 'active' })
      .populate('user', 'name email role avatar')
      .sort('role joinedAt');

    res.json(members.map(m => ({
      _id: m._id,
      role: m.role,
      joinedAt: m.joinedAt,
      user: m.user ? {
        _id: m.user._id,
        name: m.user.name,
        email: m.user.email,
        role: m.user.role,
        avatar: m.user.avatar,
      } : null,
    })));
  } catch (err) { next(err); }
});

/* ═════════════ INVITE BY EMAIL (teacher only) ═════════════ */
router.post('/:id/invite', authenticate, [
  param('id').isMongoId(),
  body('email').isEmail().normalizeEmail(),
  body('role').optional().isIn(['student', 'co-teacher']),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMembership(req, res, { teacherOnly: true });
    if (!ctx) return;

    const targetUser = await User.findOne({ email: req.body.email });
    if (!targetUser) return res.status(404).json({ error: 'User not found. Ask them to register first.' });

    const role = req.body.role === 'co-teacher' ? 'co-teacher' : 'student';

    const existing = await ClassEnrollment.findOne({ class: ctx.cls._id, user: targetUser._id });
    if (existing) {
      if (existing.status === 'active') return res.status(409).json({ error: 'Already a member' });
      existing.status = 'active';
      existing.role = role;
      existing.joinedAt = new Date();
      await existing.save();
      return res.json({ ok: true, enrollment: existing });
    }

    const enrollment = await ClassEnrollment.create({
      class: ctx.cls._id,
      user: targetUser._id,
      role,
    });
    res.status(201).json({ ok: true, enrollment });
  } catch (err) { next(err); }
});

/* ═════════════ REMOVE MEMBER (teacher only) ═════════════ */
router.delete('/:id/people/:enrollmentId', authenticate, [
  param('id').isMongoId(),
  param('enrollmentId').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMembership(req, res, { teacherOnly: true });
    if (!ctx) return;

    const enr = await ClassEnrollment.findOne({ _id: req.params.enrollmentId, class: ctx.cls._id });
    if (!enr) return res.status(404).json({ error: 'Member not found' });
    if (enr.user.toString() === ctx.cls.owner.toString()) {
      return res.status(400).json({ error: 'Cannot remove class owner' });
    }
    enr.status = 'removed';
    await enr.save();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ═════════════ LEAVE CLASS ═════════════ */
router.post('/:id/leave', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMembership(req, res);
    if (!ctx) return;
    if (ctx.cls.owner.toString() === req.user._id.toString()) {
      return res.status(400).json({ error: 'Owner cannot leave; archive the class instead.' });
    }
    ctx.membership.status = 'left';
    await ctx.membership.save();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ═════════════ PERSISTENT MEETING JOIN TOKEN (JaaS) ═════════════ */
// Mints a JaaS JWT for the class's always-on Jitsi room. Teachers get
// moderator rights so the room starts; students join as participants.
router.get('/:id/meet/token', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMembership(req, res);
    if (!ctx) return;
    if (ctx.cls.videoMode !== 'jitsi' || !ctx.cls.jitsiRoom) {
      return res.status(400).json({ error: 'Class does not have an embedded Jitsi room' });
    }
    const payload = jaasJoinPayload({
      room: ctx.cls.jitsiRoom,
      user: { id: req.user._id, name: req.user.name, email: req.user.email, avatar: req.user.avatar },
      moderator: isTeacherRole(ctx.membership.role),
    });
    res.json(payload);
  } catch (err) { next(err); }
});

export default router;
