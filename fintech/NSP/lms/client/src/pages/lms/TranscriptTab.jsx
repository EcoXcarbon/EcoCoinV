import { useState, useEffect } from 'react';
import { useLang } from '../../context/LangContext';
import api from '../../api/client';

export default function TranscriptTab() {
  const { t } = useLang();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedCourse, setExpandedCourse] = useState(null);

  useEffect(() => {
    api.get('/training/transcript/my')
      .then(res => { setData(res.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>;
  if (!data || !data.transcript) return <p className="text-center text-gray-500 py-8">{t('No transcript data available')}</p>;

  const { transcript, summary } = data;
  const gradeColor = (g) => !g ? 'gray' : g >= 90 ? 'green' : g >= 70 ? 'blue' : g >= 60 ? 'yellow' : 'red';

  return (
    <div className="max-w-4xl mx-auto">
      {/* Cumulative Summary */}
      <div className="bg-gradient-to-r from-indigo-600 to-blue-600 rounded-2xl p-6 text-white mb-8">
        <h2 className="text-2xl font-bold mb-4">{t('Academic Transcript')}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-white/20 rounded-xl p-4 text-center">
            <p className="text-3xl font-bold">{summary.totalCourses}</p>
            <p className="text-sm text-blue-100">{t('Total Courses')}</p>
          </div>
          <div className="bg-white/20 rounded-xl p-4 text-center">
            <p className="text-3xl font-bold">{summary.evaluatedCourses}</p>
            <p className="text-sm text-blue-100">{t('Evaluated')}</p>
          </div>
          <div className="bg-white/20 rounded-xl p-4 text-center">
            <p className="text-3xl font-bold">{summary.cumulativeScore}%</p>
            <p className="text-sm text-blue-100">{t('Cumulative Score')}</p>
          </div>
          <div className="bg-white/20 rounded-xl p-4 text-center">
            <p className="text-3xl font-bold">{summary.certificates}</p>
            <p className="text-sm text-blue-100">{t('Certificates')}</p>
          </div>
        </div>
        {summary.cumulativeGrade && summary.evaluatedCourses > 0 && (
          <div className="mt-4 text-center">
            <span className="bg-white/30 px-6 py-2 rounded-full text-lg font-bold">{t('Cumulative Grade')}: {summary.cumulativeGrade}</span>
          </div>
        )}
      </div>

      {/* Course List */}
      <div className="space-y-4">
        {transcript.map((course, i) => {
          const gc = gradeColor(course.grade);
          const isExpanded = expandedCourse === i;
          const statusLabel = {
            'enrolled': t('Enrolled'),
            'in-progress': t('In Progress'),
            'completed': t('Completed'),
            'submitted': t('Under Review'),
            'evaluated': course.letterGrade ? `${t('Grade')}: ${course.letterGrade} (${course.grade}%)` : t('Evaluated'),
            'dropped': t('Dropped')
          }[course.status] || course.status;
          const statusColor = {
            'enrolled': 'bg-gray-100 text-gray-600',
            'in-progress': 'bg-blue-100 text-blue-700',
            'completed': 'bg-green-100 text-green-700',
            'submitted': 'bg-yellow-100 text-yellow-700',
            'evaluated': gc === 'green' ? 'bg-green-100 text-green-700' : gc === 'blue' ? 'bg-blue-100 text-blue-700' : gc === 'yellow' ? 'bg-yellow-100 text-yellow-700' : gc === 'red' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600',
            'dropped': 'bg-red-100 text-red-600'
          }[course.status] || 'bg-gray-100 text-gray-600';

          return (
            <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50 transition" onClick={() => setExpandedCourse(isExpanded ? null : i)}>
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="font-bold text-gray-800">{course.title}</h3>
                    <span className={`px-3 py-0.5 rounded-full text-xs font-semibold ${statusColor}`}>{statusLabel}</span>
                  </div>
                  <p className="text-sm text-gray-500">{course.trade?.toUpperCase()} &middot; NQF {course.nqfLevel} &middot; {course.difficulty} &middot; {course.instructor}</p>
                </div>
                <div className="flex items-center gap-4">
                  {course.certificateIssued && (
                    <span className="text-green-500" title={t('Certificate Issued')}>
                      <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                    </span>
                  )}
                  {course.grade != null && (
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg border-2 ${gc === 'green' ? 'bg-green-50 text-green-700 border-green-300' : gc === 'blue' ? 'bg-blue-50 text-blue-700 border-blue-300' : gc === 'yellow' ? 'bg-yellow-50 text-yellow-700 border-yellow-300' : gc === 'red' ? 'bg-red-50 text-red-700 border-red-300' : 'bg-gray-50 text-gray-500 border-gray-300'}`}>
                      {course.letterGrade}
                    </div>
                  )}
                  <svg className={`w-5 h-5 text-gray-400 transition ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </div>
              </div>

              {/* Expanded details */}
              {isExpanded && (
                <div className="border-t px-4 py-4 bg-gray-50">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 text-sm">
                    <div><span className="text-gray-500">{t('Enrolled')}:</span> <span className="font-medium">{course.enrolledAt ? new Date(course.enrolledAt).toLocaleDateString() : '-'}</span></div>
                    <div><span className="text-gray-500">{t('Completed')}:</span> <span className="font-medium">{course.completedAt ? new Date(course.completedAt).toLocaleDateString() : '-'}</span></div>
                    <div><span className="text-gray-500">{t('Progress')}:</span> <span className="font-medium">{Math.round(course.progress || 0)}%</span></div>
                    <div><span className="text-gray-500">{t('Modules')}:</span> <span className="font-medium">{course.completedModules}/{course.totalModules}</span></div>
                  </div>
                  {course.preAssessmentScore != null && (
                    <p className="text-sm text-gray-600 mb-3">{t('Pre-Assessment Score')}: <span className="font-semibold">{course.preAssessmentScore}%</span></p>
                  )}
                  {course.moduleResults && course.moduleResults.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-gray-700">{t('Module Breakdown')}:</p>
                      {course.moduleResults.map((mod, mi) => (
                        <div key={mi} className="flex items-center justify-between py-2 px-3 bg-white rounded-lg text-sm">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${mod.completed ? 'bg-green-500' : 'bg-gray-300'}`} />
                            <span className="text-gray-700">{mod.title}</span>
                            <span className="text-gray-400 text-xs capitalize">({mod.type})</span>
                          </div>
                          <div>
                            {mod.quizScore !== null && <span className={`font-semibold ${mod.quizScore >= 70 ? 'text-green-600' : 'text-red-600'}`}>{mod.quizScore}%</span>}
                            {mod.assignmentGrade !== null && <span className="font-semibold text-blue-600 ml-2">{mod.assignmentGrade}%</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {course.strengths?.length > 0 && (
                    <div className="mt-3"><p className="text-sm font-semibold text-green-700">{t('Strengths')}: {course.strengths.join(', ')}</p></div>
                  )}
                  {course.weaknesses?.length > 0 && (
                    <div className="mt-1"><p className="text-sm font-semibold text-orange-700">{t('Areas to Improve')}: {course.weaknesses.join(', ')}</p></div>
                  )}
                  {course.certificateId && (
                    <p className="mt-3 text-sm text-green-600 font-semibold">{t('Certificate')}: {course.certificateId}</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {transcript.length === 0 && (
        <div className="text-center py-16">
          <p className="text-gray-400 text-lg">{t('No courses in your transcript yet')}</p>
          <p className="text-gray-400 text-sm mt-1">{t('Enroll in a course to get started')}</p>
        </div>
      )}
    </div>
  );
}
