import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api/client';
import AssignmentDetail from './AssignmentDetail';

function StatusPill({ sub, assignment }) {
  if (!sub) {
    if (assignment.dueDate && new Date(assignment.dueDate) < new Date()) {
      return <span className="text-[10px] font-semibold text-red-700 bg-red-100 dark:bg-red-900/30 px-2 py-0.5 rounded">Missing</span>;
    }
    return <span className="text-[10px] font-semibold text-gray-600 bg-gray-100 dark:bg-navy-light px-2 py-0.5 rounded">Assigned</span>;
  }
  const map = {
    'draft': ['Draft', 'text-gray-700 bg-gray-100 dark:bg-navy-light'],
    'turned-in': ['Turned in', 'text-emerald-700 bg-emerald-100 dark:bg-emerald-900/30'],
    'resubmitted': ['Resubmitted', 'text-emerald-700 bg-emerald-100 dark:bg-emerald-900/30'],
    'returned': ['Graded', 'text-ilo-blue bg-ilo-blue/10'],
  };
  const [label, cls] = map[sub.status] || ['—', 'bg-gray-100'];
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${cls}`}>
      {label}{sub.late && sub.status !== 'returned' ? ' • Late' : ''}
    </span>
  );
}

/* ───────────────── Create classwork modal ───────────────── */
function CreateAssignmentModal({ open, onClose, classId, topics, onCreated }) {
  const [form, setForm] = useState({
    title: '', instructions: '', topicId: '', type: 'assignment',
    points: 100, dueDate: '', allowLate: true, passMark: 70, awardCredential: false,
  });
  const [files, setFiles] = useState([]);
  const [attachments, setAttachments] = useState([]);   // uploaded files
  const [resources, setResources] = useState([]);       // link / video resources
  const [resName, setResName] = useState('');
  const [resUrl, setResUrl] = useState('');
  const [resKind, setResKind] = useState('link');
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  if (!open) return null;

  const isMaterial = form.type === 'material';

  const addResource = () => {
    if (!resUrl.trim()) return toast.error('Resource URL required');
    let url = resUrl.trim();
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    setResources(prev => [...prev, { kind: resKind, name: resName.trim() || url, url }]);
    setResName(''); setResUrl('');
  };

  const uploadFiles = async () => {
    if (files.length === 0) return [];
    setUploading(true);
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      const { data } = await api.post(`/classroom/${classId}/uploads`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setAttachments(prev => [...prev, ...data.files]);
      setFiles([]);
      toast.success(`Uploaded ${data.files.length} file(s)`);
      return data.files;
    } catch (err) { toast.error(err.response?.data?.error || 'Upload failed'); return []; }
    finally { setUploading(false); }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return toast.error('Title required');
    setLoading(true);
    try {
      let attach = attachments;
      if (files.length > 0) {
        const uploaded = await uploadFiles();
        attach = [...attachments, ...uploaded];
      }
      const body = { ...form, attachments: [...attach, ...resources] };
      if (!body.dueDate) delete body.dueDate;
      if (!body.topicId) delete body.topicId;
      await api.post(`/classroom/${classId}/classwork`, body);
      toast.success('Posted');
      onCreated();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setLoading(false); }
  };

  const inputCls = 'w-full px-3 py-2 border rounded-lg text-sm dark:bg-navy-light dark:border-navy-light dark:text-white';

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <form onSubmit={submit} className="bg-white dark:bg-navy-mid rounded-xl w-full max-w-lg p-6 space-y-3 my-8">
        <h2 className="text-lg font-bold dark:text-white">New Classwork</h2>
        <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className={inputCls}>
          <option value="assignment">Assignment</option>
          <option value="quiz">Quiz</option>
          <option value="material">Material (teaching resource)</option>
          <option value="question">Question</option>
        </select>
        <input required placeholder="Title" value={form.title}
          onChange={e => setForm({ ...form, title: e.target.value })} className={inputCls} />
        <textarea rows={4} placeholder={isMaterial ? 'Description (optional)' : 'Instructions (optional)'}
          value={form.instructions} onChange={e => setForm({ ...form, instructions: e.target.value })}
          className={`${inputCls} resize-none`} />

        <label className="block text-xs text-gray-600 dark:text-gray-400">
          Topic (outline section)
          <select value={form.topicId} onChange={e => setForm({ ...form, topicId: e.target.value })} className={`${inputCls} mt-1`}>
            <option value="">No topic</option>
            {topics.map(t => <option key={t._id} value={t._id}>{t.title}</option>)}
          </select>
        </label>

        {!isMaterial && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-gray-600 dark:text-gray-400">
                Points
                <input type="number" min={0} max={1000} value={form.points}
                  onChange={e => setForm({ ...form, points: Number(e.target.value) })} className={`${inputCls} mt-1`} />
              </label>
              <label className="text-xs text-gray-600 dark:text-gray-400">
                Due date
                <input type="datetime-local" value={form.dueDate}
                  onChange={e => setForm({ ...form, dueDate: e.target.value })} className={`${inputCls} mt-1`} />
              </label>
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
              <input type="checkbox" checked={form.allowLate} onChange={e => setForm({ ...form, allowLate: e.target.checked })} />
              Allow late submissions
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-gray-600 dark:text-gray-400">
                Pass mark %
                <input type="number" min={0} max={100} value={form.passMark}
                  onChange={e => setForm({ ...form, passMark: Number(e.target.value) })} className={`${inputCls} mt-1`} />
              </label>
              <label className="flex items-end gap-2 text-xs text-gray-600 dark:text-gray-400 pb-2">
                <input type="checkbox" checked={form.awardCredential}
                  onChange={e => setForm({ ...form, awardCredential: e.target.checked })} />
                <span>Award blockchain credential on pass</span>
              </label>
            </div>
          </>
        )}

        {/* Resource links / videos */}
        <div>
          <label className="text-xs text-gray-600 dark:text-gray-400">Add link / video resource</label>
          <div className="flex gap-2 mt-1">
            <select value={resKind} onChange={e => setResKind(e.target.value)}
              className="px-2 py-2 border rounded-lg text-sm dark:bg-navy-light dark:border-navy-light dark:text-white">
              <option value="link">Link</option>
              <option value="video">Video</option>
            </select>
            <input placeholder="Title" value={resName} onChange={e => setResName(e.target.value)}
              className="flex-1 px-3 py-2 border rounded-lg text-sm dark:bg-navy-light dark:border-navy-light dark:text-white" />
          </div>
          <div className="flex gap-2 mt-2">
            <input placeholder="https://…" value={resUrl} onChange={e => setResUrl(e.target.value)}
              className="flex-1 px-3 py-2 border rounded-lg text-sm dark:bg-navy-light dark:border-navy-light dark:text-white" />
            <button type="button" onClick={addResource}
              className="px-3 py-2 text-sm border border-ilo-blue text-ilo-blue rounded-lg shrink-0">Add</button>
          </div>
          {resources.length > 0 && (
            <ul className="mt-2 text-xs space-y-1">
              {resources.map((r, i) => (
                <li key={i} className="flex items-center justify-between bg-gray-50 dark:bg-navy-light px-2 py-1 rounded">
                  <span className="truncate dark:text-gray-200">{r.kind === 'video' ? '🎬' : '🔗'} {r.name}</span>
                  <button type="button" onClick={() => setResources(resources.filter((_, j) => j !== i))} className="text-red-500 ml-2">×</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* File attachments */}
        <div>
          <label className="text-xs text-gray-600 dark:text-gray-400">Attach files (optional)</label>
          <input type="file" multiple onChange={e => setFiles(Array.from(e.target.files))} className="block mt-1 text-xs" />
          {attachments.length > 0 && (
            <ul className="mt-2 text-xs space-y-1">
              {attachments.map((a, i) => (
                <li key={i} className="flex items-center justify-between bg-gray-50 dark:bg-navy-light px-2 py-1 rounded">
                  <span className="truncate dark:text-gray-200">📎 {a.name}</span>
                  <button type="button" onClick={() => setAttachments(attachments.filter((_, j) => j !== i))} className="text-red-500 ml-2">×</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400">Cancel</button>
          <button type="submit" disabled={loading || uploading} className="px-4 py-2 text-sm bg-ilo-blue text-white rounded-lg disabled:opacity-50">
            {loading ? 'Posting…' : uploading ? 'Uploading…' : 'Post'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ───────────────── Topic (outline) manager ───────────────── */
function TopicManager({ classId, topics, onChange }) {
  const [newTitle, setNewTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!newTitle.trim()) return;
    setBusy(true);
    try { await api.post(`/classroom/${classId}/topics`, { title: newTitle.trim() }); setNewTitle(''); onChange(); }
    catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setBusy(false); }
  };
  const rename = async (t) => {
    const title = window.prompt('Rename topic', t.title);
    if (!title || title === t.title) return;
    try { await api.put(`/classroom/${classId}/topics/${t._id}`, { title }); onChange(); }
    catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  };
  const remove = async (t) => {
    if (!window.confirm(`Delete topic "${t.title}"? Its classwork will move to "No topic".`)) return;
    try { await api.delete(`/classroom/${classId}/topics/${t._id}`); onChange(); }
    catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  };
  const move = async (idx, dir) => {
    const next = [...topics];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    try { await api.put(`/classroom/${classId}/topics/reorder`, { order: next.map(t => t._id) }); onChange(); }
    catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  };

  return (
    <div className="bg-white dark:bg-navy-mid rounded-lg border border-border dark:border-navy-light p-4 space-y-3">
      <h3 className="text-sm font-bold dark:text-white">Course outline — topics</h3>
      <div className="flex gap-2">
        <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), add())}
          placeholder="New topic (e.g. Week 1 — Safety)"
          className="flex-1 px-3 py-2 border rounded-lg text-sm dark:bg-navy-light dark:border-navy-light dark:text-white" />
        <button onClick={add} disabled={busy} className="px-3 py-2 text-sm bg-ilo-blue text-white rounded-lg disabled:opacity-50">+ Add</button>
      </div>
      {topics.length === 0 ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">No topics yet. Topics group your classwork into a course outline.</p>
      ) : (
        <ul className="space-y-1">
          {topics.map((t, i) => (
            <li key={t._id} className="flex items-center gap-2 text-sm dark:text-gray-200 bg-gray-50 dark:bg-navy-light px-2 py-1.5 rounded">
              <span className="flex-1 truncate">{t.title}</span>
              <button onClick={() => move(i, -1)} disabled={i === 0} className="px-1 text-gray-500 disabled:opacity-30" title="Move up">↑</button>
              <button onClick={() => move(i, 1)} disabled={i === topics.length - 1} className="px-1 text-gray-500 disabled:opacity-30" title="Move down">↓</button>
              <button onClick={() => rename(t)} className="px-1 text-ilo-blue" title="Rename">✎</button>
              <button onClick={() => remove(t)} className="px-1 text-red-500" title="Delete">🗑</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const typeIcon = (t) => ({ assignment: '📝', quiz: '✅', material: '📄', question: '❓' }[t] || '📝');

function ItemRow({ it, isTeacher, canMoveUp, canMoveDown, onMove, onOpen }) {
  return (
    <li className="flex items-center gap-2">
      {isTeacher && (
        <div className="flex flex-col">
          <button onClick={() => onMove(-1)} disabled={!canMoveUp} className="text-gray-400 disabled:opacity-30 text-xs leading-none" title="Move up">▲</button>
          <button onClick={() => onMove(1)} disabled={!canMoveDown} className="text-gray-400 disabled:opacity-30 text-xs leading-none" title="Move down">▼</button>
        </div>
      )}
      <button onClick={onOpen}
        className="flex-1 text-left bg-white dark:bg-navy-mid rounded-lg border border-border dark:border-navy-light p-4 hover:border-ilo-blue transition flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <span className="text-2xl shrink-0">{typeIcon(it.type)}</span>
          <div className="min-w-0">
            <div className="font-semibold text-sm dark:text-white truncate">{it.title}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {it.type === 'material' ? 'Material' : `${it.points} pts`}
              {it.dueDate && ` • Due ${new Date(it.dueDate).toLocaleString()}`}
              {it.attachments?.length > 0 && ` • ${it.attachments.length} resource${it.attachments.length === 1 ? '' : 's'}`}
            </div>
          </div>
        </div>
        {it.type !== 'material' && <StatusPill sub={it.mySubmission} assignment={it} />}
      </button>
    </li>
  );
}

export default function ClassworkTab({ cls, isTeacher }) {
  const [items, setItems] = useState([]);
  const [topics, setTopics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [openId, setOpenId] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [work, tps] = await Promise.all([
        api.get(`/classroom/${cls._id}/classwork`),
        api.get(`/classroom/${cls._id}/topics`),
      ]);
      setItems(work.data);
      setTopics(tps.data);
    } catch { toast.error('Failed to load classwork'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [cls._id]);

  const sortByOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || new Date(a.createdAt) - new Date(b.createdAt);

  // Reorder items within a group via up/down swap.
  const moveItem = async (group, idx, dir, topicId) => {
    const next = [...group];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    const payload = next.map((it, order) => ({ id: it._id, order, topicId: topicId || null }));
    try { await api.put(`/classroom/${cls._id}/classwork/reorder`, { items: payload }); load(); }
    catch (err) { toast.error(err.response?.data?.error || 'Reorder failed'); }
  };

  // Build outline sections: managed topics (in order) + an "Ungrouped" bucket.
  const byTopicId = {};
  const ungrouped = [];
  for (const it of items) {
    if (it.topicId) (byTopicId[it.topicId] = byTopicId[it.topicId] || []).push(it);
    else ungrouped.push(it);
  }
  const sections = topics.map(t => ({ key: t._id, title: t.title, items: (byTopicId[t._id] || []).sort(sortByOrder), topicId: t._id }));
  if (ungrouped.length) sections.push({ key: '__ungrouped', title: topics.length ? 'No topic' : 'Classwork', items: ungrouped.sort(sortByOrder), topicId: null });

  return (
    <div className="space-y-4">
      {isTeacher && (
        <div className="flex justify-end gap-2">
          <button onClick={() => setManageOpen(o => !o)}
            className="px-4 py-2 text-sm font-semibold border border-ilo-blue text-ilo-blue rounded-lg">
            {manageOpen ? 'Hide outline' : '🗂 Manage outline'}
          </button>
          <button onClick={() => setCreateOpen(true)}
            className="px-4 py-2 text-sm font-semibold bg-ilo-blue text-white rounded-lg">+ Create</button>
        </div>
      )}

      {isTeacher && manageOpen && (
        <TopicManager classId={cls._id} topics={topics} onChange={load} />
      )}

      {loading ? (
        <div className="flex justify-center py-8"><div className="animate-spin w-6 h-6 border-2 border-ilo-blue border-t-transparent rounded-full" /></div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-sm text-gray-500 dark:text-gray-400">
          {isTeacher ? 'No classwork yet. Add topics to build your outline, then click + Create.' : 'No classwork posted yet.'}
        </div>
      ) : (
        <div className="space-y-6">
          {sections.map(sec => (
            <section key={sec.key}>
              <h2 className="text-xs uppercase tracking-wider font-bold text-ilo-blue border-b border-border dark:border-navy-light pb-2 mb-2">
                {sec.title} <span className="text-gray-400 font-normal">({sec.items.length})</span>
              </h2>
              <ul className="space-y-2">
                {sec.items.map((it, idx) => (
                  <ItemRow key={it._id} it={it} isTeacher={isTeacher}
                    canMoveUp={idx > 0} canMoveDown={idx < sec.items.length - 1}
                    onMove={(dir) => moveItem(sec.items, idx, dir, sec.topicId)}
                    onOpen={() => setOpenId(it._id)} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <CreateAssignmentModal open={createOpen} onClose={() => setCreateOpen(false)}
        classId={cls._id} topics={topics} onCreated={() => { setCreateOpen(false); load(); }} />

      {openId && (
        <AssignmentDetail classId={cls._id} assignmentId={openId} isTeacher={isTeacher}
          onClose={() => { setOpenId(null); load(); }} />
      )}
    </div>
  );
}
