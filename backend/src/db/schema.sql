-- Priority Mail — PostgreSQL schema
-- Run automatically on backend startup via migrate.ts

CREATE TABLE IF NOT EXISTS emails (
  id              TEXT PRIMARY KEY,
  thread_id       TEXT,
  subject         TEXT NOT NULL DEFAULT '',
  from_address    TEXT NOT NULL DEFAULT '',
  to_address      TEXT NOT NULL DEFAULT '',
  received_at     TIMESTAMPTZ,
  body            TEXT,
  snippet         TEXT,
  labels          TEXT[],
  is_unread       BOOLEAN DEFAULT TRUE,

  -- AI / Rules classification
  priority        TEXT CHECK (priority IN ('High','Medium','Low')),
  category        TEXT,
  priority_reason TEXT,
  reply_needed    BOOLEAN DEFAULT FALSE,
  task_needed     BOOLEAN DEFAULT FALSE,
  task_title      TEXT,
  due_date_guess  DATE,
  reply_draft     TEXT,
  confidence      FLOAT,
  rule_fired      TEXT,
  classified_by   TEXT,

  -- User feedback
  user_action     TEXT CHECK (user_action IN ('approved','dismissed','corrected') OR user_action IS NULL),
  user_category   TEXT,
  actioned_at     TIMESTAMPTZ,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_emails_priority ON emails (priority);
CREATE INDEX IF NOT EXISTS idx_emails_received_at ON emails (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_emails_is_unread ON emails (is_unread);

-- ── Multi-source columns (migration — safe to run multiple times) ─────────────
ALTER TABLE emails
  ADD COLUMN IF NOT EXISTS source        TEXT NOT NULL DEFAULT 'gmail',
  ADD COLUMN IF NOT EXISTS account_email TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_emails_source        ON emails (source);
CREATE INDEX IF NOT EXISTS idx_emails_account_email ON emails (account_email);
