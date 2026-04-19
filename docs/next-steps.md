# Priority Mail — Next Steps Plan
## Building from the Working Gmail Connector POC

> Status: Gmail connector is live and fetching real emails into `NormalizedEmail` objects.
> This document is the concrete dev plan for what to build next.

---

## What We Learned from the POC Data

Looking at the real `emails.json` output, a few things stand out:

| Observation | Impact |
|---|---|
| Marketing emails (Subway, Lowe's) return raw HTML in `body` | Need HTML stripping before AI sees it |
| Gmail already labels emails `CATEGORY_PROMOTIONS` / `CATEGORY_UPDATES` | We can use these labels as a free pre-filter in the Rules Engine |
| Email #6 (FL annual report, $400 late fee, 12 days left) is clearly **High Priority** | Exactly the kind of email the AI needs to catch |
| Email #1 (Google security alert) is **High Priority** but currently sits next to spam | Priority ranking is critical |
| Most of the 20 emails are newsletters or promotions | 80%+ of inbox clutter can be flagged without AI |

---

## Immediate Fix: HTML Body Stripping

The `normalize.ts` currently extracts the plain-text MIME part. When no plain-text part exists, it falls back to the raw body — which for marketing emails is a wall of HTML.

**Fix:** Add an HTML-to-text fallback using a lightweight stripper.

### Files to change
```
connectors/gmail/src/normalize.ts
```

### What to add
- Install `html-to-text` npm package
- In `extractPlainText()`: if no `text/plain` part is found, look for a `text/html` part and strip the tags
- Also strip sequences of invisible Unicode characters (`\u200c`, `\ufeff`, etc.) that email clients use as tracking pixels — these appear as garbage in the Subway snippet

---

## Step 1 — Rules Engine
> **Goal:** Pre-classify emails with deterministic rules before any AI call.
> Cost: $0. Speed: instant.

### Location
```
connectors/gmail/src/rules-engine.ts
```

### Input / Output
```typescript
// Input: NormalizedEmail
// Output: Partial<Classification> — fields the rule filled in (rest goes to AI)
interface RulesResult {
  priority?: "High" | "Medium" | "Low";
  category?: string;
  confidence: number;       // 1.0 if hard rule fired, lower otherwise
  rule_fired?: string;      // e.g. "gmail_promotions_label"
  skip_ai?: boolean;        // if true, don't bother calling OpenRouter
}
```

### Rules to implement

| Rule | Result |
|---|---|
| Gmail label = `CATEGORY_PROMOTIONS` | Low / Newsletter-Marketing / skip_ai=true |
| Gmail label = `CATEGORY_SOCIAL` | Low / Newsletter-Marketing / skip_ai=true |
| Subject matches `/invoice|payment due|past due/i` | High / Billing-Invoice |
| Subject matches `/\d+ day[s]? (left\|remaining\|until)/i` | High (deadline detected) |
| From domain = known newsletter (substack.com, morningbrew.com) | Low / Newsletter |
| From = `no-reply@accounts.google.com` | Medium / Security-Alert |
| Gmail label = `CATEGORY_UPDATES` | Medium |
| Body contains "annual report due" | High / Billing-Invoice |

---

## Step 2 — AI Classification Service
> **Goal:** For every email that the Rules Engine doesn't fully resolve, call OpenRouter
> and get a structured classification.

### Location
```
connectors/gmail/src/ai-classifier.ts
```

### API: OpenRouter (model: `meta-llama/llama-3.1-8b-instruct` for cost, or `openai/gpt-4o-mini`)

### Environment variables to add
```
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=meta-llama/llama-3.1-8b-instruct
```

### Prompt structure
The prompt should send a **minimal representation** of the email (not raw HTML):
```
Subject: {{subject}}
From: {{from}}
Date: {{date}}
Labels: {{labels}}
Body (first 500 chars): {{body}}
```

### Expected JSON response schema
```typescript
interface AIClassification {
  priority: "High" | "Medium" | "Low";
  category:
    | "Client Request"
    | "Internal Team"
    | "Billing / Invoice"
    | "Sales Lead"
    | "Support Issue"
    | "Waiting On Someone Else"
    | "Newsletter / Marketing"
    | "Spam / Low Importance"
    | "Security Alert"
    | "Real Estate"
    | "Financial Update"
    | "Other";
  priority_reason: string;       // 1 sentence explaining why
  reply_needed: boolean;
  task_needed: boolean;
  task_title?: string;
  due_date_guess?: string;       // ISO date or null
  reply_draft?: string;          // short draft if reply_needed
  confidence: number;            // 0.0–1.0
}
```

### Safeguards
- Validate the JSON response schema — if invalid, re-try once then mark confidence=0
- Truncate body to 800 chars before sending (saves tokens)
- Skip AI call entirely if `rules_result.skip_ai === true`

---

## Step 3 — Combine: `triage-pipeline.ts`
> **Goal:** Wire the connector → rules → AI together into a single pipeline.

```
connectors/gmail/src/triage-pipeline.ts
```

```typescript
// For each NormalizedEmail:
// 1. Run Rules Engine
// 2. If skip_ai=false, run AI Classifier
// 3. Merge results (rules take precedence where confidence=1.0)
// 4. Return TriagedEmail

interface TriagedEmail extends NormalizedEmail {
  classification: AIClassification;
  rule_fired?: string;
}
```

Update `src/index.ts` to run the pipeline and write `output/triaged.json`.

---

## Step 4 — Backend API (Express)
> **Goal:** Expose a REST API so the frontend can read triaged emails.

### Location
```
backend/
├── src/
│   ├── server.ts
│   ├── routes/
│   │   └── emails.ts
│   └── db/
│       └── schema.sql
├── package.json
├── tsconfig.json
└── Dockerfile
```

### Endpoints (Phase 1)
```
GET  /emails          → list triaged emails, sorted by priority
GET  /emails/:id      → single email with full body + classification
POST /emails/:id/action  → user approves / dismisses / corrects
```

### Database schema (PostgreSQL)
```sql
CREATE TABLE emails (
  id            TEXT PRIMARY KEY,       -- Gmail message ID
  thread_id     TEXT,
  subject       TEXT,
  from_address  TEXT,
  to_address    TEXT,
  received_at   TIMESTAMPTZ,
  body          TEXT,
  snippet       TEXT,
  labels        TEXT[],
  is_unread     BOOLEAN,
  -- Classification
  priority      TEXT,
  category      TEXT,
  priority_reason TEXT,
  reply_needed  BOOLEAN,
  task_needed   BOOLEAN,
  task_title    TEXT,
  due_date_guess DATE,
  reply_draft   TEXT,
  confidence    FLOAT,
  rule_fired    TEXT,
  -- User feedback
  user_action   TEXT,                   -- "approved" | "dismissed" | "corrected"
  user_category TEXT,                   -- corrected category (if corrected)
  actioned_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Step 5 — Docker Compose Expansion

Add PostgreSQL and Redis to `docker-compose.yml`:

```yaml
services:
  gmail-connector:    # existing
    ...

  backend:
    build: ./backend
    env_file: ./backend/.env
    ports:
      - "4000:4000"
    depends_on:
      - postgres

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: prioritymail
      POSTGRES_USER: pm_user
      POSTGRES_PASSWORD: pm_pass
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  pgdata:
```

---

## Step 6 — Frontend Dashboard (Next.js)
> **Goal:** Simple UI to view, approve, and act on triaged emails.

### Location
```
frontend/
├── src/
│   ├── app/
│   │   ├── page.tsx            ← Inbox view
│   │   └── email/[id]/page.tsx ← Single email detail
│   └── components/
│       ├── EmailList.tsx
│       ├── EmailCard.tsx
│       ├── PriorityBadge.tsx
│       └── ActionPanel.tsx
```

### Key views

**Inbox View**
- Sorted by priority (High → Medium → Low)
- Each row shows: priority badge, subject, from, date, category, snippet
- Click → detail view

**Email Detail View**
- Full body (stripped of HTML garbage)
- Classification card: priority, category, reason, confidence
- Task card (if task_needed): title, due date, next step
- Reply draft (if reply_needed): editable, "Copy" button
- Action buttons: ✅ Approve / ❌ Dismiss / ✏️ Correct

---

## Build Order Summary

```
Week 1
├── [x] Gmail connector POC (DONE)
├── [ ] Fix HTML body stripping in normalize.ts
├── [ ] Rules Engine (rules-engine.ts)
└── [ ] AI Classifier (ai-classifier.ts + OpenRouter key)

Week 2
├── [ ] Triage pipeline (triage-pipeline.ts)
├── [ ] Test on real inbox data — review triaged.json
└── [ ] Backend API scaffold (Express + routes)

Week 3
├── [ ] PostgreSQL schema + migrations
├── [ ] Docker Compose expansion (postgres, redis, backend)
└── [ ] Frontend scaffold (Next.js inbox view)

Week 4
├── [ ] Email detail view + action panel
├── [ ] User feedback loop (POST /emails/:id/action)
└── [ ] End-to-end test: fetch → triage → display → approve
```

---

## Open Decisions to Make Before Week 2

1. **OpenRouter model** — cheapest capable model for classification? `llama-3.1-8b-instruct` vs `gpt-4o-mini`
2. **Polling vs webhook** — fetch on-demand (cron) or use Gmail push notifications (Google Pub/Sub)?
3. **Single user or multi-user** — keep it single-user for the MVP?
4. **Task storage** — internal DB only for now, or integrate with an existing task manager from day 1?
