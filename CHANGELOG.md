# Changelog

All notable changes to Priority Mail are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Added
- **Scheduled Connector Polling**: Optional daemon mode for both Gmail and Outlook connectors via `POLL_INTERVAL_SECONDS`.
  - Includes run-time tracking: connectors now log how long each triage cycle took (e.g., "completed in 12.5s").
  - `dev.sh` update: Automatically detects polling configuration and switches to daemon mode when using `--connectors`.
- **AI Rate Limiting**: Added `AI_CALL_DELAY_MS` to serialize and throttle AI calls, replacing the older `AI_DELAY_MS` with a more robust implementation that forces concurrency to 1 when active.
- Added `AI_DELAY_MS` configuration to Gmail and Outlook connectors to prevent rate limiting with free AI APIs by introducing a delay between triage calls.
- **Connector Run Health** — Added "Last Run" timestamps to the frontend dashboard.
  - New `GET /logs/last-run` backend endpoint to track the most recent successful triage for each source.
  - Connectors now log a completion message with metadata (email count) after a successful run.
  - Dashboard stats bar now displays relative time (e.g., "5m ago") for Gmail and Outlook sync status.
- **Interactive Inbox** — High-speed triage directly from the dashboard.
  - New "Approve" (✅) and "Dismiss" (❌) quick-action buttons on every email row in the inbox list.
  - Optimistic UI updates: emails are removed from the view instantly when actioned, before the backend sync completes.
  - Refactored inbox into a client-side `EmailList` component for real-time state management.

### Fixed
- Fixed task list delete button and status toggle by adding missing `DELETE` and `PATCH` handlers to the frontend API proxy.

### Changed
- Improved Task List delete UX: removed browser `confirm()` popup and added an "Undo" notification that remains for 5 seconds before permanently deleting the task.

### Added
- Created `dev.sh` script to simplify Docker environment management (build, up, and one-shot connectors).
- Connector Logs feature: Added a dashboard page to view triage logs from Gmail and Outlook connectors.
- New `logs` table in PostgreSQL to store connector activity and errors.
- `/logs` backend API endpoints for ingestion and retrieval.

- **Task List Feature** — Persistent task management with email traceability.
  - New `tasks` table in PostgreSQL.
  - Backend API: `GET /tasks`, `POST /tasks`, `PATCH /tasks/:id`, `DELETE /tasks/:id`.
  - Frontend "Task List" page and global navigation.
  - "Add to Task List" button on email detail pages for AI-suggested tasks.

### Changed

- **Time‑based email fetch** — Both Gmail and Outlook connectors now fetch only emails from the last 24 hours, replacing the simple `FETCH_LIMIT=20` count limit.
  - Gmail filter: `in:inbox is:unread after:{unix_timestamp}`
  - Outlook filter: `isRead eq false and receivedDateTime ge {iso_timestamp}`
- Increased default `FETCH_LIMIT` from 20 to 200 in `.env.example` and `.env` files to accommodate high‑volume 24‑hour windows.
- Gmail connector logs the constructed query; Outlook connector logs the Graph API `$filter`.

- **Personal Custom Filters** — Users can now add their own deterministic rules in a `custom-rules.json` file (ignored by git).
  - Rules support matching by `from`, `subject`, and `body` patterns.
  - Allows overriding priority, category, and skipping AI triage.
  - Template provided as `custom-rules.json.example`.

_Changes staged but not yet released._

---

## [0.4.0] — 2026-04-19

### Added

- **Microsoft Outlook / O365 connector** (`connectors/o365/`) — fetches unread emails via Microsoft Graph API using OAuth2 + PKCE
  - `auth.ts` — one-time PKCE authorization code flow; prints refresh token for `.env`
  - `o365-connector.ts` — exchanges refresh token for access token on each run, fetches via Graph API
  - `normalize.ts` — converts Graph API message objects to `NormalizedEmail` with HTML stripping and quoted history removal
  - `index.ts` — entry point: fetch → triage → write `output/triaged.json` → POST to backend
  - Shared pipeline files (`rules-engine.ts`, `ai-classifier.ts`, `triage-pipeline.ts`) copied from Gmail connector
  - `docker compose run --rm o365-connector` one-shot job wired into `docker-compose.yml`
- **Task List Feature** — Persistent task management with email traceability.
  - New `tasks` table in PostgreSQL.
  - Backend API: `GET /tasks`, `POST /tasks`, `PATCH /tasks/:id`, `DELETE /tasks/:id`.
  - Frontend "Task List" page and global navigation.
  - "Add to Task List" button on email detail pages for AI-suggested tasks.
- **`source` and `account_email` fields** across the full pipeline
- **Frontend source indicators**
  - Blue **Gmail** badge and cyan **Outlook** badge on each email row in the inbox (visible in All view)
  - **All / Gmail / Outlook** filter tabs at the top of the inbox
  - Source badge shown next to the From address on the email detail page

---

## [0.3.0] — 2026-04-19

### Added

- **Full-stack Docker Compose** — `postgres`, `redis`, `backend`, `frontend`, and `gmail-connector` services wired together
- **Backend API** (`backend/`) — Express server with PostgreSQL, auto-migrates schema on startup
  - `GET /emails` — list triaged emails sorted by priority, supports `?priority=` and `?actioned=false` filters
  - `GET /emails/:id` — single email with full body and classification
  - `POST /emails/ingest` — bulk upsert endpoint used by the Gmail connector
  - `POST /emails/:id/action` — record user action (approved / dismissed / corrected)
  - `GET /health` — health check
- **Frontend dashboard** (`frontend/`) — Next.js 14 server-side rendered inbox
  - Inbox view sorted by priority with stats bar (High / Medium / Low / Total)
  - Email detail view with classification card, task card, reply draft, and action buttons
  - `/api/[...path]` proxy route so browser requests are forwarded to the backend
- **Gmail connector pipeline** — wires fetch → rules → AI → ingest in a single Docker run
  - Writes `output/triaged.json` locally for debugging
  - POSTs results to `BACKEND_URL` when configured
- **AI Classifier** (`ai-classifier.ts`) — OpenRouter integration with JSON validation, retry on malformed response, and structured `AIClassification` output
- **Local AI support** — confidential emails routed to `LOCAL_AI_URL` (Ollama-compatible), never sent to cloud providers

### Changed

- Rules Engine expanded with security sender domain list, confidentiality detection (`CONFIDENTIAL_RE`), and `local_ai_only` flag

---

## [0.2.0] — 2026-04-12

### Added

- **Rules Engine** (`rules-engine.ts`) — deterministic pre-classifier, runs before AI
  - Gmail label rules: `CATEGORY_PROMOTIONS`, `CATEGORY_SOCIAL`, `CATEGORY_UPDATES`
  - Newsletter and promotional sender domain blocklists
  - Real estate alert domain detection
  - Security/2FA sender domain list — these emails skip all AI entirely
  - Billing/invoice and deadline keyword rules
  - `skip_ai` and `local_ai_only` flags on `RulesResult`
- **Triage pipeline** (`triage-pipeline.ts`) — merges rules and AI results, rules take precedence at `confidence = 1.0`, concurrent batch processing with configurable concurrency

---

## [0.1.0] — 2026-04-05

### Added

- **Gmail connector POC** — OAuth2 auth flow, fetches unread emails, normalises to `NormalizedEmail`
- `normalize.ts` — HTML stripping, invisible Unicode removal, quoted reply history stripping, plain-text extraction from MIME tree
- `auth.ts` — one-time OAuth2 refresh token flow
- `gmail-connector.ts` — fetches up to `FETCH_LIMIT` unread messages
- Writes `output/emails.json` with normalized email data
- Docker support for the connector
