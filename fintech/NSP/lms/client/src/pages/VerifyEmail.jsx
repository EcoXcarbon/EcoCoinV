import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import api from '../api/client';

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState('verifying'); // verifying | success | error | resend
  const [email, setEmail] = useState('');
  const [resendLoading, setResendLoading] = useState(false);

  useEffect(() => {
    if (!token) {
      setStatus('resend');
      return;
    }
    api.post('/auth/verify-email', { token })
      .then(() => setStatus('success'))
      .catch(() => setStatus('error'));
  }, [token]);

  const handleResend = async () => {
    if (!email) return;
    setResendLoading(true);
    try {
      await api.post('/auth/resend-verification', { email });
      setStatus('resent');
    } catch {
      setStatus('error');
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-ilo-dark via-ilo-blue to-ilo-dark p-4">
      <div className="w-full max-w-md bg-white dark:bg-navy-mid rounded-2xl shadow-xl p-8 text-center">
        <div className="w-14 h-14 rounded-xl bg-ilo-dark mx-auto flex items-center justify-center text-gold-accent font-black text-lg mb-6" aria-hidden="true">NSP</div>

        {status === 'verifying' && (
          <>
            <div className="animate-spin w-8 h-8 border-4 border-ilo-blue border-t-transparent rounded-full mx-auto mb-4" />
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Verifying your email...</h2>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="w-16 h-16 rounded-full bg-green-100 mx-auto mb-4 flex items-center justify-center">
              <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Email Verified!</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Your email has been successfully verified. You can now access all features.</p>
            <Link to="/login" className="inline-block px-6 py-2.5 bg-gradient-to-r from-ilo-blue to-ilo-dark text-white font-semibold rounded-xl hover:shadow-lg transition-all">Continue to Login</Link>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="w-16 h-16 rounded-full bg-red-100 mx-auto mb-4 flex items-center justify-center">
              <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Verification Failed</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">The verification link is invalid or has expired.</p>
            <button onClick={() => setStatus('resend')} className="text-ilo-blue font-semibold hover:underline text-sm">Request a new verification link</button>
          </>
        )}

        {(status === 'resend' || status === 'resent') && (
          <>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
              {status === 'resent' ? 'Verification Email Sent!' : 'Resend Verification'}
            </h2>
            {status === 'resent' ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">If your email is registered and unverified, you will receive a new verification link.</p>
            ) : (
              <>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Enter your email to receive a new verification link.</p>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" className="w-full px-4 py-2.5 border border-gray-200 dark:border-navy-light rounded-xl text-sm bg-white dark:bg-navy dark:text-white focus:ring-2 focus:ring-ilo-blue/30 focus:border-ilo-blue outline-none mb-3" />
                <button onClick={handleResend} disabled={resendLoading || !email} className="w-full py-2.5 bg-gradient-to-r from-ilo-blue to-ilo-dark text-white font-semibold rounded-xl hover:shadow-lg transition-all disabled:opacity-60">
                  {resendLoading ? 'Sending...' : 'Send Verification Link'}
                </button>
              </>
            )}
            <Link to="/login" className="block mt-4 text-sm text-ilo-blue font-semibold hover:underline">Back to Login</Link>
          </>
        )}
      </div>
    </div>
  );
}
