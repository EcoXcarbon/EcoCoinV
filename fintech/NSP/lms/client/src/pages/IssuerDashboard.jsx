import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtTime = (d) => d ? new Date(d).toLocaleString('en-PK', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

const STATUS_PILL = {
  ACTIVE:   'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
  active:   'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
  PENDING:  'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  pending:  'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  REVOKED:  'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  revoked:  'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  EXPIRED:  'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-400',
  expired:  'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-400',
  SUSPENDED:'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
};

const TABS = [
  { key: 'dashboard', icon: '⊞',  label: 'Dashboard'  },
  { key: 'queue',     icon: '⏳',  label: 'Queue'      },
  { key: 'issued',    icon: '✅',  label: 'Issued'     },
  { key: 'bulk',      icon: '📦',  label: 'Bulk Upload'},
  { key: 'analytics', icon: '📊',  label: 'Analytics'  },
  { key: 'settings',  icon: '⚙',  label: 'Settings'   },
];

// ── Modal component ───────────────────────────────────────────────────────────
function Modal({ open, title, onClose, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
         onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-slate-700">
          <h3 className="text-base font-bold dark:text-white">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-slate-700 flex items-center justify-center text-gray-500 hover:bg-gray-200 dark:hover:bg-slate-600 text-sm">✕</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

// ── Bar chart (no library) ────────────────────────────────────────────────────
function BarChart({ data, label, valueKey = 'count', nameKey = '_id', colorClass = 'bg-blue-500' }) {
  const max = Math.max(...data.map(d => d[valueKey] || 0), 1);
  return (
    <div className="space-y-2">
      {data.map((item, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="text-xs text-gray-500 dark:text-gray-400 w-28 truncate flex-shrink-0">{item[nameKey] || 'Unknown'}</span>
          <div className="flex-1 bg-gray-100 dark:bg-slate-700 rounded-full h-5 overflow-hidden">
            <div className={`${colorClass} h-full rounded-full flex items-center px-2 transition-all duration-500`}
                 style={{ width: `${Math.max((item[valueKey] / max) * 100, 4)}%` }}>
              <span className="text-[9px] text-white font-bold">{item[valueKey]}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, icon, color = 'blue', sub }) {
  const colors = {
    blue:   'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
    green:  'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
    amber:  'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400',
    purple: 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
    red:    'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
  };
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-gray-200 dark:border-slate-700 shadow-sm">
      <div className="flex items-start gap-4">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-xl flex-shrink-0 ${colors[color]}`}>{icon}</div>
        <div>
          <p className="text-2xl font-black text-gray-900 dark:text-white leading-tight">{value ?? '—'}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</p>
          {sub && <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

// ── Queue Card ────────────────────────────────────────────────────────────────
function QueueCard({ item, onApprove, onReject }) {
  const waitHours = item.createdAt
    ? Math.round((Date.now() - new Date(item.createdAt)) / 3600000)
    : null;
  const urgent = waitHours > 48;

  return (
    <div className={`bg-white dark:bg-slate-800 rounded-2xl border ${urgent ? 'border-red-300 dark:border-red-700' : 'border-gray-200 dark:border-slate-700'} p-5 shadow-sm space-y-4`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-bold dark:text-white">{item.title || item.credentialType}</h4>
            {urgent && <span className="text-[10px] font-bold bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded-full">URGENT</span>}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 capitalize">
            {(item.credentialType || item.type || '').replace(/_/g, ' ')}
          </p>
        </div>
        <span className="text-[10px] font-mono text-gray-400 dark:text-gray-500 flex-shrink-0">{item.credentialId}</span>
      </div>

      {/* Worker info grid */}
      <div className="grid grid-cols-2 gap-2 p-3 bg-gray-50 dark:bg-slate-900 rounded-xl text-xs">
        <div>
          <p className="text-[10px] text-gray-400 uppercase tracking-wide">Holder</p>
          <p className="font-semibold dark:text-white truncate">{item.holderName || item.holderCnic || '—'}</p>
        </div>
        <div>
          <p className="text-[10px] text-gray-400 uppercase tracking-wide">CNIC</p>
          <p className="font-mono font-semibold dark:text-white">{item.holderCnic || '—'}</p>
        </div>
        <div>
          <p className="text-[10px] text-gray-400 uppercase tracking-wide">Submitted</p>
          <p className="font-semibold dark:text-white">{fmtDate(item.createdAt)}</p>
        </div>
        <div>
          <p className="text-[10px] text-gray-400 uppercase tracking-wide">Wait time</p>
          <p className={`font-semibold ${urgent ? 'text-red-600 dark:text-red-400' : 'dark:text-white'}`}>
            {waitHours !== null ? `${waitHours}h` : '—'}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button onClick={() => onApprove(item.credentialId || item.requestId)}
          className="flex-1 py-2.5 text-xs font-bold bg-green-600 hover:bg-green-700 text-white rounded-xl transition-colors flex items-center justify-center gap-1.5">
          <span>✓</span> Approve
        </button>
        <button onClick={() => onReject(item.credentialId || item.requestId, item.title)}
          className="flex-1 py-2.5 text-xs font-bold bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 rounded-xl border border-red-200 dark:border-red-800 transition-colors flex items-center justify-center gap-1.5">
          <span>✕</span> Reject
        </button>
      </div>
    </div>
  );
}

// ── Issued Credential Row ─────────────────────────────────────────────────────
function IssuedRow({ cred, onRevoke }) {
  const status = cred.status || cred.credentialStatus;
  return (
    <div className="flex items-center gap-3 p-3 bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-600 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold dark:text-white truncate">{cred.title || cred.credentialType}</p>
        <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 font-mono">{cred.credentialId}</p>
        <p className="text-[10px] text-gray-400 dark:text-gray-500">{fmtDate(cred.issuanceDate || cred.validFrom || cred.createdAt)}</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_PILL[status] || STATUS_PILL['ACTIVE']}`}>
          {status || 'ACTIVE'}
        </span>
        {(status === 'ACTIVE' || status === 'active') && (
          <button onClick={() => onRevoke(cred.credentialId)}
            className="text-[10px] font-semibold text-red-500 hover:text-red-700 dark:hover:text-red-400 px-2 py-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
            Revoke
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function IssuerDashboard() {
  const { user } = useAuth();
  const [tab, setTab] = useState('dashboard');
  const [stats, setStats] = useState({ pending: 0, issued: 0, revoked: 0, avgTurnaround: '—' });
  const [queue, setQueue] = useState([]);
  const [issued, setIssued] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [issuerInfo, setIssuerInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  // Reject modal
  const [confirmAllModal, setConfirmAllModal] = useState(false);
  const [rejectModal, setRejectModal] = useState({ open: false, id: null, title: '', reason: '' });
  // Revoke modal
  const [revokeModal, setRevokeModal] = useState({ open: false, id: null, reason: '' });
  // Credential detail modal
  const [detailModal, setDetailModal] = useState({ open: false, cred: null });

  // Bulk upload
  const [dragOver, setDragOver] = useState(false);
  const [bulkFile, setBulkFile] = useState(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResults, setBulkResults] = useState(null);
  const dropRef = useRef(null);

  // Settings form
  const [settings, setSettings] = useState({ issuerName: '', issuerDid: '', contactEmail: '', website: '', logo: '' });
  const [settingsSaving, setSettingsSaving] = useState(false);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [queueRes, issuedRes, analyticsRes, issuerRes] = await Promise.all([
        api.get('/registry/verification-requests', { params: { limit: 100 } }).catch(() => ({ data: { requests: [] } })),
        api.get('/registry/search/credentials', { params: { limit: 200 } }).catch(() => ({ data: { credentials: [] } })),
        api.get('/registry/analytics/overview').catch(() => ({ data: {} })),
        api.get('/registry/issuers').catch(() => ({ data: [] })),
      ]);

      const queueData = queueRes.data.requests || [];
      const issuedData = issuedRes.data.credentials || [];
      const myIssuer = Array.isArray(issuerRes.data)
        ? issuerRes.data.find(i => i.userId === user?._id || i.contactEmail === user?.email)
        : null;

      setQueue(queueData);
      setIssued(issuedData);
      setAnalytics(analyticsRes.data);
      setIssuerInfo(myIssuer);
      setSettings({
        issuerName: myIssuer?.issuerName || user?.organization || '',
        issuerDid: myIssuer?.issuerDid || '',
        contactEmail: myIssuer?.contactEmail || user?.email || '',
        website: myIssuer?.website || '',
        logo: myIssuer?.logo || '',
      });
      setStats({
        pending: queueData.length,
        issued: issuedData.filter(c => c.status === 'ACTIVE' || c.status === 'active').length,
        revoked: issuedData.filter(c => c.status === 'REVOKED' || c.status === 'revoked').length,
        avgTurnaround: analyticsRes.data?.avgProcessingDays ? `${analyticsRes.data.avgProcessingDays}d` : '2.3d',
      });

      // Load issuer-specific analytics if we have an issuer ID
      if (myIssuer?._id || myIssuer?.issuerId) {
        const id = myIssuer._id || myIssuer.issuerId;
        api.get(`/registry/analytics/issuers/${id}/stats`).then(r => {
          setAnalytics(prev => ({ ...prev, issuerStats: r.data }));
        }).catch(() => {});
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Approve ────────────────────────────────────────────────────────────────
  const handleApprove = async (id) => {
    try {
      await api.put(`/registry/verification-requests/${id}/approve`);
      toast.success('Credential approved and issued');
      setQueue(q => q.filter(r => (r.credentialId || r.requestId) !== id));
      setStats(s => ({ ...s, pending: s.pending - 1, issued: s.issued + 1 }));
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Approval failed');
    }
  };

  // ── Reject ────────────────────────────────────────────────────────────────
  const openReject = (id, title) => setRejectModal({ open: true, id, title, reason: '' });

  const confirmReject = async () => {
    if (!rejectModal.reason.trim()) { toast.error('Please enter a reason'); return; }
    try {
      await api.put(`/registry/verification-requests/${rejectModal.id}/reject`, { reason: rejectModal.reason });
      toast.success('Credential rejected');
      setQueue(q => q.filter(r => (r.credentialId || r.requestId) !== rejectModal.id));
      setStats(s => ({ ...s, pending: s.pending - 1 }));
      setRejectModal({ open: false, id: null, title: '', reason: '' });
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Rejection failed');
    }
  };

  // ── Revoke ────────────────────────────────────────────────────────────────
  const openRevoke = (id) => setRevokeModal({ open: true, id, reason: '' });

  const confirmRevoke = async () => {
    if (!revokeModal.reason.trim()) { toast.error('Please enter a revocation reason'); return; }
    try {
      await api.post(`/registry/credentials/${revokeModal.id}/revoke`, { reason: revokeModal.reason });
      toast.success('Credential revoked');
      setIssued(prev => prev.map(c => c.credentialId === revokeModal.id ? { ...c, status: 'REVOKED' } : c));
      setRevokeModal({ open: false, id: null, reason: '' });
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Revocation failed');
    }
  };

  // ── Bulk Upload ────────────────────────────────────────────────────────────
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) setBulkFile(file);
  }, []);

  const handleBulkUpload = async () => {
    if (!bulkFile) { toast.error('Select a file first'); return; }
    setBulkLoading(true);
    setBulkResults(null);
    try {
      let data;
      const text = await bulkFile.text();
      if (bulkFile.name.endsWith('.json')) {
        data = JSON.parse(text);
      } else {
        toast.error('Only JSON files are supported currently');
        return;
      }
      const res = await api.post('/registry/bulk/credentials', { credentials: Array.isArray(data) ? data : [data] });
      setBulkResults(res.data);
      toast.success(`Processed ${res.data.success || 0} credentials`);
      loadAll();
    } catch (err) {
      toast.error(err?.response?.data?.error || err.message || 'Upload failed');
    } finally {
      setBulkLoading(false);
    }
  };

  // ── Settings Save ──────────────────────────────────────────────────────────
  const saveSettings = async () => {
    if (!issuerInfo?._id && !issuerInfo?.issuerId) {
      toast.error('No issuer profile found');
      return;
    }
    setSettingsSaving(true);
    const id = issuerInfo._id || issuerInfo.issuerId;
    try {
      await api.put(`/registry/issuers/${id}`, settings);
      toast.success('Settings saved');
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Save failed');
    } finally {
      setSettingsSaving(false);
    }
  };

  // ── Filtered issued ────────────────────────────────────────────────────────
  const filteredIssued = issued.filter(c =>
    !search || (c.title || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.credentialId || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.credentialType || '').toLowerCase().includes(search.toLowerCase())
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black dark:text-white">Issuer Dashboard</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{user?.organization || 'Credential Registry'}</p>
        </div>
        <button onClick={loadAll} disabled={loading}
          className="px-3 py-2 text-xs font-semibold bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 rounded-xl hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors flex items-center gap-1.5">
          {loading ? <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin inline-block" /> : '↻'}
          Refresh
        </button>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {TABS.map(({ key, icon, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl whitespace-nowrap transition-colors ${
              tab === key
                ? 'bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-900'
                : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-slate-700'
            }`}>
            <span>{icon}</span>
            <span>{label}</span>
            {key === 'queue' && stats.pending > 0 && (
              <span className="ml-0.5 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center">{stats.pending}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Dashboard Tab ──────────────────────────────────────────────────── */}
      {tab === 'dashboard' && (
        <div className="space-y-5">
          {/* KPI Row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Pending Review"    value={stats.pending}  icon="⏳" color="amber" />
            <StatCard label="Active Credentials" value={stats.issued}  icon="✅" color="green" />
            <StatCard label="Revoked"            value={stats.revoked} icon="🚫" color="red" />
            <StatCard label="Avg Turnaround"     value={stats.avgTurnaround} icon="⏱" color="blue" />
          </div>

          {/* Pending queue preview */}
          {queue.length > 0 && (
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-amber-200 dark:border-amber-700/50 overflow-hidden">
              <div className="px-5 py-3 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-700/50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm">⏳</span>
                  <span className="text-sm font-bold text-amber-800 dark:text-amber-300">Pending Approval</span>
                  <span className="text-[10px] bg-amber-600 text-white font-bold px-1.5 py-0.5 rounded-full">{queue.length}</span>
                </div>
                <button onClick={() => setTab('queue')}
                  className="text-xs font-semibold text-amber-700 dark:text-amber-400 hover:underline">
                  View all →
                </button>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-slate-700">
                {queue.slice(0, 3).map(r => (
                  <div key={r.credentialId || r.requestId} className="px-5 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-bold dark:text-white truncate">{r.title || r.credentialType}</p>
                      <p className="text-[10px] text-gray-400">{fmtTime(r.createdAt)}</p>
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      <button onClick={() => handleApprove(r.credentialId || r.requestId)}
                        className="px-3 py-1 text-[10px] font-bold bg-green-600 text-white rounded-lg hover:bg-green-700">✓</button>
                      <button onClick={() => openReject(r.credentialId || r.requestId, r.title)}
                        className="px-3 py-1 text-[10px] font-bold bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-200">✕</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent issued */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700">
            <div className="px-5 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
              <span className="text-sm font-bold dark:text-white">Recently Issued</span>
              <button onClick={() => setTab('issued')} className="text-xs font-semibold text-blue-600 hover:underline">View all →</button>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-slate-700">
              {issued.slice(0, 5).map(c => (
                <div key={c.credentialId || c._id} className="px-5 py-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold dark:text-white truncate">{c.title || c.credentialType}</p>
                    <p className="text-[10px] text-gray-400 font-mono">{c.credentialId}</p>
                  </div>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${STATUS_PILL[c.status] || STATUS_PILL['ACTIVE']}`}>
                    {c.status || 'ACTIVE'}
                  </span>
                </div>
              ))}
              {issued.length === 0 && (
                <div className="py-8 text-center text-sm text-gray-400">No credentials issued yet</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Queue Tab ──────────────────────────────────────────────────────── */}
      {tab === 'queue' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold dark:text-white">Verification Queue</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">{queue.length} credential{queue.length !== 1 ? 's' : ''} awaiting review</p>
            </div>
            {queue.length > 1 && (
              <button
                onClick={() => setConfirmAllModal(true)}
                className="px-4 py-2 text-xs font-bold bg-green-600 text-white rounded-xl hover:bg-green-700">
                Approve All ({queue.length})
              </button>
            )}
          </div>

          {queue.length === 0 ? (
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 py-16 text-center">
              <div className="text-4xl mb-3">🎉</div>
              <p className="text-base font-bold dark:text-white">Queue is clear!</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">No pending verifications</p>
            </div>
          ) : (
            <div className="space-y-3">
              {queue.map(r => (
                <QueueCard
                  key={r.credentialId || r.requestId}
                  item={r}
                  onApprove={handleApprove}
                  onReject={openReject}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Issued Tab ─────────────────────────────────────────────────────── */}
      {tab === 'issued' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by title, ID, or type..."
                className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
              />
            </div>
            <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">{filteredIssued.length} result{filteredIssued.length !== 1 ? 's' : ''}</span>
          </div>

          {filteredIssued.length === 0 ? (
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 py-12 text-center">
              <p className="text-sm text-gray-500">{search ? 'No matches found' : 'No credentials issued yet'}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredIssued.map(c => (
                <IssuedRow
                  key={c.credentialId || c._id}
                  cred={c}
                  onRevoke={openRevoke}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Bulk Upload Tab ─────────────────────────────────────────────────── */}
      {tab === 'bulk' && (
        <div className="space-y-5">
          <div>
            <h3 className="text-base font-bold dark:text-white">Bulk Credential Upload</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Upload a JSON array of credential objects</p>
          </div>

          {/* Drop zone */}
          <div
            ref={dropRef}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`relative border-2 border-dashed rounded-2xl p-10 text-center transition-colors cursor-pointer ${
              dragOver
                ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
                : 'border-gray-300 dark:border-slate-600 bg-gray-50 dark:bg-slate-800/50 hover:border-blue-300'
            }`}
            onClick={() => document.getElementById('bulk-file-input').click()}
          >
            <input id="bulk-file-input" type="file" accept=".json" className="hidden"
              onChange={e => setBulkFile(e.target.files[0])} />
            <div className="text-4xl mb-3">{bulkFile ? '📄' : '📤'}</div>
            {bulkFile ? (
              <>
                <p className="text-sm font-bold dark:text-white">{bulkFile.name}</p>
                <p className="text-xs text-gray-500 mt-1">{(bulkFile.size / 1024).toFixed(1)} KB</p>
                <button
                  onClick={(e) => { e.stopPropagation(); setBulkFile(null); setBulkResults(null); }}
                  className="mt-3 text-xs text-red-500 hover:underline">
                  Remove file
                </button>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold dark:text-white">Drop JSON file here</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">or click to browse</p>
                <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-3">Accepted: .json — Array of credential objects</p>
              </>
            )}
          </div>

          {bulkFile && (
            <button onClick={handleBulkUpload} disabled={bulkLoading}
              className="w-full py-3 text-sm font-bold bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-900 rounded-xl hover:bg-slate-700 dark:hover:bg-white disabled:opacity-60 transition-colors flex items-center justify-center gap-2">
              {bulkLoading
                ? <><span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> Processing...</>
                : <><span>📦</span> Upload &amp; Process</>
              }
            </button>
          )}

          {/* Results */}
          {bulkResults && (
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 dark:border-slate-700">
                <h4 className="text-sm font-bold dark:text-white">Upload Results</h4>
              </div>
              <div className="p-5">
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="text-center p-3 bg-gray-50 dark:bg-slate-900 rounded-xl">
                    <p className="text-2xl font-black text-gray-900 dark:text-white">{bulkResults.total || 0}</p>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wide mt-1">Total</p>
                  </div>
                  <div className="text-center p-3 bg-green-50 dark:bg-green-900/20 rounded-xl">
                    <p className="text-2xl font-black text-green-600 dark:text-green-400">{bulkResults.success || 0}</p>
                    <p className="text-[10px] text-green-600 uppercase tracking-wide mt-1">Success</p>
                  </div>
                  <div className="text-center p-3 bg-red-50 dark:bg-red-900/20 rounded-xl">
                    <p className="text-2xl font-black text-red-600 dark:text-red-400">{bulkResults.failed || 0}</p>
                    <p className="text-[10px] text-red-600 uppercase tracking-wide mt-1">Failed</p>
                  </div>
                </div>

                {/* Success bar */}
                {(bulkResults.total || 0) > 0 && (
                  <div className="mb-4">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>Success rate</span>
                      <span>{Math.round(((bulkResults.success || 0) / bulkResults.total) * 100)}%</span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-2">
                      <div className="bg-green-500 h-2 rounded-full transition-all duration-700"
                           style={{ width: `${Math.round(((bulkResults.success || 0) / bulkResults.total) * 100)}%` }} />
                    </div>
                  </div>
                )}

                {/* Errors */}
                {bulkResults.errors?.length > 0 && (
                  <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3 max-h-48 overflow-y-auto">
                    <p className="text-xs font-bold text-red-700 dark:text-red-400 mb-2">Errors</p>
                    {bulkResults.errors.map((e, i) => (
                      <p key={i} className="text-[10px] text-red-600 dark:text-red-400 py-0.5">Row {e.row}: {e.error}</p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Analytics Tab ──────────────────────────────────────────────────── */}
      {tab === 'analytics' && (
        <div className="space-y-5">
          <h3 className="text-base font-bold dark:text-white">Issuance Analytics</h3>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard label="Total Issued"  value={analytics?.totalCredentials || issued.length} icon="📄" color="blue" />
            <StatCard label="Verifications" value={analytics?.totalVerifications || 0} icon="🔍" color="purple" />
            <StatCard label="Avg Issue Time" value={stats.avgTurnaround} icon="⏱" color="amber" />
          </div>

          {/* By type */}
          {(analytics?.credentialsByType || []).length > 0 && (
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-5">
              <h4 className="text-sm font-bold dark:text-white mb-4">By Credential Type</h4>
              <BarChart
                data={analytics.credentialsByType}
                nameKey="_id"
                valueKey="count"
                colorClass="bg-blue-500"
              />
            </div>
          )}

          {/* By status — computed from local issued data */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-5">
            <h4 className="text-sm font-bold dark:text-white mb-4">By Status</h4>
            <BarChart
              data={[
                { _id: 'Active',   count: issued.filter(c => c.status === 'ACTIVE'  || c.status === 'active').length },
                { _id: 'Pending',  count: queue.length },
                { _id: 'Revoked',  count: issued.filter(c => c.status === 'REVOKED' || c.status === 'revoked').length },
                { _id: 'Expired',  count: issued.filter(c => c.status === 'EXPIRED' || c.status === 'expired').length },
              ].filter(d => d.count > 0)}
              nameKey="_id"
              valueKey="count"
              colorClass="bg-indigo-500"
            />
          </div>

          {/* Issuer-specific stats */}
          {analytics?.issuerStats && (
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-5">
              <h4 className="text-sm font-bold dark:text-white mb-4">Issuer Performance</h4>
              <div className="grid grid-cols-2 gap-3">
                {[
                  ['Total Issued', analytics.issuerStats.totalIssued],
                  ['Verifications', analytics.issuerStats.totalVerifications],
                  ['Avg Verify Time', analytics.issuerStats.avgVerifyTime],
                  ['Revocation Rate', analytics.issuerStats.revocationRate ? `${analytics.issuerStats.revocationRate}%` : '0%'],
                ].map(([label, value]) => (
                  <div key={label} className="bg-gray-50 dark:bg-slate-900 rounded-xl p-3 text-center">
                    <p className="text-lg font-black dark:text-white">{value ?? '—'}</p>
                    <p className="text-[10px] text-gray-500 mt-0.5">{label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!analytics && (
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 py-12 text-center">
              <p className="text-sm text-gray-500">No analytics data available yet</p>
            </div>
          )}
        </div>
      )}

      {/* ── Settings Tab ──────────────────────────────────────────────────── */}
      {tab === 'settings' && (
        <div className="space-y-5">
          <h3 className="text-base font-bold dark:text-white">Issuer Settings</h3>

          {/* Account info */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-5 space-y-4">
            <h4 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Account</h4>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <p className="text-gray-400">Role</p>
                <p className="font-semibold dark:text-white capitalize">{user?.role}</p>
              </div>
              <div>
                <p className="text-gray-400">Email</p>
                <p className="font-semibold dark:text-white">{user?.email}</p>
              </div>
              <div>
                <p className="text-gray-400">Issuer Status</p>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_PILL[issuerInfo?.status || 'ACTIVE']}`}>
                  {issuerInfo?.status || 'ACTIVE'}
                </span>
              </div>
              <div>
                <p className="text-gray-400">Issuer ID</p>
                <p className="font-mono text-[10px] dark:text-white break-all">{issuerInfo?.issuerId || issuerInfo?._id || '—'}</p>
              </div>
            </div>
          </div>

          {/* Editable fields */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-5 space-y-4">
            <h4 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Profile</h4>
            {[
              { key: 'issuerName',    label: 'Institution Name', placeholder: 'SBBU, TEVTA, etc.' },
              { key: 'contactEmail',  label: 'Contact Email',     placeholder: 'admin@institution.edu.pk' },
              { key: 'website',       label: 'Website',           placeholder: 'https://institution.edu.pk' },
              { key: 'logo',          label: 'Logo URL',          placeholder: 'https://...' },
            ].map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">{label}</label>
                <input
                  type="text"
                  value={settings[key] || ''}
                  onChange={e => setSettings(s => ({ ...s, [key]: e.target.value }))}
                  placeholder={placeholder}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-slate-600 rounded-xl bg-gray-50 dark:bg-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                />
              </div>
            ))}

            {/* DID (read-only) */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">DID (auto-assigned)</label>
              <input readOnly value={settings.issuerDid || 'Not yet assigned'}
                className="w-full px-3 py-2.5 text-xs font-mono border border-gray-200 dark:border-slate-600 rounded-xl bg-gray-100 dark:bg-slate-900/50 text-gray-500 dark:text-gray-400 outline-none cursor-default" />
            </div>

            <button onClick={saveSettings} disabled={settingsSaving}
              className="w-full py-3 text-sm font-bold bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-900 rounded-xl hover:bg-slate-700 dark:hover:bg-white disabled:opacity-60 transition-colors">
              {settingsSaving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>
      )}

      {/* ── Confirm Approve All Modal ──────────────────────────────────────── */}
      <Modal open={confirmAllModal} title="Approve All Credentials" onClose={() => setConfirmAllModal(false)}>
        <div className="space-y-4">
          <div className="flex gap-3 p-3 bg-green-50 dark:bg-green-900/20 rounded-xl">
            <span className="text-xl">✅</span>
            <p className="text-xs text-green-700 dark:text-green-300">
              This will approve all <strong>{queue.length}</strong> pending credential{queue.length !== 1 ? 's' : ''} in the queue. Each will be issued and blockchain-anchored.
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setConfirmAllModal(false)}
              className="flex-1 py-2.5 text-sm font-semibold bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-300 rounded-xl">
              Cancel
            </button>
            <button onClick={() => {
              setConfirmAllModal(false);
              queue.forEach(r => handleApprove(r.credentialId || r.requestId));
            }}
              className="flex-1 py-2.5 text-sm font-bold bg-green-600 text-white rounded-xl hover:bg-green-700">
              Approve All {queue.length}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Reject Modal ───────────────────────────────────────────────────── */}
      <Modal open={rejectModal.open} title="Reject Credential" onClose={() => setRejectModal(m => ({ ...m, open: false }))}>
        <div className="space-y-4">
          {rejectModal.title && (
            <div className="p-3 bg-gray-50 dark:bg-slate-900 rounded-xl">
              <p className="text-xs text-gray-500 dark:text-gray-400">Credential</p>
              <p className="text-sm font-semibold dark:text-white">{rejectModal.title}</p>
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
              Rejection Reason <span className="text-red-500">*</span>
            </label>
            <textarea
              value={rejectModal.reason}
              onChange={e => setRejectModal(m => ({ ...m, reason: e.target.value }))}
              rows={3}
              placeholder="e.g. Supporting documents incomplete, criteria not met..."
              className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-slate-600 rounded-xl bg-gray-50 dark:bg-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500 resize-none"
              autoFocus
            />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setRejectModal(m => ({ ...m, open: false }))}
              className="flex-1 py-2.5 text-sm font-semibold bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-200 dark:hover:bg-slate-600">
              Cancel
            </button>
            <button onClick={confirmReject}
              className="flex-1 py-2.5 text-sm font-bold bg-red-600 text-white rounded-xl hover:bg-red-700">
              Confirm Reject
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Revoke Modal ───────────────────────────────────────────────────── */}
      <Modal open={revokeModal.open} title="Revoke Credential" onClose={() => setRevokeModal(m => ({ ...m, open: false }))}>
        <div className="space-y-4">
          <div className="flex gap-3 p-3 bg-red-50 dark:bg-red-900/20 rounded-xl">
            <span className="text-xl">⚠️</span>
            <p className="text-xs text-red-700 dark:text-red-300">
              Revoking a credential is permanent and will be recorded on the blockchain. The holder will be notified.
            </p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
              Revocation Reason <span className="text-red-500">*</span>
            </label>
            <textarea
              value={revokeModal.reason}
              onChange={e => setRevokeModal(m => ({ ...m, reason: e.target.value }))}
              rows={3}
              placeholder="e.g. Fraudulent documents submitted, issuer error..."
              className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-slate-600 rounded-xl bg-gray-50 dark:bg-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500 resize-none"
              autoFocus
            />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setRevokeModal(m => ({ ...m, open: false }))}
              className="flex-1 py-2.5 text-sm font-semibold bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-300 rounded-xl">
              Cancel
            </button>
            <button onClick={confirmRevoke}
              className="flex-1 py-2.5 text-sm font-bold bg-red-600 text-white rounded-xl hover:bg-red-700">
              Revoke Credential
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
