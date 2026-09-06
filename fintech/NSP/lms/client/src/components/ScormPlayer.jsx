import { useEffect, useState, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';

/* ─── Fetch helpers ─── */
const csrf = () => document.cookie.match(/(?:^|;\s*)csrf-token=([^;]+)/)?.[1] || '';
const hdrs = () => ({
  'Content-Type': 'application/json',
  'X-CSRF-Token': csrf(),
});

const POLL_INTERVAL = 30000; // 30 seconds

/**
 * ScormPlayer - Full-screen overlay SCORM iframe player.
 *
 * Props:
 *   moduleId    - SCORM module ID
 *   onComplete  - callback(data) when SCORM content reports completion
 *   onClose     - callback to close the player overlay
 */
export default function ScormPlayer({ moduleId, onComplete, onClose }) {
  const [title, setTitle] = useState('SCORM Module');
  const [progress, setProgress] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [loading, setLoading] = useState(true);
  const iframeRef = useRef(null);
  const pollRef = useRef(null);
  const completedRef = useRef(false);

  /* ─── Fetch module metadata on mount ─── */
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/lms/api/v1/scorm/${moduleId}/runtime`, {
          method: 'GET',
          headers: hdrs(),
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json();
          if (data.title) setTitle(data.title);
          if (data.progress != null) setProgress(data.progress);
          if (data.completionStatus === 'completed' || data.completionStatus === 'passed') {
            setCompleted(true);
            completedRef.current = true;
          }
        }
      } catch {
        /* metadata fetch is best-effort */
      }
    })();
  }, [moduleId]);

  /* ─── Poll SCORM runtime state every 30s ─── */
  const checkRuntime = useCallback(async () => {
    if (completedRef.current) return;
    try {
      const res = await fetch(`/lms/api/v1/scorm/${moduleId}/runtime`, {
        method: 'GET',
        headers: hdrs(),
        credentials: 'include',
      });
      if (!res.ok) return;
      const data = await res.json();

      if (data.title) setTitle(data.title);
      if (data.progress != null) setProgress(data.progress);

      const isDone = data.completionStatus === 'completed' || data.completionStatus === 'passed';
      if (isDone && !completedRef.current) {
        completedRef.current = true;
        setCompleted(true);
        toast.success('Module completed!');
        onComplete?.({
          moduleId,
          score: data.score ?? null,
          completionStatus: data.completionStatus,
          successStatus: data.successStatus ?? null,
          totalTime: data.totalTime ?? null,
        });
      }
    } catch {
      /* polling failures are silent */
    }
  }, [moduleId, onComplete]);

  useEffect(() => {
    pollRef.current = setInterval(checkRuntime, POLL_INTERVAL);
    return () => clearInterval(pollRef.current);
  }, [checkRuntime]);

  /* ─── Listen for postMessage from SCORM iframe ─── */
  useEffect(() => {
    const handleMessage = (event) => {
      if (!event.data || typeof event.data !== 'object') return;
      const msg = event.data;

      /* Common SCORM postMessage patterns */
      if (msg.type === 'scorm-progress' || msg.type === 'scorm_progress') {
        if (msg.progress != null) setProgress(msg.progress);
      }

      if (msg.type === 'scorm-complete' || msg.type === 'scorm_complete' ||
          msg.completionStatus === 'completed' || msg.completionStatus === 'passed') {
        if (!completedRef.current) {
          completedRef.current = true;
          setCompleted(true);
          toast.success('Module completed!');
          onComplete?.({
            moduleId,
            score: msg.score ?? msg.scoreRaw ?? null,
            completionStatus: msg.completionStatus || 'completed',
            successStatus: msg.successStatus ?? null,
            totalTime: msg.totalTime ?? null,
          });
        }
      }

      if (msg.type === 'scorm-title' && msg.title) {
        setTitle(msg.title);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [moduleId, onComplete]);

  /* ─── Handle iframe load ─── */
  const handleIframeLoad = () => setLoading(false);

  /* ─── Handle close with confirmation if in-progress ─── */
  const handleClose = () => {
    if (!completedRef.current && progress > 0 && progress < 100) {
      const confirmed = window.confirm('You have unsaved progress. Are you sure you want to close?');
      if (!confirmed) return;
    }
    clearInterval(pollRef.current);
    onClose?.();
  };

  /* ─── Keyboard: Escape to close ─── */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [progress]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-sm">
      {/* ─── Top bar ─── */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-900 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <h3 className="text-sm font-semibold text-white truncate max-w-xs sm:max-w-md">
            {title}
          </h3>
          {completed && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-600 text-white shrink-0">
              Completed
            </span>
          )}
        </div>

        <div className="flex items-center gap-4 shrink-0">
          {/* Progress indicator */}
          <div className="hidden sm:flex items-center gap-2">
            <div className="w-32 h-2 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-ilo-blue rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              />
            </div>
            <span className="text-xs text-gray-400 w-10 text-right">{Math.round(progress)}%</span>
          </div>

          {/* Close button */}
          <button
            onClick={handleClose}
            className="flex items-center justify-center w-8 h-8 rounded-lg bg-gray-800 hover:bg-red-600 text-gray-400 hover:text-white transition-colors"
            title="Close player (Esc)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* ─── Mobile progress bar ─── */}
      <div className="sm:hidden h-1 bg-gray-800 shrink-0">
        <div className="h-full bg-ilo-blue transition-all duration-500" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
      </div>

      {/* ─── Iframe container ─── */}
      <div className="flex-1 flex items-center justify-center p-2 sm:p-4 overflow-hidden">
        <div className="relative w-full h-full max-w-6xl rounded-lg border border-gray-700 overflow-hidden bg-white">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-900/90 z-10">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-3 border-ilo-blue border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-gray-400">Loading SCORM content...</p>
              </div>
            </div>
          )}
          <iframe
            ref={iframeRef}
            src={`/lms/api/v1/scorm/${moduleId}/launch`}
            title={title}
            className="w-full h-full border-0"
            onLoad={handleIframeLoad}
            allow="autoplay; fullscreen; microphone; camera"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          />
        </div>
      </div>
    </div>
  );
}
