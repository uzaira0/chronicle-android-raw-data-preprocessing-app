#!/usr/bin/env bash
# Web/TypeScript test coverage — enforces vitest thresholds defined in vitest.config.ts.
# Thresholds: lines 75%, functions 80%, branches 60%, statements 75%.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$REPO_ROOT/web"

if [ ! -d "$WEB_DIR/node_modules" ]; then
  echo "web/node_modules not found — run 'npm ci' in web/ first" >&2
  exit 1
fi

(
  cd "$WEB_DIR"
  node scripts/run-clean-env.mjs vitest run --coverage 2>&1
)
