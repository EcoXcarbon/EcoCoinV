import { useState } from 'react';
import { useLang } from '../context/LangContext';
import WalletDashboard from './wallet/WalletDashboard';
import WalletCredentials from './wallet/WalletCredentials';
import WalletShare from './wallet/WalletShare';
import WalletAlerts from './wallet/WalletAlerts';
import WalletSettings from './wallet/WalletSettings';
import WalletPortfolios from './wallet/WalletPortfolios';
import WalletScanner from './wallet/WalletScanner';

const SCREENS = {
  home: { component: WalletDashboard, label: 'Home', icon: '\u{1F3E0}' },
  credentials: { component: WalletCredentials, label: 'Credentials', icon: '\u{1F4DC}' },
  scan: { component: WalletScanner, label: 'Scan', icon: '\u{1F4F7}' },
  share: { component: WalletShare, label: 'Share', icon: '\u{1F517}' },
  alerts: { component: WalletAlerts, label: 'Alerts', icon: '\u{1F514}' },
  settings: { component: WalletSettings, label: 'Settings', icon: '\u2699\uFE0F' },
};

export default function Wallet() {
  const { t } = useLang();
  const [screen, setScreen] = useState('home');
  const ActiveScreen = SCREENS[screen].component;

  return (
    <div className="max-w-lg mx-auto pb-20">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        {screen !== 'home' && (
          <button onClick={() => setScreen('home')} className="text-gray-500 hover:text-gray-700 dark:text-gray-400">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        <h2 className="text-xl font-bold dark:text-white">{t('Digital Wallet')}</h2>
      </div>

      {/* Active Screen */}
      <ActiveScreen onNavigate={setScreen} />

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-900 border-t border-gray-200 dark:border-slate-700 px-1 py-1.5 z-40">
        <div className="max-w-lg mx-auto flex justify-around">
          {Object.entries(SCREENS).map(([key, { label, icon }]) => (
            <button
              key={key}
              onClick={() => setScreen(key)}
              className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg transition-colors ${
                screen === key
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
              }`}
            >
              <span className="text-base">{icon}</span>
              <span className="text-[8px] font-semibold">{t(label)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
