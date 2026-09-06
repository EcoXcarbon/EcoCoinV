import { useState, useEffect } from 'react';
import { useLang } from '../../context/LangContext';

export default function ResultsView({ program, enrollment, onBack }) {
  const { t, lang } = useLang();
  const [aiSummary, setAiSummary] = useState(null);
  const [loadingAI, setLoadingAI] = useState(false);

  const grade = enrollment?.evaluationGrade;
  const letterGrade = enrollment?.evaluationSummary?.overallGrade;
  const isEvaluated = enrollment?.status === 'evaluated';
  const isSubmitted = enrollment?.status === 'submitted';

  const getAISummary = async () => {
    setLoadingAI(true);
    try {
      const res = await fetch(`/lms/api/ai/training/${program._id}/evaluation-summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('tl-token')}` },
        body: JSON.stringify({ language: lang })
      });
      const data = await res.json();
      setAiSummary(data);
    } catch (err) {
      console.error(err);
    }
    setLoadingAI(false);
  };

  // Build module results
  const moduleResults = (program.modules || []).map(mod => {
    const modId = mod._id;
    const isCompleted = enrollment?.completedModules?.some(cm => cm.toString() === modId || cm === modId);
    const quizAttempts = (enrollment?.quizAttempts || []).filter(a => (a.moduleId?.toString?.() || a.moduleId) === modId || (a.moduleId?.toString?.() || a.moduleId) === mod._id?.toString?.());
    const bestQuizScore = quizAttempts.length > 0 ? Math.max(...quizAttempts.map(a => a.score)) : null;
    const submission = (enrollment?.submissions || []).find(s => (s.moduleId?.toString?.() || s.moduleId) === modId || (s.moduleId?.toString?.() || s.moduleId) === mod._id?.toString?.());
    return {
      title: mod.title,
      type: mod.type,
      completed: isCompleted,
      quizScore: bestQuizScore,
      assignmentGrade: submission?.grade ?? null,
      assignmentStatus: submission?.status ?? null,
      attempts: quizAttempts.length
    };
  });

  const gradeColor = !grade ? 'gray' : grade >= 90 ? 'green' : grade >= 70 ? 'blue' : grade >= 60 ? 'yellow' : 'red';
  const gradeColorMap = {
    green: 'bg-green-100 text-green-700 border-green-300',
    blue: 'bg-blue-100 text-blue-700 border-blue-300',
    yellow: 'bg-yellow-100 text-yellow-700 border-yellow-300',
    red: 'bg-red-100 text-red-700 border-red-300',
    gray: 'bg-gray-100 text-gray-500 border-gray-300'
  };

  return (
    <div className="max-w-3xl mx-auto p-6">
      {/* Header */}
      <button onClick={onBack} className="text-blue-600 hover:text-blue-800 mb-4 flex items-center gap-1 font-medium">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        {t('Back')}
      </button>

      <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
        {/* Grade Banner */}
        <div className={`p-8 text-center ${isEvaluated ? 'bg-gradient-to-r from-blue-600 to-indigo-600' : 'bg-gradient-to-r from-gray-500 to-gray-600'} text-white`}>
          <h1 className="text-2xl font-bold mb-1">{program.title}</h1>
          <p className="text-blue-100 mb-4">{program.trade?.toUpperCase()} &middot; NQF Level {program.nqfLevel}</p>
          {isEvaluated && (
            <div className="flex items-center justify-center gap-6">
              <div className="bg-white/20 rounded-2xl px-8 py-4">
                <p className="text-5xl font-bold">{letterGrade}</p>
                <p className="text-sm text-blue-100 mt-1">{grade}%</p>
              </div>
              <div className="text-left">
                <p className="text-lg font-semibold">{grade >= 70 ? t('Passed') : t('Needs Improvement')}</p>
                {enrollment.certificateIssued && (
                  <p className="text-sm text-blue-200 flex items-center gap-1 mt-1">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                    {t('Certificate Issued')}: {enrollment.certificateId}
                  </p>
                )}
              </div>
            </div>
          )}
          {isSubmitted && (
            <div className="bg-white/20 rounded-2xl px-8 py-4 inline-block">
              <p className="text-lg font-semibold">{t('Awaiting Evaluation')}</p>
              <p className="text-sm text-blue-200 mt-1">{t('Your course has been submitted and is under review')}</p>
            </div>
          )}
        </div>

        {/* Module Results */}
        <div className="p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-4">{t('Module Results')}</h3>
          <div className="space-y-3">
            {moduleResults.map((mod, i) => (
              <div key={i} className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${mod.completed ? 'bg-green-100 text-green-600' : 'bg-gray-200 text-gray-400'}`}>
                    {mod.completed ? '\u2713' : i + 1}
                  </div>
                  <div>
                    <p className="font-medium text-gray-800">{mod.title}</p>
                    <p className="text-xs text-gray-500 capitalize">{mod.type}</p>
                  </div>
                </div>
                <div className="text-right">
                  {mod.quizScore !== null && (
                    <span className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${mod.quizScore >= 70 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {mod.quizScore}%
                    </span>
                  )}
                  {mod.assignmentGrade !== null && (
                    <span className="inline-block px-3 py-1 rounded-full text-sm font-semibold bg-blue-100 text-blue-700 ml-2">
                      {mod.assignmentGrade}%
                    </span>
                  )}
                  {mod.type === 'video' && mod.completed && <span className="text-green-500 text-sm">{t('Watched')}</span>}
                  {mod.type === 'reading' && mod.completed && <span className="text-green-500 text-sm">{t('Read')}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Evaluation Summary */}
        {isEvaluated && enrollment.evaluationSummary && (
          <div className="p-6 border-t">
            <h3 className="text-lg font-bold text-gray-800 mb-4">{t('Evaluation Summary')}</h3>
            {enrollment.evaluationSummary.strengths?.length > 0 && (
              <div className="mb-3">
                <p className="font-semibold text-green-700 mb-1">{t('Strengths')}:</p>
                <ul className="list-disc list-inside text-gray-600">
                  {enrollment.evaluationSummary.strengths.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
            {enrollment.evaluationSummary.weaknesses?.length > 0 && (
              <div className="mb-3">
                <p className="font-semibold text-orange-700 mb-1">{t('Areas for Improvement')}:</p>
                <ul className="list-disc list-inside text-gray-600">
                  {enrollment.evaluationSummary.weaknesses.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}
            {enrollment.evaluationSummary.recommendation && (
              <p className="text-gray-600 italic mt-2">"{enrollment.evaluationSummary.recommendation}"</p>
            )}
          </div>
        )}

        {/* AI Analysis Button */}
        {(isEvaluated || isSubmitted) && (
          <div className="p-6 border-t">
            {!aiSummary ? (
              <button onClick={getAISummary} disabled={loadingAI}
                className="w-full py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-xl font-semibold hover:from-purple-700 hover:to-indigo-700 disabled:opacity-50 transition flex items-center justify-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                {loadingAI ? t('Analyzing...') : t('Get AI Performance Analysis')}
              </button>
            ) : (
              <div>
                <h3 className="text-lg font-bold text-purple-800 mb-3 flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                  {t('AI Performance Analysis')}
                </h3>
                {aiSummary.overallAssessment && <p className="text-gray-700 mb-4">{aiSummary.overallAssessment}</p>}
                {aiSummary.skillGaps?.length > 0 && (
                  <div className="mb-3">
                    <p className="font-semibold text-red-700 mb-1">{t('Skill Gaps')}:</p>
                    <div className="flex flex-wrap gap-2">{aiSummary.skillGaps.map((g, i) => <span key={i} className="bg-red-100 text-red-700 px-3 py-1 rounded-full text-sm">{g}</span>)}</div>
                  </div>
                )}
                {aiSummary.recommendedNextCourses?.length > 0 && (
                  <div className="mb-3">
                    <p className="font-semibold text-blue-700 mb-1">{t('Recommended Next')}:</p>
                    <div className="flex flex-wrap gap-2">{aiSummary.recommendedNextCourses.map((c, i) => <span key={i} className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-sm">{c}</span>)}</div>
                  </div>
                )}
                {aiSummary.improvementPlan && (
                  <div className="p-4 bg-purple-50 rounded-xl mt-3">
                    <p className="font-semibold text-purple-800 mb-1">{t('Improvement Plan')}:</p>
                    <p className="text-gray-700">{aiSummary.improvementPlan}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
