# Changelog

All notable changes to Priority Mail are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

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
- **`source` and `account_email` fields** across the full pipeline
  - `NormalizedEmail` gains `source: "gmail" | "o365"` and `accountEmail: string`
  - `TriagedEmail` carries `source` and `accountEmail` through to the ingest payload
  - `emails` table gains `source TEXT` and `account_email TEXT` columns (migration via `ALTER TABLE IF NOT EXISTS`)
  - `GET /emails` accepts a new `?source=gmail` / `?source=o365` filter parameter
  - `POST /emails/ingest` stores `source` and `account_email` on every upsert
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
