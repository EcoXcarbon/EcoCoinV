// Faithful E2E for the EMBEDDED live-streaming experience as users actually see it.
//
// Unlike _livestream-verify.mjs (which loads meet.jit.si directly), this:
//   1. Serves a parent page from origin https://tl.ppmc.pk WITH the exact
//      production CSP (frame-src https://meet.jit.si; ...).
//   2. Embeds the Jitsi room in an <iframe> exactly like MeetTab.jsx JitsiView.
//   3. Proves the embed is NOT blocked by CSP, and detects whether the user
//      lands straight in the conference or gets stuck on the "Join meeting"
//      prejoin screen.
//
// It tests TWO url variants:
//   A) current app URL  -> #config.prejoinPageEnabled=false   (deprecated flag)
//   B) fixed URL        -> #config.prejoinConfig.enabled=false (current flag)
//
// Run from server dir:  node src/scripts/_livestream-embed-e2e.mjs
import crypto from 'crypto';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = path.join(__dirname, '..', '..', '..', 'screenshots');

// Exact production CSP served on tl.ppmc.pk (captured from the live site).
const PROD_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://rsms.me; " +
  "font-src 'self' https://fonts.gstatic.com https://rsms.me data:; " +
  "img-src 'self' data: blob: https:; connect-src 'self' wss:; " +
  "frame-src https://meet.jit.si; frame-ancestors 'none'; base-uri 'self'; form-action 'self';";

const room = 'tl-live-' + crypto.randomBytes(16).toString('base64url');
const name = 'Test Teacher';

const VARIANTS = [
  {
    key: 'A-current', label: 'CURRENT app URL (prejoinPageEnabled=false)',
    url: `https://meet.jit.si/${encodeURIComponent(room)}` +
         `#userInfo.displayName="${encodeURIComponent(name)}"&config.prejoinPageEnabled=false`,
  },
  {
    key: 'B-fixed', label: 'FIXED URL (prejoinConfig.enabled=false + lobby/deeplink off)',
    url: `https://meet.jit.si/${encodeURIComponent(room + 'b')}` +
         `#userInfo.displayName=${encodeURIComponent('"' + name + '"')}` +
         `&config.prejoinConfig.enabled=false` +
         `&config.disableDeepLinking=true`,
  },
];

const parentHtml = (iframeUrl) => `<!doctype html><html><head><meta charset="utf-8">
<title>TL embed test</title></head><body style="margin:0">
<iframe title="Class Jitsi Meeting" src="${iframeUrl}"
  allow="camera; microphone; fullscreen; display-capture; autoplay; clipboard-write"
  allowfullscreen style="width:100vw;height:100vh;border:0"></iframe>
</body></html>`;

let pass = 0, fail = 0;
const assert = (c, m) => { if (c) { console.log(`  ✓ ${m}`); pass++; } else { console.error(`  ❌ FAIL: ${m}`); fail++; } };

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});

for (const v of VARIANTS) {
  console.log(`\n=== Variant ${v.key}: ${v.label} ===`);
  const ctx = await browser.newContext({
    permissions: ['camera', 'microphone'],
    viewport: { width: 1280, height: 720 },
  });
  const page = await ctx.newPage();

  // Serve the parent page from https://tl.ppmc.pk WITH the production CSP header,
  // so the iframe embed is evaluated under the real policy.
  await page.route('https://tl.ppmc.pk/_embedtest', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/html', 'content-security-policy': PROD_CSP },
      body: parentHtml(v.url),
    }));

  const cspViolations = [];
  page.on('console', (msg) => {
    const t = msg.text();
    if (/Content Security Policy|Refused to frame|violates the following/i.test(t)) cspViolations.push(t);
  });

  await page.goto('https://tl.ppmc.pk/_embedtest', { waitUntil: 'domcontentloaded', timeout: 30000 });

  const frameEl = await page.waitForSelector('iframe', { timeout: 10000 });
  const frame = await frameEl.contentFrame();
  assert(!!frame, 'iframe content frame is accessible (not CSP-blocked)');
  assert(cspViolations.length === 0, `no CSP frame violations (${cspViolations.length})`);

  // Let Jitsi boot inside the iframe.
  let booted = false;
  try {
    await frame.waitForSelector('#largeVideoContainer, .premeeting-screen, #new-toolbox, [class*="prejoin"], video', { timeout: 40000 });
    booted = true;
  } catch { booted = false; }
  assert(booted, 'Jitsi app booted INSIDE the embedded iframe');

  await page.waitForTimeout(6000); // settle

  // Distinguish prejoin ("Join meeting" screen) vs actually in the conference.
  const state = await frame.evaluate(() => {
    const txt = (document.body.innerText || '');
    const hasPrejoinBtn = !!Array.from(document.querySelectorAll('div,button,span'))
      .find(el => /^join meeting$/i.test((el.textContent || '').trim()));
    const onPrejoin = !!document.querySelector('.premeeting-screen, [class*="prejoin"]') || hasPrejoinBtn;
    const inConference = !!document.querySelector('#largeVideoContainer, .filmstrip, #new-toolbox')
      && !onPrejoin;
    return { onPrejoin, inConference, sample: txt.replace(/\s+/g, ' ').slice(0, 80) };
  });

  console.log(`  state: onPrejoin=${state.onPrejoin} inConference=${state.inConference} | "${state.sample}"`);
  const shot = path.join(SHOT_DIR, `livestream-embed-${v.key}.png`);
  await page.screenshot({ path: shot });
  console.log(`  📸 ${shot}`);

  // The desired behaviour: user lands straight in the conference, NOT stuck on prejoin.
  assert(!state.onPrejoin, 'user is NOT stuck on the "Join meeting" prejoin screen');
  assert(state.inConference, 'user landed directly in the live conference');

  await ctx.close();
}

await browser.close();
console.log(`\n—— Embed E2E: ${pass} passed, ${fail} failed ——`);
process.exit(fail > 0 ? 1 : 0);
