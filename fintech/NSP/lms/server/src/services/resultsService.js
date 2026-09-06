/**
 * resultsService — PDF result slips for timed exams.
 *  - generateExamResultPDF: single-student result (name, class, score).
 *  - generateClassSheetPDF:  instructor consolidated class results sheet.
 * Uses pdfkit (already a dependency, same as pdfService).
 */
import PDFDocument from 'pdfkit';

const NAVY = '#002D72', GOLD = '#B8860B', GREY = '#6b7280', LINE = '#d1d5db', GREEN = '#15803d', RED = '#b91c1c';

function fmtDate(d) {
  try {
    return new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

/**
 * Single-student result slip.
 * data: {studentName, className, score, total, correctCount, answered,
 *        totalQuestions, topics:[{tag,correct,total,pct}], submittedAt,
 *        credentialId, flags, org}
 */
export function generateExamResultPDF(stream, data) {
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Result — ${data.studentName || ''}` } });
  doc.pipe(stream);

  const W = doc.page.width, M = 48, cw = W - M * 2;
  const pct = data.total ? Math.round((data.score / data.total) * 100) : 0;
  const nQ = data.totalQuestions || 0;
  const perQ = nQ && data.total ? Math.round((data.total / nQ) * 100) / 100 : 1;

  // Header band
  doc.rect(0, 0, W, 92).fill(NAVY);
  const org = (data.org || 'TalentLedger').slice(0, 90);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(16).text(org, M, 24, { width: cw, lineBreak: false });
  doc.fillColor('#cbd5e1').font('Helvetica').fontSize(10).text('Online Class Assessment', M, 50);
  doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(10).text('STUDENT RESULT SHEET', M, 67);

  // Student / course / date — compact two-column block
  let y = 112;
  const half = cw / 2;
  const cell = (label, value, x, w) => {
    doc.fillColor(GREY).font('Helvetica').fontSize(8.5).text(label.toUpperCase(), x, y);
    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(12).text(value || '—', x, y + 11, { width: w });
  };
  cell('Student Name', data.studentName, M, half - 10);
  cell('Date & Time', fmtDate(data.submittedAt || Date.now()), M + half, half);
  y += 40;
  cell('Course / Assessment', data.className, M, cw);
  y += 44;

  // Marks panel: big marks + progress bar + question counts
  const boxH = 118;
  doc.roundedRect(M, y, cw, boxH, 10).lineWidth(1).strokeColor(LINE).stroke();
  doc.fillColor(GREY).font('Helvetica').fontSize(10).text('MARKS OBTAINED', M, y + 14, { width: cw, align: 'center' });
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(40)
     .text(`${data.score} / ${data.total}`, M, y + 28, { width: cw, align: 'center' });
  doc.fillColor(pct >= 50 ? GREEN : RED).font('Helvetica-Bold').fontSize(14)
     .text(`${pct}%  ·  ${pct >= 50 ? 'PASS' : 'FAIL'}`, M, y + 72, { width: cw, align: 'center' });
  // progress bar
  const barW = cw - 120, barX = M + 60, barY = y + 96;
  doc.roundedRect(barX, barY, barW, 8, 4).fill('#e5e7eb');
  if (pct > 0) doc.roundedRect(barX, barY, Math.max(8, barW * Math.min(pct, 100) / 100), 8, 4).fill(pct >= 50 ? GREEN : RED);
  y += boxH + 10;

  const line2 = nQ
    ? `Questions correct: ${data.correctCount ?? '—'} of ${nQ}   ·   Attempted: ${Math.min(data.answered ?? 0, nQ)} of ${nQ}   ·   ${perQ} mark${perQ === 1 ? '' : 's'} per correct answer`
    : 'This result reflects a single, time-limited attempt.';
  doc.fillColor(GREY).font('Helvetica').fontSize(9).text(line2, M, y, { width: cw, align: 'center' });
  y += 24;

  // Learning-outcome achievement table
  const topics = Array.isArray(data.topics) ? data.topics : [];
  if (topics.length) {
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11).text('Learning Outcome Achievement', M, y);
    y += 18;
    const colTag = cw - 200, colScore = 60, colBar = 140;
    doc.rect(M, y, cw, 20).fill('#f1f5f9');
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(8.5);
    doc.text('SECTION / LEARNING OUTCOME', M + 8, y + 6, { width: colTag - 12 });
    doc.text('CORRECT', M + colTag, y + 6, { width: colScore, align: 'right' });
    doc.text('ACHIEVEMENT', M + colTag + colScore + 10, y + 6, { width: colBar - 10, align: 'left' });
    y += 20;
    for (const t of topics) {
      if (y > doc.page.height - 130) { doc.addPage(); y = 48; }
      doc.fillColor('#111827').font('Helvetica').fontSize(9)
         .text(t.tag, M + 8, y + 6, { width: colTag - 12, height: 22, ellipsis: true });
      doc.fillColor('#111827').font('Helvetica-Bold').fontSize(9)
         .text(`${t.correct}/${t.total}`, M + colTag, y + 6, { width: colScore, align: 'right' });
      const bx = M + colTag + colScore + 10, bw = colBar - 46;
      doc.roundedRect(bx, y + 8, bw, 7, 3).fill('#e5e7eb');
      if (t.pct > 0) doc.roundedRect(bx, y + 8, Math.max(6, bw * Math.min(t.pct, 100) / 100), 7, 3)
        .fill(t.pct >= 70 ? GREEN : (t.pct >= 50 ? GOLD : RED));
      doc.fillColor(t.pct >= 50 ? '#111827' : RED).font('Helvetica-Bold').fontSize(8.5)
         .text(`${t.pct}%`, bx + bw + 6, y + 6, { width: 34, align: 'right' });
      doc.strokeColor('#eef2f7').lineWidth(0.5).moveTo(M, y + 22).lineTo(M + cw, y + 22).stroke();
      y += 24;
    }
    y += 8;
  }

  // Integrity flags
  const fl = data.flags || {};
  const parts = [];
  if (fl.tabSwitch) parts.push(`${fl.tabSwitch} tab-switch${fl.tabSwitch > 1 ? 'es' : ''}`);
  if (fl.copy) parts.push(`${fl.copy} copy attempt${fl.copy > 1 ? 's' : ''}`);
  if (fl.fullscreenExit) parts.push(`${fl.fullscreenExit} fullscreen exit${fl.fullscreenExit > 1 ? 's' : ''}`);
  const flagText = parts.length ? parts.join('  ·  ') : 'None recorded';
  doc.fillColor(parts.length ? RED : GREEN).font('Helvetica-Bold').fontSize(9)
     .text(`Integrity: ${flagText}`, M, y, { width: cw, align: 'center' });
  if (data.credentialId) {
    doc.fillColor(GREY).font('Helvetica').fontSize(8).text(`Ref: ${data.credentialId}`, M, y + 14, { width: cw, align: 'center' });
  }

  // Footer
  doc.fillColor(LINE).moveTo(M, doc.page.height - 70).lineTo(W - M, doc.page.height - 70).stroke();
  doc.fillColor(GREY).font('Helvetica').fontSize(8)
     .text(`${data.org ? data.org + '  ·  ' : ''}Online Assessment via TalentLedger  ·  single time-limited attempt, server-scored`, M, doc.page.height - 60, { width: cw, align: 'center' });

  doc.end();
}

/** Instructor class sheet. data: {className, generatedAt, rows:[{name, score, total, pct, submittedAt, status}]} */
export function generateClassSheetPDF(stream, data) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Class Results — ${data.className || ''}` } });
  doc.pipe(stream);

  const W = doc.page.width, M = 40, cw = W - M * 2;
  doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(10).text(data.org || 'TalentLedger', M, 34);
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(18).text('Class Results Sheet', M, 50);
  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(12).text(data.className || '', M, 72);
  doc.fillColor(GREY).font('Helvetica').fontSize(9)
     .text(`Generated ${fmtDate(data.generatedAt || Date.now())}  ·  ${data.rows.length} student(s)`, M, 90);

  // Table
  const cols = [
    { key: 'idx',   label: '#',        w: 24,  align: 'left'  },
    { key: 'name',  label: 'Student',  w: 178, align: 'left'  },
    { key: 'score', label: 'Score',    w: 66,  align: 'right' },
    { key: 'pct',   label: '%',        w: 42,  align: 'right' },
    { key: 'flags', label: 'Flags',    w: 55,  align: 'right' },
    { key: 'when',  label: 'Submitted',w: 105, align: 'right' },
  ];
  let x0 = M, y = 116;
  const drawHeader = () => {
    doc.rect(M, y, cw, 22).fill('#f1f5f9');
    let x = x0 + 6;
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9);
    for (const c of cols) { doc.text(c.label, x, y + 7, { width: c.w - 8, align: c.align }); x += c.w; }
    y += 22;
  };
  drawHeader();
  doc.font('Helvetica').fontSize(9);
  data.rows.forEach((r, i) => {
    if (y > doc.page.height - 60) { doc.addPage(); y = 40; drawHeader(); doc.font('Helvetica').fontSize(9); }
    if (i % 2 === 0) doc.rect(M, y, cw, 20).fill('#fafafa');
    let x = x0 + 6;
    const v = (r.flags?.copy || 0) + (r.flags?.tabSwitch || 0) + (r.flags?.fullscreenExit || 0);
    const cells = {
      idx: String(i + 1),
      name: r.name || '—',
      score: r.status === 'submitted' ? `${r.score} / ${r.total}` : '—',
      pct: r.status === 'submitted' ? `${r.pct}%` : '—',
      flags: r.status === 'submitted' ? String(v) : '—',
      when: r.status === 'submitted' ? fmtDate(r.submittedAt) : (r.status === 'in-progress' ? 'in progress' : 'not taken'),
    };
    for (const c of cols) {
      if (c.key === 'flags' && v > 0 && r.status === 'submitted') doc.fillColor(RED);
      else doc.fillColor(r.status === 'submitted' ? '#111827' : GREY);
      doc.text(cells[c.key], x, y + 6, { width: c.w - 8, align: c.align }); x += c.w;
    }
    y += 20;
  });

  // Summary
  const done = data.rows.filter(r => r.status === 'submitted');
  const avg = done.length ? Math.round(done.reduce((a, r) => a + r.pct, 0) / done.length) : 0;
  y += 14;
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10)
     .text(`Submitted: ${done.length}/${data.rows.length}    Average: ${avg}%`, M, y, { width: cw });
  doc.fillColor(GREY).font('Helvetica').fontSize(8)
     .text('Flags = recorded integrity events (copy attempts · tab-switches · fullscreen exits). See each student\'s result slip for the breakdown.', M, y + 16, { width: cw });

  doc.end();
}
