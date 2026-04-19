# Changelog

All notable changes to Priority Mail are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

_Changes staged but not yet released._

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
