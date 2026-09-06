// Full LMS training/course E2E walk-through against in-memory MongoDB.
// Verifies the learner journey across TWO courses:
//   create-program(x2) -> enroll -> quiz(pass) -> scenario(pass) ->
//   practical submit -> admin review/approve -> progress/transcript ->
//   certificate auto-issued on full completion -> my-courses lists both.
//
// Run from server dir: node src/scripts/_lms-training-e2e.js
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';
import env from '../config/env.js';
import app from '../app.js';
import User from '../models/User.js';
import Worker from '../models/Worker.js';
import Training from '../models/Training.js';
import Credential from '../models/Credential.js';
import { encrypt } from '../utils/encryption.js';
import http from 'http';

let mongo, server, baseUrl;
let passCount = 0;
const log = (msg) => console.log(`  ${msg}`);

async function fetchJson(method, path, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl + path);
    const req = http.request({
      host: url.hostname, port: url.port, path: url.pathname + url.search, method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : null;
          resolve({ status: res.statusCode, body: parsed });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function uploadMultipart(path, token, files, fields = {}) {
  const boundary = '----TLBoundary' + Math.random().toString(16).slice(2);
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(`--${boundary}\r\n`);
    parts.push(`Content-Disposition: form-data; name="${k}"\r\n\r\n`);
    parts.push(String(v));
    parts.push('\r\n');
  }
  for (const f of files) {
    parts.push(`--${boundary}\r\n`);
    parts.push(`Content-Disposition: form-data; name="files"; filename="${f.name}"\r\n`);
    parts.push(`Content-Type: ${f.type || 'application/octet-stream'}\r\n\r\n`);
    parts.push(f.data);
    parts.push('\r\n');
  }
  parts.push(`--${boundary}--\r\n`);
  const buf = Buffer.concat(parts.map(p => Buffer.isBuffer(p) ? p : Buffer.from(p)));

  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl + path);
    const req = http.request({
      host: url.hostname, port: url.port, path: url.pathname, method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': buf.length,
        Authorization: `Bearer ${token}`,
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`  ❌ FAIL: ${msg}`);
    throw new Error(msg);
  }
  passCount++;
  console.log(`  ✓ ${msg}`);
}

function signToken(user) {
  return jwt.sign({ id: user._id, role: user.role }, env.JWT_SECRET, { expiresIn: '15m' });
}

async function setup() {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri(), { dbName: 'lms-training-e2e' });
  await new Promise((r) => { server = app.listen(0, () => r()); });
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
  log(`In-memory MongoDB up; app listening on ${baseUrl}`);
}

async function teardown() {
  try { server?.close(); } catch {}
  try { await mongoose.disconnect(); } catch {}
  try { await mongo?.stop(); } catch {}
}

// Build a course definition directly via the Mongoose model. Each course has
// 3 ordered modules: quiz (order 1), scenario (order 2), practical (order 3).
// No video/reading modules and no competencyTargets, so the weighted grade is
// computed purely from quiz+practical+scenario and the competency-threshold
// gate is trivially satisfied (lets the completion certificate auto-issue).
function buildCourseDoc(n) {
  return {
    title: `Course ${n} — Industrial Safety L2`,
    description: `End-to-end test program number ${n}.`,
    trade: 'welder',
    nqfLevel: 2,
    instructor: 'Mr. Khan',
    institution: 'TalentLedger TVET',
    duration: '4 Weeks',
    status: 'active',
    passMark: 70,
    modules: [
      {
        title: `C${n} Quiz — Safety Basics`,
        type: 'quiz',
        order: 1,
        // No `difficulty` on questions => no adaptive reshuffle; answers[i]
        // aligns positionally with quizQuestions[i].
        quizQuestions: [
          { question: 'PPE must be worn when?', type: 'mcq', options: ['Never', 'Always on site', 'Only at lunch'], correctOption: 1, points: 1 },
          { question: 'Fire extinguisher color for electrical?', type: 'mcq', options: ['Red water', 'CO2 black', 'Foam cream'], correctOption: 1, points: 1 },
          { question: 'A hard hat is mandatory.', type: 'true-false', correctAnswer: 'true', points: 1 },
        ],
      },
      {
        title: `C${n} Scenario — Gas Leak Response`,
        type: 'scenario',
        order: 2,
        scenario: {
          startStepId: 's1',
          passingScore: 60,
          maxScore: 100,
          steps: [
            {
              stepId: 's1',
              narrative: 'You smell gas in the workshop. What do you do first?',
              choices: [
                { text: 'Light a match to check', isOptimal: false, feedback: 'Never ignite.', scoreImpact: 0 },
                { text: 'Evacuate and shut the main valve', isOptimal: true, feedback: 'Correct.', scoreImpact: 60, nextStepId: 's2' },
              ],
            },
            {
              stepId: 's2',
              narrative: 'Area is clear. Next step?',
              choices: [
                { text: 'Re-enter immediately', isOptimal: false, feedback: 'Too soon.', scoreImpact: 0 },
                { text: 'Call emergency services and ventilate', isOptimal: true, feedback: 'Correct.', scoreImpact: 40 },
              ],
            },
          ],
        },
      },
      {
        title: `C${n} Practical — Weld Inspection`,
        type: 'practical',
        order: 3,
        description: 'Upload a photo of your completed weld for assessor review.',
      },
    ],
  };
}

async function main() {
  await setup();

  console.log('\n[1] Create users (admin + worker) and a Worker profile');
  const admin = await User.create({
    name: 'Admin Khan', email: 'admin@test.local',
    password: 'Strong#Pass123', role: 'admin', emailVerified: true,
  });
  const studentUser = await User.create({
    name: 'Ali Student', email: 'student@test.local',
    password: 'Strong#Pass123', role: 'worker', emailVerified: true,
  });
  const adminToken = signToken(admin);
  const studentToken = signToken(studentUser);

  const worker = await Worker.create({
    user: studentUser._id,
    fullName: 'Ali Student',
    cnicEncrypted: encrypt('12345-1234567-1'),
    cnicMasked: '*************4567',
    district: 'Peshawar',
    trade: 'welder',
    nqfLevel: 2,
  });
  const workerId = worker._id.toString();
  log(`admin=${admin._id} student=${studentUser._id} worker=${workerId}`);
  assert(!!adminToken && !!studentToken, 'JWTs minted for admin + worker');

  console.log('\n[2] Create TWO training programs (direct via model)');
  const courseDocs = [buildCourseDoc(1), buildCourseDoc(2)];
  const courses = await Training.create(courseDocs);
  assert(courses.length === 2, 'two courses created');
  for (const c of courses) {
    assert(c.modules.length === 3, `${c.title}: 3 modules`);
    assert(c.modules.some(m => m.type === 'quiz'), '  has a quiz module');
    assert(c.modules.some(m => m.type === 'scenario'), '  has a scenario module');
    assert(c.modules.some(m => m.type === 'practical'), '  has a practical module');
  }

  // Also verify admin can create a program via the REST endpoint (validation path).
  console.log('\n[2b] Admin POST /api/training (validation smoke test)');
  let res = await fetchJson('POST', '/api/training', {
    token: adminToken,
    body: { title: 'REST-created Program', trade: 'electrician', nqfLevel: 3, difficulty: 'beginner' },
  });
  assert(res.status === 201, 'admin can create program via REST (201)');
  assert(res.body._id, 'REST program returned an _id');

  // Worker is forbidden from creating programs.
  res = await fetchJson('POST', '/api/training', {
    token: studentToken, body: { title: 'Nope', trade: 'welder' },
  });
  assert(res.status === 403, 'worker blocked from creating programs (403)');

  // Run the full learner journey for BOTH courses.
  for (let i = 0; i < courses.length; i++) {
    const course = courses[i];
    const courseId = course._id.toString();
    const quizMod = course.modules.find(m => m.type === 'quiz');
    const scenarioMod = course.modules.find(m => m.type === 'scenario');
    const practicalMod = course.modules.find(m => m.type === 'practical');
    const label = `Course ${i + 1}`;

    console.log(`\n[3.${i + 1}] ${label}: worker enrolls`);
    res = await fetchJson('POST', `/api/training/${courseId}/enroll`, {
      token: studentToken, body: { workerId },
    });
    assert(res.status === 201, `${label}: enrolled (201)`);

    // Double-enroll guard
    res = await fetchJson('POST', `/api/training/${courseId}/enroll`, {
      token: studentToken, body: { workerId },
    });
    assert(res.status === 409, `${label}: duplicate enroll blocked (409)`);

    console.log(`\n[4.${i + 1}] ${label}: worker takes the quiz (correct answers)`);
    res = await fetchJson('POST', `/api/training/${courseId}/quiz/${quizMod._id}`, {
      token: studentToken,
      body: {
        workerId,
        answers: [
          { selectedOption: 1 },           // mcq correct
          { selectedOption: 1 },           // mcq correct
          { answer: 'true' },              // true-false correct
        ],
      },
    });
    assert(res.status === 200, `${label}: quiz submitted (200)`);
    assert(res.body.score === 100, `${label}: quiz score 100% (got ${res.body.score})`);
    assert(res.body.passed === true, `${label}: quiz passed`);
    assert(res.body.correctAnswers === 3, `${label}: 3/3 correct`);

    console.log(`\n[5.${i + 1}] ${label}: worker completes the scenario`);
    res = await fetchJson('POST', `/api/training/${courseId}/scenario/${scenarioMod._id}`, {
      token: studentToken,
      body: {
        workerId,
        choices: [
          { stepId: 's1', choiceIndex: 1 },   // optimal +60
          { stepId: 's2', choiceIndex: 1 },   // optimal +40
        ],
      },
    });
    assert(res.status === 200, `${label}: scenario submitted (200)`);
    assert(res.body.score === 100, `${label}: scenario score 100% (got ${res.body.score})`);
    assert(res.body.passed === true, `${label}: scenario passed (>= ${res.body.passingScore})`);

    console.log(`\n[6.${i + 1}] ${label}: worker submits practical (multipart)`);
    const fakeJpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    let up = await uploadMultipart(
      `/api/training/${courseId}/submit/${practicalMod._id}`,
      studentToken,
      [{ name: 'weld.jpg', type: 'image/jpeg', data: fakeJpg }],
      { workerId, notes: 'My completed butt weld.', evidenceType: 'photo-of-work' },
    );
    assert(up.status === 201, `${label}: practical submitted (201)`);
    assert(up.body.filesUploaded === 1, `${label}: 1 file uploaded`);

    // Pull the submissionId from the DB (response doesn't return it).
    const fresh = await Training.findById(courseId);
    const enr = fresh.enrollments.find(e => e.worker.toString() === workerId);
    const submission = enr.submissions.find(s => s.moduleId.toString() === practicalMod._id.toString());
    assert(!!submission, `${label}: submission persisted`);
    const submissionId = submission._id.toString();

    console.log(`\n[7.${i + 1}] ${label}: admin reviews & approves the submission`);
    res = await fetchJson('PUT', `/api/training/${courseId}/submissions/${submissionId}/review`, {
      token: adminToken,
      body: { status: 'approved', grade: 90, feedback: 'Clean penetration, good work.' },
    });
    assert(res.status === 200, `${label}: submission reviewed (200)`);
    assert(res.body.status === 'approved', `${label}: submission approved`);
    assert(res.body.grade === 90, `${label}: grade persisted (90)`);

    // Worker cannot review submissions.
    res = await fetchJson('PUT', `/api/training/${courseId}/submissions/${submissionId}/review`, {
      token: studentToken, body: { status: 'approved', grade: 100 },
    });
    assert(res.status === 403, `${label}: worker blocked from reviewing (403)`);

    console.log(`\n[8.${i + 1}] ${label}: progress + completion`);
    // All 3 modules auto-completed (quiz pass, scenario pass, practical approval),
    // so progress should already be 100% and the enrollment completed.
    const afterApproval = await Training.findById(courseId);
    const enr2 = afterApproval.enrollments.find(e => e.worker.toString() === workerId);
    assert(enr2.completedModules.length === 3, `${label}: 3/3 modules complete`);
    assert(enr2.progress === 100, `${label}: progress 100%`);
    assert(enr2.status === 'completed', `${label}: enrollment status = completed`);

    // PUT /progress is idempotent for an already-complete enrollment.
    res = await fetchJson('PUT', `/api/training/${courseId}/progress`, {
      token: studentToken, body: { workerId, progress: 100 },
    });
    assert(res.status === 200, `${label}: PUT progress ok (200)`);
    assert(res.body.status === 'completed', `${label}: still completed after progress ping`);

    console.log(`\n[9.${i + 1}] ${label}: completion certificate auto-issued`);
    assert(enr2.certificateIssued === true, `${label}: certificateIssued flag set`);
    assert(typeof enr2.certificateId === 'string' && enr2.certificateId.startsWith('TL-LMS-'),
      `${label}: certificateId has TL-LMS prefix (${enr2.certificateId})`);
    const cert = await Credential.findOne({ credentialId: enr2.certificateId });
    assert(!!cert, `${label}: certificate Credential persisted`);
    assert(cert.worker.toString() === workerId, `${label}: certificate linked to worker`);
    assert(cert.title.includes(course.title), `${label}: certificate titled for the course`);
  }

  console.log('\n[10] Transcript reflects BOTH completed courses');
  res = await fetchJson('GET', '/api/training/transcript/my', { token: studentToken });
  assert(res.status === 200, 'transcript fetched (200)');
  const transcriptArr = res.body.transcript || [];
  assert(transcriptArr.length >= 2, `transcript has >= 2 courses (got ${transcriptArr.length})`);
  const completedInTranscript = transcriptArr.filter(t => t.status === 'completed').length;
  assert(completedInTranscript >= 2, `>= 2 courses completed in transcript (got ${completedInTranscript})`);
  assert(res.body.summary.certificates >= 2, `transcript summary counts >= 2 certificates (got ${res.body.summary.certificates})`);

  console.log('\n[11] GET /api/training/my-courses shows BOTH courses');
  res = await fetchJson('GET', '/api/training/my-courses', { token: studentToken });
  assert(res.status === 200, 'my-courses fetched (200)');
  assert(Array.isArray(res.body), 'my-courses returns an array');
  assert(res.body.length === 2, `worker has exactly 2 courses (got ${res.body.length})`);
  for (const c of res.body) {
    assert(c.enrollment.status === 'completed', `${c.title}: shown as completed`);
    assert(c.enrollment.progress === 100, `${c.title}: progress 100% in my-courses`);
    assert(c.enrollment.certificateIssued === true, `${c.title}: certificate flag in my-courses`);
  }

  console.log('\n[12] Exactly 2 completion certificates issued overall');
  const certCount = await Credential.countDocuments({ title: /Completion Certificate/ });
  assert(certCount === 2, `2 completion certificates persisted (got ${certCount})`);

  console.log(`\n\n✅ All ${passCount} E2E checks passed.`);
}

main()
  .then(() => teardown().then(() => process.exit(0)))
  .catch((err) => {
    console.error('\n❌ E2E failed:', err.message);
    teardown().then(() => process.exit(1));
  });
