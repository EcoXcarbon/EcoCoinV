import { Router } from 'express';
import { body, param } from 'express-validator';
import Class from '../models/Class.js';
import ClassEnrollment from '../models/ClassEnrollment.js';
import ClassTopic from '../models/ClassTopic.js';
import ClassAssignment from '../models/ClassAssignment.js';
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

/* ────────── LIST TOPICS (ordered outline) ────────── */
router.get('/', authenticate, [
  param('classId').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMember(req, res);
    if (!ctx) return;
    const topics = await ClassTopic.find({ class: ctx.cls._id }).sort('order createdAt');
    res.json(topics);
  } catch (err) { next(err); }
});

/* ────────── CREATE TOPIC (teacher) ────────── */
router.post('/', authenticate, requireVerifiedEmail, [
  param('classId').isMongoId(),
  body('title').trim().notEmpty().isLength({ max: 150 }),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMember(req, res, { teacherOnly: true });
    if (!ctx) return;
    const last = await ClassTopic.findOne({ class: ctx.cls._id }).sort('-order').select('order');
    const topic = await ClassTopic.create({
      class: ctx.cls._id,
      title: req.body.title,
      order: (last?.order ?? -1) + 1,
      createdBy: req.user._id,
    });
    res.status(201).json(topic);
  } catch (err) { next(err); }
});

/* ────────── REORDER TOPICS (teacher) ────────── */
// Declared before /:topicId so "reorder" isn't captured as a topic id.
router.put('/reorder', authenticate, [
  param('classId').isMongoId(),
  body('order').isArray({ min: 1 }),
  body('order.*').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMember(req, res, { teacherOnly: true });
    if (!ctx) return;
    const ops = req.body.order.map((id, idx) => ({
      updateOne: {
        filter: { _id: id, class: ctx.cls._id },
        update: { order: idx },
      },
    }));
    if (ops.length) await ClassTopic.bulkWrite(ops);
    const topics = await ClassTopic.find({ class: ctx.cls._id }).sort('order createdAt');
    res.json(topics);
  } catch (err) { next(err); }
});

/* ────────── RENAME TOPIC (teacher) ────────── */
router.put('/:topicId', authenticate, [
  param('classId').isMongoId(),
  param('topicId').isMongoId(),
  body('title').trim().notEmpty().isLength({ max: 150 }),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMember(req, res, { teacherOnly: true });
    if (!ctx) return;
    const topic = await ClassTopic.findOneAndUpdate(
      { _id: req.params.topicId, class: ctx.cls._id },
      { title: req.body.title },
      { new: true, runValidators: true },
    );
    if (!topic) return res.status(404).json({ error: 'Topic not found' });
    res.json(topic);
  } catch (err) { next(err); }
});

/* ────────── DELETE TOPIC (teacher) ────────── */
// Classwork under the topic is preserved but moved to "no topic" (ungrouped).
router.delete('/:topicId', authenticate, [
  param('classId').isMongoId(),
  param('topicId').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const ctx = await requireMember(req, res, { teacherOnly: true });
    if (!ctx) return;
    const topic = await ClassTopic.findOneAndDelete({ _id: req.params.topicId, class: ctx.cls._id });
    if (!topic) return res.status(404).json({ error: 'Topic not found' });
    await ClassAssignment.updateMany(
      { class: ctx.cls._id, topicId: topic._id },
      { $unset: { topicId: '' } },
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
