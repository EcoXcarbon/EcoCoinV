'use strict';
/**
 * Registry service: the only place that changes registrant state.
 *
 *  Lifecycle
 *  ─────────
 *   SUBMITTED ──review──▶ UNDER_REVIEW ──verify──▶ VERIFIED ──issue──▶ ISSUED
 *       │                     │                        │                 │
 *       └──────reject─────────┴───────▶ REJECTED       │      suspend ◀──┼──▶ SUSPENDED ──reinstate──▶ ISSUED
 *                                                      │                 │
 *                                                      └── revoke ───────┴──▶ REVOKED   (terminal)
 *                                                                        └──▶ EXPIRED   (by clock; renewable via re-issue)
 */
const countries = require('../data/countries.json');
const occupations = require('../data/occupations.json');
const education = require('../data/education.json');
const { formatNspId } = require('./nspId');
const { buildMrz } = require('./mrz');
const signer = require('./signer');
const { validateRegistration } = require('./validation');
const dedup = require('./dedup');

const A3 = Object.fromEntries(countries.map(c => [c.alpha2, c.alpha3]));
const NAME = Object.fromEntries(countries.map(c => [c.alpha2, c.name]));
const ISCO = Object.fromEntries(occupations.unitGroups.map(u => [u.code, u.title]));
const NVQF = Object.fromEntries(education.qualificationLevels.levels.map(l => [l.nvqf, l]));

const TRANSITIONS = {
  REVIEW:    { from: ['SUBMITTED'], to: 'UNDER_REVIEW' },
  VERIFY:    { from: ['SUBMITTED', 'UNDER_REVIEW'], to: 'VERIFIED' },
  REJECT:    { from: ['SUBMITTED', 'UNDER_REVIEW'], to: 'REJECTED' },
  ISSUE:     { from: ['VERIFIED', 'EXPIRED'], to: 'ISSUED' },
  SUSPEND:   { from: ['ISSUED'], to: 'SUSPENDED' },
  REINSTATE: { from: ['SUSPENDED'], to: 'ISSUED' },
  REVOKE:    { from: ['VERIFIED', 'ISSUED', 'SUSPENDED', 'EXPIRED'], to: 'REVOKED' },
  EXPIRE:    { from: ['ISSUED'], to: 'EXPIRED' }
};

class RegistryError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

class Registry {
  constructor(store, config) {
    this.store = store;
    this.config = config;
    signer.loadKeys(config.dataDir);
  }

  // ── registration ─────────────────────────────────────────────────
  register(input, actor = 'applicant', context = {}) {
    const { ok, errors, value } = validateRegistration(input);
    if (!ok) throw new RegistryError(422, 'Validation failed', errors);

    // Hard block: the same identity document twice.
    const dup = this.store.findByIdentity(value.identity.nationality, value.identity.idDocumentType, value.identity.idDocumentNumber);
    if (dup) throw new RegistryError(409, `An NSP record already exists for this identity document (${dup.nspId})`, { nspId: dup.nspId, status: dup.status });

    // Soft signal: the same PERSON under a different document. Recorded on the
    // record for the registrar rather than refused, because genuine namesakes
    // sharing a date of birth do exist and refusing them would exclude real
    // applicants. See lib/dedup.js.
    const applicant = {
      nameKey: dedup.nameKey(value.identity.givenNames, value.identity.familyName),
      fatherKey: dedup.nameKey(value.identity.fatherOrGuardianName),
      dateOfBirth: value.identity.dateOfBirth,
      phone: value.contact.phone,
      email: value.contact.email
    };
    const flags = this.duplicateFlags(applicant);

    const year = new Date().getUTCFullYear();
    const seq = this.store.nextSequence(this.config.issuer.country, year);
    const nspId = formatNspId(this.config.issuer.country, year, seq);
    const reg = this.store.insertRegistrant(nspId, value, 'SUBMITTED');

    // A verified mobile establishes assurance tier NSP-1 (proof of control of
    // a biometrically-issued SIM). NSP-2 is only reached when a registrar
    // sights the identity document — see the VERIFY transition.
    this.store.setGateColumns(nspId, {
      nameKey: applicant.nameKey,
      fatherKey: applicant.fatherKey,
      assuranceTier: 'NSP-1',
      phoneVerified: !!context.phoneVerified,
      dedupFlags: flags,
      registeredIp: context.ip
    });
    this.store.recordRegistrationEvent({
      nspId, ip: context.ip, phone: value.contact.phone, district: value.contact.address.region || null
    });
    this.store.audit(actor, 'REGISTER', nspId, {
      type: value.type, channel: value.channel,
      phoneVerified: !!context.phoneVerified, ip: context.ip || null,
      duplicateFlags: flags.length || undefined
    });
    if (flags.length) this.store.audit('system', 'DEDUP_FLAG', nspId, { candidates: flags });
    return this.store.getRegistrant(nspId);
  }

  /** Scored possible-duplicate candidates above the review threshold. */
  duplicateFlags(applicant, excludeNspId) {
    const threshold = this.config.dedupThreshold ?? 50;
    return this.store
      .findDuplicateCandidates({ ...applicant, excludeNspId })
      .map(c => ({ ...dedup.scoreCandidate(applicant, c), nspId: c.nspId, status: c.status }))
      .filter(c => c.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }

  update(nspId, input, actor) {
    const current = this.mustGet(nspId);
    if (['REVOKED', 'REJECTED'].includes(current.status)) throw new RegistryError(409, `Record is ${current.status} and cannot be edited`);
    const { ok, errors, value } = validateRegistration(input);
    if (!ok) throw new RegistryError(422, 'Validation failed', errors);
    if (value.identity.idDocumentNumber !== current.identity.idDocumentNumber || value.identity.idDocumentType !== current.identity.idDocumentType) {
      const dup = this.store.findByIdentity(value.identity.nationality, value.identity.idDocumentType, value.identity.idDocumentNumber);
      if (dup && dup.nspId !== nspId) throw new RegistryError(409, 'Identity document already registered', { nspId: dup.nspId });
    }
    value.consent = current.consent; // consent is immutable once given
    const reg = this.store.updatePayload(nspId, value);
    this.store.audit(actor, 'UPDATE', nspId, { fields: Object.keys(input || {}) });
    return reg;
  }

  transition(nspId, action, actor, { reason } = {}) {
    const t = TRANSITIONS[action];
    if (!t) throw new RegistryError(400, `Unknown action ${action}`);
    const reg = this.mustGet(nspId);
    if (!t.from.includes(reg.status)) throw new RegistryError(409, `Cannot ${action} a record in status ${reg.status}`, { allowed: t.from });
    const now = new Date().toISOString();
    const extra = {};
    if (action === 'VERIFY') {
      extra.verified_at = now; extra.verified_by = actor;
      // The registrar has sighted the identity document in person: this is
      // what lifts the record from self-declared (NSP-1) to verified (NSP-2).
      extra.assurance_tier = 'NSP-2';
    }
    if (action === 'REJECT') { if (!reason) throw new RegistryError(400, 'reason is required'); extra.rejected_reason = reason; }
    if (action === 'ISSUE') {
      // Four eyes: whoever verified a record may not also issue it. Issuance
      // is the point at which a credential becomes trusted by third parties,
      // so it must involve a second person. Deployments with a single
      // registrar can disable this deliberately via NSP_FOUR_EYES=0 — an
      // explicit choice, recorded here rather than an accident.
      if (this.config.fourEyes && reg.registry.verifiedBy && reg.registry.verifiedBy === actor) {
        throw new RegistryError(409,
          'Four-eyes control: this record was verified by you and must be issued by a different registry officer',
          { verifiedBy: reg.registry.verifiedBy });
      }
      extra.issued_at = now;
      extra.issued_by = actor;
      extra.expires_at = this.expiryFrom(now);
      extra.suspended_at = null;
    }
    if (action === 'SUSPEND') { if (!reason) throw new RegistryError(400, 'reason is required'); extra.suspended_at = now; }
    if (action === 'REINSTATE') extra.suspended_at = null;
    if (action === 'REVOKE') {
      if (!reason) throw new RegistryError(400, 'reason is required');
      extra.revoked_at = now; extra.revoke_reason = reason;
      this.store.revokeCredentials(nspId);
    }
    const updated = this.store.setStatus(nspId, t.to, extra);
    this.store.audit(actor, action, nspId, reason ? { reason } : null);
    return updated;
  }

  expiryFrom(isoNow) {
    const d = new Date(isoNow);
    d.setUTCFullYear(d.getUTCFullYear() + this.config.cardValidityYears);
    return d.toISOString().slice(0, 10);
  }

  mustGet(nspId) {
    const reg = this.store.getRegistrant(nspId);
    if (!reg) throw new RegistryError(404, 'NSP record not found');
    return reg;
  }

  /** Applies clock-based expiry lazily on read. */
  getFresh(nspId) {
    const reg = this.mustGet(nspId);
    if (reg.status === 'ISSUED' && reg.registry.expiresAt && reg.registry.expiresAt < new Date().toISOString().slice(0, 10)) {
      return this.transition(nspId, 'EXPIRE', 'system');
    }
    return reg;
  }

  // ── credentials ──────────────────────────────────────────────────
  issueCard(nspId, actor) {
    let reg = this.getFresh(nspId);
    if (reg.status === 'VERIFIED' || reg.status === 'EXPIRED') reg = this.transition(nspId, 'ISSUE', actor);
    if (reg.status !== 'ISSUED') throw new RegistryError(409, `Card can only be issued for VERIFIED/ISSUED records (current: ${reg.status})`);
    const serial = this.nextSerial('CARD');
    const issuedAt = new Date().toISOString();
    const expiresAt = reg.registry.expiresAt;
    const primary = reg.skills.find(s => s.primary) || reg.skills[0];
    const token = signer.issueToken(this.tokenPayload(reg, serial, 'C', expiresAt));
    const mrz = buildMrz({
      issuerAlpha3: A3[this.config.issuer.country], nspId, familyName: reg.identity.familyName, givenNames: reg.identity.givenNames,
      dateOfBirth: reg.identity.dateOfBirth, sex: reg.identity.sex, expiry: expiresAt, nationalityAlpha3: A3[reg.identity.nationality], cardSerial: serial
    });
    const payload = {
      serial, nspId, kind: 'CARD',
      holder: this.holderSummary(reg),
      primarySkill: primary ? { iscoCode: primary.iscoCode, title: primary.title, nvqfLevel: primary.nvqfLevel, eqfLevel: primary.nvqfLevel ? NVQF[primary.nvqfLevel].eqf : null, sector: primary.sector } : null,
      skillCount: reg.skills.length,
      skillsBack: [...reg.skills].sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0)).slice(0, 4).map(s => ({ iscoCode: s.iscoCode, title: s.title, nvqfLevel: s.nvqfLevel })),
      issuedAt, expiresAt,
      issuer: this.issuerBlock(),
      mrz,
      verifyUrl: this.verifyUrl(nspId, token),
      token
    };
    const cred = this.store.insertCredential({ serial, nspId, kind: 'CARD', issuedAt, expiresAt, token, payload });
    this.store.audit(actor, 'ISSUE_CARD', nspId, { serial });
    return cred;
  }

  issueCertificate(nspId, actor) {
    const reg = this.getFresh(nspId);
    if (!['ISSUED', 'VERIFIED'].includes(reg.status)) throw new RegistryError(409, `Certificate requires a VERIFIED/ISSUED record (current: ${reg.status})`);
    const serial = this.nextSerial('CERTIFICATE');
    const issuedAt = new Date().toISOString();
    const expiresAt = reg.registry.expiresAt || this.expiryFrom(issuedAt);
    const token = signer.issueToken(this.tokenPayload(reg, serial, 'T', expiresAt));
    const card = this.store.activeCredential(nspId, 'CARD');
    const payload = {
      serial, nspId, kind: 'CERTIFICATE',
      holder: this.holderSummary(reg),
      skills: reg.skills.map(s => ({
        iscoCode: s.iscoCode, title: s.title, sector: s.sector, nvqfLevel: s.nvqfLevel,
        eqfLevel: s.nvqfLevel ? NVQF[s.nvqfLevel].eqf : null, evidenceType: s.evidenceType,
        certifyingBody: s.certifyingBody, certificateNumber: s.certificateNumber, issuedOn: s.issuedOn, expiresOn: s.expiresOn, primary: s.primary
      })),
      languages: reg.languages,
      education: { highestLevel: reg.education.highestLevel, highestLevelTitle: education.iscedLevels.levels.find(l => l.code === reg.education.highestLevel)?.title, institution: reg.education.institution || reg.education.currentInstitution, qualificationTitle: reg.education.qualificationTitle || reg.education.currentProgramme },
      cardSerial: card ? card.serial : null,
      registrationDate: reg.registry.submittedAt || reg.registry.createdAt,
      verifiedAt: reg.registry.verifiedAt, verifiedBy: reg.registry.verifiedBy,
      issuedAt, expiresAt,
      issuer: this.issuerBlock(),
      verifyUrl: this.verifyUrl(nspId, token),
      token,
      credentialHash: signer.canonicalize({ nspId, serial, issuedAt, skills: reg.skills.map(s => s.iscoCode) })
    };
    payload.credentialHash = require('node:crypto').createHash('sha256').update(payload.credentialHash).digest('hex');
    const cred = this.store.insertCredential({ serial, nspId, kind: 'CERTIFICATE', issuedAt, expiresAt, token, payload });
    this.store.audit(actor, 'ISSUE_CERTIFICATE', nspId, { serial });
    return cred;
  }

  nextSerial(kind) {
    const yy = String(new Date().getUTCFullYear() % 100).padStart(2, '0');
    const n = this.store.countCredentials(kind) + 1;
    return kind === 'CARD' ? `C${yy}${String(n).padStart(7, '0')}` : `NSP-CERT-${yy}-${String(n).padStart(7, '0')}`;
  }

  tokenPayload(reg, serial, kind, expiresAt) {
    const primary = reg.skills.find(s => s.primary) || reg.skills[0];
    // Deliberately minimal: no date of birth or ID number inside the QR (privacy);
    // enough to bind the signature to the printed face (name, occupation, expiry).
    return {
      v: 1, i: reg.nspId, s: serial, k: kind, e: expiresAt.replace(/-/g, ''),
      n: `${reg.identity.familyName}, ${reg.identity.givenNames}`.toUpperCase().slice(0, 40),
      o: primary ? primary.iscoCode : null
    };
  }

  verifyUrl(nspId, token) {
    return `${this.config.publicUrl}/verify/${nspId}?t=${token}`;
  }

  holderSummary(reg) {
    return {
      nspId: reg.nspId, type: reg.type,
      givenNames: reg.identity.givenNames, familyName: reg.identity.familyName, nameNative: reg.identity.nameNative,
      fullName: `${reg.identity.givenNames} ${reg.identity.familyName}`,
      dateOfBirth: reg.identity.dateOfBirth, sex: reg.identity.sex,
      nationality: reg.identity.nationality, nationalityAlpha3: A3[reg.identity.nationality], nationalityName: NAME[reg.identity.nationality],
      idDocumentType: reg.identity.idDocumentType, idDocumentMasked: maskId(reg.identity.idDocumentNumber),
      photo: reg.identity.photo || null
    };
  }

  issuerBlock() {
    const i = this.config.issuer;
    return { country: i.country, countryAlpha3: A3[i.country], countryName: NAME[i.country], name: i.name, shortName: i.shortName, authority: i.authority, did: i.did, registrar: i.registrar, keyId: signer.keyId() };
  }

  // ── verification (public) ─────────────────────────────────────────
  verify({ nspId, token, serial }, meta = {}) {
    let result;
    try {
      let reg = null, cred = null;
      if (serial) {
        cred = this.store.getCredential(serial);
        if (!cred) return this.verifyResult('NOT_FOUND', null, null, meta);
        nspId = cred.nspId;
      }
      reg = this.store.getRegistrant(nspId);
      if (!reg) return this.verifyResult('NOT_FOUND', null, null, meta);
      reg = this.getFresh(nspId);
      let tokenCheck = null;
      if (token) {
        const t = signer.verifyToken(token);
        if (!t.valid) return this.verifyResult('INVALID_SIGNATURE', reg, null, meta);
        if (t.payload.i !== reg.nspId) return this.verifyResult('TOKEN_MISMATCH', reg, null, meta);
        cred = cred || this.store.getCredential(t.payload.s);
        tokenCheck = t.payload;
      }
      if (cred && cred.status !== 'ACTIVE') result = cred.status === 'REPLACED' ? 'CREDENTIAL_REPLACED' : 'CREDENTIAL_REVOKED';
      else if (reg.status === 'ISSUED') result = 'VALID';
      else if (reg.status === 'SUSPENDED') result = 'SUSPENDED';
      else if (reg.status === 'REVOKED') result = 'REVOKED';
      else if (reg.status === 'EXPIRED') result = 'EXPIRED';
      else result = 'NOT_ISSUED';
      return this.verifyResult(result, reg, cred, meta, tokenCheck);
    } catch (e) {
      if (e instanceof RegistryError && e.status === 404) return this.verifyResult('NOT_FOUND', null, null, meta);
      throw e;
    }
  }

  verifyResult(result, reg, cred, meta, tokenPayload) {
    this.store.logVerification(reg ? reg.nspId : null, result, meta.ip, meta.userAgent);
    const publicView = reg && !['NOT_FOUND'].includes(result) ? {
      nspId: reg.nspId, status: reg.status, type: reg.type,
      holder: { givenNames: reg.identity.givenNames, familyName: reg.identity.familyName, nationality: reg.identity.nationality, nationalityName: NAME[reg.identity.nationality], dateOfBirthYear: reg.identity.dateOfBirth.slice(0, 4), photo: reg.identity.photo || null },
      skills: reg.skills.map(s => ({ iscoCode: s.iscoCode, title: s.title, sector: s.sector, nvqfLevel: s.nvqfLevel, eqfLevel: s.nvqfLevel ? NVQF[s.nvqfLevel].eqf : null, evidenceType: s.evidenceType, certifyingBody: s.certifyingBody, primary: s.primary })),
      languages: reg.languages,
      issuedAt: reg.registry.issuedAt, expiresAt: reg.registry.expiresAt, verifiedAt: reg.registry.verifiedAt,
      credential: cred ? { serial: cred.serial, kind: cred.kind, status: cred.status, issuedAt: cred.issuedAt, expiresAt: cred.expiresAt } : null,
      signatureChecked: Boolean(tokenPayload)
    } : null;
    return { result, valid: result === 'VALID', checkedAt: new Date().toISOString(), issuer: this.issuerBlock(), record: publicView };
  }

  // ── W3C Verifiable Credential export ──────────────────────────────
  verifiableCredential(nspId) {
    const reg = this.getFresh(nspId);
    if (!['ISSUED', 'VERIFIED'].includes(reg.status)) throw new RegistryError(409, 'Credential is only available for VERIFIED/ISSUED records');
    const i = this.config.issuer;
    const vm = `${i.did}#key-${signer.keyId()}`;
    const vc = {
      '@context': ['https://www.w3.org/ns/credentials/v2', { nsp: `${this.config.publicUrl}/vocab#` }],
      id: `${this.config.publicUrl}/credentials/${nspId}`,
      type: ['VerifiableCredential', 'SkillsPassportCredential'],
      issuer: { id: i.did, name: i.name },
      validFrom: reg.registry.issuedAt || reg.registry.verifiedAt,
      validUntil: reg.registry.expiresAt ? `${reg.registry.expiresAt}T23:59:59Z` : undefined,
      credentialStatus: { id: `${this.config.publicUrl}/api/v1/verify/${nspId}`, type: 'NspRegistryStatus' },
      credentialSubject: {
        id: `urn:nsp:${nspId}`,
        'nsp:registrantType': reg.type,
        givenName: reg.identity.givenNames, familyName: reg.identity.familyName,
        birthDate: reg.identity.dateOfBirth, nationality: reg.identity.nationality,
        'nsp:skills': reg.skills.map(s => ({ 'nsp:iscoCode': s.iscoCode, name: s.title, 'nsp:nvqfLevel': s.nvqfLevel, 'nsp:eqfLevel': s.nvqfLevel ? NVQF[s.nvqfLevel].eqf : null, 'nsp:evidenceType': s.evidenceType, 'nsp:certifyingBody': s.certifyingBody || undefined })),
        'nsp:languages': reg.languages.map(l => ({ 'nsp:language': l.code, 'nsp:cefr': l.level })),
        'nsp:educationLevelISCED': reg.education.highestLevel
      }
    };
    return signer.signCredential(JSON.parse(JSON.stringify(vc)), vm);
  }

  issuerDocument() {
    const i = this.config.issuer;
    const id = `${i.did}#key-${signer.keyId()}`;
    return {
      '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/multikey/v1'],
      id: i.did, name: i.name, authority: i.authority,
      verificationMethod: [{ id, type: 'Multikey', controller: i.did, publicKeyMultibase: signer.publicKeyMultibase(), publicKeyJwk: signer.publicKeyJwk() }],
      assertionMethod: [id],
      service: [{ id: `${i.did}#verify`, type: 'NspVerification', serviceEndpoint: `${this.config.publicUrl}/api/v1/verify` }]
    };
  }

  referenceData() {
    return { countries, occupations, ...education };
  }
}

function maskId(n) {
  if (!n) return '';
  const clean = String(n);
  return clean.length <= 4 ? clean : '•'.repeat(Math.max(0, clean.length - 4)).slice(0, 12) + clean.slice(-4);
}

module.exports = { Registry, RegistryError, TRANSITIONS, ISCO };
