#!/usr/bin/env bash
# Dependency vulnerability scanning — all three surfaces (Python, npm, Rust).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="${PYTHON:-$REPO_ROOT/.venv/bin/python}"
if [ ! -x "$PYTHON" ]; then
  PYTHON="python3"
fi

FAIL=0

# ---------------------------------------------------------------------------
# Python — pip-audit
# ---------------------------------------------------------------------------
echo "=== Python dependency audit ==="
if "$PYTHON" -m pip_audit --version &>/dev/null; then
  # Audit installed packages, ignore vulnerabilities with no known fix
  "$PYTHON" -m pip_audit \
    --desc \
    2>&1 || FAIL=1
else
  echo "pip-audit not installed — skipping Python audit" >&2
fi
echo

# ---------------------------------------------------------------------------
# npm — npm audit
# ---------------------------------------------------------------------------
echo "=== npm dependency audit ==="
if [ -d "$REPO_ROOT/web/node_modules" ]; then
  (
    cd "$REPO_ROOT/web"
    npm audit --audit-level=high --omit=dev 2>&1 || FAIL=1
  )
else
  echo "web/node_modules not found — run 'npm ci' in web/ first" >&2
  FAIL=1
fi
echo

# ---------------------------------------------------------------------------
# Rust — cargo audit
# ---------------------------------------------------------------------------
echo "=== Rust dependency audit ==="
if command -v cargo-audit &>/dev/null || [ -x "$HOME/.cargo/bin/cargo-audit" ]; then
  if ! command -v cargo-audit &>/dev/null; then
    export PATH="$HOME/.cargo/bin:$PATH"
  fi
  for crate_dir in "$REPO_ROOT/rust/chronicle_app_usage_matcher" "$REPO_ROOT/rust/chronicle_app_usage_wasm"; do
    if [ -f "$crate_dir/Cargo.lock" ]; then
      (cd "$crate_dir" && cargo audit 2>&1) || FAIL=1
    fi
  done
else
  echo "cargo-audit not found — install with: cargo install cargo-audit --locked" >&2
  FAIL=1
fi
echo

# ---------------------------------------------------------------------------
# Trivy — filesystem scan (catches OS-level CVEs, misconfigs, and secrets)
# ---------------------------------------------------------------------------
echo "=== Trivy filesystem scan ==="
if command -v trivy &>/dev/null; then
  trivy fs \
    --exit-code 1 \
    --severity HIGH,CRITICAL \
    --ignore-unfixed \
    --scanners vuln,secret \
    --skip-dirs ".venv,web/node_modules,web/dist,target,OutputSizeCurrentCodebook*,tests/golden" \
    --skip-files "*.csv" \
    "$REPO_ROOT" 2>&1 || FAIL=1
else
  echo "trivy not found — install with: brew install trivy" >&2
fi
echo

if [ "$FAIL" -ne 0 ]; then
  echo "Dependency audit FAILED — review vulnerabilities above." >&2
  exit 1
fi

echo "All dependency audits passed."
