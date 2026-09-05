'use strict';
/**
 * Registry data store on Node's built-in SQLite (node:sqlite, Node >= 22.5).
 * The schema mirrors server/db/schema.sql (PostgreSQL) so the service can be
 * pointed at Postgres by swapping this module only.
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sequences (
  country TEXT NOT NULL, year INTEGER NOT NULL, last INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (country, year)
);
CREATE TABLE IF NOT EXISTS registrants (
  nsp_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  type TEXT NOT NULL,
  given_names TEXT NOT NULL, family_name TEXT NOT NULL,
  date_of_birth TEXT NOT NULL, sex TEXT NOT NULL, nationality TEXT NOT NULL,
  id_document_type TEXT NOT NULL, id_document_number TEXT NOT NULL,
  email TEXT NOT NULL, phone TEXT NOT NULL,
  primary_isco TEXT, primary_skill TEXT, sector TEXT,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  submitted_at TEXT, verified_at TEXT, verified_by TEXT, issued_at TEXT, expires_at TEXT,
  suspended_at TEXT, revoked_at TEXT, revoke_reason TEXT, rejected_reason TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_registrants_iddoc ON registrants (nationality, id_document_type, id_document_number);
CREATE INDEX IF NOT EXISTS ix_registrants_email ON registrants (email);
CREATE INDEX IF NOT EXISTS ix_registrants_status ON registrants (status);
CREATE INDEX IF NOT EXISTS ix_registrants_family ON registrants (family_name);
CREATE TABLE IF NOT EXISTS credentials (
  serial TEXT PRIMARY KEY,
  nsp_id TEXT NOT NULL REFERENCES registrants (nsp_id),
  kind TEXT NOT NULL,              -- CARD | CERTIFICATE
  status TEXT NOT NULL,            -- ACTIVE | REPLACED | REVOKED
  issued_at TEXT NOT NULL, expires_at TEXT,
  token TEXT NOT NULL,             -- signed QR token
  payload TEXT NOT NULL,           -- snapshot used for printing
  replaced_by TEXT
);
CREATE INDEX IF NOT EXISTS ix_credentials_nsp ON credentials (nsp_id, kind);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
  nsp_id TEXT, detail TEXT
);
CREATE TABLE IF NOT EXISTS verification_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL, nsp_id TEXT, result TEXT NOT NULL, ip TEXT, user_agent TEXT
);
-- ── registration gate ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS otp_challenges (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL, salt TEXT NOT NULL, code_hash TEXT NOT NULL,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, consumed INTEGER NOT NULL DEFAULT 0,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS ix_otp_phone ON otp_challenges (phone, created_at);
CREATE TABLE IF NOT EXISTS used_reg_tokens (
  signature TEXT PRIMARY KEY, used_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS gate_challenges (
  challenge TEXT PRIMARY KEY, used_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS registration_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL, nsp_id TEXT, ip TEXT, phone TEXT, district TEXT
);
CREATE INDEX IF NOT EXISTS ix_regevents_ip ON registration_events (ip, at);
CREATE INDEX IF NOT EXISTS ix_regevents_phone ON registration_events (phone, at);
CREATE INDEX IF NOT EXISTS ix_regevents_district ON registration_events (district, at);
`;

// Columns added after the first release. SQLite has no "ADD COLUMN IF NOT
// EXISTS", so they are applied defensively against the live table.
const ADDED_COLUMNS = [
  ['registrants', 'assurance_tier', "TEXT NOT NULL DEFAULT 'NSP-1'"],
  ['registrants', 'phone_verified', 'INTEGER NOT NULL DEFAULT 0'],
  ['registrants', 'issued_by', 'TEXT'],
  ['registrants', 'name_key', 'TEXT'],
  ['registrants', 'father_key', 'TEXT'],
  ['registrants', 'dedup_flags', 'TEXT'],
  ['registrants', 'registered_ip', 'TEXT']
];

class Store {
  constructor(file) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
    this.migrate();
  }

  /** Idempotent column additions for databases created before the gate. */
  migrate() {
    for (const [table, column, decl] of ADDED_COLUMNS) {
      const cols = this.db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
      if (!cols.includes(column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS ix_registrants_namekey ON registrants (name_key, date_of_birth)');
    this.db.exec('CREATE INDEX IF NOT EXISTS ix_registrants_phone ON registrants (phone)');
  }

  nextSequence(country, year) {
    const db = this.db;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT OR IGNORE INTO sequences (country, year, last) VALUES (?, ?, 0)').run(country, year);
      db.prepare('UPDATE sequences SET last = last + 1 WHERE country = ? AND year = ?').run(country, year);
      const row = db.prepare('SELECT last FROM sequences WHERE country = ? AND year = ?').get(country, year);
      db.exec('COMMIT');
      return row.last;
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  findByIdentity(nationality, idType, idNumber) {
    return this.rowToRegistrant(this.db.prepare(
      'SELECT * FROM registrants WHERE nationality = ? AND id_document_type = ? AND id_document_number = ?'
    ).get(nationality, idType, idNumber));
  }

  insertRegistrant(nspId, reg, status) {
    const now = new Date().toISOString();
    const primary = reg.skills.find(s => s.primary) || reg.skills[0];
    this.db.prepare(`INSERT INTO registrants (nsp_id, status, type, given_names, family_name, date_of_birth, sex, nationality,
      id_document_type, id_document_number, email, phone, primary_isco, primary_skill, sector, payload, created_at, updated_at, submitted_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      nspId, status, reg.type, reg.identity.givenNames, reg.identity.familyName, reg.identity.dateOfBirth, reg.identity.sex,
      reg.identity.nationality, reg.identity.idDocumentType, reg.identity.idDocumentNumber, reg.contact.email, reg.contact.phone,
      primary ? primary.iscoCode : null, primary ? primary.title : null, primary ? primary.sector : null,
      JSON.stringify(reg), now, now, status === 'SUBMITTED' ? now : null);
    return this.getRegistrant(nspId);
  }

  updatePayload(nspId, reg) {
    const primary = reg.skills.find(s => s.primary) || reg.skills[0];
    this.db.prepare(`UPDATE registrants SET payload = ?, given_names = ?, family_name = ?, date_of_birth = ?, sex = ?, nationality = ?,
      email = ?, phone = ?, primary_isco = ?, primary_skill = ?, sector = ?, type = ?, updated_at = ? WHERE nsp_id = ?`).run(
      JSON.stringify(reg), reg.identity.givenNames, reg.identity.familyName, reg.identity.dateOfBirth, reg.identity.sex,
      reg.identity.nationality, reg.contact.email, reg.contact.phone, primary ? primary.iscoCode : null,
      primary ? primary.title : null, primary ? primary.sector : null, reg.type, new Date().toISOString(), nspId);
    return this.getRegistrant(nspId);
  }

  setStatus(nspId, status, extra = {}) {
    const cols = ['status = ?', 'updated_at = ?'];
    const vals = [status, new Date().toISOString()];
    for (const [k, v] of Object.entries(extra)) { cols.push(`${k} = ?`); vals.push(v); }
    vals.push(nspId);
    this.db.prepare(`UPDATE registrants SET ${cols.join(', ')} WHERE nsp_id = ?`).run(...vals);
    return this.getRegistrant(nspId);
  }

  getRegistrant(nspId) {
    return this.rowToRegistrant(this.db.prepare('SELECT * FROM registrants WHERE nsp_id = ?').get(nspId));
  }

  rowToRegistrant(row) {
    if (!row) return null;
    const reg = JSON.parse(row.payload);
    return {
      nspId: row.nsp_id, status: row.status, ...reg,
      registry: {
        createdAt: row.created_at, updatedAt: row.updated_at, submittedAt: row.submitted_at,
        verifiedAt: row.verified_at, verifiedBy: row.verified_by, issuedAt: row.issued_at, issuedBy: row.issued_by,
        expiresAt: row.expires_at,
        suspendedAt: row.suspended_at, revokedAt: row.revoked_at, revokeReason: row.revoke_reason, rejectedReason: row.rejected_reason
      },
      assurance: {
        tier: row.assurance_tier || 'NSP-1',
        phoneVerified: !!row.phone_verified,
        dedupFlags: row.dedup_flags ? JSON.parse(row.dedup_flags) : []
      }
    };
  }

  listRegistrants({ status, q, type, limit = 50, offset = 0 } = {}) {
    const where = []; const vals = [];
    if (status) { where.push('status = ?'); vals.push(status); }
    if (type) { where.push('type = ?'); vals.push(type); }
    if (q) {
      where.push('(nsp_id LIKE ? OR family_name LIKE ? OR given_names LIKE ? OR email LIKE ? OR id_document_number LIKE ?)');
      const like = `%${q}%`; vals.push(like, like, like, like, like);
    }
    const sql = `SELECT nsp_id, status, type, given_names, family_name, nationality, primary_isco, primary_skill, sector, email, created_at, updated_at, issued_at, expires_at
      FROM registrants ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    const rows = this.db.prepare(sql).all(...vals, Math.min(Number(limit) || 50, 200), Number(offset) || 0);
    const total = this.db.prepare(`SELECT COUNT(*) AS n FROM registrants ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`).get(...vals).n;
    return { total, items: rows.map(r => ({
      nspId: r.nsp_id, status: r.status, type: r.type, givenNames: r.given_names, familyName: r.family_name,
      nationality: r.nationality, primaryIsco: r.primary_isco, primarySkill: r.primary_skill, sector: r.sector,
      email: r.email, createdAt: r.created_at, updatedAt: r.updated_at, issuedAt: r.issued_at, expiresAt: r.expires_at })) };
  }

  stats() {
    const byStatus = this.db.prepare('SELECT status, COUNT(*) AS n FROM registrants GROUP BY status').all();
    const byType = this.db.prepare('SELECT type, COUNT(*) AS n FROM registrants GROUP BY type').all();
    const bySector = this.db.prepare('SELECT sector, COUNT(*) AS n FROM registrants WHERE sector IS NOT NULL GROUP BY sector ORDER BY n DESC').all();
    const total = this.db.prepare('SELECT COUNT(*) AS n FROM registrants').get().n;
    const verifications = this.db.prepare('SELECT COUNT(*) AS n FROM verification_log').get().n;
    return { total, verifications, byStatus: Object.fromEntries(byStatus.map(r => [r.status, r.n])),
      byType: Object.fromEntries(byType.map(r => [r.type, r.n])), bySector: bySector.map(r => ({ sector: r.sector, count: r.n })) };
  }

  // ── credentials ──────────────────────────────────────────────────
  insertCredential(cred) {
    this.db.prepare('UPDATE credentials SET status = ?, replaced_by = ? WHERE nsp_id = ? AND kind = ? AND status = ?')
      .run('REPLACED', cred.serial, cred.nspId, cred.kind, 'ACTIVE');
    this.db.prepare('INSERT INTO credentials (serial, nsp_id, kind, status, issued_at, expires_at, token, payload) VALUES (?,?,?,?,?,?,?,?)')
      .run(cred.serial, cred.nspId, cred.kind, 'ACTIVE', cred.issuedAt, cred.expiresAt, cred.token, JSON.stringify(cred.payload));
    return this.getCredential(cred.serial);
  }
  getCredential(serial) {
    const r = this.db.prepare('SELECT * FROM credentials WHERE serial = ?').get(serial);
    return r ? { serial: r.serial, nspId: r.nsp_id, kind: r.kind, status: r.status, issuedAt: r.issued_at, expiresAt: r.expires_at, token: r.token, payload: JSON.parse(r.payload), replacedBy: r.replaced_by } : null;
  }
  activeCredential(nspId, kind) {
    const r = this.db.prepare('SELECT * FROM credentials WHERE nsp_id = ? AND kind = ? AND status = ? ORDER BY issued_at DESC LIMIT 1').get(nspId, kind, 'ACTIVE');
    return r ? this.getCredential(r.serial) : null;
  }
  listCredentials(nspId) {
    return this.db.prepare('SELECT serial, kind, status, issued_at, expires_at, replaced_by FROM credentials WHERE nsp_id = ? ORDER BY issued_at DESC').all(nspId)
      .map(r => ({ serial: r.serial, kind: r.kind, status: r.status, issuedAt: r.issued_at, expiresAt: r.expires_at, replacedBy: r.replaced_by }));
  }
  revokeCredentials(nspId) {
    this.db.prepare('UPDATE credentials SET status = ? WHERE nsp_id = ? AND status = ?').run('REVOKED', nspId, 'ACTIVE');
  }
  countCredentials(kind) {
    return this.db.prepare('SELECT COUNT(*) AS n FROM credentials WHERE kind = ?').get(kind).n;
  }

  // ── logs ─────────────────────────────────────────────────────────
  audit(actor, action, nspId, detail) {
    this.db.prepare('INSERT INTO audit_log (at, actor, action, nsp_id, detail) VALUES (?,?,?,?,?)')
      .run(new Date().toISOString(), actor, action, nspId || null, detail ? JSON.stringify(detail) : null);
  }
  auditFor(nspId) {
    return this.db.prepare('SELECT at, actor, action, detail FROM audit_log WHERE nsp_id = ? ORDER BY id ASC').all(nspId)
      .map(r => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null }));
  }
  logVerification(nspId, result, ip, ua) {
    this.db.prepare('INSERT INTO verification_log (at, nsp_id, result, ip, user_agent) VALUES (?,?,?,?,?)')
      .run(new Date().toISOString(), nspId || null, result, ip || null, (ua || '').slice(0, 200));
  }

  /** Newest-first audit trail across all records, for the registry desk. */
  auditRecent({ limit = 100, offset = 0, actor, action } = {}) {
    const where = []; const vals = [];
    if (actor) { where.push('actor = ?'); vals.push(actor); }
    if (action) { where.push('action = ?'); vals.push(action); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = this.db.prepare(`SELECT at, actor, action, nsp_id, detail FROM audit_log ${w} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...vals, Math.min(Number(limit) || 100, 500), Number(offset) || 0);
    const total = this.db.prepare(`SELECT COUNT(*) AS n FROM audit_log ${w}`).get(...vals).n;
    return { total, items: rows.map(r => ({ at: r.at, actor: r.actor, action: r.action, nspId: r.nsp_id, detail: r.detail ? JSON.parse(r.detail) : null })) };
  }

  // ── OTP ──────────────────────────────────────────────────────────
  insertOtp({ id, phone, salt, codeHash, expiresAt, ip }) {
    this.db.prepare('INSERT INTO otp_challenges (id, phone, salt, code_hash, created_at, expires_at, ip) VALUES (?,?,?,?,?,?,?)')
      .run(id, phone, salt, codeHash, new Date().toISOString(), expiresAt, ip || null);
  }
  getOtp(id) {
    const r = this.db.prepare('SELECT * FROM otp_challenges WHERE id = ?').get(id);
    return r ? { id: r.id, phone: r.phone, salt: r.salt, codeHash: r.code_hash, expiresAt: r.expires_at, attempts: r.attempts, consumed: !!r.consumed } : null;
  }
  bumpOtpAttempts(id) { this.db.prepare('UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = ?').run(id); }
  consumeOtp(id) { this.db.prepare('UPDATE otp_challenges SET consumed = 1 WHERE id = ?').run(id); }
  countOtpRequests(phone, sinceMs) {
    const since = new Date(Date.now() - sinceMs).toISOString();
    return this.db.prepare('SELECT COUNT(*) AS n FROM otp_challenges WHERE phone = ? AND created_at >= ?').get(phone, since).n;
  }
  lastOtpRequestAt(phone) {
    const r = this.db.prepare('SELECT created_at FROM otp_challenges WHERE phone = ? ORDER BY created_at DESC LIMIT 1').get(phone);
    return r ? r.created_at : null;
  }
  registrationTokenUsed(sig) { return !!this.db.prepare('SELECT 1 FROM used_reg_tokens WHERE signature = ?').get(sig); }
  useRegistrationToken(sig) {
    this.db.prepare('INSERT OR IGNORE INTO used_reg_tokens (signature, used_at) VALUES (?,?)').run(sig, new Date().toISOString());
  }

  // ── gate ─────────────────────────────────────────────────────────
  gateChallengeSeen(c) { return !!this.db.prepare('SELECT 1 FROM gate_challenges WHERE challenge = ?').get(c); }
  recordGateChallenge(c) {
    this.db.prepare('INSERT OR IGNORE INTO gate_challenges (challenge, used_at) VALUES (?,?)').run(c, new Date().toISOString());
  }
  recordRegistrationEvent({ nspId, ip, phone, district }) {
    this.db.prepare('INSERT INTO registration_events (at, nsp_id, ip, phone, district) VALUES (?,?,?,?,?)')
      .run(new Date().toISOString(), nspId || null, ip || null, phone || null, district || null);
  }
  countRecentRegistrations({ ip, phone, district, sinceMs }) {
    const since = new Date(Date.now() - sinceMs).toISOString();
    if (ip) return this.db.prepare('SELECT COUNT(*) AS n FROM registration_events WHERE ip = ? AND at >= ?').get(ip, since).n;
    if (phone) return this.db.prepare('SELECT COUNT(*) AS n FROM registration_events WHERE phone = ? AND at >= ?').get(phone, since).n;
    if (district) return this.db.prepare('SELECT COUNT(*) AS n FROM registration_events WHERE district = ? AND at >= ?').get(district, since).n;
    return 0;
  }

  /** Purge spent gate state. Called opportunistically; safe to run any time. */
  pruneGate(olderThanMs = 7 * 24 * 60 * 60 * 1000) {
    const cut = new Date(Date.now() - olderThanMs).toISOString();
    this.db.prepare('DELETE FROM otp_challenges WHERE created_at < ?').run(cut);
    this.db.prepare('DELETE FROM gate_challenges WHERE used_at < ?').run(cut);
    this.db.prepare('DELETE FROM used_reg_tokens WHERE used_at < ?').run(cut);
  }

  // ── fuzzy duplicate search ───────────────────────────────────────
  /**
   * Candidate records that share a distinguishing attribute with the
   * applicant. Deliberately a narrow indexed pre-filter; scoring happens in
   * dedup.js against this small set.
   */
  findDuplicateCandidates({ nameKey, dateOfBirth, fatherKey, phone, email, excludeNspId }) {
    const where = []; const vals = [];
    if (nameKey) { where.push('name_key = ?'); vals.push(nameKey); }
    if (dateOfBirth) { where.push('date_of_birth = ?'); vals.push(dateOfBirth); }
    if (fatherKey) { where.push('father_key = ?'); vals.push(fatherKey); }
    if (phone) { where.push('phone = ?'); vals.push(phone); }
    if (email) { where.push('email = ?'); vals.push(email); }
    if (!where.length) return [];
    let sql = `SELECT nsp_id, status, given_names, family_name, date_of_birth, name_key, father_key, phone, email
               FROM registrants WHERE (${where.join(' OR ')})`;
    if (excludeNspId) { sql += ' AND nsp_id != ?'; vals.push(excludeNspId); }
    return this.db.prepare(sql + ' LIMIT 50').all(...vals).map(r => ({
      nspId: r.nsp_id, status: r.status, givenNames: r.given_names, familyName: r.family_name,
      dateOfBirth: r.date_of_birth, nameKey: r.name_key, fatherKey: r.father_key, phone: r.phone, email: r.email
    }));
  }

  setGateColumns(nspId, { nameKey, fatherKey, assuranceTier, phoneVerified, dedupFlags, registeredIp }) {
    this.db.prepare(`UPDATE registrants SET name_key = ?, father_key = ?, assurance_tier = ?, phone_verified = ?,
      dedup_flags = ?, registered_ip = ? WHERE nsp_id = ?`).run(
      nameKey || null, fatherKey || null, assuranceTier || 'NSP-1', phoneVerified ? 1 : 0,
      dedupFlags ? JSON.stringify(dedupFlags) : null, registeredIp || null, nspId);
  }

  close() { this.db.close(); }
}

module.exports = { Store };
