'use strict';
/* Seeds the local registry with sample records covering every lifecycle stage. Never run against production. */
const config = require('./config');
const { Store } = require('./lib/store');
const { Registry } = require('./lib/registry');

const photo = 'data:image/png;base64,' + require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'assets', 'img', 'sample-photo.png')).toString('base64');
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
