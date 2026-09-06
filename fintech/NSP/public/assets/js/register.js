/* Registration wizard */
(async function () {
  const form = document.getElementById('regForm');
  const panels = [...document.querySelectorAll('.step-panel')];
  const steps = [...document.querySelectorAll('#stepper .step')];
  const prevBtn = document.getElementById('prevBtn'), nextBtn = document.getElementById('nextBtn'), submitBtn = document.getElementById('submitBtn');
  const formError = document.getElementById('formError');
  const ref = await NSP.reference();
  const state = { photo: '', skills: [], languages: [], experience: [], documents: [] };
  let step = 1;

  // ── reference pick-lists ─────────────────────────────────────────
  const sources = {
    countries: () => ref.countries.map(c => [c.alpha2, `${c.name} (${c.alpha3})`]),
    identityDocumentTypes: () => ref.identityDocumentTypes.map(t => [t.code, t.title]),
    iscedLevels: () => ref.iscedLevels.levels.map(l => [l.code, `${l.code} — ${l.title}`]),
    iscedFields: () => ref.iscedFields.fields.map(f => [f.code, `${f.code} — ${f.title}`]),
    sectors: () => ref.sectors.map(s => [s.code, s.title]),
    evidenceTypes: () => ref.evidenceTypes.map(e => [e.code, e.title]),
    languages: () => ref.languages.map(l => [l.code, l.name]),
    cefr: () => ref.cefr.map(c => [c.code, c.title]),
    nvqf: () => ref.qualificationLevels.levels.map(l => [l.nvqf, `NVQF ${l.nvqf} / EQF ${l.eqf} — ${l.title.split('— ')[1]}`]),
    documentTypes: () => ref.documentTypes.map(d => [d.code, d.title])
  };
  function fillSelect(sel, name, { optional = false, value = '' } = {}) {
    const opts = sources[name]();
    sel.innerHTML = (optional ? '<option value="">— none —</option>' : '<option value="">Select…</option>') + opts.map(([v, t]) => `<option value="${NSP.esc(v)}">${NSP.esc(t)}</option>`).join('');
    if (value) sel.value = value;
  }
  document.querySelectorAll('select[data-ref]').forEach(sel => fillSelect(sel, sel.dataset.ref, { optional: sel.hasAttribute('data-optional') }));
  form.elements['identity.nationality'].value = 'PK';
  form.elements['contact.address.country'].value = 'PK';

  // registrant type radio cards
  const typeBox = document.getElementById('typeChoices');
  typeBox.innerHTML = ref.registrantTypes.map((t, i) => `<label class="card" style="cursor:pointer;padding:14px;box-shadow:none"><input type="radio" name="type" value="${t.code}" ${i === 2 ? 'checked' : ''}> <b>${NSP.esc(t.title.split(' — ')[0])}</b><div class="hint">${NSP.esc(t.title.split(' — ')[1] || '')}</div></label>`).join('');
  function syncType() {
    const t = form.elements['type'].value;
    const isStudent = ['STUDENT', 'APPRENTICE'].includes(t);
    document.getElementById('enrollmentBlock').style.display = isStudent ? '' : 'none';
    ['education.currentInstitution', 'education.currentProgramme', 'education.enrollmentNumber'].forEach(n => form.elements[n].required = isStudent);
  }
  typeBox.addEventListener('change', syncType); syncType();

  // ID document hint
  const idType = form.elements['identity.idDocumentType'];
  function syncIdHint() { const t = ref.identityDocumentTypes.find(x => x.code === idType.value); document.getElementById('idHint').textContent = t ? `Format: ${t.pattern.replace(/[\^$]/g, '').replace(/\\d\{(\d+)\}/g, (m, n) => '#'.repeat(n))}` : ''; }
  idType.addEventListener('change', syncIdHint); idType.value = 'CNIC'; syncIdHint();

  // ── photo: resize client-side to 420×540 JPEG ────────────────────
  document.getElementById('photoInput').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const img = new Image();
    img.onload = () => {
      const W = 420, H = 540, c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d'); const s = Math.max(W / img.width, H / img.height);
      const w = img.width * s, h = img.height * s; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
      ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
      let q = 0.85, data;
      do { data = c.toDataURL('image/jpeg', q); q -= 0.1; } while (data.length * 0.75 > 380 * 1024 && q > 0.3);
      state.photo = data; document.getElementById('photoPreview').style.backgroundImage = `url(${data})`; document.getElementById('photoPreview').textContent = '';
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(f);
  });

  // ── repeatable lists ─────────────────────────────────────────────
  const selectHtml = (name, src, value, optional) => { const s = document.createElement('select'); s.name = name; fillSelect(s, src, { optional, value }); return s.outerHTML; };
  /**
   * ISCO-08 occupations, grouped by major group so 108 entries are navigable,
   * and always re-marking the current selection — the list is rebuilt whenever
   * a skill row re-renders, and an <option> with no `selected` attribute makes
   * the field snap back to "Select…" even though the code is held in state.
   */
  const OCC_BY_MAJOR = ref.occupations.majorGroups.map(g => ({
    ...g, units: ref.occupations.unitGroups.filter(u => u.code[0] === g.code)
  })).filter(g => g.units.length);

  function occOptions(current, filter) {
    const q = (filter || '').trim().toLowerCase();
    const match = u => !q || u.code.startsWith(q) || u.title.toLowerCase().includes(q) || (u.sector || '').includes(q);
    let html = `<option value="">Select…</option>`;
    for (const g of OCC_BY_MAJOR) {
      // A filtered-out option is still rendered when it is the current value,
      // so searching can never silently discard the applicant's choice.
      const units = g.units.filter(u => match(u) || u.code === current);
      if (!units.length) continue;
      html += `<optgroup label="${g.code} — ${NSP.esc(g.title)}">` + units.map(u =>
        `<option value="${u.code}" data-sector="${u.sector}"${u.code === current ? ' selected' : ''}>${u.code} — ${NSP.esc(u.title)}</option>`
      ).join('') + '</optgroup>';
    }
    return html;
  }
  const occCount = ref.occupations.unitGroups.length;

  /** Evidence types that cannot stand up without a body that issued them. */
  const BODY_REQUIRED = ['CERTIFICATE', 'LICENCE', 'ASSESSMENT'];
  function renderList(id, items, tpl) {
    const box = document.getElementById(id);
    box.innerHTML = items.map((it, i) => `<div class="item" data-i="${i}">${tpl(it, i)}<button type="button" class="btn btn-sm btn-secondary remove" data-remove="${i}">✕</button></div>`).join('');
    box.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => { items.splice(Number(b.dataset.remove), 1); renderList(id, items, tpl); }));
    box.querySelectorAll('.occ-search').forEach(inp => inp.addEventListener('input', () => {
      const row = inp.closest('.item');
      const sel = row.querySelector('[data-k="iscoCode"]');
      const keep = sel.value;
      sel.innerHTML = occOptions(keep, inp.value);
      sel.value = keep;
    }));
    box.querySelectorAll('input,select').forEach(el => el.addEventListener('change', () => {
      const i = Number(el.closest('.item').dataset.i); const k = el.dataset.k;
      if (el.type === 'checkbox') { if (k === 'primary') items.forEach((x, j) => x.primary = j === i); else items[i][k] = el.checked; if (k === 'primary' || k === 'current') renderList(id, items, tpl); }
      else items[i][k] = el.value;
      if (k === 'iscoCode') {
        // Update the two fields this choice drives, in place. Re-rendering the
        // row here would rebuild the <select> and throw away the selection.
        const o = el.selectedOptions[0];
        const row = el.closest('.item');
        if (o && o.value) {
          items[i].title = o.textContent.split(' — ').slice(1).join(' — ');
          items[i].sector = o.dataset.sector;
          const t = row.querySelector('[data-k="title"]'); if (t) t.value = items[i].title;
          const sc = row.querySelector('[data-k="sector"]'); if (sc) sc.value = items[i].sector;
        }
      }
      if (k === 'evidenceType') markRequiredBody(el.closest('.item'), el.value);
    }));
  }
  /** Show or hide the certifying-body asterisk for the chosen evidence type. */
  function markRequiredBody(row, evidenceType) {
    const star = row.querySelector('.body-req');
    if (star) star.hidden = !BODY_REQUIRED.includes(evidenceType);
  }

  const skillTpl = (s) => `
    <div class="row">
      <div class="field"><label>Occupation (ISCO-08) <span class="req">*</span></label>
        <input type="search" class="occ-search" placeholder="Search ${occCount} occupations — e.g. teacher, welder, 7126" aria-label="Filter occupations">
        <select data-k="iscoCode">${occOptions(s.iscoCode)}</select></div>
      <div class="field"><label>Skill title <span class="req">*</span></label><input type="text" data-k="title" value="${NSP.esc(s.title || '')}"></div>
      <div class="field"><label>Sector</label><select data-k="sector">${sources.sectors().map(([v, t]) => `<option value="${v}" ${s.sector === v ? 'selected' : ''}>${NSP.esc(t)}</option>`).join('')}</select></div>
    </div>
    <div class="row">
      <div class="field"><label>Level</label><select data-k="nvqfLevel"><option value="">Not assessed</option>${sources.nvqf().map(([v, t]) => `<option value="${v}" ${String(s.nvqfLevel) === String(v) ? 'selected' : ''}>${NSP.esc(t)}</option>`).join('')}</select></div>
      <div class="field"><label>Evidence <span class="req">*</span></label><select data-k="evidenceType">${sources.evidenceTypes().map(([v, t]) => `<option value="${v}" ${s.evidenceType === v ? 'selected' : ''}>${NSP.esc(t)}</option>`).join('')}</select></div>
      <div class="field"><label>Certifying / assessing body <span class="req body-req"${BODY_REQUIRED.includes(s.evidenceType) ? '' : ' hidden'}>*</span></label><input type="text" data-k="certifyingBody" value="${NSP.esc(s.certifyingBody || '')}" placeholder="e.g. NAVTTC, TEVTA, City & Guilds"></div>
    </div>
    <div class="row">
      <div class="field"><label>Certificate number</label><input type="text" data-k="certificateNumber" value="${NSP.esc(s.certificateNumber || '')}"></div>
      <div class="field"><label>Issued on</label><input type="date" data-k="issuedOn" value="${s.issuedOn || ''}"></div>
      <div class="field"><label>Expires on</label><input type="date" data-k="expiresOn" value="${s.expiresOn || ''}"></div>
      <div class="field"><label>Years of experience</label><input type="number" min="0" max="60" data-k="yearsExperience" value="${s.yearsExperience || 0}"></div>
    </div>
    <label class="check"><input type="checkbox" data-k="primary" ${s.primary ? 'checked' : ''}> Primary skill (printed on card)</label>`;
  const langTpl = (l) => `<div class="row">
      <div class="field"><label>Language</label><select data-k="code">${sources.languages().map(([v, t]) => `<option value="${v}" ${l.code === v ? 'selected' : ''}>${NSP.esc(t)}</option>`).join('')}</select></div>
      <div class="field"><label>Level (CEFR)</label><select data-k="level">${sources.cefr().map(([v, t]) => `<option value="${v}" ${l.level === v ? 'selected' : ''}>${NSP.esc(t)}</option>`).join('')}</select></div></div>`;
  const expTpl = (x) => `<div class="row">
      <div class="field"><label>Employer <span class="req">*</span></label><input type="text" data-k="employer" value="${NSP.esc(x.employer || '')}"></div>
      <div class="field"><label>Country</label><select data-k="country">${sources.countries().map(([v, t]) => `<option value="${v}" ${x.country === v ? 'selected' : ''}>${NSP.esc(t)}</option>`).join('')}</select></div>
      <div class="field"><label>Role <span class="req">*</span></label><input type="text" data-k="role" value="${NSP.esc(x.role || '')}"></div></div>
    <div class="row">
      <div class="field"><label>From <span class="req">*</span></label><input type="date" data-k="from" value="${x.from || ''}"></div>
      <div class="field"><label>To</label><input type="date" data-k="to" value="${x.to || ''}" ${x.current ? 'disabled' : ''}></div>
      <div class="field"><label>Reference contact</label><input type="text" data-k="referenceContact" value="${NSP.esc(x.referenceContact || '')}" placeholder="name / phone / email"></div></div>
    <label class="check"><input type="checkbox" data-k="current" ${x.current ? 'checked' : ''}> Current employment</label>`;
  const docTpl = (d) => `<div class="row"><div class="field"><label>Type</label><select data-k="type">${sources.documentTypes().map(([v, t]) => `<option value="${v}" ${d.type === v ? 'selected' : ''}>${NSP.esc(t)}</option>`).join('')}</select></div>
      <div class="field"><label>File</label><div class="small">${NSP.esc(d.fileName)} · ${(d.size / 1024).toFixed(0)} KB<br><span class="mono muted">${d.sha256.slice(0, 16)}…</span></div></div></div>`;

  const lists = { skillsList: [state.skills, skillTpl], langList: [state.languages, langTpl], expList: [state.experience, expTpl], docList: [state.documents, docTpl] };
  const rerender = id => renderList(id, lists[id][0], lists[id][1]);
  document.getElementById('addSkill').onclick = () => { state.skills.push({ evidenceType: 'CERTIFICATE', sector: 'construction', primary: state.skills.length === 0 }); rerender('skillsList'); };
  document.getElementById('addLang').onclick = () => { state.languages.push({ code: 'en', level: 'B1' }); rerender('langList'); };
  document.getElementById('addExp').onclick = () => { state.experience.push({ country: 'PK' }); rerender('expList'); };
  document.getElementById('addSkill').click(); state.languages.push({ code: 'ur', level: 'NATIVE' }, { code: 'en', level: 'A2' }); rerender('langList');

  document.getElementById('docInput').addEventListener('change', async e => {
    for (const f of e.target.files) {
      if (f.size > 5 * 1024 * 1024) { alert(`${f.name} exceeds 5 MB`); continue; }
      const buf = await f.arrayBuffer();
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map(b => b.toString(16).padStart(2, '0')).join('');
      state.documents.push({ type: 'OTHER', fileName: f.name, mime: f.type, size: f.size, sha256: hash });
    }
    rerender('docList'); e.target.value = '';
  });

  // ── assemble payload ─────────────────────────────────────────────
  function payload() {
    const v = n => form.elements[n] ? form.elements[n].value.trim() : '';
    const c = n => form.elements[n] ? form.elements[n].checked : false;
    return {
      type: form.elements['type'].value, channel: 'ONLINE',
      identity: { givenNames: v('identity.givenNames'), familyName: v('identity.familyName'), nameNative: v('identity.nameNative'), fatherOrGuardianName: v('identity.fatherOrGuardianName'),
        dateOfBirth: v('identity.dateOfBirth'), sex: v('identity.sex'), nationality: v('identity.nationality'), countryOfBirth: v('identity.countryOfBirth'),
        idDocumentType: v('identity.idDocumentType'), idDocumentNumber: v('identity.idDocumentNumber'), idDocumentExpiry: v('identity.idDocumentExpiry') || undefined,
        passportNumber: v('identity.passportNumber'), passportExpiry: v('identity.passportExpiry') || undefined, photo: state.photo },
      contact: { email: v('contact.email'), phone: v('contact.phone'), altPhone: v('contact.altPhone'),
        address: { line1: v('contact.address.line1'), line2: v('contact.address.line2'), city: v('contact.address.city'), region: v('contact.address.region'), postalCode: v('contact.address.postalCode'), country: v('contact.address.country') },
        emergencyContact: { name: v('contact.emergencyContact.name'), relationship: v('contact.emergencyContact.relationship'), phone: v('contact.emergencyContact.phone') } },
      education: { highestLevel: v('education.highestLevel'), field: v('education.field'), institution: v('education.institution'), qualificationTitle: v('education.qualificationTitle'), yearCompleted: v('education.yearCompleted') || undefined,
        currentInstitution: v('education.currentInstitution'), currentProgramme: v('education.currentProgramme'), enrollmentNumber: v('education.enrollmentNumber'), expectedCompletion: v('education.expectedCompletion') || undefined },
      skills: state.skills, languages: state.languages, experience: state.experience, documents: state.documents,
      consent: { dataProcessing: c('consent.dataProcessing'), employerVerification: c('consent.employerVerification'), crossBorderSharing: c('consent.crossBorderSharing'), declarationTruthful: c('consent.declarationTruthful'), termsVersion: '1.0' }
    };
  }

  // ── navigation & validation ──────────────────────────────────────
  function show(n) {
    step = n; panels.forEach(p => p.hidden = Number(p.dataset.panel) !== n);
    steps.forEach(s => { const k = Number(s.dataset.step); s.classList.toggle('active', k === n); s.classList.toggle('done', k < n); });
    prevBtn.style.visibility = n === 1 ? 'hidden' : ''; nextBtn.hidden = n === panels.length; submitBtn.hidden = n !== panels.length;
    formError.hidden = true; window.scrollTo({ top: 0, behavior: 'smooth' });
    if (n === panels.length) renderReview();
  }
  function validatePanel(n) {
    const panel = panels[n - 1]; let ok = true;
    panel.querySelectorAll('input,select').forEach(el => {
      const bad = (el.required && !el.value) || (el.value && !el.checkValidity());
      el.classList.toggle('invalid', bad); if (bad) ok = false;
    });
    if (n === 1 && !state.photo) { ok = false; showError('A passport-style photograph is required.'); }
    if (n === 4 && !state.skills.some(s => s.iscoCode)) { ok = false; showError('Add at least one skill with an ISCO-08 occupation.'); }
    if (n === 4 && ok) {
      // The server refuses these, so say so here rather than after the last
      // panel, where the applicant has to work out which skill it meant.
      const i = state.skills.findIndex(s => BODY_REQUIRED.includes(s.evidenceType) && !(s.certifyingBody || '').trim());
      if (i >= 0) { ok = false; showError(`Skill ${i + 1}: name the body that issued the ${state.skills[i].evidenceType.toLowerCase()} (e.g. NAVTTC, TEVTA).`); }
      const j = state.skills.findIndex(s => !s.iscoCode);
      if (ok && j >= 0) { ok = false; showError(`Skill ${j + 1}: choose an ISCO-08 occupation, or remove the row.`); }
    }
    if (!ok && formError.hidden) showError('Please complete the highlighted fields.');
    return ok;
  }
  function showError(msg, details) {
    formError.hidden = false;
    formError.innerHTML = NSP.esc(msg) + (details && details.length ? '<ul>' + details.map(d => `<li><b>${NSP.esc(d.path)}</b>: ${NSP.esc(d.message)}</li>`).join('') + '</ul>' : '');
  }
  nextBtn.onclick = () => { if (validatePanel(step)) show(step + 1); };
  prevBtn.onclick = () => show(step - 1);
  steps.forEach(s => s.addEventListener('click', () => { const k = Number(s.dataset.step); if (k < step) show(k); }));

  function renderReview() {
    const p = payload(); const country = c => (ref.countries.find(x => x.alpha2 === c) || {}).name || c;
    const rows = [
      ['Type', p.type], ['Name', `${p.identity.givenNames} ${p.identity.familyName}`], ['Date of birth', p.identity.dateOfBirth], ['Nationality', country(p.identity.nationality)],
      ['ID document', `${p.identity.idDocumentType} ${p.identity.idDocumentNumber}`], ['Email / phone', `${p.contact.email} · ${p.contact.phone}`],
      ['Address', [p.contact.address.line1, p.contact.address.city, country(p.contact.address.country)].filter(Boolean).join(', ')],
      ['Education', `ISCED ${p.education.highestLevel} — ${p.education.qualificationTitle || p.education.currentProgramme || ''}`],
      ['Skills', p.skills.map(s => `${s.iscoCode} ${s.title}${s.nvqfLevel ? ' (NVQF ' + s.nvqfLevel + ')' : ''}${s.primary ? ' ★' : ''}`).join('; ')],
      ['Languages', p.languages.map(l => `${l.code.toUpperCase()} ${l.level}`).join(', ')],
      ['Experience', p.experience.length ? p.experience.map(x => `${x.role} @ ${x.employer}`).join('; ') : '—'], ['Documents', p.documents.length + ' file(s)']
    ];
    document.getElementById('review').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${NSP.esc(v)}</dd>`).join('');
  }

  // ── registration gate ────────────────────────────────────────────
  // Mobile OTP proves control of a number that was itself issued against a
  // biometric CNIC check by the operator, which is the strongest identity
  // signal available without a NADRA integration. Proof of work makes bulk
  // scripted submission expensive without depending on a hosted CAPTCHA.
  const gate = { token: null, phone: null };
  const otpMsg = document.getElementById('otpMsg');
  const otpCodeField = document.getElementById('otpCodeField');
  const otpVerifyField = document.getElementById('otpVerifyField');

  function otpSay(msg, cls) {
    otpMsg.hidden = false; otpMsg.textContent = msg;
    otpMsg.className = 'hint' + (cls ? ' ' + cls : '');
  }
  function otpSayHtml(html, cls) {
    otpMsg.hidden = false; otpMsg.innerHTML = html;
    otpMsg.className = 'hint' + (cls ? ' ' + cls : '');
  }

  document.getElementById('otpSend').addEventListener('click', async () => {
    const phone = (form.elements['contact.phone'].value || '').replace(/[\s()-]/g, '');
    if (!/^\+\d{8,15}$/.test(phone)) { otpSay('Enter your mobile in international format first, e.g. +923001234567.', 'bad'); return; }
    const btn = document.getElementById('otpSend');
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      // The email goes with the request so the server can fall back to it when
      // no SMS carrier is reachable, rather than leaving the applicant waiting
      // for a message that is never going to arrive.
      const email = (document.querySelector('[name="contact.email"]') || {}).value || '';
      const r = await NSP.call('/otp/request', { method: 'POST', body: { phone, email } });
      gate.challengeId = r.challengeId; gate.phone = phone; gate.token = null;
      otpCodeField.hidden = false; otpVerifyField.hidden = false;
      if (r.devCode) {
        otpSayHtml(`Development mode — your code is <b style="font-size:1.25em;letter-spacing:.12em">${NSP.esc(r.devCode)}</b>`, 'ok');
        document.getElementById('otpCode').value = r.devCode;
      } else if (r.channel === 'email') {
        otpSayHtml(`SMS is unavailable, so we emailed the code to <b>${NSP.esc(r.sentTo)}</b>. Check your inbox and spam folder. ` +
          `A registrar will confirm your mobile number in person when you bring your CNIC.`, 'ok');
      } else {
        otpSay(`Code sent by SMS to ${r.sentTo || phone}. It expires in ${Math.round((r.expiresIn || 600) / 60)} minutes.`, 'ok');
      }
      btn.textContent = 'Resend code';
    } catch (err) { otpSay(err.message, 'bad'); btn.textContent = 'Send code'; }
    finally { btn.disabled = false; }
  });

  document.getElementById('otpVerify').addEventListener('click', async () => {
    const code = (document.getElementById('otpCode').value || '').trim();
    if (!gate.challengeId) { otpSay('Request a code first.', 'bad'); return; }
    try {
      const r = await NSP.call('/otp/verify', { method: 'POST', body: { challengeId: gate.challengeId, code } });
      gate.token = r.registrationToken; gate.phone = r.phone;
      otpSay('Mobile number verified.', 'ok');
      otpCodeField.hidden = true; otpVerifyField.hidden = true;
      document.getElementById('otpSend').hidden = true;
    } catch (err) { otpSay(err.message, 'bad'); }
  });

  // Any edit to the number invalidates the verification: the token is bound
  // to the phone the server sent the code to.
  form.elements['contact.phone'].addEventListener('input', () => {
    if (!gate.token) return;
    const now = (form.elements['contact.phone'].value || '').replace(/[\s()-]/g, '');
    if (now !== gate.phone) {
      gate.token = null; gate.challengeId = null;
      document.getElementById('otpSend').hidden = false;
      document.getElementById('otpSend').textContent = 'Send code';
      otpSay('The number changed — verify it again.', 'bad');
    }
  });

  /**
   * Solve the server's proof-of-work challenge: sha256(challenge.nonce) with N
   * leading zero bits.
   *
   * Digests are issued in batches rather than one at a time. Almost all of the
   * cost of crypto.subtle.digest on a short input is per-call overhead, not
   * hashing, so batching is roughly four times faster — which matters on the
   * low-end handsets this form is actually filled in on.
   */
  async function solvePow(onProgress) {
    const c = await NSP.call('/gate/challenge');
    const enc = new TextEncoder();
    const need = c.difficulty;
    const BATCH = 512;
    for (let base = 0; base < 5e7; base += BATCH) {
      const digests = await Promise.all(
        Array.from({ length: BATCH }, (_, k) => crypto.subtle.digest('SHA-256', enc.encode(`${c.challenge}.${base + k}`)))
      );
      for (let k = 0; k < BATCH; k++) {
        const buf = new Uint8Array(digests[k]);
        let bits = 0;
        for (const b of buf) { if (b === 0) { bits += 8; continue; } bits += Math.clz32(b) - 24; break; }
        if (bits >= need) return { gateChallenge: c.challenge, gateNonce: String(base + k) };
      }
      if (onProgress) onProgress(base);
      await new Promise(r => setTimeout(r));   // let the browser paint
    }
    throw new Error('Could not complete the security check. Please try again.');
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!validatePanel(panels.length)) return;
    if (!gate.token) {
      showError('Your mobile number has not been verified. Go back to the Contact step and verify it.');
      show(2); return;
    }
    submitBtn.disabled = true; submitBtn.textContent = 'Security check…';
    try {
      const pow = await solvePow(() => { submitBtn.textContent = 'Security check…'; });
      submitBtn.textContent = 'Submitting…';
      const body = Object.assign(payload(), pow, {
        registrationToken: gate.token,
        website: form.elements['website'] ? form.elements['website'].value : ''
      });
      const r = await NSP.call('/registrations', { method: 'POST', body });
      form.hidden = true; document.getElementById('stepper').hidden = true;
      const rc = document.getElementById('receipt'); rc.hidden = false;
      document.getElementById('receiptId').textContent = r.nspId;
      document.getElementById('trackLink').href = `/track/${r.nspId}`;
      document.getElementById('receiptQr').innerHTML = NSP.qrSvg(location.origin + `/track/${r.nspId}`, { size: 140 });
    } catch (err) {
      showError(err.message, err.details); if (err.details && err.details.length) { const first = err.details[0].path; const n = { identity: 1, contact: 2, education: 3, skills: 4, languages: 4, experience: 5, documents: 5, consent: 6 }[first.split(/[.\[]/)[0]]; if (n) { show(n); showError(err.message, err.details); } }
    } finally { submitBtn.disabled = false; submitBtn.textContent = 'Submit application'; }
  });
  show(1);
})();
