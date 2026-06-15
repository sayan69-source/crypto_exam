# syntax=docker/dockerfile:1
#
# Centre Edge (Fastify, §5/§13) for the ZUUP-OS all-in-one demo.
#
# The Edge runs its TypeScript source DIRECTLY under Node 24 (native type
# stripping) — there is no build step, exactly as `npm start` does on a real
# centre appliance. We do a workspace-aware `npm ci` so fastify / pg /
# @noble-hashes resolve from the hoisted root node_modules.
#
# Build context = repo root.
FROM node:24-bookworm-slim

WORKDIR /app

# Manifests first so the dependency layer is cached across source edits. Every
# workspace listed in the root package.json must be present for `npm ci`.
COPY package.json package-lock.json ./
COPY packages/exam-ui/package.json packages/exam-ui/package.json
COPY private/centre-admin/package.json private/centre-admin/package.json
COPY private/edge-server/package.json private/edge-server/package.json
COPY private/system-admin/package.json private/system-admin/package.json
RUN npm ci --no-audit --no-fund

# Edge source + SQL migrations + demo seed.
COPY private/edge-server private/edge-server

WORKDIR /app/private/edge-server
ENV EDGE_HOST=0.0.0.0 \
    EDGE_PORT=4000
EXPOSE 4000

# index.ts opens the pool, builds the §13 API and listens. migrate.ts / the demo
# seed are run as one-shot commands by the edge-init service (see compose).
CMD ["node", "src/index.ts"]
