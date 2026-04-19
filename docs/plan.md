# Priority Mail — AI Email Triage Assistant
## Project Plan

---

## 1. Vision

An AI-powered email assistant that reads a user's inbox and helps them decide what needs attention, what needs a reply, and what should become a task — without taking any automatic actions. The AI recommends, the human approves.

---

## 2. Core Problems Being Solved

| Problem | Solution |
|---|---|
| Too much time reading unimportant email | Prioritization + categorization on every email |
| Hard to decide what's urgent | High / Medium / Low priority scores with reasoning |
| Converting emails into tasks manually | Automatic task extraction with due dates and assignees |
| Writing the same replies over again | Draft reply generation in multiple tones |

---

## 3. Product Phases

### Phase 1 — Mail Reading MVP
> Goal: Get a real mailbox connected and display unread emails.

- [ ] User login / authentication
- [ ] Connect Outlook mailbox via Microsoft Graph API
- [ ] Pull and normalize unread emails
- [ ] Display raw email list in the UI
- [ ] Strip signatures and quoted history from email bodies

---

### Phase 2 — AI Triage MVP
> Goal: Classify every email using AI and display results.

- [ ] Integrate OpenRouter API
- [ ] Build prompt templates for classification
- [ ] Parse and validate AI responses
- [ ] Display priority level and category per email
- [ ] Apply hard-coded rules before AI (Rules Engine — see Section 6)

**AI output per email:**
```
priority          → High / Medium / Low
category          → Client Request, Billing, Internal, etc.
reply_needed      → true / false
task_needed       → true / false
task_title        → string
due_date_guess    → date or null
reply_draft       → string
confidence        → 0.0 – 1.0
```

---

### Phase 3 — Task + Reply Suggestions
> Goal: Let users act on AI suggestions from within the app.

- [ ] Extract tasks from emails (title, due date, responsible person, next step)
- [ ] Generate draft replies (Short / Professional / Friendly / Detailed)
- [ ] Allow users to edit drafts before sending
- [ ] No automatic sending — user must approve all actions

---

### Phase 4 — Smart Inbox
> Goal: Make the inbox easier to navigate at scale.

- [ ] Rank unread emails by importance
- [ ] Daily summary digest
- [ ] Group emails by category
- [ ] Follow-up reminders for unanswered threads

---

### Phase 5 — Feedback & Learning
> Goal: Let the system improve from user corrections.

- [ ] Users can correct AI classifications
- [ ] Save corrections to the database
- [ ] Use corrections to refine prompts and rules over time

---

### Phase 6 — Production & Integrations
> Goal: Scale the product and connect external tools.

- [ ] Add Gmail API support (multi-provider)
- [ ] Shared mailbox support
- [ ] Create tasks in external apps (e.g., Todoist, Linear, Notion)
- [ ] Calendar event suggestions from email context
- [ ] CRM integration
- [ ] Team / multi-user features

---

## 4. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript + Next.js |
| Backend | Node.js + TypeScript |
| Database | PostgreSQL |
| Queue / Jobs | Redis + BullMQ |
| AI | OpenRouter API |
| Email (Phase 1) | Microsoft Graph API (Outlook) |
| Email (Phase 6) | Gmail API |

---

## 5. Architecture

```
[ Browser / Dashboard (Next.js) ]
            │
            ▼
[ Backend API (Node.js / TypeScript) ]
            │
            ▼
[ AI Service Layer ] ──────────────► OpenRouter API
            │
            ▼
[ Rules Engine ]
            │
            ▼
[ PostgreSQL + Redis (BullMQ) ]
            │
            ▼
[ Mail Connector Service ] ────────► Microsoft Graph / Gmail
```

---

## 6. Key Components

### Mail Connector Service
Handles all communication with email providers.
- OAuth authentication with the mailbox
- Pull unread emails on a schedule (via BullMQ queue)
- Normalize email format across providers
- Strip signatures and quoted reply history

### Rules Engine
Fast, hard-coded rules that run *before* the AI to reduce cost and latency.

| Rule | Result |
|---|---|
| Sender is in VIP list | → High Priority |
| Subject contains "invoice" | → Billing category |
| Sender is on internal domain | → Internal Team category |
| Sender is a known newsletter | → Low Priority |

### AI Classification Service
Calls OpenRouter with a structured prompt. Returns a structured JSON response with priority, category, task data, and a draft reply.

### Email Dashboard (Frontend)
- Inbox view sorted by priority
- Per-email detail panel: category, reason, suggested task, draft reply
- Approve / edit / dismiss actions
- No automatic sending

---

## 7. Email Categories

- Client Request
- Internal Team
- Billing / Invoice
- Sales Lead
- Support Issue
- Waiting On Someone Else
- Newsletter / Marketing
- Spam / Low Importance

---

## 8. Guiding Principles

1. **AI recommends, human approves** — no automatic actions in Phase 1–3
2. **Show the reasoning** — always display why an email was prioritized
3. **Rules first, AI second** — use cheap rules before expensive AI calls
4. **Correctability** — every AI decision can be overridden by the user
5. **Learn over time** — store corrections and use them to improve
6. **Start simple** — one mailbox, one user, one provider to start

---

## 9. Open Questions

- [ ] Which email provider to support first (Outlook confirmed for Phase 1)?
- [ ] Where should created tasks be stored — internal DB only, or external app?
- [ ] What is the reply approval flow — copy to clipboard, send via API, or both?
- [ ] Will there be a mobile view or is desktop-first acceptable for MVP?
- [ ] What is the billing / pricing model (if any) for the product?
