// Focused E2E for the classroom LIVE-MEETING / Meet feature against in-memory MongoDB.
// Verifies videoMode ('none' | 'link' | 'jitsi'), auto-generated jitsiRoom,
// meetingUrl persistence, validation, and teacher-only authorization.
//
// Run from server dir: node src/scripts/_classroom-meet-e2e.js
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';
import env from '../config/env.js';
import app from '../app.js';
import User from '../models/User.js';
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
  await mongoose.connect(mongo.getUri(), { dbName: 'classroom-meet-e2e' });
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

  console.log('\n[1] Create teacher + student; teacher creates a class (Meet disabled by default)');
  const teacher = await User.create({
    name: 'Mr. Khan', email: 'teacher@test.local',
    password: 'Strong#Pass123', role: 'institution', emailVerified: true,
  });
  const student = await User.create({
    name: 'Ali Student', email: 'student@test.local',
    password: 'Strong#Pass123', role: 'worker', emailVerified: true,
  });
  const teacherToken = signToken(teacher);
  const studentToken = signToken(student);

  let res = await fetchJson('POST', '/api/classroom', {
    token: teacherToken,
    body: { name: 'Welding Level 2', section: 'Morning A', subject: 'Welding', theme: 'amber' },
  });
  assert(res.status === 201, 'class created (201)');
  const classId = res.body._id;
  const joinCode = res.body.joinCode;
  assert(res.body.videoMode === 'none', `default videoMode === 'none' (Meet disabled)`);
  assert(!res.body.jitsiRoom, 'no jitsiRoom yet');
  assert(!res.body.meetingUrl, 'no meetingUrl yet');

  // Student joins so we can later test member-but-not-teacher authorization.
  res = await fetchJson('POST', '/api/classroom/join', { token: studentToken, body: { code: joinCode } });
  assert(res.status === 200, 'student joined the class (200)');

  console.log('\n[2] Teacher enables Jitsi → room auto-generated, hard-to-guess');
  res = await fetchJson('PUT', `/api/classroom/${classId}`, {
    token: teacherToken,
    body: { videoMode: 'jitsi' },
  });
  assert(res.status === 200, 'PUT videoMode=jitsi (200)');
  assert(res.body.videoMode === 'jitsi', `videoMode persisted as 'jitsi'`);
  const room = res.body.jitsiRoom;
  assert(typeof room === 'string' && room.length > 0, `jitsiRoom auto-generated & non-empty`);
  assert(room.startsWith('tl-'), `jitsiRoom starts with 'tl-' (${room})`);
  // crypto.randomBytes(20).toString('base64url') => ~27 chars + 'tl-' prefix.
  assert(room.length >= 20, `jitsiRoom is long/hard-to-guess (len=${room.length})`);
  assert(/^tl-[A-Za-z0-9_-]+$/.test(room), 'jitsiRoom is url-safe base64url with tl- prefix');

  console.log('\n[2b] Class-detail GET exposes videoMode + jitsiRoom');
  res = await fetchJson('GET', `/api/classroom/${classId}`, { token: teacherToken });
  assert(res.status === 200, 'class-detail GET (200)');
  assert(res.body.videoMode === 'jitsi', 'class-detail videoMode === jitsi');
  assert(res.body.jitsiRoom === room, 'class-detail exposes the same jitsiRoom');

  console.log('\n[3] Re-saving in jitsi mode keeps a STABLE room (model only generates when empty)');
  res = await fetchJson('PUT', `/api/classroom/${classId}`, {
    token: teacherToken,
    body: { videoMode: 'jitsi', section: 'Morning A (unchanged)' },
  });
  assert(res.status === 200, 'PUT again in jitsi mode (200)');
  assert(res.body.jitsiRoom === room, `jitsiRoom stays stable across re-saves (${room})`);

  console.log('\n[4] Teacher switches to external link mode (meetingUrl persisted)');
  const meetUrl = 'https://meet.google.com/abc-defg-hij';
  res = await fetchJson('PUT', `/api/classroom/${classId}`, {
    token: teacherToken,
    body: { videoMode: 'link', meetingUrl: meetUrl },
  });
  assert(res.status === 200, 'PUT videoMode=link + meetingUrl (200)');
  assert(res.body.videoMode === 'link', `videoMode persisted as 'link'`);
  assert(res.body.meetingUrl === meetUrl, 'meetingUrl persisted');

  res = await fetchJson('GET', `/api/classroom/${classId}`, { token: teacherToken });
  assert(res.body.videoMode === 'link', 'class-detail videoMode === link');
  assert(res.body.meetingUrl === meetUrl, 'class-detail exposes meetingUrl');
  // jitsiRoom is not regenerated/cleared — it remains from before.
  assert(res.body.jitsiRoom === room, 'previous jitsiRoom still retained (not cleared)');

  console.log('\n[5] Switch back to none — ACTUAL model behavior for meetingUrl');
  res = await fetchJson('PUT', `/api/classroom/${classId}`, {
    token: teacherToken,
    body: { videoMode: 'none' },
  });
  assert(res.status === 200, 'PUT videoMode=none (200)');
  assert(res.body.videoMode === 'none', `videoMode back to 'none'`);
  // NOTE: The model/route contains NO logic that clears meetingUrl when the mode
  // changes. We assert the REAL behavior (it persists) rather than force a
  // non-existent clear. See report for this gap.
  const meetingUrlAfterNone = res.body.meetingUrl;
  assert(meetingUrlAfterNone === meetUrl,
    `meetingUrl is NOT auto-cleared on switch to 'none' (still '${meetingUrlAfterNone}') — see report`);

  console.log('\n[6] Validation: bogus videoMode → 400');
  res = await fetchJson('PUT', `/api/classroom/${classId}`, {
    token: teacherToken,
    body: { videoMode: 'bogus' },
  });
  assert(res.status === 400, 'invalid videoMode rejected (400)');

  console.log('\n[6b] Validation: non-URL meetingUrl → 400');
  res = await fetchJson('PUT', `/api/classroom/${classId}`, {
    token: teacherToken,
    body: { videoMode: 'link', meetingUrl: 'not-a-url' },
  });
  assert(res.status === 400, 'non-URL meetingUrl rejected (400)');

  console.log('\n[7] Authorization: enrolled STUDENT cannot change meeting settings → 403');
  res = await fetchJson('PUT', `/api/classroom/${classId}`, {
    token: studentToken,
    body: { videoMode: 'jitsi' },
  });
  assert(res.status === 403, `student (non-teacher member) blocked from PUT (403)`);
  assert(/teacher/i.test(res.body?.error || ''), `403 reason mentions teacher access ('${res.body?.error}')`);

  // Confirm the student's attempt did NOT mutate state.
  res = await fetchJson('GET', `/api/classroom/${classId}`, { token: teacherToken });
  assert(res.body.videoMode === 'none', 'student attempt did not change videoMode');

  console.log('\n[7b] Authorization: non-member stranger → 403');
  const stranger = await User.create({
    name: 'Stranger', email: 'stranger@test.local',
    password: 'Strong#Pass123', role: 'worker', emailVerified: true,
  });
  res = await fetchJson('PUT', `/api/classroom/${classId}`, {
    token: signToken(stranger),
    body: { videoMode: 'jitsi' },
  });
  assert(res.status === 403, 'non-member blocked from PUT (403)');

  console.log(`\n\n✅ All ${passCount} checks passed.`);
}

main()
  .then(() => teardown().then(() => process.exit(0)))
  .catch((err) => {
    console.error('\n❌ Meet E2E failed:', err.message);
    teardown().then(() => process.exit(1));
  });
