import React, { useState, useEffect } from 'react';
import api from '../../api/client';

const CATEGORY_CONFIG = {
  quiz: { label: 'Quiz & Exams', color: 'bg-blue-500', lightBg: 'bg-blue-100 dark:bg-blue-900/20', text: 'text-blue-700 dark:text-blue-300' },
  practical: { label: 'Practical & Assignments', color: 'bg-emerald-500', lightBg: 'bg-emerald-100 dark:bg-emerald-900/20', text: 'text-emerald-700 dark:text-emerald-300' },
  scenario: { label: 'Scenarios', color: 'bg-amber-500', lightBg: 'bg-amber-100 dark:bg-amber-900/20', text: 'text-amber-700 dark:text-amber-300' },
  participation: { label: 'Participation', color: 'bg-purple-500', lightBg: 'bg-purple-100 dark:bg-purple-900/20', text: 'text-purple-700 dark:text-purple-300' },
};

export default function GradingBreakdown({ programId, workerId }) {
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
      <div className="h-4 bg-gray-200 dark:bg-navy-light rounded w-40 mb-3" />
      <div className="space-y-2">
        {[1,2,3,4].map(i => <div key={i} className="h-6 bg-gray-200 dark:bg-navy-light rounded" />)}
      </div>
    </div>
  );

  if (!data?.gradingBreakdown) return null;

  const bd = data.gradingBreakdown;
  const passMark = data.passMark || 70;
  const grade = data.calculatedGrade || 0;
  const passing = grade >= passMark;

  return (
    <div className="p-4 bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold dark:text-white flex items-center gap-2">
          <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          Grading Breakdown
        </h3>
        <div className={`px-3 py-1 rounded-full text-xs font-bold ${
          passing ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
        }`}>
          {grade}% {passing ? 'PASS' : 'FAIL'}
        </div>
      </div>

      {/* Stacked category bars */}
      <div className="space-y-3">
        {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => {
          const raw = bd[`${key}RawScore`] ?? 0;
          const weighted = bd[`${key}WeightedScore`] ?? 0;
          const weight = bd.effectiveWeights?.[key] ?? 0;
          if (weight === 0) return null;

          return (
            <div key={key}>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-xs font-semibold ${cfg.text}`}>{cfg.label}</span>
                <span className="text-[10px] text-gray-500 dark:text-gray-400">
                  {raw}% raw × {weight}% weight = <strong className="dark:text-white">{weighted.toFixed(1)}pts</strong>
                </span>
              </div>
              <div className="h-3 bg-gray-100 dark:bg-navy-light rounded-full overflow-hidden relative">
                <div className={`h-full ${cfg.color} rounded-full transition-all duration-500`}
                  style={{ width: `${Math.min(raw, 100)}%` }} />
                {/* Weight marker */}
                <div className="absolute top-0 h-full border-r-2 border-dashed border-gray-400 dark:border-gray-500"
                  style={{ left: `${weight}%` }} title={`Weight: ${weight}%`} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Total bar */}
      <div className="pt-2 border-t border-border dark:border-navy-light">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-bold dark:text-white">Overall Grade</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Pass mark: {passMark}%
          </span>
        </div>
        <div className="h-4 bg-gray-100 dark:bg-navy-light rounded-full overflow-hidden relative">
          <div className={`h-full rounded-full transition-all duration-500 ${passing ? 'bg-green-500' : 'bg-red-500'}`}
            style={{ width: `${Math.min(grade, 100)}%` }} />
          {/* Pass mark line */}
          <div className="absolute top-0 h-full border-r-2 border-dashed border-gray-600 dark:border-gray-300"
            style={{ left: `${passMark}%` }} />
        </div>
      </div>

      {/* What you need section */}
      {!passing && (
        <div className="p-3 bg-amber-50 dark:bg-amber-900/10 rounded-lg border border-amber-200 dark:border-amber-800">
          <p className="text-xs font-bold text-amber-700 dark:text-amber-400 mb-1">What you need to pass</p>
          <p className="text-xs text-amber-600 dark:text-amber-500">
            You need {passMark - grade} more points. Focus on categories where your raw score is lowest:
          </p>
          <ul className="mt-1 space-y-0.5">
            {Object.entries(CATEGORY_CONFIG)
              .filter(([key]) => (bd.effectiveWeights?.[key] ?? 0) > 0)
              .sort(([a], [b]) => (bd[`${a}RawScore`] ?? 0) - (bd[`${b}RawScore`] ?? 0))
              .slice(0, 2)
              .map(([key, cfg]) => (
                <li key={key} className="text-xs text-amber-600 dark:text-amber-500">
                  • Improve <strong>{cfg.label}</strong> (currently {bd[`${key}RawScore`] ?? 0}%)
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
