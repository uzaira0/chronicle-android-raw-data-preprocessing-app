#!/usr/bin/env bash
# Combinatorial coverage pipeline for the browser processing-option contract
# (docs/dag-validate-ontologize-productize-research.md §S3):
#
#   1. regenerate the PICT + ACTS models and the executed-test projection
#      from the contract SSOT (web/scripts/generate_combinatorial_model.mts);
#   2. generate t=2 / t=3 covering arrays with Microsoft PICT;
#   3. decode them into full option objects (executed by
#      web/src/lib/pipelineGraph/coveringArrayValidation.test.ts);
#   4. verify exact t=2 / t=3 coverage with the in-repository checker;
#   5. optionally cross-check the measurement with NIST CCM.
#
# Optional tool locations (override via env):
#   PICT_BIN — Microsoft PICT binary; when absent, checked-in arrays are
#              verified instead of regenerated. Build: git clone
#              https://github.com/microsoft/pict && cmake -S pict -B pict/build
#              -DCMAKE_BUILD_TYPE=Release && cmake --build pict/build
#   CCM_CMD  — optional NIST CCMCL wrapper for an independent measurement.
#
# The exact built-in verifier is authoritative. The gate does not depend on an
# undistributable workstation path; external tools are differential checks or
# regeneration aids.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB="$REPO_ROOT/web"
OUT="$WEB/combinatorial"
if [ -n "${PICT_BIN:-}" ]; then
  [ -x "$PICT_BIN" ] || { echo "PICT_BIN is not executable: $PICT_BIN"; exit 1; }
  PICT_TOOL="$PICT_BIN"
else
  PICT_TOOL="$(command -v pict || true)"
fi
if [ -n "${CCM_CMD:-}" ]; then
  [ -x "$CCM_CMD" ] || { echo "CCM_CMD is not executable: $CCM_CMD"; exit 1; }
  CCM_TOOL="$CCM_CMD"
else
  CCM_TOOL="$(command -v ccm || true)"
fi

echo "── 1/5 regenerate models + executed-test projection"
(cd "$WEB" && ./node_modules/.bin/vite-node scripts/generate_combinatorial_model.mts)

echo "── 2/5 PICT covering arrays"
if [ -n "$PICT_TOOL" ]; then
  "$PICT_TOOL" "$OUT/model.pict" /o:2 > "$OUT/covering_t2.tsv"
  "$PICT_TOOL" "$OUT/model.pict" /o:3 > "$OUT/covering_t3.tsv"
else
  echo "  PICT is not installed; verifying the checked-in arrays without regenerating them"
  [ -s "$OUT/covering_t2.tsv" ] && [ -s "$OUT/covering_t3.tsv" ] \
    || { echo "checked-in covering arrays are missing; install PICT or set PICT_BIN"; exit 1; }
fi
echo "  t=2: $(($(wc -l < "$OUT/covering_t2.tsv") - 1)) configs, t=3: $(($(wc -l < "$OUT/covering_t3.tsv") - 1)) configs"

echo "── 3/5 decode arrays for the vitest execution suite"
(cd "$WEB" \
  && ./node_modules/.bin/vite-node scripts/generate_combinatorial_model.mts decode combinatorial/covering_t2.tsv combinatorial/covering_array_t2.json \
  && ./node_modules/.bin/vite-node scripts/generate_combinatorial_model.mts decode combinatorial/covering_t3.tsv combinatorial/covering_array_t3.json)

echo "── 4/5 exact valid-tuple coverage (portable built-in verifier)"
{ cat "$OUT/existing_tests.csv"
  tail -n +2 "$OUT/covering_t2.tsv" | tr '\t' ','
  tail -n +2 "$OUT/covering_t3.tsv" | tr '\t' ','
} > "$OUT/with_covering_arrays.csv"
echo "  existing tests only:"
(cd "$WEB" && ./node_modules/.bin/vite-node scripts/generate_combinatorial_model.mts coverage 2,3 "$OUT/existing_tests.csv")
echo "  existing + covering arrays:"
(cd "$WEB" && ./node_modules/.bin/vite-node scripts/generate_combinatorial_model.mts verify-coverage 2,3 "$OUT/with_covering_arrays.csv")

echo "── 5/5 optional NIST CCM differential measurement"
if [ -n "$CCM_TOOL" ]; then
  TWAY="${TWAY:-2}"
  echo "  existing tests only:"
  "$CCM_TOOL" -I "$OUT/existing_tests.csv" -A "$OUT/model.acts.txt" -P -T "$TWAY" -p 2>&1 | grep "Total .*coverage" | sed 's/^/    /'
  echo "  existing + covering arrays:"
  "$CCM_TOOL" -I "$OUT/with_covering_arrays.csv" -A "$OUT/model.acts.txt" -P -T "$TWAY" -p 2>&1 | grep "Total .*coverage" | sed 's/^/    /'
else
  echo "  CCM is not installed; portable exact verification above is authoritative"
fi
