# syntax=docker/dockerfile:1
#
# Centre Admin portal (§10.3) for the all-in-one. A workspace app that consumes
# @zuup/exam-ui as source (transpilePackages), so it must build from the repo
# root. Emits a Next standalone server (no node_modules needed at runtime) built
# with basePath=/admin to match the kiosk's edge.local/admin/ hand-off.
#
# Build context = repo root.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/exam-ui/package.json packages/exam-ui/package.json
COPY private/centre-admin/package.json private/centre-admin/package.json
COPY private/edge-server/package.json private/edge-server/package.json
COPY private/system-admin/package.json private/system-admin/package.json
RUN npm ci --no-audit --no-fund

COPY tsconfig.base.json ./
COPY packages/exam-ui packages/exam-ui
COPY private/centre-admin private/centre-admin

ENV NEXT_OUTPUT=standalone \
    NEXT_PUBLIC_BASE_PATH=/admin \
    TRACING_ROOT=/app \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w centre-admin

FROM node:24-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3002 \
    HOSTNAME=0.0.0.0
# Standalone bundle is rooted at the monorepo (TRACING_ROOT=/app): server.js
# lands under private/centre-admin/, with node_modules + packages/ alongside.
COPY --from=build /app/private/centre-admin/.next/standalone ./
COPY --from=build /app/private/centre-admin/.next/static ./private/centre-admin/.next/static
EXPOSE 3002
CMD ["node", "private/centre-admin/server.js"]
