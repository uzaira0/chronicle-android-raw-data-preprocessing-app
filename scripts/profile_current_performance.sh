#!/usr/bin/env bash
# Native profile of the tracked incremental engine (make profile-current).
#
# Two kinds of timing are recorded and they are never the same number:
#
#   in-process   The example times only engine work inside its own process:
#                for the cold case, engine construction + execute of the
#                baseline request; for an A/B case, only the execute of the
#                changed request on an engine that has just run the baseline.
#                Each process writes one JSON line with every iteration, the
#                min/median/p90/max, the executed queries, the sequential
#                oracle's digest that every iteration matched, the input's
#                seed and SHA-256, and the load average around the timed loop.
#                The `timing_scope` field of each line states its exact scope.
#   process wall Hyperfine times the whole process: start-up, fixture
#                construction, one cold execute, result digesting and the
#                sequential oracle check. /usr/bin/time's peak RSS covers the
#                same whole process.
#
# Each process uses a distinct fixture seed (1..PROFILE_RUNS), so the pooled
# in-process figures span distinct inputs; the Samply, Hyperfine
# and /usr/bin/time captures all use seed 1.
#
# macOS only: /usr/bin/time -l, sw_vers and vm.loadavg are BSD/macOS forms.
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf 'profile_current_performance.sh records macOS figures (/usr/bin/time -l, sw_vers); run it on macOS\n' >&2
  exit 2
fi

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

rows="${PROFILE_ROWS:-60624}"
runs="${PROFILE_RUNS:-5}"
iterations="${PROFILE_ITERATIONS:-5}"
results_dir="${PROFILE_RESULTS_DIR:-$repository_root/docs/perf/results}"
work_dir="${PROFILE_WORK_DIR:-$repository_root/.perf-work}"
target_dir="$work_dir/native-profile-target"
executable="$target_dir/profiling/examples/profile_pipeline_v2"
capture_seed=1

mkdir -p "$results_dir" "$work_dir"


profile_dirty=false
if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  if [[ "${ALLOW_DIRTY_PROFILE:-0}" != "1" ]]; then
    printf 'refusing to record checked performance evidence from a dirty worktree; commit first or set ALLOW_DIRTY_PROFILE=1 for a local diagnostic\n' >&2
    exit 2
  fi
  profile_dirty=true
fi

for command in hyperfine samply; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'required profiler is missing: %s\n' "$command" >&2
    exit 2
  fi
done

load_average() {
  sysctl -n vm.loadavg | tr -d '{}' | awk '{print $1, $2, $3}'
}

CARGO_TARGET_DIR="$target_dir" cargo build \
  --locked \
  --profile profiling \
  --manifest-path rust/chronicle_chrono_kernel_wasm/Cargo.toml \
  --example profile_pipeline_v2 \
  --features incremental-v2

metadata="$results_dir/chronicle-incremental-runtime-profile-metadata.txt"
record_load() {
  printf 'load_average_1m_5m_15m_%s=%s\n' "$1" "$(load_average)" >> "$metadata"
}
{
  printf 'captured_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'commit=%s\n' "$(git rev-parse HEAD)"
  printf 'dirty=%s\n' "$profile_dirty"
  printf 'rows=%s\n' "$rows"
  printf 'runs=%s\n' "$runs"
  printf 'iterations_per_process=%s\n' "$iterations"
  printf 'in_process_seeds=%s\n' "$(seq 1 "$runs" | paste -sd, -)"
  printf 'capture_seed=%s\n' "$capture_seed"
  printf 'logical_cpus=%s\n' "$(getconf _NPROCESSORS_ONLN)"
  printf 'machine=%s\n' "$(uname -m) $(sw_vers -productName) $(sw_vers -productVersion)"
  printf 'rustc=%s\n' "$(rustc --version)"
  printf 'cargo=%s\n' "$(cargo --version)"
  printf 'hyperfine=%s\n' "$(hyperfine --version | head -1)"
  printf 'samply=%s\n' "$(samply --version)"
  printf 'profile_source_sha256=%s\n' "$(shasum -a 256 rust/chronicle_chrono_kernel_wasm/examples/profile_pipeline_v2.rs | awk '{print $1}')"
  printf 'incremental_source_sha256=%s\n' "$(python3 - <<'PYTHON'
import hashlib
from pathlib import Path
import re

root = Path("rust/chronicle_chrono_kernel_wasm/src")
paths = [root / "pipeline_v2.rs"]
for source in paths:
    for relative, delimiter in re.findall(r'#\[path\s*=\s*"([^"]+)"\]\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+\w+\s*([;{])', source.read_text()):
        child = source.parent / relative
        children = sorted(child.rglob("*.rs")) if delimiter == "{" else [child]
        for child in children:
            if child not in paths:
                paths.append(child)
digest = hashlib.sha256()
for source in sorted(paths):
    digest.update(str(source).encode() + b"\0")
    digest.update(source.read_bytes())
print(digest.hexdigest())
PYTHON
)"
} > "$metadata"
record_load start

# In-process A/B cases: one process per (case, seed), each running
# $iterations fresh-engine baseline+change pairs and timing only the change.
cases="$results_dir/chronicle-incremental-runtime-native-cases.jsonl"
: > "$cases"
record_load before_cases
for case_name in \
  unchanged \
  upstream_timezone_policy \
  middle_concurrent_usage \
  downstream_day_coverage \
  output_study_name \
  raw_representation_only \
  support_filter_add_absent_app
do
  for seed in $(seq 1 "$runs"); do
    "$executable" --rows "$rows" --seed "$seed" --iterations "$iterations" \
      --mode incremental --case "$case_name" >> "$cases"
  done
done
record_load after_cases

# In-process cold execute: one process per seed, $iterations fresh engines each.
cold="$results_dir/chronicle-incremental-runtime-native-cold.jsonl"
: > "$cold"
record_load before_cold
for seed in $(seq 1 "$runs"); do
  "$executable" --rows "$rows" --seed "$seed" --iterations "$iterations" \
    --mode incremental --case cold_benchmark >> "$cold"
done
record_load after_cold

# Process wall: the whole process, fixture construction and oracle included.
record_load before_hyperfine
hyperfine \
  --warmup 1 \
  --runs "$runs" \
  --command-name "process wall: start-up + fixture (seed ${capture_seed}, ${rows} rows) + one cold execute + digest + sequential oracle" \
  --export-json "$results_dir/chronicle-incremental-runtime-process-wall-hyperfine.json" \
  "$executable --rows $rows --seed $capture_seed --iterations 1 --mode incremental --case cold_benchmark"
record_load after_hyperfine

# Whole-process peak RSS (fixture construction and the oracle included). The
# example's own JSON line from this run carries the in-process high-water mark
# read right after the cold execute, before the oracle.
record_load before_time
/usr/bin/time -l "$executable" --rows "$rows" --seed "$capture_seed" --iterations 1 \
  --mode incremental --case cold_benchmark \
  > "$results_dir/chronicle-incremental-runtime-native-memory-run.jsonl" \
  2> "$results_dir/chronicle-incremental-runtime-native-memory.txt"
record_load after_time

python3 - "$results_dir" <<'PYTHON'
"""Pool the per-process JSON lines into the figures BASELINE.md publishes.

Same order statistics as the example: the median of an even count is the mean
of the two middle samples, p90 is nearest-rank.
"""
import json
import math
import re
import sys
from pathlib import Path

results = Path(sys.argv[1])


def stats(values):
    ordered = sorted(values)
    count = len(ordered)
    middle = count // 2
    median = ordered[middle] if count % 2 else (ordered[middle - 1] + ordered[middle]) / 2
    return {
        "n": count,
        "min_ms": ordered[0],
        "median_ms": median,
        "p90_nearest_rank_ms": ordered[max(math.ceil(0.9 * count), 1) - 1],
        "max_ms": ordered[-1],
    }


def pooled(records):
    samples = [ns / 1e6 for record in records for ns in record["elapsed_ns"]]
    readings = [
        record["load_average_1m_5m_15m"][moment][0]
        for record in records
        for moment in ("before", "after_timed_loop")
        if record["load_average_1m_5m_15m"][moment] is not None
    ]
    return {
        "processes": len(records),
        "seeds": [record["input"]["seed"] for record in records],
        "distinct_input_sha256": len({record["input"]["sha256"] for record in records}),
        "distinct_oracle_result_digests": len({record["oracle"]["result_digest"] for record in records}),
        "oracle_matched_iterations": sum(record["oracle"]["iterations_matched"] for record in records),
        # Per process; every iteration inside a process is already checked equal.
        "executed_count_per_process": [record["executed_count"] for record in records],
        "internal_executed_count_per_process": [record["internal_executed_count"] for record in records],
        "pooled_all_iterations": stats(samples),
        "load_average_1m_min_max_over_before_and_after_readings": [min(readings), max(readings)] if readings else None,
    }


def load(name):
    path = results / name
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


cases = {}
for record in load("chronicle-incremental-runtime-native-cases.jsonl"):
    cases.setdefault(record["case"], []).append(record)
cold_records = load("chronicle-incremental-runtime-native-cold.jsonl")
cold = pooled(cold_records)
# The first iteration of each process is the first pipeline execution in that
# process; later iterations run in a process that has already executed one.
cold["first_iteration_per_process"] = stats([record["first_iteration_ms"] for record in cold_records])
after_first = [ns / 1e6 for record in cold_records for ns in record["elapsed_ns"][1:]]
cold["pooled_iterations_after_first"] = stats(after_first) if after_first else None
cold["process_peak_resident_bytes_after_first_execute"] = [
    record["process_peak_resident_bytes"]["after_first_execute"] for record in cold_records
]
cold["timing_scope"] = cold_records[0]["timing_scope"]

wall = json.loads((results / "chronicle-incremental-runtime-process-wall-hyperfine.json").read_text())["results"][0]
memory_text = (results / "chronicle-incremental-runtime-native-memory.txt").read_text()
peak = re.search(r"(\d+)\s+maximum resident set size", memory_text)
memory_run = load("chronicle-incremental-runtime-native-memory-run.jsonl")[0]

summary = {
    "in_process_cold": cold,
    "in_process_ab_cases": {
        name: dict(pooled(records), timing_scope=records[0]["timing_scope"])
        for name, records in cases.items()
    },
    "process_wall_cold": {
        "scope": wall["command"],
        "runs": len(wall["times"]),
        "median_ms": wall["median"] * 1e3,
        "mean_ms": wall["mean"] * 1e3,
        # hyperfine reports no standard deviation for a single run.
        "stddev_ms": wall["stddev"] * 1e3 if wall["stddev"] is not None else None,
        "min_ms": wall["min"] * 1e3,
        "max_ms": wall["max"] * 1e3,
    },
    "process_peak_resident_bytes": {
        "whole_process_usr_bin_time": int(peak.group(1)) if peak else None,
        "same_run_in_process_high_water_after_cold_execute": memory_run["process_peak_resident_bytes"]["after_first_execute"],
        "same_run_in_process_high_water_before_first_execute": memory_run["process_peak_resident_bytes"]["before_first_execute"],
    },
}
(results / "chronicle-incremental-runtime-native-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
PYTHON

# The Samply capture covers the whole process too, so it contains the
# sequential oracle as its own subtree (run_pipeline_v2_with_supports) beside
# the measured cold execute (IncrementalPipelineV2Engine::execute). Open it in
# profiler.firefox.com for the call tree and flame graph. There is no separate
# cargo-flamegraph step: on macOS it records through xctrace, and
# cargo-flamegraph 0.6.13/0.6.14 cannot collapse xctrace 27's output
# ("Unpaired tag: frame"), so the step failed after every figure was written.
samply record \
  --save-only \
  --unstable-presymbolicate \
  --profile-name chronicle-incremental-runtime-after-cold \
  --output "$results_dir/chronicle-incremental-runtime-after-cold.json.gz" \
  -- \
  "$executable" \
  --rows "$rows" \
  --seed "$capture_seed" \
  --mode incremental \
  --case cold_benchmark

python3 -m cProfile -s cumulative \
  scripts/generate_semantic_behavior_inventory.py --check --contracts-only \
  > "$work_dir/semantic-inventory-cprofile.txt"

record_load end

printf 'profile results written to %s\n' "$results_dir"
