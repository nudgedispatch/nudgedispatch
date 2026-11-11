#!/usr/bin/env bash
# Required before any booking deploy: phone (390px) and desktop (1024px) client journeys on a local
# Worker with a throwaway database. Starts from a quote/website link with the airport prefilled,
# switches the airport connection both ways, and goes through review. Never submits a booking.
# On success writes .predeploy/PREDEPLOY_E2E with the commit it ran on.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
mkdir -p .predeploy
export SCREENSHOT_DIR="${SCREENSHOT_DIR:-$ROOT/.predeploy/screens}"
export E2E_STAMP="$ROOT/.predeploy/PREDEPLOY_E2E"
rm -f "$E2E_STAMP"
if [[ -n "$(git status --porcelain --untracked-files=no 2>/dev/null)" ]]; then
  echo "predeploy-e2e: note: uncommitted changes; the stamp will not match a deploy" >&2
fi
node scripts/e2e/booking-journeys.mjs
echo "predeploy-e2e: passed; stamp $E2E_STAMP"
