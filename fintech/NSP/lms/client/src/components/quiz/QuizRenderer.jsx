import TrueFalseQuestion from './TrueFalseQuestion';
import FillBlankQuestion from './FillBlankQuestion';
import MatchingQuestion from './MatchingQuestion';
import OrderingQuestion from './OrderingQuestion';
import DragDropQuestion from './DragDropQuestion';
import ShortAnswerQuestion from './ShortAnswerQuestion';
import EssayQuestion from './EssayQuestion';
import HotspotQuestion from './HotspotQuestion';

/**
 * QuizRenderer — dispatcher component that renders the correct question component
 * based on question.type.
 *
 * Props:
 *   question   — question object with type, options, etc.
 *   index      — question number (0-based, displayed as 1-based)
 *   answer     — current answer value
 *   onChange   — callback when answer changes
 *   disabled   — true after submission
 *   showResult — true after grading
 *   isCorrect  — whether the answer was correct
 */

/* ─── Difficulty badge (matches LMS.jsx convention) ─── */
function DifficultyBadge({ level }) {
  const colors = {
    beginner: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    intermediate: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    advanced: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    easy: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    hard: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  };
  if (!level) return null;
  return (
    <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full capitalize ${colors[level] || colors.beginner}`}>
      {level}
    </span>
  );
}

/* ─── Inline MCQ (radio buttons) ─── */
function MCQInline({ question, answer, onChange, disabled, showResult, isCorrect }) {
  const options = question.options || [];
  const correctIdx = typeof question.correctAnswer === 'number'
    ? question.correctAnswer
    : options.indexOf(question.correctAnswer);

  return (
    <div className="space-y-2">
      {options.map((opt, oi) => {
        const isSelected = answer === oi;
        const isCorrectOption = showResult && oi === correctIdx;
        const isWrongSelection = showResult && isSelected && oi !== correctIdx;

        return (
          <label
            key={oi}
            className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer border transition-colors
              ${isCorrectOption
                ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                : isWrongSelection
                  ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
                  : isSelected
                    ? 'border-ilo-blue bg-ilo-blue/5 dark:bg-ilo-blue/10'
                    : 'border-transparent hover:bg-gray-100 dark:hover:bg-navy-light'
              }
              ${disabled ? 'cursor-not-allowed' : ''}`}
          >
            <input
              type="radio"
              name={`mcq-${question._id || question.question}`}
              disabled={disabled}
              checked={isSelected}
              onChange={() => onChange(oi)}
              className="accent-ilo-blue"
            />
            <span className="text-sm dark:text-gray-300">{opt}</span>
            {isCorrectOption && (
              <span className="ml-auto text-green-600 dark:text-green-400 text-xs font-bold">Correct</span>
            )}
            {isWrongSelection && (
              <span className="ml-auto text-red-600 dark:text-red-400 text-xs font-bold">Wrong</span>
            )}
          </label>
        );
      })}
    </div>
  );
}

/* ─── Type label mapping ─── */
const TYPE_LABELS = {
  'mcq': 'Multiple Choice',
  'true-false': 'True / False',
  'fill-blank': 'Fill in the Blank',
  'matching': 'Matching',
  'ordering': 'Ordering',
  'drag-drop': 'Drag & Drop',
  'short-answer': 'Short Answer',
  'essay': 'Essay',
  'hotspot': 'Hotspot',
};

export default function QuizRenderer({ question, index, answer, onChange, disabled, showResult, isCorrect }) {
  const commonProps = { question, answer, onChange, disabled, showResult, isCorrect };

  const renderQuestion = () => {
    switch (question.type) {
      case 'mcq':
        return <MCQInline {...commonProps} />;
      case 'true-false':
        return <TrueFalseQuestion {...commonProps} />;
      case 'fill-blank':
        return <FillBlankQuestion {...commonProps} />;
      case 'matching':
        return <MatchingQuestion {...commonProps} />;
      case 'ordering':
        return <OrderingQuestion {...commonProps} />;
      case 'drag-drop':
        return <DragDropQuestion {...commonProps} />;
      case 'short-answer':
        return <ShortAnswerQuestion {...commonProps} />;
      case 'essay':
        return <EssayQuestion {...commonProps} />;
      case 'hotspot':
        return <HotspotQuestion {...commonProps} />;
      default:
        return (
          <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800">
            <p className="text-sm text-red-600 dark:text-red-400 font-semibold">
              Unknown question type: &quot;{question.type}&quot;
            </p>
          </div>
        );
    }
  };

  return (
    <div className={`p-4 rounded-xl border transition-colors
      ${showResult
        ? isCorrect
          ? 'border-green-300 dark:border-green-700 bg-gray-50 dark:bg-navy-light'
          : 'border-red-300 dark:border-red-700 bg-gray-50 dark:bg-navy-light'
        : 'border-border dark:border-navy-light bg-gray-50 dark:bg-navy-light'
      }`}
    >
      {/* Question header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          {/* Question number */}
          <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5
            ${showResult
              ? isCorrect
                ? 'bg-green-500 text-white'
                : 'bg-red-500 text-white'
              : 'bg-ilo-blue text-white'
            }`}>
            {(index ?? 0) + 1}
          </span>

          {/* Question text */}
          {question.type !== 'fill-blank' ? (
            <p className="text-sm font-semibold dark:text-white leading-relaxed pt-0.5">
              {question.question}
            </p>
          ) : (
            <p className="text-sm font-semibold dark:text-white leading-relaxed pt-0.5">
              Fill in the blanks:
            </p>
          )}
        </div>

        {/* Badges */}
        <div className="flex items-center gap-1.5 shrink-0">
          {question.difficulty && <DifficultyBadge level={question.difficulty} />}
          {question.points != null && (
            <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-ilo-blue/10 text-ilo-blue dark:bg-ilo-blue/20">
              {question.points} {question.points === 1 ? 'pt' : 'pts'}
            </span>
          )}
          <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-gray-100 text-gray-500 dark:bg-navy-mid dark:text-gray-400">
            {TYPE_LABELS[question.type] || question.type}
          </span>
        </div>
      </div>

      {/* Question body */}
      <div className="ml-9">
        {renderQuestion()}
      </div>
    </div>
  );
}
