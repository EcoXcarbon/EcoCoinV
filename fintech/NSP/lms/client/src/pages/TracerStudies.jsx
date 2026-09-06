import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import toast from 'react-hot-toast';

/* ─── Fetch helpers ─── */
const csrf = () => document.cookie.match(/csrf=([^;]+)/)?.[1] || '';
const hdrs = (extra = {}) => ({
  'Content-Type': 'application/json',
  'X-CSRF-Token': csrf(),
  ...extra,
});
const apiFetch = async (path, opts = {}) => {
  const res = await fetch(`/lms/api/v1${path}`, {
    credentials: 'include',
    ...opts,
    headers: hdrs(opts.headers),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || res.statusText);
  }
  return res;
};

/* ─── Constants ─── */
const TRADES = ['plumbing', 'electrical', 'welding', 'carpentry', 'masonry', 'hvac', 'auto-mechanic', 'tailoring', 'beautician', 'it-support'];
const NQF_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8];
const QUESTION_TYPES = [
  { value: 'text', label: 'Free Text' },
  { value: 'single-choice', label: 'Single Choice' },
  { value: 'multi-choice', label: 'Multiple Choice' },
  { value: 'rating', label: 'Rating (1-5)' },
  { value: 'salary-range', label: 'Salary Range' },
];
const EMPLOYMENT_STATUSES = ['employed', 'self-employed', 'unemployed', 'further-study', 'other'];
const SALARY_RANGES = ['Below 15,000', '15,000-30,000', '30,000-50,000', '50,000-75,000', '75,000-100,000', 'Above 100,000'];
const EMP_COLORS = { employed: '#22c55e', 'self-employed': '#3b82f6', unemployed: '#ef4444', 'further-study': '#f59e0b', other: '#8b5cf6' };

/* ─── Shared UI primitives ─── */
const statusBadge = (s) => {
  const c = s === 'active' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
    : s === 'closed' ? 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
    : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300';
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${c}`}>{s}</span>;
};

function MetricCard({ label, value, sub }) {
  return (
    <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-4 text-center">
      <p className="text-2xl font-bold dark:text-white">{value}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{label}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function Collapsible({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border dark:border-navy-light rounded-xl overflow-hidden">
      <button type="button" onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-navy-dark text-sm font-semibold dark:text-white hover:bg-gray-100 dark:hover:bg-navy-mid transition-colors">
        {title}
        <span className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>&#9662;</span>
      </button>
      {open && <div className="p-4">{children}</div>}
    </div>
  );
}

function StarRating({ value, onChange, readonly = false }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(s => (
        <button key={s} type="button" disabled={readonly}
          className={`text-xl transition-colors ${(hover || value) >= s ? 'text-yellow-400' : 'text-gray-300 dark:text-gray-600'} ${readonly ? 'cursor-default' : 'cursor-pointer hover:scale-110'}`}
          onClick={() => !readonly && onChange?.(s)}
          onMouseEnter={() => !readonly && setHover(s)}
          onMouseLeave={() => !readonly && setHover(0)}>
          &#9733;
        </button>
      ))}
    </div>
  );
}

/* ─── CSS-based circular gauge ─── */
function ResponseGauge({ rate, size = 120 }) {
  const r = size * 0.42;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(100, Math.max(0, rate));
  return (
    <div className="flex flex-col items-center">
      <svg className="-rotate-90" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="8"
          className="stroke-gray-200 dark:stroke-navy-light" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="8"
          strokeDasharray={circ} strokeDashoffset={circ - (circ * pct) / 100}
          strokeLinecap="round" className="stroke-ilo-blue transition-all duration-700" />
      </svg>
      <span className="text-lg font-bold dark:text-white -mt-[70px] mb-10">{pct.toFixed(1)}%</span>
      <p className="text-xs text-gray-500 dark:text-gray-400">Response Rate</p>
    </div>
  );
}

/* ─── CSS conic-gradient pie chart ─── */
function PieChart({ segments, size = 160 }) {
  const total = segments.reduce((s, sg) => s + sg.value, 0);
  if (total === 0) return <p className="text-xs text-gray-400 text-center py-4">No data</p>;
  let cum = 0;
  const parts = segments.map(sg => {
    const start = cum;
    cum += (sg.value / total) * 100;
    return `${sg.color} ${start}% ${cum}%`;
  });
  return (
    <div className="flex flex-col items-center gap-3">
      <div style={{ width: size, height: size, borderRadius: '50%', background: `conic-gradient(${parts.join(', ')})` }} />
      <div className="flex flex-wrap gap-2 justify-center">
        {segments.map(sg => (
          <span key={sg.label} className="flex items-center gap-1 text-[11px] dark:text-gray-300">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: sg.color }} />
            {sg.label} ({((sg.value / total) * 100).toFixed(0)}%)
          </span>
        ))}
      </div>
    </div>
  );
}

/* ─── CSS horizontal bar chart ─── */
function BarChart({ data }) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div className="space-y-2">
      {data.map(d => (
        <div key={d.label} className="flex items-center gap-2">
          <span className="w-8 text-xs text-right dark:text-gray-300 shrink-0">{d.label}</span>
          <div className="flex-1 bg-gray-100 dark:bg-navy-dark rounded-full h-5 overflow-hidden">
            <div className="h-full bg-ilo-blue rounded-full transition-all duration-500 flex items-center pl-2"
              style={{ width: `${Math.max(2, (d.value / max) * 100)}%` }}>
              <span className="text-[10px] text-white font-semibold">{d.value}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   ADMIN / INSTITUTION VIEW
   ═══════════════════════════════════════════════════════════════════ */
function AdminView({ t }) {
  const [tab, setTab] = useState('all');
  const [studies, setStudies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedStudy, setSelectedStudy] = useState(null);
  const [analyticsData, setAnalyticsData] = useState(null);

  /* ── Create-form state ── */
  const [form, setForm] = useState({
    title: '', type: '6-month',
    completedAfter: '', completedBefore: '',
    trades: [], nqfLevels: [],
    questions: [],
  });

  const loadStudies = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiFetch('/tracer-studies').then(r => r.json());
      setStudies(data.studies || data || []);
    } catch (e) { toast.error(e.message || 'Failed to load studies'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadStudies(); }, [loadStudies]);

  /* ── Analytics loader ── */
  const openAnalytics = useCallback(async (study) => {
    setSelectedStudy(study);
    setTab('analytics');
    try {
      const data = await apiFetch(`/tracer-studies/${study._id}/analytics`).then(r => r.json());
      setAnalyticsData(data);
    } catch (e) { toast.error(e.message || 'Failed to load analytics'); }
  }, []);

  /* ── Question builder helpers ── */
  const setField = (field, val) => setForm(f => ({ ...f, [field]: val }));
  const addQuestion = () => setField('questions', [...form.questions, { text: '', type: 'text', options: [] }]);

  const updateQuestion = (idx, field, value) => {
    setForm(f => {
      const qs = [...f.questions];
      qs[idx] = { ...qs[idx], [field]: value };
      return { ...f, questions: qs };
    });
  };
  const removeQuestion = (idx) => setForm(f => ({ ...f, questions: f.questions.filter((_, i) => i !== idx) }));

  const addOption = (qi) => {
    setForm(f => {
      const qs = [...f.questions];
      qs[qi] = { ...qs[qi], options: [...qs[qi].options, ''] };
      return { ...f, questions: qs };
    });
  };
  const updateOption = (qi, oi, val) => {
    setForm(f => {
      const qs = [...f.questions];
      const opts = [...qs[qi].options];
      opts[oi] = val;
      qs[qi] = { ...qs[qi], options: opts };
      return { ...f, questions: qs };
    });
  };
  const removeOption = (qi, oi) => {
    setForm(f => {
      const qs = [...f.questions];
      qs[qi] = { ...qs[qi], options: qs[qi].options.filter((_, i) => i !== oi) };
      return { ...f, questions: qs };
    });
  };

  const toggleArray = (field, item) => {
    setForm(f => {
      const arr = f[field];
      return { ...f, [field]: arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item] };
    });
  };

  /* ── Create study ── */
  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return toast.error('Title is required');
    if (form.questions.length === 0) return toast.error('Add at least one question');
    try {
      await apiFetch('/tracer-studies', {
        method: 'POST',
        body: JSON.stringify({
          title: form.title,
          type: form.type,
          targetCriteria: {
            completedAfter: form.completedAfter || undefined,
            completedBefore: form.completedBefore || undefined,
            trades: form.trades,
            nqfLevels: form.nqfLevels,
          },
          questions: form.questions,
        }),
      });
      toast.success('Tracer study created');
      setForm({ title: '', type: '6-month', completedAfter: '', completedBefore: '', trades: [], nqfLevels: [], questions: [] });
      setTab('all');
      loadStudies();
    } catch (e) { toast.error(e.message || 'Failed to create study'); }
  };

  /* ── Status changes ── */
  const changeStatus = async (id, status) => {
    try {
      await apiFetch(`/tracer-studies/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      toast.success(`Study ${status}`);
      loadStudies();
    } catch (e) { toast.error(e.message || 'Failed to update status'); }
  };

  /* ── Export CSV ── */
  const exportCSV = async () => {
    if (!selectedStudy) return;
    try {
      const res = await fetch(`/lms/api/v1/tracer-studies/${selectedStudy._id}/export-csv`, {
        credentials: 'include',
        headers: { 'X-CSRF-Token': csrf() },
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tracer-${selectedStudy.title.replace(/\s+/g, '-')}-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('CSV exported');
    } catch { toast.error('Export failed'); }
  };

  /* ── Derived chart data ── */
  const employmentSegments = useMemo(() => {
    if (!analyticsData?.employment) return [];
    return Object.entries(analyticsData.employment).map(([k, v]) => ({
      label: k.replace(/-/g, ' '), value: v, color: EMP_COLORS[k] || '#6b7280',
    }));
  }, [analyticsData]);

  const satisfactionBars = useMemo(() => {
    if (!analyticsData?.satisfactionBreakdown) return [];
    return [1, 2, 3, 4, 5].map(n => ({ label: `${n}`, value: analyticsData.satisfactionBreakdown[n] || 0 }));
  }, [analyticsData]);

  const TABS = [
    { key: 'all', label: t('All Studies') || 'All Studies' },
    { key: 'create', label: t('Create New') || 'Create New' },
    ...(selectedStudy ? [{ key: 'analytics', label: t('Analytics') || 'Analytics' }] : []),
  ];

  const inputCls = 'w-full px-3 py-2 rounded-lg border border-border dark:border-navy-light bg-white dark:bg-navy-dark dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-ilo-blue';

  return (
    <div className="space-y-5">
      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-100 dark:bg-navy-dark p-1 rounded-xl overflow-x-auto">
        {TABS.map(tb => (
          <button key={tb.key} onClick={() => setTab(tb.key)}
            className={`px-4 py-2 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors ${
              tab === tb.key
                ? 'bg-white dark:bg-navy-mid text-ilo-blue shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}>
            {tb.label}
          </button>
        ))}
      </div>

      {/* ── All Studies ── */}
      {tab === 'all' && (
        <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-400 dark:text-gray-500">Loading studies...</div>
          ) : studies.length === 0 ? (
            <div className="p-8 text-center text-gray-400 dark:text-gray-500">No tracer studies yet. Create one to get started.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-navy-dark text-left">
                    {['Title', 'Type', 'Status', 'Response Rate', 'Actions'].map(h => (
                      <th key={h} className="px-4 py-3 font-semibold dark:text-gray-300">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border dark:divide-navy-light">
                  {studies.map(s => (
                    <tr key={s._id} className="hover:bg-gray-50 dark:hover:bg-navy-dark/50 transition-colors">
                      <td className="px-4 py-3 dark:text-white font-medium">{s.title}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">{s.type}</span>
                      </td>
                      <td className="px-4 py-3">{statusBadge(s.status)}</td>
                      <td className="px-4 py-3 dark:text-gray-300">{s.analytics?.responseRate != null ? `${s.analytics.responseRate.toFixed(1)}%` : '--'}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button onClick={() => openAnalytics(s)}
                            className="px-2.5 py-1 text-[11px] font-semibold bg-ilo-blue text-white rounded-lg hover:bg-ilo-dark transition-colors">
                            View
                          </button>
                          {s.status === 'draft' && (
                            <button onClick={() => changeStatus(s._id, 'active')}
                              className="px-2.5 py-1 text-[11px] font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
                              Activate
                            </button>
                          )}
                          {s.status === 'active' && (
                            <button onClick={() => changeStatus(s._id, 'closed')}
                              className="px-2.5 py-1 text-[11px] font-semibold bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors">
                              Close
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Create New ── */}
      {tab === 'create' && (
        <form onSubmit={handleCreate} className="space-y-4">
          <Collapsible title="Basic Information" defaultOpen>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold dark:text-gray-300 mb-1">Title</label>
                <input value={form.title} onChange={e => setField('title', e.target.value)}
                  className={inputCls} placeholder="e.g. 6-Month Post-Graduation Survey 2026" />
              </div>
              <div>
                <label className="block text-xs font-semibold dark:text-gray-300 mb-1">Type</label>
                <select value={form.type} onChange={e => setField('type', e.target.value)} className={inputCls}>
                  <option value="6-month">6-Month Follow-up</option>
                  <option value="2-year">2-Year Follow-up</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
            </div>
          </Collapsible>

          <Collapsible title="Target Criteria" defaultOpen>
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold dark:text-gray-300 mb-1">Completed After</label>
                  <input type="date" value={form.completedAfter} onChange={e => setField('completedAfter', e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-semibold dark:text-gray-300 mb-1">Completed Before</label>
                  <input type="date" value={form.completedBefore} onChange={e => setField('completedBefore', e.target.value)} className={inputCls} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold dark:text-gray-300 mb-1">Trades</label>
                <div className="flex flex-wrap gap-2">
                  {TRADES.map(tr => (
                    <label key={tr} className="flex items-center gap-1.5 text-xs dark:text-gray-300 cursor-pointer">
                      <input type="checkbox" checked={form.trades.includes(tr)} onChange={() => toggleArray('trades', tr)}
                        className="rounded border-gray-300 text-ilo-blue focus:ring-ilo-blue" />
                      <span className="capitalize">{tr.replace(/-/g, ' ')}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold dark:text-gray-300 mb-1">NQF Levels</label>
                <div className="flex flex-wrap gap-2">
                  {NQF_LEVELS.map(lv => (
                    <label key={lv} className="flex items-center gap-1.5 text-xs dark:text-gray-300 cursor-pointer">
                      <input type="checkbox" checked={form.nqfLevels.includes(lv)} onChange={() => toggleArray('nqfLevels', lv)}
                        className="rounded border-gray-300 text-ilo-blue focus:ring-ilo-blue" />
                      Level {lv}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </Collapsible>

          <Collapsible title={`Questions (${form.questions.length})`} defaultOpen>
            <div className="space-y-3">
              {form.questions.map((q, qi) => (
                <div key={qi} className="bg-gray-50 dark:bg-navy-dark rounded-lg p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <span className="text-xs font-bold dark:text-gray-400 mt-2 shrink-0">Q{qi + 1}</span>
                    <input value={q.text} onChange={e => updateQuestion(qi, 'text', e.target.value)} placeholder="Question text"
                      className="flex-1 px-3 py-1.5 rounded-lg border border-border dark:border-navy-light bg-white dark:bg-navy-mid dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-ilo-blue" />
                    <select value={q.type} onChange={e => updateQuestion(qi, 'type', e.target.value)}
                      className="px-2 py-1.5 rounded-lg border border-border dark:border-navy-light bg-white dark:bg-navy-mid dark:text-white text-xs focus:outline-none focus:ring-2 focus:ring-ilo-blue">
                      {QUESTION_TYPES.map(qt => <option key={qt.value} value={qt.value}>{qt.label}</option>)}
                    </select>
                    <button type="button" onClick={() => removeQuestion(qi)}
                      className="text-red-500 hover:text-red-700 text-sm px-1" title="Remove">&#10005;</button>
                  </div>
                  {(q.type === 'single-choice' || q.type === 'multi-choice') && (
                    <div className="pl-8 space-y-1">
                      {q.options.map((opt, oi) => (
                        <div key={oi} className="flex items-center gap-2">
                          <span className="text-[10px] text-gray-400 w-4">{oi + 1}.</span>
                          <input value={opt} onChange={e => updateOption(qi, oi, e.target.value)} placeholder={`Option ${oi + 1}`}
                            className="flex-1 px-2 py-1 rounded border border-border dark:border-navy-light bg-white dark:bg-navy-mid dark:text-white text-xs focus:outline-none focus:ring-1 focus:ring-ilo-blue" />
                          <button type="button" onClick={() => removeOption(qi, oi)} className="text-red-400 hover:text-red-600 text-xs">&#10005;</button>
                        </div>
                      ))}
                      <button type="button" onClick={() => addOption(qi)} className="text-[11px] text-ilo-blue hover:underline mt-1">+ Add option</button>
                    </div>
                  )}
                </div>
              ))}
              <button type="button" onClick={addQuestion}
                className="w-full py-2 border-2 border-dashed border-gray-300 dark:border-navy-light rounded-lg text-xs font-semibold text-gray-500 dark:text-gray-400 hover:border-ilo-blue hover:text-ilo-blue transition-colors">
                + Add Question
              </button>
            </div>
          </Collapsible>

          <button type="submit"
            className="px-6 py-2.5 bg-ilo-blue text-white text-sm font-semibold rounded-xl hover:bg-ilo-dark transition-colors">
            Create Tracer Study
          </button>
        </form>
      )}

      {/* ── Analytics ── */}
      {tab === 'analytics' && selectedStudy && (
        <div className="space-y-5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h3 className="text-lg font-bold dark:text-white">{selectedStudy.title}</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">Type: {selectedStudy.type} | Status: {selectedStudy.status}</p>
            </div>
            <button onClick={exportCSV}
              className="px-4 py-2 text-xs font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
              Export CSV
            </button>
          </div>

          {!analyticsData ? (
            <div className="p-8 text-center text-gray-400">Loading analytics...</div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <MetricCard label="Total Targeted" value={analyticsData.overview?.totalTargeted ?? '--'} />
                <MetricCard label="Responded" value={analyticsData.overview?.totalResponded ?? '--'} />
                <MetricCard label="Employment Rate" value={analyticsData.overview?.employmentRate != null ? `${analyticsData.overview.employmentRate.toFixed(1)}%` : '--'} />
                <MetricCard label="Avg Satisfaction" value={analyticsData.overview?.avgSatisfaction != null ? analyticsData.overview.avgSatisfaction.toFixed(1) : '--'} sub="out of 5" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-5 flex flex-col items-center justify-center">
                  <h4 className="text-xs font-semibold dark:text-gray-300 mb-3">Response Rate</h4>
                  <ResponseGauge rate={analyticsData.overview?.responseRate ?? 0} />
                </div>
                <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-5">
                  <h4 className="text-xs font-semibold dark:text-gray-300 mb-3">Employment Status</h4>
                  <PieChart segments={employmentSegments} />
                </div>
                <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-5">
                  <h4 className="text-xs font-semibold dark:text-gray-300 mb-3">Satisfaction Ratings</h4>
                  <BarChart data={satisfactionBars} />
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   WORKER VIEW
   ═══════════════════════════════════════════════════════════════════ */
function WorkerView({ t }) {
  const [pending, setPending] = useState([]);
  const [past, setPast] = useState([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(null);

  /* Survey response state */
  const [answers, setAnswers] = useState({});
  const [employment, setEmployment] = useState('');
  const [employer, setEmployer] = useState('');
  const [salaryRange, setSalaryRange] = useState('');
  const [satisfaction, setSatisfaction] = useState(0);
  const [credentialUseful, setCredentialUseful] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadSurveys = useCallback(async () => {
    try {
      setLoading(true);
      const [pRes, pastRes] = await Promise.all([
        apiFetch('/tracer-studies/pending'),
        apiFetch('/tracer-studies/my-responses'),
      ]);
      setPending((await pRes.json()).studies || []);
      setPast((await pastRes.json()).responses || []);
    } catch (e) { toast.error(e.message || 'Failed to load surveys'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadSurveys(); }, [loadSurveys]);

  const startSurvey = (study) => {
    setActive(study);
    setAnswers({});
    setEmployment('');
    setEmployer('');
    setSalaryRange('');
    setSatisfaction(0);
    setCredentialUseful(null);
    setFeedback('');
  };

  const setAnswer = (qId, val) => setAnswers(a => ({ ...a, [qId]: val }));
  const toggleMulti = (qId, opt) => {
    setAnswers(a => {
      const prev = a[qId] || [];
      return { ...a, [qId]: prev.includes(opt) ? prev.filter(x => x !== opt) : [...prev, opt] };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!employment) return toast.error('Please select your employment status');
    if (satisfaction === 0) return toast.error('Please rate your satisfaction');
    if (credentialUseful === null) return toast.error('Please indicate if your credential was useful');
    setSubmitting(true);
    try {
      // Server expects `answers` as an array and the fields `employer` /
      // `satisfactionScore` (not `employerName` / `satisfaction`).
      const answersArray = (active.questions || []).map((q, idx) => {
        const qId = q._id || `q${idx}`;
        return { questionIndex: idx, questionId: q._id, question: q.text, answer: answers[qId] ?? '' };
      });
      await apiFetch(`/tracer-studies/${active._id}/respond`, {
        method: 'POST',
        body: JSON.stringify({ answers: answersArray, employmentStatus: employment, employer, salaryRange, satisfactionScore: satisfaction, credentialUseful, feedback }),
      });
      toast.success('Response submitted successfully');
      setActive(null);
      loadSurveys();
    } catch (e) { toast.error(e.message || 'Submission failed'); }
    finally { setSubmitting(false); }
  };

  const renderQuestion = (q, idx) => {
    const qId = q._id || `q${idx}`;
    const inputBase = 'w-full px-3 py-2 rounded-lg border border-border dark:border-navy-light bg-white dark:bg-navy-mid dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-ilo-blue';
    return (
      <div key={qId} className="bg-gray-50 dark:bg-navy-dark rounded-lg p-3 space-y-2">
        <p className="text-sm font-medium dark:text-white"><span className="text-gray-400 mr-1">{idx + 1}.</span> {q.text}</p>
        {q.type === 'text' && (
          <textarea value={answers[qId] || ''} onChange={e => setAnswer(qId, e.target.value)} rows={2}
            className={`${inputBase} resize-none`} placeholder="Your answer..." />
        )}
        {q.type === 'single-choice' && (
          <div className="space-y-1 pl-2">
            {q.options?.map((opt, oi) => (
              <label key={oi} className="flex items-center gap-2 text-sm dark:text-gray-300 cursor-pointer">
                <input type="radio" name={qId} checked={answers[qId] === opt} onChange={() => setAnswer(qId, opt)} className="text-ilo-blue focus:ring-ilo-blue" />
                {opt}
              </label>
            ))}
          </div>
        )}
        {q.type === 'multi-choice' && (
          <div className="space-y-1 pl-2">
            {q.options?.map((opt, oi) => (
              <label key={oi} className="flex items-center gap-2 text-sm dark:text-gray-300 cursor-pointer">
                <input type="checkbox" checked={(answers[qId] || []).includes(opt)} onChange={() => toggleMulti(qId, opt)}
                  className="rounded border-gray-300 text-ilo-blue focus:ring-ilo-blue" />
                {opt}
              </label>
            ))}
          </div>
        )}
        {q.type === 'rating' && <StarRating value={answers[qId] || 0} onChange={val => setAnswer(qId, val)} />}
        {q.type === 'salary-range' && (
          <select value={answers[qId] || ''} onChange={e => setAnswer(qId, e.target.value)} className={inputBase}>
            <option value="">Select range...</option>
            {SALARY_RANGES.map(sr => <option key={sr} value={sr}>{sr}</option>)}
          </select>
        )}
      </div>
    );
  };

  if (loading) return <div className="p-8 text-center text-gray-400">Loading surveys...</div>;

  /* ── Active survey form ── */
  if (active) {
    const inputCls = 'w-full px-3 py-2 rounded-lg border border-border dark:border-navy-light bg-white dark:bg-navy-dark dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-ilo-blue';
    return (
      <form onSubmit={handleSubmit} className="space-y-5 max-w-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold dark:text-white">{active.title}</h3>
          <button type="button" onClick={() => setActive(null)}
            className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">Back to list</button>
        </div>

        {active.questions?.length > 0 && (
          <Collapsible title="Survey Questions" defaultOpen>
            <div className="space-y-3">{active.questions.map((q, i) => renderQuestion(q, i))}</div>
          </Collapsible>
        )}

        <Collapsible title="Employment Information" defaultOpen>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold dark:text-gray-300 mb-1">Employment Status</label>
              <select value={employment} onChange={e => setEmployment(e.target.value)} className={inputCls}>
                <option value="">Select...</option>
                {EMPLOYMENT_STATUSES.map(s => <option key={s} value={s}>{s.replace(/-/g, ' ')}</option>)}
              </select>
            </div>
            {(employment === 'employed' || employment === 'self-employed') && (
              <>
                <div>
                  <label className="block text-xs font-semibold dark:text-gray-300 mb-1">Employer / Business Name</label>
                  <input value={employer} onChange={e => setEmployer(e.target.value)} className={inputCls} placeholder="Employer or business name" />
                </div>
                <div>
                  <label className="block text-xs font-semibold dark:text-gray-300 mb-1">Salary Range (PKR/month)</label>
                  <select value={salaryRange} onChange={e => setSalaryRange(e.target.value)} className={inputCls}>
                    <option value="">Select range...</option>
                    {SALARY_RANGES.map(sr => <option key={sr} value={sr}>{sr}</option>)}
                  </select>
                </div>
              </>
            )}
          </div>
        </Collapsible>

        <Collapsible title="Feedback" defaultOpen>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold dark:text-gray-300 mb-1">Overall Satisfaction</label>
              <StarRating value={satisfaction} onChange={setSatisfaction} />
            </div>
            <div>
              <label className="block text-xs font-semibold dark:text-gray-300 mb-1">Was your credential useful?</label>
              <div className="flex gap-3">
                <button type="button" onClick={() => setCredentialUseful(true)}
                  className={`px-4 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${credentialUseful === true ? 'bg-green-600 text-white border-green-600' : 'border-border dark:border-navy-light dark:text-gray-300 hover:bg-green-50 dark:hover:bg-green-900/20'}`}>
                  Yes
                </button>
                <button type="button" onClick={() => setCredentialUseful(false)}
                  className={`px-4 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${credentialUseful === false ? 'bg-red-600 text-white border-red-600' : 'border-border dark:border-navy-light dark:text-gray-300 hover:bg-red-50 dark:hover:bg-red-900/20'}`}>
                  No
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold dark:text-gray-300 mb-1">Additional Feedback</label>
              <textarea value={feedback} onChange={e => setFeedback(e.target.value)} rows={3}
                className={`${inputCls} resize-none`} placeholder="Share any additional thoughts..." />
            </div>
          </div>
        </Collapsible>

        <button type="submit" disabled={submitting}
          className="px-6 py-2.5 bg-ilo-blue text-white text-sm font-semibold rounded-xl hover:bg-ilo-dark transition-colors disabled:opacity-50">
          {submitting ? 'Submitting...' : 'Submit Response'}
        </button>
      </form>
    );
  }

  /* ── Survey list ── */
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-bold dark:text-white mb-3">Pending Surveys</h3>
        {pending.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">No pending surveys at this time.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {pending.map(s => (
              <div key={s._id} className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-4">
                <h4 className="font-semibold dark:text-white">{s.title}</h4>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Type: {s.type} | {s.questions?.length || 0} questions</p>
                <button onClick={() => startSurvey(s)}
                  className="mt-3 px-4 py-1.5 text-xs font-semibold bg-ilo-blue text-white rounded-lg hover:bg-ilo-dark transition-colors">
                  Start Survey
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-bold dark:text-white mb-3">Past Responses</h3>
        {past.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">You have not completed any surveys yet.</p>
        ) : (
          <div className="space-y-2">
            {past.map((r, i) => (
              <div key={r._id || i} className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium dark:text-white">{r.studyTitle || r.title || 'Survey'}</p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">
                    Submitted: {r.respondedAt ? new Date(r.respondedAt).toLocaleDateString() : '--'}
                    {r.satisfactionScore ? ` | Satisfaction: ${r.satisfactionScore}/5` : ''}
                  </p>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">Completed</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN PAGE COMPONENT
   ═══════════════════════════════════════════════════════════════════ */
export default function TracerStudies() {
  const { user } = useAuth();
  const { t } = useLang();
  const isAdmin = user?.role === 'admin' || user?.role === 'institution' || user?.role === 'instructor';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold dark:text-white">{t('Tracer Studies') || 'Tracer Studies'}</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {isAdmin ? 'Track graduate outcomes and employment data' : 'Complete graduate follow-up surveys'}
        </p>
      </div>
      {isAdmin ? <AdminView t={t} /> : <WorkerView t={t} />}
    </div>
  );
}
