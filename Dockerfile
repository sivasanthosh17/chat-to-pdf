# syntax=docker/dockerfile:1
#
# Single-container deployment: Express serves the API and the built React app
# from the same origin. The runtime image is Playwright's official image, which
# already contains Chromium and its system dependencies. Its tag MUST match the
# exact "playwright" version in server/package.json.

# ── 1. Build the frontend ───────────────────────────────────────────────────
FROM node:22-bookworm-slim AS client-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ── 2. Runtime ──────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/playwright:v1.64.0-noble

# Fonts for broad Unicode coverage in PDFs (Indic, CJK, Arabic, emoji …)
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=5000 \
    CLIENT_DIST_DIR=/app/client/dist \
    CORS_ORIGIN=http://localhost:5000 \
    DB_PATH=/app/server/data/chatpdf.db

WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/src ./src
COPY server/scripts ./scripts
COPY --from=client-build /app/client/dist /app/client/dist

# Accounts database (users, sessions, usage counts) lives in a volume so it
# survives image upgrades. Mount it with: -v chatpdf-data:/app/server/data
RUN mkdir -p /app/server/data && chown pwuser /app/server/data
VOLUME ["/app/server/data"]

# Run as the image's unprivileged user
USER pwuser

EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:5000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
