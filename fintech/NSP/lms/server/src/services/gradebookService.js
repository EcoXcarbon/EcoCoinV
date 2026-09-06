/**
 * gradebookService — weighted grades, attendance, and downloadable marksheets
 * for a course (Training) whose quiz modules are its assessments.
 */
import PDFDocument from 'pdfkit';
import Training from '../models/Training.js';
import Worker from '../models/Worker.js';
import ExamAttempt from '../models/ExamAttempt.js';

const NAVY = '#002D72', GOLD = '#B8860B', GREY = '#6b7280', LINE = '#d1d5db', GREEN = '#15803d', RED = '#b91c1c';
const TYPE_LABEL = { pre: 'Pre-test', mid: 'Mid-term', final: 'Final', quiz: 'Quiz', assignment: 'Assignment' };

export function letterGrade(pct) {
  if (pct == null) return '—';
  if (pct >= 90) return 'A+'; if (pct >= 85) return 'A'; if (pct >= 80) return 'A-';
  if (pct >= 75) return 'B+'; if (pct >= 70) return 'B'; if (pct >= 65) return 'B-';
  if (pct >= 60) return 'C+'; if (pct >= 55) return 'C'; if (pct >= 50) return 'D';
  return 'F';
}
function assessmentsOf(training) {
  return (training.modules || []).filter(m => m.type === 'quiz' && (m.quizQuestions || []).length)
    .map(m => ({
      id: String(m._id), title: m.title || 'Assessment', examType: m.examType || 'quiz',
      weightPct: m.weightPct || 0, totalMarks: (m.quizQuestions || []).reduce((s, q) => s + (q.points > 0 ? q.points : 1), 0),
      questionCount: (m.quizQuestions || []).length, durationMin: m.duration || 30,
    }));
}
const fmtDate = (d) => { try { return new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

/** Full gradebook object for a course. */
export async function computeGradebook(courseId) {
  const training = await Training.findById(courseId);
  if (!training) return null;
  const assessments = assessmentsOf(training);
  const workerIds = (training.enrollments || []).map(e => e.worker).filter(Boolean);
  const workers = await Worker.find({ _id: { $in: workerIds } }, 'fullName');
  const attempts = await ExamAttempt.find({ training: training._id });
  const key = (w, m) => `${w}|${m}`;
  const amap = new Map(attempts.map(a => [key(a.worker, a.moduleId), a]));
  const totalWeight = assessments.reduce((s, a) => s + a.weightPct, 0);

  const students = workers.map(w => {
    let weightedNum = 0, submittedWeight = 0, takenCount = 0, submittedCount = 0;
    const per = assessments.map(a => {
      const at = amap.get(key(w._id, a.id));
      const taken = !!at;
      const submitted = at && at.status === 'submitted';
      const pct = submitted && at.total ? (at.score / at.total * 100) : (submitted ? 0 : null);
      if (taken) takenCount++;
      if (submitted) { submittedCount++; if (a.weightPct > 0) { weightedNum += a.weightPct * (pct || 0); submittedWeight += a.weightPct; } }
      return {
        assessmentId: a.id, taken, submitted,
        score: submitted ? at.score : null, total: submitted ? at.total : null,
        pct: pct == null ? null : Math.round(pct * 10) / 10,
        violations: at ? ((at.flags?.copy || 0) + (at.flags?.tabSwitch || 0) + (at.flags?.fullscreenExit || 0)) : 0,
      };
    });
    const finalPct = totalWeight > 0 ? Math.round(weightedNum / totalWeight * 10) / 10 : null;       // missing = 0
    const currentPct = submittedWeight > 0 ? Math.round(weightedNum / submittedWeight * 10) / 10 : null; // so-far
    const attendancePct = assessments.length ? Math.round(takenCount / assessments.length * 100) : 0;
    return { workerId: String(w._id), name: w.fullName, perAssessment: per, submittedCount, attendancePct, finalPct, currentPct, grade: letterGrade(finalPct) };
  }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  return { courseId: String(training._id), className: training.title, subject: training.trade, institution: training.institution || '', totalWeight, assessments, students };
}

/* ── PDFs ──────────────────────────────────────────────────────── */
function header(doc, W, M, org, title, sub) {
  doc.rect(0, 0, W, 84).fill(NAVY);
  doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(9).text((org || 'TalentLedger').slice(0, 90), M, 20);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(17).text(title, M, 36);
  if (sub) doc.fillColor('#cbd5e1').font('Helvetica').fontSize(10).text(sub, M, 60);
}

/** Class gradebook (students × assessments + final grade). */
export function generateGradebookPDF(stream, gb) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 32 });
  doc.pipe(stream);
  const W = doc.page.width, M = 32, cw = W - M * 2;
  header(doc, W, M, gb.institution, 'Class Gradebook', `${gb.className}${gb.subject ? ' · ' + gb.subject : ''}`);

  const aCols = gb.assessments.map(a => ({ id: a.id, label: `${TYPE_LABEL[a.examType] || a.title} (${a.weightPct}%)`, w: 62 }));
  const cols = [{ key: 'idx', label: '#', w: 22 }, { key: 'name', label: 'Student', w: 150 }, ...aCols.map(c => ({ key: c.id, label: c.label, w: c.w })),
    { key: 'att', label: 'Att%', w: 40 }, { key: 'fin', label: 'Final%', w: 46 }, { key: 'grd', label: 'Grade', w: 42 }];
  let y = 100;
  const drawHead = () => {
    doc.rect(M, y, cw, 20).fill('#f1f5f9');
    let x = M + 4; doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(7.5);
    for (const c of cols) { doc.text(c.label, x, y + 6, { width: c.w - 6, align: c.key === 'name' || c.key === 'idx' ? 'left' : 'right' }); x += c.w; }
    y += 20;
  };
  drawHead(); doc.font('Helvetica').fontSize(8);
  gb.students.forEach((s, i) => {
    if (y > doc.page.height - 44) { doc.addPage({ size: 'A4', layout: 'landscape', margin: 32 }); y = 40; drawHead(); doc.font('Helvetica').fontSize(8); }
    if (i % 2 === 0) doc.rect(M, y, cw, 18).fill('#fafafa');
    let x = M + 4;
    for (const c of cols) {
      let txt, color = '#111827';
      if (c.key === 'idx') txt = String(i + 1);
      else if (c.key === 'name') txt = s.name || '—';
      else if (c.key === 'att') txt = `${s.attendancePct}%`;
      else if (c.key === 'fin') txt = s.finalPct == null ? '—' : `${s.finalPct}`;
      else if (c.key === 'grd') { txt = s.grade; color = s.grade === 'F' ? RED : NAVY; }
      else { const p = s.perAssessment.find(a => a.assessmentId === c.key); txt = p && p.submitted ? `${p.score}/${p.total}` : (p && p.taken ? '·' : '—'); if (p && p.submitted && p.pct < 50) color = RED; }
      doc.fillColor(color).text(txt, x, y + 5, { width: c.w - 6, align: c.key === 'name' || c.key === 'idx' ? 'left' : 'right' }); x += c.w;
    }
    y += 18;
  });
  y += 12;
  doc.fillColor(GREY).font('Helvetica').fontSize(8).text('Att% = assessments attempted. Final% = weight-adjusted total (missing = 0). Weights: ' + gb.assessments.map(a => `${TYPE_LABEL[a.examType] || a.title} ${a.weightPct}%`).join(' · ') + `  (Σ ${gb.totalWeight}%).`, M, y, { width: cw });
  doc.end();
}

/** Per-student transcript. */
export function generateTranscriptPDF(stream, gb, student) {
  const doc = new PDFDocument({ size: 'A4', margin: 44 });
  doc.pipe(stream);
  const W = doc.page.width, M = 44, cw = W - M * 2;
  header(doc, W, M, gb.institution, 'Student Transcript', gb.className + (gb.subject ? ' · ' + gb.subject : ''));
  let y = 104;
  doc.fillColor(GREY).font('Helvetica').fontSize(10).text('STUDENT', M, y);
  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(15).text(student.name || '—', M, y + 13);
  y += 50;

  const cols = [{ k: 'a', l: 'Assessment', w: 150, al: 'left' }, { k: 't', l: 'Type', w: 70, al: 'left' }, { k: 'm', l: 'Marks', w: 70, al: 'right' }, { k: 'p', l: '%', w: 50, al: 'right' }, { k: 'w', l: 'Weight', w: 60, al: 'right' }, { k: 's', l: 'Status', w: 78, al: 'right' }];
  doc.rect(M, y, cw, 20).fill('#f1f5f9'); let x = M + 6; doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9);
  for (const c of cols) { doc.text(c.l, x, y + 6, { width: c.w - 8, align: c.al }); x += c.w; } y += 20;
  doc.font('Helvetica').fontSize(9);
  gb.assessments.forEach((a, i) => {
    const p = student.perAssessment.find(x2 => x2.assessmentId === a.id) || {};
    if (i % 2 === 0) doc.rect(M, y, cw, 19).fill('#fafafa');
    x = M + 6;
    const cells = { a: a.title, t: TYPE_LABEL[a.examType] || a.examType, m: p.submitted ? `${p.score} / ${p.total}` : '—', p: p.pct == null ? '—' : `${p.pct}%`, w: `${a.weightPct}%`, s: p.submitted ? 'Submitted' : (p.taken ? 'In progress' : 'Not taken') };
    doc.fillColor(p.submitted ? '#111827' : GREY);
    for (const c of cols) { doc.text(cells[c.k], x, y + 5, { width: c.w - 8, align: c.al }); x += c.w; } y += 19;
  });
  y += 16;
  doc.roundedRect(M, y, cw, 74, 10).lineWidth(1).strokeColor(LINE).stroke();
  doc.fillColor(GREY).font('Helvetica').fontSize(10).text('ATTENDANCE', M + 20, y + 16);
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(22).text(`${student.attendancePct}%`, M + 20, y + 30);
  doc.fillColor(GREY).font('Helvetica').fontSize(10).text('FINAL GRADE (weighted)', M + cw / 2, y + 16, { width: cw / 2 - 20, align: 'right' });
  doc.fillColor(student.grade === 'F' ? RED : GREEN).font('Helvetica-Bold').fontSize(22)
    .text(`${student.finalPct == null ? '—' : student.finalPct + '%'}  ·  ${student.grade}`, M + cw / 2, y + 30, { width: cw / 2 - 20, align: 'right' });
  y += 90;
  doc.fillColor(GREY).font('Helvetica').fontSize(8).text(`Generated ${fmtDate(Date.now())} · ${gb.institution || 'TalentLedger'} · Online Assessment. Final grade is weight-adjusted (missing assessments = 0).`, M, y, { width: cw });
  doc.end();
}

export function gradebookCsv(gb) {
  const esc = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const head = ['#', 'Student', ...gb.assessments.map(a => `${a.title} (${a.weightPct}%)`), 'Attendance%', 'Final%', 'Grade'];
  const lines = [head.map(esc).join(',')];
  gb.students.forEach((s, i) => {
    const row = [i + 1, s.name, ...gb.assessments.map(a => { const p = s.perAssessment.find(x => x.assessmentId === a.id); return p && p.submitted ? `${p.score}/${p.total}` : (p && p.taken ? 'in-progress' : ''); }), s.attendancePct, s.finalPct == null ? '' : s.finalPct, s.grade];
    lines.push(row.map(esc).join(','));
  });
  return lines.join('\r\n');
}

export function attendanceCsv(gb) {
  const esc = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const head = ['#', 'Student', ...gb.assessments.map(a => a.title), 'Attendance%'];
  const lines = [head.map(esc).join(',')];
  gb.students.forEach((s, i) => {
    const row = [i + 1, s.name, ...gb.assessments.map(a => { const p = s.perAssessment.find(x => x.assessmentId === a.id); return p && p.taken ? 'P' : 'A'; }), s.attendancePct];
    lines.push(row.map(esc).join(','));
  });
  return lines.join('\r\n');
}
