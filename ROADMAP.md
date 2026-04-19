# Roadmap

Planned phases and features for Priority Mail. Status reflects current progress.

---

## ✅ Phase 0 — Gmail Connector POC _(done)_

- [x] OAuth2 authentication with Gmail
- [x] Fetch and normalize unread emails (`NormalizedEmail`)
- [x] HTML stripping, invisible Unicode removal, quoted history stripping
- [x] Docker support for the connector

---

## ✅ Phase 1 — Rules Engine + AI Triage _(done)_

- [x] Deterministic Rules Engine runs before AI (newsletters, promos, security, billing)
- [x] AI Classifier via OpenRouter — returns priority, category, task, draft reply
- [x] Confidential email routing to local AI (Ollama-compatible)
- [x] Security/2FA emails skip all AI entirely
- [x] Triage pipeline: fetch → rules → AI → merge → sort by priority

---

## ✅ Phase 2 — Backend API + Frontend Dashboard _(done)_

- [x] Express REST API with PostgreSQL
- [x] Auto-migration on backend startup
- [x] `POST /emails/ingest` — connector pushes triaged emails to the backend
- [x] `GET /emails`, `GET /emails/:id` — read endpoints
- [x] `POST /emails/:id/action` — user feedback (approved / dismissed / corrected)
- [x] Next.js dashboard — inbox view sorted by priority
- [x] Email detail view — classification card, task, draft reply, action buttons
- [x] Full Docker Compose stack

---

## 🔄 Phase 3 — Smart Inbox _(up next)_

- [ ] Running Task List: Add suggested tasks from emails to a persistent list ([Plan](docs/task-list-feature.md))
- [ ] Auto-refresh or on-demand refresh button in the dashboard
- [ ] Filter/sort by priority, category, date
- [ ] Daily digest view — summary of unread High + Medium emails
- [ ] Follow-up reminders for emails awaiting a reply
- [ ] Group emails by category in the inbox view

---

## 📋 Phase 4 — Feedback Loop + Prompt Improvement

- [ ] Store user corrections (already in DB via `user_category` field)
- [ ] Display correction count per category in the UI
- [ ] Use stored corrections to refine AI prompt examples (few-shot)
- [ ] Rules tuning based on common misclassifications

---

## 📋 Phase 5 — Scheduled Polling

- [ ] BullMQ job queue for periodic Gmail polling (every N minutes)
- [ ] Redis-backed job state
- [ ] Configurable polling interval per account
- [ ] Deduplication — skip emails already in DB

---

## 📋 Phase 6 — Production + Multi-Provider

- [x] Microsoft Outlook / Graph API connector _(shipped early in 0.4.0)_
- [ ] Multi-user support with account isolation
- [ ] Shared mailbox support
- [ ] User authentication (login/session)
- [ ] External task creation (Todoist, Linear, Notion)
- [ ] Calendar event suggestions from email context
- [ ] CRM integration

---

## Open Questions

- What model should be the default for production — `llama-3.1-8b-instruct:free` vs `gpt-4o-mini`?
- Polling vs. Gmail push notifications (Pub/Sub) for real-time fetch?
- Where should created tasks live — internal DB only, or sync to an external app from day 1?
- Mobile view — is desktop-first acceptable beyond the MVP?
- Pricing / billing model for the product (if any)?
