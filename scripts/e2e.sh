#!/usr/bin/env bash
set -euo pipefail
# PW_VERSION MUST equal the @playwright/test version npm ci installs. It is
# pinned EXACT in package.json; bump both together.
PW_VERSION="1.61.1"
# Run-scoped webServer port so concurrent runs on a shared host never fight
# over one port.
E2E_PORT="${E2E_PORT:-$((3100 + RANDOM % 800))}"
cd "$(dirname "$0")/.."
# This app is DB-less: no database step, no DATABASE_URL. The webServer in
# playwright.config.ts builds the frontend and runs the production app with
# a local iNaturalist stub, so the suite never touches the live upstream.
# --user runs as the host user (never root) so npm ci does not leave
# root-owned files on the bind mount. HOME/npm cache go to /tmp.
docker run --rm --init --ipc=host --network host \
  --user "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm \
  -e CI=1 -e E2E_PORT="$E2E_PORT" -v "$PWD":/work -w /work \
  "mcr.microsoft.com/playwright:v${PW_VERSION}-noble" \
  sh -c 'npm ci && npm run test:e2e'
