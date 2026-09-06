import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/client';

const TYPE_LABEL = { pre: 'Pre-test', mid: 'Mid-term', final: 'Final', quiz: 'Quiz', assignment: 'Assignment' };

/* Student course landing — lists the course's assessments with status/schedule
   and course materials. Clicking an open assessment starts the timed exam. */
export default function CoursePage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    document.title = 'My Course';
    if (!localStorage.getItem('tl-token')) { window.location.href = `/join/${id}?next=/course/${id}`; return; }
    (async () => {
      try { const { data } = await api.get(`/exam/${id}/assessments`); setData(data); }
      catch (e) { if (e.response?.status === 401) { window.location.href = `/join/${id}?next=/course/${id}`; return; } setErr(e.response?.data?.error || 'Could not load the course.'); }
    })();
  }, [id]);

  const downloadResult = async (mid, title) => {
    try { const r = await api.get(`/exam/${id}/a/${mid}/result.pdf`, { responseType: 'blob' }); const u = URL.createObjectURL(r.data); const a = document.createElement('a'); a.href = u; a.download = `result-${title}.pdf`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(u); } catch { /* */ }
  };

  if (err) return <div className="min-h-screen grid place-items-center bg-gradient-to-br from-[#002D72] to-[#0a1628] p-4"><p className="text-red-300 font-semibold">{err}</p></div>;
  if (!data) return <div className="min-h-screen grid place-items-center bg-gray-50 dark:bg-navy"><p className="text-gray-400">Loading…</p></div>;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-navy p-4">
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="rounded-2xl bg-gradient-to-r from-[#002D72] to-[#0a4bb3] text-white px-6 py-5">
          <p className="text-[11px] tracking-[0.2em] text-[#f0c667] font-bold">{data.institution || 'ONLINE CLASS'}</p>
          <h1 className="text-xl font-bold">{data.className}</h1>
          {data.subject && <p className="text-xs text-blue-100 mt-0.5">{data.subject}</p>}
        </div>

        <div className="rounded-2xl bg-white dark:bg-navy-mid border border-border dark:border-navy-light p-5">
          <h2 className="text-sm font-bold text-gray-800 dark:text-white mb-3">Assessments</h2>
          {data.assessments.length === 0 ? <p className="text-sm text-gray-400 py-4 text-center">No assessments have been set yet. Please check back.</p> : (
            <div className="space-y-3">
              {data.assessments.map(a => {
                const st = a.schedule?.state;
                const done = a.status === 'submitted';
                const canStart = !done && st === 'open';
                return (
                  <div key={a.assessmentId} className="rounded-xl border border-border dark:border-navy-light p-4 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-gray-800 dark:text-white">{a.title}
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 ml-2">{TYPE_LABEL[a.examType] || a.examType}</span>
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{a.totalQuestions} questions · {a.totalMarks} marks · {a.durationMin} min{a.weightPct ? ` · ${a.weightPct}% of grade` : ''}</p>
                      {st === 'upcoming' && <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">Opens {new Date(a.schedule.opensAt).toLocaleString()}</p>}
                      {st === 'closed' && !done && <p className="text-[11px] text-red-500 mt-1">Closed {a.schedule.closesAt ? new Date(a.schedule.closesAt).toLocaleString() : ''}</p>}
                    </div>
                    <div className="shrink-0 text-right">
                      {done ? (
                        <div>
                          <p className="text-sm font-bold text-green-600">{a.score} / {a.total}</p>
                          <button onClick={() => downloadResult(a.assessmentId, a.title)} className="text-[11px] text-ilo-blue hover:underline">Result PDF</button>
                        </div>
                      ) : canStart ? (
                        <button onClick={() => nav(`/exam/${id}/a/${a.assessmentId}`)} className="px-5 py-2 text-sm font-bold bg-green-600 text-white rounded-xl hover:bg-green-700">Start</button>
                      ) : (
                        <span className="text-xs font-semibold text-gray-400">{st === 'upcoming' ? 'Not open' : st === 'closed' ? 'Closed' : '—'}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {data.materials && data.materials.length > 0 && (
          <div className="rounded-2xl bg-white dark:bg-navy-mid border border-border dark:border-navy-light p-5">
            <h2 className="text-sm font-bold text-gray-800 dark:text-white mb-3">Course materials</h2>
            <div className="space-y-1.5">
              {data.materials.map((m, i) => <a key={i} href={m.url} target="_blank" rel="noreferrer" className="block text-sm text-ilo-blue hover:underline">📄 {m.name}</a>)}
            </div>
          </div>
        )}
        <p className="text-[11px] text-gray-400 text-center">{data.institution || 'NSP Learning'}</p>
      </div>
    </div>
  );
}
