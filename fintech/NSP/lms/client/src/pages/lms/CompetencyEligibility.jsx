import React, { useState, useEffect } from 'react';
import api from '../../api/client';

const LEVEL_COLORS = {
  foundation: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  intermediate: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  advanced: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  expert: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
};

export default function CompetencyEligibility({ programId, workerId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!programId || !workerId) return;
    setLoading(true);
    api.get(`/training/${programId}/competency-check/${workerId}`)
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [programId, workerId]);

  if (loading) return (
    <div className="p-4 bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light animate-pulse">
      <div className="h-4 bg-gray-200 dark:bg-navy-light rounded w-48 mb-3" />
      <div className="space-y-2">
        {[1,2,3].map(i => <div key={i} className="h-8 bg-gray-200 dark:bg-navy-light rounded" />)}
      </div>
    </div>
  );

  if (!data) return null;

  const { competencyCheckPassed, competencyGapReport, certificateEligible, calculatedGrade, passMark } = data;
  const gaps = competencyGapReport || [];
  if (gaps.length === 0) return null;

  const metCount = gaps.filter(g => g.met).length;
  const totalCount = gaps.length;

  return (
    <div className="p-4 bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold dark:text-white flex items-center gap-2">
          <svg className="w-4 h-4 text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
          </svg>
          Certificate Eligibility
        </h3>
        <span className={`px-2.5 py-0.5 text-[10px] font-bold rounded-full ${
          certificateEligible
            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
            : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
        }`}>
          {certificateEligible ? 'ELIGIBLE' : 'NOT YET ELIGIBLE'}
        </span>
      </div>

      {/* Overall indicator */}
      <div className={`p-3 rounded-lg border ${
        certificateEligible
          ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800'
          : 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800'
      }`}>
        <div className="flex items-center gap-3">
          {certificateEligible ? (
            <svg className="w-8 h-8 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ) : (
            <svg className="w-8 h-8 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          )}
          <div>
            <p className={`text-sm font-bold ${certificateEligible ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'}`}>
              {certificateEligible ? 'Ready for Certification' : 'Competency Gaps Remain'}
            </p>
            <p className={`text-xs ${certificateEligible ? 'text-green-600 dark:text-green-500' : 'text-amber-600 dark:text-amber-500'}`}>
              Grade: {calculatedGrade}% (need {passMark}%) • Competencies: {metCount}/{totalCount} met
            </p>
          </div>
        </div>
      </div>

      {/* Individual competency targets */}
      <div className="space-y-2">
        {gaps.map((g, i) => (
          <div key={i} className={`p-3 rounded-lg border ${
            g.met
              ? 'border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/5'
              : 'border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/5'
          }`}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                {g.met ? (
                  <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
                <span className="text-xs font-semibold dark:text-white">{g.skill}</span>
              </div>
              <span className={`px-2 py-0.5 text-[9px] font-bold rounded-full capitalize ${LEVEL_COLORS[g.targetLevel] || LEVEL_COLORS.foundation}`}>
                {g.targetLevel}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 bg-gray-200 dark:bg-navy-light rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-500 ${g.met ? 'bg-green-500' : 'bg-red-400'}`}
                  style={{ width: `${Math.min(g.threshold > 0 ? g.currentScore / g.threshold * 100 : 0, 100)}%` }} />
              </div>
              <span className="text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                {g.currentScore}% / {g.threshold}%
              </span>
            </div>
            {!g.met && g.gap > 0 && (
              <p className="text-[10px] text-red-600 dark:text-red-400 mt-1">
                Need {g.gap} more points in this competency
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Recommendations */}
      {!certificateEligible && (
        <div className="p-3 bg-indigo-50 dark:bg-indigo-900/10 rounded-lg border border-indigo-200 dark:border-indigo-800">
          <p className="text-xs font-bold text-indigo-700 dark:text-indigo-400 mb-1">Recommendations</p>
          <ul className="space-y-0.5">
            {!data.gradePassCheck && (
              <li className="text-xs text-indigo-600 dark:text-indigo-500">
                • Improve your overall grade by retaking quizzes and completing knowledge checks
              </li>
            )}
            {gaps.filter(g => !g.met).map((g, i) => (
              <li key={i} className="text-xs text-indigo-600 dark:text-indigo-500">
                • Complete more assessments tagged with "{g.skill}" to raise your score
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
