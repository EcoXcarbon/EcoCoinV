'use strict';
/**
 * Machine Readable Zone for the NSP card back.
 *
 * Modelled on ICAO Doc 9303 Part 5 (TD1 size documents, 3 lines x 30 chars)
 * so that any standard OCR-B MRZ reader can parse it. Document code "NS"
 * is a private-use code (ICAO reserves I/A/C for official travel docs; we use
 * a non-reserved pair so the card is never mistaken for an ID document).
 *
 * Line 1: DOC(2) ISSUER(3) NUMBER(9) CHK(1) OPTIONAL(15)
 * Line 2: DOB(6) CHK(1) SEX(1) EXP(6) CHK(1) NAT(3) OPTIONAL(11) COMPOSITE(1)
 * Line 3: NAME(30)  family<<given<given
 */

const WEIGHTS = [7, 3, 1];

function charVal(c) {
  if (c === '<') return 0;
  if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48;
  if (c >= 'A' && c <= 'Z') return c.charCodeAt(0) - 55;
  throw new Error(`Invalid MRZ char: ${c}`);
}

function checkDigit(s) {
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += charVal(s[i]) * WEIGHTS[i % 3];
  return String(sum % 10);
}

// ICAO Doc 9303 Part 3 transliterations for Latin letters that NFD cannot decompose
const TRANSLIT = { 'Ø': 'OE', 'ø': 'OE', 'Æ': 'AE', 'æ': 'AE', 'Œ': 'OE', 'œ': 'OE', 'ß': 'SS', 'Ð': 'D', 'ð': 'D', 'Þ': 'TH', 'þ': 'TH', 'Ł': 'L', 'ł': 'L', 'Đ': 'D', 'đ': 'D', 'Ħ': 'H', 'ħ': 'H', 'Ĳ': 'IJ', 'ĳ': 'IJ', 'Ŋ': 'N', 'ŋ': 'N', 'Ŧ': 'T', 'ŧ': 'T' };

function clean(s) {
  return String(s || '')
    .replace(/[ØøÆæŒœßÐðÞþŁłĐđĦħĲĳŊŋŦŧ]/g, c => TRANSLIT[c])
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .trim();
}

function pad(s, n) {
  s = clean(s).replace(/ /g, '<');
  return (s + '<'.repeat(n)).slice(0, n);
}

function yymmdd(iso) {
  if (!iso) return '<<<<<<';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '<<<<<<';
  const yy = String(d.getUTCFullYear() % 100).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

/**
 * @param {object} p
 * @param {string} p.issuerAlpha3  e.g. "PAK"
 * @param {string} p.nspId         e.g. "NSP-PK-26-0000123-N"  (digits+check used as doc number)
 * @param {string} p.familyName
 * @param {string} p.givenNames
 * @param {string} p.dateOfBirth   ISO date
 * @param {string} p.sex           M | F | X
 * @param {string} p.expiry        ISO date
 * @param {string} p.nationalityAlpha3
 * @param {string} [p.cardSerial]  up to 15 chars, goes in optional data 1
 */
function buildMrz(p) {
  const parsed = /^NSP-([A-Z]{2})-(\d{2})-(\d{7})-([0-9A-Z])$/.exec(p.nspId || '');
  if (!parsed) throw new Error('buildMrz: invalid nspId');
  // document number = YY + NNNNNNN (9 chars) ; NSP check char goes to optional data
  const docNumber = `${parsed[2]}${parsed[3]}`;
  const docChk = checkDigit(docNumber);
  const optional1 = pad(`${parsed[1]}${parsed[4]}${(p.cardSerial || '').replace(/[^A-Za-z0-9]/g, '')}`, 15);
  const line1 = `NS${pad(p.issuerAlpha3, 3)}${docNumber}${docChk}${optional1}`;

  const dob = yymmdd(p.dateOfBirth);
  const dobChk = checkDigit(dob);
  const sex = ['M', 'F', 'X'].includes(p.sex) ? (p.sex === 'X' ? '<' : p.sex) : '<';
  const exp = yymmdd(p.expiry);
  const expChk = checkDigit(exp);
  const nat = pad(p.nationalityAlpha3, 3);
  const optional2 = pad('', 11);
  const compositeInput = `${docNumber}${docChk}${optional1}${dob}${dobChk}${exp}${expChk}${optional2}`;
  const composite = checkDigit(compositeInput);
  const line2 = `${dob}${dobChk}${sex}${exp}${expChk}${nat}${optional2}${composite}`;

  const family = clean(p.familyName).replace(/ /g, '<');
  const given = clean(p.givenNames).replace(/ /g, '<');
  const line3 = (`${family}<<${given}` + '<'.repeat(30)).slice(0, 30);

  for (const l of [line1, line2, line3]) {
    if (l.length !== 30) throw new Error(`MRZ line length ${l.length} != 30: ${l}`);
  }
  return { line1, line2, line3, text: `${line1}\n${line2}\n${line3}` };
}

function verifyMrz({ line1, line2 }) {
  const docNumber = line1.slice(5, 14);
  const docChk = line1[14];
  const optional1 = line1.slice(15, 30);
  const dob = line2.slice(0, 6);
  const dobChk = line2[6];
  const exp = line2.slice(8, 14);
  const expChk = line2[14];
  const optional2 = line2.slice(18, 29);
  const composite = line2[29];
  const ok = checkDigit(docNumber) === docChk
    && checkDigit(dob) === dobChk
    && checkDigit(exp) === expChk
    && checkDigit(`${docNumber}${docChk}${optional1}${dob}${dobChk}${exp}${expChk}${optional2}`) === composite;
  return ok;
}

module.exports = { buildMrz, verifyMrz, checkDigit };
