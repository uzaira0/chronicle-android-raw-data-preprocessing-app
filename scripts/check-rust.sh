#!/usr/bin/env bash
# Rust verification gate (rust-clippy-ci): clippy across the independent crates under
# rust/ (this repo has no workspace root — each crate is standalone). `-D warnings`
# makes lint findings fail the gate, matching the fleet exemplar (actours
# scripts/check-all.sh, ios .githooks/pre-push). Local-first per
# pref-local-verification-gate — invoke from CI or a pre-push hook.
set -euo pipefail
cd "$(dirname "$0")/.."
for crate in rust/*/; do
  [ -f "${crate}Cargo.toml" ] || continue
  echo "==> cargo clippy ${crate}"
  ( cd "$crate" && cargo clippy --all-targets --all-features -- -D warnings )
done
echo "clippy: all crates clean"
