import { useLang } from '../context/LangContext';

export default function KPICard({ icon, label, value, suffix = '', trend, color = 'ilo-blue' }) {
  const { t } = useLang();
  const colors = {
    'ilo-blue': 'bg-ilo-blue/10 text-ilo-blue dark:bg-ilo-blue/20',
    'success': 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400',
    'gold': 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400',
    'purple': 'bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400',
    'teal': 'bg-teal-50 text-teal-600 dark:bg-teal-900/20 dark:text-teal-400',
    'danger': 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400',
  };

  return (
    <div className="bg-white dark:bg-navy-mid rounded-xl p-5 border border-border dark:border-navy-light shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${colors[color]}`}>{icon}</div>
        {trend && <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${trend > 0 ? 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400' : 'bg-red-50 text-red-600'}`}>{trend > 0 ? '+' : ''}{trend}%</span>}
      </div>
      <div className="text-2xl font-extrabold text-gray-900 dark:text-white">{typeof value === 'number' ? value.toLocaleString() : value}{suffix}</div>
      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t(label)}</div>
    </div>
  );
}
