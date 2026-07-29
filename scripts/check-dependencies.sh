#!/usr/bin/env bash
# Dependency vulnerability scanning — both surfaces (npm, Rust).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

FAIL=0

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
  for crate_dir in "$REPO_ROOT"/rust/*/; do
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
# Both skip patterns below were inert, so trivy walked ~2 GB of generated
# preprocessing output and died with "semaphore acquire: context deadline
# exceeded" -- failing this audit for a reason unrelated to security.
#   1. The directories on disk are "OutputSizeCheck ..." and "OutputSizeCheckBoth
#      ..."; the old "OutputSizeCurrentCodebook*" matched neither. "OutputSize*"
#      covers all three, so a new OutputSize<X> run cannot re-break the gate.
#   2. Trivy globs do not let * cross a "/", so "*.csv" only ever matched CSVs at
#      the scan root -- never the 121 MB files one directory down, which are
#      exactly what the walk timed out on. "**/*.csv" matches those.
if command -v trivy &>/dev/null; then
  trivy fs \
    --exit-code 1 \
    --severity HIGH,CRITICAL \
    --ignore-unfixed \
    --scanners vuln,secret \
    --skip-dirs "web/node_modules,web/dist,target,OutputSize*" \
    --skip-files "**/*.csv" \
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
