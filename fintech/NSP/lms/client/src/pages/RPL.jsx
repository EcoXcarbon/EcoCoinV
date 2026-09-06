import { useEffect, useState, useRef } from 'react';
import api from '../api/client';
import { useLang } from '../context/LangContext';
import { useAuth } from '../context/AuthContext';
import HelpTip from '../components/HelpTip';
import toast from 'react-hot-toast';

const STAGES = ['Pre-Screening', 'Evidence Submission', 'Document Review', 'Interview', 'Practical Demo', 'Final Decision'];
const EVIDENCE_CATEGORIES = [
  { value: 'experience-letter', label: 'Experience Letter', icon: '📋' },
  { value: 'trade-certificate', label: 'Trade Certificate', icon: '📜' },
  { value: 'reference-letter', label: 'Reference Letter', icon: '✉️' },
  { value: 'work-sample', label: 'Work Sample / Photo', icon: '🖼️' },
  { value: 'identity-doc', label: 'Identity Document', icon: '🪪' },
  { value: 'other', label: 'Other', icon: '📄' },
];
const SCORE_LABELS = ['N/A', 'Novice', 'Competent', 'Proficient', 'Expert'];
const RUBRIC_LABELS = ['Not Demonstrated', 'Below Standard', 'Meets Standard', 'Above Standard', 'Exceptional'];
const STATUS_COLORS = {
  approved: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  'in-review': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  'awaiting-moderation': 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  appealed: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  'needs-revision': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  pending: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  'awaiting-external-moderation': 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
};

function StageIndicator({ stages }) {
  const stageKeys = ['preScreening', 'evidenceSubmission', 'documentReview', 'interview', 'practicalDemo', 'finalDecision'];
  const currentIdx = stageKeys.findIndex(k => !stages?.[k]);
  const current = currentIdx === -1 ? 5 : currentIdx;
  return (
    <div className="flex items-center gap-1 w-full mb-6">
      {STAGES.map((s, i) => {
        const done = stages?.[stageKeys[i]];
        const active = i === current;
        return (
          <div key={s} className="flex-1 flex flex-col items-center">
            <div className="flex items-center w-full">
              {i > 0 && <div className={`flex-1 h-0.5 ${done ? 'bg-green-500' : 'bg-gray-200 dark:bg-navy-light'}`} />}
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0
                ${done ? 'bg-green-500 text-white' : active ? 'bg-ilo-blue text-white ring-4 ring-ilo-blue/20' : 'bg-gray-200 dark:bg-navy-light text-gray-500'}`}>
                {done ? '✓' : i + 1}
              </div>
              {i < STAGES.length - 1 && <div className={`flex-1 h-0.5 ${done ? 'bg-green-500' : 'bg-gray-200 dark:bg-navy-light'}`} />}
            </div>
            <span className={`text-[10px] mt-1.5 text-center leading-tight ${active ? 'text-ilo-blue font-bold' : done ? 'text-green-600 font-medium' : 'text-gray-400'}`}>{s}</span>
          </div>
        );
      })}
    </div>
  );
}

function SectionHeader({ number, title, done }) {
  return (
    <h3 className="text-sm font-bold dark:text-white mb-3 flex items-center gap-2">
      <span className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold ${done ? 'bg-green-100 text-green-700' : 'bg-ilo-blue/10 text-ilo-blue'}`}>
        {done ? '✓' : number}
      </span>
      {title}
    </h3>
  );
}

/* ─── Gap 7: Pre-Screening Self-Assessment ─── */
function PreScreeningSection({ assessment, stages, isWorker, onUpdate }) {
  const [ratings, setRatings] = useState({});
  const [experience, setExperience] = useState({ totalYears: '', formalTraining: false, currentlyEmployed: false });
  const [submitting, setSubmitting] = useState(false);
  const ps = assessment?.rpl?.preScreening;

  if (stages?.preScreening) {
    const rec = ps?.recommendation;
    const colors = { proceed: 'bg-green-50 border-green-300 dark:bg-green-900/10', partial: 'bg-amber-50 border-amber-300 dark:bg-amber-900/10', 'not-ready': 'bg-red-50 border-red-300 dark:bg-red-900/10' };
    const msgs = { proceed: 'Eligible to proceed.', partial: 'Partially eligible — some gaps identified.', 'not-ready': 'Not yet eligible. Consider training first.' };
    return (
      <div className={`mb-6 p-4 rounded-xl border-2 ${colors[rec] || colors.proceed}`}>
        <SectionHeader number="0" title="Pre-Screening Self-Assessment" done />
        <div className="flex items-center gap-3 mb-2">
          <span className={`text-2xl font-bold ${rec === 'proceed' ? 'text-green-600' : rec === 'partial' ? 'text-amber-600' : 'text-red-600'}`}>{ps?.eligibilityScore}%</span>
          <span className={`px-2 py-0.5 text-xs font-bold rounded-full uppercase ${rec === 'proceed' ? 'bg-green-100 text-green-700' : rec === 'partial' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{rec}</span>
          {ps?.recommendedLevel && <span className="text-xs text-gray-500">NQF Level: {ps.recommendedLevel}</span>}
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">{msgs[rec]}</p>
        {ps?.gapAreas?.length > 0 && <p className="text-xs text-gray-500 mt-2">Gaps: {ps.gapAreas.join(', ')}</p>}
      </div>
    );
  }
  if (!isWorker) return (
    <div className="mb-6 p-4 rounded-xl border border-dashed border-gray-300 dark:border-navy-light">
      <SectionHeader number="0" title="Pre-Screening" done={false} />
      <p className="text-sm text-gray-400">Waiting for worker to complete self-assessment.</p>
    </div>
  );

  const templateQuestions = [
    { area: 'Core Trade Skills', question: 'Rate your overall proficiency in primary trade tasks.' },
    { area: 'Safety & Compliance', question: 'Rate your knowledge of safety procedures.' },
    { area: 'Tools & Equipment', question: 'Rate your proficiency with specialized tools.' },
    { area: 'Blueprint Reading', question: 'Rate your ability to read construction drawings.' },
    { area: 'Quality Standards', question: 'Rate your understanding of quality standards.' },
    { area: 'Problem Solving', question: 'Rate your ability to troubleshoot on-site.' },
  ];

  return (
    <div className="mb-6 p-4 rounded-xl border-2 border-ilo-blue/30 bg-blue-50/30 dark:bg-blue-900/5">
      <SectionHeader number="0" title="Pre-Screening Self-Assessment" done={false} />
      <p className="text-xs text-gray-500 mb-4">Rate your skills honestly to determine RPL eligibility.</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div><label className="text-[10px] font-semibold text-gray-500 uppercase block mb-1">Years Experience</label>
          <input type="number" min={0} value={experience.totalYears} onChange={e => setExperience(x => ({ ...x, totalYears: e.target.value }))}
            className="w-full p-2 text-sm rounded-lg border border-border dark:border-navy-light dark:bg-navy-mid dark:text-white" /></div>
        <div className="flex items-center gap-2 pt-4"><input type="checkbox" checked={experience.formalTraining} onChange={e => setExperience(x => ({ ...x, formalTraining: e.target.checked }))} className="accent-ilo-blue" /><span className="text-xs dark:text-gray-300">Formal training</span></div>
        <div className="flex items-center gap-2 pt-4"><input type="checkbox" checked={experience.currentlyEmployed} onChange={e => setExperience(x => ({ ...x, currentlyEmployed: e.target.checked }))} className="accent-ilo-blue" /><span className="text-xs dark:text-gray-300">Currently employed</span></div>
      </div>
      <div className="space-y-3 mb-4">
        {templateQuestions.map(tq => (
          <div key={tq.area} className="p-3 rounded-lg bg-white dark:bg-navy-mid border border-border dark:border-navy-light">
            <p className="text-xs font-semibold dark:text-white mb-1">{tq.area}</p>
            <p className="text-[10px] text-gray-400 mb-2">{tq.question}</p>
            <div className="flex items-center gap-3">
              <div className="flex gap-1">{[1,2,3,4,5].map(r => (
                <button key={r} onClick={() => setRatings(p => ({ ...p, [tq.area]: { ...p[tq.area], rating: r, question: tq.question } }))}
                  className={`w-8 h-8 rounded text-xs font-bold ${(ratings[tq.area]?.rating||0) >= r ? 'bg-ilo-blue text-white' : 'bg-gray-100 dark:bg-navy-light text-gray-500'}`}>{r}</button>
              ))}</div>
              <span className="text-[10px] text-gray-400">{['','None','Basic','Competent','Proficient','Expert'][ratings[tq.area]?.rating||0]}</span>
              <label className="ml-auto flex items-center gap-1 text-[10px] text-gray-500">
                <input type="checkbox" checked={ratings[tq.area]?.hasEvidence||false} onChange={e => setRatings(p => ({ ...p, [tq.area]: { ...p[tq.area], hasEvidence: e.target.checked } }))} className="accent-green-600" />Evidence
              </label>
            </div>
          </div>
        ))}
      </div>
      <button onClick={async () => {
        const responses = Object.entries(ratings).map(([area, d]) => ({ area, question: d.question, selfRating: d.rating, yearsExperience: 0, hasEvidence: d.hasEvidence||false }));
        if (!responses.length) return toast.error('Rate at least one area');
        setSubmitting(true);
        try {
          const { data } = await api.put(`/assessments/${assessment._id}/pre-screening`, { responses, tradeExperience: { ...experience, totalYears: Number(experience.totalYears)||0 } });
          onUpdate(data); toast.success(`Score: ${data.rpl?.preScreening?.eligibilityScore}%`);
        } catch (err) { toast.error(err.response?.data?.error || 'Failed'); } finally { setSubmitting(false); }
      }} disabled={submitting} className="px-6 py-2.5 text-sm font-semibold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark disabled:opacity-50">
        {submitting ? 'Submitting...' : 'Submit Self-Assessment'}
      </button>
    </div>
  );
}

/* ─── Gap 8: External Moderation Section ─── */
function ExternalModerationSection({ assessment, isAdmin, onUpdate }) {
  const [comments, setComments] = useState('');
  const [qualityScore, setQualityScore] = useState(3);
  const [submitting, setSubmitting] = useState(false);
  const ext = assessment?.rpl?.externalModeration;
  if (!ext?.required) return null;

  if (ext.status === 'completed') {
    const dc = { endorsed: 'text-green-700', overturned: 'text-red-700', 'referred-back': 'text-amber-700' };
    return (
      <div className="mb-6 p-4 rounded-xl bg-indigo-50 dark:bg-indigo-900/10 border border-indigo-200 dark:border-indigo-800">
        <h3 className="text-sm font-bold text-indigo-700 dark:text-indigo-400 mb-2">External Moderation</h3>
        <div className="flex items-center gap-3">
          <span className={`text-sm font-bold capitalize ${dc[ext.decision]}`}>{ext.decision}</span>
          <span className="text-xs text-gray-500">Quality: {ext.qualityScore}/5</span>
          {ext.assessorConsistencyFlag && <span className="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">Flag</span>}
        </div>
        {ext.comments && <p className="text-xs text-gray-500 mt-2">{ext.comments}</p>}
      </div>
    );
  }

  if (ext.status === 'pending' && isAdmin) {
    const submit = async (decision) => {
      setSubmitting(true);
      try {
        const { data } = await api.put(`/assessments/${assessment._id}/external-moderate`, { decision, comments, qualityScore, findings: [] });
        onUpdate(data); toast.success(`External moderation: ${decision}`);
      } catch (err) { toast.error(err.response?.data?.error || 'Failed'); } finally { setSubmitting(false); }
    };
    return (
      <div className="mb-6 p-4 rounded-xl border-2 border-indigo-300 dark:border-indigo-700 bg-indigo-50/50 dark:bg-indigo-900/10">
        <h3 className="text-sm font-bold text-indigo-700 dark:text-indigo-400 mb-3">External Moderation Required</h3>
        <div className="space-y-3">
          <div><label className="text-[10px] font-semibold text-gray-500 uppercase block mb-1">Quality Score</label>
            <div className="flex gap-1">{[1,2,3,4,5].map(s => (
              <button key={s} onClick={() => setQualityScore(s)} className={`w-8 h-8 rounded text-xs font-bold ${qualityScore>=s ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-500'}`}>{s}</button>
            ))}</div></div>
          <textarea value={comments} onChange={e => setComments(e.target.value)} placeholder="Comments..." rows={3}
            className="w-full p-2 text-sm rounded-lg border border-border dark:border-navy-light dark:bg-navy-mid dark:text-white" />
          <div className="flex gap-2">
            <button onClick={() => submit('endorsed')} disabled={submitting} className="px-4 py-1.5 text-xs font-semibold bg-green-600 text-white rounded-lg disabled:opacity-50">Endorse</button>
            <button onClick={() => submit('referred-back')} disabled={submitting} className="px-4 py-1.5 text-xs font-semibold bg-amber-600 text-white rounded-lg disabled:opacity-50">Refer Back</button>
            <button onClick={() => submit('overturned')} disabled={submitting} className="px-4 py-1.5 text-xs font-semibold bg-red-600 text-white rounded-lg disabled:opacity-50">Overturn</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6 p-3 rounded-xl bg-indigo-50 dark:bg-indigo-900/10 border border-indigo-200">
      <p className="text-xs font-semibold text-indigo-700">Pending External Moderation</p>
    </div>
  );
}

export default function RPL() {
  const { t } = useLang();
  const { user } = useAuth();
  const [assessments, setAssessments] = useState([]);
  const [selected, setSelected] = useState(null);
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('experience-letter');
  const [appealReason, setAppealReason] = useState('');
  const [moderationComments, setModerationComments] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef();
  const isAssessor = ['admin', 'assessor', 'institution'].includes(user?.role);
  const isAdmin = ['admin', 'institution'].includes(user?.role);
  const isWorker = user?.role === 'worker';
  const [preScreening, setPreScreening] = useState({ totalYears: 0, formalTraining: false, currentlyEmployed: false });
  const [preScreeningQuestions, setPreScreeningQuestions] = useState([]);
  const [preScreeningResponses, setPreScreeningResponses] = useState([]);
  const [preScreeningResult, setPreScreeningResult] = useState(null);
  // Worker self-application state
  const [showApplyForm, setShowApplyForm] = useState(false);
  const [applyForm, setApplyForm] = useState({
    trade: '', nqfLevel: 1, yearsExperience: 0, motivation: '', employerCountries: [], previousCertifications: '',
  });
  const [applySubmitting, setApplySubmitting] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get('/assessments', { params: { type: 'rpl', limit: 50 } }).then(r => setAssessments(r.data.assessments)),
      isAssessor ? api.get('/workers', { params: { limit: 100 } }).then(r => setWorkers(r.data.workers)) : Promise.resolve(),
    ])
      .catch(() => toast.error('Failed to load RPL data'))
      .finally(() => setLoading(false));
  }, []);

  const refresh = async () => {
    try {
      const { data } = await api.get('/assessments', { params: { type: 'rpl', limit: 50 } });
      setAssessments(data.assessments);
      if (selected) {
        const updated = data.assessments.find(a => a._id === selected._id);
        if (updated) setSelected(updated);
      }
    } catch { /* silent */ }
  };

  const updatePreScreeningResponse = (idx, field, value) => {
    setPreScreeningResponses(prev => {
      const updated = [...prev];
      if (!updated[idx]) updated[idx] = {};
      updated[idx] = { ...updated[idx], [field]: value };
      return updated;
    });
  };

  const submitPreScreening = async () => {
    try {
      const res = await fetch(`/lms/api/v1/assessments/${selected._id}/pre-screening`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': document.cookie.match(/csrf=([^;]+)/)?.[1] || '' },
        credentials: 'include',
        body: JSON.stringify({
          responses: preScreeningResponses,
          tradeExperience: preScreening,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setPreScreeningResult(data.preScreening);
        toast.success('Self-assessment submitted!');
        // Refresh assessment
        refresh();
      } else {
        toast.error(data.error || 'Failed to submit');
      }
    } catch { toast.error('Network error'); }
  };

  // Worker self-service RPL application
  const submitApplication = async () => {
    if (!applyForm.trade) return toast.error('Please select a trade');
    setApplySubmitting(true);
    try {
      const { data } = await api.post('/assessments/apply', {
        trade: applyForm.trade,
        nqfLevel: applyForm.nqfLevel,
        yearsExperience: applyForm.yearsExperience,
        motivation: applyForm.motivation,
        employerCountries: applyForm.employerCountries.filter(Boolean),
        previousCertifications: applyForm.previousCertifications,
      });
      setAssessments(prev => [data, ...prev]);
      setShowApplyForm(false);
      setApplyForm({ trade: '', nqfLevel: 1, yearsExperience: 0, motivation: '', employerCountries: [], previousCertifications: '' });
      toast.success('RPL application submitted! You can now proceed with pre-screening.');
      setSelected(data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to submit application');
    } finally { setApplySubmitting(false); }
  };

  const createAssessment = async (workerId) => {
    const worker = workers.find(w => w._id === workerId);
    if (!worker) return;
    try {
      const { data } = await api.post('/assessments', {
        worker: workerId, type: 'rpl', trade: worker.trade,
        title: `RPL Assessment — ${worker.fullName}`,
      });
      setAssessments(prev => [data, ...prev]);
      toast.success('RPL assessment created');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create assessment');
    }
  };

  // Issue #1: Upload evidence with category
  const uploadEvidence = async () => {
    if (!fileRef.current?.files?.length || !selected) return;
    setSubmitting(true);
    const formData = new FormData();
    Array.from(fileRef.current.files).forEach(f => formData.append('documents', f));
    const cats = Array.from(fileRef.current.files).map(() => category);
    formData.append('categories', JSON.stringify(cats));
    try {
      const { data } = await api.post(`/assessments/${selected._id}/evidence`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setSelected(data);
      setAssessments(prev => prev.map(a => a._id === data._id ? data : a));
      toast.success(`${fileRef.current.files.length} document(s) uploaded as ${EVIDENCE_CATEGORIES.find(c => c.value === category)?.label}`);
      fileRef.current.value = '';
    } catch (err) {
      toast.error(err.response?.data?.error || 'Upload failed');
    } finally {
      setSubmitting(false);
    }
  };

  // Issue #4: Complete document review
  const completeDocReview = async () => {
    if (!selected) return;
    try {
      const { data } = await api.put(`/assessments/${selected._id}/document-review`, {
        feedback: 'Documents reviewed and verified.',
      });
      setSelected(data);
      setAssessments(prev => prev.map(a => a._id === data._id ? data : a));
      toast.success('Document review completed');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to complete review');
    }
  };

  // Issue #2: Submit structured interview
  const submitInterview = async (items, overallNotes, durationMinutes) => {
    if (!selected) return;
    try {
      const { data } = await api.put(`/assessments/${selected._id}/interview`, {
        items, overallNotes, durationMinutes,
      });
      setSelected(data);
      setAssessments(prev => prev.map(a => a._id === data._id ? data : a));
      toast.success('Interview recorded');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save interview');
    }
  };

  // Issue #3: Submit practical demo rubric
  const submitPracticalDemo = async (rubric, overallResult, location) => {
    if (!selected) return;
    try {
      const { data } = await api.put(`/assessments/${selected._id}/practical-demo`, {
        rubric, overallResult, location,
      });
      setSelected(data);
      setAssessments(prev => prev.map(a => a._id === data._id ? data : a));
      toast.success('Practical demonstration recorded');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save demonstration');
    }
  };

  // Issue #7: Submit final decision (goes to moderation)
  const submitDecision = async (decision) => {
    if (!selected) return;
    setSubmitting(true);
    try {
      // Calculate score from interview + practical demo
      const interviewItems = selected.rpl?.interview?.items || [];
      const interviewAvg = interviewItems.length > 0
        ? interviewItems.reduce((sum, i) => sum + (i.score || 0), 0) / (interviewItems.length * 4) * 50
        : 0;
      const demoScore = (selected.rpl?.practicalDemo?.totalScore || 0) / 2;
      const totalScore = Math.round(interviewAvg + demoScore);

      const { data } = await api.put(`/assessments/${selected._id}/review`, {
        status: decision,
        score: decision === 'needs-revision' ? undefined : totalScore,
        feedback: `Assessor decision: ${decision}. Interview avg: ${Math.round(interviewAvg * 2)}%. Demo: ${selected.rpl?.practicalDemo?.totalScore || 0}%.`,
      });
      setSelected(data);
      setAssessments(prev => prev.map(a => a._id === data._id ? data : a));
      if (data.status === 'awaiting-moderation') {
        toast.success('Decision submitted — awaiting moderation by a second reviewer');
      } else {
        toast.success(`Assessment: ${decision}`);
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to submit decision');
    } finally {
      setSubmitting(false);
    }
  };

  // Issue #7: Moderate
  const submitModeration = async (decision) => {
    if (!selected) return;
    setSubmitting(true);
    try {
      const { data } = await api.put(`/assessments/${selected._id}/moderate`, {
        decision, comments: moderationComments,
      });
      setSelected(data);
      setAssessments(prev => prev.map(a => a._id === data._id ? data : a));
      toast.success(`Moderation: ${decision}`);
      setModerationComments('');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to moderate');
    } finally {
      setSubmitting(false);
    }
  };

  // Issue #9: Submit appeal
  const submitAppeal = async () => {
    if (!selected || !appealReason.trim()) return;
    setSubmitting(true);
    try {
      const { data } = await api.post(`/assessments/${selected._id}/appeal`, { reason: appealReason });
      setSelected(data);
      setAssessments(prev => prev.map(a => a._id === data._id ? data : a));
      toast.success('Appeal submitted successfully');
      setAppealReason('');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to submit appeal');
    } finally {
      setSubmitting(false);
    }
  };

  // Issue #9: Review appeal
  const reviewAppeal = async (decision) => {
    if (!selected) return;
    setSubmitting(true);
    try {
      const { data } = await api.put(`/assessments/${selected._id}/appeal-review`, {
        decision, reviewComments: moderationComments || `Appeal ${decision}.`,
      });
      setSelected(data);
      setAssessments(prev => prev.map(a => a._id === data._id ? data : a));
      toast.success(`Appeal ${decision}`);
      setModerationComments('');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to review appeal');
    } finally {
      setSubmitting(false);
    }
  };

  // Issue #15: Enroll in gap training
  const enrollGapTraining = async (index) => {
    if (!selected) return;
    try {
      const { data } = await api.post(`/assessments/${selected._id}/gap-training/${index}/enroll`);
      toast.success('Worker enrolled in gap training');
      await refresh();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to enroll');
    }
  };

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-ilo-blue border-t-transparent rounded-full" /></div>;

  // ===== DETAIL VIEW =====
  if (selected) {
    const stages = selected.rpl?.stageCompleted || {};
    const suf = selected.rpl?.evidenceSufficiency || {};
    return (
      <div className="space-y-4">
        <button onClick={() => setSelected(null)} className="flex items-center gap-2 text-sm text-ilo-blue hover:underline">
          <span>&larr;</span> {t('Back to RPL List')}
        </button>

        <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-6">
          <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
            <div>
              <h2 className="text-lg font-bold dark:text-white">{selected.title}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {selected.worker?.fullName} &mdash; <span className="capitalize">{selected.trade}</span> &mdash; {selected.worker?.registrationId}
              </p>
            </div>
            <span className={`px-3 py-1 text-xs font-semibold rounded-full capitalize ${STATUS_COLORS[selected.status] || STATUS_COLORS.pending}`}>
              {selected.status}
            </span>
          </div>

          <StageIndicator stages={stages} />

          {/* ===== STAGE 0: Pre-Screening Self-Assessment ===== */}
          {stages.preScreening === false && (
            <div className="mb-6 p-4 rounded-xl border border-border dark:border-navy-light bg-gray-50/50 dark:bg-navy/50 space-y-6">
              <SectionHeader number="0" title="Pre-Screening Self-Assessment" done={false} />
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Complete this self-assessment to determine your eligibility for RPL certification.
              </p>

              {/* Trade Experience */}
              <div className="bg-white dark:bg-navy-mid rounded-xl p-6 border border-border dark:border-navy-light">
                <h4 className="font-semibold mb-4 dark:text-white">Trade Experience</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1 dark:text-gray-300">Total Years of Experience</label>
                    <input type="number" min="0" max="50" value={preScreening.totalYears || ''}
                      onChange={e => setPreScreening(p => ({...p, totalYears: +e.target.value}))}
                      className="w-full px-3 py-2 border rounded-lg dark:bg-navy dark:border-navy-light dark:text-white" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1 dark:text-gray-300">Formal Training?</label>
                    <select value={preScreening.formalTraining ? 'yes' : 'no'}
                      onChange={e => setPreScreening(p => ({...p, formalTraining: e.target.value === 'yes'}))}
                      className="w-full px-3 py-2 border rounded-lg dark:bg-navy dark:border-navy-light dark:text-white">
                      <option value="no">No</option>
                      <option value="yes">Yes</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1 dark:text-gray-300">Currently Employed?</label>
                    <select value={preScreening.currentlyEmployed ? 'yes' : 'no'}
                      onChange={e => setPreScreening(p => ({...p, currentlyEmployed: e.target.value === 'yes'}))}
                      className="w-full px-3 py-2 border rounded-lg dark:bg-navy dark:border-navy-light dark:text-white">
                      <option value="no">No</option>
                      <option value="yes">Yes</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Competency Self-Rating */}
              <div className="bg-white dark:bg-navy-mid rounded-xl p-6 border border-border dark:border-navy-light">
                <h4 className="font-semibold mb-4 dark:text-white">Competency Self-Rating</h4>
                <div className="space-y-4">
                  {(preScreeningQuestions || []).map((q, idx) => (
                    <div key={idx} className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 bg-gray-50 dark:bg-navy rounded-lg">
                      <div className="flex-1">
                        <p className="text-sm font-medium dark:text-white">{q.area}: {q.question}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex gap-1">
                          {[1,2,3,4,5].map(r => (
                            <button key={r} onClick={() => updatePreScreeningResponse(idx, 'selfRating', r)}
                              className={`w-8 h-8 rounded-full text-xs font-bold transition-colors ${
                                (preScreeningResponses[idx]?.selfRating || 0) >= r
                                  ? 'bg-ilo-blue text-white' : 'bg-gray-200 dark:bg-navy-light text-gray-600 dark:text-gray-400'
                              }`}>
                              {r}
                            </button>
                          ))}
                        </div>
                        <label className="flex items-center gap-1.5 text-xs">
                          <input type="checkbox" checked={preScreeningResponses[idx]?.hasEvidence || false}
                            onChange={e => updatePreScreeningResponse(idx, 'hasEvidence', e.target.checked)}
                            className="rounded" />
                          <span className="dark:text-gray-300">Has Evidence</span>
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Submit */}
              <button onClick={submitPreScreening}
                className="px-6 py-3 bg-ilo-blue text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors">
                Submit Self-Assessment
              </button>

              {/* Result display */}
              {preScreeningResult && (
                <div className={`p-4 rounded-xl border ${
                  preScreeningResult.recommendation === 'proceed' ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' :
                  preScreeningResult.recommendation === 'partial' ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800' :
                  'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                }`}>
                  <h4 className="font-bold mb-2 dark:text-white">
                    {preScreeningResult.recommendation === 'proceed' ? 'Eligible! Proceed to evidence submission.' :
                     preScreeningResult.recommendation === 'partial' ? 'Partially eligible. Some gaps identified.' :
                     'Not yet eligible. Training recommended.'}
                  </h4>
                  <p className="text-sm dark:text-gray-300">Eligibility Score: {preScreeningResult.eligibilityScore}%</p>
                  {preScreeningResult.gapAreas?.length > 0 && (
                    <p className="text-sm mt-2 dark:text-gray-300">Gap Areas: {preScreeningResult.gapAreas.join(', ')}</p>
                  )}
                </div>
              )}
            </div>
          )}
          {stages.preScreening && (
            <div className="mb-6 p-4 rounded-xl border border-border dark:border-navy-light bg-gray-50/50 dark:bg-navy/50">
              <SectionHeader number="0" title="Pre-Screening Self-Assessment" done={true} />
              <p className="text-xs text-green-600">Pre-screening completed. Proceed to evidence submission.</p>
            </div>
          )}

          {/* ===== STAGE 1: Evidence Portfolio (Issue #1) ===== */}
          <div className="mb-6 p-4 rounded-xl border border-border dark:border-navy-light bg-gray-50/50 dark:bg-navy/50">
            <SectionHeader number="1" title="Documentary Evidence Portfolio" done={stages.evidenceSubmission} />

            {/* Evidence sufficiency checklist */}
            <div className="flex flex-wrap gap-2 mb-3">
              {[
                { key: 'hasExperienceLetter', label: 'Experience Letter' },
                { key: 'hasTradeCertificate', label: 'Trade Certificate' },
                { key: 'hasReferenceLetter', label: 'Reference Letter' },
                { key: 'hasWorkSample', label: 'Work Sample' },
              ].map(r => (
                <span key={r.key} className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded-full
                  ${suf[r.key] ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-400 dark:bg-navy-light dark:text-gray-500'}`}>
                  {suf[r.key] ? '✓' : '○'} {r.label}
                </span>
              ))}
            </div>

            {/* Evidence grid with categories */}
            {selected.rpl?.documentaryEvidence?.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-3">
                {selected.rpl.documentaryEvidence.map((doc, i) => {
                  const cat = EVIDENCE_CATEGORIES.find(c => c.value === doc.category) || EVIDENCE_CATEGORIES[5];
                  return (
                    <div key={i} className="flex items-center gap-2 p-3 rounded-lg border border-border dark:border-navy-light bg-white dark:bg-navy-light">
                      <span className="text-xl">{cat.icon}</span>
                      <div className="flex-1 min-w-0">
                        {doc.url ? (
                          <a href={doc.url} target="_blank" rel="noopener noreferrer" className="text-[11px] font-medium dark:text-white truncate block hover:text-ilo-blue hover:underline">{doc.filename}</a>
                        ) : (
                          <p className="text-[11px] font-medium dark:text-white truncate">{doc.filename}</p>
                        )}
                        <p className="text-[10px] text-gray-400">{cat.label} &middot; {doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleDateString() : ''}</p>
                        {doc.verifiedByThirdParty && <p className="text-[10px] text-green-600">Verified by {doc.thirdPartyName}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-gray-400 mb-3">No evidence uploaded yet. Minimum: 2 documents including an experience letter or trade certificate.</p>
            )}

            {/* Upload with category selector */}
            {!stages.finalDecision && (
              <div className="flex flex-wrap items-center gap-2">
                <select value={category} onChange={e => setCategory(e.target.value)}
                  className="px-2 py-1.5 text-xs border border-border dark:border-navy-light rounded-lg bg-white dark:bg-navy dark:text-white">
                  {EVIDENCE_CATEGORIES.map(c => (
                    <option key={c.value} value={c.value}>{c.icon} {c.label}</option>
                  ))}
                </select>
                <input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp" className="text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-ilo-blue/10 file:text-ilo-blue hover:file:bg-ilo-blue/20 dark:text-gray-300" />
                <button onClick={uploadEvidence} disabled={submitting} className="px-4 py-1.5 text-xs font-semibold bg-ilo-blue text-white rounded-lg hover:bg-ilo-dark disabled:opacity-50">{submitting ? 'Uploading...' : 'Upload'}</button>
              </div>
            )}
          </div>

          {/* ===== STAGE 2: Document Review (Issue #4) ===== */}
          {isAssessor && (
            <div className="mb-6 p-4 rounded-xl border border-border dark:border-navy-light bg-gray-50/50 dark:bg-navy/50">
              <SectionHeader number="2" title="Document Review" done={stages.documentReview} />
              {stages.documentReview ? (
                <p className="text-xs text-green-600">Documents reviewed and verified.</p>
              ) : stages.evidenceSubmission ? (
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Review the uploaded evidence for authenticity, relevance, and sufficiency before proceeding.</p>
                  <button onClick={completeDocReview} className="px-4 py-1.5 text-xs font-semibold bg-ilo-blue text-white rounded-lg hover:bg-ilo-dark">
                    Mark Documents as Reviewed
                  </button>
                </div>
              ) : (
                <p className="text-xs text-gray-400">Waiting for evidence submission (minimum 2 documents required).</p>
              )}
            </div>
          )}

          {/* ===== STAGE 3: Structured Interview (Issue #2) ===== */}
          {isAssessor && (
            <div className="mb-6 p-4 rounded-xl border border-border dark:border-navy-light bg-gray-50/50 dark:bg-navy/50">
              <SectionHeader number="3" title="Competency Interview" done={stages.interview} />
              {!stages.documentReview && !stages.interview ? (
                <p className="text-xs text-gray-400">Complete document review first.</p>
              ) : (
                <InterviewForm
                  items={selected.rpl?.interview?.items || []}
                  overallNotes={selected.rpl?.interview?.overallNotes || ''}
                  durationMinutes={selected.rpl?.interview?.durationMinutes || 0}
                  done={stages.interview}
                  onSubmit={submitInterview}
                />
              )}
            </div>
          )}

          {/* ===== STAGE 4: Practical Demo Rubric (Issue #3) ===== */}
          {isAssessor && (
            <div className="mb-6 p-4 rounded-xl border border-border dark:border-navy-light bg-gray-50/50 dark:bg-navy/50">
              <SectionHeader number="4" title="Practical Demonstration" done={stages.practicalDemo} />
              {!stages.interview && !stages.practicalDemo ? (
                <p className="text-xs text-gray-400">Complete interview first.</p>
              ) : (
                <PracticalDemoForm
                  rubric={selected.rpl?.practicalDemo?.rubric || []}
                  overallResult={selected.rpl?.practicalDemo?.overallResult || 'pending'}
                  totalScore={selected.rpl?.practicalDemo?.totalScore}
                  location={selected.rpl?.practicalDemo?.location || ''}
                  done={stages.practicalDemo}
                  onSubmit={submitPracticalDemo}
                />
              )}
            </div>
          )}

          {/* ===== STAGE 5: Final Decision (Issue #4 gating + Issue #7 moderation) ===== */}
          {isAssessor && !['approved', 'rejected', 'awaiting-moderation', 'appealed'].includes(selected.status) && (
            <div className="mb-6 p-4 rounded-xl border border-border dark:border-navy-light bg-gray-50/50 dark:bg-navy/50">
              <SectionHeader number="5" title="Final Decision" done={stages.finalDecision} />
              {!stages.practicalDemo ? (
                <p className="text-xs text-gray-400">Complete all prior stages before making a final decision.</p>
              ) : (
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Your decision will be sent to a moderator (second reviewer) for quality assurance before being finalized.</p>
                  <div className="flex flex-wrap gap-3">
                    <button onClick={() => submitDecision('approved')} disabled={submitting}
                      className="px-5 py-2 text-sm font-semibold bg-green-600 text-white rounded-xl hover:bg-green-700 disabled:opacity-50">
                      {submitting ? 'Submitting...' : 'Recommend Approval'}
                    </button>
                    <button onClick={() => submitDecision('needs-revision')} disabled={submitting}
                      className="px-5 py-2 text-sm font-semibold bg-amber-500 text-white rounded-xl hover:bg-amber-600 disabled:opacity-50">
                      Needs Revision
                    </button>
                    <button onClick={() => submitDecision('rejected')} disabled={submitting}
                      className="px-5 py-2 text-sm font-semibold bg-red-600 text-white rounded-xl hover:bg-red-700 disabled:opacity-50">
                      Recommend Rejection
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ===== Issue #7: Moderation Panel ===== */}
          {selected.status === 'awaiting-moderation' && isAdmin && (
            <div className="mb-6 p-4 rounded-xl border-2 border-purple-300 dark:border-purple-700 bg-purple-50/50 dark:bg-purple-900/10">
              <h3 className="text-sm font-bold text-purple-700 dark:text-purple-400 mb-3 flex items-center gap-2">
                <span className="w-6 h-6 rounded bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-xs font-bold">QA</span>
                Moderation — Second Reviewer
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                Assessor recommendation: <strong className="capitalize">{selected.feedback}</strong>
                {selected.score != null && <> &middot; Score: <strong>{selected.score}%</strong></>}
              </p>
              <textarea value={moderationComments} onChange={e => setModerationComments(e.target.value)}
                placeholder="Moderation comments — explain your decision..."
                rows={3}
                className="w-full px-3 py-2 text-sm border border-purple-200 dark:border-purple-800 rounded-xl bg-white dark:bg-navy dark:text-white focus:ring-2 focus:ring-purple-400/30 outline-none resize-none mb-3" />
              <div className="flex flex-wrap gap-2">
                <button onClick={() => submitModeration('endorsed')} disabled={submitting} className="px-4 py-1.5 text-xs font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
                  {submitting ? 'Submitting...' : 'Endorse Decision'}
                </button>
                <button onClick={() => submitModeration('overturned')} disabled={submitting} className="px-4 py-1.5 text-xs font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
                  Overturn Decision
                </button>
                <button onClick={() => submitModeration('referred-back')} disabled={submitting} className="px-4 py-1.5 text-xs font-semibold bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50">
                  Refer Back to Assessor
                </button>
              </div>
            </div>
          )}

          {/* ===== Issue #9: Appeals Panel (Worker) ===== */}
          {['rejected', 'needs-revision'].includes(selected.status) && isWorker && !selected.rpl?.appeal?.decision && (
            <div className="mb-6 p-4 rounded-xl border-2 border-orange-300 dark:border-orange-700 bg-orange-50/50 dark:bg-orange-900/10">
              <h3 className="text-sm font-bold text-orange-700 dark:text-orange-400 mb-2">Appeal This Decision</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">You have 14 days from the decision date to file an appeal. Your appeal will be reviewed by a different assessor.</p>
              <textarea value={appealReason} onChange={e => setAppealReason(e.target.value)}
                placeholder="Explain why you believe the decision should be reconsidered..."
                rows={3}
                className="w-full px-3 py-2 text-sm border border-orange-200 dark:border-orange-800 rounded-xl bg-white dark:bg-navy dark:text-white focus:ring-2 focus:ring-orange-400/30 outline-none resize-none mb-2" />
              <button onClick={submitAppeal} disabled={!appealReason.trim() || submitting}
                className="px-4 py-1.5 text-xs font-semibold bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50">
                {submitting ? 'Submitting...' : 'Submit Appeal'}
              </button>
            </div>
          )}

          {/* ===== Issue #9: Appeal Review Panel (Admin) ===== */}
          {selected.status === 'appealed' && isAdmin && (
            <div className="mb-6 p-4 rounded-xl border-2 border-orange-300 dark:border-orange-700 bg-orange-50/50 dark:bg-orange-900/10">
              <h3 className="text-sm font-bold text-orange-700 dark:text-orange-400 mb-2">Review Appeal</h3>
              <div className="p-3 rounded-lg bg-orange-100/50 dark:bg-orange-900/20 mb-3">
                <p className="text-xs font-semibold text-orange-800 dark:text-orange-300">Worker's Appeal Reason:</p>
                <p className="text-xs text-gray-700 dark:text-gray-300 mt-1">{selected.rpl?.appeal?.reason}</p>
                <p className="text-[10px] text-gray-400 mt-1">Filed: {selected.rpl?.appeal?.appealedAt ? new Date(selected.rpl.appeal.appealedAt).toLocaleDateString() : 'N/A'}</p>
              </div>
              <textarea value={moderationComments} onChange={e => setModerationComments(e.target.value)}
                placeholder="Appeal review comments..."
                rows={3}
                className="w-full px-3 py-2 text-sm border border-orange-200 dark:border-orange-800 rounded-xl bg-white dark:bg-navy dark:text-white focus:ring-2 focus:ring-orange-400/30 outline-none resize-none mb-3" />
              <div className="flex flex-wrap gap-2">
                <button onClick={() => reviewAppeal('overturned')} disabled={submitting} className="px-4 py-1.5 text-xs font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
                  {submitting ? 'Submitting...' : 'Overturn — Approve Worker'}
                </button>
                <button onClick={() => reviewAppeal('partial')} disabled={submitting} className="px-4 py-1.5 text-xs font-semibold bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50">
                  Partial — Send for Re-Assessment
                </button>
                <button onClick={() => reviewAppeal('upheld')} disabled={submitting} className="px-4 py-1.5 text-xs font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
                  Uphold Original Rejection
                </button>
              </div>
            </div>
          )}

          {/* ===== Internal Moderation Status Display ===== */}
          {selected.rpl?.moderation?.decision && (
            <div className="mb-6 p-3 rounded-xl bg-purple-50 dark:bg-purple-900/10 border border-purple-200 dark:border-purple-800">
              <p className="text-xs font-semibold text-purple-700 dark:text-purple-400">
                Internal Moderation: <span className="capitalize">{selected.rpl.moderation.decision}</span>
                {selected.rpl.moderation.moderatedAt && <> &middot; {new Date(selected.rpl.moderation.moderatedAt).toLocaleDateString()}</>}
              </p>
              {selected.rpl.moderation.comments && <p className="text-xs text-gray-500 mt-1">{selected.rpl.moderation.comments}</p>}
            </div>
          )}

          {/* ===== External Moderation Panel ===== */}
          {selected.rpl?.externalModeration?.required && (
            <div className="bg-white dark:bg-navy-mid rounded-xl p-6 border border-border dark:border-navy-light mt-4 mb-6">
              <h4 className="font-semibold mb-3 dark:text-white flex items-center gap-2">
                External Moderation
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  selected.rpl.externalModeration.status === 'completed' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                  'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
                }`}>
                  {selected.rpl.externalModeration.status}
                </span>
              </h4>
              {selected.rpl.externalModeration.status === 'completed' ? (
                <div className="space-y-2">
                  <p className="text-sm dark:text-gray-300">Decision: <strong>{selected.rpl.externalModeration.decision}</strong></p>
                  <p className="text-sm dark:text-gray-300">Quality Score: {selected.rpl.externalModeration.qualityScore}/5</p>
                  {selected.rpl.externalModeration.comments && (
                    <p className="text-sm dark:text-gray-300">Comments: {selected.rpl.externalModeration.comments}</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-amber-600 dark:text-amber-400">Awaiting external moderator review...</p>
              )}
            </div>
          )}

          {/* ===== Appeal Status Display ===== */}
          {selected.rpl?.appeal?.decision && selected.rpl.appeal.decision !== 'pending' && (
            <div className="mb-6 p-3 rounded-xl bg-orange-50 dark:bg-orange-900/10 border border-orange-200 dark:border-orange-800">
              <p className="text-xs font-semibold text-orange-700 dark:text-orange-400">
                Appeal: <span className="capitalize">{selected.rpl.appeal.decision}</span>
                {selected.rpl.appeal.reviewedAt && <> &middot; {new Date(selected.rpl.appeal.reviewedAt).toLocaleDateString()}</>}
              </p>
              {selected.rpl.appeal.reviewComments && <p className="text-xs text-gray-500 mt-1">{selected.rpl.appeal.reviewComments}</p>}
            </div>
          )}

          {/* ===== Issue #6 & #15: Gap Training Recommendations ===== */}
          {selected.rpl?.gapTraining?.length > 0 && (
            <div className="mb-6 p-4 rounded-xl border-2 border-sky-300 dark:border-sky-700 bg-sky-50/50 dark:bg-sky-900/10">
              <h3 className="text-sm font-bold text-sky-700 dark:text-sky-400 mb-3 flex items-center gap-2">
                <span className="w-6 h-6 rounded bg-sky-100 dark:bg-sky-900/30 flex items-center justify-center text-xs font-bold">LMS</span>
                Gap Training Recommendations
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Skill gaps identified during assessment. Complete recommended training to improve competency and re-apply for RPL.</p>
              <div className="space-y-2">
                {selected.rpl.gapTraining.map((gap, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-white dark:bg-navy-light border border-sky-200 dark:border-sky-800">
                    <div>
                      <p className="text-xs font-semibold dark:text-white">{gap.competencyArea}</p>
                      <p className="text-[10px] text-gray-400">
                        Current: <span className="capitalize text-red-500">{gap.currentLevel?.replace('-', ' ')}</span> &rarr; Required: <span className="capitalize text-green-600">{gap.requiredLevel}</span>
                      </p>
                      {gap.recommendedTrainingTitle && (
                        <p className="text-[10px] text-sky-600 mt-0.5">Recommended: {gap.recommendedTrainingTitle}</p>
                      )}
                    </div>
                    {gap.enrolled ? (
                      <span className="px-2 py-1 text-[10px] font-semibold bg-green-100 text-green-700 rounded-full">Enrolled</span>
                    ) : gap.recommendedTraining && isAssessor ? (
                      <button onClick={() => enrollGapTraining(i)}
                        className="px-3 py-1 text-[10px] font-semibold bg-sky-600 text-white rounded-lg hover:bg-sky-700">
                        Enroll Worker
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ===== Score & Feedback ===== */}
          {selected.score != null && (
            <div className="mt-4 p-4 rounded-xl bg-gray-50 dark:bg-navy-light">
              <div className="flex items-center gap-4">
                <div className={`w-14 h-14 rounded-xl flex items-center justify-center text-lg font-bold text-white
                  ${selected.score >= 70 ? 'bg-green-500' : selected.score >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}>
                  {selected.score}%
                </div>
                <div>
                  <p className="text-sm font-semibold dark:text-white capitalize">{selected.status}</p>
                  {selected.feedback && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{selected.feedback}</p>}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ===== LIST VIEW =====
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold dark:text-white">{t('RPL')} &mdash; Recognition of Prior Learning</h2>
            <HelpTip tipId="rpl-intro" text="RPL lets you get certified based on skills you already have. Submit evidence of your work experience and an assessor will review it through a 5-stage process." position="bottom" />
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Assess and certify workers based on existing skills and experience</p>
        </div>
        <div className="flex items-center gap-2">
          {isWorker && (
            <button onClick={() => setShowApplyForm(!showApplyForm)}
              className="px-4 py-2 text-sm font-semibold bg-green-600 text-white rounded-xl hover:bg-green-700 transition-colors flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              {showApplyForm ? 'Cancel' : 'Apply for RPL'}
            </button>
          )}
          {isAssessor && (
            <select onChange={e => e.target.value && createAssessment(e.target.value)}
              className="px-3 py-1.5 text-xs border border-border dark:border-navy-light rounded-lg bg-white dark:bg-navy-mid dark:text-white">
              <option value="">+ New RPL Assessment</option>
              {workers.map(w => <option key={w._id} value={w._id}>{w.fullName} &mdash; {w.trade}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Worker Self-Application Form */}
      {showApplyForm && isWorker && (
        <div className="bg-white dark:bg-navy-mid rounded-xl border border-green-200 dark:border-green-800 p-6 space-y-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            <div>
              <h3 className="text-sm font-bold dark:text-white">Apply for Recognition of Prior Learning</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">Get your existing skills and experience formally recognized and certified</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Trade */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">Trade *</label>
              <select value={applyForm.trade} onChange={e => setApplyForm(f => ({ ...f, trade: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-border dark:border-navy-light rounded-lg bg-white dark:bg-navy-dark dark:text-white">
                <option value="">Select your trade</option>
                {['mason','electrician','welder','plumber','carpenter','steel-fixer','painter','hvac',
                  'pipe-fitter','scaffolder','rigger','crane-operator','heavy-driver','shuttering-carpenter',
                  'tile-fixer','duct-fabricator','auto-mechanic','diesel-mechanic','fabricator',
                  'insulation-worker','heavy-equipment-operator','aluminium-fabricator','safety-officer',
                  'cook','ac-technician'].map(tr => (
                  <option key={tr} value={tr}>{tr.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
                ))}
              </select>
            </div>

            {/* NQF Level */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">Target NQF Level</label>
              <select value={applyForm.nqfLevel} onChange={e => setApplyForm(f => ({ ...f, nqfLevel: Number(e.target.value) }))}
                className="w-full px-3 py-2 text-sm border border-border dark:border-navy-light rounded-lg bg-white dark:bg-navy-dark dark:text-white">
                {[1,2,3,4,5,6,7,8].map(l => (
                  <option key={l} value={l}>NQF Level {l}{l <= 2 ? ' (Semi-Skilled)' : l <= 4 ? ' (Skilled)' : l <= 6 ? ' (Advanced)' : ' (Expert)'}</option>
                ))}
              </select>
            </div>

            {/* Years of Experience */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">Years of Experience</label>
              <input type="number" min="0" max="50" value={applyForm.yearsExperience}
                onChange={e => setApplyForm(f => ({ ...f, yearsExperience: Number(e.target.value) }))}
                className="w-full px-3 py-2 text-sm border border-border dark:border-navy-light rounded-lg bg-white dark:bg-navy-dark dark:text-white" />
            </div>

            {/* Countries Worked In */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">Countries Worked In</label>
              <input type="text" placeholder="e.g. UAE, Saudi Arabia, Qatar"
                value={applyForm.employerCountries.join(', ')}
                onChange={e => setApplyForm(f => ({ ...f, employerCountries: e.target.value.split(',').map(s => s.trim()) }))}
                className="w-full px-3 py-2 text-sm border border-border dark:border-navy-light rounded-lg bg-white dark:bg-navy-dark dark:text-white" />
            </div>
          </div>

          {/* Previous Certifications */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">Previous Certifications / Training</label>
            <input type="text" placeholder="e.g. City & Guilds Level 2, NAVTTC Certificate, employer training"
              value={applyForm.previousCertifications}
              onChange={e => setApplyForm(f => ({ ...f, previousCertifications: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-border dark:border-navy-light rounded-lg bg-white dark:bg-navy-dark dark:text-white" />
          </div>

          {/* Motivation */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">Why are you applying for RPL?</label>
            <textarea rows={3} placeholder="Describe your work experience and why you believe you deserve formal recognition..."
              value={applyForm.motivation}
              onChange={e => setApplyForm(f => ({ ...f, motivation: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-border dark:border-navy-light rounded-lg bg-white dark:bg-navy-dark dark:text-white resize-none" />
            <p className="text-[10px] text-gray-400 mt-1">{applyForm.motivation.length}/1000 characters</p>
          </div>

          {/* Info box */}
          <div className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-900/10 rounded-xl border border-blue-200 dark:border-blue-800">
            <svg className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <div className="text-xs text-blue-700 dark:text-blue-300">
              <p className="font-semibold mb-1">What happens next?</p>
              <ol className="list-decimal list-inside space-y-0.5">
                <li>Your application is submitted for review</li>
                <li>Complete the pre-screening self-assessment</li>
                <li>Upload documentary evidence (certificates, letters, work samples)</li>
                <li>An assessor will review your documents and schedule an interview</li>
                <li>Complete a practical demonstration</li>
                <li>Receive your RPL certification decision</li>
              </ol>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button onClick={() => setShowApplyForm(false)}
              className="px-4 py-2 text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-navy-light rounded-xl transition-colors">
              Cancel
            </button>
            <button onClick={submitApplication} disabled={applySubmitting || !applyForm.trade}
              className="px-6 py-2 text-sm font-semibold bg-green-600 text-white rounded-xl hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center gap-2">
              {applySubmitting ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              )}
              {applySubmitting ? 'Submitting...' : 'Submit RPL Application'}
            </button>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Total RPL', value: assessments.length, color: 'bg-ilo-blue/10 text-ilo-blue' },
          { label: 'Pending', value: assessments.filter(a => a.status === 'pending').length, color: STATUS_COLORS.pending },
          { label: 'In Review', value: assessments.filter(a => a.status === 'in-review').length, color: STATUS_COLORS['in-review'] },
          { label: 'Moderation', value: assessments.filter(a => a.status === 'awaiting-moderation').length, color: STATUS_COLORS['awaiting-moderation'] },
          { label: 'Approved', value: assessments.filter(a => a.status === 'approved').length, color: STATUS_COLORS.approved },
          { label: 'Rejected', value: assessments.filter(a => a.status === 'rejected').length, color: STATUS_COLORS.rejected },
        ].map(s => (
          <div key={s.label} className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-3 text-center">
            <p className="text-xl font-bold dark:text-white">{s.value}</p>
            <p className={`text-[10px] font-semibold mt-1 px-2 py-0.5 rounded-full inline-block ${s.color}`}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Assessment list */}
      <div className="space-y-2">
        {assessments.length === 0 && (
          <div className="text-center py-12 bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light">
            <span className="text-4xl">📋</span>
            <p className="text-sm text-gray-400 mt-3">No RPL assessments yet</p>
            {isWorker && (
              <button onClick={() => setShowApplyForm(true)}
                className="mt-4 px-5 py-2.5 text-sm font-semibold bg-green-600 text-white rounded-xl hover:bg-green-700 transition-colors inline-flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                Apply for RPL Assessment
              </button>
            )}
          </div>
        )}
        {assessments.map(a => {
          const stg = a.rpl?.stageCompleted || {};
          const stagesDone = [stg.evidenceSubmission, stg.documentReview, stg.interview, stg.practicalDemo, stg.finalDecision].filter(Boolean).length;
          return (
            <div key={a._id} onClick={() => setSelected(a)}
              className="flex items-center justify-between p-4 rounded-xl bg-white dark:bg-navy-mid border border-border dark:border-navy-light hover:shadow-md transition-shadow cursor-pointer">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-white text-sm font-bold
                  ${a.status === 'approved' ? 'bg-green-500' : a.status === 'rejected' ? 'bg-red-500' : a.status === 'awaiting-moderation' ? 'bg-purple-500' : a.status === 'appealed' ? 'bg-orange-500' : a.status === 'in-review' ? 'bg-amber-500' : 'bg-ilo-blue'}`}>
                  {a.status === 'approved' ? '✓' : a.status === 'rejected' ? '✗' : a.status === 'awaiting-moderation' ? 'QA' : a.status === 'appealed' ? '!' : '→'}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold dark:text-white">{a.worker?.fullName || 'Worker'}</p>
                    {a.rpl?.selfApplication?.applied && (
                      <span className="px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">Self-Applied</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">{a.trade} &middot; {new Date(a.createdAt).toLocaleDateString()}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right hidden sm:block">
                  <p className="text-[10px] text-gray-400">Evidence: {a.rpl?.documentaryEvidence?.length || 0} docs</p>
                  <p className="text-[10px] text-gray-400">Progress: {stagesDone}/5 stages</p>
                </div>
                <span className={`px-2.5 py-1 text-[11px] font-semibold rounded-full capitalize ${STATUS_COLORS[a.status] || STATUS_COLORS.pending}`}>
                  {a.status}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ===== Issue #2: Structured Interview Form Component =====
function InterviewForm({ items, overallNotes, durationMinutes, done, onSubmit }) {
  const [formItems, setFormItems] = useState(items.map(i => ({ ...i })));
  const [notes, setNotes] = useState(overallNotes);
  const [duration, setDuration] = useState(durationMinutes || 30);

  const updateItem = (idx, field, value) => {
    setFormItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  };

  const handleSubmit = () => {
    const incomplete = formItems.some(i => !i.response?.trim());
    if (incomplete) { toast.error('Please complete all interview responses'); return; }
    onSubmit(formItems, notes, duration);
  };

  if (done) {
    const avgScore = formItems.length > 0 ? (formItems.reduce((s, i) => s + (i.score || 0), 0) / formItems.length).toFixed(1) : 0;
    return (
      <div>
        <p className="text-xs text-green-600 mb-2">Interview completed &middot; Avg score: {avgScore}/4 &middot; Duration: {durationMinutes} min</p>
        <div className="space-y-2">
          {formItems.map((item, i) => (
            <div key={i} className="p-2 rounded-lg bg-gray-50 dark:bg-navy-light text-xs">
              <p className="font-semibold dark:text-white">{item.competencyArea}: <span className={`${item.score >= 2 ? 'text-green-600' : 'text-red-500'}`}>{SCORE_LABELS[item.score || 0]} ({item.score}/4)</span></p>
              {item.response && <p className="text-gray-500 mt-0.5">{item.response}</p>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <label className="text-xs text-gray-500">Duration (min):</label>
        <input type="number" value={duration} onChange={e => setDuration(+e.target.value)} min={1} max={480}
          className="w-20 px-2 py-1 text-xs border border-border dark:border-navy-light rounded-lg bg-white dark:bg-navy dark:text-white" />
      </div>
      <div className="space-y-3">
        {formItems.map((item, i) => (
          <div key={i} className="p-3 rounded-lg border border-border dark:border-navy-light bg-white dark:bg-navy-light">
            <p className="text-xs font-bold text-ilo-blue mb-1">{item.competencyArea}</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2 italic">{item.question}</p>
            <textarea value={item.response || ''} onChange={e => updateItem(i, 'response', e.target.value)}
              placeholder="Record candidate's response..."
              rows={2}
              className="w-full px-2 py-1.5 text-xs border border-border dark:border-navy-light rounded-lg bg-gray-50 dark:bg-navy dark:text-white resize-none mb-2" />
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-gray-400 mr-1">Score:</span>
              {SCORE_LABELS.map((label, s) => (
                <button key={s} onClick={() => updateItem(i, 'score', s)}
                  className={`px-2 py-0.5 text-[10px] rounded-full border transition-colors
                    ${item.score === s ? 'bg-ilo-blue text-white border-ilo-blue' : 'border-gray-200 dark:border-navy-light text-gray-400 hover:border-ilo-blue'}`}>
                  {s} - {label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <textarea value={notes} onChange={e => setNotes(e.target.value)}
        placeholder="Overall interview notes..."
        rows={2}
        className="w-full mt-3 px-3 py-2 text-sm border border-border dark:border-navy-light rounded-xl bg-white dark:bg-navy dark:text-white resize-none" />
      <button onClick={handleSubmit} className="mt-2 px-4 py-1.5 text-xs font-semibold bg-amber-500 text-white rounded-lg hover:bg-amber-600">
        Complete Interview
      </button>
    </div>
  );
}

// ===== Issue #3: Practical Demo Rubric Form Component =====
function PracticalDemoForm({ rubric, overallResult, totalScore, location, done, onSubmit }) {
  const [formRubric, setFormRubric] = useState(rubric.map(r => ({ ...r })));
  const [result, setResult] = useState(overallResult);
  const [loc, setLoc] = useState(location);

  const updateRubric = (idx, field, value) => {
    setFormRubric(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  };

  const calcTotal = () => {
    const max = formRubric.length * 4;
    const raw = formRubric.reduce((sum, r) => sum + (r.score || 0), 0);
    return max > 0 ? Math.round((raw / max) * 100) : 0;
  };

  const handleSubmit = () => {
    if (result === 'pending') { toast.error('Select pass or fail for the overall result'); return; }
    onSubmit(formRubric, result, loc);
  };

  if (done) {
    return (
      <div>
        <div className="flex items-center gap-3 mb-2">
          <span className={`px-3 py-1 text-xs font-semibold rounded-full capitalize ${overallResult === 'pass' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            {overallResult}
          </span>
          <span className="text-xs text-gray-500">Score: {totalScore}%</span>
          {location && <span className="text-xs text-gray-400">Location: {location}</span>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {formRubric.map((item, i) => (
            <div key={i} className="p-2 rounded-lg bg-gray-50 dark:bg-navy-light text-xs flex justify-between items-center">
              <span className="font-medium dark:text-white">{item.criterion}</span>
              <span className={`font-bold ${item.score >= 2 ? 'text-green-600' : 'text-red-500'}`}>{item.score}/4</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <label className="text-xs text-gray-500">Location:</label>
        <input value={loc} onChange={e => setLoc(e.target.value)} placeholder="Assessment site location"
          className="flex-1 px-2 py-1 text-xs border border-border dark:border-navy-light rounded-lg bg-white dark:bg-navy dark:text-white" />
      </div>
      <div className="space-y-3">
        {formRubric.map((item, i) => (
          <div key={i} className="p-3 rounded-lg border border-border dark:border-navy-light bg-white dark:bg-navy-light">
            <p className="text-xs font-bold dark:text-white mb-0.5">{item.criterion}</p>
            {item.description && <p className="text-[10px] text-gray-400 mb-2">{item.description}</p>}
            <div className="flex flex-wrap items-center gap-1 mb-1">
              {RUBRIC_LABELS.map((label, s) => (
                <button key={s} onClick={() => updateRubric(i, 'score', s)}
                  className={`px-2 py-0.5 text-[10px] rounded-full border transition-colors
                    ${item.score === s ? (s >= 2 ? 'bg-green-500 text-white border-green-500' : 'bg-red-500 text-white border-red-500') : 'border-gray-200 dark:border-navy-light text-gray-400 hover:border-gray-400'}`}>
                  {s}
                </button>
              ))}
            </div>
            <input value={item.notes || ''} onChange={e => updateRubric(i, 'notes', e.target.value)} placeholder="Notes..."
              className="w-full px-2 py-1 text-[11px] border border-border dark:border-navy-light rounded bg-gray-50 dark:bg-navy dark:text-white" />
          </div>
        ))}
      </div>
      <div className="mt-3 p-3 rounded-lg bg-gray-50 dark:bg-navy-light flex items-center justify-between">
        <span className="text-sm font-bold dark:text-white">Total: {calcTotal()}%</span>
        <div className="flex gap-2">
          {['pass', 'fail'].map(r => (
            <button key={r} onClick={() => setResult(r)}
              className={`px-4 py-1.5 text-xs font-semibold rounded-lg border-2 capitalize
                ${result === r ? (r === 'pass' ? 'bg-green-50 border-green-500 text-green-700' : 'bg-red-50 border-red-500 text-red-700') : 'border-gray-200 text-gray-400'}`}>
              {r}
            </button>
          ))}
        </div>
      </div>
      <button onClick={handleSubmit} className="mt-2 px-4 py-1.5 text-xs font-semibold bg-ilo-blue text-white rounded-lg hover:bg-ilo-dark">
        Complete Practical Demo
      </button>
    </div>
  );
}
