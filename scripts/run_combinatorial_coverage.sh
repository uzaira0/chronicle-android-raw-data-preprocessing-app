#!/usr/bin/env bash
# Combinatorial coverage pipeline for the browser processing-option contract
# (docs/workflow/dag-validate-ontologize-productize-research.md §S3):
#
#   1. regenerate the PICT + ACTS models and the executed-test projection
#      from the contract SSOT (web/scripts/generate_combinatorial_model.mts);
#   2. generate t=2 / t=3 covering arrays with Microsoft PICT;
#   3. decode them into full option objects (executed by
#      web/src/lib/pipelineGraph/coveringArrayValidation.test.ts);
#   4. generate a replayable high-order sample from those same domains;
#   5. verify exact t=2 / t=3 coverage with the in-repository checker;
#   6. execute the arrays and seeded synthetic corpora through Rust/WASM;
#   7. optionally cross-check the measurement with NIST CCM.
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

echo "── 1/7 regenerate models + executed-test projection"
(cd "$WEB" && ./node_modules/.bin/vite-node scripts/generate_combinatorial_model.mts)

echo "── 2/7 PICT covering arrays"
if [ -n "$PICT_TOOL" ]; then
  "$PICT_TOOL" "$OUT/model.pict" /o:2 > "$OUT/covering_t2.tsv"
  "$PICT_TOOL" "$OUT/model.pict" /o:3 > "$OUT/covering_t3.tsv"
else
  echo "  PICT is not installed; verifying the checked-in arrays without regenerating them"
  [ -s "$OUT/covering_t2.tsv" ] && [ -s "$OUT/covering_t3.tsv" ] \
    || { echo "checked-in covering arrays are missing; install PICT or set PICT_BIN"; exit 1; }
fi
echo "  t=2: $(($(wc -l < "$OUT/covering_t2.tsv") - 1)) configs, t=3: $(($(wc -l < "$OUT/covering_t3.tsv") - 1)) configs"

echo "── 3/7 decode arrays for the vitest execution suite"
(cd "$WEB" \
  && ./node_modules/.bin/vite-node scripts/generate_combinatorial_model.mts decode combinatorial/covering_t2.tsv combinatorial/covering_array_t2.json \
  && ./node_modules/.bin/vite-node scripts/generate_combinatorial_model.mts decode combinatorial/covering_t3.tsv combinatorial/covering_array_t3.json)

echo "── 4/7 deterministic high-order sample"
(cd "$WEB" \
  && ./node_modules/.bin/vite-node scripts/generate_combinatorial_model.mts sample \
    12648430 128 combinatorial/seeded_high_order_00c0ffee.json)

echo "── 5/7 exact valid-tuple coverage (portable built-in verifier)"
{ cat "$OUT/existing_tests.csv"
  tail -n +2 "$OUT/covering_t2.tsv" | tr '\t' ','
  tail -n +2 "$OUT/covering_t3.tsv" | tr '\t' ','
} > "$OUT/with_covering_arrays.csv"
echo "  existing tests only:"
(cd "$WEB" && ./node_modules/.bin/vite-node scripts/generate_combinatorial_model.mts coverage 2,3 "$OUT/existing_tests.csv")
echo "  existing + covering arrays:"
(cd "$WEB" && ./node_modules/.bin/vite-node scripts/generate_combinatorial_model.mts verify-coverage 2,3 "$OUT/with_covering_arrays.csv")

run_campaign_batch() {
  local batch_name="$1"
  shift
  local batch_dir="$CAMPAIGN_LOG_ROOT/$batch_name"
  local names=()
  local pids=()
  mkdir -p "$batch_dir"

  while [ "$#" -gt 0 ]; do
    local name="$1"
    local script="$2"
    shift 2
    names+=("$name")
    (
      cd "$WEB"
      npm run "$script"
    ) >"$batch_dir/$name.log" 2>&1 &
    pids+=("$!")
  done

  local failed=0
  local index
  local rc
  for index in "${!pids[@]}"; do
    rc=0
    wait "${pids[$index]}" || rc=$?
    if [ "$rc" -ne 0 ]; then
      failed=1
      echo "── campaign: ${names[$index]} FAILED (exit $rc)"
    else
      echo "── campaign: ${names[$index]}"
    fi
    cat "$batch_dir/${names[$index]}.log"
  done
  [ "$failed" -eq 0 ]
}

echo "── 6/7 Rust/WASM synthetic configuration campaign"
CAMPAIGN_LOG_ROOT="$OUT/campaign_logs"
rm -rf "$CAMPAIGN_LOG_ROOT"
mkdir -p "$CAMPAIGN_LOG_ROOT"
trap 'rm -rf "$CAMPAIGN_LOG_ROOT"' EXIT INT TERM

# Each verifier is process-isolated and read-only in checked mode. The batches
# keep total process pressure bounded while overlapping the three longest
# independent campaigns, then the three shorter campaigns.
run_campaign_batch long \
  configuration-space test:configuration-space \
  interaction-influence test:interaction-influence \
  mixed-influence test:mixed-influence
run_campaign_batch short \
  artifact-influence test:artifact-influence \
  raw-boundary-influence test:raw-boundary-influence \
  semantic-mutations test:semantic-mutations \
  field-provenance test:field-provenance
# Runs on its own: it already recycles one process per source column and
# bounds its own concurrency with FIELD_MIXED_MAX_PARALLEL.
run_campaign_batch per-field \
  field-mixed-tomography test:field-mixed-tomography
rm -rf "$CAMPAIGN_LOG_ROOT"
trap - EXIT INT TERM

# Covering-array reports, goldens, and synthetic proof fixtures are evidence,
# not executable build inputs. Running the campaign must leave the checked
# implementation identity and capability bindings at the same fixed point.
python3 "$REPO_ROOT/scripts/generate_semantic_behavior_inventory.py" --check

echo "── 7/7 optional NIST CCM differential measurement"
if [ -n "$CCM_TOOL" ]; then
  TWAY="${TWAY:-2}"
  echo "  existing tests only:"
  "$CCM_TOOL" -I "$OUT/existing_tests.csv" -A "$OUT/model.acts.txt" -P -T "$TWAY" -p 2>&1 | grep "Total .*coverage" | sed 's/^/    /'
  echo "  existing + covering arrays:"
  "$CCM_TOOL" -I "$OUT/with_covering_arrays.csv" -A "$OUT/model.acts.txt" -P -T "$TWAY" -p 2>&1 | grep "Total .*coverage" | sed 's/^/    /'
else
  echo "  CCM is not installed; portable exact verification above is authoritative"
fi
