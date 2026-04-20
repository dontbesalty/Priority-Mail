# Feature Plan: Re-Classify Emails + Feedback Memory

## Overview

This feature lets users correct the AI's classification of an email (category and/or priority) directly from the email detail page. The correction is persisted in a `classification_overrides` table, and future emails from the same sender are automatically classified using the user's override — bypassing the rules engine and AI entirely.

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
3. **Manage** — Overrides can be listed and deleted (to stop forcing a sender into a category).

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

Stores learned corrections keyed by sender. When a user corrects an email, a row is written here. The connector reads this table at startup and applies any matching override before running rules or AI.

```sql
CREATE TABLE IF NOT EXISTS classification_overrides (
  id              SERIAL PRIMARY KEY,
  from_address    TEXT,          -- exact sender address, e.g. "boss@acme.com"
  sender_domain   TEXT,          -- domain portion only, e.g. "acme.com"
  subject_contains TEXT,         -- optional keyword to narrow scope, e.g. "invoice"
  category        TEXT NOT NULL,
  priority        TEXT CHECK (priority IN ('High','Medium','Low')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_overrides_from_address  ON classification_overrides (from_address);
CREATE INDEX IF NOT EXISTS idx_overrides_sender_domain ON classification_overrides (sender_domain);
```

**Matching logic (applied in order — first match wins):**
1. Exact `from_address` + `subject_contains` match (most specific)
2. Exact `from_address` match (no subject filter)
3. `sender_domain` + `subject_contains` match
4. `sender_domain` match (broadest)

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
  "priority": "High" | "Medium" | "Low" (optional, only used when action=corrected)",
  "save_override": true | false  // default true when action=corrected
}
```

**Backend behavior when `action=corrected`:**
1. Write `user_action='corrected'`, `user_category`, `user_priority`, `actioned_at` to the `emails` row (existing behavior, now extended with `user_priority`).
2. If `save_override=true` (default), call the override creation logic:
   - Extract `from_address` from the email row
   - Extract `sender_domain` from `from_address`
   - Upsert into `classification_overrides`:
     - Match key: `from_address` (and `subject_contains` if provided)
     - Update `category`, `priority`, `updated_at` if the row already exists
     - Insert new row otherwise

### `GET /classification-overrides` (new)

Returns all saved overrides, sorted by `created_at DESC`.

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
    "category": "Newsletter / Marketing",
    "priority": "Low",
    "created_at": "2026-04-15T10:00:00Z",
    "updated_at": "2026-04-15T10:00:00Z"
  }
]
```

### `DELETE /classification-overrides/:id` (new)

Deletes a single override by ID. Future emails from that sender will go back through the rules engine and AI.

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

In `index.ts` (the connector entry point), before calling `triageBatch`, fetch all overrides from the backend:

```typescript
const overrides = await fetchOverrides(backendUrl); // GET /classification-overrides
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

```typescript
function matchOverride(
  email: NormalizedEmail,
  overrides: ClassificationOverride[]
): ClassificationOverride | undefined {
  const from = email.from.toLowerCase();
  const domainMatch = from.match(/@([\w.-]+)/);
  const domain = domainMatch ? domainMatch[1] : "";
  const subject = email.subject.toLowerCase();

  // Priority: exact from + subject > exact from > domain + subject > domain
  return (
    overrides.find(o => o.from_address && from.includes(o.from_address.toLowerCase())
      && o.subject_contains && subject.includes(o.subject_contains.toLowerCase())) ??
    overrides.find(o => o.from_address && from.includes(o.from_address.toLowerCase()) && !o.subject_contains) ??
    overrides.find(o => o.sender_domain && domain.endsWith(o.sender_domain.toLowerCase())
      && o.subject_contains && subject.includes(o.subject_contains.toLowerCase())) ??
    overrides.find(o => o.sender_domain && domain.endsWith(o.sender_domain.toLowerCase()) && !o.subject_contains)
  );
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
│  📌 Remember for future emails from this sender     │
│  [ ☑ Yes, save override ]                           │
│                                                     │
│  [ Save Correction ]  [ Cancel ]                    │
└─────────────────────────────────────────────────────┘
```

- Category dropdown lists all valid categories (same list as the AI/rules engine).
- Priority dropdown defaults to the current priority; has "Keep as [current]" as default.
- The "save override" checkbox defaults to **checked**.
- On submit: calls `POST /emails/:id/action` with `action: "corrected"`, the selected `category`, optional `priority`, and `save_override`.
- On success: redirect to `/` (same as current approve/dismiss behavior).
- Toast/notice: "Classification saved. Future emails from [sender domain] will be categorized as [category]."

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

### Optional: Overrides Management Page (`/overrides`)

A simple admin page listing all saved overrides with a delete button. Not required for the initial implementation but useful.

**Route:** `frontend/src/app/overrides/page.tsx`

**Display columns:** Sender / Domain | Category | Priority | Subject Filter | Saved | Delete

**API calls:** `GET /classification-overrides` and `DELETE /classification-overrides/:id`

---

## File Change Summary

| File | Change |
|---|---|
| `backend/src/db/schema.sql` | Add `user_priority` column to `emails`; add `classification_overrides` table |
| `backend/src/routes/emails.ts` | Update `POST /:id/action` to accept `user_priority` + `save_override`; write override on corrected |
| `backend/src/routes/overrides.ts` | New file: `GET /classification-overrides`, `DELETE /classification-overrides/:id` |
| `backend/src/server.ts` | Register new overrides router |
| `connectors/gmail/src/triage-pipeline.ts` | Add override pre-check, `matchOverride()`, update `triageEmail` + `triageBatch` signatures |
| `connectors/gmail/src/index.ts` | Fetch overrides at startup, pass to `triageBatch` |
| `connectors/o365/src/triage-pipeline.ts` | Same as Gmail changes |
| `connectors/o365/src/index.ts` | Same as Gmail changes |
| `frontend/src/lib/api.ts` | Add `correctEmail()`, `getOverrides()`, `deleteOverride()` API helpers |
| `frontend/src/app/email/[id]/page.tsx` | Add "Correct Classification" panel with category + priority dropdowns |
| `frontend/src/app/overrides/page.tsx` | (Optional) New admin page for managing saved overrides |

---

## Implementation Phases

### Phase 1 — Core Re-Classify (no memory)
- [ ] Add `user_priority` column to `emails` table
- [ ] Update `POST /emails/:id/action` to accept and store `user_priority`
- [ ] Add "Correct Classification" UI panel to email detail page
- [ ] Verify corrected action is stored with `user_category` + `user_priority`

### Phase 2 — Override Storage
- [ ] Add `classification_overrides` table + indexes to schema
- [ ] Add `POST /classification-overrides` create logic (called from action route)
- [ ] Add `GET /classification-overrides` endpoint
- [ ] Add `DELETE /classification-overrides/:id` endpoint
- [ ] Register overrides router in `server.ts`
- [ ] Wire `save_override` toggle in the frontend panel
- [ ] Add `getOverrides()` and `deleteOverride()` to `frontend/src/lib/api.ts`

### Phase 3 — Connector Memory
- [ ] Add `fetchOverrides()` helper to both connectors
- [ ] Load overrides at connector startup (with graceful fallback on error)
- [ ] Add `matchOverride()` function to triage pipeline
- [ ] Insert override pre-check at top of `triageEmail` in both connectors
- [ ] Log `classified_by: "user_override"` + `rule_fired: "user_override:N"` for auditability

### Phase 4 — Polish (Optional)
- [ ] Build `/overrides` management page in the frontend
- [ ] Add `subject_contains` field to the correction form (advanced option)
- [ ] Show "Override active" badge on emails classified via user override
- [ ] Add override count to the dashboard stats bar

---

## Open Questions

1. **Scope of override**: Should the default scope be the exact `from_address` or the `sender_domain`? Exact address is safer; domain is more aggressive. The plan defaults to `from_address` but the form could expose both as radio options.
2. **Conflict with custom-rules.json**: User overrides run before the static custom rules file (since they run before the rules engine). Is this the right precedence, or should custom rules take priority?
3. **Priority on correction**: Is it useful to allow priority correction, or is category correction sufficient for most use cases?
4. **Override collision**: If two corrections exist for the same `from_address` (e.g., user changed their mind), the current plan upserts by `from_address` — the latest correction wins. Is this the right behavior?
5. **Dedup on same email**: The ingest route uses `ON CONFLICT (id) DO UPDATE` but currently overwrites `priority` and `category` on re-ingest. With overrides, re-ingest of an already-corrected email would re-classify it via the override correctly — but verify this doesn't clobber `user_action = 'corrected'` on the email row.
