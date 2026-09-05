'use strict';
/* Seeds the local registry with sample records covering every lifecycle stage. Never run against production. */
const config = require('./config');
const { Store } = require('./lib/store');
const { Registry } = require('./lib/registry');

// 210×270 neutral silhouette PNG so no real face is ever seeded
const photo = 'data:image/png;base64,' + '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';
const base = (over) => ({
  type: 'WORKER',
  identity: { givenNames: 'Muhammad Ali', familyName: 'Khan', nameNative: 'محمد علی خان', dateOfBirth: '1998-04-12', sex: 'M', nationality: 'PK', countryOfBirth: 'PK', idDocumentType: 'CNIC', idDocumentNumber: '17301-1234567-1', passportNumber: 'AB1234567', passportExpiry: '2031-01-01', photo },
  contact: { email: 'ali.khan@example.com', phone: '+923001234567', address: { line1: 'House 12, Street 4, Hayatabad', city: 'Peshawar', region: 'Khyber Pakhtunkhwa', postalCode: '25000', country: 'PK' }, emergencyContact: { name: 'Zainab Khan', relationship: 'Sister', phone: '+923009876543' } },
  education: { highestLevel: '4', field: '07', institution: 'Government College of Technology, Peshawar', qualificationTitle: 'DAE Civil Technology', yearCompleted: 2018 },
  skills: [
    { iscoCode: '7126', title: 'Plumber and pipe fitter', sector: 'construction', nvqfLevel: 3, evidenceType: 'CERTIFICATE', certifyingBody: 'NAVTTC', certificateNumber: 'NV-2021-00887', issuedOn: '2021-06-01', yearsExperience: 6, primary: true },
    { iscoCode: '7212', title: 'Welder and flame cutter (SMAW)', sector: 'construction', nvqfLevel: 2, evidenceType: 'ASSESSMENT', certifyingBody: 'TEVTA Khyber Pakhtunkhwa', issuedOn: '2022-11-14' },
    { iscoCode: '7127', title: 'Air conditioning and refrigeration mechanic', sector: 'construction', evidenceType: 'EXPERIENCE', certifyingBody: 'Frontier Works Organization' }
  ],
  languages: [{ code: 'ur', level: 'NATIVE' }, { code: 'en', level: 'B1' }, { code: 'ar', level: 'A2' }],
  experience: [{ employer: 'Frontier Works Organization', country: 'PK', role: 'Plumber', iscoCode: '7126', from: '2019-01-01', current: true, referenceContact: 'Site engineer, +92 300 1112222' }],
  documents: [{ type: 'ID_FRONT', fileName: 'cnic-front.jpg', mime: 'image/jpeg', size: 240000, sha256: 'a'.repeat(64) }],
  consent: { dataProcessing: true, employerVerification: true, crossBorderSharing: true, declarationTruthful: true },
  ...over
});
const people = [
  base({}),
  base({ type: 'STUDENT', identity: { givenNames: 'Ayesha', familyName: 'Siddiqui', dateOfBirth: '2005-09-30', sex: 'F', nationality: 'PK', idDocumentType: 'CNIC', idDocumentNumber: '42201-7654321-2', photo },
    contact: { email: 'ayesha.s@example.com', phone: '+923211234567', address: { line1: 'Flat 3B, Clifton Block 5', city: 'Karachi', region: 'Sindh', country: 'PK' } },
    education: { highestLevel: '3', field: '06', currentInstitution: 'Aptech Karachi', currentProgramme: 'Diploma in Software Engineering', enrollmentNumber: 'APT-2025-1187', expectedCompletion: '2027-06-30' },
    skills: [{ iscoCode: '2513', title: 'Web and multimedia developer', sector: 'ict', nvqfLevel: 4, evidenceType: 'CERTIFICATE', certifyingBody: 'Aptech', certificateNumber: 'APT-WD-2026-04', issuedOn: '2026-03-01', primary: true }],
    languages: [{ code: 'ur', level: 'NATIVE' }, { code: 'en', level: 'B2' }], experience: [] }),
  base({ type: 'PROFESSIONAL', identity: { givenNames: 'Bilal', familyName: 'Ahmed', dateOfBirth: '1989-02-14', sex: 'M', nationality: 'PK', idDocumentType: 'PASSPORT', idDocumentNumber: 'CK9988776', passportNumber: 'CK9988776', passportExpiry: '2032-05-05', photo },
    contact: { email: 'bilal.ahmed@example.com', phone: '+971501234567', address: { line1: 'Al Nahda 2', city: 'Dubai', country: 'AE' } },
    education: { highestLevel: '6', field: '07', institution: 'UET Lahore', qualificationTitle: 'BSc Civil Engineering', yearCompleted: 2011 },
    skills: [{ iscoCode: '2142', title: 'Civil engineer', sector: 'construction', nvqfLevel: 6, evidenceType: 'LICENCE', certifyingBody: 'Pakistan Engineering Council', certificateNumber: 'CIVIL/45210', issuedOn: '2012-01-10', primary: true }, { iscoCode: '1323', title: 'Construction manager', sector: 'construction', nvqfLevel: 6, evidenceType: 'EXPERIENCE', certifyingBody: 'Arabtec' }],
    languages: [{ code: 'ur', level: 'NATIVE' }, { code: 'en', level: 'C1' }, { code: 'ar', level: 'B1' }],
    experience: [{ employer: 'Arabtec Construction', country: 'AE', role: 'Project Engineer', iscoCode: '2142', from: '2015-03-01', current: true }] }),
  base({ type: 'APPRENTICE', identity: { givenNames: 'Hassan', familyName: 'Raza', dateOfBirth: '2007-01-20', sex: 'M', nationality: 'PK', idDocumentType: 'CNIC', idDocumentNumber: '35202-1122334-5', photo },
    contact: { email: 'hassan.raza@example.com', phone: '+923451234567', address: { line1: 'Mohallah Sadiqabad', city: 'Lahore', region: 'Punjab', country: 'PK' } },
    education: { highestLevel: '2', currentInstitution: 'TEVTA Lahore', currentProgramme: 'Electrician (NVQF L2)', enrollmentNumber: 'TV-LHR-9921', expectedCompletion: '2027-03-31' },
    skills: [{ iscoCode: '7411', title: 'Building electrician (trainee)', sector: 'construction', nvqfLevel: 1, evidenceType: 'ASSESSMENT', certifyingBody: 'TEVTA', primary: true }], languages: [{ code: 'pa', level: 'NATIVE' }, { code: 'ur', level: 'C1' }], experience: [] })
];

const store = new Store(config.dbFile);
const registry = new Registry(store, config);
const made = [];
for (const p of people) {
  try { made.push(registry.register(p, 'seed')); } catch (e) { console.log('skip:', e.message); }
}
if (made[0]) { registry.transition(made[0].nspId, 'VERIFY', 'seed-registrar'); registry.issueCard(made[0].nspId, 'seed-registrar'); registry.issueCertificate(made[0].nspId, 'seed-registrar'); }
if (made[1]) registry.transition(made[1].nspId, 'REVIEW', 'seed-registrar');
if (made[2]) { registry.transition(made[2].nspId, 'VERIFY', 'seed-registrar'); registry.issueCard(made[2].nspId, 'seed-registrar'); registry.transition(made[2].nspId, 'SUSPEND', 'seed-registrar', { reason: 'Employer complaint under investigation' }); }
for (const r of made) console.log(`${store.getRegistrant(r.nspId).status.padEnd(12)} ${r.nspId}  ${r.identity.givenNames} ${r.identity.familyName}`);
store.close();
