import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';

// ── Status configuration ──────────────────────────────────────────────────────
const STATUS_CONFIG = {
  active:   { label: 'VALID',   bg: 'bg-green-500',  text: 'text-green-700',  ring: 'ring-green-400', dark: 'dark:text-green-300', icon: '✓' },
  ACTIVE:   { label: 'VALID',   bg: 'bg-green-500',  text: 'text-green-700',  ring: 'ring-green-400', dark: 'dark:text-green-300', icon: '✓' },
  revoked:  { label: 'REVOKED', bg: 'bg-red-500',    text: 'text-red-700',    ring: 'ring-red-400',   dark: 'dark:text-red-300',   icon: '✕' },
  REVOKED:  { label: 'REVOKED', bg: 'bg-red-500',    text: 'text-red-700',    ring: 'ring-red-400',   dark: 'dark:text-red-300',   icon: '✕' },
  expired:  { label: 'EXPIRED', bg: 'bg-amber-500',  text: 'text-amber-700',  ring: 'ring-amber-400', dark: 'dark:text-amber-300', icon: '⏰' },
  EXPIRED:  { label: 'EXPIRED', bg: 'bg-amber-500',  text: 'text-amber-700',  ring: 'ring-amber-400', dark: 'dark:text-amber-300', icon: '⏰' },
  pending:  { label: 'PENDING', bg: 'bg-blue-500',   text: 'text-blue-700',   ring: 'ring-blue-400',  dark: 'dark:text-blue-300',  icon: '⋯' },
};

const NQF_COLORS = ['', 'bg-slate-500', 'bg-blue-500', 'bg-indigo-500', 'bg-purple-500',
                        'bg-violet-600', 'bg-fuchsia-600', 'bg-rose-600', 'bg-red-700'];

function NQFBadge({ level }) {
  if (!level) return null;
  const color = NQF_COLORS[level] || 'bg-slate-500';
  return (
    <span className={`inline-flex items-center gap-1 ${color} text-white text-xs font-bold px-2.5 py-1 rounded-full`}>
      NQF {level}
    </span>
  );
}

function FieldRow({ label, value, mono, className = '' }) {
  if (!value) return null;
  return (
    <div className={`flex items-center justify-between py-2 border-b border-gray-100 dark:border-slate-700 last:border-0 ${className}`}>
      <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0 w-28">{label}</span>
      <span className={`text-sm font-medium dark:text-white text-right break-all ${mono ? 'font-mono text-xs text-gray-600 dark:text-gray-300' : ''}`}>
        {value}
      </span>
    </div>
  );
}

function BlockchainBadge({ verification, credentialId }) {
  if (!verification) return null;
  const { proofValid, method, issuer, signatureType } = verification;
  return (
    <div className={`flex items-center gap-3 p-3 rounded-xl ${proofValid ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800' : 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800'}`}>
      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-xl font-bold flex-shrink-0 ${proofValid ? 'bg-green-500' : 'bg-amber-500'}`}>
        {proofValid ? '⛓' : '⚠'}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-bold ${proofValid ? 'text-green-700 dark:text-green-300' : 'text-amber-700 dark:text-amber-300'}`}>
          {proofValid ? 'Cryptographic Proof Verified' : 'Proof Unverifiable'}
        </p>
        {method && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{signatureType || method}</p>}
        {issuer && <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{issuer}</p>}
      </div>
    </div>
  );
}

function SharePanel({ credentialId }) {
  const url = `${window.location.origin}/verify/${credentialId}`;
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  return (
    <div className="mt-5 p-4 bg-gray-50 dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700">
      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Share Verification Link</p>
      <div className="flex gap-2">
        <input readOnly value={url}
          className="flex-1 text-xs font-mono px-3 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-600 rounded-lg text-gray-600 dark:text-gray-300 outline-none" />
        <button onClick={copy}
          className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors ${copied ? 'bg-green-500 text-white' : 'bg-slate-800 dark:bg-slate-600 text-white hover:bg-slate-700'}`}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

function CredentialCard({ result }) {
  const status = STATUS_CONFIG[result.status] || STATUS_CONFIG['pending'];
  const qrUrl = `/lms/api/verification/qr?size=140&data=${encodeURIComponent(`${window.location.origin}/verify/${result.credentialId}`)}`;
  const isValid = result.status === 'active' || result.status === 'ACTIVE';
  const isRevoked = result.status === 'revoked' || result.status === 'REVOKED';

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden shadow-lg">

      {/* Status Banner */}
      <div className={`${status.bg} px-6 py-4 flex items-center justify-between`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white text-xl font-black">
            {status.icon}
          </div>
          <div>
            <p className="text-white text-xs font-semibold opacity-80 uppercase tracking-widest">Credential Status</p>
            <p className="text-white text-2xl font-black leading-tight">{status.label}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-white/70 text-[10px] uppercase tracking-wide">Verified</p>
          <p className="text-white font-bold text-sm">{result.verificationCount}×</p>
        </div>
      </div>

      {/* Main Body */}
      <div className="p-5 space-y-5">

        {/* Worker Identity Card */}
        <div className="flex gap-4 p-4 bg-slate-50 dark:bg-slate-900 rounded-xl">
          {/* Avatar */}
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center text-2xl font-black text-white flex-shrink-0 overflow-hidden ring-2 ring-white dark:ring-slate-600 shadow">
            {result.worker?.name?.charAt(0)?.toUpperCase() || '?'}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-black text-gray-900 dark:text-white leading-tight truncate">
              {result.worker?.name || '—'}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 font-mono mt-0.5">{result.worker?.cnicMasked || ''}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{result.worker?.district || ''}</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <NQFBadge level={result.nqfLevel} />
              {result.worker?.registrationId && (
                <span className="text-[10px] font-mono bg-gray-200 dark:bg-slate-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded">
                  {result.worker.registrationId}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Credential Details */}
        <div className="flex gap-4">
          {/* Details */}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">Credential</p>
            <h4 className="text-base font-bold text-gray-900 dark:text-white leading-snug">{result.title || result.type || '—'}</h4>
            {result.trade && (
              <span className="mt-1.5 inline-block text-xs font-semibold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2.5 py-1 rounded-lg capitalize">
                {result.trade.replace(/-/g, ' ')}
              </span>
            )}
          </div>
          {/* QR Code */}
          <div className="flex-shrink-0 text-center">
            <div className="bg-white p-1.5 rounded-xl shadow-sm border border-gray-200 dark:border-slate-600 inline-block">
              <img src={qrUrl} alt="Verify QR" className="w-[70px] h-[70px]" />
            </div>
            <p className="text-[9px] text-gray-400 mt-1">Scan to verify</p>
          </div>
        </div>

        {/* Field Rows */}
        <div className="bg-gray-50 dark:bg-slate-900 rounded-xl px-4 py-1">
          <FieldRow label="Credential ID"   value={result.credentialId} mono />
          <FieldRow label="Institution"     value={result.institution} />
          <FieldRow label="Issued By"       value={result.issuedBy} />
          <FieldRow label="Valid From"      value={result.validFrom?.split('T')[0]} />
          <FieldRow label="Valid Until"     value={result.validUntil?.split('T')[0] || 'No Expiry'} />
          <FieldRow label="Last Verified"   value={result.lastVerifiedAt ? new Date(result.lastVerifiedAt).toLocaleString() : null} />
        </div>

        {/* Revocation Notice */}
        {isRevoked && (
          <div className="flex gap-3 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
            <span className="text-red-500 text-xl">⛔</span>
            <div>
              <p className="text-sm font-bold text-red-700 dark:text-red-300">Credential Revoked</p>
              <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                {result.revokedAt ? `Date: ${result.revokedAt.split('T')[0]}` : ''}
                {result.revokedReason ? ` — ${result.revokedReason}` : ''}
              </p>
            </div>
          </div>
        )}

        {/* Blockchain / Cryptographic Proof */}
        <div>
          <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">Security</p>
          <BlockchainBadge verification={result.verification} />
        </div>

        {/* Share */}
        <SharePanel credentialId={result.credentialId} />
      </div>
    </div>
  );
}

// ── EDC-style verification checks panel ──
function ChecksPanel({ data }) {
  if (!data?.checks) return null;
  const verified = data.overall === 'VERIFIED';
  const order = ['format', 'seal', 'owner', 'revocation', 'accreditation', 'validity'];
  const rows = order.map(k => data.checks[k]).filter(Boolean);
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden shadow-lg">
      <div className={`px-6 py-4 flex items-center justify-between ${verified ? 'bg-green-600' : 'bg-amber-500'}`}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-white text-lg font-black">
            {verified ? '✓' : '!'}
          </div>
          <div>
            <p className="text-white text-[10px] font-semibold opacity-80 uppercase tracking-widest">Verification result</p>
            <p className="text-white text-xl font-black leading-tight">{verified ? 'VERIFIED' : 'PARTIALLY VERIFIED'}</p>
          </div>
        </div>
        <span className="text-white/90 text-sm font-bold">{data.checksPassed} checks</span>
      </div>
      <div className="p-4 space-y-2">
        {rows.map((c, i) => (
          <div key={i} className="flex items-start gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900">
            <span className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${c.passed ? 'bg-green-500' : 'bg-red-500'}`}>
              {c.passed ? '✓' : '✗'}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-gray-900 dark:text-white">{c.name}{c.signatureType ? ` · ${c.signatureType}` : ''}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{c.detail}</p>
            </div>
          </div>
        ))}
      </div>
      {data.independentlyVerifiableAt && (
        <div className="px-4 pb-4">
          <p className="text-[11px] text-gray-400 dark:text-gray-500">
            Independently verifiable: this credential is signed with the issuer key published at{' '}
            <a href={data.independentlyVerifiableAt.jwks} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 underline break-all">/.well-known/jwks.json</a>
            {' '}(<span className="font-mono">{data.independentlyVerifiableAt.did}</span>). Anyone can validate the signed VC without contacting TalentLedger.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Verification() {
  const { credentialId: paramId } = useParams();
  const [input, setInput] = useState(paramId || '');
  const [result, setResult] = useState(null);
  const [checks, setChecks] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  const verify = async (id) => {
    const cid = (id || input).trim().toUpperCase();
    // Accepts registry IDs (TL-2026-00001) and LMS/unit certs (TL-LMS-00056, TL-UNIT-00001).
    if (!/^TL-[A-Z0-9]{2,6}-\d{5}$/.test(cid)) {
      setError('Invalid format. Expected: TL-XXXX-NNNNN');
      inputRef.current?.focus();
      return;
    }
    setLoading(true); setError(''); setResult(null); setChecks(null);
    try {
      const [{ data }, full] = await Promise.all([
        axios.get(`/lms/api/verification/${cid}`),
        axios.get(`/lms/api/verification/${cid}/full`).catch(() => null),
      ]);
      setResult(data);
      if (full?.data) setChecks(full.data);
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.message || 'Verification failed. Check the credential ID and try again.');
    } finally { setLoading(false); }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (paramId) verify(paramId); }, [paramId]);

  const handleKey = (e) => { if (e.key === 'Enter') verify(); };

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-slate-950 py-10 px-4">
      <div className="w-full max-w-lg mx-auto space-y-6">

        {/* Header */}
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-800 mx-auto flex items-center justify-center mb-4 shadow-lg">
            <span className="text-2xl font-black text-amber-400">NSP</span>
          </div>
          <h1 className="text-2xl font-black text-gray-900 dark:text-white">Credential Verification</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Instant, tamper-proof verification of TalentLedger credentials</p>
        </div>

        {/* Search Bar */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow border border-gray-200 dark:border-slate-700">
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
            Enter Credential ID
          </label>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => { setInput(e.target.value.toUpperCase()); setError(''); }}
              onKeyDown={handleKey}
              placeholder="TL-2026-00001"
              className="flex-1 px-4 py-3 border border-gray-200 dark:border-slate-600 rounded-xl text-sm font-mono bg-gray-50 dark:bg-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none placeholder:text-gray-400 uppercase"
              autoComplete="off"
              spellCheck="false"
            />
            <button
              onClick={() => verify()}
              disabled={loading}
              className="px-6 py-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-60 text-white font-bold rounded-xl transition-colors text-sm min-w-[90px]"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                  </svg>
                  <span>...</span>
                </span>
              ) : 'Verify'}
            </button>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">Format: TL-YYYY-NNNNN (e.g. TL-2026-00001)</p>
        </div>

        {/* Error */}
        {error && (
          <div className="flex gap-3 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
            <span className="text-red-500 text-lg flex-shrink-0">⚠</span>
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        {/* Loading Skeleton */}
        {loading && !result && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden shadow-lg animate-pulse">
            <div className="h-20 bg-gray-200 dark:bg-slate-700" />
            <div className="p-5 space-y-4">
              <div className="flex gap-4">
                <div className="w-16 h-16 rounded-full bg-gray-200 dark:bg-slate-700" />
                <div className="flex-1 space-y-2">
                  <div className="h-5 bg-gray-200 dark:bg-slate-700 rounded w-3/4" />
                  <div className="h-3 bg-gray-200 dark:bg-slate-700 rounded w-1/2" />
                </div>
              </div>
              <div className="space-y-2">
                {[1,2,3,4].map(i => <div key={i} className="h-3 bg-gray-200 dark:bg-slate-700 rounded" />)}
              </div>
            </div>
          </div>
        )}

        {/* EDC-style 6-check result */}
        {checks && !loading && <ChecksPanel data={checks} />}

        {/* Result Card */}
        {result && !loading && <CredentialCard result={result} />}

        {/* Footer */}
        <p className="text-center text-xs text-gray-400 dark:text-gray-600 pb-4">
          Powered by TalentLedger — National Skills Credential Registry
        </p>
      </div>
    </div>
  );
}
