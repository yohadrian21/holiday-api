-- Holiday data (populated from data/holidays/<year>.json via seed/seed.sql)
CREATE TABLE data_versions (
  version    TEXT    NOT NULL,
  year       INTEGER NOT NULL,
  source_ref TEXT    NOT NULL,
  source_url TEXT    NOT NULL,
  updated_at TEXT    NOT NULL,
  notes      TEXT,
  PRIMARY KEY (year, version)
);

CREATE TABLE holidays (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  date         TEXT    NOT NULL,
  year         INTEGER NOT NULL,
  name_id      TEXT    NOT NULL,
  name_en      TEXT    NOT NULL,
  type         TEXT    NOT NULL CHECK (type IN ('national', 'cuti_bersama')),
  source_ref   TEXT    NOT NULL,
  source_url   TEXT    NOT NULL,
  data_version TEXT    NOT NULL,
  UNIQUE (date, type, name_id)
);
CREATE INDEX idx_holidays_year ON holidays (year);

-- API keys: only the SHA-256 hex hash of the key is stored.
CREATE TABLE api_keys (
  id         TEXT PRIMARY KEY,
  key_hash   TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  name       TEXT NOT NULL,
  tier       TEXT NOT NULL CHECK (tier IN ('free', 'starter', 'business')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  revoked_at TEXT
);

-- Monthly usage per key; period is 'YYYY-MM' in Asia/Jakarta. key_id may be the synthetic 'rapidapi'.
CREATE TABLE usage (
  key_id TEXT    NOT NULL,
  period TEXT    NOT NULL,
  count  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, period)
);
