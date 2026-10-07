#!/usr/bin/env bash
# Web/TypeScript test coverage — enforces vitest thresholds defined in vitest.config.ts.
# Thresholds live in web/vitest.config.ts (lines/statements/functions 99%, branches 95%).
#
# This runs `npm run test:coverage`, NOT a hand-rolled `vitest run --coverage`.
# That distinction is the whole point of this comment.
#
# `test:unit` and `test:coverage` in web/package.json both exclude four campaign
# files — configurationSpaceCampaign, artifactInterventionCampaign,
# rawBoundaryTomography, interactionTomography — which drive real Rust/WASM across
# large configuration spaces and are run by their own targets, not by the unit
# suite. Until 2026-08-08 this script invoked vitest directly and therefore
# silently dropped all four exclusions: `npm run test` reported 49 files while
# this pre-push gate ran all 53. The four extra files do not finish in a
# reasonable time under v8 instrumentation, so every push that touched
# `web/src/` sat here indefinitely and presented as a hang rather than an error.
# The measured coverage thresholds above were taken from the 49-file set, so
# running 53 here was also comparing against the wrong denominator.
#
# Keep the exclusion list in web/package.json. One home, not two.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$REPO_ROOT/web"

# Wall-clock backstop. Even with the right file set, a genuinely stuck worker must
# fail with a message instead of blocking a push forever.
#
# Measured 2026-08-08 on a 32-core M3 Ultra: the correct 49-file set completes in
# 5 seconds (534 tests, 99.08/95.42/99.52/99.64). 300s is a ~60x headroom backstop,
# not a performance target — it exists to convert a hang into a named error, and
# any run approaching it means something is structurally wrong rather than slow.
# Override for a loaded or slower machine:
#   WEB_COVERAGE_TIMEOUT_SECONDS=1800 scripts/check-web-critical-coverage.sh
TIMEOUT_SECONDS="${WEB_COVERAGE_TIMEOUT_SECONDS:-300}"

if [ ! -d "$WEB_DIR/node_modules" ]; then
  echo "web/node_modules not found — run 'npm ci' in web/ first" >&2
  exit 1
fi

# The thresholds are measured with the machine-local private literature corpus
# present. Without it the corpus-backed tests skip (web/src/testSupport/
# privateCorpus.ts) and most of src/lib/methodProfiles.ts goes unexercised:
# coverage falls to about 56% and the run would end in a bare threshold miss.
# Name the cause instead.
CORPUS_DIR="$REPO_ROOT/.tmp-literature-review-private"
if [ ! -d "$CORPUS_DIR" ]; then
  echo "web coverage gate: the private literature corpus is absent ($CORPUS_DIR)." >&2
  echo "The coverage thresholds assume it is present; without it the corpus-backed" >&2
  echo "tests skip and coverage falls below them. Run this gate where the corpus" >&2
  echo "exists, or link it into the repository root." >&2
  exit 1
fi

# GNU coreutils `timeout` is `gtimeout` under Homebrew on macOS. If neither is
# present, run unbounded rather than skipping the gate, but say so — a silent
# unbounded run is exactly the failure this backstop exists to prevent.
TIMEOUT_BIN=""
if command -v timeout >/dev/null 2>&1; then
  TIMEOUT_BIN="timeout"
elif command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT_BIN="gtimeout"
else
  echo "warning: neither 'timeout' nor 'gtimeout' found; running without a wall-clock bound" >&2
fi

cd "$WEB_DIR"

set +e
if [ -n "$TIMEOUT_BIN" ]; then
  "$TIMEOUT_BIN" "$TIMEOUT_SECONDS" npm run --silent test:coverage 2>&1
  STATUS=$?
else
  npm run --silent test:coverage 2>&1
  STATUS=$?
fi
set -e

if [ "$STATUS" -eq 124 ]; then
  echo "" >&2
  echo "web coverage gate: TIMED OUT after ${TIMEOUT_SECONDS}s." >&2
  echo "" >&2
  echo "This is a timeout, not a threshold failure. The suite did not finish." >&2
  echo "Check, in this order:" >&2
  echo "  1. Did a campaign file get added back to the unit run? The four" >&2
  echo "     --exclude entries in web/package.json's test:coverage script are" >&2
  echo "     load-bearing; dropping them is what made this gate hang before." >&2
  echo "  2. Is a single test stuck? Re-run without the bound:" >&2
  echo "     cd web && npm run test:coverage" >&2
  echo "  3. Slow machine? Raise the budget:" >&2
  echo "     WEB_COVERAGE_TIMEOUT_SECONDS=1800 scripts/check-web-critical-coverage.sh" >&2
  exit 124
fi

exit "$STATUS"
