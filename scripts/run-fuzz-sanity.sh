#!/usr/bin/env bash
# Bounded libFuzzer sanity runs against the matcher and authoritative runtime
# ingestion boundaries. Override FUZZ_SECONDS for a longer local campaign.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FUZZ_SECONDS="${FUZZ_SECONDS:-10}"

# Ensure ~/.cargo/bin is on PATH (needed after fresh cargo install)
export PATH="$HOME/.cargo/bin:$PATH"

if ! command -v rustup >/dev/null 2>&1; then
  echo "rustup is required to select the fuzz packages' nightly toolchain" >&2
  exit 1
fi
if ! rustup run nightly cargo --version &>/dev/null 2>&1; then
  echo "the Rust nightly toolchain is required; install with: rustup toolchain install nightly" >&2
  exit 1
fi
if ! rustup run nightly cargo fuzz --version &>/dev/null 2>&1; then
  echo "cargo-fuzz is required; install the recommended version with: cargo install cargo-fuzz --version 0.13.2 --locked" >&2
  exit 1
fi

run_target() {
  local fuzz_dir="$1"
  local target="$2"
  shift 2
  echo "=== Fuzz sanity: ${target} (${FUZZ_SECONDS}s) ==="
  (
    cd "$fuzz_dir"
    rustup run nightly cargo fuzz run "$target" -- \
      "$@" \
      -max_total_time="$FUZZ_SECONDS" \
      -rss_limit_mb=1024 \
      -print_final_stats=1
  )
}

run_target "$REPO_ROOT/rust/chronicle_app_usage_matcher/fuzz" match_core
run_target "$REPO_ROOT/rust/chronicle_preprocessing_runtime_wasm/fuzz" raw_file_inspection \
  -seed_inputs=seeds/raw_file_inspection
run_target "$REPO_ROOT/rust/chronicle_preprocessing_runtime_wasm/fuzz" structured_workspace

echo "=== Fuzz sanity: all targets passed ==="
