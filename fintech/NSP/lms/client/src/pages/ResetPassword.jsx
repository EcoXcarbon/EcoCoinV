import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import api from '../api/client';
import toast from 'react-hot-toast';

export default function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});

  const validate = () => {
    const errs = {};
    if (!password) errs.password = 'Password is required';
    else if (password.length < 8) errs.password = 'Minimum 8 characters';
    else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?])/.test(password))
      errs.password = 'Needs uppercase, lowercase, number, and special character';
    if (password !== confirmPassword) errs.confirmPassword = 'Passwords do not match';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    if (!token) { toast.error('Invalid reset link'); return; }
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      toast.success('Password reset successfully!');
      navigate('/login');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Reset failed. The link may have expired.');
    } finally { setLoading(false); }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-ilo-dark via-ilo-blue to-ilo-dark p-4">
        <div className="w-full max-w-md bg-white dark:bg-navy-mid rounded-2xl shadow-xl p-8 text-center">
          <h1 className="text-xl font-bold text-red-600 mb-2">Invalid Reset Link</h1>
          <p className="text-sm text-gray-500 mb-4">This password reset link is invalid or has expired.</p>
          <Link to="/forgot-password" className="text-ilo-blue font-semibold hover:underline">Request a new reset link</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-ilo-dark via-ilo-blue to-ilo-dark p-4">
      <div className="w-full max-w-md bg-white dark:bg-navy-mid rounded-2xl shadow-xl p-8">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-xl bg-ilo-dark mx-auto flex items-center justify-center text-gold-accent font-black text-lg mb-4">NSP</div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Set New Password</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">New Password</label>
            <input type="password" value={password} onChange={e => { setPassword(e.target.value); setErrors(prev => ({ ...prev, password: undefined })); }}
              className={`w-full px-4 py-2.5 border ${errors.password ? 'border-red-400' : 'border-gray-200 dark:border-navy-light'} rounded-xl text-sm bg-white dark:bg-navy dark:text-white focus:ring-2 focus:ring-ilo-blue/30 focus:border-ilo-blue outline-none`}
              placeholder="Min 8 chars, mixed case + number + special" />
            {errors.password && <p className="text-xs text-red-500 mt-1">{errors.password}</p>}
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">Confirm New Password</label>
            <input type="password" value={confirmPassword} onChange={e => { setConfirmPassword(e.target.value); setErrors(prev => ({ ...prev, confirmPassword: undefined })); }}
              className={`w-full px-4 py-2.5 border ${errors.confirmPassword ? 'border-red-400' : 'border-gray-200 dark:border-navy-light'} rounded-xl text-sm bg-white dark:bg-navy dark:text-white focus:ring-2 focus:ring-ilo-blue/30 focus:border-ilo-blue outline-none`}
              placeholder="Re-enter new password" />
            {errors.confirmPassword && <p className="text-xs text-red-500 mt-1">{errors.confirmPassword}</p>}
          </div>
          <button type="submit" disabled={loading}
            className="w-full py-2.5 bg-gradient-to-r from-ilo-blue to-ilo-dark text-white font-semibold rounded-xl hover:shadow-lg transition-all disabled:opacity-60">
            {loading ? 'Resetting...' : 'Reset Password'}
          </button>
        </form>
      </div>
    </div>
  );
}
