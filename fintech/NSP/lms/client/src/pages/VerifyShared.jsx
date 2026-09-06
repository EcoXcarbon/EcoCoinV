import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/client';

// Public page for a shared-credentials link (/verify/shared/:shareId).
// Renders only the fields the holder chose to disclose. No auth required.

const FIELD_LABELS = {
  title: 'Title',
  credentialType: 'Type',
  issuerName: 'Issuer',
  status: 'Status',
  issuanceDate: 'Issue Date',
  expiryDate: 'Expiry Date',
  nqfLevel: 'NQF Level',
  trade: 'Trade',
  credentialId: 'Credential ID',
  blockchainTxHash: 'Blockchain Anchor',
};

const DATE_FIELDS = new Set(['issuanceDate', 'expiryDate']);

function fmt(field, value) {
  if (value == null || value === '') return null;
  if (DATE_FIELDS.has(field)) {
    const d = new Date(value);
    return isNaN(d) ? String(value) : d.toLocaleDateString();
  }
  if (field === 'credentialType') return String(value).replace(/_/g, ' ');
  return String(value);
}

function statusPill(status) {
  const s = String(status || '').toUpperCase();
  const cls = s === 'ACTIVE'
    ? 'bg-green-100 text-green-700'
    : s === 'REVOKED' ? 'bg-red-100 text-red-700'
    : s === 'EXPIRED' ? 'bg-amber-100 text-amber-700'
    : 'bg-gray-100 text-gray-600';
  return <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full uppercase ${cls}`}>{s || 'UNKNOWN'}</span>;
}

export default function VerifyShared() {
  const { shareId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/public/shared/${shareId}`)
      .then(r => setData(r.data))
      .catch(e => setError(e?.response?.data?.error || 'This share link is invalid or has expired.'))
      .finally(() => setLoading(false));
  }, [shareId]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0072BC] to-[#003a63] py-10 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-6 text-white">
          <div className="inline-flex items-center gap-2 mb-2">
            <span className="w-9 h-9 rounded-lg bg-white text-[#0072BC] font-black flex items-center justify-center">NSP</span>
            <span className="text-lg font-bold">NSP Learning</span>
          </div>
          <p className="text-sm text-blue-100">Verified Credential Share · Pakistan National Skills Passport</p>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin w-10 h-10 border-4 border-white border-t-transparent rounded-full" />
          </div>
        ) : error ? (
          <div className="bg-white rounded-2xl p-8 text-center shadow-xl">
            <p className="text-4xl mb-3">🔗</p>
            <p className="text-lg font-bold text-gray-800">Link unavailable</p>
            <p className="text-sm text-gray-500 mt-1">{error}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Meta card */}
            <div className="bg-white rounded-2xl p-5 shadow-xl">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-400">Shared by</p>
                  <p className="text-sm font-bold text-gray-800">Holder ID {data.sharedBy}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-400">Valid until</p>
                  <p className="text-sm font-semibold text-gray-700">
                    {data.expiresAt ? new Date(data.expiresAt).toLocaleDateString() : '—'}
                  </p>
                </div>
              </div>
              {data.purpose && (
                <p className="mt-2 text-xs text-gray-500">Purpose: <span className="font-medium text-gray-700">{data.purpose}</span></p>
              )}
              <p className="mt-2 text-[11px] text-gray-400">
                {(data.credentials || []).length} credential(s) shared · selective disclosure applied
              </p>
            </div>

            {/* Credential cards */}
            {(data.credentials || []).map((c, i) => {
              const fields = (c._disclosedFields || Object.keys(c)).filter(
                f => FIELD_LABELS[f] && f !== 'title' && fmt(f, c[f]) != null
              );
              return (
                <div key={c.credentialId || i} className="bg-white rounded-2xl p-5 shadow-xl">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <h3 className="text-base font-bold text-gray-800">{c.title || 'Credential'}</h3>
                    {c.status != null && statusPill(c.status)}
                  </div>
                  <div className="divide-y divide-gray-100">
                    {fields.map(f => (
                      <div key={f} className="flex items-center justify-between py-2">
                        <span className="text-xs text-gray-500 w-32 flex-shrink-0">{FIELD_LABELS[f]}</span>
                        <span className={`text-sm font-medium text-gray-800 text-right break-all ${f === 'credentialId' || f === 'blockchainTxHash' ? 'font-mono text-xs text-gray-600' : ''}`}>
                          {fmt(f, c[f])}
                        </span>
                      </div>
                    ))}
                    {fields.length === 0 && (
                      <p className="text-xs text-gray-400 py-2">Only the title was disclosed for this credential.</p>
                    )}
                  </div>
                </div>
              );
            })}

            <p className="text-center text-[11px] text-blue-100 pt-2">
              Credentials verified against the TalentLedger registry. © 2026
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
