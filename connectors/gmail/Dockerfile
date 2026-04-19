# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (layer-cached separately from source)
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source and compile TypeScript → dist/
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ─── Stage 2: Run ────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Only copy the compiled output and production deps
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

# output/ is expected to be a mounted volume so emails.json is readable on the host
VOLUME ["/app/output"]

CMD ["node", "dist/index.js"]
