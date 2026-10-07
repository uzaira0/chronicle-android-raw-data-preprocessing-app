#!/usr/bin/env bash
# Unused-dependency gate (launch audit 2026-10-03, analysis S5/S13): cargo-udeps
# over the five product crates, every target (lib, tests, examples, benches) so
# an unused dev-dependency is caught too — the audit found `proptest` declared
# and never used by chronicle_preprocessing_semantic_adapter.
#
# cargo-udeps needs a nightly toolchain (it reads -Zbinary-dep-depinfo). Builds
# go to rust/target/udeps (gitignored), apart from each crate's own stable
# target/, so this never invalidates a `make rust` build. Every crate is checked
# even after one fails, and the gate fails if any did.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"
export CARGO_TARGET_DIR="${UDEPS_TARGET_DIR:-$PWD/rust/target/udeps}"
toolchain="${CHRONICLE_UDEPS_TOOLCHAIN:-nightly}"

if ! rustup run "$toolchain" cargo udeps --version >/dev/null 2>&1; then
  echo "cargo-udeps on the $toolchain toolchain is required:" >&2
  echo "  rustup toolchain install $toolchain && cargo install cargo-udeps --locked" >&2
  exit 1
fi

# manifest + the features its gate builds with (the Makefile's `rust` target).
crates=(
  "rust/chronicle_app_usage_matcher/Cargo.toml --no-default-features"
  "rust/chronicle_chrono_kernel_wasm/Cargo.toml --features incremental-v2"
  "rust/chronicle_preprocessing_semantic_adapter/Cargo.toml"
  "rust/chronicle_preprocessing_runtime_wasm/Cargo.toml"
  "rust/chronicle_semantic_index_wasm/Cargo.toml"
)

failed=()
for entry in "${crates[@]}"; do
  read -r manifest features <<<"$entry"
  echo "── udeps: $manifest ${features:-}"
  # shellcheck disable=SC2086  # $features is zero or more separate flags
  if ! rustup run "$toolchain" cargo udeps --quiet --locked --all-targets \
      --manifest-path "$manifest" $features; then
    failed+=("$manifest")
  fi
done

if (( ${#failed[@]} )); then
  printf 'unused dependencies (or a failed build) in: %s\n' "${failed[@]}" >&2
  exit 1
fi
echo "✓ udeps: no unused dependencies in ${#crates[@]} crates"
