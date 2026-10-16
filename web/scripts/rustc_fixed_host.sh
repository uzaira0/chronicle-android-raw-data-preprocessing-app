#!/bin/sh
# The rustc that WASM builds hand to Cargo as RUSTC (see wasm_build_flags.mjs).
#
# Cargo hashes the `host:` line of `rustc -vV` into the metadata of every build
# script and proc-macro, and from there into the -C metadata of every crate that
# depends on one (rust-lang/cargo#13922). The runtime build.rs hashes the same
# line into BUILD_ENVIRONMENT_DIGEST. So the same sources built different WASM
# bytes on macOS and on Linux. The WASM does not depend on the build host, so
# this reports one fixed host; every other invocation is the real rustc as is.
# The fixed value is the Linux host the committed packages were first built on.
set -eu
real=${CHRONICLE_REAL_RUSTC:-rustc}
if [ "$#" -eq 1 ] && [ "$1" = "-vV" ]; then
  version=$("$real" -vV)
  # Shell builtins only: PATH may not hold sed for this process.
  printf '%s\n' "$version" | while IFS= read -r line; do
    case $line in
      "host: "*) printf '%s\n' "host: x86_64-unknown-linux-gnu" ;;
      *) printf '%s\n' "$line" ;;
    esac
  done
  exit 0
fi
exec "$real" "$@"
