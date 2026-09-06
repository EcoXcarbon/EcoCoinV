import { validationResult } from 'express-validator';

/**
 * Middleware that checks express-validator results and returns 400 on failure.
 */
export function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array().map(e => ({ field: e.path, message: e.msg })),
    });
  }
  next();
}
