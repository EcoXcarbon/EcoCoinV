import { useEffect, useState, useCallback } from 'react';
import api from '../api/client';
import toast from 'react-hot-toast';

const COUNTRIES = [
  'United Arab Emirates', 'Saudi Arabia', 'Qatar', 'Kuwait', 'Oman', 'Bahrain',
  'Pakistan', 'India', 'Bangladesh', 'Philippines', 'Indonesia', 'Sri Lanka',
  'Germany', 'United Kingdom', 'France', 'Netherlands', 'Poland', 'Spain', 'Italy',
  'Malaysia', 'Singapore', 'South Korea', 'Japan',
  'Australia', 'New Zealand',
  'United States', 'Canada', 'Brazil',
  'South Africa', 'Nigeria', 'Kenya', 'Egypt',
  'Turkey', 'Jordan', 'Iraq',
];

const SECTORS = [
  'Construction', 'Oil & Gas', 'Healthcare', 'IT & Technology', 'Manufacturing',
  'Hospitality', 'Retail', 'Finance & Banking', 'Education', 'Logistics & Transport',
  'Telecommunications', 'Agriculture', 'Mining', 'Real Estate', 'Security Services',
  'Labour Recruitment',
];

const TYPE_LABELS = {
  DIRECT_EMPLOYER: 'Direct Employer',
  RECRUITMENT_AGENCY: 'Recruitment Agency',
  CONTRACTOR: 'Contractor',
  STAFFING_AGENCY: 'Staffing Agency',
};

const HIRING_COLORS = {
  ACTIVELY_HIRING: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  OCCASIONALLY: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  NOT_HIRING: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
};

const VERIFIED_BADGE = {
  VERIFIED: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  PENDING: 'bg-orange-100 text-orange-700',
  UNVERIFIED: 'bg-gray-100 text-gray-400',
};

export default function Companies() {
  const [companies, setCompanies] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [q, setQ] = useState('');
  const [country, setCountry] = useState('');
  const [sector, setSector] = useState('');
  const [type, setType] = useState('');
  const [hiringStatus, setHiringStatus] = useState('');

  const load = useCallback((pg = 1) => {
    setLoading(true);
    const params = { page: pg, limit: 24 };
    if (q.trim()) params.q = q.trim();
    if (country) params.country = country;
    if (sector) params.sector = sector;
    if (type) params.type = type;
    if (hiringStatus) params.hiringStatus = hiringStatus;
    api.get('/companies', { params })
      .then(r => {
        setCompanies(r.data.companies || []);
        setTotal(r.data.total || 0);
        setPages(r.data.pages || 1);
        setPage(pg);
      })
      .catch(() => toast.error('Failed to load companies'))
      .finally(() => setLoading(false));
  }, [q, country, sector, type, hiringStatus]);

  useEffect(() => { load(1); }, [load]);

  useEffect(() => {
    api.get('/companies/stats/overview').then(r => setStats(r.data)).catch(() => {});
  }, []);

  const handleSearch = e => { e.preventDefault(); load(1); };

  const clearFilters = () => {
    setQ(''); setCountry(''); setSector(''); setType(''); setHiringStatus('');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold dark:text-white">Employer Directory</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {total.toLocaleString()} companies worldwide
          </p>
        </div>
      </div>

      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total', value: stats.total?.toLocaleString(), color: 'text-blue-600' },
            { label: 'Actively Hiring', value: stats.activelyHiring?.toLocaleString(), color: 'text-green-600' },
            { label: 'Verified', value: stats.verified?.toLocaleString(), color: 'text-indigo-600' },
            { label: 'Countries', value: stats.byCountry?.length, color: 'text-amber-600' },
          ].map(s => (
            <div key={s.label} className="bg-white dark:bg-navy-mid rounded-xl border border-gray-200 dark:border-navy-light p-4 text-center">
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <form onSubmit={handleSearch} className="bg-white dark:bg-navy-mid rounded-xl border border-gray-200 dark:border-navy-light p-4 space-y-3">
        <div className="flex gap-2">
          <input
            type="text" value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search by company name..."
            className="flex-1 px-4 py-2 border border-gray-200 dark:border-navy-light rounded-xl text-sm bg-white dark:bg-navy dark:text-white focus:outline-none focus:ring-2 focus:ring-ilo-blue"
          />
          <button type="submit" className="px-5 py-2 bg-ilo-blue hover:bg-ilo-dark text-white text-sm font-semibold rounded-xl">
            Search
          </button>
          <button type="button" onClick={clearFilters} className="px-4 py-2 text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-navy-light rounded-xl">
            Clear
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <select value={country} onChange={e => setCountry(e.target.value)}
            className="px-3 py-2 border border-gray-200 dark:border-navy-light rounded-xl text-sm bg-white dark:bg-navy dark:text-white">
            <option value="">All Countries</option>
            {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={sector} onChange={e => setSector(e.target.value)}
            className="px-3 py-2 border border-gray-200 dark:border-navy-light rounded-xl text-sm bg-white dark:bg-navy dark:text-white">
            <option value="">All Sectors</option>
            {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={type} onChange={e => setType(e.target.value)}
            className="px-3 py-2 border border-gray-200 dark:border-navy-light rounded-xl text-sm bg-white dark:bg-navy dark:text-white">
            <option value="">All Types</option>
            {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select value={hiringStatus} onChange={e => setHiringStatus(e.target.value)}
            className="px-3 py-2 border border-gray-200 dark:border-navy-light rounded-xl text-sm bg-white dark:bg-navy dark:text-white">
            <option value="">All Hiring Status</option>
            <option value="ACTIVELY_HIRING">Actively Hiring</option>
            <option value="OCCASIONALLY">Occasionally</option>
            <option value="NOT_HIRING">Not Hiring</option>
          </select>
        </div>
      </form>

      {/* Grid */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin w-8 h-8 border-4 border-ilo-blue border-t-transparent rounded-full" />
        </div>
      ) : companies.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-navy-mid rounded-xl border border-gray-200 dark:border-navy-light">
          <p className="text-4xl mb-3">🏢</p>
          <p className="text-sm text-gray-500">No companies found. Try adjusting your filters.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {companies.map(c => (
              <div
                key={c._id}
                onClick={() => setSelected(c)}
                className="bg-white dark:bg-navy-mid rounded-xl border border-gray-200 dark:border-navy-light p-5 hover:shadow-md hover:border-ilo-blue/40 transition-all cursor-pointer"
              >
                {/* Top row */}
                <div className="flex items-start justify-between mb-2 gap-2">
                  <h3 className="text-sm font-bold dark:text-white leading-tight line-clamp-2">{c.name}</h3>
                  <span className={`shrink-0 px-2 py-0.5 text-[10px] font-semibold rounded-full whitespace-nowrap ${HIRING_COLORS[c.hiringStatus]}`}>
                    {c.hiringStatus === 'ACTIVELY_HIRING' ? 'Hiring' : c.hiringStatus === 'OCCASIONALLY' ? 'Sometimes' : 'Not Hiring'}
                  </span>
                </div>

                {/* Location + sector */}
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                  {c.location?.city ? `${c.location.city}, ` : ''}{c.location?.country}
                </p>
                <p className="text-xs text-gray-600 dark:text-gray-300 mb-3">{c.sector}</p>

                {/* Tags */}
                <div className="flex flex-wrap gap-1.5">
                  <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                    {TYPE_LABELS[c.type] || c.type}
                  </span>
                  {c.verificationStatus === 'VERIFIED' && (
                    <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                      ✓ Verified
                    </span>
                  )}
                  {c.registration?.beoeNumber && (
                    <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-green-100 text-green-700">
                      BEOE
                    </span>
                  )}
                  {c.registration?.mohreNumber && (
                    <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-amber-100 text-amber-700">
                      MOHRE
                    </span>
                  )}
                  <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                    {c.size}
                  </span>
                </div>

                {/* Trades */}
                {c.trades?.length > 0 && (
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-2 truncate">
                    {c.trades.slice(0, 3).join(' · ')}
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Pagination */}
          {pages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                onClick={() => load(page - 1)}
                disabled={page <= 1}
                className="px-4 py-2 text-sm font-semibold rounded-xl border border-gray-200 dark:border-navy-light disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-navy-light dark:text-white"
              >
                ← Prev
              </button>
              <span className="text-sm text-gray-500 dark:text-gray-400 px-3">
                Page {page} of {pages}
              </span>
              <button
                onClick={() => load(page + 1)}
                disabled={page >= pages}
                className="px-4 py-2 text-sm font-semibold rounded-xl border border-gray-200 dark:border-navy-light disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-navy-light dark:text-white"
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}

      {/* Detail modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setSelected(null)}>
          <div
            className="bg-white dark:bg-navy-mid rounded-2xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold dark:text-white">{selected.name}</h3>
                {selected.nameLocal && <p className="text-sm text-gray-500 mt-0.5">{selected.nameLocal}</p>}
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none ml-2">×</button>
            </div>

            {/* Status badges */}
            <div className="flex flex-wrap gap-2 mb-5">
              <span className={`px-3 py-1 text-xs font-semibold rounded-full ${HIRING_COLORS[selected.hiringStatus]}`}>
                {selected.hiringStatus?.replace(/_/g, ' ')}
              </span>
              <span className={`px-3 py-1 text-xs font-semibold rounded-full ${VERIFIED_BADGE[selected.verificationStatus]}`}>
                {selected.verificationStatus}
              </span>
              <span className="px-3 py-1 text-xs font-semibold rounded-full bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                {TYPE_LABELS[selected.type] || selected.type}
              </span>
              <span className="px-3 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                {selected.size}
              </span>
            </div>

            {/* Details grid */}
            <div className="space-y-3 text-sm">
              <Row label="Location" value={[selected.location?.city, selected.location?.country].filter(Boolean).join(', ')} />
              <Row label="Sector" value={selected.sector} />
              {selected.trades?.length > 0 && <Row label="Trades" value={selected.trades.join(', ')} />}
              {selected.contact?.website && <Row label="Website" value={<a href={selected.contact.website} target="_blank" rel="noopener noreferrer" className="text-ilo-blue hover:underline">{selected.contact.website}</a>} />}
              {selected.contact?.email && <Row label="Email" value={selected.contact.email} />}
              {selected.contact?.phone && <Row label="Phone" value={selected.contact.phone} />}
              {selected.registration?.beoeNumber && <Row label="BEOE No." value={selected.registration.beoeNumber} />}
              {selected.registration?.mohreNumber && <Row label="MOHRE No." value={selected.registration.mohreNumber} />}
              {selected.registration?.pecNumber && <Row label="PEC No." value={selected.registration.pecNumber} />}
              <Row label="Company ID" value={<span className="font-mono text-xs">{selected.companyId}</span>} />
            </div>

            <button
              onClick={() => setSelected(null)}
              className="mt-6 w-full py-2.5 text-sm font-semibold bg-gray-100 hover:bg-gray-200 dark:bg-navy-light dark:hover:bg-navy dark:text-white rounded-xl"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex gap-3">
      <span className="text-gray-500 dark:text-gray-400 w-28 shrink-0 text-xs pt-0.5">{label}</span>
      <span className="dark:text-white text-xs flex-1">{value}</span>
    </div>
  );
}
