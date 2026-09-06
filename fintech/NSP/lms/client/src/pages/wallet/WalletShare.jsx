import { useState, useEffect } from 'react';
import api from '../../api/client';
import { useLang } from '../../context/LangContext';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';

const DISCLOSURE_FIELDS = [
  { key: 'title', label: 'Title' },
  { key: 'credentialType', label: 'Type' },
  { key: 'issuerName', label: 'Issuer' },
  { key: 'status', label: 'Status' },
  { key: 'issuanceDate', label: 'Issue Date' },
  { key: 'expiryDate', label: 'Expiry Date' },
  { key: 'nqfLevel', label: 'NQF Level' },
  { key: 'trade', label: 'Trade' },
  { key: 'credentialId', label: 'Credential ID' },
  { key: 'blockchainTxHash', label: 'Blockchain Anchor' },
];

const DEFAULT_FIELDS = new Set(['title', 'credentialType', 'issuerName', 'status', 'issuanceDate']);

export default function WalletShare() {
  const { t } = useLang();
  const { user } = useAuth();
  const [credentials, setCredentials] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [shareMode, setShareMode] = useState('qr'); // qr | link | pdf
  const [expiry, setExpiry] = useState('7d');
  const [shareUrl, setShareUrl] = useState('');
  const [shareId, setShareId] = useState('');
  const [shareHistory, setShareHistory] = useState([]);
  // Map of credentialId → Set of disclosed fields
  const [disclosureMap, setDisclosureMap] = useState({});
  // Which credential's disclosure panel is open
  const [expandedDisclosure, setExpandedDisclosure] = useState(null);

  useEffect(() => {
    Promise.all([
      api.get('/credentials', { params: { limit: 100 } }).catch(() => ({ data: { credentials: [] } })),
      api.get('/registry/credentials', { params: { limit: 200 } }).catch(() => ({ data: { credentials: [] } })),
    ]).then(([legacyRes, registryRes]) => {
      setCredentials([
        ...(legacyRes.data.credentials || []).map(c => ({ ...c, _source: 'legacy' })),
        ...(registryRes.data.credentials || []).map(c => ({ ...c, _source: 'registry' })),
      ]);
    }).catch(() => {});
  }, [user]);

  // Stable identifier the server can resolve: registry creds by their credentialId,
  // legacy issued creds by their Mongo _id (falls back to credentialId).
  const credKey = (c) => (c._source === 'registry' ? c.credentialId : (c._id || c.credentialId));

  const toggleSelect = (id) => {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
      // Init disclosure fields for this credential if not set
      if (!disclosureMap[id]) {
        setDisclosureMap(prev => ({ ...prev, [id]: new Set(DEFAULT_FIELDS) }));
      }
    }
    setSelected(next);
  };

  const selectAll = () => {
    if (selected.size === credentials.length) {
      setSelected(new Set());
    } else {
      const allIds = credentials.map(credKey);
      setSelected(new Set(allIds));
      // Init disclosure for all
      const initMap = {};
      allIds.forEach(id => {
        if (!disclosureMap[id]) initMap[id] = new Set(DEFAULT_FIELDS);
      });
      if (Object.keys(initMap).length > 0) {
        setDisclosureMap(prev => ({ ...prev, ...initMap }));
      }
    }
  };

  const toggleField = (credId, field) => {
    setDisclosureMap(prev => {
      const fields = new Set(prev[credId] || DEFAULT_FIELDS);
      if (fields.has(field)) fields.delete(field); else fields.add(field);
      return { ...prev, [credId]: fields };
    });
  };

  const generateShareLink = async () => {
    if (selected.size === 0) return toast.error('Select at least one credential');

    const credList = Array.from(selected).map(id => ({
      credentialId: id,
      disclosedFields: Array.from(disclosureMap[id] || DEFAULT_FIELDS),
    }));

    try {
      const res = await api.post('/wallet/share', {
        credentials: credList,
        shareType: shareMode === 'qr' ? 'QR_CODE' : shareMode === 'pdf' ? 'PDF_EXPORT' : 'DIRECT_LINK',
        expiresIn: expiry,
        purpose: 'Employer verification',
      });
      const fullUrl = `${window.location.origin}${res.data.shareUrl}`;
      setShareUrl(fullUrl);
      setShareId(res.data.shareId);
      setShareHistory(prev => [{
        url: fullUrl,
        createdAt: new Date().toISOString(),
        expiresAt: res.data.expiresAt,
        count: selected.size,
      }, ...prev.slice(0, 9)]);
      navigator.clipboard.writeText(fullUrl).catch(() => {});
      toast.success('Share link generated and copied!');
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Could not generate share link');
    }
  };

  const shareToLinkedIn = () => {
    if (!shareUrl) return;
    const text = encodeURIComponent('View my verified credentials from Pakistan National Skills Passport');
    const url = encodeURIComponent(shareUrl);
    window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${url}&summary=${text}`, '_blank');
  };

  const shareToWhatsApp = () => {
    if (!shareUrl) return;
    const text = encodeURIComponent(`View my verified credentials: ${shareUrl}`);
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  const shareViaEmail = () => {
    if (!shareUrl) return;
    const subject = encodeURIComponent('My Verified Credentials — Talent Ledger');
    const body = encodeURIComponent(`Hi,\n\nPlease view my verified credentials at:\n${shareUrl}\n\nThis link will expire in ${expiry}.\n\nRegards`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-bold dark:text-white">{t('Share Center')}</h3>

      {/* Share Mode */}
      <div className="flex gap-2">
        {[
          { key: 'qr', label: 'QR Code' },
          { key: 'link', label: 'Direct Link' },
          { key: 'pdf', label: 'PDF Export' },
        ].map(m => (
          <button
            key={m.key}
            onClick={() => setShareMode(m.key)}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors ${
              shareMode === m.key ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-400'
            }`}
          >
            {t(m.label)}
          </button>
        ))}
      </div>

      {/* Credential Selection + Selective Disclosure */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm font-semibold dark:text-white">{t('Select Credentials to Share')}</span>
          <button onClick={selectAll} className="text-xs text-blue-600 hover:underline">
            {selected.size === credentials.length ? t('Deselect All') : t('Select All')}
          </button>
        </div>

        <div className="space-y-2 max-h-80 overflow-y-auto">
          {credentials.map(c => {
            const id = credKey(c);
            const isSelected = selected.has(id);
            const fields = disclosureMap[id] || DEFAULT_FIELDS;
            const isDisclosureOpen = expandedDisclosure === id;

            return (
              <div key={id} className={`rounded-lg border transition-colors ${
                isSelected ? 'border-blue-300 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-100 dark:border-slate-700'
              }`}>
                {/* Credential Row */}
                <label className="flex items-center gap-3 p-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700 rounded-lg">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(id)}
                    className="w-4 h-4 rounded text-blue-600"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold dark:text-white truncate">{c.title}</p>
                    <p className="text-[10px] text-gray-400">{c.institution || c.issuerName}</p>
                  </div>
                  <span className={`text-[9px] px-2 py-0.5 rounded-full ${c.status === 'active' || c.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {c.status}
                  </span>
                </label>

                {/* Disclosure Field Selector (visible only when selected) */}
                {isSelected && (
                  <div className="px-3 pb-2">
                    <button
                      onClick={() => setExpandedDisclosure(isDisclosureOpen ? null : id)}
                      className="text-[10px] text-blue-600 hover:underline flex items-center gap-1"
                    >
                      <span>{isDisclosureOpen ? '▾' : '▸'}</span>
                      {t('Choose what to share')} ({fields.size}/{DISCLOSURE_FIELDS.length} {t('fields')})
                    </button>

                    {isDisclosureOpen && (
                      <div className="mt-2 grid grid-cols-2 gap-1">
                        {DISCLOSURE_FIELDS.map(f => (
                          <label key={f.key} className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={fields.has(f.key)}
                              onChange={() => toggleField(id, f.key)}
                              className="w-3 h-3 rounded text-blue-600"
                            />
                            <span className="text-[10px] text-gray-600 dark:text-gray-300">{t(f.label)}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Expiry Selection */}
      <div className="flex items-center gap-3">
        <span className="text-xs font-semibold dark:text-white">{t('Link expires in')}:</span>
        {['24h', '7d', '30d'].map(opt => (
          <button
            key={opt}
            onClick={() => setExpiry(opt)}
            className={`px-3 py-1 text-xs rounded-lg ${expiry === opt ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-400'}`}
          >
            {opt}
          </button>
        ))}
      </div>

      {/* Generate Button */}
      <button
        onClick={generateShareLink}
        className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors"
      >
        {t('Generate Share')} ({selected.size} {t('credentials')})
      </button>

      {/* Generated URL + Social Share */}
      {shareUrl && (
        <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-green-800 dark:text-green-300">{t('Share link generated!')}</p>
          <p className="text-[10px] font-mono text-green-700 dark:text-green-400 break-all">{shareUrl}</p>

          {shareMode === 'qr' && (
            <div className="flex justify-center">
              <img
                src={`/lms/api/verification/qr?size=200&data=${encodeURIComponent(shareUrl)}`}
                alt="QR"
                className="w-48 h-48 rounded-lg"
              />
            </div>
          )}

          {/* Social Share Row */}
          <div className="pt-1">
            <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-2">{t('Share via')}:</p>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => { navigator.clipboard.writeText(shareUrl); toast.success('Copied!'); }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600"
              >
                🔗 {t('Copy Link')}
              </button>
              <button
                onClick={shareToLinkedIn}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-blue-700 text-white rounded-lg hover:bg-blue-800"
              >
                💼 LinkedIn
              </button>
              <button
                onClick={shareToWhatsApp}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-green-500 text-white rounded-lg hover:bg-green-600"
              >
                💬 WhatsApp
              </button>
              <button
                onClick={shareViaEmail}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-amber-500 text-white rounded-lg hover:bg-amber-600"
              >
                📧 Email
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share History */}
      {shareHistory.length > 0 && (
        <div>
          <h4 className="text-sm font-bold dark:text-white mb-2">{t('Share History')}</h4>
          <div className="space-y-2">
            {shareHistory.map((h, i) => (
              <div key={i} className="bg-white dark:bg-slate-800 rounded-lg p-3 border border-gray-200 dark:border-slate-700 flex justify-between items-center">
                <div>
                  <p className="text-[10px] text-gray-500">{new Date(h.createdAt).toLocaleString()}</p>
                  <p className="text-xs dark:text-white">{h.count} credentials shared</p>
                </div>
                <span className="text-[10px] text-gray-400">expires {new Date(h.expiresAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
