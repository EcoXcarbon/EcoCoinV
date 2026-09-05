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
`;

class Store {
  constructor(file) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
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
        verifiedAt: row.verified_at, verifiedBy: row.verified_by, issuedAt: row.issued_at, expiresAt: row.expires_at,
        suspendedAt: row.suspended_at, revokedAt: row.revoked_at, revokeReason: row.revoke_reason, rejectedReason: row.rejected_reason
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
  close() { this.db.close(); }
}

module.exports = { Store };
