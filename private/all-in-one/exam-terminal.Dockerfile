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
# npm's default is 2 retries with a short timeout, which loses this layer to a
# single transient registry blip — and it is a 400-second layer. Retry harder.
RUN npm config set fetch-retries 6  && npm config set fetch-retry-mintimeout 20000  && npm config set fetch-retry-maxtimeout 180000  && npm config set fetch-timeout 900000
RUN npm ci --no-audit --no-fund
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# The proving ground is a container with no camera and no fingerprint reader, so
# the biometric daemon isn't there and every factor would score 0 — a correct
# denial, but it makes the walkthrough impossible to demo. Stand the scores in
# HERE, at the container image level, where it is visible: the login screen
# labels them "simulated", and a real ZUUP-OS terminal never sets this flag.
# Baked at build time because NEXT_PUBLIC_* is inlined by `next build`.
ENV NEXT_PUBLIC_SIMULATE_BIOMETRICS=true
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
