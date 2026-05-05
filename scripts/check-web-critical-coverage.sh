#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/web"

npm test -- \
  --coverage \
  --coverage.reporter=text \
  --coverage.reporter=lcov \
  --coverage.include='src/lib/chronicleMatcher.ts' \
  --coverage.include='src/lib/fileInspection.ts' \
  --coverage.include='src/lib/zip.ts' \
  --coverage.thresholds.lines=99 \
  --coverage.thresholds.statements=99 \
  --coverage.thresholds.functions=99 \
  --coverage.thresholds.branches=95
