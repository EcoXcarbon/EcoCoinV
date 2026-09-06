// E2E for JaaS token minting — proves the server produces a valid, correctly-
// scoped RS256 JWT WITHOUT needing a real 8x8 account: we generate a throwaway
// RSA keypair, sign with the private key, and verify with the public key.
// The only thing this does NOT cover is the live 8x8.vc handshake (needs the
// real tenant key) — that is verified once real JAAS_* creds are deployed.
//
// Run from server dir:  node src/scripts/_jaas-token-e2e.js
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { execFileSync } from 'child_process';

let pass = 0, fail = 0;
const assert = (c, m) => { if (c) { console.log(`  ✓ ${m}`); pass++; } else { console.error(`  ❌ FAIL: ${m}`); fail++; } };

// 1) Throwaway RSA keypair stands in for the real JaaS API key.
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const APP_ID = 'vpaas-magic-cookie-deadbeefcafe';
const KID = `${APP_ID}/test01`;

// 2) Configure env BEFORE importing the service (env.js reads process.env at load).
//    Also exercise the \n-escaped form the real .env will use.
process.env.JAAS_APP_ID = APP_ID;
process.env.JAAS_KID = KID;
process.env.JAAS_PRIVATE_KEY = privateKey.replace(/\n/g, '\\n');

const { mintJaasToken, jaasJoinPayload, jaasConfigured, JAAS_DOMAIN } =
  await import('../services/jaasToken.js');

console.log('\n[1] Configuration detection');
assert(jaasConfigured() === true, 'jaasConfigured() true when all three vars set');

console.log('\n[2] Moderator token (teacher) — verifies against the public key');
const room = 'tl-live-Abc123_room';
const modToken = mintJaasToken({
  room, moderator: true,
  user: { id: 'u-teacher', name: 'Test Teacher', email: 't@talentledger.pk' },
});
const decoded = jwt.verify(modToken, publicKey, { algorithms: ['RS256'] });
const header = JSON.parse(Buffer.from(modToken.split('.')[0], 'base64').toString());

assert(header.alg === 'RS256', 'JWT header alg = RS256');
assert(header.kid === KID, `JWT header kid = API key id (${header.kid})`);
assert(decoded.aud === 'jitsi', "aud = 'jitsi'");
assert(decoded.iss === 'chat', "iss = 'chat'");
assert(decoded.sub === APP_ID, 'sub = App ID (tenant)');
assert(decoded.room === room, 'room claim matches requested room');
assert(decoded.exp > Math.floor(Date.now() / 1000), 'exp is in the future');
assert(decoded.context?.user?.name === 'Test Teacher', 'context.user.name carried through');
assert(decoded.context?.user?.moderator === true, 'context.user.moderator = true for teacher');
assert(decoded.context?.features?.recording === true, 'moderator may record');

console.log('\n[3] Participant token (student) — no moderator/record rights');
const stuToken = mintJaasToken({ room, moderator: false, user: { id: 'u-stu', name: 'Student' } });
const stu = jwt.verify(stuToken, publicKey, { algorithms: ['RS256'] });
assert(stu.context.user.moderator === false, 'context.user.moderator = false for student');
assert(stu.context.features.recording === false, 'student may NOT record');

console.log('\n[4] Tamper detection — modified token fails verification');
const tampered = modToken.slice(0, -4) + 'AAAA';
let rejected = false;
try { jwt.verify(tampered, publicKey, { algorithms: ['RS256'] }); } catch { rejected = true; }
assert(rejected, 'tampered signature is rejected');

console.log('\n[5] Client join payload shape');
const payload = jaasJoinPayload({ room, user: { id: 'u1', name: 'T' }, moderator: true });
assert(payload.configured === true, 'payload.configured = true');
assert(payload.domain === JAAS_DOMAIN && payload.domain === '8x8.vc', 'domain = 8x8.vc');
assert(payload.appId === APP_ID, 'payload.appId = tenant');
assert(typeof payload.token === 'string' && payload.token.split('.').length === 3, 'payload.token is a JWT');

console.log('\n[6] Unconfigured → graceful fallback (fresh process, no JAAS_* env)');
// env.js captures process.env at load, so run a clean child process with the
// JaaS vars blanked to prove the fallback path.
const childCode = `import { jaasConfigured, jaasJoinPayload } from './src/services/jaasToken.js';
const r = jaasJoinPayload({ room: 'fallback-room', user: { id: 'u1', name: 'T' }, moderator: true });
process.stdout.write('@@@' + JSON.stringify({ configured: jaasConfigured(), payload: r }) + '@@@');`;
const out = execFileSync(process.execPath, ['--input-type=module', '-e', childCode], {
  cwd: process.cwd(),
  env: { ...process.env, JAAS_APP_ID: '', JAAS_KID: '', JAAS_PRIVATE_KEY: '' },
  encoding: 'utf8',
});
// env.js logs INFO/WARN to stdout; extract just our marked JSON.
const res = JSON.parse(out.split('@@@')[1]);
assert(res.configured === false, 'jaasConfigured() false when vars unset');
assert(res.payload.configured === false && res.payload.room === 'fallback-room', 'fallback payload {configured:false, room}');

console.log(`\n—— JaaS token E2E: ${pass} passed, ${fail} failed ——`);
process.exit(fail > 0 ? 1 : 0);
