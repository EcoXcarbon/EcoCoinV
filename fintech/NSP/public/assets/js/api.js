/* Shared API helper for the NSP registry front-end. */
window.NSP = (function () {
  const API = '/api/v1';
  const KEY_STORE = 'nsp.registryKey';
  function key() { try { return sessionStorage.getItem(KEY_STORE) || ''; } catch { return ''; } }
  function setKey(k) { try { k ? sessionStorage.setItem(KEY_STORE, k) : sessionStorage.removeItem(KEY_STORE); } catch {} }
  async function call(path, { method = 'GET', body, auth = false } = {}) {
    const headers = { 'Accept': 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    if (auth) headers['X-Registry-Key'] = key();
    const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) { const e = new Error((data && data.error) || `HTTP ${res.status}`); e.status = res.status; e.details = data && data.details; throw e; }
    return data;
  }
  let refCache = null;
  async function reference() { if (!refCache) refCache = await call('/reference'); return refCache; }
  function fmtDate(iso, opts) {
    if (!iso) return '—';
    const d = new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso);
    return d.toLocaleDateString('en-GB', Object.assign({ day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }, opts || {}));
  }
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function qrSvg(text, { size = 120, level = 'M', margin = 0 } = {}) {
    const qr = window.qrcode(0, level); qr.addData(text); qr.make();
    const n = qr.getModuleCount(); const cell = size / (n + margin * 2);
    let path = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${(c + margin) * cell} ${(r + margin) * cell}h${cell}v${cell}h-${cell}z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
  }
  return { call, key, setKey, reference, fmtDate, esc, qrSvg };
})();
