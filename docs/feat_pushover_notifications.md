# Feature Plan: Pushover Notifications for High Priority Emails

## Overview

When the connector runs on a schedule (see `feat_scheduled_polling.md`) and ingests new emails, any email classified as **High priority** should immediately trigger a Pushover push notification. Notifications fire at most once per email — re-ingesting the same email on a subsequent poll does not send a duplicate.

---

## Prerequisites

This feature depends on **`feat_scheduled_polling.md`** being implemented first. In daemon mode, the connector runs continuously and ingests small batches every `POLL_INTERVAL_SECONDS`. Notifications make most sense in that context, though they will also work on manual one-shot runs.

---

## Design Decision: Where does notification logic live?

| Option | Pros | Cons |
|---|---|---|
| **Backend sends notifications** (chosen) | Single configuration point for both connectors; backend knows exactly which rows are newly inserted vs updated | Backend gains a new external API dependency |
| Connector sends notifications | No backend change needed | Credentials and logic duplicated in both connectors |

**Decision: Backend.** The backend handles the ingest for all connectors. It already controls the `ON CONFLICT` logic and can precisely identify newly inserted vs updated rows, making de-duplication trivial. Credentials only need to be set in one place.

---

## Pushover API

Pushover sends push notifications to iOS/Android devices via a simple HTTP POST. No SDK or npm package needed — the codebase already uses native `fetch`.

```
POST https://api.pushover.net/1/messages.json
Content-Type: application/json

{
  "token":    "<PUSHOVER_APP_TOKEN>",
  "user":     "<PUSHOVER_USER_KEY>",
  "title":    "🔴 High Priority Email",
  "message":  "From: boss@acme.com\nRe: Invoice overdue — 12 days\nCategory: Billing / Invoice",
  "url":      "http://yourdashboard:3000/email/gmail%3Aabc123",
  "url_title": "Open in Priority Mail",
  "priority": 1,
  "sound":    "persistent"
}
```

Pushover priority levels:
| Value | Behaviour |
|---|---|
| `-1` | Low priority, no sound |
| `0` | Normal (default) |
| `1` | High — bypasses quiet hours, uses loud sound |
| `2` | Emergency — requires acknowledgement, keeps alerting until confirmed |

Recommended: `priority: 1` (bypasses quiet hours without requiring acknowledgement).

---

## Rate Limiting / Grace Period

If a burst of High priority emails arrives across several polls (e.g., a busy morning), the system should not spam a notification for each one. A **15-minute grace period** is enforced globally: after any notification fires, no further notifications are sent for 15 minutes. New High emails that arrive during the grace window are held and will be included in the next notification after the window expires.

**How it works:**

1. At the end of every ingest, query for any High emails with `notified_pushover_at IS NULL`.
2. Before sending, check whether **any** notification has been sent in the last `PUSHOVER_GRACE_PERIOD_MINUTES` (default: 15) minutes:
   ```sql
   SELECT 1 FROM emails
   WHERE notified_pushover_at > NOW() - INTERVAL '15 minutes'
   LIMIT 1;
   ```
3. If that query returns a row → **grace period is active** → skip notifications this batch. The emails keep `notified_pushover_at = NULL` and will be re-evaluated on the next poll.
4. If no row → **grace period has expired** → send ONE batched notification covering all pending High emails, then stamp all of them with `notified_pushover_at = NOW()`.

This means: at most one Pushover notification every grace period, no matter how many High emails arrive. Emails are never permanently suppressed — they are notified after the grace window clears.

The grace period is configurable via `PUSHOVER_GRACE_PERIOD_MINUTES` (default: `15`).

---

## Data Model Changes

### New column: `notified_pushover_at` on `emails`

```sql
ALTER TABLE emails
  ADD COLUMN IF NOT EXISTS notified_pushover_at TIMESTAMPTZ;
```

- `NULL` = not yet notified (or held pending grace window)
- Set to `NOW()` on all emails in a batch immediately after a successful Pushover API call
- Used as the grace period clock: presence of any row with `notified_pushover_at > NOW() - INTERVAL 'N minutes'` indicates the window is active

---

## Config Changes

### New environment variables — `backend/.env`

| Variable | Required | Description |
|---|---|---|
| `PUSHOVER_APP_TOKEN` | Optional | Pushover application token from pushover.net. If unset, notifications are disabled. |
| `PUSHOVER_USER_KEY` | Optional | Pushover user/group key. Required when `PUSHOVER_APP_TOKEN` is set. |
| `PUSHOVER_NOTIFY_PRIORITY` | Optional | Minimum email priority to notify. Default: `High`. Set to `Medium` to also notify on Medium priority. |
| `PUSHOVER_FRONTEND_URL` | Optional | Base URL of the dashboard (e.g., `http://192.168.1.100:3000`). Used to generate deep-links in the notification. If unset, no URL is included. |
| `PUSHOVER_GRACE_PERIOD_MINUTES` | Optional | Minutes to suppress further notifications after one fires. Default: `15`. |

Add all five to `backend/.env.example`.

---

## Backend Changes

### 1. `backend/src/db/schema.sql`

Add the `notified_pushover_at` column migration:

```sql
ALTER TABLE emails
  ADD COLUMN IF NOT EXISTS notified_pushover_at TIMESTAMPTZ;
```

### 2. `backend/src/routes/emails.ts` — ingest endpoint

The `POST /emails/ingest` endpoint currently upserts all emails with `ON CONFLICT (id) DO UPDATE`. Modify it to:

1. Track which email IDs are freshly **inserted** (not updated) by checking whether the row existed before the upsert. The cleanest way: use `ON CONFLICT DO UPDATE ... RETURNING id, (xmax = 0) AS is_insert` — PostgreSQL's `xmax` trick identifies whether the returned row was an insert (`xmax = 0`) or an update (`xmax != 0`).

2. After all upserts complete, collect ALL emails (not just newly inserted) with `priority = 'High'` (or configured threshold) and `notified_pushover_at IS NULL` — this catches emails held over from previous grace windows as well as new arrivals.

3. If there are no pending emails, do nothing.

4. Check the grace period: query for any row with `notified_pushover_at` in the last `PUSHOVER_GRACE_PERIOD_MINUTES` minutes. If found, skip — do not send, do not stamp. The pending emails remain NULL and will be re-evaluated on the next poll.

5. If the grace window has cleared, send ONE batched notification covering all pending emails, then set `notified_pushover_at = NOW()` on all of them in a single `UPDATE ... WHERE id = ANY($1)`.

6. Notification failures must not cause the ingest to fail — wrap in try/catch and log a warning.

**Minimal code sketch:**

```typescript
const notifyPriority = process.env.PUSHOVER_NOTIFY_PRIORITY ?? "High";
const graceMins = parseInt(process.env.PUSHOVER_GRACE_PERIOD_MINUTES ?? "15", 10);

// Collect ALL un-notified High emails (new + held from prior grace windows)
const pendingResult = await pool.query(
  `SELECT id, subject, from_address, category, priority_reason
   FROM emails
   WHERE priority = $1 AND notified_pushover_at IS NULL`,
  [notifyPriority]
);
const pending = pendingResult.rows;

if (pending.length > 0 && pushoverConfig) {
  // Grace period check
  const graceResult = await pool.query(
    `SELECT 1 FROM emails
     WHERE notified_pushover_at > NOW() - INTERVAL '${graceMins} minutes'
     LIMIT 1`
  );

  if (graceResult.rows.length === 0) {
    // Grace window clear — fire ONE batched notification
    try {
      await sendPushoverNotification(pending, pushoverConfig);
      const pendingIds = pending.map(e => e.id);
      await pool.query(
        `UPDATE emails SET notified_pushover_at = NOW() WHERE id = ANY($1)`,
        [pendingIds]
      );
    } catch (err: any) {
      console.warn(`⚠️  Pushover notification failed: ${err.message}`);
    }
  }
  // else: grace period active — emails remain un-stamped, retried next poll
}
```

### 3. New file: `backend/src/notifications/pushover.ts`

Isolate the Pushover API call in its own module:

```typescript
import { Email } from "../types";  // or inline the relevant type

interface PushoverConfig {
  appToken: string;
  userKey: string;
  frontendUrl?: string;
}

export async function sendPushoverNotification(
  emails: { id: string; subject: string; from_address: string; category: string; priority_reason: string }[],
  config: PushoverConfig
): Promise<void> {
  let title: string;
  let message: string;

  if (emails.length === 1) {
    const e = emails[0];
    title = "🔴 High Priority Email";
    message = [
      `From: ${e.from_address}`,
      `Re: ${e.subject}`,
      `Category: ${e.category}`,
      e.priority_reason ? `Why: ${e.priority_reason}` : null,
    ].filter(Boolean).join("\n");
  } else {
    title = `🔴 ${emails.length} High Priority Emails`;
    message = emails
      .map(e => `• ${e.subject} — ${e.from_address}`)
      .join("\n");
  }

  const body: Record<string, string | number> = {
    token:    config.appToken,
    user:     config.userKey,
    title,
    message,
    priority: 1,
    sound:    "persistent",
  };

  if (config.frontendUrl) {
    // For batches, link to the inbox; for a single email, deep-link to that email
    body.url = emails.length === 1
      ? `${config.frontendUrl}/email/${encodeURIComponent(emails[0].id)}`
      : config.frontendUrl;
    body.url_title = emails.length === 1 ? "Open Email" : "Open Priority Mail";
  }

  const res = await fetch("https://api.pushover.net/1/messages.json", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pushover API error ${res.status}: ${text}`);
  }
}
```

**Caller in `emails.ts` reads config from env:**

```typescript
const pushoverConfig = process.env.PUSHOVER_APP_TOKEN
  ? {
      appToken:    process.env.PUSHOVER_APP_TOKEN,
      userKey:     process.env.PUSHOVER_USER_KEY ?? "",
      frontendUrl: process.env.PUSHOVER_FRONTEND_URL,
    }
  : null;

// Only call if configured (called with array — see ingest code sketch above)
if (pushoverConfig) {
  await sendPushoverNotification(pending, pushoverConfig);
}
```

### 4. `backend/.env.example` additions

```env
# ─── Pushover Notifications ───────────────────────────────────────────────────
# Get tokens at https://pushover.net
# Leave unset to disable notifications entirely.
PUSHOVER_APP_TOKEN=
PUSHOVER_USER_KEY=

# Minimum priority to trigger a notification: High | Medium (default: High)
PUSHOVER_NOTIFY_PRIORITY=High

# Base URL of the dashboard for notification deep-links (no trailing slash).
# Example: http://192.168.1.100:3000
PUSHOVER_FRONTEND_URL=

# After a notification fires, suppress further notifications for this many minutes.
# Prevents alert floods when many High emails arrive close together.
# Default: 15
PUSHOVER_GRACE_PERIOD_MINUTES=15
```

---

## Notification Format

**Single email (1 pending High email):**
```
🔴 High Priority Email
─────────────────────
From: billing@acme.com
Re: Invoice #4492 — payment overdue
Category: Billing / Invoice
Why: Invoice is 12 days past due with a $400 late fee

[Open Email]
```

**Batch (multiple pending High emails after grace window clears):**
```
🔴 3 High Priority Emails
──────────────────────────
• Invoice #4492 — payment overdue — billing@acme.com
• Urgent: contract review needed — boss@acme.com
• Your account requires action — security@bank.com

[Open Priority Mail]
```

---

## Duplicate Prevention

| Scenario | Behaviour |
|---|---|
| Same email re-ingested on next poll (still unread) | `notified_pushover_at` is already set → no second notification |
| New High email arrives within grace window | Email stays `notified_pushover_at = NULL`; included in next batch once window clears |
| Multiple High emails arrive across several polls during grace window | All held; sent together in ONE batch when window expires |
| User corrects classification from Low → High after the fact | `notified_pushover_at` is NULL (was Low, never notified) → included in next batch |
| Pushover API call fails | `notified_pushover_at` stays NULL → retry on next ingest, with logged warning |
| `PUSHOVER_APP_TOKEN` not set | Feature is disabled entirely, ingest behaves as before |

---

## File Change Summary

| File | Change |
|---|---|
| `backend/src/db/schema.sql` | Add `notified_pushover_at TIMESTAMPTZ` column to `emails` |
| `backend/src/routes/emails.ts` | Detect newly-inserted rows in ingest; call notifier for High priority inserts |
| `backend/src/notifications/pushover.ts` | New file: `sendPushoverNotification()` function |
| `backend/.env.example` | Add `PUSHOVER_APP_TOKEN`, `PUSHOVER_USER_KEY`, `PUSHOVER_NOTIFY_PRIORITY`, `PUSHOVER_FRONTEND_URL`, `PUSHOVER_GRACE_PERIOD_MINUTES` |

No connector files change. No frontend changes required (the deep-link is optional and constructed in the backend).

---

## Implementation Phases

### Phase 1 — Core Notification
- [ ] Add `notified_pushover_at` column to `backend/src/db/schema.sql`
- [ ] Create `backend/src/notifications/pushover.ts` with `sendPushoverNotification()` (accepts array of emails)
- [ ] After each ingest, query for ALL un-notified High emails (`notified_pushover_at IS NULL`)
- [ ] Check grace period: query for any `notified_pushover_at > NOW() - INTERVAL 'N minutes'`
- [ ] If grace window clear: send ONE batched notification, then stamp all pending emails with `notified_pushover_at = NOW()` via `UPDATE ... WHERE id = ANY($1)`
- [ ] If grace window active: skip — emails remain NULL and retry next poll
- [ ] Wrap all notification logic in try/catch — ingest must not fail if Pushover is down
- [ ] Add all `PUSHOVER_*` vars (including `PUSHOVER_GRACE_PERIOD_MINUTES`) to `backend/.env.example`

### Phase 2 — Test & Validate
- [ ] Test with `PUSHOVER_APP_TOKEN` unset — verify ingest completes normally with no errors
- [ ] Test with credentials set — verify notification arrives and `notified_pushover_at` is set
- [ ] Test re-ingest of same High email — verify no duplicate notification
- [ ] Test Pushover API down scenario — verify ingest still succeeds, warning logged

### Phase 3 — Polish (Optional)
- [ ] Support `PUSHOVER_NOTIFY_PRIORITY=Medium` to also alert on Medium emails at a lower Pushover priority level (`priority: 0`)
- [ ] Surface `notified_pushover_at` status on the email detail page in the frontend ("Notification sent X ago")

---

## Open Questions

1. **Emergency priority (level 2)**: Pushover level 2 requires the user to acknowledge the alert or it keeps repeating. Useful for truly critical emails but potentially annoying. Should this be configurable per-category (e.g., "Billing / Invoice" always = level 2)?
2. **Quiet hours**: If `priority: 1` is used, Pushover bypasses device quiet hours. Is this the desired behavior? If not, use `priority: 0`.
3. **Detection of new inserts**: The `xmax = 0` trick is a PostgreSQL-specific internal — it works reliably but is not part of the SQL standard. An alternative is to check in a `SELECT` before the upsert, but that adds a query per email. The `xmax` approach is simpler.
