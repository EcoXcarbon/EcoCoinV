import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api/client';
import DataTable from '../components/DataTable';
import { useLang } from '../context/LangContext';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

const SUBMIT_TYPES = [
  ['ACADEMIC', 'Academic degree'], ['TVET', 'TVET / diploma'], ['PROFESSIONAL_LICENSE', 'Professional license'],
  ['MICRO_CREDENTIAL', 'Micro-credential / online course'], ['TRAINING_RECORD', 'Training certificate'],
  ['EMPLOYER_ENDORSEMENT', 'Employer endorsement'], ['HEALTH_CLEARANCE', 'Health / safety clearance'],
  ['MIGRATION_RECORD', 'Migration record'], ['SELF_DECLARED', 'Other / self-declared'],
];

const regStatusPill = (s) => {
  const m = {
    PENDING_VERIFICATION: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    UNDER_REVIEW: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
    CHANGES_REQUESTED: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    ACTIVE: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    REJECTED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    REVOKED: 'bg-red-100 text-red-700', EXPIRED: 'bg-gray-100 text-gray-500',
  };
  const label = { PENDING_VERIFICATION: 'Pending review', UNDER_REVIEW: 'Under review', CHANGES_REQUESTED: 'Changes requested', ACTIVE: 'Verified ✓', REJECTED: 'Not approved' }[s] || s;
  return <span className={`px-2 py-0.5 text-[11px] font-semibold rounded-full ${m[s] || 'bg-gray-100 text-gray-500'}`}>{label}</span>;
};

export default function Credentials() {
  const { t } = useLang();
  const { user } = useAuth();
  const isStaff = ['admin', 'institution', 'assessor'].includes(user?.role);
  const canReview = ['admin', 'institution'].includes(user?.role);
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || (isStaff ? 'issued' : 'my-submissions');
  const setTab = (name) => setSp((prev) => { const n = new URLSearchParams(prev); n.set('tab', name); return n; }, { replace: true });

  // ── staff (existing) issuance state ──
  const [credentials, setCreds] = useState([]);
  const [showIssue, setShowIssue] = useState(false);
  const [workers, setWorkers] = useState([]);
  const [form, setForm] = useState({ workerId: '', type: 'trade-certificate', title: '', trade: 'mason', nqfLevel: 2, institution: 'PPMC Peshawar' });

  // ── verification workflow state ──
  const [queue, setQueue] = useState([]);
  const [mySubs, setMySubs] = useState([]);
  const [showSubmit, setShowSubmit] = useState(false);
  const [subForm, setSubForm] = useState({ credentialType: 'ACADEMIC', title: '', issuerName: '', issuanceDate: '', evidenceDescription: '' });
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [queueCounts, setQueueCounts] = useState({});
  const [queueFilter, setQueueFilter] = useState('OPEN');

  const loadQueue = useCallback((status = 'OPEN') => {
    setQueueFilter(status);
    const params = status && status !== 'OPEN' ? { status } : {};
    return api.get('/registry/verification-queue', { params })
      .then((r) => { setQueue(r.data.credentials || []); setQueueCounts(r.data.counts || {}); })
      .catch(() => {});
  }, []);
  const loadMySubs = useCallback(() => api.get('/registry/my-submissions').then((r) => setMySubs(r.data.credentials || [])).catch(() => {}), []);

  useEffect(() => {
    if (isStaff) {
      api.get('/credentials', { params: { limit: 100 } }).then((r) => setCreds(r.data.credentials)).catch(() => {});
      api.get('/workers', { params: { limit: 100 } }).then((r) => setWorkers(r.data.workers)).catch(() => {});
      loadQueue();
    } else {
      loadMySubs();
    }
  }, [isStaff, loadQueue, loadMySubs]);

  const handleIssue = async (e) => {
    e.preventDefault();
    try {
      const { data } = await api.post('/credentials', form);
      toast.success(`Credential ${data.credentialId} issued`);
      setShowIssue(false);
      setCreds((c) => [data, ...c]);
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to issue'); }
  };

  const handleRevoke = async (id) => {
    if (!confirm('Revoke this credential?')) return;
    try {
      await api.post(`/credentials/${id}/revoke`, { reason: 'Administrative revocation' });
      toast.success('Credential revoked');
      setCreds((c) => c.map((cr) => (cr._id === id ? { ...cr, status: 'revoked' } : cr)));
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to revoke'); }
  };

  const handleDownloadPDF = async (id, credentialId) => {
    try {
      const res = await api.get(`/credentials/${id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a'); a.href = url; a.download = `${credentialId || id}.pdf`; a.click();
      URL.revokeObjectURL(url); toast.success('Certificate downloaded');
    } catch { toast.error('PDF generation failed'); }
  };
  const handleDownloadCard = async (id, credentialId) => {
    try {
      const res = await api.get(`/credentials/${id}/card`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a'); a.href = url; a.download = `${credentialId || id}-card.pdf`; a.click();
      URL.revokeObjectURL(url); toast.success('PVC card downloaded');
    } catch { toast.error('Card generation failed'); }
  };

  // ── verification workflow handlers ──
  const submitCredential = async (e) => {
    e.preventDefault();
    if (!subForm.title.trim()) { toast.error('Enter the credential title'); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      Object.entries(subForm).forEach(([k, v]) => { if (v) fd.append(k, v); });
      files.forEach((f) => fd.append('evidence', f));
      await api.post('/registry/credentials/submit', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Submitted — an admin will verify it shortly.');
      setShowSubmit(false);
      setSubForm({ credentialType: 'ACADEMIC', title: '', issuerName: '', issuanceDate: '', evidenceDescription: '' });
      setFiles([]);
      loadMySubs();
    } catch (err) { toast.error(err.response?.data?.error || 'Submission failed'); }
    finally { setBusy(false); }
  };

  const review = async (cred, decision) => {
    let reviewNotes = '', rejectionReason = '', referredTo = '';
    if (decision === 'APPROVE') {
      if (!window.confirm(`Approve "${cred.title}" and issue a verified credential?`)) return;
    } else if (decision === 'REJECT') {
      rejectionReason = window.prompt('Reason it is NOT approved (shown to the applicant):') || '';
      if (!rejectionReason.trim()) return;
    } else if (decision === 'REQUEST_CHANGES') {
      reviewNotes = window.prompt('What must the applicant change/re-submit? (shown to them):') || '';
      if (!reviewNotes.trim()) return;
    } else if (decision === 'FORWARD') {
      referredTo = window.prompt('Forward / refer to — e.g. Issuing institution, Senior administrator, Assessor panel:', 'Issuing institution') || '';
      if (!referredTo.trim()) return;
      reviewNotes = window.prompt('Note for the referral (optional):') || '';
    }
    setBusy(true);
    try {
      await api.post(`/registry/credentials/${cred.credentialId}/review-submission`, { decision, reviewNotes, rejectionReason, referredTo });
      toast.success({ APPROVE: 'Approved & verified ✓', REJECT: 'Marked not approved', REQUEST_CHANGES: 'Changes requested', FORWARD: `Forwarded to ${referredTo}`, HOLD: 'Marked under review' }[decision]);
      loadQueue(queueFilter);
    } catch (err) { toast.error(err.response?.data?.error || 'Action failed'); }
    finally { setBusy(false); }
  };

  const viewEvidence = async (f) => {
    try {
      const rel = f.url.replace(/^\/api/, '');
      const res = await api.get(rel, { responseType: 'blob' });
      window.open(URL.createObjectURL(res.data), '_blank');
    } catch { toast.error('Could not open evidence'); }
  };

  const columns = [
    { key: 'credentialId', label: 'ID' },
    { key: 'worker', label: 'Worker', render: (_, row) => row.worker?.fullName || '—' },
    { key: 'trade', label: 'Trade', render: (v) => <span className="capitalize">{v}</span> },
    { key: 'title', label: 'Title' },
    { key: 'nqfLevel', label: 'NQF' },
    { key: 'status', label: 'Status', render: (v) => {
      const c = { active: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', revoked: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', expired: 'bg-gray-100 text-gray-500' };
      return <span className={`px-2 py-0.5 text-[11px] font-semibold rounded-full capitalize ${c[v] || ''}`}>{v}</span>;
    } },
    { key: 'actions', label: 'Actions', sortable: false, render: (_, row) => (
      <div className="flex gap-1 flex-wrap">
        <button onClick={() => handleDownloadPDF(row._id, row.credentialId)} className="px-2 py-1 text-[10px] bg-ilo-blue/10 text-ilo-blue rounded hover:bg-ilo-blue/20">📄 Cert</button>
        <button onClick={() => handleDownloadCard(row._id, row.credentialId)} className="px-2 py-1 text-[10px] bg-emerald-50 text-emerald-700 rounded hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400">🪪 Card</button>
        {row.status === 'active' && canReview && (
          <button onClick={() => handleRevoke(row._id)} className="px-2 py-1 text-[10px] bg-red-50 text-red-600 rounded hover:bg-red-100 dark:bg-red-900/20">Revoke</button>
        )}
      </div>
    ) },
  ];

  const TabBtn = ({ name, children, badge }) => (
    <button onClick={() => setTab(name)}
      className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${tab === name ? 'bg-ilo-blue text-white' : 'text-slate-500 hover:bg-surface dark:hover:bg-navy-light'}`}>
      {children}{badge > 0 && <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-amber-500 text-white">{badge}</span>}
    </button>
  );

  const inputCls = 'w-full px-3 py-2 text-sm border border-border dark:border-navy-light rounded-lg bg-white dark:bg-navy dark:text-white';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold dark:text-white">{t('Credentials')}</h2>
        {isStaff
          ? tab === 'issued' && canReview && (
            <button onClick={() => setShowIssue(!showIssue)} className="px-4 py-1.5 text-xs font-semibold bg-ilo-blue text-white rounded-lg hover:bg-ilo-dark">+ Issue Credential</button>
          )
          : <button onClick={() => setShowSubmit(!showSubmit)} className="px-4 py-1.5 text-xs font-semibold bg-ilo-blue text-white rounded-lg hover:bg-ilo-dark">+ Submit a credential</button>}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 flex-wrap">
        {isStaff ? (
          <>
            <TabBtn name="issued">Issued Credentials</TabBtn>
            <TabBtn name="verification-queue" badge={queue.length}>Verification Queue</TabBtn>
          </>
        ) : (
          <TabBtn name="my-submissions">My Credentials</TabBtn>
        )}
      </div>

      {/* ── Worker: submit form ── */}
      {!isStaff && showSubmit && (
        <form onSubmit={submitCredential} className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-4 space-y-3">
          <p className="text-sm font-bold text-ilo-dark dark:text-white">Submit a credential you already hold — an admin will verify it.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block"><span className="text-xs font-semibold text-slate-500">Credential type</span>
              <select value={subForm.credentialType} onChange={(e) => setSubForm((f) => ({ ...f, credentialType: e.target.value }))} className={inputCls}>
                {SUBMIT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="block"><span className="text-xs font-semibold text-slate-500">Title *</span>
              <input required value={subForm.title} onChange={(e) => setSubForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. BSc Civil Engineering" className={inputCls} />
            </label>
            <label className="block"><span className="text-xs font-semibold text-slate-500">Issuing body</span>
              <input value={subForm.issuerName} onChange={(e) => setSubForm((f) => ({ ...f, issuerName: e.target.value }))} placeholder="e.g. UET Peshawar" className={inputCls} />
            </label>
            <label className="block"><span className="text-xs font-semibold text-slate-500">Issue date</span>
              <input type="date" value={subForm.issuanceDate} onChange={(e) => setSubForm((f) => ({ ...f, issuanceDate: e.target.value }))} className={inputCls} />
            </label>
          </div>
          <label className="block"><span className="text-xs font-semibold text-slate-500">Notes (optional)</span>
            <textarea rows={2} value={subForm.evidenceDescription} onChange={(e) => setSubForm((f) => ({ ...f, evidenceDescription: e.target.value }))} placeholder="Anything the reviewer should know" className={inputCls} />
          </label>
          <label className="block"><span className="text-xs font-semibold text-slate-500">Evidence (PDF / image of the certificate) *</span>
            <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx" onChange={(e) => setFiles(Array.from(e.target.files))} className={`${inputCls} py-1.5`} />
          </label>
          {files.length > 0 && <p className="text-[11px] text-slate-500">{files.length} file(s) attached</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="px-4 py-2 text-xs font-black bg-ilo-blue text-white rounded-lg disabled:opacity-50">{busy ? 'Submitting…' : 'Submit for verification'}</button>
            <button type="button" onClick={() => setShowSubmit(false)} className="px-4 py-2 text-xs border border-border dark:border-navy-light rounded-lg dark:text-gray-300">Cancel</button>
          </div>
        </form>
      )}

      {/* ── Worker: my submissions ── */}
      {!isStaff && tab === 'my-submissions' && (
        mySubs.length === 0 ? (
          <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-10 text-center text-sm text-slate-400">
            No credentials yet. Click <strong>“+ Submit a credential”</strong> to add one for verification.
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {mySubs.map((c) => (
              <div key={c.credentialId} className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[11px] text-slate-400">{c.credentialType?.replace(/_/g, ' ')}</div>
                    <h3 className="font-bold text-ilo-dark dark:text-white leading-snug">{c.title}</h3>
                    {c.issuerName && <p className="text-xs text-slate-500">{c.issuerName}</p>}
                  </div>
                  {regStatusPill(c.status)}
                </div>
                {c.status === 'REJECTED' && c.rejectionReason && <p className="mt-2 text-xs text-red-500">Reason: {c.rejectionReason}</p>}
                {c.status === 'ACTIVE' && <p className="mt-2 text-xs text-emerald-600 font-semibold">✓ Verified &amp; added to your registry</p>}
                {c.evidenceFiles?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {c.evidenceFiles.map((f, i) => <button key={i} onClick={() => viewEvidence(f)} className="px-2 py-0.5 text-[10px] bg-surface dark:bg-navy-light rounded hover:bg-surface-2">📎 {f.name?.slice(0, 22) || 'evidence'}</button>)}
                  </div>
                ) : null}
                <div className="mt-2 text-[10px] text-slate-400">Submitted {new Date(c.createdAt).toLocaleDateString()}</div>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Admin: verification queue ── */}
      {isStaff && tab === 'verification-queue' && (
        <div className="space-y-3">
          {/* Status filters */}
          <div className="flex gap-1.5 flex-wrap">
            {[['OPEN', 'Needs action'], ['PENDING_VERIFICATION', 'Pending'], ['UNDER_REVIEW', 'Under review / referred'], ['CHANGES_REQUESTED', 'Awaiting applicant'], ['ALL', 'All']].map(([k, label]) => {
              const n = k === 'OPEN' ? (queueCounts.PENDING_VERIFICATION || 0) + (queueCounts.UNDER_REVIEW || 0) + (queueCounts.CHANGES_REQUESTED || 0)
                : k === 'ALL' ? Object.values(queueCounts).reduce((a, b) => a + b, 0) : (queueCounts[k] || 0);
              return (
                <button key={k} onClick={() => loadQueue(k)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${queueFilter === k ? 'bg-ilo-blue text-white' : 'bg-surface dark:bg-navy-light text-slate-500 hover:bg-surface-2'}`}>
                  {label} <span className="opacity-70">({n})</span>
                </button>
              );
            })}
          </div>

          {queue.length === 0 ? (
            <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-10 text-center text-sm text-slate-400">
              🎉 Nothing here.
            </div>
          ) : queue.map((c) => {
            const decided = ['ACTIVE', 'REJECTED', 'REVOKED', 'EXPIRED', 'SUSPENDED'].includes(c.status);
            return (
              <div key={c.credentialId} className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {regStatusPill(c.status)}
                      {c.assignedToName && c.status === 'UNDER_REVIEW' && <span className="text-[10px] text-indigo-500">held by {c.assignedToName}</span>}
                      {c.referredTo && c.status === 'UNDER_REVIEW' && <span className="text-[10px] text-indigo-500">→ referred to {c.referredTo}</span>}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1">{c.credentialType?.replace(/_/g, ' ')} · submitted {new Date(c.createdAt).toLocaleDateString()}</div>
                    <h3 className="font-bold text-ilo-dark dark:text-white leading-snug">{c.title}</h3>
                    {c.issuerName && <p className="text-xs text-slate-500">Issuer: {c.issuerName}</p>}
                    <p className="mt-1 text-xs text-slate-500">
                      Applicant: <strong className="text-ilo-dark dark:text-white">{c.holder?.fullName || c.submittedBy?.name || '—'}</strong>
                      {c.holder?.registrationId ? ` · ${c.holder.registrationId}` : ''}
                      {c.holder?.trade ? ` · ${c.holder.trade}` : ''}
                      {c.holder?.nadraVerificationStatus === 'VERIFIED' ? ' · 🆔 NADRA verified' : ''}
                    </p>
                    {c.metadata?.selfDeclared?.evidenceDescription && <p className="mt-1 text-xs italic text-slate-400">“{c.metadata.selfDeclared.evidenceDescription}”</p>}
                    {c.evidenceFiles?.length ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {c.evidenceFiles.map((f, i) => <button key={i} onClick={() => viewEvidence(f)} className="px-2 py-1 text-[11px] bg-ilo-blue/10 text-ilo-blue rounded hover:bg-ilo-blue/20">📎 View evidence {i + 1}</button>)}
                      </div>
                    ) : <p className="mt-2 text-[11px] text-amber-500">⚠ No evidence attached</p>}
                    {/* Audit trail */}
                    {c.reviewHistory?.length ? (
                      <div className="mt-3 border-t border-border dark:border-navy-light pt-2">
                        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Review history</div>
                        <ul className="space-y-0.5">
                          {c.reviewHistory.map((h, i) => (
                            <li key={i} className="text-[11px] text-slate-500">
                              <span className="font-semibold">{h.action?.replace(/_/g, ' ')}</span> by {h.byName || 'reviewer'}
                              {h.referredTo ? ` → ${h.referredTo}` : ''}{h.note ? ` — "${h.note}"` : ''} · {new Date(h.at).toLocaleString()}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                  {canReview && !decided && (
                    <div className="flex flex-col gap-1.5 shrink-0 w-full sm:w-auto">
                      <button disabled={busy} onClick={() => review(c, 'APPROVE')} className="px-4 py-2 text-xs font-black bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">✓ Approve &amp; verify</button>
                      <button disabled={busy} onClick={() => review(c, 'REJECT')} className="px-4 py-2 text-xs font-bold border border-red-300 text-red-600 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50">✗ Not approved</button>
                      <button disabled={busy} onClick={() => review(c, 'REQUEST_CHANGES')} className="px-4 py-2 text-xs font-bold border border-orange-300 text-orange-600 rounded-lg hover:bg-orange-50 dark:hover:bg-orange-900/20 disabled:opacity-50">✎ Request changes</button>
                      <button disabled={busy} onClick={() => review(c, 'FORWARD')} className="px-4 py-2 text-xs font-bold border border-indigo-300 text-indigo-600 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 disabled:opacity-50">↪ Forward / refer</button>
                      {c.status !== 'UNDER_REVIEW' && <button disabled={busy} onClick={() => review(c, 'HOLD')} className="px-4 py-2 text-xs font-bold border border-slate-300 text-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50">⏸ Hold (under review)</button>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Staff: issue form + issued credentials table ── */}
      {isStaff && tab === 'issued' && (
        <>
          {showIssue && (
            <form onSubmit={handleIssue} className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <select required value={form.workerId} onChange={(e) => setForm((f) => ({ ...f, workerId: e.target.value }))} className={inputCls}>
                <option value="">Select Worker</option>
                {workers.map((w) => <option key={w._id} value={w._id}>{w.fullName} — {w.registrationId}</option>)}
              </select>
              <input required placeholder="Title (e.g. Mason Trade Certificate)" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className={inputCls} />
              <select value={form.trade} onChange={(e) => setForm((f) => ({ ...f, trade: e.target.value }))} className={`${inputCls} capitalize`}>
                {['mason', 'electrician', 'welder', 'plumber', 'carpenter', 'steel-fixer', 'painter', 'hvac', 'pipe-fitter', 'scaffolder', 'rigger', 'crane-operator', 'heavy-driver', 'shuttering-carpenter', 'tile-fixer', 'duct-fabricator', 'auto-mechanic', 'diesel-mechanic', 'fabricator', 'insulation-worker', 'heavy-equipment-operator', 'aluminium-fabricator', 'safety-officer', 'cook', 'ac-technician'].map((tr) => <option key={tr} value={tr}>{tr}</option>)}
              </select>
              <select value={form.nqfLevel} onChange={(e) => setForm((f) => ({ ...f, nqfLevel: Number(e.target.value) }))} className={inputCls}>
                {[1, 2, 3, 4].map((n) => <option key={n} value={n}>NQF Level {n}</option>)}
              </select>
              <input value={form.institution} onChange={(e) => setForm((f) => ({ ...f, institution: e.target.value }))} className={inputCls} />
              <div className="flex gap-2">
                <button type="submit" className="px-4 py-2 text-xs font-semibold bg-green-600 text-white rounded-lg">Issue</button>
                <button type="button" onClick={() => setShowIssue(false)} className="px-4 py-2 text-xs border border-border dark:border-navy-light rounded-lg dark:text-gray-300">Cancel</button>
              </div>
            </form>
          )}
          <DataTable columns={columns} data={credentials} />
        </>
      )}
    </div>
  );
}
