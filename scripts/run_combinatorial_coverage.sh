#!/usr/bin/env bash
# Combinatorial coverage pipeline for the browser processing-option contract
# (docs/dag-validate-ontologize-productize-research.md §S3):
#
#   1. regenerate the PICT + ACTS models and the executed-test projection
#      from the contract SSOT (web/scripts/generate_combinatorial_model.mts);
#   2. generate t=2 / t=3 covering arrays with Microsoft PICT;
#   3. decode them into full option objects (executed by
#      web/src/lib/pipelineGraph/coveringArrayValidation.test.ts);
#   4. measure before/after coverage with NIST CCM.
#
# Tool locations (override via env):
#   PICT_BIN — Microsoft PICT binary; build: git clone
#              https://github.com/microsoft/pict && cmake -S pict -B pict/build
#              -DCMAKE_BUILD_TYPE=Release && cmake --build pict/build
#   CCM_CMD  — NIST CCMCL wrapper; headless-patched build lives in
#              /home/opt/nist-ccm (see its ccm script + ctt-src patch).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB="$REPO_ROOT/web"
OUT="$WEB/combinatorial"
PICT_BIN="${PICT_BIN:-/home/opt/pict/build/cli/pict}"
CCM_CMD="${CCM_CMD:-/home/opt/nist-ccm/ccm}"

[ -x "$PICT_BIN" ] || { echo "PICT not found at $PICT_BIN (set PICT_BIN; see header)"; exit 1; }
[ -x "$CCM_CMD" ] || { echo "CCM not found at $CCM_CMD (set CCM_CMD; see header)"; exit 1; }

echo "── 1/4 regenerate models + executed-test projection"
(cd "$WEB" && ./node_modules/.bin/vite-node scripts/generate_combinatorial_model.mts)

echo "── 2/4 PICT covering arrays"
"$PICT_BIN" "$OUT/model.pict" /o:2 > "$OUT/covering_t2.tsv"
"$PICT_BIN" "$OUT/model.pict" /o:3 > "$OUT/covering_t3.tsv"
echo "  t=2: $(($(wc -l < "$OUT/covering_t2.tsv") - 1)) configs, t=3: $(($(wc -l < "$OUT/covering_t3.tsv") - 1)) configs"

echo "── 3/4 decode arrays for the vitest execution suite"
(cd "$WEB" \
  && ./node_modules/.bin/vite-node scripts/generate_combinatorial_model.mts decode combinatorial/covering_t2.tsv combinatorial/covering_array_t2.json \
  && ./node_modules/.bin/vite-node scripts/generate_combinatorial_model.mts decode combinatorial/covering_t3.tsv combinatorial/covering_array_t3.json)

echo "── 4/4 NIST CCM coverage (t=2; t≥3 is slow — run with TWAY=2,3 to include)"
TWAY="${TWAY:-2}"
{ cat "$OUT/existing_tests.csv"
  tail -n +2 "$OUT/covering_t2.tsv" | tr '\t' ','
  tail -n +2 "$OUT/covering_t3.tsv" | tr '\t' ','
} > "$OUT/with_covering_arrays.csv"
echo "  existing tests only:"
"$CCM_CMD" -I "$OUT/existing_tests.csv" -A "$OUT/model.acts.txt" -P -T "$TWAY" -p 2>&1 | grep "Total .*coverage" | sed 's/^/    /'
echo "  existing + covering arrays:"
"$CCM_CMD" -I "$OUT/with_covering_arrays.csv" -A "$OUT/model.acts.txt" -P -T "$TWAY" -p 2>&1 | grep "Total .*coverage" | sed 's/^/    /'
