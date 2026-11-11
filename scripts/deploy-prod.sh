#!/usr/bin/env bash
# Production deploy of the nudge-app Worker. Refuses unless:
#   * the working tree is clean,
#   * npm run check passes,
#   * scripts/predeploy-e2e.sh passed on this exact commit (booking phone walkthrough),
#   * NUDGE_DEPLOY_CONFIRM=yes is set by the person deploying.
# D1 migrations are NOT applied here. Apply them separately, on purpose, after review.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
CONFIG="${NUDGE_PROD_CONFIG:-wrangler.prod.toml}"
[[ -f "$CONFIG" ]] || { echo "deploy-prod: $CONFIG not found" >&2; exit 1; }
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || { echo "deploy-prod: commit or stash changes first" >&2; exit 1; }
npm run check
bash scripts/predeploy-e2e.sh
SHA=$(git rev-parse HEAD)
grep -qx "sha=$SHA" .predeploy/PREDEPLOY_E2E && grep -qx "ok=yes" .predeploy/PREDEPLOY_E2E || { echo "deploy-prod: booking walkthrough stamp does not match $SHA" >&2; exit 1; }
if [[ "${NUDGE_DEPLOY_CONFIRM:-}" != "yes" ]]; then
  echo "deploy-prod: checks passed for $SHA. Set NUDGE_DEPLOY_CONFIRM=yes to deploy." >&2
  exit 3
fi
npx wrangler deploy -c "$CONFIG"
