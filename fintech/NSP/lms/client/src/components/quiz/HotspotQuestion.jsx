import { useRef, useState, useCallback } from 'react';

/**
 * Hotspot question — click on an image to select a point.
 * question.hotspotImage: string (URL)
 * question.hotspotRegions: [{x, y, radius}] — correct clickable regions (percentages)
 * answer: {x, y} — click position as percentages (0-100)
 */
export default function HotspotQuestion({ question, answer, onChange, disabled, showResult, isCorrect }) {
  const containerRef = useRef(null);
  const [imageLoaded, setImageLoaded] = useState(false);

  const handleClick = useCallback((e) => {
    if (disabled) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    onChange({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 });
  }, [disabled, onChange]);

  const regions = question.hotspotRegions || [];

  return (
    <div>
      {!disabled && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Click on the image to mark your answer. You can click again to reposition.
        </p>
      )}

      <div
        ref={containerRef}
        className={`relative inline-block w-full max-w-xl rounded-xl overflow-hidden border-2 transition-colors
          ${showResult
            ? isCorrect
              ? 'border-green-500'
              : 'border-red-500'
            : 'border-border dark:border-navy-light'
          }
          ${disabled ? 'cursor-not-allowed' : 'cursor-crosshair'}
        `}
      >
        {/* Image */}
        <img
          src={question.hotspotImage}
          alt="Hotspot question"
          className="w-full h-auto block select-none"
          draggable={false}
          onLoad={() => setImageLoaded(true)}
        />

        {/* SVG overlay for click detection and markers */}
        {imageLoaded && (
          <svg
            className="absolute inset-0 w-full h-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            onClick={handleClick}
            style={{ pointerEvents: disabled ? 'none' : 'auto' }}
          >
            {/* Show correct regions on result */}
            {showResult && regions.map((region, i) => (
              <circle
                key={`region-${i}`}
                cx={region.x}
                cy={region.y}
                r={region.radius || 5}
                fill="rgba(34, 197, 94, 0.2)"
                stroke="rgba(34, 197, 94, 0.8)"
                strokeWidth="0.4"
                strokeDasharray="1,0.5"
              />
            ))}

            {/* User's click marker */}
            {answer && (
              <g>
                {/* Outer ring */}
                <circle
                  cx={answer.x}
                  cy={answer.y}
                  r={2.5}
                  fill="none"
                  stroke={showResult ? (isCorrect ? '#22c55e' : '#ef4444') : '#2563eb'}
                  strokeWidth="0.4"
                />
                {/* Inner dot */}
                <circle
                  cx={answer.x}
                  cy={answer.y}
                  r={0.8}
                  fill={showResult ? (isCorrect ? '#22c55e' : '#ef4444') : '#2563eb'}
                />
                {/* Crosshair lines */}
                <line x1={answer.x - 3.5} y1={answer.y} x2={answer.x - 1.5} y2={answer.y}
                  stroke={showResult ? (isCorrect ? '#22c55e' : '#ef4444') : '#2563eb'} strokeWidth="0.3" />
                <line x1={answer.x + 1.5} y1={answer.y} x2={answer.x + 3.5} y2={answer.y}
                  stroke={showResult ? (isCorrect ? '#22c55e' : '#ef4444') : '#2563eb'} strokeWidth="0.3" />
                <line x1={answer.x} y1={answer.y - 3.5} x2={answer.x} y2={answer.y - 1.5}
                  stroke={showResult ? (isCorrect ? '#22c55e' : '#ef4444') : '#2563eb'} strokeWidth="0.3" />
                <line x1={answer.x} y1={answer.y + 1.5} x2={answer.x} y2={answer.y + 3.5}
                  stroke={showResult ? (isCorrect ? '#22c55e' : '#ef4444') : '#2563eb'} strokeWidth="0.3" />
              </g>
            )}
          </svg>
        )}

        {/* Loading skeleton */}
        {!imageLoaded && (
          <div className="w-full h-48 bg-gray-200 dark:bg-navy-light animate-pulse flex items-center justify-center">
            <span className="text-xs text-gray-400 dark:text-gray-500">Loading image...</span>
          </div>
        )}
      </div>

      {/* Coordinates display */}
      {answer && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">
            Position: ({answer.x.toFixed(1)}%, {answer.y.toFixed(1)}%)
          </span>
        </div>
      )}

      {/* Result feedback */}
      {showResult && (
        <div className={`mt-2 flex items-center gap-1.5 text-xs font-semibold
          ${isCorrect ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
          {isCorrect ? (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Correct spot selected
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              Incorrect — the correct region is highlighted in green
            </>
          )}
        </div>
      )}
    </div>
  );
}
