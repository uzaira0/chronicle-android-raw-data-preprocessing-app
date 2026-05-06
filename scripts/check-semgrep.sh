#!/usr/bin/env bash
# Run repo-specific Semgrep rules on Python source.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v semgrep &>/dev/null; then
  echo "semgrep not found — install with: pip install semgrep" >&2
  exit 1
fi

semgrep \
  --config "$REPO_ROOT/.semgrep/chronicle-security.yml" \
  --config "$REPO_ROOT/.semgrep/chronicle-domain.yml" \
  --error \
  "$REPO_ROOT/src/" \
  "$REPO_ROOT/web/src/" \
  2>&1
