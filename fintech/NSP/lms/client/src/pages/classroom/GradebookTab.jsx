import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api/client';

export default function GradebookTab({ cls }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/classroom/${cls._id}/classwork/gradebook/all`);
      setData(data);
    } catch (err) { toast.error('Failed to load gradebook'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [cls._id]);

  if (loading || !data) {
    return <div className="flex justify-center py-8"><div className="animate-spin w-6 h-6 border-2 border-ilo-blue border-t-transparent rounded-full" /></div>;
  }
  if (data.assignments.length === 0) {
    return <div className="text-center py-12 text-sm text-gray-500 dark:text-gray-400">No graded items yet. Create assignments first.</div>;
  }
  if (data.rows.length === 0) {
    return <div className="text-center py-12 text-sm text-gray-500 dark:text-gray-400">No students enrolled yet.</div>;
  }

  return (
    <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-navy-light">
          <tr>
            <th className="text-left p-3 sticky left-0 bg-gray-50 dark:bg-navy-light">Student</th>
            {data.assignments.map(a => (
              <th key={a._id} className="text-center p-3 min-w-[100px]">
                <div className="font-semibold text-gray-700 dark:text-gray-200 truncate max-w-[120px]" title={a.title}>{a.title}</div>
                <div className="text-[10px] font-normal text-gray-400">/{a.points}</div>
              </th>
            ))}
            <th className="text-right p-3">Average</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map(r => (
            <tr key={r.student._id} className="border-t border-border dark:border-navy-light">
              <td className="p-3 dark:text-white sticky left-0 bg-white dark:bg-navy-mid font-semibold">{r.student.name}</td>
              {r.cells.map(c => (
                <td key={c.assignmentId} className="text-center p-3">
                  {c.grade != null ? (
                    <span className={`${c.late ? 'text-amber-600' : 'dark:text-white'}`}>{c.grade}</span>
                  ) : c.status === 'turned-in' || c.status === 'resubmitted' ? (
                    <span className="text-emerald-600 text-xs">●</span>
                  ) : (
                    <span className="text-gray-300 dark:text-gray-600">—</span>
                  )}
                </td>
              ))}
              <td className="text-right p-3 font-bold dark:text-white">
                {r.average != null ? `${r.average}%` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
