#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

require_tool() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "Missing required tool: $name" >&2
    exit 1
  fi
}

run_checked() {
  echo
  echo "==> $*"
  "$@"
}

require_tool semgrep
run_checked semgrep --config .semgrep/chronicle-security.yml --error .
if command -v ast-grep >/dev/null 2>&1; then
  run_checked ast-grep scan
elif command -v sg >/dev/null 2>&1; then
  run_checked sg scan
else
  echo "Missing required tool: ast-grep (or sg)" >&2
  exit 1
fi
require_tool trivy
run_checked trivy fs --config trivy.yaml .
require_tool gitleaks
run_checked gitleaks detect --source . --config .gitleaks.toml --max-target-megabytes 5 --redact --verbose
require_tool bandit
run_checked bandit -c bandit.yaml -r src/chronicle_preprocessing_app -ll
