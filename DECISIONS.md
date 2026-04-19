# Architectural Decisions

Key technical and product decisions made during the development of Priority Mail, with context and rationale.

---

## ADR-001 — AI recommends, human approves

**Decision:** The system never takes automatic actions. All AI-generated suggestions (task creation, reply sending, email archiving) require explicit user approval.

**Rationale:** Email actions are high-stakes. A false positive that auto-archives an important email or sends an unreviewed reply would seriously damage user trust. Keeping humans in the loop is the safest default for an MVP.

**Status:** Active — applies through at least Phase 3.

---

## ADR-002 — Rules Engine runs before AI

**Decision:** A deterministic rules engine (`rules-engine.ts`) runs on every email before any AI call. Emails fully resolved by rules skip the AI entirely (`skip_ai: true`).

**Rationale:** ~80% of inbox volume is newsletters, promotions, or well-understood automated emails. Running AI on these wastes tokens and adds latency. Rules are free and instant.

**Status:** Active.

---

## ADR-003 — Gmail as the first provider

**Decision:** Gmail API (OAuth2) was chosen for the MVP connector over Microsoft Graph / Outlook.

**Rationale:** Developer has a Gmail account available for testing. Gmail's label system (`CATEGORY_PROMOTIONS`, etc.) provides a free pre-filter that improves triage quality. Outlook support is planned for a later phase.

**Status:** Active. Outlook planned for Phase 6.

---

## ADR-004 — OpenRouter as the AI gateway

**Decision:** Email classification calls are routed through [OpenRouter](https://openrouter.ai) rather than directly to a single AI provider.

**Rationale:** OpenRouter allows switching models (e.g. `llama-3.1-8b-instruct:free` → `gpt-4o-mini`) without code changes. The free-tier Llama model keeps costs at $0 during development.

**Status:** Active. Model is configurable via `OPENROUTER_MODEL` env var.

---

## ADR-005 — Confidential emails routed to local AI only

**Decision:** Emails whose body or subject matches a confidentiality pattern (attorney-client privilege, "this email is confidential", etc.) are flagged with `local_ai_only: true` and routed to a local Ollama-compatible endpoint. If no local AI is configured, they are classified by rules only — they are never sent to any cloud provider.

**Rationale:** Sending privileged or confidential communications to a third-party AI introduces legal and data-privacy risks. Local models (e.g., Ollama + llama3.2) can handle triage without data leaving the machine.

**Status:** Active. See `CONFIDENTIAL_RE` in `rules-engine.ts`.

---

## ADR-006 — Security / 2FA emails skip all AI

**Decision:** Emails from security-related sender domains (Google, Microsoft, GitHub, Okta, etc.) or matching 2FA subject patterns skip all AI processing entirely — cloud and local.

**Rationale:** These emails contain OTP codes, recovery links, and account-access tokens. Sending them to any AI model (even a local one) creates unnecessary exposure, and they don't benefit from AI triage — priority and category are already deterministic.

**Status:** Active. See `SECURITY_SENDER_DOMAINS` and `SECURITY_SUBJECT_RE` in `rules-engine.ts`.

---

## ADR-007 — PostgreSQL as the primary data store

**Decision:** PostgreSQL 16 is used for persistent storage. The schema is applied automatically on backend startup via `migrate()`.

**Rationale:** Structured email and classification data fits a relational model well. PostgreSQL's JSONB and array types handle labels cleanly. SQLite was considered but ruled out to avoid needing a migration when scaling.

**Status:** Active. Schema in `backend/src/db/schema.sql`.

---

## ADR-008 — Single-user MVP

**Decision:** The MVP supports a single Gmail account and a single user dashboard. Multi-user support is deferred.

**Rationale:** Keeps auth, data isolation, and credential management simple. Multi-user adds significant complexity before the core triage loop has been validated.

**Status:** Active. Multi-user planned for Phase 6.

---

## ADR-009 — Gmail connector as a one-shot job

**Decision:** The Gmail connector runs as a one-shot Docker Compose job (`docker compose run --rm gmail-connector`) rather than a long-running service with a scheduler.

**Rationale:** Polling frequency requirements are unknown. Manual triggering is sufficient for the MVP and avoids the complexity of a job scheduler. BullMQ + Redis (already in the stack) will be used for scheduled polling in a later phase.

**Status:** Active. Scheduled polling planned when Phase 4 begins.

---

## ADR-010 — Frontend uses Next.js server components for data fetching

**Decision:** The inbox and detail pages use Next.js server-side rendering (`async` server components) to fetch from the backend. Browser-side actions (approve/dismiss/correct) use client-side `fetch` through the `/api/[...path]` proxy.

**Rationale:** SSR means no loading spinners on initial render and no need for a client-side state management layer for the read path. The proxy rewrite avoids CORS issues and keeps the frontend URL scheme clean.

**Status:** Active.
