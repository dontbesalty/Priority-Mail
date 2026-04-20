# Feature Plan: Scheduled Connector Polling

## Overview

Both connectors (`gmail-connector`, `o365-connector`) are currently **one-shot jobs** — they run once when you execute `docker compose run --rm gmail-connector`, then exit. This feature adds an optional polling mode: when `POLL_INTERVAL_SECONDS` is set, the connector stays alive as a long-running service and re-runs the fetch → triage → ingest pipeline on a repeating schedule. Scheduled runs use a smaller configurable fetch limit to reduce AI cost and latency on routine polls.

---

## Current Behavior

Both connector `index.ts` files call `main()` once and exit:
```
docker compose run --rm gmail-connector
  → fetches FETCH_LIMIT emails
  → triages them
  → posts to backend
  → exits (process.exit)
```

There is no cron, no loop, no keepalive. Both services in `docker-compose.yml` have no restart policy (`restart: "no"` is implicit) — they are one-shot by design today.

---

## Goals

1. **Optional daemon mode** — Setting `POLL_INTERVAL_SECONDS` turns the connector into a long-running service that polls on a schedule.
2. **Smaller batch on polls** — `POLL_FETCH_LIMIT` controls how many emails to fetch on each scheduled run (default: `5`). `FETCH_LIMIT` stays as the initial / manual run limit (default: `20`).
3. **No new dependencies** — Implemented entirely with a `setInterval` / sleep loop inside the existing `index.ts`. No cron container, no BullMQ, no Redis scheduler needed.
4. **Deduplication is already handled** — The backend ingest uses `ON CONFLICT (id) DO UPDATE`, so re-ingesting an already-seen email just updates it. No extra work required.
5. **Dashboard shows last poll time** — The logs table already records every connector run. The frontend can display "Last polled X ago" by reading from `GET /logs?source=gmail-connector&limit=1`.

---

## Design Decision: Loop inside the connector vs. external cron

| Approach | Pros | Cons |
|---|---|---|
| **Loop inside connector** (`setInterval`) | No new services, no new dependencies, self-contained change, fits existing Dockerfile | Less flexible scheduling (no cron syntax), requires container restart to change interval |
| External cron container (`supercronic`) | Cron syntax, decoupled | New Dockerfile, new service, more complexity |
| Docker `restart: always` + sleep | Simple | Sloppy timing, process exits between runs |

**Decision: Loop inside connector.** Simplest path that works for this use case.

---

## Data / Config Changes

### New environment variables (both connectors)

| Variable | Default | Description |
|---|---|---|
| `POLL_INTERVAL_SECONDS` | unset | If set, connector runs in daemon mode and polls on this interval. If unset, connector runs once and exits (current behavior preserved). |
| `POLL_FETCH_LIMIT` | `5` | How many emails to fetch on each scheduled poll. |
| `FETCH_LIMIT` | `20` | Unchanged — used for the first run (in daemon mode) and for all manual one-shot runs. |
| `AI_CALL_DELAY_MS` | `0` | Milliseconds to wait between each AI call. Set to e.g. `1500` to stay under free-tier rate limits. When > 0, concurrency is automatically forced to 1. |

Add all new variables to `.env.example` for each connector with documentation comments.

---

## AI Rate Limiting / Call Throttling

The current `triageBatch` function in `triage-pipeline.ts` dispatches AI calls concurrently (default concurrency: 3) with no delay between them. On free-tier OpenRouter models this quickly hits the rate limit.

### How it works today (`triage-pipeline.ts`)

```typescript
export async function triageBatch(
  emails: NormalizedEmail[],
  { concurrency = 3 }: { concurrency?: number } = {}
)
```

Three workers run in parallel, each popping an email off the queue and calling `classifyWithAI()` immediately. No pacing.

### Change: `AI_CALL_DELAY_MS` + forced concurrency=1

When `AI_CALL_DELAY_MS > 0`, the connector passes `concurrency: 1` to `triageBatch` and passes the delay value through. This serializes all AI calls and inserts a sleep between each one:

```typescript
// In index.ts (both connectors)
const aiDelay = process.env.AI_CALL_DELAY_MS
  ? parseInt(process.env.AI_CALL_DELAY_MS, 10)
  : 0;
const concurrency = aiDelay > 0 ? 1 : 3;

const triaged = await triageBatch(emails, { concurrency, aiCallDelayMs: aiDelay });
```

In `triage-pipeline.ts`, the worker loop gains a post-call delay:

```typescript
export async function triageBatch(
  emails: NormalizedEmail[],
  { concurrency = 3, aiCallDelayMs = 0 }: { concurrency?: number; aiCallDelayMs?: number } = {}
): Promise<TriagedEmail[]> {
  ...
  async function worker() {
    while (idx < emails.length) {
      const email = emails[idx++];
      const triaged = await triageEmail(email);
      results.push(triaged);
      ...
      // Throttle: pause before the next AI call
      if (aiCallDelayMs > 0 && idx < emails.length) {
        await sleep(aiCallDelayMs);
      }
    }
  }
  ...
}
```

The `sleep()` helper is already defined in `index.ts`; it should be moved to `triage-pipeline.ts` or a shared utility so both the polling loop and the AI throttle can use it.

### Only delays AI calls

Emails classified entirely by the rules engine (newsletters, promos, security alerts — `skip_ai: true`) pass through instantly. The delay only fires after calls to `classifyWithAI()` or `classifyWithLocalAI()`. This means a batch of 20 emails where 15 are caught by rules will only have ~5 delays, not 20.

### Recommended value

For OpenRouter free-tier models the typical rate limit is ~1–3 requests/second. Setting `AI_CALL_DELAY_MS=1500` (1.5 seconds between calls) provides a safe buffer and keeps a 20-email batch within ~30 seconds.

---

## Code Changes

### Both `connectors/gmail/src/index.ts` and `connectors/o365/src/index.ts`

Replace the single `main()` call at the bottom with a run-loop entry point:

```typescript
async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run(): Promise<void> {
  const pollIntervalSec = process.env.POLL_INTERVAL_SECONDS
    ? parseInt(process.env.POLL_INTERVAL_SECONDS, 10)
    : null;

  if (!pollIntervalSec) {
    // One-shot mode (existing behavior)
    await main();
    return;
  }

  // Daemon mode
  console.log(`⏱️  Polling mode: running every ${pollIntervalSec}s`);

  let isFirstRun = true;
  while (true) {
    const fetchLimit = isFirstRun
      ? (process.env.FETCH_LIMIT ? parseInt(process.env.FETCH_LIMIT, 10) : 20)
      : (process.env.POLL_FETCH_LIMIT ? parseInt(process.env.POLL_FETCH_LIMIT, 10) : 5);

    await main({ fetchLimit });
    isFirstRun = false;

    console.log(`💤  Next poll in ${pollIntervalSec}s…`);
    await sleep(pollIntervalSec * 1000);
  }
}

run().catch(err => {
  console.error("❌  Fatal error:", err.message ?? err);
  process.exit(1);
});
```

The `main()` function signature is updated to accept an optional `fetchLimit` override:

```typescript
async function main({ fetchLimit }: { fetchLimit?: number } = {}): Promise<void> {
  const limit = fetchLimit ?? (process.env.FETCH_LIMIT ? parseInt(process.env.FETCH_LIMIT, 10) : 20);
  const emails = await fetchEmails(limit);
  ...
}
```

Both `fetchEmails()` functions in `gmail-connector.ts` and `o365-connector.ts` already accept a `maxResults` / `top` parameter — they just need to be updated to pass the `limit` argument through rather than reading `FETCH_LIMIT` from env internally.

### `connectors/gmail/src/gmail-connector.ts`

```typescript
// Before:
const maxResults = parseInt(process.env.FETCH_LIMIT ?? "20", 10);

// After:
export async function fetchEmails(limit = 20): Promise<NormalizedEmail[]> {
  // use `limit` instead of reading from env
```

### `connectors/o365/src/o365-connector.ts`

Same change — accept `limit` parameter, use it for `$top`.

---

## Docker Compose Changes

Add `POLL_INTERVAL_SECONDS` and `POLL_FETCH_LIMIT` to the environment block for both connector services. Change both connectors to `restart: unless-stopped` when running in daemon mode.

**Recommended: Add a comment block explaining the two modes.**

```yaml
# ── Gmail Connector ───────────────────────────────────────────────────────────
# One-shot mode (default):
#   docker compose run --rm gmail-connector
#
# Daemon mode (polls on a schedule):
#   Set POLL_INTERVAL_SECONDS in connectors/gmail/.env, then:
#   docker compose up -d gmail-connector
# ─────────────────────────────────────────────────────────────────────────────
gmail-connector:
  build:
    context: ./connectors/gmail
  networks: [prioritymail]
  env_file:
    - ./connectors/gmail/.env
  environment:
    BACKEND_URL: http://backend:4000
  restart: unless-stopped          # ← changed from no restart policy
  depends_on:
    backend:
      condition: service_healthy
  volumes:
    - ./connectors/gmail/output:/app/output
```

Same change for `o365-connector`.

> **Note:** `restart: unless-stopped` is fine even in one-shot mode — if `POLL_INTERVAL_SECONDS` is not set, the process exits cleanly after one run and Docker won't restart it (clean exit = exit code 0, which `unless-stopped` does not restart).

---

## `.env.example` additions (both connectors)

```env
# ─── Polling / Scheduling ───────────────────────────────────────────────────
# Leave unset to run once and exit (one-shot mode).
# Set to a number of seconds to run continuously on a schedule (daemon mode).
POLL_INTERVAL_SECONDS=300     # e.g. 300 = every 5 minutes

# Number of emails to fetch on each scheduled poll.
# The first run in daemon mode always uses FETCH_LIMIT.
POLL_FETCH_LIMIT=5

# ─── AI Rate Limiting ────────────────────────────────────────────────────────
# Milliseconds to wait between each AI classifier call.
# Required when using free-tier OpenRouter models that are rate-limited.
# When set > 0, AI calls are automatically serialized (concurrency forced to 1).
# Recommended: 1500 (1.5s) for free-tier models.
AI_CALL_DELAY_MS=1500
```

---

## Frontend: "Last Polled" Indicator (Optional)

The logs table already records every run. A small "Last polled X ago" indicator can be added to the dashboard header or stats bar by reading:

```
GET /logs?source=gmail-connector&level=info&limit=1
GET /logs?source=o365-connector&level=info&limit=1
```

The most recent log entry's `timestamp` gives the last run time. This requires no backend changes — only a small frontend addition.

---

## Behavior Summary

| Scenario | How to run | Fetch limit |
|---|---|---|
| Manual one-shot (current behavior) | `docker compose run --rm gmail-connector` | `FETCH_LIMIT` (default 20) |
| Daemon first run | `docker compose up -d gmail-connector` | `FETCH_LIMIT` (default 20) |
| Daemon subsequent polls | automatic, every `POLL_INTERVAL_SECONDS` | `POLL_FETCH_LIMIT` (default 5) |

---

## File Change Summary

| File | Change |
|---|---|
| `connectors/gmail/src/index.ts` | Replace `main()` call with `run()` entry point; add sleep loop; pass `fetchLimit` + `aiCallDelayMs` to `main()` and `triageBatch()` |
| `connectors/gmail/src/gmail-connector.ts` | Accept `limit` parameter on `fetchEmails()`; stop reading `FETCH_LIMIT` from env internally |
| `connectors/gmail/src/triage-pipeline.ts` | Add `aiCallDelayMs` param to `triageBatch()`; add `sleep()` helper; add delay after each AI call in worker loop |
| `connectors/gmail/.env.example` | Add `POLL_INTERVAL_SECONDS`, `POLL_FETCH_LIMIT`, `AI_CALL_DELAY_MS` |
| `connectors/o365/src/index.ts` | Same as Gmail `index.ts` changes |
| `connectors/o365/src/o365-connector.ts` | Same as Gmail `gmail-connector.ts` changes |
| `connectors/o365/src/triage-pipeline.ts` | Same as Gmail `triage-pipeline.ts` changes |
| `connectors/o365/.env.example` | Add `POLL_INTERVAL_SECONDS`, `POLL_FETCH_LIMIT`, `AI_CALL_DELAY_MS` |
| `docker-compose.yml` | Add `restart: unless-stopped` to both connector services; add usage comment block |

---

## Implementation Phases

### Phase 1 — AI Rate Limiting (do this first — independent of polling)
- [ ] Move `sleep()` helper into `triage-pipeline.ts` (or a shared `utils.ts`)
- [ ] Add `aiCallDelayMs` parameter to `triageBatch()` in both `triage-pipeline.ts` files
- [ ] Add delay logic after each email triage in the worker loop (only when `aiCallDelayMs > 0`)
- [ ] Update `index.ts` in both connectors to read `AI_CALL_DELAY_MS` from env and pass to `triageBatch()`
- [ ] Add `AI_CALL_DELAY_MS` to both `.env.example` files
- [ ] Test: set `AI_CALL_DELAY_MS=1500` and run a batch — verify calls are serialized with ~1.5s gaps

### Phase 2 — Core Polling Loop
- [ ] Update `fetchEmails()` in `gmail-connector.ts` to accept a `limit` parameter
- [ ] Update `fetchEmails()` in `o365-connector.ts` to accept a `limit` parameter
- [ ] Add `run()` entry point with sleep loop to `connectors/gmail/src/index.ts`
- [ ] Add `run()` entry point with sleep loop to `connectors/o365/src/index.ts`
- [ ] Test one-shot mode still works (no `POLL_INTERVAL_SECONDS` set)
- [ ] Test daemon mode locally with a short interval (e.g., 30s)

### Phase 3 — Config + Docker
- [ ] Add `POLL_INTERVAL_SECONDS` and `POLL_FETCH_LIMIT` to both `.env.example` files
- [ ] Update `docker-compose.yml` with `restart: unless-stopped` and usage comments
- [ ] Verify that a clean exit (exit code 0) in one-shot mode does not trigger Docker restart

### Phase 3 — Dashboard (Optional)
- [ ] Add "Last polled X ago" indicator to the frontend dashboard (reads from `/logs`)
- [ ] Show per-source last poll time (Gmail vs Outlook separately)

---

## Open Questions

1. **Interval granularity**: Is minutes enough, or should users be able to set hours? The `POLL_INTERVAL_SECONDS` approach covers both (e.g., `3600` = 1 hour).
2. **Error backoff**: If the AI API is rate-limited or the backend is down during a scheduled poll, should the connector use exponential backoff before the next poll, or just log the error and wait the full interval? The simplest approach is log + wait the full interval.
3. **Separate intervals per connector**: Should Gmail and O365 have independent schedules? They already have separate `.env` files so `POLL_INTERVAL_SECONDS` is per-connector by default.
4. **Skip poll if inbox empty**: On subsequent polls, if `fetchEmails()` returns 0 emails, the connector logs "No new emails" but still waits the full interval before next poll. This is the correct behavior — no special handling needed.
5. **First-run vs poll limit**: Should the first run in daemon mode always use `FETCH_LIMIT` (the larger value)? The current design does this to do a full initial backfill, then switch to smaller incremental polls.
