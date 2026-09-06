import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend } from 'chart.js';
import api from '../api/client';
import KPICard from '../components/KPICard';
import { useLang } from '../context/LangContext';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend);

export default function Dashboard() {
  const { t } = useLang();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [kpis, setKpis] = useState(null);
  const [regData, setRegData] = useState([]);
  const [tradeData, setTradeData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    if (user?.role !== 'worker') return false;
    return !localStorage.getItem('tl-onboarding-dismissed');
  });

  useEffect(() => {
    Promise.all([
      api.get('/analytics/dashboard').then(r => setKpis(r.data)),
      api.get('/analytics/registrations').then(r => setRegData(r.data)),
      api.get('/analytics/trades').then(r => setTradeData(r.data)),
    ])
      .catch(() => toast.error('Failed to load dashboard data'))
      .finally(() => setLoading(false));
  }, []);

  const TRADE_COLORS = {
    mason: '#0072BC', electrician: '#C8952E', welder: '#7C3AED', plumber: '#0D9488',
    carpenter: '#EC4899', 'steel-fixer': '#DC2626', painter: '#15803D', hvac: '#D97706',
    'pipe-fitter': '#2563EB', scaffolder: '#9333EA', rigger: '#B91C1C', 'crane-operator': '#0369A1',
    'heavy-driver': '#4338CA', 'shuttering-carpenter': '#A16207', 'tile-fixer': '#059669',
    'duct-fabricator': '#7C3AED', 'auto-mechanic': '#6D28D9', 'diesel-mechanic': '#475569',
    fabricator: '#BE185D', 'insulation-worker': '#0891B2', 'heavy-equipment-operator': '#1D4ED8',
    'aluminium-fabricator': '#64748B', 'safety-officer': '#EA580C', cook: '#16A34A',
    'ac-technician': '#0284C7',
  };

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-ilo-blue border-t-transparent rounded-full" /></div>;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold dark:text-white">{t('Dashboard')}</h2>

      {/* Worker onboarding banner */}
      {showOnboarding && (
        <div className="bg-gradient-to-r from-ilo-dark to-ilo-blue rounded-xl p-5 text-white relative overflow-hidden">
          <button onClick={() => { setShowOnboarding(false); localStorage.setItem('tl-onboarding-dismissed', '1'); }}
            className="absolute top-3 right-3 w-6 h-6 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-xs transition-colors"
            aria-label="Dismiss">&times;</button>
          <h3 className="text-lg font-bold mb-1">{t('Welcome to NSP Learning!')}</h3>
          <p className="text-sm text-blue-100 mb-4">Get started in 3 simple steps</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { step: 1, title: t('Check Your Wallet'), desc: t('View your credentials & micro-credentials roadmap'), action: () => navigate('/wallet'), btn: t('Open Wallet'), icon: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z' },
              { step: 2, title: t('Enroll in a Course'), desc: t('Browse the catalog and pick a training program'), action: () => navigate('/lms?tab=catalog'), btn: t('Browse Courses'), icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253' },
              { step: 3, title: t('Start Learning'), desc: t('Complete modules, take quizzes & earn certificates'), action: () => navigate('/lms?tab=mylearning'), btn: t('My Learning'), icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
            ].map(s => (
              <div key={s.step} className="bg-white/10 rounded-xl p-4 flex flex-col">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-6 h-6 rounded-full bg-white text-ilo-blue flex items-center justify-center text-xs font-bold shrink-0">{s.step}</span>
                  <svg className="w-4 h-4 text-blue-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d={s.icon} /></svg>
                </div>
                <h4 className="text-sm font-bold">{s.title}</h4>
                <p className="text-[11px] text-blue-100 mt-1 flex-1">{s.desc}</p>
                <button onClick={s.action}
                  className="mt-3 px-3 py-1.5 text-xs font-semibold bg-white text-ilo-blue rounded-lg hover:bg-blue-50 transition-colors self-start">
                  {s.btn}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        <KPICard icon="👷" label="Total Workers" value={kpis?.totalWorkers ?? '—'} color="ilo-blue" trend={12} />
        <KPICard icon="🎓" label="Certification Rate" value={kpis?.certificationRate ?? '—'} suffix="%" color="success" trend={5} />
        <KPICard icon="📜" label="Active Credentials" value={kpis?.activeCredentials ?? '—'} color="gold" />
        <KPICard icon="🌍" label="Gulf Readiness" value={kpis?.gulfReadiness ?? '—'} suffix="%" color="teal" />
        <KPICard icon="📋" label="Pending Assessments" value={kpis?.pendingAssessments ?? '—'} color="purple" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Monthly Registrations */}
        <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-5">
          <h3 className="text-sm font-semibold dark:text-white mb-4">Monthly Registrations</h3>
          <Bar data={{
            labels: regData.map(d => d._id),
            datasets: [{ label: 'Workers', data: regData.map(d => d.count), backgroundColor: '#0072BC', borderRadius: 6 }],
          }} options={{ responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }} />
        </div>

        {/* Trade Distribution */}
        <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-5">
          <h3 className="text-sm font-semibold dark:text-white mb-4">Trade Distribution</h3>
          <Doughnut data={{
            labels: tradeData.map(d => d._id?.charAt(0).toUpperCase() + d._id?.slice(1)),
            datasets: [{ data: tradeData.map(d => d.count), backgroundColor: tradeData.map(d => TRADE_COLORS[d._id] || '#94a3b8'), borderWidth: 0 }],
          }} options={{ responsive: true, plugins: { legend: { position: 'right', labels: { usePointStyle: true, pointStyle: 'circle' } } } }} />
        </div>
      </div>
    </div>
  );
}
