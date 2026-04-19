# Database

## Overview

Priority Mail uses **PostgreSQL 16** as its primary data store. The schema is a single `emails` table that holds both normalized email data and triage/classification results.

The schema is applied automatically on backend startup via `migrate()` in `backend/src/db/client.ts`. It uses `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`, so it is safe to run repeatedly.

---

## Connection

The backend connects using the `pg` library with a connection pool:

```typescript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
```

**Local / Docker Compose:**
```
DATABASE_URL=postgres://pm_user:pm_pass@postgres:5432/prioritymail
```

**Local dev (PostgreSQL running on host):**
```
DATABASE_URL=postgres://pm_user:pm_pass@localhost:5432/prioritymail
```

---

## Schema

File: `backend/src/db/schema.sql`

```sql
CREATE TABLE IF NOT EXISTS emails (
  id              TEXT PRIMARY KEY,      -- provider message ID (primary key)
  thread_id       TEXT,
  subject         TEXT NOT NULL DEFAULT '',
  from_address    TEXT NOT NULL DEFAULT '',
  to_address      TEXT NOT NULL DEFAULT '',
  received_at     TIMESTAMPTZ,
  body            TEXT,
  snippet         TEXT,
  labels          TEXT[],                -- Gmail label IDs
  is_unread       BOOLEAN DEFAULT TRUE,

  -- Source tracking (multi-provider)
  source          TEXT DEFAULT 'gmail',   -- "gmail" | "o365"
  account_email   TEXT DEFAULT '',        -- mailbox address

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
  rule_fired      TEXT,                  -- name of the rules-engine rule that fired
  classified_by   TEXT,                  -- "rules" | "ai" | "rules+ai"

  -- User feedback
  user_action     TEXT CHECK (user_action IN ('approved','dismissed','corrected') OR user_action IS NULL),
  user_category   TEXT,                  -- corrected category (only set when corrected)
  actioned_at     TIMESTAMPTZ,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_emails_priority    ON emails (priority);
CREATE INDEX IF NOT EXISTS idx_emails_received_at ON emails (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_emails_is_unread   ON emails (is_unread);
```

---

## Column Reference

### Email Data

| Column | Type | Description |
|---|---|---|
| `id` | TEXT | Provider message ID — primary key |
| `thread_id` | TEXT | Thread / conversation ID |
| `subject` | TEXT | Email subject line |
| `from_address` | TEXT | Sender (may include display name, e.g. `Alice <alice@example.com>`) |
| `to_address` | TEXT | Recipient |
| `received_at` | TIMESTAMPTZ | Message date parsed from headers |
| `body` | TEXT | Clean plain-text body (HTML stripped, quoted history removed) |
| `snippet` | TEXT | Short preview from the provider |
| `labels` | TEXT[] | Gmail label IDs or O365 categories (e.g. `["INBOX", "UNREAD"]`) |
| `is_unread` | BOOLEAN | Whether the email is unread at time of fetch |
| `source` | TEXT | `"gmail"` \| `"o365"` — which provider this email came from |
| `account_email` | TEXT | The mailbox address (e.g. `"you@gmail.com"`) |

### Classification Fields

| Column | Type | Description |
|---|---|---|
| `priority` | TEXT | `High` \| `Medium` \| `Low` |
| `category` | TEXT | Email category (see `rules-engine.ts` for the full list) |
| `priority_reason` | TEXT | One-sentence explanation from AI |
| `reply_needed` | BOOLEAN | Whether a reply is suggested |
| `task_needed` | BOOLEAN | Whether a task was identified |
| `task_title` | TEXT | AI-suggested task title |
| `due_date_guess` | DATE | Estimated due date |
| `reply_draft` | TEXT | AI-generated draft reply |
| `confidence` | FLOAT | Classification confidence (0.0–1.0) |
| `rule_fired` | TEXT | Name of the matching rule (e.g. `subject_billing_keywords`) |
| `classified_by` | TEXT | `rules` \| `ai` \| `rules+ai` |

### User Feedback Fields

| Column | Type | Description |
|---|---|---|
| `user_action` | TEXT | `approved` \| `dismissed` \| `corrected` |
| `user_category` | TEXT | User-supplied corrected category (only when `user_action = 'corrected'`) |
| `actioned_at` | TIMESTAMPTZ | When the user actioned the email |

### Audit Fields

| Column | Type | Description |
|---|---|---|
| `created_at` | TIMESTAMPTZ | When the row was first inserted |
| `updated_at` | TIMESTAMPTZ | When the row was last updated (set by upsert) |

---

## Indexes

| Index | Column | Purpose |
|---|---|---|
| `idx_emails_priority` | `priority` | Filter/sort by priority level |
| `idx_emails_received_at` | `received_at DESC` | Sort by date descending |
| `idx_emails_is_unread` | `is_unread` | Filter unread emails |

---

## Upsert Behavior

The `POST /emails/ingest` endpoint uses `INSERT ... ON CONFLICT (id) DO UPDATE`. On re-ingest of the same email:

- Classification fields (`priority`, `category`, `priority_reason`, etc.) are updated
- `updated_at` is set to `NOW()`
- User feedback fields (`user_action`, `user_category`, `actioned_at`) are **not** overwritten — they preserve the user's decision

---

## Docker Volume

PostgreSQL data is persisted in a named Docker volume `pgdata`:

```yaml
volumes:
  pgdata: {}

services:
  postgres:
    image: postgres:16-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data
```

The volume survives `docker compose down` and is only removed with `docker compose down -v`.

---

## Migrations

There is currently no migration framework. The schema is applied via a single `schema.sql` file on startup using `CREATE TABLE IF NOT EXISTS`. 

**Adding new columns:** Add the column to `schema.sql`. For existing deployments the column must be added manually via `ALTER TABLE` until a migration tool is introduced (see `KNOWN_ISSUES.md`).

**0.4.0 migration** — the `source` and `account_email` columns were added in v0.4.0. The backend's `migrate()` function applies these via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements that are safe to re-run on an existing database.
