import { useMemo } from 'react';

/**
 * Fill-in-the-blank question.
 * Renders question text with {{blank}} markers replaced by inline inputs.
 * answer: string[] — one entry per blank.
 */
export default function FillBlankQuestion({ question, answer, onChange, disabled, showResult, isCorrect }) {
  const parts = useMemo(() => {
    return question.question.split(/\{\{blank\}\}/gi);
  }, [question.question]);

  const blanksCount = parts.length - 1;
  const values = answer || Array(blanksCount).fill('');

  const handleChange = (idx, val) => {
    const next = [...values];
    next[idx] = val;
    onChange(next);
  };

  const correctAnswers = question.correctAnswer || question.acceptableAnswers || [];

  const isBlankCorrect = (idx) => {
    if (!correctAnswers[idx]) return false;
    return values[idx]?.toLowerCase().trim() === String(correctAnswers[idx]).toLowerCase().trim();
  };

  return (
    <div className="leading-relaxed text-sm dark:text-gray-200">
      {parts.map((part, i) => (
        <span key={i}>
          <span>{part}</span>
          {i < blanksCount && (
            <span className="inline-flex items-center mx-1 align-baseline">
              <input
                type="text"
                value={values[i] || ''}
                onChange={(e) => handleChange(i, e.target.value)}
                disabled={disabled}
                placeholder={`blank ${i + 1}`}
                className={`inline-block w-36 px-2 py-1 text-sm rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-ilo-blue/40
                  ${showResult
                    ? isBlankCorrect(i)
                      ? 'border-green-500 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                      : 'border-red-500 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                    : 'border-border dark:border-navy-light bg-white dark:bg-navy-mid text-gray-900 dark:text-white'
                  }
                  disabled:cursor-not-allowed disabled:opacity-75`}
              />
              {showResult && correctAnswers[i] && !isBlankCorrect(i) && (
                <span className="ml-1.5 text-[10px] font-semibold text-green-600 dark:text-green-400 whitespace-nowrap">
                  ({correctAnswers[i]})
                </span>
              )}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}
