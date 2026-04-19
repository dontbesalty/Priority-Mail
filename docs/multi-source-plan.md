# Multi-Source Inbox Plan
## Adding O365 / Outlook alongside Gmail (single-user)

---

## 1. Goal

Keep everything as single-user, but allow the one user to connect both a Gmail inbox **and** an O365 / Outlook inbox at the same time. Every email in the dashboard should show a small source badge (`Gmail` or `Outlook`) so it's always clear which account it came from.

---

## 2. What Has to Change — Overview

| Layer | Change |
|---|---|
| `NormalizedEmail` (shared type) | Add `source` + `accountEmail` fields |
| `emails` DB table | Add `source` + `account_email` columns |
| `id` field in DB | Prefix with source to prevent collisions |
| Shared connector code | Extract to `connectors/shared/` package |
| New O365 connector | `connectors/o365/` using Microsoft Graph API |
| Backend ingest route | Save new `source` / `account_email` columns |
| Frontend inbox | Source badge on each email card |
| Frontend email detail | Source badge in header |
| `docker-compose.yml` | Add `o365-connector` service |

---

## 3. Data Model Changes

### 3.1 — NormalizedEmail (shared type)

Add two new required fields:

```typescript
export interface NormalizedEmail {
  id: string;         // prefixed: "gmail:abc123"  or  "o365:xyz456"
  threadId: string;   // prefixed: "gmail:thr123"  or  "o365:thr456"
  source: "gmail" | "o365";   // ← NEW
  accountEmail: string;        // ← NEW  e.g. "jake@gmail.com" / "jake@contoso.com"
  subject: string;
  from: string;
  to: string;
  date: string;
  snippet: string;
  body: string;
  isUnread: boolean;
  labels: string[];   // Gmail label IDs  or  O365 category names
}
```

> **Why prefix the ID?** Gmail and O365 both generate their own message IDs.
> A Gmail ID and an O365 ID could theoretically collide in the shared PostgreSQL table.
> Prefixing makes every stored ID globally unique with no extra columns needed.

### 3.2 — PostgreSQL schema migration

```sql
ALTER TABLE emails
  ADD COLUMN IF NOT EXISTS source        TEXT DEFAULT 'gmail',
  ADD COLUMN IF NOT EXISTS account_email TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_emails_source        ON emails (source);
CREATE INDEX IF NOT EXISTS idx_emails_account_email ON emails (account_email);
```

The migration runs automatically on backend startup (existing migrate pattern).

---

## 4. Shared Connector Code — Extract to `connectors/shared/`

Right now the triage logic lives inside `connectors/gmail/src/`. The O365 connector needs the same code. Rather than copy-paste, extract the shared modules into a common package.

### New directory structure

```
connectors/
  shared/
    package.json          (name: "@prioritymail/connector-shared")
    tsconfig.json
    src/
      normalize.ts        ← NormalizedEmail interface + HTML/text helpers
      rules-engine.ts     ← applyRules (unchanged)
      ai-classifier.ts    ← classifyWithAI + classifyWithLocalAI (unchanged)
      triage-pipeline.ts  ← triageEmail + triageBatch (unchanged)
  gmail/
    src/
      gmail-connector.ts  ← imports from @prioritymail/connector-shared
      normalize.ts        ← Gmail-specific normalizeMessage(), calls shared helpers
      auth.ts
      index.ts
  o365/
    src/
      o365-connector.ts
      normalize.ts        ← O365-specific normalizeMessage(), calls shared helpers
      auth.ts
      index.ts
    package.json
    tsconfig.json
    Dockerfile
    .env.example
```

Both connectors declare `"@prioritymail/connector-shared": "file:../shared"` in their `package.json`.

---

## 5. O365 Connector — `connectors/o365/`

### 5.1 — Authentication (MSAL device-code / OAuth)

Use `@azure/msal-node` with the **Authorization Code + PKCE** flow (same concept as Gmail's OAuth desktop flow).

Required Azure App Registration settings:
- Platform: **Mobile and desktop application**
- Redirect URI: `http://localhost:{AUTH_PORT}/callback`
- API permissions: `Mail.Read`, `offline_access`, `User.Read`
- Token type: **delegated** (single user, no admin consent needed for personal accounts)

`connectors/o365/src/auth.ts` — one-time auth script:
1. Open browser to Microsoft login
2. Catch the callback on local server
3. Exchange code for tokens
4. Print the `refresh_token` for the user to paste into `.env`

### 5.2 — Fetching emails (Microsoft Graph)

Endpoint:
```
GET https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages
  ?$filter=isRead eq false
  &$top={FETCH_LIMIT}
  &$select=id,subject,from,toRecipients,receivedDateTime,bodyPreview,body,categories,isRead
  &$expand=singleValueExtendedProperties(...)
```

Token refresh: exchange `OUTLOOK_REFRESH_TOKEN` for a new access token using MSAL before each run.

### 5.3 — Normalization (`connectors/o365/src/normalize.ts`)

Maps the Graph API response shape to `NormalizedEmail`:

```
message.id                     → "o365:" + message.id
message.conversationId         → "o365:" + message.conversationId
"o365"                         → source
accountEmail (from env)        → accountEmail
message.subject                → subject
message.from.emailAddress.name + address → from
message.toRecipients[0]        → to
message.receivedDateTime       → date
message.bodyPreview            → snippet
message.body.content           → body (stripHtml if contentType="html")
!message.isRead                → isUnread
message.categories             → labels (O365 uses named categories, not IDs)
```

### 5.4 — `.env.example` for O365 connector

```env
# Azure App Registration
OUTLOOK_CLIENT_ID=your-azure-app-client-id
OUTLOOK_CLIENT_SECRET=your-azure-app-client-secret   # leave blank for public client
OUTLOOK_TENANT_ID=consumers   # use "consumers" for personal accounts, tenant ID for org

# The Outlook account email (shown as source tag in UI)
OUTLOOK_ACCOUNT_EMAIL=jake@outlook.com

# After running: npm run auth
OUTLOOK_REFRESH_TOKEN=

# ─── Shared with Gmail connector ───
AUTH_PORT=3001                 # different port so both can run simultaneously
FETCH_LIMIT=20
BACKEND_URL=http://backend:4000
OPENROUTER_API_KEY=
OPENROUTER_MODEL=openai/gpt-oss-20b:free
LOCAL_AI_URL=
LOCAL_AI_MODEL=llama3.2
```

---

## 6. Backend Changes

### 6.1 — Ingest route (`backend/src/routes/emails.ts`)

The `POST /emails/ingest` body already accepts an array. Add `source` and `account_email` to the insert:

```typescript
// existing insert columns:
id, thread_id, subject, from_address, to_address, received_at, body, snippet,
labels, is_unread, priority, category, ...

// add:
source,        // "gmail" | "o365"
account_email  // "jake@gmail.com" | "jake@contoso.com"
```

Because the ID is now prefixed (`"gmail:abc"` / `"o365:xyz"`), the upsert `ON CONFLICT (id)` still works correctly — each source's emails have a separate namespace.

### 6.2 — GET /emails — filtering (optional, Phase 2)

Add an optional `?source=gmail` or `?source=o365` query param so the frontend can filter by source in a later phase.

---

## 7. Frontend Changes

### 7.1 — Source badge component

A small pill badge shown on every email row + detail page:

```
[G]  Gmail        → blue badge, "Gmail"
[O]  Outlook      → cyan badge, "Outlook"
```

Colors chosen to be distinguishable at a glance but not distracting.

### 7.2 — Inbox page (`frontend/src/app/page.tsx`)

- Add source badge next to the sender name on each email row
- Add two filter buttons at the top: **All** | **Gmail** | **Outlook**
  - Default: All (merged, sorted by priority + date)
  - Filtered view shows only that source

### 7.3 — Email detail page (`frontend/src/app/email/[id]/page.tsx`)

- Show source badge in the email header alongside the From address
- No other changes needed

---

## 8. Docker Compose Changes

Add the O365 connector as a separate one-shot service alongside the Gmail connector:

```yaml
o365-connector:
  build: ./connectors/o365
  env_file: ./connectors/o365/.env
  depends_on:
    backend:
      condition: service_healthy
  networks:
    - prioritymail
  restart: "no"
```

Both connectors post to the same `http://backend:4000` endpoint. They run independently — you can trigger one, both, or schedule them via `cron` / `docker compose run`.

---

## 9. Implementation Phases

### Phase 1 — Foundation (no UI change yet)
- [ ] Add `source` + `accountEmail` to `NormalizedEmail` interface
- [ ] Add `source` prefix logic to both connectors' `normalize.ts`
- [ ] Run schema migration (`ALTER TABLE emails ADD COLUMN source ...`)
- [ ] Update backend ingest to store `source` + `account_email`
- [ ] Update Gmail connector to set `source: "gmail"` on all messages

### Phase 2 — O365 Connector
- [ ] Create `connectors/shared/` package with shared triage/AI code
- [ ] Build `connectors/o365/` connector (auth, fetch, normalize, index)
  - [ ] Azure app registration guide in README
  - [ ] `npm run auth` one-time device-code flow
  - [ ] Graph API fetch + normalize to `NormalizedEmail`
- [ ] Add `o365-connector` to `docker-compose.yml`
- [ ] Test end-to-end: both connectors posting to the same backend

### Phase 3 — Frontend Source Badges
- [ ] Add `source` field to frontend `Email` type (`src/lib/api.ts`)
- [ ] Build `<SourceBadge source="gmail" | "o365" />` component
- [ ] Add badge to inbox email rows
- [ ] Add badge to email detail header
- [ ] Add **All / Gmail / Outlook** filter tabs to inbox

### Phase 4 — Polish
- [ ] Deduplication: if the same email arrives from both sources (forwarded), detect and merge
- [ ] Account label in settings: let user rename "Gmail" → "Personal", "Outlook" → "Work"
- [ ] Source-aware rules: add `source` as a rule condition (e.g., all Outlook emails from `@clientdomain.com` → Client Request)

---

## 10. Open Questions

- [ ] **Personal vs work O365?** Personal `@outlook.com` uses `consumers` tenant; work accounts use a specific tenant ID. The auth flow needs to handle both.
- [ ] **Shared `OPENROUTER_API_KEY`?** Both connectors can share the same key. Rate limits apply per key, so both drain from the same pool.
- [ ] **Run schedule?** Currently both connectors are one-shot (`restart: "no"`). Should they run on a cron? If so, what interval per source?
- [ ] **Conflict handling?** If Gmail and O365 receive the same email (e.g., a reply-all that hits both accounts), the prefixed IDs mean both rows are stored separately. Is that the desired behavior?
- [ ] **Which O365 folder to poll?** Default is Inbox. Should focused inbox (`/mailFolders/AAMkAGVm...`) or all unread be fetched?
