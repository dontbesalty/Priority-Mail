# Architecture

## System Overview

```
[ Browser / Dashboard ]
        │  HTTP (server-side fetch via SSR)
        │  HTTP (client-side via /api proxy rewrite)
        ▼
[ Next.js Frontend — port 3000 ]
        │  /api/* → rewrites to backend
        ▼
[ Express Backend API — port 4000 ]
        │  pg Pool
        ▼
[ PostgreSQL — port 5432 ]

[ Gmail Connector — one-shot job ]
        │  Gmail API (OAuth2)
        ▼
[ Google Gmail API ]
        │  normalized emails
        ▼
[ Rules Engine ]          ← deterministic, no external calls
        │  skip_ai=false
        ▼
[ AI Triage ]
        ├── cloud_ai → OpenRouter API  (default)
        └── local_ai → LOCAL_AI_URL    (confidential emails only)
        │
        ▼
[ POST /emails/ingest → Backend API ]
```

---

## Services

### `connectors/gmail` — Gmail Connector

Runs as a **one-shot Docker job**. Entry point: `src/index.ts`.

| File | Responsibility |
|---|---|
| `auth.ts` | One-time OAuth2 flow — exchanges auth code for a refresh token |
| `gmail-connector.ts` | Authenticates with a stored refresh token, fetches raw Gmail messages |
| `normalize.ts` | Converts raw Gmail API response → `NormalizedEmail` (HTML stripping, MIME parsing, quoted history removal) |
| `rules-engine.ts` | Deterministic pre-classifier — returns `RulesResult` with `priority`, `category`, `skip_ai`, `local_ai_only` |
| `ai-classifier.ts` | Calls OpenRouter or a local Ollama endpoint, validates and returns `AIClassification` |
| `triage-pipeline.ts` | Orchestrates rules → AI, merges results, runs batch with configurable concurrency |
| `index.ts` | Entry point: fetch → triage → write `output/triaged.json` → POST to backend |

**Data flow:**
```
fetchEmails() → NormalizedEmail[]
  → triageBatch()
      → applyRules()     → RulesResult
      → classifyWithAI() → AIClassification  (if not skip_ai)
      → merge            → TriagedEmail
  → writeOutput()        → output/triaged.json
  → postToBackend()      → POST /emails/ingest
```

### `backend` — REST API

Node.js + Express, TypeScript. Entry point: `src/server.ts`.

| File | Responsibility |
|---|---|
| `server.ts` | Express setup, CORS, JSON body parser, route mounting, startup with auto-migration |
| `db/client.ts` | `pg.Pool` singleton, `migrate()` applies schema on startup |
| `db/schema.sql` | PostgreSQL schema — single `emails` table |
| `routes/emails.ts` | All email CRUD and ingest routes |

### `frontend` — Next.js Dashboard

Next.js 14 App Router, TypeScript, Tailwind CSS.

| File | Responsibility |
|---|---|
| `src/app/page.tsx` | Inbox view — SSR, fetches all unread unactioned emails, sorted by priority |
| `src/app/email/[id]/page.tsx` | Email detail — full body, classification card, task card, draft reply, action buttons |
| `src/app/api/[...path]/route.ts` | Catch-all proxy — forwards browser requests to the backend service |
| `src/lib/api.ts` | Typed fetch wrappers: `getEmails`, `getEmail`, `actionEmail` |

---

## Data Models

### `NormalizedEmail`

Produced by `normalize.ts` from raw Gmail API responses.

```typescript
interface NormalizedEmail {
  id: string;          // Gmail message ID
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: string;        // ISO string
  snippet: string;     // short preview from Gmail
  body: string;        // clean plain-text body
  isUnread: boolean;
  labels: string[];    // Gmail label IDs
}
```

### `AIClassification`

Produced by `ai-classifier.ts`, validated against a strict schema.

```typescript
interface AIClassification {
  priority: "High" | "Medium" | "Low";
  category: Category;       // see rules-engine.ts for the full union type
  priority_reason: string;  // one-sentence explanation
  reply_needed: boolean;
  task_needed: boolean;
  task_title?: string;
  due_date_guess?: string;  // ISO date string or null
  reply_draft?: string;
  confidence: number;       // 0.0–1.0
}
```

### `TriagedEmail`

Produced by `triage-pipeline.ts`. Combines `NormalizedEmail` + classification metadata.

```typescript
interface TriagedEmail extends NormalizedEmail {
  classification: AIClassification;
  rule_fired?: string;
  classified_by: "rules" | "ai" | "rules+ai";
}
```

---

## Key Flows

### Rules Engine Decision Logic

```
email
  → CATEGORY_PROMOTIONS label?      → Low / Newsletter / skip_ai=true
  → CATEGORY_SOCIAL label?          → Low / Newsletter / skip_ai=true
  → Known newsletter domain?        → Low / Newsletter / skip_ai=true
  → Known promo domain?             → Low / Newsletter / skip_ai=true
  → Real estate domain?             → Low / Real Estate / skip_ai=true
  → Security sender domain?         → Medium / Security Alert / skip_ai=true
  → Security subject keywords?      → Medium / Security Alert / skip_ai=true
  → Confidential language in text?  → High / Client Request / local_ai_only=true
  → Billing/invoice keyword?        → High / Billing Invoice / skip_ai=false
  → Deadline keyword?               → High / Other / skip_ai=false
  → Compliance/fee body keyword?    → High / Billing Invoice / skip_ai=false
  → CATEGORY_UPDATES label?         → Medium / Other / skip_ai=false
  → (no match)                      → confidence=0 / skip_ai=false → full AI
```

### User Feedback Loop

1. User views an email in the dashboard
2. User clicks Approve / Dismiss / Correct
3. Frontend POSTs to `POST /emails/:id/action` with `{ action, category? }`
4. Backend records `user_action`, `user_category`, `actioned_at` on the email row
5. Corrected classifications are stored for future prompt tuning (Phase 4)

---

## Network Topology (Docker)

All services run on the `prioritymail` bridge network. Internal service names resolve as hostnames.

| Service | Internal host | Port |
|---|---|---|
| `postgres` | `postgres` | `5432` |
| `redis` | `redis` | `6379` |
| `backend` | `backend` | `4000` |
| `frontend` | `frontend` | `3000` |
| `gmail-connector` | `gmail-connector` | — (one-shot) |

The backend is never exposed directly when running behind the frontend proxy in production.
