import { useEffect, useState, useMemo } from 'react';
import { Bar, Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import api from '../api/client';
import { useLang } from '../context/LangContext';
import toast from 'react-hot-toast';

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend, Filler);

export default function Analytics() {
  const { t } = useLang();
  const [gap, setGap] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [trends, setTrends] = useState([]);
  const [pipeline, setPipeline] = useState(null);
  const [training, setTraining] = useState(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    api.get('/analytics/skills-gap')
      .then(r => setGap(r.data))
      .catch(() => toast.error('Failed to load skills gap data'));
    api.get('/analytics/districts')
      .then(r => setDistricts(r.data))
      .catch(() => toast.error('Failed to load district data'));
    api.get('/analytics/trends')
      .then(r => setTrends(r.data))
      .catch(() => toast.error('Failed to load trends data'));
    api.get('/analytics/pipeline')
      .then(r => setPipeline(r.data))
      .catch(() => toast.error('Failed to load pipeline data'));
    api.get('/training/analytics/overview')
      .then(r => setTraining(r.data))
      .catch(() => toast.error('Failed to load training analytics'));
  }, []);

  /* Filter trends by date range */
  const filteredTrends = useMemo(() => {
    if (!startDate && !endDate) return trends;
    return trends.filter(item => {
      const month = item.month; // expected format: "YYYY-MM"
      if (startDate && month < startDate) return false;
      if (endDate && month > endDate) return false;
      return true;
    });
  }, [trends, startDate, endDate]);

  /* Download PDF report */
  const handleDownloadPdf = async () => {
    setDownloading(true);
    try {
      const res = await api.get('/reports/analytics/pdf', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'analytics-report.pdf');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Report downloaded');
    } catch {
      toast.error('Failed to download report');
    } finally {
      setDownloading(false);
    }
  };

  /* Line chart data */
  const trendsChartData = {
    labels: filteredTrends.map(d => d.month),
    datasets: [
      {
        label: 'Workers',
        data: filteredTrends.map(d => d.workers),
        borderColor: '#0072BC',
        backgroundColor: 'rgba(0,114,188,0.1)',
        fill: true,
        tension: 0.3,
      },
      {
        label: 'Credentials',
        data: filteredTrends.map(d => d.credentials),
        borderColor: '#C8952E',
        backgroundColor: 'rgba(200,149,46,0.1)',
        fill: true,
        tension: 0.3,
      },
      {
        label: 'Assessments',
        data: filteredTrends.map(d => d.assessments),
        borderColor: '#7C3AED',
        backgroundColor: 'rgba(124,58,237,0.1)',
        fill: true,
        tension: 0.3,
      },
    ],
  };

  /* Pipeline funnel chart data */
  const pipelineChartData = pipeline ? {
    labels: ['Pipeline'],
    datasets: [
      {
        label: 'Scheduled',
        data: [pipeline.scheduled ?? 0],
        backgroundColor: '#0072BC',
        borderRadius: 4,
      },
      {
        label: 'In Progress',
        data: [pipeline.inProgress ?? 0],
        backgroundColor: '#C8952E',
        borderRadius: 4,
      },
      {
        label: 'Completed',
        data: [pipeline.completed ?? 0],
        backgroundColor: '#15803D',
        borderRadius: 4,
      },
      {
        label: 'Failed',
        data: [pipeline.failed ?? 0],
        backgroundColor: '#DC2626',
        borderRadius: 4,
      },
    ],
  } : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h2 className="text-xl font-bold dark:text-white">{t('Analytics & Insights')}</h2>
        <button
          onClick={handleDownloadPdf}
          disabled={downloading}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl bg-ilo-blue text-white hover:bg-ilo-blue/90 disabled:opacity-50 transition-colors"
        >
          {downloading ? (
            <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17v3a2 2 0 002 2h14a2 2 0 002-2v-3" /></svg>
          )}
          {t('Download PDF')}
        </button>
      </div>

      {/* Date Range Filter */}
      <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-5">
        <h3 className="font-semibold dark:text-white mb-3">{t('Date Range Filter')}</h3>
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="start-date" className="text-xs text-gray-500 dark:text-gray-400 font-medium">{t('Start Date')}</label>
            <input
              id="start-date"
              type="month"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="px-3 py-2 text-sm border border-border dark:border-navy-light rounded-xl bg-white dark:bg-navy-mid dark:text-white focus:ring-2 focus:ring-ilo-blue/30 focus:border-ilo-blue outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="end-date" className="text-xs text-gray-500 dark:text-gray-400 font-medium">{t('End Date')}</label>
            <input
              id="end-date"
              type="month"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="px-3 py-2 text-sm border border-border dark:border-navy-light rounded-xl bg-white dark:bg-navy-mid dark:text-white focus:ring-2 focus:ring-ilo-blue/30 focus:border-ilo-blue outline-none"
            />
          </div>
          {(startDate || endDate) && (
            <button
              onClick={() => { setStartDate(''); setEndDate(''); }}
              className="self-end px-3 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border border-border dark:border-navy-light rounded-xl transition-colors"
            >
              {t('Clear')}
            </button>
          )}
        </div>
      </div>

      {/* Time-Series Trends */}
      <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-5">
        <h3 className="font-semibold dark:text-white mb-4">{t('Trends Over Time')}</h3>
        {filteredTrends.length > 0 ? (
          <Line
            data={trendsChartData}
            options={{
              responsive: true,
              interaction: { mode: 'index', intersect: false },
              plugins: {
                legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle' } },
              },
              scales: {
                y: { beginAtZero: true },
              },
            }}
          />
        ) : (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">{t('No trend data available for the selected range')}</p>
        )}
      </div>

      {/* Assessment Pipeline Funnel */}
      <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-5">
        <h3 className="font-semibold dark:text-white mb-4">{t('Assessment Pipeline')}</h3>
        {pipelineChartData ? (
          <Bar
            data={pipelineChartData}
            options={{
              responsive: true,
              indexAxis: 'y',
              plugins: {
                legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle' } },
              },
              scales: {
                x: { stacked: true, beginAtZero: true },
                y: { stacked: true, display: false },
              },
            }}
          />
        ) : (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">{t('Loading pipeline data...')}</p>
        )}
      </div>

      {/* Training Effectiveness */}
      <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-5">
        <h3 className="font-semibold dark:text-white mb-4">{t('Training Effectiveness')}</h3>
        {training && training.byTrade && training.byTrade.length > 0 ? (
          <div className="space-y-3">
            {training.byTrade.map(item => (
              <div key={item.trade} className="flex items-center gap-4">
                <span className="w-28 text-sm font-medium capitalize dark:text-white truncate">{item.trade}</span>
                <div className="flex-1 h-6 bg-gray-100 dark:bg-navy-light rounded-full overflow-hidden">
                  <div
                    className="h-full bg-ilo-blue rounded-full flex items-center justify-end pr-2 text-[10px] font-bold text-white transition-all duration-500"
                    style={{ width: `${Math.min(item.completionRate ?? 0, 100)}%` }}
                  >
                    {(item.completionRate ?? 0).toFixed(1)}%
                  </div>
                </div>
                <span className="w-16 text-right text-xs text-gray-500 dark:text-gray-400">
                  {item.completed ?? 0}/{item.total ?? 0}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">{t('No training data available')}</p>
        )}
      </div>

      {/* Skills Gap */}
      <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-5">
        <h3 className="font-semibold dark:text-white mb-4">Skills Gap Analysis</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-navy-light">
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Trade</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Supply</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Demand</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Gap</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Gap %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border dark:divide-navy-light">
              {gap.map(g => (
                <tr key={g.trade} className="hover:bg-gray-50 dark:hover:bg-navy-light">
                  <td className="px-4 py-2 font-medium capitalize dark:text-white">{g.trade}</td>
                  <td className="px-4 py-2 text-right dark:text-gray-300">{g.supply}</td>
                  <td className="px-4 py-2 text-right dark:text-gray-300">{g.demand}</td>
                  <td className="px-4 py-2 text-right text-red-600 dark:text-red-400 font-semibold">{g.gap}</td>
                  <td className="px-4 py-2 text-right">
                    <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">{g.gapPercent}%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* District Distribution */}
      <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-5">
        <h3 className="font-semibold dark:text-white mb-4">District Distribution</h3>
        <Bar data={{
          labels: districts.map(d => d._id),
          datasets: [{ label: 'Workers', data: districts.map(d => d.count), backgroundColor: '#C8952E', borderRadius: 6 }],
        }} options={{ responsive: true, indexAxis: 'y', plugins: { legend: { display: false } } }} />
      </div>
    </div>
  );
}
