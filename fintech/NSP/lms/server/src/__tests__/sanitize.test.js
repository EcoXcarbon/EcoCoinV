import { describe, it, expect } from 'vitest';
import { escapeRegex, sanitizeInput } from '../middleware/sanitize.js';

describe('Sanitize middleware', () => {
  describe('escapeRegex', () => {
    it('should escape regex special characters', () => {
      expect(escapeRegex('test.value')).toBe('test\\.value');
      expect(escapeRegex('a*b+c?')).toBe('a\\*b\\+c\\?');
      expect(escapeRegex('(group)[class]')).toBe('\\(group\\)\\[class\\]');
      expect(escapeRegex('$dollar^caret')).toBe('\\$dollar\\^caret');
    });

    it('should not modify safe strings', () => {
      expect(escapeRegex('Muhammad Irfan')).toBe('Muhammad Irfan');
      // Hyphens are not regex-special outside character classes, but our escaper is conservative
      expect(escapeRegex('TL-2026-00001')).toBe('TL-2026-00001');
    });
  });

  describe('sanitizeInput', () => {
    it('should strip $-prefixed keys from body', () => {
      const req = {
        body: { name: 'test', $gt: 100, nested: { $ne: null } },
        query: {},
      };
      const next = () => {};
      sanitizeInput(req, {}, next);
      expect(req.body).toEqual({ name: 'test', nested: {} });
    });

    it('should strip $-prefixed keys from query', () => {
      const req = {
        body: {},
        query: { status: 'active', $regex: '.*' },
      };
      const next = () => {};
      sanitizeInput(req, {}, next);
      expect(req.query).toEqual({ status: 'active' });
    });

    it('should handle arrays in body', () => {
      const req = {
        body: { items: [{ skill: 'test', $set: true }] },
        query: {},
      };
      const next = () => {};
      sanitizeInput(req, {}, next);
      expect(req.body.items[0]).toEqual({ skill: 'test' });
    });

    it('should pass through clean data unchanged', () => {
      const req = {
        body: { name: 'test', age: 25 },
        query: { page: '1' },
      };
      const next = () => {};
      sanitizeInput(req, {}, next);
      expect(req.body).toEqual({ name: 'test', age: 25 });
      expect(req.query).toEqual({ page: '1' });
    });
  });
});
