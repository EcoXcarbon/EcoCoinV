'use strict';
const express = require('express');
const crypto = require('node:crypto');
const { RegistryError, TRANSITIONS } = require('../lib/registry');
const { normaliseNspId } = require('../lib/nspId');
const { Gate, GateError } = require('../lib/gate');
const { Otp, OtpError } = require('../lib/otp');
const { SmsGateway, SmsError } = require('../lib/sms');
const { SmtpMailer, EmailError } = require('../lib/email');

function timingSafeEqual(a, b) {
  const ab = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function buildApi(registry, config) {
  const router = express.Router();
  const store = registry.store;

  // ── auth: registry officers present X-Registry-Key ────────────────
  function registrarAuth(req, res, next) {
    const key = req.get('X-Registry-Key') || (req.query.key ? String(req.query.key) : '');
    let actor = null;
    for (const [k, name] of config.registryKeys) if (timingSafeEqual(k, key)) actor = name;
    if (!actor) return res.status(401).json({ error: 'registry key required' });
    req.actor = actor;
    next();
  }

  // ── very small in-memory rate limiter for public endpoints ────────
  const buckets = new Map();
  function rateLimit(req, res, next) {
    const now = Date.now();
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    let b = buckets.get(ip);
    if (!b || now - b.start > config.rateLimit.windowMs) { b = { start: now, n: 0 }; buckets.set(ip, b); }
    b.n++;
    if (buckets.size > 10_000) buckets.clear();
    if (b.n > config.rateLimit.max) return res.status(429).json({ error: 'too many requests' });
    next();
  }

  // ── registration gate ─────────────────────────────────────────────
  const gate = new Gate(store, {
    ...config.pow, ...config.velocity,
    enabled: config.gateEnabled, secret: config.gateSecret
  });
  const sms = new SmsGateway(config.sms, store);
  const mailer = new SmtpMailer(config.email);
  const otp = new Otp(store, {
    ...config.otp, secret: config.gateSecret, sms, mailer,
    emailFallback: config.email.fallback
  });
  const clientIp = req => (req.ip || req.socket.remoteAddress || '').replace(/^::ffff:/, '') || null;

  /** The fields an officer actually compares when judging a possible duplicate. */
  const compareView = r => ({
    nspId: r.nspId, status: r.status, type: r.type,
    givenNames: r.identity.givenNames, familyName: r.identity.familyName,
    dateOfBirth: r.identity.dateOfBirth, sex: r.identity.sex,
    fatherOrGuardianName: r.identity.fatherOrGuardianName || null,
    idDocumentType: r.identity.idDocumentType, idDocumentNumber: r.identity.idDocumentNumber,
    photo: r.identity.photo || null,
    phone: r.contact.phone, email: r.contact.email,
    district: r.district || (r.contact.address || {}).region || null,
    primarySkill: (r.skills.find(k => k.primary) || r.skills[0] || {}).title || null,
    assurance: r.assurance, registry: r.registry
  });

  const wrap = fn => (req, res, next) => { try { fn(req, res, next); } catch (e) { next(e); } };
  const wrapAsync = fn => (req, res, next) => { Promise.resolve(fn(req, res, next)).catch(next); };
  const idParam = (req, res, next) => {
    const id = normaliseNspId(req.params.nspId);
    if (!id) return res.status(400).json({ error: 'malformed NSP ID (check character failed)' });
    req.nspId = id; next();
  };

  // ── public ────────────────────────────────────────────────────────
  router.get('/health', (req, res) => res.json({ ok: true, service: 'nsp-registry', time: new Date().toISOString() }));
  router.get('/reference', (req, res) => res.json(registry.referenceData()));
  router.get('/reference/:name', (req, res) => {
    const data = registry.referenceData()[req.params.name];
    if (!data) return res.status(404).json({ error: 'unknown reference set' });
    res.json(data);
  });
  router.get('/issuer', (req, res) => res.json(registry.issuerDocument()));

  // ── gate: proof of work ──────────────────────────────────────────
  // Issued to the registration form, solved in the browser, submitted back
  // with the application. Costs a human a moment and a scripted bulk
  // submitter real CPU, without depending on a third-party CAPTCHA service
  // that a rural centre may not be able to reach.
  router.get('/gate/challenge', rateLimit, wrap((req, res) => res.json(gate.challenge())));

  // ── gate: mobile OTP ─────────────────────────────────────────────
  router.post('/otp/request', rateLimit, wrapAsync(async (req, res) => {
    const body = req.body || {};
    const out = await otp.request(String(body.phone || '').replace(/[\s()-]/g, ''), {
      ip: clientIp(req),
      // Only consulted if the SMS carrier cannot take the message.
      email: String(body.email || '').trim()
    });
    store.audit('applicant', 'OTP_REQUEST', null, { challengeId: out.challengeId, channel: out.channel, ip: clientIp(req) });
    res.status(201).json(out);
  }));

  router.post('/otp/verify', rateLimit, wrap((req, res) => {
    const { challengeId, code } = req.body || {};
    const out = otp.verify(String(challengeId || ''), String(code || ''));
    store.audit('applicant', 'OTP_VERIFIED', null, { phone: out.phone, channel: out.channel, ip: clientIp(req) });
    res.json(out);
  }));

  router.post('/registrations', rateLimit, wrap((req, res) => {
    const body = req.body || {};
    const ip = clientIp(req);
    let phoneVerified = false;
    let emailVerified = false;
    let tokenSignature = null;

    if (config.gateEnabled) {
      // Honeypot: a field hidden from humans by CSS. Anything in it is a bot.
      if (String(body.website || '').trim()) {
        store.audit('system', 'GATE_REJECT', null, { reason: 'honeypot', ip });
        throw new GateError('registration rejected');
      }
      gate.verifyChallenge(body.gateChallenge, body.gateNonce);

      const token = req.get('X-Registration-Token') || body.registrationToken;
      const opened = otp.openToken(token);
      const submitted = String(((body.contact || {}).phone) || '').replace(/[\s()-]/g, '');
      if (opened.phone !== submitted) {
        throw new OtpError('the mobile number on the form does not match the number you verified', 400);
      }
      // A code delivered to an inbox proves the applicant reads that inbox. It
      // does not prove they hold this SIM, so phoneVerified stays false and the
      // record surfaces in the desk's "no verified mobile" queue.
      if (opened.channel === 'email') emailVerified = true; else phoneVerified = true;
      tokenSignature = opened.signature;

      gate.checkVelocity({
        ip, phone: submitted,
        district: ((body.contact || {}).address || {}).region || null
      });
    }

    const reg = registry.register(body, 'applicant', { ip, phoneVerified, emailVerified });
    if (tokenSignature) otp.consumeToken(tokenSignature);
    store.pruneGate();
    res.status(201).json({
      nspId: reg.nspId, status: reg.status, submittedAt: reg.registry.submittedAt,
      receipt: { message: 'Registration received. Keep your NSP ID; you will need it with your date of birth to track status.', trackUrl: `${config.publicUrl}/track/${reg.nspId}` }
    });
  }));

  // applicant self-service status: NSP ID + date of birth
  router.get('/registrations/:nspId/status', rateLimit, idParam, wrap((req, res) => {
    const reg = registry.getFresh(req.nspId);
    if (!req.query.dob || req.query.dob !== reg.identity.dateOfBirth) return res.status(403).json({ error: 'date of birth does not match' });
    res.json({
      nspId: reg.nspId, status: reg.status, type: reg.type, submittedAt: reg.registry.submittedAt, verifiedAt: reg.registry.verifiedAt,
      issuedAt: reg.registry.issuedAt, expiresAt: reg.registry.expiresAt, rejectedReason: reg.registry.rejectedReason,
      credentials: store.listCredentials(reg.nspId).filter(c => c.status === 'ACTIVE').map(c => ({ kind: c.kind, serial: c.serial, issuedAt: c.issuedAt }))
    });
  }));

  router.get('/verify/serial/:serial', rateLimit, wrap((req, res) => {
    res.json(registry.verify({ serial: String(req.params.serial).toUpperCase() }, { ip: req.ip, userAgent: req.get('user-agent') }));
  }));
  router.get('/verify/:nspId', rateLimit, wrap((req, res) => {
    const id = normaliseNspId(req.params.nspId);
    if (!id) return res.json({ result: 'MALFORMED_ID', valid: false, checkedAt: new Date().toISOString(), record: null });
    res.json(registry.verify({ nspId: id, token: req.query.t ? String(req.query.t) : null }, { ip: req.ip, userAgent: req.get('user-agent') }));
  }));

  // ── registry desk (authenticated) ─────────────────────────────────
  router.use(registrarAuth);

  router.get('/me', (req, res) => res.json({
    actor: req.actor,
    // The desk needs to know which controls are live: four-eyes changes what
    // this officer is allowed to do to a record they verified themselves.
    controls: { fourEyes: !!config.fourEyes, gate: !!config.gateEnabled },
    issuer: { name: config.issuer.name, shortName: config.issuer.shortName, country: config.issuer.country }
  }));
  router.get('/stats', wrap((req, res) => res.json(store.stats())));
  // One round trip for the whole overview: queues, throughput, service levels,
  // gate and SMS health. Scoped to the caller so the four-eyes queue is theirs.
  router.get('/dashboard', wrap((req, res) => {
    const d = store.dashboard({ actor: req.actor, days: Math.min(Math.max(Number(req.query.days) || 30, 7), 180) });
    d.sms.provider = sms.name; d.sms.live = sms.live; d.sms.devEcho = !!config.otp.devEcho;
    d.sms.emailFallback = config.email.fallback && mailer.configured ? mailer.name : null;
    res.json(d);
  }));
  router.get('/registrations', wrap((req, res) => res.json(
    store.listRegistrants({ ...req.query, actor: req.actor })
  )));
  // The possible duplicates recorded for a record, resolved into enough of
  // each candidate to judge them side by side without opening six tabs.
  router.get('/registrations/:nspId/duplicates', idParam, wrap((req, res) => {
    const reg = registry.mustGet(req.nspId);
    const flags = reg.assurance.dedupFlags || [];
    res.json({
      nspId: reg.nspId,
      subject: compareView(reg),
      candidates: flags.map(f => {
        const other = store.getRegistrant(f.nspId);
        return { score: f.score, reasons: f.reasons, status: f.status, ...(other ? compareView(other) : { nspId: f.nspId, missing: true }) };
      })
    });
  }));
  // Full audit trail across the registry, newest first. Every state change,
  // registration, OTP event and gate rejection is here.
  router.get('/audit', wrap((req, res) => res.json(store.auditRecent(req.query))));
  // Is the SMS gateway actually delivering? Without this, an outage looks
  // identical to "nobody registered today".
  router.get('/sms/status', wrap((req, res) => res.json({
    provider: sms.name,
    live: sms.live,
    emailFallback: config.email.fallback && mailer.configured ? mailer.name : null,
    numberFormat: sms.numberFormat,
    devEcho: !!config.otp.devEcho,
    ...store.smsHealth({ limit: Number(req.query.limit) || 20 })
  })));
  // Send a real message to a real handset, to prove the gateway before a
  // rollout. Registrar-only, and it never returns the code.
  router.post('/sms/test', wrapAsync(async (req, res) => {
    const phone = String((req.body || {}).phone || '').replace(/[\s()-]/g, '');
    if (!/^\+\d{8,15}$/.test(phone)) return res.status(400).json({ error: 'phone must be in E.164 form, e.g. +923001234567' });
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    const out = await sms.send(phone, code);
    store.audit(req.actor, 'SMS_TEST', null, { provider: out.provider, attempts: out.attempts });
    res.json({ ok: true, provider: out.provider, messageId: out.messageId, attempts: out.attempts });
  }));
  router.get('/registrations/:nspId', idParam, wrap((req, res) => {
    const reg = registry.getFresh(req.nspId);
    res.json({ ...reg, credentials: store.listCredentials(req.nspId), audit: store.auditFor(req.nspId) });
  }));
  router.put('/registrations/:nspId', idParam, wrap((req, res) => res.json(registry.update(req.nspId, req.body, req.actor))));
  router.post('/registrations/:nspId/transition', idParam, wrap((req, res) => {
    const action = String((req.body || {}).action || '').toUpperCase();
    if (!TRANSITIONS[action]) return res.status(400).json({ error: 'action must be one of ' + Object.keys(TRANSITIONS).join(', ') });
    res.json(registry.transition(req.nspId, action, req.actor, { reason: (req.body || {}).reason }));
  }));
  router.post('/registrations/:nspId/credentials/card', idParam, wrap((req, res) => res.status(201).json(registry.issueCard(req.nspId, req.actor))));
  router.post('/registrations/:nspId/credentials/certificate', idParam, wrap((req, res) => res.status(201).json(registry.issueCertificate(req.nspId, req.actor))));
  router.get('/registrations/:nspId/credential.json', idParam, wrap((req, res) => {
    res.type('application/vc+ld+json').send(JSON.stringify(registry.verifiableCredential(req.nspId), null, 2));
  }));
  router.get('/credentials/:serial', wrap((req, res) => {
    const cred = registry.credentialForPrint(String(req.params.serial).toUpperCase());
    if (!cred) return res.status(404).json({ error: 'credential not found' });
    res.json(cred);
  }));

  router.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err instanceof RegistryError) return res.status(err.status).json({ error: err.message, details: err.details || null });
    if (err instanceof GateError || err instanceof OtpError) return res.status(err.status || 400).json({ error: err.message });
    if (err instanceof SmsError || err instanceof EmailError) return res.status(err.status || 502).json({ error: err.message });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'payload too large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid JSON' });
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  });

  return router;
}

module.exports = { buildApi };
