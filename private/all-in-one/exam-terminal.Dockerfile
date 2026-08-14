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
# This image once baked NEXT_PUBLIC_SIMULATE_BIOMETRICS=true so a container with
# no camera could still walk through a login. That switch no longer exists in
# any form: the biometric factors are now signed by the on-device daemon, and a
# score this process could invent is a score an attacker could invent.
#
# A container therefore CANNOT log a human in, and that is the honest outcome —
# it has no camera, no fingerprint reader and no TPM. What it can do is run the
# Edge, the portals and the whole answer pipeline against real hardware
# terminals on the same network, and refuse everything else.
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
