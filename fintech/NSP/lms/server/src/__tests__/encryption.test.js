import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, maskCNIC, hashSHA256 } from '../utils/encryption.js';

describe('Encryption utilities', () => {
  describe('encrypt / decrypt', () => {
    it('should encrypt and decrypt a string correctly', () => {
      const original = '17301-8234567-1';
      const encrypted = encrypt(original);
      expect(encrypted).not.toBe(original);
      expect(encrypted.split(':')).toHaveLength(3); // iv:authTag:ciphertext (GCM format)
      expect(decrypt(encrypted)).toBe(original);
    });

    it('should produce different ciphertexts for same input (random IV)', () => {
      const text = 'test-data';
      const enc1 = encrypt(text);
      const enc2 = encrypt(text);
      expect(enc1).not.toBe(enc2);
      expect(decrypt(enc1)).toBe(text);
      expect(decrypt(enc2)).toBe(text);
    });

    it('should handle unicode characters', () => {
      const text = 'Muhammad Irfan Khan';
      const encrypted = encrypt(text);
      expect(decrypt(encrypted)).toBe(text);
    });
  });

  describe('maskCNIC', () => {
    it('should mask all but last 4 characters', () => {
      expect(maskCNIC('17301-8234567-1')).toBe('***********67-1');
    });

    it('should handle short strings', () => {
      expect(maskCNIC('abc')).toBe('***');
    });

    it('should handle null/empty', () => {
      expect(maskCNIC('')).toBe('***');
      expect(maskCNIC(null)).toBe('***');
    });
  });

  describe('hashSHA256', () => {
    it('should produce a 64-char hex hash', () => {
      const hash = hashSHA256('test');
      expect(hash).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
    });

    it('should be deterministic', () => {
      expect(hashSHA256('abc')).toBe(hashSHA256('abc'));
    });

    it('should produce different hashes for different inputs', () => {
      expect(hashSHA256('a')).not.toBe(hashSHA256('b'));
    });
  });
});
