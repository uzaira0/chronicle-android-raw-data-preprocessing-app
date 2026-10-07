#!/usr/bin/env bash
# Bounded libFuzzer sanity runs against the matcher, the authoritative runtime
# ingestion boundaries, and the evidence-journal decoder an imported workspace
# archive reaches. Override FUZZ_SECONDS for a longer local run.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FUZZ_SECONDS="${FUZZ_SECONDS:-10}"

# Ensure ~/.cargo/bin is on PATH (needed after fresh cargo install)
export PATH="$HOME/.cargo/bin:$PATH"

if ! command -v rustup >/dev/null 2>&1; then
  echo "rustup is required to select the fuzz packages' nightly toolchain" >&2
  exit 1
fi
if ! rustup run nightly cargo --version >/dev/null 2>&1; then
  echo "the Rust nightly toolchain is required; install with: rustup toolchain install nightly" >&2
  exit 1
fi
if ! rustup run nightly cargo fuzz --version >/dev/null 2>&1; then
  echo "cargo-fuzz is required; install with: cargo install cargo-fuzz --locked" >&2
  exit 1
fi

run_target() {
  local fuzz_dir="$1"
  local target="$2"
  shift 2
  echo "=== Fuzz sanity: ${target} (${FUZZ_SECONDS}s) ==="
  (
    cd "$fuzz_dir"
    # -print_funcs=0: on every new covered function libFuzzer symbolizes its PC
    # (atos on macOS) against a 1.7M-PC binary; one such stall took 3.1 s of a
    # 6 s profile of structured_workspace. The NEW_FUNC lines it buys are not
    # read by a sanity run; crash reports are symbolized as before.
    rustup run nightly cargo fuzz run "$target" -- \
      "$@" \
      -max_total_time="$FUZZ_SECONDS" \
      -rss_limit_mb=1024 \
      -print_funcs=0 \
      -print_final_stats=1
  )
}

run_target "$REPO_ROOT/rust/chronicle_app_usage_matcher/fuzz" match_core
# libFuzzer's -seed_inputs takes a comma-separated list of files, not a directory.
run_target "$REPO_ROOT/rust/chronicle_preprocessing_runtime_wasm/fuzz" raw_file_inspection \
  -seed_inputs=seeds/raw_file_inspection/minimal.csv
# -detect_leaks=0: libFuzzer re-runs every input whose malloc and free counts
# differ to look for a leak, and the runtime keeps per-thread caches across
# executions, so every input that reaches the pipeline (~250 ms each under
# ASan) ran twice. With a 19-input corpus the whole 10 s went to loading it
# twice (#39 INITED, zero mutations). ASan leaves LeakSanitizer off by default
# on macOS, so those re-runs could not report anything here; a Rust leak is not
# a memory-safety bug either way.
run_target "$REPO_ROOT/rust/chronicle_preprocessing_runtime_wasm/fuzz" structured_workspace \
  -detect_leaks=0
run_target "$REPO_ROOT/rust/chronicle_preprocessing_runtime_wasm/fuzz" closure_evidence_journal

echo "=== Fuzz sanity: all targets passed ==="
