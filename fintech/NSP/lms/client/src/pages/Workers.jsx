import { useEffect, useState, useCallback } from 'react';
import api from '../api/client';
import DataTable from '../components/DataTable';
import { useLang } from '../context/LangContext';
import toast from 'react-hot-toast';

const TRADES = [
  '', 'mason', 'electrician', 'welder', 'plumber', 'carpenter', 'steel-fixer', 'painter', 'hvac',
  'pipe-fitter', 'scaffolder', 'rigger', 'crane-operator', 'heavy-driver', 'shuttering-carpenter',
  'tile-fixer', 'duct-fabricator', 'auto-mechanic', 'diesel-mechanic', 'fabricator',
  'insulation-worker', 'heavy-equipment-operator', 'aluminium-fabricator', 'safety-officer',
  'cook', 'ac-technician',
];

export default function Workers() {
  const { t } = useLang();
  const [workers, setWorkers] = useState([]);
  const [pagination, setPagination] = useState({});
  const [trade, setTrade] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ fullName: '', cnic: '', trade: 'mason', district: 'Peshawar', fatherName: '' });

  const load = useCallback(async () => {
    try {
      const params = { limit: 100 };
      if (trade) params.trade = trade;
      const { data } = await api.get('/workers', { params });
      setWorkers(data.workers);
      setPagination(data.pagination);
    } catch {
      toast.error('Failed to load workers');
    }
  }, [trade]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async (e) => {
    e.preventDefault();
    try {
      await api.post('/workers', form);
      toast.success('Worker registered');
      setShowForm(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to register');
    }
  };

  const columns = [
    { key: 'registrationId', label: 'Reg. ID' },
    { key: 'fullName', label: 'Name' },
    { key: 'trade', label: 'Trade', render: v => <span className="capitalize">{v}</span> },
    { key: 'district', label: 'District' },
    { key: 'nqfLevel', label: 'NQF' },
    { key: 'cnicMasked', label: 'CNIC' },
    { key: 'status', label: 'Status', render: v => {
      const colors = { registered: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', assessed: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', certified: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', employed: 'bg-purple-100 text-purple-700', inactive: 'bg-gray-100 text-gray-500' };
      return <span className={`px-2 py-0.5 text-[11px] font-semibold rounded-full capitalize ${colors[v] || ''}`}>{v}</span>;
    }},
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold dark:text-white">{t('Workers')} <span className="text-sm font-normal text-gray-500">({pagination.total || 0})</span></h2>
        <div className="flex gap-2">
          <select value={trade} onChange={e => setTrade(e.target.value)}
            className="px-3 py-1.5 text-xs border border-border dark:border-navy-light rounded-lg bg-white dark:bg-navy-mid dark:text-white">
            <option value="">All Trades</option>
            {TRADES.filter(Boolean).map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
          </select>
          <button onClick={() => setShowForm(!showForm)}
            className="px-4 py-1.5 text-xs font-semibold bg-ilo-blue text-white rounded-lg hover:bg-ilo-dark transition-colors">
            + Register Worker
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleAdd} className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <input required placeholder="Full Name" value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))}
            className="px-3 py-2 text-sm border border-border dark:border-navy-light rounded-lg bg-white dark:bg-navy dark:text-white" />
          <input required placeholder="CNIC (17301-1234567-1)" value={form.cnic} onChange={e => setForm(f => ({ ...f, cnic: e.target.value }))}
            pattern="\d{5}-\d{7}-\d{1}" className="px-3 py-2 text-sm border border-border dark:border-navy-light rounded-lg bg-white dark:bg-navy dark:text-white" />
          <input placeholder="Father Name" value={form.fatherName} onChange={e => setForm(f => ({ ...f, fatherName: e.target.value }))}
            className="px-3 py-2 text-sm border border-border dark:border-navy-light rounded-lg bg-white dark:bg-navy dark:text-white" />
          <select value={form.trade} onChange={e => setForm(f => ({ ...f, trade: e.target.value }))}
            className="px-3 py-2 text-sm border border-border dark:border-navy-light rounded-lg bg-white dark:bg-navy-mid dark:text-white capitalize">
            {TRADES.filter(Boolean).map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input placeholder="District" value={form.district} onChange={e => setForm(f => ({ ...f, district: e.target.value }))}
            className="px-3 py-2 text-sm border border-border dark:border-navy-light rounded-lg bg-white dark:bg-navy dark:text-white" />
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-2 text-xs font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700">Save</button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-xs border border-border dark:border-navy-light rounded-lg dark:text-gray-300">Cancel</button>
          </div>
        </form>
      )}

      <DataTable columns={columns} data={workers} />
    </div>
  );
}
