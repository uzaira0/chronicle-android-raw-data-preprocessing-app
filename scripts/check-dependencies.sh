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
  # `|| FAIL=1` must sit OUTSIDE the subshell. Assigning FAIL inside `( ... )`
  # sets it in the child, the parent keeps FAIL=0, and the subshell's own exit
  # status becomes that of the successful assignment — so a high/critical
  # advisory printed "All dependency audits passed." and exited 0. The cargo
  # audit loop below has always had it in the right place; this half did not.
  (cd "$REPO_ROOT/web" && npm audit --audit-level=high --omit=dev 2>&1) || FAIL=1
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
#   3. ".claude" holds agent worktrees, each with its own target/ and, during a
#      mutation campaign, cargo-mutants scratch copies of the whole crate. One
#      lane left 208 GB there and trivy died with the same semaphore timeout.
#      None of it is repository source, so it is never in scope for this scan.
if command -v trivy &>/dev/null; then
  trivy fs \
    --exit-code 1 \
    --severity HIGH,CRITICAL \
    --ignore-unfixed \
    --scanners vuln,secret \
    --skip-dirs "web/node_modules,web/dist,target,OutputSize*,.claude" \
    --skip-files "**/*.csv" \
    "$REPO_ROOT" 2>&1 || FAIL=1
else
  echo "trivy not found — install with: brew install trivy" >&2
  # A missing scanner is an unrun check, not a passed one. The npm and
  # cargo-audit branches above both fail closed when their tool is absent; this
  # one used to warn and let the script report "All dependency audits passed."
  FAIL=1
fi
echo

if [ "$FAIL" -ne 0 ]; then
  echo "Dependency audit FAILED — review vulnerabilities above." >&2
  exit 1
fi

echo "All dependency audits passed."
