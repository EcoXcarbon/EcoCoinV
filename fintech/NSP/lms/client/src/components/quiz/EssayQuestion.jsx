import { useMemo } from 'react';

/**
 * Essay question — textarea with character count, min 500 / max 2000 chars.
 * Shows AI grading indicator when showResult is true but score is pending.
 * answer: string
 */
export default function EssayQuestion({ question, answer, onChange, disabled, showResult, isCorrect }) {
  const minLength = 500;
  const maxLength = 2000;
  const value = answer || '';
  const charCount = value.length;

  const charState = useMemo(() => {
    if (charCount === 0) return 'empty';
    if (charCount < minLength) return 'under';
    if (charCount >= maxLength) return 'max';
    return 'valid';
  }, [charCount]);

  const charColor = {
    empty: 'text-gray-400 dark:text-gray-500',
    under: 'text-amber-500 dark:text-amber-400',
    valid: 'text-green-500 dark:text-green-400',
    max: 'text-red-500 dark:text-red-400',
  };

  // Score may not be available yet for essay questions (AI grading pending)
  const isPending = showResult && isCorrect === null;

  return (
    <div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, maxLength))}
        disabled={disabled}
        placeholder="Write your essay response here..."
        rows={8}
        maxLength={maxLength}
        className={`w-full px-4 py-3 text-sm rounded-xl border-2 transition-colors resize-y focus:outline-none focus:ring-2 focus:ring-ilo-blue/40
          ${showResult
            ? isCorrect === true
              ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
              : isCorrect === false
                ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
                : 'border-amber-500 bg-amber-50 dark:bg-amber-900/20'
            : 'border-border dark:border-navy-light bg-white dark:bg-navy-mid'
          }
          text-gray-900 dark:text-white
          disabled:cursor-not-allowed disabled:opacity-75`}
      />

      {/* Character counter bar */}
      <div className="flex items-center justify-between mt-1.5">
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-semibold ${charColor[charState]}`}>
            {charCount}/{maxLength} characters
          </span>
          {charState === 'under' && (
            <span className="text-[10px] text-amber-500 dark:text-amber-400">
              (minimum {minLength})
            </span>
          )}
          {charState === 'valid' && (
            <span className="text-[10px] text-green-500 dark:text-green-400">
              Length OK
            </span>
          )}
        </div>

        {/* Progress indicator */}
        {!showResult && (
          <div className="flex items-center gap-1">
            <div className="w-20 h-1.5 rounded-full bg-gray-200 dark:bg-navy-light overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300
                  ${charState === 'max' ? 'bg-red-500' : charState === 'valid' ? 'bg-green-500' : charState === 'under' ? 'bg-amber-500' : 'bg-gray-300'}`}
                style={{ width: `${Math.min((charCount / maxLength) * 100, 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Result / grading status */}
      {showResult && (
        <div className="mt-3">
          {isPending ? (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800">
              <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                AI Grading in Progress...
              </span>
              <span className="text-[10px] text-amber-500 dark:text-amber-400/70">
                Your essay is being evaluated. Score will appear shortly.
              </span>
            </div>
          ) : isCorrect ? (
            <div className="flex items-center gap-1.5 text-xs font-semibold text-green-600 dark:text-green-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Essay graded — Passed
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs font-semibold text-red-600 dark:text-red-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              Essay graded — Needs improvement
            </div>
          )}
        </div>
      )}
    </div>
  );
}
