import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api/client';

function SettingsModal({ open, cls, onClose, onSaved }) {
  const [mode, setMode] = useState(cls.videoMode || 'none');
  const [url, setUrl] = useState(cls.meetingUrl || '');
  const [saving, setSaving] = useState(false);
  if (!open) return null;

  const save = async (e) => {
    e.preventDefault();
    if (mode === 'link' && !url.trim()) {
      return toast.error('Meeting URL is required for Link mode');
    }
    setSaving(true);
    try {
      const payload = { videoMode: mode };
      if (mode === 'link') payload.meetingUrl = url.trim();
      if (mode === 'none' || mode === 'jitsi') payload.meetingUrl = '';
      await api.put(`/classroom/${cls._id}`, payload);
      toast.success('Saved');
      onSaved();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <form onSubmit={save} className="bg-white dark:bg-navy-mid rounded-xl w-full max-w-lg p-6 space-y-4">
        <h2 className="text-lg font-bold dark:text-white">Class meeting</h2>

        <div className="space-y-2">
          <label className={`block border rounded-lg p-3 cursor-pointer ${mode === 'none' ? 'border-ilo-blue bg-ilo-blue/5' : 'border-border dark:border-navy-light'}`}>
            <div className="flex items-center gap-2">
              <input type="radio" checked={mode === 'none'} onChange={() => setMode('none')} />
              <span className="font-semibold text-sm dark:text-white">No meeting</span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 ml-6">Disable the persistent meeting (scheduled sessions still work).</p>
          </label>

          <label className={`block border rounded-lg p-3 cursor-pointer ${mode === 'link' ? 'border-ilo-blue bg-ilo-blue/5' : 'border-border dark:border-navy-light'}`}>
            <div className="flex items-center gap-2">
              <input type="radio" checked={mode === 'link'} onChange={() => setMode('link')} />
              <span className="font-semibold text-sm dark:text-white">External link</span>
              <span className="text-xs text-gray-500">(Zoom, Google Meet, Teams…)</span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 ml-6 mb-2">Paste your meeting link. Students click "Join" to open it in a new tab.</p>
            {mode === 'link' && (
              <input value={url} onChange={e => setUrl(e.target.value)}
                placeholder="https://us02web.zoom.us/j/123…"
                className="w-full ml-6 px-3 py-2 border rounded-lg text-sm dark:bg-navy-light dark:border-navy-light dark:text-white"
                style={{ width: 'calc(100% - 1.5rem)' }} />
            )}
          </label>

          <label className={`block border rounded-lg p-3 cursor-pointer ${mode === 'jitsi' ? 'border-ilo-blue bg-ilo-blue/5' : 'border-border dark:border-navy-light'}`}>
            <div className="flex items-center gap-2">
              <input type="radio" checked={mode === 'jitsi'} onChange={() => setMode('jitsi')} />
              <span className="font-semibold text-sm dark:text-white">Embedded Jitsi</span>
              <span className="text-xs text-emerald-600">Free · No accounts</span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 ml-6">Video meeting opens inside the Meet tab. A private random room name is generated for this class.</p>
          </label>
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400">Cancel</button>
          <button type="submit" disabled={saving}
            className="px-4 py-2 text-sm bg-ilo-blue text-white rounded-lg disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ───────────────── Schedule live session modal ───────────────── */
function ScheduleModal({ open, classId, onClose, onSaved }) {
  const [form, setForm] = useState({ title: '', description: '', scheduledFor: '', durationMins: 60, mode: 'jitsi', meetingUrl: '' });
  const [saving, setSaving] = useState(false);
  if (!open) return null;

  const save = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return toast.error('Title required');
    if (!form.scheduledFor) return toast.error('Pick a date/time');
    if (form.mode === 'link' && !form.meetingUrl.trim()) return toast.error('Meeting URL required for link mode');
    setSaving(true);
    try {
      const body = {
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        scheduledFor: new Date(form.scheduledFor).toISOString(),
        durationMins: Number(form.durationMins),
        mode: form.mode,
      };
      if (form.mode === 'link') body.meetingUrl = form.meetingUrl.trim();
      await api.post(`/classroom/${classId}/live`, body);
      toast.success('Session scheduled');
      onSaved();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setSaving(false); }
  };

  const inputCls = 'w-full px-3 py-2 border rounded-lg text-sm dark:bg-navy-light dark:border-navy-light dark:text-white';
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <form onSubmit={save} className="bg-white dark:bg-navy-mid rounded-xl w-full max-w-lg p-6 space-y-3 my-8">
        <h2 className="text-lg font-bold dark:text-white">Schedule live session</h2>
        <input required placeholder="Title (e.g. Live: Bricklaying demo)" value={form.title}
          onChange={e => setForm({ ...form, title: e.target.value })} className={inputCls} />
        <textarea rows={3} placeholder="Description (optional)" value={form.description}
          onChange={e => setForm({ ...form, description: e.target.value })} className={`${inputCls} resize-none`} />
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-gray-600 dark:text-gray-400">
            Date & time
            <input type="datetime-local" required value={form.scheduledFor}
              onChange={e => setForm({ ...form, scheduledFor: e.target.value })} className={`${inputCls} mt-1`} />
          </label>
          <label className="text-xs text-gray-600 dark:text-gray-400">
            Duration (min)
            <input type="number" min={5} max={600} value={form.durationMins}
              onChange={e => setForm({ ...form, durationMins: e.target.value })} className={`${inputCls} mt-1`} />
          </label>
        </div>
        <select value={form.mode} onChange={e => setForm({ ...form, mode: e.target.value })} className={inputCls}>
          <option value="jitsi">Embedded Jitsi (free, private room)</option>
          <option value="link">External link (Zoom/Meet/Teams)</option>
        </select>
        {form.mode === 'link' && (
          <input placeholder="https://us02web.zoom.us/j/123…" value={form.meetingUrl}
            onChange={e => setForm({ ...form, meetingUrl: e.target.value })} className={inputCls} />
        )}
        <div className="flex gap-2 justify-end pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400">Cancel</button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm bg-ilo-blue text-white rounded-lg disabled:opacity-50">
            {saving ? 'Scheduling…' : 'Schedule'}
          </button>
        </div>
      </form>
    </div>
  );
}

const STATUS_BADGE = {
  scheduled: ['Scheduled', 'text-ilo-blue bg-ilo-blue/10'],
  live: ['● LIVE', 'text-white bg-red-600 animate-pulse'],
  ended: ['Ended', 'text-gray-600 bg-gray-100 dark:bg-navy-light'],
  cancelled: ['Cancelled', 'text-gray-500 bg-gray-100 dark:bg-navy-light'],
};

// Build the URL to open/embed a Jitsi room.
//  - JaaS configured  → 8x8.vc/<appId>/<room>?jwt=<token>  (teacher joins as moderator)
//  - fallback          → public meet.jit.si (anonymous; cannot start a meeting)
// Uses the current Jitsi option names (prejoinConfig.enabled, not the deprecated
// prejoinPageEnabled) so the prejoin screen is actually skipped.
function buildJitsiUrl(payload, room, name) {
  const cfg = '#config.prejoinConfig.enabled=false&config.disableDeepLinking=true';
  if (payload?.configured) {
    return `https://${payload.domain}/${payload.appId}/${encodeURIComponent(payload.room)}` +
      `?jwt=${payload.token}${cfg}`;
  }
  return `https://meet.jit.si/${encodeURIComponent(room)}` +
    `${cfg}&userInfo.displayName=${encodeURIComponent('"' + (name || 'Guest') + '"')}`;
}

function LiveSessions({ classId, isTeacher, currentUserName }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try { const { data } = await api.get(`/classroom/${classId}/live`); setSessions(data); }
    catch { toast.error('Failed to load sessions'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [classId]);

  // Fetch a fresh join token (moderator JWT for teachers) then open the room.
  const openRoom = async (s) => {
    try {
      if (s.mode === 'link') { window.open(s.meetingUrl, '_blank', 'noreferrer'); return; }
      const { data } = await api.get(`/classroom/${classId}/live/${s._id}/token`);
      window.open(buildJitsiUrl(data, s.jitsiRoom, currentUserName), '_blank', 'noreferrer');
    } catch (err) { toast.error(err.response?.data?.error || 'Could not open meeting'); }
  };
  const start = async (s) => {
    try { await api.post(`/classroom/${classId}/live/${s._id}/start`); await openRoom(s); load(); }
    catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  };
  const end = async (s) => {
    const recordingUrl = window.prompt('Recording link (optional) — paste a URL or leave blank:', '') || '';
    try { await api.post(`/classroom/${classId}/live/${s._id}/end`, recordingUrl.trim() ? { recordingUrl: recordingUrl.trim() } : {}); load(); }
    catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  };
  const remove = async (s) => {
    if (!window.confirm(`Delete session "${s.title}"?`)) return;
    try { await api.delete(`/classroom/${classId}/live/${s._id}`); load(); }
    catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  };

  return (
    <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold dark:text-white">📅 Live sessions</h2>
        {isTeacher && (
          <button onClick={() => setScheduleOpen(true)} className="px-3 py-1.5 text-sm font-semibold bg-ilo-blue text-white rounded-lg">+ Schedule</button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-6"><div className="animate-spin w-5 h-5 border-2 border-ilo-blue border-t-transparent rounded-full" /></div>
      ) : sessions.length === 0 ? (
        <p className="text-xs text-gray-500 dark:text-gray-400 py-2">No live sessions scheduled yet.</p>
      ) : (
        <ul className="space-y-2">
          {sessions.map(s => {
            const [label, badge] = STATUS_BADGE[s.status] || STATUS_BADGE.scheduled;
            const canJoin = s.status === 'live' || s.status === 'scheduled';
            return (
              <li key={s._id} className="border border-border dark:border-navy-light rounded-lg p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${badge}`}>{label}</span>
                    <span className="font-semibold text-sm dark:text-white truncate">{s.title}</span>
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {new Date(s.scheduledFor).toLocaleString()} • {s.durationMins} min • {s.mode === 'jitsi' ? 'Jitsi' : 'External'}
                  </div>
                  {s.recordingUrl && (
                    <a href={s.recordingUrl} target="_blank" rel="noreferrer" className="text-xs text-ilo-blue hover:underline">▶ Recording</a>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {canJoin && (
                    <button onClick={() => openRoom(s)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${s.status === 'live' ? 'bg-red-600 text-white' : 'border border-ilo-blue text-ilo-blue'}`}>
                      Join
                    </button>
                  )}
                  {isTeacher && s.status === 'scheduled' && (
                    <button onClick={() => start(s)} className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 text-white rounded-lg">Go live</button>
                  )}
                  {isTeacher && s.status === 'live' && (
                    <button onClick={() => end(s)} className="px-3 py-1.5 text-xs font-semibold bg-gray-700 text-white rounded-lg">End</button>
                  )}
                  {isTeacher && (
                    <button onClick={() => remove(s)} className="px-2 text-red-500" title="Delete">🗑</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ScheduleModal open={scheduleOpen} classId={classId}
        onClose={() => setScheduleOpen(false)} onSaved={() => { setScheduleOpen(false); load(); }} />
    </div>
  );
}

function LinkView({ cls, isTeacher, onOpenSettings }) {
  return (
    <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-8 text-center space-y-4">
      <div className="text-5xl">🎥</div>
      <h2 className="text-lg font-bold dark:text-white">Class meeting</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 break-all">{cls.meetingUrl}</p>
      <div className="flex gap-2 justify-center pt-2">
        <a href={cls.meetingUrl} target="_blank" rel="noreferrer"
          className="px-6 py-2 text-sm font-semibold bg-ilo-blue text-white rounded-lg hover:bg-ilo-blue/90">
          Join meeting
        </a>
        {isTeacher && (
          <button onClick={onOpenSettings}
            className="px-4 py-2 text-sm border border-ilo-blue text-ilo-blue rounded-lg">
            Change
          </button>
        )}
      </div>
    </div>
  );
}

function JitsiView({ cls, currentUserName }) {
  const room = cls.jitsiRoom;
  const [url, setUrl] = useState(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get(`/classroom/${cls._id}/meet/token`)
      .then(({ data }) => {
        if (!alive) return;
        setUrl(buildJitsiUrl(data, room, currentUserName));
        setFallback(!data.configured);
      })
      .catch(() => {
        if (!alive) return;
        setUrl(buildJitsiUrl({ configured: false }, room, currentUserName));
        setFallback(true);
      });
    return () => { alive = false; };
  }, [cls._id, room, currentUserName]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-500 dark:text-gray-400">
          🔒 Private room: <code className="text-gray-700 dark:text-gray-200">{room}</code>
        </span>
        {url && (
          <a href={url} target="_blank" rel="noreferrer"
            className="text-ilo-blue hover:underline">Open in new tab ↗</a>
        )}
      </div>
      {fallback && (
        <div className="text-xs bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 rounded-lg p-2">
          ⚠ Using public meet.jit.si — anonymous users cannot start the meeting. Configure JaaS (JAAS_APP_ID) so teachers join as moderator.
        </div>
      )}
      <div className="bg-black rounded-xl overflow-hidden border border-border dark:border-navy-light"
        style={{ height: 'min(70vh, 640px)' }}>
        {url ? (
          <iframe
            title="Class Jitsi Meeting"
            src={url}
            allow="camera; microphone; fullscreen; display-capture; autoplay; clipboard-write"
            allowFullScreen
            style={{ width: '100%', height: '100%', border: 0 }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="animate-spin w-6 h-6 border-2 border-white/40 border-t-white rounded-full" />
          </div>
        )}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        The teacher joins as moderator and the meeting starts automatically. Click "Open in new tab" if your browser blocks the embedded video.
      </p>
    </div>
  );
}

function PersistentMeeting({ cls, isTeacher, currentUserName, onOpenSettings }) {
  const mode = cls.videoMode || 'none';
  if (mode === 'none') {
    return isTeacher ? (
      <div className="text-center py-8 bg-white dark:bg-navy-mid rounded-xl border border-dashed border-border dark:border-navy-light">
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">No always-on class meeting. Add a Zoom/Meet link or a private Jitsi room.</p>
        <button onClick={onOpenSettings} className="px-4 py-2 text-sm font-semibold bg-ilo-blue text-white rounded-lg">Set up class meeting</button>
      </div>
    ) : null;
  }
  return (
    <div className="space-y-2">
      {isTeacher && (
        <div className="flex justify-end">
          <button onClick={onOpenSettings} className="text-xs text-ilo-blue hover:underline">Meeting settings</button>
        </div>
      )}
      {mode === 'link' && <LinkView cls={cls} isTeacher={isTeacher} onOpenSettings={onOpenSettings} />}
      {mode === 'jitsi' && <JitsiView cls={cls} currentUserName={currentUserName} />}
    </div>
  );
}

export default function MeetTab({ cls, isTeacher, onClassUpdate, currentUserName }) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="space-y-4">
      <LiveSessions classId={cls._id} isTeacher={isTeacher} currentUserName={currentUserName} />

      <div>
        <h2 className="text-sm font-bold dark:text-white mb-2">🎥 Always-on class meeting</h2>
        <PersistentMeeting cls={cls} isTeacher={isTeacher} currentUserName={currentUserName}
          onOpenSettings={() => setSettingsOpen(true)} />
      </div>

      <SettingsModal open={settingsOpen} cls={cls}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => { setSettingsOpen(false); onClassUpdate && onClassUpdate(); }} />
    </div>
  );
}
