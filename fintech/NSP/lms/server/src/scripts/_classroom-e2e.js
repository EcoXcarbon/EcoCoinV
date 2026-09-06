// Full classroom E2E walk-through against in-memory MongoDB.
// Verifies: create-class -> join-by-code -> announcement -> assignment -> submit -> grade -> gradebook.
//
// Run from server dir: node src/scripts/_classroom-e2e.js
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';
import env from '../config/env.js';
import app from '../app.js';
import User from '../models/User.js';
import Worker from '../models/Worker.js';
import Credential from '../models/Credential.js';
import { encrypt } from '../utils/encryption.js';
import http from 'http';

let mongo, server, baseUrl;
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

async function uploadMultipart(path, token, files) {
  const boundary = '----TLBoundary' + Math.random().toString(16).slice(2);
  const parts = [];
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
  console.log(`  ✓ ${msg}`);
}

function signToken(user) {
  return jwt.sign({ id: user._id, role: user.role }, env.JWT_SECRET, { expiresIn: '15m' });
}

async function setup() {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri(), { dbName: 'classroom-e2e' });
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

async function main() {
  await setup();

  console.log('\n[1] Create users');
  const teacher = await User.create({
    name: 'Mr. Khan', email: 'teacher@test.local',
    password: 'Strong#Pass123', role: 'institution',
    emailVerified: true,
  });
  const student = await User.create({
    name: 'Ali Student', email: 'student@test.local',
    password: 'Strong#Pass123', role: 'worker',
    emailVerified: true,
  });
  const teacherToken = signToken(teacher);
  const studentToken = signToken(student);
  log(`teacher=${teacher._id} student=${student._id}`);

  console.log('\n[2] Teacher creates a class');
  let res = await fetchJson('POST', '/api/classroom', {
    token: teacherToken,
    body: { name: 'Welding Level 2', section: 'Morning A', subject: 'Welding', theme: 'amber' },
  });
  assert(res.status === 201, 'class created (201)');
  assert(res.body.joinCode && res.body.joinCode.length >= 6, `join code generated (${res.body.joinCode})`);
  const classId = res.body._id;
  const joinCode = res.body.joinCode;

  console.log('\n[3] Class appears in teacher\'s list');
  res = await fetchJson('GET', '/api/classroom', { token: teacherToken });
  assert(res.status === 200 && res.body.length === 1, '1 class in teacher list');
  assert(res.body[0].myRole === 'teacher', 'teacher role is "teacher"');
  assert(res.body[0].joinCode === joinCode, 'teacher sees join code');

  console.log('\n[4] Student joins by code');
  res = await fetchJson('POST', '/api/classroom/join', {
    token: studentToken,
    body: { code: joinCode },
  });
  assert(res.status === 200, 'student joined (200)');
  assert(res.body.classId === classId, 'returned classId matches');

  console.log('\n[5] Student sees class in their list');
  res = await fetchJson('GET', '/api/classroom', { token: studentToken });
  assert(res.body.length === 1, 'student has 1 class');
  assert(res.body[0].myRole === 'student', 'student role is "student"');
  assert(res.body[0].joinCode === undefined, 'student does NOT see join code');

  console.log('\n[6] People tab shows teacher + student');
  res = await fetchJson('GET', `/api/classroom/${classId}/people`, { token: teacherToken });
  assert(res.body.length === 2, '2 members in class');
  assert(res.body.some(m => m.role === 'teacher'), 'has 1 teacher');
  assert(res.body.some(m => m.role === 'student'), 'has 1 student');

  console.log('\n[7] Wrong code returns 404');
  res = await fetchJson('POST', '/api/classroom/join', {
    token: studentToken, body: { code: 'WRONGX' },
  });
  assert(res.status === 404, 'bad code returns 404');

  console.log('\n[8] Teacher posts an announcement (pinned)');
  res = await fetchJson('POST', `/api/classroom/${classId}/stream`, {
    token: teacherToken,
    body: { body: 'Welcome to Welding L2 — first class on Monday', pinned: true },
  });
  assert(res.status === 201, 'announcement created');
  assert(res.body.pinned === true, 'teacher can pin');
  const announcementId = res.body._id;

  console.log('\n[9] Student tries to pin own post (denied)');
  res = await fetchJson('POST', `/api/classroom/${classId}/stream`, {
    token: studentToken,
    body: { body: 'Excited to start!', pinned: true },
  });
  assert(res.status === 201, 'student post created');
  assert(res.body.pinned === false, 'student CANNOT pin (silently downgraded)');

  console.log('\n[10] Stream returns posts (pinned first)');
  res = await fetchJson('GET', `/api/classroom/${classId}/stream`, { token: studentToken });
  assert(res.body.length === 2, '2 posts in stream');
  assert(res.body[0]._id === announcementId, 'pinned post is first');

  console.log('\n[11] Student comments on teacher post');
  res = await fetchJson('POST', `/api/classroom/${classId}/stream/${announcementId}/comments`, {
    token: studentToken,
    body: { body: 'Thank you sir, I\'ll be there.' },
  });
  assert(res.status === 201, 'comment posted');
  assert(res.body.comments.length === 1, '1 comment on post');

  console.log('\n[12] Teacher creates an assignment');
  res = await fetchJson('POST', `/api/classroom/${classId}/classwork`, {
    token: teacherToken,
    body: {
      title: 'Practical 1 — Butt Weld',
      instructions: 'Perform a butt weld on 6mm plate. Upload photo + supervisor signoff.',
      points: 100,
      dueDate: new Date(Date.now() + 7 * 86400000).toISOString(),
      topic: 'Practicals',
    },
  });
  assert(res.status === 201, 'assignment created');
  const assignmentId = res.body._id;

  console.log('\n[13] Stream gains an "assignment-posted" entry');
  res = await fetchJson('GET', `/api/classroom/${classId}/stream`, { token: studentToken });
  const assignmentPost = res.body.find(p => p.kind === 'assignment-posted');
  assert(assignmentPost, 'system stream entry emitted');

  console.log('\n[14] Student sees assignment in classwork');
  res = await fetchJson('GET', `/api/classroom/${classId}/classwork`, { token: studentToken });
  assert(res.body.length === 1, '1 classwork item visible to student');
  assert(res.body[0].mySubmission === null, 'no submission yet');

  console.log('\n[15] Student turns in submission');
  res = await fetchJson('POST', `/api/classroom/${classId}/classwork/${assignmentId}/submit`, {
    token: studentToken,
    body: { text: 'Photo + signoff attached.' },
  });
  assert(res.status === 200, 'submitted');
  assert(res.body.status === 'turned-in', 'status = turned-in');
  assert(res.body.late === false, 'not late');
  const submissionId = res.body._id;

  console.log('\n[16] Teacher sees submission in roster');
  res = await fetchJson('GET', `/api/classroom/${classId}/classwork/${assignmentId}/submissions`, {
    token: teacherToken,
  });
  assert(res.body.rows.length === 1, '1 student in roster');
  assert(res.body.rows[0].status === 'turned-in', 'roster reflects turned-in');

  console.log('\n[17] Teacher grades & returns');
  res = await fetchJson('PUT', `/api/classroom/${classId}/classwork/${assignmentId}/submissions/${submissionId}/grade`, {
    token: teacherToken,
    body: { grade: 85, feedback: 'Good penetration, mind the bead consistency.', return: true },
  });
  assert(res.status === 200, 'grade saved');
  assert(res.body.status === 'returned', 'status = returned');
  assert(res.body.grade === 85, 'grade persisted');

  console.log('\n[18] Student sees grade');
  res = await fetchJson('GET', `/api/classroom/${classId}/classwork/${assignmentId}`, { token: studentToken });
  assert(res.body.mySubmission.grade === 85, 'student sees grade');
  assert(res.body.mySubmission.feedback.includes('penetration'), 'student sees feedback');

  console.log('\n[19] Student cannot grade');
  res = await fetchJson('PUT', `/api/classroom/${classId}/classwork/${assignmentId}/submissions/${submissionId}/grade`, {
    token: studentToken,
    body: { grade: 100, return: true },
  });
  assert(res.status === 403, 'student blocked from grading');

  console.log('\n[20] Gradebook reflects the grade');
  res = await fetchJson('GET', `/api/classroom/${classId}/classwork/gradebook/all`, { token: teacherToken });
  assert(res.body.assignments.length === 1, '1 assignment in gradebook');
  assert(res.body.rows.length === 1, '1 student row');
  assert(res.body.rows[0].cells[0].grade === 85, 'cell shows 85');
  assert(res.body.rows[0].average === 85, 'average = 85%');

  console.log('\n[21] Non-member cannot read class');
  const stranger = await User.create({ name: 'Stranger', email: 'x@test.local', password: 'Strong#Pass123', emailVerified: true });
  const strangerToken = signToken(stranger);
  res = await fetchJson('GET', `/api/classroom/${classId}`, { token: strangerToken });
  assert(res.status === 403, 'stranger blocked (403)');

  console.log('\n[22] Teacher regenerates join code');
  res = await fetchJson('POST', `/api/classroom/${classId}/reset-code`, { token: teacherToken });
  assert(res.body.joinCode !== joinCode, 'new code is different');
  assert(res.body.joinCode.length >= 6, 'new code is valid');

  console.log('\n[23] File upload — student uploads a PDF');
  const fakePdf = Buffer.from('%PDF-1.4\n%fake test pdf\n%%EOF');
  let upRes = await uploadMultipart(`/api/classroom/${classId}/uploads`, studentToken, [
    { name: 'evidence.pdf', type: 'application/pdf', data: fakePdf },
  ]);
  assert(upRes.status === 201, 'upload accepted');
  assert(upRes.body.files.length === 1, '1 file returned');
  assert(upRes.body.files[0].url.startsWith('/uploads/'), 'file url returned');

  console.log('\n[24] Non-member cannot upload');
  upRes = await uploadMultipart(`/api/classroom/${classId}/uploads`, strangerToken, [
    { name: 'x.pdf', type: 'application/pdf', data: fakePdf },
  ]);
  assert(upRes.status === 403, 'stranger upload blocked');

  console.log('\n[25] Credential auto-mint — student has Worker record');
  // Backfill a Worker record for the student (encrypted CNIC field is required)
  await Worker.create({
    user: student._id,
    fullName: 'Ali Student',
    cnicEncrypted: encrypt('12345-1234567-1'),
    cnicMasked: '*************4567',
    district: 'Peshawar',
    trade: 'welder',
    nqfLevel: 2,
  });

  // Create a new assignment with awardCredential=true
  res = await fetchJson('POST', `/api/classroom/${classId}/classwork`, {
    token: teacherToken,
    body: {
      title: 'Practical 2 — Fillet Weld (credentialed)',
      instructions: 'Pass this for a blockchain credential.',
      points: 100,
      passMark: 70,
      awardCredential: true,
    },
  });
  assert(res.status === 201, 'credentialed assignment created');
  const credAsgId = res.body._id;

  res = await fetchJson('POST', `/api/classroom/${classId}/classwork/${credAsgId}/submit`, {
    token: studentToken,
    body: { text: 'Completed' },
  });
  assert(res.body.status === 'turned-in', 'turned in');
  const credSubId = res.body._id;

  console.log('\n[26] Grade BELOW pass mark → no credential');
  res = await fetchJson('PUT', `/api/classroom/${classId}/classwork/${credAsgId}/submissions/${credSubId}/grade`, {
    token: teacherToken,
    body: { grade: 50, return: true },
  });
  assert(res.status === 200, 'grade applied');
  assert(!res.body.mintedCredentialId, 'no credential when below pass mark');

  console.log('\n[27] Re-grade ABOVE pass mark → credential minted');
  res = await fetchJson('PUT', `/api/classroom/${classId}/classwork/${credAsgId}/submissions/${credSubId}/grade`, {
    token: teacherToken,
    body: { grade: 88, return: true },
  });
  assert(res.body.mintedCredentialId, `credential minted (${res.body.mintedCredentialId})`);
  assert(res.body.mintedCredentialId.startsWith('TL-CLS-'), 'has TL-CLS prefix');

  const credCount = await Credential.countDocuments();
  assert(credCount === 1, '1 Credential persisted in DB');
  const cred = await Credential.findOne({ credentialId: res.body.mintedCredentialId });
  assert(cred.type === 'micro-credential', 'credential type = micro-credential');
  assert(cred.worker.toString().length > 0, 'credential linked to worker');

  console.log('\n[28] Re-grading does NOT double-mint');
  res = await fetchJson('PUT', `/api/classroom/${classId}/classwork/${credAsgId}/submissions/${credSubId}/grade`, {
    token: teacherToken,
    body: { grade: 95, return: true },
  });
  const credCount2 = await Credential.countDocuments();
  assert(credCount2 === 1, 'still only 1 credential — no double mint');

  console.log('\n[29] Assignment WITHOUT awardCredential — no mint even on pass');
  res = await fetchJson('GET', `/api/classroom/${classId}/classwork/${assignmentId}/submissions`, {
    token: teacherToken,
  });
  // Re-grade the original Practical 1 (which has awardCredential=false by default)
  await fetchJson('PUT', `/api/classroom/${classId}/classwork/${assignmentId}/submissions/${submissionId}/grade`, {
    token: teacherToken,
    body: { grade: 95, return: true },
  });
  const credCount3 = await Credential.countDocuments();
  assert(credCount3 === 1, 'still 1 credential — opt-in flag respected');

  console.log('\n\n✅ All 29 E2E checks passed.');
}

main()
  .then(() => teardown().then(() => process.exit(0)))
  .catch((err) => {
    console.error('\n❌ E2E failed:', err.message);
    teardown().then(() => process.exit(1));
  });
