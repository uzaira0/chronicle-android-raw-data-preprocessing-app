#!/usr/bin/env bash
# Detector-truth checks for the generate-or-check drift gates (research doc
# V4): each gate must FIRE on a seeded defect, or the gate itself is broken.
# (The ast-grep rules get the same treatment via `sg test` meta-tests; the
# engine/MR suites prove themselves by construction.)
#
# Method: perturb the checked artifact, assert --check exits non-zero, restore.
# Restoration runs on EXIT so an interrupt cannot leave the tree dirty.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB="$REPO_ROOT/web"
VITE_NODE="$WEB/node_modules/.bin/vite-node"
BACKUP_DIR="$(mktemp -d)"

restore() {
  cp "$BACKUP_DIR/chronicle-pipeline-graph.yaml" "$WEB/schema/chronicle-pipeline-graph.yaml"
  cp "$BACKUP_DIR/chronicle-output-columns.yaml" "$WEB/schema/chronicle-output-columns.yaml"
  cp "$BACKUP_DIR/generatedContract.ts" "$WEB/src/lib/generatedContract.ts"
  rm -rf "$BACKUP_DIR"
}
trap restore EXIT

cp "$WEB/schema/chronicle-pipeline-graph.yaml" "$BACKUP_DIR/"
cp "$WEB/schema/chronicle-output-columns.yaml" "$BACKUP_DIR/"
cp "$WEB/src/lib/generatedContract.ts" "$BACKUP_DIR/"

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

echo "── gate-truth: seeded defects must trip every drift gate"

# 1. Pipeline-graph projection drift.
sed -i 's/node_label: Event parsing/node_label: SEEDED DEFECT/' \
  "$WEB/schema/chronicle-pipeline-graph.yaml"
expect_gate_fires "pipeline-graph drift gate" \
  "$VITE_NODE" scripts/generate_pipeline_graph_artifacts.mts --check
cp "$BACKUP_DIR/chronicle-pipeline-graph.yaml" "$WEB/schema/chronicle-pipeline-graph.yaml"

# 2. Output-column catalog bijection (both directions).
printf '  - column_name: seeded_defect_column\n    column_outputs: [app]\n    value_type: string\n    column_description: seeded.\n' \
  >> "$WEB/schema/chronicle-output-columns.yaml"
expect_gate_fires "output-codebook bijection gate (phantom column)" \
  "$VITE_NODE" scripts/generate_output_codebook_artifacts.mts --check
cp "$BACKUP_DIR/chronicle-output-columns.yaml" "$WEB/schema/chronicle-output-columns.yaml"

sed -i 's/^  - column_name: usage_layer$/  - column_name: usage_layer_seeded/' \
  "$WEB/schema/chronicle-output-columns.yaml"
expect_gate_fires "output-codebook bijection gate (missing column)" \
  "$VITE_NODE" scripts/generate_output_codebook_artifacts.mts --check
cp "$BACKUP_DIR/chronicle-output-columns.yaml" "$WEB/schema/chronicle-output-columns.yaml"

# 3. Contract artifact drift.
sed -i 's/export const DEFAULT_BROWSER_OPTIONS/export const SEEDED_DEFECT_OPTIONS/' \
  "$WEB/src/lib/generatedContract.ts"
expect_gate_fires "contract artifact drift gate" \
  "$VITE_NODE" scripts/generate_contract_artifacts.mts --check
cp "$BACKUP_DIR/generatedContract.ts" "$WEB/src/lib/generatedContract.ts"

if [ "$fails" -gt 0 ]; then
  echo "gate-truth: $fails gate(s) failed to fire"
  exit 1
fi
echo "gate-truth: all drift gates fire on seeded defects"
