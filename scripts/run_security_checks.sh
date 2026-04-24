#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

run_if_installed() {
  local name="$1"
  shift
  if command -v "$name" >/dev/null 2>&1; then
    echo
    echo "==> $*"
    "$@"
  else
    echo
    echo "==> Skipping $name: not installed"
  fi
}

run_if_installed semgrep semgrep --config=auto --error .
run_if_installed trivy trivy fs --config trivy.yaml .
run_if_installed gitleaks gitleaks detect --source . --max-target-megabytes 5 --redact --verbose
