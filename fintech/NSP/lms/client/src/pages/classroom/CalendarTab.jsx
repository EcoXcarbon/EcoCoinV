import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api/client';

function dayKey(d) {
  const dt = new Date(d);
  return dt.toISOString().slice(0, 10);
}

function dayLabel(key) {
  const d = new Date(key + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d - today) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

function statusFor(item) {
  const s = item.mySubmission?.status;
  if (s === 'returned') return { label: 'Graded', cls: 'text-ilo-blue bg-ilo-blue/10' };
  if (s === 'turned-in' || s === 'resubmitted') return { label: 'Turned in', cls: 'text-emerald-700 bg-emerald-100 dark:bg-emerald-900/30' };
  if (item.dueDate && new Date(item.dueDate) < new Date()) return { label: 'Missing', cls: 'text-red-700 bg-red-100 dark:bg-red-900/30' };
  return { label: 'Assigned', cls: 'text-gray-600 bg-gray-100 dark:bg-navy-light' };
}

export default function CalendarTab({ cls }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/classroom/${cls._id}/classwork`);
      setItems(data.filter(i => i.dueDate));
    } catch { toast.error('Failed to load calendar'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [cls._id]);

  if (loading) return <div className="flex justify-center py-8"><div className="animate-spin w-6 h-6 border-2 border-ilo-blue border-t-transparent rounded-full" /></div>;
  if (items.length === 0) {
    return <div className="text-center py-12 text-sm text-gray-500 dark:text-gray-400">No items with due dates yet.</div>;
  }

  // Group by day, sort
  const groups = {};
  for (const it of items) {
    const k = dayKey(it.dueDate);
    (groups[k] = groups[k] || []).push(it);
  }
  const sortedKeys = Object.keys(groups).sort();

  return (
    <div className="space-y-6">
      {sortedKeys.map(key => (
        <section key={key}>
          <h2 className="text-xs uppercase tracking-wider font-bold text-ilo-blue border-b border-border dark:border-navy-light pb-2 mb-2">
            {dayLabel(key)}
          </h2>
          <ul className="space-y-2">
            {groups[key]
              .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
              .map(it => {
                const st = statusFor(it);
                return (
                  <li key={it._id} className="bg-white dark:bg-navy-mid rounded-lg border border-border dark:border-navy-light p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold dark:text-white truncate">{it.title}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {new Date(it.dueDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {it.points} pts
                        {it.topic && ` · ${it.topic}`}
                      </div>
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${st.cls}`}>{st.label}</span>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  );
}
