import { describe, it, expect, vi } from 'vitest';
import { handleValidation } from '../middleware/validate.js';
import { validationResult } from 'express-validator';

vi.mock('express-validator', () => ({
  validationResult: vi.fn(),
}));

describe('handleValidation middleware', () => {
  it('should call next() when no errors', () => {
    validationResult.mockReturnValue({
      isEmpty: () => true,
      array: () => [],
    });

    const req = {};
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    handleValidation(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should return 400 with errors when validation fails', () => {
    validationResult.mockReturnValue({
      isEmpty: () => false,
      array: () => [{ path: 'email', msg: 'Invalid email' }],
    });

    const req = {};
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    handleValidation(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Validation failed',
      details: [{ field: 'email', message: 'Invalid email' }],
    });
  });
});
