import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useLang } from '../../context/LangContext';
import { useAuth } from '../../context/AuthContext';
import api from '../../api/client';
import QuizRenderer from '../../components/quiz/QuizRenderer';
import DOMPurify from 'dompurify';
import { toEmbedUrl, isDirectVideo } from '../../utils/video';

/* Render uploaded handout/exercise content — sanitized HTML (tables, headings,
   lists) when present, otherwise clean pre-wrapped text. */
function RichContent({ content, className = '' }) {
  if (!content) return null;
  const isHtml = /<\/?[a-z][\s\S]*>/i.test(content);
  if (isHtml) {
    const clean = DOMPurify.sanitize(content, { USE_PROFILES: { html: true } });
    return <div className={`tl-rich ${className}`} dangerouslySetInnerHTML={{ __html: clean }} />;
  }
  return <div className={`tl-rich whitespace-pre-wrap ${className}`}>{content}</div>;
}

const STAFF_ROLES = ['admin', 'institution', 'assessor'];

/* ─────────────────────────────────────────────────────────────────────────
 * TrainingTab — the unified learner journey for one enrolled training:
 *   Pre-Assessment → Materials → Live Sessions → Final Assessment → Certificate
 * Every stage is wired to the real backend (no mock data) and gates the next.
 * ───────────────────────────────────────────────────────────────────────── */

const spinner = (
  <div className="flex justify-center py-16">
    <div className="w-8 h-8 border-4 border-ilo-blue border-t-transparent rounded-full animate-spin" />
  </div>
);

/* Map a QuizRenderer answer to the server payload shape (mirrors LMS QuizView). */
const wordCount = (s) => { const x = (s || '').trim(); return x ? x.split(/\s+/).length : 0; };
const WordLimitHint = ({ q, answer }) => {
  if (!(q.type === 'essay' || q.type === 'short-answer') || !q.wordLimit) return null;
  const wc = wordCount(answer);
  return <p className={`text-xs ${wc > q.wordLimit ? 'text-red-500' : 'text-gray-500 dark:text-gray-400'}`}>✍ Write up to {q.wordLimit} words · {wc} written</p>;
};

function toAnswerPayload(type, ans) {
  switch (type || 'mcq') {
    case 'mcq': return { selectedOption: ans };
    case 'matching': return { pairs: ans };
    case 'ordering': return { order: ans };
    case 'drag-drop': return { placements: ans };
    case 'hotspot': return { coordinates: ans };
    default: return { answer: ans }; // true-false, fill-blank, short-answer, essay
  }
}

/* ─── A single quiz stage (pre or final) ─── */
function JourneyQuiz({ programId, module, workerId, passMark, onPassed }) {
  const { t } = useLang();
  const questions = module.quizQuestions || [];
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const submitted = !!result;

  const submit = async () => {
    if (Object.keys(answers).length < questions.length) {
      return toast.error(t('Please answer all questions'));
    }
    setSubmitting(true);
    try {
      const payload = questions.map((q, i) => toAnswerPayload(q.type, answers[i]));
      const { data } = await api.post(`/training/${programId}/quiz/${module._id}`, {
        workerId, answers: payload,
      });
      setResult(data);
      if (data.passed) {
        toast.success(`${t('Passed')}: ${data.score}%`);
        onPassed?.(data);
      } else {
        toast.error(`${t('Score')} ${data.score}% — ${t('need')} ${data.passMark || passMark}%`);
      }
    } catch (err) {
      toast.error(err.response?.data?.error || t('Failed to submit'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!questions.length) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">{t('No questions configured for this assessment.')}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span>{questions.length} {t('questions')}</span><span>·</span>
        <span>{t('Pass mark')}: {passMark}%</span>
      </div>
      {questions.map((q, i) => {
        const fb = result?.answers?.[i];
        return (
          <div key={i} className="space-y-2">
            <QuizRenderer question={q} index={i} answer={answers[i]}
              onChange={(v) => setAnswers(a => ({ ...a, [i]: v }))}
              disabled={submitted} showResult={submitted}
              isCorrect={fb?.isCorrect} />
            {submitted && fb && !fb.pending && (
              <div className={`text-xs rounded-lg p-3 ${fb.isCorrect
                ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'}`}>
                <span className="font-bold">{fb.isCorrect ? `✓ ${t('Correct')}` : `✗ ${t('Incorrect')}`}</span>
                {!fb.isCorrect && (fb.correctOption != null && fb.correctOption >= 0 || fb.correctAnswer) && (
                  <span className="ml-1 text-gray-600 dark:text-gray-300">
                    {t('Correct answer')}: {fb.correctOption != null && fb.correctOption >= 0
                      ? (q.options?.[fb.correctOption] ?? fb.correctOption) : fb.correctAnswer}
                  </span>
                )}
                {fb.explanation && <p className="mt-1 text-gray-600 dark:text-gray-300">{fb.explanation}</p>}
              </div>
            )}
          </div>
        );
      })}
      {!submitted ? (
        <button onClick={submit} disabled={submitting}
          className="px-6 py-2.5 text-sm font-semibold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark transition-colors disabled:opacity-50">
          {submitting ? t('Submitting...') : t('Submit')}
        </button>
      ) : (
        <div className="flex items-center gap-3">
          <span className={`px-4 py-2 rounded-xl text-sm font-bold text-white ${result.passed ? 'bg-green-500' : 'bg-red-500'}`}>
            {t('Score')}: {result.score}%
          </span>
          {!result.passed && (
            <button onClick={() => { setResult(null); setAnswers({}); }}
              className="px-5 py-2 text-sm font-semibold bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition-colors">
              {t('Retry')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Professional, downloadable results report ─── */
const WRITTEN = new Set(['essay', 'short-answer']);
function bandColor(pct) { return pct >= 70 ? '#16a34a' : pct >= 50 ? '#d97706' : '#dc2626'; }

function buildReportHtml(meta, result) {
  const passed = result.passed ?? (result.score >= (result.passMark || 70));
  const rows = (result.answers || []).map((a, i) => {
    const ok = a.isCorrect;
    const yourAns = WRITTEN.has(a.type) ? (a.response || '—') : (a.selectedOption != null ? `Option ${a.selectedOption + 1}` : '—');
    const correct = a.correctAnswer ?? (a.correctText || '');
    const fb = a.aiFeedback || a.explanation || '';
    return `<tr>
      <td style="padding:8px;border-bottom:1px solid #eee;vertical-align:top">${i + 1}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;vertical-align:top">${a.score != null ? a.score + '%' : (ok ? '✓' : '✗')}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;vertical-align:top">${(yourAns + '').replace(/</g, '&lt;')}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;vertical-align:top;color:#555">${(correct + '').replace(/</g, '&lt;')}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;vertical-align:top;color:#666">${(fb + '').replace(/</g, '&lt;')}</td>
    </tr>`;
  }).join('');
  const rel = result.relative ? `<div style="text-align:center"><div style="font-size:34px;font-weight:800;color:#002D72">${result.relative.percentile}%</div><div style="font-size:12px;color:#888">Relative (percentile)<br/>cohort avg ${result.relative.cohortAvg}% (${result.relative.delta >= 0 ? '+' : ''}${result.relative.delta})</div></div>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Result — ${meta.moduleTitle || ''}</title></head>
  <body style="font-family:Segoe UI,Arial,sans-serif;color:#1a1a1a;margin:0;padding:32px;background:#fff">
    <div style="max-width:820px;margin:0 auto;border:2px solid #002D72;border-radius:14px;padding:28px 32px">
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #C8952E;padding-bottom:12px">
        <div><div style="font-size:12px;letter-spacing:3px;color:#C8952E;font-weight:700">TALENTLEDGER · PPMC KP</div>
          <div style="font-size:22px;font-weight:800;color:#002D72">Assessment Result</div></div>
        <div style="text-align:right;font-size:12px;color:#666">${meta.training || ''}<br/>${meta.trade || ''}${meta.nqfLevel ? ' · NQF ' + meta.nqfLevel : ''}</div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:16px">
        <div><div style="font-size:12px;color:#888">Participant</div><div style="font-size:18px;font-weight:700">${meta.holderName || '—'}</div>
          <div style="font-size:12px;color:#888;margin-top:6px">Assessment</div><div style="font-weight:600">${meta.moduleTitle || ''}</div></div>
        <div style="text-align:center"><div style="font-size:44px;font-weight:800;color:${bandColor(result.score)}">${result.score}%</div>
          <div style="display:inline-block;padding:3px 12px;border-radius:20px;font-size:12px;font-weight:700;color:#fff;background:${passed ? '#16a34a' : '#dc2626'}">${passed ? 'PASS' : 'NOT YET PASSED'}</div>
          <div style="font-size:12px;color:#888;margin-top:4px">${result.correctAnswers}/${result.totalQuestions} correct · pass ${result.passMark || 70}%</div></div>
        ${rel}
      </div>
      <table style="width:100%;border-collapse:collapse;margin-top:20px;font-size:13px">
        <thead><tr style="background:#f5f7fb;text-align:left"><th style="padding:8px">#</th><th style="padding:8px">Score</th><th style="padding:8px">Your answer</th><th style="padding:8px">Correct/model</th><th style="padding:8px">Feedback</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="margin-top:18px;font-size:11px;color:#999;text-align:center">Generated by NSP Learning · ${meta.moduleTitle || ''} · Single-attempt result</div>
    </div>
    <script>window.onload=function(){setTimeout(function(){window.print();},300);}</script>
  </body></html>`;
}
function downloadReport(meta, result) {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(buildReportHtml(meta, result)); w.document.close(); w.focus();
  return true;
}

function ScoreRing({ pct, label, sub, color }) {
  const c = color || bandColor(pct);
  return (
    <div className="flex flex-col items-center">
      <div className="relative w-28 h-28">
        <svg viewBox="0 0 36 36" className="w-28 h-28 -rotate-90">
          <circle cx="18" cy="18" r="16" fill="none" className="stroke-gray-200 dark:stroke-navy-light" strokeWidth="3.2" />
          <circle cx="18" cy="18" r="16" fill="none" stroke={c} strokeWidth="3.2" strokeDasharray={`${(pct / 100) * 100.5} 100.5`} strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-2xl font-black" style={{ color: c }}>{pct}%</div>
      </div>
      <p className="text-xs font-semibold mt-1 dark:text-gray-200">{label}</p>
      {sub && <p className="text-[11px] text-gray-400 text-center">{sub}</p>}
    </div>
  );
}

function ResultsReport({ meta, result, submittedNote }) {
  const { t } = useLang();
  const passed = result.passed ?? (result.score >= (result.passMark || 70));
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border dark:border-navy-light overflow-hidden">
        <div className="bg-gradient-to-r from-[#002D72] to-[#0a4bb3] text-white px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-[11px] tracking-[0.2em] text-[#f0c667] font-bold">ASSESSMENT RESULT</p>
            <h3 className="text-lg font-bold">{meta.moduleTitle}</h3>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-bold ${passed ? 'bg-green-500' : 'bg-red-500'}`}>{passed ? t('PASS') : t('NOT YET PASSED')}</span>
        </div>
        <div className="p-5 flex flex-wrap items-center justify-center gap-8">
          <ScoreRing pct={result.score} label={t('Absolute score')} sub={`${result.correctAnswers}/${result.totalQuestions} ${t('correct')} · ${t('pass')} ${result.passMark || 70}%`} />
          {result.relative
            ? <ScoreRing pct={result.relative.percentile} label={t('Relative score')} color="#002D72" sub={`${t('percentile')} · ${t('cohort avg')} ${result.relative.cohortAvg}% (${result.relative.delta >= 0 ? '+' : ''}${result.relative.delta})`} />
            : <div className="max-w-[9rem] text-center text-[11px] text-gray-400">{t('Relative score appears once other participants have submitted.')}</div>}
        </div>
      </div>

      {/* Learning gain (pre → post) */}
      {result.learningGain && (
        <div className="rounded-2xl border border-green-500/40 bg-green-50 dark:bg-green-900/20 p-4">
          <p className="text-xs font-bold text-green-700 dark:text-green-400 uppercase mb-2">📈 {t('Learning gain')}</p>
          <div className="flex items-center justify-around text-center">
            <div><div className="text-2xl font-black text-gray-500 dark:text-gray-400">{result.learningGain.pre}%</div><div className="text-[11px] text-gray-400">{t('Pre-test')}</div></div>
            <div className="text-2xl text-gray-300">→</div>
            <div><div className="text-2xl font-black text-[#002D72] dark:text-blue-300">{result.learningGain.post}%</div><div className="text-[11px] text-gray-400">{t('Post-test')}</div></div>
            <div><div className={`text-3xl font-black ${result.learningGain.gain >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>{result.learningGain.gain >= 0 ? '+' : ''}{result.learningGain.gain}</div><div className="text-[11px] text-gray-400">{t('points gained')}</div></div>
          </div>
        </div>
      )}

      {/* Per-question review */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{t('Answer review')}</p>
        {(result.answers || []).map((a, i) => (
          <div key={i} className={`rounded-lg p-3 text-sm ${a.isCorrect ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}>
            <div className="flex items-center justify-between">
              <span className="font-semibold dark:text-gray-100">{t('Question')} {i + 1}</span>
              <span className={`text-xs font-bold ${a.isCorrect ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>{a.score != null ? `${a.score}%` : (a.isCorrect ? `✓ ${t('Correct')}` : `✗ ${t('Incorrect')}`)}</span>
            </div>
            {WRITTEN.has(a.type) && a.response && <p className="text-xs text-gray-600 dark:text-gray-300 mt-1"><b>{t('Your answer')}:</b> {a.response}</p>}
            {!a.isCorrect && (a.correctAnswer || a.correctText) && <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5"><b>{t('Correct')}:</b> {a.correctAnswer || a.correctText}</p>}
            {(a.aiFeedback || a.explanation) && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{a.aiFeedback || a.explanation}</p>}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button onClick={() => { if (!downloadReport(meta, result)) toast.error(t('Allow pop-ups to download the report')); }}
          className="px-5 py-2.5 text-sm font-semibold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark transition-colors">
          ⬇ {t('Download result')}
        </button>
        {submittedNote && <span className="text-xs text-gray-400">{submittedNote}</span>}
      </div>
    </div>
  );
}

/* Reconstruct a result object from a stored attempt (for no-retry re-view). */
function attemptToResult(attempt, passMark) {
  return {
    score: attempt.score, correctAnswers: attempt.correctAnswers, totalQuestions: attempt.totalQuestions,
    passed: attempt.passed, passMark, answers: attempt.answers || [],
  };
}

/* ─── Blind pre-test baseline card (no answer key revealed) ─── */
function PreBaselineCard({ result, moduleTitle }) {
  const { t } = useLang();
  return (
    <div className="rounded-2xl border border-border dark:border-navy-light overflow-hidden">
      <div className="bg-gradient-to-r from-[#5b4a8a] to-[#7a63b0] text-white px-5 py-4">
        <p className="text-[11px] tracking-[0.2em] text-white/70 font-bold">PRE-TEST · BASELINE RECORDED</p>
        <h3 className="text-lg font-bold">{moduleTitle}</h3>
      </div>
      <div className="p-5 text-center space-y-2">
        <ScoreRing pct={result.score} label={t('Baseline score')} color="#7a63b0" sub={`${result.correctAnswers ?? ''}${result.totalQuestions ? '/' + result.totalQuestions : ''} ${t('correct')}`} />
        <p className="text-sm text-gray-600 dark:text-gray-300">{t('Your baseline is recorded. Answers are hidden until you complete the training and take the post-test — then you\'ll see your learning gain.')}</p>
      </div>
    </div>
  );
}

/* ─── Paged assessment player: one question at a time, Skip/Next, single attempt ─── */
function AssessmentPlayer({ programId, module, workerId, passMark, meta, phase, onSubmitted }) {
  const { t } = useLang();
  const questions = module.quizQuestions || [];
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      const payload = questions.map((q, i) => toAnswerPayload(q.type, answers[i]));
      const { data } = await api.post(`/training/${programId}/quiz/${module._id}`, { workerId, answers: payload, phase });
      setResult(data); onSubmitted?.(data);
    } catch (err) {
      const status = err.response?.status;
      const msg = err.response?.data?.error || '';
      if (status === 409) { setResult(err.response.data); onSubmitted?.(err.response.data); }
      // Stale module id (e.g. the training content was refreshed while this page
      // was open) — reload the latest training and ask the learner to resubmit.
      else if (status === 404 || /not a quiz|not found|not enrolled/i.test(msg)) {
        toast.error(t('This assessment was just updated. Reloading — please tap Submit again.'));
        onSubmitted?.();
      } else toast.error(msg || t('Failed to submit'));
    } finally { setSubmitting(false); }
  };

  if (result) {
    if (result.hideAnswers || phase === 'pre') return <PreBaselineCard result={result} moduleTitle={module.title} />;
    return <ResultsReport meta={{ ...meta, moduleTitle: module.title }} result={result} />;
  }
  if (!questions.length) return <p className="text-sm text-gray-500 dark:text-gray-400">{t('No questions configured.')}</p>;

  const q = questions[idx];
  const last = idx === questions.length - 1;
  const answered = answers[idx] !== undefined && answers[idx] !== '' && answers[idx] !== null;
  return (
    <div className="space-y-4">
      {phase && (
        <div className={`text-xs font-semibold rounded-lg px-3 py-2 ${phase === 'pre' ? 'bg-[#7a63b0]/10 text-[#5b4a8a] dark:text-purple-300' : 'bg-ilo-blue/10 text-ilo-blue'}`}>
          {phase === 'pre' ? `📋 ${t('Pre-test — measures your starting point. Answers stay hidden until the post-test.')}` : `🎯 ${t('Post-test — the same questions as the pre-test. Your result shows how much you gained.')}`}
        </div>
      )}
      <div>
        <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
          <span>{t('Question')} {idx + 1} {t('of')} {questions.length}</span>
          <span className="text-amber-600 dark:text-amber-400 font-semibold">⚠ {t('Single attempt — no retry')}</span>
        </div>
        <div className="h-1.5 rounded-full bg-gray-200 dark:bg-navy-mid overflow-hidden"><div className="h-full bg-ilo-blue transition-all" style={{ width: `${((idx + 1) / questions.length) * 100}%` }} /></div>
      </div>

      <QuizRenderer question={q} index={idx} answer={answers[idx]} onChange={(v) => setAnswers(a => ({ ...a, [idx]: v }))} />
      <WordLimitHint q={q} answer={answers[idx]} />

      <div className="flex items-center justify-between gap-2 pt-2">
        <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}
          className="px-4 py-2 text-sm font-semibold rounded-xl border border-border dark:border-navy-light dark:text-gray-200 disabled:opacity-40">{t('Previous')}</button>
        <div className="flex items-center gap-2">
          {!last && <button onClick={() => setIdx(i => i + 1)}
            className="px-4 py-2 text-sm font-semibold rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-navy-light">{t('Skip')}</button>}
          {!last
            ? <button onClick={() => setIdx(i => i + 1)}
                className="px-6 py-2 text-sm font-semibold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark transition-colors">{answered ? t('Next') : t('Next')} →</button>
            : <button onClick={submit} disabled={submitting}
                className="px-6 py-2 text-sm font-bold bg-green-600 text-white rounded-xl hover:bg-green-700 transition-colors disabled:opacity-50">{submitting ? t('Submitting…') : t('Submit')}</button>}
        </div>
      </div>
      {last && <p className="text-[11px] text-gray-400 text-right">{t('Review with Previous before submitting — you cannot change answers after Submit.')}</p>}
    </div>
  );
}

/* ─── Paged, scored exercise player (single attempt) ─── */
/* ─── Trainee exercise result: score + AI comments ─── */
function ExerciseResult({ result, title }) {
  const { t } = useLang();
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border dark:border-navy-light overflow-hidden">
        <div className="bg-gradient-to-r from-[#002D72] to-[#0a4bb3] text-white px-5 py-3">
          <p className="text-[11px] tracking-[0.2em] text-[#f0c667] font-bold">EXERCISE RESULT</p>
          <h3 className="text-base font-bold">{title}</h3>
        </div>
        <div className="p-5 flex flex-wrap items-center justify-center gap-8">
          <ScoreRing pct={result.score} label={t('Your score')} />
          {result.relative && <ScoreRing pct={result.relative.percentile} label={t('Vs cohort')} color="#002D72" sub={`${t('percentile')} · ${t('avg')} ${result.relative.cohortAvg}%`} />}
        </div>
      </div>
      {result.feedback && <p className="text-sm text-gray-700 dark:text-gray-200">{result.feedback}</p>}
      {result.wrong?.length > 0 && (
        <div className="rounded-xl bg-red-50 dark:bg-red-900/20 p-4">
          <p className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase mb-1">📌 {t('What to improve')}</p>
          <ul className="list-disc list-inside space-y-1 text-sm text-gray-700 dark:text-gray-300">{result.wrong.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
      {result.response && (
        <details className="text-sm">
          <summary className="cursor-pointer text-gray-500 dark:text-gray-400">{t('Your submitted reply')}</summary>
          <p className="mt-1 whitespace-pre-wrap text-gray-700 dark:text-gray-300 p-3 rounded-xl bg-gray-50 dark:bg-navy-light">{result.response}</p>
        </details>
      )}
    </div>
  );
}

function ExercisePlayer({ programId, set, workerId, meta, onSubmitted }) {
  const { t } = useLang();
  const [response, setResponse] = useState('');
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!response.trim()) return toast.error(t('Write your reply before submitting'));
    setSubmitting(true);
    try {
      const { data } = await api.post(`/training/${programId}/practice/${set._id}/submit`, { workerId, response });
      setResult(data); onSubmitted?.(data);
    } catch (err) {
      if (err.response?.status === 409) { setResult(err.response.data); onSubmitted?.(err.response.data); }
      else toast.error(err.response?.data?.error || t('Failed to submit'));
    } finally { setSubmitting(false); }
  };

  if (result) return <ExerciseResult result={result} title={set.title} />;
  const exercise = set.content || set.description || '';
  return (
    <div className="space-y-4">
      {exercise && (
        <div className="rounded-2xl border border-border dark:border-navy-light overflow-hidden shadow-sm">
          <div className="flex items-center gap-2 bg-gradient-to-r from-[#002D72] to-[#0a4bb3] px-4 py-2.5 text-white">
            <span>📄</span><p className="text-sm font-bold">{set.title}</p>
          </div>
          <div className="p-5 max-h-[26rem] overflow-y-auto bg-white dark:bg-navy-mid text-gray-700 dark:text-gray-200">
            <RichContent content={exercise} />
          </div>
        </div>
      )}
      <div className="rounded-2xl border border-ilo-blue/30 bg-ilo-blue/5 dark:bg-ilo-blue/10 p-4 space-y-2">
        <label className="text-sm font-bold text-ilo-blue">✍ {t('Your reply')}</label>
        <textarea value={response} onChange={e => setResponse(e.target.value)} rows={7}
          placeholder={t('Read the exercise above, then write your reply here…')}
          className="w-full px-3 py-2.5 text-sm rounded-xl border border-border dark:border-navy-light bg-white dark:bg-navy-mid dark:text-white" />
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-gray-400">⚠ {t('Single attempt — the AI grades your reply on submit.')}</p>
          <button onClick={submit} disabled={submitting}
            className="px-6 py-2.5 text-sm font-bold bg-green-600 text-white rounded-xl hover:bg-green-700 transition-colors disabled:opacity-50 shrink-0">
            {submitting ? t('Evaluating…') : `✓ ${t('Submit for AI evaluation')}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Material (non-assessment) module viewer ─── */
const TA_LABELS = { clarity: 'Clarity', knowledge: 'Subject knowledge', timekeeping: 'Time-keeping', examples: 'Examples & visuals', engagement: 'Engagement' };

/* Interactive Trainer Assessment — participants rate each trainer 1–5 on five
   criteria; submits once per participant and auto-averages. Staff see results. */
function TrainerAssessment({ programId }) {
  const { t } = useLang();
  const { user } = useAuth();
  const isStaff = ['admin', 'institution', 'assessor'].includes(user?.role);
  const [trainers, setTrainers] = useState(null);
  const [criteria, setCriteria] = useState([]);
  const [submitted, setSubmitted] = useState(false);
  const [ratings, setRatings] = useState({});
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);

  useEffect(() => {
    api.get(`/training/${programId}/trainer-assessment`)
      .then(({ data }) => { setTrainers(data.trainers || []); setCriteria(data.criteria || []); setSubmitted(!!data.submitted); })
      .catch(() => setTrainers([]));
  }, [programId]);

  const setRating = (tk, c, v) => setRatings(p => ({ ...p, [tk]: { ...(p[tk] || {}), [c]: v } }));
  const complete = trainers && trainers.length > 0 && trainers.every(tr => criteria.every(c => ratings[tr.key]?.[c]));

  const submit = async () => {
    if (!complete) { toast.error(t('Please rate every trainer on all five criteria.')); return; }
    setBusy(true);
    try {
      const payload = trainers.map(tr => ({ key: tr.key, ...ratings[tr.key] }));
      await api.post(`/training/${programId}/trainer-assessment`, { ratings: payload, comment });
      toast.success(t('Thank you — your assessment was submitted.'));
      setSubmitted(true);
    } catch (err) {
      toast.error(err.response?.data?.error || t('Could not submit.'));
      if (err.response?.data?.alreadySubmitted) setSubmitted(true);
    } finally { setBusy(false); }
  };

  const loadResults = async () => {
    try { const { data } = await api.get(`/training/${programId}/trainer-assessment/results`); setResults(data); }
    catch (err) { toast.error(err.response?.data?.error || t('Could not load results')); }
  };

  if (!trainers) return <div className="text-sm text-gray-500 dark:text-gray-400">{t('Loading…')}</div>;

  const Scale = ({ tk, c }) => (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(v => {
        const on = ratings[tk]?.[c] === v;
        return (
          <button key={v} type="button" onClick={() => setRating(tk, c, v)}
            className={`w-7 h-7 text-xs font-bold rounded-md border transition-colors ${on
              ? 'bg-ilo-blue text-white border-ilo-blue'
              : 'bg-white dark:bg-navy-mid text-gray-600 dark:text-gray-300 border-border dark:border-navy-light hover:border-ilo-blue'}`}>{v}</button>
        );
      })}
    </div>
  );

  const ResultsPanel = () => results && (
    <div className="mt-4 rounded-xl border border-border dark:border-navy-light overflow-hidden">
      <div className="px-4 py-2 bg-ilo-blue/10 dark:bg-ilo-blue/20 text-sm font-semibold text-ilo-blue">
        {t('Results')} · {results.totalResponses} {t('responses')}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs uppercase text-gray-500 dark:text-gray-400 border-b border-border dark:border-navy-light">
            <th className="px-3 py-2">{t('Trainer')}</th><th className="px-2 py-2 text-center">n</th>
            {criteria.map(c => <th key={c} className="px-2 py-2 text-center">{t(TA_LABELS[c] || c)}</th>)}
            <th className="px-3 py-2 text-center">/100</th>
          </tr></thead>
          <tbody>
            {results.results.map((r, i) => (
              <tr key={r.key} className="border-b border-border/60 dark:border-navy-light/60">
                <td className="px-3 py-2"><span className="font-semibold text-navy dark:text-white">{i + 1}. {r.name}</span>
                  <span className="block text-xs text-gray-500">{r.topic}</span></td>
                <td className="px-2 py-2 text-center tabular-nums">{r.n}</td>
                {criteria.map(c => <td key={c} className="px-2 py-2 text-center tabular-nums">{r[c] ?? '—'}</td>)}
                <td className="px-3 py-2 text-center font-bold text-ilo-blue tabular-nums">{r.score ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {results.comments?.length > 0 && (
        <div className="p-3 text-xs text-gray-600 dark:text-gray-300 space-y-1 border-t border-border dark:border-navy-light">
          <p className="font-semibold uppercase text-gray-500">{t('Comments')}</p>
          {results.comments.map((c, i) => <p key={i}>• {c}</p>)}
        </div>
      )}
    </div>
  );

  if (submitted) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-green-500/40 bg-green-50 dark:bg-green-900/20 p-4 text-sm text-green-700 dark:text-green-300">
          ✓ {t('Thank you — your trainer assessment has been submitted.')}
        </div>
        {isStaff && (results ? <ResultsPanel /> :
          <button onClick={loadResults} className="px-4 py-2 text-sm font-semibold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark">{t('View results')}</button>)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-xs text-gray-500 dark:text-gray-400">
        {t('Rate each trainer 1–5')}: 1 = {t('Strongly disagree')} · 5 = {t('Strongly agree')}. {t('Anonymous.')}
      </div>
      <div className="space-y-3">
        {trainers.map((tr, i) => (
          <div key={tr.key} className="rounded-xl border border-border dark:border-navy-light overflow-hidden">
            <div className="px-4 py-2 bg-navy text-white flex justify-between items-baseline">
              <span className="font-bold text-sm">{i + 1}. {tr.name}</span>
              <span className="text-xs italic opacity-80">{tr.topic}</span>
            </div>
            <div className="p-3 space-y-2">
              {criteria.map(c => (
                <div key={c} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-gray-700 dark:text-gray-300">{t(TA_LABELS[c] || c)}</span>
                  <Scale tk={tr.key} c={c} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2} maxLength={2000}
        placeholder={t('Any comments / one thing a trainer could improve (optional)')}
        className="w-full px-3 py-2 text-sm rounded-xl border border-border dark:border-navy-light bg-white dark:bg-navy-mid dark:text-white" />
      <button onClick={submit} disabled={busy || !complete}
        className="px-5 py-2 text-sm font-semibold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark disabled:opacity-50">
        {busy ? '…' : t('Submit assessment')}
      </button>
      {isStaff && (results ? <ResultsPanel /> :
        <button onClick={loadResults} className="ml-2 px-4 py-2 text-sm font-semibold rounded-xl border border-border dark:border-navy-light dark:text-gray-200">{t('View results')}</button>)}
    </div>
  );
}

/* Interactive Survey Activity — a module flagged isSurvey; single/multi choice
   + free-text questions, submitted once per participant. Staff see aggregates. */
function SurveyActivity({ programId, moduleId }) {
  const { t } = useLang();
  const { user } = useAuth();
  const isStaff = ['admin', 'institution', 'assessor'].includes(user?.role);
  const [data, setData] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [ans, setAns] = useState({});
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);

  useEffect(() => {
    api.get(`/training/${programId}/survey/${moduleId}`)
      .then(({ data }) => { setData(data); setSubmitted(!!data.submitted); })
      .catch(() => setData({ questions: [] }));
  }, [programId, moduleId]);

  const setChoice = (i, v) => setAns(p => ({ ...p, [i]: { choice: v } }));
  const toggleMulti = (i, v) => setAns(p => {
    const cur = new Set(p[i]?.choices || []);
    cur.has(v) ? cur.delete(v) : cur.add(v);
    return { ...p, [i]: { choices: [...cur] } };
  });
  const setText = (i, v) => setAns(p => ({ ...p, [i]: { text: v } }));

  const submit = async () => {
    setBusy(true);
    try {
      const answers = (data.questions || []).map((q, i) => ans[i] || {});
      await api.post(`/training/${programId}/survey/${moduleId}`, { answers });
      toast.success(t('Thank you — your survey was submitted.'));
      setSubmitted(true);
    } catch (err) {
      toast.error(err.response?.data?.error || t('Could not submit.'));
      if (err.response?.data?.alreadySubmitted) setSubmitted(true);
    } finally { setBusy(false); }
  };

  const loadResults = async () => {
    try { const { data } = await api.get(`/training/${programId}/survey/${moduleId}/results`); setResults(data); }
    catch (err) { toast.error(err.response?.data?.error || t('Could not load results')); }
  };

  if (!data) return <div className="text-sm text-gray-500 dark:text-gray-400">{t('Loading…')}</div>;

  const ResultsPanel = () => results && (
    <div className="mt-4 rounded-xl border border-border dark:border-navy-light p-4 space-y-3">
      <div className="text-sm font-semibold text-ilo-blue">{t('Results')} · {results.totalResponses} {t('responses')}</div>
      {results.results.map((r, i) => (
        <div key={i} className="text-sm">
          <p className="font-medium text-navy dark:text-white">{r.prompt}</p>
          {r.text
            ? <ul className="text-xs text-gray-600 dark:text-gray-300 list-disc ml-5">{r.answers.length ? r.answers.map((a, j) => <li key={j}>{a}</li>) : <li className="list-none text-gray-400">{t('No answers')}</li>}</ul>
            : <div className="text-xs text-gray-600 dark:text-gray-300 flex flex-wrap gap-x-4">{Object.entries(r.counts).map(([o, c]) => <span key={o} className="tabular-nums">{o}: <b>{c}</b></span>)}</div>}
        </div>
      ))}
    </div>
  );

  if (submitted) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-green-500/40 bg-green-50 dark:bg-green-900/20 p-4 text-sm text-green-700 dark:text-green-300">
          ✓ {t('Thank you — your survey has been submitted.')}
        </div>
        {isStaff && (results ? <ResultsPanel /> :
          <button onClick={loadResults} className="px-4 py-2 text-sm font-semibold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark">{t('View results')}</button>)}
      </div>
    );
  }

  let lastSection = null;
  return (
    <div className="space-y-3">
      {(data.questions || []).map((q, i) => {
        const showSection = q.section && q.section !== lastSection;
        lastSection = q.section || lastSection;
        return (
          <div key={i}>
            {showSection && <p className="mt-3 mb-1 text-xs font-bold uppercase tracking-wide text-green-700 dark:text-green-400">{q.section}</p>}
            <div className="rounded-xl border border-border dark:border-navy-light p-3">
              <p className="text-sm text-gray-700 dark:text-gray-200 mb-2">{q.prompt}</p>
              {q.text ? (
                <input type="text" value={ans[i]?.text || ''} onChange={e => setText(i, e.target.value)} maxLength={2000}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-border dark:border-navy-light bg-white dark:bg-navy-mid dark:text-white" />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {q.options.map(o => {
                    const on = q.multi ? (ans[i]?.choices || []).includes(o) : ans[i]?.choice === o;
                    return (
                      <button key={o} type="button" onClick={() => q.multi ? toggleMulti(i, o) : setChoice(i, o)}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${on
                          ? 'bg-ilo-blue text-white border-ilo-blue'
                          : 'bg-white dark:bg-navy-mid text-gray-600 dark:text-gray-300 border-border dark:border-navy-light hover:border-ilo-blue'}`}>{o}</button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })}
      <button onClick={submit} disabled={busy}
        className="px-5 py-2 text-sm font-semibold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark disabled:opacity-50">
        {busy ? '…' : t('Submit survey')}
      </button>
      {isStaff && (results ? <ResultsPanel /> :
        <button onClick={loadResults} className="ml-2 px-4 py-2 text-sm font-semibold rounded-xl border border-border dark:border-navy-light dark:text-gray-200">{t('View results')}</button>)}
    </div>
  );
}

function MaterialViewer({ module, programId, workerId, done, onComplete }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);

  const markComplete = async () => {
    setBusy(true);
    try {
      await api.put(`/training/${programId}/progress`, { workerId, moduleId: module._id });
      toast.success(t('Marked complete'));
      onComplete?.();
    } catch (err) {
      toast.error(err.response?.data?.error || t('Could not update progress'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {module.description && <p className="text-sm text-gray-600 dark:text-gray-300">{module.description}</p>}

      {module.type === 'video' && module.videoUrl && (
        isDirectVideo(module.videoUrl) ? (
          <video src={module.videoUrl} controls className="w-full rounded-xl border border-border dark:border-navy-light" />
        ) : (
          <div className="relative w-full rounded-xl overflow-hidden border border-border dark:border-navy-light bg-black"
               style={{ aspectRatio: '16 / 9' }}>
            <iframe src={toEmbedUrl(module.videoUrl)} title={module.title} frameBorder="0"
              allow="autoplay; encrypted-media; fullscreen" allowFullScreen
              className="absolute inset-0 w-full h-full" />
          </div>
        )
      )}
      {module.isTrainerAssessment && <TrainerAssessment programId={programId} />}
      {!module.isTrainerAssessment && (module.type === 'reading' || module.content) && module.content && (
        <div className="prose prose-sm max-w-none dark:prose-invert text-sm text-gray-700 dark:text-gray-300
                        p-4 rounded-xl bg-gray-50 dark:bg-navy-light border border-border dark:border-navy-light">
          <RichContent content={module.content} />
        </div>
      )}
      {module.isSurvey && <SurveyActivity programId={programId} moduleId={module._id} />}
      {module.type === 'scorm' && (
        <a href={`/lms/api/v1/scorm/${module._id}/launch`} target="_blank" rel="noopener noreferrer"
          className="inline-block px-4 py-2 text-sm font-semibold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark">
          {t('Launch SCORM content')}
        </a>
      )}
      {module.attachments?.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{t('Attachments')}</p>
          {module.attachments.map((a, i) => (
            <a key={i} href={a.url} target="_blank" rel="noopener noreferrer"
              className="block text-sm text-ilo-blue hover:underline">📎 {a.name}</a>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 pt-2">
        {done ? (
          <span className="px-4 py-2 rounded-xl text-sm font-bold bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
            ✓ {t('Completed')}
          </span>
        ) : (
          <button onClick={markComplete} disabled={busy}
            className="px-5 py-2 text-sm font-semibold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark transition-colors disabled:opacity-50">
            {busy ? '…' : t('Mark as complete')}
          </button>
        )}
      </div>
    </div>
  );
}

/* ─── A single interactive exercise set: instant feedback, unlimited retries, ungraded ─── */
function PracticeExercise({ programId, set }) {
  const { t } = useLang();
  const questions = set.questions || [];
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);   // { total, correct, score, answers:[...] }
  const [busy, setBusy] = useState(false);
  const checked = !!result;

  const check = async () => {
    setBusy(true);
    try {
      const payload = questions.map((q, i) => toAnswerPayload(q.type, answers[i]));
      const { data } = await api.post(`/training/${programId}/practice/${set._id}/check`, { answers: payload });
      setResult(data);
    } catch (err) {
      toast.error(err.response?.data?.error || t('Could not check answers'));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => { setResult(null); setAnswers({}); };

  if (!questions.length) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">{t('No questions in this exercise yet.')}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="text-xs text-gray-500 dark:text-gray-400">
        {questions.length} {t('questions')} · <span className="text-ilo-blue font-semibold">{t('Practice — not graded')}</span>
      </div>
      {questions.map((q, i) => {
        const fb = result?.answers?.[i];
        return (
          <div key={i} className="space-y-2">
            <QuizRenderer question={q} index={i} answer={answers[i]}
              onChange={(v) => setAnswers(a => ({ ...a, [i]: v }))}
              disabled={checked} showResult={checked} isCorrect={fb?.isCorrect} />
            {checked && fb && (
              <div className={`text-xs rounded-lg p-3 ${fb.isCorrect
                ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'}`}>
                <span className="font-bold">{fb.isCorrect ? `✓ ${t('Correct')}` : `✗ ${t('Not quite')}`}</span>
                {!fb.isCorrect && (fb.correctOption != null || fb.correctAnswer) && (
                  <span className="ml-1 text-gray-600 dark:text-gray-300">
                    {t('Answer')}: {fb.correctOption != null ? (q.options?.[fb.correctOption] ?? fb.correctOption) : fb.correctAnswer}
                  </span>
                )}
                {fb.explanation && <p className="mt-1 text-gray-600 dark:text-gray-300">{fb.explanation}</p>}
              </div>
            )}
          </div>
        );
      })}
      {!checked ? (
        <button onClick={check} disabled={busy || Object.keys(answers).length === 0}
          className="px-6 py-2.5 text-sm font-semibold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark transition-colors disabled:opacity-50">
          {busy ? t('Checking…') : t('Check answers')}
        </button>
      ) : (
        <div className="flex items-center gap-3">
          <span className="px-4 py-2 rounded-xl text-sm font-bold bg-ilo-blue/10 text-ilo-blue dark:bg-ilo-blue/20">
            {result.correct}/{result.total} {t('correct')} · {result.score}%
          </span>
          <button onClick={reset}
            className="px-5 py-2 text-sm font-semibold bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition-colors">
            {t('Try again')}
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Exercises stage: paged — one exercise at a time, submit → review → Next ─── */
function PracticeStage({ programId, sets, workerId, meta, resultFor, onSubmitted }) {
  const { t } = useLang();
  const ordered = (sets || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  const [idx, setIdx] = useState(0);
  const [justSubmitted, setJustSubmitted] = useState({}); // setId -> true (submitted this session)
  if (!ordered.length) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">{t('No interactive exercises for this training yet.')}</p>;
  }
  const set = ordered[Math.min(idx, ordered.length - 1)];
  const stored = resultFor?.(set._id);
  const done = !!stored || !!justSubmitted[set._id];
  const isLast = idx === ordered.length - 1;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
          <span>{t('Exercise')} {idx + 1} {t('of')} {ordered.length} — <b className="dark:text-gray-200">{set.title}</b></span>
          <span className="flex gap-1">{ordered.map((s, i) => {
            const d = !!resultFor?.(s._id) || !!justSubmitted[s._id];
            return <span key={i} onClick={() => setIdx(i)} title={s.title}
              className={`w-2.5 h-2.5 rounded-full cursor-pointer ${i === idx ? 'ring-2 ring-ilo-blue' : ''} ${d ? 'bg-green-500' : 'bg-gray-300 dark:bg-navy-light'}`} />;
          })}</span>
        </div>
        <div className="h-1.5 rounded-full bg-gray-200 dark:bg-navy-mid overflow-hidden"><div className="h-full bg-ilo-blue transition-all" style={{ width: `${((idx + 1) / ordered.length) * 100}%` }} /></div>
      </div>

      {stored
        ? <ExerciseResult result={{ score: stored.score, feedback: stored.feedback, wrong: stored.wrong, response: stored.response }} title={set.title} />
        : <ExercisePlayer key={set._id} programId={programId} set={set} workerId={workerId} meta={meta}
            onSubmitted={(data) => { setJustSubmitted(m => ({ ...m, [set._id]: true })); onSubmitted?.(data); }} />}

      {/* Navigation — Next turns green once the current exercise is submitted */}
      <div className="flex items-center justify-between gap-2 pt-3 border-t border-border dark:border-navy-light">
        <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}
          className="px-4 py-2 text-sm font-semibold rounded-xl border border-border dark:border-navy-light dark:text-gray-200 disabled:opacity-40">← {t('Previous')}</button>
        {!isLast
          ? <button onClick={() => setIdx(i => i + 1)}
              className={`px-6 py-2 text-sm font-bold rounded-xl text-white transition-colors ${done ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-400 hover:bg-gray-500'}`}>
              {t('Next exercise')} →</button>
          : <span className="text-xs text-gray-400">{done ? `✓ ${t('All exercises done')}` : t('Submit to finish')}</span>}
      </div>
      {!done && !isLast && <p className="text-[11px] text-gray-400 text-right">{t('Submit this exercise to unlock the next (Next turns green).')}</p>}
    </div>
  );
}

/* ─── Material Library: uploaded, downloadable resources ─── */
function fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function fileIcon(name = '', mime = '') {
  const ext = name.split('.').pop()?.toLowerCase();
  if (mime.startsWith('video') || ['mp4', 'mov', 'webm', 'avi'].includes(ext)) return '🎬';
  if (mime.startsWith('image') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return '🖼️';
  if (mime.startsWith('audio') || ['mp3', 'm4a'].includes(ext)) return '🎧';
  if (ext === 'pdf') return '📕';
  if (['ppt', 'pptx'].includes(ext)) return '📊';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📈';
  if (['zip'].includes(ext)) return '🗜️';
  return '📄';
}
function LibraryStage({ resources }) {
  const { t } = useLang();
  const list = resources || [];
  if (!list.length) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">{t('No library resources uploaded yet.')}</p>;
  }
  // Group by category.
  const groups = list.reduce((acc, r) => {
    const k = r.category || 'general';
    (acc[k] = acc[k] || []).push(r);
    return acc;
  }, {});
  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600 dark:text-gray-300">{t('Downloadable materials for this training — handouts, slides, references and more.')}</p>
      {Object.entries(groups).map(([cat, items]) => (
        <div key={cat}>
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">{cat}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {items.map((r, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl border border-border dark:border-navy-light">
                <span className="text-2xl shrink-0">{fileIcon(r.name, r.mimetype)}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold dark:text-white truncate">{r.name}</p>
                  <p className="text-xs text-gray-400">{fmtSize(r.size)}</p>
                </div>
                <a href={r.url} target="_blank" rel="noopener noreferrer"
                  className="shrink-0 px-3 py-1.5 text-xs font-semibold bg-ilo-blue text-white rounded-lg hover:bg-ilo-dark transition-colors">
                  {t('Open')}
                </a>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── AI Coach: relay-backed feedback analysis of the learner's performance ─── */
function AICoachPanel({ programId, workerId }) {
  const { t } = useLang();
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [msg, setMsg] = useState('');

  const run = async () => {
    setLoading(true); setMsg('');
    try {
      const { data } = await api.post(`/ai/training/${programId}/feedback-analysis`, { workerId });
      setAnalysis(data.analysis);
    } catch (err) {
      setMsg(err.response?.data?.error || t('Analysis unavailable right now.'));
    } finally { setLoading(false); }
  };

  const readinessColor = {
    'on-track': 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    'needs-support': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    'at-risk': 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  };
  const Section = ({ title, items, icon }) => items?.length ? (
    <div>
      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">{icon} {title}</p>
      <ul className="list-disc list-inside space-y-1 text-sm text-gray-700 dark:text-gray-300">
        {items.map((x, i) => <li key={i}>{x}</li>)}
      </ul>
    </div>
  ) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold dark:text-white">🧠 {t('AI Learning Coach')}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">{t('Get a personalised analysis of your strengths, gaps and next steps.')}</p>
        </div>
        <button onClick={run} disabled={loading}
          className="shrink-0 px-4 py-2 text-sm font-semibold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark transition-colors disabled:opacity-50">
          {loading ? t('Analysing…') : (analysis ? t('Refresh') : t('Analyse my progress'))}
        </button>
      </div>

      {msg && <p className="text-sm text-amber-600 dark:text-amber-400">{msg}</p>}

      {analysis && (
        <div className="space-y-4 rounded-xl border border-border dark:border-navy-light p-5">
          {analysis.readiness && (
            <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold ${readinessColor[analysis.readiness] || 'bg-gray-100 text-gray-600'}`}>
              {t('Readiness')}: {analysis.readiness}
            </span>
          )}
          {analysis.summary && <p className="text-sm text-gray-700 dark:text-gray-200">{analysis.summary}</p>}
          <Section title={t('Strengths')} items={analysis.strengths} icon="💪" />
          <Section title={t('Areas to improve')} items={analysis.weaknesses} icon="📌" />
          <Section title={t('Recommendations')} items={analysis.recommendations} icon="✅" />
          <Section title={t('Focus areas')} items={analysis.focusAreas} icon="🎯" />
          <p className="text-[11px] text-gray-400">{t('AI-generated guidance — always verify with your instructor.')}</p>
        </div>
      )}
    </div>
  );
}

/* ─── Live sessions ─── */
function LiveSessions({ programId }) {
  const { t } = useLang();
  const [sessions, setSessions] = useState(null);

  useEffect(() => {
    api.get(`/training/${programId}/live`)
      .then(r => setSessions(r.data))
      .catch(() => setSessions([]));
  }, [programId]);

  const join = async (s) => {
    try {
      const { data } = await api.get(`/training/${programId}/live/${s._id}/token`);
      let url;
      if (data.mode === 'link') url = data.meetingUrl;
      else if (data.configured) url = `https://${data.domain}/${data.appId}/${data.room}?jwt=${data.token}`;
      else url = `https://meet.jit.si/${data.room}`; // fallback when JaaS not configured
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error(err.response?.data?.error || t('Could not join session'));
    }
  };

  if (sessions === null) return spinner;
  if (!sessions.length) return <p className="text-sm text-gray-500 dark:text-gray-400">{t('No live sessions scheduled yet.')}</p>;

  return (
    <div className="space-y-3">
      {sessions.map(s => {
        const when = new Date(s.scheduledFor);
        const live = s.status === 'live';
        return (
          <div key={s._id} className="flex items-center justify-between gap-4 p-4 rounded-xl border border-border dark:border-navy-light">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold dark:text-white truncate">{s.title}</p>
                {live && <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-red-500 text-white animate-pulse">LIVE</span>}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">{when.toLocaleString()} · {s.durationMins} {t('min')}</p>
              {s.recordingUrl && (
                <a href={s.recordingUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-ilo-blue hover:underline">▶ {t('Recording')}</a>
              )}
            </div>
            {s.status !== 'ended' && s.status !== 'cancelled' && (
              <button onClick={() => join(s)}
                className="shrink-0 px-4 py-2 text-sm font-semibold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark transition-colors">
                {t('Join')}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─── Designed certificate preview + download ─── */
function CertificatePanel({ programId, cert, onRefresh }) {
  const { t } = useLang();
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    setDownloading(true);
    try {
      const res = await api.get(`/training/${programId}/certificate/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url; a.download = `${cert.certificateId}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t('Could not download certificate'));
    } finally {
      setDownloading(false);
    }
  };

  if (!cert?.issued) {
    return (
      <div className="text-center py-10 space-y-3">
        <div className="text-4xl">🔒</div>
        <p className="text-sm font-semibold dark:text-white">{t('Certificate locked')}</p>
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
          {t('Complete all training materials and pass the final assessment to earn your certificate.')}
        </p>
        <button onClick={onRefresh} className="text-xs text-ilo-blue hover:underline">{t('Refresh status')}</button>
      </div>
    );
  }

  const issued = cert.issuedAt ? new Date(cert.issuedAt).toLocaleDateString() : '';
  return (
    <div className="space-y-5">
      {/* Designed certificate card (mirrors the PDF layout) */}
      <div className="relative mx-auto max-w-2xl rounded-2xl border-[3px] border-[#002D72] bg-white p-8 text-center shadow-lg">
        <div className="absolute inset-2 rounded-xl border border-[#C8952E] pointer-events-none" />
        <p className="text-xs font-bold tracking-[0.3em] text-[#C8952E]">TALENTLEDGER · PPMC KP</p>
        <h2 className="mt-3 text-2xl font-black tracking-wide text-[#002D72]">CERTIFICATE OF COMPLETION</h2>
        <p className="mt-4 text-xs text-gray-500">{t('This is to certify that')}</p>
        <p className="mt-1 text-xl font-bold text-gray-900">{cert.holderName || '—'}</p>
        <p className="mt-3 text-xs text-gray-500">{t('has successfully completed')}</p>
        <p className="mt-1 text-lg font-bold text-[#002D72] px-4">{cert.title}</p>
        <p className="mt-2 text-xs text-gray-600">
          {cert.trade && <span className="capitalize">{cert.trade}</span>}
          {cert.nqfLevel ? ` · NQF ${cert.nqfLevel}` : ''}
        </p>
        {/* Letter grades (per-domain + overall) */}
        {(cert.grades?.length > 0 || cert.overallGrade?.letter) && (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            {cert.overallGrade?.letter && (
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-[#002D72] text-white">
                {t('Overall')}: {cert.overallGrade.letter}
              </span>
            )}
            {(cert.grades || []).map((g, i) => (
              <span key={i} className="px-3 py-1 rounded-full text-xs font-semibold bg-[#C8952E]/15 text-[#8a6a1e] border border-[#C8952E]/40">
                {g.domain}: <b>{g.letter}</b>
              </span>
            ))}
          </div>
        )}
        <div className="mt-4 text-[11px] text-gray-500 text-left px-4">
          <p>{t('Credential ID')}: <span className="font-semibold text-gray-700">{cert.certificateId}</span></p>
          <p>{t('Issued')}: <span className="font-semibold text-gray-700">{issued}</span></p>
        </div>
        {/* QR to the public verification page */}
        {cert.qrDataUrl && (
          <div className="mt-4 flex flex-col items-center">
            <img src={cert.qrDataUrl} alt="Verify QR code" className="w-24 h-24 rounded bg-white p-1 border border-gray-200" />
            <p className="mt-1 text-[10px] text-gray-400">{t('Scan to verify')} · {cert.certificateId}</p>
          </div>
        )}
        {/* Signatories — signature image over a line, name, title/org */}
        <div className="mt-5 flex flex-wrap justify-around gap-6 px-2">
          {(cert.signatories?.length ? cert.signatories : [cert.signatory]).filter(Boolean).map((sg, i) => (
            <div key={i} className="text-center min-w-[150px]">
              <div className="h-12 flex items-end justify-center">
                {sg.signatureUrl
                  ? <img src={sg.signatureUrl} alt="signature" className="h-12 w-40 object-contain" />
                  : <span className="text-[11px] text-gray-300 italic pb-1">{t('signature')}</span>}
              </div>
              <div className="w-44 mx-auto border-t border-gray-400" />
              <p className="mt-1 text-sm font-bold text-[#002D72]">{sg.name || '[Signatory]'}</p>
              <p className="text-[11px] text-gray-500">{[sg.title, sg.org].filter(Boolean).join(', ') || 'Chief Master Trainer'}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-center">
        <button onClick={download} disabled={downloading}
          className="px-6 py-2.5 text-sm font-semibold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark transition-colors disabled:opacity-50">
          {downloading ? t('Preparing…') : `⬇ ${t('Download official PDF')}`}
        </button>
      </div>
    </div>
  );
}

/* ─── Step rail item ─── */
function Step({ id, label, icon, active, done, locked, onClick }) {
  return (
    <button onClick={onClick} disabled={locked}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-left transition-colors
        ${active ? 'bg-ilo-blue text-white' : locked ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-100 dark:hover:bg-navy-light dark:text-gray-200'}`}>
      <span className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs
        ${done ? 'bg-green-500 text-white' : active ? 'bg-white/20' : 'bg-gray-200 dark:bg-navy-mid'}`}>
        {done ? '✓' : icon}
      </span>
      <span className="font-semibold truncate">{label}</span>
    </button>
  );
}

/* ─── Open, editable certificate signatory (staff) ─── */
function SignatoryEditor({ training, onSaved }) {
  const { t } = useLang();
  const [name, setName] = useState(training.signatory?.name || '');
  const [title, setTitle] = useState(training.signatory?.title || 'Chief Master Trainer');
  const [saving, setSaving] = useState(false);

  // Re-sync when a different training is selected.
  useEffect(() => {
    setName(training.signatory?.name || '');
    setTitle(training.signatory?.title || 'Chief Master Trainer');
  }, [training._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/training/${training._id}`, {
        signatory: { name: name.trim(), title: title.trim() || 'Chief Master Trainer' },
      });
      toast.success(t('Signatory saved'));
      onSaved?.({ name: name.trim(), title: title.trim() || 'Chief Master Trainer' });
    } catch (err) {
      toast.error(err.response?.data?.error || t('Could not save signatory'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-border dark:border-navy-light p-5 space-y-4">
      <div>
        <h3 className="text-sm font-bold dark:text-white">{t('Certificate Signatory')}</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t('Type the name that will be printed and signed on every certificate issued for this training.')}
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{t('Signatory name')}</label>
          <input value={name} onChange={e => setName(e.target.value)} maxLength={120}
            placeholder={t('e.g. Dr. Ayesha Khan')}
            className="mt-1 w-full px-3 py-2 text-sm rounded-xl border border-border dark:border-navy-light bg-white dark:bg-navy-mid dark:text-white" />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{t('Title')}</label>
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={120}
            placeholder="Chief Master Trainer"
            className="mt-1 w-full px-3 py-2 text-sm rounded-xl border border-border dark:border-navy-light bg-white dark:bg-navy-mid dark:text-white" />
        </div>
      </div>
      {/* Live preview of the signature block */}
      <div className="flex justify-center pt-2">
        <div className="text-center">
          <div className="w-52 border-t border-gray-400 dark:border-gray-500" />
          <p className="mt-1 text-sm font-bold text-[#002D72] dark:text-blue-300">{name || t('[type a name]')}</p>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">{title || 'Chief Master Trainer'}</p>
        </div>
      </div>
      <button onClick={save} disabled={saving}
        className="px-5 py-2 text-sm font-semibold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark transition-colors disabled:opacity-50">
        {saving ? t('Saving…') : t('Save signatory')}
      </button>
    </div>
  );
}

/* ─── Staff: author interactive exercises (practice sets) for a training ─── */
function PracticeSetManager({ training, onChanged }) {
  const { t } = useLang();
  const [sets, setSets] = useState(training.practiceSets || []);
  const [newTitle, setNewTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [bulkBusy, setBulkBusy] = useState('');

  useEffect(() => { setSets(training.practiceSets || []); }, [training._id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bulk: each uploaded file becomes its own exercise (title = filename, content = its text).
  const bulkUpload = async (files) => {
    if (!files.length) return;
    const created = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setBulkBusy(`${i + 1}/${files.length}`);
      try {
        const fd = new FormData(); fd.append('file', f);
        const { data } = await api.post('/ai/extract-text', fd);
        const title = (f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 120)) || `Exercise ${i + 1}`;
        const { data: set } = await api.post(`/training/${training._id}/practice`, { title, content: data.text || '' });
        created.push(set);
      } catch (err) { toast.error(`${f.name}: ${err.response?.data?.error || t('failed')}`); }
    }
    setBulkBusy('');
    if (created.length) { setSets(s => [...s, ...created]); toast.success(`${created.length} ${t('exercises created from files')}`); onChanged?.(); }
  };

  const createSet = async () => {
    if (!newTitle.trim()) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/training/${training._id}/practice`, { title: newTitle.trim(), questions: [] });
      setSets(s => [...s, data]);
      setNewTitle('');
      toast.success(t('Exercise set created'));
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.error || t('Could not create set'));
    } finally { setBusy(false); }
  };

  const deleteSet = async (setId) => {
    setBusy(true);
    try {
      await api.delete(`/training/${training._id}/practice/${setId}`);
      setSets(s => s.filter(x => x._id !== setId));
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.error || t('Could not delete set'));
    } finally { setBusy(false); }
  };

  const saveExercise = async (setId, patch) => {
    setBusy(true);
    try {
      await api.put(`/training/${training._id}/practice/${setId}`, patch);
      setSets(s => s.map(x => x._id === setId ? { ...x, ...patch } : x));
      toast.success(t('Exercise saved'));
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.error || t('Could not save'));
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl border border-border dark:border-navy-light p-5 space-y-4">
      <div>
        <h3 className="text-sm font-bold dark:text-white">{t('Interactive Exercises')}</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t('Upload (or type) the exercise. Trainees read it, write their reply in a box and submit — the AI scores it and comments on what\'s wrong. Single attempt.')}
        </p>
      </div>

      {/* Bulk upload — each file becomes its own exercise */}
      <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-ilo-blue/5 dark:bg-ilo-blue/10 border border-ilo-blue/30">
        <label className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-xl cursor-pointer transition-colors ${bulkBusy ? 'bg-gray-300 dark:bg-navy-light text-gray-500' : 'bg-ilo-blue text-white hover:bg-ilo-dark'}`}>
          📎 {bulkBusy ? `${t('Uploading')} ${bulkBusy}…` : t('Bulk-upload exercise files')}
          <input type="file" multiple disabled={!!bulkBusy} className="hidden" onChange={e => { bulkUpload(Array.from(e.target.files)); e.target.value = ''; }} />
        </label>
        <span className="text-xs text-gray-500 dark:text-gray-400">{t('Select many files — each becomes its own exercise (edit them below).')}</span>
      </div>

      {sets.map(set => (
        <SetEditor key={set._id} set={set} busy={busy} programId={training._id}
          onSave={(patch) => saveExercise(set._id, patch)} onDelete={() => deleteSet(set._id)} />
      ))}

      <div className="flex items-center gap-2 pt-2 border-t border-border dark:border-navy-light">
        <input value={newTitle} onChange={e => setNewTitle(e.target.value)} maxLength={200}
          placeholder={t('New exercise title')}
          className="flex-1 px-3 py-2 text-sm rounded-xl border border-border dark:border-navy-light bg-white dark:bg-navy-mid dark:text-white" />
        <button onClick={createSet} disabled={busy || !newTitle.trim()}
          className="px-4 py-2 text-sm font-semibold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark transition-colors disabled:opacity-50">
          {t('Add set')}
        </button>
      </div>
    </div>
  );
}

/* One exercise: upload/type the exercise + optional grading guidance, then save. */
function SetEditor({ set, busy, programId, onSave, onDelete }) {
  const { t } = useLang();
  const [content, setContent] = useState(set.content || set.description || '');
  const [criteria, setCriteria] = useState(set.scoringCriteria || '');
  const [uploading, setUploading] = useState(false);
  useEffect(() => { setContent(set.content || set.description || ''); setCriteria(set.scoringCriteria || ''); }, [set._id]); // eslint-disable-line react-hooks/exhaustive-deps
  const inp = 'w-full px-3 py-2 text-sm rounded-lg border border-border dark:border-navy-light bg-white dark:bg-navy-mid dark:text-white';

  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData(); fd.append('file', file);
      const { data } = await api.post('/ai/extract-text', fd);
      if (!data.text?.trim()) return toast.error(t('No readable text found in that file'));
      setContent(c => c.trim() ? `${c}\n\n${data.text}` : data.text);
      toast.success(t('Exercise loaded from file'));
    } catch (err) { toast.error(err.response?.data?.error || t('Could not read the file')); }
    finally { setUploading(false); }
  };

  return (
    <div className="rounded-xl border border-border dark:border-navy-light p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold dark:text-white">{set.title}</p>
        <button onClick={onDelete} disabled={busy} className="text-xs text-red-500 hover:underline">{t('Delete exercise')}</button>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('Exercise content (shown to trainees)')}</label>
        <div className="flex flex-wrap items-center gap-2">
          <label className={`inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold rounded-xl cursor-pointer transition-colors ${uploading ? 'bg-gray-200 dark:bg-navy-light text-gray-400' : 'bg-ilo-blue/10 text-ilo-blue hover:bg-ilo-blue/20'}`}>
            📎 {uploading ? t('Reading file…') : t('Upload a file (PDF/DOCX/TXT)')}
            <input type="file" onChange={e => { upload(e.target.files[0]); e.target.value = ''; }} disabled={uploading} className="hidden" />
          </label>
          <span className="text-xs text-gray-400">{t('or type it below')}</span>
        </div>
        <textarea value={content} onChange={e => setContent(e.target.value)} rows={5}
          placeholder={t('Upload a file, or type the exercise / instructions the trainee must respond to…')} className={inp} />
        {content.trim() && (
          <div className="rounded-lg border border-border dark:border-navy-light overflow-hidden">
            <p className="text-[10px] uppercase text-gray-400 bg-gray-50 dark:bg-navy-light px-2 py-1">{t('Preview (what trainees see)')}</p>
            <div className="p-3 max-h-52 overflow-y-auto bg-white dark:bg-navy-mid text-gray-700 dark:text-gray-200"><RichContent content={content} /></div>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('Grading guidance (optional)')}</label>
        <textarea value={criteria} onChange={e => setCriteria(e.target.value)} rows={2}
          placeholder={t('What a good reply must include — the AI grades against this (leave blank for general grading).')} className={inp} />
      </div>

      <button onClick={() => onSave({ content: content.trim(), scoringCriteria: criteria.trim(), questions: [] })} disabled={busy || uploading}
        className="w-full sm:w-auto px-6 py-2.5 text-sm font-bold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark transition-colors disabled:opacity-50">
        {busy ? t('Saving…') : `✓ ${t('Save exercise')}`}
      </button>
      <p className="text-[11px] text-gray-400">{t('After saving, trainees see this exercise, write a reply, and get an instant AI score with comments.')}</p>
    </div>
  );
}

/* ─── Staff: Material Library manager (upload / delete resources) ─── */
function ResourceManager({ training, onChanged }) {
  const { t } = useLang();
  const [resources, setResources] = useState(training.resources || []);
  const [files, setFiles] = useState([]);
  const [category, setCategory] = useState('handout');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setResources(training.resources || []); }, [training._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async () => {
    if (!files.length) return;
    setBusy(true);
    try {
      const fd = new FormData();
      files.forEach(f => fd.append('files', f));
      fd.append('category', category);
      const { data } = await api.post(`/training/${training._id}/resources`, fd);
      setResources(r => [...r, ...data]);
      setFiles([]);
      toast.success(t('Uploaded'));
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.error || t('Upload failed'));
    } finally { setBusy(false); }
  };

  const remove = async (rid) => {
    setBusy(true);
    try {
      await api.delete(`/training/${training._id}/resources/${rid}`);
      setResources(r => r.filter(x => x._id !== rid));
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.error || t('Could not delete'));
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl border border-border dark:border-navy-light p-5 space-y-4">
      <div>
        <h3 className="text-sm font-bold dark:text-white">{t('Material Library')}</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">{t('Upload handouts, slides, references and media learners can download.')}</p>
      </div>

      {resources.map(r => (
        <div key={r._id} className="flex items-center gap-3 text-sm bg-gray-50 dark:bg-navy-light rounded-lg p-2">
          <span className="text-xl">{fileIcon(r.name, r.mimetype)}</span>
          <span className="flex-1 min-w-0 truncate dark:text-gray-200">{r.name}
            <span className="text-xs text-gray-400"> · {r.category} · {fmtSize(r.size)}</span></span>
          <button onClick={() => remove(r._id)} disabled={busy} className="text-red-400 hover:text-red-600">✕</button>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border dark:border-navy-light">
        <select value={category} onChange={e => setCategory(e.target.value)}
          className="px-3 py-2 text-sm rounded-xl border border-border dark:border-navy-light bg-white dark:bg-navy-mid dark:text-white">
          {['handout', 'slides', 'reference', 'template', 'video', 'general'].map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input type="file" multiple onChange={e => setFiles(Array.from(e.target.files))}
          className="text-sm text-gray-600 dark:text-gray-300 flex-1 min-w-[180px]" />
        <button onClick={upload} disabled={busy || !files.length}
          className="px-4 py-2 text-sm font-semibold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark transition-colors disabled:opacity-50">
          {busy ? t('Uploading…') : t('Upload')}
        </button>
      </div>
    </div>
  );
}

/* ─── Staff: Question Bank manager (pool questions, assemble into an exam) ─── */
function QuestionBankManager({ training, onChanged }) {
  const { t } = useLang();
  const [bank, setBank] = useState(training.questionBank || []);
  const blank = { question: '', type: 'mcq', options: ['', '', '', ''], correctOption: 0, difficulty: 'medium', competencyTag: '', explanation: '' };
  const [draft, setDraft] = useState(blank);
  const [busy, setBusy] = useState(false);
  const quizModules = (training.modules || []).filter(m => m.type === 'quiz');
  const [targetModule, setTargetModule] = useState(quizModules[0]?._id || '');
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState('');

  useEffect(() => {
    setBank(training.questionBank || []);
    setTargetModule((training.modules || []).find(m => m.type === 'quiz')?._id || '');
  }, [training._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const addQuestion = async () => {
    if (!draft.question.trim() || draft.options.some(o => !o.trim())) return;
    setBusy(true);
    try {
      const q = { ...draft, options: draft.options.map(o => o.trim()), competencyTag: draft.competencyTag.trim() || undefined };
      const { data } = await api.post(`/training/${training._id}/question-bank`, { questions: [q] });
      setBank(data);
      setDraft(blank);
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.error || t('Could not add question'));
    } finally { setBusy(false); }
  };

  const remove = async (qid) => {
    setBusy(true);
    try {
      await api.delete(`/training/${training._id}/question-bank/${qid}`);
      setBank(b => b.filter(x => x._id !== qid));
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.error || t('Could not delete'));
    } finally { setBusy(false); }
  };

  const assemble = async () => {
    if (!targetModule) return toast.error(t('Create a quiz module first'));
    setBusy(true);
    try {
      const { data } = await api.post(`/training/${training._id}/modules/${targetModule}/assemble`,
        { count: Number(count), difficulty: difficulty || undefined });
      toast.success(`${t('Assembled')} ${data.assembled} ${t('questions')}`);
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.error || t('Assembly failed'));
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl border border-border dark:border-navy-light p-5 space-y-4">
      <div>
        <h3 className="text-sm font-bold dark:text-white">{t('Question Bank')}</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">{t('Pool reusable questions, then randomly assemble them into a quiz module.')}</p>
      </div>

      {/* Upload a file + instruction → AI drafts bank questions */}
      <AIGenPanel programId={training._id} onGenerated={async (qs) => {
        try { const { data } = await api.post(`/training/${training._id}/question-bank`, { questions: qs }); setBank(data); onChanged?.(); }
        catch (err) { toast.error(err.response?.data?.error || t('Could not add')); }
      }} />

      <div className="max-h-52 overflow-y-auto space-y-1">
        {bank.map(q => (
          <div key={q._id} className="flex items-start justify-between gap-2 text-xs bg-gray-50 dark:bg-navy-light rounded-lg p-2">
            <span className="dark:text-gray-200">{q.question}
              <span className="text-gray-400"> — {q.difficulty}{q.competencyTag ? ` · ${q.competencyTag}` : ''}</span></span>
            <button onClick={() => remove(q._id)} disabled={busy} className="text-red-400 hover:text-red-600 shrink-0">✕</button>
          </div>
        ))}
        {!bank.length && <p className="text-xs text-gray-400">{t('No questions in the bank yet.')}</p>}
      </div>

      {/* Composer */}
      <div className="space-y-2 rounded-lg border border-dashed border-border dark:border-navy-light p-3">
        <input value={draft.question} onChange={e => setDraft(d => ({ ...d, question: e.target.value }))}
          placeholder={t('Question')}
          className="w-full px-2 py-1.5 text-sm rounded-lg border border-border dark:border-navy-light bg-white dark:bg-navy-mid dark:text-white" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {draft.options.map((o, i) => (
            <label key={i} className="flex items-center gap-2">
              <input type="radio" name="bank-correct" checked={draft.correctOption === i}
                onChange={() => setDraft(d => ({ ...d, correctOption: i }))} />
              <input value={o} onChange={e => setDraft(d => ({ ...d, options: d.options.map((x, j) => j === i ? e.target.value : x) }))}
                placeholder={`${t('Option')} ${i + 1}`}
                className="flex-1 px-2 py-1 text-sm rounded-lg border border-border dark:border-navy-light bg-white dark:bg-navy-mid dark:text-white" />
            </label>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <select value={draft.difficulty} onChange={e => setDraft(d => ({ ...d, difficulty: e.target.value }))}
            className="px-2 py-1.5 text-sm rounded-lg border border-border dark:border-navy-light bg-white dark:bg-navy-mid dark:text-white">
            {['easy', 'medium', 'hard'].map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <input value={draft.competencyTag} onChange={e => setDraft(d => ({ ...d, competencyTag: e.target.value }))}
            placeholder={t('Competency tag (optional)')}
            className="flex-1 min-w-[140px] px-2 py-1.5 text-sm rounded-lg border border-border dark:border-navy-light bg-white dark:bg-navy-mid dark:text-white" />
        </div>
        <input value={draft.explanation} onChange={e => setDraft(d => ({ ...d, explanation: e.target.value }))}
          placeholder={t('Explanation (optional)')}
          className="w-full px-2 py-1.5 text-sm rounded-lg border border-border dark:border-navy-light bg-white dark:bg-navy-mid dark:text-white" />
        <button onClick={addQuestion} disabled={busy}
          className="px-3 py-1.5 text-xs font-semibold bg-gray-200 dark:bg-navy-mid dark:text-white rounded-lg hover:bg-gray-300">
          + {t('Add to bank')}
        </button>
      </div>

      {/* Assemble */}
      <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-border dark:border-navy-light">
        <div>
          <label className="block text-[11px] text-gray-500 dark:text-gray-400 uppercase">{t('Into quiz module')}</label>
          <select value={targetModule} onChange={e => setTargetModule(e.target.value)}
            className="px-2 py-1.5 text-sm rounded-lg border border-border dark:border-navy-light bg-white dark:bg-navy-mid dark:text-white">
            {quizModules.length ? quizModules.map(m => <option key={m._id} value={m._id}>{m.title}</option>)
              : <option value="">{t('No quiz modules')}</option>}
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-gray-500 dark:text-gray-400 uppercase">{t('Count')}</label>
          <input type="number" min={1} max={100} value={count} onChange={e => setCount(e.target.value)}
            className="w-20 px-2 py-1.5 text-sm rounded-lg border border-border dark:border-navy-light bg-white dark:bg-navy-mid dark:text-white" />
        </div>
        <div>
          <label className="block text-[11px] text-gray-500 dark:text-gray-400 uppercase">{t('Difficulty')}</label>
          <select value={difficulty} onChange={e => setDifficulty(e.target.value)}
            className="px-2 py-1.5 text-sm rounded-lg border border-border dark:border-navy-light bg-white dark:bg-navy-mid dark:text-white">
            <option value="">{t('any')}</option>
            {['easy', 'medium', 'hard'].map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <button onClick={assemble} disabled={busy || !quizModules.length}
          className="px-4 py-2 text-sm font-semibold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark transition-colors disabled:opacity-50">
          {t('Assemble exam')}
        </button>
      </div>
      <p className="text-[11px] text-gray-400">{t('Assembling replaces the target module’s questions with a fresh random draw from the bank.')}</p>
    </div>
  );
}

/* ─── Staff view: pick a training, set its certificate signatory ─── */
/* ─── Response Analysis: a respondent writes → AI scores absolute + relative (%) ─── */
function ResponseAnalysis({ training }) {
  const { t } = useLang();
  const gradable = (training.modules || []).filter(m => (m.rubricTemplate || []).length > 0);
  const [moduleId, setModuleId] = useState('');
  const [question, setQuestion] = useState('');
  const [response, setResponse] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const input = 'w-full px-3 py-2 text-sm rounded-xl border border-border dark:border-navy-light bg-white dark:bg-navy-mid dark:text-white';

  const analyze = async () => {
    if (!response.trim()) return toast.error(t('Enter a response to analyze'));
    setBusy(true); setMsg(''); setRes(null);
    try {
      const rubric = gradable.find(m => m._id === moduleId)?.rubricTemplate || [];
      const { data } = await api.post(`/ai/training/${training._id}/analyze-response`, { question, response, rubric });
      setRes(data);
    } catch (err) { setMsg(err.response?.data?.error || t('Analysis unavailable right now.')); }
    finally { setBusy(false); }
  };

  const ring = (pct, label, sub) => (
    <div className="flex flex-col items-center">
      <div className="relative w-24 h-24">
        <svg viewBox="0 0 36 36" className="w-24 h-24 -rotate-90">
          <circle cx="18" cy="18" r="16" fill="none" className="stroke-gray-200 dark:stroke-navy-light" strokeWidth="3" />
          <circle cx="18" cy="18" r="16" fill="none" className="stroke-ilo-blue" strokeWidth="3"
            strokeDasharray={`${(pct / 100) * 100.5} 100.5`} strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-lg font-black dark:text-white">{pct}%</div>
      </div>
      <p className="text-xs font-semibold mt-1 dark:text-gray-200">{label}</p>
      {sub && <p className="text-[11px] text-gray-400">{sub}</p>}
    </div>
  );

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">{t('Paste a participant\'s written answer. The AI scores it and shows an absolute score plus how it ranks against the cohort.')}</p>
      {gradable.length > 0 && (
        <select value={moduleId} onChange={e => setModuleId(e.target.value)} className={input}>
          <option value="">{t('No rubric (general grading)')}</option>
          {gradable.map(m => <option key={m._id} value={m._id}>{t('Use rubric from')}: {m.title}</option>)}
        </select>
      )}
      <input value={question} onChange={e => setQuestion(e.target.value)} placeholder={t('Question / prompt (optional)')} className={input} />
      <textarea value={response} onChange={e => setResponse(e.target.value)} rows={5} placeholder={t('The respondent writes their answer here…')} className={input} />
      <button onClick={analyze} disabled={busy}
        className="px-5 py-2 text-sm font-semibold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark transition-colors disabled:opacity-50">
        {busy ? t('Analyzing…') : t('Analyze response')}
      </button>
      {msg && <p className="text-sm text-amber-600 dark:text-amber-400">{msg}</p>}
      {res && (
        <div className="space-y-4 rounded-xl border border-border dark:border-navy-light p-4">
          <div className="flex flex-wrap justify-center gap-8">
            {ring(res.absolute, t('Absolute score'), t('quality of the answer'))}
            {res.relative
              ? ring(res.relative.percentile, t('Relative score'), `${t('percentile')} · ${t('cohort avg')} ${res.relative.cohortAvg}% (${res.relative.delta >= 0 ? '+' : ''}${res.relative.delta})`)
              : <div className="flex flex-col items-center justify-center text-center max-w-[10rem]"><p className="text-xs text-gray-400">{t('Relative score needs at least 2 graded participants for a cohort comparison.')}</p></div>}
          </div>
          {res.perCriterion?.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{t('Per criterion')}</p>
              {res.perCriterion.map((c, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 dark:text-gray-200 truncate">{c.criterion}</span>
                  <div className="w-32 h-2 rounded-full bg-gray-200 dark:bg-navy-light overflow-hidden"><div className="h-full bg-ilo-blue" style={{ width: `${c.score}%` }} /></div>
                  <span className="w-10 text-right text-xs font-semibold dark:text-gray-300">{c.score}%</span>
                </div>
              ))}
            </div>
          )}
          {res.feedback && <p className="text-sm text-gray-700 dark:text-gray-200">{res.feedback}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            {res.strengths?.length > 0 && <div><p className="text-xs font-semibold text-green-600 dark:text-green-400 uppercase mb-1">💪 {t('Strengths')}</p><ul className="list-disc list-inside text-gray-700 dark:text-gray-300 space-y-0.5">{res.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
            {res.gaps?.length > 0 && <div><p className="text-xs font-semibold text-red-500 uppercase mb-1">📌 {t('Gaps')}</p><ul className="list-disc list-inside text-gray-700 dark:text-gray-300 space-y-0.5">{res.gaps.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Collapsible section (children mount only when open → keeps the page light) ─── */
function Section({ title, subtitle, icon, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-border dark:border-navy-light overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-navy-light/50 transition-colors">
        <div>
          <p className="text-sm font-bold dark:text-white">{icon} {title}</p>
          {subtitle && <p className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>}
        </div>
        <span className="text-gray-400 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="px-4 pb-4 pt-1">{children}</div>}
    </div>
  );
}

const TRADES = ['mason', 'electrician', 'welder', 'plumber', 'carpenter', 'steel-fixer', 'painter', 'hvac',
  'pipe-fitter', 'scaffolder', 'rigger', 'crane-operator', 'heavy-driver', 'shuttering-carpenter', 'tile-fixer',
  'duct-fabricator', 'auto-mechanic', 'diesel-mechanic', 'fabricator'];

/* ─── Create a new training ─── */
function CreateTrainingForm({ onCreated }) {
  const { t } = useLang();
  const [f, setF] = useState({ title: '', trade: 'electrician', customTrade: '', nqfLevel: 2, duration: '', cmt: '' });
  const [busy, setBusy] = useState(false);
  const isOther = f.trade === '__other__';
  const create = async () => {
    if (!f.title.trim()) return toast.error(t('Title is required'));
    const trade = isOther ? f.customTrade.trim() : f.trade;
    if (!trade) return toast.error(t('Enter the trade / skill'));
    setBusy(true);
    try {
      const { data } = await api.post('/training', {
        title: f.title.trim(), trade, nqfLevel: Number(f.nqfLevel), duration: f.duration.trim(),
        signatory: f.cmt.trim() ? { name: f.cmt.trim(), title: 'Chief Master Trainer' } : undefined,
      });
      toast.success(t('Training created'));
      setF({ title: '', trade: 'electrician', customTrade: '', nqfLevel: 2, duration: '', cmt: '' });
      onCreated?.(data);
    } catch (err) {
      toast.error(err.response?.data?.error || t('Could not create training'));
    } finally { setBusy(false); }
  };
  const input = 'w-full px-3 py-2 text-sm rounded-xl border border-border dark:border-navy-light bg-white dark:bg-navy-mid dark:text-white';
  return (
    <div className="space-y-3">
      <input value={f.title} onChange={e => setF(s => ({ ...s, title: e.target.value }))} placeholder={t('Training title')} className={input} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <select value={f.trade} onChange={e => setF(s => ({ ...s, trade: e.target.value }))} className={input}>
          <option value="__other__">{t('Other (specify)…')}</option>
          {TRADES.map(tr => <option key={tr} value={tr}>{tr}</option>)}
        </select>
        <select value={f.nqfLevel} onChange={e => setF(s => ({ ...s, nqfLevel: e.target.value }))} className={input}>
          {[1, 2, 3, 4, 5, 6, 7, 8].map(n => <option key={n} value={n}>NQF {n}</option>)}
        </select>
        <input value={f.duration} onChange={e => setF(s => ({ ...s, duration: e.target.value }))} placeholder={t('Duration e.g. 12 Weeks')} className={input} />
      </div>
      {isOther && (
        <input value={f.customTrade} onChange={e => setF(s => ({ ...s, customTrade: e.target.value }))}
          placeholder={t('Enter trade / skill (e.g. Solar Technician, Green Skills)')} className={input} autoFocus />
      )}
      <input value={f.cmt} onChange={e => setF(s => ({ ...s, cmt: e.target.value }))} placeholder={t('Chief Master Trainer name')} className={input} />
      <button onClick={create} disabled={busy}
        className="px-5 py-2 text-sm font-semibold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark transition-colors disabled:opacity-50">
        {busy ? t('Creating…') : t('Create training')}
      </button>
    </div>
  );
}

/* ─── Associated trainers (co-facilitators) + duration ─── */
function TrainersEditor({ training, onSaved }) {
  const { t } = useLang();
  const [rows, setRows] = useState(training.associatedTrainers || []);
  const [duration, setDuration] = useState(training.duration || '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setRows(training.associatedTrainers || []); setDuration(training.duration || ''); }, [training._id]); // eslint-disable-line react-hooks/exhaustive-deps
  const input = 'px-2 py-1.5 text-sm rounded-lg border border-border dark:border-navy-light bg-white dark:bg-navy-mid dark:text-white';
  const save = async () => {
    setBusy(true);
    try {
      const associatedTrainers = rows.filter(r => (r.name || '').trim());
      await api.put(`/training/${training._id}`, { associatedTrainers, duration: duration.trim() });
      toast.success(t('Saved'));
      onSaved?.();
    } catch (err) { toast.error(err.response?.data?.error || t('Could not save')); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{t('Duration')}</label>
        <input value={duration} onChange={e => setDuration(e.target.value)} placeholder={t('e.g. 12 Weeks')} className={`mt-1 w-full ${input}`} />
      </div>
      <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{t('Associated trainers')}</label>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <input value={r.name || ''} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} placeholder={t('Name')} className={`flex-1 ${input}`} />
          <input value={r.role || ''} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, role: e.target.value } : x))} placeholder={t('Role')} className={`w-32 ${input}`} />
          <button onClick={() => setRows(rs => rs.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600">✕</button>
        </div>
      ))}
      <button onClick={() => setRows(rs => [...rs, { name: '', role: 'Trainer' }])} className="text-xs text-ilo-blue hover:underline">+ {t('Add trainer')}</button>
      <div><button onClick={save} disabled={busy}
        className="px-4 py-2 text-sm font-semibold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark transition-colors disabled:opacity-50">
        {busy ? t('Saving…') : t('Save details')}</button></div>
    </div>
  );
}

/* ─── Editable question card — AI drafts, trainer edits; change type, mark correct, set word limit ─── */
function EditableQuestion({ q, index, onChange, onRemove }) {
  const { t } = useLang();
  const written = q.type === 'essay' || q.type === 'short-answer';
  const opts = q.options && q.options.length ? q.options : ['', '', '', ''];
  const inp = 'w-full px-2 py-1.5 text-sm rounded-lg border border-border dark:border-navy-light bg-white dark:bg-navy-mid dark:text-white';
  const changeType = (nt) => {
    const patch = { ...q, type: nt };
    if (nt === 'mcq') { patch.options = q.options?.length ? q.options : ['', '', '', '']; patch.correctOption = q.correctOption ?? 0; }
    if (nt === 'true-false') patch.correctAnswer = q.correctAnswer || 'true';
    onChange(patch);
  };
  return (
    <div className="rounded-lg border border-border dark:border-navy-light bg-white dark:bg-navy-mid p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-bold text-ilo-blue mt-2">{index + 1}.</span>
        <input value={q.question || ''} onChange={e => onChange({ ...q, question: e.target.value })} placeholder={t('Question / prompt')} className={`flex-1 ${inp}`} />
        <select value={written ? 'essay' : q.type || 'mcq'} onChange={e => changeType(e.target.value)} className="px-1.5 py-1.5 text-xs rounded-lg border border-border dark:border-navy-light bg-white dark:bg-navy-mid dark:text-white shrink-0" title={t('Question type')}>
          <option value="mcq">{t('Multiple choice')}</option>
          <option value="true-false">{t('True / False')}</option>
          <option value="essay">{t('Written box')}</option>
        </select>
        <button onClick={onRemove} className="text-red-400 hover:text-red-600 mt-1.5 shrink-0">✕</button>
      </div>

      {q.type === 'mcq' && (
        <div className="pl-5 space-y-1.5">
          <p className="text-[10px] uppercase text-gray-400">{t('Answer options')} — {t('click the circle to mark the correct one')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {opts.map((o, oi) => (
              <label key={oi} className={`flex items-center gap-2 rounded-lg px-1 ${q.correctOption === oi ? 'ring-1 ring-green-500' : ''}`} title={t('Click to mark correct')}>
                <input type="radio" checked={q.correctOption === oi} onChange={() => onChange({ ...q, options: opts, correctOption: oi })} />
                <input value={o} onChange={e => onChange({ ...q, options: opts.map((x, j) => j === oi ? e.target.value : x) })} placeholder={`${t('Option')} ${oi + 1}`} className={`flex-1 px-2 py-1 text-sm rounded-lg border border-border dark:border-navy-light bg-white dark:bg-navy-mid dark:text-white ${q.correctOption === oi ? 'text-green-600 dark:text-green-400 font-semibold' : ''}`} />
              </label>
            ))}
          </div>
        </div>
      )}
      {q.type === 'true-false' && (
        <div className="pl-5 flex items-center gap-4 text-sm">
          <span className="text-[10px] uppercase text-gray-400">{t('Correct')}:</span>
          {['true', 'false'].map(v => (
            <label key={v} className="flex items-center gap-1.5"><input type="radio" checked={(q.correctAnswer || 'true') === v} onChange={() => onChange({ ...q, correctAnswer: v })} /><span className="capitalize dark:text-gray-200">{t(v)}</span></label>
          ))}
        </div>
      )}
      {written && (
        <div className="pl-5 space-y-1.5">
          <textarea value={q.modelAnswer || q.scoringCriteria || ''} onChange={e => onChange({ ...q, modelAnswer: e.target.value })} rows={2} placeholder={t('Model answer / marking criteria (the AI grades the written answer against this)')} className={inp} />
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase text-gray-400 shrink-0">✍ {t('Word limit')}</span>
            <input type="number" min={0} max={5000} value={q.wordLimit || ''} onChange={e => onChange({ ...q, wordLimit: e.target.value ? Number(e.target.value) : undefined })} placeholder="e.g. 200" className="w-28 px-2 py-1 text-sm rounded-lg border border-border dark:border-navy-light bg-white dark:bg-navy-mid dark:text-white" />
            <span className="text-[11px] text-gray-400">{t('words (shown to the trainee)')}</span>
          </div>
        </div>
      )}

      {/* Metadata — clearly separated from the answer */}
      <div className="pl-5 pt-2 mt-1 border-t border-border/60 dark:border-navy-light/60 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase text-gray-400 w-24 shrink-0">🏷 {t('Domain tag')}</span>
          <input value={q.competencyTag || ''} onChange={e => onChange({ ...q, competencyTag: e.target.value })} placeholder={t('e.g. Greening (drives certificate grades)')} className={inp} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase text-gray-400 w-24 shrink-0">💬 {t('Explanation')}</span>
          <input value={q.explanation || ''} onChange={e => onChange({ ...q, explanation: e.target.value })} placeholder={t('Shown to the trainee after answering (optional)')} className={inp} />
        </div>
      </div>
    </div>
  );
}

/* ─── AI generator: upload a file + instruction ("make MCQs from the file") → relay ─── */
function AIGenPanel({ programId, onGenerated, defaultType = 'mcq' }) {
  const { t } = useLang();
  const [files, setFiles] = useState([]);
  const [instruction, setInstruction] = useState('');
  const [count, setCount] = useState(5);
  const [type, setType] = useState(defaultType);
  const [busy, setBusy] = useState(false);
  const input = 'px-2 py-1.5 text-sm rounded-lg border border-border dark:border-navy-light bg-white dark:bg-navy-mid dark:text-white';
  const gen = async () => {
    if (!files.length && !instruction.trim()) return toast.error(t('Add an instruction or upload file(s)'));
    setBusy(true);
    try {
      const fd = new FormData();
      files.forEach(f => fd.append('files', f));
      fd.append('instruction', instruction);
      fd.append('count', String(count));
      fd.append('type', type);
      const { data } = await api.post(`/ai/training/${programId}/generate-questions`, fd);
      if (!data.questions?.length) return toast.error(t('No questions generated — refine the instruction'));
      toast.success(`${t('Generated')} ${data.questions.length} ${t('questions')}`);
      onGenerated?.(data.questions);
      setFiles([]); setInstruction('');
    } catch (err) { toast.error(err.response?.data?.error || t('Generation failed')); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-2 rounded-lg border border-ilo-blue/40 bg-ilo-blue/5 dark:bg-ilo-blue/10 p-3">
      <p className="text-xs font-bold text-ilo-blue">✨ {t('Generate with AI')}</p>
      <textarea value={instruction} onChange={e => setInstruction(e.target.value)} rows={2}
        placeholder={t('Instruction, e.g. "Make MCQs from the uploaded file about electrical safety"')} className={`w-full ${input}`} />
      <div className="flex flex-wrap items-center gap-2">
        <input type="file" multiple onChange={e => setFiles(Array.from(e.target.files))} className="text-xs text-gray-600 dark:text-gray-300 flex-1 min-w-[160px]" />
        <select value={type} onChange={e => setType(e.target.value)} className={input}>
          <option value="mcq">MCQ</option>
          <option value="true-false">{t('True/False')}</option>
          <option value="short-answer">{t('Short answer')}</option>
          <option value="answer-box">{t('Answer box (written)')}</option>
        </select>
        <input type="number" min={1} max={40} value={count} onChange={e => setCount(e.target.value)} className={`w-16 ${input}`} title={t('How many')} />
        <button onClick={gen} disabled={busy}
          className="px-4 py-2 text-sm font-semibold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark transition-colors disabled:opacity-50">
          {busy ? t('Generating…') : t('Generate')}
        </button>
      </div>
      {files.length > 0 && <p className="text-[11px] text-ilo-blue">{files.length} {t('file(s) selected')}: {files.map(f => f.name).join(', ').slice(0, 100)}</p>}
      <p className="text-[11px] text-gray-400">{t('Tip: your instruction controls it — e.g. "extract the existing questions from the file", or "make ONE written question, 200-word answer". Every draft is editable below.')}</p>
    </div>
  );
}

/* ─── Author assessments (pre/post), quizzes and case studies ─── */
function ModuleAuthor({ training, onChanged }) {
  const { t } = useLang();
  const assessable = (training.modules || []).filter(m => m.type === 'quiz' || m.type === 'scenario');
  const KIND_TITLE = { prepost: 'Pre/Post Assessment', quiz: 'Quiz', case: 'Case Study', pre: 'Pre-Assessment', final: 'Final Assessment' };
  const blankQ = () => ({ question: '', type: 'mcq', options: ['', '', '', ''], correctOption: 0, explanation: '', competencyTag: '' });
  const [title, setTitle] = useState(KIND_TITLE.prepost);
  const [kind, setKind] = useState('prepost');   // prepost | quiz | case | pre | final
  const [narrative, setNarrative] = useState('');
  const [questions, setQuestions] = useState([]);
  const [busy, setBusy] = useState(false);
  const input = 'w-full px-2 py-1.5 text-sm rounded-lg border border-border dark:border-navy-light bg-white dark:bg-navy-mid dark:text-white';

  const changeKind = (k) => {
    // Auto-fill a sensible title unless the trainer typed their own.
    if (!title.trim() || Object.values(KIND_TITLE).includes(title)) setTitle(KIND_TITLE[k] || 'Assessment');
    setKind(k);
  };
  const create = async () => {
    if (!questions.length) return toast.error(t('Generate or add at least one question first'));
    if (questions.some(q => !(q.question || '').trim())) return toast.error(t('Every question needs text'));
    setBusy(true);
    try {
      const body = {
        title: (title.trim() || KIND_TITLE[kind] || 'Assessment'),
        type: kind === 'case' ? 'scenario' : 'quiz',
        description: kind === 'case' ? narrative.trim() : undefined,
        content: kind === 'case' ? narrative.trim() : undefined,
        isPrePost: kind === 'prepost',
        isPreAssessment: kind === 'pre',
        isFinalAssessment: kind === 'final',
        quizQuestions: questions,
      };
      await api.post(`/training/${training._id}/modules`, body);
      toast.success(t('Assessment added'));
      setTitle(KIND_TITLE[kind]); setNarrative(''); setQuestions([]);
      onChanged?.();
    } catch (err) { toast.error(err.response?.data?.error || t('Could not add')); } finally { setBusy(false); }
  };
  const removeModule = async (id) => {
    setBusy(true);
    try { await api.delete(`/training/${training._id}/modules/${id}`); onChanged?.(); }
    catch (err) { toast.error(err.response?.data?.error || t('Could not delete')); } finally { setBusy(false); }
  };
  const kindLabel = (m) => m.isPrePost ? t('Pre/Post Assessment') : m.isPreAssessment ? t('Pre-assessment') : m.isFinalAssessment ? t('Final assessment') : m.type === 'scenario' ? t('Case study') : t('Quiz');

  return (
    <div className="space-y-4">
      {assessable.map(m => (
        <div key={m._id} className="flex items-center justify-between gap-2 text-sm bg-gray-50 dark:bg-navy-light rounded-lg p-2">
          <span className="dark:text-gray-200">{m.title}
            <span className="ml-2 text-[10px] uppercase px-1.5 py-0.5 rounded bg-ilo-blue/10 text-ilo-blue">{kindLabel(m)}</span>
            <span className="text-gray-400 text-xs"> · {(m.quizQuestions || []).length} Q</span></span>
          <button onClick={() => removeModule(m._id)} disabled={busy} className="text-red-400 hover:text-red-600">✕</button>
        </div>
      ))}

      <div className="space-y-3 rounded-lg border border-dashed border-border dark:border-navy-light p-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder={t('Assessment title')} className={input} />
          <select value={kind} onChange={e => changeKind(e.target.value)} className={input}>
            <option value="prepost">{t('Pre/Post Assessment (same set → measures learning gain)')}</option>
            <option value="quiz">{t('Quiz')}</option>
            <option value="case">{t('Case study')}</option>
            <option value="pre">{t('Pre-assessment only')}</option>
            <option value="final">{t('Final assessment only')}</option>
          </select>
        </div>
        {kind === 'case' && (
          <textarea value={narrative} onChange={e => setNarrative(e.target.value)} rows={3}
            placeholder={t('Case scenario / situation description')} className={input} />
        )}
        {/* Upload a file + instruction → AI drafts the questions */}
        <AIGenPanel programId={training._id} onGenerated={qs => setQuestions(q => [...q, ...qs])} />

        {/* Editable questions (AI-drafted + manual) — click any option to mark it correct */}
        {questions.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-ilo-blue">{questions.length} {t('question(s) — edit, then Create assessment')}</p>
              <button onClick={() => setQuestions([])} className="text-[11px] text-red-500 hover:underline">{t('Clear all')}</button>
            </div>
            {questions.map((q, qi) => (
              <EditableQuestion key={qi} q={q} index={qi}
                onChange={nq => setQuestions(qs => qs.map((x, j) => j === qi ? nq : x))}
                onRemove={() => setQuestions(qs => qs.filter((_, j) => j !== qi))} />
            ))}
          </div>
        )}
        <button onClick={() => setQuestions(q => [...q, blankQ()])} className="px-3 py-1.5 text-xs font-semibold bg-gray-200 dark:bg-navy-mid dark:text-white rounded-lg hover:bg-gray-300">+ {t('Add a blank question')}</button>
      </div>
      <button onClick={create} disabled={busy}
        className="px-5 py-2 text-sm font-semibold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark transition-colors disabled:opacity-50">
        {busy ? t('Saving…') : t('Create assessment')}
      </button>
      <p className="text-[11px] text-gray-400">{t('Competency/domain tags drive the letter grades printed on certificates (e.g. Greening A, Skills B+).')}</p>
    </div>
  );
}

const DEFAULT_RUBRIC = [
  { criterion: 'Knowledge & Understanding', description: 'Grasp of underlying trade theory and standards', weightPct: 20 },
  { criterion: 'Practical Application', description: 'Correct, competent execution of the task', weightPct: 25 },
  { criterion: 'Health & Safety Compliance', description: 'Follows HSE procedures and uses PPE correctly', weightPct: 25 },
  { criterion: 'Quality of Work', description: 'Accuracy, finish and adherence to spec', weightPct: 20 },
  { criterion: 'Communication & Professionalism', description: 'Clarity, teamwork and work ethic', weightPct: 10 },
];

/* ─── Rubric builder (with a one-click standard rubric) ─── */
function RubricBuilder({ training, onChanged }) {
  const { t } = useLang();
  const gradable = (training.modules || []).filter(m => ['practical', 'assignment', 'scenario', 'quiz'].includes(m.type));
  const [moduleId, setModuleId] = useState(gradable[0]?._id || '');
  const current = gradable.find(m => m._id === moduleId);
  const [rows, setRows] = useState(current?.rubricTemplate || []);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setRows((gradable.find(m => m._id === moduleId)?.rubricTemplate) || []); }, [moduleId, training._id]); // eslint-disable-line react-hooks/exhaustive-deps
  const input = 'px-2 py-1.5 text-sm rounded-lg border border-border dark:border-navy-light bg-white dark:bg-navy-mid dark:text-white';
  const save = async () => {
    if (!moduleId) return;
    setBusy(true);
    try {
      await api.put(`/training/${training._id}/modules/${moduleId}`, { rubricTemplate: rows, rubricRequired: rows.length > 0 });
      toast.success(t('Rubric saved'));
      onChanged?.();
    } catch (err) { toast.error(err.response?.data?.error || t('Could not save')); } finally { setBusy(false); }
  };
  if (!gradable.length) return <p className="text-sm text-gray-500 dark:text-gray-400">{t('Add a practical, assignment, case or quiz module first, then attach a rubric.')}</p>;
  return (
    <div className="space-y-3">
      <select value={moduleId} onChange={e => setModuleId(e.target.value)} className={`w-full ${input}`}>
        {gradable.map(m => <option key={m._id} value={m._id}>{m.title} ({m.type})</option>)}
      </select>
      <div className="flex gap-2">
        <button onClick={() => setRows(DEFAULT_RUBRIC.map(r => ({ ...r })))} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-200 dark:bg-navy-mid dark:text-white hover:bg-gray-300">✨ {t('Generate default rubric')}</button>
        <button onClick={() => setRows(r => [...r, { criterion: '', description: '', weightPct: 0 }])} className="text-xs text-ilo-blue hover:underline self-center">+ {t('Add criterion')}</button>
      </div>
      {rows.map((r, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="flex-1 space-y-1">
            <input value={r.criterion} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, criterion: e.target.value } : x))} placeholder={t('Criterion')} className={`w-full ${input}`} />
            <input value={r.description || ''} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} placeholder={t('Description')} className={`w-full text-xs ${input}`} />
          </div>
          <div className="flex items-center gap-1 mt-0.5">
            <input type="number" min={0} max={100} value={r.weightPct ?? 0} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, weightPct: Number(e.target.value) } : x))} className={`w-16 ${input}`} title={t('Weight %')} />
            <span className="text-sm text-gray-400">%</span>
          </div>
          <button onClick={() => setRows(rs => rs.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600 mt-2">✕</button>
        </div>
      ))}
      {rows.length > 0 && (() => { const total = rows.reduce((s, r) => s + (Number(r.weightPct) || 0), 0);
        return <p className={`text-xs font-semibold ${total === 100 ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
          {t('Total weight')}: {total}% {total !== 100 ? `(${t('should be 100%')})` : '✓'}</p>; })()}
      <button onClick={save} disabled={busy}
        className="px-4 py-2 text-sm font-semibold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark transition-colors disabled:opacity-50">
        {busy ? t('Saving…') : t('Save rubric')}
      </button>
    </div>
  );
}

/* ─── Participant analysis (AI over cohort replies) ─── */
function ParticipantAnalysis({ programId }) {
  const { t } = useLang();
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState(null);
  const [msg, setMsg] = useState('');
  const run = async () => {
    setLoading(true); setMsg('');
    try {
      const { data } = await api.post(`/ai/training/${programId}/participant-analysis`, {});
      setRes(data);
    } catch (err) { setMsg(err.response?.data?.error || t('Analysis unavailable right now.')); } finally { setLoading(false); }
  };
  const List = ({ title, items, icon }) => items?.length ? (
    <div>
      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">{icon} {title}</p>
      <ul className="list-disc list-inside space-y-1 text-sm text-gray-700 dark:text-gray-300">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  ) : null;
  const a = res?.analysis;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">{t('Analyze the replies participants gave on quizzes, cases and assignments.')}</p>
        <button onClick={run} disabled={loading}
          className="shrink-0 px-4 py-2 text-sm font-semibold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark transition-colors disabled:opacity-50">
          {loading ? t('Analysing…') : (res ? t('Refresh') : t('Analyze participants'))}
        </button>
      </div>
      {msg && <p className="text-sm text-amber-600 dark:text-amber-400">{msg}</p>}
      {res && (
        <div className="space-y-4 rounded-xl border border-border dark:border-navy-light p-4">
          {res.stats && <div className="flex gap-4 text-xs text-gray-500 dark:text-gray-400">
            <span>{res.stats.participants} {t('participants')}</span><span>{t('avg progress')} {res.stats.avgProgress}%</span><span>{res.stats.certified} {t('certified')}</span></div>}
          {a?.overview && <p className="text-sm text-gray-700 dark:text-gray-200">{a.overview}</p>}
          <List title={t('Common weaknesses')} items={a?.commonWeaknesses} icon="📉" />
          <List title={t('Hardest items')} items={a?.hardestItems} icon="🧩" />
          <List title={t('At-risk participants')} items={a?.atRiskParticipants} icon="⚠️" />
          <List title={t('Teaching recommendations')} items={a?.teachingRecommendations} icon="👩‍🏫" />
          <List title={t('Assessment improvements')} items={a?.assessmentImprovements} icon="🛠️" />
        </div>
      )}
    </div>
  );
}

/* ─── 1. Introduction: description + trainers + signatory ─── */
function IntroductionEditor({ training, onSaved }) {
  const { t } = useLang();
  const [desc, setDesc] = useState(training.description || '');
  const [issuers, setIssuers] = useState((training.issuers || []).join(', '));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDesc(training.description || ''); setIssuers((training.issuers || []).join(', ')); }, [training._id]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    setBusy(true);
    try {
      const issuerList = issuers.split(',').map(x => x.trim()).filter(Boolean);
      await api.put(`/training/${training._id}`, { description: desc.trim(), issuers: issuerList });
      toast.success(t('Introduction saved')); onSaved?.();
    }
    catch (err) { toast.error(err.response?.data?.error || t('Could not save')); } finally { setBusy(false); }
  };
  const input = 'w-full px-3 py-2 text-sm rounded-xl border border-border dark:border-navy-light bg-white dark:bg-navy-mid dark:text-white';
  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500 dark:text-gray-400 capitalize">
        {training.trade}{training.nqfLevel ? ` · NQF ${training.nqfLevel}` : ''}{training.duration ? ` · ${training.duration}` : ''}
      </div>
      <div>
        <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{t('Introduction / description of the training')}</label>
        <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={5} placeholder={t('Purpose, objectives, target audience, outcomes…')} className={`mt-1 ${input}`} />
      </div>
      <div>
        <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{t('Certificate issuers')}</label>
        <input value={issuers} onChange={e => setIssuers(e.target.value)} placeholder={t('e.g. Lodhran Pilot Project, PPMC')} className={`mt-1 ${input}`} />
        <p className="text-[11px] text-gray-400 mt-1">{t('Comma-separated — the partner organisations printed on the certificate.')}</p>
      </div>
      <div>
        <button onClick={save} disabled={busy}
          className="px-5 py-2 text-sm font-semibold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark transition-colors disabled:opacity-50">
          {busy ? t('Saving…') : t('Save introduction')}
        </button>
      </div>
      <div className="border-t border-border dark:border-navy-light pt-4"><TrainersEditor training={training} onSaved={onSaved} /></div>
      <div className="border-t border-border dark:border-navy-light pt-4"><SignatoryEditor training={training} onSaved={onSaved} /></div>
    </div>
  );
}

/* ─── 2. Particulars of the trainees: roster with scores ─── */
function ParticipantsPanel({ programId }) {
  const { t } = useLang();
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get(`/training/${programId}/participants`).then(r => setData(r.data)).catch(() => setData({ participants: [] }));
  }, [programId]);
  if (!data) return spinner;
  if (!data.participants.length) return <p className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">{t('No trainees enrolled yet.')}</p>;
  const cell = 'px-2 py-2 text-xs';
  const pct = (v) => v == null ? '—' : `${v}%`;
  return (
    <div className="overflow-x-auto">
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{data.count} {t('enrolled trainees')}</p>
      <table className="w-full text-left border-collapse">
        <thead><tr className="text-[11px] uppercase text-gray-400 border-b border-border dark:border-navy-light">
          <th className={cell}>{t('Trainee')}</th><th className={cell}>{t('Reg #')}</th><th className={cell}>{t('District')}</th>
          <th className={cell}>{t('Progress')}</th><th className={cell}>{t('Pre')}</th><th className={cell}>{t('Post')}</th>
          <th className={cell}>{t('Gain')}</th><th className={cell}>{t('Exercises')}</th><th className={cell}>{t('Cert')}</th>
        </tr></thead>
        <tbody>
          {data.participants.map((p, i) => (
            <tr key={i} className="border-b border-border/50 dark:border-navy-light/50">
              <td className={`${cell} font-semibold dark:text-white`}>{p.name}</td>
              <td className={`${cell} text-gray-500`}>{p.registrationId || '—'}</td>
              <td className={`${cell} text-gray-500`}>{p.district || '—'}</td>
              <td className={cell}>{p.progress}%</td>
              <td className={cell}>{pct(p.pre)}</td>
              <td className={cell}>{pct(p.post)}</td>
              <td className={`${cell} font-semibold ${p.gain > 0 ? 'text-green-600 dark:text-green-400' : p.gain < 0 ? 'text-red-500' : 'text-gray-400'}`}>{p.gain == null ? '—' : (p.gain > 0 ? '+' : '') + p.gain}</td>
              <td className={cell}>{pct(p.exerciseAvg)}</td>
              <td className={cell}>{p.certified ? '🏅' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StaffManageView() {
  const { t } = useLang();
  const [courses, setCourses] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [training, setTraining] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const loadList = useCallback((selectId) => {
    // `summary=1` → lightweight list so the picker loads fast.
    api.get('/training?summary=1')
      .then(r => {
        const all = r.data.trainings || r.data.programs || r.data || [];
        // Exam/course-system items are managed via the Courses / exam admin,
        // not the Training tab.
        const list = all.filter(c => !(c.tags || []).includes('online-exam'));
        setCourses(list);
        if (selectId) setSelectedId(selectId);
        else if (list.length && !selectId) setSelectedId(cur => cur || list[0]._id);
      })
      .catch(() => setCourses([]));
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  const reload = useCallback(() => {
    if (!selectedId) return;
    api.get(`/training/${selectedId}`).then(r => setTraining(r.data)).catch(() => {});
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) { setTraining(null); return; }
    setTraining(null);
    reload();
  }, [selectedId, reload]);

  if (courses === null) return spinner;

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div className="flex-1">
          <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{t('Training')}</label>
          <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm rounded-xl border border-border dark:border-navy-light bg-white dark:bg-navy-mid dark:text-white">
            {!courses.length && <option value="">{t('No trainings yet')}</option>}
            {courses.map(c => <option key={c._id} value={c._id}>{c.title}</option>)}
          </select>
        </div>
        <button onClick={() => setShowCreate(s => !s)}
          className="shrink-0 px-4 py-2 text-sm font-semibold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark transition-colors">
          {showCreate ? t('Close') : `+ ${t('New training')}`}
        </button>
      </div>

      {showCreate && (
        <div className="rounded-xl border border-border dark:border-navy-light p-4">
          <h3 className="text-sm font-bold dark:text-white mb-3">{t('Create Training')}</h3>
          <CreateTrainingForm onCreated={(c) => { setShowCreate(false); loadList(c._id); }} />
        </div>
      )}

      {selectedId && (training ? (
        <>
          <div>
            <h2 className="text-lg font-bold dark:text-white">{training.title}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 capitalize">
              {training.trade}{training.nqfLevel ? ` · NQF ${training.nqfLevel}` : ''}{training.duration ? ` · ${training.duration}` : ''}
            </p>
          </div>
          <Section title={t('1. Introduction')} icon="📘" subtitle={t('About the training + trainers')} defaultOpen>
            <IntroductionEditor training={training} onSaved={reload} />
          </Section>
          <Section title={t('2. Particulars of the Trainees')} icon="👤" subtitle={t('Enrolled trainees, progress & scores')}>
            <ParticipantsPanel programId={training._id} />
          </Section>
          <Section title={t('3. Assessment (Pre & Post)')} icon="📝" subtitle={t('Upload a document — the AI builds the assessment')}>
            <ModuleAuthor training={training} onChanged={reload} />
          </Section>
          <Section title={t('4. Material Library')} icon="📚" subtitle={t('Upload materials to distribute to trainees')}>
            <ResourceManager training={training} onChanged={reload} />
          </Section>
          <Section title={t('5. Training Exercises')} icon="✎" subtitle={t('Bulk-upload files → AI builds scored exercises with on-spot feedback')}>
            <PracticeSetManager training={training} onChanged={reload} />
          </Section>
        </>
      ) : spinner)}
    </div>
  );
}

/* Public catalog of open-enrolment trainings, shown as join cards inside the
   Training tab. Each card shows the dates and a Join button (→ /join/:id). */
function OpenTrainingsCatalog({ enrolledIds = [], onOpen, compact = false }) {
  const [items, setItems] = useState(null);
  useEffect(() => {
    let live = true;
    api.get('/training/public/open')
      .then(r => { if (live) setItems(Array.isArray(r.data) ? r.data : []); })
      .catch(() => { if (live) setItems([]); });
    return () => { live = false; };
  }, []);
  const fmt = (d) => d ? new Date(d).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
  if (items === null || items.length === 0) return null;
  const enrolled = new Set(enrolledIds.map(String));
  return (
    <div className={compact ? 'mb-5' : ''}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[#C8952E] text-lg">▣</span>
        <h3 className="text-sm font-bold uppercase tracking-wide text-[#002D72] dark:text-[#f0c667]">Available Trainings</h3>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {items.map(tr => {
          const isEnrolled = enrolled.has(String(tr.id));
          const dateLine = tr.startDate ? (tr.endDate ? `${fmt(tr.startDate)} – ${fmt(tr.endDate)}` : fmt(tr.startDate)) : '';
          return (
            <div key={tr.id} className="rounded-2xl border border-border dark:border-navy-light overflow-hidden bg-white dark:bg-navy-mid shadow-sm">
              <div className="h-1.5 bg-gradient-to-r from-[#002D72] via-[#0a4bb3] to-[#C8952E]" />
              <div className="p-4">
                <h4 className="font-bold text-[15px] leading-snug dark:text-white">{tr.title}</h4>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                  {dateLine && <span className="px-2 py-0.5 rounded-full bg-[#eef4ff] text-[#002D72] dark:bg-navy dark:text-[#9dc0ff] font-semibold">📅 {dateLine}</span>}
                  {tr.duration && <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-navy text-gray-600 dark:text-gray-300">{tr.duration}</span>}
                  {typeof tr.seatsLeft === 'number' && <span className="px-2 py-0.5 rounded-full bg-[#fff6e6] text-[#8a5e10] dark:bg-navy dark:text-[#f0c667] font-semibold">{tr.seatsLeft} seats left</span>}
                </div>
                {!compact && tr.description && (
                  <p className="mt-2 text-[12px] text-gray-500 dark:text-gray-400 line-clamp-3">{tr.description}</p>
                )}
                <div className="mt-3 flex gap-2">
                  {isEnrolled ? (
                    <>
                      <span className="px-3 py-1.5 text-xs font-bold rounded-lg bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300">✓ Enrolled</span>
                      {onOpen && <button onClick={() => onOpen(tr.id)} className="px-3 py-1.5 text-xs font-bold rounded-lg border border-border dark:border-navy-light dark:text-white hover:bg-gray-50 dark:hover:bg-navy">Open →</button>}
                    </>
                  ) : (
                    <>
                      <a href={`/join/${tr.id}`} className="px-4 py-1.5 text-xs font-bold rounded-lg bg-[#002D72] text-white hover:bg-[#0a4bb3] transition-colors">Join the training →</a>
                      <button onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}/join/${tr.id}`); toast.success('Join link copied'); }}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border dark:border-navy-light dark:text-white hover:bg-gray-50 dark:hover:bg-navy">Copy link</button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function TrainingTab({ workerId }) {
  const { t } = useLang();
  const { user } = useAuth();
  const isStaff = STAFF_ROLES.includes(user?.role);
  const [courses, setCourses] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [training, setTraining] = useState(null);
  const [cert, setCert] = useState(null);
  const [stage, setStage] = useState('overview');
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Load the worker's enrolled trainings.
  useEffect(() => {
    if (!workerId) { setCourses([]); return; }
    api.get('/training/my-courses')
      .then(r => {
        const raw = r.data.courses || r.data || [];
        // The Training tab is for trainings only; exam/course-system items are
        // taken via the exam runner and shown in the Courses / My Learning tabs.
        const list = raw.filter(c => !c.isExamCourse);
        setCourses(list);
        if (list.length) {
          const inProgress = list.find(c => c.enrollment && c.enrollment.status !== 'completed');
          setSelectedId((inProgress || list[0])._id);
        }
      })
      .catch(() => setCourses([]));
  }, [workerId]);

  const loadDetail = useCallback(async (id) => {
    if (!id) return;
    setLoadingDetail(true);
    try {
      const [tRes, cRes] = await Promise.allSettled([
        api.get(`/training/${id}`),
        api.get(`/training/${id}/certificate`),
      ]);
      if (tRes.status === 'fulfilled') setTraining(tRes.value.data);
      if (cRes.status === 'fulfilled') setCert(cRes.value.data);
      else setCert(null);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => { if (selectedId) loadDetail(selectedId); }, [selectedId, loadDetail]);

  // Staff manage the certificate signatory (open, editable) per training.
  if (isStaff) return <StaffManageView />;

  if (!workerId) {
    return <p className="text-center text-gray-500 dark:text-gray-400 py-12">{t('The Training journey is available for learner accounts.')}</p>;
  }
  if (courses === null) return spinner;
  if (!courses.length) {
    return (
      <div className="space-y-6">
        <div className="text-center py-6 space-y-2">
          <div className="text-4xl">🎓</div>
          <p className="text-sm font-semibold dark:text-white">{t('You are not enrolled in any training yet.')}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('Join an open programme below to begin your training journey.')}</p>
        </div>
        <OpenTrainingsCatalog enrolledIds={[]} />
      </div>
    );
  }

  const enrollment = training?.enrollments?.find(e => String(e.worker) === String(workerId)
    || String(e.worker?._id) === String(workerId));
  const completed = new Set((enrollment?.completedModules || []).map(String));
  const modules = (training?.modules || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  const prePostModules = modules.filter(m => m.isPrePost);
  const preModules = modules.filter(m => m.isPreAssessment && !m.isPrePost);
  const finalModules = modules.filter(m => m.isFinalAssessment && !m.isPrePost);
  const surveyModules = modules.filter(m => m.isSurvey && !m.isFinalAssessment && !m.isPrePost);
  const evalModules = modules.filter(m => m.isTrainerAssessment && !m.isFinalAssessment && !m.isPrePost);
  const materials = modules.filter(m => !m.isPreAssessment && !m.isFinalAssessment && !m.isPrePost && !m.isSurvey && !m.isTrainerAssessment);
  const practiceSets = training?.practiceSets || [];
  const resources = training?.resources || [];

  const allMaterialsDone = materials.length > 0 && materials.every(m => completed.has(String(m._id)));
  const finalDone = finalModules.length > 0 && finalModules.every(m => completed.has(String(m._id)));
  const preDone = preModules.every(m => completed.has(String(m._id)));

  // Report metadata + single-attempt result lookups.
  const reportMeta = { training: training?.title, trade: training?.trade, nqfLevel: training?.nqfLevel, holderName: user?.name || '' };
  const passMark = training?.passMark || 70;
  const attemptFor = (mid, phase) => (enrollment?.quizAttempts || []).find(a => String(a.moduleId) === String(mid) && (a.phase || null) === (phase || null));
  const exerciseResultFor = (pid) => (enrollment?.exerciseResults || []).find(r => String(r.practiceId) === String(pid));

  const steps = [
    { id: 'overview', label: t('Overview'), icon: 'i', done: false, locked: false },
    { id: 'pre', label: t('Pre-Assessment'), icon: '1', done: preDone && preModules.length > 0, locked: preModules.length === 0 && prePostModules.length === 0 },
    { id: 'materials', label: t('Training Materials'), icon: '2', done: allMaterialsDone, locked: false },
    { id: 'library', label: t('Library'), icon: '📚', done: false, locked: resources.length === 0 },
    { id: 'exercises', label: t('Exercises'), icon: '✎', done: false, locked: practiceSets.length === 0 },
    { id: 'live', label: t('Live Sessions'), icon: '3', done: false, locked: false },
    { id: 'survey', label: t('Field Survey'), icon: '📋', done: surveyModules.length > 0 && surveyModules.every(m => completed.has(String(m._id))), locked: surveyModules.length === 0 },
    { id: 'evaluation', label: t('Trainer Assessment'), icon: '⭐', done: evalModules.length > 0 && evalModules.every(m => completed.has(String(m._id))), locked: evalModules.length === 0 },
    { id: 'final', label: t('Final Assessment'), icon: '4', done: finalDone, locked: finalModules.length === 0 && prePostModules.length === 0 },
    { id: 'coach', label: t('AI Coach'), icon: '🧠', done: false, locked: false },
    { id: 'certificate', label: t('Certificate'), icon: '★', done: !!cert?.issued, locked: false },
  ];

  const progress = enrollment?.progress ?? 0;

  // Sequential navigation across the available (unlocked) steps.
  const navSteps = steps.filter(s => !s.locked);
  const navIdx = Math.max(0, navSteps.findIndex(s => s.id === stage));
  const atStart = navIdx <= 0;
  const atEnd = navIdx >= navSteps.length - 1;
  const goStart = () => setStage(navSteps[0]?.id || 'overview');
  const goBack = () => { if (!atStart) setStage(navSteps[navIdx - 1].id); };
  const goNext = () => { if (!atEnd) setStage(navSteps[navIdx + 1].id); };

  return (
   <div className="space-y-5">
    <OpenTrainingsCatalog enrolledIds={courses.map(c => c._id)} onOpen={(id) => { setSelectedId(id); setStage('overview'); }} compact />
    <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-6">
      {/* Left: course picker + step rail */}
      <aside className="space-y-4">
        <div>
          <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{t('My Training')}</label>
          <select value={selectedId || ''} onChange={e => { setSelectedId(e.target.value); setStage('overview'); }}
            className="mt-1 w-full px-3 py-2 text-sm rounded-xl border border-border dark:border-navy-light bg-white dark:bg-navy-mid dark:text-white">
            {courses.map(c => <option key={c._id} value={c._id}>{c.title}</option>)}
          </select>
        </div>

        <div className="rounded-xl border border-border dark:border-navy-light p-2 space-y-1">
          {steps.map(s => (
            <Step key={s.id} {...s} active={stage === s.id} onClick={() => setStage(s.id)} />
          ))}
        </div>

        <div className="px-1">
          <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
            <span>{t('Progress')}</span><span>{progress}%</span>
          </div>
          <div className="h-2 rounded-full bg-gray-200 dark:bg-navy-mid overflow-hidden">
            <div className="h-full bg-ilo-blue transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </aside>

      {/* Right: stage content */}
      <section className="min-w-0">
        {loadingDetail || !training ? spinner : (
          <>
            <div className="mb-4">
              <h2 className="text-lg font-bold dark:text-white">{training.title}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 capitalize">
                {training.trade}{training.nqfLevel ? ` · NQF ${training.nqfLevel}` : ''}{training.institution ? ` · ${training.institution}` : ''}
              </p>
            </div>

            {/* Start / Back / Next navigation */}
            <div className="flex items-center justify-between gap-2 mb-4 p-2 rounded-xl border border-border dark:border-navy-light bg-gray-50 dark:bg-navy-light/40">
              <div className="flex items-center gap-2">
                <button onClick={goStart} disabled={atStart}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border dark:border-navy-light dark:text-gray-200 hover:bg-white dark:hover:bg-navy-mid disabled:opacity-40 transition-colors">⏮ {t('Start')}</button>
                <button onClick={goBack} disabled={atStart}
                  className="px-3 py-1.5 text-sm font-semibold rounded-lg border border-border dark:border-navy-light dark:text-gray-200 hover:bg-white dark:hover:bg-navy-mid disabled:opacity-40 transition-colors">← {t('Back')}</button>
              </div>
              <span className="text-xs text-gray-500 dark:text-gray-400 text-center">
                {t('Step')} {navIdx + 1} / {navSteps.length} · <b className="dark:text-gray-200">{navSteps[navIdx]?.label}</b>
              </span>
              <button onClick={goNext} disabled={atEnd}
                className="px-4 py-1.5 text-sm font-bold rounded-lg bg-ilo-blue text-white hover:bg-ilo-dark disabled:opacity-40 transition-colors">{t('Next')} →</button>
            </div>

            {stage === 'overview' && (
              <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
                {training.description && <p>{training.description}</p>}
                <ul className="space-y-1">
                  <li>📝 {t('Pre-Assessment')}: {preModules.length ? t('available') : t('none')}</li>
                  <li>📚 {t('Training Materials')}: {materials.length} {t('modules')}</li>
                  <li>✎ {t('Exercises')}: {practiceSets.length ? `${practiceSets.length} ${t('practice sets')}` : t('none')}</li>
                  <li>📚 {t('Library')}: {resources.length ? `${resources.length} ${t('resources')}` : t('none')}</li>
                  <li>🎥 {t('Live Sessions')}: {t('see Live tab')}</li>
                  {surveyModules.length > 0 && <li>📋 {t('Field Survey')}: {t('available')}</li>}
                  {evalModules.length > 0 && <li>⭐ {t('Trainer Assessment')}: {t('available')}</li>}
                  <li>🎯 {t('Final Assessment')}: {finalModules.length ? t('required to pass') : t('none')}</li>
                  <li>★ {t('Certificate')}: {cert?.issued ? t('issued') : t('on successful completion')}</li>
                </ul>
                <p className="text-xs text-gray-400">{t('Signed by')}: {training.signatory?.name || '[Chief Master Trainer]'} — {training.signatory?.title || 'Chief Master Trainer'}</p>
              </div>
            )}

            {stage === 'pre' && ((prePostModules.length + preModules.length)
              ? <div className="space-y-6">
                  {prePostModules.map(m => {
                    const preAt = attemptFor(m._id, 'pre');
                    return <div key={m._id}>
                      <h3 className="text-sm font-bold dark:text-white mb-2">{m.title}
                        <span className="ml-2 text-[10px] uppercase px-1.5 py-0.5 rounded bg-[#7a63b0]/15 text-[#5b4a8a] dark:text-purple-300">{t('Pre/Post')}</span></h3>
                      {preAt
                        ? <PreBaselineCard result={preAt} moduleTitle={m.title} />
                        : <AssessmentPlayer programId={training._id} module={m} workerId={workerId} passMark={passMark} meta={reportMeta} phase="pre" onSubmitted={() => loadDetail(training._id)} />}
                    </div>;})}
                  {preModules.map(m => {
                    const at = attemptFor(m._id);
                    return <div key={m._id}>
                      <h3 className="text-sm font-bold dark:text-white mb-2">{m.title}</h3>
                      {at
                        ? <ResultsReport meta={{ ...reportMeta, moduleTitle: m.title }} result={attemptToResult(at, passMark)} submittedNote={t('Submitted')} />
                        : <AssessmentPlayer programId={training._id} module={m} workerId={workerId} passMark={passMark} meta={reportMeta} onSubmitted={() => loadDetail(training._id)} />}
                    </div>;})}
                </div>
              : <p className="text-sm text-gray-500 dark:text-gray-400">{t('No pre-assessment for this training.')}</p>)}

            {stage === 'materials' && (materials.length
              ? <div className="space-y-6">{materials.map(m => {
                  const isQuiz = (m.type === 'quiz' || m.type === 'scenario') && (m.quizQuestions || []).length > 0;
                  return (
                  <div key={m._id} className="pb-6 border-b border-border dark:border-navy-light last:border-0">
                    <h3 className="text-sm font-bold dark:text-white mb-2">{m.title}
                      <span className="ml-2 text-[10px] uppercase text-gray-400">{m.type === 'scenario' ? t('case') : m.type}</span></h3>
                    {isQuiz ? (
                      attemptFor(m._id)
                        ? <ResultsReport meta={{ ...reportMeta, moduleTitle: m.title }} result={attemptToResult(attemptFor(m._id), passMark)} submittedNote={t('Submitted')} />
                        : <>
                            {m.content && <div className="mb-3 p-3 rounded-xl bg-gray-50 dark:bg-navy-light text-sm text-gray-700 dark:text-gray-300"><RichContent content={m.content} /></div>}
                            <AssessmentPlayer programId={training._id} module={m} workerId={workerId} passMark={passMark} meta={reportMeta} onSubmitted={() => loadDetail(training._id)} />
                          </>
                    ) : (
                      <MaterialViewer module={m} programId={training._id} workerId={workerId}
                        done={completed.has(String(m._id))} onComplete={() => loadDetail(training._id)} />
                    )}
                  </div>);})}</div>
              : <p className="text-sm text-gray-500 dark:text-gray-400">{t('No materials yet.')}</p>)}

            {stage === 'survey' && (surveyModules.length
              ? <div className="space-y-6">{surveyModules.map(m => (
                  <div key={m._id}>
                    <h3 className="text-sm font-bold dark:text-white mb-2">{m.title}</h3>
                    <MaterialViewer module={m} programId={training._id} workerId={workerId}
                      done={completed.has(String(m._id))} onComplete={() => loadDetail(training._id)} />
                  </div>))}</div>
              : <p className="text-sm text-gray-500 dark:text-gray-400">{t('No survey for this training.')}</p>)}

            {stage === 'evaluation' && (evalModules.length
              ? <div className="space-y-6">{evalModules.map(m => (
                  <div key={m._id}>
                    <h3 className="text-sm font-bold dark:text-white mb-2">{m.title}</h3>
                    <MaterialViewer module={m} programId={training._id} workerId={workerId}
                      done={completed.has(String(m._id))} onComplete={() => loadDetail(training._id)} />
                  </div>))}</div>
              : <p className="text-sm text-gray-500 dark:text-gray-400">{t('No trainer assessment for this training.')}</p>)}

            {stage === 'library' && <LibraryStage resources={resources} />}

            {stage === 'exercises' && <PracticeStage programId={training._id} sets={practiceSets} workerId={workerId} meta={reportMeta} resultFor={exerciseResultFor} onSubmitted={() => loadDetail(training._id)} />}

            {stage === 'coach' && <AICoachPanel programId={training._id} workerId={workerId} />}

            {stage === 'live' && <LiveSessions programId={training._id} />}

            {stage === 'final' && ((prePostModules.length + finalModules.length)
              ? <div className="space-y-6">
                  {!allMaterialsDone && (
                    <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-xs font-semibold">
                      ⚠ {t('Complete all training materials before the final assessment counts toward your certificate.')}
                    </div>)}
                  {prePostModules.map(m => {
                    const postAt = attemptFor(m._id, 'post');
                    const preAt = attemptFor(m._id, 'pre');
                    let res = null;
                    if (postAt) { res = attemptToResult(postAt, passMark); if (preAt) res.learningGain = { pre: preAt.score, post: postAt.score, gain: postAt.score - preAt.score }; }
                    return <div key={m._id}>
                      <h3 className="text-sm font-bold dark:text-white mb-2">{m.title}
                        <span className="ml-2 text-[10px] uppercase px-1.5 py-0.5 rounded bg-ilo-blue/10 text-ilo-blue">{t('Post-test')}</span></h3>
                      {postAt
                        ? <ResultsReport meta={{ ...reportMeta, moduleTitle: m.title }} result={res} submittedNote={t('Submitted')} />
                        : !preAt
                          ? <div className="p-3 rounded-xl bg-[#7a63b0]/10 text-[#5b4a8a] dark:text-purple-300 text-xs font-semibold">📋 {t('Take the Pre-test first (Pre-Assessment step) — the post-test uses the same questions.')}</div>
                          : <AssessmentPlayer programId={training._id} module={m} workerId={workerId} passMark={passMark} meta={reportMeta} phase="post" onSubmitted={() => loadDetail(training._id)} />}
                    </div>;})}
                  {finalModules.map(m => {
                    const at = attemptFor(m._id);
                    return <div key={m._id}>
                      <h3 className="text-sm font-bold dark:text-white mb-2">{m.title}</h3>
                      {at
                        ? <ResultsReport meta={{ ...reportMeta, moduleTitle: m.title }} result={attemptToResult(at, passMark)} submittedNote={t('Submitted')} />
                        : <AssessmentPlayer programId={training._id} module={m} workerId={workerId} passMark={passMark} meta={reportMeta} onSubmitted={() => loadDetail(training._id)} />}
                    </div>;})}</div>
              : <p className="text-sm text-gray-500 dark:text-gray-400">{t('No final assessment for this training.')}</p>)}

            {stage === 'certificate' && (
              <CertificatePanel programId={training._id} cert={cert} onRefresh={() => loadDetail(training._id)} />
            )}

            {/* Bottom Back / Next for easy maneuvering */}
            <div className="flex items-center justify-between gap-2 mt-8 pt-4 border-t border-border dark:border-navy-light">
              <button onClick={goBack} disabled={atStart}
                className="px-4 py-2 text-sm font-semibold rounded-xl border border-border dark:border-navy-light dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-navy-light disabled:opacity-40 transition-colors">← {t('Back')}</button>
              {atEnd
                ? <button onClick={goStart} className="px-4 py-2 text-sm font-semibold rounded-xl text-gray-500 dark:text-gray-400 hover:underline">⏮ {t('Back to start')}</button>
                : <button onClick={goNext}
                    className="px-6 py-2 text-sm font-bold rounded-xl bg-ilo-blue text-white hover:bg-ilo-dark transition-colors">{t('Next')}: {navSteps[navIdx + 1]?.label} →</button>}
            </div>
          </>
        )}
      </section>
    </div>
   </div>
  );
}
