import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import toast from 'react-hot-toast';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error('Please enter a valid email address');
      return;
    }
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
      toast.success('If that email is registered, a reset link has been sent.');
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-ilo-dark via-ilo-blue to-ilo-dark p-4">
      <div className="w-full max-w-md bg-white dark:bg-navy-mid rounded-2xl shadow-xl p-8">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-xl bg-ilo-dark mx-auto flex items-center justify-center text-gold-accent font-black text-lg mb-4">NSP</div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Reset Password</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Enter your email to receive a reset link</p>
        </div>

        {sent ? (
          <div className="text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 mx-auto flex items-center justify-center">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300">Check your email for the reset link. It expires in 1 hour.</p>
            <Link to="/login" className="inline-block text-sm text-ilo-blue font-semibold hover:underline">Back to Sign In</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">Email Address</label>
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 dark:border-navy-light rounded-xl text-sm bg-white dark:bg-navy dark:text-white focus:ring-2 focus:ring-ilo-blue/30 focus:border-ilo-blue outline-none"
                placeholder="your@email.com" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full py-2.5 bg-gradient-to-r from-ilo-blue to-ilo-dark text-white font-semibold rounded-xl hover:shadow-lg transition-all disabled:opacity-60">
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>
          </form>
        )}

        <p className="mt-4 text-center text-sm text-gray-500 dark:text-gray-400">
          Remember your password? <Link to="/login" className="text-ilo-blue font-semibold hover:underline">Sign In</Link>
        </p>
      </div>
    </div>
  );
}
