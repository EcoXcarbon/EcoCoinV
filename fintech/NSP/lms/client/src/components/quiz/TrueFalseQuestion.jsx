/**
 * True/False question — two large toggle buttons.
 * answer: true | false | null
 */
export default function TrueFalseQuestion({ question, answer, onChange, disabled, showResult, isCorrect }) {
  const options = [
    { label: 'True', value: true },
    { label: 'False', value: false },
  ];

  const getButtonClass = (val) => {
    const selected = answer === val;
    const base = 'flex-1 py-4 rounded-xl text-sm font-bold transition-all border-2 focus:outline-none';

    if (showResult) {
      const correctVal = question.correctAnswer === true || question.correctAnswer === 'true';
      const isThisCorrect = val === correctVal;

      if (isThisCorrect) {
        return `${base} border-green-500 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400 dark:border-green-500`;
      }
      if (selected && !isCorrect) {
        return `${base} border-red-500 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400 dark:border-red-500`;
      }
      return `${base} border-border dark:border-navy-light text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-navy-mid`;
    }

    if (selected) {
      return `${base} border-ilo-blue bg-ilo-blue/10 text-ilo-blue dark:bg-ilo-blue/20 dark:text-ilo-blue shadow-sm`;
    }

    return `${base} border-border dark:border-navy-light text-gray-700 dark:text-gray-300 bg-white dark:bg-navy-mid hover:border-ilo-blue/50 hover:bg-ilo-blue/5 dark:hover:bg-ilo-blue/10`;
  };

  return (
    <div className="flex gap-4">
      {options.map(({ label, value }) => (
        <button
          key={label}
          type="button"
          disabled={disabled}
          onClick={() => onChange(value)}
          className={getButtonClass(value)}
        >
          <span className="text-lg">{label}</span>
          {showResult && (() => {
            const correctVal = question.correctAnswer === true || question.correctAnswer === 'true';
            if (value === correctVal) {
              return <span className="block text-[10px] mt-1 text-green-600 dark:text-green-400 font-semibold">Correct Answer</span>;
            }
            if (answer === value && !isCorrect) {
              return <span className="block text-[10px] mt-1 text-red-600 dark:text-red-400 font-semibold">Your Answer</span>;
            }
            return null;
          })()}
        </button>
      ))}
    </div>
  );
}
