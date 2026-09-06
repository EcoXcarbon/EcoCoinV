import { useEffect, useState } from 'react';
import api from '../../api/client';
import { useLang } from '../../context/LangContext';

const reasonIcons = {
  'Strengthen weak skills': '🎯',
  'Matches your trade': '🔧',
  'Popular with similar workers': '👥',
  'Advance to next NQF level': '📈',
};

export default function RecommendationsPanel({ workerId, onSelectCourse }) {
  const { t } = useLang();
  const [recs, setRecs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workerId) return;
    (async () => {
      try {
        const { data } = await api.get('/achievements/recommendations');
        setRecs(data);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, [workerId]);

  if (loading || recs.length === 0) return null;

  return (
    <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">✨</span>
        <h3 className="text-sm font-bold dark:text-white">{t('Recommended For You')}</h3>
        <span className="text-[10px] text-gray-400 ml-auto">AI-powered suggestions</span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {recs.slice(0, 6).map(rec => (
          <div key={rec._id} onClick={() => onSelectCourse?.(rec._id)}
            className="min-w-[220px] bg-gray-50 dark:bg-navy-light rounded-xl p-3 cursor-pointer hover:shadow-md transition-shadow border border-border dark:border-navy-light shrink-0">
            <div className="flex items-center gap-1 mb-2">
              <span className="text-sm">{reasonIcons[rec.reason] || '📚'}</span>
              <span className="text-[9px] font-semibold text-ilo-blue bg-ilo-blue/10 px-2 py-0.5 rounded-full">{rec.reason}</span>
            </div>
            <h4 className="text-xs font-bold dark:text-white line-clamp-2">{rec.title}</h4>
            <div className="flex items-center gap-2 mt-2">
              <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded-full bg-ilo-blue/10 text-ilo-blue capitalize">{rec.trade}</span>
              {rec.difficulty && <span className="text-[9px] text-gray-400 capitalize">{rec.difficulty}</span>}
              {rec.avgRating > 0 && (
                <span className="text-[9px] text-amber-500 flex items-center gap-0.5">
                  <svg className="w-2.5 h-2.5 fill-amber-400" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
                  {rec.avgRating}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1 text-[9px] text-gray-400">
              <span>{rec.moduleCount} modules</span>
              <span>{rec.enrollmentCount} enrolled</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
