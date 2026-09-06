import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import StreamTab from './classroom/StreamTab';
import ClassworkTab from './classroom/ClassworkTab';
import GradebookTab from './classroom/GradebookTab';
import PeopleTab from './classroom/PeopleTab';
import MeetTab from './classroom/MeetTab';

const THEMES = {
  blue: 'from-blue-500 to-blue-700',
  green: 'from-emerald-500 to-emerald-700',
  purple: 'from-purple-500 to-purple-700',
  amber: 'from-amber-500 to-amber-700',
  rose: 'from-rose-500 to-rose-700',
  teal: 'from-teal-500 to-teal-700',
};

const TABS = ['Stream', 'Classwork', 'Meet', 'People', 'Grades'];

export default function ClassView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [cls, setCls] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('Stream');

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/classroom/${id}`);
      setCls(data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load class');
      navigate('/classroom');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [id]);

  if (loading || !cls) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin w-6 h-6 border-2 border-ilo-blue border-t-transparent rounded-full" />
      </div>
    );
  }

  const isTeacher = cls.myRole === 'teacher' || cls.myRole === 'co-teacher';
  const banner = THEMES[cls.theme] || THEMES.blue;
  // Meet is always visible — it now hosts scheduled live sessions in addition to
  // the optional always-on class meeting.
  const visibleTabs = TABS.filter(t => {
    if (t === 'Grades' && !isTeacher) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <button onClick={() => navigate('/classroom')}
        className="text-xs text-gray-500 dark:text-gray-400 hover:text-ilo-blue">← All classes</button>

      {/* Banner */}
      <div className={`bg-gradient-to-r ${banner} rounded-xl p-6 text-white flex items-end justify-between min-h-[140px]`}>
        <div>
          <h1 className="text-3xl font-bold">{cls.name}</h1>
          {cls.section && <p className="text-sm opacity-90 mt-1">{cls.section}</p>}
          {cls.subject && <p className="text-xs opacity-75 mt-1">{cls.subject}</p>}
        </div>
        {cls.joinCode && (
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider opacity-80">Class code</div>
            <div className="text-2xl font-mono font-bold tracking-widest">{cls.joinCode}</div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-border dark:border-navy-light flex gap-1 tl-tabs">
        {visibleTabs.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-semibold transition-colors relative whitespace-nowrap shrink-0 ${
              tab === t
                ? 'text-ilo-blue'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
            }`}>
            {t}
            {tab === t && <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-ilo-blue rounded-t" />}
          </button>
        ))}
      </div>

      {tab === 'Stream' && <StreamTab cls={cls} isTeacher={isTeacher} onClassUpdate={load} />}
      {tab === 'Classwork' && <ClassworkTab cls={cls} isTeacher={isTeacher} />}
      {tab === 'Meet' && <MeetTab cls={cls} isTeacher={isTeacher} onClassUpdate={load} currentUserName={user?.name} />}
      {tab === 'People' && <PeopleTab cls={cls} isTeacher={isTeacher} onChange={load} />}
      {tab === 'Grades' && isTeacher && <GradebookTab cls={cls} />}
    </div>
  );
}
