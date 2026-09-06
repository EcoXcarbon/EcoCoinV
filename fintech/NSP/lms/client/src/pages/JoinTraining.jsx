import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/client';

/* Public entry gate: a member enters their details, gets enrolled and is
   routed straight into the Training tab. */
export default function JoinTraining() {
  const { id } = useParams();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [contact, setContact] = useState('');
  const [institute, setInstitute] = useState('');
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { document.title = 'Join the training · NSP Learning'; }, []);
  useEffect(() => {
    let live = true;
    api.get(`/training/public/${id}`).then(({ data }) => { if (live) setInfo(data); }).catch(() => {});
    return () => { live = false; };
  }, [id]);

  const fmt = (d) => d ? new Date(d).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
  const dateLine = info?.startDate
    ? (info.endDate ? `${fmt(info.startDate)} – ${fmt(info.endDate)}` : fmt(info.startDate))
    : '';

  const join = async (e) => {
    e.preventDefault();
    setErr('');
    if (!name.trim()) return setErr('Please enter your name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setErr('Please enter a valid email (Gmail).');
    if (!contact.trim()) return setErr('Please enter a contact number.');
    if (!institute.trim()) return setErr('Please enter your institute or organisation.');
    setBusy(true);
    try {
      const { data } = await api.post(`/training/${id}/join`, {
        name: name.trim(), email: email.trim(), contact: contact.trim(), institute: institute.trim(),
      });
      const next = new URLSearchParams(window.location.search).get('next') || '/lms?tab=training';
      // Existing real account: enrolled, but must log in (no session handed out).
      if (data.requiresLogin || !data.accessToken) {
        window.location.href = `/login?next=${encodeURIComponent(next)}`;
        return;
      }
      localStorage.setItem('tl-token', data.accessToken);
      window.location.href = next;
    } catch (e2) {
      setErr(e2.response?.data?.error || 'Could not join right now. Please try again.');
      setBusy(false);
    }
  };

  const field = "mt-1 w-full px-3 py-2.5 text-sm rounded-xl border border-border dark:border-navy-light bg-white dark:bg-navy dark:text-white";
  const label = "text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase";

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#002D72] to-[#0a1628] p-4">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-navy-mid shadow-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-[#002D72] to-[#0a4bb3] px-6 py-5 text-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-white/15 grid place-items-center font-black text-xs">NSP</div>
            <div>
              <p className="text-[11px] tracking-[0.2em] text-[#f0c667] font-bold">TALENTLEDGER · PPMC KP</p>
              <h1 className="text-lg font-bold">Join the Training</h1>
            </div>
          </div>
        </div>
        <form onSubmit={join} className="p-6 space-y-4">
          <div className="rounded-xl bg-[#eef4ff] dark:bg-navy px-4 py-3">
            <p className="text-sm text-gray-700 dark:text-gray-200">
              You are joining <b>{info?.title || 'this training programme'}</b>.
            </p>
            {(dateLine || info?.duration) && (
              <p className="mt-1 text-[12px] text-gray-500 dark:text-gray-400">
                {dateLine}{dateLine && info?.duration ? ' · ' : ''}{info?.duration || ''}
                {typeof info?.seatsLeft === 'number' ? ` · ${info.seatsLeft} seats left` : ''}
              </p>
            )}
          </div>
          <div>
            <label className={label}>Full name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Ayesha Khan" autoFocus className={field} />
          </div>
          <div>
            <label className={label}>Email (Gmail)</label>
            <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="your.name@gmail.com" className={field} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Contact no.</label>
              <input value={contact} onChange={e => setContact(e.target.value)} placeholder="03xx xxxxxxx" className={field} />
            </div>
            <div>
              <label className={label}>Institute</label>
              <input value={institute} onChange={e => setInstitute(e.target.value)} placeholder="Organisation / district" className={field} />
            </div>
          </div>
          {err && <p className="text-sm text-red-500">{err}</p>}
          <button type="submit" disabled={busy}
            className="w-full px-6 py-3 text-sm font-bold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark transition-colors disabled:opacity-50">
            {busy ? 'Joining…' : 'Join the training →'}
          </button>
          <p className="text-[11px] text-gray-400 text-center">No account needed — your details enrol you and take you straight to your training dashboard.</p>
        </form>
      </div>
    </div>
  );
}
