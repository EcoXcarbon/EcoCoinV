'use strict';
/**
 * NSP identifier scheme
 * ---------------------
 * Format:  NSP-<CC>-<YY>-<NNNNNNN>-<K>
 *   CC       ISO 3166-1 alpha-2 country of the issuing registry (e.g. PK)
 *   YY       two-digit year of first registration
 *   NNNNNNN  7-digit zero-padded sequence, unique per (CC, YY)
 *   K        ISO/IEC 7064 MOD 37,36 check character over "CC YY NNNNNNN"
 *
 * Example: NSP-PK-26-0000123-N
 *
 * The check character catches all single-character errors and all adjacent
 * transpositions, which is what the card printers, call-centre agents and
 * border/employer desks need when the number is keyed by hand.
 */

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const M = 36;

function charValue(c) {
  const v = ALPHABET.indexOf(c);
  if (v < 0) throw new Error(`Character not allowed in NSP ID: ${c}`);
  return v;
}

/** ISO/IEC 7064 MOD 37,36 (hybrid system) check character. */
function mod3736Check(body) {
  let p = M;
  for (const c of body.toUpperCase()) {
    p = (p + charValue(c)) % M;
    if (p === 0) p = M;
    p = (p * 2) % (M + 1);
  }
  const check = (M + 1 - p) % M;
  return ALPHABET[check];
}

/** Validates a body + check pair using the same recurrence (result must be 1). */
function mod3736Verify(bodyWithCheck) {
  const s = bodyWithCheck.toUpperCase();
  let p = M;
  for (let i = 0; i < s.length; i++) {
    let sum = (p + charValue(s[i])) % M;
    if (sum === 0) sum = M;
    if (i === s.length - 1) return sum % M === 1;
    p = (sum * 2) % (M + 1);
  }
  return false;
}

function formatNspId(country, year, sequence) {
  const cc = String(country).toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) throw new Error('country must be ISO 3166-1 alpha-2');
  const yy = String(year % 100).padStart(2, '0');
  const seq = String(sequence).padStart(7, '0');
  if (seq.length !== 7) throw new Error('sequence exceeds 7 digits');
  const body = `${cc}${yy}${seq}`;
  const k = mod3736Check(body);
  return `NSP-${cc}-${yy}-${seq}-${k}`;
}

const NSP_ID_RE = /^NSP-([A-Z]{2})-(\d{2})-(\d{7})-([0-9A-Z])$/;

function parseNspId(id) {
  if (typeof id !== 'string') return null;
  const m = NSP_ID_RE.exec(id.trim().toUpperCase());
  if (!m) return null;
  const [, cc, yy, seq, k] = m;
  if (!mod3736Verify(`${cc}${yy}${seq}${k}`)) return null;
  return { country: cc, year: 2000 + Number(yy), sequence: Number(seq), check: k, id: m[0] };
}

function isValidNspId(id) {
  return parseNspId(id) !== null;
}

/** Normalises user input like "nsp pk 26 0000123 n" or "NSPPK260000123N". */
function normaliseNspId(input) {
  if (typeof input !== 'string') return null;
  const compact = input.toUpperCase().replace(/[^0-9A-Z]/g, '');
  const m = /^NSP([A-Z]{2})(\d{2})(\d{7})([0-9A-Z])$/.exec(compact);
  if (!m) return null;
  const id = `NSP-${m[1]}-${m[2]}-${m[3]}-${m[4]}`;
  return isValidNspId(id) ? id : null;
}

module.exports = { formatNspId, parseNspId, isValidNspId, normaliseNspId, mod3736Check, mod3736Verify, NSP_ID_RE };
