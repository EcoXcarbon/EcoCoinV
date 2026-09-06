import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import DOMPurify from 'dompurify';
import api from '../api/client';
import { useLang } from '../context/LangContext';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

/* ─── Lazy-loaded enhanced LMS components ─── */
import PathwaysTab from './lms/PathwaysTab';
import AchievementsTab from './lms/AchievementsTab';
import RecommendationsPanel from './lms/RecommendationsPanel';
import ScenarioView from './lms/ScenarioView';
import CompetencyMap from './lms/CompetencyMap';
import AIAdaptPanel from './lms/AIAdaptPanel';
import AIGenerateModal from './lms/AIGenerateModal';
import HelpTip from '../components/HelpTip';
import QuizRenderer from '../components/quiz/QuizRenderer';
import ScormPlayer from '../components/ScormPlayer';
/* ─── New simplified flow components ─── */
import PreAssessment from './lms/PreAssessment';
import ResultsView from './lms/ResultsView';
import TranscriptTab from './lms/TranscriptTab';
import TrainingTab from './lms/TrainingTab';
/* ─── Competency-based assessment components ─── */
import GradingBreakdown from './lms/GradingBreakdown';
import CompetencyEligibility from './lms/CompetencyEligibility';

/* ─── Simple Markdown renderer ─── */
function renderMarkdown(text) {
  if (!text) return '';
  // Content authored/converted as HTML (e.g. docx → HTML) must be rendered, not
  // escaped — otherwise the raw <div>/<h2>/<p> tags show as visible text.
  if (/<\/?[a-z][\s\S]*>/i.test(text)) {
    return DOMPurify.sanitize(text, { USE_PROFILES: { html: true } });
  }
  let html = text
    // Escape HTML entities
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // Headings
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Tables — convert markdown tables to HTML
    .replace(/^(\|.+\|)\n(\|[-| :]+\|)\n((?:\|.+\|\n?)*)/gm, (_match, header, _sep, body) => {
      const ths = header.split('|').filter(c => c.trim()).map(c => `<th>${c.trim()}</th>`).join('');
      const rows = body.trim().split('\n').map(row => {
        const tds = row.split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join('');
        return `<tr>${tds}</tr>`;
      }).join('');
      return `<table><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>`;
    })
    // Numbered lists
    .replace(/^(\d+)\. (.+)$/gm, '<li data-num="$1">$2</li>')
    // Bullet lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // Wrap consecutive <li> in <ul> or <ol>
    .replace(/((?:<li data-num="\d+">.+<\/li>\n?)+)/g, (m) => `<ol>${m.replace(/ data-num="\d+"/g, '')}</ol>`)
    .replace(/((?:<li>(?!<\/ol>).+<\/li>\n?)+)/g, '<ul>$1</ul>')
    // Paragraphs — double newlines
    .replace(/\n\n/g, '</p><p>')
    // Single newlines within paragraphs
    .replace(/\n/g, '<br/>');
  return `<p>${html}</p>`;
}

/* ─── YouTube helpers ─── */
function isYouTubeUrl(url) {
  if (!url) return false;
  return /(?:youtube\.com|youtu\.be)/.test(url);
}

function getYouTubeVideoId(url) {
  if (!url) return null;
  // youtu.be/ID
  const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];
  // youtube.com/watch?v=ID
  const watchMatch = url.match(/youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch) return watchMatch[1];
  // youtube.com/embed/ID
  const embedMatch = url.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/);
  if (embedMatch) return embedMatch[1];
  return null;
}

function getYouTubeEmbedUrl(url) {
  const videoId = getYouTubeVideoId(url);
  return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
}

/* ─── Unified Video Player component (click-to-play for reliability) ─── */
function VideoPlayer({ videoUrl, title }) {
  const [playing, setPlaying] = useState(false);
  const [thumbError, setThumbError] = useState(false);

  const videoId = videoUrl ? getYouTubeVideoId(videoUrl) : null;
  const isYT = videoUrl && isYouTubeUrl(videoUrl) && videoId;

  // Reset when URL changes
  useEffect(() => { setPlaying(false); setThumbError(false); }, [videoUrl]);

  // No URL — placeholder
  if (!videoUrl) {
    return (
      <div className="aspect-video bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl flex items-center justify-center">
        <div className="text-center text-white">
          <svg className="w-16 h-16 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <p className="text-gray-400 text-sm">Video content for this module</p>
        </div>
      </div>
    );
  }

  // YouTube — click thumbnail to play
  if (isYT) {
    if (playing) {
      return (
        <div className="aspect-video bg-black rounded-xl overflow-hidden">
          <iframe
            className="w-full h-full"
            src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1&playsinline=1`}
            title={title || 'Video'}
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
      );
    }

    // Thumbnail + play button (always loads — no iframe until click)
    return (
      <div className="aspect-video bg-black rounded-xl overflow-hidden relative cursor-pointer group" onClick={() => setPlaying(true)}>
        {!thumbError ? (
          <img
            src={`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`}
            alt={title || 'Video thumbnail'}
            className="w-full h-full object-cover"
            onError={() => setThumbError(true)}
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-gray-800 to-gray-900" />
        )}
        {/* Dark overlay */}
        <div className="absolute inset-0 bg-black/30 group-hover:bg-black/20 transition-colors" />
        {/* Play button */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-16 h-16 sm:w-20 sm:h-20 bg-red-600 rounded-2xl flex items-center justify-center shadow-2xl group-hover:bg-red-500 group-hover:scale-110 transition-all">
            <svg className="w-8 h-8 sm:w-10 sm:h-10 text-white ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          </div>
        </div>
        {/* Title overlay */}
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
          <p className="text-white text-sm font-semibold truncate">{title}</p>
          <p className="text-gray-300 text-xs mt-0.5">Click to play</p>
        </div>
      </div>
    );
  }

  // Non-YouTube — HTML5 player
  return (
    <div className="aspect-video bg-black rounded-xl overflow-hidden">
      <video controls className="w-full h-full" src={videoUrl}>
        Your browser does not support video.
      </video>
    </div>
  );
}

/* ─── Shared components ─── */
function ProgressRing({ pct, size = 48 }) {
  const r = size * 0.44;
  const circ = 2 * Math.PI * r;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg className="-rotate-90" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="3" className="stroke-gray-200 dark:stroke-navy-light" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="3"
          strokeDasharray={circ} strokeDashoffset={circ - (circ * pct) / 100}
          strokeLinecap="round" className="stroke-ilo-blue transition-all duration-500" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold dark:text-white">{pct}%</span>
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-4 text-center">
      <p className="text-2xl font-bold dark:text-white">{value}</p>
      <p className={`text-[11px] font-semibold mt-1 px-2 py-0.5 rounded-full inline-block ${color}`}>{label}</p>
    </div>
  );
}

function SectionHeader({ children, action }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-sm font-bold dark:text-white">{children}</h3>
      {action}
    </div>
  );
}

function StarRating({ value, onChange, size = 'md' }) {
  const sz = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(s => (
        <button key={s} type="button" onClick={() => onChange?.(s)}
          className={`${sz} transition-colors ${s <= value ? 'text-amber-400' : 'text-gray-300 dark:text-gray-600'} ${onChange ? 'cursor-pointer hover:text-amber-300' : 'cursor-default'}`}>
          <svg fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
        </button>
      ))}
    </div>
  );
}

function DifficultyBadge({ level }) {
  const colors = {
    beginner: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    intermediate: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    advanced: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  };
  return (
    <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full capitalize ${colors[level] || colors.beginner}`}>
      {level || 'beginner'}
    </span>
  );
}

/* ─── Course sector taxonomy (NAVTTC-style major categories) ───
   Each course is automatically filed under a major sector tab from its trade /
   tags — so new courses appear under the right tab with no manual wiring. The
   two flagship trainings (Green Skills, Zigzag ToT) fall under "Training". */
const COURSE_SECTORS = [
  { key: 'training', label: 'Training', icon: '🎓',
    test: (p) => {
      const tags = (p.tags || []).map(t => String(t).toLowerCase());
      const tr = String(p.trade || '').toLowerCase();
      return tags.some(t => ['training of trainers', 'green skills', 'zigzag'].includes(t))
        || /green|zigzag|brick.?kiln|trainer/.test(tr);
    } },
  { key: 'construction', label: 'Construction & Building', icon: '🏗️',
    trades: ['mason', 'carpenter', 'shuttering', 'steel-fixer', 'tile', 'painter', 'scaffold', 'plumb', 'concrete', 'block', 'civil', 'earthwork'] },
  { key: 'electrical', label: 'Electrical & HVAC', icon: '⚡',
    trades: ['electric', 'hvac', 'ac-tech', 'refriger', 'insulation', 'duct', 'air-condition'] },
  { key: 'fabrication', label: 'Welding & Fabrication', icon: '🛠️',
    trades: ['weld', 'fabricat', 'pipe-fit', 'pipe', 'aluminium', 'sheet-metal', 'rigger'] },
  { key: 'automotive', label: 'Automotive & Heavy Equipment', icon: '🚜',
    trades: ['mechanic', 'auto', 'diesel', 'driver', 'heavy-equipment', 'crane', 'operator', 'transport', 'logistic'] },
  { key: 'hospitality', label: 'Hospitality & Services', icon: '🍽️',
    trades: ['cook', 'chef', 'hospitality', 'cater', 'housekeep', 'waiter'] },
  { key: 'safety', label: 'Health & Safety', icon: '🦺',
    trades: ['safety', 'hse', 'first-aid'], categories: ['safety'] },
];
const OTHER_SECTOR = { key: 'other', label: 'Other Programs', icon: '📚' };
const ALL_SECTORS = [...COURSE_SECTORS, OTHER_SECTOR];

function sectorOf(p) {
  const tr = String(p?.trade || '').toLowerCase();
  const cat = String(p?.category || '').toLowerCase();
  for (const s of COURSE_SECTORS) {
    if (s.test && s.test(p)) return s.key;
    if (s.trades && s.trades.some(k => tr.includes(k))) return s.key;
    if (s.categories && s.categories.includes(cat)) return s.key;
  }
  return OTHER_SECTOR.key;
}
const prettyTrade = (t) => String(t || '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

function TabButton({ active, onClick, children, count }) {
  return (
    <button onClick={onClick}
      className={`px-3 py-1.5 text-xs font-semibold transition-colors relative whitespace-nowrap shrink-0 ${active ? 'bg-ilo-blue text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-navy-light'}`}>
      {children}
      {count > 0 && (
        <span className="ml-1.5 px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-white/20">{count}</span>
      )}
    </button>
  );
}

/* ─── Quiz with score persistence (Gap 6: multi-type support) ─── */
function QuizView({ questions, programId, moduleId, workerId, onComplete, passMark = 70 }) {
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleAnswerChange = (index, value) => {
    setAnswers(a => ({ ...a, [index]: value }));
  };

  const handleSubmit = async () => {
    if (Object.keys(answers).length < questions.length) {
      return toast.error('Please answer all questions');
    }
    setSubmitting(true);
    try {
      // Build answers array based on question types
      const formattedAnswers = questions.map((q, i) => {
        const qType = q.type || 'mcq';
        const ans = answers[i];
        if (qType === 'mcq') return { selectedOption: ans };
        if (qType === 'true-false') return { answer: ans };
        if (qType === 'fill-blank') return { answer: ans };
        if (qType === 'matching') return { pairs: ans };
        if (qType === 'ordering') return { order: ans };
        if (qType === 'drag-drop') return { placements: ans };
        if (qType === 'short-answer' || qType === 'essay') return { answer: ans };
        if (qType === 'hotspot') return { coordinates: ans };
        return { selectedOption: ans };
      });

      const { data } = await api.post(`/training/${programId}/quiz/${moduleId}`, {
        workerId,
        answers: formattedAnswers,
      });
      setResult(data);
      setSubmitted(true);
      if (data.passed) {
        toast.success(`Passed: ${data.correctAnswers}/${data.totalQuestions} (${data.score}%)`);
      } else {
        toast.error(`Failed: ${data.correctAnswers}/${data.totalQuestions} (${data.score}%). Need ${data.passMark || passMark}%.`);
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to submit quiz');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-gray-500 dark:text-gray-400">{questions.length} questions</span>
        <span className="text-xs text-gray-400">|</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">Pass mark: {passMark}%</span>
        {questions.some(q => q.type && q.type !== 'mcq') && (
          <span className="text-xs text-violet-500 font-semibold ml-2">Multi-type quiz</span>
        )}
      </div>

      <div className="space-y-4">
        {questions.map((q, i) => (
          <QuizRenderer
            key={i}
            question={q}
            index={i}
            answer={answers[i]}
            onChange={(val) => handleAnswerChange(i, val)}
            disabled={submitted}
            showResult={submitted}
            isCorrect={result?.answers?.[i]?.isCorrect}
          />
        ))}
      </div>

      {!submitted ? (
        <button onClick={handleSubmit} disabled={submitting}
          className="px-6 py-2.5 text-sm font-semibold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark transition-colors disabled:opacity-50">
          {submitting ? 'Submitting...' : 'Submit Quiz'}
        </button>
      ) : (
        <div className="flex items-center gap-4">
          <div className={`px-4 py-2 rounded-xl text-sm font-bold text-white ${result.passed ? 'bg-green-500' : 'bg-red-500'}`}>
            Score: {result.correctAnswers}/{result.totalQuestions} ({result.score}%)
            {result.attemptNumber > 1 && <span className="ml-2 text-xs opacity-75">Attempt #{result.attemptNumber}</span>}
          </div>
          {result.passed ? (
            <button onClick={onComplete}
              className="px-6 py-2.5 text-sm font-semibold bg-green-600 text-white rounded-xl hover:bg-green-700 transition-colors">
              Continue
            </button>
          ) : (
            <button onClick={() => { setSubmitted(false); setAnswers({}); setResult(null); }}
              className="px-6 py-2.5 text-sm font-semibold bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition-colors">
              Retry Quiz
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Module editor (admin/institution) ─── */
function ModuleEditor({ programId, existingModule, onSaved, onCancel }) {
  const [form, setForm] = useState(existingModule || {
    title: '', type: 'video', description: '', duration: 30, videoUrl: '', content: '', quizQuestions: [], deadline: '',
  });
  const [saving, setSaving] = useState(false);

  const addQuestion = (type = 'mcq') => {
    const base = { question: '', type, points: 1, difficulty: 'medium' };
    if (type === 'mcq') Object.assign(base, { options: ['', '', '', ''], correctOption: 0 });
    else if (type === 'true-false') base.correctAnswer = 'true';
    else if (type === 'fill-blank') Object.assign(base, { acceptableAnswers: [''], caseSensitive: false });
    else if (type === 'matching') base.matchPairs = [{ left: '', right: '' }];
    else if (type === 'ordering') base.correctOrder = [''];
    else if (type === 'short-answer') Object.assign(base, { acceptableAnswers: [''], caseSensitive: false });
    else if (type === 'essay') base.essayRubric = '';
    else if (type === 'drag-drop') Object.assign(base, { dropZones: [{ id: 'z1', label: '', accepts: [] }], draggables: [{ id: 'd1', text: '', correctZone: 'z1' }] });
    else if (type === 'hotspot') Object.assign(base, { hotspotImage: '', hotspotRegions: [] });
    setForm(f => ({ ...f, quizQuestions: [...(f.quizQuestions || []), base] }));
  };

  const updateQuestion = (qi, field, value) => {
    setForm(f => {
      const qs = [...f.quizQuestions];
      if (field === 'question') qs[qi].question = value;
      else if (field === 'correctOption') qs[qi].correctOption = Number(value);
      return { ...f, quizQuestions: qs };
    });
  };

  const updateOption = (qi, oi, value) => {
    setForm(f => {
      const qs = [...f.quizQuestions];
      qs[qi].options[oi] = value;
      return { ...f, quizQuestions: qs };
    });
  };

  const removeQuestion = (qi) => {
    setForm(f => ({ ...f, quizQuestions: f.quizQuestions.filter((_, i) => i !== qi) }));
  };

  const handleSave = async () => {
    if (!form.title.trim()) return toast.error('Module title is required');
    setSaving(true);
    try {
      if (existingModule?._id) {
        await api.put(`/training/${programId}/modules/${existingModule._id}`, form);
        toast.success('Module updated');
      } else {
        await api.post(`/training/${programId}/modules`, form);
        toast.success('Module added');
      }
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save module');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 p-4 bg-gray-50 dark:bg-navy-light rounded-xl border border-border dark:border-navy-light">
      <h4 className="text-sm font-bold dark:text-white">{existingModule?._id ? 'Edit Module' : 'Add Module'}</h4>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
          placeholder="Module title" className="p-2 text-sm rounded-lg border border-border dark:border-navy-light dark:bg-navy-mid dark:text-white" />
        <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
          className="p-2 text-sm rounded-lg border border-border dark:border-navy-light dark:bg-navy-mid dark:text-white">
          <option value="video">Video</option>
          <option value="reading">Reading</option>
          <option value="quiz">Quiz</option>
          <option value="practical">Practical</option>
          <option value="assignment">Assignment</option>
          <option value="scenario">Scenario</option>
          <option value="scorm">SCORM Package</option>
        </select>
        <input type="date" value={form.deadline ? form.deadline.split('T')[0] : ''}
          onChange={e => setForm(f => ({ ...f, deadline: e.target.value ? new Date(e.target.value).toISOString() : '' }))}
          placeholder="Deadline (optional)" className="p-2 text-sm rounded-lg border border-border dark:border-navy-light dark:bg-navy-mid dark:text-white" />
      </div>

      <textarea value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
        placeholder="Description" rows={2}
        className="w-full p-2 text-sm rounded-lg border border-border dark:border-navy-light dark:bg-navy-mid dark:text-white" />

      {(form.type === 'reading' || form.type === 'assignment') && (
        <textarea value={form.content || ''} onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
          placeholder="Rich content (supports markdown-style text)" rows={5}
          className="w-full p-2 text-sm rounded-lg border border-border dark:border-navy-light dark:bg-navy-mid dark:text-white font-mono" />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input type="number" value={form.duration || ''} onChange={e => setForm(f => ({ ...f, duration: Number(e.target.value) }))}
          placeholder="Duration (minutes)" className="p-2 text-sm rounded-lg border border-border dark:border-navy-light dark:bg-navy-mid dark:text-white" />
        {form.type === 'video' && (
          <input value={form.videoUrl || ''} onChange={e => setForm(f => ({ ...f, videoUrl: e.target.value }))}
            placeholder="Video URL" className="p-2 text-sm rounded-lg border border-border dark:border-navy-light dark:bg-navy-mid dark:text-white" />
        )}
      </div>

      {form.type === 'scorm' && (
        <div className="p-4 bg-violet-50 dark:bg-violet-900/10 rounded-lg border border-violet-200 dark:border-violet-800">
          <p className="text-sm font-semibold text-violet-800 dark:text-violet-300 mb-2">SCORM Package Upload</p>
          <p className="text-xs text-gray-500 mb-3">Upload a SCORM 1.2 or 2004 ZIP package. The manifest will be parsed automatically.</p>
          <input type="file" accept=".zip" onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (!programId || !existingModule?._id) {
              toast.error('Save the module first, then upload the SCORM package');
              return;
            }
            const fd = new FormData();
            fd.append('scormPackage', file);
            fd.append('programId', programId);
            fd.append('moduleId', existingModule._id);
            try {
              const { data } = await api.post('/scorm/upload', fd, {
                headers: { 'Content-Type': 'multipart/form-data' },
              });
              toast.success(`SCORM ${data.scormVersion} package uploaded: ${data.title}`);
              onSaved();
            } catch (err) {
              toast.error(err.response?.data?.error || 'Failed to upload SCORM package');
            }
          }} className="text-sm" />
        </div>
      )}

      {form.type === 'quiz' && (
        <div className="space-y-3">
          <SectionHeader>Quiz Questions ({form.quizQuestions?.length || 0})</SectionHeader>
          {(form.quizQuestions || []).map((q, qi) => (
            <div key={qi} className="p-3 bg-white dark:bg-navy-mid rounded-lg border border-border dark:border-navy-light space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-gray-400">Q{qi + 1}</span>
                <select value={q.type || 'mcq'} onChange={e => {
                  setForm(f => {
                    const qs = [...f.quizQuestions];
                    qs[qi] = { ...qs[qi], type: e.target.value };
                    return { ...f, quizQuestions: qs };
                  });
                }} className="p-1 text-xs rounded border border-border dark:border-navy-light dark:bg-navy-light dark:text-white">
                  <option value="mcq">MCQ</option>
                  <option value="true-false">True/False</option>
                  <option value="fill-blank">Fill Blank</option>
                  <option value="matching">Matching</option>
                  <option value="ordering">Ordering</option>
                  <option value="drag-drop">Drag & Drop</option>
                  <option value="short-answer">Short Answer</option>
                  <option value="essay">Essay</option>
                  <option value="hotspot">Hotspot</option>
                </select>
                <input value={q.question} onChange={e => updateQuestion(qi, 'question', e.target.value)}
                  placeholder="Question text" className="flex-1 p-1.5 text-sm rounded border border-border dark:border-navy-light dark:bg-navy-light dark:text-white" />
                <button onClick={() => removeQuestion(qi)} className="text-red-500 hover:text-red-700 text-xs font-bold px-2">X</button>
              </div>

              {/* MCQ options */}
              {(!q.type || q.type === 'mcq') && (q.options || []).map((opt, oi) => (
                <div key={oi} className="flex items-center gap-2 ml-6">
                  <input type="radio" name={`correct-${qi}`} checked={q.correctOption === oi}
                    onChange={() => updateQuestion(qi, 'correctOption', oi)} className="accent-green-600" />
                  <input value={opt} onChange={e => updateOption(qi, oi, e.target.value)}
                    placeholder={`Option ${oi + 1}`} className="flex-1 p-1.5 text-sm rounded border border-border dark:border-navy-light dark:bg-navy-light dark:text-white" />
                </div>
              ))}

              {/* True/False */}
              {q.type === 'true-false' && (
                <div className="ml-6 flex gap-4">
                  <label className="text-sm dark:text-gray-300"><input type="radio" name={`tf-${qi}`} checked={q.correctAnswer === 'true'}
                    onChange={() => updateQuestion(qi, 'correctAnswer', 'true')} className="mr-1 accent-green-600" />True (correct)</label>
                  <label className="text-sm dark:text-gray-300"><input type="radio" name={`tf-${qi}`} checked={q.correctAnswer === 'false'}
                    onChange={() => updateQuestion(qi, 'correctAnswer', 'false')} className="mr-1 accent-green-600" />False (correct)</label>
                </div>
              )}

              {/* Fill-blank / Short-answer acceptable answers */}
              {(q.type === 'fill-blank' || q.type === 'short-answer') && (
                <div className="ml-6 space-y-1">
                  <p className="text-[10px] text-gray-400 font-semibold uppercase">Acceptable Answers</p>
                  {(q.acceptableAnswers || ['']).map((a, ai) => (
                    <input key={ai} value={a} onChange={e => {
                      setForm(f => {
                        const qs = [...f.quizQuestions];
                        const answers = [...(qs[qi].acceptableAnswers || [''])];
                        answers[ai] = e.target.value;
                        qs[qi] = { ...qs[qi], acceptableAnswers: answers };
                        return { ...f, quizQuestions: qs };
                      });
                    }} placeholder={`Answer ${ai + 1}`}
                    className="w-full p-1.5 text-sm rounded border border-border dark:border-navy-light dark:bg-navy-light dark:text-white" />
                  ))}
                  <button onClick={() => {
                    setForm(f => {
                      const qs = [...f.quizQuestions];
                      qs[qi] = { ...qs[qi], acceptableAnswers: [...(qs[qi].acceptableAnswers || []), ''] };
                      return { ...f, quizQuestions: qs };
                    });
                  }} className="text-xs text-ilo-blue hover:underline">+ Add alternative</button>
                </div>
              )}

              {/* Matching pairs */}
              {q.type === 'matching' && (
                <div className="ml-6 space-y-1">
                  <p className="text-[10px] text-gray-400 font-semibold uppercase">Match Pairs</p>
                  {(q.matchPairs || []).map((pair, pi) => (
                    <div key={pi} className="flex gap-2">
                      <input value={pair.left || ''} onChange={e => {
                        setForm(f => {
                          const qs = [...f.quizQuestions];
                          const pairs = [...(qs[qi].matchPairs || [])];
                          pairs[pi] = { ...pairs[pi], left: e.target.value };
                          qs[qi] = { ...qs[qi], matchPairs: pairs };
                          return { ...f, quizQuestions: qs };
                        });
                      }} placeholder="Left" className="flex-1 p-1.5 text-sm rounded border border-border dark:border-navy-light dark:bg-navy-light dark:text-white" />
                      <span className="text-gray-400 self-center">=</span>
                      <input value={pair.right || ''} onChange={e => {
                        setForm(f => {
                          const qs = [...f.quizQuestions];
                          const pairs = [...(qs[qi].matchPairs || [])];
                          pairs[pi] = { ...pairs[pi], right: e.target.value };
                          qs[qi] = { ...qs[qi], matchPairs: pairs };
                          return { ...f, quizQuestions: qs };
                        });
                      }} placeholder="Right" className="flex-1 p-1.5 text-sm rounded border border-border dark:border-navy-light dark:bg-navy-light dark:text-white" />
                    </div>
                  ))}
                  <button onClick={() => {
                    setForm(f => {
                      const qs = [...f.quizQuestions];
                      qs[qi] = { ...qs[qi], matchPairs: [...(qs[qi].matchPairs || []), { left: '', right: '' }] };
                      return { ...f, quizQuestions: qs };
                    });
                  }} className="text-xs text-ilo-blue hover:underline">+ Add pair</button>
                </div>
              )}

              {/* Ordering items */}
              {q.type === 'ordering' && (
                <div className="ml-6 space-y-1">
                  <p className="text-[10px] text-gray-400 font-semibold uppercase">Correct Order (top to bottom)</p>
                  {(q.correctOrder || ['']).map((item, ii) => (
                    <div key={ii} className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 w-4">{ii + 1}.</span>
                      <input value={item} onChange={e => {
                        setForm(f => {
                          const qs = [...f.quizQuestions];
                          const order = [...(qs[qi].correctOrder || [''])];
                          order[ii] = e.target.value;
                          qs[qi] = { ...qs[qi], correctOrder: order };
                          return { ...f, quizQuestions: qs };
                        });
                      }} placeholder={`Item ${ii + 1}`}
                      className="flex-1 p-1.5 text-sm rounded border border-border dark:border-navy-light dark:bg-navy-light dark:text-white" />
                    </div>
                  ))}
                  <button onClick={() => {
                    setForm(f => {
                      const qs = [...f.quizQuestions];
                      qs[qi] = { ...qs[qi], correctOrder: [...(qs[qi].correctOrder || []), ''] };
                      return { ...f, quizQuestions: qs };
                    });
                  }} className="text-xs text-ilo-blue hover:underline">+ Add item</button>
                </div>
              )}

              {/* Essay rubric */}
              {q.type === 'essay' && (
                <div className="ml-6">
                  <textarea value={q.essayRubric || ''} onChange={e => {
                    setForm(f => {
                      const qs = [...f.quizQuestions];
                      qs[qi] = { ...qs[qi], essayRubric: e.target.value };
                      return { ...f, quizQuestions: qs };
                    });
                  }} placeholder="Essay rubric / grading criteria" rows={2}
                  className="w-full p-1.5 text-sm rounded border border-border dark:border-navy-light dark:bg-navy-light dark:text-white" />
                </div>
              )}
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => addQuestion('mcq')}
              className="text-sm text-ilo-blue hover:underline font-semibold">+ MCQ</button>
            <button onClick={() => addQuestion('true-false')}
              className="text-sm text-green-600 hover:underline font-semibold">+ True/False</button>
            <button onClick={() => addQuestion('fill-blank')}
              className="text-sm text-violet-600 hover:underline font-semibold">+ Fill Blank</button>
            <button onClick={() => addQuestion('matching')}
              className="text-sm text-amber-600 hover:underline font-semibold">+ Matching</button>
            <button onClick={() => addQuestion('ordering')}
              className="text-sm text-cyan-600 hover:underline font-semibold">+ Ordering</button>
            <button onClick={() => addQuestion('short-answer')}
              className="text-sm text-rose-600 hover:underline font-semibold">+ Short Answer</button>
            <button onClick={() => addQuestion('essay')}
              className="text-sm text-indigo-600 hover:underline font-semibold">+ Essay</button>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={handleSave} disabled={saving}
          className="px-4 py-2 text-sm font-semibold bg-ilo-blue text-white rounded-lg hover:bg-ilo-dark disabled:opacity-50">
          {saving ? 'Saving...' : 'Save Module'}
        </button>
        <button onClick={onCancel}
          className="px-4 py-2 text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-navy-mid rounded-lg">
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ─── Notifications bell ─── */
function NotificationBell({ notifications, onMarkRead }) {
  const [open, setOpen] = useState(false);
  const bellRef = useRef(null);
  const unread = notifications.filter(n => !n.read).length;

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (bellRef.current && !bellRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (notifications.length === 0) return null;

  const typeIcon = { enrollment: 'E', 'module-complete': 'M', 'quiz-passed': 'P', 'quiz-failed': 'F', 'course-complete': 'C', 'certificate-issued': 'D', announcement: 'A', 'discussion-reply': 'R' };
  const typeColor = { enrollment: 'bg-blue-100 text-blue-600', 'module-complete': 'bg-green-100 text-green-600', 'quiz-passed': 'bg-green-100 text-green-600', 'quiz-failed': 'bg-red-100 text-red-600', 'course-complete': 'bg-gold-light/20 text-gold-light', 'certificate-issued': 'bg-purple-100 text-purple-600', announcement: 'bg-amber-100 text-amber-600', 'discussion-reply': 'bg-indigo-100 text-indigo-600' };

  return (
    <div className="relative" ref={bellRef}>
      <button onClick={() => setOpen(!open)}
        className="relative p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-navy-light transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 max-h-80 overflow-y-auto bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light shadow-xl z-50">
          <div className="p-3 border-b border-border dark:border-navy-light">
            <p className="text-xs font-bold dark:text-white">Notifications ({unread} unread)</p>
          </div>
          {notifications.slice(0, 20).map(n => (
            <div key={n._id} onClick={() => { if (!n.read) onMarkRead(n.programId, n._id); }}
              className={`p-3 border-b border-border/50 dark:border-navy-light/50 cursor-pointer hover:bg-gray-50 dark:hover:bg-navy-light ${!n.read ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''}`}>
              <div className="flex items-start gap-2">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${typeColor[n.type] || 'bg-gray-100 text-gray-600'}`}>
                  {typeIcon[n.type] || 'N'}
                </span>
                <div className="min-w-0">
                  <p className="text-xs dark:text-gray-300 leading-relaxed">{n.message}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{new Date(n.createdAt).toLocaleDateString()}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Discussion Panel ─── */
function DiscussionPanel({ programId, discussions, onRefresh, isAdmin }) {
  const [message, setMessage] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [replyMsg, setReplyMsg] = useState('');
  const [posting, setPosting] = useState(false);

  const sorted = useMemo(() => {
    const pinned = (discussions || []).filter(d => d.pinned);
    const unpinned = (discussions || []).filter(d => !d.pinned);
    return [...pinned, ...unpinned.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))];
  }, [discussions]);

  const handlePost = async () => {
    if (!message.trim()) return;
    setPosting(true);
    try {
      await api.post(`/training/${programId}/discussions`, { message });
      setMessage('');
      toast.success('Posted');
      onRefresh();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to post');
    } finally {
      setPosting(false);
    }
  };

  const handleReply = async (discussionId) => {
    if (!replyMsg.trim()) return;
    setPosting(true);
    try {
      await api.post(`/training/${programId}/discussions/${discussionId}/reply`, { message: replyMsg });
      setReplyMsg('');
      setReplyTo(null);
      toast.success('Reply posted');
      onRefresh();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to reply');
    } finally {
      setPosting(false);
    }
  };

  const handlePin = async (discussionId) => {
    try {
      await api.put(`/training/${programId}/discussions/${discussionId}/pin`);
      onRefresh();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to toggle pin');
    }
  };

  const roleColor = { admin: 'text-red-600', institution: 'text-purple-600', assessor: 'text-amber-600', worker: 'text-ilo-blue' };

  return (
    <div className="space-y-4">
      {/* New post */}
      <div className="flex gap-2">
        <input value={message} onChange={e => setMessage(e.target.value)}
          placeholder="Start a discussion..." maxLength={2000}
          onKeyDown={e => e.key === 'Enter' && handlePost()}
          className="flex-1 p-2.5 text-sm rounded-xl border border-border dark:border-navy-light dark:bg-navy-mid dark:text-white" />
        <button onClick={handlePost} disabled={posting || !message.trim()}
          className="px-4 py-2 text-sm font-semibold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark disabled:opacity-50 shrink-0">
          Post
        </button>
      </div>

      {/* Threads */}
      {sorted.length === 0 && (
        <p className="text-center text-xs text-gray-400 py-6">No discussions yet. Be the first to post!</p>
      )}
      {sorted.map(d => (
        <div key={d._id} className={`p-4 rounded-xl border ${d.pinned ? 'border-amber-300 bg-amber-50/50 dark:bg-amber-900/10 dark:border-amber-700' : 'border-border dark:border-navy-light'}`}>
          <div className="flex items-start gap-2">
            <div className="w-8 h-8 rounded-full bg-ilo-blue/10 flex items-center justify-center text-xs font-bold text-ilo-blue shrink-0">
              {d.authorName?.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold dark:text-white">{d.authorName}</span>
                <span className={`text-[10px] font-bold capitalize ${roleColor[d.authorRole] || 'text-gray-500'}`}>{d.authorRole}</span>
                {d.pinned && <span className="text-[10px] font-bold text-amber-600">Pinned</span>}
                <span className="text-[10px] text-gray-400 ml-auto">{new Date(d.createdAt).toLocaleDateString()}</span>
              </div>
              <p className="text-sm text-gray-700 dark:text-gray-300 mt-1 whitespace-pre-wrap">{d.message}</p>

              <div className="flex items-center gap-3 mt-2">
                <button onClick={() => setReplyTo(replyTo === d._id ? null : d._id)}
                  className="text-[11px] text-ilo-blue font-semibold hover:underline">
                  Reply ({d.replies?.length || 0})
                </button>
                {isAdmin && (
                  <button onClick={() => handlePin(d._id)}
                    className="text-[11px] text-amber-600 font-semibold hover:underline">
                    {d.pinned ? 'Unpin' : 'Pin'}
                  </button>
                )}
              </div>

              {/* Replies */}
              {d.replies?.length > 0 && (
                <div className="mt-3 space-y-2 pl-4 border-l-2 border-gray-200 dark:border-navy-light">
                  {d.replies.map((r, ri) => (
                    <div key={r._id || ri} className="text-xs">
                      <span className="font-semibold dark:text-white">{r.authorName}</span>
                      <span className={`ml-1 text-[10px] capitalize ${roleColor[r.authorRole] || 'text-gray-400'}`}>{r.authorRole}</span>
                      <span className="text-gray-400 ml-2">{new Date(r.createdAt).toLocaleDateString()}</span>
                      <p className="text-gray-600 dark:text-gray-400 mt-0.5">{r.message}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Reply input */}
              {replyTo === d._id && (
                <div className="flex gap-2 mt-2">
                  <input value={replyMsg} onChange={e => setReplyMsg(e.target.value)}
                    placeholder="Write a reply..." maxLength={1000}
                    onKeyDown={e => e.key === 'Enter' && handleReply(d._id)}
                    className="flex-1 p-2 text-xs rounded-lg border border-border dark:border-navy-light dark:bg-navy-mid dark:text-white" />
                  <button onClick={() => handleReply(d._id)} disabled={posting || !replyMsg.trim()}
                    className="px-3 py-1.5 text-xs font-semibold bg-ilo-blue text-white rounded-lg disabled:opacity-50">
                    Reply
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Announcements Panel ─── */
function AnnouncementsPanel({ programId, announcements, isAdmin, onRefresh }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', message: '', priority: 'normal' });
  const [posting, setPosting] = useState(false);

  const handlePost = async () => {
    if (!form.title.trim() || !form.message.trim()) return toast.error('Title and message are required');
    setPosting(true);
    try {
      await api.post(`/training/${programId}/announcements`, form);
      setForm({ title: '', message: '', priority: 'normal' });
      setShowForm(false);
      toast.success('Announcement posted');
      onRefresh();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to post');
    } finally {
      setPosting(false);
    }
  };

  const handleDelete = async (annId) => {
    if (!confirm('Delete this announcement?')) return;
    try {
      await api.delete(`/training/${programId}/announcements/${annId}`);
      toast.success('Deleted');
      onRefresh();
    } catch { toast.error('Failed to delete'); }
  };

  const priorityColors = { urgent: 'border-red-400 bg-red-50 dark:bg-red-900/10', important: 'border-amber-400 bg-amber-50 dark:bg-amber-900/10', normal: 'border-border dark:border-navy-light' };
  const priorityBadge = { urgent: 'bg-red-100 text-red-700', important: 'bg-amber-100 text-amber-700', normal: 'bg-gray-100 text-gray-600' };

  return (
    <div className="space-y-4">
      {isAdmin && !showForm && (
        <button onClick={() => setShowForm(true)}
          className="px-4 py-2 text-sm font-semibold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark transition-colors">
          + New Announcement
        </button>
      )}

      {showForm && (
        <div className="p-4 rounded-xl border border-border dark:border-navy-light space-y-3">
          <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            placeholder="Announcement title" maxLength={200}
            className="w-full p-2 text-sm rounded-lg border border-border dark:border-navy-light dark:bg-navy-mid dark:text-white" />
          <textarea value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
            placeholder="Announcement message" rows={3} maxLength={3000}
            className="w-full p-2 text-sm rounded-lg border border-border dark:border-navy-light dark:bg-navy-mid dark:text-white" />
          <div className="flex items-center gap-3">
            <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
              className="p-2 text-sm rounded-lg border border-border dark:border-navy-light dark:bg-navy-mid dark:text-white">
              <option value="normal">Normal</option>
              <option value="important">Important</option>
              <option value="urgent">Urgent</option>
            </select>
            <button onClick={handlePost} disabled={posting}
              className="px-4 py-2 text-sm font-semibold bg-ilo-blue text-white rounded-lg disabled:opacity-50">Post</button>
            <button onClick={() => setShowForm(false)}
              className="px-4 py-2 text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-navy-light rounded-lg">Cancel</button>
          </div>
        </div>
      )}

      {(!announcements || announcements.length === 0) && (
        <p className="text-center text-xs text-gray-400 py-6">No announcements yet</p>
      )}
      {(announcements || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(a => (
        <div key={a._id} className={`p-4 rounded-xl border ${priorityColors[a.priority]}`}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h4 className="text-sm font-bold dark:text-white">{a.title}</h4>
                {a.priority !== 'normal' && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${priorityBadge[a.priority]}`}>{a.priority}</span>
                )}
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{a.message}</p>
              <p className="text-[10px] text-gray-400 mt-2">By {a.authorName} — {new Date(a.createdAt).toLocaleDateString()}</p>
            </div>
            {isAdmin && (
              <button onClick={() => handleDelete(a._id)} className="text-red-400 hover:text-red-600 text-xs shrink-0">Del</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Rating Panel ─── */
function RatingPanel({ programId, ratings, avgRating, myWorkerId, onRefresh }) {
  const [score, setScore] = useState(0);
  const [review, setReview] = useState('');
  const [posting, setPosting] = useState(false);

  const myRating = ratings?.find(r => r.worker === myWorkerId);

  useEffect(() => {
    if (myRating) {
      setScore(myRating.score);
      setReview(myRating.review || '');
    }
  }, [myRating]);

  const handleSubmit = async () => {
    if (score === 0) return toast.error('Please select a rating');
    setPosting(true);
    try {
      await api.post(`/training/${programId}/ratings`, { score, review });
      toast.success(myRating ? 'Rating updated' : 'Rating submitted');
      onRefresh();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to submit');
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Average rating */}
      <div className="flex items-center gap-4 p-4 bg-gray-50 dark:bg-navy-light rounded-xl">
        <div className="text-center">
          <p className="text-3xl font-bold dark:text-white">{avgRating || 0}</p>
          <StarRating value={Math.round(avgRating || 0)} size="sm" />
          <p className="text-[10px] text-gray-500 mt-1">{ratings?.length || 0} ratings</p>
        </div>
        <div className="flex-1">
          {[5, 4, 3, 2, 1].map(s => {
            const count = ratings?.filter(r => r.score === s).length || 0;
            const pct = ratings?.length > 0 ? Math.round(count / ratings.length * 100) : 0;
            return (
              <div key={s} className="flex items-center gap-2 text-xs">
                <span className="w-3 text-gray-500">{s}</span>
                <div className="flex-1 h-2 bg-gray-200 dark:bg-navy-mid rounded-full overflow-hidden">
                  <div className="h-full bg-amber-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
                <span className="w-6 text-right text-gray-400">{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Submit rating */}
      {myWorkerId && (
        <div className="p-4 rounded-xl border border-border dark:border-navy-light space-y-3">
          <p className="text-sm font-semibold dark:text-white">{myRating ? 'Update your rating' : 'Rate this course'}</p>
          <StarRating value={score} onChange={setScore} />
          <textarea value={review} onChange={e => setReview(e.target.value)}
            placeholder="Write a review (optional)" rows={2} maxLength={500}
            className="w-full p-2 text-sm rounded-lg border border-border dark:border-navy-light dark:bg-navy-mid dark:text-white" />
          <button onClick={handleSubmit} disabled={posting || score === 0}
            className="px-4 py-2 text-sm font-semibold bg-ilo-blue text-white rounded-lg disabled:opacity-50">
            {posting ? 'Submitting...' : myRating ? 'Update Rating' : 'Submit Rating'}
          </button>
        </div>
      )}

      {/* Reviews */}
      {(ratings || []).filter(r => r.review).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(r => (
        <div key={r._id} className="p-3 rounded-xl border border-border dark:border-navy-light">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold dark:text-white">{r.workerName || 'Worker'}</span>
            <StarRating value={r.score} size="sm" />
            <span className="text-[10px] text-gray-400 ml-auto">{new Date(r.createdAt).toLocaleDateString()}</span>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-400">{r.review}</p>
        </div>
      ))}
    </div>
  );
}

/* ─── Module Pre-Check Modal ─── */
function ModulePreCheck({ questions, programId, moduleId, workerId, passMark, onPass, onFail, onClose }) {
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (Object.keys(answers).length < questions.length) {
      return toast.error('Please answer all questions');
    }
    setSubmitting(true);
    try {
      const { data } = await api.post(`/training/${programId}/pre-check/${moduleId}`, {
        workerId,
        answers: questions.map((_, i) => answers[i] ?? -1),
      });
      setResult(data);
      setSubmitted(true);
      if (data.passed) {
        toast.success(`Pre-check passed with ${data.score}%! Module skipped.`);
      } else {
        toast.error(`Scored ${data.score}%. Need ${data.passMark}%. Opening module...`);
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Pre-check failed');
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-navy-mid rounded-2xl border border-border dark:border-navy-light max-w-lg w-full max-h-[80vh] overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold dark:text-white">Module Pre-Check</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">&times;</button>
        </div>
        <p className="text-xs text-gray-500">Score {passMark}%+ to skip this module. {questions.length} questions.</p>

        {!submitted ? (
          <>
            {questions.map((q, qi) => (
              <div key={qi} className="p-3 bg-gray-50 dark:bg-navy-light rounded-xl space-y-2">
                <p className="text-sm font-medium dark:text-white">{qi + 1}. {q.question}</p>
                {(q.options || []).map((opt, oi) => (
                  <label key={oi} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                    <input type="radio" name={`precheck-${qi}`} checked={answers[qi] === oi}
                      onChange={() => setAnswers(a => ({ ...a, [qi]: oi }))} className="accent-ilo-blue" />
                    {opt}
                  </label>
                ))}
              </div>
            ))}
            <button onClick={handleSubmit} disabled={submitting}
              className="w-full px-4 py-2.5 text-sm font-semibold bg-violet-600 text-white rounded-xl hover:bg-violet-700 disabled:opacity-50 transition-colors">
              {submitting ? 'Checking...' : 'Submit Pre-Check'}
            </button>
          </>
        ) : (
          <div className="text-center py-4">
            <p className={`text-lg font-bold ${result.passed ? 'text-green-600' : 'text-red-500'}`}>
              {result.score}% ({result.correct}/{result.total})
            </p>
            <p className="text-sm text-gray-500 mt-1">
              {result.passed ? 'Module skipped! You already know this material.' : `Need ${result.passMark}% to skip. Opening module...`}
            </p>
            <button onClick={() => result.passed ? onPass() : onFail()}
              className={`mt-4 px-6 py-2.5 text-sm font-semibold text-white rounded-xl transition-colors ${result.passed ? 'bg-green-600 hover:bg-green-700' : 'bg-ilo-blue hover:bg-ilo-dark'}`}>
              {result.passed ? 'Continue' : 'Open Module'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Instructor Dashboard (admin/institution/assessor) ─── */
function InstructorDashboard() {
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/training/analytics/overview');
        setAnalytics(data);
      } catch {
        toast.error('Failed to load analytics');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-ilo-blue border-t-transparent rounded-full" /></div>;
  if (!analytics) return null;

  const { overview, byTrade, programs } = analytics;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Programs" value={overview.totalPrograms} color="bg-ilo-blue/10 text-ilo-blue" />
        <StatCard label="Enrollments" value={overview.totalEnrollments} color="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" />
        <StatCard label="Completion Rate" value={`${overview.completionRate}%`} color="bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" />
        <StatCard label="Certificates" value={overview.certificatesIssued} color="bg-gold-light/10 text-gold-light" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="In Progress" value={overview.inProgressEnrollments} color="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" />
        <StatCard label="Completed" value={overview.completedEnrollments} color="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" />
        <StatCard label="Quiz Pass Rate" value={`${overview.quizPassRate}%`} color="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" />
        <StatCard label="Submissions" value={overview.totalSubmissions || 0} color="bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400" />
      </div>

      <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-4">
        <SectionHeader>Performance by Trade</SectionHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b border-border dark:border-navy-light">
                <th className="pb-2 font-semibold">Trade</th>
                <th className="pb-2 font-semibold text-center">Programs</th>
                <th className="pb-2 font-semibold text-center">Enrolled</th>
                <th className="pb-2 font-semibold text-center">Completed</th>
                <th className="pb-2 font-semibold text-center">Rate</th>
              </tr>
            </thead>
            <tbody>
              {byTrade.map(t => (
                <tr key={t.trade} className="border-b border-border/50 dark:border-navy-light/50">
                  <td className="py-2.5 font-medium dark:text-white capitalize">{t.trade}</td>
                  <td className="py-2.5 text-center text-gray-600 dark:text-gray-400">{t.programs}</td>
                  <td className="py-2.5 text-center text-gray-600 dark:text-gray-400">{t.enrolled}</td>
                  <td className="py-2.5 text-center text-gray-600 dark:text-gray-400">{t.completed}</td>
                  <td className="py-2.5 text-center">
                    <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${t.completionRate >= 70 ? 'bg-green-100 text-green-700' : t.completionRate >= 40 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                      {t.completionRate}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-4">
        <SectionHeader>Program Performance</SectionHeader>
        <div className="space-y-3">
          {programs.map(p => (
            <div key={p._id} className="flex items-center gap-3 p-3 rounded-xl border border-border dark:border-navy-light">
              <ProgressRing pct={p.completionRate} size={44} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium dark:text-white truncate">{p.title}</p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  {p.enrolled} enrolled &bull; {p.completed} completed &bull; {p.totalModules} modules
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs dark:text-gray-300">Avg: {p.avgProgress}%</p>
                <p className="text-[10px] text-gray-500">Quiz pass: {p.quizPassRate}%</p>
                {p.avgRating > 0 && (
                  <div className="flex items-center gap-1 justify-end">
                    <StarRating value={Math.round(p.avgRating)} size="sm" />
                    <span className="text-[10px] text-gray-400">{p.avgRating}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MAIN LMS COMPONENT
   ═══════════════════════════════════════════════════════════ */
export default function LMS() {
  const { t } = useLang();
  const { user } = useAuth();
  const [programs, setPrograms] = useState([]);
  const [myCourses, setMyCourses] = useState([]);
  const [selected, setSelected] = useState(null);
  const [activeModule, setActiveModule] = useState(null);
  const [myWorkerId, setMyWorkerId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [editingModule, setEditingModule] = useState(null);
  const [submissionNotes, setSubmissionNotes] = useState('');
  const [showSubmitForm, setShowSubmitForm] = useState(null); // moduleId or null
  const [showAIPanel, setShowAIPanel] = useState(false);
  const [preSelectedPathway, setPreSelectedPathway] = useState(null);
  const [pathwaySourceCourse, setPathwaySourceCourse] = useState(null);
  const [showAIGenerate, setShowAIGenerate] = useState(false);
  const [showPreAssessment, setShowPreAssessment] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [submittingEval, setSubmittingEval] = useState(false);
  const [adaptivePath, setAdaptivePath] = useState(null);
  const [loadingAI, setLoadingAI] = useState({});
  const [freshnessResults, setFreshnessResults] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => {
    const urlTab = searchParams.get('tab');
    return ['catalog', 'mylearning', 'training', 'pathways', 'achievements', 'dashboard', 'transcript'].includes(urlTab) ? urlTab : 'catalog';
  });
  const [programTab, setProgramTab] = useState('modules');     // modules | discussions | announcements | ratings
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterTrade, setFilterTrade] = useState('');
  const [filterDifficulty, setFilterDifficulty] = useState('');
  const [filterFramework, setFilterFramework] = useState('navttc'); // main tab: navttc | gulf | archived
  const [activeSector, setActiveSector] = useState('training');   // sector sub-tab
  const [activeSubTrade, setActiveSubTrade] = useState('');        // (unused now — trades folded into sectors)
  const [rowBusy, setRowBusy] = useState('');                     // course id being archived/removed
  // Time tracking state
  const [moduleStartTime, setModuleStartTime] = useState(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef(null);
  // Module pre-check state
  const [showModulePreCheck, setShowModulePreCheck] = useState(null); // moduleId or null
  // Evidence upload state
  const [uploadFiles, setUploadFiles] = useState([]);
  const [evidenceType, setEvidenceType] = useState('other');
  // ─── Knowledge check state ───
  const [kcAnswers, setKcAnswers] = useState({});
  const [kcSubmitting, setKcSubmitting] = useState(false);
  const [kcResult, setKcResult] = useState(null);
  // ─── Self-assessment state ───
  const [selfAssessScores, setSelfAssessScores] = useState({});

  const debounceRef = useRef(null);
  const isWorker = user?.role === 'worker';
  const isAdmin = ['admin', 'institution', 'assessor'].includes(user?.role);

  // Sync tab from URL search params
  useEffect(() => {
    const urlTab = searchParams.get('tab');
    if (urlTab && ['catalog', 'mylearning', 'training', 'pathways', 'achievements', 'dashboard', 'transcript'].includes(urlTab)) {
      setActiveTab(urlTab);
    }
  }, [searchParams]);

  // Debounce search input (300ms)
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchQuery]);

  // Time tracking: start/stop timer when activeModule changes
  const sendTimeLog = useCallback(async (modId, seconds) => {
    if (!selected || !myWorkerId || !isWorker || seconds < 60) return; // Only log if at least 1 minute
    const minutes = Math.max(1, Math.round(seconds / 60));
    try {
      await api.put(`/training/${selected._id}/time-log`, { workerId: myWorkerId, moduleId: modId, minutesSpent: minutes });
    } catch { /* silent */ }
  }, [selected, myWorkerId, isWorker]);

  useEffect(() => {
    // Cleanup previous timer
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

    if (activeModule && selected && myWorkerId && isWorker) {
      setModuleStartTime(Date.now());
      setElapsedSeconds(0);
      timerRef.current = setInterval(() => {
        setElapsedSeconds(s => s + 1);
      }, 1000);
    }

    return () => {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
  }, [activeModule, selected?._id, myWorkerId]);

  // Send time log when leaving module
  const prevModuleRef = useRef(null);
  useEffect(() => {
    if (prevModuleRef.current && prevModuleRef.current !== activeModule) {
      sendTimeLog(prevModuleRef.current, elapsedSeconds);
    }
    prevModuleRef.current = activeModule;
  }, [activeModule, sendTimeLog]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    try {
      const params = {};
      if (debouncedSearch) params.search = debouncedSearch;
      if (filterTrade) params.trade = filterTrade;
      if (filterDifficulty) params.difficulty = filterDifficulty;
      if (filterFramework === 'archived') params.status = 'archived';
      else if (filterFramework) params.framework = filterFramework;

      // Each call is independently guarded — a transient failure on one
      // (e.g. a flaky /training) must NOT block worker-id resolution, or a
      // real learner falls through to the "available for learner accounts"
      // gate and is locked out of their own training journey.
      const [trainingRes, ...rest] = await Promise.all([
        api.get('/training', { params }).catch(() => null),
        ...(isWorker ? [
          api.get('/workers', { params: { limit: 1 } }).catch(() => null),
          api.get('/training/notifications/my').catch(() => ({ data: [] })),
          api.get('/training/my-courses').catch(() => ({ data: [] })),
        ] : []),
      ]);
      if (trainingRes) setPrograms(trainingRes.data);
      else toast.error('Failed to load programs');
      if (isWorker && rest.length >= 3) {
        if (rest[0]?.data?.workers?.length) setMyWorkerId(rest[0].data.workers[0]._id);
        setNotifications(rest[1].data);
        setMyCourses(rest[2].data);
      }
    } catch {
      toast.error('Failed to load programs');
    } finally {
      setLoading(false);
    }
  }, [isWorker, debouncedSearch, filterTrade, filterDifficulty, filterFramework]);

  useEffect(() => { load(); }, [load]);

  // Staff: archive / restore / delete a course.
  const archiveCourse = async (e, id, archived) => {
    e.stopPropagation();
    setRowBusy(id);
    try {
      await api.patch(`/training/${id}/archive`, { archived });
      toast.success(archived ? 'Course archived' : 'Course restored');
      await load();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setRowBusy(''); }
  };
  const deleteCourse = async (e, id, title) => {
    e.stopPropagation();
    if (!window.confirm(`Permanently delete "${title}"?\nThis cannot be undone.`)) return;
    setRowBusy(id);
    try {
      await api.delete(`/training/${id}`);
      toast.success('Course deleted');
      await load();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setRowBusy(''); }
  };

  const selectProgram = async (id) => {
    try {
      const { data } = await api.get(`/training/${id}`);
      setSelected(data);
      setActiveModule(null);
      setEditingModule(null);
      setProgramTab('modules');
      setKcAnswers({});
      setKcResult(null);
      setSelfAssessScores({});
      setShowModulePreCheck(null);
      setShowPreAssessment(false);
    } catch {
      toast.error('Failed to load program');
    }
  };

  const getMyEnrollment = () => {
    if (!selected || !myWorkerId) return null;
    return selected.enrollments?.find(e => e.worker === myWorkerId || e.worker?._id === myWorkerId);
  };

  const handleEnroll = async () => {
    if (!myWorkerId || !selected) return;
    setEnrolling(true);
    try {
      await api.post(`/training/${selected._id}/enroll`, { workerId: myWorkerId });
      toast.success('Enrolled successfully!');
      await selectProgram(selected._id);
      load(); // refresh my courses
    } catch (err) {
      toast.error(err.response?.data?.error || 'Enrollment failed');
    } finally {
      setEnrolling(false);
    }
  };

  const completeModule = async (mod) => {
    if (!myWorkerId || !selected) return;
    try {
      await api.put(`/training/${selected._id}/progress`, {
        workerId: myWorkerId,
        moduleId: mod._id,
      });
      toast.success(`"${mod.title}" completed!`);
      await selectProgram(selected._id);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update progress');
    }
  };

  const submitKnowledgeCheck = async (mod) => {
    if (!myWorkerId || !selected) return;
    const questions = mod.knowledgeChecks || [];
    const answers = questions.map((q, i) => {
      const ans = kcAnswers[`${mod._id}-${i}`];
      if (q.type === 'true-false') return { answer: ans };
      if (q.type === 'fill-blank') return { answer: ans };
      return { selectedOption: typeof ans === 'number' ? ans : parseInt(ans, 10) };
    });
    setKcSubmitting(true);
    try {
      const { data } = await api.post(`/training/${selected._id}/knowledge-check/${mod._id}`, {
        workerId: myWorkerId,
        answers,
      });
      setKcResult({ moduleId: mod._id, ...data });
      if (data.passed) {
        toast.success(`Knowledge check passed! ${data.score}%`);
      } else {
        toast.error(`Score: ${data.score}%. Need ${data.passMark}% to pass.`);
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to submit knowledge check');
    } finally {
      setKcSubmitting(false);
    }
  };

  const submitSelfAssessment = async (mod) => {
    if (!myWorkerId || !selected) return;
    const rubricTemplate = mod.rubricTemplate || [];
    const rubricScores = rubricTemplate.map(rt => ({
      criterion: rt.criterion,
      score: selfAssessScores[`${mod._id}-${rt.criterion}`] || 0,
      notes: '',
    }));
    try {
      await api.post(`/training/${selected._id}/self-assessment/${mod._id}`, {
        workerId: myWorkerId,
        rubricScores,
      });
      toast.success('Self-assessment saved!');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save self-assessment');
    }
  };

  const deleteModule = async (modId) => {
    if (!selected) return;
    try {
      await api.delete(`/training/${selected._id}/modules/${modId}`);
      toast.success('Module deleted');
      await selectProgram(selected._id);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to delete module');
    }
  };

  const toggleBookmark = async () => {
    if (!selected) return;
    try {
      const { data } = await api.put(`/training/${selected._id}/bookmark`);
      toast.success(data.bookmarked ? 'Bookmarked!' : 'Bookmark removed');
      await selectProgram(selected._id);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to bookmark');
    }
  };

  const submitAssignment = async (mod) => {
    if (!myWorkerId || !selected) return;
    try {
      const fd = new FormData();
      fd.append('workerId', myWorkerId);
      fd.append('notes', submissionNotes || '');
      fd.append('evidenceType', evidenceType || 'other');
      for (const file of uploadFiles) {
        fd.append('files', file);
      }
      await api.post(`/training/${selected._id}/submit/${mod._id}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('Submission received! Awaiting review.');
      setShowSubmitForm(null);
      setSubmissionNotes('');
      setUploadFiles([]);
      setEvidenceType('other');
      await selectProgram(selected._id);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to submit');
    }
  };

  const handleSubmitForEvaluation = async () => {
    if (!selected) return;
    setSubmittingEval(true);
    try {
      await api.post(`/training/${selected._id}/submit-evaluation`);
      toast.success(t('Course submitted for evaluation!'));
      await selectProgram(selected._id);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to submit for evaluation');
    } finally {
      setSubmittingEval(false);
    }
  };

  const handlePreAssessmentComplete = async (results) => {
    setShowPreAssessment(false);
    // Pre-assessment done, now enroll
    await handleEnroll();
  };

  const handleStartCourse = () => {
    if (!myWorkerId || !selected) return;
    const enrollment = getMyEnrollment();
    if (enrollment) {
      // Already enrolled, just go to first module
      const modules = (selected.modules || []).sort((a, b) => (a.order || 0) - (b.order || 0));
      if (modules.length > 0) {
        const nextMod = modules.find(m => !enrollment.completedModules?.includes(m._id)) || modules[0];
        setActiveModule(nextMod._id);
      }
    } else {
      // Show pre-assessment before enrolling
      setShowPreAssessment(true);
    }
  };

  const markNotifRead = async (programId, notifId) => {
    try {
      await api.put(`/training/notifications/${programId}/${notifId}/read`);
      setNotifications(ns => ns.map(n => n._id === notifId ? { ...n, read: true } : n));
    } catch { /* ignore */ }
  };

  /* ─── AI Feature Handlers ─── */
  const fetchAdaptivePath = async (programId) => {
    setLoadingAI(s => ({ ...s, adaptive: true }));
    try {
      const { data } = await api.post(`/ai/training/${programId}/adaptive-path`);
      setAdaptivePath(data.adaptivePath);
      toast.success(t('AI study plan generated'));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to generate study plan');
    } finally {
      setLoadingAI(s => ({ ...s, adaptive: false }));
    }
  };

  const fetchAIGrade = async (programId, submissionId) => {
    setLoadingAI(s => ({ ...s, [`grade-${submissionId}`]: true }));
    try {
      const { data } = await api.post(`/ai/training/${programId}/ai-grade/${submissionId}`);
      toast.success(t('AI grade generated'));
      await selectProgram(programId);
      return data.aiGrade;
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to generate AI grade');
    } finally {
      setLoadingAI(s => ({ ...s, [`grade-${submissionId}`]: false }));
    }
  };

  const fetchFreshnessCheck = async (programId) => {
    setLoadingAI(s => ({ ...s, freshness: true }));
    try {
      const { data } = await api.post(`/ai/training/${programId}/freshness-check`);
      setFreshnessResults(data.results);
      toast.success(t('Freshness check complete'));
      await selectProgram(programId);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Freshness check failed');
    } finally {
      setLoadingAI(s => ({ ...s, freshness: false }));
    }
  };

  const acceptAIGrade = async (programId, submissionId, aiGrade) => {
    try {
      await api.put(`/training/${programId}/submissions/${submissionId}/review`, {
        status: 'approved',
        grade: aiGrade.suggestedScore,
        feedback: aiGrade.feedback,
      });
      toast.success(t('AI grade accepted'));
      await selectProgram(programId);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to accept grade');
    }
  };

  // Extract unique trades for filter
  const trades = useMemo(() => [...new Set(programs.map(p => p.trade))].sort(), [programs]);

  /* ── Sector hierarchy: group courses into major sector tabs, then into
        sub-tabs by trade within the active sector. ── */
  const sectorTabs = useMemo(() => {
    const counts = {};
    for (const p of programs) { const k = sectorOf(p); counts[k] = (counts[k] || 0) + 1; }
    return ALL_SECTORS.filter(s => counts[s.key]).map(s => ({ ...s, count: counts[s.key] }));
  }, [programs]);

  // Keep the active sector valid as data loads.
  useEffect(() => {
    if (sectorTabs.length && !sectorTabs.some(s => s.key === activeSector)) {
      setActiveSector(sectorTabs[0].key);
    }
  }, [sectorTabs, activeSector]);

  const sectorCourses = useMemo(
    () => programs.filter(p => sectorOf(p) === activeSector),
    [programs, activeSector],
  );
  const subTrades = useMemo(
    () => [...new Set(sectorCourses.map(p => p.trade).filter(Boolean))].sort(),
    [sectorCourses],
  );
  useEffect(() => { setActiveSubTrade(''); }, [activeSector]);
  const visibleCourses = useMemo(
    () => (activeSubTrade ? sectorCourses.filter(p => p.trade === activeSubTrade) : sectorCourses),
    [sectorCourses, activeSubTrade],
  );

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-ilo-blue border-t-transparent rounded-full" /></div>;

  /* ─── Tab switch: always clears course detail ─── */
  const handleTabSwitch = (tab) => {
    setSearchParams({ tab });
    setActiveTab(tab);
    setSelected(null);
    setActiveModule(null);
    setEditingModule(null);
    if (tab !== 'pathways') setPathwaySourceCourse(null);
  };

  /* ─── Module content viewer (render fn) ─── */
  const renderModuleViewer = () => {
    const mod = selected?.modules?.find(m => m._id === activeModule);
    if (!mod) return null;
    const enrollment = getMyEnrollment();
    const isCompleted = enrollment?.completedModules?.includes(mod._id);

    const quizAttempts = enrollment?.quizAttempts?.filter(a => a.moduleId === mod._id) || [];
    const bestAttempt = quizAttempts.length > 0
      ? quizAttempts.reduce((best, a) => a.score > best.score ? a : best, quizAttempts[0])
      : null;

    // Check for existing submission
    const moduleSubmissions = enrollment?.submissions?.filter(s => s.moduleId === mod._id) || [];
    const mySubmission = moduleSubmissions.length > 0 ? moduleSubmissions[moduleSubmissions.length - 1] : null;

    return (
      <div className="space-y-4">
        <button onClick={() => setActiveModule(null)}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-ilo-blue hover:bg-ilo-dark rounded-lg shadow transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          Back to {selected.title}
        </button>

        <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light overflow-hidden">
          <div className="p-6 border-b border-border dark:border-navy-light">
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <span className={`px-2.5 py-0.5 text-[10px] font-bold rounded-full uppercase
                ${mod.type === 'video' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' :
                  mod.type === 'quiz' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                  mod.type === 'scenario' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' :
                  mod.type === 'practical' || mod.type === 'assignment' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                  'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'}`}>
                {mod.type}
              </span>
              {mod.duration && <span className="text-xs text-gray-500">{mod.duration} min</span>}
              {mod.deadline && (
                <span className={`text-xs font-semibold ${new Date(mod.deadline) < new Date() ? 'text-red-500' : 'text-amber-600'}`}>
                  Due: {new Date(mod.deadline).toLocaleDateString()}
                </span>
              )}
              {isCompleted && <span className="text-xs font-bold text-green-600 dark:text-green-400 ml-auto">{t('Completed')}</span>}
              {bestAttempt && (
                <span className={`text-xs font-bold ml-2 ${bestAttempt.passed ? 'text-green-600' : 'text-red-500'}`}>
                  Best: {bestAttempt.score}% ({quizAttempts.length} attempts)
                </span>
              )}
              {/* Timer display */}
              {enrollment && isWorker && (
                <span className="flex items-center gap-1 text-xs text-gray-500 ml-auto">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  {String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:{String(elapsedSeconds % 60).padStart(2, '0')}
                  {(() => { const tl = enrollment?.moduleTimeLog?.find(t => t.moduleId === mod._id); return tl ? ` (${tl.timeSpentMinutes}m total)` : ''; })()}
                </span>
              )}
            </div>
            <h2 className="text-lg font-bold dark:text-white">{mod.title}</h2>
            {mod.description && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{mod.description}</p>}
            {/* Module credential info */}
            {(() => { const mc = enrollment?.moduleCredentials?.find(c => c.moduleId === mod._id); return mc ? (
              <div className="flex items-center gap-2 mt-2 px-3 py-1.5 bg-amber-50 dark:bg-amber-900/10 rounded-lg border border-amber-200 dark:border-amber-800 w-fit">
                <svg className="w-3.5 h-3.5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" /></svg>
                <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">Unit Credential: {mc.credentialId}</span>
              </div>
            ) : null; })()}
          </div>

          <div className="p-6">
            {mod.type === 'video' && (
              <div className="space-y-4">
                <VideoPlayer videoUrl={mod.videoUrl} title={mod.title} />
                {/* Knowledge checks for video modules */}
                {mod.knowledgeChecks?.length > 0 && !isCompleted && enrollment && isWorker && (
                  <div className="p-4 bg-indigo-50 dark:bg-indigo-900/10 rounded-xl border border-indigo-200 dark:border-indigo-800 space-y-3">
                    <h4 className="text-sm font-bold text-indigo-700 dark:text-indigo-400">
                      Knowledge Check ({mod.knowledgeChecks.length} questions)
                      {mod.knowledgeCheckRequired && <span className="ml-2 text-[10px] font-bold text-red-600">Required</span>}
                    </h4>
                    {mod.knowledgeChecks.map((q, qi) => (
                      <div key={qi} className="p-3 bg-white dark:bg-navy-mid rounded-lg border border-border dark:border-navy-light">
                        <p className="text-xs font-semibold dark:text-white mb-2">{qi + 1}. {q.question}</p>
                        {q.type === 'mcq' && q.options?.map((opt, oi) => (
                          <label key={oi} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 py-1 cursor-pointer">
                            <input type="radio" name={`kc-${mod._id}-${qi}`} value={oi}
                              checked={kcAnswers[`${mod._id}-${qi}`] === oi}
                              onChange={() => setKcAnswers(p => ({ ...p, [`${mod._id}-${qi}`]: oi }))} />
                            {opt}
                          </label>
                        ))}
                        {q.type === 'true-false' && ['true', 'false'].map(v => (
                          <label key={v} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 py-1 cursor-pointer">
                            <input type="radio" name={`kc-${mod._id}-${qi}`} value={v}
                              checked={kcAnswers[`${mod._id}-${qi}`] === v}
                              onChange={() => setKcAnswers(p => ({ ...p, [`${mod._id}-${qi}`]: v }))} />
                            {v.charAt(0).toUpperCase() + v.slice(1)}
                          </label>
                        ))}
                        {q.type === 'fill-blank' && (
                          <input type="text" placeholder="Type your answer..."
                            value={kcAnswers[`${mod._id}-${qi}`] || ''}
                            onChange={e => setKcAnswers(p => ({ ...p, [`${mod._id}-${qi}`]: e.target.value }))}
                            className="w-full px-3 py-1.5 text-xs border border-border dark:border-navy-light rounded-lg bg-white dark:bg-navy dark:text-white" />
                        )}
                        {/* Show result feedback */}
                        {kcResult?.moduleId === mod._id && kcResult.answers?.[qi] && (
                          <p className={`text-[10px] mt-1 font-semibold ${kcResult.answers[qi].isCorrect ? 'text-green-600' : 'text-red-600'}`}>
                            {kcResult.answers[qi].isCorrect ? '✓ Correct' : '✗ Incorrect'}{kcResult.answers[qi].explanation && ` — ${kcResult.answers[qi].explanation}`}
                          </p>
                        )}
                      </div>
                    ))}
                    <button onClick={() => submitKnowledgeCheck(mod)} disabled={kcSubmitting}
                      className="px-5 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-50">
                      {kcSubmitting ? 'Checking...' : 'Submit Knowledge Check'}
                    </button>
                    {kcResult?.moduleId === mod._id && (
                      <p className={`text-xs font-bold ${kcResult.passed ? 'text-green-600' : 'text-red-600'}`}>
                        Score: {kcResult.score}% ({kcResult.correctAnswers}/{kcResult.totalQuestions}) — {kcResult.passed ? 'PASSED' : `Need ${kcResult.passMark}% to pass`}
                      </p>
                    )}
                  </div>
                )}
                {/* Admin KC preview for video */}
                {mod.knowledgeChecks?.length > 0 && isAdmin && (
                  <div className="p-4 bg-gray-50 dark:bg-navy-light rounded-xl border border-gray-200 dark:border-navy-light space-y-3">
                    <h4 className="text-sm font-bold text-gray-700 dark:text-gray-300">
                      Knowledge Check Preview ({mod.knowledgeChecks.length} questions)
                      {mod.knowledgeCheckRequired && <span className="ml-2 text-[10px] font-bold text-red-600">Required</span>}
                    </h4>
                    {mod.knowledgeChecks.map((q, qi) => (
                      <div key={qi} className="p-3 bg-white dark:bg-navy-mid rounded-lg border border-border dark:border-navy-light">
                        <p className="text-xs font-semibold dark:text-white mb-2">{qi + 1}. {q.question}</p>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-navy text-gray-500 dark:text-gray-400 uppercase font-bold">{q.type}</span>
                        {q.type === 'mcq' && q.options?.map((opt, oi) => (
                          <p key={oi} className={`text-xs py-0.5 pl-4 ${oi === q.correctAnswer ? 'text-green-600 font-bold' : 'text-gray-500 dark:text-gray-400'}`}>
                            {oi === q.correctAnswer ? '✓ ' : '  '}{opt}
                          </p>
                        ))}
                        {q.type === 'true-false' && (
                          <p className="text-xs text-green-600 font-bold pl-4 py-0.5">Answer: {String(q.correctAnswer)}</p>
                        )}
                        {q.type === 'fill-blank' && q.correctAnswer && (
                          <p className="text-xs text-green-600 font-bold pl-4 py-0.5">Answer: {q.correctAnswer}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {!isCompleted && enrollment && isWorker && (
                  <button onClick={() => completeModule(mod)}
                    className="px-6 py-2.5 text-sm font-semibold bg-green-600 text-white rounded-xl hover:bg-green-700 transition-colors">
                    {mod.knowledgeCheckRequired && mod.knowledgeChecks?.length > 0 ? 'Complete (requires passing knowledge check)' : 'Mark as Complete'}
                  </button>
                )}
              </div>
            )}

            {mod.type === 'reading' && (
              <div className="space-y-4">
                <div className="max-w-none p-6 bg-gray-50 dark:bg-navy-light rounded-xl min-h-[200px]">
                  {(mod.content || mod.description) ? (
                    <div className="tl-rich dark:text-gray-200" dangerouslySetInnerHTML={{ __html: renderMarkdown(mod.content || mod.description) }} />
                  ) : (
                    <p className="text-gray-500">Reading material for this module</p>
                  )}
                </div>
                {/* Knowledge checks for reading modules */}
                {mod.knowledgeChecks?.length > 0 && !isCompleted && enrollment && isWorker && (
                  <div className="p-4 bg-indigo-50 dark:bg-indigo-900/10 rounded-xl border border-indigo-200 dark:border-indigo-800 space-y-3">
                    <h4 className="text-sm font-bold text-indigo-700 dark:text-indigo-400">
                      Knowledge Check ({mod.knowledgeChecks.length} questions)
                      {mod.knowledgeCheckRequired && <span className="ml-2 text-[10px] font-bold text-red-600">Required</span>}
                    </h4>
                    {mod.knowledgeChecks.map((q, qi) => (
                      <div key={qi} className="p-3 bg-white dark:bg-navy-mid rounded-lg border border-border dark:border-navy-light">
                        <p className="text-xs font-semibold dark:text-white mb-2">{qi + 1}. {q.question}</p>
                        {q.type === 'mcq' && q.options?.map((opt, oi) => (
                          <label key={oi} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 py-1 cursor-pointer">
                            <input type="radio" name={`kc-${mod._id}-${qi}`} value={oi}
                              checked={kcAnswers[`${mod._id}-${qi}`] === oi}
                              onChange={() => setKcAnswers(p => ({ ...p, [`${mod._id}-${qi}`]: oi }))} />
                            {opt}
                          </label>
                        ))}
                        {q.type === 'true-false' && ['true', 'false'].map(v => (
                          <label key={v} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 py-1 cursor-pointer">
                            <input type="radio" name={`kc-${mod._id}-${qi}`} value={v}
                              checked={kcAnswers[`${mod._id}-${qi}`] === v}
                              onChange={() => setKcAnswers(p => ({ ...p, [`${mod._id}-${qi}`]: v }))} />
                            {v.charAt(0).toUpperCase() + v.slice(1)}
                          </label>
                        ))}
                        {q.type === 'fill-blank' && (
                          <input type="text" placeholder="Type your answer..."
                            value={kcAnswers[`${mod._id}-${qi}`] || ''}
                            onChange={e => setKcAnswers(p => ({ ...p, [`${mod._id}-${qi}`]: e.target.value }))}
                            className="w-full px-3 py-1.5 text-xs border border-border dark:border-navy-light rounded-lg bg-white dark:bg-navy dark:text-white" />
                        )}
                        {kcResult?.moduleId === mod._id && kcResult.answers?.[qi] && (
                          <p className={`text-[10px] mt-1 font-semibold ${kcResult.answers[qi].isCorrect ? 'text-green-600' : 'text-red-600'}`}>
                            {kcResult.answers[qi].isCorrect ? '✓ Correct' : '✗ Incorrect'}{kcResult.answers[qi].explanation && ` — ${kcResult.answers[qi].explanation}`}
                          </p>
                        )}
                      </div>
                    ))}
                    <button onClick={() => submitKnowledgeCheck(mod)} disabled={kcSubmitting}
                      className="px-5 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-50">
                      {kcSubmitting ? 'Checking...' : 'Submit Knowledge Check'}
                    </button>
                    {kcResult?.moduleId === mod._id && (
                      <p className={`text-xs font-bold ${kcResult.passed ? 'text-green-600' : 'text-red-600'}`}>
                        Score: {kcResult.score}% ({kcResult.correctAnswers}/{kcResult.totalQuestions}) — {kcResult.passed ? 'PASSED' : `Need ${kcResult.passMark}% to pass`}
                      </p>
                    )}
                  </div>
                )}
                {/* Admin KC preview for reading */}
                {mod.knowledgeChecks?.length > 0 && isAdmin && (
                  <div className="p-4 bg-gray-50 dark:bg-navy-light rounded-xl border border-gray-200 dark:border-navy-light space-y-3">
                    <h4 className="text-sm font-bold text-gray-700 dark:text-gray-300">
                      Knowledge Check Preview ({mod.knowledgeChecks.length} questions)
                      {mod.knowledgeCheckRequired && <span className="ml-2 text-[10px] font-bold text-red-600">Required</span>}
                    </h4>
                    {mod.knowledgeChecks.map((q, qi) => (
                      <div key={qi} className="p-3 bg-white dark:bg-navy-mid rounded-lg border border-border dark:border-navy-light">
                        <p className="text-xs font-semibold dark:text-white mb-2">{qi + 1}. {q.question}</p>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-navy text-gray-500 dark:text-gray-400 uppercase font-bold">{q.type}</span>
                        {q.type === 'mcq' && q.options?.map((opt, oi) => (
                          <p key={oi} className={`text-xs py-0.5 pl-4 ${oi === q.correctAnswer ? 'text-green-600 font-bold' : 'text-gray-500 dark:text-gray-400'}`}>
                            {oi === q.correctAnswer ? '✓ ' : '  '}{opt}
                          </p>
                        ))}
                        {q.type === 'true-false' && (
                          <p className="text-xs text-green-600 font-bold pl-4 py-0.5">Answer: {String(q.correctAnswer)}</p>
                        )}
                        {q.type === 'fill-blank' && q.correctAnswer && (
                          <p className="text-xs text-green-600 font-bold pl-4 py-0.5">Answer: {q.correctAnswer}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {!isCompleted && enrollment && isWorker && (
                  <button onClick={() => completeModule(mod)}
                    className="px-6 py-2.5 text-sm font-semibold bg-green-600 text-white rounded-xl hover:bg-green-700 transition-colors">
                    {mod.knowledgeCheckRequired && mod.knowledgeChecks?.length > 0 ? 'Complete (requires passing knowledge check)' : 'Mark as Complete'}
                  </button>
                )}
              </div>
            )}

            {mod.type === 'quiz' && mod.quizQuestions?.length > 0 ? (
              isCompleted ? (
                <div className="text-center py-8">
                  <svg className="w-12 h-12 mx-auto text-green-500 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  <p className="text-sm font-semibold dark:text-white">Quiz completed!</p>
                  {bestAttempt && <p className="text-xs text-gray-500 mt-1">Best score: {bestAttempt.score}% in {quizAttempts.length} attempt(s)</p>}
                </div>
              ) : isWorker && enrollment ? (
                <QuizView
                  questions={mod.quizQuestions}
                  programId={selected._id}
                  moduleId={mod._id}
                  workerId={myWorkerId}
                  onComplete={() => selectProgram(selected._id)}
                  passMark={selected.passMark || 70}
                />
              ) : (
                /* Admin quiz preview — read-only question list */
                <div className="space-y-3">
                  <div className="flex items-center gap-3 mb-2">
                    <h4 className="text-sm font-bold text-gray-700 dark:text-gray-300">Quiz Preview</h4>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-bold">
                      {mod.quizQuestions.length} questions
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 font-bold">
                      Pass: {selected.passMark || 70}%
                    </span>
                  </div>
                  {mod.quizQuestions.map((q, qi) => (
                    <div key={qi} className="p-3 bg-gray-50 dark:bg-navy-light rounded-lg border border-border dark:border-navy-light">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-semibold dark:text-white">{qi + 1}. {q.question}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-200 dark:bg-navy text-gray-600 dark:text-gray-400 uppercase font-bold">{q.type || 'mcq'}</span>
                        {q.points && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 font-bold">{q.points} pts</span>}
                        {q.difficulty && <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${q.difficulty === 'hard' ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' : q.difficulty === 'medium' ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'}`}>{q.difficulty}</span>}
                      </div>
                      {(q.type === 'mcq' || !q.type) && q.options?.map((opt, oi) => (
                        <p key={oi} className={`text-xs py-0.5 pl-4 ${oi === q.correctAnswer ? 'text-green-600 font-bold' : 'text-gray-500 dark:text-gray-400'}`}>
                          {oi === q.correctAnswer ? '✓ ' : '  '}{opt}
                        </p>
                      ))}
                      {q.type === 'true-false' && (
                        <p className="text-xs text-green-600 font-bold pl-4 py-0.5">Answer: {String(q.correctAnswer)}</p>
                      )}
                      {q.type === 'fill-blank' && q.correctAnswer && (
                        <p className="text-xs text-green-600 font-bold pl-4 py-0.5">Answer: {q.correctAnswer}</p>
                      )}
                    </div>
                  ))}
                </div>
              )
            ) : mod.type === 'quiz' ? (
              <div className="text-center py-12">
                <p className="text-gray-500 text-sm">Quiz questions not yet configured</p>
              </div>
            ) : null}

            {mod.type === 'scorm' && (
              <div className="space-y-4">
                {mod.scormLaunchFile ? (
                  <ScormPlayer
                    moduleId={mod._id}
                    onComplete={(data) => {
                      // Mark module complete
                      completeModule(mod);
                    }}
                    onClose={() => setActiveModule(null)}
                  />
                ) : (
                  <div className="text-center py-12">
                    <p className="text-gray-500 text-sm">SCORM package not yet uploaded</p>
                  </div>
                )}
              </div>
            )}

            {(mod.type === 'practical' || mod.type === 'assignment') && (
              <div className="space-y-4">
                <div className="py-8 bg-gray-50 dark:bg-navy-light rounded-xl px-6">
                  <p className="text-sm font-semibold dark:text-white mb-2">
                    {mod.type === 'assignment' ? 'Assignment Submission' : 'Practical Assessment'}
                  </p>
                  <p className="text-xs text-gray-500 max-w-lg">
                    {mod.content || mod.description || 'Complete the hands-on assessment and submit your work for review.'}
                  </p>
                </div>

                {/* Rubric criteria display */}
                {mod.rubricTemplate?.length > 0 && (
                  <div className="p-4 bg-violet-50 dark:bg-violet-900/10 rounded-xl border border-violet-200 dark:border-violet-800">
                    <h4 className="text-sm font-bold text-violet-700 dark:text-violet-400 mb-2">
                      Assessment Rubric ({mod.rubricTemplate.length} criteria)
                      {mod.rubricRequired && <span className="ml-2 text-[10px] font-bold text-red-600">Rubric Required</span>}
                    </h4>
                    <div className="grid gap-2">
                      {mod.rubricTemplate.map((rt, ri) => (
                        <div key={ri} className="flex items-center justify-between p-2 bg-white dark:bg-navy-mid rounded-lg border border-border dark:border-navy-light">
                          <div>
                            <span className="text-xs font-semibold dark:text-white">{rt.criterion}</span>
                            {rt.description && <p className="text-[10px] text-gray-500">{rt.description}</p>}
                          </div>
                          <span className="text-[10px] text-gray-400">Max: {rt.maxScore || 4}</span>
                        </div>
                      ))}
                    </div>

                    {/* Self-assessment form for workers */}
                    {!isCompleted && enrollment && isWorker && (
                      <div className="mt-3 pt-3 border-t border-violet-200 dark:border-violet-800">
                        <p className="text-xs font-bold text-violet-600 dark:text-violet-400 mb-2">Self-Assessment (rate yourself before submission)</p>
                        <div className="space-y-2">
                          {mod.rubricTemplate.map((rt, ri) => (
                            <div key={ri} className="flex items-center gap-3">
                              <span className="text-xs text-gray-600 dark:text-gray-300 w-40 truncate">{rt.criterion}</span>
                              <input type="range" min="0" max={rt.maxScore || 4} step="1"
                                value={selfAssessScores[`${mod._id}-${rt.criterion}`] || 0}
                                onChange={e => setSelfAssessScores(p => ({ ...p, [`${mod._id}-${rt.criterion}`]: parseInt(e.target.value) }))}
                                className="flex-1 h-1.5 accent-violet-600" />
                              <span className="text-xs font-bold dark:text-white w-8 text-right">
                                {selfAssessScores[`${mod._id}-${rt.criterion}`] || 0}/{rt.maxScore || 4}
                              </span>
                            </div>
                          ))}
                        </div>
                        <button onClick={() => submitSelfAssessment(mod)}
                          className="mt-2 px-4 py-1.5 text-xs font-semibold bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors">
                          Save Self-Assessment
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Rubric scores display (if reviewed with rubric) */}
                {mySubmission?.rubricScores?.length > 0 && (
                  <div className="p-4 bg-green-50 dark:bg-green-900/10 rounded-xl border border-green-200 dark:border-green-800">
                    <h4 className="text-xs font-bold text-green-700 dark:text-green-400 mb-2">
                      Rubric Score: {mySubmission.rubricPercentage}% ({mySubmission.rubricTotal}/{mySubmission.rubricMaxTotal})
                    </h4>
                    <div className="grid gap-1.5">
                      {mySubmission.rubricScores.map((rs, ri) => (
                        <div key={ri} className="flex items-center justify-between">
                          <span className="text-[11px] text-gray-600 dark:text-gray-300">{rs.criterion}</span>
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 bg-gray-200 dark:bg-navy-light rounded-full overflow-hidden">
                              <div className="h-full bg-green-500 rounded-full" style={{ width: `${(rs.score / (mod.rubricTemplate?.find(r => r.criterion === rs.criterion)?.maxScore || 4)) * 100}%` }} />
                            </div>
                            <span className="text-[10px] font-semibold dark:text-white">{rs.score}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {mySubmission && (
                  <div className={`p-4 rounded-xl border ${mySubmission.status === 'approved' ? 'border-green-300 bg-green-50 dark:bg-green-900/10' : mySubmission.status === 'rejected' ? 'border-red-300 bg-red-50 dark:bg-red-900/10' : 'border-amber-300 bg-amber-50 dark:bg-amber-900/10'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-bold uppercase ${mySubmission.status === 'approved' ? 'text-green-700' : mySubmission.status === 'rejected' ? 'text-red-700' : 'text-amber-700'}`}>
                        {mySubmission.status}
                      </span>
                      {mySubmission.grade != null && <span className="text-xs text-gray-500">Grade: {mySubmission.grade}%</span>}
                      {mySubmission.aiGrade && <span className="text-[10px] font-bold text-violet-600">{t('AI-assisted')}</span>}
                    </div>
                    {mySubmission.feedback && <p className="text-xs text-gray-600 dark:text-gray-400">Feedback: {mySubmission.feedback}</p>}
                    {mySubmission.notes && <p className="text-xs text-gray-500 mt-1">Your notes: {mySubmission.notes}</p>}
                  </div>
                )}

                {/* P4b: AI Grading — visible to instructors on pending submissions */}
                {isAdmin && enrollment && (() => {
                  // Find all submissions for this module from all enrollments
                  const allSubs = [];
                  for (const enr of (selected.enrollments || [])) {
                    for (const sub of (enr.submissions || [])) {
                      if (sub.moduleId === mod._id && sub.status === 'submitted') {
                        allSubs.push({ ...sub, enrollmentWorker: enr.worker });
                      }
                    }
                  }
                  if (allSubs.length === 0) return null;

                  return (
                    <div className="p-4 bg-indigo-50 dark:bg-indigo-900/10 rounded-xl border border-indigo-200 dark:border-indigo-800 space-y-3">
                      <h4 className="text-sm font-bold text-indigo-700 dark:text-indigo-400">{t('Pending Submissions')} ({allSubs.length})</h4>
                      {allSubs.map(sub => (
                        <div key={sub._id} className="p-3 bg-white dark:bg-navy-mid rounded-lg border border-border dark:border-navy-light">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-semibold dark:text-white">{t('Submission')}: {sub._id?.slice(-6)}</p>
                            <span className="text-[10px] text-gray-400">{sub.submittedAt ? new Date(sub.submittedAt).toLocaleDateString() : ''}</span>
                          </div>
                          {sub.notes && <p className="text-xs text-gray-500 mb-2">{t('Notes')}: {sub.notes}</p>}

                          {/* AI Grade result */}
                          {sub.aiGrade && (
                            <div className="p-3 mb-2 bg-violet-50 dark:bg-violet-900/10 rounded-lg border border-violet-200 dark:border-violet-800">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-xs font-bold text-violet-700 dark:text-violet-300">{t('AI Suggested Grade')}: {sub.aiGrade.suggestedScore}%</span>
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300">{t('AI-generated')}</span>
                              </div>
                              {sub.aiGrade.strengths?.length > 0 && (
                                <p className="text-xs text-green-700 dark:text-green-400 mb-1"><span className="font-semibold">{t('Strengths')}:</span> {sub.aiGrade.strengths.join(', ')}</p>
                              )}
                              {sub.aiGrade.weaknesses?.length > 0 && (
                                <p className="text-xs text-amber-700 dark:text-amber-400 mb-1"><span className="font-semibold">{t('Weaknesses')}:</span> {sub.aiGrade.weaknesses.join(', ')}</p>
                              )}
                              {sub.aiGrade.feedback && <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">{sub.aiGrade.feedback}</p>}
                              <button onClick={() => acceptAIGrade(selected._id, sub._id, sub.aiGrade)}
                                className="px-3 py-1 text-xs font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
                                {t('Accept AI Grade')}
                              </button>
                            </div>
                          )}

                          <div className="flex gap-2">
                            <button onClick={() => fetchAIGrade(selected._id, sub._id)}
                              disabled={loadingAI[`grade-${sub._id}`]}
                              className="px-3 py-1 text-xs font-semibold bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-lg hover:from-violet-700 hover:to-indigo-700 transition-all disabled:opacity-50 flex items-center gap-1">
                              {loadingAI[`grade-${sub._id}`] ? (
                                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                              )}
                              {t('AI Grade')}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* Show uploaded file thumbnails on existing submissions */}
                {mySubmission?.files?.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {mySubmission.files.map((f, fi) => {
                      const isImage = /\.(jpg|jpeg|png|webp)$/i.test(f.name);
                      const isVideo = /\.(mp4|mov|avi|webm)$/i.test(f.name);
                      return (
                        <a key={fi} href={f.url} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1.5 px-2 py-1 bg-gray-100 dark:bg-navy-light rounded-lg text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-navy">
                          {isImage ? (
                            <img src={f.url} alt={f.name} className="w-8 h-8 object-cover rounded" />
                          ) : isVideo ? (
                            <svg className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                          ) : (
                            <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                          )}
                          <span className="truncate max-w-[100px]">{f.name}</span>
                        </a>
                      );
                    })}
                  </div>
                )}
                {mySubmission?.evidenceType && mySubmission.evidenceType !== 'other' && (
                  <span className="inline-block px-2 py-0.5 text-[10px] font-bold rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 capitalize">{mySubmission.evidenceType.replace(/-/g, ' ')}</span>
                )}

                {!isCompleted && enrollment && isWorker && (!mySubmission || mySubmission.status === 'rejected') && (
                  showSubmitForm === mod._id ? (
                    <div className="space-y-3">
                      {/* Evidence type */}
                      <div>
                        <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 block">{t('Evidence Type')}</label>
                        <select value={evidenceType} onChange={e => setEvidenceType(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-border dark:border-navy-light rounded-xl bg-white dark:bg-navy dark:text-white">
                          <option value="other">Other</option>
                          <option value="photo-of-work">Photo of Work</option>
                          <option value="video-demonstration">Video Demonstration</option>
                          <option value="supervisor-signoff">Supervisor Sign-off</option>
                        </select>
                      </div>
                      {/* File upload */}
                      <div>
                        <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 block">{t('Upload Evidence')} (max 5 files)</label>
                        <input type="file" multiple accept=".jpg,.jpeg,.png,.webp,.mp4,.mov,.pdf,.doc,.docx"
                          onChange={e => setUploadFiles(Array.from(e.target.files || []).slice(0, 5))}
                          className="text-sm text-gray-600 dark:text-gray-300" />
                        {uploadFiles.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-2">
                            {uploadFiles.map((f, fi) => (
                              <span key={fi} className="px-2 py-1 text-[10px] bg-gray-100 dark:bg-navy-light rounded-lg text-gray-600 dark:text-gray-300">{f.name} ({Math.round(f.size / 1024)}KB)</span>
                            ))}
                          </div>
                        )}
                      </div>
                      {/* Notes */}
                      <textarea value={submissionNotes} onChange={e => setSubmissionNotes(e.target.value)}
                        placeholder="Add notes for your submission (optional)..."
                        rows={3} maxLength={1000}
                        className="w-full px-3 py-2 text-sm border border-border dark:border-navy-light rounded-xl bg-white dark:bg-navy dark:text-white focus:ring-2 focus:ring-ilo-blue/30 outline-none resize-none" />
                      <div className="flex gap-2">
                        <button onClick={() => submitAssignment(mod)}
                          className="px-6 py-2.5 text-sm font-semibold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark transition-colors">
                          {mySubmission?.status === 'rejected' ? t('Resubmit for Review') : t('Submit for Review')}
                        </button>
                        <button onClick={() => { setShowSubmitForm(null); setSubmissionNotes(''); setUploadFiles([]); setEvidenceType('other'); }}
                          className="px-4 py-2.5 text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-navy-light rounded-xl">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-3">
                      <button onClick={() => setShowSubmitForm(mod._id)}
                        className="px-6 py-2.5 text-sm font-semibold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark transition-colors">
                        {mySubmission?.status === 'rejected' ? t('Resubmit for Review') : t('Submit for Review')}
                      </button>
                      <button onClick={() => completeModule(mod)}
                        className="px-6 py-2.5 text-sm font-semibold bg-green-600 text-white rounded-xl hover:bg-green-700 transition-colors">
                        {t('Mark as Complete')}
                      </button>
                    </div>
                  )
                )}
                {/* Allow marking complete even after submission (don't block on approval) */}
                {!isCompleted && enrollment && isWorker && mySubmission && mySubmission.status !== 'rejected' && mySubmission.status !== 'approved' && (
                  <button onClick={() => completeModule(mod)}
                    className="px-6 py-2.5 text-sm font-semibold bg-green-600 text-white rounded-xl hover:bg-green-700 transition-colors">
                    {t('Mark as Complete & Continue')}
                  </button>
                )}
              </div>
            )}

            {mod.type === 'scenario' && (
              isCompleted ? (
                <div className="text-center py-8">
                  <svg className="w-12 h-12 mx-auto text-green-500 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  <p className="text-sm font-semibold dark:text-white">Scenario completed!</p>
                </div>
              ) : isWorker && enrollment ? (
                <ScenarioView
                  scenario={mod.scenario}
                  programId={selected._id}
                  moduleId={mod._id}
                  workerId={myWorkerId}
                  onComplete={() => selectProgram(selected._id)}
                />
              ) : mod.scenario ? (
                /* Admin scenario preview — read-only narrative and choices */
                <div className="space-y-4">
                  <div className="p-4 bg-rose-50 dark:bg-rose-900/10 rounded-xl border border-rose-200 dark:border-rose-800">
                    <h4 className="text-sm font-bold text-rose-700 dark:text-rose-400 mb-2">Scenario Preview</h4>
                    {mod.scenario.narrative && (
                      <div className="prose prose-sm dark:prose-invert max-w-none mb-3">
                        <p className="text-sm text-gray-700 dark:text-gray-300">{mod.scenario.narrative}</p>
                      </div>
                    )}
                    {mod.scenario.choices?.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Choices:</p>
                        {mod.scenario.choices.map((choice, ci) => (
                          <div key={ci} className={`p-2.5 rounded-lg border text-xs ${choice.isOptimal ? 'border-green-300 bg-green-50 dark:bg-green-900/10 text-green-700 dark:text-green-400 font-semibold' : 'border-gray-200 dark:border-navy-light text-gray-600 dark:text-gray-400'}`}>
                            {choice.isOptimal && <span className="text-[10px] font-bold text-green-600 mr-1">OPTIMAL</span>}
                            {choice.text || choice.label}
                            {choice.feedback && <p className="text-[10px] text-gray-500 mt-1">Feedback: {choice.feedback}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-center py-12">
                  <p className="text-gray-500 text-sm">Scenario not yet configured</p>
                </div>
              )
            )}
          </div>
        </div>

        {/* P4e: AI Adapt Panel — available on all modules for enrolled workers */}
        {enrollment && isWorker && (
          <AIAdaptPanel
            programId={selected._id}
            moduleId={mod._id}
            isOpen={showAIPanel}
            onToggle={() => setShowAIPanel(p => !p)}
            courseTitle={selected.title}
            moduleTitle={mod.title}
          />
        )}
      </div>
    );
  };

  /* ─── Program detail view (render fn) ─── */
  const renderCourseDetail = () => {
    const enrollment = getMyEnrollment();
    const pct = enrollment?.progress || 0;
    const modules = (selected.modules || []).sort((a, b) => (a.order || 0) - (b.order || 0));
    const isBookmarked = enrollment?.bookmarked;

    return (
      <div className="space-y-4">
        <button onClick={() => { setSearchParams({ tab: activeTab }); setSelected(null); setActiveModule(null); load(); }} className="flex items-center gap-2 text-sm text-ilo-blue hover:underline">
          <span>&larr;</span> {activeTab === 'mylearning' ? t('Back to My Learning') : t('Back to Catalog')}
        </button>

        <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light overflow-hidden">
          {/* Hero */}
          <div className={`h-40 p-6 flex items-end justify-between relative ${
            selected.framework === 'gulf'
              ? 'bg-gradient-to-br from-amber-700 to-amber-500'
              : 'bg-gradient-to-br from-ilo-dark to-ilo-blue'
          }`}>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${
                  selected.framework === 'gulf' ? 'bg-white/25 text-white' : 'bg-white/25 text-white'
                }`}>{selected.framework === 'gulf' ? 'Gulf / City & Guilds' : 'NAVTTC'}</span>
              </div>
              <h2 className="text-xl font-bold text-white">{selected.title}</h2>
              <p className={`text-sm mt-1 ${selected.framework === 'gulf' ? 'text-amber-100' : 'text-blue-100'}`}>{selected.instructor} — {selected.institution}</p>
            </div>
            <div className="flex items-center gap-3">
              {enrollment && isWorker && (
                <button onClick={toggleBookmark} title={isBookmarked ? 'Remove bookmark' : 'Bookmark'}
                  className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors">
                  <svg className={`w-5 h-5 ${isBookmarked ? 'text-amber-400 fill-amber-400' : 'text-white'}`} viewBox="0 0 24 24" stroke="currentColor" fill={isBookmarked ? 'currentColor' : 'none'} strokeWidth={2}>
                    <path strokeLinecap="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                  </svg>
                </button>
              )}
              {enrollment && <ProgressRing pct={pct} size={56} />}
            </div>
          </div>

          <div className="p-6">
            {/* Meta badges */}
            <div className="flex flex-wrap gap-2 mb-4">
              <span className={`px-2.5 py-0.5 text-[11px] font-semibold rounded-full ${
                selected.framework === 'gulf' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-ilo-blue/10 text-ilo-blue'
              }`}>{selected.framework === 'gulf' ? 'Gulf / C&G' : 'NAVTTC'}</span>
              <span className="px-2.5 py-0.5 text-[11px] font-semibold rounded-full bg-ilo-blue/10 text-ilo-blue capitalize">{selected.trade}</span>
              <span className="px-2.5 py-0.5 text-[11px] font-semibold rounded-full bg-gold-light/10 text-gold-light">NQF {selected.nqfLevel}</span>
              <DifficultyBadge level={selected.difficulty} />
              <span className="px-2.5 py-0.5 text-[11px] font-semibold rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400">{selected.duration}</span>
              <span className="px-2.5 py-0.5 text-[11px] font-semibold rounded-full bg-gray-100 text-gray-600 dark:bg-navy-light dark:text-gray-300">
                {selected.enrollments?.length || 0}/{selected.maxEnrollment} enrolled
              </span>
              {selected.avgRating > 0 && (
                <span className="flex items-center gap-1 px-2.5 py-0.5 text-[11px] font-semibold rounded-full bg-amber-100 text-amber-700">
                  <svg className="w-3 h-3 fill-amber-500" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
                  {selected.avgRating} ({selected.ratings?.length})
                </span>
              )}
              {selected.startDate && (
                <span className="px-2.5 py-0.5 text-[11px] font-semibold rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-400">
                  {new Date(selected.startDate).toLocaleDateString()} — {selected.endDate ? new Date(selected.endDate).toLocaleDateString() : 'Ongoing'}
                </span>
              )}
            </div>

            {selected.description && <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">{selected.description}</p>}

            {/* Total time spent */}
            {enrollment && enrollment.totalTimeSpentMinutes > 0 && (
              <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-gray-50 dark:bg-navy-light rounded-lg w-fit">
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span className="text-xs text-gray-600 dark:text-gray-300">Total time: <strong>{Math.floor(enrollment.totalTimeSpentMinutes / 60)}h {enrollment.totalTimeSpentMinutes % 60}m</strong></span>
              </div>
            )}

            {/* Competency Targets & Transferable Skills */}
            {(selected.competencyTargets?.length > 0 || selected.transferableSkills?.length > 0) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                {selected.competencyTargets?.length > 0 && (
                  <div className="p-4 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 rounded-xl">
                    <p className="text-xs font-bold text-blue-800 dark:text-blue-300 mb-2">Competency Targets</p>
                    <div className="space-y-1.5">
                      {selected.competencyTargets.map((ct, i) => (
                        <div key={i} className="flex items-center justify-between">
                          <span className="text-xs text-blue-700 dark:text-blue-400">{ct.skill}</span>
                          <span className={`px-2 py-0.5 text-[9px] font-bold rounded-full capitalize ${
                            ct.targetLevel === 'expert' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' :
                            ct.targetLevel === 'advanced' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                            ct.targetLevel === 'intermediate' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                            'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                          }`}>{ct.targetLevel}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {selected.transferableSkills?.length > 0 && (
                  <div className="p-4 bg-teal-50 dark:bg-teal-900/10 border border-teal-200 dark:border-teal-800 rounded-xl">
                    <p className="text-xs font-bold text-teal-800 dark:text-teal-300 mb-2">Transferable Skills</p>
                    <div className="space-y-1.5">
                      {selected.transferableSkills.map((ts, i) => (
                        <div key={i}>
                          <span className="text-xs font-semibold text-teal-700 dark:text-teal-400">{ts.name}</span>
                          <p className="text-[11px] text-teal-600 dark:text-teal-500">{ts.description}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Syllabus */}
            {selected.syllabus && (
              <details className="mb-4">
                <summary className="text-sm font-semibold text-ilo-blue cursor-pointer hover:underline">{t('View Syllabus')}</summary>
                <div className="mt-2 p-4 bg-gray-50 dark:bg-navy-light rounded-xl text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
                  {selected.syllabus}
                </div>
              </details>
            )}

            {/* Prerequisites */}
            {selected.prerequisites?.length > 0 && (
              <div className="mb-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800">
                <p className="text-xs font-bold text-amber-700 dark:text-amber-400">{t('Prerequisites Required')}</p>
                <p className="text-xs text-amber-600 dark:text-amber-300 mt-1">Complete prerequisite courses before enrolling.</p>
              </div>
            )}

            {/* View Career Path button */}
            {selected.pathway && (
              <button onClick={() => {
                setPathwaySourceCourse(selected._id);
                setPreSelectedPathway(selected.pathway);
                setSelected(null);
                setActiveModule(null);
                setSearchParams({ tab: 'pathways' });
                setActiveTab('pathways');
              }}
                className="mb-4 px-4 py-2 text-sm font-semibold text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-xl hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                </svg>
                {t('View Career Path')}
              </button>
            )}

            {/* Enroll button — with AI Pre-Assessment */}
            {isWorker && !enrollment && (
              <button onClick={handleStartCourse} disabled={enrolling}
                className="mb-6 px-6 py-2.5 text-sm font-semibold bg-green-600 text-white rounded-xl hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                {enrolling ? t('Enrolling...') : t('Start Course')}
              </button>
            )}

            {/* Enrollment status bar */}
            {enrollment && (
              <div className="mb-6 p-4 rounded-xl bg-ilo-blue/5 dark:bg-ilo-blue/10 border border-ilo-blue/20">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-ilo-blue">{t('Enrolled')}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {enrollment.completedModules?.length || 0} of {modules.length} modules completed
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {enrollment.certificateIssued && (
                      <a href={`/lms/api/certificates/${enrollment.certificateId}/download`} target="_blank" rel="noopener noreferrer"
                        className="px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 hover:underline cursor-pointer">
                        Certificate: {enrollment.certificateId}
                      </a>
                    )}
                    <span className={`px-2.5 py-0.5 text-[10px] font-bold rounded-full uppercase
                      ${enrollment.status === 'completed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                        enrollment.status === 'submitted' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                        enrollment.status === 'evaluated' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' :
                        enrollment.status === 'in-progress' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                        'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'}`}>
                      {enrollment.status === 'submitted' ? t('Under Review') :
                       enrollment.status === 'evaluated' ? `${t('Evaluated')}: ${enrollment.evaluationSummary?.overallGrade || ''}` :
                       enrollment.status}
                    </span>
                  </div>
                </div>
                {/* Progress bar */}
                <div className="mt-2 h-2 bg-gray-200 dark:bg-navy-light rounded-full overflow-hidden">
                  <div className="h-full bg-ilo-blue rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                </div>

                {/* ── Submit for Evaluation button (when course completed — workers only) ── */}
                {enrollment.status === 'completed' && isWorker && (
                  <div className="mt-3 p-3 bg-green-50 dark:bg-green-900/10 rounded-xl border border-green-200 dark:border-green-800">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold text-green-700 dark:text-green-400">{t('Course Completed!')}</p>
                        <p className="text-xs text-green-600 dark:text-green-500">{t('Submit for evaluation to receive your grade and certificate')}</p>
                      </div>
                      <button onClick={handleSubmitForEvaluation} disabled={submittingEval}
                        className="px-5 py-2 text-sm font-semibold bg-green-600 text-white rounded-xl hover:bg-green-700 transition-colors disabled:opacity-50 shrink-0">
                        {submittingEval ? t('Submitting...') : t('Submit for Evaluation')}
                      </button>
                    </div>
                  </div>
                )}

                {/* ── View Results button (when submitted or evaluated) ── */}
                {['submitted', 'evaluated'].includes(enrollment.status) && (
                  <div className="mt-3">
                    <button onClick={() => setShowResults(true)}
                      className="w-full py-2.5 text-sm font-semibold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      {enrollment.status === 'evaluated' ? t('View Results & Grade') : t('View Submission Status')}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ─── Grading Breakdown & Certificate Eligibility Panels ─── */}
            {enrollment && isWorker && myWorkerId && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                <GradingBreakdown programId={selected._id} workerId={myWorkerId} />
                <CompetencyEligibility programId={selected._id} workerId={myWorkerId} />
              </div>
            )}

            {/* Quick Start CTA for enrolled workers */}
            {isWorker && enrollment && enrollment.status !== 'completed' && (() => {
              const nextMod = modules.find((m, i) =>
                !enrollment.completedModules?.includes(m._id) &&
                (i === 0 || enrollment.completedModules?.includes(modules[i - 1]?._id))
              );
              if (!nextMod) return null;
              return (
                <div className="flex items-center gap-4 p-4 bg-gradient-to-r from-green-500 to-emerald-600 rounded-xl text-white mb-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-green-100">{t('Up Next')}</p>
                    <p className="text-sm font-bold truncate">{nextMod.title}</p>
                    <p className="text-[11px] text-green-100 capitalize">{nextMod.type} &bull; {nextMod.duration} min</p>
                  </div>
                  <button onClick={() => setActiveModule(nextMod._id)}
                    className="px-5 py-2.5 bg-white text-green-700 font-semibold text-sm rounded-xl hover:bg-green-50 transition-colors shrink-0">
                    {t('Start Module')}
                  </button>
                </div>
              );
            })()}

            {/* Program tabs */}
            <div className="flex rounded-lg border border-border dark:border-navy-light overflow-hidden mb-4">
              <TabButton active={programTab === 'modules'} onClick={() => setProgramTab('modules')}>
                {t('Modules')} ({modules.length})
              </TabButton>
              <TabButton active={programTab === 'discussions'} onClick={() => setProgramTab('discussions')} count={selected.discussions?.length}>
                {t('Discussions')}
              </TabButton>
              <TabButton active={programTab === 'announcements'} onClick={() => setProgramTab('announcements')} count={selected.announcements?.length}>
                {t('Announcements')}
              </TabButton>
              <TabButton active={programTab === 'ratings'} onClick={() => setProgramTab('ratings')} count={selected.ratings?.length}>
                {t('Ratings')}
              </TabButton>
            </div>

            {/* ─── Modules tab ─── */}
            {programTab === 'modules' && (
              <>
                {isAdmin && (
                  <div className="mb-4 flex items-center gap-2 flex-wrap">
                    <button onClick={() => setEditingModule('new')}
                      className="px-3 py-1.5 text-xs font-semibold bg-ilo-blue text-white rounded-lg hover:bg-ilo-dark transition-colors">
                      + {t('Add Module')}
                    </button>
                    <button onClick={() => setShowAIGenerate(true)}
                      className="px-3 py-1.5 text-xs font-semibold bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-lg hover:from-violet-700 hover:to-indigo-700 transition-all flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                      {t('Generate with AI')}
                    </button>
                    <button onClick={() => fetchFreshnessCheck(selected._id)}
                      disabled={loadingAI.freshness}
                      className="px-3 py-1.5 text-xs font-semibold bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors disabled:opacity-50 flex items-center gap-1">
                      {loadingAI.freshness ? (
                        <div className="w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      )}
                      {t('Check Freshness')}
                    </button>
                  </div>
                )}

                {/* P4d: Freshness check results */}
                {freshnessResults && isAdmin && (
                  <div className="mb-4 p-4 bg-amber-50 dark:bg-amber-900/10 rounded-xl border border-amber-200 dark:border-amber-800">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-bold text-amber-700 dark:text-amber-400 flex items-center gap-2">
                        {t('Content Freshness Report')}
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300">{t('AI-powered')}</span>
                      </h4>
                      <button onClick={() => setFreshnessResults(null)}
                        className="text-xs text-gray-400 hover:text-gray-600">&times; {t('Dismiss')}</button>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-amber-200 dark:border-amber-800">
                            <th className="pb-2 font-semibold">{t('Module')}</th>
                            <th className="pb-2 font-semibold text-center">{t('Status')}</th>
                            <th className="pb-2 font-semibold">{t('Issues')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {freshnessResults.map((r, i) => (
                            <tr key={i} className="border-b border-amber-100 dark:border-amber-900/30">
                              <td className="py-2 font-medium dark:text-white">{r.title}</td>
                              <td className="py-2 text-center">
                                <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${r.isFresh ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                                  {r.isFresh ? t('Fresh') : t('Stale')}
                                </span>
                              </td>
                              <td className="py-2 text-gray-600 dark:text-gray-400">
                                {r.issues?.length > 0 ? r.issues.join('; ') : t('No issues found')}
                                {r.recommendations?.length > 0 && (
                                  <p className="text-violet-600 dark:text-violet-400 mt-0.5">{r.recommendations.join('; ')}</p>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {editingModule && (
                  <div className="mb-4">
                    <ModuleEditor
                      programId={selected._id}
                      existingModule={editingModule === 'new' ? null : editingModule}
                      onSaved={() => { setEditingModule(null); selectProgram(selected._id); }}
                      onCancel={() => setEditingModule(null)}
                    />
                  </div>
                )}

                <div className="space-y-2">
                  {modules.map((m, i) => {
                    const isModCompleted = enrollment?.completedModules?.includes(m._id);
                    const isSkippedViaPreCheck = enrollment?.skippedViaPreCheck?.includes(m._id);
                    const prevCompleted = i === 0 || enrollment?.completedModules?.includes(modules[i - 1]?._id);
                    const canAccess = (enrollment && (isModCompleted || prevCompleted)) || isAdmin;
                    const isDeadlinePassed = m.deadline && new Date(m.deadline) < new Date();
                    const isFinalQuiz = m.type === 'quiz' && i === modules.length - 1;

                    const isStale = m.flaggedStale;
                    const modQuizAttempts = enrollment?.quizAttempts?.filter(a => a.moduleId === m._id) || [];
                    const bestScore = modQuizAttempts.length > 0 ? Math.max(...modQuizAttempts.map(a => a.score)) : null;

                    // Time spent on this module
                    const modTimeLog = enrollment?.moduleTimeLog?.find(t => t.moduleId === m._id);
                    const modTimeSpent = modTimeLog?.timeSpentMinutes || 0;

                    // Module credential
                    const modCredential = enrollment?.moduleCredentials?.find(mc => mc.moduleId === m._id);

                    return (
                      <React.Fragment key={m._id || i}>
                      {/* Visual separator before final assessment */}
                      {isFinalQuiz && (
                        <div className="flex items-center gap-3 my-3">
                          <div className="flex-1 h-px bg-gradient-to-r from-transparent via-amber-400 to-transparent" />
                          <span className="px-3 py-1 text-xs font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-full border border-amber-200 dark:border-amber-800 flex items-center gap-1.5">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" /></svg>
                            {t('Final Assessment')}
                          </span>
                          <div className="flex-1 h-px bg-gradient-to-r from-transparent via-amber-400 to-transparent" />
                        </div>
                      )}
                      <div
                        className={`flex items-center gap-3 p-3 rounded-xl border transition-all
                          ${canAccess ? 'cursor-pointer hover:shadow-md' : 'opacity-50 cursor-not-allowed'}
                          ${isFinalQuiz && !isModCompleted ? 'border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-900/10 ring-1 ring-amber-200 dark:ring-amber-800' :
                            isModCompleted ? 'border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/10' :
                            canAccess ? 'border-ilo-blue/30 dark:border-ilo-blue/30 bg-ilo-blue/5' :
                            'border-gray-200 dark:border-navy-light'}`}>
                        <div onClick={() => {
                            if (!canAccess) return;
                            // Check if module has pre-check questions and hasn't been taken/completed
                            const preCheckTaken = enrollment?.modulePreChecks?.some(pc => pc.moduleId === m._id);
                            if (m.preCheckQuestions?.length > 0 && !isModCompleted && !preCheckTaken && isWorker) {
                              setShowModulePreCheck(m._id);
                            } else {
                              setActiveModule(m._id);
                            }
                          }}
                          className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold shrink-0
                          ${isModCompleted ? 'bg-green-100 text-green-600 dark:bg-green-900/30' :
                            canAccess ? 'bg-ilo-blue/10 text-ilo-blue' :
                            'bg-gray-100 dark:bg-navy-light text-gray-400'}`}>
                          {isModCompleted ? '\u2713' : !canAccess ? (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                          ) : i + 1}
                        </div>
                        <div className="flex-1 min-w-0" onClick={() => {
                            if (!canAccess) return;
                            const preCheckTaken = enrollment?.modulePreChecks?.some(pc => pc.moduleId === m._id);
                            if (m.preCheckQuestions?.length > 0 && !isModCompleted && !preCheckTaken && isWorker) {
                              setShowModulePreCheck(m._id);
                            } else {
                              setActiveModule(m._id);
                            }
                          }}>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="text-sm font-medium dark:text-white">{m.title}</p>
                            {isSkippedViaPreCheck && <span className="px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">Skipped via Pre-Check</span>}
                            {modCredential && <span className="px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Unit Cert</span>}
                          </div>
                          <p className="text-[11px] text-gray-500">
                            {m.duration} min &bull; <span className="capitalize">{m.type}</span>
                            {bestScore !== null && <span className="ml-2 text-ilo-blue font-semibold">Best: {bestScore}%</span>}
                            {modTimeSpent > 0 && <span className="ml-2 text-gray-400">{modTimeSpent}m spent</span>}
                            {isStale && <span className="ml-2 text-amber-600 font-semibold">{t('Stale')}</span>}
                            {m.deadline && (
                              <span className={`ml-2 ${isDeadlinePassed ? 'text-red-500' : 'text-amber-600'}`}>
                                Due: {new Date(m.deadline).toLocaleDateString()}
                              </span>
                            )}
                          </p>
                        </div>
                        <span className={`px-2.5 py-0.5 text-[10px] font-bold rounded-full uppercase shrink-0
                          ${m.type === 'video' ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400' :
                            m.type === 'quiz' ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400' :
                            m.type === 'scenario' ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/20 dark:text-rose-400' :
                            m.type === 'practical' || m.type === 'assignment' ? 'bg-green-100 text-green-600 dark:bg-green-900/20 dark:text-green-400' :
                            'bg-blue-100 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400'}`}>
                          {m.type}
                        </span>
                        {isAdmin && (
                          <div className="flex gap-1 shrink-0">
                            <button onClick={(e) => { e.stopPropagation(); setEditingModule(m); }}
                              className="px-2 py-1 text-[10px] font-semibold text-ilo-blue hover:bg-ilo-blue/10 rounded">Edit</button>
                            <button onClick={(e) => { e.stopPropagation(); if (confirm('Delete this module?')) deleteModule(m._id); }}
                              className="px-2 py-1 text-[10px] font-semibold text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded">Del</button>
                          </div>
                        )}
                      </div>
                      </React.Fragment>
                    );
                  })}
                </div>

                {isAdmin && selected.enrollments?.length > 0 && (
                  <div className="mt-6 p-4 bg-gray-50 dark:bg-navy-light rounded-xl">
                    <SectionHeader>Enrollment Overview ({selected.enrollments.length})</SectionHeader>
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div>
                        <p className="text-lg font-bold text-green-600">{selected.enrollments.filter(e => e.status === 'completed').length}</p>
                        <p className="text-[10px] text-gray-500">Completed</p>
                      </div>
                      <div>
                        <p className="text-lg font-bold text-amber-600">{selected.enrollments.filter(e => e.status === 'in-progress').length}</p>
                        <p className="text-[10px] text-gray-500">In Progress</p>
                      </div>
                      <div>
                        <p className="text-lg font-bold text-blue-600">{selected.enrollments.filter(e => e.status === 'enrolled').length}</p>
                        <p className="text-[10px] text-gray-500">Not Started</p>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ─── Discussions tab ─── */}
            {programTab === 'discussions' && (
              <DiscussionPanel
                programId={selected._id}
                discussions={selected.discussions}
                isAdmin={isAdmin}
                onRefresh={() => selectProgram(selected._id)}
              />
            )}

            {/* ─── Announcements tab ─── */}
            {programTab === 'announcements' && (
              <AnnouncementsPanel
                programId={selected._id}
                announcements={selected.announcements}
                isAdmin={isAdmin}
                onRefresh={() => selectProgram(selected._id)}
              />
            )}

            {/* ─── Ratings tab ─── */}
            {programTab === 'ratings' && (
              <RatingPanel
                programId={selected._id}
                ratings={selected.ratings}
                avgRating={selected.avgRating}
                myWorkerId={myWorkerId}
                onRefresh={() => selectProgram(selected._id)}
              />
            )}
          </div>
        </div>

        {/* P4c: AI Generate Modal */}
        {showAIGenerate && isAdmin && (
          <AIGenerateModal
            programId={selected._id}
            trade={selected.trade}
            onGenerated={() => selectProgram(selected._id)}
            onClose={() => setShowAIGenerate(false)}
          />
        )}

        {/* Module Pre-Check Modal */}
        {showModulePreCheck && (() => {
          const pcMod = selected.modules?.find(m => m._id === showModulePreCheck);
          if (!pcMod?.preCheckQuestions?.length) return null;
          return (
            <ModulePreCheck
              questions={pcMod.preCheckQuestions}
              programId={selected._id}
              moduleId={pcMod._id}
              workerId={myWorkerId}
              passMark={selected.passMark || 80}
              onPass={() => { setShowModulePreCheck(null); selectProgram(selected._id); }}
              onFail={() => { setShowModulePreCheck(null); setActiveModule(pcMod._id); }}
              onClose={() => setShowModulePreCheck(null)}
            />
          );
        })()}
      </div>
    );
  };

  /* ═══════════════════════════════════════════════════════════
     CATALOG / MY LEARNING / DASHBOARD tabs
     ═══════════════════════════════════════════════════════════ */
  const enrolledIds = programs
    .filter(p => p.enrollments?.some(e => e.worker === myWorkerId))
    .map(p => p._id);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold dark:text-white">{t('LMS')} — Learning Management</h2>
            {isWorker && <HelpTip tipId="lms-intro" text="Browse courses in the Catalog, enroll with one click, and track your progress in My Learning. Use the tabs above to switch views." position="bottom" />}
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Browse training programs, take courses, and earn certifications</p>
        </div>
        <div className="flex items-center gap-2">
          {isWorker && <NotificationBell notifications={notifications} onMarkRead={markNotifRead} />}
          <div className="flex rounded-lg border border-border dark:border-navy-light overflow-hidden tl-tabs max-w-[calc(100vw-2rem)]">
            <TabButton active={activeTab === 'catalog'} onClick={() => handleTabSwitch('catalog')}>{t('Courses')}</TabButton>
            {isWorker && <TabButton active={activeTab === 'mylearning'} onClick={() => handleTabSwitch('mylearning')} count={myCourses.length}>{t('My Learning')}</TabButton>}
            {(isWorker || isAdmin) && <TabButton active={activeTab === 'training'} onClick={() => handleTabSwitch('training')}>{t('Training')}</TabButton>}
            {isWorker && <TabButton active={activeTab === 'pathways'} onClick={() => handleTabSwitch('pathways')}>{t('Pathways')}</TabButton>}
            {isWorker && <TabButton active={activeTab === 'achievements'} onClick={() => handleTabSwitch('achievements')}>{t('Achievements')}</TabButton>}
            {isWorker && <TabButton active={activeTab === 'transcript'} onClick={() => handleTabSwitch('transcript')}>{t('Transcript')}</TabButton>}
            {isAdmin && <TabButton active={activeTab === 'dashboard'} onClick={() => handleTabSwitch('dashboard')}>{t('Dashboard')}</TabButton>}
          </div>
        </div>
      </div>

      {/* Breadcrumb when viewing course/module */}
      {selected && (
        <div className="flex items-center gap-2 text-sm px-1">
          <button onClick={() => { setSearchParams({ tab: activeTab }); setSelected(null); setActiveModule(null); load(); }}
            className="text-ilo-blue hover:underline font-medium">
            {activeTab === 'mylearning' ? t('My Learning') : t('Catalog')}
          </button>
          <span className="text-gray-400 dark:text-gray-500">›</span>
          {activeModule ? (
            <>
              <button onClick={() => setActiveModule(null)}
                className="text-ilo-blue hover:underline font-medium truncate max-w-[200px]">
                {selected.title}
              </button>
              <span className="text-gray-400 dark:text-gray-500">›</span>
              <span className="text-gray-600 dark:text-gray-300 truncate max-w-[200px]">
                {selected.modules?.find(m => m._id === activeModule)?.title}
              </span>
            </>
          ) : (
            <span className="text-gray-600 dark:text-gray-300 font-medium truncate max-w-[300px]">
              {selected.title}
            </span>
          )}
        </div>
      )}

      {/* Persistent Continue Learning widget (visible on non-mylearning tabs when worker has in-progress course) */}
      {isWorker && !selected && activeTab !== 'mylearning' && myCourses.filter(c => c.enrollment.status === 'in-progress' && c.nextModule).length > 0 && (() => {
        const course = myCourses.find(c => c.enrollment.status === 'in-progress' && c.nextModule);
        return (
          <div className="flex items-center gap-4 bg-gradient-to-r from-ilo-dark to-ilo-blue rounded-xl px-4 py-3 text-white">
            <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-blue-200 font-semibold">{t('Continue Learning')}</p>
              <p className="text-sm font-bold truncate">{course.title}</p>
              <p className="text-[11px] text-blue-100 truncate">Next: {course.nextModule.title}</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="text-center hidden sm:block">
                <p className="text-lg font-bold">{course.enrollment.progress}%</p>
                <p className="text-[10px] text-blue-200">progress</p>
              </div>
              <button onClick={() => selectProgram(course._id)}
                className="px-4 py-2 text-xs font-semibold bg-white text-ilo-blue rounded-lg hover:bg-blue-50 transition-colors">
                Resume
              </button>
            </div>
          </div>
        );
      })()}

      {/* ─── Content ─── */}
      {showPreAssessment && selected ? (
        <PreAssessment
          program={selected}
          workerId={myWorkerId}
          onComplete={handlePreAssessmentComplete}
          onSkip={async () => { setShowPreAssessment(false); await handleEnroll(); }}
        />
      ) : showResults && selected ? (
        <ResultsView
          program={selected}
          enrollment={getMyEnrollment()}
          onBack={() => setShowResults(false)}
        />
      ) : selected && activeModule ? renderModuleViewer()
        : selected ? renderCourseDetail()
        : activeTab === 'dashboard' && isAdmin ? (
        <InstructorDashboard />
      ) : activeTab === 'transcript' && isWorker ? (
        <TranscriptTab />
      ) : activeTab === 'pathways' ? (
        <PathwaysTab isWorker={isWorker} isAdmin={isAdmin} workerId={myWorkerId}
          preSelectedPathway={preSelectedPathway} onPathwayViewed={() => setPreSelectedPathway(null)}
          onBackToCourse={pathwaySourceCourse ? () => { selectProgram(pathwaySourceCourse); setPathwaySourceCourse(null); setActiveTab('catalog'); } : null}
          onSelectCourse={(courseId) => { selectProgram(courseId); setActiveTab('catalog'); }} />
      ) : activeTab === 'achievements' && isWorker ? (
        <AchievementsTab workerId={myWorkerId} />
      ) : activeTab === 'training' && (isWorker || isAdmin) ? (
        <TrainingTab workerId={myWorkerId} />
      ) : activeTab === 'mylearning' && isWorker ? (
        /* ─── My Learning ─── */
        <div className="space-y-4">
          {myCourses.length === 0 ? (
            <div className="text-center py-16 bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light">
              <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
              <p className="text-sm text-gray-400">No courses enrolled yet</p>
              <button onClick={() => setActiveTab('catalog')}
                className="mt-3 px-4 py-2 text-sm font-semibold text-ilo-blue hover:underline">Browse Catalog</button>
            </div>
          ) : (
            <>
              {/* Continue learning card */}
              {myCourses.filter(c => c.enrollment.status === 'in-progress' && c.nextModule).length > 0 && (
                <div className="bg-gradient-to-r from-ilo-dark to-ilo-blue rounded-xl p-5 text-white">
                  <p className="text-xs font-semibold text-blue-200 mb-1">Continue Learning</p>
                  {(() => {
                    const course = myCourses.find(c => c.enrollment.status === 'in-progress' && c.nextModule);
                    return (
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <h3 className="text-lg font-bold">{course.title}</h3>
                          <p className="text-sm text-blue-100 mt-1">Next: {course.nextModule.title} ({course.nextModule.type})</p>
                        </div>
                        <button onClick={() => selectProgram(course._id)}
                          className="px-5 py-2.5 bg-white text-ilo-blue font-semibold text-sm rounded-xl hover:bg-blue-50 transition-colors shrink-0">
                          Resume
                        </button>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Enrolled" value={myCourses.length} color="bg-ilo-blue/10 text-ilo-blue" />
                <StatCard label="In Progress" value={myCourses.filter(c => c.enrollment.status === 'in-progress').length} color="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" />
                <StatCard label="Completed" value={myCourses.filter(c => c.enrollment.status === 'completed').length} color="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" />
                <StatCard label="Certificates" value={myCourses.filter(c => c.enrollment.certificateIssued).length} color="bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" />
              </div>

              {/* P4a: AI Adaptive Learning — generate study plan for in-progress course */}
              {myCourses.filter(c => c.enrollment.status === 'in-progress').length > 0 && (
                <div className="bg-white dark:bg-navy-mid rounded-xl border border-violet-200 dark:border-violet-800 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <svg className="w-5 h-5 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                      <h3 className="text-sm font-bold dark:text-white">{t('AI Study Plan')}</h3>
                      <HelpTip tipId="ai-study-plan" text="Click a course below to generate a personalized study plan powered by AI. It will identify your weak areas and suggest the best module order." position="bottom" />
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300">{t('AI-powered')}</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{t('aiStudyPlanDesc')}</p>
                  <div className="flex flex-wrap gap-2">
                    {myCourses.filter(c => c.enrollment.status === 'in-progress').map(c => (
                      <button key={c._id} onClick={() => fetchAdaptivePath(c._id)}
                        disabled={loadingAI.adaptive}
                        className="px-3 py-1.5 text-xs font-semibold bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 rounded-lg hover:bg-violet-100 dark:hover:bg-violet-900/30 transition-colors disabled:opacity-50 flex items-center gap-1.5">
                        {loadingAI.adaptive ? (
                          <div className="w-3 h-3 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                        )}
                        {c.title}
                      </button>
                    ))}
                  </div>

                  {/* Adaptive path results */}
                  {adaptivePath && (
                    <div className="mt-4 space-y-3 p-3 bg-violet-50 dark:bg-violet-900/10 rounded-xl border border-violet-200 dark:border-violet-800">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold text-violet-700 dark:text-violet-300">{t('Your Personalized Study Plan')}</h4>
                        <span className="text-[10px] text-gray-400">{adaptivePath.generatedAt ? new Date(adaptivePath.generatedAt).toLocaleDateString() : ''}</span>
                      </div>

                      {adaptivePath.recommendations?.length > 0 && (
                        <div>
                          <p className="text-[11px] font-bold text-gray-600 dark:text-gray-400 mb-1">{t('Recommendations')}:</p>
                          <ul className="space-y-1">
                            {adaptivePath.recommendations.map((r, i) => (
                              <li key={i} className="text-xs text-gray-700 dark:text-gray-300 flex items-start gap-1.5">
                                <span className="text-violet-500 mt-0.5">&#8226;</span> {r}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {adaptivePath.weakAreas?.length > 0 && (
                        <div>
                          <p className="text-[11px] font-bold text-amber-600 dark:text-amber-400 mb-1">{t('Areas to Improve')}:</p>
                          <div className="space-y-1">
                            {adaptivePath.weakAreas.map((w, i) => (
                              <div key={i} className="text-xs p-2 bg-amber-50 dark:bg-amber-900/10 rounded-lg">
                                <span className="font-semibold text-amber-700 dark:text-amber-400">{w.skill}:</span>{' '}
                                <span className="text-gray-600 dark:text-gray-400">{w.suggestion}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {adaptivePath.suggestedOrder?.length > 0 && (
                        <div>
                          <p className="text-[11px] font-bold text-gray-600 dark:text-gray-400 mb-1">{t('Suggested Module Order')}:</p>
                          <div className="space-y-1">
                            {adaptivePath.suggestedOrder.map((s, i) => (
                              <div key={i} className="text-xs flex items-center gap-2 text-gray-700 dark:text-gray-300">
                                <span className="w-5 h-5 rounded-full bg-violet-500 text-white flex items-center justify-center text-[10px] font-bold shrink-0">{i + 1}</span>
                                <span className="italic text-gray-500">{s.reason}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <button onClick={() => setAdaptivePath(null)}
                        className="text-[11px] text-gray-400 hover:text-gray-600 hover:underline">{t('Dismiss')}</button>
                    </div>
                  )}
                </div>
              )}

              {/* AI-Powered Recommendations */}
              <RecommendationsPanel workerId={myWorkerId} onSelectCourse={selectProgram} />

              {/* Competency Map */}
              <CompetencyMap workerId={myWorkerId} />

              {/* Course list */}
              <div className="space-y-3">
                {myCourses.map(c => (
                  <div key={c._id} onClick={() => selectProgram(c._id)}
                    className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-4 cursor-pointer hover:shadow-lg transition-shadow">
                    <div className="flex items-center gap-4">
                      <ProgressRing pct={c.enrollment.progress} size={52} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm font-bold dark:text-white">{c.title}</h3>
                          {c.enrollment.bookmarked && <svg className="w-4 h-4 text-amber-400 fill-amber-400" viewBox="0 0 24 24"><path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" /></svg>}
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {c.instructor} &bull; {c.enrollment.completedModules}/{c.totalModules} modules
                          {c.nextModule && <span className="ml-2 text-ilo-blue">Next: {c.nextModule.title}</span>}
                        </p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-ilo-blue/10 text-ilo-blue capitalize">{c.trade}</span>
                          <DifficultyBadge level={c.difficulty} />
                          <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full uppercase
                            ${c.enrollment.status === 'evaluated' ? 'bg-indigo-100 text-indigo-700' :
                              c.enrollment.status === 'submitted' ? 'bg-yellow-100 text-yellow-700' :
                              c.enrollment.status === 'completed' ? 'bg-green-100 text-green-700' :
                              c.enrollment.status === 'in-progress' ? 'bg-amber-100 text-amber-700' :
                              'bg-blue-100 text-blue-700'}`}>
                            {c.enrollment.status === 'submitted' ? t('Under Review') :
                             c.enrollment.status === 'evaluated' ? t('Evaluated') :
                             c.enrollment.status}
                          </span>
                          {c.enrollment.certificateIssued && (
                            <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-purple-100 text-purple-700">
                              Certified
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {c.avgRating > 0 && (
                          <div className="flex items-center gap-1">
                            <svg className="w-3.5 h-3.5 fill-amber-400" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
                            <span className="text-xs text-gray-500">{c.avgRating}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        /* ─── Catalog ─── */
        <>
          {/* ── Framework main tabs: NAVTTC | City & Guilds | Archived ── */}
          {(() => {
            const FW = [
              { key: 'navttc', label: 'NAVTTC', sub: 'National · Pakistan', color: 'border-ilo-blue text-ilo-blue' },
              { key: 'gulf', label: 'City & Guilds', sub: 'International · Gulf', color: 'border-amber-500 text-amber-600 dark:text-amber-400' },
              ...(isAdmin ? [{ key: 'archived', label: 'Archived', sub: 'Completed · removed', color: 'border-gray-500 text-gray-600 dark:text-gray-300' }] : []),
            ];
            return (
              <div className="tl-tabs border-b-2 border-border dark:border-navy-light">
                {FW.map(fw => {
                  const active = filterFramework === fw.key;
                  return (
                    <button key={fw.key} onClick={() => setFilterFramework(fw.key)}
                      className={`text-left px-5 py-2.5 whitespace-nowrap shrink-0 border-b-[3px] -mb-[2px] transition-colors ${active ? fw.color : 'border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'}`}>
                      <span className="block text-sm font-bold">{fw.key === 'archived' ? '🗄 ' : ''}{fw.label}</span>
                      <span className="block text-[10px] font-medium opacity-70">{fw.sub}</span>
                    </button>
                  );
                })}
              </div>
            );
          })()}

          {/* Search & Filters */}
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-[200px]">
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search programs, trades, instructors..."
                className="w-full p-2.5 text-sm rounded-xl border border-border dark:border-navy-light dark:bg-navy-mid dark:text-white pl-10"
                style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 24 24\' stroke=\'%239CA3AF\' stroke-width=\'2\'%3E%3Cpath stroke-linecap=\'round\' d=\'m21 21-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: '10px center', backgroundSize: '18px' }} />
            </div>
            <select value={filterDifficulty} onChange={e => setFilterDifficulty(e.target.value)}
              className="p-2.5 text-sm rounded-xl border border-border dark:border-navy-light dark:bg-navy-mid dark:text-white">
              <option value="">All Levels</option>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3">
            <StatCard label={filterFramework === 'archived' ? 'Archived' : 'Courses'} value={programs.length} color="bg-ilo-blue/10 text-ilo-blue" />
            <StatCard label="My Enrolled" value={enrolledIds.length} color="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" />
            <StatCard label="Trades" value={trades.length} color="bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" />
          </div>

          {/* AI Recommendations for workers */}
          {isWorker && myWorkerId && (
            <RecommendationsPanel workerId={myWorkerId} onSelectCourse={selectProgram} />
          )}

          {/* ── Major sector tabs (NAVTTC-style categories) ── */}
          <div className="tl-tabs border-b border-border dark:border-navy-light pb-px">
            {sectorTabs.map(s => {
              const active = s.key === activeSector;
              return (
                <button key={s.key} onClick={() => setActiveSector(s.key)}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold whitespace-nowrap shrink-0 border-b-2 transition-colors ${
                    active
                      ? 'border-ilo-blue text-ilo-blue'
                      : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-ilo-blue'
                  }`}>
                  <span>{s.icon}</span>{s.label}
                  <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded-full ${active ? 'bg-ilo-blue text-white' : 'bg-gray-100 dark:bg-navy-light text-gray-500 dark:text-gray-400'}`}>{s.count}</span>
                </button>
              );
            })}
          </div>

          {/* ── Sub-tabs: trades within the selected sector ── */}
          {subTrades.length > 1 && (
            <div className="tl-tabs">
              <button onClick={() => setActiveSubTrade('')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-full whitespace-nowrap shrink-0 transition-colors ${activeSubTrade === '' ? 'bg-ilo-blue text-white' : 'bg-white dark:bg-navy-mid border border-border dark:border-navy-light text-gray-600 dark:text-gray-300 hover:border-ilo-blue'}`}>
                All ({sectorCourses.length})
              </button>
              {subTrades.map(tr => (
                <button key={tr} onClick={() => setActiveSubTrade(tr)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-full whitespace-nowrap shrink-0 capitalize transition-colors ${activeSubTrade === tr ? 'bg-ilo-blue text-white' : 'bg-white dark:bg-navy-mid border border-border dark:border-navy-light text-gray-600 dark:text-gray-300 hover:border-ilo-blue'}`}>
                  {prettyTrade(tr)}
                </button>
              ))}
            </div>
          )}

          {/* Program cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {visibleCourses.map(p => {
              const isEnrolled = enrolledIds.includes(p._id);
              return (
                <div key={p._id} onClick={() => selectProgram(p._id)}
                  className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light overflow-hidden cursor-pointer hover:shadow-lg transition-shadow group">
                  <div className={`h-28 p-4 flex items-end relative ${
                    p.framework === 'gulf'
                      ? 'bg-gradient-to-br from-amber-700 to-amber-500'
                      : 'bg-gradient-to-br from-ilo-dark to-ilo-blue'
                  }`}>
                    <h3 className="text-white font-bold text-sm group-hover:text-gold-accent transition-colors pr-16">{p.title}</h3>
                    {isEnrolled && (
                      <span className="absolute top-3 right-3 px-2 py-0.5 text-[10px] font-bold rounded-full bg-green-500 text-white">
                        Enrolled
                      </span>
                    )}
                    {p.framework === 'gulf' ? (
                      <span className="absolute top-3 left-3 px-2 py-0.5 text-[10px] font-bold rounded-full bg-white/25 text-white">
                        Gulf/C&G
                      </span>
                    ) : (
                      <span className="absolute top-3 left-3 px-2 py-0.5 text-[10px] font-bold rounded-full bg-white/25 text-white">
                        NAVTTC
                      </span>
                    )}
                    {p.avgRating > 0 && (
                      <span className="absolute bottom-3 right-3 flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full bg-black/30 text-white">
                        <svg className="w-3 h-3 fill-amber-400" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
                        {p.avgRating}
                      </span>
                    )}
                  </div>
                  <div className="p-4">
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${
                        p.framework === 'gulf' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-ilo-blue/10 text-ilo-blue'
                      }`}>{p.framework === 'gulf' ? 'Gulf/C&G' : 'NAVTTC'}</span>
                      <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-ilo-blue/10 text-ilo-blue capitalize">{p.trade}</span>
                      <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-gold-light/10 text-gold-light">NQF {p.nqfLevel}</span>
                      <DifficultyBadge level={p.difficulty} />
                      {p.modules?.length > 0 && (
                        <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-gray-100 text-gray-500 dark:bg-navy-light dark:text-gray-400">
                          {p.modules.length} modules
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{p.instructor} — {p.institution}</p>
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100 dark:border-navy-light gap-2">
                      <span className="text-[11px] text-gray-500 shrink-0">{p.duration}</span>
                      <div className="flex items-center gap-1.5 flex-wrap justify-end">
                        {isWorker && (
                          <button onClick={(e) => { e.stopPropagation(); selectProgram(p._id); }}
                            className={`px-3 py-1 text-[11px] font-semibold rounded-lg transition-colors ${isEnrolled ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-ilo-blue text-white hover:bg-ilo-dark'}`}>
                            {isEnrolled ? 'Continue' : 'View & Enroll'}
                          </button>
                        )}
                        {isAdmin && filterFramework !== 'archived' && (<>
                          <span className="text-[11px] text-gray-500 mr-1">{p.enrollments?.length || 0} enrolled</span>
                          <button onClick={(e) => archiveCourse(e, p._id, true)} disabled={rowBusy === p._id} title="Archive (completed)"
                            className="px-2 py-1 text-[11px] font-semibold rounded-lg border border-border dark:border-navy-light text-gray-500 hover:bg-gray-50 dark:hover:bg-navy-light disabled:opacity-50">🗄 Archive</button>
                          <button onClick={(e) => deleteCourse(e, p._id, p.title)} disabled={rowBusy === p._id} title="Delete permanently"
                            className="px-2 py-1 text-[11px] font-semibold rounded-lg border border-red-300 dark:border-red-800 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50">🗑 Remove</button>
                        </>)}
                        {isAdmin && filterFramework === 'archived' && (<>
                          <button onClick={(e) => archiveCourse(e, p._id, false)} disabled={rowBusy === p._id}
                            className="px-2 py-1 text-[11px] font-semibold rounded-lg border border-ilo-blue text-ilo-blue hover:bg-ilo-blue/10 disabled:opacity-50">↩ Restore</button>
                          <button onClick={(e) => deleteCourse(e, p._id, p.title)} disabled={rowBusy === p._id}
                            className="px-2 py-1 text-[11px] font-semibold rounded-lg border border-red-300 dark:border-red-800 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50">🗑 Delete</button>
                        </>)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {visibleCourses.length === 0 && (
            <div className="text-center py-16 bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light">
              <p className="text-sm text-gray-400">
                {searchQuery || filterDifficulty || filterFramework
                  ? 'No programs match your filters in this category'
                  : 'No programs in this category yet'}
              </p>
              {(searchQuery || filterDifficulty || filterFramework) && (
                <button onClick={() => { setSearchQuery(''); setFilterDifficulty(''); setFilterFramework(''); }}
                  className="mt-2 text-sm text-ilo-blue hover:underline">Clear filters</button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
