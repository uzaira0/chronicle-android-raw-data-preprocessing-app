# Production browser performance baseline

This is the active Rust/WASM browser baseline. The former TypeScript/Python
comparison described retired engines and is intentionally no longer used as a
production gate.

- Captured: 2026-07-22
- Machine: Apple M3 Ultra, 512 GiB RAM, arm64 macOS 26.2
- Browser: Playwright Chromium, headless, service-worker controlled
- Fixture: deterministic generated Chronicle raw CSV, 601 lines (600 data
  rows), 111,924 bytes,
  `sha256:bedb857c9eb97b0e80692312d5a99875588d7bd3feb623bc1f07082cd83936b1`
- Commands: `npm run generate:benchmark-fixture -- --output <fixture>` then
  `npm run benchmark:browser -- --raw <fixture> --output-json`

## End-to-end result

| Measurement | Result | Enforced budget |
|---|---:|---:|
| Processing wall time | 549.1 ms | 10,000 ms |
| Input files completed | 1/1 | all files |
| App output rows | 4,272 | non-empty |
| Screen output rows | 3,892 | non-empty when enabled |
| External requests | 0 | 0 |
| Service-worker controlled | yes | required |
| Reported JS heap delta | 0 bytes | 256 MiB |

Chromium exposes `performance.memory` only as an approximate browser metric;
the heap delta budget is a regression tripwire, not proof of peak total WASM
memory. Large-fixture browser memory profiling remains a release obligation.

## Large Rust/WASM runtime baseline

The 600-row browser check above is retained as a fast end-to-end gate. A
second, artifact-heavy baseline now measures the production Rust/WASM entry
point at realistic scale, including every enabled correspondence export.

- Captured: 2026-07-23
- Runtime: Node 22.23.1 loading the production browser WASM on arm64 macOS
- Fixture: 60,624 data rows, 11,525,930 bytes,
  `sha256:8bf14d199724ad7df3cb8822241b4d6355d20977e0c7eb0e92799f06dd2b8e60`
- Options: concurrent-usage modeling, screen-gated crediting, and aggregate
  exports enabled
- Command: `npx vite-node scripts/benchmark_runtime_wasm.mts --raw <fixture>
  --full-options`

| Measurement | Final result |
|---|---:|
| Hyperfine process median (5 runs) | 8.817 s |
| Hyperfine process range | 8.794–8.823 s |
| Rust/WASM `execute_workspace` | 8,372 ms |
| Artifact extraction | 12.7 ms |
| SHA-256 verification of all artifacts | 51.5 ms |
| Measured total inside benchmark | 8,445 ms |
| Maximum resident set size (`/usr/bin/time -l`) | 945,635,328 bytes |
| Produced artifacts | 43 / 143,005,771 bytes |
| Runtime WASM | 4,762,609 bytes |
| Published-output digest | `sha256:c34427afd08fe31acdfa4a7509d6d87ce739b5171fed4c05e84a5e037ab54258` |

The matching pre-optimization fixture measured 10,956.8 ms inside
`execute_workspace` and 1,421,639,680 bytes maximum RSS. The current code is
about 24% faster on that direct execution measurement and uses about 33%
less peak process memory. The output digest is unchanged.

All five Hyperfine measurements landed within 29 milliseconds. The median is
the tracked comparison value. This is a machine-specific regression baseline,
not a portable latency promise.

## Interactive View comparison baseline

The View tab now requests only the Rust-produced review metrics, executes the
affected part of the same 55-step Salsa graph, and does not build CSV exports,
timeline geometry, lineage tables, workspace roots, or evidence closures. The
shared comparison worker begins loading Arm A as soon as the comparison drawer
opens; Arm B then reuses that exact parsed workspace.

- Captured: 2026-07-25
- Runtime: Node 22.23.1 loading the release browser WASM on Apple M3 Ultra
- Fixture: deterministic generated weird-case Chronicle CSV, 100,004 accepted
  raw rows, 19,018,650 bytes,
  `sha256:6c4bca2853bd7ef10df31dbe2f4c7e3e4c7e4f5da3e96b82e0175d0b5513a95f`
- Change: `modelConcurrentUsage: true` to `false`, with the other browser
  options held constant
- Scale: 100 separately named synthetic workspaces, executed by eight parallel
  worker processes
- Command: `npm exec vite-node scripts/benchmark_runtime_wasm.mts -- --raw
  <fixture> --mode warm --iterations 2 --case middle_concurrent_usage
  --materialization review --workspace-count <shard> --full-options --summary
  --compact`

| Measurement across 100 files | Result |
|---|---:|
| Warm changed-file execute median | 656.1 ms |
| Warm changed-file execute p90 | 668.2 ms |
| Warm changed-file execute p95 | 1,243.1 ms |
| Warm changed-file execute maximum | 1,337.7 ms |
| Warm changed-file total median, including artifact transfer/hash | 657.2 ms |
| Cold preparation median | 2,733.9 ms |
| Cold preparation p95 | 4,483.7 ms |
| Runtime WASM | 5,810,920 bytes |
| Runtime WASM digest | `sha256:ed6b2939ec5e31776f79cc10436b744b09b7fff13d1aed11dacdacb480bd4627` |

The eight first-change measurements—one per fresh worker process—paid JIT and
allocator warmup and account for the p95 tail. The other 92 changed files were
tightly grouped around 644–669 ms. A single-process three-file check measured
630–633 ms after warmup and 805 ms for its first changed file. The equivalent
native query-timed run measured 357–471 ms. These values include exact final-row
content hashing and all 55 step statuses; intermediate adjacent steps use
Merkle-style dependency checkpoints so the same 100k rows are not re-hashed at
every logical label.

## Clean-commit native full-output profile

Commit `af41c2f0a56e85272b0aed3d4aab222031875543` was profiled from a clean
worktree with 60,624 generated rows. Every changed result matched a fresh cold
Rust oracle. This harness deliberately materializes full outputs, so the
upstream and middle figures include primary CSV assembly and are not the
review-only View-tab latency above.

| Change after a cold run | Median | Product queries run |
|---|---:|---:|
| No change | 0.161 ms | 0 |
| Timezone policy | 795.181 ms | 4 |
| Concurrent-usage model | 780.454 ms | 4 |
| Day coverage | 251.762 ms | 1 |
| Output study name | 699.193 ms | 1 |
| Raw representation only | 44.668 ms | 1 |
| Add an absent app to the filter support | 35.979 ms | 1 |

Five independent cold process runs had a 2,565.5 ms median, 2,553.6–2,578.6
ms range, and 9.1 ms standard deviation. Peak resident memory was 830,717,952
bytes. Reproducible raw measurements, exact executed-step lists, environment
metadata, a symbolized Samply capture, and the cold CPU flamegraph are in
[`docs/perf/results`](results/). Python `cProfile` measured only the metadata
checker: 0.565 seconds total, 0.465 seconds waiting for its two Rust
subprocesses; it is not part of preprocessing latency.

## Historical pre-Salsa warm-path baseline

A targeted 2026-07-23 diagnostic on the same 60,624-row fixture measured the
old fused worker-local warm path before the 55-query runtime cutover. These
values preserve the optimization baseline and must not be used as the current
runtime result. The active plan requires a committed, repeatable measurement of
the tracked runtime before any new performance claim.

| Request after an initial cold run | Observed wall time | What physically happened |
|---|---:|---|
| Identical request | about 3.87 s | Reused the fused result, but rebuilt/hashed substantial output and evidence data. |
| Raw timestamp changed | about 8.77 s | Ran the complete fused pipeline. |
| Early timezone option changed | about 8.75 s | Ran the complete fused pipeline. |
| Middle `modelConcurrentUsage` option changed | about 8.25 s | Ran the complete fused pipeline. |
| Output-only `studyName` changed | about 8.71 s | Ran the complete fused pipeline. |

The historical result was that every changed case performed the full physical
computation and the 55 labels were post-run projections. The current runtime
has removed that physical gate; fresh measurements must now prove the benefit
and cost of exact Salsa query reuse. The
[55-step incremental Rust plan](../semantic-federation/55-step-incremental-rust-plan.md)
requires actual query execution events and separate cold, unchanged, upstream,
middle, downstream, and qualification/binding measurements.

The production hot path was also captured with symbol-preserving WASM/V8 CPU
profiles and a native Samply flamegraph. The final named WASM profile attributes
23.3% of samples to BLAKE3 SIMD compression and 14.3% to SHA-256 compression;
those hashes protect checkpoint and artifact identity and remain intact.
`cProfile` confirms the Python metadata generator is not on the product path
(616,557 calls in 0.221 seconds, with YAML parsing dominant).

## Deploy artifact

The exact final deploy build occupied 9,758,545 bytes (approximately 9.31
MiB) on disk. Largest
payloads were:

| Asset | Bytes |
|---|---:|
| preprocessing runtime WASM | 4,762,609 |
| semantic index WASM | 2,099,237 |
| bundled app codebook | 2,029,388 |
| main JavaScript | 420,820 |
| graph JavaScript | 233,870 |

The repository deploy-artifact and bundle-budget checks remain authoritative;
these figures are evidence for this machine and commit, not portable promises.

## Known profiling gaps

- The committed [Salsa product trial](SALSA_PRODUCT_TRIAL.md) preserves the
  original six-query selection benchmark. All 55 transformations are now
  callable; the replacement measurement must cover cold, unchanged, upstream,
  middle, downstream, qualification/binding, peak memory, and actual execution
  events. Snapshot export/restore was measured and removed because it was slower
  and much larger than cold recalculation.
- Repeated large-fixture peak RSS in Chromium rather than the Node WASM host.
- Cross-browser OPFS and performance measurements outside Chromium.
- Cold-versus-warm semantic-index query profiling after adding an index cache.
- Export/import streaming memory for large workspace closures.
- Separate cost attribution for CSV-to-Parquet/SPSS generation.
