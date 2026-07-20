#!/usr/bin/env bash
# Detector-truth checks for the generate-or-check drift gates (research doc
# V4): each gate must FIRE on a seeded defect, or the gate itself is broken.
# (The ast-grep rules get the same treatment via `sg test` meta-tests; the
# engine/MR suites prove themselves by construction.)
#
# Method: perturb the checked artifact, VERIFY the perturbation applied,
# assert --check exits non-zero, restore. Restoration runs on EXIT so an
# interrupt cannot leave the tree dirty. Two ordering rules learned the hard
# way: (1) backups are created BEFORE the trap is registered, so an interrupt
# in the setup window never runs restore against missing backup files;
# (2) every sed seed is verified to have actually changed the file — GNU sed
# exits 0 on a no-match, so a renamed target would otherwise silently turn a
# seed into a no-op and misreport the GATE as broken.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB="$REPO_ROOT/web"
VITE_NODE="$WEB/node_modules/.bin/vite-node"
BACKUP_DIR="$(mktemp -d)"

# Backups FIRST — the restore trap must never run before its sources exist.
cp "$WEB/schema/chronicle-pipeline-graph.yaml" "$BACKUP_DIR/"
cp "$WEB/schema/chronicle-output-columns.yaml" "$BACKUP_DIR/"
cp "$WEB/src/lib/generatedContract.ts" "$BACKUP_DIR/"
cp "$WEB/src/lib/pipelineGraph/steps/parseEvents.ts" "$BACKUP_DIR/"
cp "$WEB/schema/contract-baseline.json" "$BACKUP_DIR/"

restore() {
  cp "$BACKUP_DIR/chronicle-pipeline-graph.yaml" "$WEB/schema/chronicle-pipeline-graph.yaml"
  cp "$BACKUP_DIR/chronicle-output-columns.yaml" "$WEB/schema/chronicle-output-columns.yaml"
  cp "$BACKUP_DIR/generatedContract.ts" "$WEB/src/lib/generatedContract.ts"
  cp "$BACKUP_DIR/parseEvents.ts" "$WEB/src/lib/pipelineGraph/steps/parseEvents.ts"
  cp "$BACKUP_DIR/contract-baseline.json" "$WEB/schema/contract-baseline.json"
  rm -rf "$BACKUP_DIR"
}
trap restore EXIT

fails=0

expect_gate_fires() {
  local name="$1"; shift
  if (cd "$WEB" && "$@" >/dev/null 2>&1); then
    echo "✗ $name: gate DID NOT FIRE on the seeded defect"
    fails=$((fails + 1))
  else
    echo "✓ $name fires"
  fi
}

# Seed a defect via sed and PROVE it landed: `sed -i` exits 0 on a no-match,
# so an un-verified seed can silently become a no-op after a refactor.
seed() {
  local file="$1" expr="$2" must_contain="$3"
  sed -i "$expr" "$file"
  if ! grep -qF "$must_contain" "$file"; then
    echo "✗ seed no-op: '$expr' did not land in $file — the seed target is stale, fix this script"
    exit 1
  fi
}

echo "── gate-truth: seeded defects must trip every drift gate"

# 1. Pipeline-graph projection drift.
seed "$WEB/schema/chronicle-pipeline-graph.yaml" \
  's/node_label: Event parsing/node_label: SEEDED DEFECT/' 'SEEDED DEFECT'
expect_gate_fires "pipeline-graph drift gate" \
  "$VITE_NODE" scripts/generate_pipeline_graph_artifacts.mts --check
cp "$BACKUP_DIR/chronicle-pipeline-graph.yaml" "$WEB/schema/chronicle-pipeline-graph.yaml"

# 2. Output-column catalog bijection (both directions).
printf '  - column_name: seeded_defect_column\n    column_outputs: [app]\n    value_type: string\n    column_description: seeded.\n' \
  >> "$WEB/schema/chronicle-output-columns.yaml"
grep -qF 'seeded_defect_column' "$WEB/schema/chronicle-output-columns.yaml" || {
  echo "✗ seed no-op: phantom column append failed"; exit 1;
}
expect_gate_fires "output-codebook bijection gate (phantom column)" \
  "$VITE_NODE" scripts/generate_output_codebook_artifacts.mts --check
cp "$BACKUP_DIR/chronicle-output-columns.yaml" "$WEB/schema/chronicle-output-columns.yaml"

seed "$WEB/schema/chronicle-output-columns.yaml" \
  's/^  - column_name: usage_layer$/  - column_name: usage_layer_seeded/' 'usage_layer_seeded'
expect_gate_fires "output-codebook bijection gate (missing column)" \
  "$VITE_NODE" scripts/generate_output_codebook_artifacts.mts --check
cp "$BACKUP_DIR/chronicle-output-columns.yaml" "$WEB/schema/chronicle-output-columns.yaml"

# 3. Contract artifact drift.
seed "$WEB/src/lib/generatedContract.ts" \
  's/export const DEFAULT_BROWSER_OPTIONS/export const SEEDED_DEFECT_OPTIONS/' 'SEEDED_DEFECT_OPTIONS'
expect_gate_fires "contract artifact drift gate" \
  "$VITE_NODE" scripts/generate_contract_artifacts.mts --check
cp "$BACKUP_DIR/generatedContract.ts" "$WEB/src/lib/generatedContract.ts"

# 4. Step-dataflow AST gate: a run body destructuring an input the step never
#    declared is exactly the drift channel the checker exists to close.
seed "$WEB/src/lib/pipelineGraph/steps/parseEvents.ts" \
  's/run: ({ rows }) => sortByEventThenIndex(rows),/run: ({ rows, seededExtra }) => sortByEventThenIndex(rows),/' \
  'seededExtra'
expect_gate_fires "step-dataflow gate (undeclared input destructured)" \
  "$VITE_NODE" scripts/check_step_dataflow.mts
cp "$BACKUP_DIR/parseEvents.ts" "$WEB/src/lib/pipelineGraph/steps/parseEvents.ts"

# 5. Step-scale pipeline-graph projection drift (the node-scale label is case 1;
#    this seeds the STEP projection, which is a separate emission path).
seed "$WEB/schema/chronicle-pipeline-graph.yaml" \
  's/step_label: CSV parse/step_label: SEEDED DEFECT/' 'SEEDED DEFECT'
expect_gate_fires "pipeline-graph drift gate (step projection)" \
  "$VITE_NODE" scripts/generate_pipeline_graph_artifacts.mts --check
cp "$BACKUP_DIR/chronicle-pipeline-graph.yaml" "$WEB/schema/chronicle-pipeline-graph.yaml"

# 6. Contract-compat breaking gate: a baseline option the live contract lacks
#    reads as a REMOVED researcher-facing option — must fail without a bump.
seed "$WEB/schema/contract-baseline.json" \
  's/"options": {/"options": {\n    "seededPhantomOption": { "type": "boolean", "default": false },/' \
  'seededPhantomOption'
expect_gate_fires "contract-compat gate (removed option without version bump)" \
  "$VITE_NODE" scripts/check_contract_compat.mts
cp "$BACKUP_DIR/contract-baseline.json" "$WEB/schema/contract-baseline.json"

if [ "$fails" -gt 0 ]; then
  echo "gate-truth: $fails gate(s) failed to fire"
  exit 1
fi
echo "gate-truth: all drift gates fire on seeded defects"
