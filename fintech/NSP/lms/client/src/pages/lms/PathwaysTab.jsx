import { useEffect, useState } from 'react';
import api from '../../api/client';
import { useLang } from '../../context/LangContext';
import toast from 'react-hot-toast';

const categoryColors = {
  'trade-mastery': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  'safety-compliance': 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  'gulf-readiness': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  'leadership': 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  'digital-skills': 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  'specialization': 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
};

const categoryIcons = {
  'trade-mastery': '🔧',
  'safety-compliance': '🛡️',
  'gulf-readiness': '🌍',
  'leadership': '👔',
  'digital-skills': '💻',
  'specialization': '🎯',
};

export default function PathwaysTab({ isWorker, isAdmin, workerId, preSelectedPathway, onPathwayViewed, onBackToCourse, onSelectCourse }) {
  const { t } = useLang();
  const [pathways, setPathways] = useState([]);
  const [myPathways, setMyPathways] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [allRes, myRes] = await Promise.all([
          api.get('/pathways'),
          isWorker ? api.get('/pathways/my-pathways').catch(() => ({ data: [] })) : { data: [] },
        ]);
        setPathways(allRes.data);
        setMyPathways(myRes.data);
      } catch {
        toast.error('Failed to load pathways');
      } finally { setLoading(false); }
    })();
  }, [isWorker]);

  // Auto-select pathway when navigated from course detail
  useEffect(() => {
    if (preSelectedPathway && !loading) {
      setSelected(preSelectedPathway);
      onPathwayViewed?.();
    }
  }, [preSelectedPathway, loading]);

  const enroll = async (pathwayId) => {
    if (!workerId) return toast.error('Worker ID not found');
    setEnrolling(true);
    try {
      await api.post(`/pathways/${pathwayId}/enroll`, { workerId });
      toast.success('Enrolled in pathway!');
      const [allRes, myRes] = await Promise.all([api.get('/pathways'), api.get('/pathways/my-pathways')]);
      setPathways(allRes.data);
      setMyPathways(myRes.data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to enroll');
    } finally { setEnrolling(false); }
  };

  const isEnrolledIn = (pathwayId) =>
    myPathways.some(p => p._id === pathwayId);

  if (loading) return <div className="flex justify-center py-16"><div className="animate-spin w-8 h-8 border-4 border-ilo-blue border-t-transparent rounded-full" /></div>;

  if (selected) {
    const pw = pathways.find(p => p._id === selected) || myPathways.find(p => p._id === selected);
    const myEnroll = myPathways.find(p => p._id === selected)?.enrollment;
    if (!pw) return null;

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <button onClick={() => setSelected(null)} className="text-sm text-ilo-blue hover:underline font-semibold">&larr; Back to Pathways</button>
          {onBackToCourse && (
            <button onClick={onBackToCourse} className="text-sm text-purple-600 dark:text-purple-400 hover:underline font-semibold">&larr; Back to Course</button>
          )}
        </div>

        {/* Pathway header */}
        <div className={`rounded-xl p-6 text-white ${
          pw.framework === 'gulf'
            ? 'bg-gradient-to-r from-amber-700 to-amber-500'
            : 'bg-gradient-to-r from-ilo-dark to-ilo-blue'
        }`}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl">{categoryIcons[pw.category] || '📚'}</span>
            <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full bg-white/20`}>{pw.category?.replace(/-/g, ' ')}</span>
            <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${
              pw.framework === 'gulf' ? 'bg-amber-300/30 text-white' : 'bg-blue-300/30 text-white'
            }`}>{pw.framework === 'gulf' ? 'Gulf / C&G' : 'NAVTTC'}</span>
          </div>
          <h2 className="text-xl font-bold">{pw.title}</h2>
          <p className={`text-sm mt-1 ${pw.framework === 'gulf' ? 'text-amber-100' : 'text-blue-100'}`}>{pw.description}</p>
          <div className="flex items-center gap-4 mt-3 text-sm text-blue-200">
            {pw.totalDurationWeeks && <span>{pw.totalDurationWeeks} weeks</span>}
            {pw.totalHours && <span>{pw.totalHours} hours</span>}
            <span>{pw.courses?.length || 0} courses</span>
            {pw.trade && <span className="capitalize">{pw.trade}</span>}
          </div>
          {myEnroll && (
            <div className="mt-4 bg-white/10 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Progress: {myEnroll.progress}%</span>
                <span className="text-xs">{myEnroll.completedCourses}/{pw.courses?.length || pw.totalCourses} courses</span>
              </div>
              <div className="w-full bg-white/20 rounded-full h-2 mt-2">
                <div className="bg-white rounded-full h-2 transition-all" style={{ width: `${myEnroll.progress}%` }} />
              </div>
              <div className="flex gap-4 mt-2 text-xs text-blue-200">
                {myEnroll.streak > 0 && <span>🔥 {myEnroll.streak} day streak</span>}
                {myEnroll.totalTimeSpentMinutes > 0 && <span>⏱ {Math.round(myEnroll.totalTimeSpentMinutes / 60)}h spent</span>}
              </div>
            </div>
          )}
        </div>

        {/* Competency targets */}
        {pw.competencyTargets?.length > 0 && (
          <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-4">
            <h3 className="text-sm font-bold dark:text-white mb-3">🎯 Competency Targets</h3>
            <div className="flex flex-wrap gap-2">
              {pw.competencyTargets.map((ct, i) => (
                <span key={i} className="px-3 py-1 text-xs font-semibold rounded-full bg-ilo-blue/10 text-ilo-blue">
                  {ct.skill} — {ct.targetLevel}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Transferable skills */}
        {pw.transferableSkills?.length > 0 && (
          <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-4">
            <h3 className="text-sm font-bold dark:text-white mb-3">🔄 Transferable Skills</h3>
            <div className="space-y-2">
              {pw.transferableSkills.map((sk, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-green-500 font-bold text-xs mt-0.5">✓</span>
                  <div>
                    <span className="text-sm font-semibold dark:text-white">{sk.name}</span>
                    {sk.description && <p className="text-xs text-gray-500 dark:text-gray-400">{sk.description}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Course list */}
        <div className="space-y-3">
          <h3 className="text-sm font-bold dark:text-white">📋 Courses in this Pathway</h3>
          {(pw.courses || []).sort((a, b) => a.order - b.order).map((c, idx) => {
            const course = c.training || c;
            const isCompleted = myEnroll?.completedCourses?.some?.(cc => cc === course._id) ||
                                (myPathways.find(p => p._id === selected)?.courses?.[idx]?.completed);
            return (
              <div key={idx} onClick={() => course._id && onSelectCourse?.(course._id)}
                className={`bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-4 flex items-center gap-4 ${course._id && onSelectCourse ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}>
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0
                  ${isCompleted ? 'bg-green-100 text-green-700 dark:bg-green-900/30' : 'bg-gray-100 text-gray-500 dark:bg-navy-light dark:text-gray-400'}`}>
                  {isCompleted ? '✓' : idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold dark:text-white">{course.title || 'Course'}</h4>
                  <div className="flex items-center gap-2 mt-1">
                    {course.trade && <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-ilo-blue/10 text-ilo-blue capitalize">{course.trade}</span>}
                    {course.difficulty && <span className="text-[10px] text-gray-400 capitalize">{course.difficulty}</span>}
                    {course.duration && <span className="text-[10px] text-gray-400">{course.duration}</span>}
                    {!c.required && <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-gray-100 text-gray-500">Elective</span>}
                  </div>
                </div>
                {isCompleted && <span className="text-xs font-bold text-green-600">Completed</span>}
                {course._id && onSelectCourse && <span className="text-xs text-ilo-blue font-semibold shrink-0">View →</span>}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* My Pathways */}
      {isWorker && myPathways.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-bold dark:text-white">📚 My Learning Pathways</h3>
          {myPathways.map(pw => (
            <div key={pw._id} onClick={() => setSelected(pw._id)}
              className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-4 cursor-pointer hover:shadow-lg transition-shadow">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{categoryIcons[pw.category] || '📚'}</span>
                <div className="flex-1">
                  <h4 className="text-sm font-bold dark:text-white">{pw.title}</h4>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full capitalize ${categoryColors[pw.category] || 'bg-gray-100 text-gray-600'}`}>
                      {pw.category?.replace(/-/g, ' ')}
                    </span>
                    <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${
                      pw.framework === 'gulf' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                    }`}>{pw.framework === 'gulf' ? 'Gulf/C&G' : 'NAVTTC'}</span>
                    <span className="text-xs text-gray-500">{pw.enrollment?.completedCourses}/{pw.totalCourses} courses</span>
                    {pw.enrollment?.streak > 0 && <span className="text-xs text-amber-500">🔥 {pw.enrollment.streak}</span>}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-ilo-blue">{pw.enrollment?.progress || 0}%</div>
                  <div className="w-20 bg-gray-200 dark:bg-navy-light rounded-full h-1.5 mt-1">
                    <div className="bg-ilo-blue rounded-full h-1.5 transition-all" style={{ width: `${pw.enrollment?.progress || 0}%` }} />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* All Pathways */}
      <h3 className="text-sm font-bold dark:text-white">🗺️ Available Learning Pathways</h3>
      {pathways.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light">
          <p className="text-sm text-gray-400">No learning pathways available yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {pathways.map(pw => {
            const enrolled = isEnrolledIn(pw._id);
            return (
              <div key={pw._id} className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light overflow-hidden hover:shadow-lg transition-shadow">
                <div className={`p-4 text-white ${
                  pw.framework === 'gulf'
                    ? 'bg-gradient-to-r from-amber-700 to-amber-500'
                    : `bg-gradient-to-r ${pw.category === 'trade-mastery' ? 'from-blue-600 to-blue-400' :
                        pw.category === 'safety-compliance' ? 'from-red-600 to-red-400' :
                        pw.category === 'gulf-readiness' ? 'from-amber-600 to-amber-400' :
                        pw.category === 'leadership' ? 'from-purple-600 to-purple-400' :
                        pw.category === 'digital-skills' ? 'from-cyan-600 to-cyan-400' :
                        'from-green-600 to-green-400'}`
                }`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xl">{categoryIcons[pw.category] || '📚'}</span>
                    <span className="text-[10px] font-bold bg-white/20 px-2 py-0.5 rounded-full capitalize">{pw.category?.replace(/-/g, ' ')}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      pw.framework === 'gulf' ? 'bg-amber-300/30' : 'bg-blue-300/30'
                    }`}>{pw.framework === 'gulf' ? 'Gulf/C&G' : 'NAVTTC'}</span>
                  </div>
                  <h4 className="text-sm font-bold">{pw.title}</h4>
                </div>
                <div className="p-4 space-y-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">{pw.description}</p>
                  <div className="flex flex-wrap gap-2 text-[10px] text-gray-500 dark:text-gray-400">
                    <span>{pw.courses?.length || 0} courses</span>
                    {pw.totalDurationWeeks && <span>• {pw.totalDurationWeeks} weeks</span>}
                    {pw.totalHours && <span>• {pw.totalHours}h</span>}
                    {pw.trade && <span className="capitalize">• {pw.trade}</span>}
                  </div>
                  {pw.competencyTargets?.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {pw.competencyTargets.slice(0, 3).map((ct, i) => (
                        <span key={i} className="px-2 py-0.5 text-[9px] font-semibold rounded-full bg-ilo-blue/10 text-ilo-blue">{ct.skill}</span>
                      ))}
                      {pw.competencyTargets.length > 3 && <span className="text-[9px] text-gray-400">+{pw.competencyTargets.length - 3}</span>}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <button onClick={() => setSelected(pw._id)}
                      className="flex-1 px-3 py-2 text-xs font-semibold text-ilo-blue border border-ilo-blue rounded-lg hover:bg-ilo-blue/5 transition-colors">
                      View Details
                    </button>
                    {isWorker && !enrolled && (
                      <button onClick={() => enroll(pw._id)} disabled={enrolling}
                        className="flex-1 px-3 py-2 text-xs font-semibold bg-ilo-blue text-white rounded-lg hover:bg-ilo-dark transition-colors disabled:opacity-50">
                        {enrolling ? 'Enrolling...' : 'Enroll'}
                      </button>
                    )}
                    {enrolled && <span className="text-xs font-bold text-green-600">Enrolled ✓</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
