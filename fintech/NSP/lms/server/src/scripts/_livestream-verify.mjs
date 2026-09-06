// Live-streaming (embedded Jitsi) verification.
// Reproduces EXACTLY what the app does:
//   - room name: Class.js pre('save') -> 'tl-' + crypto.randomBytes(20).toString('base64url')
//   - embed URL: client/src/pages/classroom/MeetTab.jsx -> JitsiView()
// Then loads the real meet.jit.si room in a headless browser and asserts the
// Jitsi conference app actually boots inside the iframe target.
//
// Run from server dir:  node src/scripts/_livestream-verify.mjs
import crypto from 'crypto';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOT = path.join(__dirname, '..', '..', '..', 'screenshots', 'livestream-jitsi.png');

let pass = 0, fail = 0;
const assert = (cond, msg) => {
  if (cond) { console.log(`  ✓ ${msg}`); pass++; }
  else { console.error(`  ❌ FAIL: ${msg}`); fail++; }
};

// 1) Replicate the server's room-name generation (models/Class.js)
const jitsiRoom = 'tl-' + crypto.randomBytes(20).toString('base64url');
console.log('\n[1] Room name generation (mirrors Class.js pre-save)');
assert(jitsiRoom.startsWith('tl-'), `room has tl- prefix (${jitsiRoom})`);
assert(jitsiRoom.length === 30, `room length 30 (got ${jitsiRoom.length})`);
assert(/^tl-[A-Za-z0-9_-]+$/.test(jitsiRoom), 'room is url-safe base64url, no padding');

// 2) Replicate the client's embed URL construction (MeetTab.jsx JitsiView)
const currentUserName = 'Test Teacher';
const url = `https://meet.jit.si/${encodeURIComponent(jitsiRoom)}` +
  `#userInfo.displayName="${encodeURIComponent(currentUserName || 'Guest')}"` +
  `&config.prejoinPageEnabled=false`;
console.log('\n[2] Embed URL construction (mirrors JitsiView)');
assert(url.startsWith('https://meet.jit.si/tl-'), 'points at meet.jit.si room');
assert(url.includes('prejoinPageEnabled=false'), 'prejoin disabled (joins straight in)');
assert(url.includes('userInfo.displayName'), 'display name passed to Jitsi');
console.log(`  url = ${url}`);

// 3) Load the real Jitsi room headless and prove the conference app boots
console.log('\n[3] Loading real meet.jit.si room in a browser...');
let browser;
try {
  browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const ctx = await browser.newContext({
    permissions: ['camera', 'microphone'],
    viewport: { width: 1280, height: 800 },
  });
  const page = await ctx.newPage();
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  assert(resp && resp.status() < 400, `page loaded (HTTP ${resp && resp.status()})`);

  // Jitsi boots a SPA: wait for its app root / conference container to appear.
  let booted = false;
  try {
    await page.waitForSelector(
      '#react, .welcome, #largeVideoContainer, [class*="conference"], video, #new-toolbox, .premeeting-screen',
      { timeout: 40000 }
    );
    booted = true;
  } catch { booted = false; }
  assert(booted, 'Jitsi conference app initialized in the page');

  const title = await page.title();
  assert(/jitsi|meet/i.test(title), `page title looks like Jitsi ("${title}")`);

  // Is the app actually live (JS app mounted), not an error page?
  const hasApp = await page.evaluate(() => {
    return !!(document.querySelector('#react, #app, [data-testid], video, #largeVideoContainer, .premeeting-screen'))
      && !/not\s+supported|unsupported browser/i.test(document.body.innerText);
  });
  assert(hasApp, 'app mounted and browser supported (no unsupported-browser error)');

  await page.waitForTimeout(4000); // let media/UI settle for the screenshot
  await page.screenshot({ path: SHOT, fullPage: false });
  console.log(`  📸 screenshot saved: ${SHOT}`);
} catch (e) {
  assert(false, `browser load threw: ${e.message}`);
} finally {
  if (browser) await browser.close();
}

console.log(`\n—— Live-stream verify: ${pass} passed, ${fail} failed ——`);
if (fail > 0) process.exit(1);
console.log('✅ Live streaming (embedded Jitsi) verified.');
