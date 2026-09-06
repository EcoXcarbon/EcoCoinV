/**
 * Short answer question — single-line text input with 200 char limit.
 * answer: string
 */
export default function ShortAnswerQuestion({ question, answer, onChange, disabled, showResult, isCorrect }) {
  const maxLength = 200;
  const value = answer || '';

  return (
    <div>
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, maxLength))}
          disabled={disabled}
          placeholder="Type your answer..."
          maxLength={maxLength}
          className={`w-full px-4 py-3 text-sm rounded-xl border-2 transition-colors focus:outline-none focus:ring-2 focus:ring-ilo-blue/40
            ${showResult
              ? isCorrect
                ? 'border-green-500 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                : 'border-red-500 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
              : 'border-border dark:border-navy-light bg-white dark:bg-navy-mid text-gray-900 dark:text-white'
            }
            disabled:cursor-not-allowed disabled:opacity-75`}
        />
      </div>

      <div className="flex items-center justify-between mt-1.5">
        <span className={`text-[10px] ${value.length >= maxLength ? 'text-red-500 font-semibold' : 'text-gray-400 dark:text-gray-500'}`}>
          {value.length}/{maxLength} characters
        </span>
        {showResult && !isCorrect && question.acceptableAnswers && (
          <span className="text-[10px] text-green-600 dark:text-green-400 font-semibold">
            Accepted: {Array.isArray(question.acceptableAnswers) ? question.acceptableAnswers.join(', ') : question.correctAnswer}
          </span>
        )}
      </div>

      {showResult && (
        <div className={`mt-2 flex items-center gap-1.5 text-xs font-semibold
          ${isCorrect ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
          {isCorrect ? (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Correct
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              Incorrect
            </>
          )}
        </div>
      )}
    </div>
  );
}
