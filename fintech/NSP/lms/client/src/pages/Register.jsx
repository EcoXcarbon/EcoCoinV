import { useState, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

// Stage 1: Password strength calculator
function getPasswordStrength(password) {
  if (!password) return { score: 0, label: '', color: '' };
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) score++;
  const levels = [
    { label: '', color: '' },
    { label: 'Very Weak', color: 'bg-red-500' },
    { label: 'Weak', color: 'bg-orange-500' },
    { label: 'Fair', color: 'bg-yellow-500' },
    { label: 'Strong', color: 'bg-blue-500' },
    { label: 'Very Strong', color: 'bg-green-500' },
  ];
  return { score, ...levels[score] };
}

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '', email: '', password: '', confirmPassword: '',
    role: 'worker', cnic: '', phone: '', district: '',
    organization: '', trade: '', termsAccepted: false,
  });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  // Stage 1: Show/hide password toggle
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Stage 1: Password strength
  const passwordStrength = useMemo(() => getPasswordStrength(form.password), [form.password]);

  const validate = () => {
    const errs = {};
    if (!form.name.trim()) errs.name = 'Full name is required';
    if (!form.email) errs.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = 'Invalid email format';
    if (!form.password) errs.password = 'Password is required';
    else if (form.password.length < 8) errs.password = 'Minimum 8 characters';
    else if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,128}$/.test(form.password))
      errs.password = 'Needs uppercase, lowercase, number, and special character';
    if (form.password !== form.confirmPassword) errs.confirmPassword = 'Passwords do not match';
    if (form.cnic && !/^\d{5}-\d{7}-\d{1}$/.test(form.cnic)) errs.cnic = 'Format: 12345-1234567-1';
    if (!form.district.trim()) errs.district = 'District is required';
    if (form.role === 'worker' && !form.trade) errs.trade = 'Please select your trade';
    if ((form.role === 'employer' || form.role === 'institution') && !form.organization.trim()) errs.organization = 'Organization is required';
    // Stage 1: ToS acceptance required
    if (!form.termsAccepted) errs.termsAccepted = 'You must accept the Terms of Service';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      const { confirmPassword, ...payload } = form;
      const result = await register(payload);
      toast.success('Account created! Please check your email to verify your address.');
      navigate('/');
    } catch (err) {
      const msg = err.response?.data?.error || 'Registration failed';
      toast.error(msg);
      if (err.response?.data?.details) {
        const fieldErrors = {};
        err.response.data.details.forEach(d => { fieldErrors[d.field] = d.message; });
        setErrors(fieldErrors);
      }
    } finally { setLoading(false); }
  };

  const set = (field) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm(prev => ({ ...prev, [field]: value }));
    setErrors(prev => ({ ...prev, [field]: undefined }));
  };

  const inputClass = (field) => `w-full px-4 py-2.5 border ${errors[field] ? 'border-red-400' : 'border-gray-200 dark:border-navy-light'} rounded-xl text-sm bg-white dark:bg-navy dark:text-white focus:ring-2 focus:ring-ilo-blue/30 focus:border-ilo-blue outline-none`;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-ilo-dark via-ilo-blue to-ilo-dark p-4">
      <div className="w-full max-w-lg bg-white dark:bg-navy-mid rounded-2xl shadow-xl p-8">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-xl bg-ilo-dark mx-auto flex items-center justify-center text-gold-accent font-black text-lg mb-4" aria-hidden="true">NSP</div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Create Account</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">NSP Learning</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3" noValidate aria-label="Registration form">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="reg-name" className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Full Name *</label>
              <input id="reg-name" type="text" value={form.name} onChange={set('name')} className={inputClass('name')} placeholder="Muhammad Ali" autoComplete="name" aria-required="true" aria-invalid={!!errors.name} />
              {errors.name && <p className="text-xs text-red-500 mt-0.5" role="alert">{errors.name}</p>}
            </div>
            <div>
              <label htmlFor="reg-email" className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Email *</label>
              <input id="reg-email" type="email" value={form.email} onChange={set('email')} className={inputClass('email')} placeholder="your@email.com" autoComplete="email" aria-required="true" aria-invalid={!!errors.email} />
              {errors.email && <p className="text-xs text-red-500 mt-0.5" role="alert">{errors.email}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Stage 1: Password with show/hide toggle and strength meter */}
            <div>
              <label htmlFor="reg-password" className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Password *</label>
              <div className="relative">
                <input id="reg-password" type={showPassword ? 'text' : 'password'} value={form.password} onChange={set('password')} className={`${inputClass('password')} pr-10`} placeholder="Min 8 chars, mixed case + number + special" autoComplete="new-password" aria-required="true" aria-invalid={!!errors.password} aria-describedby="password-strength" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs" aria-label={showPassword ? 'Hide password' : 'Show password'} tabIndex={-1}>
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              {/* Stage 1: Password strength meter */}
              {form.password && (
                <div id="password-strength" className="mt-1.5">
                  <div className="flex gap-1 mb-0.5">
                    {[1,2,3,4,5].map(i => (
                      <div key={i} className={`h-1 flex-1 rounded-full ${i <= passwordStrength.score ? passwordStrength.color : 'bg-gray-200 dark:bg-navy-light'}`} />
                    ))}
                  </div>
                  <p className="text-xs text-gray-500">{passwordStrength.label}</p>
                </div>
              )}
              {errors.password && <p className="text-xs text-red-500 mt-0.5" role="alert">{errors.password}</p>}
            </div>
            <div>
              <label htmlFor="reg-confirm-password" className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Confirm Password *</label>
              <div className="relative">
                <input id="reg-confirm-password" type={showConfirmPassword ? 'text' : 'password'} value={form.confirmPassword} onChange={set('confirmPassword')} className={`${inputClass('confirmPassword')} pr-10`} placeholder="Re-enter password" autoComplete="new-password" aria-required="true" aria-invalid={!!errors.confirmPassword} />
                <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs" aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'} tabIndex={-1}>
                  {showConfirmPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              {errors.confirmPassword && <p className="text-xs text-red-500 mt-0.5" role="alert">{errors.confirmPassword}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="reg-cnic" className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">CNIC</label>
              <input id="reg-cnic" type="text" value={form.cnic} onChange={set('cnic')} className={inputClass('cnic')} placeholder="12345-1234567-1" autoComplete="off" aria-invalid={!!errors.cnic} />
              {errors.cnic && <p className="text-xs text-red-500 mt-0.5" role="alert">{errors.cnic}</p>}
            </div>
            <div>
              <label htmlFor="reg-phone" className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Phone</label>
              <input id="reg-phone" type="tel" value={form.phone} onChange={set('phone')} className={inputClass('phone')} placeholder="03001234567" autoComplete="tel" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="reg-district" className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">District *</label>
              <input id="reg-district" type="text" value={form.district} onChange={set('district')} className={inputClass('district')} placeholder="e.g. Peshawar" autoComplete="address-level2" aria-required="true" aria-invalid={!!errors.district} />
              {errors.district && <p className="text-xs text-red-500 mt-0.5" role="alert">{errors.district}</p>}
            </div>
            <div>
              <label htmlFor="reg-role" className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Account Type</label>
              <select id="reg-role" value={form.role} onChange={set('role')} className={inputClass('role')} aria-label="Account type">
                <option value="worker">Worker</option>
                <option value="employer">Employer</option>
                <option value="institution">Institution</option>
              </select>
            </div>
          </div>

          {form.role === 'worker' && (
            <div>
              <label htmlFor="reg-trade" className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Trade *</label>
              <select id="reg-trade" value={form.trade} onChange={set('trade')} className={inputClass('trade')} aria-required="true" aria-invalid={!!errors.trade}>
                <option value="">Select your trade</option>
                <option value="mason">Mason / Bricklayer</option>
                <option value="electrician">Electrician</option>
                <option value="welder">Welder</option>
                <option value="plumber">Plumber</option>
                <option value="carpenter">Carpenter</option>
                <option value="steel-fixer">Steel Fixer / Rebar</option>
                <option value="painter">Building Painter</option>
                <option value="hvac">HVACR Technician</option>
                <option value="pipe-fitter">Pipe Fitter</option>
                <option value="scaffolder">Scaffolder</option>
                <option value="rigger">Rigger</option>
                <option value="crane-operator">Crane Operator</option>
                <option value="heavy-driver">Heavy Vehicle Driver</option>
                <option value="shuttering-carpenter">Shuttering Carpenter</option>
                <option value="tile-fixer">Tile Fixer</option>
                <option value="duct-fabricator">Duct Fabricator</option>
                <option value="auto-mechanic">Auto Mechanic</option>
                <option value="diesel-mechanic">Diesel Mechanic</option>
                <option value="fabricator">Steel Fabricator</option>
                <option value="insulation-worker">Insulation Worker</option>
                <option value="heavy-equipment-operator">Heavy Equipment Operator</option>
                <option value="aluminium-fabricator">Aluminium Fabricator</option>
                <option value="safety-officer">Safety Officer</option>
                <option value="cook">Cook / Chef</option>
                <option value="ac-technician">AC Technician</option>
              </select>
              {errors.trade && <p className="text-xs text-red-500 mt-0.5" role="alert">{errors.trade}</p>}
            </div>
          )}

          {(form.role === 'employer' || form.role === 'institution') && (
            <div>
              <label htmlFor="reg-organization" className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Organization *</label>
              <input id="reg-organization" type="text" value={form.organization} onChange={set('organization')} className={inputClass('organization')} placeholder="e.g. Al Futtaim Group" autoComplete="organization" aria-required="true" aria-invalid={!!errors.organization} />
              {errors.organization && <p className="text-xs text-red-500 mt-0.5" role="alert">{errors.organization}</p>}
            </div>
          )}

          {/* Stage 1: Terms of Service checkbox */}
          <div className="flex items-start gap-2 pt-1">
            <input id="reg-terms" type="checkbox" checked={form.termsAccepted} onChange={set('termsAccepted')} className="mt-0.5 h-4 w-4 rounded border-gray-300 text-ilo-blue focus:ring-ilo-blue/30" aria-required="true" aria-invalid={!!errors.termsAccepted} />
            <label htmlFor="reg-terms" className="text-xs text-gray-600 dark:text-gray-400">
              I accept the <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-ilo-blue font-semibold hover:underline">Terms of Service</a> and <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-ilo-blue font-semibold hover:underline">Privacy Policy</a> *
            </label>
          </div>
          {errors.termsAccepted && <p className="text-xs text-red-500 -mt-1" role="alert">{errors.termsAccepted}</p>}

          <button type="submit" disabled={loading}
            className="w-full py-2.5 bg-gradient-to-r from-ilo-blue to-ilo-dark text-white font-semibold rounded-xl hover:shadow-lg transition-all disabled:opacity-60 mt-2"
            aria-busy={loading}>
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <div className="mt-4 space-y-3">
          <div className="relative flex items-center">
            <div className="flex-1 border-t border-gray-200 dark:border-navy-light" />
            <span className="mx-3 text-xs text-gray-400">or sign up with</span>
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
            Sign up with Google
          </a>
        </div>
        <p className="mt-3 text-center text-sm text-gray-500 dark:text-gray-400">
          Already have an account? <Link to="/login" className="text-ilo-blue font-semibold hover:underline">Sign In</Link>
        </p>
      </div>
    </div>
  );
}
