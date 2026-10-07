# Detached B03-B05 capture contract

This directory freezes an oracle captured from commit
`080801a0232a6a2c97daba0c986094f6cf48fe08`. That commit is paper-only on top
of B02 parent `e02ab1e710edffb4c48019e7aaf9bf6af6e54e2b`; its tree
`ef7b3fc573be0913e984309c90ac92899d876ae0` predates the B03-B05 product
fields. It is therefore the code under test during capture, never the current
worktree.

The repository-resolvable evidence is:

- `detached-b03-b05-080801a.capture-probe.rs`: the exact reviewed probe bytes,
  SHA-256 `9dc2e7b4d94bb2433b8f59f784443faa525e4b2b676e5039107889406d13b514`.
- `detached-b03-b05-080801a.capture.jsonl`: the exact 23-record output from two
  byte-identical captures, 26,098 bytes, SHA-256
  `91769aa3dbfddc01881b62805118b30504e7e0231daa6c95a19c2cad8ed20ec8`.
- `detached-b03-b05-080801a.json`: the lossless inventory projection consumed
  by the current-code compatibility test.
- `recapture-detached-b03-b05-080801a.sh`: the reviewed capture, filtering, and
  verification procedure, pinned from the inventory as SHA-256
  `e8f4f88fafc58a130a007eb575dfa3d82bcd3372ac3274cea17ad0c883a388e0`.

The observed capture toolchain is selected as exact Rust `1.94.0`, never the
floating `stable` alias. Its rustc commit is
`4a4ef493e3a1488c6e321570238084b38948f6db`, Cargo commit
`85eff7c80277b57f78b11e28d14154ab12fcf643`, target
`x86_64-unknown-linux-gnu`, and LLVM 21.1.8. The procedure refuses any other
toolchain and validates the detached `rust-toolchain.toml`, Cargo config,
manifest, lockfile, and three pipeline source blobs before compiling.

The procedure is independent of the caller's current directory. Invoke this
file by a suitable relative or absolute path; from the repository root, run:

```sh
bash rust/chronicle_chrono_kernel_wasm/tests/oracles/recapture-detached-b03-b05-080801a.sh
```

The procedure creates two fresh `git archive` trees under a validated
`mktemp -d` path and copies only the frozen probe into each detached tree. Each
run gets separate target, home, temporary, and Cargo-home directories. The
isolated Cargo home exposes only the caller's cached registry/git inputs, not
its configuration. Cargo executes from the detached crate after the procedure
verifies that its frozen `.cargo/config.toml` is the sole discoverable Cargo
configuration. `env -i` removes caller-provided compiler selection, wrappers,
flags, target/profile overrides, and `UPDATE_GOLDEN`; the actual Cargo build is
given the exact rustup-resolved 1.94.0 `rustc` path. Both invocations use
`--locked`, `--offline`, and `CARGO_NET_OFFLINE=true`. Rustup download roots
point to nonexistent local paths during toolchain discovery and capture, so an
absent exact toolchain fails instead of fetching. Temporary trees are removed
on exit.

Each run is filtered with the exact expression
`CHRONICLE_DETACHED_ORACLE\t.*$`, must yield exactly 23 LF-terminated records,
must have the frozen capture digest, and must compare byte-for-byte with both
the committed JSONL and the other run. The integration test independently
reconstructs the canonical JSONL from the inventory and requires exact byte
equality.

The 21 B02 strategy/opener rows explicitly use
`minimum_usage_duration = 0`; the B04 boundary and B05 Chronicle screen rows
explicitly use `60`. No captured constant is read by production code.
