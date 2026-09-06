import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../api/client';

function EnrollFlow({ onDone }) {
  const [step, setStep] = useState('start'); // start | scan | done
  const [setup, setSetup] = useState(null);   // { secret, otpauthUrl, qrDataUrl }
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [loading, setLoading] = useState(false);

  const begin = async () => {
    setLoading(true);
    try {
      const { data } = await api.post('/auth/mfa/setup');
      setSetup(data);
      setStep('scan');
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to start setup'); }
    finally { setLoading(false); }
  };

  const verify = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post('/auth/mfa/enroll/verify', { code: code.trim() });
      setRecoveryCodes(data.recoveryCodes);
      setStep('done');
      toast.success('MFA enabled');
    } catch (err) { toast.error(err.response?.data?.error || 'Invalid code'); }
    finally { setLoading(false); }
  };

  if (step === 'start') {
    return (
      <button onClick={begin} disabled={loading}
        className="px-4 py-2 text-sm font-semibold bg-ilo-blue text-white rounded-lg disabled:opacity-50">
        {loading ? 'Starting…' : 'Enable 2-step verification'}
      </button>
    );
  }

  if (step === 'scan') {
    return (
      <form onSubmit={verify} className="space-y-4">
        <p className="text-xs text-gray-600 dark:text-gray-300">
          Scan this QR code with Google Authenticator, Microsoft Authenticator, 1Password, or any TOTP app.
        </p>
        <div className="flex justify-center">
          <img src={setup.qrDataUrl} alt="MFA QR code" className="rounded-lg border border-border dark:border-navy-light" />
        </div>
        <details className="text-xs text-gray-500 dark:text-gray-400">
          <summary className="cursor-pointer">Can't scan? Use this manual key</summary>
          <code className="block break-all bg-gray-50 dark:bg-navy-light p-2 rounded mt-2">{setup.secret}</code>
        </details>
        <label className="block">
          <span className="text-xs text-gray-600 dark:text-gray-300">Enter the 6-digit code from your app</span>
          <input autoFocus value={code} onChange={e => setCode(e.target.value)}
            placeholder="123 456" maxLength={8}
            className="w-full mt-1 px-3 py-2 border rounded-lg text-center font-mono text-lg tracking-widest dark:bg-navy-light dark:border-navy-light dark:text-white" />
        </label>
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={() => { setStep('start'); setSetup(null); setCode(''); }}
            className="px-3 py-2 text-sm text-gray-500">Cancel</button>
          <button type="submit" disabled={loading || !code.trim()}
            className="px-4 py-2 text-sm bg-ilo-blue text-white rounded-lg disabled:opacity-50">
            {loading ? 'Verifying…' : 'Verify & enable'}
          </button>
        </div>
      </form>
    );
  }

  // done
  return (
    <div className="space-y-3">
      <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3 text-sm text-emerald-800 dark:text-emerald-200">
        ✅ MFA is enabled. Save these recovery codes <strong>now</strong> — they will not be shown again.
      </div>
      <ul className="bg-gray-50 dark:bg-navy-light rounded-lg p-3 space-y-1 font-mono text-sm text-gray-800 dark:text-gray-100">
        {recoveryCodes.map((c, i) => <li key={i}>{c}</li>)}
      </ul>
      <button onClick={() => navigator.clipboard?.writeText(recoveryCodes.join('\n')).then(() => toast.success('Copied'))}
        className="px-3 py-1.5 text-xs border border-ilo-blue text-ilo-blue rounded-lg">
        Copy all codes
      </button>
      <div>
        <button onClick={onDone} className="px-4 py-2 text-sm bg-ilo-blue text-white rounded-lg">
          I've saved them — done
        </button>
      </div>
    </div>
  );
}

function DisableFlow({ onDone }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/auth/mfa/disable', { password, code: code.trim() });
      toast.success('MFA disabled');
      onDone();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setLoading(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-xs text-gray-600 dark:text-gray-300">
        To disable 2-step verification, confirm your password and your current 6-digit code (or a recovery code).
      </p>
      <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password"
        className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-navy-light dark:border-navy-light dark:text-white" />
      <input value={code} onChange={e => setCode(e.target.value)} placeholder="6-digit code or recovery code"
        className="w-full px-3 py-2 border rounded-lg text-sm font-mono dark:bg-navy-light dark:border-navy-light dark:text-white" />
      <button type="submit" disabled={loading || !password || !code}
        className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg disabled:opacity-50">
        {loading ? 'Disabling…' : 'Disable 2-step verification'}
      </button>
    </form>
  );
}

export default function SecuritySettings() {
  const [status, setStatus] = useState(null);
  const [showEnroll, setShowEnroll] = useState(false);
  const [showDisable, setShowDisable] = useState(false);

  const load = () => api.get('/auth/mfa/status').then(r => setStatus(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  if (!status) {
    return <div className="text-xs text-gray-500">Loading security settings…</div>;
  }

  return (
    <section className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-5 space-y-4">
      <div>
        <h3 className="text-lg font-bold dark:text-white">Security</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">Two-step verification protects your account from credential theft.</p>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold dark:text-white">
            2-step verification — {status.enabled
              ? <span className="text-emerald-600">Enabled</span>
              : <span className="text-amber-600">Disabled</span>}
          </div>
          {status.enabled && (
            <div className="text-xs text-gray-500 dark:text-gray-400">{status.recoveryCodesRemaining} recovery code(s) remaining</div>
          )}
        </div>
        {status.enabled ? (
          <button onClick={() => { setShowDisable(s => !s); setShowEnroll(false); }}
            className="text-xs text-red-600 hover:underline">{showDisable ? 'Hide' : 'Disable'}</button>
        ) : (
          <button onClick={() => { setShowEnroll(s => !s); setShowDisable(false); }}
            className="text-xs text-ilo-blue hover:underline">{showEnroll ? 'Hide' : 'Set up'}</button>
        )}
      </div>

      {showEnroll && !status.enabled && (
        <div className="border-t border-border dark:border-navy-light pt-4">
          <EnrollFlow onDone={() => { setShowEnroll(false); load(); }} />
        </div>
      )}
      {showDisable && status.enabled && (
        <div className="border-t border-border dark:border-navy-light pt-4">
          <DisableFlow onDone={() => { setShowDisable(false); load(); }} />
        </div>
      )}
    </section>
  );
}
