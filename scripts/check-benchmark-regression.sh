#!/usr/bin/env bash
# Benchmark regression gate — fails if any benchmark regresses beyond 20% vs baseline.
# Baseline: benchmarks/baseline.json (committed).
# Update baseline: pytest tests/benchmarks/ --benchmark-only --benchmark-save=baseline
#                  then cp .benchmarks/*/baseline.json benchmarks/baseline.json
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="${PYTHON:-$REPO_ROOT/.venv/bin/python}"
if [ ! -x "$PYTHON" ]; then
  PYTHON="python3"
fi

BASELINE="$REPO_ROOT/benchmarks/baseline.json"

if [ ! -f "$BASELINE" ]; then
  echo "No baseline found at $BASELINE — skipping regression check." >&2
  echo "Generate one with: pytest tests/benchmarks/ --benchmark-only --benchmark-json=benchmarks/baseline.json"
  exit 0
fi

cd "$REPO_ROOT"

"$PYTHON" -m pytest tests/benchmarks/ \
  --benchmark-only \
  --benchmark-json=benchmarks/current.json \
  --benchmark-compare="$BASELINE" \
  --benchmark-compare-fail=mean:20% \
  -q \
  2>&1
