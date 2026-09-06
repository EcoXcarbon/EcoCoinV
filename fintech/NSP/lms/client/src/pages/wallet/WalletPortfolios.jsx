import { useState, useEffect } from 'react';
import api from '../../api/client';
import { useLang } from '../../context/LangContext';
import toast from 'react-hot-toast';

const CATEGORIES = [
  { key: 'GULF_DEPLOYMENT', label: 'Gulf Deployment', icon: '✈️' },
  { key: 'EDUCATION', label: 'Education', icon: '🎓' },
  { key: 'TRADE_SKILLS', label: 'Trade Skills', icon: '🔧' },
  { key: 'CUSTOM', label: 'Custom', icon: '📁' },
];

const CATEGORY_COLORS = {
  GULF_DEPLOYMENT: 'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-700',
  EDUCATION: 'bg-purple-50 border-purple-200 dark:bg-purple-900/20 dark:border-purple-700',
  TRADE_SKILLS: 'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-700',
  PROFESSIONAL: 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-700',
  GENERAL: 'bg-slate-50 border-slate-200 dark:bg-slate-800 dark:border-slate-600',
  CUSTOM: 'bg-gray-50 border-gray-200 dark:bg-slate-800 dark:border-slate-700',
};

export default function WalletPortfolios() {
  const { t } = useLang();
  const [portfolios, setPortfolios] = useState([]);
  const [credentials, setCredentials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showAddCreds, setShowAddCreds] = useState(null); // portfolioId
  const [form, setForm] = useState({ name: '', description: '', category: 'JOB_APPLICATION' });
  const [selectedCreds, setSelectedCreds] = useState(new Set());
  const [sharing, setSharing] = useState(null); // { portfolioId, url }

  useEffect(() => {
    loadPortfolios();
    api.get('/credentials', { params: { limit: 200 } })
      .then(r => setCredentials(r.data.credentials || []))
      .catch(() => {});
  }, []);

  const loadPortfolios = () => {
    setLoading(true);
    api.get('/wallet/portfolios')
      .then(r => setPortfolios(r.data.portfolios || []))
      .catch(() => setPortfolios([]))
      .finally(() => setLoading(false));
  };

  const createPortfolio = async () => {
    if (!form.name.trim()) return toast.error('Name is required');
    try {
      await api.post('/wallet/portfolios', {
        name: form.name,
        description: form.description,
        category: form.category,
        credentials: [],
      });
      toast.success('Portfolio created');
      setShowCreate(false);
      setForm({ name: '', description: '', category: 'JOB_APPLICATION' });
      loadPortfolios();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to create portfolio');
    }
  };

  const deletePortfolio = async (portfolioId) => {
    if (!confirm('Delete this portfolio?')) return;
    try {
      await api.delete(`/wallet/portfolios/${portfolioId}`);
      toast.success('Portfolio deleted');
      loadPortfolios();
    } catch {
      toast.error('Failed to delete');
    }
  };

  const openAddCreds = (portfolioId) => {
    setSelectedCreds(new Set());
    setShowAddCreds(portfolioId);
  };

  const addCredentialsToPortfolio = async () => {
    if (selectedCreds.size === 0) return toast.error('Select at least one credential');
    try {
      await api.put(`/wallet/portfolios/${showAddCreds}`, {
        credentials: Array.from(selectedCreds),
      });
      toast.success(`${selectedCreds.size} credential(s) added`);
      setShowAddCreds(null);
      loadPortfolios();
    } catch {
      toast.error('Failed to update portfolio');
    }
  };

  const sharePortfolio = async (portfolio) => {
    const credIds = (portfolio.credentials || []).map(c => c.credentialId || c);
    if (credIds.length === 0) return toast.error('Portfolio has no credentials');
    try {
      const res = await api.post('/wallet/share', {
        credentials: credIds.map(id => ({ credentialId: id })),
        shareType: 'DIRECT_LINK',
        expiresIn: '30d',
        purpose: `Portfolio: ${portfolio.name}`,
      });
      const url = `${window.location.origin}${res.data.shareUrl}`;
      setSharing({ portfolioId: portfolio.portfolioId || portfolio._id, url });
      navigator.clipboard.writeText(url).catch(() => {});
      toast.success('Portfolio share link copied!');
    } catch {
      toast.error('Failed to create share link');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-bold dark:text-white">{t('Portfolios')}</h3>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700"
        >
          + {t('Create Portfolio')}
        </button>
      </div>

      {/* Portfolio List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full" />
        </div>
      ) : portfolios.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700">
          <p className="text-4xl mb-3">📁</p>
          <p className="text-sm font-semibold dark:text-white mb-1">{t('No portfolios yet')}</p>
          <p className="text-xs text-gray-400">{t('Create a portfolio to group and share credentials')}</p>
          <button
            onClick={() => setShowCreate(true)}
            className="mt-4 px-6 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700"
          >
            {t('Create First Portfolio')}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {portfolios.map(p => {
            const catConfig = CATEGORIES.find(c => c.key === p.category) || CATEGORIES[3];
            const credCount = p.credentials?.length || 0;
            const isShared = sharing?.portfolioId === (p.portfolioId || p._id);

            return (
              <div key={p._id || p.portfolioId} className={`rounded-xl border-2 p-4 ${CATEGORY_COLORS[p.category] || CATEGORY_COLORS.CUSTOM}`}>
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{catConfig.icon}</span>
                    <div>
                      <h4 className="text-sm font-bold dark:text-white">{p.name}</h4>
                      <p className="text-[10px] text-gray-400">{catConfig.label} · {credCount} credentials</p>
                    </div>
                  </div>
                  <button
                    onClick={() => deletePortfolio(p.portfolioId || p._id)}
                    className="text-gray-400 hover:text-red-500 text-xs"
                    title="Delete portfolio"
                  >
                    🗑
                  </button>
                </div>

                {/* Description */}
                {p.description && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{p.description}</p>
                )}

                {/* Credential Thumbnails */}
                {credCount > 0 && (
                  <div className="grid grid-cols-4 gap-1 mb-3">
                    {(p.credentials || []).slice(0, 4).map((c, i) => (
                      <div key={i} className="bg-white dark:bg-slate-700 rounded-lg p-1.5 text-center">
                        <p className="text-[9px] text-gray-500 dark:text-gray-400 truncate">
                          {c.credentialId ? c.credentialId.slice(0, 8) + '...' : `Cred ${i + 1}`}
                        </p>
                      </div>
                    ))}
                    {credCount > 4 && (
                      <div className="bg-white dark:bg-slate-700 rounded-lg p-1.5 text-center flex items-center justify-center">
                        <span className="text-[9px] text-gray-400">+{credCount - 4}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Shared URL */}
                {isShared && (
                  <div className="mb-3 p-2 bg-green-50 dark:bg-green-900/20 rounded-lg">
                    <p className="text-[9px] text-green-600 dark:text-green-400 font-mono break-all">{sharing.url}</p>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2">
                  <button
                    onClick={() => openAddCreds(p.portfolioId || p._id)}
                    className="flex-1 py-1.5 text-[11px] font-semibold bg-white dark:bg-slate-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-600 border border-gray-200 dark:border-slate-600"
                  >
                    + {t('Add Credentials')}
                  </button>
                  <button
                    onClick={() => sharePortfolio(p)}
                    className="flex-1 py-1.5 text-[11px] font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    🔗 {t('Share Portfolio')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Portfolio Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold dark:text-white mb-4">{t('Create Portfolio')}</h3>

            <div className="space-y-3">
              <input
                type="text"
                placeholder={t('Portfolio name')}
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                className="w-full px-3 py-2 text-sm border rounded-lg dark:bg-slate-700 dark:border-slate-600 dark:text-white"
              />
              <textarea
                placeholder={t('Description (optional)')}
                value={form.description}
                onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                rows={2}
                className="w-full px-3 py-2 text-sm border rounded-lg dark:bg-slate-700 dark:border-slate-600 dark:text-white resize-none"
              />
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{t('Category')}</p>
                <div className="grid grid-cols-2 gap-2">
                  {CATEGORIES.map(cat => (
                    <button
                      key={cat.key}
                      onClick={() => setForm(p => ({ ...p, category: cat.key }))}
                      className={`py-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors ${
                        form.category === cat.key ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-400'
                      }`}
                    >
                      {cat.icon} {t(cat.label)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowCreate(false)} className="flex-1 py-2 text-sm font-semibold bg-gray-100 dark:bg-slate-700 dark:text-white rounded-xl">
                {t('Cancel')}
              </button>
              <button onClick={createPortfolio} className="flex-1 py-2 text-sm font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700">
                {t('Create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Credentials Modal */}
      {showAddCreds && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowAddCreds(null)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 max-w-sm w-full max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold dark:text-white mb-4">{t('Add Credentials')}</h3>

            <div className="flex-1 overflow-y-auto space-y-2 mb-4">
              {credentials.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">{t('No credentials available')}</p>
              ) : credentials.map(c => {
                const id = c._id || c.credentialId;
                return (
                  <label key={id} className="flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700">
                    <input
                      type="checkbox"
                      checked={selectedCreds.has(id)}
                      onChange={() => {
                        const next = new Set(selectedCreds);
                        if (next.has(id)) next.delete(id); else next.add(id);
                        setSelectedCreds(next);
                      }}
                      className="w-4 h-4 rounded text-blue-600"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold dark:text-white truncate">{c.title}</p>
                      <p className="text-[10px] text-gray-400">{c.institution || c.issuerName}</p>
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="flex gap-3">
              <button onClick={() => setShowAddCreds(null)} className="flex-1 py-2 text-sm font-semibold bg-gray-100 dark:bg-slate-700 dark:text-white rounded-xl">
                {t('Cancel')}
              </button>
              <button onClick={addCredentialsToPortfolio} className="flex-1 py-2 text-sm font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700">
                {t('Add')} ({selectedCreds.size})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
