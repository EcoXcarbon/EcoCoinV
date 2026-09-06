import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api/client';

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function AnnouncementCard({ item, isTeacher, currentUserId, classId, canComment, onChange }) {
  const [commentText, setCommentText] = useState('');
  const [showComments, setShowComments] = useState(false);
  const [posting, setPosting] = useState(false);

  const isMine = item.author?._id === currentUserId;
  const canDelete = isMine || isTeacher;
  const isScheduled = item.scheduledFor && new Date(item.scheduledFor) > new Date();
  const effectiveCanComment = canComment && !item.commentsLocked;

  const postComment = async (e) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    setPosting(true);
    try {
      await api.post(`/classroom/${classId}/stream/${item._id}/comments`, { body: commentText });
      setCommentText('');
      onChange();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to comment'); }
    finally { setPosting(false); }
  };

  const togglePin = async () => {
    try {
      await api.put(`/classroom/${classId}/stream/${item._id}/pin`, { pinned: !item.pinned });
      onChange();
    } catch (err) { toast.error('Failed to pin'); }
  };

  const toggleCommentsLock = async () => {
    try {
      await api.put(`/classroom/${classId}/stream/${item._id}/comments-lock`, { locked: !item.commentsLocked });
      onChange();
    } catch (err) { toast.error('Failed to update'); }
  };

  const remove = async () => {
    if (!confirm('Delete this post?')) return;
    try {
      await api.delete(`/classroom/${classId}/stream/${item._id}`);
      onChange();
    } catch (err) { toast.error('Failed to delete'); }
  };

  return (
    <div className="bg-white dark:bg-navy-mid rounded-xl shadow-sm border border-border dark:border-navy-light p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex gap-3 items-center">
          <div className="w-10 h-10 rounded-full bg-ilo-blue/10 flex items-center justify-center text-sm font-bold text-ilo-blue">
            {item.author?.name?.[0] || '?'}
          </div>
          <div>
            <div className="text-sm font-semibold dark:text-white flex items-center gap-2 flex-wrap">
              {item.author?.name}
              {item.pinned && <span className="text-[10px] uppercase tracking-wider text-amber-600 bg-amber-100 dark:bg-amber-900/30 px-1.5 py-0.5 rounded">Pinned</span>}
              {item.kind === 'assignment-posted' && <span className="text-[10px] uppercase tracking-wider text-purple-600 bg-purple-100 dark:bg-purple-900/30 px-1.5 py-0.5 rounded">Assignment</span>}
              {isScheduled && <span className="text-[10px] uppercase tracking-wider text-blue-600 bg-blue-100 dark:bg-blue-900/30 px-1.5 py-0.5 rounded">Scheduled · {new Date(item.scheduledFor).toLocaleString()}</span>}
              {item.commentsLocked && <span className="text-[10px] uppercase tracking-wider text-gray-600 bg-gray-100 dark:bg-navy-light dark:text-gray-300 px-1.5 py-0.5 rounded">🔒 Comments closed</span>}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{timeAgo(item.createdAt)}</div>
          </div>
        </div>
        <div className="flex gap-2">
          {isTeacher && (
            <>
              <button onClick={togglePin} className="text-xs text-gray-500 hover:text-ilo-blue">
                {item.pinned ? 'Unpin' : 'Pin'}
              </button>
              <button onClick={toggleCommentsLock} className="text-xs text-gray-500 hover:text-ilo-blue">
                {item.commentsLocked ? 'Open comments' : 'Close comments'}
              </button>
            </>
          )}
          {canDelete && (
            <button onClick={remove} className="text-xs text-red-500 hover:underline">Delete</button>
          )}
        </div>
      </div>

      <p className="text-sm dark:text-gray-100 whitespace-pre-wrap">{item.body}</p>

      <div className="border-t border-border dark:border-navy-light pt-2">
        <button onClick={() => setShowComments(s => !s)}
          className="text-xs text-gray-500 dark:text-gray-400 hover:text-ilo-blue">
          {(item.comments?.length || 0)} class comment{item.comments?.length === 1 ? '' : 's'}
        </button>

        {showComments && (
          <div className="mt-3 space-y-2">
            {item.comments?.map(c => (
              <div key={c._id} className="flex gap-2 items-start">
                <div className="w-7 h-7 rounded-full bg-gray-200 dark:bg-navy-light flex items-center justify-center text-xs font-bold text-gray-600 dark:text-gray-300">
                  {c.author?.name?.[0] || '?'}
                </div>
                <div className="flex-1">
                  <div className="text-xs">
                    <span className="font-semibold dark:text-white">{c.author?.name}</span>
                    <span className="text-gray-500 dark:text-gray-400 ml-2">{timeAgo(c.createdAt)}</span>
                  </div>
                  <p className="text-sm dark:text-gray-200">{c.body}</p>
                </div>
              </div>
            ))}
            {effectiveCanComment ? (
              <form onSubmit={postComment} className="flex gap-2 pt-2">
                <input value={commentText} onChange={e => setCommentText(e.target.value)}
                  placeholder="Add a class comment…"
                  className="flex-1 px-3 py-1.5 text-sm border rounded-lg dark:bg-navy-light dark:border-navy-light dark:text-white" />
                <button type="submit" disabled={posting || !commentText.trim()}
                  className="px-3 py-1.5 text-xs bg-ilo-blue text-white rounded-lg disabled:opacity-50">Post</button>
              </form>
            ) : (
              <p className="text-xs text-gray-400 dark:text-gray-500 italic pt-2">
                {item.commentsLocked ? 'Comments closed on this post.' : 'Comments are teacher-only in this class.'}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function StreamTab({ cls, isTeacher, onClassUpdate }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [scheduledFor, setScheduledFor] = useState('');
  const [commentsLockedOnPost, setCommentsLockedOnPost] = useState(false);
  const [posting, setPosting] = useState(false);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingMode, setSavingMode] = useState(false);

  const perm = cls.streamPermission || 'post-and-comment';
  const studentCanPost = isTeacher || perm === 'post-and-comment';
  const studentCanComment = isTeacher || perm !== 'teacher-only';

  const PERM_LABELS = {
    'post-and-comment': { label: 'Students can post and comment', icon: '💬', short: 'Open' },
    'comment-only':     { label: 'Students can only comment', icon: '💭', short: 'Comments only' },
    'teacher-only':     { label: 'Only teachers can post or comment', icon: '🔒', short: 'Teacher-only' },
  };

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/classroom/${cls._id}/stream`);
      setItems(data);
    } catch (err) { toast.error('Failed to load stream'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    try {
      const token = localStorage.getItem('tl-token');
      if (token) {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setCurrentUserId(payload.id);
      }
    } catch {}
    load();
  }, [cls._id]);

  const post = async (e) => {
    e.preventDefault();
    if (!body.trim()) return;
    setPosting(true);
    try {
      const payload = { body, pinned };
      if (isTeacher && scheduledFor) payload.scheduledFor = new Date(scheduledFor).toISOString();
      if (isTeacher && commentsLockedOnPost) payload.commentsLocked = true;
      await api.post(`/classroom/${cls._id}/stream`, payload);
      const msg = scheduledFor && new Date(scheduledFor) > new Date()
        ? `Scheduled for ${new Date(scheduledFor).toLocaleString()}`
        : 'Posted';
      toast.success(msg);
      setBody('');
      setPinned(false);
      setScheduledFor('');
      setCommentsLockedOnPost(false);
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to post'); }
    finally { setPosting(false); }
  };

  const setMode = async (newMode) => {
    if (newMode === perm) { setSettingsOpen(false); return; }
    setSavingMode(true);
    try {
      await api.put(`/classroom/${cls._id}`, { streamPermission: newMode });
      toast.success(`Stream mode: ${PERM_LABELS[newMode].short}`);
      setSettingsOpen(false);
      if (onClassUpdate) onClassUpdate();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setSavingMode(false); }
  };

  return (
    <div className="space-y-4">
      {/* Mode banner */}
      <div className="flex items-center justify-between bg-white dark:bg-navy-mid rounded-lg border border-border dark:border-navy-light px-4 py-2 text-xs">
        <span className="text-gray-600 dark:text-gray-400">
          {PERM_LABELS[perm].icon} {PERM_LABELS[perm].label}
        </span>
        {isTeacher && (
          <button onClick={() => setSettingsOpen(true)}
            className="text-ilo-blue hover:underline">Change</button>
        )}
      </div>

      {studentCanPost ? (
        <form onSubmit={post} className="bg-white dark:bg-navy-mid rounded-xl shadow-sm border border-border dark:border-navy-light p-4 space-y-3">
          <textarea value={body} onChange={e => setBody(e.target.value)}
            placeholder="Share something with your class…"
            rows={3}
            className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-navy-light dark:border-navy-light dark:text-white resize-none" />
          {isTeacher && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1 border-t border-border dark:border-navy-light">
              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                <input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} />
                Pin to top
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                <input type="checkbox" checked={commentsLockedOnPost} onChange={e => setCommentsLockedOnPost(e.target.checked)} />
                Close comments
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                Schedule for
                <input type="datetime-local" value={scheduledFor}
                  onChange={e => setScheduledFor(e.target.value)}
                  className="px-2 py-1 border rounded text-xs dark:bg-navy-light dark:border-navy-light dark:text-white" />
              </label>
            </div>
          )}
          <div className="flex items-center justify-end">
            <button type="submit" disabled={posting || !body.trim()}
              className="px-4 py-1.5 text-sm font-semibold bg-ilo-blue text-white rounded-lg disabled:opacity-50">
              {posting ? 'Posting…' : (scheduledFor && new Date(scheduledFor) > new Date()) ? 'Schedule' : 'Post'}
            </button>
          </div>
        </form>
      ) : (
        <div className="bg-gray-50 dark:bg-navy-light rounded-lg border border-dashed border-border dark:border-navy-light px-4 py-3 text-xs text-gray-500 dark:text-gray-400 text-center">
          {perm === 'teacher-only'
            ? 'Read-only stream — only teachers post or comment here.'
            : 'Students can only comment — new posts are teacher-only.'}
        </div>
      )}

      {/* Settings modal */}
      {settingsOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-navy-mid rounded-xl w-full max-w-md p-6 space-y-3">
            <h3 className="text-lg font-bold dark:text-white">Stream posting</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">Control who can post and comment in this class's Stream.</p>
            <div className="space-y-2 pt-2">
              {Object.entries(PERM_LABELS).map(([key, info]) => (
                <button key={key} onClick={() => setMode(key)} disabled={savingMode}
                  className={`w-full text-left px-3 py-2 rounded-lg border transition flex items-start gap-3 ${perm === key ? 'border-ilo-blue bg-ilo-blue/5' : 'border-border dark:border-navy-light hover:border-ilo-blue/50'}`}>
                  <span className="text-lg">{info.icon}</span>
                  <div className="flex-1">
                    <div className="text-sm font-semibold dark:text-white">{info.label}</div>
                  </div>
                  {perm === key && <span className="text-ilo-blue text-sm">✓</span>}
                </button>
              ))}
            </div>
            <div className="flex justify-end pt-2">
              <button onClick={() => setSettingsOpen(false)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400">Close</button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8"><div className="animate-spin w-6 h-6 border-2 border-ilo-blue border-t-transparent rounded-full" /></div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-sm text-gray-500 dark:text-gray-400">
          No posts yet. Start the conversation!
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(it => (
            <AnnouncementCard key={it._id} item={it} isTeacher={isTeacher}
              currentUserId={currentUserId} classId={cls._id}
              canComment={studentCanComment} onChange={load} />
          ))}
        </div>
      )}
    </div>
  );
}
