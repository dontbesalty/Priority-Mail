# Known Issues

Current limitations, bugs, technical debt, and unresolved issues in Priority Mail.

---

## Security

### No API Authentication
**Severity:** High (for any non-local deployment)  
The backend API has no authentication. All endpoints are publicly accessible to anyone on the network. Do not deploy to a public server without adding authentication first.  
**Resolution:** Add JWT or session-based auth before any production deployment.

### No Dashboard Authentication
**Severity:** High (for any non-local deployment)  
The Next.js dashboard has no login. Anyone who can reach port 3000 can view and action all emails.  
**Resolution:** Add authentication in tandem with the API auth work.

### Hardcoded Postgres Credentials
**Severity:** Medium  
`docker-compose.yml` contains hardcoded development credentials (`pm_user` / `pm_pass`). These must not be used in production.  
**Resolution:** Move credentials to environment variables or a secrets manager before production deployment.

### CORS Allows All Origins
**Severity:** Medium (for any non-local deployment)  
The backend uses `cors()` with default settings, allowing requests from any origin.  
**Resolution:** Restrict to the known frontend origin before production deployment.

---

## Infrastructure

### No Migration Framework
**Severity:** Medium  
The database schema is applied via a single `schema.sql` file using `CREATE TABLE IF NOT EXISTS`. Adding new columns to an existing deployment requires manual `ALTER TABLE` statements.  
**Resolution:** Introduce a migration tool (e.g. `node-pg-migrate` or `db-migrate`) before the schema changes significantly.

### No Automated Test Suite
**Severity:** Medium  
There are no unit or integration tests. Changes must be verified manually by running the connector against a real inbox and visually inspecting `output/triaged.json`.  
**Resolution:** Add tests for the Rules Engine (`applyRules`), the AI classifier JSON validation (`validateClassification`), and the triage pipeline merge logic.

### Redis is Unused
**Severity:** Low  
Redis 7 is included in the Docker Compose stack but no code currently uses it.  
**Resolution:** Remove from the stack or begin using it for job queuing when scheduled polling is implemented (Phase 5).

### No Scheduled Polling
**Severity:** Low  
The Gmail connector is a one-shot job — it must be run manually to fetch new emails. There is no background scheduler.  
**Resolution:** Implement BullMQ + Redis-backed polling queue (Phase 5).

---

## Email Processing

### `is_unread` Reflects State at Fetch Time Only
**Severity:** Low  
The `is_unread` field is set when the email is fetched from Gmail. If the user reads the email in Gmail after it has been ingested, `is_unread` in the Priority Mail database will not update.  
**Resolution:** Re-sync unread status on each connector run, or add a webhook/push notification integration.

### Retention Policy Severing Task Links
**Severity:** Low  
The cleanup process purges emails based on priority (Low/48h, Med/1w, High/1m). Associated tasks remain in the `tasks` table but their `email_id` is set to `NULL`. This is intentional but means the original email content is no longer reachable from the task.

### No Deduplication Between Runs
**Severity:** Low  
Running the Gmail connector twice in a row will re-ingest the same emails. The `upsert` behavior updates classification fields, but re-processing adds unnecessary AI overhead.  
**Resolution:** Check the DB for existing email IDs before making AI calls, or filter out already-ingested emails in the connector.

### HTML Stripping Is Basic
**Severity:** Low  
The HTML stripper in `normalize.ts` is a regex-based approach. Complex newsletter HTML or heavily nested tables may produce garbled text. The `html-to-text` npm package would produce cleaner output for edge cases.  
**Resolution:** Replace the regex stripper with `html-to-text` for more reliable HTML → plain text conversion.

### Rules Engine First-Match-Wins
**Severity:** Low  
Rules run in order and the first match wins. An email that matches both a newsletter domain rule and a billing subject keyword will be classified as newsletter (newsletter rule is checked first).  
**Resolution:** Consider a scoring/weighted approach for conflicting rules when edge cases are identified.

### Confidential Detection May Have False Positives
**Severity:** Low  
The `CONFIDENTIAL_RE` regex matches broadly. Some legitimate non-privileged emails (e.g. automated notifications mentioning the word "confidential") may be incorrectly routed to local AI.  
**Resolution:** Tune the regex and/or require multiple signals before triggering `local_ai_only`.

---

## Frontend

### No Real-Time Updates
**Severity:** Low  
The inbox page is server-side rendered and does not auto-refresh. To see newly ingested emails, the user must manually reload the page.  
**Resolution:** Add a polling mechanism or WebSocket push for dashboard updates (Phase 3).

### No Pagination
**Severity:** Low  
`GET /emails` returns a maximum of 100 results. Inboxes with more than 100 unactioned emails will be silently truncated.  
**Resolution:** Add cursor-based or offset pagination to the API and implement infinite scroll or pagination in the dashboard.

### No Filter / Sort Controls
**Severity:** Low  
The inbox view is always sorted by priority then date. There are no controls to filter by category, date range, or search by subject/sender.  
**Resolution:** Planned for Phase 3.

---

## Production Readiness

### No CI/CD Pipeline
There is no automated build, test, or deployment pipeline.

### No Observability
There is no metrics collection, distributed tracing, or structured logging. Console logs only.

### No Backup Strategy
The `pgdata` Docker volume is not backed up. A volume loss means all ingested emails and user feedback are lost.

### No Production Deployment Target
There is no defined infrastructure for hosting Priority Mail beyond a local Docker Compose setup.
