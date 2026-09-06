import { useEffect, useState } from 'react';
import api from '../api/client';
import { useLang } from '../context/LangContext';
import KPICard from '../components/KPICard';
import toast from 'react-hot-toast';

export default function Assessor() {
  const { t } = useLang();
  const [stats, setStats] = useState(null);
  const [pendingVideos, setPendingVideos] = useState([]);
  const [pendingChecklists, setPendingChecklists] = useState([]);
  // Training submissions
  const [pendingSubmissions, setPendingSubmissions] = useState([]);
  const [submissionStats, setSubmissionStats] = useState(null);
  const [reviewModal, setReviewModal] = useState(null); // submission object or null
  const [reviewForm, setReviewForm] = useState({ grade: '', feedback: '', status: '' });

  useEffect(() => {
    api.get('/analytics/assessor')
      .then(r => setStats(r.data))
      .catch(() => toast.error('Failed to load assessor stats'));
    api.get('/assessments', { params: { type: 'video', status: 'pending', limit: 10 } })
      .then(r => setPendingVideos(r.data.assessments))
      .catch(() => toast.error('Failed to load pending videos'));
    api.get('/assessments', { params: { type: 'checklist', status: 'pending', limit: 10 } })
      .then(r => setPendingChecklists(r.data.assessments))
      .catch(() => toast.error('Failed to load pending checklists'));
    // Training submissions
    api.get('/training/submissions/pending')
      .then(r => setPendingSubmissions(r.data))
      .catch(() => {});
    api.get('/training/submissions/stats')
      .then(r => setSubmissionStats(r.data))
      .catch(() => {});
  }, []);

  const review = async (id, status) => {
    try {
      await api.put(`/assessments/${id}/review`, { status, feedback: `${status} by assessor`, score: status === 'approved' ? 85 : 40 });
      toast.success(`Assessment ${status}`);
      setPendingVideos(v => v.filter(a => a._id !== id));
      setPendingChecklists(c => c.filter(a => a._id !== id));
    } catch { toast.error('Review failed'); }
  };

  const quickApproveSubmission = async (sub) => {
    try {
      await api.put(`/training/${sub.programId}/submissions/${sub._id}/review`, {
        status: 'approved',
        grade: 85,
        feedback: 'Approved by assessor — good work.',
      });
      toast.success('Submission approved');
      setPendingSubmissions(s => s.filter(p => p._id !== sub._id));
      if (submissionStats) setSubmissionStats(s => ({ ...s, pendingReviews: Math.max(0, s.pendingReviews - 1), approvedToday: s.approvedToday + 1 }));
    } catch { toast.error('Approval failed'); }
  };

  const reviewSubmission = async (status) => {
    if (!reviewModal || !status) return;
    try {
      await api.put(`/training/${reviewModal.programId}/submissions/${reviewModal._id}/review`, {
        status,
        grade: reviewForm.grade ? Number(reviewForm.grade) : undefined,
        feedback: reviewForm.feedback || '',
      });
      toast.success(`Submission ${status}`);
      setPendingSubmissions(s => s.filter(p => p._id !== reviewModal._id));
      if (submissionStats) setSubmissionStats(s => ({ ...s, pendingReviews: Math.max(0, s.pendingReviews - 1), totalReviewed: s.totalReviewed + 1 }));
      setReviewModal(null);
      setReviewForm({ grade: '', feedback: '', status: '' });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Review failed');
    }
  };

  // Mini calendar
  const today = new Date();
  const year = today.getFullYear(), month = today.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const eventDays = [5, 12, 19, 26]; // Weekly assessment visits

  const evidenceTypeColors = {
    'photo-of-work': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    'video-demonstration': 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    'supervisor-signoff': 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    'other': 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold dark:text-white">{t('Assessor Dashboard')}</h2>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard icon="📹" label="Pending Videos" value={stats?.pendingVideos ?? '—'} color="purple" />
        <KPICard icon="📋" label="Checklist Sign-offs" value={stats?.pendingChecklists ?? '—'} color="gold" />
        <KPICard icon="✅" label="Reviewed Today" value={stats?.reviewedToday ?? '—'} color="success" />
        <KPICard icon="📊" label="Approval Rate" value={stats?.approvalRate ?? '—'} suffix="%" color="teal" />
      </div>

      {/* Training Submission KPIs */}
      {submissionStats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard icon="📝" label="Pending Submissions" value={submissionStats.pendingReviews} color="purple" />
          <KPICard icon="✅" label="Approved Today" value={submissionStats.approvedToday} color="success" />
          <KPICard icon="❌" label="Rejection Rate" value={submissionStats.rejectionRate} suffix="%" color="gold" />
          <KPICard icon="📊" label="Total Reviewed" value={submissionStats.totalReviewed} color="teal" />
        </div>
      )}

      {/* Training Submissions Panel */}
      {pendingSubmissions.length > 0 && (
        <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-5">
          <h3 className="font-semibold dark:text-white mb-4 flex items-center gap-2">
            Training Submissions
            <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded-full">{pendingSubmissions.length} pending</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {pendingSubmissions.map(sub => (
              <div key={sub._id} className="p-4 rounded-xl border border-border dark:border-navy-light bg-gray-50 dark:bg-navy-light space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold dark:text-white">{sub.workerName}</p>
                    <p className="text-[11px] text-gray-500 capitalize">{sub.trade}</p>
                  </div>
                  <span className="text-[10px] text-gray-400">{sub.submittedAt ? new Date(sub.submittedAt).toLocaleDateString() : ''}</span>
                </div>

                <div>
                  <p className="text-xs font-medium dark:text-gray-300">{sub.programTitle}</p>
                  <p className="text-[11px] text-gray-500">Module: {sub.moduleTitle} <span className="capitalize">({sub.moduleType})</span></p>
                </div>

                {/* Evidence type badge */}
                <div className="flex flex-wrap gap-1.5">
                  <span className={`px-2 py-0.5 text-[9px] font-bold rounded-full capitalize ${evidenceTypeColors[sub.evidenceType] || evidenceTypeColors.other}`}>
                    {(sub.evidenceType || 'other').replace(/-/g, ' ')}
                  </span>
                  {sub.competencies?.slice(0, 3).map((c, ci) => (
                    <span key={ci} className="px-1.5 py-0.5 text-[9px] font-semibold rounded-full bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400">{c.skill}</span>
                  ))}
                </div>

                {/* File thumbnails */}
                {sub.files?.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {sub.files.map((f, fi) => {
                      const isImage = /\.(jpg|jpeg|png|webp)$/i.test(f.name);
                      const isVideo = /\.(mp4|mov|avi|webm)$/i.test(f.name);
                      return (
                        <a key={fi} href={f.url} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1 px-2 py-1 bg-white dark:bg-navy-mid rounded text-[10px] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-navy border border-border dark:border-navy-light">
                          {isImage ? (
                            <img src={f.url} alt={f.name} className="w-6 h-6 object-cover rounded" />
                          ) : isVideo ? (
                            <svg className="w-3 h-3 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                          ) : (
                            <svg className="w-3 h-3 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                          )}
                          <span className="truncate max-w-[60px]">{f.name}</span>
                        </a>
                      );
                    })}
                  </div>
                )}

                {sub.notes && <p className="text-[11px] text-gray-500 italic">"{sub.notes}"</p>}

                {/* Action buttons */}
                <div className="flex gap-2 pt-1">
                  <button onClick={() => quickApproveSubmission(sub)}
                    className="flex-1 px-3 py-1.5 text-xs font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
                    Quick Approve
                  </button>
                  <button onClick={() => { setReviewModal(sub); setReviewForm({ grade: '', feedback: '', status: '' }); }}
                    className="flex-1 px-3 py-1.5 text-xs font-semibold bg-ilo-blue text-white rounded-lg hover:bg-ilo-dark transition-colors">
                    Review
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Pending Video Reviews */}
        <div className="lg:col-span-1 bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-5">
          <h3 className="font-semibold dark:text-white mb-3">Pending Video Reviews</h3>
          <div className="space-y-3">
            {pendingVideos.length === 0 && <p className="text-sm text-gray-400">No pending videos</p>}
            {pendingVideos.map(v => (
              <div key={v._id} className="flex items-center gap-3 p-2 rounded-lg bg-gray-50 dark:bg-navy-light">
                <div className="w-10 h-10 rounded-lg bg-ilo-blue/10 dark:bg-ilo-blue/20 flex items-center justify-center text-lg">📹</div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold dark:text-white truncate">{v.worker?.fullName}</p>
                  <p className="text-[10px] text-gray-500 capitalize">{v.trade}</p>
                </div>
                <button onClick={() => review(v._id, 'approved')} className="px-2 py-1 text-[10px] font-semibold bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded hover:bg-green-200">Approve</button>
              </div>
            ))}
          </div>
        </div>

        {/* Pending Checklist Sign-offs */}
        <div className="lg:col-span-1 bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-5">
          <h3 className="font-semibold dark:text-white mb-3">Pending Checklists</h3>
          <div className="space-y-3">
            {pendingChecklists.length === 0 && <p className="text-sm text-gray-400">No pending checklists</p>}
            {pendingChecklists.map(c => (
              <div key={c._id} className="flex items-center gap-3 p-2 rounded-lg bg-gray-50 dark:bg-navy-light">
                <div className="w-10 h-10 rounded-lg bg-gold-light/10 flex items-center justify-center text-lg">📋</div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold dark:text-white truncate">{c.worker?.fullName}</p>
                  <p className="text-[10px] text-gray-500 capitalize">{c.checklist?.site || c.trade}</p>
                </div>
                <button onClick={() => review(c._id, 'approved')} className="px-2 py-1 text-[10px] font-semibold bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded hover:bg-green-200">Sign Off</button>
              </div>
            ))}
          </div>
        </div>

        {/* Mini Calendar */}
        <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-5">
          <h3 className="font-semibold dark:text-white mb-3">
            {today.toLocaleString('default', { month: 'long' })} {year}
          </h3>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px]">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
              <div key={d} className="font-semibold text-gray-400 py-1">{d}</div>
            ))}
            {Array.from({ length: firstDay }, (_, i) => <div key={`e-${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1;
              const isToday = day === today.getDate();
              const hasEvent = eventDays.includes(day);
              return (
                <div key={day} className={`py-1.5 rounded-lg relative ${isToday ? 'bg-ilo-blue text-white font-bold' : 'dark:text-gray-300'}`}>
                  {day}
                  {hasEvent && <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-gold-accent" />}
                </div>
              );
            })}
          </div>
          <div className="mt-3 pt-3 border-t border-gray-100 dark:border-navy-light">
            <p className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-gold-accent" /> Workplace assessment visits
            </p>
          </div>
        </div>
      </div>

      {/* Review Modal */}
      {reviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-navy-mid rounded-2xl border border-border dark:border-navy-light max-w-xl w-full max-h-[85vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold dark:text-white">Review Submission</h3>
              <button onClick={() => setReviewModal(null)} className="text-gray-400 hover:text-gray-600 text-lg">&times;</button>
            </div>

            <div className="space-y-2">
              <p className="text-xs text-gray-500"><strong>Worker:</strong> {reviewModal.workerName}</p>
              <p className="text-xs text-gray-500"><strong>Program:</strong> {reviewModal.programTitle}</p>
              <p className="text-xs text-gray-500"><strong>Module:</strong> {reviewModal.moduleTitle} ({reviewModal.moduleType})</p>
              {reviewModal.evidenceType && reviewModal.evidenceType !== 'other' && (
                <p className="text-xs text-gray-500"><strong>Evidence:</strong> <span className="capitalize">{reviewModal.evidenceType.replace(/-/g, ' ')}</span></p>
              )}
              {reviewModal.notes && <p className="text-xs text-gray-500"><strong>Notes:</strong> {reviewModal.notes}</p>}
            </div>

            {/* File preview */}
            {reviewModal.files?.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-500">Uploaded Files ({reviewModal.files.length})</p>
                <div className="flex flex-wrap gap-3">
                  {reviewModal.files.map((f, fi) => {
                    const isImage = /\.(jpg|jpeg|png|webp)$/i.test(f.name);
                    return (
                      <a key={fi} href={f.url} target="_blank" rel="noopener noreferrer" className="block">
                        {isImage ? (
                          <img src={f.url} alt={f.name} className="w-32 h-32 object-cover rounded-lg border border-border dark:border-navy-light" />
                        ) : (
                          <div className="w-32 h-32 flex flex-col items-center justify-center rounded-lg border border-border dark:border-navy-light bg-gray-50 dark:bg-navy-light">
                            <svg className="w-8 h-8 text-gray-400 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                            <span className="text-[10px] text-gray-500 truncate max-w-[100px]">{f.name}</span>
                          </div>
                        )}
                      </a>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Competency rubric */}
            {reviewModal.competencies?.length > 0 && (
              <div className="p-3 bg-blue-50 dark:bg-blue-900/10 rounded-lg border border-blue-200 dark:border-blue-800">
                <p className="text-xs font-bold text-blue-700 dark:text-blue-400 mb-2">Competencies Assessed</p>
                <div className="flex flex-wrap gap-1.5">
                  {reviewModal.competencies.map((c, ci) => (
                    <span key={ci} className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 capitalize">
                      {c.skill} ({c.level})
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Grade input */}
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1">Grade (0-100)</label>
              <input type="number" min="0" max="100" value={reviewForm.grade}
                onChange={e => setReviewForm(f => ({ ...f, grade: e.target.value }))}
                placeholder="Enter grade..."
                className="w-full px-3 py-2 text-sm border border-border dark:border-navy-light rounded-xl bg-white dark:bg-navy dark:text-white" />
            </div>

            {/* Feedback */}
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1">Feedback</label>
              <textarea value={reviewForm.feedback}
                onChange={e => setReviewForm(f => ({ ...f, feedback: e.target.value }))}
                placeholder="Provide constructive feedback..."
                rows={3} maxLength={1000}
                className="w-full px-3 py-2 text-sm border border-border dark:border-navy-light rounded-xl bg-white dark:bg-navy dark:text-white resize-none" />
            </div>

            {/* Action buttons */}
            <div className="flex gap-3 pt-2">
              <button onClick={() => reviewSubmission('approved')}
                className="flex-1 px-4 py-2.5 text-sm font-semibold bg-green-600 text-white rounded-xl hover:bg-green-700 transition-colors">
                Approve
              </button>
              <button onClick={() => reviewSubmission('rejected')}
                className="flex-1 px-4 py-2.5 text-sm font-semibold bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors">
                Reject
              </button>
              <button onClick={() => setReviewModal(null)}
                className="px-4 py-2.5 text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-navy-light rounded-xl">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
