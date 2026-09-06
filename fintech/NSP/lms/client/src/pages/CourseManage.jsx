import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/client';

const TYPES = [['pre', 'Pre-test'], ['mid', 'Mid-term'], ['final', 'Final'], ['quiz', 'Quiz'], ['assignment', 'Assignment']];
const TYPE_LABEL = Object.fromEntries(TYPES);
const inp = 'mt-1 w-full px-3 py-2 text-sm rounded-xl border border-border dark:border-navy-light bg-white dark:bg-navy dark:text-white';

function Copy({ url }) {
  const [d, setD] = useState(false);
  return <button onClick={async () => { try { await navigator.clipboard.writeText(url); setD(true); setTimeout(() => setD(false), 1200); } catch { /* */ } }}
    className="px-2 py-1 text-[11px] font-semibold bg-ilo-blue text-white rounded hover:bg-ilo-dark shrink-0">{d ? '✓ Copied' : 'Copy link'}</button>;
}

export default function CourseManage() {
  const { id } = useParams();
  const [c, setC] = useState(null);
  const [gb, setGb] = useState(null);
  const [err, setErr] = useState('');
  const [needAuth, setNeedAuth] = useState(false);
  // add-assessment form
  const [f, setF] = useState({ title: '', examType: 'quiz', weightPct: 20, durationMin: 30, marksPerQuestion: 1, opensAt: '', closesAt: '', examPassword: '' });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [aErr, setAErr] = useState('');
  const [matBusy, setMatBusy] = useState(false);

  const signIn = () => { localStorage.removeItem('tl-token'); window.location.href = `/login?next=/course/${id}/manage`; };
  const load = async () => {
    if (!localStorage.getItem('tl-token')) { window.location.href = `/login?next=/course/${id}/manage`; return; }
    setErr(''); setNeedAuth(false);
    try {
      const { data } = await api.get(`/courses/${id}`); setC(data);
      const g = await api.get(`/courses/${id}/gradebook`); setGb(g.data);
    } catch (e) {
      if (e.response?.status === 403) { setErr('Staff-only page — sign in as an administrator or instructor.'); setNeedAuth(true); }
      else if (e.response?.status === 401) { signIn(); return; }
      else setErr(e.response?.data?.error || 'Could not load course.');
    }
  };
  useEffect(() => { document.title = 'Manage course · NSP Learning'; load(); }, [id]);

  const addAssessment = async (e) => {
    e.preventDefault(); setAErr('');
    if (!file) return setAErr('Choose an MCQ file (.docx, .txt or .csv).');
    setBusy(true);
    try {
      const fd = new FormData();
      Object.entries(f).forEach(([k, v]) => { if (v !== '') fd.append(k, v); });
      fd.append('file', file);
      await api.post(`/courses/${id}/assessment`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setFile(null); const fi = document.getElementById('mcqfile'); if (fi) fi.value = '';
      setF(s => ({ ...s, title: '' }));
      load();
    } catch (e2) { setAErr(e2.response?.data?.error || 'Could not add assessment.'); }
    finally { setBusy(false); }
  };
  const delAssessment = async (mid, title) => { if (!window.confirm(`Delete assessment "${title}" and its results?`)) return; try { await api.delete(`/courses/${id}/assessment/${mid}`); load(); } catch { setErr('Delete failed.'); } };
  const uploadMaterial = async (e) => {
    const mf = e.target.files[0]; if (!mf) return; setMatBusy(true);
    try { const fd = new FormData(); fd.append('file', mf); await api.post(`/courses/${id}/material`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }); e.target.value = ''; load(); }
    catch { setErr('Material upload failed.'); } finally { setMatBusy(false); }
  };
  const delMaterial = async (idx) => { try { await api.delete(`/courses/${id}/material/${idx}`); load(); } catch { setErr('Delete failed.'); } };
  const download = async (path, filename) => { try { const r = await api.get(path, { responseType: 'blob' }); const u = URL.createObjectURL(r.data); const a = document.createElement('a'); a.href = u; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(u); } catch { setErr('Download failed.'); } };

  if (err) return (
    <div className="min-h-screen bg-gray-50 dark:bg-navy p-4"><div className="max-w-2xl mx-auto rounded-2xl bg-white dark:bg-navy-mid border border-border dark:border-navy-light p-8 text-center mt-10">
      <p className="text-sm text-red-500">{err}</p>
      {needAuth && <button onClick={signIn} className="mt-4 px-5 py-2.5 text-sm font-bold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark">Sign in as administrator</button>}
    </div></div>
  );
  if (!c) return <div className="min-h-screen bg-gray-50 dark:bg-navy grid place-items-center"><p className="text-gray-400">Loading…</p></div>;

  const base = window.location.origin;
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-navy p-4">
      <div className="max-w-4xl mx-auto space-y-5">
        <div className="rounded-2xl bg-gradient-to-r from-[#002D72] to-[#0a4bb3] text-white px-6 py-5 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] tracking-[0.2em] text-[#f0c667] font-bold">MANAGE COURSE</p>
            <h1 className="text-xl font-bold truncate">{c.title}</h1>
            <p className="text-xs text-blue-100 mt-0.5">{c.institution ? c.institution + ' · ' : ''}{c.subject} · {c.assessments.length} assessments (Σ weight {c.totalWeight}%) · {c.enrolled}/{c.maxEnrollment} students</p>
          </div>
          <a href="/exam-admin" className="px-3 py-2 text-xs font-semibold bg-white/15 rounded-lg hover:bg-white/25 shrink-0">← All courses</a>
        </div>

        {/* student link */}
        <div className="rounded-2xl bg-white dark:bg-navy-mid border border-border dark:border-navy-light p-4 flex items-center gap-3 flex-wrap">
          <span className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">Student link</span>
          <input readOnly value={c.links.join} onFocus={e => e.target.select()} className="flex-1 min-w-[220px] px-2 py-1 text-xs rounded border border-border dark:border-navy-light bg-gray-50 dark:bg-navy font-mono text-gray-700 dark:text-gray-200" />
          <Copy url={c.links.join} />
          <span className="text-[11px] text-gray-400">Share this — students sign in with Gmail and see all assessments.</span>
        </div>

        {/* add assessment */}
        <form onSubmit={addAssessment} className="rounded-2xl bg-white dark:bg-navy-mid border border-border dark:border-navy-light p-5 space-y-3">
          <h2 className="text-sm font-bold text-gray-800 dark:text-white">Add an assessment (upload MCQ file)</h2>
          <div className="grid sm:grid-cols-3 gap-3">
            <div><label className="text-[11px] font-semibold text-gray-500 uppercase">Type</label>
              <select value={f.examType} onChange={e => setF({ ...f, examType: e.target.value })} className={inp}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <div><label className="text-[11px] font-semibold text-gray-500 uppercase">Title (optional)</label>
              <input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder={TYPE_LABEL[f.examType]} className={inp} /></div>
            <div><label className="text-[11px] font-semibold text-gray-500 uppercase">Weight %</label>
              <input type="number" min="0" max="100" value={f.weightPct} onChange={e => setF({ ...f, weightPct: e.target.value })} className={inp} /></div>
            <div><label className="text-[11px] font-semibold text-gray-500 uppercase">Duration (min)</label>
              <input type="number" min="1" max="240" value={f.durationMin} onChange={e => setF({ ...f, durationMin: e.target.value })} className={inp} /></div>
            <div><label className="text-[11px] font-semibold text-gray-500 uppercase">Marks / question</label>
              <input type="number" min="0.5" step="0.5" value={f.marksPerQuestion} onChange={e => setF({ ...f, marksPerQuestion: e.target.value })} className={inp} /></div>
            <div><label className="text-[11px] font-semibold text-gray-500 uppercase">Opens (optional)</label>
              <input type="datetime-local" value={f.opensAt} onChange={e => setF({ ...f, opensAt: e.target.value })} className={inp} /></div>
            <div><label className="text-[11px] font-semibold text-gray-500 uppercase">Closes (optional)</label>
              <input type="datetime-local" value={f.closesAt} onChange={e => setF({ ...f, closesAt: e.target.value })} className={inp} /></div>
            <div><label className="text-[11px] font-semibold text-gray-500 uppercase">Exam password (optional)</label>
              <input value={f.examPassword} onChange={e => setF({ ...f, examPassword: e.target.value })} placeholder="Leave blank for open exam" autoComplete="off" className={inp} /></div>
            <div className="sm:col-span-2"><label className="text-[11px] font-semibold text-gray-500 uppercase">MCQ file (.docx / .txt / .csv, with Answer Key)</label>
              <input id="mcqfile" type="file" accept=".docx,.doc,.txt,.md,.csv" onChange={e => setFile(e.target.files[0] || null)}
                className="mt-1 w-full text-sm text-gray-600 dark:text-gray-300 file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-ilo-blue file:text-white file:font-semibold" /></div>
          </div>
          {aErr && <p className="text-sm text-red-500">{aErr}</p>}
          <button type="submit" disabled={busy} className="px-6 py-2.5 text-sm font-bold bg-green-600 text-white rounded-xl hover:bg-green-700 disabled:opacity-50">{busy ? 'Adding…' : 'Add assessment'}</button>
        </form>

        {/* assessments list */}
        <div className="rounded-2xl bg-white dark:bg-navy-mid border border-border dark:border-navy-light p-5">
          <h2 className="text-sm font-bold text-gray-800 dark:text-white mb-3">Assessments</h2>
          {c.assessments.length === 0 ? <p className="text-sm text-gray-400 py-4 text-center">None yet — add one above.</p> : (
            <div className="space-y-2.5">
              {c.assessments.map(a => (
                <div key={a.assessmentId} className="rounded-xl border border-border dark:border-navy-light p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-gray-800 dark:text-white">{a.title} <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 ml-1">{TYPE_LABEL[a.examType] || a.examType}</span></p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{a.questionCount} Q · {a.totalMarks} marks · {a.durationMin} min · weight {a.weightPct}% · {a.submitted} submitted{a.opensAt ? ` · opens ${new Date(a.opensAt).toLocaleString()}` : ''}{a.closesAt ? ` · closes ${new Date(a.closesAt).toLocaleString()}` : ''}{a.hasPassword ? ` · password: ${a.examPassword}` : ' · open (no password)'}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Copy url={a.examLink} />
                      <button onClick={() => download(`/exam/${id}/a/${a.assessmentId}/class-sheet.pdf`, `${a.title}.pdf`)} className="px-2 py-1 text-[11px] font-semibold border border-border dark:border-navy-light rounded text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-navy-light">Results PDF</button>
                      <button onClick={() => delAssessment(a.assessmentId, a.title)} className="px-2 py-1 text-[11px] font-semibold text-red-500 border border-red-300 dark:border-red-800 rounded hover:bg-red-50 dark:hover:bg-red-900/20">Delete</button>
                    </div>
                  </div>
                </div>
              ))}
              {c.totalWeight !== 100 && c.assessments.length > 0 && <p className="text-[11px] text-amber-600 dark:text-amber-400">Note: assessment weights sum to {c.totalWeight}% (not 100%). Final grade is normalised by the total weight.</p>}
            </div>
          )}
        </div>

        {/* materials */}
        <div className="rounded-2xl bg-white dark:bg-navy-mid border border-border dark:border-navy-light p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-800 dark:text-white">Course materials</h2>
            <label className="text-xs font-bold bg-ilo-blue text-white px-3 py-1.5 rounded-lg cursor-pointer hover:bg-ilo-dark">{matBusy ? 'Uploading…' : '+ Upload'}
              <input type="file" onChange={uploadMaterial} className="hidden" /></label>
          </div>
          {(!c.materials || c.materials.length === 0) ? <p className="text-sm text-gray-400 py-2 text-center">No materials uploaded.</p> : (
            <div className="space-y-1.5">
              {c.materials.map(m => (
                <div key={m.idx} className="flex items-center justify-between gap-3 text-sm">
                  <a href={m.url} target="_blank" rel="noreferrer" className="text-ilo-blue hover:underline truncate">{m.name}</a>
                  <button onClick={() => delMaterial(m.idx)} className="text-[11px] text-red-500 shrink-0">Remove</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* gradebook */}
        <div className="rounded-2xl bg-white dark:bg-navy-mid border border-border dark:border-navy-light p-5">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="text-sm font-bold text-gray-800 dark:text-white">Gradebook &amp; attendance</h2>
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => download(`/courses/${id}/gradebook.pdf`, `gradebook-${c.title}.pdf`)} className="px-3 py-1.5 text-xs font-bold bg-[#f0c667] text-[#002D72] rounded-lg hover:brightness-95">Gradebook PDF</button>
              <button onClick={() => download(`/courses/${id}/gradebook.csv`, `gradebook-${c.title}.csv`)} className="px-3 py-1.5 text-xs font-semibold border border-border dark:border-navy-light rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-navy-light">Gradebook CSV</button>
              <button onClick={() => download(`/courses/${id}/attendance.csv`, `attendance-${c.title}.csv`)} className="px-3 py-1.5 text-xs font-semibold border border-border dark:border-navy-light rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-navy-light">Attendance CSV</button>
              <button onClick={load} className="text-xs font-semibold text-ilo-blue hover:underline">Refresh</button>
            </div>
          </div>
          {!gb ? <p className="text-sm text-gray-400 py-4 text-center">Loading…</p>
            : gb.students.length === 0 ? <p className="text-sm text-gray-400 py-4 text-center">No students enrolled yet.</p>
              : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-left uppercase tracking-wide text-gray-400 border-b border-border dark:border-navy-light">
                      <th className="py-2 pr-2">Student</th>
                      {gb.assessments.map(a => <th key={a.id} className="py-2 px-2 text-right whitespace-nowrap">{TYPE_LABEL[a.examType] || a.title}<span className="text-gray-300"> {a.weightPct}%</span></th>)}
                      <th className="py-2 px-2 text-right">Att%</th><th className="py-2 px-2 text-right">Final</th><th className="py-2 px-2 text-right">Grade</th><th className="py-2 pl-2 text-right">Sheet</th>
                    </tr></thead>
                    <tbody>
                      {gb.students.map(s => (
                        <tr key={s.workerId} className="border-b border-gray-100 dark:border-navy-light/50">
                          <td className="py-2 pr-2 font-medium text-gray-800 dark:text-gray-100 whitespace-nowrap">{s.name}</td>
                          {gb.assessments.map(a => { const p = s.perAssessment.find(x => x.assessmentId === a.id); return <td key={a.id} className={`py-2 px-2 text-right font-mono ${p && p.submitted && p.pct < 50 ? 'text-red-500' : 'text-gray-700 dark:text-gray-200'}`}>{p && p.submitted ? `${p.score}/${p.total}` : (p && p.taken ? '·' : '—')}</td>; })}
                          <td className="py-2 px-2 text-right">{s.attendancePct}%</td>
                          <td className="py-2 px-2 text-right font-semibold">{s.finalPct == null ? '—' : `${s.finalPct}%`}</td>
                          <td className={`py-2 px-2 text-right font-bold ${s.grade === 'F' ? 'text-red-500' : 'text-[#002D72] dark:text-blue-300'}`}>{s.grade}</td>
                          <td className="py-2 pl-2 text-right"><button onClick={() => download(`/courses/${id}/transcript/${s.workerId}`, `transcript-${s.name}.pdf`)} className="text-[11px] text-ilo-blue hover:underline">PDF</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
        </div>
        <p className="text-[11px] text-gray-400 text-center">NSP Learning · Instructor tools</p>
      </div>
    </div>
  );
}
