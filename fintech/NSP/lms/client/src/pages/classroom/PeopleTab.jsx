import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api/client';

export default function PeopleTab({ cls, isTeacher, onChange }) {
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('student');
  const [inviting, setInviting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/classroom/${cls._id}/people`);
      setPeople(data);
    } catch { toast.error('Failed to load people'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [cls._id]);

  const invite = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      await api.post(`/classroom/${cls._id}/invite`, { email: inviteEmail.trim(), role: inviteRole });
      toast.success('User added to class');
      setInviteEmail('');
      setInviteOpen(false);
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Invite failed'); }
    finally { setInviting(false); }
  };

  const remove = async (enrollmentId) => {
    if (!confirm('Remove this member?')) return;
    try {
      await api.delete(`/classroom/${cls._id}/people/${enrollmentId}`);
      toast.success('Removed');
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Remove failed'); }
  };

  const teachers = people.filter(p => p.role === 'teacher' || p.role === 'co-teacher');
  const students = people.filter(p => p.role === 'student');

  return (
    <div className="space-y-6">
      {isTeacher && (
        <div className="flex justify-end">
          <button onClick={() => setInviteOpen(true)}
            className="px-3 py-1.5 text-xs font-semibold bg-ilo-blue text-white rounded-lg">+ Invite</button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8"><div className="animate-spin w-6 h-6 border-2 border-ilo-blue border-t-transparent rounded-full" /></div>
      ) : (
        <>
          <section>
            <div className="border-b border-border dark:border-navy-light pb-2 mb-3">
              <h2 className="text-lg font-bold text-ilo-blue">Teachers ({teachers.length})</h2>
            </div>
            <ul className="space-y-1">
              {teachers.map(p => (
                <li key={p._id} className="flex items-center justify-between py-2 px-3 hover:bg-gray-50 dark:hover:bg-navy-light rounded">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-ilo-blue/10 flex items-center justify-center text-sm font-bold text-ilo-blue">
                      {p.user?.name?.[0] || '?'}
                    </div>
                    <div>
                      <div className="text-sm font-semibold dark:text-white">{p.user?.name}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{p.user?.email}</div>
                    </div>
                  </div>
                  <span className="text-[10px] uppercase tracking-wider text-ilo-blue">{p.role}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <div className="border-b border-border dark:border-navy-light pb-2 mb-3 flex justify-between">
              <h2 className="text-lg font-bold text-ilo-blue">Students ({students.length})</h2>
            </div>
            {students.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 py-4">No students yet. Share the class code or invite by email.</p>
            ) : (
              <ul className="space-y-1">
                {students.map(p => (
                  <li key={p._id} className="flex items-center justify-between py-2 px-3 hover:bg-gray-50 dark:hover:bg-navy-light rounded">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-gray-200 dark:bg-navy-light flex items-center justify-center text-sm font-bold text-gray-600 dark:text-gray-300">
                        {p.user?.name?.[0] || '?'}
                      </div>
                      <div>
                        <div className="text-sm font-semibold dark:text-white">{p.user?.name}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">{p.user?.email}</div>
                      </div>
                    </div>
                    {isTeacher && (
                      <button onClick={() => remove(p._id)} className="text-xs text-red-600 hover:underline">Remove</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {inviteOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <form onSubmit={invite} className="bg-white dark:bg-navy-mid rounded-xl w-full max-w-md p-6 space-y-3">
            <h3 className="text-lg font-bold dark:text-white">Invite to class</h3>
            <input type="email" required value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
              placeholder="email@example.com"
              className="w-full px-3 py-2 border rounded-lg dark:bg-navy-light dark:border-navy-light dark:text-white" />
            <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-navy-light dark:border-navy-light dark:text-white">
              <option value="student">Student</option>
              <option value="co-teacher">Co-teacher</option>
            </select>
            <p className="text-xs text-gray-500 dark:text-gray-400">User must already have an account.</p>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setInviteOpen(false)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400">Cancel</button>
              <button type="submit" disabled={inviting} className="px-4 py-2 text-sm bg-ilo-blue text-white rounded-lg disabled:opacity-50">
                {inviting ? 'Inviting…' : 'Invite'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
