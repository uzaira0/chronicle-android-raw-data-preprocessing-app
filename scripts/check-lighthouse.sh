#!/usr/bin/env bash
# Local Lighthouse CI check — Core Web Vitals and accessibility gates.
# Requires: @lhci/cli (npm install -D @lhci/cli in web/)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$REPO_ROOT/web"

LHCI="$WEB_DIR/node_modules/.bin/lhci"
if [ ! -x "$LHCI" ]; then
  echo "lhci not found — run 'npm ci' in web/ first" >&2
  exit 1
fi

echo "=== Building web app for Lighthouse ==="
(cd "$WEB_DIR" && npm run build -- --outDir dist 2>&1)

echo "=== Running Lighthouse CI ==="
(cd "$WEB_DIR" && "$LHCI" autorun --config=lighthouserc.json 2>&1)
