#!/usr/bin/env bash
# JS bundle size gate via size-limit (ceiling: 2MB for all JS).
# Only runs if the dist/ directory exists (i.e., after a build).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$REPO_ROOT/web"

if [ ! -d "$WEB_DIR/dist" ]; then
  echo "web/dist not found — building first..."
  (cd "$WEB_DIR" && npm run build 2>&1)
fi

(cd "$WEB_DIR" && npx size-limit 2>&1)
