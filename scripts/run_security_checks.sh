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

run_if_installed semgrep semgrep --config .semgrep/chronicle-security.yml --error .
if command -v ast-grep >/dev/null 2>&1; then
  echo
  echo "==> ast-grep scan"
  ast-grep scan
elif command -v sg >/dev/null 2>&1; then
  echo
  echo "==> sg scan"
  sg scan
else
  echo
  echo "==> Skipping ast-grep: not installed"
fi
run_if_installed trivy trivy fs --config trivy.yaml .
run_if_installed gitleaks gitleaks detect --source . --config .gitleaks.toml --max-target-megabytes 5 --redact --verbose
run_if_installed bandit bandit -c bandit.yaml -r src/chronicle_preprocessing_app -ll
