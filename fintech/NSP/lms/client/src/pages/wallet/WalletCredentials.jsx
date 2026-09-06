import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useLang } from '../../context/LangContext';
import toast from 'react-hot-toast';

// Types cover both the registry (UPPER_SNAKE) and legacy (hyphen-case) credential models.
const TABS = [
  { key: 'identity', label: 'Identity & Authorization', types: ['IDENTITY_VERIFICATION', 'MIGRATION_RECORD'], icon: '🪪' },
  { key: 'education', label: 'Education', types: ['ACADEMIC'], icon: '🎓' },
  { key: 'skills', label: 'Skills & Trade', types: ['TVET', 'RPL', 'TRADE_CERTIFICATE', 'RPL_CERTIFICATE', 'GULF_READINESS'], icon: '🔧' },
  { key: 'licenses', label: 'Professional Licenses', types: ['PROFESSIONAL_LICENSE'], icon: '📋' },
  { key: 'training', label: 'Training & Micro', types: ['TRAINING_RECORD', 'MICRO_CREDENTIAL', 'SELF_DECLARED'], icon: '📚' },
  { key: 'employment', label: 'Employment', types: ['EMPLOYER_ENDORSEMENT', 'HEALTH_CLEARANCE', 'SAFETY_CARD'], icon: '💼' },
];

// Canonicalise a credential type (uppercase, hyphens/spaces → underscore) so
// registry (IDENTITY_VERIFICATION) and legacy (trade-certificate) both match.
const normType = (s) => (s || '').toUpperCase().replace(/[-\s]+/g, '_');

const STATUS_BADGE = {
  ACTIVE: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  active: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  PENDING_VERIFICATION: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  EXPIRED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  expired: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  REVOKED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  revoked: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  SUSPENDED: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
};

const STATUS_SIMPLE = {
  ACTIVE: { icon: '✅', color: 'bg-green-500', label: 'Active' },
  active: { icon: '✅', color: 'bg-green-500', label: 'Active' },
  PENDING_VERIFICATION: { icon: '⏳', color: 'bg-amber-400', label: 'Pending' },
  EXPIRED: { icon: '❌', color: 'bg-red-500', label: 'Expired' },
  expired: { icon: '❌', color: 'bg-red-500', label: 'Expired' },
  REVOKED: { icon: '⚠️', color: 'bg-red-600', label: 'Revoked' },
  revoked: { icon: '⚠️', color: 'bg-red-600', label: 'Revoked' },
  SELF_DECLARED: { icon: '📝', color: 'bg-blue-400', label: 'Self-Declared' },
};

const VERIFICATION_BADGE = {
  SOURCE_VERIFIED: { icon: '🛡️', color: 'text-green-600', label: 'Source Verified' },
  PLATFORM_VERIFIED: { icon: '🔵', color: 'text-blue-600', label: 'Platform Verified' },
  SELF_DECLARED: { icon: '🟠', color: 'text-orange-500', label: 'Self-Declared' },
  VERIFICATION_FAILED: { icon: '🔴', color: 'text-red-600', label: 'Verification Failed' },
};

export default function WalletCredentials() {
  const { t } = useLang();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('identity');
  const [credentials, setCredentials] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [verificationHistory, setVerificationHistory] = useState({}); // credentialId → logs
  const [loading, setLoading] = useState(true);
  const simpleMode = localStorage.getItem('tl_simple_mode') === 'true';
  const [selectedCategory, setSelectedCategory] = useState(null); // for simple mode drill-down

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get('/credentials', { params: { limit: 100 } }).catch(() => ({ data: { credentials: [] } })),
      api.get('/registry/credentials', { params: { limit: 200 } }).catch(() => ({ data: { credentials: [] } })),
    ]).then(([legacyRes, registryRes]) => {
      const all = [
        ...(legacyRes.data.credentials || []).map(c => ({ ...c, _source: 'legacy' })),
        ...(registryRes.data.credentials || []).map(c => ({ ...c, _source: 'registry' })),
      ];
      setCredentials(all);
    }).finally(() => setLoading(false));
  }, []);

  const getCredsForTab = (tabKey) => {
    const tab = TABS.find(t => t.key === tabKey);
    if (!tab) return [];
    const tabTypes = new Set(tab.types.map(normType));
    return credentials.filter(c => tabTypes.has(normType(c.credentialType || c.type)));
  };

  const loadVerificationHistory = async (credentialId) => {
    if (verificationHistory[credentialId]) return; // already loaded
    try {
      // Query verification logs for this specific credential via registry endpoint
      const res = await api.get(`/registry/credentials/${credentialId}/history`, { params: { limit: 5 } });
      const logs = (res.data || []).map(v => ({
        result: v.verificationResult,
        verifierType: v.verifierType?.replace(/_/g, ' ') || 'Unknown',
        location: v.geolocation?.city ? `${v.geolocation.city}, ${v.geolocation.country}` : v.geolocation?.country || '',
        date: v.createdAt,
      }));
      setVerificationHistory(prev => ({ ...prev, [credentialId]: logs }));
    } catch {
      setVerificationHistory(prev => ({ ...prev, [credentialId]: [] }));
    }
  };

  // Registry credentials (self-submitted → verified) are rendered by the registry
  // routes; legacy issued credentials by the credentials routes. Route by _source.
  const downloadUrl = (cred, kind) =>
    cred._source === 'registry'
      ? `/registry/credentials/${cred.credentialId}/${kind}`
      : `/credentials/${cred._id}/${kind}`;

  const downloadBlob = async (cred, kind, suffix, failMsg) => {
    const tid = toast.loading('Preparing download…');
    try {
      const res = await api.get(downloadUrl(cred, kind), { responseType: 'blob' });
      // Force the correct MIME so the browser treats it as a real PDF download.
      const blob = res.data instanceof Blob ? res.data : new Blob([res.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${cred.credentialId || cred._id}${suffix}.pdf`;
      a.rel = 'noopener';
      a.style.display = 'none';
      // Firefox only initiates the download when the anchor is in the DOM —
      // a detached element's .click() is silently ignored there.
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
      toast.success('Download ready', { id: tid });
    } catch {
      toast.error(failMsg, { id: tid });
    }
  };

  const downloadPdf = (cred) => downloadBlob(cred, 'pdf', '', 'Certificate download failed');
  const downloadCard = (cred) => downloadBlob(cred, 'card', '-card', 'Card download failed');

  // ── Simple Mode ───────────────────────────────────────────────
  if (simpleMode) {
    // Drill-down: show credentials for a selected category
    if (selectedCategory) {
      const tab = TABS.find(t => t.key === selectedCategory);
      const creds = getCredsForTab(selectedCategory);
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <button onClick={() => setSelectedCategory(null)} className="text-3xl">⬅️</button>
            <h3 className="text-xl font-bold dark:text-white">{tab?.icon} {t(tab?.label)}</h3>
          </div>
          {creds.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-5xl mb-4">📭</p>
              <p className="text-lg font-semibold dark:text-white">{t('No credentials here')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {creds.map(cred => {
                const status = cred.status || 'ACTIVE';
                const s = STATUS_SIMPLE[status] || STATUS_SIMPLE.PENDING_VERIFICATION;
                return (
                  <div key={cred._id || cred.credentialId}
                    className={`rounded-2xl p-5 border-2 ${s.color === 'bg-green-500' ? 'border-green-300 bg-green-50 dark:bg-green-900/20' : s.color === 'bg-red-500' || s.color === 'bg-red-600' ? 'border-red-300 bg-red-50 dark:bg-red-900/20' : 'border-amber-300 bg-amber-50 dark:bg-amber-900/20'}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-4xl">{s.icon}</span>
                      <div className="flex-1">
                        <p className="text-base font-bold dark:text-white">{cred.title}</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{cred.issuerName || cred.institution}</p>
                      </div>
                    </div>
                    <p className="mt-3 text-sm font-semibold" style={{ color: s.color.replace('bg-', '#').replace('-500', '').replace('-400', '').replace('-600', '') }}>
                      {s.label}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    // Simple Mode: Category grid
    return (
      <div className="space-y-4">
        <h3 className="text-xl font-bold dark:text-white">{t('My Credentials')}</h3>
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {TABS.map(tab => {
              const count = getCredsForTab(tab.key).length;
              return (
                <button
                  key={tab.key}
                  onClick={() => setSelectedCategory(tab.key)}
                  className="bg-white dark:bg-slate-800 rounded-2xl p-5 border-2 border-gray-100 dark:border-slate-700 hover:border-blue-300 transition-colors text-center"
                >
                  <span className="text-4xl block mb-2">{tab.icon}</span>
                  <p className="text-sm font-bold dark:text-white">{t(tab.label.split(' ')[0])}</p>
                  <span className="mt-2 inline-block bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-lg font-bold px-3 py-0.5 rounded-full">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── Standard Mode ─────────────────────────────────────────────
  const activeTabConfig = TABS.find(t => t.key === activeTab);
  const filtered = getCredsForTab(activeTab);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-bold dark:text-white">{t('My Credentials')}</h3>
        <button onClick={() => navigate('/credentials')}
          className="px-3 py-1.5 text-xs font-bold bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          + {t('Add credential')}
        </button>
      </div>

      {/* Tab Bar */}
      <div className="flex overflow-x-auto gap-1 pb-1 -mx-1 px-1">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-2 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors flex-shrink-0 ${
              activeTab === tab.key
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200'
            }`}
          >
            {t(activeTabConfig?.label === tab.label ? tab.label : tab.label)}
          </button>
        ))}
      </div>

      {/* Credential Cards */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-10 px-4 bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700">
          <p className="text-3xl mb-2">{activeTabConfig?.icon || '📁'}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            {t('No credentials in this category yet.')}
          </p>
          <div className="flex flex-wrap gap-2 justify-center">
            <button onClick={() => navigate('/credentials')}
              className="px-4 py-2 text-xs font-bold bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              + {t('Add a credential')}
            </button>
            <button onClick={() => navigate('/documents')}
              className="px-4 py-2 text-xs font-bold border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700">
              📄 {t('Upload a document')}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(cred => {
            const status = cred.status || 'ACTIVE';
            const verStatus = cred.verificationStatus || (cred.status === 'active' ? 'SOURCE_VERIFIED' : 'SELF_DECLARED');
            const vBadge = VERIFICATION_BADGE[verStatus] || VERIFICATION_BADGE.SELF_DECLARED;
            const isExpanded = expandedId === (cred._id || cred.credentialId);

            return (
              <div
                key={cred._id || cred.credentialId}
                className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden"
              >
                {/* Card Header */}
                <button
                  onClick={() => {
                    const id = cred._id || cred.credentialId;
                    setExpandedId(isExpanded ? null : id);
                    if (!isExpanded && cred.credentialId) loadVerificationHistory(cred.credentialId);
                  }}
                  className="w-full p-4 text-left flex items-start gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-sm ${vBadge.color}`}>{vBadge.icon}</span>
                      <h4 className="text-sm font-bold dark:text-white truncate">{cred.title}</h4>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {cred.issuerName || cred.institution || 'Talent Ledger'}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-[10px] text-gray-400">
                        {cred.issuanceDate ? new Date(cred.issuanceDate).toLocaleDateString() : ''}
                        {cred.expiryDate && ` — ${new Date(cred.expiryDate).toLocaleDateString()}`}
                      </span>
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full uppercase ${STATUS_BADGE[status] || STATUS_BADGE.ACTIVE}`}>
                    {status.replace(/_/g, ' ')}
                  </span>
                </button>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-gray-100 dark:border-slate-700 pt-3 space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-gray-400">{t('Type')}:</span>
                        <span className="ml-1 dark:text-white font-medium">{cred.credentialType || cred.type}</span>
                      </div>
                      <div>
                        <span className="text-gray-400">{t('Verification')}:</span>
                        <span className={`ml-1 font-medium ${vBadge.color}`}>{vBadge.label}</span>
                      </div>
                      {cred.trade && (
                        <div>
                          <span className="text-gray-400">{t('Trade')}:</span>
                          <span className="ml-1 dark:text-white capitalize">{cred.trade?.replace(/-/g, ' ')}</span>
                        </div>
                      )}
                      {(cred.nqfLevel || cred.nqfLevel === 0) && (
                        <div>
                          <span className="text-gray-400">NQF:</span>
                          <span className="ml-1 dark:text-white">Level {cred.nqfLevel}</span>
                        </div>
                      )}
                      {cred.credentialId && (
                        <div className="col-span-2">
                          <span className="text-gray-400">{t('Credential ID')}:</span>
                          <span className="ml-1 font-mono text-[10px] dark:text-white">{cred.credentialId}</span>
                        </div>
                      )}
                      {cred.blockchainTxHash && (
                        <div className="col-span-2">
                          <span className="text-gray-400">{t('Blockchain')}:</span>
                          <span className="ml-1 font-mono text-[10px] text-green-600">{cred.blockchainTxHash.slice(0, 20)}...</span>
                        </div>
                      )}
                    </div>

                    {/* Verification History */}
                    {(() => {
                      const logs = verificationHistory[cred.credentialId];
                      if (!logs || logs.length === 0) return null;
                      return (
                        <div className="border-t border-gray-100 dark:border-slate-700 pt-3">
                          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">🔍 {t('Who verified this?')}</p>
                          <div className="space-y-1.5">
                            {logs.map((v, i) => (
                              <div key={i} className="flex items-center gap-2 text-xs">
                                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                                  v.result === 'VALID' ? 'bg-green-500' : v.result === 'NOT_FOUND' ? 'bg-gray-400' : 'bg-amber-400'
                                }`} />
                                <span className="text-gray-500 dark:text-gray-400 flex-1">{v.verifierType}{v.location ? ` · ${v.location}` : ''}</span>
                                <span className="text-gray-400">{new Date(v.date).toLocaleDateString()}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Actions */}
                    <div className="flex flex-wrap gap-2 pt-2">
                      <button
                        onClick={() => downloadPdf(cred)}
                        className="px-3 py-1.5 text-[11px] font-semibold bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-100"
                      >
                        📄 {t('Certificate PDF')}
                      </button>
                      <button
                        onClick={() => downloadCard(cred)}
                        className="px-3 py-1.5 text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 rounded-lg hover:bg-emerald-100"
                      >
                        🪪 {t('PVC Card')}
                      </button>
                      <button
                        onClick={() => {
                          const url = `${window.location.origin}/verify/${cred.credentialId || cred._id}`;
                          navigator.clipboard.writeText(url);
                          toast.success('Link copied');
                        }}
                        className="px-3 py-1.5 text-[11px] font-semibold bg-gray-50 dark:bg-slate-700 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-100"
                      >
                        {t('Share')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
