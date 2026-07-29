#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT/web"
if [ ! -f "src/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js" ]; then
  echo "WASM not built — run: npm run build:wasm" >&2; exit 1
fi
npx playwright test --grep "@smoke"
