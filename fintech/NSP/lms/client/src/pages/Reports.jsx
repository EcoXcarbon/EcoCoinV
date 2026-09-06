import { useEffect, useState } from 'react';
import api from '../api/client';
import { useLang } from '../context/LangContext';
import toast from 'react-hot-toast';

export default function Reports() {
  const { t } = useLang();
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    api.get('/reports/summary')
      .then(r => setSummary(r.data))
      .catch(() => toast.error('Failed to load report summary'));
  }, []);

  const downloadCSV = async (type) => {
    try {
      const res = await api.get(`/reports/${type}/csv`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = `${type}-${Date.now()}.csv`; a.click();
      URL.revokeObjectURL(url);
      toast.success(`${type} CSV downloaded`);
    } catch { toast.error('Export failed'); }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold dark:text-white">{t('Reports')} & Export</h2>

      {/* Export buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          { type: 'workers', icon: '👷', label: 'Workers Registry', desc: 'Full worker data with CNIC masked' },
          { type: 'credentials', icon: '📜', label: 'Credentials Report', desc: 'All issued credentials with status' },
        ].map(r => (
          <div key={r.type} className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-5">
            <div className="text-2xl mb-2">{r.icon}</div>
            <h3 className="font-semibold dark:text-white">{r.label}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-4">{r.desc}</p>
            <button onClick={() => downloadCSV(r.type)}
              className="px-4 py-2 text-xs font-semibold bg-ilo-blue text-white rounded-lg hover:bg-ilo-dark transition-colors">
              Download CSV
            </button>
          </div>
        ))}
      </div>

      {/* Summary tables */}
      {summary && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-5">
            <h3 className="font-semibold dark:text-white mb-3">Workers by Trade</h3>
            <div className="space-y-2">
              {summary.workersByTrade?.map(t => (
                <div key={t._id} className="flex items-center justify-between">
                  <span className="text-sm capitalize dark:text-gray-300">{t._id}</span>
                  <span className="text-sm font-semibold dark:text-white">{t.count}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-5">
            <h3 className="font-semibold dark:text-white mb-3">Assessments by Status</h3>
            <div className="space-y-2">
              {summary.assessmentsByStatus?.map(s => (
                <div key={s._id} className="flex items-center justify-between">
                  <span className="text-sm capitalize dark:text-gray-300">{s._id}</span>
                  <span className="text-sm font-semibold dark:text-white">{s.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
