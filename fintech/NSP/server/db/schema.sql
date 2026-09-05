-- National Skill Passport Registry — PostgreSQL schema (mirror of server/lib/store.js)
CREATE TABLE IF NOT EXISTS sequences (
  country CHAR(2) NOT NULL, year INT NOT NULL, last INT NOT NULL DEFAULT 0,
  PRIMARY KEY (country, year)
);

CREATE TABLE IF NOT EXISTS registrants (
  nsp_id             VARCHAR(22) PRIMARY KEY,           -- NSP-CC-YY-NNNNNNN-K
  status             VARCHAR(16) NOT NULL,              -- SUBMITTED|UNDER_REVIEW|VERIFIED|ISSUED|SUSPENDED|REVOKED|EXPIRED|REJECTED
  type               VARCHAR(16) NOT NULL,              -- STUDENT|APPRENTICE|WORKER|PROFESSIONAL
  given_names        VARCHAR(80) NOT NULL,
  family_name        VARCHAR(80) NOT NULL,
  date_of_birth      DATE NOT NULL,
  sex                CHAR(1) NOT NULL,                  -- M|F|X (ICAO 9303)
  nationality        CHAR(2) NOT NULL,                  -- ISO 3166-1 alpha-2
  id_document_type   VARCHAR(16) NOT NULL,
  id_document_number VARCHAR(40) NOT NULL,
  email              VARCHAR(120) NOT NULL,
  phone              VARCHAR(20) NOT NULL,              -- E.164
  primary_isco       CHAR(4),                           -- ISCO-08 unit group
  primary_skill      VARCHAR(120),
  sector             VARCHAR(30),
  payload            JSONB NOT NULL,                    -- full registration document
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at       TIMESTAMPTZ, verified_at TIMESTAMPTZ, verified_by VARCHAR(60),
  issued_at          TIMESTAMPTZ, expires_at DATE,
  suspended_at       TIMESTAMPTZ, revoked_at TIMESTAMPTZ, revoke_reason TEXT, rejected_reason TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_registrants_iddoc ON registrants (nationality, id_document_type, id_document_number);
CREATE INDEX IF NOT EXISTS ix_registrants_email  ON registrants (email);
CREATE INDEX IF NOT EXISTS ix_registrants_status ON registrants (status);
CREATE INDEX IF NOT EXISTS ix_registrants_family ON registrants (family_name);
CREATE INDEX IF NOT EXISTS ix_registrants_payload ON registrants USING GIN (payload);

CREATE TABLE IF NOT EXISTS credentials (
  serial      VARCHAR(24) PRIMARY KEY,                  -- C26NNNNNNN (card) | NSP-CERT-YY-NNNNNNN
  nsp_id      VARCHAR(22) NOT NULL REFERENCES registrants (nsp_id),
  kind        VARCHAR(12) NOT NULL,                     -- CARD|CERTIFICATE
  status      VARCHAR(10) NOT NULL,                     -- ACTIVE|REPLACED|REVOKED
  issued_at   TIMESTAMPTZ NOT NULL, expires_at DATE,
  token       TEXT NOT NULL,                            -- Ed25519-signed QR token
  payload     JSONB NOT NULL,                           -- print snapshot
  replaced_by VARCHAR(24)
);
CREATE INDEX IF NOT EXISTS ix_credentials_nsp ON credentials (nsp_id, kind);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor VARCHAR(60) NOT NULL, action VARCHAR(24) NOT NULL, nsp_id VARCHAR(22), detail JSONB
);
CREATE TABLE IF NOT EXISTS verification_log (
  id BIGSERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(),
  nsp_id VARCHAR(22), result VARCHAR(24) NOT NULL, ip INET, user_agent VARCHAR(200)
);
