# Gmail Connector — POC

Fetches unread emails from a Gmail inbox via the Gmail API (OAuth2), normalises them into a clean data shape, and writes the results to `output/emails.json`.

This is the first proof-of-concept for the mail connector layer.  
No emails are modified. Read-only access only.

---

## Quick Start

### 1. Install dependencies

```bash
cd connectors/gmail
npm install
```

### 2. Create a Google Cloud project & credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (e.g. `priority-mail-poc`)
3. Enable the **Gmail API** (`APIs & Services → Enable APIs`)
4. Go to `APIs & Services → Credentials → Create Credentials → OAuth client ID`
5. Choose **Desktop app** as the application type
6. Download the JSON file — you'll need `client_id` and `client_secret` from it

### 3. Configure your environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:
```
GMAIL_CLIENT_ID=<your client_id>
GMAIL_CLIENT_SECRET=<your client_secret>
GMAIL_REDIRECT_URI=urn:ietf:wg:oauth:2.0:oob
```

### 4. Authorise (one-time)

```bash
npm run auth
```

This will:
- Print an OAuth URL — open it in your browser
- Ask you to paste back the code Google shows you
- Print your `GMAIL_REFRESH_TOKEN`

Copy the token into your `.env`:
```
GMAIL_REFRESH_TOKEN=<token from above>
```

### 5. Fetch emails

```bash
npm run dev
```

The connector will:
- Fetch up to `FETCH_LIMIT` (default: 20) unread inbox emails
- Print a summary to the terminal
- Write the full normalized data to `output/emails.json`

---

## Output shape (`NormalizedEmail`)

```json
{
  "id": "18f3a...",
  "threadId": "18f3a...",
  "subject": "Follow up on proposal",
  "from": "Alice <alice@example.com>",
  "to": "me@example.com",
  "date": "2026-04-19T08:00:00.000Z",
  "snippet": "Hi, just wanted to check in on...",
  "body": "Hi, just wanted to check in on the proposal we discussed...",
  "isUnread": true,
  "labels": ["INBOX", "UNREAD"]
}
```

---

## Project Structure

```
connectors/gmail/
├── src/
│   ├── auth.ts              # One-time OAuth2 flow to get a refresh token
│   ├── gmail-connector.ts   # Authenticates and fetches raw Gmail messages
│   ├── normalize.ts         # Converts raw Gmail API response → NormalizedEmail
│   └── index.ts             # Entry point: fetch → print summary → write JSON
├── output/                  # Auto-created; contains emails.json after a run
├── .env.example             # Copy to .env and fill in your credentials
├── package.json
├── tsconfig.json
└── README.md
```

---

## Running with Docker

This is the recommended way to run the connector in a consistent environment.

### Prerequisites
- Docker + Docker Compose installed
- `.env` file created and populated with your credentials (see Quick Start above)

### 1. One-time auth (runs locally — needs interactive terminal)

The OAuth flow is interactive, so run it outside Docker the first time:

```bash
cd connectors/gmail
npm install
npm run auth
# Paste the refresh token into your .env
```

### 2. Build & run via Docker Compose

From the **project root**:

```bash
docker compose up gmail-connector
```

Or for a clean one-shot run:

```bash
docker compose run --rm gmail-connector
```

- Emails are printed to the container logs
- `connectors/gmail/output/emails.json` is written to your **host machine** (via volume mount)

### 3. Rebuild after code changes

```bash
docker compose build gmail-connector
docker compose run --rm gmail-connector
```

---

## Next Steps

Once this POC is working, the normalized email objects feed into:
- **Rules Engine** — fast pre-classification before AI
- **AI Classification Service** — OpenRouter call for priority/category/draft reply
