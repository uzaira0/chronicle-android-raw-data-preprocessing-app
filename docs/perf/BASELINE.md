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
affected part of the same query-registry Salsa graph, and does not build CSV exports,
timeline geometry, lineage tables, workspace roots, or evidence closures. The
selected file stays in its existing worker and can use exact in-memory query
reuse. For every other file, the saved result already is Arm A, so an eight-way
worker pool computes Arm B only. It no longer repeats the old configuration
just to warm each replacement worker.

- Captured: 2026-07-25
- Runtime: Node 22.23.1 loading the release browser WASM on Apple M3 Ultra
- Fixture: deterministic generated weird-case Chronicle CSV, 100,004 accepted
  raw rows, 19,018,650 bytes,
  `sha256:6c4bca2853bd7ef10df31dbe2f4c7e3e4c7e4f5da3e96b82e0175d0b5513a95f`
- Changes: `modelConcurrentUsage: true` to `false`, and the narrower
  `minimumUsageDuration: 60` to `2`, with all other browser options held
  constant
- Scale: 100 copies of the synthetic input, executed as independent cold Arm B
  computations by eight parallel worker processes
- Command: `npm run measure:review-batch --
  ../.tmp-benchmark/chronicle-synthetic-100000.csv 100 8`

| Measurement across 100 files | Concurrent-usage change | Minimum-duration change |
|---|---:|---:|
| Whole 100-file wall time | 4.928 s | 1.423 s |
| Arm B execute minimum | 367.5 ms | 104.6 ms |
| Arm B execute median | 376.9 ms | 107.5 ms |
| Arm B execute p90 | 384.1 ms | 111.1 ms |
| Arm B execute p95 | 386.3 ms | 111.6 ms |
| Arm B execute maximum | 387.0 ms | 114.3 ms |
| Arm B execute mean | 377.3 ms | 108.0 ms |
| Bytes copied into WASM per file | 15,509,934 | 14,014,310 |
| Verified review-summary digest | `sha256:dd1f366ec052bbd484a8f18e4122d75c3c674cc7a6b1b33974bd72e957b1adad` | `sha256:77efd3cb915681bc34f3ce1237a7bdb05417c7001e5dbdf862ec232d05341045` |

The runtime WASM was 6,047,282 bytes with digest
`sha256:679ece24d761bc782442978b60ca56173afce107f02975d9091a8683bdf36f4b`.

This is the honest persisted-base cost for 100 independent files on eight warm
WASM workers, not an unchanged-request shortcut. It measures the normal
fail-closed WASM package after a one-process bootstrap; no test-only evidence
bypass is present. A direct full browser attempt with 100
simultaneously loaded 19 MB files remained active but the target page closed
after the browser process tree reached roughly 7 GB. That is a separate
full-result retention and rendering-memory problem; this benchmark isolates the
review computation distribution without claiming the current UI can safely
retain all 100 full results.

These numbers include the durable Rust-owned resume points that are now in
production code. A full run saves independently checksummed values after step
16 (`compile_reconstruction`) and reconstruction (`sort_episodes`) in the existing
OPFS content-addressed store. A replacement worker verifies the exact input,
options, implementation, contract, schema, compressed-object digest, and
decoded payload before resuming at post-review or post-reconstruction. A mismatch cannot reuse
the value; the browser transfers the raw input and runs the ordinary Rust path.

The initial full ingestion verifies the 19,018,650-byte input with SHA-256.
Later comparisons reuse that verified identity and transfer only the selected
Rust cache value. This removes a second raw-file copy and hash from every Arm B
run. The remaining measured time is cache verification/decompression/decoding,
the actually affected Rust steps, and final review-state assembly. Further work
must profile those costs instead of adding another scheduler or cache model.

## Exact-duplicate browser batch baseline

The normal browser path now hashes selected files with bounded WebCrypto
concurrency, groups files only when their SHA-256 contents are identical, runs
one full Rust/WASM computation for each unique content digest, and gives each
selected filename its own result record. This is content reuse, not a
filename-based shortcut: files with different bytes still execute separately.

- Captured: 2026-07-26
- Build: production Vite bundle served by `vite preview`
- Fixture: the 100,004-row / 19,018,650-byte fixture above, selected under 100
  distinct browser filenames
- Configured worker cap: eight
- Command: `node scripts/verify-many-files.mjs <preview-url> 100 8 600000
  <fixture> compare 0 no-plots <trace.jsonl> repeat`

| Measurement | Result |
|---|---:|
| File selection through inspection readiness | 1.301 s |
| Process click through 100 rendered results | 4.915 s |
| First changed comparison through rendered bars | 0.827 s |
| Second nearby option change through rendered bars | 0.852 s |
| Full Rust/WASM kernel for the one unique input | 4.88 s |
| First changed-comparison Rust/WASM kernel | 0.62 s |
| Second-change Rust/WASM kernel | 0.35 s |
| Peak Chromium process-tree RSS | 1,492,959,232 bytes |
| Runtime WASM | 6,047,282 bytes (`sha256:679ece24d761bc782442978b60ca56173afce107f02975d9091a8683bdf36f4b`) |
| Worker JavaScript | 120,971 bytes |
| Errors / missing results | 0 / 0 |

The second request changes `minimumUsageDuration` from 2 to 3 and reports
`salsa-memory`, 17 recomputed product steps, and 27 cached steps. It is a warm
nearby edit, not an unchanged-request benchmark. The saved review and
reconstruction bases remain verified and
the output correspondence, source-coordinate, lineage, and workspace-root
artifacts are unchanged. A rejected experiment that retained OPFS base objects
in a JavaScript memory cache produced no repeatable latency improvement and was
removed.

Although the configured cap was eight, inspection proved that all 100 files
had the same SHA-256 content, so the batch created one processing worker. The
previous path created all eight even though seven could never receive work; it
also retired active workers after one file. Distinct files still use up to the
configured, memory-safe worker count and reuse those workers until the batch
ends.

This benchmark proves the important repeated-content case without claiming
that 100 distinct 100,000-row inputs cost the same. The independent eight-WASM
process measurements above remain the bound for 100 unique inputs.

## Current native 100,000-row full-output profile

The final native release harness runs the same registered-query product runtime and
consumes every artifact. Five Hyperfine runs after the allocation changes
measured 4.476 s ± 0.025 s (4.448–4.509 s). The published-output digest stayed
`sha256:022ac0c820511e341879178d6a4dcb45824e689bdd75cfe224fcecb303119f36`.

The run emits 46 artifacts totaling about 150.6 MB. The largest costs are the
31.5 MB exact result-cell correspondence, two 25.7 MB app CSVs, 17.0 MB
visualization data, 15.3 MB review base, 13.9 MB reconstruction base, 7.4 MB
row lineage, and 5.8 MB source-coordinate index. The final changes reuse CSV
record buffers, read cells as bytes, reuse the already parsed selected
timezone, and write timestamps directly into output buffers. They preserve all
cryptographic identities and remove allocations rather than weakening the
provenance model.

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
old fused worker-local warm path before the registered-query runtime cutover. These
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
computation and the registered labels were post-run projections. The current runtime
has removed that physical gate; fresh measurements must now prove the benefit
and cost of exact Salsa query reuse. The
[query-registry incremental Rust plan](../semantic-federation/incremental-runtime-plan.md)
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
  original six-query selection benchmark. All registered transformations are now
  callable; the replacement measurement must cover cold, unchanged, upstream,
  middle, downstream, qualification/binding, peak memory, and actual execution
  events. Snapshot export/restore was measured and removed because it was slower
  and much larger than cold recalculation.
- Repeated large-fixture peak RSS in Chromium rather than the Node WASM host.
- Cross-browser OPFS and performance measurements outside Chromium.
- Export/import streaming memory for large workspace closures.

Two gaps listed here previously are now measured in
[measured debt items 5 and 6](MEASURED_DEBT_ITEMS_5_AND_6.md): semantic-index
query profiling (the reconstruction is 92.4% of every registered query, is
independent of workspace size, and no product surface issues repeated queries,
so no index cache was added) and separate cost attribution for
CSV-to-Parquet/SPSS generation (the duplicate parse when both exports are
enabled was removed with byte-identical output; the remaining cost is the
writers themselves).
