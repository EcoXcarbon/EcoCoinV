import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';

/* Course Manager (staff) — list & create courses. Each course opens a manage
   page where you add weighted assessments, materials, and view the gradebook. */
export default function ExamAdmin() {
  const nav = useNavigate();
  const [list, setList] = useState(null);
  const [err, setErr] = useState('');
  const [needAuth, setNeedAuth] = useState(false);
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [institution, setInst] = useState('');
  const [maxEnrollment, setMax] = useState(30);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');

  const signIn = () => { localStorage.removeItem('tl-token'); window.location.href = '/login?next=/exam-admin'; };
  const load = async () => {
    if (!localStorage.getItem('tl-token')) { window.location.href = '/login?next=/exam-admin'; return; }
    setErr(''); setNeedAuth(false);
    try { const { data } = await api.get('/courses'); setList(data.courses || []); }
    catch (e) {
      if (e.response?.status === 403) { setErr('This is a staff-only page — sign in as an administrator or instructor.'); setNeedAuth(true); }
      else if (e.response?.status === 401) { signIn(); return; }
      else setErr(e.response?.data?.error || 'Could not load courses.');
    }
  };
  useEffect(() => { document.title = 'Course Manager · NSP Learning'; load(); }, []);

  const create = async (e) => {
    e.preventDefault(); setFormErr('');
    if (!title.trim()) return setFormErr('Enter a course / class name.');
    setBusy(true);
    try {
      const { data } = await api.post('/courses', { title: title.trim(), subject: subject.trim(), institution: institution.trim(), maxEnrollment });
      setTitle(''); setSubject(''); setInst('');
      nav(`/course/${data.courseId}/manage`);
    } catch (e2) { setFormErr(e2.response?.data?.error || 'Could not create the course.'); }
    finally { setBusy(false); }
  };
  const del = async (id, name) => {
    if (!window.confirm(`Delete course "${name}", all its assessments and results? This cannot be undone.`)) return;
    try { await api.delete(`/courses/${id}`); load(); } catch { setErr('Could not delete.'); }
  };
  const input = 'mt-1 w-full px-3 py-2 text-sm rounded-xl border border-border dark:border-navy-light bg-white dark:bg-navy dark:text-white';

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-navy p-4">
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="rounded-2xl bg-gradient-to-r from-[#002D72] to-[#0a4bb3] text-white px-6 py-5">
          <p className="text-[11px] tracking-[0.2em] text-[#f0c667] font-bold">TALENTLEDGER LMS · COURSE MANAGER</p>
          <h1 className="text-xl font-bold mt-0.5">Courses &amp; online assessments</h1>
          <p className="text-xs text-blue-100 mt-1">Create a course, then add weighted assessments (pre-test, mid-term, final, quizzes) by uploading MCQ files, plus materials, attendance and a downloadable gradebook.</p>
        </div>

        {err && (
          <div className="rounded-xl bg-white dark:bg-navy-mid border border-border dark:border-navy-light p-6 text-center">
            <p className="text-sm text-red-500">{err}</p>
            {needAuth && <button onClick={signIn} className="mt-4 px-5 py-2.5 text-sm font-bold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark">Sign in as administrator</button>}
          </div>
        )}

        {!err && (
          <>
            <form onSubmit={create} className="rounded-2xl bg-white dark:bg-navy-mid border border-border dark:border-navy-light p-5 space-y-4">
              <h2 className="text-sm font-bold text-gray-800 dark:text-white">New course</h2>
              <div className="grid sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Course / Class name</label>
                  <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Advanced Corporate Finance" className={input} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Max students</label>
                  <input type="number" min="1" max="1000" value={maxEnrollment} onChange={e => setMax(e.target.value)} className={input} />
                </div>
                <div className="sm:col-span-3">
                  <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Institution / Organisation (optional)</label>
                  <input value={institution} onChange={e => setInst(e.target.value)} placeholder="e.g. Institute of Management Sciences (IMSciences)" className={input} />
                </div>
                <div className="sm:col-span-3">
                  <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Subject (optional)</label>
                  <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g. BS Accounting & Finance, 8th Semester" className={input} />
                </div>
              </div>
              {formErr && <p className="text-sm text-red-500">{formErr}</p>}
              <button type="submit" disabled={busy} className="px-6 py-2.5 text-sm font-bold bg-green-600 text-white rounded-xl hover:bg-green-700 disabled:opacity-50">
                {busy ? 'Creating…' : 'Create course →'}
              </button>
            </form>

            <div className="rounded-2xl bg-white dark:bg-navy-mid border border-border dark:border-navy-light p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-gray-800 dark:text-white">Your courses</h2>
                <button onClick={load} className="text-xs font-semibold text-ilo-blue hover:underline">Refresh</button>
              </div>
              {list == null ? <p className="text-sm text-gray-400 py-6 text-center">Loading…</p>
                : list.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No courses yet — create one above.</p>
                  : (
                    <div className="space-y-2.5">
                      {list.map(c => (
                        <div key={c.courseId} className="rounded-xl border border-border dark:border-navy-light p-4 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-bold text-gray-800 dark:text-white truncate">{c.title}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">{c.institution ? c.institution + ' · ' : ''}{c.subject} · {c.assessments} assessment{c.assessments === 1 ? '' : 's'} · {c.enrolled}/{c.maxEnrollment} students · {c.submitted} submissions · {c.materials} material{c.materials === 1 ? '' : 's'}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <a href={`/course/${c.courseId}/manage`} className="px-3 py-1.5 text-xs font-bold bg-ilo-blue text-white rounded-lg hover:bg-ilo-dark">Manage</a>
                            <button onClick={() => del(c.courseId, c.title)} className="px-2.5 py-1.5 text-xs font-semibold text-red-500 border border-red-300 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20">Delete</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
            </div>
          </>
        )}
        <p className="text-[11px] text-gray-400 text-center">NSP Learning · Instructor tools</p>
      </div>
    </div>
  );
}
