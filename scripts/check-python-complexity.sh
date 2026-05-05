#!/usr/bin/env bash
# check-python-complexity.sh
# Cyclomatic complexity gate for the Python source.
#
# Threshold: complexity > 50 (current max in codebase is 49, in
# ChronicleAndroidRawDataPreprocessingGUI._load_config_to_options).
# Set to current-max + 1 so existing code is not blocked but regressions
# that push beyond the ceiling are caught.
#
# To add to .pre-commit-config.yaml see scripts/pre-commit-additions-licenses-complexity.txt
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON="${PYTHON:-$REPO_ROOT/.venv/bin/python}"
if [ ! -x "$PYTHON" ]; then PYTHON="python3"; fi

SRC="$REPO_ROOT/src/chronicle_preprocessing_app"

echo "=== Cyclomatic complexity check (threshold: > 50) ==="

# Capture all blocks rated C or higher (complexity >= 8) with numeric scores
output=$("$PYTHON" -m radon cc "$SRC" --min C -s 2>&1)

# Parse scores numerically; fail if any exceed threshold
violations=$(echo "$output" | grep -oE '\([0-9]+\)' | tr -d '()' | awk '$1 > 50 {print}')

if [ -n "$violations" ]; then
    echo "$output"
    echo ""
    echo "ERROR: The following cyclomatic complexity scores exceed the ceiling of 50:" >&2
    echo "$violations" >&2
    echo "Refactor the offending functions to bring complexity below 51." >&2
    exit 1
fi

if [ -n "$output" ]; then
    echo "$output"
    echo ""
fi
echo "Complexity check passed (max allowed: 50)."

echo ""
echo "=== Maintainability Index (informational) ==="
"$PYTHON" -m radon mi "$SRC" -s 2>&1
