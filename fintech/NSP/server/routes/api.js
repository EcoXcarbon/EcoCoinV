'use strict';
const express = require('express');
const crypto = require('node:crypto');
const { RegistryError, TRANSITIONS } = require('../lib/registry');
const { normaliseNspId } = require('../lib/nspId');

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

  const wrap = fn => (req, res, next) => { try { fn(req, res, next); } catch (e) { next(e); } };
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

  router.post('/registrations', rateLimit, wrap((req, res) => {
    const reg = registry.register(req.body, 'applicant');
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

  router.get('/me', (req, res) => res.json({ actor: req.actor }));
  router.get('/stats', wrap((req, res) => res.json(store.stats())));
  router.get('/registrations', wrap((req, res) => res.json(store.listRegistrants(req.query))));
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
    const cred = store.getCredential(String(req.params.serial).toUpperCase());
    if (!cred) return res.status(404).json({ error: 'credential not found' });
    res.json(cred);
  }));

  router.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err instanceof RegistryError) return res.status(err.status).json({ error: err.message, details: err.details || null });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'payload too large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid JSON' });
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  });

  return router;
}

module.exports = { buildApi };
