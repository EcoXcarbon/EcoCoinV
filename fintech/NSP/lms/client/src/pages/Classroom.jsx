import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../api/client';

const THEMES = {
  blue: 'from-blue-500 to-blue-700',
  green: 'from-emerald-500 to-emerald-700',
  purple: 'from-purple-500 to-purple-700',
  amber: 'from-amber-500 to-amber-700',
  rose: 'from-rose-500 to-rose-700',
  teal: 'from-teal-500 to-teal-700',
};

function ClassCard({ cls, onOpen }) {
  const banner = THEMES[cls.theme] || THEMES.blue;
  return (
    <button
      onClick={() => onOpen(cls._id)}
      className="text-left bg-white dark:bg-navy-mid rounded-xl shadow-sm border border-border dark:border-navy-light overflow-hidden hover:shadow-md transition-shadow"
    >
      <div className={`h-24 bg-gradient-to-r ${banner} flex items-end p-4`}>
        <div className="text-white">
          <h3 className="font-bold text-lg leading-tight">{cls.name}</h3>
          {cls.section && <p className="text-xs opacity-90">{cls.section}</p>}
        </div>
      </div>
      <div className="p-4 space-y-1">
        {cls.subject && <p className="text-xs text-gray-500 dark:text-gray-400">{cls.subject}</p>}
        <div className="flex items-center justify-between pt-2">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-ilo-blue">
            {cls.myRole}
          </span>
          {cls.joinCode && (
            <span className="text-xs font-mono text-gray-600 dark:text-gray-400">
              {cls.joinCode}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function CreateClassModal({ open, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', section: '', subject: '', room: '', theme: 'blue' });
  const [loading, setLoading] = useState(false);
  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('Class name is required');
    setLoading(true);
    try {
      const { data } = await api.post('/classroom', form);
      toast.success('Class created');
      onCreated(data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create class');
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white dark:bg-navy-mid rounded-xl w-full max-w-md p-6 space-y-4">
        <h2 className="text-lg font-bold dark:text-white">Create Class</h2>
        <div className="space-y-3">
          <input className="w-full px-3 py-2 border rounded-lg dark:bg-navy-light dark:border-navy-light dark:text-white"
            placeholder="Class name (e.g. Welding Level 2)" value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })} />
          <input className="w-full px-3 py-2 border rounded-lg dark:bg-navy-light dark:border-navy-light dark:text-white"
            placeholder="Section (e.g. Morning Batch A)" value={form.section}
            onChange={e => setForm({ ...form, section: e.target.value })} />
          <input className="w-full px-3 py-2 border rounded-lg dark:bg-navy-light dark:border-navy-light dark:text-white"
            placeholder="Subject" value={form.subject}
            onChange={e => setForm({ ...form, subject: e.target.value })} />
          <input className="w-full px-3 py-2 border rounded-lg dark:bg-navy-light dark:border-navy-light dark:text-white"
            placeholder="Room (optional)" value={form.room}
            onChange={e => setForm({ ...form, room: e.target.value })} />
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Theme</label>
            <div className="flex gap-2 mt-1">
              {Object.entries(THEMES).map(([key, grad]) => (
                <button key={key} type="button" onClick={() => setForm({ ...form, theme: key })}
                  className={`w-8 h-8 rounded-full bg-gradient-to-br ${grad} ${form.theme === key ? 'ring-2 ring-offset-2 ring-ilo-blue' : ''}`}
                  aria-label={key} />
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400">Cancel</button>
          <button type="submit" disabled={loading} className="px-4 py-2 text-sm bg-ilo-blue text-white rounded-lg disabled:opacity-50">
            {loading ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}

function JoinClassModal({ open, onClose, onJoined }) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    try {
      const { data } = await api.post('/classroom/join', { code: code.trim().toUpperCase() });
      toast.success(`Joined ${data.name}`);
      onJoined(data.classId);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to join');
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white dark:bg-navy-mid rounded-xl w-full max-w-md p-6 space-y-4">
        <h2 className="text-lg font-bold dark:text-white">Join Class</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Ask your teacher for the class code, then enter it here.</p>
        <input autoFocus className="w-full px-4 py-3 border rounded-lg text-center text-xl font-mono tracking-widest uppercase dark:bg-navy-light dark:border-navy-light dark:text-white"
          placeholder="ABC123" value={code} maxLength={8}
          onChange={e => setCode(e.target.value.toUpperCase())} />
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400">Cancel</button>
          <button type="submit" disabled={loading || !code.trim()} className="px-4 py-2 text-sm bg-ilo-blue text-white rounded-lg disabled:opacity-50">
            {loading ? 'Joining…' : 'Join'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function Classroom() {
  const navigate = useNavigate();
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/classroom');
      setClasses(data);
    } catch (err) {
      toast.error('Failed to load classes');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleCreated = (cls) => { setCreateOpen(false); navigate(`/classroom/${cls._id}`); };
  const handleJoined = (id) => { setJoinOpen(false); navigate(`/classroom/${id}`); };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">Classroom</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Classes you teach or are enrolled in</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setJoinOpen(true)}
            className="px-4 py-2 text-sm font-semibold border border-ilo-blue text-ilo-blue rounded-lg hover:bg-ilo-blue/5">
            + Join
          </button>
          <button onClick={() => setCreateOpen(true)}
            className="px-4 py-2 text-sm font-semibold bg-ilo-blue text-white rounded-lg hover:bg-ilo-blue/90">
            + Create
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-6 h-6 border-2 border-ilo-blue border-t-transparent rounded-full" />
        </div>
      ) : classes.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light">
          <div className="text-5xl mb-3">🎓</div>
          <p className="text-gray-600 dark:text-gray-300 font-semibold">No classes yet</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Create a class to get started, or join one with a code.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {classes.map(c => <ClassCard key={c._id} cls={c} onOpen={(id) => navigate(`/classroom/${id}`)} />)}
        </div>
      )}

      <CreateClassModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={handleCreated} />
      <JoinClassModal open={joinOpen} onClose={() => setJoinOpen(false)} onJoined={handleJoined} />
    </div>
  );
}
