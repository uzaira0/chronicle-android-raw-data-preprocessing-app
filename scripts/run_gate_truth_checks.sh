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
# Repo-scoped backups: /tmp is wiped on reboot, and a reboot mid-run would
# otherwise destroy the only copies of the seeded files and leave the tree
# dirty with defects. A leftover dir here is visible in `git status`, which is
# the recovery signal.
BACKUP_DIR="$(mktemp -d "$REPO_ROOT/.gate-truth-backup.XXXXXX")"

# A missing runner must be a hard error, not a fired gate: `expect_gate_fires`
# once scored `spawn vite-node ENOENT` as ✓ and printed an all-green report
# from a checkout with no web/node_modules.
if [[ ! -x "$VITE_NODE" ]]; then
  echo "gate-truth: $VITE_NODE is missing or not executable (run npm ci in web/); refusing to report vacuous results" >&2
  rm -rf "$BACKUP_DIR"
  exit 2
fi
if ! command -v cargo >/dev/null 2>&1; then
  echo "gate-truth: cargo is not on PATH; refusing to report vacuous results" >&2
  rm -rf "$BACKUP_DIR"
  exit 2
fi

# Backups FIRST — the restore trap must never run before its sources exist.
cp "$WEB/schema/chronicle-workflow.yaml" "$BACKUP_DIR/"
cp "$WEB/schema/chronicle-output-columns.yaml" "$BACKUP_DIR/"
cp "$WEB/src/lib/generatedContract.ts" "$BACKUP_DIR/"
cp "$WEB/schema/contract-baseline.json" "$BACKUP_DIR/"
cp "$REPO_ROOT/rust/chronicle_chrono_kernel_wasm/src/workflow_contract.rs" "$BACKUP_DIR/"
cp "$WEB/src/lib/generatedRuntimeBoundary.ts" "$BACKUP_DIR/"
cp "$REPO_ROOT/rust/chronicle_preprocessing_runtime_wasm/src/lib.rs" "$BACKUP_DIR/runtime_lib.rs"

restore() {
  cp "$BACKUP_DIR/chronicle-workflow.yaml" "$WEB/schema/chronicle-workflow.yaml"
  cp "$BACKUP_DIR/chronicle-output-columns.yaml" "$WEB/schema/chronicle-output-columns.yaml"
  cp "$BACKUP_DIR/generatedContract.ts" "$WEB/src/lib/generatedContract.ts"
  cp "$BACKUP_DIR/contract-baseline.json" "$WEB/schema/contract-baseline.json"
  cp "$BACKUP_DIR/workflow_contract.rs" "$REPO_ROOT/rust/chronicle_chrono_kernel_wasm/src/workflow_contract.rs"
  cp "$BACKUP_DIR/generatedRuntimeBoundary.ts" "$WEB/src/lib/generatedRuntimeBoundary.ts"
  cp "$BACKUP_DIR/runtime_lib.rs" "$REPO_ROOT/rust/chronicle_preprocessing_runtime_wasm/src/lib.rs"
  rm -rf "$BACKUP_DIR"
}
trap restore EXIT

fails=0

# A drift gate is truthful only if it PASSES on the clean tree AND FIRES on the
# seeded defect. Checking only the second half scores an always-red gate
# (broken harness, stale runner, compile error) as ✓. Each check command is
# therefore run once on the clean tree before its seed; a clean-tree failure is
# the gate being broken, not the gate firing.
expect_clean_pass() {
  local name="$1"; shift
  local rc=0
  (cd "$WEB" && "$@" >/dev/null 2>&1) || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "✗ $name: check failed on the CLEAN tree (exit $rc) — the gate is broken, a seeded run would be vacuous"
    fails=$((fails + 1))
  else
    echo "✓ $name passes"
  fi
}

expect_gate_fires() {
  local name="$1"; shift
  local rc=0
  (cd "$WEB" && "$@" >/dev/null 2>&1) || rc=$?
  if [ "$rc" -eq 126 ] || [ "$rc" -eq 127 ]; then
    echo "✗ $name: runner missing or not executable (exit $rc) — this is NOT a fired gate"
    fails=$((fails + 1))
  elif [ "$rc" -eq 0 ]; then
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
  if sed --version >/dev/null 2>&1; then
    sed -i "$expr" "$file"
  else
    sed -i '' "$expr" "$file"
  fi
  if ! grep -qF "$must_contain" "$file"; then
    echo "✗ seed no-op: '$expr' did not land in $file — the seed target is stale, fix this script"
    exit 1
  fi
}

echo "── gate-truth: every gate must pass on the clean tree first"
expect_clean_pass "pipeline-graph drift gate (clean)" \
  "$VITE_NODE" scripts/generate_workflow_artifacts.mts --check
expect_clean_pass "output-codebook bijection gate (clean)" \
  "$VITE_NODE" scripts/generate_output_codebook_artifacts.mts --check
expect_clean_pass "contract artifact drift gate (clean)" \
  "$VITE_NODE" scripts/generate_contract_artifacts.mts --check
expect_clean_pass "Rust query-dataflow gate (clean)" \
  cargo test --quiet --locked \
    --manifest-path "$REPO_ROOT/rust/chronicle_chrono_kernel_wasm/Cargo.toml" \
    --features incremental-v2 \
    workflow_contract::tests::declared_query_edges_equal_direct_salsa_query_calls
expect_clean_pass "contract-compat gate (clean)" \
  "$VITE_NODE" scripts/check_contract_compat.mts
expect_clean_pass "TypeScript authority boundary (clean)" \
  "$VITE_NODE" scripts/check_no_typescript_authority.mts
expect_clean_pass "runtime boundary drift gate (clean)" \
  "$VITE_NODE" scripts/generate_runtime_boundary_artifacts.mts --check

echo "── gate-truth: seeded defects must trip every drift gate"

# 1. Pipeline-graph projection drift.
seed "$WEB/schema/chronicle-workflow.yaml" \
  's/node_label: Event parsing/node_label: SEEDED DEFECT/' 'SEEDED DEFECT'
expect_gate_fires "pipeline-graph drift gate" \
  "$VITE_NODE" scripts/generate_workflow_artifacts.mts --check
cp "$BACKUP_DIR/chronicle-workflow.yaml" "$WEB/schema/chronicle-workflow.yaml"

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

# 4. Rust graph/dataflow gate: declare a dependency that the tracked Salsa
#    query does not actually read. The source-level query-call audit must fire.
seed "$REPO_ROOT/rust/chronicle_chrono_kernel_wasm/src/workflow_contract.rs" \
  '/id: "decode_source_records"/,/inputs: &\[\],/s/inputs: &\[\],/inputs: \&["validate_remap_rules"],/' \
  'inputs: &["validate_remap_rules"]'
expect_gate_fires "Rust query-dataflow gate (declared edge not read)" \
  cargo test --quiet --locked \
    --manifest-path "$REPO_ROOT/rust/chronicle_chrono_kernel_wasm/Cargo.toml" \
    --features incremental-v2 \
    workflow_contract::tests::declared_query_edges_equal_direct_salsa_query_calls
cp "$BACKUP_DIR/workflow_contract.rs" "$REPO_ROOT/rust/chronicle_chrono_kernel_wasm/src/workflow_contract.rs"

# 5. Workflow-query projection drift.
seed "$WEB/schema/chronicle-workflow.yaml" \
  '/- id: remove_missing_timestamps/,/definitionDigest:/s/- decode_source_records/- SEEDED_DEFECT/' 'SEEDED_DEFECT'
expect_gate_fires "workflow drift gate (query projection)" \
  "$VITE_NODE" scripts/generate_workflow_artifacts.mts --check
cp "$BACKUP_DIR/chronicle-workflow.yaml" "$WEB/schema/chronicle-workflow.yaml"

# 6. Contract-compat breaking gate: a baseline option the live contract lacks
#    reads as a REMOVED researcher-facing option — must fail without a bump.
seed "$WEB/schema/contract-baseline.json" \
  's/"options": {/"options": {\n    "seededPhantomOption": { "type": "boolean", "default": false },/' \
  'seededPhantomOption'
expect_gate_fires "contract-compat gate (removed option without version bump)" \
  "$VITE_NODE" scripts/check_contract_compat.mts
cp "$BACKUP_DIR/contract-baseline.json" "$WEB/schema/contract-baseline.json"

# 7. Authority boundary: even an otherwise harmless production declaration
#    using a retired engine symbol must fail the no-TypeScript-engine gate.
printf '\nexport const runRustV2Shadow = false;\n' >> "$WEB/src/lib/generatedContract.ts"
grep -qF 'runRustV2Shadow' "$WEB/src/lib/generatedContract.ts" || {
  echo "✗ seed no-op: authority-boundary symbol append failed"; exit 1;
}
expect_gate_fires "TypeScript authority boundary" \
  "$VITE_NODE" scripts/check_no_typescript_authority.mts
cp "$BACKUP_DIR/generatedContract.ts" "$WEB/src/lib/generatedContract.ts"

# 8. WASM-boundary validator drift: the generated browser validator must match
#    the Rust serialization model byte for byte.
seed "$WEB/src/lib/generatedRuntimeBoundary.ts" \
  's/export const RUNTIME_BOUNDARY_MODEL/export const SEEDED_DEFECT_MODEL/' 'SEEDED_DEFECT_MODEL'
expect_gate_fires "runtime boundary artifact drift gate" \
  "$VITE_NODE" scripts/generate_runtime_boundary_artifacts.mts --check
cp "$BACKUP_DIR/generatedRuntimeBoundary.ts" "$WEB/src/lib/generatedRuntimeBoundary.ts"

# 9. The same gate must be bound to the RUST model, not merely to itself.
#    Retyping a manifest digest field as a bare String still compiles (the
#    boundary digest types are transparent aliases) and still serializes the
#    same bytes, but it downgrades what the browser is allowed to accept from
#    "sha256 digest" to "any non-empty string" — so the gate must fire.
seed "$REPO_ROOT/rust/chronicle_preprocessing_runtime_wasm/src/lib.rs" \
  's/pub journal_digest: Sha256Digest,/pub journal_digest: String,/' \
  'pub journal_digest: String,'
expect_gate_fires "runtime boundary Rust-model binding" \
  "$VITE_NODE" scripts/generate_runtime_boundary_artifacts.mts --check
cp "$BACKUP_DIR/runtime_lib.rs" "$REPO_ROOT/rust/chronicle_preprocessing_runtime_wasm/src/lib.rs"

if [ "$fails" -gt 0 ]; then
  echo "gate-truth: $fails gate(s) failed to fire"
  exit 1
fi
echo "gate-truth: all drift gates fire on seeded defects"
