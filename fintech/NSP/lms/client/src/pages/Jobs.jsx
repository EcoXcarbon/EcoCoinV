import { useEffect, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

const TRADES = ['mason','electrician','welder','plumber','carpenter','steel-fixer','painter','hvac','pipe-fitter','scaffolder','rigger','crane-operator','heavy-driver','shuttering-carpenter','tile-fixer','duct-fabricator','auto-mechanic','diesel-mechanic','fabricator','insulation-worker','heavy-equipment-operator','aluminium-fabricator','safety-officer','cook','ac-technician'];

export default function Jobs() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tradeFilter, setTradeFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [coverNote, setCoverNote] = useState('');
  const [applying, setApplying] = useState(false);
  const [myApps, setMyApps] = useState([]);
  const [tab, setTab] = useState('browse');

  const isEmployer = user?.role === 'employer' || user?.role === 'admin';

  useEffect(() => {
    loadJobs();
    if (user?.role === 'worker') loadMyApps();
  }, [search, tradeFilter]);

  const loadJobs = () => {
    setLoading(true);
    const params = { limit: 50 };
    if (search) params.search = search;
    if (tradeFilter) params.trade = tradeFilter;
    api.get('/jobs', { params })
      .then(r => setJobs(r.data.jobs || []))
      .catch(() => toast.error('Failed to load jobs'))
      .finally(() => setLoading(false));
  };

  const loadMyApps = () => {
    api.get('/jobs/my/applications')
      .then(r => setMyApps(r.data.applications || []))
      .catch(() => {});
  };

  const handleApply = async (jobId) => {
    setApplying(true);
    try {
      await api.post(`/jobs/${jobId}/apply`, { coverNote });
      toast.success('Application submitted!');
      setCoverNote('');
      setSelected(null);
      loadJobs();
      loadMyApps();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Application failed');
    } finally { setApplying(false); }
  };

  const statusColors = {
    applied: 'bg-blue-100 text-blue-700', shortlisted: 'bg-green-100 text-green-700',
    interviewed: 'bg-purple-100 text-purple-700', offered: 'bg-emerald-100 text-emerald-700',
    rejected: 'bg-red-100 text-red-700', withdrawn: 'bg-gray-100 text-gray-500',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold dark:text-white">Jobs</h2>
        {user?.role === 'worker' && (
          <div className="flex gap-2">
            <button onClick={() => setTab('browse')} className={`px-4 py-1.5 text-xs font-semibold rounded-lg ${tab === 'browse' ? 'bg-ilo-blue text-white' : 'bg-gray-100 dark:bg-navy-light text-gray-600 dark:text-gray-400'}`}>Browse</button>
            <button onClick={() => setTab('applications')} className={`px-4 py-1.5 text-xs font-semibold rounded-lg ${tab === 'applications' ? 'bg-ilo-blue text-white' : 'bg-gray-100 dark:bg-navy-light text-gray-600 dark:text-gray-400'}`}>My Applications ({myApps.length})</button>
          </div>
        )}
      </div>

      {tab === 'browse' && (
        <>
          <div className="flex flex-wrap gap-3">
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search jobs..."
              className="px-4 py-2 border border-gray-200 dark:border-navy-light rounded-xl text-sm bg-white dark:bg-navy dark:text-white flex-1 min-w-48" />
            <select value={tradeFilter} onChange={e => setTradeFilter(e.target.value)}
              className="px-4 py-2 border border-gray-200 dark:border-navy-light rounded-xl text-sm bg-white dark:bg-navy dark:text-white">
              <option value="">All Trades</option>
              {TRADES.map(t => <option key={t} value={t}>{t.replace(/-/g, ' ')}</option>)}
            </select>
          </div>

          {loading ? (
            <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-ilo-blue border-t-transparent rounded-full" /></div>
          ) : jobs.length === 0 ? (
            <div className="text-center py-12 bg-white dark:bg-navy-mid rounded-xl border border-gray-200 dark:border-navy-light">
              <p className="text-sm text-gray-500">No jobs found. {tradeFilter ? 'Try a different trade.' : 'Check back later.'}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {jobs.map(j => (
                <div key={j._id} className="bg-white dark:bg-navy-mid rounded-xl border border-gray-200 dark:border-navy-light p-5 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="text-sm font-bold dark:text-white">{j.title}</h3>
                    {j.myApplicationStatus && <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full capitalize ${statusColors[j.myApplicationStatus]}`}>{j.myApplicationStatus}</span>}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{j.employerName} — {j.location?.city || j.location?.district || j.location?.country}</p>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-blue-100 text-blue-700 capitalize">{j.trade?.replace(/-/g, ' ')}</span>
                    {j.requirements?.minNqfLevel && <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-gray-100 text-gray-600">NQF {j.requirements.minNqfLevel}+</span>}
                    {j.location?.isGulf && <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-amber-100 text-amber-700">Gulf</span>}
                    {j.salary?.min && <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-green-100 text-green-700">{j.salary.currency} {j.salary.min.toLocaleString()}{j.salary.max ? `-${j.salary.max.toLocaleString()}` : ''}/{j.salary.period}</span>}
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-300 line-clamp-2 mb-3">{j.description}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-400">{j.positions} position{j.positions > 1 ? 's' : ''} {j.deadline ? `— Due ${new Date(j.deadline).toLocaleDateString()}` : ''}</span>
                    {user?.role === 'worker' && !j.myApplicationStatus && (
                      <button onClick={() => setSelected(j)} className="px-4 py-1.5 text-xs font-semibold bg-ilo-blue text-white rounded-lg hover:bg-ilo-dark">Apply</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'applications' && (
        <div className="space-y-3">
          {myApps.length === 0 ? (
            <div className="text-center py-12 bg-white dark:bg-navy-mid rounded-xl border border-gray-200 dark:border-navy-light">
              <p className="text-sm text-gray-500">No applications yet. Browse jobs to get started.</p>
            </div>
          ) : myApps.map((a, i) => (
            <div key={i} className="bg-white dark:bg-navy-mid rounded-xl border border-gray-200 dark:border-navy-light p-4 flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold dark:text-white">{a.jobTitle}</h4>
                <p className="text-xs text-gray-500">{a.employer} — {a.trade?.replace(/-/g, ' ')}</p>
                <p className="text-[10px] text-gray-400 mt-1">Applied {new Date(a.appliedAt).toLocaleDateString()}</p>
                {a.feedback && <p className="text-xs text-gray-600 mt-1 italic">"{a.feedback}"</p>}
              </div>
              <span className={`px-3 py-1 text-xs font-semibold rounded-full capitalize ${statusColors[a.status]}`}>{a.status}</span>
            </div>
          ))}
        </div>
      )}

      {/* Apply Modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSelected(null)}>
          <div className="bg-white dark:bg-navy-mid rounded-2xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold dark:text-white mb-1">Apply to {selected.title}</h3>
            <p className="text-xs text-gray-500 mb-4">{selected.employerName}</p>
            <textarea value={coverNote} onChange={e => setCoverNote(e.target.value)} rows={4} maxLength={1000}
              className="w-full px-4 py-2.5 border border-gray-200 dark:border-navy-light rounded-xl text-sm bg-white dark:bg-navy dark:text-white mb-3"
              placeholder="Cover note (optional) — briefly describe your relevant experience..." />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setSelected(null)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-navy-light rounded-lg">Cancel</button>
              <button onClick={() => handleApply(selected._id)} disabled={applying}
                className="px-6 py-2 text-sm font-semibold bg-ilo-blue text-white rounded-lg hover:bg-ilo-dark disabled:opacity-60">
                {applying ? 'Submitting...' : 'Submit Application'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
