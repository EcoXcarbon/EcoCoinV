import { useState, useMemo } from 'react';

/**
 * Matching question — click-to-match pairs.
 * question.matchPairs: [{left, right}] — the correct pairs
 * answer: [{left, right}] — user's matched pairs
 *
 * Interaction: Click a left item, then click a right item to form a pair.
 * Click an existing matched item to remove that pair.
 */
export default function MatchingQuestion({ question, answer, onChange, disabled, showResult, isCorrect }) {
  const [selectedLeft, setSelectedLeft] = useState(null);

  const pairs = answer || [];
  const matchPairs = question.matchPairs || [];

  const leftItems = useMemo(() => matchPairs.map(p => p.left), [matchPairs]);
  const rightItems = useMemo(() => {
    const items = matchPairs.map(p => p.right);
    // Deterministic shuffle so right items are not in same order as left
    return [...items].sort((a, b) => {
      const ha = Array.from(a).reduce((s, c) => s + c.charCodeAt(0), 0);
      const hb = Array.from(b).reduce((s, c) => s + c.charCodeAt(0), 0);
      return ha - hb;
    });
  }, [matchPairs]);

  const matchedLefts = new Set(pairs.map(p => p.left));
  const matchedRights = new Set(pairs.map(p => p.right));

  // Color assignments for matched pairs
  const pairColors = [
    'bg-blue-100 border-blue-400 dark:bg-blue-900/30 dark:border-blue-500',
    'bg-purple-100 border-purple-400 dark:bg-purple-900/30 dark:border-purple-500',
    'bg-amber-100 border-amber-400 dark:bg-amber-900/30 dark:border-amber-500',
    'bg-teal-100 border-teal-400 dark:bg-teal-900/30 dark:border-teal-500',
    'bg-pink-100 border-pink-400 dark:bg-pink-900/30 dark:border-pink-500',
    'bg-indigo-100 border-indigo-400 dark:bg-indigo-900/30 dark:border-indigo-500',
    'bg-emerald-100 border-emerald-400 dark:bg-emerald-900/30 dark:border-emerald-500',
    'bg-orange-100 border-orange-400 dark:bg-orange-900/30 dark:border-orange-500',
  ];

  const getPairColorForItem = (item, side) => {
    const idx = pairs.findIndex(p => p[side] === item);
    if (idx === -1) return '';
    return pairColors[idx % pairColors.length];
  };

  const handleLeftClick = (item) => {
    if (disabled) return;
    if (matchedLefts.has(item)) {
      onChange(pairs.filter(p => p.left !== item));
      return;
    }
    setSelectedLeft(item);
  };

  const handleRightClick = (item) => {
    if (disabled) return;
    if (matchedRights.has(item)) {
      onChange(pairs.filter(p => p.right !== item));
      return;
    }
    if (selectedLeft == null) return;
    const newPairs = [...pairs.filter(p => p.left !== selectedLeft), { left: selectedLeft, right: item }];
    onChange(newPairs);
    setSelectedLeft(null);
  };

  const isCorrectPair = (left, right) => {
    return matchPairs.some(p => p.left === left && p.right === right);
  };

  return (
    <div>
      {!disabled && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Click a left item, then click its match on the right. Click a matched item to unmatch it.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4">
        {/* Left column */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">Items</p>
          {leftItems.map((item) => {
            const matched = matchedLefts.has(item);
            const pair = pairs.find(p => p.left === item);
            const colorClass = matched ? getPairColorForItem(item, 'left') : '';
            const isActive = selectedLeft === item;

            return (
              <button
                key={item}
                type="button"
                disabled={disabled}
                onClick={() => handleLeftClick(item)}
                className={`w-full text-left px-3 py-2.5 text-sm rounded-lg border-2 transition-all
                  ${isActive
                    ? 'border-ilo-blue bg-ilo-blue/10 dark:bg-ilo-blue/20 text-ilo-blue font-semibold shadow-sm'
                    : matched
                      ? `${colorClass} ${showResult && pair
                          ? isCorrectPair(pair.left, pair.right) ? 'ring-2 ring-green-500' : 'ring-2 ring-red-500'
                          : ''}`
                      : 'border-border dark:border-navy-light bg-white dark:bg-navy-mid text-gray-700 dark:text-gray-300 hover:border-ilo-blue/50'
                  }
                  disabled:cursor-not-allowed`}
              >
                {item}
                {showResult && matched && pair && (
                  <span className={`ml-2 text-[10px] font-bold ${isCorrectPair(pair.left, pair.right) ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {isCorrectPair(pair.left, pair.right) ? 'Correct' : 'Wrong'}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Right column */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">Matches</p>
          {rightItems.map((item) => {
            const matched = matchedRights.has(item);
            const colorClass = matched ? getPairColorForItem(item, 'right') : '';
            const pair = pairs.find(p => p.right === item);

            return (
              <button
                key={item}
                type="button"
                disabled={disabled}
                onClick={() => handleRightClick(item)}
                className={`w-full text-left px-3 py-2.5 text-sm rounded-lg border-2 transition-all
                  ${matched
                    ? `${colorClass} ${showResult && pair
                        ? isCorrectPair(pair.left, pair.right) ? 'ring-2 ring-green-500' : 'ring-2 ring-red-500'
                        : ''}`
                    : selectedLeft != null
                      ? 'border-ilo-blue/30 bg-ilo-blue/5 dark:bg-ilo-blue/10 text-gray-700 dark:text-gray-300 hover:border-ilo-blue cursor-pointer'
                      : 'border-border dark:border-navy-light bg-white dark:bg-navy-mid text-gray-700 dark:text-gray-300'
                  }
                  disabled:cursor-not-allowed`}
              >
                {item}
              </button>
            );
          })}
        </div>
      </div>

      {/* Correct answers revealed when wrong */}
      {showResult && !isCorrect && (
        <div className="mt-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800">
          <p className="text-[10px] font-bold text-green-700 dark:text-green-400 uppercase mb-1">Correct Matches</p>
          <div className="space-y-1">
            {matchPairs.map((p, i) => (
              <p key={i} className="text-xs text-green-800 dark:text-green-300">
                {p.left} <span className="text-green-500 mx-1">&rarr;</span> {p.right}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
