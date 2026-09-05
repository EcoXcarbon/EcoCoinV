'use strict';
const path = require('node:path');
const root = path.join(__dirname, '..');

function parseKeys(s) {
  // "registrar:abc123,printer:def456"  ->  Map(key -> actor)
  const m = new Map();
  for (const pair of String(s || '').split(',')) {
    const [name, key] = pair.split(':').map(x => (x || '').trim());
    if (name && key) m.set(key, name);
  }
  return m;
}

const config = {
  port: Number(process.env.PORT) || 4100,
  host: process.env.HOST || '0.0.0.0',
  publicUrl: (process.env.NSP_PUBLIC_URL || 'http://localhost:4100').replace(/\/$/, ''),
  dbFile: process.env.NSP_DB_FILE || path.join(root, 'data', 'nsp-registry.db'),
  dataDir: path.join(root, 'data'),
  issuer: {
    country: (process.env.NSP_ISSUER_COUNTRY || 'PK').toUpperCase(),
    name: process.env.NSP_ISSUER_NAME || 'National Skill Passport Registry',
    shortName: process.env.NSP_ISSUER_SHORT || 'NSP Registry',
    authority: process.env.NSP_ISSUER_AUTHORITY || 'Power Planning & Monitoring Company (PPMC) — TalentLedger',
    did: process.env.NSP_ISSUER_DID || 'did:web:tl.ppmc.pk',
    registrar: process.env.NSP_REGISTRAR_TITLE || 'Registrar, National Skill Passport'
  },
  cardValidityYears: Number(process.env.NSP_CARD_VALIDITY_YEARS) || 5,
  registryKeys: parseKeys(process.env.NSP_REGISTRY_KEYS || 'registrar:dev-registrar-key'),
  corsOrigins: (process.env.NSP_CORS_ORIGINS || '*').split(',').map(s => s.trim()),
  rateLimit: { windowMs: 60_000, max: Number(process.env.NSP_RATE_LIMIT) || 60 }
};

module.exports = config;
