# Integrations

External APIs, services, and third-party systems that Priority Mail connects to.

---

## Gmail API

**Status:** Active  
**Used by:** `connectors/gmail`  
**Purpose:** Fetch unread emails from a Gmail inbox

### Authentication

OAuth2 (Desktop app flow). Requires:

- `GMAIL_CLIENT_ID` — from Google Cloud Console
- `GMAIL_CLIENT_SECRET` — from Google Cloud Console
- `GMAIL_REFRESH_TOKEN` — obtained once via `npm run auth`

The connector uses the refresh token to obtain short-lived access tokens automatically. Scopes: `gmail.readonly` (read-only, no modifications to the mailbox).

### Setup

1. Create a Google Cloud project at [console.cloud.google.com](https://console.cloud.google.com)
2. Enable the Gmail API under **APIs & Services → Enable APIs**
3. Create OAuth credentials: **Credentials → Create → OAuth client ID → Desktop app**
4. Copy `client_id` and `client_secret` into `connectors/gmail/.env`
5. Run `npm run auth` in `connectors/gmail/` to complete the OAuth flow and obtain the refresh token

### Configuration

| Env Var | Description |
|---|---|
| `GMAIL_CLIENT_ID` | OAuth2 client ID |
| `GMAIL_CLIENT_SECRET` | OAuth2 client secret |
| `GMAIL_ACCOUNT_EMAIL` | Gmail address to authorize |
| `GMAIL_REFRESH_TOKEN` | Refresh token (set after `npm run auth`) |
| `FETCH_LIMIT` | Max emails to fetch per run (default: `20`) |

### Notes

- Gmail label system (`CATEGORY_PROMOTIONS`, `CATEGORY_SOCIAL`, `CATEGORY_UPDATES`) is used by the Rules Engine as a free pre-filter
- Fetches unread messages from the `INBOX` label only
- The connector has read-only access — it does not modify, archive, or send any emails

---

## OpenRouter API

**Status:** Active  
**Used by:** `connectors/gmail/src/ai-classifier.ts`  
**Purpose:** AI-powered email classification (priority, category, task extraction, draft reply)

### Authentication

Bearer token via `Authorization: Bearer <OPENROUTER_API_KEY>` header.

### Endpoint

`POST https://openrouter.ai/api/v1/chat/completions`

Compatible with the OpenAI chat completions API format.

### Configuration

| Env Var | Description |
|---|---|
| `OPENROUTER_API_KEY` | API key from [openrouter.ai](https://openrouter.ai) |
| `OPENROUTER_MODEL` | Model to use (default: `meta-llama/llama-3.1-8b-instruct:free`) |

### Model Selection

| Model | Cost | Quality | Recommended for |
|---|---|---|---|
| `meta-llama/llama-3.1-8b-instruct:free` | Free | Good | Development / testing |
| `openai/gpt-4o-mini` | Low | Better | Production |
| `openai/gpt-4o` | Higher | Best | High-stakes classification |

### Behavior

- Email body is truncated to 800 characters before sending (token efficiency)
- Temperature is set to `0.1` for consistent, deterministic output
- On invalid JSON response, the classifier retries once with an explicit correction prompt
- If retry also fails, falls back to `{ priority: "Medium", category: "Other", confidence: 0 }`
- Emails classified as `skip_ai: true` by the Rules Engine never reach OpenRouter

### Privacy

Confidential emails (matching `CONFIDENTIAL_RE` in `rules-engine.ts`) are **never sent to OpenRouter**. They are routed to a local AI instead.

---

## Local AI (Ollama)

**Status:** Optional  
**Used by:** `connectors/gmail/src/ai-classifier.ts` (`classifyWithLocalAI`)  
**Purpose:** Classify confidential/privileged emails without sending data to any cloud provider

### Authentication

No authentication required for local Ollama instances.

### Endpoint

Any OpenAI-compatible chat completions endpoint, e.g.:
```
POST http://localhost:11434/v1/chat/completions
```

### Configuration

| Env Var | Description |
|---|---|
| `LOCAL_AI_URL` | Base URL of the local AI endpoint (e.g. `http://localhost:11434/v1`) |
| `LOCAL_AI_MODEL` | Model name (default: `llama3.2`) |

### Setup (Ollama on macOS)

```bash
brew install ollama
ollama pull llama3.2
ollama serve   # starts on http://localhost:11434
```

### When running via Docker Compose

Use `host.docker.internal` to reach Ollama on the host machine from inside a container:

```env
LOCAL_AI_URL=http://host.docker.internal:11434/v1
```

### Fallback behavior

If `LOCAL_AI_URL` is not set and a confidential email is encountered, the email is classified by rules only (`High / Client Request`) — it is never sent to any cloud provider.

---

## PostgreSQL

**Status:** Active  
**Used by:** `backend`  
**Purpose:** Persistent storage for emails and classification results

See `DATABASE.md` for full schema and connection details.

---

## Redis

**Status:** In stack, not yet in use  
**Used by:** — (reserved)  
**Purpose:** Job queue (BullMQ) for scheduled Gmail polling — planned for Phase 5

Redis 7 is included in the Docker Compose stack but no application code currently uses it.

---

## Planned Integrations (Not Yet Implemented)

| Integration | Phase | Purpose |
|---|---|---|
| Microsoft Graph API / Outlook | Phase 6 | Second email provider |
| Gmail Push Notifications (Pub/Sub) | Phase 5 | Real-time email delivery instead of polling |
| Todoist | Phase 6 | Create tasks from email suggestions |
| Linear | Phase 6 | Create issues from email suggestions |
| Notion | Phase 6 | Create tasks/pages from email suggestions |
| Google Calendar | Phase 6 | Suggest calendar events from email context |
| CRM (TBD) | Phase 6 | Log client emails to CRM |
