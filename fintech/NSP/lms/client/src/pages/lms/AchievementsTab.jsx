import { useEffect, useState } from 'react';
import api from '../../api/client';
import { useLang } from '../../context/LangContext';
import toast from 'react-hot-toast';

const levelColors = ['bg-gray-200', 'bg-green-200', 'bg-blue-200', 'bg-purple-200', 'bg-amber-200', 'bg-red-200'];
const rarityColors = {
  common: 'border-gray-300 bg-gray-50 dark:bg-gray-800',
  uncommon: 'border-green-300 bg-green-50 dark:bg-green-900/20',
  rare: 'border-blue-300 bg-blue-50 dark:bg-blue-900/20',
  epic: 'border-purple-300 bg-purple-50 dark:bg-purple-900/20',
  legendary: 'border-amber-300 bg-amber-50 dark:bg-amber-900/20',
};
const badgeIcons = {
  learning: '📖', quiz: '🧠', streak: '🔥', social: '👥', completion: '🎓', special: '⭐',
};

export default function AchievementsTab({ workerId }) {
  const { t } = useLang();
  const [profile, setProfile] = useState(null);
  const [badges, setBadges] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('overview'); // overview | badges | leaderboard

  useEffect(() => {
    (async () => {
      try {
        const [profileRes, badgesRes, lbRes] = await Promise.all([
          api.get('/achievements/profile'),
          api.get('/achievements/badges'),
          api.get('/achievements/leaderboard', { params: { limit: 20 } }),
        ]);
        setProfile(profileRes.data);
        setBadges(badgesRes.data);
        setLeaderboard(lbRes.data);
      } catch {
        toast.error('Failed to load achievements');
      } finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="flex justify-center py-16"><div className="animate-spin w-8 h-8 border-4 border-ilo-blue border-t-transparent rounded-full" /></div>;
  if (!profile) return <div className="text-center py-16 text-gray-400">No learner profile found</div>;

  const xpForNextLevel = Math.pow(profile.level, 2) * 100;
  const xpProgress = Math.min(100, Math.round((profile.xp / xpForNextLevel) * 100));
  const earnedCodes = new Set(profile.badges?.map(b => b.badgeCode) || []);

  return (
    <div className="space-y-4">
      {/* XP & Level Card */}
      <div className="bg-gradient-to-r from-purple-700 to-indigo-600 rounded-xl p-6 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-purple-200 font-semibold">LEVEL {profile.level}</p>
            <p className="text-3xl font-bold mt-1">{profile.xp.toLocaleString()} XP</p>
            <p className="text-xs text-purple-200 mt-1">{xpForNextLevel - profile.xp} XP to Level {profile.level + 1}</p>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-4">
              <div className="text-center">
                <p className="text-2xl font-bold">🔥 {profile.currentStreak}</p>
                <p className="text-[10px] text-purple-200">Day Streak</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold">🏆 {profile.badges?.length || 0}</p>
                <p className="text-[10px] text-purple-200">Badges</p>
              </div>
            </div>
          </div>
        </div>
        {/* XP Progress bar */}
        <div className="mt-4">
          <div className="w-full bg-white/20 rounded-full h-3">
            <div className="bg-white rounded-full h-3 transition-all duration-500" style={{ width: `${xpProgress}%` }} />
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-3 text-center">
          <p className="text-xl font-bold text-blue-600">{profile.analytics?.totalCoursesCompleted || 0}</p>
          <p className="text-[10px] text-gray-500 mt-1">Courses Done</p>
        </div>
        <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-3 text-center">
          <p className="text-xl font-bold text-green-600">{profile.analytics?.totalModulesCompleted || 0}</p>
          <p className="text-[10px] text-gray-500 mt-1">Modules Done</p>
        </div>
        <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-3 text-center">
          <p className="text-xl font-bold text-amber-600">{profile.analytics?.totalQuizzesPassed || 0}</p>
          <p className="text-[10px] text-gray-500 mt-1">Quizzes Passed</p>
        </div>
        <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-3 text-center">
          <p className="text-xl font-bold text-purple-600">{profile.analytics?.avgQuizScore || 0}%</p>
          <p className="text-[10px] text-gray-500 mt-1">Avg Quiz Score</p>
        </div>
        <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-3 text-center">
          <p className="text-xl font-bold text-cyan-600">{Math.round((profile.analytics?.totalTimeSpentMinutes || 0) / 60)}h</p>
          <p className="text-[10px] text-gray-500 mt-1">Time Spent</p>
        </div>
        <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-3 text-center">
          <p className="text-xl font-bold text-red-600">{profile.longestStreak || 0}</p>
          <p className="text-[10px] text-gray-500 mt-1">Best Streak</p>
        </div>
      </div>

      {/* Engagement & Risk */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-4">
          <h3 className="text-sm font-bold dark:text-white mb-3">📊 Engagement Score</h3>
          <div className="flex items-center gap-4">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center text-lg font-bold
              ${profile.analytics?.engagementScore >= 70 ? 'bg-green-100 text-green-700' :
                profile.analytics?.engagementScore >= 40 ? 'bg-amber-100 text-amber-700' :
                'bg-red-100 text-red-700'}`}>
              {profile.analytics?.engagementScore || 0}
            </div>
            <div className="flex-1">
              <div className="w-full bg-gray-200 dark:bg-navy-light rounded-full h-2">
                <div className={`rounded-full h-2 transition-all ${
                  profile.analytics?.engagementScore >= 70 ? 'bg-green-500' :
                  profile.analytics?.engagementScore >= 40 ? 'bg-amber-500' : 'bg-red-500'
                }`} style={{ width: `${profile.analytics?.engagementScore || 0}%` }} />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {profile.analytics?.engagementScore >= 70 ? 'Highly engaged! Keep it up!' :
                 profile.analytics?.engagementScore >= 40 ? 'Good progress. Stay consistent!' :
                 'Try to study more regularly for better results.'}
              </p>
            </div>
          </div>
        </div>

        {/* Weekly Activity */}
        <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-4">
          <h3 className="text-sm font-bold dark:text-white mb-3">📅 Weekly Activity</h3>
          <div className="flex items-end gap-1 h-20">
            {(profile.analytics?.weeklyActivity || []).slice(-8).map((w, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full bg-ilo-blue/20 rounded-t" style={{
                  height: `${Math.max(4, Math.min(100, (w.minutesSpent / 120) * 100))}%`,
                  backgroundColor: w.minutesSpent > 60 ? '#2563eb' : w.minutesSpent > 30 ? '#60a5fa' : '#93c5fd',
                }} />
                <span className="text-[8px] text-gray-400">{w.week?.split('-W')[1]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Badges */}
      <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-4">
        <h3 className="text-sm font-bold dark:text-white mb-4">🏅 Badges ({profile.badges?.length || 0}/{badges.length})</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {badges.map(badge => {
            const earned = earnedCodes.has(badge.code);
            return (
              <div key={badge._id}
                className={`rounded-xl border-2 p-3 text-center transition-all ${earned ? rarityColors[badge.rarity] || rarityColors.common : 'border-gray-200 bg-gray-50 dark:bg-navy-light dark:border-navy-light opacity-50'}`}>
                <div className="text-2xl mb-1">{badgeIcons[badge.category] || '🏅'}</div>
                <p className={`text-xs font-bold ${earned ? 'dark:text-white' : 'text-gray-400'}`}>{badge.title}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">{badge.description}</p>
                <div className="flex items-center justify-center gap-1 mt-2">
                  <span className="text-[9px] font-bold text-amber-500">+{badge.xpReward} XP</span>
                  <span className={`text-[9px] font-bold capitalize ${badge.rarity === 'legendary' ? 'text-amber-600' : badge.rarity === 'epic' ? 'text-purple-600' : badge.rarity === 'rare' ? 'text-blue-600' : 'text-gray-500'}`}>
                    {badge.rarity}
                  </span>
                </div>
                {earned && (
                  <>
                    <p className="text-[9px] text-green-600 font-bold mt-1">✓ Earned</p>
                    <button
                      onClick={async () => {
                        try {
                          const res = await fetch(`/lms/api/v1/achievements/badges/${badge.code}/ob3`, {
                            credentials: 'include',
                            headers: { 'X-CSRF-Token': document.cookie.match(/csrf=([^;]+)/)?.[1] || '' },
                          });
                          const ob3 = await res.json();
                          await navigator.clipboard.writeText(JSON.stringify(ob3, null, 2));
                          toast.success('OB3 badge copied to clipboard!');
                        } catch { toast.error('Failed to copy badge'); }
                      }}
                      className="text-xs text-ilo-blue hover:underline"
                    >
                      Share OB3
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Leaderboard */}
      <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-4">
        <h3 className="text-sm font-bold dark:text-white mb-3">🏆 Leaderboard</h3>
        <div className="space-y-2">
          {leaderboard.map((entry, idx) => (
            <div key={idx} className={`flex items-center gap-3 p-2.5 rounded-lg ${
              entry.worker?._id === workerId ? 'bg-ilo-blue/5 border border-ilo-blue/20' : 'hover:bg-gray-50 dark:hover:bg-navy-light'
            }`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold
                ${idx === 0 ? 'bg-amber-100 text-amber-700' : idx === 1 ? 'bg-gray-200 text-gray-700' : idx === 2 ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-500'}`}>
                {idx < 3 ? ['🥇', '🥈', '🥉'][idx] : `#${entry.rank}`}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold dark:text-white truncate">{entry.worker?.name || 'Worker'}</p>
                <p className="text-[10px] text-gray-500 capitalize">{entry.worker?.trade}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-purple-600">{entry.xp.toLocaleString()} XP</p>
                <p className="text-[10px] text-gray-500">Lv.{entry.level} • {entry.badgeCount} badges</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Competency Map */}
      {profile.competencies?.length > 0 && (
        <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-4">
          <h3 className="text-sm font-bold dark:text-white mb-3">🎯 Competency Map</h3>
          <div className="space-y-3">
            {profile.competencies.map((comp, i) => (
              <div key={i}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold dark:text-white">{comp.skill}</span>
                  <span className={`px-2 py-0.5 text-[9px] font-bold rounded-full capitalize
                    ${comp.level === 'expert' ? 'bg-purple-100 text-purple-700' :
                      comp.level === 'advanced' ? 'bg-blue-100 text-blue-700' :
                      comp.level === 'intermediate' ? 'bg-green-100 text-green-700' :
                      comp.level === 'foundation' ? 'bg-amber-100 text-amber-700' :
                      'bg-gray-100 text-gray-500'}`}>
                    {comp.level}
                  </span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-navy-light rounded-full h-2">
                  <div className={`rounded-full h-2 transition-all ${
                    comp.score >= 75 ? 'bg-green-500' : comp.score >= 50 ? 'bg-blue-500' : comp.score >= 25 ? 'bg-amber-500' : 'bg-red-500'
                  }`} style={{ width: `${comp.score}%` }} />
                </div>
                <p className="text-[10px] text-gray-400 mt-0.5">{comp.score}% • {comp.assessments} assessments</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
