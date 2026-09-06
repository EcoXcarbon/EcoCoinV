import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/client';

/* Staff-only class results view for a timed exam course.
   Table of every student's score + a Download class results (PDF) button. */
export default function ExamResults() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [dl, setDl] = useState(false);
  const [needAuth, setNeedAuth] = useState(false);

  const signInAsStaff = () => { localStorage.removeItem('tl-token'); window.location.href = `/login?next=/exam/${id}/results`; };

  useEffect(() => { document.title = 'Class Results · IMSciences'; }, []);

  const load = async () => {
    if (!localStorage.getItem('tl-token')) { window.location.href = `/login?next=/exam/${id}/results`; return; }
    setLoading(true); setErr(''); setNeedAuth(false);
    try {
      const { data } = await api.get(`/exam/${id}/results`);
      setData(data);
    } catch (e) {
      if (e.response?.status === 403) { setErr('This is a staff-only page — you are signed in as a student/non-staff account.'); setNeedAuth(true); }
      else if (e.response?.status === 401) { signInAsStaff(); return; }
      else setErr(e.response?.data?.error || 'Could not load results.');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [id]);

  const downloadFile = async (path, filename) => {
    setDl(true);
    try {
      const res = await api.get(path, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch { setErr('Could not download the file.'); } finally { setDl(false); }
  };
  const slug = () => (data?.className || 'exam').replace(/\W+/g, '_');
  const downloadPdf = () => downloadFile(`/exam/${id}/class-sheet.pdf`, `class-results-${slug()}.pdf`);
  const downloadXlsx = () => downloadFile(`/exam/${id}/results.xlsx`, `final-results-${slug()}.xlsx`);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-navy p-4">
      <div className="max-w-3xl mx-auto">
        <div className="rounded-2xl bg-white dark:bg-navy-mid shadow overflow-hidden">
          <div className="bg-gradient-to-r from-[#002D72] to-[#0a4bb3] px-6 py-5 text-white flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] tracking-[0.2em] text-[#f0c667] font-bold">CLASS RESULTS</p>
              <h1 className="text-lg font-bold truncate">{data?.className || 'Exam'}</h1>
              {data && <p className="text-xs text-blue-100 mt-0.5">{data.submitted} submitted · {data.count} attempt(s)</p>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={load} title="Refresh"
                className="px-3 py-2 text-xs font-semibold bg-white/15 rounded-lg hover:bg-white/25">Refresh</button>
              <button onClick={downloadPdf} disabled={dl || !data?.count}
                className="px-4 py-2 text-sm font-bold bg-[#f0c667] text-[#002D72] rounded-lg hover:brightness-95 disabled:opacity-50">
                {dl ? 'Preparing…' : 'Download PDF'}
              </button>
              <button onClick={downloadXlsx} disabled={dl || !data?.count}
                className="px-4 py-2 text-sm font-bold bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
                Excel
              </button>
            </div>
          </div>

          <div className="p-4">
            {loading && <p className="text-sm text-gray-500 py-8 text-center">Loading…</p>}
            {err && !loading && (
              <div className="py-8 text-center">
                <p className="text-sm text-red-500">{err}</p>
                {needAuth && (
                  <button onClick={signInAsStaff}
                    className="mt-4 px-5 py-2.5 text-sm font-bold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark transition-colors">
                    Sign in as administrator
                  </button>
                )}
              </div>
            )}
            {!loading && !err && data && (
              data.count === 0
                ? <p className="text-sm text-gray-500 py-8 text-center">No students have taken this exam yet.</p>
                : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-border dark:border-navy-light">
                          <th className="py-2 pr-2 w-8">#</th>
                          <th className="py-2 pr-2">Student</th>
                          <th className="py-2 px-2 text-right" title="Questions attempted">Attempted</th>
                          <th className="py-2 px-2 text-right">Marks</th>
                          <th className="py-2 px-2 text-right">%</th>
                          <th className="py-2 px-2 text-right" title="Recorded integrity events: copy attempts, tab-switches, fullscreen exits">Flags</th>
                          <th className="py-2 pl-2 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.rows.map((r, i) => (
                          <tr key={i} className="border-b border-gray-100 dark:border-navy-light/50">
                            <td className="py-2 pr-2 text-gray-400">{i + 1}</td>
                            <td className="py-2 pr-2 font-medium text-gray-800 dark:text-gray-100">{r.name}</td>
                            <td className="py-2 px-2 text-right font-mono text-gray-600 dark:text-gray-300">
                              {r.status === 'submitted' ? `${Math.min(r.answered ?? 0, r.totalQuestions ?? r.answered ?? 0)}/${r.totalQuestions ?? '—'}` : '—'}
                            </td>
                            <td className="py-2 px-2 text-right font-mono text-gray-800 dark:text-gray-100">
                              {r.status === 'submitted' ? `${r.score} / ${r.total}` : '—'}
                            </td>
                            <td className={`py-2 px-2 text-right font-semibold ${r.status === 'submitted' ? (r.pct >= 50 ? 'text-green-600' : 'text-red-500') : 'text-gray-400'}`}>
                              {r.status === 'submitted' ? `${r.pct}%` : '—'}
                            </td>
                            <td className="py-2 px-2 text-right" title={r.flags ? `copy ${r.flags.copy||0} · tab-switch ${r.flags.tabSwitch||0} · fullscreen-exit ${r.flags.fullscreenExit||0}` : ''}>
                              {r.status === 'submitted'
                                ? <span className={`font-mono font-semibold ${(r.violations||0) > 0 ? 'text-red-500' : 'text-gray-400'}`}>{r.violations || 0}</span>
                                : <span className="text-gray-400">—</span>}
                            </td>
                            <td className="py-2 pl-2 text-right">
                              <span className={`text-[11px] px-2 py-0.5 rounded-full ${r.status === 'submitted' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'}`}>
                                {r.status === 'submitted' ? 'Submitted' : 'In progress'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
            )}
          </div>
        </div>
        <p className="text-[11px] text-gray-400 text-center mt-3">IMSciences · Online Class Assessment · Instructor view</p>
      </div>
    </div>
  );
}
