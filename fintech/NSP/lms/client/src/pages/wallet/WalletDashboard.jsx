import { useState, useEffect } from 'react';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useLang } from '../../context/LangContext';
import toast from 'react-hot-toast';

export default function WalletDashboard({ onNavigate }) {
  const { user } = useAuth();
  const { t } = useLang();
  const [profile, setProfile] = useState(null);
  const [summary, setSummary] = useState({ verified: 0, pending: 0, selfDeclared: 0, total: 0, expired: 0 });
  const [showQR, setShowQR] = useState(false);
  const [qrData, setQrData] = useState('');
  const [gulfReadiness, setGulfReadiness] = useState(null);
  const [recentVerifications, setRecentVerifications] = useState([]);
  const simpleMode = localStorage.getItem('tl_simple_mode') === 'true';

  useEffect(() => {
    // Load worker profile
    api.get('/workers', { params: { limit: 1 } })
      .then(r => {
        const w = r.data.workers?.[0];
        if (w) setProfile(w);
      })
      .catch(() => {});

    // Load credential counts
    api.get('/credentials', { params: { limit: 200 } })
      .then(r => {
        const creds = r.data.credentials || [];
        setSummary({
          verified: creds.filter(c => c.status === 'active' || c.status === 'ACTIVE').length,
          pending: creds.filter(c => c.status === 'pending' || c.status === 'PENDING_VERIFICATION').length,
          selfDeclared: creds.filter(c => c.type === 'self-declared' || c.verificationStatus === 'SELF_DECLARED').length,
          expired: creds.filter(c => c.status === 'expired' || c.status === 'EXPIRED').length,
          total: creds.length,
        });
      })
      .catch(() => {});

    // Gulf readiness (skills gap for UAE market)
    api.get('/wallet/skills-gap', { params: { market: 'UAE' } })
      .then(r => setGulfReadiness(r.data))
      .catch(() => {});

    // Recent credential verifications (who checked my creds)
    api.get('/wallet/verification-history', { params: { limit: 5 } })
      .then(r => setRecentVerifications(r.data.verifications || []))
      .catch(() => {});
  }, []);

  const generateProfileQR = () => {
    if (!profile) return;
    const verifyUrl = `${window.location.origin}/verify/profile/${profile._id}`;
    setQrData(verifyUrl);
    setShowQR(true);
  };

  // ── Simple Mode ───────────────────────────────────────────────
  if (simpleMode) {
    return (
      <div className="space-y-5">
        {/* Name Banner */}
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-5 text-white text-center">
          <div className="w-20 h-20 rounded-full bg-slate-600 flex items-center justify-center text-3xl font-bold mx-auto mb-3">
            {profile?.photo ? (
              <img src={profile.photo} alt="" className="w-full h-full object-cover rounded-full" />
            ) : (
              (profile?.fullName || user?.name || 'U').charAt(0).toUpperCase()
            )}
          </div>
          <h2 className="text-2xl font-bold">{profile?.fullName || user?.name}</h2>
          <p className="text-slate-400 text-sm mt-1 font-mono">{profile?.cnicMasked || ''}</p>
          <button
            onClick={generateProfileQR}
            className="mt-4 px-6 py-3 bg-white/15 hover:bg-white/25 rounded-xl text-base font-semibold transition-colors"
          >
            📱 {t('Show My QR Code')}
          </button>
        </div>

        {/* Three big tiles */}
        <div className="grid grid-cols-1 gap-4">
          <button
            onClick={() => onNavigate('credentials')}
            className="bg-green-500 rounded-2xl p-6 text-white flex items-center gap-5"
          >
            <span className="text-5xl">📄</span>
            <div className="text-left">
              <p className="text-4xl font-bold">{summary.verified}</p>
              <p className="text-lg font-semibold opacity-90">{t('Your Papers')}</p>
              <p className="text-sm opacity-75">{t('Active credentials')}</p>
            </div>
          </button>

          <button
            onClick={() => onNavigate('alerts')}
            className="bg-amber-400 rounded-2xl p-6 text-white flex items-center gap-5"
          >
            <span className="text-5xl">⏰</span>
            <div className="text-left">
              <p className="text-4xl font-bold">{summary.pending}</p>
              <p className="text-lg font-semibold opacity-90">{t('Check Soon')}</p>
              <p className="text-sm opacity-75">{t('Pending verification')}</p>
            </div>
          </button>

          <button
            onClick={() => onNavigate('credentials')}
            className="bg-red-500 rounded-2xl p-6 text-white flex items-center gap-5"
          >
            <span className="text-5xl">❌</span>
            <div className="text-left">
              <p className="text-4xl font-bold">{summary.expired}</p>
              <p className="text-lg font-semibold opacity-90">{t('Expired')}</p>
              <p className="text-sm opacity-75">{t('Need renewal')}</p>
            </div>
          </button>
        </div>

        {/* QR Modal */}
        {showQR && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowQR(false)}>
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 max-w-sm w-full text-center" onClick={e => e.stopPropagation()}>
              <h3 className="text-xl font-bold dark:text-white mb-4">{t('My QR Code')}</h3>
              <div className="bg-white p-4 rounded-xl inline-block">
                <img src={`/lms/api/verification/qr?size=250&data=${encodeURIComponent(qrData)}`} alt="QR Code" className="w-60 h-60" />
              </div>
              <button onClick={() => setShowQR(false)} className="mt-5 px-8 py-3 bg-slate-800 text-white rounded-xl text-base font-semibold hover:bg-slate-700">
                {t('Close')}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Standard Mode ─────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Tier 1 — Instant Card */}
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-6 text-white shadow-xl">
        <div className="flex items-start gap-4">
          {/* Photo */}
          <div className="w-20 h-20 rounded-full bg-slate-600 flex items-center justify-center text-2xl font-bold flex-shrink-0 overflow-hidden">
            {profile?.photo ? (
              <img src={profile.photo} alt="" className="w-full h-full object-cover" />
            ) : (
              (profile?.fullName || user?.name || 'U').charAt(0).toUpperCase()
            )}
          </div>

          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold truncate">{profile?.fullName || user?.name}</h2>
            {profile?.fullNameUrdu && (
              <p className="text-sm text-slate-300 font-urdu" dir="rtl">{profile.fullNameUrdu}</p>
            )}
            <p className="text-sm text-slate-400 mt-1 font-mono">
              {profile?.cnicMasked || 'CNIC Not Linked'}
            </p>

            {/* NADRA Verification Badge */}
            {profile?.nadraVerificationStatus === 'VERIFIED' && (
              <div className="mt-2 inline-flex items-center gap-1 bg-green-500/20 text-green-300 px-3 py-1 rounded-full text-xs font-semibold">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                NADRA Verified
              </div>
            )}
          </div>
        </div>

        {/* Primary Trade */}
        <div className="mt-4 flex items-center gap-3">
          <span className="bg-blue-500/20 text-blue-300 px-3 py-1 rounded-lg text-xs font-semibold capitalize">
            {profile?.trade?.replace(/-/g, ' ') || 'No Trade Set'}
          </span>
          {profile?.nqfLevel && (
            <span className="bg-amber-500/20 text-amber-300 px-2 py-1 rounded-lg text-xs font-semibold">
              NQF Level {profile.nqfLevel}
            </span>
          )}
        </div>

        {/* Credential Summary */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="bg-white/5 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-green-400">{summary.verified}</p>
            <p className="text-[10px] text-slate-400 uppercase tracking-wide">{t('Verified')}</p>
          </div>
          <div className="bg-white/5 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-amber-400">{summary.pending}</p>
            <p className="text-[10px] text-slate-400 uppercase tracking-wide">{t('Pending')}</p>
          </div>
          <div className="bg-white/5 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-orange-400">{summary.selfDeclared}</p>
            <p className="text-[10px] text-slate-400 uppercase tracking-wide">{t('Self-Declared')}</p>
          </div>
        </div>

        {/* Profile Completeness */}
        <div className="mt-4">
          <div className="flex justify-between text-xs text-slate-400 mb-1">
            <span>{t('Profile Completeness')}</span>
            <span>{profile?.profileCompleteness || 0}%</span>
          </div>
          <div className="w-full bg-slate-700 rounded-full h-2">
            <div
              className="bg-gradient-to-r from-blue-500 to-green-500 h-2 rounded-full transition-all"
              style={{ width: `${profile?.profileCompleteness || 0}%` }}
            />
          </div>
        </div>

        {/* QR Code Button */}
        <button
          onClick={generateProfileQR}
          className="mt-4 w-full py-2.5 bg-white/10 hover:bg-white/20 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" /></svg>
          {t('Show Profile QR Code')}
        </button>
      </div>

      {/* QR Modal */}
      {showQR && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowQR(false)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 max-w-sm w-full text-center" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold dark:text-white mb-4">{t('Profile QR Code')}</h3>
            <div className="bg-white p-4 rounded-xl inline-block">
              <img src={`/lms/api/verification/qr?size=250&data=${encodeURIComponent(qrData)}`} alt="QR Code" className="w-60 h-60" />
            </div>
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">{t('Scan to view verified credentials')}</p>
            <button onClick={() => setShowQR(false)} className="mt-4 px-6 py-2 bg-slate-800 text-white rounded-xl text-sm font-semibold hover:bg-slate-700">
              {t('Close')}
            </button>
          </div>
        </div>
      )}

      {/* Quick Navigation */}
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => onNavigate('credentials')} className="bg-white dark:bg-slate-800 rounded-xl p-4 text-left border border-gray-200 dark:border-slate-700 hover:border-blue-300 transition-colors">
          <p className="text-sm font-bold dark:text-white">{t('My Credentials')}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{summary.total} total</p>
        </button>
        <button onClick={() => onNavigate('scan')} className="bg-white dark:bg-slate-800 rounded-xl p-4 text-left border border-gray-200 dark:border-slate-700 hover:border-blue-300 transition-colors">
          <p className="text-sm font-bold dark:text-white">📷 {t('Scan QR')}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t('Verify credentials')}</p>
        </button>
        <button onClick={() => onNavigate('share')} className="bg-white dark:bg-slate-800 rounded-xl p-4 text-left border border-gray-200 dark:border-slate-700 hover:border-blue-300 transition-colors">
          <p className="text-sm font-bold dark:text-white">{t('Share Center')}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t('Share with employers')}</p>
        </button>
        <button onClick={() => onNavigate('alerts')} className="bg-white dark:bg-slate-800 rounded-xl p-4 text-left border border-gray-200 dark:border-slate-700 hover:border-blue-300 transition-colors">
          <p className="text-sm font-bold dark:text-white">{t('Alerts')}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t('Expiry & updates')}</p>
        </button>
      </div>

      {/* Gulf Readiness Card */}
      {gulfReadiness && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-bold dark:text-white">🌍 {t('Gulf Readiness')}</h4>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
              gulfReadiness.readiness === 'READY' ? 'bg-green-100 text-green-700' :
              gulfReadiness.readiness === 'ALMOST_READY' ? 'bg-amber-100 text-amber-700' :
              'bg-red-100 text-red-700'
            }`}>
              {gulfReadiness.readiness?.replace(/_/g, ' ')}
            </span>
          </div>
          {/* Score bar */}
          <div className="mb-3">
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
              <span>{t('Readiness Score')}</span>
              <span className="font-semibold">{gulfReadiness.readinessScore}%</span>
            </div>
            <div className="w-full bg-gray-100 dark:bg-slate-700 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${
                  gulfReadiness.readinessScore >= 80 ? 'bg-green-500' :
                  gulfReadiness.readinessScore >= 50 ? 'bg-amber-400' : 'bg-red-500'
                }`}
                style={{ width: `${gulfReadiness.readinessScore}%` }}
              />
            </div>
          </div>
          {/* Top gap */}
          {gulfReadiness.gaps?.length > 0 && (
            <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-2.5 mb-2">
              <p className="text-xs font-semibold text-red-700 dark:text-red-400">
                ⚠️ {gulfReadiness.gaps[0].gap}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {gulfReadiness.gaps[0].action}
              </p>
            </div>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400">
            💰 {gulfReadiness.salary_range} · {gulfReadiness.trade?.replace(/-/g, ' ')}
          </p>
        </div>
      )}

      {/* Recent Verifications (who checked my credentials) */}
      {recentVerifications.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
          <h4 className="text-sm font-bold dark:text-white mb-3">🔍 {t('Recent Verifications')}</h4>
          <div className="space-y-2">
            {recentVerifications.map((v, i) => (
              <div key={i} className="flex items-start gap-3 text-xs">
                <span className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${
                  v.verificationResult === 'VALID' ? 'bg-green-500' :
                  v.verificationResult === 'NOT_FOUND' ? 'bg-gray-400' : 'bg-amber-400'
                }`} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium dark:text-white truncate">{v.credentialTitle}</p>
                  <p className="text-gray-400">
                    {v.verifierType?.replace(/_/g, ' ')} · {v.location} · {new Date(v.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <span className={`font-semibold flex-shrink-0 ${
                  v.verificationResult === 'VALID' ? 'text-green-600' :
                  v.verificationResult === 'NOT_FOUND' ? 'text-gray-400' : 'text-amber-600'
                }`}>
                  {v.verificationResult}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
