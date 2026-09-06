import { useEffect, useState } from 'react';
import api from '../api/client';
import { useLang } from '../context/LangContext';
import toast from 'react-hot-toast';

export default function Training() {
  const { t } = useLang();
  const [programs, setPrograms] = useState([]);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    api.get('/training')
      .then(r => setPrograms(r.data))
      .catch(() => toast.error('Failed to load training programs'));
  }, []);

  const selectProgram = async (id) => {
    try {
      const { data } = await api.get(`/training/${id}`);
      setSelected(data);
    } catch {
      toast.error('Failed to load program details');
    }
  };

  if (selected) {
    const pct = selected.modules?.length ? Math.round(selected.enrollments?.[0]?.completedModules?.length / selected.modules.length * 100) || 0 : 0;
    return (
      <div className="space-y-4">
        <button onClick={() => setSelected(null)} className="flex items-center gap-2 text-sm text-ilo-blue hover:underline">
          <span>←</span> Back to Programs
        </button>
        <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-6">
          <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
            <div>
              <h2 className="text-xl font-bold dark:text-white">{selected.title}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{selected.instructor} — {selected.institution}</p>
              <div className="flex gap-2 mt-2">
                <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-ilo-blue/10 text-ilo-blue capitalize">{selected.trade}</span>
                <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-gold-light/10 text-gold-light">NQF {selected.nqfLevel}</span>
                <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400">{selected.duration}</span>
              </div>
            </div>
            {/* Progress ring */}
            <div className="relative w-16 h-16">
              <svg className="w-16 h-16 -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="15.9" fill="none" strokeWidth="2" className="stroke-gray-200 dark:stroke-navy-light" />
                <circle cx="18" cy="18" r="15.9" fill="none" strokeWidth="2" strokeDasharray="100" strokeDashoffset={100 - pct} strokeLinecap="round" className="stroke-ilo-blue" />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-xs font-bold dark:text-white">{pct}%</span>
            </div>
          </div>

          <h3 className="text-sm font-semibold dark:text-white mb-3">Modules ({selected.modules?.length})</h3>
          <div className="space-y-2">
            {selected.modules?.map((m, i) => {
              const done = i < Math.ceil((selected.modules.length * pct) / 100);
              const current = i === Math.ceil((selected.modules.length * pct) / 100);
              return (
                <div key={m._id || i} className={`flex items-center gap-3 p-3 rounded-xl border ${done ? 'border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/10' : current ? 'border-ilo-blue dark:border-ilo-blue bg-ilo-blue/5' : 'border-gray-200 dark:border-navy-light opacity-60'}`}>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${done ? 'bg-green-100 text-green-600 dark:bg-green-900/30' : current ? 'bg-ilo-blue/10 text-ilo-blue' : 'bg-gray-100 dark:bg-navy-light text-gray-400'}`}>
                    {done ? '✓' : i + 1}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium dark:text-white">{m.title}</p>
                    <p className="text-[11px] text-gray-500">{m.duration} min • {m.type}</p>
                  </div>
                  <button onClick={() => toast.success(done ? 'Review completed' : current ? 'Continuing module' : 'Module locked')}
                    className={`px-3 py-1 text-[11px] font-semibold rounded-lg ${done ? 'bg-green-100 text-green-700 dark:bg-green-900/30' : current ? 'bg-ilo-blue text-white' : 'bg-gray-100 text-gray-400 dark:bg-navy-light cursor-not-allowed'}`}>
                    {done ? 'Review' : current ? 'Continue' : 'Locked'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold dark:text-white">{t('Training')} Programs</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {programs.map(p => (
          <div key={p._id} onClick={() => selectProgram(p._id)}
            className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light overflow-hidden cursor-pointer hover:shadow-lg transition-shadow group">
            <div className="h-28 bg-gradient-to-br from-ilo-dark to-ilo-blue p-4 flex items-end">
              <h3 className="text-white font-bold text-sm group-hover:text-gold-accent transition-colors">{p.title}</h3>
            </div>
            <div className="p-4">
              <div className="flex gap-2 mb-2">
                <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-ilo-blue/10 text-ilo-blue capitalize">{p.trade}</span>
                <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-gold-light/10 text-gold-light">NQF {p.nqfLevel}</span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">{p.instructor} — {p.institution}</p>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100 dark:border-navy-light">
                <span className="text-[11px] text-gray-500">{p.duration}</span>
                <span className="text-[11px] text-gray-500">{p.enrollments?.length || 0} enrolled</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
