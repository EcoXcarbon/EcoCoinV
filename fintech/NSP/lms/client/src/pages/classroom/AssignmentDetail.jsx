import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import DOMPurify from 'dompurify';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';

const fileKind = (name = '') => {
  const n = name.toLowerCase();
  if (/\.pdf$/.test(n)) return 'pdf';
  if (/\.(png|jpe?g|webp|gif|bmp|svg)$/.test(n)) return 'img';
  if (/\.(mp4|webm|mov|ogg)$/.test(n)) return 'video';
  if (/\.docx?$/.test(n)) return 'doc';
  return 'other';
};

/* In-app viewer — fetches the file as an authenticated blob and shows it inline
   (bypassing the download-only Content-Disposition on /api/uploads). */
function InlineViewer({ file, onClose }) {
  if (!file) return null;
  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-white dark:bg-navy-mid rounded-xl w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border dark:border-navy-light shrink-0">
          <span className="text-sm font-semibold dark:text-white truncate">📖 {file.name}</span>
          <button onClick={onClose} aria-label="Close viewer" className="text-gray-500 hover:text-red-500 text-xl leading-none">×</button>
        </div>
        <div className={`flex-1 overflow-auto bg-gray-100 dark:bg-navy ${file.kind === 'html' ? '' : 'grid place-items-center'}`}>
          {file.kind === 'pdf' && <iframe title={file.name} src={file.blobUrl} className="w-full h-full" />}
          {file.kind === 'img' && <img src={file.blobUrl} alt={file.name} className="max-w-full max-h-full object-contain" />}
          {file.kind === 'video' && <video src={file.blobUrl} controls className="max-w-full max-h-full" />}
          {file.kind === 'html' && (
            <div className="tl-rich bg-white dark:bg-navy-mid dark:text-gray-100 max-w-3xl mx-auto my-4 p-6 md:p-8 rounded-lg shadow"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(file.html, { USE_PROFILES: { html: true } }) }} />
          )}
          {file.kind === 'other' && (
            <div className="text-center p-8">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">This document type can't be previewed inline.</p>
              <a href={file.blobUrl} target="_blank" rel="noreferrer" className="tl-btn tl-btn-primary">Open in new tab</a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MaterialView({ assignment, classId, assignmentId }) {
  const { user } = useAuth();
  const [viewing, setViewing] = useState(null);
  const [loadingUrl, setLoadingUrl] = useState(null);
  const [quiz, setQuiz] = useState(null);
  const [answers, setAnswers] = useState({});
  const [genLoading, setGenLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  const openInApp = async (att, index) => {
    const kind = fileKind(att.name);
    try {
      setLoadingUrl(att.url);
      if (kind === 'doc') {
        // Word docs render as server-converted HTML (browsers can't show .docx).
        const { data } = await api.get(`/classroom/${classId}/classwork/${assignmentId}/material-html`, { params: { index } });
        setViewing({ name: att.name, kind: 'html', html: data.html });
        return;
      }
      // att.url is an origin path like /api/uploads/x; the api client already
      // prefixes /api, so strip it to avoid /api/api/…
      const rel = String(att.url).replace(/^\/api(?=\/)/, '');
      const res = await api.get(rel, { responseType: 'blob' });
      const blobUrl = URL.createObjectURL(res.data);
      setViewing({ name: att.name, blobUrl, kind });
    } catch { toast.error('Could not open this file'); }
    finally { setLoadingUrl(null); }
  };
  const closeViewer = () => {
    if (viewing?.blobUrl) URL.revokeObjectURL(viewing.blobUrl);
    setViewing(null);
  };

  const startQuiz = async () => {
    setGenLoading(true); setResult(null); setQuiz(null);
    try {
      const { data } = await api.post(`/classroom/${classId}/classwork/${assignmentId}/lesson-quiz`, {});
      setQuiz(data.questions); setAnswers({});
    } catch (e) { toast.error(e.response?.data?.error || 'Could not build the quiz'); }
    finally { setGenLoading(false); }
  };

  const submitQuiz = async () => {
    if (Object.keys(answers).length < quiz.length) return toast.error('Answer all questions first');
    setSubmitting(true);
    try {
      const arr = quiz.map((_, i) => (answers[i] ?? -1));
      const { data } = await api.post(`/classroom/${classId}/classwork/${assignmentId}/lesson-quiz/submit`, { answers: arr });
      setResult(data);
    } catch (e) { toast.error(e.response?.data?.error || 'Could not submit'); }
    finally { setSubmitting(false); }
  };

  const downloadResult = () => {
    if (!result) return;
    const when = new Date().toLocaleString();
    const rows = result.results.map((r, i) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #eee">${i + 1}. ${r.question}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;color:${r.isCorrect ? '#16a34a' : '#dc2626'};font-weight:700">${r.isCorrect ? '✓' : '✗'}</td>
      </tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Lesson Result</title></head>
      <body style="font-family:Inter,Arial,sans-serif;max-width:720px;margin:24px auto;color:#0f172a">
        <div style="border:1px solid #e2e8f0;border-radius:16px;overflow:hidden">
          <div style="background:linear-gradient(135deg,#002D72,#0072BC);color:#fff;padding:20px 24px">
            <div style="font-size:12px;letter-spacing:.1em;opacity:.8">TALENTLEDGER · LESSON COMPLETION</div>
            <div style="font-size:20px;font-weight:800;margin-top:4px">${assignment.title}</div>
          </div>
          <div style="padding:24px">
            <p style="margin:0 0 4px"><strong>Learner:</strong> ${user?.name || ''}</p>
            <p style="margin:0 0 4px"><strong>Completed:</strong> ${when}</p>
            <div style="text-align:center;margin:20px 0">
              <div style="font-size:52px;font-weight:800;color:${result.passed ? '#16a34a' : '#dc2626'}">${result.score}%</div>
              <div style="display:inline-block;padding:3px 14px;border-radius:20px;font-size:12px;font-weight:700;color:#fff;background:${result.passed ? '#16a34a' : '#dc2626'}">${result.passed ? 'PASSED' : 'NOT YET PASSED'}</div>
              <div style="font-size:12px;color:#64748b;margin-top:6px">${result.correct} / ${result.total} correct</div>
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:13px">${rows}</table>
          </div>
        </div>
        <p style="text-align:center;color:#94a3b8;font-size:11px;margin-top:12px">Generated by NSP Learning · AI-assessed lesson quiz</p>
      </body></html>`;
    const w = window.open('', '_blank');
    if (!w) return toast.error('Allow pop-ups to download your result');
    w.document.write(html); w.document.close(); w.focus();
    setTimeout(() => w.print(), 400);
  };

  return (
    <div className="space-y-4">
      <div className="bg-emerald-50/50 dark:bg-emerald-900/10 border border-emerald-200/60 dark:border-emerald-800/40 rounded-lg p-4">
        <div className="text-xs text-emerald-700 dark:text-emerald-300 uppercase tracking-wider font-semibold mb-1">Lesson Material</div>
        <p className="text-sm dark:text-gray-100 whitespace-pre-wrap">{assignment.instructions || 'No description.'}</p>
      </div>

      {assignment.attachments?.length > 0 && (
        <div className="border border-border dark:border-navy-light rounded-lg p-4">
          <div className="text-xs text-gray-500 dark:text-gray-400 uppercase font-semibold mb-2">Reading — open each to study</div>
          <ul className="space-y-2">
            {assignment.attachments.map((a, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span className="text-sm dark:text-gray-100 truncate flex items-center gap-2">📄 {a.name}</span>
                <button onClick={() => openInApp(a, i)} disabled={loadingUrl === a.url}
                  className="tl-btn tl-btn-primary text-xs px-3 py-1.5 shrink-0">
                  {loadingUrl === a.url ? 'Opening…' : 'Open'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* AI lesson quiz */}
      <div className="border border-ilo-blue/30 dark:border-ilo-blue/40 rounded-lg p-4 bg-ilo-blue/5">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold dark:text-white flex items-center gap-2">🤖 Lesson Quiz</h3>
          {result && (
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold text-white ${result.passed ? 'bg-green-600' : 'bg-red-500'}`}>
              {result.score}% · {result.passed ? 'Passed' : 'Try again'}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">After reading, take a short AI-generated quiz on this lesson. Your score is shown instantly and you can download it to keep.</p>

        {!quiz && !result && (
          <button onClick={startQuiz} disabled={genLoading} className="tl-btn tl-btn-primary text-sm">
            {genLoading ? 'Building your quiz…' : 'Take the quiz'}
          </button>
        )}

        {quiz && (
          <div className="space-y-4">
            {quiz.map((q, qi) => {
              const r = result?.results?.[qi];
              return (
                <div key={qi} className="bg-white dark:bg-navy-mid rounded-lg p-3 border border-border dark:border-navy-light">
                  <p className="text-sm font-medium dark:text-white mb-2">{qi + 1}. {q.question}</p>
                  <div className="space-y-1.5">
                    {q.options.map((opt, oi) => {
                      const chosen = answers[qi] === oi;
                      const isRight = r && oi === r.correctOption;
                      const isWrongPick = r && chosen && oi !== r.correctOption;
                      return (
                        <label key={oi}
                          className={`flex items-center gap-2 p-2 rounded-lg text-sm cursor-pointer border transition
                            ${isRight ? 'bg-green-50 dark:bg-green-900/20 border-green-400' :
                              isWrongPick ? 'bg-red-50 dark:bg-red-900/20 border-red-400' :
                              chosen ? 'bg-ilo-blue/10 border-ilo-blue' : 'bg-transparent border-border dark:border-navy-light hover:bg-gray-50 dark:hover:bg-navy-light'}`}>
                          <input type="radio" name={`lq-${qi}`} checked={chosen} disabled={!!result}
                            onChange={() => setAnswers(a => ({ ...a, [qi]: oi }))} className="accent-ilo-blue" />
                          <span className="dark:text-gray-200">{opt}</span>
                          {isRight && <span className="ml-auto text-green-600 text-xs font-bold">✓ correct</span>}
                        </label>
                      );
                    })}
                  </div>
                  {r && r.explanation && (
                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 italic">{r.explanation}</p>
                  )}
                </div>
              );
            })}

            {!result ? (
              <button onClick={submitQuiz} disabled={submitting} className="tl-btn tl-btn-primary text-sm">
                {submitting ? 'Scoring…' : 'Submit answers'}
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-sm font-semibold dark:text-white">Your score: <span className={result.passed ? 'text-green-600' : 'text-red-500'}>{result.score}%</span> ({result.correct}/{result.total})</div>
                <button onClick={downloadResult} className="tl-btn tl-btn-gold text-sm">⬇ Download my result</button>
                <button onClick={startQuiz} className="tl-btn tl-btn-ghost text-sm">Retake</button>
              </div>
            )}
          </div>
        )}
      </div>

      <InlineViewer file={viewing} onClose={closeViewer} />
    </div>
  );
}

function StudentView({ classId, assignmentId, data, onChange }) {
  const { assignment, mySubmission } = data;
  const [text, setText] = useState(mySubmission?.text || '');
  const [attachments, setAttachments] = useState(mySubmission?.attachments || []);
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const turnedIn = mySubmission && ['turned-in', 'resubmitted', 'returned'].includes(mySubmission.status);
  const readOnly = turnedIn && mySubmission?.status !== 'returned';

  const upload = async () => {
    if (files.length === 0) return [];
    setUploading(true);
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      const { data: r } = await api.post(`/classroom/${classId}/uploads`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setAttachments(prev => [...prev, ...r.files]);
      setFiles([]);
      toast.success(`Uploaded ${r.files.length} file(s)`);
      return r.files;
    } catch (err) { toast.error(err.response?.data?.error || 'Upload failed'); return []; }
    finally { setUploading(false); }
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      let attach = attachments;
      if (files.length > 0) {
        const newly = await upload();
        attach = [...attachments, ...newly];
      }
      await api.post(`/classroom/${classId}/classwork/${assignmentId}/submit`, { text, attachments: attach });
      toast.success('Turned in');
      onChange();
    } catch (err) { toast.error(err.response?.data?.error || 'Submit failed'); }
    finally { setSubmitting(false); }
  };

  const unsubmit = async () => {
    if (!confirm('Unsubmit this assignment?')) return;
    setSubmitting(true);
    try {
      await api.post(`/classroom/${classId}/classwork/${assignmentId}/unsubmit`);
      toast.success('Unsubmitted');
      onChange();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-4">
      <div className="bg-gray-50 dark:bg-navy-light rounded-lg p-4">
        <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider font-semibold mb-1">Instructions</div>
        <p className="text-sm dark:text-gray-100 whitespace-pre-wrap">{assignment.instructions || 'No instructions.'}</p>
        {assignment.attachments?.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border dark:border-navy-mid">
            <div className="text-xs text-gray-500 dark:text-gray-400 uppercase font-semibold mb-1">Attachments</div>
            <ul className="space-y-1">
              {assignment.attachments.map((a, i) => (
                <li key={i}><a href={a.url} target="_blank" rel="noreferrer"
                  className="text-sm text-ilo-blue hover:underline">📎 {a.name}</a></li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="border border-border dark:border-navy-light rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold dark:text-white">Your work</h3>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Status: <strong className="text-gray-800 dark:text-white">{mySubmission?.status || 'assigned'}</strong>
          </span>
        </div>

        {mySubmission?.status === 'returned' && (
          <div className="bg-ilo-blue/10 border border-ilo-blue/30 rounded-lg p-3 space-y-1">
            <div className="text-xs text-ilo-blue font-semibold">Grade</div>
            <div className="text-2xl font-bold dark:text-white">
              {mySubmission.grade ?? '—'} / {assignment.points}
            </div>
            {mySubmission.feedback && (
              <div className="text-sm dark:text-gray-200 pt-2 border-t border-ilo-blue/20">
                <div className="text-xs text-ilo-blue font-semibold mb-1">Feedback</div>
                {mySubmission.feedback}
              </div>
            )}
          </div>
        )}

        <textarea rows={6} value={text} onChange={e => setText(e.target.value)}
          disabled={readOnly}
          placeholder="Type your response here…"
          className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-navy-light dark:border-navy-light dark:text-white disabled:opacity-60 resize-none" />

        {attachments.length > 0 && (
          <ul className="space-y-1">
            {attachments.map((a, i) => (
              <li key={i} className="flex items-center justify-between bg-gray-50 dark:bg-navy-light px-3 py-1.5 rounded text-xs">
                <a href={a.url} target="_blank" rel="noreferrer" className="text-ilo-blue hover:underline truncate">📎 {a.name}</a>
                {!readOnly && (
                  <button onClick={() => setAttachments(attachments.filter((_, j) => j !== i))}
                    className="text-red-500 ml-2">×</button>
                )}
              </li>
            ))}
          </ul>
        )}

        {!readOnly && (
          <div>
            <input type="file" multiple onChange={e => setFiles(Array.from(e.target.files))}
              className="block text-xs" />
          </div>
        )}

        {mySubmission?.status === 'returned' && mySubmission?.credentialId && (
          <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3 text-xs">
            <span className="font-semibold text-emerald-700 dark:text-emerald-300">🏅 Credential issued:</span>
            <code className="ml-2 text-emerald-700 dark:text-emerald-300">{mySubmission.credentialId}</code>
          </div>
        )}

        <div className="flex justify-end gap-2">
          {turnedIn && mySubmission?.status !== 'returned' && (
            <button onClick={unsubmit} disabled={submitting}
              className="px-4 py-2 text-sm border border-ilo-blue text-ilo-blue rounded-lg disabled:opacity-50">
              Unsubmit
            </button>
          )}
          {(!turnedIn || mySubmission?.status === 'returned') && (
            <button onClick={submit} disabled={submitting || uploading || (!text.trim() && files.length === 0 && attachments.length === 0)}
              className="px-4 py-2 text-sm bg-ilo-blue text-white rounded-lg disabled:opacity-50">
              {submitting ? 'Submitting…' : uploading ? 'Uploading…' : mySubmission?.status === 'returned' ? 'Resubmit' : 'Turn in'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function TeacherView({ classId, assignmentId, onChange }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editGrade, setEditGrade] = useState('');
  const [editFeedback, setEditFeedback] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/classroom/${classId}/classwork/${assignmentId}/submissions`);
      setData(data);
    } catch (err) { toast.error('Failed to load submissions'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [assignmentId]);

  const startEdit = (row) => {
    if (!row.submission) return;
    setEditingId(row.submission._id);
    setEditGrade(row.submission.grade ?? '');
    setEditFeedback(row.submission.feedback ?? '');
  };

  const saveGrade = async (sub, doReturn) => {
    setSaving(true);
    try {
      await api.put(`/classroom/${classId}/classwork/${assignmentId}/submissions/${sub._id}/grade`, {
        grade: editGrade === '' ? undefined : Number(editGrade),
        feedback: editFeedback,
        return: doReturn,
      });
      toast.success(doReturn ? 'Returned' : 'Saved');
      setEditingId(null);
      load();
      onChange();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setSaving(false); }
  };

  if (loading || !data) {
    return <div className="flex justify-center py-8"><div className="animate-spin w-6 h-6 border-2 border-ilo-blue border-t-transparent rounded-full" /></div>;
  }

  const counts = data.rows.reduce((acc, r) => {
    const k = r.status === 'missing' ? 'assigned' : r.status;
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex gap-4 text-xs">
        <div><strong className="dark:text-white">{counts['turned-in'] || 0}</strong> turned in</div>
        <div><strong className="dark:text-white">{counts['returned'] || 0}</strong> graded</div>
        <div><strong className="dark:text-white">{counts['assigned'] || 0}</strong> assigned</div>
      </div>

      <table className="w-full text-sm">
        <thead className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          <tr className="border-b border-border dark:border-navy-light">
            <th className="text-left py-2">Student</th>
            <th className="text-left">Status</th>
            <th className="text-right">Grade</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map(r => (
            <tr key={r.student._id} className="border-b border-border/50 dark:border-navy-light/50">
              <td className="py-3 dark:text-white">{r.student.name}</td>
              <td className="text-xs text-gray-600 dark:text-gray-300">{r.submission?.status || 'missing'}{r.submission?.late ? ' (late)' : ''}</td>
              <td className="text-right dark:text-white">
                {r.submission?.grade != null ? `${r.submission.grade} / ${data.assignment.points}` : '—'}
              </td>
              <td className="text-right">
                {r.submission && (
                  <button onClick={() => startEdit(r)} className="text-xs text-ilo-blue hover:underline">
                    {r.submission.status === 'returned' ? 'Update' : 'Grade'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editingId && (() => {
        const row = data.rows.find(r => r.submission?._id === editingId);
        if (!row) return null;
        return (
          <div className="bg-white dark:bg-navy-mid border border-ilo-blue/30 rounded-lg p-4 space-y-3">
            <h4 className="font-semibold dark:text-white">{row.student.name}</h4>
            {row.submission.text && (
              <div className="bg-gray-50 dark:bg-navy-light rounded p-3 text-sm dark:text-gray-100 whitespace-pre-wrap">
                {row.submission.text}
              </div>
            )}
            <div className="flex items-center gap-3">
              <label className="text-xs">
                Grade
                <input type="number" min={0} max={data.assignment.points * 2} value={editGrade}
                  onChange={e => setEditGrade(e.target.value)}
                  className="ml-2 w-24 px-2 py-1 border rounded text-sm dark:bg-navy-light dark:border-navy-light dark:text-white" />
                <span className="ml-1 text-gray-500 dark:text-gray-400">/ {data.assignment.points}</span>
              </label>
            </div>
            <textarea rows={3} placeholder="Feedback (optional)" value={editFeedback}
              onChange={e => setEditFeedback(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-navy-light dark:border-navy-light dark:text-white resize-none" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditingId(null)} className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400">Cancel</button>
              <button onClick={() => saveGrade(row.submission, false)} disabled={saving}
                className="px-3 py-1.5 text-sm border border-ilo-blue text-ilo-blue rounded-lg disabled:opacity-50">Save draft</button>
              <button onClick={() => saveGrade(row.submission, true)} disabled={saving}
                className="px-3 py-1.5 text-sm bg-ilo-blue text-white rounded-lg disabled:opacity-50">Return</button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export default function AssignmentDetail({ classId, assignmentId, isTeacher, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/classroom/${classId}/classwork/${assignmentId}`);
      setData(data);
    } catch (err) { toast.error('Failed to load'); onClose(); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [assignmentId]);

  const remove = async () => {
    if (!confirm('Delete this assignment? All submissions will be removed.')) return;
    try {
      await api.delete(`/classroom/${classId}/classwork/${assignmentId}`);
      toast.success('Deleted');
      onClose();
    } catch (err) { toast.error('Failed'); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white dark:bg-navy-mid rounded-xl w-full max-w-3xl my-8 max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white dark:bg-navy-mid border-b border-border dark:border-navy-light p-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold dark:text-white">{data?.assignment?.title || 'Loading…'}</h2>
            {data?.assignment && (
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {data.assignment.points} pts
                {data.assignment.dueDate && ` • Due ${new Date(data.assignment.dueDate).toLocaleString()}`}
              </div>
            )}
          </div>
          <div className="flex gap-3">
            {isTeacher && data && (
              <button onClick={remove} className="text-xs text-red-600 hover:underline">Delete</button>
            )}
            <button onClick={onClose} className="text-2xl text-gray-400 hover:text-gray-700 leading-none">×</button>
          </div>
        </div>

        <div className="p-4">
          {loading || !data ? (
            <div className="flex justify-center py-12"><div className="animate-spin w-6 h-6 border-2 border-ilo-blue border-t-transparent rounded-full" /></div>
          ) : data.assignment?.type === 'material' ? (
            <MaterialView assignment={data.assignment} classId={classId} assignmentId={assignmentId} />
          ) : isTeacher ? (
            <TeacherView classId={classId} assignmentId={assignmentId} onChange={load} />
          ) : (
            <StudentView classId={classId} assignmentId={assignmentId} data={data} onChange={load} />
          )}
        </div>
      </div>
    </div>
  );
}
