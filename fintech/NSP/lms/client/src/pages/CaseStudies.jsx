import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

const WORD_LIMIT = 100;
const bandColor = (b) => ({
  Distinction: 'bg-gold text-white',
  Merit: 'bg-ilo-blue text-white',
  Pass: 'bg-emerald-600 text-white',
  Developing: 'bg-amber-500 text-white',
}[b] || 'bg-slate-500 text-white');

const wc = (s) => (s || '').trim().split(/\s+/).filter(Boolean).length;
const medal = (r) => (r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : `#${r}`);

const Card = ({ children, className = '' }) => (
  <div className={`bg-white dark:bg-navy-mid rounded-2xl border border-border dark:border-navy-light ${className}`}>{children}</div>
);

/* ─────────────────────────── Registration ─────────────────────────── */
function RegistrationForm({ onDone }) {
  const { user } = useAuth();
  const [form, setForm] = useState({ fullName: user?.name || '', studentId: '', program: '' });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    if (form.fullName.trim().length < 2) { toast.error('Please enter your full name.'); return; }
    setSaving(true);
    try { await api.post('/cases/register', form); toast.success('Registered — welcome!'); onDone(); }
    catch (err) { toast.error(err.response?.data?.error || 'Registration failed'); }
    finally { setSaving(false); }
  };
  return (
    <div className="max-w-lg mx-auto">
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-ilo-dark to-ilo-blue p-7 text-white">
          <div className="text-3xl">🎓</div>
          <h1 className="mt-3 text-2xl font-black leading-tight">Register for Case Studies</h1>
          <p className="mt-1 text-sm opacity-90">
            A one-time registration. Your name appears on the leaderboard, so enter it as you want it shown.
          </p>
        </div>
        <form onSubmit={submit} className="p-7 space-y-5">
          <Field label="Full name" required>
            <input value={form.fullName} onChange={set('fullName')} autoFocus
              className="w-full rounded-xl border border-border dark:border-navy-light bg-surface dark:bg-navy px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ilo-blue" placeholder="e.g. Ayesha Khan" />
          </Field>
          <Field label="Student / Registration ID" hint="optional">
            <input value={form.studentId} onChange={set('studentId')} className="w-full rounded-xl border border-border dark:border-navy-light bg-surface dark:bg-navy px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ilo-blue" placeholder="e.g. BSAF-2026-014" />
          </Field>
          <Field label="Programme / Batch" hint="optional">
            <input value={form.program} onChange={set('program')} className="w-full rounded-xl border border-border dark:border-navy-light bg-surface dark:bg-navy px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ilo-blue" placeholder="e.g. BS Accounting & Finance, 8th Semester" />
          </Field>
          <button type="submit" disabled={saving}
            className="w-full px-6 py-3 text-sm font-black bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark transition-colors disabled:opacity-50">
            {saving ? 'Registering…' : 'Register & continue →'}
          </button>
        </form>
      </Card>
    </div>
  );
}
const Field = ({ label, hint, required, children }) => (
  <label className="block">
    <span className="text-xs font-bold text-ilo-dark dark:text-white">{label}{required && <span className="text-red-500"> *</span>}{hint && <span className="ml-1 font-normal text-slate-400">({hint})</span>}</span>
    <div className="mt-1.5">{children}</div>
  </label>
);

/* ─────────────────────────── Overview ─────────────────────────── */
function Overview({ go }) {
  const [data, setData] = useState(null);
  const load = useCallback(() => { api.get('/cases').then((r) => setData(r.data)).catch(() => toast.error('Failed to load')); }, []);
  useEffect(load, [load]);
  if (!data) return <Loading />;
  if (!data.registered) return <RegistrationForm onDone={load} />;
  return (
    <div className="space-y-6">
      <header>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl sm:text-3xl font-black text-ilo-dark dark:text-white">Case Studies</h1>
          {data.participant && (
            <span className="text-xs font-semibold text-slate-500 bg-surface dark:bg-navy-light rounded-full px-3 py-1">
              Registered as <span className="text-ilo-dark dark:text-white">{data.participant.fullName}</span>
              {data.participant.studentId ? ` · ${data.participant.studentId}` : ''}
            </span>
          )}
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
          Read a case, answer five short questions, and submit. Claude grades every answer on merit and ranks you against your peers.
          Each case can be attempted <strong>once</strong> — once it is done, it is done.
        </p>
      </header>
      <div className="grid sm:grid-cols-2 gap-5">
        {data.courses.map((c) => {
          const done = c.completedCases ?? c.attempted;
          const pct = c.totalCases ? Math.round((done / c.totalCases) * 100) : 0;
          return (
            <Card key={c.course} className="p-6 flex flex-col">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-bold tracking-wide text-ilo-blue">{c.course} · {c.level || 'Graduate-Level Course'}</div>
                  <h2 className="text-xl font-black text-ilo-dark dark:text-white leading-tight mt-0.5">{c.title}</h2>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-black text-gold">{c.cumulativeScore}</div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">cumulative pts</div>
                </div>
              </div>
              <div className="mt-4">
                <div className="flex justify-between text-xs text-slate-500 mb-1">
                  <span>{done} / {c.totalCases} cases completed</span>
                  <span>{c.averageScore != null ? `avg ${c.averageScore}%` : '—'}</span>
                </div>
                <div className="h-2 rounded-full bg-surface-2 dark:bg-navy-light overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${c.completed ? 'bg-emerald-500' : 'bg-ilo-blue'}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
              {c.completed && (
                <div className="mt-3 flex items-center gap-2 text-xs font-bold text-emerald-600">
                  🎓 Course completed — certificate awarded{c.certificate?.band ? ` (${c.certificate.band})` : ''}
                </div>
              )}
              <div className="mt-4 flex gap-2 flex-wrap">
                <button onClick={() => go({ course: c.course })}
                  className="flex-1 px-4 py-2.5 text-sm font-bold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark transition-colors">
                  Open {c.remaining > 0 ? `(${c.remaining} left)` : 'cases'}
                </button>
                <button onClick={() => go({ course: c.course, view: 'leaderboard' })}
                  className="px-4 py-2.5 text-sm font-bold border border-border dark:border-navy-light rounded-xl hover:bg-surface dark:hover:bg-navy-light transition-colors">
                  🏆 Ladder
                </button>
                {c.completed && (
                  <button onClick={() => go({ course: c.course, view: 'certificate' })}
                    className="px-4 py-2.5 text-sm font-black bg-gold text-white rounded-xl hover:opacity-90 transition-opacity">
                    🎓 Certificate
                  </button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────── Course case list ─────────────────────────── */
function CourseList({ course, go }) {
  const [data, setData] = useState(null);
  useEffect(() => { api.get(`/cases/${course}`).then((r) => setData(r.data)).catch(() => toast.error('Failed to load')); }, [course]);
  if (!data) return <Loading />;
  return (
    <div className="space-y-5">
      <TopBar onBack={() => go({})}>
        <div>
          <div className="text-[11px] font-bold text-ilo-blue">{course}</div>
          <h1 className="text-xl sm:text-2xl font-black text-ilo-dark dark:text-white">{data.title}</h1>
        </div>
        <button onClick={() => go({ course, view: 'leaderboard' })}
          className="ml-auto px-4 py-2 text-sm font-bold border border-border dark:border-navy-light rounded-xl hover:bg-surface dark:hover:bg-navy-light">
          🏆 Leaderboard
        </button>
      </TopBar>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {data.cases.map((c) => (
          <button key={c.id} onClick={() => go({ course, code: c.code })}
            className="text-left bg-white dark:bg-navy-mid rounded-2xl border border-border dark:border-navy-light p-5 hover:shadow-lg hover:-translate-y-0.5 transition-all">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-400">Week {c.week} · {c.code}</span>
              {!c.locked
                ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-surface-2 dark:bg-navy-light text-slate-500">NEW</span>
                : c.status === 'grading'
                  ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500 text-white">Grading…</span>
                  : c.status === 'failed'
                    ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500 text-white">Reopen</span>
                    : <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${bandColor(c.band)}`}>{c.rawScore}% · {c.band}</span>}
            </div>
            <h3 className="font-bold text-ilo-dark dark:text-white mt-2 leading-snug">{c.title}</h3>
            <div className="mt-3 text-xs font-semibold flex items-center gap-1">
              {!c.locked
                ? <span className="text-ilo-blue">Begin case →</span>
                : c.status === 'grading'
                  ? <span className="text-amber-600">⏳ Grading in progress</span>
                  : c.status === 'failed'
                    ? <span className="text-red-500">⚠ Open to retry grading</span>
                    : <span className="text-emerald-600">✓ Completed · locked</span>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────── Case reader + answer form ─────────────────────────── */
function CaseView({ course, code, go }) {
  const { user } = useAuth();
  const draftKey = `tl-case-draft:${user?._id || user?.id || 'me'}:${course}:${code}`;
  const [data, setData] = useState(null);
  const [answers, setAnswers] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data: d } = await api.get(`/cases/${course}/${code}`);
      setData(d);
      if (!d.locked) {
        // Restore a locally-saved draft — survives sign-out, refresh, or a crash.
        let restored = null;
        try {
          const raw = localStorage.getItem(draftKey);
          const arr = raw ? JSON.parse(raw) : null;
          if (Array.isArray(arr) && arr.length === d.case.questions.length) restored = arr;
        } catch { /* ignore malformed draft */ }
        setAnswers(restored || new Array(d.case.questions.length).fill(''));
        if (restored && restored.some((a) => a && a.trim())) {
          setSavedAt(Date.now());
          toast.success('Restored your saved answers', { id: 'draft-restore' });
        }
      }
    } catch { toast.error('Failed to load case'); }
  }, [course, code, draftKey]);
  useEffect(() => { load(); }, [load]);

  // Persist each keystroke locally so answers can't be lost.
  const updateAnswer = (i, val) => {
    setAnswers((a) => {
      const next = a.map((v, j) => (j === i ? val : v));
      try { localStorage.setItem(draftKey, JSON.stringify(next)); setSavedAt(Date.now()); } catch { /* storage full */ }
      return next;
    });
  };

  // While the AI is grading, poll every 4s until it finishes (or fails).
  const status = data?.locked ? data.attempt?.status : null;
  useEffect(() => {
    if (status !== 'grading') return undefined;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [status, load]);

  if (!data) return <Loading />;

  if (data.locked) {
    if (data.attempt?.status === 'grading') return <GradingCard cs={data.case} course={course} go={go} />;
    if (data.attempt?.status === 'failed') {
      return <FailedCard cs={data.case} attempt={data.attempt} course={course} go={go}
        onRetry={async () => {
          try { await api.post(`/cases/${course}/${code}/regrade`); toast.success('Re-grading your answers…'); load(); }
          catch (e) { toast.error(e.response?.data?.error || 'Retry failed'); }
        }} />;
    }
    return <ResultView cs={data.case} attempt={data.attempt} course={course} go={go} />;
  }

  const cs = data.case;
  const overLimit = answers.some((a) => wc(a) > WORD_LIMIT);
  const allFilled = answers.every((a) => a.trim().length >= 3);

  const submit = async () => {
    setSubmitting(true);
    try {
      await api.post(`/cases/${course}/${code}/submit`, { answers });
      try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
      toast.success('Submitted! Claude is grading your answers.');
      await load();              // flips to GradingCard, which then polls to the result
    } catch (e) {
      const msg = e.response?.data?.error || 'Submission failed';
      toast.error(msg);
      if (e.response?.status === 409) load();
    } finally { setSubmitting(false); setConfirm(false); }
  };

  return (
    <div className="space-y-5">
      <TopBar onBack={() => go({ course })}>
        <div>
          <div className="text-[11px] font-bold text-ilo-blue">{course} · Week {cs.week} · {cs.code}</div>
          <h1 className="text-xl sm:text-2xl font-black text-ilo-dark dark:text-white">{cs.title}</h1>
        </div>
      </TopBar>

      <Card className="p-6 sm:p-8">
        <div className="tl-rich max-w-none" dangerouslySetInnerHTML={{ __html: cs.contentHtml }} />
      </Card>

      <Card className="p-6 sm:p-8">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-lg font-black text-ilo-dark dark:text-white">Your answers</h2>
          {savedAt && <span className="text-[11px] font-semibold text-emerald-600 flex items-center gap-1">✓ Draft saved on this device</span>}
        </div>
        <p className="text-xs text-slate-500 mt-1">Answer all {cs.questions.length} questions. Maximum {WORD_LIMIT} words each. You may submit only once.</p>
        <p className="text-[11px] text-slate-400 mt-1">Your answers save automatically as you type — if you get signed out or close the tab, they'll be waiting when you reopen this case.</p>
        <div className="space-y-6 mt-5">
          {cs.questions.map((q, i) => {
            const n = wc(answers[i]);
            const over = n > WORD_LIMIT;
            return (
              <div key={i}>
                <label className="flex gap-2 font-bold text-ilo-dark dark:text-white text-sm">
                  <span className="text-ilo-blue">Q{i + 1}.</span><span>{q}</span>
                </label>
                <textarea rows={3} value={answers[i]}
                  onChange={(e) => updateAnswer(i, e.target.value)}
                  className="mt-2 w-full rounded-xl border border-border dark:border-navy-light bg-surface dark:bg-navy px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ilo-blue"
                  placeholder="Reason from the facts of the case…" />
                <div className={`text-[11px] font-semibold text-right mt-1 ${over ? 'text-red-500' : 'text-slate-400'}`}>{n}/{WORD_LIMIT} words</div>
              </div>
            );
          })}
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button disabled={!allFilled || overLimit || submitting} onClick={() => setConfirm(true)}
            className="px-6 py-3 text-sm font-black bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark transition-colors disabled:opacity-40">
            {submitting ? 'Grading…' : 'Submit for AI grading'}
          </button>
          {overLimit && <span className="text-xs font-semibold text-red-500">Some answers exceed {WORD_LIMIT} words.</span>}
          {!allFilled && !overLimit && <span className="text-xs text-slate-400">Answer every question to submit.</span>}
        </div>
      </Card>

      {confirm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setConfirm(false)}>
          <Card className="p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-black text-ilo-dark dark:text-white">Submit and lock this case?</h3>
            <p className="text-sm text-slate-500 mt-2">Claude will grade your answers on merit and this case will be <strong>locked forever</strong> — you cannot re-enter it. Continue?</p>
            <div className="mt-5 flex gap-3 justify-end">
              <button onClick={() => setConfirm(false)} className="px-4 py-2 text-sm font-bold border border-border dark:border-navy-light rounded-xl">Keep editing</button>
              <button onClick={submit} disabled={submitting} className="px-5 py-2 text-sm font-black bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark disabled:opacity-50">
                {submitting ? 'Grading…' : 'Submit & lock'}
              </button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Grading in progress ─────────────────────────── */
function GradingCard({ cs, course, go }) {
  return (
    <div className="space-y-5">
      <TopBar onBack={() => go({ course })}>
        <div>
          <div className="text-[11px] font-bold text-ilo-blue">{course} · Week {cs.week} · {cs.code}</div>
          <h1 className="text-xl sm:text-2xl font-black text-ilo-dark dark:text-white">{cs.title}</h1>
        </div>
      </TopBar>
      <Card className="p-10 text-center">
        <div className="mx-auto w-14 h-14 rounded-full border-4 border-ilo-blue/25 border-t-ilo-blue animate-spin" />
        <h2 className="mt-6 text-lg font-black text-ilo-dark dark:text-white">Claude is grading your answers…</h2>
        <p className="mt-2 text-sm text-slate-500 max-w-md mx-auto">
          Your answers are submitted and this case is now <strong>locked</strong>. Grading on merit usually takes under a minute.
          You can stay on this page — the result appears automatically — or come back later; it will be waiting for you.
        </p>
        <button onClick={() => go({ course })}
          className="mt-6 px-5 py-2.5 text-sm font-bold border border-border dark:border-navy-light rounded-xl hover:bg-surface dark:hover:bg-navy-light">
          Back to cases
        </button>
      </Card>
    </div>
  );
}

/* ─────────────────────────── Grading failed (retryable) ─────────────────────────── */
function FailedCard({ cs, attempt, course, go, onRetry }) {
  return (
    <div className="space-y-5">
      <TopBar onBack={() => go({ course })}>
        <div>
          <div className="text-[11px] font-bold text-ilo-blue">{course} · Week {cs.week} · {cs.code}</div>
          <h1 className="text-xl sm:text-2xl font-black text-ilo-dark dark:text-white">{cs.title}</h1>
        </div>
      </TopBar>
      <Card className="p-10 text-center">
        <div className="mx-auto w-14 h-14 rounded-full bg-amber-500/15 grid place-items-center text-2xl">⚠️</div>
        <h2 className="mt-5 text-lg font-black text-ilo-dark dark:text-white">Grading hit a snag</h2>
        <p className="mt-2 text-sm text-slate-500 max-w-md mx-auto">
          {attempt.gradeError || 'The AI grader was busy.'} Your submitted answers are safe and the case stays locked — just re-run the grading.
        </p>
        <div className="mt-6 flex gap-3 justify-center">
          <button onClick={onRetry}
            className="px-6 py-2.5 text-sm font-black bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark transition-colors">Retry grading</button>
          <button onClick={() => go({ course })}
            className="px-5 py-2.5 text-sm font-bold border border-border dark:border-navy-light rounded-xl hover:bg-surface dark:hover:bg-navy-light">Back to cases</button>
        </div>
      </Card>
    </div>
  );
}

/* AI-writing likelihood → colour/label. Higher = more likely AI-generated. */
const aiTone = (pct) => (pct >= 60
  ? { bar: 'bg-red-500', text: 'text-red-500', chip: 'bg-red-500 text-white', label: 'Likely AI-generated' }
  : pct >= 30
    ? { bar: 'bg-amber-500', text: 'text-amber-500', chip: 'bg-amber-500 text-white', label: 'Some AI signals' }
    : { bar: 'bg-emerald-500', text: 'text-emerald-500', chip: 'bg-emerald-500 text-white', label: 'Looks self-written' });

// A labelled percentage bar for the AI-writing estimate.
const AiBar = ({ pct, dark }) => {
  const t = aiTone(pct);
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] font-semibold mb-1">
        <span className={dark ? 'opacity-80' : 'text-slate-500'}>AI-writing likelihood</span>
        <span className={dark ? 'text-white' : t.text}>{pct}% · {t.label}</span>
      </div>
      <div className={`h-2 rounded-full overflow-hidden ${dark ? 'bg-white/20' : 'bg-surface-2 dark:bg-navy-light'}`}>
        <div className={`h-full rounded-full ${dark ? 'bg-white' : t.bar}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

const CriterionChip = ({ label, v }) => (
  <div className="rounded-lg bg-surface dark:bg-navy px-2.5 py-1.5 text-center">
    <div className="text-sm font-black text-ilo-dark dark:text-white leading-none">{v}<span className="text-[10px] text-slate-400">/5</span></div>
    <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400 mt-0.5">{label}</div>
  </div>
);

/* ─────────────────────────── Result / AI analysis ─────────────────────────── */
function ResultView({ cs, attempt, course, go }) {
  const ai = attempt.ai || {};
  const aiOverall = ai.aiOverall ?? 0;
  return (
    <div className="space-y-5">
      <TopBar onBack={() => go({ course })}>
        <div>
          <div className="text-[11px] font-bold text-ilo-blue">{course} · Week {cs.week} · {cs.code}</div>
          <h1 className="text-xl sm:text-2xl font-black text-ilo-dark dark:text-white">{cs.title}</h1>
        </div>
        <button onClick={() => go({ course, view: 'leaderboard' })}
          className="ml-auto px-4 py-2 text-sm font-bold border border-border dark:border-navy-light rounded-xl hover:bg-surface dark:hover:bg-navy-light">🏆 Ladder</button>
      </TopBar>

      {/* Score banner */}
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-ilo-dark to-ilo-blue p-6 sm:p-8 text-white">
          <div className="flex flex-wrap items-end gap-6">
            <div>
              <div className="text-6xl font-black leading-none">{attempt.rawScore}<span className="text-2xl">%</span></div>
              <div className="text-xs uppercase tracking-wide opacity-80 mt-1">on merit</div>
            </div>
            <div className="flex gap-6">
              <Stat label="Grade" value={<span className={`px-2.5 py-1 rounded-full text-sm ${bandColor(ai.band)}`}>{ai.band}</span>} />
              <Stat label="Percentile" value={attempt.relativeScore != null ? `${attempt.relativeScore}th` : '—'} />
              <Stat label="Peers" value={attempt.peers || 1} />
            </div>
          </div>
          {/* Overall AI-writing meter */}
          <div className="mt-6 max-w-md"><AiBar pct={aiOverall} dark /></div>
          {ai.overall && <p className="mt-5 text-sm leading-relaxed opacity-95 max-w-3xl">{ai.overall}</p>}
        </div>
        {aiOverall >= 60 && (
          <div className="bg-red-500/10 border-t border-red-500/30 px-6 py-3 text-sm font-semibold text-red-600 dark:text-red-400 flex items-center gap-2">
            ⚠️ Strong AI-writing signals in this submission. Case work should be in your own words — over-reliance on AI is flagged for your instructor.
          </div>
        )}
        {(ai.strengths?.length || ai.improvements?.length) ? (
          <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-border dark:divide-navy-light">
            <Bullets title="Strengths" tone="emerald" items={ai.strengths} />
            <Bullets title="To improve" tone="amber" items={ai.improvements} />
          </div>
        ) : null}
      </Card>

      {/* Per-question breakdown */}
      <div className="space-y-4">
        {(ai.perQuestion || []).map((p, i) => {
          const c = p.criteria || {};
          const flagged = (p.aiLikelihood || 0) >= 60;
          return (
            <Card key={i} className="p-5 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="font-bold text-ilo-dark dark:text-white text-sm flex gap-2">
                  <span className="text-ilo-blue">Q{i + 1}.</span><span>{p.question}</span>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-2xl font-black text-ilo-dark dark:text-white">{p.score}<span className="text-sm text-slate-400">/{p.max}</span></div>
                </div>
              </div>
              {/* Numeric rubric */}
              <div className="mt-3 grid grid-cols-4 gap-2">
                <CriterionChip label="Relevance" v={c.relevance ?? 0} />
                <CriterionChip label="Accuracy" v={c.accuracy ?? 0} />
                <CriterionChip label="Reasoning" v={c.reasoning ?? 0} />
                <CriterionChip label="Use of case" v={c.useOfCase ?? 0} />
              </div>
              <div className="mt-4 grid sm:grid-cols-2 gap-4">
                <div className={`rounded-xl p-3 border ${flagged ? 'bg-red-500/5 border-red-500/40' : 'bg-surface dark:bg-navy border-transparent'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Your answer</div>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${aiTone(p.aiLikelihood || 0).chip}`}>AI {p.aiLikelihood || 0}%</span>
                  </div>
                  <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{p.answer}</p>
                  <div className="mt-2"><AiBar pct={p.aiLikelihood || 0} /></div>
                  {p.aiReason && <p className="mt-1.5 text-[11px] italic text-slate-400">{p.aiReason}</p>}
                </div>
                <div className="rounded-xl bg-ilo-blue/5 dark:bg-ilo-blue/10 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-ilo-blue mb-1">Examiner feedback</div>
                  <p className="text-sm text-slate-700 dark:text-slate-200">{p.feedback}</p>
                  {p.modelPoints?.length ? (
                    <ul className="mt-2 space-y-0.5">
                      {p.modelPoints.map((m, j) => <li key={j} className="text-xs text-slate-500 flex gap-1.5"><span className="text-ilo-blue">•</span>{m}</li>)}
                    </ul>
                  ) : null}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {ai.modelAnswer && (
        <Card className="p-6 sm:p-8">
          <h3 className="text-lg font-black text-ilo-dark dark:text-white flex items-center gap-2">📘 Model analysis</h3>
          <p className="mt-3 text-sm leading-relaxed text-slate-700 dark:text-slate-200">{ai.modelAnswer}</p>
        </Card>
      )}

      {/* Back to cases — start a new case */}
      <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
        <button onClick={() => go({ course })}
          className="px-8 py-3.5 text-sm font-black bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark transition-colors">
          ← Back to cases — start a new case
        </button>
        <button onClick={() => go({ course, view: 'leaderboard' })}
          className="px-6 py-3.5 text-sm font-bold border border-border dark:border-navy-light rounded-xl hover:bg-surface dark:hover:bg-navy-light">
          🏆 View leaderboard
        </button>
      </div>

      <div className="text-center text-xs text-slate-400">
        Graded on merit by Claude · relative rank computed against {attempt.peers || 1} peer{(attempt.peers || 1) === 1 ? '' : 's'} on this case · this case is locked. AI-writing figures are an automated estimate, not proof.
      </div>
    </div>
  );
}

/* ─────────────────────────── Leaderboard ─────────────────────────── */
function Leaderboard({ course, go }) {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  useEffect(() => { api.get(`/cases/${course}/leaderboard`).then((r) => setData(r.data)).catch(() => toast.error('Failed to load')); }, [course]);
  if (!data) return <Loading />;
  return (
    <div className="space-y-5">
      <TopBar onBack={() => go({ course })}>
        <div>
          <div className="text-[11px] font-bold text-ilo-blue">{course} · Leaderboard</div>
          <h1 className="text-xl sm:text-2xl font-black text-ilo-dark dark:text-white">{data.title}</h1>
        </div>
      </TopBar>
      <Card className="overflow-hidden">
        {data.ladder.length === 0 ? (
          <div className="p-10 text-center text-slate-400 text-sm">No attempts yet — be the first on the board.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-border dark:border-navy-light">
                <th className="px-4 py-3">Rank</th><th className="px-4 py-3">Student</th>
                <th className="px-4 py-3 text-right">Cumulative</th><th className="px-4 py-3 text-right">Cases</th>
                <th className="px-4 py-3 text-right">Avg</th><th className="px-4 py-3 text-right">Best</th>
              </tr>
            </thead>
            <tbody>
              {data.ladder.map((r) => (
                <tr key={r.student} className={`border-b border-border dark:border-navy-light last:border-0 ${r.isMe ? 'bg-gold/10' : ''}`}>
                  <td className="px-4 py-3 font-black text-lg">{medal(r.rank)}</td>
                  <td className="px-4 py-3 font-bold text-ilo-dark dark:text-white">{r.studentName}{r.isMe && <span className="ml-2 text-[10px] font-bold text-gold">YOU</span>}</td>
                  <td className="px-4 py-3 text-right font-black text-gold">{r.cumulativeScore}</td>
                  <td className="px-4 py-3 text-right">{r.casesDone}</td>
                  <td className="px-4 py-3 text-right">{r.averageScore}%</td>
                  <td className="px-4 py-3 text-right">{r.bestScore}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <p className="text-center text-xs text-slate-400">Ranked by cumulative on-merit points across all completed cases in this course.</p>
    </div>
  );
}

/* ─────────────────────────── shared bits ─────────────────────────── */
const Loading = () => <div className="py-24 text-center text-slate-400 text-sm animate-pulse">Loading…</div>;
const Stat = ({ label, value }) => (
  <div><div className="text-lg font-black">{value}</div><div className="text-[10px] uppercase tracking-wide opacity-80">{label}</div></div>
);
const Bullets = ({ title, tone, items }) => (
  <div className="p-5">
    <div className={`text-[11px] font-bold uppercase tracking-wide mb-2 ${tone === 'emerald' ? 'text-emerald-600' : 'text-amber-600'}`}>{title}</div>
    <ul className="space-y-1">{(items || []).map((s, i) => <li key={i} className="text-sm text-slate-600 dark:text-slate-300 flex gap-2"><span className={tone === 'emerald' ? 'text-emerald-500' : 'text-amber-500'}>{tone === 'emerald' ? '✓' : '→'}</span>{s}</li>)}</ul>
  </div>
);
const TopBar = ({ onBack, children }) => (
  <div className="flex items-center gap-3">
    <button onClick={onBack} className="w-9 h-9 shrink-0 grid place-items-center rounded-xl border border-border dark:border-navy-light hover:bg-surface dark:hover:bg-navy-light" aria-label="Back">←</button>
    {children}
  </div>
);

/* ─────────────────────────── page router ─────────────────────────── */
/* ─────────────────────────── Certificate ─────────────────────────── */
function CertificateView({ course, go }) {
  const [data, setData] = useState(null);
  useEffect(() => { api.get(`/cases/${course}/certificate`).then((r) => setData(r.data)).catch(() => toast.error('Failed to load certificate')); }, [course]);
  if (!data) return <Loading />;
  const cert = data.certificate;

  return (
    <div className="space-y-5">
      <TopBar onBack={() => go({})}>
        <div>
          <div className="text-[11px] font-bold text-ilo-blue">{course} · Certificate</div>
          <h1 className="text-xl sm:text-2xl font-black text-ilo-dark dark:text-white">{data.title}</h1>
        </div>
      </TopBar>

      {!data.eligible || !cert ? (
        <Card className="p-10 text-center">
          <div className="text-4xl">🎓</div>
          <h2 className="mt-3 text-lg font-black text-ilo-dark dark:text-white">Certificate not earned yet</h2>
          <p className="mt-2 text-sm text-slate-500 max-w-md mx-auto">
            Complete all <strong>{data.totalCases}</strong> cases in {data.title} to earn your certificate.
            You've completed <strong>{data.casesCompleted}</strong> — {data.remaining} to go.
          </p>
          <button onClick={() => go({ course })} className="mt-6 px-6 py-2.5 text-sm font-black bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark">Continue cases →</button>
        </Card>
      ) : (
        <>
          <style>{'@media print{body *{visibility:hidden}#tl-cert,#tl-cert *{visibility:visible}#tl-cert{position:absolute;left:0;top:0;width:100%;margin:0}.no-print{display:none!important}}'}</style>
          <div id="tl-cert" className="mx-auto max-w-3xl bg-white text-[#0e1f3d]" style={{ border: '9px solid #002D72' }}>
            <div className="text-center" style={{ border: '2px solid #A07422', margin: '9px', padding: '38px 28px' }}>
              <div className="text-[13px] tracking-[0.32em] font-black text-[#0072BC] uppercase">NSP Learning</div>
              <div className="mt-1 text-[10px] tracking-[0.2em] text-slate-500 uppercase">Skills Passport · ppmc.pk</div>
              <div className="mt-7 text-3xl font-black text-[#002D72]" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>Certificate of Completion</div>
              <div className="mx-auto mt-3 h-[3px] w-24 rounded" style={{ background: '#A07422' }} />
              <div className="mt-7 text-sm text-slate-500">This is to certify that</div>
              <div className="mt-2 text-4xl font-black text-[#002D72]" style={{ fontFamily: 'Georgia, serif' }}>{cert.studentName}</div>
              {cert.studentId ? <div className="text-xs text-slate-500 mt-1">{cert.studentId}</div> : null}
              <div className="mt-6 text-sm text-slate-600">has successfully completed the graduate-level course</div>
              <div className="mt-2 text-2xl font-black text-[#0072BC]">{data.title}</div>
              <div className="mt-1 text-xs text-slate-500">{data.level} · {cert.totalCases} case studies · assessed on merit</div>
              <div className="mt-7 inline-flex items-center gap-10">
                <div><div className="text-2xl font-black text-[#A07422]">{cert.band}</div><div className="text-[10px] uppercase tracking-wide text-slate-400">grade</div></div>
                <div><div className="text-2xl font-black text-[#002D72]">{cert.averageScore}%</div><div className="text-[10px] uppercase tracking-wide text-slate-400">course average</div></div>
              </div>
              <div className="mt-9 flex items-end justify-between text-left gap-4">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">Issued</div>
                  <div className="text-sm font-bold">{new Date(cert.issuedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">Certificate ID</div>
                  <div className="text-sm font-mono font-bold">{cert.certificateId}</div>
                </div>
              </div>
              <div className="mt-5 text-[9px] text-slate-400">Verify authenticity at {window.location.host}/lms/api/v1/cases/certificate/verify/{cert.certificateId}</div>
            </div>
          </div>
          <div className="no-print flex justify-center gap-3">
            <button onClick={() => window.print()} className="px-6 py-3 text-sm font-black bg-gold text-white rounded-xl hover:opacity-90">🖨 Print / Save as PDF</button>
            <button onClick={() => go({})} className="px-5 py-3 text-sm font-bold border border-border dark:border-navy-light rounded-xl hover:bg-surface dark:hover:bg-navy-light">Back to courses</button>
          </div>
        </>
      )}
    </div>
  );
}

export default function CaseStudies() {
  const [sp, setSp] = useSearchParams();
  const course = sp.get('course');
  const code = sp.get('code');
  const view = sp.get('view');
  const go = (params) => {
    const next = new URLSearchParams();
    if (params.course) next.set('course', params.course);
    if (params.code) next.set('code', params.code);
    if (params.view) next.set('view', params.view);
    setSp(next);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {course && code ? <CaseView course={course} code={code} go={go} />
        : course && view === 'leaderboard' ? <Leaderboard course={course} go={go} />
        : course && view === 'certificate' ? <CertificateView course={course} go={go} />
        : course ? <CourseList course={course} go={go} />
        : <Overview go={go} />}
    </div>
  );
}
