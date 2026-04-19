# Security

## Overview

Priority Mail handles sensitive personal data — email content, credentials, and authentication tokens. This document describes the security model, protections in place, and known gaps.

---

## Authentication

### Gmail OAuth2

- The connector authenticates with Gmail using OAuth2 — **read-only scopes only** (`gmail.readonly`)
- A `GMAIL_REFRESH_TOKEN` is obtained once via the interactive `npm run auth` flow and stored in `connectors/gmail/.env`
- The refresh token is never stored in the database or logged
- The `.env` file must never be committed to version control — it is listed in `connectors/gmail/.gitignore`

### API Authentication

**There is currently no authentication on the backend API.** The API is fully open and accessible to anyone on the same network. This is acceptable for local/development use only.

Before any non-local deployment, API authentication must be added (see `KNOWN_ISSUES.md`).

### Dashboard Authentication

**There is currently no user login for the dashboard.** The frontend is fully open.

---

## Email Data Privacy

### AI Routing Rules

The Rules Engine applies privacy-aware routing before any AI call:

#### Security / 2FA Emails — Skip ALL AI

Emails from the following types of senders skip all AI processing (cloud and local):

- Google account security (`accounts.google.com`)
- Microsoft account security (`account.microsoft.com`)
- GitHub, GitLab, Apple, PayPal, Stripe, Okta, Auth0, Twilio/Authy, Duo, OneLogin

Emails matching 2FA/verification subject patterns (OTP codes, login codes, password resets, etc.) are also blocked from AI.

These emails are classified as `Medium / Security Alert` by the Rules Engine alone.

**Rationale:** These emails contain OTP codes, account recovery links, and session tokens. Sending them to any AI model introduces unnecessary risk.

#### Confidential / Privileged Emails — Local AI Only

Emails containing attorney-client privilege language, confidentiality notices, or similar patterns are flagged with `local_ai_only: true`:

- They are routed to `LOCAL_AI_URL` (a local Ollama-compatible endpoint)
- If no local AI is configured, they are classified by rules only (never sent to any cloud provider)
- They are **never** sent to OpenRouter or any other cloud AI service

**Rationale:** Privileged communications carry legal and contractual obligations around confidentiality. Local models (Ollama) process the email without the data leaving the machine.

---

## Secrets Management

### Current State (Development)

| Secret | Storage Location |
|---|---|
| `GMAIL_CLIENT_ID` | `connectors/gmail/.env` (git-ignored) |
| `GMAIL_CLIENT_SECRET` | `connectors/gmail/.env` (git-ignored) |
| `GMAIL_REFRESH_TOKEN` | `connectors/gmail/.env` (git-ignored) |
| `OPENROUTER_API_KEY` | `connectors/gmail/.env` (git-ignored) |
| Postgres password | `docker-compose.yml` (hardcoded dev value) |

`.env` files are never committed. `.env.example` files contain only placeholder values and are safe to commit.

### Production Requirements (Not Yet Implemented)

- Use a secrets manager (e.g. AWS Secrets Manager, Doppler, Docker Secrets) for all credentials
- Rotate the Postgres password from the default `pm_pass`
- Rotate the Gmail refresh token periodically

---

## Network Security

### Current State (Development)

- The backend API is open — no auth, no rate limiting
- CORS is configured with `cors()` defaults (allows all origins)
- All services communicate over a private Docker bridge network

### Production Requirements

- Restrict CORS to known frontend origins
- Add API authentication (JWT or session-based)
- Add rate limiting on the API (especially `/emails/ingest`)
- Place the backend behind a reverse proxy (Nginx/Caddy) — do not expose it directly
- Enforce HTTPS on all outbound-facing services

---

## Data at Rest

- Email bodies, subjects, sender information, and AI classifications are stored in plain text in PostgreSQL
- There is no encryption at rest for the database (relies on host-level/volume encryption)
- The `pgdata` Docker volume should be encrypted at the host level in production deployments

---

## Data in Transit

- Gmail API calls use HTTPS (enforced by the Google client library)
- OpenRouter API calls use HTTPS
- Local AI calls (`LOCAL_AI_URL`) may use HTTP if running on localhost — acceptable for local development only
- Internal Docker service communication uses the private `prioritymail` bridge network (unencrypted, but isolated)

---

## Logging

- Email subjects and sender domains are logged to the connector console for debugging
- **Email bodies are not logged**
- Classification results (priority, category, reason) are logged at the connector level
- Avoid logging raw email content in production log pipelines

---

## Reporting Security Issues

If you discover a security vulnerability, do not open a public GitHub issue. Contact the project maintainer directly.
