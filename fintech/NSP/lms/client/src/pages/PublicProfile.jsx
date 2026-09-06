import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';

const NQF_COLORS = ['', 'bg-slate-500', 'bg-blue-500', 'bg-indigo-500', 'bg-purple-500',
                        'bg-violet-600', 'bg-fuchsia-600', 'bg-rose-600', 'bg-red-700'];

function NQFBadge({ level }) {
  if (!level) return null;
  const color = NQF_COLORS[level] || 'bg-slate-500';
  return <span className={`${color} text-white text-[10px] font-bold px-2 py-0.5 rounded-full`}>NQF {level}</span>;
}

function CredentialRow({ cred, onVerify }) {
  return (
    <div className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 hover:border-green-300 dark:hover:border-green-600 transition-colors">
      <div className="w-9 h-9 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0 text-green-600 dark:text-green-400 font-black text-sm">
        ✓
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-gray-900 dark:text-white leading-tight">{cred.title || cred.type}</p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {cred.trade && (
            <span className="text-[10px] font-semibold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded capitalize">
              {cred.trade.replace(/-/g, ' ')}
            </span>
          )}
          <NQFBadge level={cred.nqfLevel} />
        </div>
        {cred.institution && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{cred.institution}</p>}
        {cred.validUntil && (
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
            Valid until {cred.validUntil.split('T')[0]}
          </p>
        )}
      </div>
      <button
        onClick={() => onVerify(cred.credentialId)}
        className="flex-shrink-0 text-[10px] font-semibold text-blue-600 dark:text-blue-400 hover:underline px-2 py-1"
      >
        Verify →
      </button>
    </div>
  );
}

export default function PublicProfile() {
  const { workerId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get(`/lms/api/verification/profile/${workerId}`)
      .then(r => setData(r.data))
      .catch(err => setError(err.response?.data?.error || 'Profile not found'))
      .finally(() => setLoading(false));
  }, [workerId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 dark:bg-slate-950 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 border-4 border-slate-800 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading profile...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-100 dark:bg-slate-950 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 text-center max-w-sm w-full shadow-lg">
          <div className="text-5xl mb-4">⚠️</div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Profile Not Found</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">{error}</p>
        </div>
      </div>
    );
  }

  const { worker, credentials } = data;

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-slate-950 py-8 px-4">
      <div className="max-w-lg mx-auto space-y-5">

        {/* TalentLedger Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center">
              <span className="text-xs font-black text-amber-400">NSP</span>
            </div>
            <span className="text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wide">National Skills Registry</span>
          </div>
          <span className="text-[10px] text-gray-400 dark:text-gray-500">Public Profile</span>
        </div>

        {/* Worker Identity Card */}
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-6 text-white shadow-xl">
          <div className="flex gap-4 items-start">
            {/* Photo / Avatar */}
            <div className="w-20 h-20 rounded-full bg-slate-600 flex items-center justify-center text-3xl font-black flex-shrink-0 overflow-hidden ring-2 ring-white/20 shadow-lg">
              {worker.photo ? (
                <img src={worker.photo} alt="" className="w-full h-full object-cover" />
              ) : (
                (worker.fullName || 'U').charAt(0).toUpperCase()
              )}
            </div>

            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-black leading-tight">{worker.fullName}</h1>
              {worker.fullNameUrdu && (
                <p className="text-sm text-slate-300 font-urdu mt-0.5" dir="rtl">{worker.fullNameUrdu}</p>
              )}
              <p className="text-xs text-slate-400 font-mono mt-1">{worker.cnicMasked || ''}</p>
              <p className="text-xs text-slate-400 mt-0.5">{worker.district || ''}</p>

              {/* Badges row */}
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                {worker.nadraVerified && (
                  <span className="inline-flex items-center gap-1 bg-green-500/20 text-green-300 text-[10px] font-semibold px-2 py-0.5 rounded-full">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                    NADRA Verified
                  </span>
                )}
                {worker.nqfLevel && (
                  <span className="bg-amber-500/20 text-amber-300 text-[10px] font-bold px-2 py-0.5 rounded-full">NQF {worker.nqfLevel}</span>
                )}
              </div>
            </div>
          </div>

          {/* Trade & Registration */}
          <div className="mt-4 flex items-center justify-between pt-4 border-t border-white/10">
            <div>
              {worker.trade && (
                <span className="bg-blue-500/20 text-blue-300 text-xs font-semibold px-2.5 py-1 rounded-lg capitalize">
                  {worker.trade.replace(/-/g, ' ')}
                </span>
              )}
            </div>
            {worker.registrationId && (
              <span className="text-xs font-mono text-slate-400">{worker.registrationId}</span>
            )}
          </div>
        </div>

        {/* Credentials */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden shadow">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-gray-900 dark:text-white">Verified Credentials</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{credentials.length} active credential{credentials.length !== 1 ? 's' : ''}</p>
            </div>
            <div className="w-9 h-9 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-green-600 dark:text-green-400 font-black">
              {credentials.length}
            </div>
          </div>

          <div className="p-4 space-y-3">
            {credentials.length === 0 ? (
              <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-6">No active credentials on record</p>
            ) : (
              credentials.map(cred => (
                <CredentialRow
                  key={cred.credentialId}
                  cred={cred}
                  onVerify={id => navigate(`/verify/${id}`)}
                />
              ))
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center space-y-1 pb-4">
          <p className="text-xs text-gray-400 dark:text-gray-600">
            Verified on {new Date(data.generatedAt).toLocaleDateString('en-PK', { dateStyle: 'long' })}
          </p>
          <p className="text-[10px] text-gray-300 dark:text-gray-700">
            NSP Learning — National Skill Passport, Pakistan
          </p>
        </div>
      </div>
    </div>
  );
}
