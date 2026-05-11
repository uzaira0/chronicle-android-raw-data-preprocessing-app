#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON="${REPO_ROOT}/.venv/bin/python3"
cd "$REPO_ROOT"
"$PYTHON" -m pytest tests/test_memory_regression.py -q --tb=short
