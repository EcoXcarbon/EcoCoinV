/* Registry desk */
(function () {
  const $ = s => document.querySelector(s);
  const login = $('#login'), desk = $('#desk'), drawer = $('#drawer'), detail = $('#detail');
  let ref = null;

  async function boot() {
    if (!NSP.key()) return;
    try { await NSP.call('/me', { auth: true }); } catch { NSP.setKey(''); return; }
    login.hidden = true; desk.hidden = false; $('#logout').hidden = false;
    ref = await NSP.reference();
    await Promise.all([loadStats(), loadList()]);
  }
  $('#lf').addEventListener('submit', async e => {
    e.preventDefault(); NSP.setKey($('#key').value.trim());
    try { await NSP.call('/me', { auth: true }); $('#loginErr').hidden = true; boot(); }
    catch (err) { NSP.setKey(''); $('#loginErr').hidden = false; $('#loginErr').textContent = err.message; }
  });
  $('#logout').addEventListener('click', e => { e.preventDefault(); NSP.setKey(''); location.reload(); });

  async function loadStats() {
    const s = await NSP.call('/stats', { auth: true });
    const order = ['SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'ISSUED', 'SUSPENDED', 'EXPIRED', 'REVOKED', 'REJECTED'];
    $('#stats').innerHTML = `<div class="card stat"><div class="n">${s.total}</div><div class="l">Total</div></div>` +
      order.map(k => `<div class="card stat"><div class="n">${s.byStatus[k] || 0}</div><div class="l">${k.replace('_', ' ')}</div></div>`).join('') +
      `<div class="card stat"><div class="n">${s.verifications}</div><div class="l">Verifications</div></div>`;
  }
  async function loadList() {
    const p = new URLSearchParams({ q: $('#q').value.trim(), status: $('#status').value, type: $('#type').value, limit: 100 });
    const r = await NSP.call('/registrations?' + p, { auth: true });
    $('#count').textContent = `${r.items.length} of ${r.total}`;
    $('#list tbody').innerHTML = r.items.map(i => `<tr>
      <td class="mono small">${i.nspId}</td><td><b>${NSP.esc(i.familyName)}</b>, ${NSP.esc(i.givenNames)}</td><td class="small">${i.type}</td>
      <td class="small">${NSP.esc(i.primarySkill || '')} <span class="muted">${i.primaryIsco || ''}</span></td><td>${i.nationality}</td>
      <td><span class="pill ${i.status}">${i.status.replace('_', ' ')}</span></td><td class="small">${NSP.fmtDate(i.createdAt)}</td>
      <td><button class="btn btn-sm btn-secondary" data-open="${i.nspId}">Open</button></td></tr>`).join('') || '<tr><td colspan="8" class="muted">No records</td></tr>';
    $('#list').querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => openRecord(b.dataset.open)));
  }
  ['#q', '#status', '#type'].forEach(s => $(s).addEventListener('change', loadList));
  $('#q').addEventListener('keyup', e => { if (e.key === 'Enter') loadList(); });
  $('#refresh').addEventListener('click', () => { loadStats(); loadList(); });
  $('#closeDrawer').addEventListener('click', () => drawer.classList.remove('open'));

  const ACTIONS = { SUBMITTED: ['REVIEW', 'VERIFY', 'REJECT'], UNDER_REVIEW: ['VERIFY', 'REJECT'], VERIFIED: ['ISSUE_CARD', 'ISSUE_CERT', 'REVOKE'], ISSUED: ['ISSUE_CARD', 'ISSUE_CERT', 'SUSPEND', 'REVOKE'], SUSPENDED: ['REINSTATE', 'REVOKE'], EXPIRED: ['ISSUE_CARD', 'REVOKE'], REVOKED: [], REJECTED: [] };
  const LABEL = { REVIEW: 'Start review', VERIFY: '✔ Verify', REJECT: 'Reject', ISSUE_CARD: '🪪 Issue / reprint card', ISSUE_CERT: '📜 Issue certificate', SUSPEND: 'Suspend', REINSTATE: 'Reinstate', REVOKE: 'Revoke' };
  const NEEDS_REASON = ['REJECT', 'SUSPEND', 'REVOKE'];

  async function openRecord(id) {
    drawer.classList.add('open'); detail.innerHTML = '<p class="muted">Loading…</p>';
    let r; try { r = await NSP.call(`/registrations/${id}`, { auth: true }); } catch (e) { detail.innerHTML = `<div class="notice err">${NSP.esc(e.message)}</div>`; return; }
    const country = c => (ref.countries.find(x => x.alpha2 === c) || {}).name || c || '—';
    const isced = ref.iscedLevels.levels.find(l => l.code === r.education.highestLevel);
    const card = r.credentials.find(c => c.kind === 'CARD' && c.status === 'ACTIVE'), cert = r.credentials.find(c => c.kind === 'CERTIFICATE' && c.status === 'ACTIVE');
    detail.innerHTML = `
      <div class="photo-sm" style="${r.identity.photo ? `background-image:url(${r.identity.photo})` : ''}"></div>
      <h2 style="margin:0">${NSP.esc(r.identity.givenNames)} ${NSP.esc(r.identity.familyName)}</h2>
      ${r.identity.nameNative ? `<div class="muted">${NSP.esc(r.identity.nameNative)}</div>` : ''}
      <div class="mono">${r.nspId}</div>
      <p><span class="pill ${r.status}">${r.status.replace('_', ' ')}</span> <span class="pill">${r.type}</span> <span class="small muted">via ${r.channel}</span></p>
      <div class="actions-bar" id="actions">${(ACTIONS[r.status] || []).map(a => `<button class="btn btn-sm ${a === 'REVOKE' || a === 'REJECT' ? 'btn-danger' : a.startsWith('ISSUE') || a === 'VERIFY' ? 'btn-primary' : 'btn-secondary'}" data-act="${a}">${LABEL[a]}</button>`).join('')}
        ${['VERIFIED', 'ISSUED'].includes(r.status) ? `<a class="btn btn-sm btn-secondary" href="/api/v1/registrations/${r.nspId}/credential.json?key=${encodeURIComponent(NSP.key())}" target="_blank">VC JSON</a>` : ''}</div>
      <div id="actMsg"></div>
      ${card || cert ? `<fieldset><legend>Active credentials</legend>${card ? `<div>🪪 Card <span class="mono">${card.serial}</span> · issued ${NSP.fmtDate(card.issuedAt)} · expires ${NSP.fmtDate(card.expiresAt)} — <a href="/card/${card.serial}" target="_blank">open print view</a></div>` : ''}${cert ? `<div>📜 Certificate <span class="mono">${cert.serial}</span> · issued ${NSP.fmtDate(cert.issuedAt)} — <a href="/certificate/${cert.serial}" target="_blank">open print view</a></div>` : ''}</fieldset>` : ''}
      <fieldset><legend>Identity</legend><dl class="kv">
        <dt>Date of birth</dt><dd>${NSP.fmtDate(r.identity.dateOfBirth)} · ${r.identity.sex}</dd>
        <dt>Nationality</dt><dd>${country(r.identity.nationality)}${r.identity.countryOfBirth ? ` · born ${country(r.identity.countryOfBirth)}` : ''}</dd>
        <dt>ID document</dt><dd>${r.identity.idDocumentType} <span class="mono">${NSP.esc(r.identity.idDocumentNumber)}</span>${r.identity.idDocumentExpiry ? ' · exp ' + NSP.fmtDate(r.identity.idDocumentExpiry) : ''}</dd>
        ${r.identity.passportNumber ? `<dt>Passport</dt><dd><span class="mono">${NSP.esc(r.identity.passportNumber)}</span> · exp ${NSP.fmtDate(r.identity.passportExpiry)}</dd>` : ''}
        ${r.identity.fatherOrGuardianName ? `<dt>Father / guardian</dt><dd>${NSP.esc(r.identity.fatherOrGuardianName)}</dd>` : ''}</dl></fieldset>
      <fieldset><legend>Contact</legend><dl class="kv">
        <dt>Email / phone</dt><dd>${NSP.esc(r.contact.email)} · ${NSP.esc(r.contact.phone)}${r.contact.altPhone ? ' / ' + NSP.esc(r.contact.altPhone) : ''}</dd>
        <dt>Address</dt><dd>${[r.contact.address.line1, r.contact.address.line2, r.contact.address.city, r.contact.address.region, r.contact.address.postalCode, country(r.contact.address.country)].filter(Boolean).map(NSP.esc).join(', ')}</dd>
        ${r.contact.emergencyContact.name ? `<dt>Emergency</dt><dd>${NSP.esc(r.contact.emergencyContact.name)} (${NSP.esc(r.contact.emergencyContact.relationship)}) ${NSP.esc(r.contact.emergencyContact.phone)}</dd>` : ''}</dl></fieldset>
      <fieldset><legend>Education</legend><dl class="kv">
        <dt>Highest level</dt><dd>ISCED ${r.education.highestLevel} — ${isced ? NSP.esc(isced.title) : ''}</dd>
        ${r.education.qualificationTitle ? `<dt>Qualification</dt><dd>${NSP.esc(r.education.qualificationTitle)} · ${NSP.esc(r.education.institution)} ${r.education.yearCompleted || ''}</dd>` : ''}
        ${r.education.currentInstitution ? `<dt>Enrolled</dt><dd>${NSP.esc(r.education.currentProgramme)} · ${NSP.esc(r.education.currentInstitution)} · roll ${NSP.esc(r.education.enrollmentNumber)}${r.education.expectedCompletion ? ' · completes ' + NSP.fmtDate(r.education.expectedCompletion) : ''}</dd>` : ''}</dl></fieldset>
      <fieldset><legend>Skills</legend><table class="table"><thead><tr><th>ISCO</th><th>Skill</th><th>Level</th><th>Evidence</th></tr></thead><tbody>
        ${r.skills.map(s => `<tr><td class="mono">${s.iscoCode}</td><td>${s.primary ? '★ ' : ''}${NSP.esc(s.title)}<div class="small muted">${NSP.esc(s.sector || '')}</div></td><td>${s.nvqfLevel ? 'NVQF ' + s.nvqfLevel : '—'}</td><td class="small">${s.evidenceType}<br>${NSP.esc(s.certifyingBody || '')} ${NSP.esc(s.certificateNumber || '')}${s.issuedOn ? '<br>' + NSP.fmtDate(s.issuedOn) : ''}</td></tr>`).join('')}</tbody></table>
        ${r.languages.length ? `<p class="small" style="margin-top:8px"><b>Languages:</b> ${r.languages.map(l => l.code.toUpperCase() + ' ' + l.level).join(', ')}</p>` : ''}</fieldset>
      ${r.experience.length ? `<fieldset><legend>Experience</legend>${r.experience.map(x => `<div class="small">${NSP.esc(x.role)} — <b>${NSP.esc(x.employer)}</b> (${country(x.country)}) ${NSP.fmtDate(x.from)} → ${x.current ? 'present' : NSP.fmtDate(x.to)}${x.referenceContact ? ' · ref: ' + NSP.esc(x.referenceContact) : ''}</div>`).join('')}</fieldset>` : ''}
      ${r.documents.length ? `<fieldset><legend>Documents</legend>${r.documents.map(d => `<div class="small">${d.type} · ${NSP.esc(d.fileName)} · ${(d.size / 1024).toFixed(0)} KB · <span class="mono">${d.sha256.slice(0, 12)}…</span></div>`).join('')}</fieldset>` : ''}
      <fieldset><legend>Consent</legend><div class="small">Processing: ${r.consent.dataProcessing ? '✔' : '✖'} · Employer verification: ${r.consent.employerVerification ? '✔' : '✖'} · Cross-border: ${r.consent.crossBorderSharing ? '✔' : '✖'} · Declaration: ${r.consent.declarationTruthful ? '✔' : '✖'} · terms v${r.consent.termsVersion} · ${new Date(r.consent.consentedAt).toLocaleString()}</div></fieldset>
      <fieldset><legend>Registry</legend><dl class="kv"><dt>Submitted</dt><dd>${NSP.fmtDate(r.registry.submittedAt)}</dd><dt>Verified</dt><dd>${NSP.fmtDate(r.registry.verifiedAt)} ${r.registry.verifiedBy ? 'by ' + NSP.esc(r.registry.verifiedBy) : ''}</dd><dt>Issued</dt><dd>${NSP.fmtDate(r.registry.issuedAt)} → ${NSP.fmtDate(r.registry.expiresAt)}</dd>${r.registry.revokeReason ? `<dt>Revoked</dt><dd>${NSP.esc(r.registry.revokeReason)}</dd>` : ''}${r.registry.rejectedReason ? `<dt>Rejected</dt><dd>${NSP.esc(r.registry.rejectedReason)}</dd>` : ''}</dl>
        <ul class="audit">${r.audit.map(a => `<li>${new Date(a.at).toLocaleString()} — <b>${a.action}</b> by ${NSP.esc(a.actor)}${a.detail ? ' · ' + NSP.esc(JSON.stringify(a.detail)) : ''}</li>`).join('')}</ul></fieldset>`;
    detail.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => act(r.nspId, b.dataset.act)));
  }

  async function act(id, a) {
    const msg = $('#actMsg');
    let reason;
    if (NEEDS_REASON.includes(a)) { reason = prompt(`Reason for ${a}:`); if (!reason) return; }
    try {
      if (a === 'ISSUE_CARD') { const c = await NSP.call(`/registrations/${id}/credentials/card`, { method: 'POST', auth: true }); window.open(`/card/${c.serial}`, '_blank'); }
      else if (a === 'ISSUE_CERT') { const c = await NSP.call(`/registrations/${id}/credentials/certificate`, { method: 'POST', auth: true }); window.open(`/certificate/${c.serial}`, '_blank'); }
      else await NSP.call(`/registrations/${id}/transition`, { method: 'POST', auth: true, body: { action: a, reason } });
      msg.innerHTML = `<div class="notice">${a} done.</div>`;
      await Promise.all([openRecord(id), loadList(), loadStats()]);
    } catch (e) { msg.innerHTML = `<div class="notice err">${NSP.esc(e.message)}${e.details ? '<br><small>' + NSP.esc(JSON.stringify(e.details)) + '</small>' : ''}</div>`; }
  }
  boot();
})();
