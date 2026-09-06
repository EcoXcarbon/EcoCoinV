// Internal integration E2E for the live-video JOIN-TOKEN endpoints, driven over
// real HTTP through the full Express stack (auth + membership + role checks),
// with JaaS ENABLED via a throwaway RSA keypair. Verifies returned JWTs against
// the matching public key. No external 8x8 call — fully self-contained.
//
//   GET /api/classroom/:id/meet/token                       (persistent room)
//   GET /api/classroom/:id/live/:sessionId/token            (scheduled session)
//
// Run from server dir:  node src/scripts/_livestream-token-e2e.js
import crypto from 'crypto';
import http from 'http';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';

// 1) Throwaway keypair + JaaS env — MUST be set before importing env/app.
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const APP_ID = 'vpaas-magic-cookie-e2e0001';
const KID = `${APP_ID}/e2ekey`;
process.env.JAAS_APP_ID = APP_ID;
process.env.JAAS_KID = KID;
process.env.JAAS_PRIVATE_KEY = privateKey.replace(/\n/g, '\\n'); // exercise \n-escaped form

// 2) Dynamic imports so the above env is in place when env.js builds its config.
const { default: env } = await import('../config/env.js');
const { default: app } = await import('../app.js');
const { default: User } = await import('../models/User.js');

let mongo, server, baseUrl, pass = 0;
const assert = (c, m) => { if (!c) { console.error(`  ❌ FAIL: ${m}`); throw new Error(m); } pass++; console.log(`  ✓ ${m}`); };
const signToken = (u) => jwt.sign({ id: u._id, role: u.role }, env.JWT_SECRET, { expiresIn: '15m' });

function fetchJson(method, path, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl + path);
    const req = http.request({
      host: url.hostname, port: url.port, path: url.pathname + url.search, method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }, (res) => {
      let data = ''; res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }); } catch { resolve({ status: res.statusCode, body: data }); } });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Verify a returned JaaS token against the public key and return its claims.
function verifyJaas(token) {
  const claims = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
  const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64').toString());
  return { claims, header };
}

try {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri(), { dbName: 'livestream-token-e2e' });
  await new Promise((r) => { server = app.listen(0, r); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  console.log(`In-memory MongoDB up; app on ${baseUrl}`);

  console.log('\n[0] Seed teacher, student, stranger; create class; student joins');
  const teacher = await User.create({ name: 'Mr Khan', email: 'teach@test.local', password: 'Strong#Pass123', role: 'institution', emailVerified: true });
  const student = await User.create({ name: 'Ali Student', email: 'stud@test.local', password: 'Strong#Pass123', role: 'worker', emailVerified: true });
  const stranger = await User.create({ name: 'Nobody', email: 'no@test.local', password: 'Strong#Pass123', role: 'worker', emailVerified: true });
  const tT = signToken(teacher), tS = signToken(student), tX = signToken(stranger);

  let res = await fetchJson('POST', '/api/classroom', { token: tT, body: { name: 'Welding L2', section: 'AM', subject: 'Welding', theme: 'amber' } });
  assert(res.status === 201, 'class created (201)');
  const classId = res.body._id, joinCode = res.body.joinCode;
  res = await fetchJson('POST', '/api/classroom/join', { token: tS, body: { code: joinCode } });
  assert(res.status === 200, 'student joined (200)');
  res = await fetchJson('PUT', `/api/classroom/${classId}`, { token: tT, body: { videoMode: 'jitsi' } });
  assert(res.status === 200 && res.body.videoMode === 'jitsi', 'class set to jitsi mode');
  const room = res.body.jitsiRoom;
  assert(!!room, `persistent jitsiRoom generated (${room})`);

  console.log('\n[1] Persistent meet token — TEACHER gets a moderator JWT');
  res = await fetchJson('GET', `/api/classroom/${classId}/meet/token`, { token: tT });
  assert(res.status === 200, 'GET /meet/token teacher (200)');
  assert(res.body.configured === true, 'configured = true (JaaS active)');
  assert(res.body.domain === '8x8.vc', 'domain = 8x8.vc');
  assert(res.body.appId === APP_ID, 'appId = tenant');
  assert(res.body.room === room, 'room = class jitsiRoom');
  let v = verifyJaas(res.body.token);
  assert(v.header.kid === KID && v.header.alg === 'RS256', 'JWT signed with correct kid + RS256');
  assert(v.claims.aud === 'jitsi' && v.claims.iss === 'chat' && v.claims.sub === APP_ID, 'aud/iss/sub correct');
  assert(v.claims.room === room, 'token room claim matches');
  assert(v.claims.context.user.moderator === true, 'teacher token: moderator = true');
  assert(v.claims.context.user.name === 'Mr Khan', 'teacher name embedded');

  console.log('\n[2] Persistent meet token — STUDENT gets a participant JWT');
  res = await fetchJson('GET', `/api/classroom/${classId}/meet/token`, { token: tS });
  assert(res.status === 200, 'GET /meet/token student (200)');
  v = verifyJaas(res.body.token);
  assert(v.claims.context.user.moderator === false, 'student token: moderator = false');
  assert(v.claims.room === room, 'student token room matches');

  console.log('\n[3] Authorization — non-member stranger blocked (403)');
  res = await fetchJson('GET', `/api/classroom/${classId}/meet/token`, { token: tX });
  assert(res.status === 403, 'stranger blocked from meet token (403)');
  res = await fetchJson('GET', `/api/classroom/${classId}/meet/token`, {});
  assert(res.status === 401, 'unauthenticated blocked (401)');

  console.log('\n[4] Meet token requires jitsi mode (switch to none → 400)');
  await fetchJson('PUT', `/api/classroom/${classId}`, { token: tT, body: { videoMode: 'none' } });
  res = await fetchJson('GET', `/api/classroom/${classId}/meet/token`, { token: tT });
  assert(res.status === 400, 'non-jitsi class → 400 for meet token');
  await fetchJson('PUT', `/api/classroom/${classId}`, { token: tT, body: { videoMode: 'jitsi' } }); // restore

  console.log('\n[5] Scheduled session (jitsi) — teacher moderator, student participant');
  res = await fetchJson('POST', `/api/classroom/${classId}/live`, {
    token: tT, body: { title: 'Live: Bricklaying demo', scheduledFor: new Date(Date.now() + 3600e3).toISOString(), durationMins: 45, mode: 'jitsi' },
  });
  assert(res.status === 201, 'live session created (201)');
  const sid = res.body._id, sRoom = res.body.jitsiRoom;
  assert(!!sRoom && sRoom.startsWith('tl-live-'), `session jitsiRoom generated (${sRoom})`);

  res = await fetchJson('GET', `/api/classroom/${classId}/live/${sid}/token`, { token: tT });
  assert(res.status === 200 && res.body.mode === 'jitsi', 'session token teacher (200, jitsi)');
  v = verifyJaas(res.body.token);
  assert(v.claims.room === sRoom, 'session token room = session jitsiRoom');
  assert(v.claims.context.user.moderator === true, 'teacher session token: moderator = true');

  res = await fetchJson('GET', `/api/classroom/${classId}/live/${sid}/token`, { token: tS });
  v = verifyJaas(res.body.token);
  assert(v.claims.context.user.moderator === false, 'student session token: moderator = false');

  res = await fetchJson('GET', `/api/classroom/${classId}/live/${sid}/token`, { token: tX });
  assert(res.status === 403, 'stranger blocked from session token (403)');

  console.log('\n[6] Scheduled session (link mode) — token returns the external URL, no JWT');
  const ext = 'https://us02web.zoom.us/j/123456';
  res = await fetchJson('POST', `/api/classroom/${classId}/live`, {
    token: tT, body: { title: 'Zoom session', scheduledFor: new Date(Date.now() + 7200e3).toISOString(), mode: 'link', meetingUrl: ext },
  });
  assert(res.status === 201, 'link session created (201)');
  res = await fetchJson('GET', `/api/classroom/${classId}/live/${res.body._id}/token`, { token: tT });
  assert(res.status === 200 && res.body.mode === 'link' && res.body.meetingUrl === ext, 'link session token returns meetingUrl');

  console.log(`\n—— Livestream token E2E: ${pass} passed ——\n✅ Internal token flow verified (auth, membership, roles, moderator JWT).`);
} catch (e) {
  console.error(`\n❌ E2E FAILED: ${e.message}`);
  process.exitCode = 1;
} finally {
  try { server?.close(); } catch {}
  try { await mongoose.disconnect(); } catch {}
  try { await mongo?.stop(); } catch {}
}
