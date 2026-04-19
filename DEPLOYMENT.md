# Deployment

## Environments

| Environment | Description |
|---|---|
| Local dev | Services run natively via `npm run dev` |
| Docker local | Full stack via `docker compose` on a developer machine |
| Production | Not yet defined — see `KNOWN_ISSUES.md` |

---

## Docker Compose (Recommended)

The primary way to run the full stack is via Docker Compose. All services are defined in `docker-compose.yml`.

### Services

| Service | Image | Port | Notes |
|---|---|---|---|
| `postgres` | `postgres:16-alpine` | `5432` | Persistent via `pgdata` volume |
| `redis` | `redis:7-alpine` | `6379` | Reserved for future job queue use |
| `backend` | Built from `./backend` | `4000` | Waits for Postgres healthcheck |
| `frontend` | Built from `./frontend` | `3000` | Depends on backend |
| `gmail-connector` | Built from `./connectors/gmail` | — | One-shot job, no persistent port |
| `o365-connector` | Built from `./connectors/o365` | — | One-shot job, no persistent port |

### Network

All services run on the `prioritymail` Docker bridge network. Internal hostnames match service names (`postgres`, `backend`, etc.).

### Startup Order

1. `postgres` — starts first, healthcheck via `pg_isready`
2. `backend` — waits for `postgres` healthcheck to pass, then auto-migrates schema
3. `frontend` — waits for `backend` to be up
4. `gmail-connector` — run manually on demand
5. `o365-connector` — run manually on demand

---

## Running the Stack

### Start persistent services

```bash
docker compose up -d postgres backend frontend
```

### Check service status

```bash
docker compose ps
docker compose logs -f backend
```

### Run the Gmail connector (fetch + triage + ingest)

```bash
docker compose run --rm gmail-connector
```

### Run the O365 connector (fetch + triage + ingest)

```bash
docker compose run --rm o365-connector
```

### Stop all services

```bash
docker compose down
```

### Stop and remove all data (including the database volume)

```bash
docker compose down -v
```

---

## Building Images

### Build all services

```bash
docker compose build
```

### Build individual services

```bash
docker compose build backend
docker compose build frontend
docker compose build gmail-connector
```

### Rebuild and restart after code changes

```bash
docker compose build backend frontend
docker compose up -d --force-recreate backend frontend
```

---

## Dockerfiles

### `backend/Dockerfile`

Multi-stage build: installs dependencies, compiles TypeScript, produces a lean production image. Runs `node dist/server.js`.

### `frontend/Dockerfile`

Multi-stage Next.js build. Uses the Next.js standalone output for a minimal production image.

### `connectors/gmail/Dockerfile`

Single-stage: installs dependencies, compiles TypeScript, runs `node dist/index.js`. Designed for one-shot execution.

---

## Environment Variables at Runtime

### Backend (Docker)

Set in `docker-compose.yml` under the `backend` service:

```yaml
environment:
  PORT: "4000"
  DATABASE_URL: postgres://pm_user:pm_pass@postgres:5432/prioritymail
```

### Frontend (Docker)

```yaml
environment:
  BACKEND_URL: http://backend:4000
  PORT: "3000"
```

The `BACKEND_URL` is used by Next.js server-side rendering to reach the backend within the Docker network. Browser-side requests go through the `/api` proxy.

### Gmail Connector (Docker)

Loaded from `connectors/gmail/.env` via `env_file:` directive, plus:

```yaml
environment:
  BACKEND_URL: http://backend:4000
```

The `BACKEND_URL` tells the connector where to POST triaged results.

---

## Postgres Credentials

Default Docker Compose credentials (development only — change for production):

| Setting | Value |
|---|---|
| Database | `prioritymail` |
| User | `pm_user` |
| Password | `pm_pass` |

---

## Health Check

The backend exposes a health endpoint:

```
GET http://localhost:4000/health
→ { "status": "ok", "ts": "..." }
```

The `postgres` service has a built-in Docker healthcheck:

```yaml
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U pm_user -d prioritymail"]
  interval: 5s
  timeout: 5s
  retries: 10
```

---

## Production Considerations

There is no production deployment defined yet. Before deploying to production, the following must be addressed:

- Replace hardcoded Postgres credentials with secrets management
- Restrict CORS origins in the backend (`server.ts` currently allows all origins)
- Add HTTPS (TLS termination via reverse proxy, e.g. Nginx or Caddy)
- Add authentication to protect the API and dashboard
- Consider running the Next.js frontend behind a CDN
- Set up log aggregation
- Define a backup strategy for the `pgdata` volume

See `KNOWN_ISSUES.md` for more detail on production gaps.
