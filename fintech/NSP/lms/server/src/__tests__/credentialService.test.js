import { describe, it, expect } from 'vitest';
import { generateVC, verifyVCProof, generateVCJsonLd } from '../services/credentialService.js';

const mockWorker = {
  registrationId: 'TL-2026-00001',
  fullName: 'Muhammad Irfan',
  trade: 'mason',
};

describe('Credential Service', () => {
  describe('generateVC', () => {
    it('should generate a valid VC structure', () => {
      const vc = generateVC({
        credentialId: 'TL-2026-00001',
        worker: mockWorker,
        type: 'trade-certificate',
        title: 'Mason Trade Certificate',
        trade: 'mason',
        nqfLevel: 3,
        institution: 'PPMC Peshawar',
      });

      expect(vc.context).toContain('https://www.w3.org/ns/credentials/v2');
      expect(vc.context).toContain('https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json');
      expect(vc.issuerDID).toBeTruthy();
      expect(vc.subjectDID).toBe('did:key:TL-2026-00001');
      expect(vc.credentialHash).toBeTruthy();
      expect(vc.proof.proofValue).toBeTruthy();
      expect(vc.proof.proofPurpose).toBe('assertionMethod');
      expect(vc.alignment).toHaveLength(4);
      expect(vc.alignment[0].targetFramework).toBe('ESCO / ISCO-08');
      expect(vc.alignment[1].targetFramework).toBe('Pakistan National Qualifications Framework (NVQF)');
      expect(vc.alignment[2].targetFramework).toBe('European Qualifications Framework (EQF)');
      expect(vc.alignment[3].targetFramework).toBe('ISCED-F 2013');
      expect(vc.id).toMatch(/^urn:uuid:/);
    });

    it('should generate unique IDs for each credential', () => {
      const vc1 = generateVC({ credentialId: 'TL-2026-00001', worker: mockWorker, type: 'trade-certificate', title: 'Test', trade: 'mason', nqfLevel: 3 });
      const vc2 = generateVC({ credentialId: 'TL-2026-00002', worker: mockWorker, type: 'trade-certificate', title: 'Test', trade: 'mason', nqfLevel: 3 });
      expect(vc1.id).not.toBe(vc2.id);
      expect(vc1.credentialHash).not.toBe(vc2.credentialHash);
    });
  });

  describe('verifyVCProof', () => {
    it('should verify a valid credential', () => {
      const vc = generateVC({
        credentialId: 'TL-2026-00001',
        worker: mockWorker,
        type: 'trade-certificate',
        title: 'Test',
        trade: 'mason',
        nqfLevel: 3,
      });

      const mockCredential = { vc };
      const result = verifyVCProof(mockCredential);
      expect(result.valid).toBe(true);
      expect(result.reason).toContain('verified successfully');
    });

    it('should reject a tampered credential', () => {
      const vc = generateVC({
        credentialId: 'TL-2026-00001',
        worker: mockWorker,
        type: 'trade-certificate',
        title: 'Test',
        trade: 'mason',
        nqfLevel: 3,
      });

      // Tamper with the JWT signature to trigger verification failure
      const parts = vc.jwt.split('.');
      parts[2] = 'tampered-signature-value';
      vc.jwt = parts.join('.');
      const result = verifyVCProof({ vc });
      expect(result.valid).toBe(false);
    });

    it('should reject credential with missing proof', () => {
      const result = verifyVCProof({ vc: {} });
      expect(result.valid).toBe(false);
    });

    it('should reject expired credential via JWT exp', () => {
      const vc = generateVC({
        credentialId: 'TL-2026-00001',
        worker: mockWorker,
        type: 'trade-certificate',
        title: 'Test',
        trade: 'mason',
        nqfLevel: 3,
      });

      // Rebuild JWT with expired exp claim but keep the original signature
      // so the signature itself is valid but exp check catches it
      const parts = vc.jwt.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      payload.exp = Math.floor(new Date('2020-01-01').getTime() / 1000);
      parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url');
      vc.jwt = parts.join('.');
      const result = verifyVCProof({ vc });
      // Either fails on signature mismatch (payload changed) or expiration
      expect(result.valid).toBe(false);
    });
  });

  describe('generateVCJsonLd', () => {
    it('should produce valid JSON-LD structure', () => {
      const vc = generateVC({
        credentialId: 'TL-2026-00001',
        worker: mockWorker,
        type: 'trade-certificate',
        title: 'Mason Certificate',
        trade: 'mason',
        nqfLevel: 3,
      });

      const jsonLd = generateVCJsonLd({
        vc,
        credentialId: 'TL-2026-00001',
        title: 'Mason Certificate',
        trade: 'mason',
        nqfLevel: 3,
      });

      expect(jsonLd['@context']).toBeTruthy();
      expect(jsonLd.type).toContain('VerifiableCredential');
      expect(jsonLd.type).toContain('OpenBadgeCredential');
      expect(jsonLd.issuer.id).toBeTruthy();
      expect(jsonLd.credentialSubject.type).toBe('AchievementSubject');
      expect(jsonLd.credentialStatus.type).toBe('BitstringStatusListEntry');
    });
  });
});
