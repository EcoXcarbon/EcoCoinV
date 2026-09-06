import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

export default function Login() {
  const { login, loginVerifyMfa } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const dest = location.state?.from || '/';   // deep-link back after login
  const forCases = dest.startsWith('/cases'); // arrived from the Case Studies link
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  // Stage 1: Show/hide password toggle
  const [showPassword, setShowPassword] = useState(false);
  // MFA challenge step
  const [mfaChallenge, setMfaChallenge] = useState(null); // { challengeToken }
  const [mfaCode, setMfaCode] = useState('');

  const validate = () => {
    const errs = {};
    if (!email) errs.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = 'Invalid email format';
    if (!password) errs.password = 'Password is required';
    else if (password.length < 8) errs.password = 'Password must be at least 8 characters';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleMfaSubmit = async (e) => {
    e.preventDefault();
    if (!mfaCode.trim()) return;
    setLoading(true);
    try {
      const r = await loginVerifyMfa(mfaChallenge.challengeToken, mfaCode.trim());
      toast.success('Welcome to NSP Learning');
      if (r.recoveryCodeUsed) {
        toast(`Recovery code used. ${r.recoveryCodesRemaining} remaining.`, { icon: '⚠️' });
      }
      navigate(dest);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Invalid code');
    } finally { setLoading(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      const r = await login(email, password);
      if (r?.mfaRequired) {
        setMfaChallenge({ challengeToken: r.challengeToken });
        toast('Enter your authenticator code', { icon: '🔐' });
        return;
      }
      toast.success('Welcome to NSP Learning');
      navigate(dest);
    } catch (err) {
      const status = err.response?.status;
      const msg = err.response?.data?.error || 'Login failed';

      // Stage 1: Account lockout feedback
      if (status === 423) {
        toast.error(msg);
        setErrors({ email: 'Account temporarily locked' });
      } else {
        toast.error(msg);
      }

      if (err.response?.data?.details) {
        const fieldErrors = {};
        err.response.data.details.forEach(d => { fieldErrors[d.field] = d.message; });
        setErrors(fieldErrors);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-ilo-dark via-ilo-blue to-ilo-dark p-4">
      <div className="w-full max-w-md bg-white dark:bg-navy-mid rounded-2xl shadow-xl p-8">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-xl bg-ilo-dark mx-auto flex items-center justify-center text-gold-accent font-black text-lg mb-4" aria-hidden="true">NSP</div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">NSP Learning</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Skills Passport — Sign In</p>
        </div>

        {forCases && !mfaChallenge && (
          <div className="mb-6 p-4 rounded-xl bg-ilo-blue/10 dark:bg-ilo-blue/15 border border-ilo-blue/30 text-center">
            <p className="text-sm font-black text-ilo-dark dark:text-white">📊 Corporate Finance &amp; M&amp;A Case Studies</p>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
              Sign in above to continue to the cases. New here?{' '}
              <Link to="/register" className="text-ilo-blue font-semibold hover:underline">Create a free account</Link>, then reopen this link.
            </p>
          </div>
        )}

        {mfaChallenge ? (
          <form onSubmit={handleMfaSubmit} className="space-y-4" noValidate aria-label="MFA challenge">
            <p className="text-sm text-gray-600 dark:text-gray-300 text-center">
              Enter the 6-digit code from your authenticator app, or one of your recovery codes.
            </p>
            <input autoFocus value={mfaCode} onChange={e => setMfaCode(e.target.value)}
              placeholder="123 456"
              className="w-full px-4 py-3 border border-gray-200 dark:border-navy-light rounded-xl text-center text-2xl font-mono tracking-widest bg-white dark:bg-navy dark:text-white focus:ring-2 focus:ring-ilo-blue/30 focus:border-ilo-blue outline-none" />
            <button type="submit" disabled={loading || !mfaCode.trim()}
              className="w-full py-2.5 bg-gradient-to-r from-ilo-blue to-ilo-dark text-white font-semibold rounded-xl hover:shadow-lg transition-all disabled:opacity-60">
              {loading ? 'Verifying…' : 'Verify'}
            </button>
            <button type="button" onClick={() => { setMfaChallenge(null); setMfaCode(''); }}
              className="w-full text-xs text-gray-500 hover:text-ilo-blue">← Use a different account</button>
          </form>
        ) : (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate aria-label="Login form">
          <div>
            <label htmlFor="login-email" className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">Email</label>
            <input id="login-email" type="email" required value={email} onChange={e => { setEmail(e.target.value); setErrors(prev => ({ ...prev, email: undefined })); }}
              className={`w-full px-4 py-2.5 border ${errors.email ? 'border-red-400' : 'border-gray-200 dark:border-navy-light'} rounded-xl text-sm bg-white dark:bg-navy dark:text-white focus:ring-2 focus:ring-ilo-blue/30 focus:border-ilo-blue outline-none`}
              placeholder="your@email.com" autoComplete="email" aria-required="true" aria-invalid={!!errors.email} />
            {errors.email && <p className="text-xs text-red-500 mt-1" role="alert">{errors.email}</p>}
          </div>
          <div>
            <label htmlFor="login-password" className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">Password</label>
            <div className="relative">
              <input id="login-password" type={showPassword ? 'text' : 'password'} required value={password} onChange={e => { setPassword(e.target.value); setErrors(prev => ({ ...prev, password: undefined })); }}
                className={`w-full px-4 py-2.5 pr-16 border ${errors.password ? 'border-red-400' : 'border-gray-200 dark:border-navy-light'} rounded-xl text-sm bg-white dark:bg-navy dark:text-white focus:ring-2 focus:ring-ilo-blue/30 focus:border-ilo-blue outline-none`}
                placeholder="Minimum 8 characters" autoComplete="current-password" aria-required="true" aria-invalid={!!errors.password} />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs font-medium" aria-label={showPassword ? 'Hide password' : 'Show password'} tabIndex={-1}>
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            {errors.password && <p className="text-xs text-red-500 mt-1" role="alert">{errors.password}</p>}
          </div>
          <button type="submit" disabled={loading}
            className="w-full py-2.5 bg-gradient-to-r from-ilo-blue to-ilo-dark text-white font-semibold rounded-xl hover:shadow-lg transition-all disabled:opacity-60"
            aria-busy={loading}>
            {loading ? 'Signing in… (first load may take 30s)' : 'Sign In'}
          </button>
        </form>
        )}

        {!mfaChallenge && (
        <>
        {/* Green Skills training — self-enrolment gate (hidden for case-study visitors) */}
        {!forCases && (
        <div className="mt-5 p-3 rounded-xl bg-[#e7f4ec] dark:bg-[#0f2b1d] border border-[#1f8a4c]/40 text-center">
          <p className="text-xs font-semibold text-[#1f8a4c] dark:text-[#54d18c] mb-2">Here for the Green Skills &amp; Green Economy training?</p>
          <Link to="/join/6a5664fd44e166d1dbd1b111"
            className="block w-full py-3 rounded-xl text-sm font-bold text-white bg-[#1f8a4c] hover:bg-[#186b3b] transition-colors shadow-sm">
            Join the Training →
          </Link>
          <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">No account needed — just your name &amp; Gmail.</p>
        </div>
        )}
        <div className="mt-4 space-y-3">
          <div className="relative flex items-center">
            <div className="flex-1 border-t border-gray-200 dark:border-navy-light" />
            <span className="mx-3 text-xs text-gray-400">or continue with</span>
            <div className="flex-1 border-t border-gray-200 dark:border-navy-light" />
          </div>
          <a href="/lms/api/auth/google"
            className="flex items-center justify-center gap-2 w-full py-2.5 border border-gray-200 dark:border-navy-light rounded-xl text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-navy-light transition-colors">
            <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Sign in with Google
          </a>
        </div>
        <div className="mt-4 text-center space-y-2">
          <Link to="/forgot-password" className="block text-sm text-ilo-blue font-semibold hover:underline">Forgot Password?</Link>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Don't have an account? <Link to="/register" className="text-ilo-blue font-semibold hover:underline">Register</Link>
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            <Link to="/pricing" className="text-ilo-blue font-semibold hover:underline">View Pricing Plans</Link>
          </p>
        </div>
        </>
        )}
      </div>
    </div>
  );
}
