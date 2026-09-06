import { useState, useEffect } from 'react';
import api from '../../api/client';
import { useLang } from '../../context/LangContext';

export default function WalletAlerts() {
  const { t } = useLang();
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAlerts();
  }, []);

  const loadAlerts = async () => {
    setLoading(true);
    try {
      const [notifRes, credRes] = await Promise.all([
        api.get('/notifications', { params: { limit: 20 } }).catch(() => ({ data: [] })),
        api.get('/credentials', { params: { limit: 200 } }).catch(() => ({ data: { credentials: [] } })),
      ]);

      const notifications = (Array.isArray(notifRes.data) ? notifRes.data : notifRes.data.notifications || []).map(n => ({
        id: n._id,
        type: n.type || 'info',
        title: n.title || n.message,
        message: n.message || n.body,
        date: n.createdAt,
        read: n.read,
      }));

      // Generate expiry alerts from credentials
      const creds = credRes.data.credentials || [];
      const now = new Date();
      const expiryAlerts = creds
        .filter(c => c.validUntil || c.expiryDate)
        .map(c => {
          const expiry = new Date(c.validUntil || c.expiryDate);
          const daysLeft = Math.ceil((expiry - now) / 86400000);
          if (daysLeft > 90) return null;
          return {
            id: `expiry-${c._id}`,
            type: daysLeft <= 0 ? 'expired' : daysLeft <= 7 ? 'urgent' : daysLeft <= 30 ? 'warning' : 'info',
            title: daysLeft <= 0 ? `${c.title} has EXPIRED` : `${c.title} expires in ${daysLeft} days`,
            message: `Credential: ${c.credentialId || c._id}`,
            date: c.validUntil || c.expiryDate,
            daysLeft,
          };
        })
        .filter(Boolean);

      setAlerts([...expiryAlerts.sort((a, b) => a.daysLeft - b.daysLeft), ...notifications]);
    } finally {
      setLoading(false);
    }
  };

  const getAlertStyle = (type) => ({
    expired: 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-900/20',
    urgent: 'border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-900/10',
    warning: 'border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-900/10',
    info: 'border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-900/10',
  }[type] || 'border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800');

  const getAlertIcon = (type) => ({
    expired: '\u{1F534}',
    urgent: '\u{1F7E0}',
    warning: '\u{1F7E1}',
    info: '\u{1F535}',
  }[type] || '\u{2139}\uFE0F');

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-bold dark:text-white">{t('Alerts & Notifications')}</h3>
        <button onClick={loadAlerts} className="text-xs text-blue-600 hover:underline">
          {t('Refresh')}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full" />
        </div>
      ) : alerts.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700">
          <p className="text-3xl mb-2">{'\u2705'}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('No alerts. All credentials are up to date.')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map(alert => (
            <div key={alert.id} className={`rounded-xl border p-4 ${getAlertStyle(alert.type)}`}>
              <div className="flex items-start gap-3">
                <span className="text-lg flex-shrink-0">{getAlertIcon(alert.type)}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold dark:text-white">{alert.title}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{alert.message}</p>
                  <p className="text-[10px] text-gray-400 mt-1">
                    {alert.date ? new Date(alert.date).toLocaleDateString() : ''}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
