/**
 * mcqParser — turn an uploaded MCQ file into a validated question bank:
 *   [{ question, options:[4 strings], correctOption:0-3 }]
 *
 * Supported: .docx / .doc (via mammoth), .txt, .md  → text parser
 *            .csv                                    → csv parser
 *
 * Text format (what the provided files use):
 *   Q1. <question text>
 *   A. <option>            (A–D prefixes optional; 4 lines per question)
 *   B. <option>
 *   ...
 *   Answer Key
 *   Q1. C — <optional text>   (question number → correct letter)
 *
 * CSV format: header row optional; columns:
 *   question, optionA, optionB, optionC, optionD, correct   (correct = A–D or 1–4 or the text)
 */
import mammoth from 'mammoth';

const LETTER = { A: 0, B: 1, C: 2, D: 3 };

export function parseTextBank(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const akIdx = lines.findIndex(l => /^answer\s*key\b/i.test(l));
  const qLines = akIdx >= 0 ? lines.slice(0, akIdx) : lines;
  const akLines = akIdx >= 0 ? lines.slice(akIdx + 1) : [];

  // answer key: "Q1. C — text" | "1) B" | "1 A" | "1. a"
  const key = {};
  for (const l of akLines) {
    const m = l.match(/^Q?\s*(\d+)\s*[.):\-]*\s*([A-Da-d])\b/);
    if (m) key[+m[1]] = LETTER[m[2].toUpperCase()];
  }

  // questions + options; optional "Section: <label>" lines tag the questions
  // that follow with a topic / learning-outcome label (reported on results),
  // and an optional "Overview: <text>" line after a Section gives the case
  // overview shown to students when that section starts.
  const banks = [];
  const sections = [];
  let cur = null;
  let topic = '';
  const isOpt = (l) => /^[A-Da-d][.)]\s+/.test(l);
  const isQ = (l) => /^Q?\s*\d+\s*[.)]\s+/.test(l) && !isOpt(l);
  const isSection = (l) => /^section\s*[:\-]\s*/i.test(l);
  const isOverview = (l) => /^overview\s*[:\-]\s*/i.test(l);
  for (const l of qLines) {
    if (isSection(l)) {
      topic = l.replace(/^section\s*[:\-]\s*/i, '').trim().slice(0, 160);
      if (topic && !sections.some(s => s.tag === topic)) sections.push({ tag: topic, overview: '' });
    } else if (isOverview(l)) {
      const s = sections.find(x => x.tag === topic);
      if (s) s.overview = (s.overview ? s.overview + ' ' : '') + l.replace(/^overview\s*[:\-]\s*/i, '').trim();
    } else if (isQ(l)) {
      if (cur) banks.push(cur);
      const m = l.match(/^Q?\s*(\d+)\s*[.)]\s+(.+)/);
      cur = { n: +m[1], question: m[2].trim(), options: [], topic };
    } else if (cur && cur.options.length < 4) {
      const opt = l.replace(/^[A-Da-d][.)]\s+/, '').trim();
      if (opt) cur.options.push(opt);
    }
  }
  if (cur) banks.push(cur);

  const out = [];
  const problems = [];
  for (const q of banks) {
    if (q.options.length !== 4) { problems.push(`Q${q.n}: found ${q.options.length} options (need exactly 4)`); continue; }
    if (!(q.n in key)) { problems.push(`Q${q.n}: no matching answer in the Answer Key`); continue; }
    out.push({ question: q.question, options: q.options, correctOption: key[q.n], topic: q.topic || '' });
  }
  if (out.length === 0) {
    throw new Error(akIdx < 0
      ? 'No "Answer Key" section found. The file must list the correct answer for each question under an "Answer Key" heading.'
      : ('Could not read any complete questions. ' + (problems[0] || '')));
  }
  if (problems.length) throw new Error(`${problems.length} question(s) had issues: ` + problems.slice(0, 5).join('; '));
  out.sections = sections;   // [{tag, overview}] in bank order (empty when no Section lines)
  return out;
}

function splitCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else { if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

export function parseCsvBank(text) {
  const rows = text.split(/\r?\n/).filter(l => l.trim()).map(splitCsvLine);
  const out = [];
  rows.forEach((cells, idx) => {
    if (cells.length < 6) return;
    // skip a header row
    if (idx === 0 && !/^[A-D1-4]/i.test(cells[5]) && /answer|correct|option|question/i.test(cells.join(' '))) return;
    const [q, a, b, c, d, correctRaw] = cells;
    if (!q || !a || !b || !c || !d) return;
    let ci = LETTER[(correctRaw || '').trim().toUpperCase()[0]];
    if (ci == null) { const n = parseInt(correctRaw, 10); if (n >= 1 && n <= 4) ci = n - 1; }
    if (ci == null) { const t = (correctRaw || '').trim().toLowerCase(); ci = [a, b, c, d].findIndex(o => o.trim().toLowerCase() === t); }
    if (ci == null || ci < 0) throw new Error(`Row ${idx + 1}: could not read the correct answer "${correctRaw}" (use A–D, 1–4, or the exact option text).`);
    out.push({ question: q, options: [a, b, c, d], correctOption: ci });
  });
  if (out.length === 0) throw new Error('No questions found in the CSV. Expected columns: question, A, B, C, D, correct.');
  return out;
}

/** Parse an uploaded file buffer into a question bank. */
export async function parseMcqFile(buffer, filename = '', mimetype = '') {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (ext === 'csv' || mimetype.includes('csv')) return parseCsvBank(buffer.toString('utf8'));
  if (ext === 'docx' || ext === 'doc' || mimetype.includes('word') || mimetype.includes('officedocument')) {
    const r = await mammoth.extractRawText({ buffer });
    return parseTextBank(r.value || '');
  }
  // txt / md / anything else → treat as text
  return parseTextBank(buffer.toString('utf8'));
}
