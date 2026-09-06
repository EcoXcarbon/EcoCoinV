import { Router } from 'express';
import { body, param } from 'express-validator';
import Class from '../models/Class.js';
import ClassEnrollment from '../models/ClassEnrollment.js';
import ClassAnnouncement from '../models/ClassAnnouncement.js';
import { authenticate, requireVerifiedEmail } from '../middleware/auth.js';
import { handleValidation } from '../middleware/validate.js';

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

/* GET stream */
router.get('/', authenticate, [
  param('classId').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMember(req, res);
    if (!ctx) return;

    // Scheduled-post filter: hide posts where scheduledFor > now from anyone
    // except the author and teachers/co-teachers.
    const now = new Date();
    const visibilityFilter = isTeacher(ctx.m.role)
      ? {} // teachers see everything
      : {
          $or: [
            { scheduledFor: { $exists: false } },
            { scheduledFor: null },
            { scheduledFor: { $lte: now } },
            { author: req.user._id }, // author sees their own scheduled drafts
          ],
        };

    const items = await ClassAnnouncement.find({ class: ctx.cls._id, ...visibilityFilter })
      .populate('author', 'name email avatar role')
      .populate('comments.author', 'name avatar')
      .sort('-pinned -createdAt')
      .limit(100);
    res.json(items);
  } catch (err) { next(err); }
});

/* POST announcement */
router.post('/', authenticate, requireVerifiedEmail, [
  param('classId').isMongoId(),
  body('body').trim().notEmpty().isLength({ max: 5000 }),
  body('pinned').optional().isBoolean(),
  body('attachments').optional().isArray(),
  body('scheduledFor').optional().isISO8601(),
  body('commentsLocked').optional().isBoolean(),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMember(req, res);
    if (!ctx) return;

    // Stream permission gate — students may be restricted from posting
    const perm = ctx.cls.streamPermission || 'post-and-comment';
    if (!isTeacher(ctx.m.role) && perm !== 'post-and-comment') {
      return res.status(403).json({
        error: perm === 'teacher-only'
          ? 'Only teachers can post in this class.'
          : 'Students can only comment in this class — new posts are teacher-only.',
      });
    }

    // Only teachers may schedule or lock comments
    const teacher = isTeacher(ctx.m.role);
    const scheduledFor = (teacher && req.body.scheduledFor) ? new Date(req.body.scheduledFor) : undefined;
    const commentsLocked = teacher ? !!req.body.commentsLocked : false;

    const ann = await ClassAnnouncement.create({
      class: ctx.cls._id,
      author: req.user._id,
      body: req.body.body,
      attachments: req.body.attachments || [],
      pinned: teacher ? !!req.body.pinned : false,
      scheduledFor,
      commentsLocked,
    });
    const populated = await ClassAnnouncement.findById(ann._id)
      .populate('author', 'name email avatar role');
    res.status(201).json(populated);
  } catch (err) { next(err); }
});

/* DELETE announcement (author or teacher) */
router.delete('/:announcementId', authenticate, [
  param('classId').isMongoId(),
  param('announcementId').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMember(req, res);
    if (!ctx) return;
    const ann = await ClassAnnouncement.findOne({ _id: req.params.announcementId, class: ctx.cls._id });
    if (!ann) return res.status(404).json({ error: 'Not found' });
    if (ann.author.toString() !== req.user._id.toString() && !isTeacher(ctx.m.role)) {
      return res.status(403).json({ error: 'Cannot delete this post' });
    }
    await ann.deleteOne();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* PIN/UNPIN (teacher only) */
router.put('/:announcementId/pin', authenticate, [
  param('classId').isMongoId(),
  param('announcementId').isMongoId(),
  body('pinned').isBoolean(),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMember(req, res, { teacherOnly: true });
    if (!ctx) return;
    const ann = await ClassAnnouncement.findOneAndUpdate(
      { _id: req.params.announcementId, class: ctx.cls._id },
      { pinned: req.body.pinned },
      { new: true }
    );
    if (!ann) return res.status(404).json({ error: 'Not found' });
    res.json(ann);
  } catch (err) { next(err); }
});

/* LOCK/UNLOCK comments on a specific post (teacher only) */
router.put('/:announcementId/comments-lock', authenticate, [
  param('classId').isMongoId(),
  param('announcementId').isMongoId(),
  body('locked').isBoolean(),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMember(req, res, { teacherOnly: true });
    if (!ctx) return;
    const ann = await ClassAnnouncement.findOneAndUpdate(
      { _id: req.params.announcementId, class: ctx.cls._id },
      { commentsLocked: req.body.locked },
      { new: true }
    );
    if (!ann) return res.status(404).json({ error: 'Not found' });
    res.json(ann);
  } catch (err) { next(err); }
});

/* POST comment */
router.post('/:announcementId/comments', authenticate, requireVerifiedEmail, [
  param('classId').isMongoId(),
  param('announcementId').isMongoId(),
  body('body').trim().notEmpty().isLength({ max: 2000 }),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMember(req, res);
    if (!ctx) return;

    // Stream permission gate — teacher-only mode blocks student comments too
    const perm = ctx.cls.streamPermission || 'post-and-comment';
    if (!isTeacher(ctx.m.role) && perm === 'teacher-only') {
      return res.status(403).json({ error: 'Only teachers can comment in this class.' });
    }

    const ann = await ClassAnnouncement.findOne({ _id: req.params.announcementId, class: ctx.cls._id });
    if (!ann) return res.status(404).json({ error: 'Not found' });

    // Per-post comment lock — teachers may still comment (so they can post follow-ups),
    // students get blocked.
    if (ann.commentsLocked && !isTeacher(ctx.m.role)) {
      return res.status(403).json({ error: 'Comments are closed on this post.' });
    }

    ann.comments.push({ author: req.user._id, body: req.body.body });
    await ann.save();
    const populated = await ClassAnnouncement.findById(ann._id)
      .populate('author', 'name email avatar role')
      .populate('comments.author', 'name avatar');
    res.status(201).json(populated);
  } catch (err) { next(err); }
});

/* DELETE comment (author or teacher) */
router.delete('/:announcementId/comments/:commentId', authenticate, [
  param('classId').isMongoId(),
  param('announcementId').isMongoId(),
  param('commentId').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMember(req, res);
    if (!ctx) return;
    const ann = await ClassAnnouncement.findOne({ _id: req.params.announcementId, class: ctx.cls._id });
    if (!ann) return res.status(404).json({ error: 'Not found' });
    const comment = ann.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    if (comment.author.toString() !== req.user._id.toString() && !isTeacher(ctx.m.role)) {
      return res.status(403).json({ error: 'Cannot delete this comment' });
    }
    comment.deleteOne();
    await ann.save();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
