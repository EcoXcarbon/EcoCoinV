import { useEffect, useState } from 'react';
import api from '../../api/client';
import { useLang } from '../../context/LangContext';

const levelGradient = {
  novice: 'from-gray-300 to-gray-400',
  foundation: 'from-amber-300 to-amber-500',
  intermediate: 'from-green-300 to-green-500',
  advanced: 'from-blue-300 to-blue-500',
  expert: 'from-purple-300 to-purple-500',
};

const TARGET_LEVEL_VALUE = { foundation: 25, intermediate: 50, advanced: 75, expert: 100 };

export default function CompetencyMap({ workerId, programId }) {
  const { t } = useLang();
  const [profile, setProfile] = useState(null);
  const [targets, setTargets] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workerId) return;
    const promises = [
      api.get('/achievements/profile').then(r => setProfile(r.data)).catch(() => {}),
    ];
    // Fetch competency targets from enrolled programs
    if (programId) {
      promises.push(
        api.get(`/training/${programId}`).then(r => {
          setTargets(r.data?.competencyTargets || []);
        }).catch(() => {})
      );
    } else {
      promises.push(
        api.get('/training/my-courses').then(r => {
          const programs = r.data?.programs || r.data || [];
          const allTargets = [];
          for (const p of (Array.isArray(programs) ? programs : [])) {
            for (const ct of (p.competencyTargets || [])) {
              if (!allTargets.find(t => t.skill === ct.skill)) {
                allTargets.push(ct);
              }
            }
          }
          setTargets(allTargets);
        }).catch(() => {})
      );
    }
    Promise.all(promises).finally(() => setLoading(false));
  }, [workerId, programId]);

  if (loading) return <div className="flex justify-center py-4"><div className="animate-spin w-5 h-5 border-2 border-ilo-blue border-t-transparent rounded-full" /></div>;

  // Merge earned competencies with framework targets
  const earnedMap = {};
  for (const c of (profile?.competencies || [])) {
    earnedMap[c.skill] = c;
  }

  const merged = [];
  // Add all framework targets first
  for (const t of targets) {
    merged.push({
      skill: t.skill,
      targetLevel: t.targetLevel,
      targetValue: TARGET_LEVEL_VALUE[t.targetLevel] || 50,
      score: earnedMap[t.skill]?.score || 0,
      level: earnedMap[t.skill]?.level || 'novice',
      assessments: earnedMap[t.skill]?.assessments || 0,
    });
    delete earnedMap[t.skill];
  }
  // Add earned competencies that aren't in framework targets
  for (const [skill, c] of Object.entries(earnedMap)) {
    merged.push({ skill, targetLevel: null, targetValue: null, score: c.score, level: c.level, assessments: c.assessments });
  }

  if (merged.length === 0) return null;

  const sorted = merged.sort((a, b) => (b.targetValue || 0) - (a.targetValue || 0) || b.score - a.score);

  return (
    <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">{'\uD83C\uDFAF'}</span>
        <h3 className="text-sm font-bold dark:text-white">{t('Competency Map')}</h3>
        <span className="ml-auto text-[10px] text-gray-400">{sorted.length} skills tracked</span>
      </div>

      <div className="space-y-3">
        {sorted.map((comp, i) => (
          <div key={i} className="group">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold dark:text-white">{comp.skill}</span>
              <div className="flex items-center gap-2">
                {comp.targetLevel && (
                  <span className="px-1.5 py-0.5 text-[8px] font-bold rounded bg-gray-100 dark:bg-navy-light text-gray-500 dark:text-gray-400 capitalize">
                    Target: {comp.targetLevel}
                  </span>
                )}
                <span className={`px-2 py-0.5 text-[9px] font-bold rounded-full capitalize
                  ${comp.level === 'expert' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' :
                    comp.level === 'advanced' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                    comp.level === 'intermediate' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                    comp.level === 'foundation' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                    'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}>
                  {comp.level}
                </span>
                <span className="text-xs font-bold dark:text-white">{comp.score}%</span>
              </div>
            </div>
            <div className="relative w-full bg-gray-200 dark:bg-navy-light rounded-full h-2.5 overflow-hidden">
              {/* Earned score bar */}
              <div className={`h-full rounded-full transition-all duration-500 bg-gradient-to-r ${levelGradient[comp.level] || levelGradient.novice}`}
                style={{ width: `${comp.score}%` }} />
              {/* Target marker */}
              {comp.targetValue && (
                <div className="absolute top-0 h-full w-0.5 bg-red-500 dark:bg-red-400"
                  style={{ left: `${comp.targetValue}%` }}
                  title={`Target: ${comp.targetLevel}`} />
              )}
            </div>
            <div className="flex justify-between mt-0.5">
              <p className="text-[9px] text-gray-400">{comp.assessments} assessment{comp.assessments !== 1 ? 's' : ''}</p>
              {comp.targetValue && comp.score < comp.targetValue && (
                <p className="text-[9px] text-red-500 font-semibold">Gap: {comp.targetValue - comp.score}%</p>
              )}
              {comp.targetValue && comp.score >= comp.targetValue && (
                <p className="text-[9px] text-green-600 font-semibold">{'\u2713'} Target met</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Weak areas highlight */}
      {sorted.filter(c => c.targetValue && c.score < c.targetValue).length > 0 && (
        <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-900/10 rounded-lg border border-amber-200 dark:border-amber-800">
          <p className="text-xs font-bold text-amber-700 dark:text-amber-400 mb-1">{'\uD83D\uDCA1'} Skills Below Target</p>
          <div className="flex flex-wrap gap-1">
            {sorted.filter(c => c.targetValue && c.score < c.targetValue).map((c, i) => (
              <span key={i} className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                {c.skill} ({c.score}% / {c.targetValue}%)
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
