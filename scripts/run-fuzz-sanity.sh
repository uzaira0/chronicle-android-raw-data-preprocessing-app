#!/usr/bin/env bash
# 10-second libFuzzer sanity run against the core app-usage matching algorithm.
# Fails if cargo-fuzz is not available (installs it first if missing).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FUZZ_DIR="$REPO_ROOT/rust/chronicle_app_usage_matcher/fuzz"

# Ensure ~/.cargo/bin is on PATH (needed after fresh cargo install)
export PATH="$HOME/.cargo/bin:$PATH"

# Install cargo-fuzz if not present
if ! cargo fuzz --version &>/dev/null 2>&1; then
  echo "cargo-fuzz not found — installing..."
  cargo install cargo-fuzz --locked
fi

cd "$FUZZ_DIR"

# The fuzz dir already has rust-toolchain.toml pinning nightly.
# Use RUSTUP_TOOLCHAIN to ensure cargo-fuzz picks it up regardless
# of how cargo resolves the active toolchain.
export RUSTUP_TOOLCHAIN=nightly

echo "=== Fuzz sanity: match_core (10s) ==="
cargo fuzz run match_core -- \
  -max_total_time=10 \
  -rss_limit_mb=512 \
  -print_final_stats=1

echo "=== Fuzz sanity: PASS ==="
