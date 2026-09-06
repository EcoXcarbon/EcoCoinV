import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLang } from '../../context/LangContext';
import toast from 'react-hot-toast';

/**
 * QR Scanner — uses BarcodeDetector API where available (Chrome/Edge/Android),
 * falls back to getUserMedia + canvas-based jsQR-style polling.
 */
export default function WalletScanner({ onNavigate }) {
  const { t } = useLang();
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const scannerRef = useRef(null);

  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [torchOn, setTorchOn] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [supported, setSupported] = useState(true);

  // Check BarcodeDetector support
  const hasBarcodeDetector = typeof window !== 'undefined' && 'BarcodeDetector' in window;

  useEffect(() => {
    // Check if camera is available at all
    if (!navigator.mediaDevices?.getUserMedia) {
      setSupported(false);
      setError('Camera not supported in this browser. Use Chrome or a modern mobile browser.');
    }
    return () => stopCamera();
  }, []);

  const startCamera = async () => {
    setError('');
    setResult(null);
    try {
      const constraints = {
        video: {
          facingMode: 'environment', // rear camera preferred
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // Check for torch capability
      const track = stream.getVideoTracks()[0];
      const capabilities = track?.getCapabilities?.();
      if (capabilities?.torch) setHasTorch(true);

      setScanning(true);
      startScanning(stream);
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        setError('Camera permission denied. Please allow camera access and try again.');
      } else if (err.name === 'NotFoundError') {
        setError('No camera found on this device.');
      } else {
        setError(`Camera error: ${err.message}`);
      }
    }
  };

  const stopCamera = () => {
    if (scannerRef.current) {
      clearInterval(scannerRef.current);
      scannerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
  };

  const startScanning = (stream) => {
    if (hasBarcodeDetector) {
      scanWithBarcodeDetector();
    } else {
      scanWithCanvas();
    }
  };

  // ── BarcodeDetector API (Chrome 88+, Edge, Android) ──────────────────────
  const scanWithBarcodeDetector = () => {
    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    scannerRef.current = setInterval(async () => {
      if (!videoRef.current || videoRef.current.readyState < 2) return;
      try {
        const barcodes = await detector.detect(videoRef.current);
        if (barcodes.length > 0) {
          handleResult(barcodes[0].rawValue);
        }
      } catch {}
    }, 300);
  };

  // ── Canvas-based fallback — no jsQR available; show guidance ────────────
  const scanWithCanvas = () => {
    // BarcodeDetector is unavailable in this browser. Show a helpful message.
    setError('Automatic QR scanning requires Chrome 88+ or a modern Android browser. Please use the manual entry below or open this page in Chrome.');
    stopCamera();
  };

  const handleResult = (raw) => {
    if (result) return; // already handled
    stopCamera();
    setResult(raw);

    // Parse TalentLedger credential URLs
    const patterns = [
      /\/verify\/([A-Z]{2}-[A-Z]{3}-\d{5})/,      // TL-LMS-00001
      /\/verify\/shared\/([a-f0-9-]{36})/,           // shared UUID
      /\/verify\/profile\/([a-f0-9]{24})/,           // worker profile
      /\/api\/v1\/registry\/credentials\/(.+?)\/verify/, // direct API URL
    ];

    for (const pattern of patterns) {
      const m = raw.match(pattern);
      if (m) {
        toast.success('QR Code scanned!');
        // Navigate to verification page
        if (raw.includes('/verify/shared/')) {
          navigate(`/verify/shared/${m[1]}`);
        } else if (raw.includes('/verify/profile/')) {
          navigate(`/verify/profile/${m[1]}`);
        } else {
          navigate(`/verify/${m[1]}`);
        }
        return;
      }
    }

    // If it's any URL, open it
    if (raw.startsWith('http')) {
      toast.success('QR Code scanned — opening link');
      window.open(raw, '_blank', 'noopener');
      return;
    }

    // Plain text — show result
    toast.success('QR Code scanned');
  };

  const toggleTorch = async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn }] });
      setTorchOn(t => !t);
    } catch {
      toast.error('Torch not supported');
    }
  };

  const handleManualEntry = (e) => {
    e.preventDefault();
    const input = e.target.elements.credId.value.trim();
    if (!input) return;
    navigate(`/verify/${input}`);
  };

  return (
    <div className="space-y-5">
      <h3 className="text-lg font-bold dark:text-white">{t('Scan QR Code')}</h3>

      {!supported ? (
        <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-4 text-center">
          <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
        </div>
      ) : (
        <>
          {/* Camera viewport */}
          <div className="relative rounded-2xl overflow-hidden bg-black aspect-square max-w-xs mx-auto">
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              playsInline
              muted
            />
            <canvas ref={canvasRef} className="hidden" />

            {/* Scanner overlay */}
            {scanning && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                {/* Corner brackets */}
                <div className="relative w-52 h-52">
                  <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-white rounded-tl-lg" />
                  <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-white rounded-tr-lg" />
                  <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-white rounded-bl-lg" />
                  <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-white rounded-br-lg" />
                  {/* Scan line animation */}
                  <div className="absolute left-2 right-2 h-0.5 bg-blue-400/80 top-1/2 animate-pulse" />
                </div>
              </div>
            )}

            {/* Torch button */}
            {scanning && hasTorch && (
              <button
                onClick={toggleTorch}
                className={`absolute top-3 right-3 p-2 rounded-full ${torchOn ? 'bg-yellow-400 text-black' : 'bg-white/20 text-white'}`}
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1H6a2 2 0 01-2-2v-2a2 2 0 012-2h8a2 2 0 012 2v2a2 2 0 01-2 2h-2v1a1 1 0 11-2 0z" />
                </svg>
              </button>
            )}

            {/* Idle state */}
            {!scanning && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/80">
                <svg className="w-16 h-16 text-slate-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                </svg>
                <p className="text-slate-300 text-sm">{t('Camera off')}</p>
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3 text-center">
              <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-xl p-4">
              <p className="text-xs font-semibold text-green-700 dark:text-green-400 mb-1">✅ Scanned</p>
              <p className="text-xs font-mono text-gray-700 dark:text-gray-300 break-all">{result}</p>
            </div>
          )}

          {/* Controls */}
          <div className="flex gap-3">
            {!scanning ? (
              <button
                onClick={startCamera}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl flex items-center justify-center gap-2 text-sm"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {t('Start Camera')}
              </button>
            ) : (
              <button
                onClick={stopCamera}
                className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl text-sm"
              >
                {t('Stop')}
              </button>
            )}
          </div>

          {/* Scanning hint */}
          {scanning && (
            <p className="text-center text-xs text-gray-500 dark:text-gray-400">
              {t('Point the camera at a TalentLedger QR code to verify credentials')}
            </p>
          )}
        </>
      )}

      {/* Manual entry fallback */}
      <div className="border-t border-gray-200 dark:border-slate-700 pt-5">
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-3 uppercase tracking-wide">
          {t('Or enter credential ID manually')}
        </p>
        <form onSubmit={handleManualEntry} className="flex gap-2">
          <input
            name="credId"
            type="text"
            placeholder="TL-LMS-00001 or UUID"
            className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold rounded-lg"
          >
            {t('Verify')}
          </button>
        </form>
      </div>
    </div>
  );
}
