# Rust/WASM Fast-Path Promotion Gate

Date: 2026-04-28

## Summary

Create an automated promotion gate for the Rust/WASM browser pipeline so the
fast path can advance without silently regressing parity, size, or fallback
behavior.

## Repo evidence

The repo already contains multiple Rust/WASM crates and measured build outputs:

- `rust/chronicle_app_usage_wasm`
- `rust/chronicle_chrono_kernel_wasm`
- `rust/chronicle_polars_kernels_wasm`
- `web/src/wasm/*/pkg/*_bg.wasm`
- `web/scripts/bench_*`
- `docs/rust-port-design-memo.md`
- `docs/rust-port-wave-2.md`

Current checked-in WASM sizes observed during this review:

- matcher-only WASM: 30,364 bytes raw, 13,156 bytes gzipped
- chrono kernel WASM: 1,226,498 bytes raw, 312,139 bytes gzipped
- polars kernel WASM: 9,173,219 bytes raw, 2,137,996 bytes gzipped

The Rust port docs make a concrete recommendation: use a single end-to-end Rust
kernel, keep the TypeScript pipeline as fallback, and enforce byte-identical
output across the fixture grid.

## Classification

Deterministic local script / manual promotion command, with optional pre-push
hook or launchd benchmark schedule. This is not a Codex automation.

This classification follows `/Users/u/AGENTS.md` Priority 4 because build,
size, parity, fallback, and benchmark checks are deterministic command surfaces.
It also follows Priority 7 by defining concrete verification artifacts, and
Priority 5 by avoiding unrelated repo edits or workflow churn.

## Proposed mechanism

Add a path-aware local command, for example
`scripts/check-wasm-fast-path-promotion.sh`, that the operator can run manually
or install as a pre-push hook. If trend data is needed, run the same command
from launchd on this machine and store local reports. Do not create a Codex
automation or a GitHub Actions workflow for this local test/check surface.

The command runs when Rust/WASM, benchmark, or browser pipeline files change
and:

1. Builds all production candidate WASM packages with the repo's intended
   release flags.
2. Records raw and gzipped sizes.
3. Runs the TS-vs-Rust and desktop-vs-browser parity harnesses on the fixture
   matrix.
4. Runs a bounded benchmark suite with stable input fixtures.
5. Checks that the TS fallback path still runs when the WASM module is absent or
   intentionally disabled.
6. Writes a concise Markdown artifact with byte-diff, row counts, wall time,
   and size deltas.

## Trigger

- Manual command before promoting a Rust/WASM preprocessing path.
- Optional pre-push hook when changed files include `rust/chronicle_*`,
  `web/src/lib/browserPipeline.ts`, `web/src/workers/chronicle-worker.ts`,
  `web/src/wasm/`, or `web/scripts/bench_*`.
- Optional local launchd benchmark schedule on the main checkout, using trend
  thresholds rather than a single-run hard failure for noisy timing data.

## Inputs

- Rust/WASM crates and generated browser packages.
- Fixture matrix for TypeScript-vs-Rust and desktop-vs-browser parity.
- Current size baselines or the most recent local report.
- Benchmark configuration and bounded sample inputs.

## Outputs

- WASM raw/gzip size table.
- Parity row-count and byte-diff summary.
- Fallback-path result.
- Benchmark timing summary with threshold decisions.
- Local Markdown report artifact.

## Stop condition

Stop once the fast path remains byte-identical to the fallback across the
fixture matrix, fallback behavior is still available, size deltas are reported,
and benchmark thresholds are either within tolerance or recorded as a specific
regression.

## Failure reporting

Exit nonzero with the first failing category, the exact command to rerun, and
the report path. Escalate to Codex only when a failed category needs code
diagnosis, fixture expansion, or promotion-policy judgment.

## Why LLM judgment is not required

Build success, binary size, parity, fallback behavior, and benchmark thresholds
are measurable. Under `/Users/u/AGENTS.md` Priority 4, that belongs in scripts,
hooks, or non-LLM schedules. Codex is appropriate only after deterministic
evidence shows a regression that needs repair.

## Why it helps

The repo is in an active Rust-port phase. A promotion gate keeps the optimization
work honest: faster paths must remain byte-identical, and larger WASM payloads
must be visible alongside runtime gains.

## Duplicate-risk review

This is narrower than a general performance budget or web quality watch. It is
specifically about promoting Rust/WASM preprocessing kernels while preserving
the TypeScript fallback and desktop/browser output contract.

## External references reviewed

- The Rust and WebAssembly book recommends measuring gzipped WASM size and
  runtime tradeoffs, not raw size alone: https://rustwasm.github.io/book/reference/code-size.html
- `wasm-pack` is the standard Rust-to-WebAssembly workflow tool used alongside
  JavaScript build workflows: https://github.com/wasm-bindgen/wasm-pack
