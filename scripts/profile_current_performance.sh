#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

rows="${PROFILE_ROWS:-60624}"
runs="${PROFILE_RUNS:-5}"
results_dir="${PROFILE_RESULTS_DIR:-$repository_root/docs/perf/results}"
work_dir="${PROFILE_WORK_DIR:-$repository_root/.perf-work}"
target_dir="$work_dir/native-profile-target"
executable="$target_dir/profiling/examples/profile_pipeline_v2"

mkdir -p "$results_dir" "$work_dir"

flamegraph_work_dir="$(mktemp -d "$work_dir/flamegraph.XXXXXX")"
cleanup() {
  rm -rf "$flamegraph_work_dir"
}
trap cleanup EXIT

profile_dirty=false
if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  if [[ "${ALLOW_DIRTY_PROFILE:-0}" != "1" ]]; then
    printf 'refusing to record checked performance evidence from a dirty worktree; commit first or set ALLOW_DIRTY_PROFILE=1 for a local diagnostic\n' >&2
    exit 2
  fi
  profile_dirty=true
fi

for command in hyperfine samply cargo-flamegraph; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'required profiler is missing: %s\n' "$command" >&2
    exit 2
  fi
done

CARGO_TARGET_DIR="$target_dir" cargo build \
  --locked \
  --profile profiling \
  --manifest-path rust/chronicle_chrono_kernel_wasm/Cargo.toml \
  --example profile_pipeline_v2 \
  --features incremental-v2

metadata="$results_dir/chronicle-55-step-profile-metadata.txt"
{
  printf 'captured_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'commit=%s\n' "$(git rev-parse HEAD)"
  printf 'dirty=%s\n' "$profile_dirty"
  printf 'rows=%s\n' "$rows"
  printf 'runs=%s\n' "$runs"
  printf 'machine=%s\n' "$(uname -m) $(sw_vers -productName) $(sw_vers -productVersion)"
  printf 'rustc=%s\n' "$(rustc --version)"
  printf 'cargo=%s\n' "$(cargo --version)"
  printf 'hyperfine=%s\n' "$(hyperfine --version | head -1)"
  printf 'cargo_flamegraph=%s\n' "$(cargo flamegraph --version)"
  printf 'samply=%s\n' "$(samply --version)"
  printf 'profile_source_sha256=%s\n' "$(shasum -a 256 rust/chronicle_chrono_kernel_wasm/examples/profile_pipeline_v2.rs | awk '{print $1}')"
  printf 'incremental_source_sha256=%s\n' "$(shasum -a 256 rust/chronicle_chrono_kernel_wasm/src/pipeline_v2_incremental.rs | awk '{print $1}')"
} > "$metadata"

: > "$results_dir/chronicle-55-step-native-cases.txt"
for case_name in \
  unchanged \
  upstream_timezone_policy \
  middle_concurrent_usage \
  downstream_day_coverage \
  output_study_name \
  raw_representation_only \
  support_filter_add_absent_app
do
  for _ in $(seq 1 "$runs"); do
    "$executable" --rows "$rows" --mode incremental --case "$case_name" \
      >> "$results_dir/chronicle-55-step-native-cases.txt"
  done
done

hyperfine \
  --warmup 1 \
  --runs "$runs" \
  --command-name "tracked Rust cold, ${rows} rows" \
  --export-json "$results_dir/chronicle-55-step-after-hyperfine.json" \
  "$executable --rows $rows --mode incremental --case cold_benchmark"

/usr/bin/time -l "$executable" --rows "$rows" --mode incremental --case cold_benchmark \
  > "$work_dir/cold-memory.stdout.txt" \
  2> "$results_dir/chronicle-55-step-native-memory.txt"

(
  cd "$flamegraph_work_dir"
  CARGO_TARGET_DIR="$target_dir" cargo flamegraph \
    --manifest-path "$repository_root/rust/chronicle_chrono_kernel_wasm/Cargo.toml" \
    --example profile_pipeline_v2 \
    --features incremental-v2 \
    --profile profiling \
    --output "$results_dir/chronicle-55-step-after-cold.svg" \
    -- \
    --rows "$rows" \
    --mode incremental \
    --case cold_benchmark
)

samply record \
  --save-only \
  --unstable-presymbolicate \
  --profile-name chronicle-55-step-after-cold \
  --output "$results_dir/chronicle-55-step-after-cold.json.gz" \
  -- \
  "$executable" \
  --rows "$rows" \
  --mode incremental \
  --case cold_benchmark

python3 -m cProfile -s cumulative \
  scripts/generate_semantic_behavior_inventory.py --check --contracts-only \
  > "$work_dir/semantic-inventory-cprofile.txt"

printf 'profile results written to %s\n' "$results_dir"
