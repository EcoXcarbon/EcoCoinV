'use strict';
/**
 * Fuzzy duplicate detection.
 *
 * The unique index on (nationality, id_document_type, id_document_number)
 * already blocks the same CNIC twice. It does nothing about the same person
 * registered under a mistyped CNIC, a borrowed one, or no document at all,
 * which is the realistic fraud and error mode in a mass registration drive.
 *
 * Names here are normalised for Pakistani naming practice before comparison:
 *   - "Muhammad Ali Khan", "Mohammad Ali Khan", "Md Ali Khan" and "Ali Khan"
 *     all reduce to the same key, because the honorific/teknonym prefix is
 *     optional in everyday use and inconsistently recorded.
 *   - Initials are dropped ("M. Ali Khan" -> "ali khan").
 *   - Token order is normalised, since given/family order is frequently
 *     transposed between a CNIC and a handwritten form.
 *
 * A fuzzy hit is deliberately NOT a hard rejection. Namesakes with the same
 * date of birth genuinely exist, and refusing them would silently exclude real
 * workers. Hits are attached to the record and surfaced in the registrar
 * queue for a human decision.
 */

// Prefixes that are honorifics or near-universal given-name components rather
// than distinguishing parts of a name. Conservative on purpose: only tokens
// that are ambiguous as identifiers in practice.
const DROP_TOKENS = new Set([
  'muhammad', 'mohammad', 'mohammed', 'muhammed', 'mohd', 'md', 'mohamad',
  'syed', 'syeda', 'sayed', 'sayyed',
  'mst', 'musammat', 'mussammat',
  'mr', 'mrs', 'miss', 'ms', 'dr',
  'bin', 'bint', 'ibn'
]);

// Spelling variants that should collapse to one form before comparison.
const CANONICAL = new Map([
  ['mohammad', 'muhammad'], ['mohammed', 'muhammad'], ['muhammed', 'muhammad'],
  ['mohamad', 'muhammad'], ['mohd', 'muhammad'], ['md', 'muhammad'],
  ['ahmad', 'ahmed'], ['ahmmed', 'ahmed'],
  ['hussain', 'hussain'], ['hussein', 'hussain'], ['husain', 'hussain'],
  ['khhan', 'khan'],
  ['begam', 'begum'],
  ['abdul', 'abdul'], ['abdool', 'abdul']
]);

function tokenise(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')   // strip combining marks
    .toLowerCase()
    .replace(/[^a-z؀-ۿ]+/g, ' ')  // keep latin + arabic-script letters
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Comparison key for a person's name. Order-independent, honorific-free.
 * Returns '' when nothing distinguishing remains.
 */
function nameKey(...parts) {
  const seen = new Set();
  for (const raw of tokenise(parts.filter(Boolean).join(' '))) {
    const t = CANONICAL.get(raw) || raw;
    if (t.length < 2) continue;          // drop initials
    if (DROP_TOKENS.has(t)) continue;
    seen.add(t);
  }
  return [...seen].sort().join(' ');
}

/** Dice coefficient over character bigrams: 1.0 identical, 0.0 disjoint. */
function similarity(a, b) {
  const A = bigrams(a), B = bigrams(b);
  if (!A.length || !B.length) return a === b ? 1 : 0;
  const pool = new Map();
  for (const g of A) pool.set(g, (pool.get(g) || 0) + 1);
  let hits = 0;
  for (const g of B) {
    const n = pool.get(g) || 0;
    if (n > 0) { hits++; pool.set(g, n - 1); }
  }
  return (2 * hits) / (A.length + B.length);
}

function bigrams(s) {
  const t = String(s || '').replace(/\s+/g, '');
  const out = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

/**
 * Score a candidate record against the applicant.
 * Returns { score, reasons[] } where score is 0..100.
 */
function scoreCandidate(applicant, candidate) {
  const reasons = [];
  let score = 0;

  const sameDob = applicant.dateOfBirth && applicant.dateOfBirth === candidate.dateOfBirth;
  const nameSim = similarity(applicant.nameKey, candidate.nameKey);

  if (applicant.nameKey && applicant.nameKey === candidate.nameKey && sameDob) {
    score += 70; reasons.push('identical normalised name and date of birth');
  } else if (sameDob && nameSim >= 0.85) {
    score += 55; reasons.push(`date of birth matches and name is ${Math.round(nameSim * 100)}% similar`);
  } else if (sameDob && nameSim >= 0.6) {
    score += 30; reasons.push(`date of birth matches and name is ${Math.round(nameSim * 100)}% similar`);
  } else if (applicant.nameKey && applicant.nameKey === candidate.nameKey) {
    score += 20; reasons.push('identical normalised name, different date of birth');
  }

  if (applicant.fatherKey && applicant.fatherKey === candidate.fatherKey) {
    score += 20; reasons.push("father's / guardian's name matches");
  }
  if (applicant.phone && applicant.phone === candidate.phone) {
    score += 15; reasons.push('same mobile number');
  }
  if (applicant.email && applicant.email === candidate.email) {
    score += 10; reasons.push('same email address');
  }

  return { score: Math.min(score, 100), reasons };
}

module.exports = { nameKey, similarity, scoreCandidate, tokenise };
