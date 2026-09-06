import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/client';

/* Timed final exam — start button, 30-min countdown (server-clocked, no pause),
   auto-submit at 0, single attempt, score-only result + PDF download. */
const LETTERS = ['A', 'B', 'C', 'D'];
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export default function ExamRunner() {
  const { id, mid } = useParams();
  const apiBase = mid ? `/exam/${id}/a/${mid}` : `/exam/${id}`;
  const [phase, setPhase] = useState('loading'); // loading | intro | running | done | error
  const [meta, setMeta] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});     // {displayIdx: sel}
  const [remaining, setRemaining] = useState(0);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState(0);      // one-question-at-a-time index (main pass)
  const [pwd, setPwd] = useState('');             // exam access password (if required)
  const [sections, setSections] = useState([]);   // [{tag, overview, count, startIndex}] display order
  const [seenSections, setSeenSections] = useState([]);   // section tags whose intro was acknowledged
  const [skipped, setSkipped] = useState([]);     // display indices skipped (max maxSkips)
  const [mode, setMode] = useState('main');       // 'main' pass, then 'review' of skipped questions
  const [reviewPos, setReviewPos] = useState(0);
  const [maxSkips, setMaxSkips] = useState(10);
  const submittedRef = useRef(false);
  const answersRef = useRef({});
  answersRef.current = answers;
  const pwdRef = useRef('');
  pwdRef.current = pwd;

  // ── integrity monitoring state ────────────────────────────────
  const flagsRef = useRef({ copy: 0, tabSwitch: 0, fullscreenExit: 0 });
  const flagEventsRef = useRef([]);
  const warnTimer = useRef(null);
  const [warn, setWarn] = useState('');
  const [fsOut, setFsOut] = useState(false);

  const bumpFlag = useCallback((type, msg) => {
    if (submittedRef.current) return;
    if (flagsRef.current[type] != null) flagsRef.current[type] += 1;
    if (flagEventsRef.current.length < 200) flagEventsRef.current.push({ type, at: new Date().toISOString() });
    setWarn(msg);
    if (warnTimer.current) clearTimeout(warnTimer.current);
    warnTimer.current = setTimeout(() => setWarn(''), 4000);
  }, []);
  const enterFullscreen = useCallback(() => {
    const el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
  }, []);
  const blockCopy = (e) => { e.preventDefault(); bumpFlag('copy', '⚠ Copying is disabled and has been recorded.'); };

  useEffect(() => { document.title = 'Online Class Assessment'; }, []);

  // ── initial load ──────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!localStorage.getItem('tl-token')) { window.location.href = `/join/${id}?next=/course/${id}`; return; }
      try {
        const { data } = await api.get(apiBase);
        if (!alive) return;
        setMeta(data);
        if (data.status === 'submitted') { setResult({ score: data.score, total: data.total }); setPhase('done'); }
        else if (data.status === 'in-progress' && !data.requiresPassword) { await beginOrResume(); }
        else setPhase('intro');
      } catch (e) {
        if (e.response?.status === 401) { window.location.href = `/join/${id}?next=/course/${id}`; return; }
        setErr(e.response?.data?.error || 'Could not load the exam.'); setPhase('error');
      }
    })();
    return () => { alive = false; };
  }, [id, mid]);

  const beginOrResume = useCallback(async () => {
    setBusy(true); setErr('');
    try {
      const { data } = await api.post(`${apiBase}/start`, { password: pwdRef.current });
      setQuestions(data.questions || []);
      setSections(data.sections || []);
      setMaxSkips(data.maxSkips ?? 10);
      setSeenSections([]); setSkipped([]); setMode('main'); setReviewPos(0);
      setAnswers(Object.fromEntries((data.savedAnswers || []).map(a => [a.i, a.sel])));
      setRemaining(data.remainingSec ?? data.durationSec ?? 1800);
      setCurrent(0);
      setPhase('running');
      setTimeout(enterFullscreen, 60);
    } catch (e) {
      if (e.response?.status === 409) { setResult({ score: e.response.data.score, total: e.response.data.total }); setPhase('done'); }
      else if (e.response?.status === 403 && e.response?.data?.requiresPassword) {
        setErr(e.response.data.error || 'This exam is password protected.'); setPhase('intro');
      } else setErr(e.response?.data?.error || 'Could not start the exam.');
    } finally { setBusy(false); }
  }, [id, mid, enterFullscreen]);

  // ── submit — retries on network failure and NEVER shows a false zero ──
  const submit = useCallback(async (auto) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setBusy(true);
    const payload = Object.entries(answersRef.current).map(([i, sel]) => ({ i: Number(i), sel }));
    const finish = (score, total) => {
      setResult({ score, total });
      try { if (document.fullscreenElement) document.exitFullscreen(); } catch { /* ignore */ }
      setPhase('done'); setBusy(false);
    };
    for (let attemptNo = 1; attemptNo <= 3; attemptNo++) {
      try {
        const { data } = await api.post(`${apiBase}/submit`, { answers: payload, flags: flagsRef.current, flagEvents: flagEventsRef.current });
        return finish(data.score, data.total);
      } catch (e) {
        // A definitive server verdict (already submitted / time expired with recorded score) is a real result.
        if (e.response?.data?.score != null) return finish(e.response.data.score, e.response.data.total);
        // Network / gateway failure: wait and retry.
        await new Promise((r) => setTimeout(r, 1500 * attemptNo));
      }
    }
    // Still unreachable — answers are autosaved server-side; let the student try again rather than faking a result.
    submittedRef.current = false;
    setBusy(false);
    setWarn('Connection problem — your answers are SAVED on the server. Wait a few seconds and press Submit again.');
  }, [id, mid]);

  // ── live autosave: every answer reaches the server within seconds ──
  useEffect(() => {
    if (phase !== 'running') return;
    const t = setTimeout(() => {
      const payload = Object.entries(answersRef.current).map(([i, sel]) => ({ i: Number(i), sel }));
      if (payload.length) api.post(`${apiBase}/progress`, { answers: payload }).catch(() => {});
    }, 2000);
    return () => clearTimeout(t);
  }, [answers, phase]);

  // ── countdown (server-clocked; auto-submit at 0) ──────────────
  useEffect(() => {
    if (phase !== 'running') return;
    const t = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) { clearInterval(t); submit(true); return 0; }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [phase, submit]);

  // ── warn on leave while running ───────────────────────────────
  useEffect(() => {
    if (phase !== 'running') return;
    const h = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [phase]);

  // ── integrity monitoring (deterrence + logging) ───────────────
  useEffect(() => {
    if (phase !== 'running') return;
    const onVis = () => { if (document.hidden) bumpFlag('tabSwitch', '⚠ You left the exam window. This has been recorded.'); };
    const onFs = () => {
      const out = !document.fullscreenElement;
      setFsOut(out);
      if (out) bumpFlag('fullscreenExit', '⚠ You exited full-screen. This has been recorded.');
    };
    document.addEventListener('visibilitychange', onVis);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      document.removeEventListener('fullscreenchange', onFs);
    };
  }, [phase, bumpFlag]);

  const downloadPdf = async () => {
    try {
      const res = await api.get(`${apiBase}/result.pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a'); a.href = url; a.download = `result-${(meta?.className || 'exam').replace(/\W+/g, '_')}.pdf`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch { setErr('Could not download the PDF.'); }
  };

  const answered = Object.keys(answers).length;
  const low = remaining <= 300;

  // ── screens ───────────────────────────────────────────────────
  if (phase === 'loading') return <Center><p className="text-gray-500">Loading exam…</p></Center>;
  if (phase === 'error') return <Center><div className="text-center"><p className="text-red-500 font-semibold">{err}</p></div></Center>;

  if (phase === 'intro') return (
    <Center>
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-navy-mid shadow-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-[#002D72] to-[#0a4bb3] px-6 py-5 text-white">
          <p className="text-[11px] tracking-[0.2em] text-[#f0c667] font-bold">{meta?.institution || 'ONLINE CLASS ASSESSMENT'}</p>
          <h1 className="text-lg font-bold mt-0.5">{meta?.className}</h1>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">Please read carefully before you begin:</p>
          <ul className="text-sm text-gray-700 dark:text-gray-200 space-y-2 list-disc list-inside">
            <li><b>{meta?.totalQuestions}</b> multiple-choice questions · <b>{meta?.totalMarks ?? meta?.totalQuestions} marks</b> total{meta?.totalMarks && meta?.totalQuestions ? ` (${Math.round((meta.totalMarks / meta.totalQuestions) * 100) / 100} per correct answer)` : ''}.</li>
            <li>Time limit: <b>{Math.round((meta?.durationSec || 1800) / 60)} minutes</b>. The timer <b>cannot be paused</b>.</li>
            <li>The test <b>auto-submits</b> when time runs out. You get <b>one attempt only</b>.</li>
            <li>The paper runs <b>section by section</b>: each section opens with a brief case overview, then its questions one at a time. Sections and the questions inside them appear in <b>random order</b>.</li>
            <li>You may <b>skip up to 10 questions</b>; skipped questions reappear at the end of the paper. Do not refresh unnecessarily — your timer keeps running.</li>
            <li><b>Copying is disabled.</b> The exam runs in full-screen; leaving the tab or full-screen is <b>recorded and reported</b> to your instructor.</li>
          </ul>
          {meta?.requiresPassword && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
                Exam password (provided by your instructor)
              </label>
              <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="off"
                onKeyDown={(e) => { if (e.key === 'Enter' && pwd.trim() && !busy) beginOrResume(); }}
                placeholder="Enter exam password"
                className="w-full px-4 py-2.5 text-sm rounded-xl border border-border dark:border-navy-light bg-white dark:bg-navy text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-ilo-blue" />
            </div>
          )}
          {err && <p className="text-sm text-red-500">{err}</p>}
          <button onClick={beginOrResume} disabled={busy || (meta?.requiresPassword && !pwd.trim())}
            className="w-full px-6 py-3 text-sm font-bold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark transition-colors disabled:opacity-50">
            {busy ? 'Starting…' : 'Start Exam →'}
          </button>
        </div>
      </div>
    </Center>
  );

  if (phase === 'done') {
    const pct = result?.total ? Math.round((result.score / result.total) * 100) : 0;
    return (
      <Center>
        <div className="w-full max-w-md rounded-2xl bg-white dark:bg-navy-mid shadow-2xl overflow-hidden text-center">
          <div className="bg-gradient-to-r from-[#002D72] to-[#0a4bb3] px-6 py-5 text-white">
            <p className="text-[11px] tracking-[0.2em] text-[#f0c667] font-bold">ASSESSMENT COMPLETE</p>
            <h1 className="text-base font-bold mt-0.5">{meta?.className}</h1>
          </div>
          <div className="p-8">
            <p className="text-xs uppercase tracking-widest text-gray-400">Your Score</p>
            <p className="text-5xl font-black text-[#002D72] dark:text-blue-300 mt-2">{result?.score} / {result?.total}</p>
            <p className={`text-xl font-bold mt-1 ${pct >= 50 ? 'text-green-600' : 'text-red-500'}`}>{pct}%</p>
            <button onClick={downloadPdf}
              className="mt-6 w-full px-6 py-3 text-sm font-bold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark transition-colors">
              Download Result (PDF)
            </button>
            {err && <p className="text-sm text-red-500 mt-2">{err}</p>}
            <p className="text-[11px] text-gray-400 mt-4">This was a single, time-limited attempt. Your result has been recorded.</p>
          </div>
        </div>
      </Center>
    );
  }

  // running
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-navy select-none"
      onCopy={blockCopy} onCut={blockCopy} onPaste={blockCopy} onContextMenu={blockCopy}
      style={{ userSelect: 'none', WebkitUserSelect: 'none', MozUserSelect: 'none' }}>
      {warn && (
        <div className="fixed top-0 inset-x-0 z-50 bg-red-600 text-white text-sm font-semibold text-center py-2 px-4 shadow-lg">
          {warn}
        </div>
      )}
      {fsOut && (
        <div className="fixed bottom-4 inset-x-0 z-40 flex justify-center px-4">
          <button onClick={enterFullscreen}
            className="px-4 py-2.5 text-sm font-bold bg-[#002D72] text-white rounded-xl shadow-lg hover:bg-[#0a4bb3]">
            ⛶ Return to full-screen
          </button>
        </div>
      )}
      <div className="sticky top-0 z-20 bg-white/95 dark:bg-navy-mid/95 backdrop-blur border-b border-border dark:border-navy-light">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-[#f0c667]">{meta?.institution || 'ONLINE ASSESSMENT'}</p>
            <h1 className="text-sm font-bold text-gray-800 dark:text-white truncate">{meta?.className}</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-gray-500 dark:text-gray-400">{answered}/{questions.length} answered</span>
            <span className={`font-mono text-lg font-bold px-3 py-1 rounded-lg ${low ? 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300 animate-pulse' : 'bg-blue-100 text-[#002D72] dark:bg-blue-900/40 dark:text-blue-200'}`}>
              {mmss(remaining)}
            </span>
          </div>
        </div>
      </div>

      {(() => {
        const inReview = mode === 'review';
        const displayIdx = inReview ? skipped[reviewPos] : current;
        const q = questions[displayIdx];
        if (!q) return null;
        const sec = sections.find(s => s.tag === q.section);
        const secNo = Math.max(0, sections.findIndex(s => s.tag === q.section)) + 1;
        const isLastMain = !inReview && current === questions.length - 1;
        const isLastReview = inReview && reviewPos === skipped.length - 1;
        const atSubmitPoint = (isLastMain && skipped.length === 0) || isLastReview;
        const skipsLeft = maxSkips - skipped.length;
        const canSkip = !inReview && skipsLeft > 0 && !skipped.includes(current);

        const goNext = () => {
          if (!inReview) {
            if (!isLastMain) setCurrent(c => c + 1);
            else if (skipped.length) { setMode('review'); setReviewPos(0); }
          } else if (!isLastReview) setReviewPos(p => p + 1);
        };
        const goPrev = () => {
          if (!inReview) setCurrent(c => Math.max(0, c - 1));
          else setReviewPos(p => Math.max(0, p - 1));
        };
        const skipQ = () => {
          if (!canSkip) return;
          setSkipped(s => [...s, current]);
          if (!isLastMain) setCurrent(c => c + 1);
          else { setMode('review'); setReviewPos(0); }
        };
        const confirmSubmit = () => {
          const unanswered = questions.length - Object.keys(answersRef.current).length;
          const msg = unanswered > 0
            ? `Submit your exam now? ${unanswered} question(s) are unanswered and will score zero.`
            : 'Submit your exam now? You cannot change answers after submitting.';
          if (window.confirm(msg)) submit(false);
        };

        // ── Section intro (case overview) before the first question of each section ──
        if (!inReview && !seenSections.includes(q.section)) {
          return (
            <div className="max-w-2xl mx-auto px-4 py-10">
              <div className="rounded-2xl bg-white dark:bg-navy-mid border border-border dark:border-navy-light shadow-sm overflow-hidden">
                <div className="bg-gradient-to-r from-[#002D72] to-[#0a4bb3] px-6 py-4 text-white">
                  <p className="text-[10px] tracking-[0.2em] text-[#f0c667] font-bold uppercase">Section {secNo} of {sections.length}</p>
                  <h2 className="text-lg font-bold mt-0.5">{q.section}</h2>
                </div>
                <div className="p-6 space-y-4">
                  {sec?.overview && (
                    <div className="rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/40 p-4">
                      <p className="text-[11px] font-bold text-ilo-blue uppercase tracking-wide mb-1">Case overview</p>
                      <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed">{sec.overview}</p>
                    </div>
                  )}
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    This section has <b>{sec?.count ?? '—'} questions</b>, shown one at a time in random order. You can skip a
                    question ({skipsLeft} skip{skipsLeft === 1 ? '' : 's'} remaining of {maxSkips}); skipped questions return at the end of the paper.
                  </p>
                  <p className="text-xs text-amber-600 dark:text-amber-400 font-semibold">The exam timer is running.</p>
                  <button onClick={() => setSeenSections(s => [...s, q.section])}
                    className="w-full px-6 py-3 text-sm font-bold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark">
                    Start Section →
                  </button>
                </div>
              </div>
            </div>
          );
        }

        return (
          <div className="max-w-2xl mx-auto px-4 py-8">
            {inReview && (
              <div className="mb-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-2.5">
                <p className="text-xs font-bold text-amber-700 dark:text-amber-300">
                  Reviewing skipped questions — {reviewPos + 1} of {skipped.length}. Answer them now; you cannot skip again.
                </p>
              </div>
            )}
            {/* progress */}
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                {inReview ? `Skipped question ${reviewPos + 1} of ${skipped.length}` : `Question ${current + 1} of ${questions.length}`}
              </p>
              <p className="text-xs text-gray-400">{answered} answered{!inReview && skipped.length ? ` · ${skipped.length} skipped` : ''}</p>
            </div>
            <p className="text-[11px] font-bold text-ilo-blue mb-2 truncate">
              Section {secNo}: {q.section}
            </p>
            <div className="h-1.5 w-full bg-gray-200 dark:bg-navy-light rounded-full overflow-hidden mb-5">
              <div className="h-full bg-ilo-blue transition-all"
                style={{ width: `${(inReview ? ((questions.length - skipped.length + reviewPos + 1) / questions.length) : ((current + 1) / questions.length)) * 100}%` }} />
            </div>

            <div className="rounded-2xl bg-white dark:bg-navy-mid border border-border dark:border-navy-light p-5 shadow-sm">
              <p className="text-base font-semibold text-gray-800 dark:text-gray-100">
                <span className="text-ilo-blue">Q{displayIdx + 1}.</span> {q.question}
              </p>
              <div className="mt-4 space-y-2.5">
                {q.options.map((opt, oi) => (
                  <label key={oi}
                    className={`flex items-start gap-3 p-3 rounded-xl cursor-pointer border transition
                      ${answers[displayIdx] === oi ? 'bg-blue-50 border-blue-300 dark:bg-blue-900/30 dark:border-blue-500' : 'bg-white border-gray-200 hover:bg-gray-50 dark:bg-navy dark:border-navy-light dark:hover:bg-navy-light'}`}>
                    <input type="radio" name={`q${displayIdx}`} checked={answers[displayIdx] === oi}
                      onChange={() => setAnswers((a) => ({ ...a, [displayIdx]: oi }))} className="mt-1" />
                    <span className="text-sm text-gray-700 dark:text-gray-200"><b className="mr-1.5">{LETTERS[oi]}.</b>{opt}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* navigation */}
            <div className="mt-5 flex items-center justify-between gap-3">
              <button onClick={goPrev} disabled={inReview ? reviewPos === 0 : current === 0}
                className="px-5 py-2.5 text-sm font-semibold rounded-xl border border-border dark:border-navy-light text-gray-600 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-navy-light">
                ← Previous
              </button>
              <div className="flex items-center gap-2">
                {!inReview && (
                  <button onClick={skipQ} disabled={!canSkip}
                    title={canSkip ? `Skip this question — it will return at the end (${skipsLeft} left)` : (skipped.includes(current) ? 'Already skipped' : 'No skips remaining')}
                    className="px-4 py-2.5 text-sm font-semibold rounded-xl border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 disabled:opacity-40 hover:bg-amber-50 dark:hover:bg-amber-900/20">
                    Skip ({skipsLeft})
                  </button>
                )}
                {atSubmitPoint ? (
                  <button onClick={confirmSubmit} disabled={busy}
                    className="px-7 py-2.5 text-sm font-bold bg-green-600 text-white rounded-xl hover:bg-green-700 disabled:opacity-50">
                    {busy ? 'Submitting…' : 'Submit Exam'}
                  </button>
                ) : (
                  <button onClick={goNext}
                    className="px-7 py-2.5 text-sm font-bold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark">
                    {isLastMain && skipped.length ? 'Skipped questions →' : 'Next →'}
                  </button>
                )}
              </div>
            </div>

            {!atSubmitPoint && (
              <div className="mt-4 text-center">
                <button onClick={confirmSubmit}
                  className="text-xs text-gray-400 underline hover:text-gray-600 dark:hover:text-gray-200">
                  Finish &amp; submit early
                </button>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

function Center({ children }) {
  return <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#002D72] to-[#0a1628] p-4">{children}</div>;
}
