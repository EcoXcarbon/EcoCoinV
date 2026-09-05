'use strict';
/* Renders PNG previews of the demo card and certificate with headless Chromium.
   Usage: node scripts/render-previews.js [baseUrl] [chromePath]   (server must be running) */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const base = process.argv[2] || 'http://localhost:4100';
const chrome = process.argv[3] || process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const out = path.join(__dirname, '..', 'previews');
fs.mkdirSync(out, { recursive: true });
const shots = [
  ['card-demo.png', `${base}/card/demo?demo=1`, '1400,1120'],
  ['card-demo-bleed.png', `${base}/card/demo?demo=1&bleed=1&chip=1`, '1400,1160'],
  ['certificate-demo.png', `${base}/certificate/demo?demo=1`, '900,1260'],
  ['register.png', `${base}/register`, '1280,1400'],
  ['verify.png', `${base}/verify`, '1280,800'],
  ['home.png', `${base}/`, '1280,1100']
];
for (const [file, url, size] of shots) {
  const r = spawnSync(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', `--window-size=${size}`, `--screenshot=${path.join(out, file)}`, url], { encoding: 'utf8', timeout: 60000 });
  console.log(file, r.status === 0 ? 'ok' : 'failed', r.status !== 0 ? r.stderr.slice(-300) : '');
}
