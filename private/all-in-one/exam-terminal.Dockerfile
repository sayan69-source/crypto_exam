# syntax=docker/dockerfile:1
#
# Exam-terminal portal (the Login Gate, candidate seat, invigilator console)
# for the all-in-one. This app is standalone (its own lockfile, not a workspace),
# so it builds from its own directory. Emits a Next standalone server.
#
# Build context = private/exam-terminal.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
