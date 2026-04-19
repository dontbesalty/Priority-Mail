# API Reference

The backend exposes a REST API on port `4000`. All responses are JSON.

Base URL (local): `http://localhost:4000`  
Base URL (Docker internal): `http://backend:4000`

---

## Health

### `GET /health`

Returns service status and server timestamp.

**Response**
```json
{
  "status": "ok",
  "ts": "2026-04-19T14:00:00.000Z"
}
```

---

## Emails

### `GET /emails`

Returns a list of triaged emails sorted by priority (High → Medium → Low), then by received date descending. Limited to 100 results.

**Query Parameters**

| Parameter | Type | Description |
|---|---|---|
| `priority` | `High` \| `Medium` \| `Low` | Filter by priority level |
| `actioned` | `false` | Omit emails that have already been actioned by the user |
| `source` | `gmail` \| `o365` | Filter by email provider |

**Example**

```
GET /emails?actioned=false
GET /emails?priority=High&actioned=false
GET /emails?source=gmail&actioned=false
GET /emails?source=o365
```

**Response** — array of email objects (body field excluded for performance)

```json
[
  {
    "id": "18f3a1b2c3d4e5f6",
    "thread_id": "18f3a1b2c3d4e5f6",
    "subject": "Invoice #1042 due in 3 days",
    "from_address": "billing@vendor.com",
    "to_address": "you@gmail.com",
    "received_at": "2026-04-19T10:00:00.000Z",
    "snippet": "Your invoice is due...",
    "labels": ["INBOX", "UNREAD"],
    "is_unread": true,
    "priority": "High",
    "category": "Billing / Invoice",
    "priority_reason": "Invoice is due in 3 days and requires payment.",
    "reply_needed": false,
    "task_needed": true,
    "task_title": "Pay invoice #1042",
    "due_date_guess": "2026-04-22",
    "confidence": 0.95,
    "rule_fired": "subject_billing_keywords",
    "classified_by": "rules+ai",
    "user_action": null,
    "user_category": null,
    "actioned_at": null,
    "created_at": "2026-04-19T10:05:00.000Z"
  }
]
```

---

### `GET /emails/:id`

Returns a single email with all fields including the full `body` and `reply_draft`.

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `id` | string | Gmail message ID |

**Response** — full email object with `body` and `reply_draft` included

**Error Responses**

| Status | Condition |
|---|---|
| `404` | Email not found |
| `500` | Database error |

---

### `POST /emails/ingest`

Bulk upsert endpoint. The Gmail connector POSTs an array of `TriagedEmail` objects here after each run. On conflict (same `id`), classification fields are updated but user action fields are preserved.

**Request Body** — array of `TriagedEmail` objects

```json
[
  {
    "id": "18f3a1b2c3d4e5f6",
    "threadId": "18f3a1b2c3d4e5f6",
    "subject": "Invoice #1042 due in 3 days",
    "from": "Billing <billing@vendor.com>",
    "to": "you@gmail.com",
    "date": "2026-04-19T10:00:00.000Z",
    "snippet": "Your invoice is due...",
    "body": "Dear Customer, your invoice #1042...",
    "isUnread": true,
    "labels": ["INBOX", "UNREAD"],
    "classification": {
      "priority": "High",
      "category": "Billing / Invoice",
      "priority_reason": "Invoice due in 3 days.",
      "reply_needed": false,
      "task_needed": true,
      "task_title": "Pay invoice #1042",
      "due_date_guess": "2026-04-22",
      "confidence": 0.95
    },
    "rule_fired": "subject_billing_keywords",
    "classified_by": "rules+ai"
  }
]
```

**Response**

```json
{ "upserted": 12 }
```

**Error Responses**

| Status | Condition |
|---|---|
| `400` | Body is not an array |
| `500` | Database error (per-email errors are logged but do not fail the whole batch) |

---

### `POST /emails/:id/action`

Records a user action on an email. Used by the dashboard when the user approves, dismisses, or corrects a classification.

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `id` | string | Gmail message ID |

**Request Body**

```json
{
  "action": "approved",
  "category": "Billing / Invoice"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `action` | `approved` \| `dismissed` \| `corrected` | ✅ | User's decision |
| `category` | string | Only when `action = "corrected"` | The corrected category |

**Response**

```json
{ "ok": true, "id": "18f3a1b2c3d4e5f6" }
```

**Error Responses**

| Status | Condition |
|---|---|
| `400` | Invalid `action` value |
| `404` | Email not found |
| `500` | Database error |

---

## Email Object Shape

Full email object as returned by `GET /emails/:id`:

| Field | Type | Description |
|---|---|---|
| `id` | string | Provider message ID (primary key) |
| `thread_id` | string | Thread / conversation ID |
| `source` | string | `"gmail"` \| `"o365"` — which provider this email came from |
| `account_email` | string | The mailbox address (e.g. `"you@gmail.com"`) |
| `subject` | string | Email subject |
| `from_address` | string | Sender (name + email) |
| `to_address` | string | Recipient |
| `received_at` | ISO datetime | When the email was received |
| `body` | string | Clean plain-text body |
| `snippet` | string | Short preview from Gmail |
| `labels` | string[] | Gmail label IDs |
| `is_unread` | boolean | Whether the email is unread in Gmail |
| `priority` | `High` \| `Medium` \| `Low` | AI/rules classification |
| `category` | string | Email category |
| `priority_reason` | string | One-sentence explanation |
| `reply_needed` | boolean | Whether a reply is suggested |
| `task_needed` | boolean | Whether a task was identified |
| `task_title` | string \| null | Suggested task title |
| `due_date_guess` | date \| null | Estimated due date (ISO date) |
| `reply_draft` | string \| null | AI-generated draft reply |
| `confidence` | float | Classification confidence (0.0–1.0) |
| `rule_fired` | string \| null | Name of the rule that fired (if any) |
| `classified_by` | string | `"rules"` \| `"ai"` \| `"rules+ai"` |
| `user_action` | string \| null | `"approved"` \| `"dismissed"` \| `"corrected"` |
| `user_category` | string \| null | User-corrected category |
| `actioned_at` | ISO datetime \| null | When the user actioned the email |
| `created_at` | ISO datetime | When the record was inserted |
| `updated_at` | ISO datetime | When the record was last updated |

---

## Frontend Proxy

The Next.js frontend exposes a catch-all API proxy route at `/api/[...path]` that forwards requests to the backend. Browser requests to `/api/emails` are forwarded to `http://backend:4000/emails`.

This avoids CORS issues and means the frontend and API share the same origin from the browser's perspective.
