# Development Guide

## Prerequisites

- Node.js 18+
- Docker + Docker Compose
- A Google Cloud project with:
  - Gmail API enabled
  - OAuth 2.0 credentials (Desktop app type)
- An [OpenRouter](https://openrouter.ai) API key

---

## Repository Layout

```
priorityMail/
├── connectors/
│   └── gmail/          # Gmail connector + Rules Engine + AI Classifier
├── backend/            # Express REST API
├── frontend/           # Next.js dashboard
├── docs/               # Planning documents
└── docker-compose.yml
```

Each package has its own `package.json`, `tsconfig.json`, and `Dockerfile`.

---

## Initial Setup

### 1. Configure the Gmail connector

```bash
cp connectors/gmail/.env.example connectors/gmail/.env
```

Edit `connectors/gmail/.env`:

```env
GMAIL_CLIENT_ID=<from Google Cloud Console>
GMAIL_CLIENT_SECRET=<from Google Cloud Console>
GMAIL_ACCOUNT_EMAIL=you@gmail.com
OPENROUTER_API_KEY=sk-or-...
```

### 2. Authorize Gmail (one-time)

This must run locally — it opens a browser for the OAuth flow.

```bash
cd connectors/gmail
npm install
npm run auth
```

Follow the prompts and copy the printed `GMAIL_REFRESH_TOKEN` into `connectors/gmail/.env`.

### 3. Configure the backend (optional for local dev)

```bash
cp backend/.env.example backend/.env
# Default DATABASE_URL works with Docker Compose
```

---

## Running the Full Stack (Docker)

```bash
# Start persistent services
docker compose up -d postgres backend frontend

# Fetch and triage emails (runs once, then exits)
docker compose run --rm gmail-connector

# Open the dashboard
open http://localhost:3000
```

### Rebuilding after code changes

```bash
docker compose build backend
docker compose build frontend
docker compose build gmail-connector
docker compose up -d --force-recreate backend frontend
```

---

## Running Services Locally (without Docker)

### Backend

```bash
cd backend
npm install
# Requires a running PostgreSQL instance — update DATABASE_URL in .env if needed
npm run dev      # ts-node-dev with auto-restart
```

### Frontend

```bash
cd frontend
npm install
# Ensure BACKEND_URL is set or defaults to http://localhost:4000
npm run dev      # Next.js dev server on port 3000
```

### Gmail Connector

```bash
cd connectors/gmail
npm install
npm run dev      # Fetches emails, runs triage, writes output/triaged.json
```

---

## Available Scripts

### `connectors/gmail`

| Command | Description |
|---|---|
| `npm run auth` | One-time OAuth2 flow — prints refresh token |
| `npm run dev` | Run the triage pipeline locally |
| `npm run build` | Compile TypeScript to `dist/` |

### `backend`

| Command | Description |
|---|---|
| `npm run dev` | Start with ts-node-dev (hot reload) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Start compiled `dist/server.js` |

### `frontend`

| Command | Description |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production Next.js build |
| `npm start` | Start production server |

---

## Environment Variables Reference

### `connectors/gmail/.env`

| Variable | Required | Description |
|---|---|---|
| `GMAIL_CLIENT_ID` | ✅ | OAuth2 client ID from Google Cloud Console |
| `GMAIL_CLIENT_SECRET` | ✅ | OAuth2 client secret |
| `GMAIL_ACCOUNT_EMAIL` | ✅ | Gmail address to authorize |
| `GMAIL_REFRESH_TOKEN` | ✅ | Set after running `npm run auth` |
| `OPENROUTER_API_KEY` | ✅ | OpenRouter API key |
| `OPENROUTER_MODEL` | — | AI model (default: `meta-llama/llama-3.1-8b-instruct:free`) |
| `LOCAL_AI_URL` | — | Ollama base URL for confidential emails (e.g. `http://localhost:11434/v1`) |
| `LOCAL_AI_MODEL` | — | Local model name (default: `llama3.2`) |
| `BACKEND_URL` | — | If set, POSTs results to this URL after triage |
| `FETCH_LIMIT` | — | Max emails to fetch per run (default: `20`) |
| `AUTH_PORT` | — | Port for one-time auth callback (default: `3000`) |

### `backend/.env`

| Variable | Required | Description |
|---|---|---|
| `PORT` | — | Server port (default: `4000`) |
| `DATABASE_URL` | ✅ | PostgreSQL connection string |

---

## Local AI Setup (Ollama)

For testing confidential email routing without sending data to the cloud:

```bash
brew install ollama
ollama pull llama3.2
ollama serve   # starts on http://localhost:11434
```

Then in `connectors/gmail/.env`:

```env
LOCAL_AI_URL=http://localhost:11434/v1
LOCAL_AI_MODEL=llama3.2
```

When running the connector via Docker Compose, use `host.docker.internal` instead:

```env
LOCAL_AI_URL=http://host.docker.internal:11434/v1
```

---

## Inspecting Output

After running the Gmail connector, triage results are written to:

```
connectors/gmail/output/triaged.json
```

This file is also mounted into the Docker container via a volume, so it's accessible on the host machine regardless of how the connector is run.

---

## Logs

```bash
# All services
docker compose logs -f

# Individual service
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f gmail-connector
```
