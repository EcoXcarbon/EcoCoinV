'use strict';
/**
 * Registration payload validation.
 * Returns { ok, errors: [{ path, message }], value } where value is the
 * normalised registration ready to persist.
 */
const countries = require('../data/countries.json');
const education = require('../data/education.json');

const A2 = new Set(countries.map(c => c.alpha2));
const ISCED = new Set(education.iscedLevels.levels.map(l => l.code));
const FIELDS = new Set(education.iscedFields.fields.map(f => f.code));
const CEFR = new Set(education.cefr.map(c => c.code));
const SECTORS = new Set(education.sectors.map(s => s.code));
const TYPES = new Set(education.registrantTypes.map(t => t.code));
const ID_TYPES = Object.fromEntries(education.identityDocumentTypes.map(t => [t.code, t]));
const EVIDENCE = new Set(education.evidenceTypes.map(e => e.code));
const DOC_TYPES = new Set(education.documentTypes.map(d => d.code));
const LANGS = new Set(education.languages.map(l => l.code));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const E164_RE = /^\+[1-9]\d{6,14}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISCO_RE = /^\d{4}$/;
const NAME_RE = /^[\p{L}\p{M}' .\-]{1,80}$/u;
const MAX_PHOTO_BYTES = 400 * 1024;

function str(v, max = 200) {
  if (v === undefined || v === null) return '';
  return String(v).trim().slice(0, max);
}
function isoDate(v) {
  const s = str(v, 10);
  if (!ISO_DATE_RE.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}
function ageAt(dob, at = new Date()) {
  const b = new Date(dob);
  let age = at.getUTCFullYear() - b.getUTCFullYear();
  const m = at.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && at.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

function validateRegistration(input, { partial = false } = {}) {
  const errors = [];
  const err = (path, message) => errors.push({ path, message });
  const body = input && typeof input === 'object' ? input : {};
  const out = {};

  // ── Registrant type ───────────────────────────────────────────────
  out.type = str(body.type, 20).toUpperCase();
  if (!TYPES.has(out.type)) err('type', 'must be one of ' + [...TYPES].join(', '));

  // ── Identity ──────────────────────────────────────────────────────
  const id = body.identity || {};
  const identity = {
    givenNames: str(id.givenNames, 80),
    familyName: str(id.familyName, 80),
    nameNative: str(id.nameNative, 120),
    fatherOrGuardianName: str(id.fatherOrGuardianName, 120),
    dateOfBirth: isoDate(id.dateOfBirth),
    sex: str(id.sex, 1).toUpperCase(),
    nationality: str(id.nationality, 2).toUpperCase(),
    countryOfBirth: str(id.countryOfBirth, 2).toUpperCase(),
    placeOfBirth: str(id.placeOfBirth, 80),
    idDocumentType: str(id.idDocumentType, 20).toUpperCase(),
    idDocumentNumber: str(id.idDocumentNumber, 40).toUpperCase(),
    idDocumentExpiry: id.idDocumentExpiry ? isoDate(id.idDocumentExpiry) : null,
    passportNumber: str(id.passportNumber, 12).toUpperCase().replace(/\s/g, ''),
    passportExpiry: id.passportExpiry ? isoDate(id.passportExpiry) : null,
    photo: typeof id.photo === 'string' ? id.photo : ''
  };
  if (!NAME_RE.test(identity.givenNames)) err('identity.givenNames', 'required, letters only (max 80)');
  if (!NAME_RE.test(identity.familyName)) err('identity.familyName', 'required, letters only (max 80)');
  if (!identity.dateOfBirth) err('identity.dateOfBirth', 'required ISO date YYYY-MM-DD');
  else {
    const age = ageAt(identity.dateOfBirth);
    if (age < 14) err('identity.dateOfBirth', 'registrant must be at least 14 years old (ILO C138 minimum age)');
    if (age > 90) err('identity.dateOfBirth', 'implausible date of birth');
  }
  if (!['M', 'F', 'X'].includes(identity.sex)) err('identity.sex', 'must be M, F or X (ICAO 9303)');
  if (!A2.has(identity.nationality)) err('identity.nationality', 'must be ISO 3166-1 alpha-2');
  if (identity.countryOfBirth && !A2.has(identity.countryOfBirth)) err('identity.countryOfBirth', 'must be ISO 3166-1 alpha-2');
  const idType = ID_TYPES[identity.idDocumentType];
  if (!idType) err('identity.idDocumentType', 'must be one of ' + Object.keys(ID_TYPES).join(', '));
  else {
    if (idType.countries && !idType.countries.includes(identity.nationality)) {
      err('identity.idDocumentType', `${idType.code} is only valid for nationality ${idType.countries.join('/')}`);
    }
    if (!new RegExp(idType.pattern).test(identity.idDocumentNumber)) err('identity.idDocumentNumber', `does not match ${idType.title} format`);
  }
  if (identity.passportNumber && !/^[A-Z0-9]{6,9}$/.test(identity.passportNumber)) err('identity.passportNumber', 'must be 6–9 alphanumeric characters');
  if (identity.passportNumber && !identity.passportExpiry) err('identity.passportExpiry', 'required when passport number is given');
  if (identity.photo) {
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(identity.photo)) err('identity.photo', 'must be a base64 data URL (jpeg/png/webp)');
    else if (Buffer.byteLength(identity.photo, 'utf8') * 0.75 > MAX_PHOTO_BYTES) err('identity.photo', `photo must be under ${MAX_PHOTO_BYTES / 1024} KB`);
  } else if (!partial) err('identity.photo', 'passport-style photo is required');
  out.identity = identity;

  // ── Contact ───────────────────────────────────────────────────────
  const c = body.contact || {};
  const addr = c.address || {};
  const contact = {
    email: str(c.email, 120).toLowerCase(),
    phone: str(c.phone, 20).replace(/[\s()-]/g, ''),
    altPhone: str(c.altPhone, 20).replace(/[\s()-]/g, ''),
    address: {
      line1: str(addr.line1, 120), line2: str(addr.line2, 120), city: str(addr.city, 80),
      region: str(addr.region, 80), postalCode: str(addr.postalCode, 20), country: str(addr.country, 2).toUpperCase()
    },
    emergencyContact: {
      name: str((c.emergencyContact || {}).name, 120),
      relationship: str((c.emergencyContact || {}).relationship, 40),
      phone: str((c.emergencyContact || {}).phone, 20).replace(/[\s()-]/g, '')
    }
  };
  if (!EMAIL_RE.test(contact.email)) err('contact.email', 'valid email required');
  if (!E164_RE.test(contact.phone)) err('contact.phone', 'must be E.164, e.g. +923001234567');
  if (contact.altPhone && !E164_RE.test(contact.altPhone)) err('contact.altPhone', 'must be E.164');
  if (!contact.address.line1) err('contact.address.line1', 'required');
  if (!contact.address.city) err('contact.address.city', 'required');
  if (!A2.has(contact.address.country)) err('contact.address.country', 'must be ISO 3166-1 alpha-2');
  if (contact.emergencyContact.phone && !E164_RE.test(contact.emergencyContact.phone)) err('contact.emergencyContact.phone', 'must be E.164');
  out.contact = contact;

  // ── Education ─────────────────────────────────────────────────────
  const e = body.education || {};
  const edu = {
    highestLevel: str(e.highestLevel, 1),
    field: str(e.field, 2),
    institution: str(e.institution, 160),
    qualificationTitle: str(e.qualificationTitle, 160),
    yearCompleted: e.yearCompleted ? Number(e.yearCompleted) : null,
    // students / apprentices
    currentInstitution: str(e.currentInstitution, 160),
    currentProgramme: str(e.currentProgramme, 160),
    enrollmentNumber: str(e.enrollmentNumber, 60),
    expectedCompletion: e.expectedCompletion ? isoDate(e.expectedCompletion) : null
  };
  if (!ISCED.has(edu.highestLevel)) err('education.highestLevel', 'must be ISCED 2011 level 0–8');
  if (edu.field && !FIELDS.has(edu.field)) err('education.field', 'must be ISCED-F 2013 broad field 00–10');
  if (edu.yearCompleted !== null && (!Number.isInteger(edu.yearCompleted) || edu.yearCompleted < 1950 || edu.yearCompleted > new Date().getUTCFullYear())) err('education.yearCompleted', 'invalid year');
  if (['STUDENT', 'APPRENTICE'].includes(out.type)) {
    if (!edu.currentInstitution) err('education.currentInstitution', 'required for students / apprentices');
    if (!edu.currentProgramme) err('education.currentProgramme', 'required for students / apprentices');
    if (!edu.enrollmentNumber) err('education.enrollmentNumber', 'required for students / apprentices');
  }
  out.education = edu;

  // ── Skills ────────────────────────────────────────────────────────
  const skillsIn = Array.isArray(body.skills) ? body.skills.slice(0, 20) : [];
  const skills = skillsIn.map((s, i) => {
    const sk = {
      iscoCode: str(s.iscoCode, 4),
      title: str(s.title, 120),
      sector: str(s.sector, 30).toLowerCase(),
      nvqfLevel: s.nvqfLevel ? Number(s.nvqfLevel) : null,
      evidenceType: str(s.evidenceType, 20).toUpperCase(),
      certifyingBody: str(s.certifyingBody, 160),
      certificateNumber: str(s.certificateNumber, 80),
      issuedOn: s.issuedOn ? isoDate(s.issuedOn) : null,
      expiresOn: s.expiresOn ? isoDate(s.expiresOn) : null,
      yearsExperience: s.yearsExperience ? Number(s.yearsExperience) : 0,
      primary: Boolean(s.primary)
    };
    if (!ISCO_RE.test(sk.iscoCode)) err(`skills[${i}].iscoCode`, 'must be a 4-digit ISCO-08 unit group');
    if (!sk.title) err(`skills[${i}].title`, 'required');
    if (sk.sector && !SECTORS.has(sk.sector)) err(`skills[${i}].sector`, 'unknown sector');
    if (sk.nvqfLevel !== null && !(Number.isInteger(sk.nvqfLevel) && sk.nvqfLevel >= 1 && sk.nvqfLevel <= 8)) err(`skills[${i}].nvqfLevel`, 'must be 1–8');
    if (!EVIDENCE.has(sk.evidenceType)) err(`skills[${i}].evidenceType`, 'must be one of ' + [...EVIDENCE].join(', '));
    if (['CERTIFICATE', 'LICENCE', 'ASSESSMENT'].includes(sk.evidenceType) && !sk.certifyingBody) err(`skills[${i}].certifyingBody`, 'required for this evidence type');
    if (sk.issuedOn && sk.expiresOn && sk.expiresOn < sk.issuedOn) err(`skills[${i}].expiresOn`, 'expiry before issue date');
    return sk;
  });
  if (skills.length === 0) err('skills', 'at least one skill / occupation is required');
  if (skills.length && !skills.some(s => s.primary)) skills[0].primary = true;
  if (skills.filter(s => s.primary).length > 1) err('skills', 'only one skill may be marked primary');
  out.skills = skills;

  // ── Languages ─────────────────────────────────────────────────────
  const langsIn = Array.isArray(body.languages) ? body.languages.slice(0, 10) : [];
  out.languages = langsIn.map((l, i) => {
    const lang = { code: str(l.code, 3).toLowerCase(), level: str(l.level, 6).toUpperCase() };
    if (!LANGS.has(lang.code)) err(`languages[${i}].code`, 'unknown language code (ISO 639)');
    if (!CEFR.has(lang.level)) err(`languages[${i}].level`, 'must be a CEFR level A1–C2 or NATIVE');
    return lang;
  });

  // ── Experience ────────────────────────────────────────────────────
  const expIn = Array.isArray(body.experience) ? body.experience.slice(0, 20) : [];
  out.experience = expIn.map((x, i) => {
    const w = {
      employer: str(x.employer, 160), country: str(x.country, 2).toUpperCase(), role: str(x.role, 120),
      iscoCode: str(x.iscoCode, 4), from: x.from ? isoDate(x.from) : null, to: x.to ? isoDate(x.to) : null,
      current: Boolean(x.current), referenceContact: str(x.referenceContact, 160)
    };
    if (!w.employer) err(`experience[${i}].employer`, 'required');
    if (!w.role) err(`experience[${i}].role`, 'required');
    if (w.country && !A2.has(w.country)) err(`experience[${i}].country`, 'must be ISO 3166-1 alpha-2');
    if (w.iscoCode && !ISCO_RE.test(w.iscoCode)) err(`experience[${i}].iscoCode`, 'must be 4-digit ISCO-08');
    if (!w.from) err(`experience[${i}].from`, 'start date required');
    if (!w.current && !w.to) err(`experience[${i}].to`, 'end date required unless current');
    if (w.from && w.to && w.to < w.from) err(`experience[${i}].to`, 'end before start');
    return w;
  });

  // ── Documents (metadata only; binaries live in object storage) ────
  const docsIn = Array.isArray(body.documents) ? body.documents.slice(0, 20) : [];
  out.documents = docsIn.map((d, i) => {
    const doc = { type: str(d.type, 20).toUpperCase(), fileName: str(d.fileName, 160), mime: str(d.mime, 60), size: Number(d.size) || 0, sha256: str(d.sha256, 64).toLowerCase(), storageKey: str(d.storageKey, 200) };
    if (!DOC_TYPES.has(doc.type)) err(`documents[${i}].type`, 'unknown document type');
    if (doc.sha256 && !/^[0-9a-f]{64}$/.test(doc.sha256)) err(`documents[${i}].sha256`, 'must be hex SHA-256');
    return doc;
  });

  // ── Consent (GDPR Art. 6/7-style explicit consent) ────────────────
  const k = body.consent || {};
  out.consent = {
    dataProcessing: k.dataProcessing === true,
    crossBorderSharing: k.crossBorderSharing === true,
    employerVerification: k.employerVerification === true,
    declarationTruthful: k.declarationTruthful === true,
    termsVersion: str(k.termsVersion, 20) || '1.0',
    consentedAt: new Date().toISOString()
  };
  if (!out.consent.dataProcessing) err('consent.dataProcessing', 'consent to data processing is required');
  if (!out.consent.declarationTruthful) err('consent.declarationTruthful', 'declaration of truthfulness is required');

  out.channel = str(body.channel, 20).toUpperCase() || 'ONLINE';
  out.preferredLanguage = str(body.preferredLanguage, 3).toLowerCase() || 'en';

  return { ok: errors.length === 0, errors, value: out };
}

module.exports = { validateRegistration, isoDate, ageAt };
