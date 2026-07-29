#!/usr/bin/env bash
# Verify generated contract artifacts are in sync with the source schema.
# Fails if the generated file is stale — regenerate with: npm run generate:contract
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$REPO_ROOT/web"

if [ ! -d "$WEB_DIR/node_modules" ]; then
  echo "web/node_modules not found — run 'npm ci' in web/ first" >&2
  exit 1
fi

(cd "$WEB_DIR" && npm run check:contract 2>&1)
