# syntax=docker/dockerfile:1.7

# ── Stage 1: deps + build ─────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Enable corepack so we get the pinned pnpm version from package.json
RUN corepack enable

# Install OS deps for native builds + ffmpeg (used by the ffmpeg_command tool at runtime)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies first (better cache reuse)
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

# Build client + server bundle
COPY . .
RUN pnpm build

# Prune to production deps for the runtime image
RUN pnpm prune --prod

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# ffmpeg is the one binary the agent shells out to via the ffmpeg_command tool.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg ca-certificates curl tini \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/package.json ./package.json

EXPOSE 3000

# tini reaps zombies (important for ffmpeg subprocesses)
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
