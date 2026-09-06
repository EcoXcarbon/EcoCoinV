import { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bar, Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend } from 'chart.js';
import api from '../api/client';
import { useLang } from '../context/LangContext';
import toast from 'react-hot-toast';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend);

const TABS = ['Talent Search', 'Shortlist', 'Verify Credential', 'Workforce Overview'];
const TRADES = [
  '', 'mason', 'electrician', 'welder', 'plumber', 'carpenter', 'steel-fixer', 'painter', 'hvac',
  'pipe-fitter', 'scaffolder', 'rigger', 'crane-operator', 'heavy-driver', 'shuttering-carpenter',
  'tile-fixer', 'duct-fabricator', 'auto-mechanic', 'diesel-mechanic', 'fabricator',
  'insulation-worker', 'heavy-equipment-operator', 'aluminium-fabricator', 'safety-officer',
  'cook', 'ac-technician',
];
const TRADE_COLORS = {
  mason: '#0072BC', electrician: '#C8952E', welder: '#7C3AED', plumber: '#0D9488',
  carpenter: '#EC4899', 'steel-fixer': '#DC2626', painter: '#15803D', hvac: '#D97706',
  'pipe-fitter': '#2563EB', scaffolder: '#9333EA', rigger: '#B91C1C', 'crane-operator': '#0369A1',
  'heavy-driver': '#4338CA', 'shuttering-carpenter': '#A16207', 'tile-fixer': '#059669',
  'duct-fabricator': '#7C3AED', 'auto-mechanic': '#6D28D9', 'diesel-mechanic': '#475569',
  fabricator: '#BE185D', 'insulation-worker': '#0891B2', 'heavy-equipment-operator': '#1D4ED8',
  'aluminium-fabricator': '#64748B', 'safety-officer': '#EA580C', cook: '#16A34A',
  'ac-technician': '#0284C7',
};

function getShortlist() {
  try { return JSON.parse(localStorage.getItem('tl-shortlist') || '[]'); } catch { return []; }
}
function setShortlistStorage(list) {
  localStorage.setItem('tl-shortlist', JSON.stringify(list));
}

const TAB_PARAM_MAP = { search: 0, shortlist: 1, verify: 2, overview: 3 };

export default function Employer() {
  const { t } = useLang();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(() => {
    const urlTab = searchParams.get('tab');
    return TAB_PARAM_MAP[urlTab] ?? 0;
  });

  // Talent Search state
  const [workers, setWorkers] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pages: 1 });
  const [search, setSearch] = useState('');
  const [tradeFilter, setTradeFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedWorker, setSelectedWorker] = useState(null);
  const [workerCredentials, setWorkerCredentials] = useState([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Shortlist state
  const [shortlist, setShortlist] = useState(getShortlist());
  const [shortlistedWorkers, setShortlistedWorkers] = useState([]);
  const [loadingShortlist, setLoadingShortlist] = useState(false);

  // Verification state
  const [verifyId, setVerifyId] = useState('');
  const [verifyResult, setVerifyResult] = useState(null);
  const [verifying, setVerifying] = useState(false);

  // Analytics state
  const [analytics, setAnalytics] = useState(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);

  // Load workers
  const loadWorkers = async (page = 1) => {
    setLoading(true);
    try {
      const params = { page, limit: 12 };
      if (search) params.search = search;
      if (tradeFilter) params.trade = tradeFilter;
      const { data } = await api.get('/workers', { params });
      setWorkers(data.workers);
      setPagination(data.pagination);
    } catch {
      toast.error(t('Failed to load workers'));
    } finally {
      setLoading(false);
    }
  };

  // Sync tab from URL search params
  useEffect(() => {
    const urlTab = searchParams.get('tab');
    if (urlTab && TAB_PARAM_MAP[urlTab] !== undefined) {
      setTab(TAB_PARAM_MAP[urlTab]);
    }
  }, [searchParams]);

  useEffect(() => {
    if (tab === 0) loadWorkers();
  }, [tab, tradeFilter]);

  // Load shortlisted workers
  useEffect(() => {
    if (tab === 1 && shortlist.length > 0) {
      setLoadingShortlist(true);
      Promise.all(shortlist.map(id =>
        api.get(`/workers/${id}`).then(r => r.data).catch(() => null)
      ))
        .then(results => setShortlistedWorkers(results.filter(Boolean)))
        .finally(() => setLoadingShortlist(false));
    }
  }, [tab, shortlist.length]);

  // Load analytics
  useEffect(() => {
    if (tab === 3 && !analytics) {
      setLoadingAnalytics(true);
      api.get('/analytics/employer')
        .then(r => setAnalytics(r.data))
        .catch(() => toast.error(t('Failed to load analytics')))
        .finally(() => setLoadingAnalytics(false));
    }
  }, [tab]);

  // Search handler
  const handleSearch = (e) => {
    e.preventDefault();
    loadWorkers(1);
  };

  // Worker detail
  const openWorkerDetail = async (workerId) => {
    setLoadingDetail(true);
    try {
      const [workerRes, credRes] = await Promise.all([
        api.get(`/workers/${workerId}`),
        api.get('/credentials', { params: { worker: workerId, limit: 50 } }),
      ]);
      setSelectedWorker(workerRes.data);
      setWorkerCredentials(credRes.data.credentials || []);
    } catch {
      toast.error(t('Failed to load worker details'));
    } finally {
      setLoadingDetail(false);
    }
  };

  // Shortlist toggle
  const toggleShortlist = (workerId) => {
    setShortlist(prev => {
      const next = prev.includes(workerId)
        ? prev.filter(id => id !== workerId)
        : [...prev, workerId];
      setShortlistStorage(next);
      return next;
    });
  };

  // Verify credential
  const handleVerify = async (e) => {
    e.preventDefault();
    if (!verifyId.trim()) return;
    setVerifying(true);
    setVerifyResult(null);
    try {
      const { data } = await api.get(`/verification/${verifyId.trim()}`);
      setVerifyResult(data);
    } catch (err) {
      setVerifyResult({ error: err.response?.data?.error || 'Credential not found' });
    } finally {
      setVerifying(false);
    }
  };

  const isShortlisted = (id) => shortlist.includes(id);

  // Status badge
  const StatusBadge = ({ status }) => {
    const colors = {
      certified: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
      assessed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
      employed: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
      registered: 'bg-gray-100 text-gray-600 dark:bg-gray-800/30 dark:text-gray-400',
    };
    return (
      <span className={`px-2 py-0.5 text-[11px] font-semibold rounded-full capitalize ${colors[status] || colors.registered}`}>
        {status}
      </span>
    );
  };

  // NQF level badge
  const NqfBadge = ({ level }) => (
    <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-ilo-blue/10 text-ilo-blue dark:bg-ilo-blue/20">
      NQF {level || 1}
    </span>
  );

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold dark:text-white">{t('Employer')}</h2>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-navy-light rounded-xl p-1 overflow-x-auto">
        {TABS.map((label, i) => (
          <button key={i} onClick={() => { setTab(i); setSelectedWorker(null); }}
            className={`px-4 py-2 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors ${
              tab === i ? 'bg-white dark:bg-navy-mid text-ilo-blue shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
            }`}>
            {t(label)}
            {i === 1 && shortlist.length > 0 && (
              <span className="ml-1.5 bg-ilo-blue text-white text-[10px] px-1.5 py-0.5 rounded-full">{shortlist.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ========== TAB 0: Talent Search ========== */}
      {tab === 0 && !selectedWorker && (
        <div className="space-y-4">
          {/* Search & Filters */}
          <form onSubmit={handleSearch} className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 relative">
                <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                  placeholder={t('Search by name or registration ID...')}
                  className="w-full pl-9 pr-4 py-2.5 text-sm border border-border dark:border-navy-light rounded-xl bg-white dark:bg-navy dark:text-white focus:ring-2 focus:ring-ilo-blue/30 focus:border-ilo-blue outline-none" />
                <svg className="absolute left-3 top-3 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
              </div>
              <select value={tradeFilter} onChange={e => setTradeFilter(e.target.value)}
                className="px-3 py-2.5 text-sm border border-border dark:border-navy-light rounded-xl bg-white dark:bg-navy dark:text-white">
                <option value="">{t('All Trades')}</option>
                {TRADES.filter(Boolean).map(tr => <option key={tr} value={tr} className="capitalize">{tr}</option>)}
              </select>
              <button type="submit" className="px-6 py-2.5 text-sm font-semibold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark transition-colors">
                {t('Search')}
              </button>
            </div>
          </form>

          {/* Results */}
          {loading ? (
            <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-ilo-blue border-t-transparent rounded-full" /></div>
          ) : workers.length === 0 ? (
            <div className="text-center py-12 text-gray-400 dark:text-gray-500">
              <p className="text-3xl mb-2">👷</p>
              <p className="text-sm">{t('No workers found')}</p>
            </div>
          ) : (
            <>
              <p className="text-xs text-gray-500 dark:text-gray-400">{pagination.total} {t('workers found')}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {workers.map(w => (
                  <div key={w._id} className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-4 hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-10 h-10 rounded-full bg-ilo-blue/10 dark:bg-ilo-blue/20 flex items-center justify-center text-sm font-bold text-ilo-blue">
                        {w.fullName?.charAt(0)}
                      </div>
                      <button onClick={() => toggleShortlist(w._id)} title={isShortlisted(w._id) ? 'Remove from shortlist' : 'Add to shortlist'}
                        className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-navy-light transition-colors">
                        {isShortlisted(w._id)
                          ? <svg className="w-5 h-5 text-gold-accent fill-current" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                          : <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"/></svg>
                        }
                      </button>
                    </div>
                    <h4 className="font-semibold text-sm dark:text-white truncate">{w.fullName}</h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{w.registrationId}</p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <span className="px-2 py-0.5 text-[10px] font-semibold rounded bg-gray-100 dark:bg-navy-light text-gray-600 dark:text-gray-300 capitalize">{w.trade}</span>
                      <NqfBadge level={w.nqfLevel} />
                      <StatusBadge status={w.status} />
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">{w.district}</p>
                    {w.experience?.years > 0 && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">{w.experience.years} {t('years experience')}</p>
                    )}
                    <button onClick={() => openWorkerDetail(w._id)}
                      className="mt-3 w-full py-2 text-xs font-semibold text-ilo-blue bg-ilo-blue/5 hover:bg-ilo-blue/10 rounded-lg transition-colors">
                      {t('View Profile')}
                    </button>
                  </div>
                ))}
              </div>

              {/* Pagination */}
              {pagination.pages > 1 && (
                <div className="flex justify-center gap-2 pt-2">
                  <button onClick={() => loadWorkers(pagination.page - 1)} disabled={pagination.page <= 1}
                    className="px-3 py-1.5 text-xs font-semibold border border-border dark:border-navy-light rounded-lg disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-navy-light dark:text-gray-300">
                    {t('Previous')}
                  </button>
                  <span className="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400">
                    {pagination.page} / {pagination.pages}
                  </span>
                  <button onClick={() => loadWorkers(pagination.page + 1)} disabled={pagination.page >= pagination.pages}
                    className="px-3 py-1.5 text-xs font-semibold border border-border dark:border-navy-light rounded-lg disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-navy-light dark:text-gray-300">
                    {t('Next')}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Worker Detail Panel */}
      {tab === 0 && selectedWorker && (
        <div className="space-y-4">
          <button onClick={() => setSelectedWorker(null)} className="text-xs font-semibold text-ilo-blue hover:underline flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
            {t('Back to Search')}
          </button>

          <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-5">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-ilo-blue/10 dark:bg-ilo-blue/20 flex items-center justify-center text-xl font-bold text-ilo-blue">
                  {selectedWorker.fullName?.charAt(0)}
                </div>
                <div>
                  <h3 className="text-lg font-bold dark:text-white">{selectedWorker.fullName}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{selectedWorker.registrationId}</p>
                  <div className="flex gap-2 mt-1">
                    <span className="px-2 py-0.5 text-[10px] font-semibold rounded bg-gray-100 dark:bg-navy-light text-gray-600 dark:text-gray-300 capitalize">{selectedWorker.trade}</span>
                    <NqfBadge level={selectedWorker.nqfLevel} />
                    <StatusBadge status={selectedWorker.status} />
                  </div>
                </div>
              </div>
              <button onClick={() => toggleShortlist(selectedWorker._id)}
                className={`px-4 py-2 text-xs font-semibold rounded-lg border-2 transition-colors ${
                  isShortlisted(selectedWorker._id)
                    ? 'border-gold-accent bg-gold-accent/10 text-gold-accent'
                    : 'border-gray-200 dark:border-navy-light text-gray-500 hover:border-gold-accent'
                }`}>
                {isShortlisted(selectedWorker._id) ? t('Shortlisted') : t('Shortlist')}
              </button>
            </div>

            {/* Worker Info Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5 pt-5 border-t border-border dark:border-navy-light">
              <div>
                <p className="text-[10px] uppercase font-bold text-gray-400 mb-1">{t('District')}</p>
                <p className="text-sm font-medium dark:text-white">{selectedWorker.district}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold text-gray-400 mb-1">{t('Province')}</p>
                <p className="text-sm font-medium dark:text-white">{selectedWorker.province || 'KP'}</p>
              </div>
              {selectedWorker.experience?.years > 0 && (
                <div>
                  <p className="text-[10px] uppercase font-bold text-gray-400 mb-1">{t('Experience')}</p>
                  <p className="text-sm font-medium dark:text-white">{selectedWorker.experience.years} {t('years')}</p>
                </div>
              )}
              {selectedWorker.experience?.countries?.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase font-bold text-gray-400 mb-1">{t('Countries')}</p>
                  <p className="text-sm font-medium dark:text-white">{selectedWorker.experience.countries.join(', ')}</p>
                </div>
              )}
              {selectedWorker.cnicMasked && (
                <div>
                  <p className="text-[10px] uppercase font-bold text-gray-400 mb-1">CNIC</p>
                  <p className="text-sm font-medium dark:text-white font-mono">{selectedWorker.cnicMasked}</p>
                </div>
              )}
              {selectedWorker.phone && (
                <div>
                  <p className="text-[10px] uppercase font-bold text-gray-400 mb-1">{t('Phone')}</p>
                  <p className="text-sm font-medium dark:text-white">{selectedWorker.phone}</p>
                </div>
              )}
            </div>

            {/* Gulf Readiness */}
            {selectedWorker.gulfReadiness && (
              <div className="mt-5 pt-5 border-t border-border dark:border-navy-light">
                <h4 className="text-xs font-bold uppercase text-gray-400 mb-3">{t('Gulf Readiness')}</h4>
                <div className="flex items-center gap-4 mb-3">
                  <div className="flex-1 h-3 bg-gray-100 dark:bg-navy-light rounded-full overflow-hidden">
                    <div className="h-full bg-ilo-blue rounded-full transition-all" style={{ width: `${selectedWorker.gulfReadiness.score || 0}%` }} />
                  </div>
                  <span className="text-sm font-bold text-ilo-blue">{selectedWorker.gulfReadiness.score || 0}%</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[
                    { key: 'safetyTraining', label: 'Safety Training' },
                    { key: 'languageTest', label: 'Language Test' },
                    { key: 'medicalClearance', label: 'Medical Clearance' },
                    { key: 'passportValid', label: 'Passport Valid' },
                  ].map(item => (
                    <span key={item.key} className={`px-2 py-1 text-[10px] font-semibold rounded-lg ${
                      selectedWorker.gulfReadiness[item.key]
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-gray-100 text-gray-500 dark:bg-navy-light dark:text-gray-500'
                    }`}>
                      {selectedWorker.gulfReadiness[item.key] ? '\u2713' : '\u2717'} {t(item.label)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Competencies */}
            {selectedWorker.competencies?.length > 0 && (
              <div className="mt-5 pt-5 border-t border-border dark:border-navy-light">
                <h4 className="text-xs font-bold uppercase text-gray-400 mb-3">{t('Competencies')}</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {selectedWorker.competencies.map((c, i) => (
                    <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-gray-50 dark:bg-navy-light">
                      <div>
                        <p className="text-xs font-medium dark:text-white">{c.title}</p>
                        <p className="text-[10px] text-gray-500">{c.code} | NQF {c.nqfLevel}</p>
                      </div>
                      <span className={`px-2 py-0.5 text-[10px] font-semibold rounded capitalize ${
                        c.proficiency === 'expert' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' :
                        c.proficiency === 'proficient' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                        c.proficiency === 'competent' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {c.proficiency}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Credentials */}
            <div className="mt-5 pt-5 border-t border-border dark:border-navy-light">
              <h4 className="text-xs font-bold uppercase text-gray-400 mb-3">{t('Credentials')} ({workerCredentials.length})</h4>
              {workerCredentials.length === 0 ? (
                <p className="text-sm text-gray-400">{t('No credentials issued yet')}</p>
              ) : (
                <div className="space-y-2">
                  {workerCredentials.map(cred => (
                    <div key={cred._id} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-navy-light">
                      <div>
                        <p className="text-sm font-medium dark:text-white">{cred.title}</p>
                        <p className="text-[10px] text-gray-500">{cred.credentialId} | {cred.type} | NQF {cred.nqfLevel}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${
                          cred.status === 'active' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                          cred.status === 'revoked' ? 'bg-red-100 text-red-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {cred.status}
                        </span>
                        <a href={`/verify/${cred.credentialId}`} target="_blank" rel="noopener noreferrer"
                          className="text-[10px] font-semibold text-ilo-blue hover:underline">
                          {t('Verify')}
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========== TAB 1: Shortlist ========== */}
      {tab === 1 && (
        <div className="space-y-4">
          {shortlist.length === 0 ? (
            <div className="text-center py-12 text-gray-400 dark:text-gray-500">
              <p className="text-3xl mb-2">&#11088;</p>
              <p className="text-sm">{t('No workers shortlisted yet')}</p>
              <p className="text-xs mt-1">{t('Use Talent Search to find and shortlist workers')}</p>
            </div>
          ) : loadingShortlist ? (
            <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-ilo-blue border-t-transparent rounded-full" /></div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500 dark:text-gray-400">{shortlistedWorkers.length} {t('workers shortlisted')}</p>
                <button onClick={() => { setShortlist([]); setShortlistStorage([]); setShortlistedWorkers([]); }}
                  className="text-xs text-red-500 hover:underline">
                  {t('Clear All')}
                </button>
              </div>
              <div className="space-y-3">
                {shortlistedWorkers.map(w => (
                  <div key={w._id} className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-4 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-ilo-blue/10 dark:bg-ilo-blue/20 flex items-center justify-center text-sm font-bold text-ilo-blue shrink-0">
                      {w.fullName?.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-sm dark:text-white truncate">{w.fullName}</h4>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{w.registrationId} | {w.trade} | {w.district}</p>
                      <div className="flex gap-1.5 mt-1">
                        <NqfBadge level={w.nqfLevel} />
                        <StatusBadge status={w.status} />
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => { setTab(0); openWorkerDetail(w._id); }}
                        className="px-3 py-1.5 text-xs font-semibold text-ilo-blue bg-ilo-blue/5 hover:bg-ilo-blue/10 rounded-lg transition-colors">
                        {t('View Profile')}
                      </button>
                      <button onClick={() => toggleShortlist(w._id)}
                        className="px-3 py-1.5 text-xs font-semibold text-red-500 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/30 rounded-lg transition-colors">
                        {t('Remove')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ========== TAB 2: Verify Credential ========== */}
      {tab === 2 && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-5">
            <h3 className="font-semibold dark:text-white mb-3">{t('Verify Worker Credential')}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">{t('Enter a credential ID (e.g. TL-2026-00001) to verify its authenticity and status.')}</p>
            <form onSubmit={handleVerify} className="flex gap-3">
              <input type="text" value={verifyId} onChange={e => setVerifyId(e.target.value)}
                placeholder="TL-2026-XXXXX"
                className="flex-1 px-4 py-2.5 text-sm border border-border dark:border-navy-light rounded-xl bg-white dark:bg-navy dark:text-white font-mono focus:ring-2 focus:ring-ilo-blue/30 focus:border-ilo-blue outline-none" />
              <button type="submit" disabled={verifying}
                className="px-6 py-2.5 text-sm font-semibold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark transition-colors disabled:opacity-50">
                {verifying ? t('Verifying...') : t('Verify')}
              </button>
            </form>
          </div>

          {verifyResult && (
            <div className={`bg-white dark:bg-navy-mid rounded-xl border-2 p-5 ${
              verifyResult.error ? 'border-red-300 dark:border-red-800' :
              verifyResult.verification?.proofValid ? 'border-green-300 dark:border-green-800' :
              'border-amber-300 dark:border-amber-800'
            }`}>
              {verifyResult.error ? (
                <div className="flex items-center gap-3">
                  <span className="text-2xl">&#10060;</span>
                  <div>
                    <p className="font-semibold text-red-700 dark:text-red-400">{t('Verification Failed')}</p>
                    <p className="text-sm text-gray-500">{verifyResult.error}</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{verifyResult.verification?.proofValid ? '\u2705' : '\u26A0\uFE0F'}</span>
                    <div>
                      <p className={`font-semibold ${verifyResult.verification?.proofValid ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'}`}>
                        {verifyResult.verification?.proofValid ? t('Credential Verified') : t('Verification Warning')}
                      </p>
                      <p className="text-xs text-gray-500">{verifyResult.verification?.message}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-4 border-t border-border dark:border-navy-light">
                    <div>
                      <p className="text-[10px] uppercase font-bold text-gray-400">{t('Credential ID')}</p>
                      <p className="text-sm font-mono font-medium dark:text-white">{verifyResult.credentialId}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-bold text-gray-400">{t('Status')}</p>
                      <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${
                        verifyResult.status === 'active' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {verifyResult.status}
                      </span>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-bold text-gray-400">{t('Type')}</p>
                      <p className="text-sm font-medium dark:text-white capitalize">{verifyResult.type?.replace('-', ' ')}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-bold text-gray-400">{t('Worker')}</p>
                      <p className="text-sm font-medium dark:text-white">{verifyResult.worker?.name}</p>
                      <p className="text-[10px] text-gray-500">{verifyResult.worker?.registrationId}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-bold text-gray-400">{t('Trade')}</p>
                      <p className="text-sm font-medium dark:text-white capitalize">{verifyResult.trade}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-bold text-gray-400">NQF {t('Level')}</p>
                      <p className="text-sm font-medium dark:text-white">{verifyResult.nqfLevel}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-bold text-gray-400">{t('Issued By')}</p>
                      <p className="text-sm font-medium dark:text-white">{verifyResult.issuedBy}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-bold text-gray-400">{t('Valid Until')}</p>
                      <p className="text-sm font-medium dark:text-white">{new Date(verifyResult.validUntil).toLocaleDateString()}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-bold text-gray-400">{t('Verifications')}</p>
                      <p className="text-sm font-medium dark:text-white">{verifyResult.verificationCount}</p>
                    </div>
                  </div>

                  {verifyResult.revokedAt && (
                    <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                      <p className="text-sm font-semibold text-red-700 dark:text-red-400">{t('Credential Revoked')}</p>
                      <p className="text-xs text-red-600 dark:text-red-300">{t('Reason')}: {verifyResult.revokedReason}</p>
                      <p className="text-xs text-red-500">{new Date(verifyResult.revokedAt).toLocaleDateString()}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ========== TAB 3: Workforce Overview ========== */}
      {tab === 3 && (
        <div className="space-y-4">
          {loadingAnalytics ? (
            <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-ilo-blue border-t-transparent rounded-full" /></div>
          ) : analytics ? (
            <>
              {/* KPI Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                {[
                  { icon: '👷', label: 'Available Workers', value: analytics.totalAvailable },
                  { icon: '🎓', label: 'Certified', value: analytics.certified, sub: `${analytics.certificationRate}%` },
                  { icon: '🌍', label: 'Gulf Ready', value: analytics.gulfReady, sub: `${analytics.gulfReadyRate}%` },
                  { icon: '📜', label: 'Active Credentials', value: analytics.activeCredentials },
                  { icon: '📊', label: 'Trades', value: analytics.byTrade?.length || 0 },
                ].map((kpi, i) => (
                  <div key={i} className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-4">
                    <p className="text-2xl mb-1">{kpi.icon}</p>
                    <p className="text-xl font-bold dark:text-white">{kpi.value}</p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 font-semibold uppercase">{t(kpi.label)}</p>
                    {kpi.sub && <p className="text-xs text-ilo-blue font-semibold mt-0.5">{kpi.sub}</p>}
                  </div>
                ))}
              </div>

              {/* Charts Row */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Trade Distribution */}
                <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-5">
                  <h3 className="text-sm font-semibold dark:text-white mb-4">{t('Workers by Trade')}</h3>
                  {analytics.byTrade?.length > 0 ? (
                    <Doughnut data={{
                      labels: analytics.byTrade.map(d => d._id?.charAt(0).toUpperCase() + d._id?.slice(1)),
                      datasets: [{
                        data: analytics.byTrade.map(d => d.count),
                        backgroundColor: analytics.byTrade.map(d => TRADE_COLORS[d._id] || '#94a3b8'),
                        borderWidth: 0,
                      }],
                    }} options={{ responsive: true, plugins: { legend: { position: 'right', labels: { usePointStyle: true, pointStyle: 'circle' } } } }} />
                  ) : (
                    <p className="text-sm text-gray-400 text-center py-8">{t('No data')}</p>
                  )}
                </div>

                {/* District Distribution */}
                <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-5">
                  <h3 className="text-sm font-semibold dark:text-white mb-4">{t('Top Districts')}</h3>
                  {analytics.byDistrict?.length > 0 ? (
                    <Bar data={{
                      labels: analytics.byDistrict.map(d => d._id),
                      datasets: [{
                        label: t('Workers'),
                        data: analytics.byDistrict.map(d => d.count),
                        backgroundColor: '#0072BC',
                        borderRadius: 6,
                      }],
                    }} options={{ responsive: true, indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } }} />
                  ) : (
                    <p className="text-sm text-gray-400 text-center py-8">{t('No data')}</p>
                  )}
                </div>
              </div>

              {/* NQF Level Distribution */}
              {analytics.byNqf?.length > 0 && (
                <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-5">
                  <h3 className="text-sm font-semibold dark:text-white mb-4">{t('NQF Level Distribution')}</h3>
                  <div className="flex items-end gap-3 h-40">
                    {analytics.byNqf.map(n => {
                      const max = Math.max(...analytics.byNqf.map(x => x.count));
                      const pct = max > 0 ? (n.count / max) * 100 : 0;
                      return (
                        <div key={n._id} className="flex-1 flex flex-col items-center gap-1">
                          <span className="text-xs font-bold text-ilo-blue">{n.count}</span>
                          <div className="w-full bg-ilo-blue/80 rounded-t-lg transition-all" style={{ height: `${Math.max(pct, 5)}%` }} />
                          <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400">L{n._id}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-400 text-center py-12">{t('Failed to load analytics')}</p>
          )}
        </div>
      )}
    </div>
  );
}
