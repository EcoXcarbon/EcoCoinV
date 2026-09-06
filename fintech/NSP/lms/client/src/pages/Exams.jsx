import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';

/* LMS > Exams — every active exam course, with its assessments and schedule.
   Students click through to the course page and sit the exam from there. */
const TYPE_LABEL = { pre: 'Pre-test', mid: 'Mid-term', final: 'Final', quiz: 'Quiz', assignment: 'Assignment' };

export default function Exams() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    document.title = 'Exams · NSP Learning';
    (async () => {
      try { const { data: d } = await api.get('/exam'); setData(d); }
      catch (e) { setErr(e.response?.data?.error || 'Could not load exams.'); }
    })();
  }, []);

  if (err) return <p className="text-sm text-red-500 p-6">{err}</p>;
  if (!data) return <p className="text-sm text-gray-400 p-6">Loading exams…</p>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Exams</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Timed online assessments. Open a course to see its scheduled exams; password-protected exams require the
          password shared by your instructor.
        </p>
      </div>

      {data.staff && (
        <div className="rounded-2xl border border-border dark:border-navy-light bg-blue-50 dark:bg-blue-900/20 p-4 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-gray-700 dark:text-gray-200 font-medium">Instructor tools — create courses, upload MCQ papers, set passwords and view results.</p>
          <a href="/exam-admin" className="px-4 py-2 text-xs font-bold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark shrink-0">Open Course Manager</a>
        </div>
      )}

      {data.courses.length === 0 ? (
        <div className="rounded-2xl border border-border dark:border-navy-light bg-white dark:bg-navy-mid p-10 text-center">
          <p className="text-sm text-gray-400">No exam courses are open right now.</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {data.courses.map(c => (
            <div key={c.courseId} className="rounded-2xl bg-white dark:bg-navy-mid border border-border dark:border-navy-light overflow-hidden flex flex-col">
              <div className="bg-gradient-to-r from-[#002D72] to-[#0a4bb3] px-5 py-4 text-white">
                <p className="text-[10px] tracking-[0.2em] text-[#f0c667] font-bold uppercase">{c.institution || 'Online Assessment'}</p>
                <h2 className="text-base font-bold mt-0.5">{c.title}</h2>
              </div>
              <div className="p-5 flex-1 flex flex-col gap-3">
                {c.assessments.length === 0 ? (
                  <p className="text-sm text-gray-400">No assessments scheduled yet.</p>
                ) : c.assessments.map(a => (
                  <div key={a.assessmentId} className="flex items-center justify-between gap-3 rounded-xl border border-border dark:border-navy-light px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
                        {a.title}
                        <span className="ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">{TYPE_LABEL[a.examType] || 'Quiz'}</span>
                      </p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">
                        {a.totalQuestions} questions · {a.durationMin} min
                        {a.requiresPassword ? ' · password required' : ''}
                        {a.schedule.state === 'upcoming' ? ` · opens ${new Date(a.schedule.opensAt).toLocaleString()}` : ''}
                        {a.schedule.state === 'closed' ? ' · closed' : ''}
                      </p>
                    </div>
                    {a.schedule.state === 'open' ? (
                      <Link to={`/exam/${c.courseId}/a/${a.assessmentId}`}
                        className="px-3 py-1.5 text-xs font-bold bg-ilo-blue text-white rounded-lg hover:bg-ilo-dark shrink-0">
                        Take Exam
                      </Link>
                    ) : (
                      <span className="px-3 py-1.5 text-xs font-semibold text-gray-400 border border-border dark:border-navy-light rounded-lg shrink-0">
                        {a.schedule.state === 'upcoming' ? 'Not open' : 'Closed'}
                      </span>
                    )}
                  </div>
                ))}
                <div className="mt-auto pt-2 flex items-center justify-between">
                  <p className="text-[11px] text-gray-400">{c.enrolledCount}/{c.maxEnrollment} enrolled{c.enrolled ? ' · you are enrolled' : ''}</p>
                  <Link to={`/course/${c.courseId}`} className="text-xs font-semibold text-ilo-blue hover:underline">Course page →</Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
