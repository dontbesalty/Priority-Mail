# Feature Plan: Re-Classify Emails + Feedback Memory

## Overview

This feature lets users correct the AI's classification of an email (category and/or priority) directly from the email detail page. The correction is persisted in a `classification_overrides` table, and future emails from the same sender are automatically classified using the user's override — bypassing the rules engine and AI entirely. A dedicated **Overrides management page** lets the user view, edit, enable/disable, and delete their saved overrides at any time.

---

## Background: What the Current Approve/Dismiss Flow Does

The current UI has three possible `user_action` values already in the schema:
- `approved` — user agrees with the classification; email disappears from inbox
- `dismissed` — user ignores the email; email disappears from inbox
- `corrected` — stubbed in schema and API but **not yet wired to anything**

The `user_category` column exists to store a corrected category, but:
- The UI never presents a way to pick a different category
- The connector never reads past corrections when ingesting new emails
- There is no "memory" — the same sender would receive the same AI classification next time

This feature fully implements the `corrected` path and adds the feedback loop.

---

## Goals

1. **Re-Classify (immediate)** — Users can change the category and/or priority of any email from the detail page.
2. **Remember (future ingestion)** — When a correction is saved, an override record is written so future emails from the same sender are auto-classified to match.
3. **Manage** — Overrides can be viewed, edited, enabled/disabled, and deleted from a dedicated management page.

---

## Non-Goals

- This does not retrain, fine-tune, or modify the AI model or prompt.
- This does not create rules in `custom-rules.json` (that file remains a static, developer-managed config).
- This does not change the approve / dismiss behavior at all.
- Priority correction is optional on the correction form — category is required.

---

## Data Model Changes

### 1. New column: `user_priority` on `emails`

The existing `user_category` stores a corrected category. Add a parallel column for priority:

```sql
ALTER TABLE emails
  ADD COLUMN IF NOT EXISTS user_priority TEXT
    CHECK (user_priority IN ('High','Medium','Low') OR user_priority IS NULL);
```

This is stored alongside `user_action = 'corrected'` and `user_category`.

### 2. New table: `classification_overrides`

Stores learned corrections keyed by sender. When a user corrects an email, a row is written here. The connector reads this table at startup and applies any matching, enabled override before running rules or AI.

```sql
CREATE TABLE IF NOT EXISTS classification_overrides (
  id               SERIAL PRIMARY KEY,
  from_address     TEXT,          -- exact sender address, e.g. "boss@acme.com"
  sender_domain    TEXT,          -- domain portion only, e.g. "acme.com"
  subject_contains TEXT,          -- optional keyword in subject, e.g. "invoice"
  body_contains    TEXT,          -- optional keyword in body, e.g. "annual report"
  category         TEXT NOT NULL,
  priority         TEXT CHECK (priority IN ('High','Medium','Low')),
  enabled          BOOLEAN NOT NULL DEFAULT TRUE,  -- toggle off without deleting
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_overrides_from_address  ON classification_overrides (from_address);
CREATE INDEX IF NOT EXISTS idx_overrides_sender_domain ON classification_overrides (sender_domain);
CREATE INDEX IF NOT EXISTS idx_overrides_enabled       ON classification_overrides (enabled);
```

**Matching logic:**

An override matches an incoming email when `enabled = TRUE` and **all non-null conditions** in that row are satisfied simultaneously:
- `from_address` (if set): the email's `from` field must contain this value (case-insensitive)
- `sender_domain` (if set): the sender's domain must end with this value (case-insensitive)
- `subject_contains` (if set): the email's `subject` must contain this keyword (case-insensitive)
- `body_contains` (if set): the email's `body` must contain this keyword (case-insensitive)

Overrides are evaluated most-specific first, scored by how many conditions are set. The override with the highest number of matching conditions wins. Ties are broken by `created_at DESC` (most recent override wins).

---

## API Changes

### `POST /emails/:id/action` (existing — extend)

**Current body:**
```json
{ "action": "approved" | "dismissed" | "corrected", "category": "string" }
```

**New body:**
```json
{
  "action": "approved" | "dismissed" | "corrected",
  "category": "string (required when action=corrected)",
  "priority": "High" | "Medium" | "Low",   // optional, only used when action=corrected
  "subject_contains": "string",             // optional keyword to narrow the override to matching subjects
  "body_contains": "string",               // optional keyword to narrow the override to matching body text
  "save_override": true | false            // default true when action=corrected
}
```

**Backend behavior when `action=corrected`:**
1. Write `user_action='corrected'`, `user_category`, `user_priority`, `actioned_at` to the `emails` row (existing behavior, now extended with `user_priority`).
2. If `save_override=true` (default), call the override creation logic:
   - Extract `from_address` from the email row
   - Extract `sender_domain` from `from_address`
   - Upsert into `classification_overrides`:
     - Upsert key: `from_address` + `subject_contains` + `body_contains` (all three together form a unique combination)
     - Store the provided `subject_contains` and `body_contains` values (may be null if user left them blank)
     - Set `enabled = TRUE` on upsert
     - Update `category`, `priority`, `updated_at` if a matching row already exists
     - Insert new row otherwise

### `GET /classification-overrides` (new)

Returns all saved overrides, sorted by `created_at DESC`. Includes both enabled and disabled rows so the management page can show all of them.

```
GET /classification-overrides
```

Response:
```json
[
  {
    "id": 1,
    "from_address": "newsletter@acme.com",
    "sender_domain": "acme.com",
    "subject_contains": null,
    "body_contains": null,
    "category": "Newsletter / Marketing",
    "priority": "Low",
    "enabled": true,
    "created_at": "2026-04-15T10:00:00Z",
    "updated_at": "2026-04-15T10:00:00Z"
  }
]
```

### `PATCH /classification-overrides/:id` (new)

Update any fields of an existing override. Used for both editing (change category, priority, subject/body filters) and toggling enabled/disabled.

```
PATCH /classification-overrides/1
```

Body (all fields optional — only provided fields are updated):
```json
{
  "category": "Billing / Invoice",
  "priority": "High",
  "subject_contains": "invoice",
  "body_contains": null,
  "enabled": false
}
```

Response:
```json
{ "ok": true, "id": 1 }
```

### `DELETE /classification-overrides/:id` (new)

Permanently deletes an override. Future emails from that sender will go back through the rules engine and AI.

```
DELETE /classification-overrides/1
```

Response:
```json
{ "ok": true, "id": 1 }
```

---

## Connector Changes (Gmail + O365 — identical for both)

Both `connectors/gmail/src/triage-pipeline.ts` and `connectors/o365/src/triage-pipeline.ts` need the same changes.

### 1. Fetch overrides at startup

In `index.ts` (the connector entry point), before calling `triageBatch`, fetch all overrides from the backend. The backend already filters to `enabled = TRUE` for the connector's query (or the connector can filter client-side):

```typescript
const overrides = await fetchOverrides(backendUrl); // GET /classification-overrides?enabled=true
```

Pass the overrides array down to `triageBatch`.

### 2. Apply overrides as the first step in `triageEmail`

In `triage-pipeline.ts`, add a pre-rules check at the top of `triageEmail`:

```typescript
export async function triageEmail(
  email: NormalizedEmail,
  overrides: ClassificationOverride[] = []
): Promise<TriagedEmail> {

  // ── Step 1: User overrides take priority over everything ────────────────
  const override = matchOverride(email, overrides);
  if (override) {
    return toTriagedEmail(email, {
      priority: override.priority ?? "Medium",
      category: override.category,
      priority_reason: `Classified by user override (from: ${override.from_address ?? override.sender_domain})`,
      reply_needed: false,
      task_needed: false,
      confidence: 1.0,
    }, { confidence: 1.0, skip_ai: true, local_ai_only: false, rule_fired: `user_override:${override.id}` }, "rules");
  }

  // ── Step 2: Rules engine (existing) ─────────────────────────────────────
  const rules = applyRules(email);
  ...
}
```

### 3. `matchOverride` function

Score each override by how many conditions it sets. Disabled overrides are excluded before scoring. The highest-scoring match wins; ties broken by newest `created_at`.

```typescript
function overrideScore(o: ClassificationOverride): number {
  return (o.from_address ? 2 : 0) +
         (o.sender_domain ? 1 : 0) +
         (o.subject_contains ? 1 : 0) +
         (o.body_contains ? 1 : 0);
}

function matchOverride(
  email: NormalizedEmail,
  overrides: ClassificationOverride[]
): ClassificationOverride | undefined {
  const from    = email.from.toLowerCase();
  const subject = email.subject.toLowerCase();
  const body    = email.body.toLowerCase();
  const domainMatch = from.match(/@([\w.-]+)/);
  const domain  = domainMatch ? domainMatch[1] : "";

  const candidates = overrides.filter(o => {
    if (!o.enabled) return false;  // skip disabled overrides
    if (o.from_address     && !from.includes(o.from_address.toLowerCase()))           return false;
    if (o.sender_domain    && !domain.endsWith(o.sender_domain.toLowerCase()))        return false;
    if (o.subject_contains && !subject.includes(o.subject_contains.toLowerCase()))   return false;
    if (o.body_contains    && !body.includes(o.body_contains.toLowerCase()))          return false;
    return true;
  });

  if (candidates.length === 0) return undefined;

  // Most-specific override wins; ties broken by newest created_at
  return candidates.sort((a, b) =>
    overrideScore(b) - overrideScore(a) ||
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )[0];
}
```

### 4. Error handling

If `GET /classification-overrides` fails at startup, log a warning and continue with an empty array. The connector must not crash because overrides are unavailable.

```typescript
let overrides: ClassificationOverride[] = [];
try {
  overrides = await fetchOverrides(backendUrl);
  console.log(`Loaded ${overrides.length} classification overrides`);
} catch (err) {
  console.warn("⚠️  Could not load classification overrides — continuing without them:", err.message);
}
```

---

## Frontend Changes

### Email Detail Page (`frontend/src/app/email/[id]/page.tsx`)

#### Current action panel
```
[ ✅ Approve ]  [ ❌ Dismiss ]
```

#### New action panel

Replace with a three-option layout:

```
[ ✅ Approve ]  [ ❌ Dismiss ]  [ ✏️ Correct Classification ]
```

When the user clicks **"✏️ Correct Classification"**, expand an inline panel (no page navigation) below the buttons:

```
┌─────────────────────────────────────────────────────┐
│  Correct Classification                             │
│                                                     │
│  Category *                                         │
│  [ Client Request              ▼ ]                  │
│                                                     │
│  Priority (optional)                                │
│  [ Keep as Medium              ▼ ]                  │
│                                                     │
│  📌 Remember for future emails matching:            │
│  [ ☑ Yes, save override ]                           │
│                                                     │
│  Subject contains  (optional — leave blank = any)  │
│  [ Annual Report                        ]           │
│                                                     │
│  Body contains  (optional — leave blank = any)     │
│  [ late fee                             ]           │
│                                                     │
│  [ Save Correction ]  [ Cancel ]                    │
└─────────────────────────────────────────────────────┘
```

- Category dropdown lists all valid categories (same list as the AI/rules engine).
- Priority dropdown defaults to the current priority; has "Keep as [current]" as default.
- The "save override" checkbox defaults to **checked**. When unchecked, the keyword fields are hidden.
- **Subject contains**: text input, pre-filled with a suggested keyword extracted from the current email's subject (the longest non-stopword token). User can clear or change it.
- **Body contains**: text input, empty by default. User can optionally enter a phrase that must appear in the email body for the override to fire.
- Leaving either keyword field blank means "match any" for that condition — the override fires on all emails from that sender regardless of subject/body content.
- On submit: calls `POST /emails/:id/action` with `action: "corrected"`, the selected `category`, optional `priority`, `subject_contains` (null if blank), `body_contains` (null if blank), and `save_override`.
- On success: redirect to `/` (same as current approve/dismiss behavior).
- Toast/notice: "Classification saved. Future emails from [sender] will be categorized as [category]."

#### Valid Category Options (matches `rules-engine.ts`)
```
Client Request
Internal Team
Billing / Invoice
Sales Lead
Support Issue
Waiting On Someone Else
Newsletter / Marketing
Spam / Low Importance
Security Alert
Real Estate
Financial Update
Other
```

---

### Overrides Management Page (`/overrides`) — Required

**Route:** `frontend/src/app/overrides/page.tsx`

Accessible from the main navigation bar (alongside Tasks and Logs). Lists all saved overrides and lets the user manage them without having to re-visit an email.

#### Layout

```
┌────────────────────────────────────────────────────────────────────────┐
│  🔁 Classification Overrides                              [ + New ]   │
│  Rules saved from your past corrections. Active rules run before AI.  │
├──────────┬──────────────┬──────────┬───────────────┬──────────┬───────┤
│  Sender  │   Category   │ Priority │ Subject / Body│  Status  │       │
├──────────┼──────────────┼──────────┼───────────────┼──────────┼───────┤
│ acme.com │ Client Req.  │ High     │ sub: "invoice"│ ● Active │ ✏️ 🗑 │
│ foo@bar  │ Newsletter   │ Low      │ —             │ ○ Off    │ ✏️ 🗑 │
└──────────┴──────────────┴──────────┴───────────────┴──────────┴───────┘
```

#### Columns
| Column | Notes |
|---|---|
| Sender | `from_address` if set, otherwise `sender_domain`. Shows the narrowest identifier. |
| Category | The override category |
| Priority | Override priority, or "—" if not set |
| Subject / Body | Shows `sub: "..."` and/or `body: "..."` if set, otherwise "—" |
| Status | Toggle button: **Active** (green dot) / **Disabled** (grey dot). Clicking calls `PATCH /:id { enabled: !current }`. No page reload needed — optimistic UI update. |
| Actions | ✏️ Edit icon opens an inline edit row (same fields as the correction form). 🗑 Delete icon shows a confirm prompt then calls `DELETE /:id`. |

#### Inline Edit Row

Clicking ✏️ on a row expands it in-place to an editable form:

```
┌───────────────────────────────────────────────────────────────────┐
│  Editing: acme.com                                               │
│  Category:  [ Billing / Invoice ▼ ]   Priority: [ High ▼ ]      │
│  Subject contains:  [ invoice           ]                        │
│  Body contains:     [                   ]                        │
│  [ Save ]  [ Cancel ]                                            │
└───────────────────────────────────────────────────────────────────┘
```

On save: calls `PATCH /classification-overrides/:id` with changed fields.

#### `+ New` Button

Opens a standalone create form (same fields, no pre-fill). Useful for manually creating an override without going through an email. Calls `POST /classification-overrides` directly (separate from the email action endpoint).

#### API helpers needed in `frontend/src/lib/api.ts`
- `getOverrides()` → `GET /classification-overrides`
- `updateOverride(id, patch)` → `PATCH /classification-overrides/:id`
- `deleteOverride(id)` → `DELETE /classification-overrides/:id`
- `createOverride(data)` → `POST /classification-overrides`

---

## File Change Summary

| File | Change |
|---|---|
| `backend/src/db/schema.sql` | Add `user_priority` to `emails`; add `classification_overrides` table with `enabled` column |
| `backend/src/routes/emails.ts` | Update `POST /:id/action` to accept `user_priority`, `subject_contains`, `body_contains`, `save_override`; write override on corrected |
| `backend/src/routes/overrides.ts` | New file: `GET`, `POST`, `PATCH /:id`, `DELETE /:id` for overrides |
| `backend/src/server.ts` | Register new overrides router at `/classification-overrides` |
| `connectors/gmail/src/triage-pipeline.ts` | Add `matchOverride()`, override pre-check at top of `triageEmail`; update `triageBatch` signature |
| `connectors/gmail/src/index.ts` | Fetch enabled overrides at startup, pass to `triageBatch` |
| `connectors/o365/src/triage-pipeline.ts` | Same as Gmail changes |
| `connectors/o365/src/index.ts` | Same as Gmail changes |
| `frontend/src/lib/api.ts` | Add `correctEmail()`, `getOverrides()`, `updateOverride()`, `deleteOverride()`, `createOverride()` |
| `frontend/src/app/email/[id]/page.tsx` | Add "Correct Classification" panel with category, priority, subject/body inputs |
| `frontend/src/app/overrides/page.tsx` | New page: override list with enable/disable toggle, inline edit, delete |
| `frontend/src/app/layout.tsx` | Add "🔁 Overrides" link to nav bar alongside Tasks and Logs |

---

## Implementation Phases

### Phase 1 — Core Re-Classify (no memory)
- [ ] Add `user_priority` column to `emails` table
- [ ] Update `POST /emails/:id/action` to accept and store `user_priority`
- [ ] Add "Correct Classification" UI panel to email detail page
- [ ] Verify corrected action is stored with `user_category` + `user_priority`

### Phase 2 — Override Storage + Management Page
- [ ] Add `classification_overrides` table + indexes (including `enabled` column) to schema
- [ ] Add override create/upsert logic called from the action endpoint
- [ ] Add `GET /classification-overrides` endpoint
- [ ] Add `PATCH /classification-overrides/:id` endpoint (edit fields + toggle enabled)
- [ ] Add `DELETE /classification-overrides/:id` endpoint
- [ ] Add `POST /classification-overrides` standalone create endpoint
- [ ] Register overrides router in `server.ts`
- [ ] Wire `save_override` + keyword fields in the frontend correction panel
- [ ] Build `/overrides` management page (list, inline edit, enable/disable toggle, delete, + New)
- [ ] Add overrides nav link to layout
- [ ] Add `getOverrides()`, `updateOverride()`, `deleteOverride()`, `createOverride()` to `frontend/src/lib/api.ts`

### Phase 3 — Connector Memory
- [ ] Add `fetchOverrides()` helper to both connectors (filter to `enabled=true` only)
- [ ] Load overrides at connector startup (with graceful fallback on error)
- [ ] Add `overrideScore()` and `matchOverride()` to both triage pipelines
- [ ] Insert override pre-check at top of `triageEmail` in both connectors
- [ ] Log `classified_by: "user_override"` + `rule_fired: "user_override:N"` for auditability

### Phase 4 — Polish (Optional)
- [ ] Show "Override active" badge on email detail page when an email was classified by a user override
- [ ] Add override count to the dashboard stats bar
- [ ] Allow creating overrides scoped to `sender_domain` only (not just `from_address`) via the `+ New` form

---

## Open Questions

1. **Scope of override**: Should the default scope be the exact `from_address` or the `sender_domain`? Exact address is safer; domain is more aggressive. The plan defaults to `from_address` but the form could expose both as radio options.
2. **Conflict with custom-rules.json**: User overrides run before the static custom rules file (since they run before the rules engine). Is this the right precedence, or should custom rules take priority?
3. **Re-ingest clobber risk**: The ingest route uses `ON CONFLICT (id) DO UPDATE` and currently overwrites `priority` and `category`. With overrides active, re-ingesting an already-corrected email reclassifies it correctly via the override — but confirm the upsert does not overwrite `user_action = 'corrected'` on the email row.
4. **Disabled overrides in connector**: The `GET /classification-overrides?enabled=true` approach is preferred so the connector only loads what it needs. The backend should support an `?enabled=true` filter param.
