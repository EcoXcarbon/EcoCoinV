/* Registry desk — dashboard, work queues, records, gate health and audit. */
(function () {
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => NSP.esc(s);
  const login = $('#login'), desk = $('#desk'), drawer = $('#drawer'), detail = $('#detail');

  let me = null;          // { actor, controls: { fourEyes, gate }, issuer }
  let ref = null;         // reference data (countries, ISCED, …)
  let dash = null;        // last /dashboard payload
  let page = 0, auditPage = 0;
  const PAGE = 50;

  // ── helpers ────────────────────────────────────────────────────────
  const num = n => (n === null || n === undefined ? '—' : Number(n).toLocaleString());
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

  /** "3 days", "4 hours" — how long something has been waiting. */
  function since(iso) {
    if (!iso) return '—';
    const h = (Date.now() - Date.parse(iso)) / 3600e3;
    if (h < 1) return 'under an hour';
    if (h < 48) return `${Math.round(h)} hours`;
    return `${Math.round(h / 24)} days`;
  }
  function hours(h) {
    if (h === null || h === undefined) return '—';
    return h < 48 ? `${h} h` : `${(h / 24).toFixed(1)} days`;
  }
  const tierPill = t => `<span class="tier sm tier-${String(t || 'NSP-1').slice(-1)}">${esc(t || 'NSP-1')}</span>`;
  /** How the applicant's contact details were proved — the two are not equal. */
  const contactMark = i => (i.phoneVerified ? ''
    : i.emailVerified ? ' <span class="novrf" title="A code was emailed because SMS was unavailable; the mobile number is unproven">email only</span>'
    : ' <span class="novrf">no mobile</span>');

  /**
   * Bar chart as inline SVG — one or two series over the same dates. Small
   * enough to keep here rather than pull a charting library onto a page that
   * a registry office may be loading over a slow link.
   */
  function barChart(seriesA, seriesB, opts = {}) {
    const W = 600, H = 150, pad = { l: 28, r: 6, t: 8, b: 18 };
    const n = seriesA.length;
    const max = Math.max(1, ...seriesA.map(d => d.count), ...(seriesB || []).map(d => d.count));
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const slot = iw / n, bw = Math.max(1.5, (slot - 2) / (seriesB ? 2 : 1));
    const y = v => pad.t + ih - (v / max) * ih;

    let bars = '';
    seriesA.forEach((d, i) => {
      const x = pad.l + i * slot + 1;
      bars += `<rect class="bar" x="${x.toFixed(1)}" y="${y(d.count).toFixed(1)}" width="${bw.toFixed(1)}" height="${(pad.t + ih - y(d.count)).toFixed(1)}"><title>${d.date}: ${d.count}</title></rect>`;
      if (seriesB) {
        const b = seriesB[i] || { count: 0 };
        bars += `<rect class="bar alt" x="${(x + bw).toFixed(1)}" y="${y(b.count).toFixed(1)}" width="${bw.toFixed(1)}" height="${(pad.t + ih - y(b.count)).toFixed(1)}"><title>${b.date}: ${b.count}</title></rect>`;
      }
    });

    // Gridlines at 0, half and max, labelled — a chart without a scale invites
    // the reader to invent one.
    let grid = '';
    for (const v of [0, max / 2, max]) {
      grid += `<line class="grid" x1="${pad.l}" y1="${y(v).toFixed(1)}" x2="${W - pad.r}" y2="${y(v).toFixed(1)}"/>` +
              `<text class="lbl" x="0" y="${(y(v) + 3).toFixed(1)}">${Math.round(v)}</text>`;
    }
    const first = seriesA[0], last = seriesA[n - 1];
    const dm = iso => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    const axis = n ? `<text class="lbl" x="${pad.l}" y="${H - 5}">${dm(first.date)}</text>` +
      `<text class="lbl" x="${W - pad.r}" y="${H - 5}" text-anchor="end">${dm(last.date)}</text>` : '';

    const total = seriesA.reduce((s, d) => s + d.count, 0) + (seriesB || []).reduce((s, d) => s + d.count, 0);
    if (!total && opts.emptyText) return `<div class="emptystate small">${esc(opts.emptyText)}</div>`;
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label || 'chart')}">${grid}${bars}${axis}</svg>`;
  }

  function hbars(rows, keyName) {
    if (!rows.length) return '<p class="muted small">No data yet.</p>';
    const max = Math.max(...rows.map(r => r.count));
    return rows.map(r => `<div class="hbar"><span class="t">${esc(r[keyName] || '—')}</span><span class="v">${r.count}</span>
      <span class="track"><span class="fill" style="width:${pct(r.count, max)}%"></span></span></div>`).join('');
  }

  // ── auth ───────────────────────────────────────────────────────────
  async function boot() {
    if (!NSP.key()) return;
    try { me = await NSP.call('/me', { auth: true }); } catch { NSP.setKey(''); return; }
    login.hidden = true; desk.hidden = false;
    $('#avatar').textContent = me.actor.slice(0, 2).toUpperCase();
    $('#whoName').textContent = me.actor;
    $('#whoRole').textContent = `${me.issuer.shortName}${me.controls.fourEyes ? ' · four-eyes control on' : ' · four-eyes control OFF'}`;
    ref = await NSP.reference();
    await loadDashboard();
  }
  $('#lf').addEventListener('submit', async e => {
    e.preventDefault(); NSP.setKey($('#key').value.trim());
    try { await NSP.call('/me', { auth: true }); $('#loginErr').hidden = true; boot(); }
    catch (err) { NSP.setKey(''); $('#loginErr').hidden = false; $('#loginErr').textContent = err.message; }
  });
  $('#logout').addEventListener('click', () => { NSP.setKey(''); location.reload(); });
  $('#refresh').addEventListener('click', () => refreshActive());

  // ── tabs ───────────────────────────────────────────────────────────
  const LOADERS = { overview: loadDashboard, queues: loadQueue, records: loadList, gate: loadGate, audit: loadAudit };
  let activeTab = 'overview';
  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]'); if (!b) return;
    showTab(b.dataset.tab);
  });
  function showTab(name) {
    activeTab = name;
    $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    $$('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== name; });
    LOADERS[name]();
  }
  function refreshActive() { LOADERS[activeTab](); if (activeTab !== 'overview') loadDashboard(true); }

  // ── overview ───────────────────────────────────────────────────────
  const QUEUES = [
    { key: 'needsVerification', label: 'Awaiting verification', tone: 'act', help: 'Applications submitted online. A registrar must sight the CNIC or B-Form in person before these can be issued — that sighting is what lifts a record from NSP-1 to NSP-2.' },
    { key: 'awaitingIssue', label: 'Verified, not issued', tone: 'act', help: 'Documents have been sighted. These are ready for a card or certificate.' },
    { key: 'secondOfficer', label: 'Needs another officer', tone: 'warn', help: 'You verified these records yourself, so under the four-eyes control a different registry officer must issue them.' },
    { key: 'flagged', label: 'Possible duplicates', tone: 'warn', help: 'These resemble an existing person on name, date of birth and father’s name. Judge each one: genuine namesakes sharing a birthday do exist, so a flag is a question, not a verdict.' },
    { key: 'expiringSoon', label: 'Expiring in 90 days', tone: 'warn', help: 'Issued passports approaching their expiry date. Re-issue before they lapse.' },
    { key: 'unverifiedPhone', label: 'No verified mobile', tone: 'stop', help: 'The mobile number was never proved. Usually because SMS was unavailable and the code went to the applicant’s email instead, which shows they read that inbox and nothing about who holds the SIM. Confirm the number in person before issuing.' }
  ];

  async function loadDashboard(quiet) {
    dash = await NSP.call('/dashboard?days=30', { auth: true });
    $('#freshness').textContent = 'as of ' + new Date(dash.generatedAt).toLocaleTimeString();

    const actionable = dash.queues.needsVerification + dash.queues.awaitingIssue + dash.queues.flagged;
    const badge = $('#tabQueueCount');
    badge.textContent = actionable;
    badge.classList.toggle('hot', actionable > 0);

    if (quiet) return;
    renderAlerts(); renderKpis(); renderQueueCards();

    $('#trendWindow').textContent = `last ${dash.windowDays} days`;
    $('#trendChart').innerHTML = barChart(dash.trend.registrations, dash.trend.issuances, { label: 'Registrations and issuances per day', emptyText: 'No registrations or issuances in this window.' });
    $('#checkChart').innerHTML = barChart(dash.trend.publicChecks, null, { label: 'Public verifications per day', emptyText: 'Nobody has verified a passport yet.' });

    const sl = dash.serviceLevel;
    $('#sla').innerHTML = `<dl class="kv">
      <dt>Submitted → verified</dt><dd><b>${hours(sl.submittedToVerified.medianHours)}</b> median<br><span class="muted small">90th percentile ${hours(sl.submittedToVerified.p90Hours)} · n=${sl.submittedToVerified.n}</span></dd>
      <dt>Verified → issued</dt><dd><b>${hours(sl.verifiedToIssued.medianHours)}</b> median<br><span class="muted small">90th percentile ${hours(sl.verifiedToIssued.p90Hours)} · n=${sl.verifiedToIssued.n}</span></dd></dl>
      ${sl.submittedToVerified.n === 0 ? '<p class="muted small">No record has completed this step yet.</p>' : ''}`;

    const tiers = [
      ['NSP-1', 'Mobile verified — self-declared identity'],
      ['NSP-2', 'Document sighted by a registrar'],
      ['NSP-3', 'Biometric / NADRA match — not available']
    ];
    const totalTier = Object.values(dash.byAssurance).reduce((a, b) => a + b, 0) || 1;
    $('#assuranceBreakdown').innerHTML = tiers.map(([t, d]) => {
      const n = dash.byAssurance[t] || 0;
      return `<div class="hbar"><span class="t">${tierPill(t)} <span class="muted small">${esc(d)}</span></span><span class="v">${n}</span>
        <span class="track"><span class="fill" style="width:${pct(n, totalTier)}%"></span></span></div>`;
    }).join('');

    $('#officers').innerHTML = dash.officers.length
      ? `<table class="table"><thead><tr><th>Officer</th><th>Verified</th><th>Issued</th></tr></thead><tbody>${
        dash.officers.map(o => `<tr><td>${esc(o.actor)}${o.actor === me.actor ? ' <span class="muted small">(you)</span>' : ''}</td><td>${o.verified}</td><td>${o.issued}</td></tr>`).join('')}</tbody></table>`
      : '<p class="muted small">No record has been verified yet.</p>';

    $('#districts').innerHTML = hbars(dash.topDistricts, 'district');
    $('#sectors').innerHTML = hbars(dash.topSectors, 'sector');
    $('#occupations').innerHTML = hbars(dash.topOccupations, 'occupation');

    // The district filter on the Records tab is populated from real data
    // rather than a hard-coded list, so it always matches what is registered.
    const sel = $('#district');
    if (sel.options.length <= 1) {
      for (const d of dash.topDistricts) sel.add(new Option(d.district, d.district));
    }
  }

  function renderAlerts() {
    const a = [];
    const s = dash.sms;
    if (!s.provider || s.provider === 'log') {
      a.push(['err', '📵', 'No SMS gateway is connected',
        (s.emailFallback
          ? `Verification codes are going out by email (${esc(s.emailFallback)}) instead. Applicants can register, but an emailed code proves only that they read that inbox — <b>the mobile number is not being verified</b>, and those records are queued under “No verified mobile” for a registrar to confirm in person.`
          : 'Verification codes are only written to the server journal, so nobody outside this server can complete a registration on their own.') +
        (s.devEcho ? ' The code is also returned in the API response, which means <b>the check is not a real control at all</b>.' : '')]);
    } else if (s.successRate !== null && s.successRate < 0.9) {
      a.push(['err', '📵', `SMS delivery is failing (${Math.round(s.successRate * 100)}% success)`,
        `${s.failed} of ${s.sent + s.failed} messages failed in the last ${s.windowHours} hours. Applicants cannot register while this is broken — see the Gate &amp; SMS tab.`]);
    }
    if (!me.controls.fourEyes) {
      a.push(['warn', '👥', 'Four-eyes control is switched off',
        'One officer can both verify and issue a passport. Acceptable for a single-registrar office, but it removes the separation of duties on issuance.']);
    }
    if (!me.controls.gate) {
      a.push(['err', '🚪', 'The registration gate is disabled',
        'Anything that can post JSON can create a registry record. This setting is meant for local development only.']);
    }
    if (dash.queues.flagged) {
      a.push(['warn', '⚠️', `${dash.queues.flagged} record${dash.queues.flagged > 1 ? 's' : ''} flagged as a possible duplicate`,
        'Someone must judge each one. A flag that nobody looks at is not a control.']);
    }
    if (dash.queues.secondOfficer) {
      a.push(['info', '👤', `${dash.queues.secondOfficer} record${dash.queues.secondOfficer > 1 ? 's' : ''} waiting on a second officer`,
        'You verified these, so a different officer must issue them.']);
    }
    if (dash.gate.abandonedAtCode > 5 && dash.gate.otpRequested > 10) {
      a.push(['warn', '📉', `${dash.gate.abandonedAtCode} applicants asked for a code and never entered it`,
        `Out of ${dash.gate.otpRequested} in the last ${dash.gate.windowHours} hours. That pattern usually means the messages are not arriving, not that people changed their minds.`]);
    }
    $('#alerts').innerHTML = a.map(([tone, ico, title, body]) =>
      `<div class="alert ${tone}"><span class="ico">${ico}</span><span><b>${title}</b>${body}</span></div>`).join('');
  }

  function renderKpis() {
    const t = dash.totals;
    $('#kpis').innerHTML = [
      [num(t.registrants), 'On the register', `${num(t.newInWindow)} in the last ${dash.windowDays} days`],
      [num(t.issued), 'Passports issued', `${num(t.cards)} cards · ${num(t.certificates)} certificates`],
      [num(t.publicChecks), 'Public verifications', 'Since the registry opened'],
      [num(dash.gate.registered), 'Registered today', `${dash.gate.otpRequested} codes requested`],
      [num(dash.byStatus.SUSPENDED || 0), 'Suspended', `${num(dash.byStatus.REVOKED || 0)} revoked`]
    ].map(([n, l, sub]) => `<div class="kpi"><div class="n">${n}</div><div class="l">${l}</div><div class="sub">${sub}</div></div>`).join('');
  }

  function renderQueueCards() {
    $('#queueCards').innerHTML = QUEUES.map(q => {
      const n = dash.queues[q.key] || 0;
      return `<button class="qcard ${n ? q.tone : 'zero'}" data-queue="${q.key}">
        <div class="n">${n}</div><div class="l">${q.label}</div>
        <div class="d">${n ? 'Open the queue' : 'Nothing waiting'}</div></button>`;
    }).join('');
    $$('#queueCards [data-queue]').forEach(b => b.addEventListener('click', () => { currentQueue = b.dataset.queue; showTab('queues'); }));
  }

  // ── work queues ────────────────────────────────────────────────────
  let currentQueue = 'needsVerification';
  async function loadQueue() {
    $('#queueTabs').innerHTML = QUEUES.map(q =>
      `<button data-q="${q.key}" class="${q.key === currentQueue ? 'active' : ''}">${q.label}<span class="badge ${dash && dash.queues[q.key] ? 'hot' : ''}">${dash ? dash.queues[q.key] || 0 : 0}</span></button>`).join('');
    $$('#queueTabs [data-q]').forEach(b => b.addEventListener('click', () => { currentQueue = b.dataset.q; loadQueue(); }));

    const meta = QUEUES.find(q => q.key === currentQueue);
    $('#queueHelp').innerHTML = meta.help;

    const r = await NSP.call(`/registrations?queue=${currentQueue}&limit=100`, { auth: true });
    const waitFrom = i => (currentQueue === 'awaitingIssue' || currentQueue === 'secondOfficer' ? i.verifiedAt || i.updatedAt : i.submittedAt || i.createdAt);
    $('#queueList tbody').innerHTML = r.items.map(i => `<tr>
      <td class="mono small">${i.nspId}</td>
      <td><b>${esc(i.familyName)}</b>, ${esc(i.givenNames)}${i.flags ? ` <span class="flagmark">${i.flags} possible duplicate${i.flags > 1 ? 's' : ''}</span>` : ''}</td>
      <td>${tierPill(i.assuranceTier)}${contactMark(i)}</td>
      <td class="small">${esc(i.district || '—')}</td>
      <td><span class="pill ${i.status}">${i.status.replace('_', ' ')}</span></td>
      <td class="small">${currentQueue === 'expiringSoon' ? 'expires ' + NSP.fmtDate(i.expiresAt) : since(waitFrom(i))}</td>
      <td><button class="btn btn-sm btn-secondary" data-open="${i.nspId}">Open</button></td></tr>`).join('')
      || `<tr><td colspan="7"><div class="emptystate"><div class="big">✓</div>Nothing in this queue.</div></td></tr>`;
    wireOpen('#queueList');
  }

  // ── records ────────────────────────────────────────────────────────
  let lastList = { items: [] };
  function listParams() {
    // Only send filters that are actually set. An empty — or worse, undefined —
    // value reaching the API reads as a filter for that literal string and
    // silently returns nothing.
    const p = new URLSearchParams({ limit: PAGE, offset: page * PAGE });
    for (const [k, sel] of [['q', '#q'], ['status', '#status'], ['type', '#type'], ['assurance', '#assurance'], ['district', '#district']]) {
      const v = ($(sel).value || '').trim();
      if (v) p.set(k, v);
    }
    return p;
  }
  async function loadList() {
    const r = await NSP.call('/registrations?' + listParams(), { auth: true });
    lastList = r;
    $('#count').textContent = `${r.total} record${r.total === 1 ? '' : 's'}`;
    $('#pageInfo').textContent = r.total ? `${page * PAGE + 1}–${Math.min((page + 1) * PAGE, r.total)} of ${r.total}` : '';
    $('#prevPage').disabled = page === 0;
    $('#nextPage').disabled = (page + 1) * PAGE >= r.total;
    $('#list tbody').innerHTML = r.items.map(i => `<tr>
      <td class="mono small">${i.nspId}</td>
      <td><b>${esc(i.familyName)}</b>, ${esc(i.givenNames)}${i.flags ? ` <span class="flagmark">${i.flags} dup</span>` : ''}</td>
      <td class="small">${i.type}</td>
      <td class="small">${esc(i.primarySkill || '')} <span class="muted">${i.primaryIsco || ''}</span></td>
      <td class="small">${esc(i.district || '—')}</td>
      <td>${tierPill(i.assuranceTier)}${contactMark(i)}</td>
      <td><span class="pill ${i.status}">${i.status.replace('_', ' ')}</span></td>
      <td class="small">${NSP.fmtDate(i.submittedAt || i.createdAt)}</td>
      <td><button class="btn btn-sm btn-secondary" data-open="${i.nspId}">Open</button></td></tr>`).join('')
      || '<tr><td colspan="9"><div class="emptystate">No records match these filters.</div></td></tr>';
    wireOpen('#list');
  }
  function wireOpen(sel) {
    $$(`${sel} [data-open]`).forEach(b => b.addEventListener('click', () => openRecord(b.dataset.open)));
  }
  ['#q', '#status', '#type', '#assurance', '#district'].forEach(s =>
    $(s).addEventListener('change', () => { page = 0; loadList(); }));
  $('#q').addEventListener('keyup', e => { if (e.key === 'Enter') { page = 0; loadList(); } });
  $('#prevPage').addEventListener('click', () => { if (page > 0) { page--; loadList(); } });
  $('#nextPage').addEventListener('click', () => { page++; loadList(); });

  $('#exportCsv').addEventListener('click', async () => {
    // Export what the filters currently select, not just the visible page.
    const p = listParams(); p.set('limit', '200'); p.set('offset', '0');
    const all = []; let off = 0;
    for (;;) {
      p.set('offset', String(off));
      const r = await NSP.call('/registrations?' + p, { auth: true });
      all.push(...r.items); off += 200;
      if (off >= r.total || !r.items.length) break;
    }
    const cols = ['nspId', 'status', 'type', 'familyName', 'givenNames', 'nationality', 'district', 'primaryIsco', 'primarySkill', 'sector', 'assuranceTier', 'phoneVerified', 'flags', 'verifiedBy', 'issuedBy', 'submittedAt', 'issuedAt', 'expiresAt'];
    const cell = v => {
      const s = v === null || v === undefined ? '' : String(v);
      // Leading =, +, - or @ makes a spreadsheet treat the value as a formula.
      return /^[=+\-@]/.test(s) ? `"'${s.replace(/"/g, '""')}"` : `"${s.replace(/"/g, '""')}"`;
    };
    const csv = [cols.join(','), ...all.map(r => cols.map(c => cell(r[c])).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `nsp-registrants-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  });

  // ── gate & SMS ─────────────────────────────────────────────────────
  async function loadGate() {
    const s = await NSP.call('/sms/status?limit=25', { auth: true });
    const g = dash ? dash.gate : await NSP.call('/dashboard', { auth: true }).then(d => d.gate);

    const steps = [
      ['Codes requested', g.otpRequested, null],
      ['Mobile verified', g.otpVerified, g.abandonedAtCode ? `${g.abandonedAtCode} never entered a code` : null],
      ['Registrations completed', g.registered, g.abandonedAtForm ? `${g.abandonedAtForm} verified but did not finish the form` : null]
    ];
    const top = Math.max(1, g.otpRequested);
    $('#funnel').innerHTML = steps.map(([l, n, drop]) => `<div class="step">
      <span>${l}</span><span class="track"><span class="fill" style="width:${Math.min(100, pct(n, top))}%"></span></span><b>${n}</b>
      ${drop ? `<span></span><span class="drop">↳ ${esc(drop)}</span><span></span>` : ''}</div>`).join('') +
      (g.rejectedByGate ? `<p class="muted small" style="margin:10px 0 0">${g.rejectedByGate} submission(s) rejected by the gate, and ${g.duplicateFlags} flagged as a possible duplicate, in the last ${g.windowHours} hours.</p>` : '');

    const live = s.live;
    $('#smsStatus').innerHTML = `
      <div class="alert ${live ? (s.successRate === null || s.successRate >= 0.9 ? 'info' : 'err') : 'err'}" style="margin-bottom:12px">
        <span class="ico">${live ? '📶' : '📵'}</span>
        <span><b>${live ? `Connected via ${esc(s.provider)}` : 'No carrier connected — provider is “log”'}</b>
        ${live ? 'Codes are being sent by SMS.'
               : (s.emailFallback
                  ? `Codes are falling back to email via <b>${esc(s.emailFallback)}</b>, so registration still works — but an emailed code does not prove the applicant holds the SIM, and those records are flagged for the desk.`
                  : 'Codes are written to the server journal only. Nobody outside this server can complete a registration.')
                 + (s.devEcho ? ' The code is also returned in the API response, which means the check is <b>not a real control at all</b>.' : '')}</span></div>
      <dl class="kv">
        <dt>Number format</dt><dd class="mono">${esc(s.numberFormat)}</dd>
        <dt>Last ${s.windowHours} hours</dt><dd>${s.sent} sent · ${s.failed} failed${s.successRate !== null ? ` · ${Math.round(s.successRate * 100)}% success` : ''}</dd>
        <dt>Average latency</dt><dd>${s.averageLatencyMs ? s.averageLatencyMs + ' ms' : '—'}</dd>
      </dl>
      ${s.lastFailures.length ? `<fieldset style="margin-top:10px"><legend>Recent failures</legend>${
        s.lastFailures.map(f => `<div class="small"><span class="muted">${new Date(f.at).toLocaleString()}</span> · ${esc(f.provider)} attempt ${f.attempt} — ${esc(f.error || '')}</div>`).join('')}</fieldset>` : ''}`;

    $('#smsLog tbody').innerHTML = s.recent.map(r => `<tr>
      <td class="small">${new Date(r.at).toLocaleString()}</td><td class="mono small">${esc(r.phone)}</td>
      <td class="small">${esc(r.provider)}</td><td>${r.attempt}</td><td class="small">${r.latencyMs ? r.latencyMs + ' ms' : '—'}</td>
      <td><span class="pill ${r.status === 'SENT' ? 'ACTIVE' : 'REVOKED'}">${r.status}</span></td></tr>`).join('')
      || '<tr><td colspan="6"><div class="emptystate">No messages have been attempted yet.</div></td></tr>';
  }

  $('#smsSend').addEventListener('click', async () => {
    const phone = $('#smsPhone').value.trim(), box = $('#smsMsg');
    const btn = $('#smsSend'); btn.disabled = true;
    try {
      const r = await NSP.call('/sms/test', { method: 'POST', auth: true, body: { phone } });
      box.innerHTML = `<div class="notice">Accepted by <b>${esc(r.provider)}</b> after ${r.attempts} attempt(s).${r.messageId ? ` Message id <span class="mono">${esc(r.messageId)}</span>.` : ''} If the handset shows nothing within a minute, the carrier dropped it — usually an unregistered sender mask.</div>`;
      loadGate();
    } catch (e) { box.innerHTML = `<div class="notice err">${esc(e.message)}</div>`; }
    finally { btn.disabled = false; }
  });

  // ── audit ──────────────────────────────────────────────────────────
  const AUDIT_ACTIONS = ['REGISTER', 'REVIEW', 'VERIFY', 'REJECT', 'ISSUE', 'SUSPEND', 'REINSTATE', 'REVOKE', 'EXPIRE', 'UPDATE', 'OTP_REQUEST', 'OTP_VERIFIED', 'GATE_REJECT', 'DEDUP_FLAG', 'SMS_TEST'];
  async function loadAudit() {
    const sel = $('#auditAction');
    if (sel.options.length <= 1) for (const a of AUDIT_ACTIONS) sel.add(new Option(a, a));
    const p = new URLSearchParams({ limit: PAGE, offset: auditPage * PAGE });
    if (sel.value) p.set('action', sel.value);
    if ($('#auditActor').value.trim()) p.set('actor', $('#auditActor').value.trim());
    const r = await NSP.call('/audit?' + p, { auth: true });
    $('#auditCount').textContent = `${r.total} entr${r.total === 1 ? 'y' : 'ies'}`;
    $('#auditPage').textContent = r.total ? `${auditPage * PAGE + 1}–${Math.min((auditPage + 1) * PAGE, r.total)} of ${r.total}` : '';
    $('#auditPrev').disabled = auditPage === 0;
    $('#auditNext').disabled = (auditPage + 1) * PAGE >= r.total;
    $('#auditList tbody').innerHTML = r.items.map(i => `<tr>
      <td class="small">${new Date(i.at).toLocaleString()}</td>
      <td>${esc(i.actor)}</td><td><b>${esc(i.action)}</b></td>
      <td class="mono small">${i.nspId ? `<a href="#" data-open="${i.nspId}">${i.nspId}</a>` : '—'}</td>
      <td class="small muted">${i.detail ? esc(JSON.stringify(i.detail)) : ''}</td></tr>`).join('')
      || '<tr><td colspan="5"><div class="emptystate">Nothing recorded for these filters.</div></td></tr>';
    $$('#auditList [data-open]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); openRecord(a.dataset.open); }));
  }
  $('#auditRefresh').addEventListener('click', () => { auditPage = 0; loadAudit(); });
  $('#auditPrev').addEventListener('click', () => { if (auditPage > 0) { auditPage--; loadAudit(); } });
  $('#auditNext').addEventListener('click', () => { auditPage++; loadAudit(); });

  // ── record drawer ──────────────────────────────────────────────────
  $('#closeDrawer').addEventListener('click', () => drawer.classList.remove('open'));

  const ACTIONS = { SUBMITTED: ['REVIEW', 'VERIFY', 'REJECT'], UNDER_REVIEW: ['VERIFY', 'REJECT'], VERIFIED: ['ISSUE_CARD', 'ISSUE_CERT', 'REVOKE'], ISSUED: ['ISSUE_CARD', 'ISSUE_CERT', 'SUSPEND', 'REVOKE'], SUSPENDED: ['REINSTATE', 'REVOKE'], EXPIRED: ['ISSUE_CARD', 'REVOKE'], REVOKED: [], REJECTED: [] };
  const LABEL = { REVIEW: 'Start review', VERIFY: '✔ Verify', REJECT: 'Reject', ISSUE_CARD: '🪪 Issue / reprint card', ISSUE_CERT: '📜 Issue certificate', SUSPEND: 'Suspend', REINSTATE: 'Reinstate', REVOKE: 'Revoke' };
  const NEEDS_REASON = ['REJECT', 'SUSPEND', 'REVOKE'];
  const ISSUING = ['ISSUE_CARD', 'ISSUE_CERT'];

  async function openRecord(id) {
    drawer.classList.add('open'); detail.innerHTML = '<p class="muted">Loading…</p>';
    let r; try { r = await NSP.call(`/registrations/${id}`, { auth: true }); } catch (e) { detail.innerHTML = `<div class="notice err">${esc(e.message)}</div>`; return; }
    const country = c => (ref.countries.find(x => x.alpha2 === c) || {}).name || c || '—';
    const isced = ref.iscedLevels.levels.find(l => l.code === r.education.highestLevel);
    const card = r.credentials.find(c => c.kind === 'CARD' && c.status === 'ACTIVE'), cert = r.credentials.find(c => c.kind === 'CERTIFICATE' && c.status === 'ACTIVE');

    // Four eyes: say so before the officer clicks, rather than after a 409.
    const blockedByFourEyes = me.controls.fourEyes && r.registry.verifiedBy && r.registry.verifiedBy === me.actor;
    const flags = r.assurance.dedupFlags || [];

    detail.innerHTML = `
      <div class="photo-sm" style="${r.identity.photo ? `background-image:url(${r.identity.photo})` : ''}"></div>
      <h2 style="margin:0">${esc(r.identity.givenNames)} ${esc(r.identity.familyName)}</h2>
      ${r.identity.nameNative ? `<div class="muted">${esc(r.identity.nameNative)}</div>` : ''}
      <div class="mono">${r.nspId}</div>
      <p><span class="pill ${r.status}">${r.status.replace('_', ' ')}</span> <span class="pill">${r.type}</span>
         ${tierPill(r.assurance.tier)} <span class="small muted">via ${r.channel}</span></p>

      ${flags.length ? `<div class="alert warn"><span class="ico">⚠️</span><span>
        <b>${flags.length} possible duplicate${flags.length > 1 ? 's' : ''} of this person</b>
        Same normalised name, date of birth or father's name as ${flags.length > 1 ? 'other records' : 'another record'}.
        <button class="btn btn-sm btn-secondary" id="cmpBtn" style="margin-top:8px">Compare side by side</button></span></div>` : ''}

      ${blockedByFourEyes ? `<div class="alert info"><span class="ico">👥</span><span>
        <b>You verified this record, so you cannot issue it</b>
        The four-eyes control requires a different registry officer to issue. Hand it to a colleague, or find it under “Needs another officer”.</span></div>` : ''}

      ${!r.assurance.phoneVerified ? `<div class="alert warn"><span class="ico">📵</span><span>
        <b>Mobile number not verified</b>
        ${r.assurance.emailVerified
          ? 'The code went to this applicant&rsquo;s email because SMS was unavailable. That proves they read the inbox, not that they hold this SIM.'
          : 'This record did not pass the mobile check at all.'}
        Confirm the number in person before issuing.</span></div>` : ''}

      <div class="actions-bar" id="actions">${(ACTIONS[r.status] || []).map(a => {
        const stop = blockedByFourEyes && ISSUING.includes(a);
        return `<button class="btn btn-sm ${a === 'REVOKE' || a === 'REJECT' ? 'btn-danger' : a.startsWith('ISSUE') || a === 'VERIFY' ? 'btn-primary' : 'btn-secondary'}" data-act="${a}"${stop ? ' disabled title="Another officer must issue this record"' : ''}>${LABEL[a]}</button>`;
      }).join('')}
        ${['VERIFIED', 'ISSUED'].includes(r.status) ? `<a class="btn btn-sm btn-secondary" href="/api/v1/registrations/${r.nspId}/credential.json?key=${encodeURIComponent(NSP.key())}" target="_blank">VC JSON</a>` : ''}</div>
      <div id="actMsg"></div>
      <div id="cmpBox"></div>

      ${card || cert ? `<fieldset><legend>Active credentials</legend>${card ? `<div>🪪 Card <span class="mono">${card.serial}</span> · issued ${NSP.fmtDate(card.issuedAt)} · expires ${NSP.fmtDate(card.expiresAt)} — <a href="/card/${card.serial}" target="_blank">open print view</a></div>` : ''}${cert ? `<div>📜 Certificate <span class="mono">${cert.serial}</span> · issued ${NSP.fmtDate(cert.issuedAt)} — <a href="/certificate/${cert.serial}" target="_blank">open print view</a></div>` : ''}</fieldset>` : ''}
      <fieldset><legend>Identity</legend><dl class="kv">
        <dt>Date of birth</dt><dd>${NSP.fmtDate(r.identity.dateOfBirth)} · ${r.identity.sex}</dd>
        <dt>Nationality</dt><dd>${country(r.identity.nationality)}${r.identity.countryOfBirth ? ` · born ${country(r.identity.countryOfBirth)}` : ''}</dd>
        <dt>ID document</dt><dd>${r.identity.idDocumentType} <span class="mono">${esc(r.identity.idDocumentNumber)}</span>${r.identity.idDocumentExpiry ? ' · exp ' + NSP.fmtDate(r.identity.idDocumentExpiry) : ''}</dd>
        ${r.identity.passportNumber ? `<dt>Passport</dt><dd><span class="mono">${esc(r.identity.passportNumber)}</span> · exp ${NSP.fmtDate(r.identity.passportExpiry)}</dd>` : ''}
        ${r.identity.fatherOrGuardianName ? `<dt>Father / guardian</dt><dd>${esc(r.identity.fatherOrGuardianName)}</dd>` : ''}</dl></fieldset>
      <fieldset><legend>Contact</legend><dl class="kv">
        <dt>Email / phone</dt><dd>${esc(r.contact.email)} ${r.assurance.emailVerified ? '<span class="pill ACTIVE">verified</span>' : ''} · ${esc(r.contact.phone)} ${r.assurance.phoneVerified ? '<span class="pill ACTIVE">verified</span>' : '<span class="novrf">unverified</span>'}${r.contact.altPhone ? ' / ' + esc(r.contact.altPhone) : ''}</dd>
        <dt>Address</dt><dd>${[r.contact.address.line1, r.contact.address.line2, r.contact.address.city, r.contact.address.region, r.contact.address.postalCode, country(r.contact.address.country)].filter(Boolean).map(esc).join(', ')}</dd>
        ${r.contact.emergencyContact.name ? `<dt>Emergency</dt><dd>${esc(r.contact.emergencyContact.name)} (${esc(r.contact.emergencyContact.relationship)}) ${esc(r.contact.emergencyContact.phone)}</dd>` : ''}</dl></fieldset>
      <fieldset><legend>Education</legend><dl class="kv">
        <dt>Highest level</dt><dd>ISCED ${r.education.highestLevel} — ${isced ? esc(isced.title) : ''}</dd>
        ${r.education.qualificationTitle ? `<dt>Qualification</dt><dd>${esc(r.education.qualificationTitle)} · ${esc(r.education.institution)} ${r.education.yearCompleted || ''}</dd>` : ''}
        ${r.education.currentInstitution ? `<dt>Enrolled</dt><dd>${esc(r.education.currentProgramme)} · ${esc(r.education.currentInstitution)} · roll ${esc(r.education.enrollmentNumber)}${r.education.expectedCompletion ? ' · completes ' + NSP.fmtDate(r.education.expectedCompletion) : ''}</dd>` : ''}</dl></fieldset>
      <fieldset><legend>Skills</legend><table class="table"><thead><tr><th>ISCO</th><th>Skill</th><th>Level</th><th>Evidence</th></tr></thead><tbody>
        ${r.skills.map(s => `<tr><td class="mono">${s.iscoCode}</td><td>${s.primary ? '★ ' : ''}${esc(s.title)}<div class="small muted">${esc(s.sector || '')}</div></td><td>${s.nvqfLevel ? 'NVQF ' + s.nvqfLevel : '—'}</td><td class="small">${s.evidenceType}<br>${esc(s.certifyingBody || '')} ${esc(s.certificateNumber || '')}${s.issuedOn ? '<br>' + NSP.fmtDate(s.issuedOn) : ''}</td></tr>`).join('')}</tbody></table>
        ${r.languages.length ? `<p class="small" style="margin-top:8px"><b>Languages:</b> ${r.languages.map(l => l.code.toUpperCase() + ' ' + l.level).join(', ')}</p>` : ''}</fieldset>
      ${r.experience.length ? `<fieldset><legend>Experience</legend>${r.experience.map(x => `<div class="small">${esc(x.role)} — <b>${esc(x.employer)}</b> (${country(x.country)}) ${NSP.fmtDate(x.from)} → ${x.current ? 'present' : NSP.fmtDate(x.to)}${x.referenceContact ? ' · ref: ' + esc(x.referenceContact) : ''}</div>`).join('')}</fieldset>` : ''}
      ${r.documents.length ? `<fieldset><legend>Documents</legend>${r.documents.map(d => `<div class="small">${d.type} · ${esc(d.fileName)} · ${(d.size / 1024).toFixed(0)} KB · <span class="mono">${d.sha256.slice(0, 12)}…</span></div>`).join('')}</fieldset>` : ''}
      <fieldset><legend>Consent</legend><div class="small">Processing: ${r.consent.dataProcessing ? '✔' : '✖'} · Employer verification: ${r.consent.employerVerification ? '✔' : '✖'} · Cross-border: ${r.consent.crossBorderSharing ? '✔' : '✖'} · Declaration: ${r.consent.declarationTruthful ? '✔' : '✖'} · terms v${r.consent.termsVersion} · ${new Date(r.consent.consentedAt).toLocaleString()}</div></fieldset>
      <fieldset><legend>Registry</legend><dl class="kv">
        <dt>Submitted</dt><dd>${NSP.fmtDate(r.registry.submittedAt)}</dd>
        <dt>Verified</dt><dd>${NSP.fmtDate(r.registry.verifiedAt)} ${r.registry.verifiedBy ? 'by <b>' + esc(r.registry.verifiedBy) + '</b>' : ''}</dd>
        <dt>Issued</dt><dd>${NSP.fmtDate(r.registry.issuedAt)} ${r.registry.issuedBy ? 'by <b>' + esc(r.registry.issuedBy) + '</b>' : ''} → ${NSP.fmtDate(r.registry.expiresAt)}</dd>
        ${r.registry.revokeReason ? `<dt>Revoked</dt><dd>${esc(r.registry.revokeReason)}</dd>` : ''}${r.registry.rejectedReason ? `<dt>Rejected</dt><dd>${esc(r.registry.rejectedReason)}</dd>` : ''}</dl>
        <ul class="audit">${r.audit.map(a => `<li>${new Date(a.at).toLocaleString()} — <b>${a.action}</b> by ${esc(a.actor)}${a.detail ? ' · ' + esc(JSON.stringify(a.detail)) : ''}</li>`).join('')}</ul></fieldset>`;

    detail.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => act(r.nspId, b.dataset.act)));
    const cmp = $('#cmpBtn');
    if (cmp) cmp.addEventListener('click', () => showDuplicates(r.nspId));
  }

  /**
   * Side-by-side comparison of a record and everything the dedup check thought
   * it might be. Matching fields are highlighted, because what an officer is
   * really asking is "which of these fields agree, and does the photo agree
   * too?".
   */
  async function showDuplicates(id) {
    const box = $('#cmpBox');
    box.innerHTML = '<p class="muted">Loading…</p>';
    let d; try { d = await NSP.call(`/registrations/${id}/duplicates`, { auth: true }); }
    catch (e) { box.innerHTML = `<div class="notice err">${esc(e.message)}</div>`; return; }

    const people = [d.subject, ...d.candidates];
    const ROWS = [
      ['Photo', p => p.photo ? `<img src="${p.photo}" alt="">` : '—', 'facecell'],
      ['Name', p => `${esc(p.givenNames || '')} ${esc(p.familyName || '')}`],
      ['Date of birth', p => NSP.fmtDate(p.dateOfBirth)],
      ['Father / guardian', p => esc(p.fatherOrGuardianName || '—')],
      ['ID document', p => `${p.idDocumentType || ''} <span class="mono">${esc(p.idDocumentNumber || '')}</span>`],
      ['Mobile', p => esc(p.phone || '—')],
      ['Email', p => esc(p.email || '—')],
      ['District', p => esc(p.district || '—')],
      ['Primary skill', p => esc(p.primarySkill || '—')],
      ['Status', p => `<span class="pill ${p.status}">${(p.status || '').replace('_', ' ')}</span>`]
    ];
    // Compare on the raw value, not the rendered HTML.
    const RAW = { Name: p => `${p.givenNames} ${p.familyName}`.toLowerCase(), 'Date of birth': p => p.dateOfBirth, 'Father / guardian': p => (p.fatherOrGuardianName || '').toLowerCase(), 'ID document': p => p.idDocumentNumber, Mobile: p => p.phone, Email: p => p.email, District: p => p.district };

    box.innerHTML = `<fieldset><legend>Possible duplicates</legend>
      <table class="cmp"><thead><tr><th></th>
        <th>This record<br><span class="mono small">${d.subject.nspId}</span></th>
        ${d.candidates.map(c => `<th><span class="scorepill ${c.score >= 75 ? 'high' : ''}">${c.score}/100</span><br>
          <a href="#" data-open="${c.nspId}" class="mono small">${c.nspId}</a><br>
          <span class="muted small">${esc((c.reasons || []).join(', '))}</span></th>`).join('')}
      </tr></thead><tbody>
      ${ROWS.map(([label, render, cls]) => `<tr><th>${label}</th>${people.map((p, i) => {
        const raw = RAW[label];
        const same = i > 0 && raw && raw(p) && raw(p) === raw(d.subject);
        return `<td class="${cls || ''} ${same ? 'same' : ''}">${p.missing ? '—' : render(p)}</td>`;
      }).join('')}</tr>`).join('')}
      </tbody></table>
      <p class="muted small" style="margin:10px 0 0">A high score is a question, not a verdict. If these are the same person, revoke the later record with a reason. If they are genuinely different people who share a name and a birthday — which is common — leave both and the flag stays on file as evidence that it was looked at.</p>
      </fieldset>`;
    box.querySelectorAll('[data-open]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); openRecord(a.dataset.open); }));
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
      await openRecord(id);
      await loadDashboard(true);
      LOADERS[activeTab]();
    } catch (e) { msg.innerHTML = `<div class="notice err">${esc(e.message)}${e.details ? '<br><small>' + esc(JSON.stringify(e.details)) + '</small>' : ''}</div>`; }
  }

  document.addEventListener('keydown', e => { if (e.key === 'Escape') drawer.classList.remove('open'); });
  boot();
})();
