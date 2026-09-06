import { useState, useEffect, useRef } from 'react';

/**
 * Contextual help tooltip — shows a pulsing dot that expands to a tip on click.
 * Automatically shows the tip on first visit (per tipId), then collapses.
 * Dismissed tips are stored in localStorage.
 *
 * Props:
 *   tipId    — unique key for localStorage (e.g. "lms-enroll")
 *   text     — the help text to display
 *   position — "top" | "bottom" | "left" | "right" (default "top")
 */
export default function HelpTip({ tipId, text, position = 'top' }) {
  const storageKey = `tl-help-${tipId}`;
  const [dismissed, setDismissed] = useState(() => !!localStorage.getItem(storageKey));
  const [open, setOpen] = useState(false);
  const [autoShown, setAutoShown] = useState(false);
  const ref = useRef();

  // Auto-show on first visit after a delay
  useEffect(() => {
    if (dismissed || autoShown) return;
    const timer = setTimeout(() => {
      setOpen(true);
      setAutoShown(true);
      // Auto-hide after 5s
      setTimeout(() => setOpen(false), 5000);
    }, 1500);
    return () => clearTimeout(timer);
  }, [dismissed, autoShown]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const dismiss = () => {
    setOpen(false);
    setDismissed(true);
    localStorage.setItem(storageKey, '1');
  };

  if (dismissed) return null;

  const positionClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  return (
    <div ref={ref} className="relative inline-flex items-center">
      <button
        onClick={() => setOpen(!open)}
        className="w-5 h-5 rounded-full bg-ilo-blue text-white text-[10px] font-bold flex items-center justify-center shrink-0 hover:bg-ilo-dark transition-colors relative"
        aria-label="Help"
      >
        ?
        {!open && (
          <span className="absolute inset-0 rounded-full bg-ilo-blue animate-ping opacity-40" />
        )}
      </button>
      {open && (
        <div className={`absolute z-50 ${positionClasses[position]} w-56 bg-gray-900 dark:bg-gray-800 text-white text-xs rounded-xl p-3 shadow-xl`}>
          <p className="leading-relaxed">{text}</p>
          <button onClick={dismiss}
            className="mt-2 text-[10px] text-blue-300 hover:text-white font-semibold">
            Got it, don't show again
          </button>
          {/* Arrow */}
          {position === 'top' && <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-transparent border-t-gray-900 dark:border-t-gray-800" />}
          {position === 'bottom' && <div className="absolute bottom-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-b-[6px] border-transparent border-b-gray-900 dark:border-b-gray-800" />}
        </div>
      )}
    </div>
  );
}
