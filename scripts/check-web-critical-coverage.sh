#!/usr/bin/env bash
# Web/TypeScript test coverage — enforces vitest thresholds defined in vitest.config.ts.
# Thresholds live in web/vitest.config.ts (lines/statements/functions 99%, branches 95%).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$REPO_ROOT/web"

if [ ! -d "$WEB_DIR/node_modules" ]; then
  echo "web/node_modules not found — run 'npm ci' in web/ first" >&2
  exit 1
fi

(
  cd "$WEB_DIR"
  node scripts/run-clean-env.mjs ./node_modules/.bin/vitest run --coverage 2>&1
)
