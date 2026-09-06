import { Router } from 'express';
import { param, query } from 'express-validator';
import Notification from '../models/Notification.js';
import { authenticate } from '../middleware/auth.js';
import { handleValidation } from '../middleware/validate.js';
import { getUnreadCount, markAsRead, markAllAsRead } from '../services/notificationService.js';

const router = Router();

// Gap #22: List notifications for the authenticated user
router.get('/', authenticate, [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
  query('unreadOnly').optional().isBoolean().toBoolean(),
  query('type').optional().isString(),
  handleValidation,
], async (req, res, next) => {
  try {
    const { page = 1, limit = 20, unreadOnly, type } = req.query;
    const filter = { recipient: req.user._id };
    if (unreadOnly) filter.read = false;
    if (type) filter.type = type;

    const total = await Notification.countDocuments(filter);
    const notifications = await Notification.find(filter)
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const unread = await getUnreadCount(req.user._id);

    res.json({
      notifications,
      unreadCount: unread,
      pagination: { total, page: Number(page), pages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
});

// Gap #22: Get unread count
router.get('/unread-count', authenticate, async (req, res, next) => {
  try {
    const count = await getUnreadCount(req.user._id);
    res.json({ unreadCount: count });
  } catch (err) { next(err); }
});

// Gap #22: Mark a single notification as read
router.put('/:id/read', authenticate, [
  param('id').isMongoId().withMessage('Invalid notification ID'),
  handleValidation,
], async (req, res, next) => {
  try {
    const notification = await markAsRead(req.params.id, req.user._id);
    if (!notification) return res.status(404).json({ error: 'Notification not found' });
    res.json(notification);
  } catch (err) { next(err); }
});

// Gap #22: Mark all notifications as read
router.put('/read-all', authenticate, async (req, res, next) => {
  try {
    const result = await markAllAsRead(req.user._id);
    res.json({ message: 'All notifications marked as read', modified: result.modifiedCount });
  } catch (err) { next(err); }
});

export default router;
