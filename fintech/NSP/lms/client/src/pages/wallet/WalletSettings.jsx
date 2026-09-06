import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLang } from '../../context/LangContext';
import toast from 'react-hot-toast';
import api from '../../api/client';

export default function WalletSettings() {
  const { user, changePassword, exportData, deactivateAccount } = useAuth();
  const { t, lang, setLang } = useLang();
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [passwords, setPasswords] = useState({ current: '', new: '', confirm: '' });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [simpleMode, setSimpleMode] = useState(() => localStorage.getItem('tl_simple_mode') === 'true');
  const [blockchainStatus, setBlockchainStatus] = useState(null);

  useEffect(() => {
    api.get('/wallet/blockchain-status')
      .then(r => setBlockchainStatus(r.data))
      .catch(() => setBlockchainStatus({ mode: 'simulated', networkName: 'Simulated (Local)' }));
  }, []);

  const toggleSimpleMode = () => {
    const next = !simpleMode;
    setSimpleMode(next);
    localStorage.setItem('tl_simple_mode', String(next));
    toast.success(next ? 'Simplified view enabled' : 'Standard view enabled');
  };

  const handleChangePassword = async () => {
    if (passwords.new !== passwords.confirm) return toast.error('Passwords do not match');
    if (passwords.new.length < 8) return toast.error('Password must be at least 8 characters');
    try {
      await changePassword(passwords.current, passwords.new);
      toast.success('Password changed');
      setShowChangePassword(false);
      setPasswords({ current: '', new: '', confirm: '' });
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to change password');
    }
  };

  const handleExport = async () => {
    try {
      await exportData();
      toast.success('Data export sent to your email');
    } catch {
      toast.error('Export failed');
    }
  };

  const handleDeactivate = async () => {
    try {
      await deactivateAccount();
      toast.success('Account deactivated');
    } catch {
      toast.error('Deactivation failed');
    }
  };

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-bold dark:text-white">{t('Settings')}</h3>

      {/* Profile */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
        <h4 className="text-sm font-bold dark:text-white mb-3">{t('Profile')}</h4>
        <div className="space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-gray-500">{t('Name')}</span>
            <span className="dark:text-white font-medium">{user?.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">{t('Email')}</span>
            <span className="dark:text-white font-medium">{user?.email}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">{t('Role')}</span>
            <span className="dark:text-white font-medium capitalize">{user?.role}</span>
          </div>
        </div>
      </div>

      {/* Accessibility */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
        <h4 className="text-sm font-bold dark:text-white mb-3">{t('Accessibility')}</h4>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold dark:text-white">{t('Simplified View')}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{t('Large icons and fewer details')}</p>
          </div>
          <button
            onClick={toggleSimpleMode}
            className={`relative w-12 h-6 rounded-full transition-colors ${simpleMode ? 'bg-blue-600' : 'bg-gray-200 dark:bg-slate-600'}`}
          >
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${simpleMode ? 'translate-x-7' : 'translate-x-1'}`} />
          </button>
        </div>
      </div>

      {/* Language */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
        <h4 className="text-sm font-bold dark:text-white mb-3">{t('Language')}</h4>
        <div className="flex gap-2">
          {[
            { code: 'en', label: 'English' },
            { code: 'ur', label: '\u0627\u0631\u062F\u0648' },
            { code: 'ps', label: '\u067E\u069A\u062A\u0648' },
          ].map(l => (
            <button
              key={l.code}
              onClick={() => setLang(l.code)}
              className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors ${
                lang === l.code ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-400'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      {/* Blockchain Status */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
        <h4 className="text-sm font-bold dark:text-white mb-3">{t('Blockchain')}</h4>
        {blockchainStatus ? (
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">{t('Mode')}</span>
              <span className={`flex items-center gap-1.5 font-semibold ${blockchainStatus.mode === 'polygon' ? 'text-green-600' : 'text-amber-500'}`}>
                {blockchainStatus.mode === 'polygon' ? '✅' : '🔶'}
                {blockchainStatus.networkName}
              </span>
            </div>
            {blockchainStatus.contractAddress && (
              <div className="flex items-center justify-between">
                <span className="text-gray-500">{t('Contract')}</span>
                <span className="font-mono text-[10px] dark:text-white">
                  {blockchainStatus.contractAddress.slice(0, 10)}...
                </span>
              </div>
            )}
            {blockchainStatus.chainId && (
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Chain ID</span>
                <span className="dark:text-white">{blockchainStatus.chainId}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <div className="animate-spin w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full" />
            {t('Checking blockchain status...')}
          </div>
        )}
      </div>

      {/* Security */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4 space-y-3">
        <h4 className="text-sm font-bold dark:text-white">{t('Security')}</h4>

        <button
          onClick={() => setShowChangePassword(!showChangePassword)}
          className="w-full text-left px-3 py-2 text-xs font-semibold bg-gray-50 dark:bg-slate-700 rounded-lg hover:bg-gray-100 dark:text-white"
        >
          {t('Change Password')}
        </button>

        {showChangePassword && (
          <div className="space-y-2 p-3 bg-gray-50 dark:bg-slate-700 rounded-lg">
            <input type="password" placeholder={t('Current Password')} value={passwords.current}
              onChange={e => setPasswords(p => ({ ...p, current: e.target.value }))}
              className="w-full px-3 py-2 text-xs border rounded-lg dark:bg-slate-600 dark:border-slate-500 dark:text-white" />
            <input type="password" placeholder={t('New Password')} value={passwords.new}
              onChange={e => setPasswords(p => ({ ...p, new: e.target.value }))}
              className="w-full px-3 py-2 text-xs border rounded-lg dark:bg-slate-600 dark:border-slate-500 dark:text-white" />
            <input type="password" placeholder={t('Confirm New Password')} value={passwords.confirm}
              onChange={e => setPasswords(p => ({ ...p, confirm: e.target.value }))}
              className="w-full px-3 py-2 text-xs border rounded-lg dark:bg-slate-600 dark:border-slate-500 dark:text-white" />
            <button onClick={handleChangePassword}
              className="w-full py-2 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              {t('Update Password')}
            </button>
          </div>
        )}
      </div>

      {/* Data */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4 space-y-3">
        <h4 className="text-sm font-bold dark:text-white">{t('Data & Privacy')}</h4>
        <button onClick={handleExport}
          className="w-full text-left px-3 py-2 text-xs font-semibold bg-gray-50 dark:bg-slate-700 rounded-lg hover:bg-gray-100 dark:text-white">
          {t('Export My Data (JSON)')}
        </button>
        <button onClick={() => setShowDeleteConfirm(true)}
          className="w-full text-left px-3 py-2 text-xs font-semibold bg-red-50 dark:bg-red-900/20 text-red-600 rounded-lg hover:bg-red-100">
          {t('Delete Account')}
        </button>
      </div>

      {/* Delete Confirm Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowDeleteConfirm(false)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold dark:text-white mb-2">{t('Delete Account?')}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              {t('This will permanently deactivate your account and remove all your credentials. This action cannot be undone.')}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-2 text-sm font-semibold bg-gray-100 dark:bg-slate-700 dark:text-white rounded-xl">
                {t('Cancel')}
              </button>
              <button onClick={handleDeactivate}
                className="flex-1 py-2 text-sm font-semibold bg-red-600 text-white rounded-xl hover:bg-red-700">
                {t('Delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* App Version */}
      <div className="text-center text-[10px] text-gray-400 py-4">
        Talent Ledger v1.0.0 | Pakistan's National Skills Passport
      </div>
    </div>
  );
}
