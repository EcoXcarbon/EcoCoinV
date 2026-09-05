'use strict';
/* Copies the self-hosted typefaces (OFL) from the @fontsource packages into public/assets/fonts.
   Runs on `npm install` (postinstall). Missing packages are skipped so production installs with
   --omit=dev still work — the CSS falls back to system faces. */
const fs = require('node:fs');
const path = require('node:path');
const out = path.join(__dirname, '..', 'public', 'assets', 'fonts');
fs.mkdirSync(out, { recursive: true });
const wanted = {
  'inter': ['400-normal', '500-normal', '600-normal', '700-normal'],
  'ibm-plex-sans': ['400-normal', '400-italic', '500-normal', '600-normal', '700-normal'],
  'ibm-plex-sans-condensed': ['500-normal', '600-normal', '700-normal'],
  'b612-mono': ['400-normal', '700-normal'],
  'spectral': ['400-normal', '400-italic', '500-italic', '600-normal', '700-normal']
};
let n = 0;
for (const [pkg, faces] of Object.entries(wanted)) {
  let dir;
  try { dir = path.join(path.dirname(require.resolve(`@fontsource/${pkg}/package.json`)), 'files'); } catch { console.warn(`copy-fonts: @fontsource/${pkg} not installed, skipping`); continue; }
  for (const f of faces) {
    const file = `${pkg}-latin-${f}.woff2`;
    try { fs.copyFileSync(path.join(dir, file), path.join(out, file)); n++; } catch (e) { console.warn(`copy-fonts: ${file}: ${e.message}`); }
  }
}
console.log(`copy-fonts: ${n} files → public/assets/fonts`);
