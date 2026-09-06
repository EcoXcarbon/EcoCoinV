import { useEffect, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import SecuritySettings from '../components/SecuritySettings';

const TRADES = ['mason','electrician','welder','plumber','carpenter','steel-fixer','painter','hvac','pipe-fitter','scaffolder','rigger','crane-operator','heavy-driver','shuttering-carpenter','tile-fixer','duct-fabricator','auto-mechanic','diesel-mechanic','fabricator','insulation-worker','heavy-equipment-operator','aluminium-fabricator','safety-officer','cook','ac-technician'];

export default function Profile() {
  const { user } = useAuth();
  const [worker, setWorker] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({});

  useEffect(() => {
    api.get('/workers', { params: { limit: 1 } })
      .then(r => {
        const w = r.data.workers?.[0];
        if (w) { setWorker(w); setForm({ fullName: w.fullName || '', fatherName: w.fatherName || '', phone: w.phone || '', gender: w.gender || '', dateOfBirth: w.dateOfBirth?.split('T')[0] || '', gulfReadiness: w.gulfReadiness || {} }); }
      })
      .catch(() => toast.error('Failed to load profile'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    if (!worker) return;
    setSaving(true);
    try {
      const { data } = await api.put(`/workers/${worker._id}`, form);
      setWorker(data);
      toast.success('Profile updated successfully');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Update failed');
    } finally { setSaving(false); }
  };

  const set = (field) => (e) => setForm(prev => ({ ...prev, [field]: e.target.value }));
  const setGulf = (field) => (e) => setForm(prev => ({ ...prev, gulfReadiness: { ...prev.gulfReadiness, [field]: e.target.checked } }));

  const inputClass = 'w-full px-4 py-2.5 border border-gray-200 dark:border-navy-light rounded-xl text-sm bg-white dark:bg-navy dark:text-white focus:ring-2 focus:ring-ilo-blue/30 focus:border-ilo-blue outline-none';

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin w-8 h-8 border-4 border-ilo-blue border-t-transparent rounded-full" /></div>;

  if (!worker) return (
    <div className="max-w-3xl mx-auto space-y-6">
      <SecuritySettings />
      <div className="text-center py-12 bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light">
        <h2 className="text-xl font-bold dark:text-white mb-2">No Worker Profile</h2>
        <p className="text-sm text-gray-500">Your account does not have a worker profile yet. Contact your administrator.</p>
      </div>
    </div>
  );

  const gulfScore = worker.gulfReadiness?.score || 0;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <SecuritySettings />
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold dark:text-white">My Profile</h2>
        <span className="text-xs font-mono text-gray-400">{worker.registrationId}</span>
      </div>

      {/* Personal Information */}
      <div className="bg-white dark:bg-navy-mid rounded-xl border border-gray-200 dark:border-navy-light p-6">
        <h3 className="text-sm font-bold dark:text-white mb-4">Personal Information</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Full Name</label>
            <input type="text" value={form.fullName} onChange={set('fullName')} className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Father's Name</label>
            <input type="text" value={form.fatherName} onChange={set('fatherName')} className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Phone</label>
            <input type="text" value={form.phone} onChange={set('phone')} className={inputClass} placeholder="03001234567" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Date of Birth</label>
            <input type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Gender</label>
            <select value={form.gender} onChange={set('gender')} className={inputClass}>
              <option value="">Select</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Trade</label>
            <input type="text" value={worker.trade} disabled className={`${inputClass} opacity-60 cursor-not-allowed capitalize`} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">District</label>
            <input type="text" value={worker.district} disabled className={`${inputClass} opacity-60 cursor-not-allowed`} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">NQF Level</label>
            <input type="text" value={worker.nqfLevel || 1} disabled className={`${inputClass} opacity-60 cursor-not-allowed`} />
          </div>
        </div>
      </div>

      {/* Gulf Readiness */}
      <div className="bg-white dark:bg-navy-mid rounded-xl border border-gray-200 dark:border-navy-light p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold dark:text-white">Gulf Readiness</h3>
          <div className="flex items-center gap-2">
            <div className="w-24 bg-gray-200 dark:bg-navy-light rounded-full h-2.5">
              <div className={`h-full rounded-full transition-all ${gulfScore >= 75 ? 'bg-green-500' : gulfScore >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${gulfScore}%` }} />
            </div>
            <span className="text-xs font-bold dark:text-white">{gulfScore}%</span>
          </div>
        </div>
        <div className="space-y-3">
          {[
            { key: 'safetyTraining', label: 'Safety Training (NEBOSH/IOSH)', desc: 'Completed recognized occupational safety training' },
            { key: 'languageTest', label: 'Language Test', desc: 'Passed English/Arabic language proficiency test' },
            { key: 'medicalClearance', label: 'Medical Clearance', desc: 'Valid medical fitness certificate for overseas employment' },
            { key: 'passportValid', label: 'Valid Passport', desc: 'Passport valid for at least 12 months' },
          ].map(item => (
            <label key={item.key} className="flex items-start gap-3 p-3 rounded-lg border border-gray-100 dark:border-navy-light hover:bg-gray-50 dark:hover:bg-navy/50 cursor-pointer transition-colors">
              <input type="checkbox" checked={form.gulfReadiness?.[item.key] || false} onChange={setGulf(item.key)}
                className="mt-0.5 w-5 h-5 rounded border-gray-300 text-ilo-blue focus:ring-ilo-blue/30" />
              <div>
                <p className="text-sm font-semibold dark:text-white">{item.label}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{item.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Competencies */}
      {worker.competencies?.length > 0 && (
        <div className="bg-white dark:bg-navy-mid rounded-xl border border-gray-200 dark:border-navy-light p-6">
          <h3 className="text-sm font-bold dark:text-white mb-4">Competencies</h3>
          <div className="space-y-2">
            {worker.competencies.map((c, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-navy-light last:border-0">
                <div>
                  <span className="text-xs font-mono text-gray-400 mr-2">{c.code}</span>
                  <span className="text-sm font-semibold dark:text-white">{c.title}</span>
                </div>
                <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full capitalize ${
                  c.proficiency === 'expert' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' :
                  c.proficiency === 'proficient' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                  c.proficiency === 'competent' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                  'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                }`}>{c.proficiency || 'novice'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Save Button */}
      <div className="flex justify-end">
        <button onClick={handleSave} disabled={saving}
          className="px-6 py-2.5 bg-gradient-to-r from-ilo-blue to-ilo-dark text-white font-semibold rounded-xl hover:shadow-lg transition-all disabled:opacity-60">
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}
