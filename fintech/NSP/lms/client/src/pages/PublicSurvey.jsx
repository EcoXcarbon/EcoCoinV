import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';

/* Standalone, no-login survey page opened via a direct link:
   /s/:tid/:mid  → fills a training survey flagged { isSurvey, publicSurvey }. */
export default function PublicSurvey() {
  const { tid, mid } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  const [ans, setAns] = useState({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`/lms/api/v1/public-survey/${tid}/${mid}`)
      .then(r => r.json().then(j => (r.ok ? j : Promise.reject(j))))
      .then(setData)
      .catch(e => setErr(e.error || 'This survey is not available.'));
  }, [tid, mid]);

  const setChoice = (i, v) => setAns(p => ({ ...p, [i]: { choice: v } }));
  const toggleMulti = (i, v) => setAns(p => {
    const cur = new Set(p[i]?.choices || []);
    cur.has(v) ? cur.delete(v) : cur.add(v);
    return { ...p, [i]: { choices: [...cur] } };
  });
  const setText = (i, v) => setAns(p => ({ ...p, [i]: { text: v } }));

  const submit = async () => {
    if (!name.trim()) { setErr('Please enter your name.'); return; }
    setBusy(true); setErr('');
    try {
      const answers = (data.questions || []).map((q, i) => ans[i] || {});
      const r = await fetch(`/lms/api/v1/public-survey/${tid}/${mid}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), answers }),
      });
      const j = await r.json();
      if (!r.ok) throw j;
      setDone(true);
    } catch (e) { setErr(e.error || 'Could not submit. Please try again.'); }
    finally { setBusy(false); }
  };

  const reset = () => { setName(''); setAns({}); setDone(false); setErr(''); window.scrollTo(0, 0); };

  const shell = (children) => (
    <div style={{ minHeight: '100vh', background: '#0E2A47', display: 'flex', justifyContent: 'center', padding: '24px 12px' }}>
      <div style={{ width: '100%', maxWidth: 640 }}>
        <div style={{ textAlign: 'center', color: '#fff', marginBottom: 16 }}>
          <div style={{ fontSize: 13, letterSpacing: '.12em', textTransform: 'uppercase', opacity: .8 }}>Field Visit Survey</div>
          <div style={{ fontSize: 15, opacity: .7, marginTop: 2 }}>{data?.trainingTitle || 'NSP Learning'}</div>
        </div>
        <div style={{ background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 12px 40px rgba(0,0,0,.3)' }}>
          {children}
        </div>
        <p style={{ textAlign: 'center', color: '#ffffff88', fontSize: 12, marginTop: 14 }}>NSP Learning</p>
      </div>
    </div>
  );

  if (err && !data) return shell(<p style={{ color: '#b91c1c', fontSize: 15 }}>{err}</p>);
  if (!data) return shell(<p style={{ color: '#666' }}>Loading…</p>);

  if (done) return shell(
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 40 }}>✓</div>
      <h2 style={{ color: '#166534', margin: '8px 0' }}>Thank you, {name.split(' ')[0]}!</h2>
      <p style={{ color: '#444', fontSize: 15 }}>Your field visit feedback has been recorded.</p>
      <button onClick={reset} style={btn('#0E2A47')}>Submit another response</button>
    </div>
  );

  let lastSec = null;
  return shell(
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h2 style={{ color: '#0E2A47', fontSize: 19, margin: 0 }}>{data.title}</h2>
      <div>
        <label style={lbl}>Your name <span style={{ color: '#b91c1c' }}>*</span></label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Full name"
          style={inp} />
      </div>
      {(data.questions || []).map((q, i) => {
        const showSec = q.section && q.section !== lastSec; lastSec = q.section || lastSec;
        return (
          <div key={i}>
            {showSec && <div style={{ fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em', color: '#1A4D2E', marginTop: 8, marginBottom: 2 }}>{q.section}</div>}
            <div style={{ border: '1px solid #e5e2d8', borderRadius: 12, padding: 12 }}>
              <p style={{ fontSize: 15, color: '#333', marginBottom: 8 }}>{q.prompt}</p>
              {q.text ? (
                <input value={ans[i]?.text || ''} onChange={e => setText(i, e.target.value)} style={inp} />
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {q.options.map(o => {
                    const on = q.multi ? (ans[i]?.choices || []).includes(o) : ans[i]?.choice === o;
                    return (
                      <button key={o} type="button" onClick={() => q.multi ? toggleMulti(i, o) : setChoice(i, o)}
                        style={{ ...pill, background: on ? '#0E2A47' : '#fff', color: on ? '#fff' : '#555', borderColor: on ? '#0E2A47' : '#d8d3c4' }}>{o}</button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })}
      {err && <p style={{ color: '#b91c1c', fontSize: 14 }}>{err}</p>}
      <button onClick={submit} disabled={busy} style={{ ...btn('#0E2A47'), opacity: busy ? .6 : 1 }}>
        {busy ? 'Submitting…' : 'Submit feedback'}
      </button>
    </div>
  );
}

const lbl = { display: 'block', fontSize: 13, fontWeight: 600, color: '#444', marginBottom: 4 };
const inp = { width: '100%', padding: '10px 12px', fontSize: 15, borderRadius: 10, border: '1px solid #d8d3c4', outline: 'none' };
const pill = { padding: '8px 14px', fontSize: 14, fontWeight: 600, borderRadius: 10, border: '1px solid', cursor: 'pointer' };
const btn = (bg) => ({ marginTop: 8, padding: '12px 20px', fontSize: 15, fontWeight: 700, color: '#fff', background: bg, border: 0, borderRadius: 12, cursor: 'pointer', width: '100%' });
