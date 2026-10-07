#!/usr/bin/env bash
# Reproduce the frozen B03-B05 oracle without compiling the current worktree.
#
# Usage, from anywhere in this repository:
#   bash rust/chronicle_chrono_kernel_wasm/tests/oracles/recapture-detached-b03-b05-080801a.sh
#
# The command is intentionally fail-closed: the detached commit, parent, tree,
# source blobs, probe bytes, canonical JSONL bytes, and capture toolchain must
# all match before the two isolated, locked/offline captures are accepted.

set -euo pipefail

readonly baseline_commit="080801a0232a6a2c97daba0c986094f6cf48fe08"
readonly baseline_parent="e02ab1e710edffb4c48019e7aaf9bf6af6e54e2b"
readonly baseline_tree="ef7b3fc573be0913e984309c90ac92899d876ae0"
readonly probe_sha256="9dc2e7b4d94bb2433b8f59f784443faa525e4b2b676e5039107889406d13b514"
readonly capture_sha256="91769aa3dbfddc01881b62805118b30504e7e0231daa6c95a19c2cad8ed20ec8"
readonly capture_toolchain="1.94.0"
readonly rustc_release="1.94.0"
readonly rustc_commit="4a4ef493e3a1488c6e321570238084b38948f6db"
readonly cargo_release="1.94.0"
readonly cargo_commit="85eff7c80277b57f78b11e28d14154ab12fcf643"
readonly capture_test="detached_b03_b05_capture"
readonly capture_test_fn="capture_detached_b03_b05_oracle"

script_dir="$(
  unset CDPATH
  cd -- "$(dirname -- "$0")" && pwd -P
)"
readonly script_dir
repo_root="$(
  unset CDPATH
  cd -- "$script_dir/../../../.." && pwd -P
)"
readonly repo_root
readonly probe_source="$script_dir/detached-b03-b05-080801a.capture-probe.rs"
readonly canonical_capture="$script_dir/detached-b03-b05-080801a.capture.jsonl"
readonly crate_relative="rust/chronicle_chrono_kernel_wasm"

: "${HOME:?HOME must be set}"
: "${PATH:?PATH must be set}"
readonly capture_path="$PATH"
readonly capture_user_home="$HOME"

for required_tool in cargo chmod cmp cp cut dirname env git ln mkdir mktemp rg rm rustc rustup \
  sed sha256sum tar tr wc; do
  command -v "$required_tool" >/dev/null || {
    echo "missing required tool: $required_tool" >&2
    exit 1
  }
done

resolve_existing_directory() {
  (
    unset CDPATH
    cd -- "$1" && pwd -P
  )
}

source_cargo_home="$(
  resolve_existing_directory "${CARGO_HOME:-$capture_user_home/.cargo}"
)"
readonly source_cargo_home
capture_rustup_home="$(
  resolve_existing_directory "${RUSTUP_HOME:-$capture_user_home/.rustup}"
)"
readonly capture_rustup_home

assert_cargo_config_closure() {
  local detached_crate_root="$1"
  local expected_config="$detached_crate_root/.cargo/config.toml"
  local cursor="$detached_crate_root"
  local candidate
  local filename
  local found_expected=0

  test "$(git hash-object --no-filters "$expected_config")" = \
    "92d129a9de66fa08122d3d5fafa5ba6933c5af51"
  while :; do
    for filename in config config.toml; do
      candidate="$cursor/.cargo/$filename"
      if [[ -e "$candidate" || -L "$candidate" ]]; then
        if [[ "$candidate" != "$expected_config" ]]; then
          echo "refusing ambient Cargo config: $candidate" >&2
          exit 1
        fi
        found_expected=$((found_expected + 1))
      fi
    done
    [[ "$cursor" = "/" ]] && break
    cursor="$(dirname -- "$cursor")"
  done
  test "$found_expected" -eq 1
}

test "$(sha256sum "$probe_source" | cut -d' ' -f1)" = "$probe_sha256"
test "$(sha256sum "$canonical_capture" | cut -d' ' -f1)" = "$capture_sha256"
test "$(wc -l < "$canonical_capture" | tr -d ' ')" = "23"

git -C "$repo_root" cat-file -e "$baseline_commit^{commit}"
test "$(git -C "$repo_root" rev-parse "$baseline_commit^")" = "$baseline_parent"
test "$(git -C "$repo_root" rev-parse "$baseline_commit^{tree}")" = "$baseline_tree"

while IFS=' ' read -r expected_blob relative_path; do
  test "$(git -C "$repo_root" rev-parse "$baseline_commit:$relative_path")" = "$expected_blob"
done <<'BLOBS'
1bfb75ae0515114878b666abd0fc345d13e0bf44 rust/chronicle_chrono_kernel_wasm/src/pipeline_v2.rs
ff446fe6e07ad9a8d53c0688330462013fcfabd0 rust/chronicle_chrono_kernel_wasm/src/pipeline_v2_incremental.rs
dee0ba82ef1363df06237f421335be801ace254e rust/chronicle_chrono_kernel_wasm/src/pipeline_v2_aggregates.rs
1e85dc917fba1b9a95cb0c71496abc214614bbf9 rust/chronicle_chrono_kernel_wasm/Cargo.toml
14b598f6f86b73a47d334cec4804d1cec9040b7a rust/chronicle_chrono_kernel_wasm/Cargo.lock
49952b3e5cd66cbd6aa7398f927a7e3df2b67aae rust-toolchain.toml
92d129a9de66fa08122d3d5fafa5ba6933c5af51 rust/chronicle_chrono_kernel_wasm/.cargo/config.toml
BLOBS

rustc_toolchain_bin="$(
  env -i \
    HOME="$capture_user_home" \
    LC_ALL=C \
    PATH="$capture_path" \
    RUSTUP_DIST_SERVER=file:///nonexistent \
    RUSTUP_HOME="$capture_rustup_home" \
    RUSTUP_UPDATE_ROOT=file:///nonexistent \
    rustup which --toolchain "$capture_toolchain" rustc
)"
readonly rustc_toolchain_bin
test -x "$rustc_toolchain_bin"
rustc_metadata="$(
  env -i \
    HOME="$capture_user_home" \
    LC_ALL=C \
    PATH="$capture_path" \
    RUSTUP_DIST_SERVER=file:///nonexistent \
    RUSTUP_HOME="$capture_rustup_home" \
    RUSTUP_UPDATE_ROOT=file:///nonexistent \
    rustc +1.94.0 --version --verbose
)"
cargo_metadata="$(
  env -i \
    HOME="$capture_user_home" \
    LC_ALL=C \
    PATH="$capture_path" \
    RUSTUP_DIST_SERVER=file:///nonexistent \
    RUSTUP_HOME="$capture_rustup_home" \
    RUSTUP_UPDATE_ROOT=file:///nonexistent \
    cargo +1.94.0 --version --verbose
)"
test "$(printf '%s\n' "$rustc_metadata" | sed -n 's/^release: //p')" = "$rustc_release"
test "$(printf '%s\n' "$rustc_metadata" | sed -n 's/^commit-hash: //p')" = "$rustc_commit"
test "$(printf '%s\n' "$rustc_metadata" | sed -n 's/^host: //p')" = "x86_64-unknown-linux-gnu"
test "$(printf '%s\n' "$rustc_metadata" | sed -n 's/^LLVM version: //p')" = "21.1.8"
test "$(printf '%s\n' "$cargo_metadata" | sed -n 's/^release: //p')" = "$cargo_release"
test "$(printf '%s\n' "$cargo_metadata" | sed -n 's/^commit-hash: //p')" = "$cargo_commit"

capture_root="$(mktemp -d /tmp/chronicle-detached-080801a.XXXXXX)"
case "$capture_root" in
  /tmp/chronicle-detached-080801a.*) ;;
  *)
    echo "refusing unexpected temporary path: $capture_root" >&2
    exit 1
    ;;
esac
cleanup() {
  chmod -R u+w -- "$capture_root" 2>/dev/null || true
  rm -rf -- "$capture_root"
}
trap cleanup EXIT

for run in a b; do
  run_root="$capture_root/$run"
  source_root="$run_root/src"
  detached_crate_root="$source_root/$crate_relative"
  target_root="$run_root/target"
  manifest="$detached_crate_root/Cargo.toml"
  probe_target="$detached_crate_root/tests/$capture_test.rs"
  capture_log="$run_root/capture.log"
  filtered_jsonl="$run_root/capture.filtered.jsonl"
  isolated_cargo_home="$run_root/cargo-home"
  isolated_home="$run_root/home"
  isolated_tmp="$run_root/tmp"

  mkdir -p "$source_root"
  git -C "$repo_root" archive --format=tar "$baseline_commit" | tar -xf - -C "$source_root"
  mkdir -p "$(dirname -- "$probe_target")"
  cp -- "$probe_source" "$probe_target"
  test "$(sha256sum "$probe_target" | cut -d' ' -f1)" = "$probe_sha256"
  mkdir -p "$isolated_cargo_home" "$isolated_home" "$isolated_tmp"
  for cache_directory in registry git; do
    if [[ -e "$source_cargo_home/$cache_directory" ]]; then
      ln -s -- "$source_cargo_home/$cache_directory" \
        "$isolated_cargo_home/$cache_directory"
    fi
  done
  test ! -e "$isolated_cargo_home/config"
  test ! -e "$isolated_cargo_home/config.toml"
  assert_cargo_config_closure "$detached_crate_root"

  (
    cd -- "$detached_crate_root"
    env -i \
      CAPTURE_PROBE_SHA256="sha256:$probe_sha256" \
      CARGO_HOME="$isolated_cargo_home" \
      CARGO_INCREMENTAL=0 \
      CARGO_NET_OFFLINE=true \
      CARGO_TARGET_DIR="$target_root" \
      HOME="$isolated_home" \
      LC_ALL=C \
      PATH="$capture_path" \
      RUSTC="$rustc_toolchain_bin" \
      RUSTUP_DIST_SERVER=file:///nonexistent \
      RUSTUP_HOME="$capture_rustup_home" \
      RUSTUP_UPDATE_ROOT=file:///nonexistent \
      TMPDIR="$isolated_tmp" \
      TZ=UTC \
      cargo +1.94.0 test \
        --manifest-path "$manifest" \
        --locked \
        --offline \
        --test "$capture_test" \
        --no-run

    env -i \
      CAPTURE_PROBE_SHA256="sha256:$probe_sha256" \
      CARGO_HOME="$isolated_cargo_home" \
      CARGO_INCREMENTAL=0 \
      CARGO_NET_OFFLINE=true \
      CARGO_TARGET_DIR="$target_root" \
      HOME="$isolated_home" \
      LC_ALL=C \
      PATH="$capture_path" \
      RUSTC="$rustc_toolchain_bin" \
      RUSTUP_DIST_SERVER=file:///nonexistent \
      RUSTUP_HOME="$capture_rustup_home" \
      RUSTUP_UPDATE_ROOT=file:///nonexistent \
      TMPDIR="$isolated_tmp" \
      TZ=UTC \
      cargo +1.94.0 test \
        --manifest-path "$manifest" \
        --locked \
        --offline \
        --test "$capture_test" \
        "$capture_test_fn" \
        -- \
        --exact \
        --nocapture \
        --test-threads=1 >"$capture_log" 2>&1
  )

  LC_ALL=C rg -o 'CHRONICLE_DETACHED_ORACLE\t.*$' "$capture_log" > "$filtered_jsonl"
  test "$(wc -l < "$filtered_jsonl" | tr -d ' ')" = "23"
  test "$(sha256sum "$filtered_jsonl" | cut -d' ' -f1)" = "$capture_sha256"
  cmp -- "$canonical_capture" "$filtered_jsonl"
done

cmp -- "$capture_root/a/capture.filtered.jsonl" "$capture_root/b/capture.filtered.jsonl"
printf 'detached probe sha256: %s\n' "$probe_sha256"
printf 'detached capture sha256: %s\n' "$capture_sha256"
printf 'two isolated locked/offline captures are byte-identical\n'
