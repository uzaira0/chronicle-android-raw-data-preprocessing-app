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

The timing, memory, output-count, and output-digest figures below remain the
2026-07-23 capture. The current package-size figure is listed separately;
rebuilding that package does not remeasure this benchmark. Since 2026-10-03
the same command drives the app's `executeRustRuntime` (persisted workspace,
sequential engine, bundled app codebook on), so a rerun measures a different
configuration from this capture's direct `execute_workspace` call.

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
| Published-output digest | `sha256:c34427afd08fe31acdfa4a7509d6d87ce739b5171fed4c05e84a5e037ab54258` |

The matching pre-optimization fixture measured 10,956.8 ms inside
`execute_workspace` and 1,421,639,680 bytes maximum RSS. The captured optimized build was
about 24% faster on that direct execution measurement and used about 33%
less peak process memory. The output digest is unchanged.

All five Hyperfine measurements landed within 29 milliseconds. The median is
the tracked comparison value. This is a machine-specific regression baseline,
not a portable latency promise.

Historical working-tree package size, measured 2026-09-29 (retained build measurement,
not a size attributed to the July capture or updated by the current figure checker):

| Package | Historical bytes (2026-09-29) |
|---|---:|
| Runtime WASM | 24,962,404 bytes |

## Interactive View comparison baseline

**Historical (incremental engine).** Everything in this section was measured
with `executionEngine: "incremental"` and persisted review/reconstruction
bases. The app has sent only the sequential engine since 2026-09-29, which
persists no resume base, and the harness modes that produced these figures
(`--review-base`, `--review-bases-dir`, `--warm-runtime`) were removed on
2026-10-03. What the app runs today is measured in "Distinct-input View
comparison on the app path" below.

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

MEASURED (node, vite-node, 8 subprocesses). This is the honest persisted-base
cost for **100 byte-identical copies** of one file on eight warm WASM worker
processes, not for 100 distinct files, and not an unchanged-request shortcut.
`measure_review_batch.mjs` is structurally incapable of accepting distinct
inputs: it resolves a single `raw` path for every shard and throws unless all
shards produce exactly one review-summary digest. The min/median/p90/p95/max
above are the spread *across shards of a single run*; there is no run-to-run
noise band for this table. It measures the normal
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
that 100 distinct 100,000-row inputs cost the same. The eight-WASM process
measurements above are **also duplicate-content** and are therefore **not** a
bound for 100 unique inputs — that earlier sentence was an unproven
extrapolation and has been removed. The only harness in this repository that
can produce distinct-input evidence for a browser batch is
`measure_unique_review_batch.mjs`; it did not execute at the audit below and
runs again from 2026-10-03 (next section). (The native `profile_pipeline_v2`
example now takes `--seed` and gives distinct single-file inputs natively;
that is not batch evidence.)

The `4.915 s` "process click through 100 rendered results" figure is one kernel
execution plus 99 result-record renders. It must never be quoted as the cost of
processing 100 files. n=1, so no noise band exists and the three significant
figures are not defensible from a single browser run.

## Distinct-input View comparison on the app path (2026-10-03)

MEASURED (node, vite-node, 8 worker processes) over 16 distinct files. The
harness calls the app's own runtime functions instead of building requests:
per file, one child process runs `executeRustRuntime` (the Process tab, A
options, persisted workspace), then the View-tab comparison with the B options
exactly as `processPersistedOrRawChangedReview` drives it —
`queryPersistedRustReview` first, `queryRustReview` with the raw bytes on a
miss, offering the review-summary digests of earlier comparisons — with the
app's runtime toggles (`incrementalEngine: false`, so
`executionEngine: "sequential"`; `provenanceEvidence: false`), the support
files `resolveDefaultSupportFiles` resolves (bundled app codebook on), and the
payload-spill budget the pool gives each of 8 workers (512 MiB). A second,
independent child computes the B review cold from the raw bytes with no
persisted state; that is the oracle.

- Captured: 2026-10-03, Apple M3 Ultra, 32 logical CPUs, arm64 macOS, Node
  v26.5.0 (the `run-clean-env` node). The machine was shared: load average
  17-30 during the runs.
- Runtime WASM: the committed package, 15,560,638 bytes,
  `sha256:9db31ed02c46ba63fc1c7351de32dfbe5d0356d6877748fd3bb4404c27c595cd`
- Options: app defaults with `selectedTimezone: America/Chicago`, plus
  concurrent-usage modeling, screen-gated crediting and aggregates
  (`--full-options`). B changes one option: `minimumUsageDuration` 60 to 2, or
  `modelConcurrentUsage` true to false.
- Storage: Node has no OPFS, so the persisted workspace is the in-memory File
  System Access root from `web/src/testSupport/memoryFileSystem.ts` and the
  payload spill is a Map; storage I/O is memory-speed and every other cost is
  real.
- Commands (from `web/`):

```bash
for seed in $(seq 700001 700016); do
  npm run generate:benchmark-fixture -- --realistic --days 14 --rows-per-day 400 \
    --seed "$seed" --output <dir>/realistic-14d-400-seed-$seed.csv
done
npm run measure:unique-review-batch -- <dir> 8 middle_minimum_usage_duration
npm run measure:unique-review-batch -- <dir> 8 middle_concurrent_usage
```

Fixtures: 16 files, 5,046–5,789 rows (median 5,539; the real-export median is
5,752 rows over 14 days), 982,687–1,170,096 bytes, 16 distinct SHA-256 values
(the generator receipts list them; the harness re-hashes and refuses
duplicates). Each case ran twice; receipts:
`docs/perf/results/unique-review-batch-2026-10-03-{minimum-duration,concurrent-usage}-run{1,2}.json`.

Per file, n=16 per run; median with (minimum–maximum), in ms:

| Measurement | min-duration run 1 | min-duration run 2 | concurrent run 1 | concurrent run 2 |
|---|---:|---:|---:|---:|
| Comparison to B (what the user waits for) | 272.3 (246.1–486.9) | 268.4 (251.6–286.9) | 267.1 (259.7–328.0) | 267.9 (249.0–286.7) |
| — persisted-base probe (always a miss) | 4.5 (2.3–23.1) | 5.6 (2.3–12.7) | 4.9 (3.0–32.1) | 4.1 (2.2–13.3) |
| — raw review | 267.3 (243.7–473.6) | 262.9 (249.2–280.2) | 262.6 (255.5–295.9) | 262.1 (246.3–278.4) |
| — kernel phase | 215.7 (201.8–344.7) | 213.0 (204.8–223.7) | 217.0 (207.6–236.9) | 216.9 (205.7–228.9) |
| — scientific-preflight phase | 41.9 (38.0–46.4) | 42.3 (37.1–63.4) | 42.0 (37.4–51.8) | 41.4 (37.3–46.6) |
| Process run with A, persisted | 798.4 (781.8–1,573.2) | 664.2 (557.0–943.7) | 684.1 (567.9–936.3) | 622.7 (535.3–1,001.7) |
| Cold oracle B review, fresh process | 631.4 (581.7–999.3) | 435.7 (402.8–519.8) | 476.3 (413.6–560.6) | 442.4 (390.6–506.9) |
| Whole 16-file batch wall time | 8,359 | 6,443 | 6,766 | 6,170 |

Phase figures come from the runtime's own `traceRuntimePhase` timers. The
comparison runs in a process that has already run the file, as the app's
worker has; the cold-oracle row is the first execution in a new process. The
comparison median is stable across the four runs (267.1–272.3 ms); the Process
run and the tails are not, and the spread tracks the shared machine's load.

Proof, every run: 16/16 cold-oracle matches (comparison digest — which
commits to the options digest and the active support inputs — review-summary
digest, counts and runtime identity), 16 distinct review-summary digests, 48
manifests per run with the complete 67-query registry in contract order. Each
comparison reported 47 recomputed, 12 bypassed, 8 skipped, none cached, and no
cache source. The persisted probe missed 64 of 64 times and the Process runs
wrote 0 resume bases: the sequential engine persists none, so every app
comparison of a new option set is a full raw-input review. No summary was
reused (each input is compared once). Peak child RSS 646,397,952 bytes; peak
WASM linear memory 63,242,240 bytes.

Limitation: for `middle_concurrent_usage` the review summary does not depend
on the option on these fixtures — a warm A/B/A run over seed 700001 gave the
same review-summary digest (`sha256:72455c2e…`) for both arms — so for that
case only the comparison digest, which carries the options digest, shows the
two arms ran different options. The minimum-duration case changes the summary
itself (A `sha256:72455c2e…`, B `sha256:d95a8912…` on the same file).

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

MEASURED 2026-10-04 by `make profile-current` at commit
`ac6419a0e5dee1cd49d5a798a80b790880063f63` from a clean worktree, arm64
macOS 26.6.2, 32 logical CPUs, rustc 1.97.1, `--profile profiling` (release
plus debug info). The machine was shared with other heavy jobs: every
1-minute load average read during the run was between 17.9 and 26.1 (each
JSON line records the load before and after its own timed loop, and the
metadata file records it around every block; nothing samples it in between).
The commit after it, `c1e689bd`, changed only a comment in the example and
the metadata's seed-list formatting, so the recorded `profile_source_sha256`
and `in_process_seeds=1,2,3,4,5,` match `ac6419a0`, not later commits. This harness deliberately materializes full
outputs, so the upstream and middle figures include primary CSV assembly and
are not the review-only View-tab latency above.

Every timing and memory figure the profile produced carries one of three
labels, and they are never the same measurement. Figures taken outside the
profile are marked SEPARATE RUN or DERIVED and are not in the committed
records.

- **IN-PROCESS** — an `Instant` inside `profile_pipeline_v2` around exactly the
  scope named in each record's `timing_scope` field. Cold: a fresh
  `IncrementalPipelineV2Engine` plus `execute()` of the baseline request. A/B:
  only the `execute()` of the changed request on a fresh engine that has just
  executed the baseline. Neither includes process start, fixture construction,
  result digesting, freeing an earlier result (drained outside the timer) or
  the oracle.
- **PROCESS WALL** — Hyperfine over the whole process: start-up, building the
  60,624-row fixture, hashing it, one cold execute, the result digest, the
  sequential oracle run, and exit.
- **PROCESS PEAK RSS** — a resident-set high-water mark of the whole process
  (binary, fixture and everything allocated so far), never an execute-only
  peak.

Inputs: 60,624 synthetic rows per fixture, seeds 1-5, so five distinct inputs
(five distinct input SHA-256s and five distinct oracle result digests). The
seeds are different workloads, not only different bytes. SEPARATE RUN: after
the profile, `profile_pipeline_v2 --rows 60624 --seed S` (sequential mode, same
binary, load not recorded) reported `app_rows` 70,096 / 63,938 / 71,044 /
53,046 / 71,986 for seeds 1-5. Within one seed the min-to-max spread of the
five samples is at most 16% of the minimum for every case except "No change"
(sub-millisecond, up to 2.2x); between seeds it is up to 1.7x for cold, so
the per-seed columns are the figures to quote and the pooled columns describe
this five-seed mixture only.

Correctness: every timed iteration — 25 cold and 25 per A/B change, 200 in
all — produced the same result digest as `run_pipeline_v2_with_supports` (the
sequential scheduler) for its own request, and every process executed the same
query sets in each of its five iterations. Both schedulers call the same stage
functions, so this checks the incremental scheduling and reuse, not the
algorithms themselves.

Cold execute, IN-PROCESS, five iterations per process, one process per seed.
Iteration 1 is the first pipeline execution in its process; iterations 2-5
run in a process that has already executed one. The RSS column is the PROCESS
PEAK RSS high-water mark read right after iteration 1, before the digest and
the oracle.

| Seed | First iteration (ms) | Median of 5 (ms) | Range (ms) | Process RSS high-water after it (B) | 1-min load before–after |
|---:|---:|---:|---:|---:|---:|
| 1 | 895.2 | 857.8 | 823.0–895.2 | 531,316,736 | 21.8–21.7 |
| 2 | 1,021.3 | 1,012.7 | 959.8–1,021.3 | 612,564,992 | 21.7–21.2 |
| 3 | 905.3 | 888.7 | 855.0–905.3 | 535,527,424 | 21.2–21.5 |
| 4 | 621.3 | 608.8 | 590.7–621.3 | 398,360,576 | 21.5–21.5 |
| 5 | 871.1 | 867.4 | 838.5–874.2 | 542,998,528 | 21.5–21.1 |

IN-PROCESS, pooled over the five seeds: first iterations median 895.2 ms (621.3–1,021.3,
n=5); all 25 iterations median 867.4 ms, p90 1,012.7 ms; iterations 2-5 median
858.3 ms (n=20). Every cold execute ran 59 product queries and 9 internal
derived queries.

A/B changes, IN-PROCESS, median of five iterations per seed, each iteration on
a fresh engine. Pooled p90 is nearest-rank over the 25 samples.

| Change after the baseline execute | Product queries run (seeds 1-5) | Seed 1 | Seed 2 | Seed 3 | Seed 4 | Seed 5 | Pooled median (n=25) | Pooled p90 | 1-min load min–max |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| No change | 0 | 0.711 | 0.613 | 0.602 | 0.616 | 0.667 | 0.624 | 0.937 | 22.6–26.1 |
| Timezone policy | 4 | 318.8 | 429.3 | 326.4 | 183.5 | 327.5 | 325.0 | 429.3 | 20.2–22.6 |
| Concurrent-usage model | 33/33/33/4/33 | 1,568.8 | 410.1 | 391.5 | 204.5 | 393.5 | 398.7 | 1,568.8 | 20.2–23.1 |
| Day coverage | 1 | 77.6 | 99.2 | 77.0 | 57.7 | 77.4 | 77.4 | 99.2 | 20.3–22.3 |
| Output study name | 1 | 299.4 | 413.7 | 316.7 | 177.2 | 320.1 | 316.5 | 413.7 | 18.8–20.3 |
| Raw representation only | 3 | 392.1 | 500.1 | 406.3 | 268.3 | 416.9 | 406.3 | 500.1 | 17.9–20.0 |
| Add an absent app to the filter support | 2 | 19.9 | 19.5 | 24.4 | 24.7 | 25.5 | 23.9 | 25.8 | 20.0–21.8 |

All values in milliseconds. The concurrent-usage change is data-dependent: it
re-executes 4 product queries on seed 4 and 33 on the other seeds. Seed 1 runs
the same 33 queries as seeds 2, 3 and 5 at about four times their cost (cause
not investigated). That row's pooled median and p90 therefore mix different
regimes and should not be quoted as one figure.

PROCESS WALL, seed 1, Hyperfine 1 warm-up + 5 runs: median 1,825.7 ms, mean
1,942.0 ± 260.8 ms, range 1,782.6–2,397.3 ms (runs 1,782.7 / 2,397.3 /
1,921.7 / 1,782.6 / 1,825.7 ms); 1-minute load 21.15 before and 19.88 after.
DERIVED, not measured: the oracle inside these processes was never timed.
1,825.7 − 895.2 = 930.5 ms separates the process wall from seed 1's first
in-process cold execute; SEPARATE RUN: the sequential-mode run above timed one
sequential execute of the seed-1 fixture at 859.3 ms (`run_ms`, the stage run
without the checksum, first in its process), which suggests the oracle is most
of that gap.

PROCESS PEAK RSS 689,422,336 B maximum resident set size (`/usr/bin/time -l`)
for one whole seed-1 process, oracle included, at 1-minute load 19.88; the same
run reported 571,900,768 B peak memory footprint.
PROCESS PEAK RSS read by the example in that same run: 526,548,992 B right after the cold execute, before the digest and the oracle (10,190,848 B after building the fixture).

Raw records for every IN-PROCESS, PROCESS WALL and PROCESS PEAK RSS figure
above, committed under [`docs/perf/results`](results/):
`chronicle-incremental-runtime-native-cold.jsonl` and
`chronicle-incremental-runtime-native-cases.jsonl` (one JSON line per process:
every sample, the distribution, executed query lists, oracle digest, input
seed and SHA-256, load average), `chronicle-incremental-runtime-native-summary.json`
(the pooled figures above, produced by the script),
`chronicle-incremental-runtime-process-wall-hyperfine.json`,
`chronicle-incremental-runtime-native-memory.txt` and
`chronicle-incremental-runtime-native-memory-run.jsonl` (the `/usr/bin/time`
run and the example's own line from it),
`chronicle-incremental-runtime-profile-metadata.txt` (environment, source
digests, load average around every block) and the symbolized Samply capture
`chronicle-incremental-runtime-after-cold.json.gz` (with its `.syms.json`).
The Samply capture covers the whole seed-1 process, so the sequential oracle
appears as its own `run_pipeline_v2_with_supports` subtree beside the measured
`IncrementalPipelineV2Engine::execute`.

**No cold flamegraph exists for this commit.** `cargo flamegraph` was the
target's last step and failed on this machine: cargo-flamegraph 0.6.13 (in a
small dry run) and 0.6.14 (Homebrew upgrade, in the measured run) both record
through xctrace 27 (Xcode-beta, the only Xcode installed) and then stop with `unable to collapse generated profile data: Unpaired tag:
frame`, so `make profile-current` exited 2 after every figure, the Samply
capture and the Python profile have been written. The step has since been
removed from the target; the Samply capture (Flame Graph tab in
profiler.firefox.com) is the profile. Python `cProfile` measured
only the metadata checker (output in the gitignored `.perf-work/`, not
committed): 78.397 seconds total, 78.155 of them waiting for its two Rust
subprocesses; it is not part of preprocessing latency.

### Superseded: commit `af41c2f0a` (old harness)

Kept for the record; not comparable with the figures above. The old harness
ran one sample per process on the seedless fixture (byte-identical to today's
seed 0, not to seeds 1-5), and each A/B process first ran a cold execute and a
sequential oracle before its baseline. The A/B figures were IN-PROCESS changed
executes, each matched against a cold oracle:

| Change after a cold run | Median | Product queries run |
|---|---:|---:|
| No change | 0.161 ms | 0 |
| Timezone policy | 795.181 ms | 4 |
| Concurrent-usage model | 780.454 ms | 4 |
| Day coverage | 251.762 ms | 1 |
| Output study name | 699.193 ms | 1 |
| Raw representation only | 44.668 ms | 1 |
| Add an absent app to the filter support | 35.979 ms | 1 |

The "cold" figure published with it — 2,565.5 ms median, 2,553.6–2,578.6 ms
range, 9.1 ms standard deviation over five runs — is PROCESS WALL including
fixture construction, and the `cold_benchmark` run behind it checked no
oracle (the A/B processes did check their own cold run). Its 830,717,952 B is the whole-process PROCESS PEAK RSS. No load
average was recorded, and its raw captures were never committed (see the
corrections below).

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

The deploy build occupies 15,071,112 bytes on disk (2026-10-03 working-tree build;
480,690 of those bytes are `THIRD-PARTY-NOTICES.txt` and 83,539 are the CycloneDX
SBOM `sbom.cdx.json`, neither of which the app fetches or precaches; they are served
only when someone opens them).
MEASURED after `npm run build:app` and `scripts/generate-sbom.sh`, by a recursive byte sum over `dist`
(`find dist -type f -printf '%s\n' | awk '{s+=$1} END {print s}'` on GNU
coreutils; the earlier `stat -f %z` form is the BSD/macOS equivalent) — not
arithmetic over the table below, which lists only the largest payloads and does
not sum to the total.

The rows below track the current working-tree build and are checked directly
by `scripts/check_published_figures.py`. The preprocessing runtime row is the
shipped gzip transport; the decoded package row is not another shipped file.
`dist/runtime-wasm-transport.json` binds both sizes and SHA-256 identities.
These are size measurements, not fresh merged-source acceptance or a new
timing/RSS benchmark.

| Asset | Bytes |
|---|---:|
| preprocessing runtime WASM | 6,018,210 |
| decoded preprocessing runtime WASM | 15,622,895 |
| semantic index WASM | 2,907,468 |
| bundled app codebook | 2,147,719 |
| main JavaScript | 497,377 |
| graph JavaScript | 240,510 |

The historical 2026-08-27 deploy capture on the verification-sweep-endgame
branch occupied 14,820,029 bytes (approximately 14.13 MiB). Its JavaScript
measurements are retained separately and are not attributed to the current build:

| Historical JavaScript asset (2026-08-27 capture) | Bytes |
|---|---:|
| main JavaScript (historical) | 658,018 |
| graph JavaScript (historical) | 240,796 |

The repository deploy-artifact and bundle-budget checks remain authoritative;
these figures are evidence for this machine and measured build, not portable promises.

## First load, Lighthouse mobile (2026-10-03, this Mac)

MEASURED with Lighthouse 12.6.1 (`--only-categories=performance`, default mobile
form factor: 150 ms RTT, 1.6 Mbit/s, 4x CPU slowdown) in headless Chrome 154
against `vite preview` of a deploy `build:vite` (no test hooks), a fresh
profile per run, three runs per mode; the table gives the median. "Before" is
the build of 24ec7154; "after" is the fix/audit-app-robustness build that moved
the method-profile registries (the 958 KB Android runtime registry pack, about
10 MB once decoded, plus the literature-adapter, executor, provenance and
sleep-diary packs), the 809 KB method-profile catalogue, the Rust runtime bridge
and the result/review panels behind dynamic imports, and painted a static
skeleton from `index.html`. The entry chunk fell from 1,350,924 to 489,985
bytes and now awaits only the two small contract packs (17 KB and 7 KB) before
the first render.

| Metric | Simulated, before | Simulated, after | DevTools throttling, before | DevTools throttling, after |
|---|---:|---:|---:|---:|
| Performance score | 0.70 | 0.80 | 0.55 | 0.87 |
| First Contentful Paint | 2,705 ms | 1,656 ms | 15,761 ms | 1,346 ms |
| Largest Contentful Paint | 10,355 ms | 5,109 ms | 15,761 ms | 3,617 ms |
| Time to Interactive | 10,355 ms | 5,726 ms | 16,555 ms | 10,115 ms |
| Total Blocking Time | 68 ms | 69 ms | 77 ms | 163 ms |
| Speed Index | 2,705 ms | 1,656 ms | 15,670 ms | 3,444 ms |
| Cumulative Layout Shift | 0 | 0 | 0 | 0 |
| Bytes transferred in the trace | 1,766,751 | 6,731,252 | 1,766,067 | 6,709,466 |

The byte count rose because the app now renders early enough for its existing
runtime warm-up (the worker and its 6,001,265-byte preprocessing WASM, fetched
after the first render) to fall inside the trace; before, the first render came
at about 16 s under DevTools throttling and the warm-up started after the trace
ended (one of the three "before" simulated runs did capture it: 7,768,068
bytes). No byte the app fetches was added. The Largest Contentful Paint element
is the settings-management card's intro paragraph in both builds.

## Distinct-input benchmark audit

- Captured: 2026-08-06
- Machine: Apple M3 Ultra, 512 GiB RAM, arm64 macOS 26.2, 32 logical CPUs,
  Node 22.23.1
- Commit under measurement: `1d720eb`, in an isolated worktree
- Purpose: replace the four "floor" figures that circulated in session notes
  (warm A/B toggle 2.3-3.2 ms, batch cached per file 13.55-13.60 ms, restored +
  changed 118.5-123 ms, cold full execute 461.7-471.1 ms) with either a
  MEASURED row or an explicit statement that no measurement exists.

Every number below carries a MEASURED or PROJECTED label. No row in this
section is arithmetic over another row. Where a figure could not be produced,
the cell says so instead of carrying a projection.

### Floor status by section

| Section | Prior circulated figure | Now | Floor status |
|---|---|---|---|
| Warm A/B toggle (bases supplied, stable engine) | 2.3-3.2 ms (PROJECTED, unsourced) | **no measurement** | **UNKNOWN.** `benchmark_runtime_wasm.mts` aborts before emitting any receipt (see harness defects). Six warm invocations, six `EXIT=1`. Additionally the row's own label is unbuildable: `--review-base` derives a *fresh* workspace id per iteration, `--mode warm` keeps a stable one, so "bases supplied" and "stable engine" cannot co-occur in one run. Since 2026-10-03 warm mode is a real A/B toggle on the app path; the app supplies no bases (sequential engine), so this row's configuration no longer exists in the product. |
| Batch cached per file (8 workers, 100 distinct) | 13.9 ms then 13.55-13.60 ms (PROJECTED, unsourced) | **no measurement** | **UNDETERMINED.** `measure_unique_review_batch.mjs` — the repository's only distinct-input harness — exits 1 during workflow-registry parsing before dispatching any file. Neither figure can have come from it at this commit. Since 2026-10-03 the harness runs; the app no longer has a cached comparison path (sequential engine, no resume base), and its measured distinct-input comparison has a 267.1-272.3 ms median at ~5.5k rows ("Distinct-input View comparison on the app path"). |
| Restored + changed, fresh engine | 143 ms then 118.5-123 ms (PROJECTED, unsourced; browser/WASM at ~94k rows) | 14.540 ms MEASURED — **native, 24,269 rows, not comparable** | **NOT AT FLOOR — format-bound.** Decode is 70.7% of total; the recompute the option change forces is 10.0%. Decomposition below. The browser/WASM arm at ~94k rows was not measured; the 118.5-123 ms figure remains unsourced. |
| Cold full execute | 517.2 ms then 461.7-471.1 ms (PROJECTED, unsourced) | **REFUTED — withheld** | A 9-run distinct-input capture at 93,946 rows was produced (median 4266.2 ms, node/WASM), but its decomposition was refuted on verification: it attributed 11 credit/coverage/attribution queries to the full-materialization remainder when the receipts show those 11 are bypassed in *both* materializations and contribute zero. Per the evidence rule, the section is reported as refuted rather than published. |

The one publishable row is decomposed below and its components sum exactly to
its total. "At floor" is nowhere claimed in this section, because for three of
the four rows it is not checkable at this commit.

### Restored + changed, fresh engine — raw metrics

MEASURED with the checked-in native example
`rust/chronicle_chrono_kernel_wasm/examples/profile_pipeline_v2`, built
`--release --features incremental-v2,query-timing`, case
`cached_review_profile`, `--iterations 1`. That case is exactly this shape: a
cold engine exports review + reconstruction bases, both engines are dropped, a
fresh `IncrementalPipelineV2Engine::default()` calls
`execute_review_with_bases()` with `model_concurrent_usage` flipped, and the
digest is compared to a cold oracle from a third fresh engine.

**Scale caveat, stated first:** this is **native at 24,269 rows**, not browser
WASM at ~94k rows. It is not a replacement for, correction of, or comparison
against the circulated 118.5-123 ms. Do not place them in the same column.

| Fixture | run 1 (ms) | run 2 (ms) | run 3 (ms) | per-fixture spread | oracle matches | label |
|---|---:|---:|---:|---:|---:|---|
| f1 | 15.238 | 14.680 | 14.531 | 0.707 | 6/6 | MEASURED |
| f2 | 14.390 | 13.824 | 14.430 | 0.606 | 6/6 | MEASURED |
| f3 | 14.287 | 14.459 | 13.802 | 0.657 | 6/6 | MEASURED |
| f4 | 15.095 | 13.815 | 14.908 | 1.280 | 6/6 | MEASURED |
| f5 | 14.839 | 14.488 | 14.369 | 0.470 | 6/6 | MEASURED |
| f6 | 14.462 | 14.114 | 14.754 | 0.640 | 6/6 | MEASURED |
| f7 | 15.960 | 15.707 | 14.542 | 1.418 | 6/6 | MEASURED |
| f8 | 14.743 | 13.633 | 13.884 | 1.110 | 6/6 | MEASURED |
| run mean | 14.877 | 14.340 | 14.403 | — | — | MEASURED |

| Aggregate | Value | Label |
|---|---:|---|
| n | 24 (8 distinct fixtures x 3 runs) | MEASURED |
| minimum | 13.633 ms | MEASURED |
| maximum | 15.960 ms | MEASURED |
| mean | 14.540 ms | MEASURED |
| **noise band** | **+/-1.16 ms (+/-8.0% of mean)** | MEASURED |
| run-to-run mean spread | 0.537 ms (3.7%) | MEASURED |
| cold-oracle matches | **48 / 48, 0 mismatches** | MEASURED |
| review base / reconstruction base | 2,732,338 B / 3,454,116 B | MEASURED |
| base export (mean) | 87.857 ms | MEASURED |
| executed product queries / internal derived | 15 / 17 | MEASURED |

The largest per-fixture repeat spread (f7, 1.418 ms) marginally exceeds the
largest between-fixture difference in 3-run means (1.316 ms, f8 14.087 to f7
15.403). Per-fixture cost differences are therefore **not resolvable at this
n** — state that as a limit, not as a comfortable margin.

**Oracle mechanism** (checked-in, not added for this capture):
the `cached_review_profile` branch of `profile_incremental()` in
`profile_pipeline_v2.rs` (lines 398-421 at `1d720eb`) runs a third fresh engine's
`execute_review()` with the changed options and no bases, capture
`oracle_digest`, drop both engines, then compare `result_digest(&execution.result)`
inside the timed loop and return `Err` (nonzero exit) on mismatch. All 32
processes recorded a real captured `$?` of 0. Note that the `result_digest=`
field the binary *prints* is the oracle digest, not the restored run's.

**Iterations trap:** with `--iterations 3` the decoded review base is cached
across engines, `decode_review_base_payload` fires once per file while
`decoded_review_base` fires per iteration, and the per-iteration mean falls to
7.595 ms. Any "restored + changed" number taken with `iterations > 1` is
roughly 2x optimistic. All figures above use `iterations = 1`.

### Restored + changed — decomposed floor

MEASURED from the `query-timing` feature's per-label `Instant` spans (n=8, run
1 only; runs 2-3 discarded stderr, so **the components carry no noise band** —
only the totals do). Each residual is a parent-minus-children subtraction, so
the sum closes by construction; the honest content is that 12.316 ms of
14.877 ms is attributed to named instrumented spans and 2.561 ms is not.

| Component | ms | share | What it is | Label |
|---|---:|---:|---|---|
| blake3 verify | 1.334 | 9.0% | `decode_review_base_verify_digest` over the 2.73 MB review base (~2.05 GB/s) | MEASURED |
| LZ4 decompress | 1.074 | 7.2% | `decode_review_base_decompress` to `header.declared_bytes` | MEASURED |
| postcard decode | 7.995 | 53.7% | `decode_review_base_payload`, full `ReviewBase` materialization incl. row string pool | MEASURED |
| header/protocol checks | 0.114 | 0.8% | protocol version, suffix-digest arity, row-count | MEASURED |
| reconstruction-base restore | 0.059 | 0.4% | `assemble_result_manifest_restore_bases` minus `decoded_review_base` | MEASURED (by subtraction) |
| recompute | 1.484 | 10.0% | `assemble_result_manifest_app_steps`: rows-before-floor 0.554, reconstructed-rows 0.621, reconstruction-fused 0.772, annotations-fused 0.078, participant windows 0.051, person attribution 0.049, plus placeholder/sharing/window resolution | MEASURED |
| manifest sub-steps | 0.096 | 0.6% | early_state + screen_rows + outputs + finalize | MEASURED |
| manifest residual | 0.159 | 1.1% | `assemble_result_manifest` minus the above | MEASURED (by subtraction) |
| outside the manifest timer | 2.561 | 17.2% | **NOT INSTRUMENTED.** Fresh-engine construction, runtime-level base header verification, `build_and_serialize_review_summary` (no timer fires on this path), and the harness's own `result_digest()` which sits inside the timed loop | MEASURED (by subtraction), **undecomposed** |
| **Total** | **14.877** | 100% | equals the run-1 measured mean exactly | MEASURED |

Sum check: 1.334 + 1.074 + 7.995 + 0.114 + 0.059 + 1.484 + 0.096 + 0.159 +
2.561 = **14.877** = run-1 mean.

Floor reading, per component rather than for the row as a whole:

- verify (1.334 ms) and LZ4 decompress (1.074 ms) **are** at floor for this
  design — blake3 at ~2 GB/s single-thread, 2.73 MB decompressed in ~1 ms.
- postcard decode (7.995 ms) is **not** at floor and is the single largest cost
  in the row: 7.4x the decompress it consumes and 6.0x the verify. Nothing in
  the changed-option path needs most of `ReviewBase` eagerly.
- recompute (1.484 ms) is the only term that scales with the change and is
  already small. The engine spends ~7x longer rehydrating the base than doing
  the work the change requires.
- the 2.561 ms residual (17.2%) is unmeasured and cannot be claimed at floor.

Not resolved: the reconstruction base has no `decode_reconstruction_base_*`
label on this path, so its 0.059 ms is a subtraction and is implausibly small
for a 3.45 MB base — it is most likely decoded lazily or not at all for this
option change. Splitting the 2.561 ms residual and pricing
`build_and_serialize_review_summary` require new timers.

### Fixture provenance

Eight distinct-seed fixtures from
`web/scripts/generate_benchmark_fixture.mts -- --sessions 8000 --seed <S>`,
seeds `700000 + 13337*i` for i = 1..8. Generator-reported rows: 24,269 per
file. Bytes: 4,614,175 / 4,613,544 / 4,611,974 / 4,615,814 / 4,617,230 /
4,613,522 / 4,613,683 / 4,610,271, total 36,910,213.

| f | sha256 |
|---|---|
| f1 | `05841121def95bb971c17c3c1ab40dbfef70278d73fa76a9122f61ccd015c1a4` |
| f2 | `6a1876f64b8a2c2768d6cc44721dd627c627143f8cd9ed065e5e0c6b986a4747` |
| f3 | `d20503be29582da9a70453344a8ef8c4266a2043e2704c7fcc340cbcdaa26e0b` |
| f4 | `8eaa70da4a2a4dea0683d492ee38e6c329b77b14ec39c8af7da33239fa9ea820` |
| f5 | `ff5b704660cdb31b30aa167e937b2089a933d0732082a2d602da448552cc4d55` |
| f6 | `e389ae336d61b2339c302f5d56703a5a3539c6c8fb000597daf059e5adede0ff` |
| f7 | `71823d01ab7f9a96ffb2c21ed5738d85e933ccc87958deff76c0c89612d03f7c` |
| f8 | `9c1aeb6673395ea1ddf45b34de29e107dcfb2cadf13b94bf2cbaae657e985785` |

Distinctness was proven three independent ways: eight distinct
generator-reported digests, an on-disk re-hash yielding eight unique values,
and eight pairwise-distinct oracle result digests out of the kernel (which
byte-identical inputs cannot produce). Byte sizes also differ pairwise. In
`syntheticChronicleCorpus.ts` the seed feeds both `seededRandom()` and the
literal participant id `P-SYN-<seed hex>`, so every row differs between seeds.

Row-count methodology, so this is not later mis-flagged: the generator reports
24,269 logical CSV rows per file, but `wc -l` gives 24,270-24,275 and differs
per file, because the generator injects unicode and quoted labels containing
embedded newlines. **Verify row counts with a CSV parser, never with line
counting.** The same applies to the 93,946-row fixtures.

Scale: 24,269 rows is ~3.9x smaller than the ~94k-100k-row inputs the
circulated floor figures came from, and ~38x larger than the ~641-row fixtures
the operator flagged. Since the browser arm produced no timing, this choice
cost nothing.

### Harness defects found at this commit

These are the reason three of the four sections have no number. All are real
defects in committed code, each confirmed by reading the committed source at
`1d720eb`, not only by a failed run.

1. **`web/scripts/measure_unique_review_batch.mjs` does not run.** Line 28 is
   `const queryIds = workflow.queries.map((query) => query.id);` but
   `web/schema/chronicle-workflow.yaml` has no top-level `queries` key — its
   top-level keys are `workflow_model_version`, `workflow_phases`,
   `workflow_operations`, `workflow_artifacts`, `workflow_queries`, and entries
   carry `workflow_id` / `workflow_input_ids` / `workflow_operation_ids` /
   `workflow_output_ids`. There is no query-level `id`, `inputs`, or
   `requestFields`, so lines 24-52 cannot be repaired by a key rename;
   `requestFields` must be resolved by joining `workflow_operation_ids` into
   `workflow_operations`. `git log -1` on both the schema and the harness
   returns the same commit, `6dd5aaa` ("Replace fixed workflow steps with a
   semantic DAG contract (#96)") — the rename landed and the harness was not
   brought with it. `6dd5aaa` is an ancestor of `1d720eb`.
2. **`web/scripts/measure_review_batch.mjs` carries the identical stale reads**
   at lines 28, 32, 41, 42, 48. Both batch harnesses are dead at this commit.

   **Items 1-2 FIXED 2026-10-03.** Both harnesses now read the query registry
   (`id`, `inputs`, `requestFields`) from the runtime WASM's own
   `workflow_contract_json()` through `web/scripts/runtime_workflow_queries.mjs`,
   from the same package the benchmark helper runs, instead of the YAML
   projection.

   **Follow-on defects FIXED 2026-10-03** (the `salsa-memory` throw in
   `executePreparedReview`, both batch harnesses sending
   `executionEngine: "incremental"`, and `measure_unique_review_batch.mjs`
   expecting `verified-review-base` / `verified-reconstruction-base` cache
   sources that a raw-carrying request cannot reach).
   `benchmark_runtime_wasm.mts` no longer builds requests or calls the WASM
   exports itself: it calls the app's `executeRustRuntime`,
   `queryPersistedRustReview` and `queryRustReview` with the app's runtime
   toggles, so the request shape, the raw-less `persistedReviewOnly` probe, base
   selection (including `salsa-memory`) and the sequential engine are the
   app's. The review-base export/import modes and the base-kind and
   cache-source expectations were removed: the sequential engine writes no
   resume base, so the app's persisted probe misses and its raw review runs,
   which is what the harnesses now measure and report (`persistedReviewHits`,
   `persistedResumeBasesWritten`). The declared-affected-query closure over
   `WORKFLOW_QUERIES.inputs` was dropped as well (a re-derivation of graph
   reachability); the registry check is now completeness, order, and no
   `cached` status without a named cache source. Measured result: "Distinct-input
   View comparison on the app path" above.
3. **`web/scripts/benchmark_runtime_wasm.mts` line 568** dereferences
   `manifest.nodeExecutions.map(...)`. That field is emitted by nothing: it
   occurs exactly once in the whole repository (that line), appears in no Rust
   source, and its string is absent from the committed
   `chronicle_preprocessing_runtime_wasm_bg.wasm` — while the adjacent
   `queryExecutions` **is** present in that binary and is what
   `rust/chronicle_preprocessing_runtime_wasm/src/lib.rs:3834` emits. This is a
   script defect, not a stale WASM package; no `npm run build:wasm` fixes it.
   The throw happens *after* the timed run, so every measurement is discarded.
   `npm run benchmark:runtime-wasm` is broken at this commit.

   **FIXED** (the read became `queryExecutions` in `310acc1a`; since
   2026-10-03 the helper reads it from the manifest the app's own runtime
   functions decode).
4. **`benchmark_runtime_wasm.mts --mode warm` is not an A/B toggle.** Iteration
   0 runs baseline options and iterations 1..N-1 all run the *same* changed
   option set against one workspace, so iteration 1 is the only real
   option-change recompute and iterations 2+ are repeat executions of an
   already-memoized option set. Numbers from it must be labelled "repeat of an
   already-memoized option set", never "cost of a toggle".

   **FIXED 2026-10-03.** Warm mode now runs iteration 0 as a Process run with
   the A options and alternates B, A, B, … from iteration 1, so every timed
   iteration is a real toggle; each result carries its `arm`, and the receipt
   reports `toggleToB` and `toggleToA` separately.
5. **`--workspace-count` is duplicate-content amplification.** It appends
   `-001`, `-002`, ... to the same basename and derives distinct workspace ids
   over byte-identical `inputBytes`. `workspaceCount=100` is not 100 distinct
   files. (Since 2026-10-03 the helper goes through the app's
   `runtimeWorkspaceId`, which keys a workspace by content alone, so the
   renamed copies share one workspace, as duplicated files do in the app. The
   flag stays, labelled duplicate-content, for `measure_review_batch.mjs`.)
6. **`verify-many-files.mjs` distinctness is reported but never asserted.**
   `distinctContentCount` is computed and emitted but nothing throws when it is
   1, and in the no-fixture branch it is never set at all — the one mode that
   silently generates trivially small (733-byte, 6-data-row) distinct files
   reports no distinctness evidence. It needs the hard throw that
   `measure_unique_review_batch.mjs` line 270 already has.

   **FIXED 2026-10-03.** A fixture directory (the distinct-input mode) now
   throws unless every staged file has its own SHA-256, and the generated mode
   computes and asserts its distinct count too. A single fixture file stays
   duplicate-content by design and reports `distinctContentCount: 1`.
7. **Native `profile_pipeline_v2 --case cold_benchmark` returns before its
   oracle comparison** (at `1d720eb`: early return at line 375; the
   `run_pipeline_v2_with_supports` comparison is at 490-498), so the cold
   number `make profile-current` publishes carries no correctness check. The
   native fixture generator `synthetic_raw_csv()` is also seedless — same
   `--rows` always yields byte-identical CSV — so no native figure in this file
   is distinct-input evidence.
8. **`--iterations` is silently ignored** by `measure_incremental_case()` for
   all seven named A/B cases and for cold/cold_benchmark, so the native harness
   emits no in-process distribution and no noise band of its own.
9. **`scripts/profile_current_performance.sh` times the whole process**,
   including `synthetic_raw_csv(60624)` fixture construction. The
   `2,565.5 ms` cold median in the native section above is PROCESS WALL and
   its `830,717,952 B` is whole-process PROCESS PEAK RSS, not cold execute.

   **Items 7-9 FIXED 2026-10-04.** `cold` and `cold_benchmark` now compare
   every iteration's result digest with the sequential
   `run_pipeline_v2_with_supports` oracle after the timed loop and exit
   non-zero on a mismatch. `synthetic_raw_csv(rows, seed)` takes `--seed N`:
   seed 0, the default, reproduces the old seedless fixture byte for byte
   (checked by SHA-256 at 2,000 rows against a re-implementation of the old
   generator), and
   other seeds rotate app and interaction, shift the calendar and change the
   participant id, so they are distinct inputs; every record names its seed
   and input SHA-256. `--iterations` is honoured by cold, `cold_benchmark` and
   the seven A/B cases, each emitting one JSON line with every sample, the
   min/median/p90/max, the executed queries (which must not differ between
   iterations), the oracle digest, the load average and a `timing_scope`
   string. Deferred payload-store frees are drained outside the timer, so a
   timed execute no longer pays for freeing the previous iteration's result.
   `scripts/profile_current_performance.sh` now runs one process per seed for
   the in-process figures, keeps Hyperfine as PROCESS WALL and
   `/usr/bin/time` as whole-process PROCESS PEAK RSS, records the example's
   own RSS high-water mark right after the cold execute, logs the load
   average around every block, and writes a pooled summary. The
   "Clean-commit native full-output profile" section above now carries
   figures from this harness, each labelled IN-PROCESS, PROCESS WALL or
   PROCESS PEAK RSS, and moves the `af41c2f0a` figures under a "Superseded"
   heading with their true labels. Comparability caveat: none of the new
   figures is comparable with the `af41c2f0a` ones — the engine commit, the
   fixture (seeds 1-5 instead of seed 0), the executed query sets and the
   process shape all differ (the named A/B cases no longer run a cold execute
   and oracle before their baseline).

### Corrections to figures already in this file

- The claim in "Known profiling gaps" that raw captures for the native profile
  are in `docs/perf/results` is **false**. `docs/perf/results/` contains only
  `browser-peak-memory.json` and four `workspace-archive-memory-*.json`.
  `git log --all --diff-filter=A -- 'docs/perf/results/chronicle-incremental-*'`
  is empty: those captures were never committed on any branch and are not
  gitignored. The native section's stated raw backing does not exist.
  RESOLVED 2026-10-04 for the current native figures: the `ac6419a0` run's raw
  records, summary, metadata and Samply capture are committed under
  `docs/perf/results/chronicle-incremental-runtime-*`. The `af41c2f0a`
  captures remain lost, and no flamegraph exists (see the native section).
- The `24% faster` / `33% less peak process memory` comparison in the large
  runtime baseline is DERIVED FROM TWO SEPARATE CAPTURES of different builds
  with no stated noise band on the older arm, against a documented ~30 ms
  cross-run noise floor. Label it as such or re-capture both arms interleaved.
- The `549.1 ms` end-to-end figure is a 600-row fixture at n=1 — a **tripwire,
  not a scale baseline** — and its "reported JS heap delta 0 bytes" is below
  probe resolution, because `benchmark_browser_processing.mjs` does not launch
  Chromium with `--enable-precise-memory-info` the way the memory probes do.
- `SALSA_PRODUCT_TRIAL.md` is **not reproducible at this commit**: neither
  `salsa-benchmark` nor `salsa-browser-test` exists in the Makefile and the
  trial crate was removed. RESOLVED 2026-08-06: that document now carries a
  historical banner stating its numbers are frozen at 2026-07-23, and its
  4,762,609-byte runtime WASM row is explicitly marked as a different build
  from the live figure. The live figure is no longer copied by hand — the
  runtime WASM byte count in this document is registered in
  `scripts/check_published_figures.py` and re-read from the built package on
  every `make web`, which is what caught it sitting at 4,762,609 while the real
  file had grown past 6.7 MB.
- The `92.4%` reconstruction share in
  `semantic-index-and-export-performance.md` is measured **natively**; the
  "about 14.6 ms of a 15.8 ms panel refresh in WASM" sentence applies it to a
  WASM-measured total. That 14.6 ms is a PROJECTION across compilation targets
  and is currently unlabelled.


## Known profiling gaps

- The committed [Salsa product trial](SALSA_PRODUCT_TRIAL.md) preserves the
  original six-query selection benchmark. All registered transformations are now
  callable; the replacement measurement must cover cold, unchanged, upstream,
  middle, downstream, qualification/binding, peak memory, and actual execution
  events. Snapshot export/restore was measured and removed because it was slower
  and much larger than cold recalculation.
- Repeated large-fixture peak RSS in Chromium rather than the Node WASM host.
  A capture exists at `results/browser-peak-memory.json` but no document
  consumes it, so it does not yet close this gap.
- **Distinct-input batch cost at production scale.** See
  "Distinct-input benchmark audit" below: no committed browser batch number in
  this file is distinct-input evidence, and the harness that would produce it
  is broken at this commit. The native single-file figures in "Clean-commit
  native full-output profile" do span five distinct seeds, but they measure
  one file per process natively, not a browser batch.
- Cross-browser OPFS and performance measurements outside Chromium.
- Export/import streaming memory for large workspace closures.

Two gaps listed here previously are now measured in
[measured debt items 5 and 6](semantic-index-and-export-performance.md): semantic-index
query profiling (the reconstruction is 92.4% of every registered query, is
independent of workspace size, and no product surface issues repeated queries,
so no index cache was added) and separate cost attribution for
CSV-to-Parquet/SPSS generation (the duplicate parse when both exports are
enabled was removed with byte-identical output; the remaining cost is the
writers themselves).

## Per-option warm change cost (2026-08-28, RHEL 9 host)

Full sweep of all 72 computational contract keys, one change at a time from the
warm default base, on a regenerated 100,004-row / 19,018,650-byte fixture
(`npm run generate:benchmark-fixture -- --sessions 33000` reproduces exactly
that row/byte count with the default seed). Evidence and driver:
`docs/perf/option-change-sweep/`. Headlines: cold 9.2 s; warm no-change floor
5.6 s (envelope, dominated by output serialization — 0.9 s with app usage off);
most single-option changes land at floor + 0.5–2.5 s; outliers are
`polledEmulationMethod` first activation (22 s) and the interaction-type
surface (40–50 of 55 queries recomputed, 8–9 s). Both non-default
`screenSessionConstructionStrategy` arms refuse the warm path
(`scientific_preflight_retry_required` — the strategy moves the B05 preflight
identity) and fall back to a full raw re-run.

Caveat on the warm figures earlier in this file: `benchmark_runtime_wasm.mts`
warm mode predates the scientific-preflight boundary and no longer runs
against the current runtime with screen usage on (the default) — it never
calls `scientific_preflight_json`, which `execute_workspace` now requires.
The sweep driver includes that call (~90–140 ms warm, ~1 s cold).
FIXED 2026-10-03: the helper now runs through the app's runtime functions,
which call `preflightScientificInputs` themselves (it shows up as the
`scientific-preflight` phase in its receipts).

## Large-export memory peak (2026-09-14, RHEL 9 host)

Live-heap high-water mark of one native `ExecuteWorkspace` over the 580,793-row
synthetic export (`generate:benchmark-fixture --sessions 191707 --seed 4242`,
110,463,056 bytes), measured by the counting allocator in
`examples/profile_execute_workspace_native.rs` (`CHRONICLE_HEAP_BACKTRACE=1`
records the call stack at every 64 MiB of new growth). Wall time on this host
is 30–35 s; the peak is what decides whether a file fits a wasm32 worker.

| Phase | Before | After |
|-------|-------:|------:|
| live after scientific preflight | 1,041 MiB | 1,041 MiB |
| peak during execute | 6,333 MiB | 5,134 MiB |
| live after execute (artifacts still in the handle) | 4,202 MiB | 4,203 MiB |
| live after every artifact is taken and the handle dropped | 3,431 MiB | 3,432 MiB |
| peak per raw row | 11.2 KiB | 9.1 KiB |

Where the two removed transients came from, in growth order:

1. `compute_pipeline_result_digest_with_scientific` canonicalized the whole
   provenance record with `serde_jcs`, which buffers every object member's full
   JSON text before sorting names. The row lineage member alone was ~900 MiB of
   text. `write_canonical_object` now streams the members and the lineage
   array entry by entry into the hasher; a unit test pins the bytes to the
   derived `serde_jcs` form, and the result digest of this run is unchanged.
2. `source_result_influence_witness_arrow` owned five strings per record for
   2.8 million records, grew that vector from empty by doubling (so the last
   doubling briefly held the previous copy beside the new one), sorted it
   with a stable sort whose merge buffer is half the vector again, grew
   thirteen Arrow key vectors by doubling beside it, and kept the whole vector
   alive through the LZ4 IPC encoder. Records now borrow from the inputs, one
   reserve covers every row that follows it, the sort orders an index vector,
   the builders are pre-sized, and the vector is dropped before encoding. The
   artifact bytes are unchanged.

What remains after the fix, in order of size: the retained incremental state
(3.4 GiB after every artifact has left the handle, about 6 KiB per raw row,
held by the memoized stage outputs the warm-reuse path depends on), the
artifacts still inside the handle (0.8 GiB), and the influence-witness build
(about 0.9 GiB above the post-execute live set, which is where the 5,134 MiB
peak now sits). These are native 64-bit figures; wasm32 pointers are half the
width, so the browser's per-row cost is lower. Treated as a conservative
proxy against the 4 GiB a wasm32 worker can address, this fixture was
expected to exhaust the worker, and the upload inspection warned above a
provisional `BROWSER_ENGINE_ROW_CEILING` of 380,000 rows. The budgeted
payload store below removed most of the retained per-row state, and the
browser run of this fixture (measured in the next subsection) completes on
both engines at 2.0 GiB; the ceiling is now 950,000 rows, derived from that
measurement.

### Budgeted payload residency (2026-09-14, node-z, Ubuntu 24.04)

The retained per-row state is now budgeted. Every memoized row table, the row
lineage, the matcher input and output, the review-base wrappers' rows, the
pipeline's output bytes (64 KiB chunks) and every runtime-built artifact
(arrow sidecars, receipts, review bases) are `PayloadHandle`s in one per-worker
store (`payload_store.rs`). Salsa memos keep only the handle; a lease pins a
value while a stage reads it, and the store evicts unpinned values past the
budget through a clock walk, serializing each once (postcard for rows and,
through a stored mirror, for the lineage; raw bytes for chunks) to a spill
backend: a temp directory natively, OPFS sync-access-handle regions in the
worker (`web/src/workers/payloadSpill.ts`, 512 MiB budget), memory when neither
is available (budget 0 = unlimited, the pre-existing behaviour). Same fixture
and profiler as above (`CHRONICLE_PAYLOAD_BUDGET_MIB` selects the budget);
the result digest and every artifact byte are identical across all rows of
the table (the exported artifact sets of the two budgets compare equal file
by file).

| Phase | unlimited | 512 MiB budget |
|-------|----------:|---------------:|
| live after scientific preflight | 915 MiB | 643 MiB |
| peak during execute | 4,699 MiB | 1,607 MiB |
| live after execute (artifacts still in the handle) | 4,134 MiB | 605 MiB |
| live after every artifact is taken and the handle dropped | 3,314 MiB | 298 MiB |
| store-resident bytes after the handle is dropped | 6.1 GB | 0 |
| execute wall time (node-z) | 78 s | 196 s |
| spills / reloads | 0 / 0 | 31,545 / 24,898 |
| peak per raw row | 8.3 KiB | 2.8 KiB |

The app's default engine since 2026-09-17 is the sequential scheduler
(`executionEngine: "sequential"`; since 2026-09-29 the app has no toggle for
the incremental engine): one pass over the registry from the raw file, no
memo, no resume base. Same fixture, same profiler (`--sequential-engine`), same
result digest; the incremental engine above is reachable only from tests and
benchmarks.

| Phase | sequential engine, 512 MiB store budget |
|-------|----------------------------------------:|
| peak during the scientific preflight (its own request) | 739 MiB |
| live after scientific preflight | 112 MiB |
| peak during execute | 1,123 MiB |
| live after execute (artifacts still in the handle) | 139 MiB |
| live after every artifact is taken and the handle dropped | 2.5 MiB |
| store-resident bytes after the handle is dropped | 0 |
| execute wall time (node-z) | 87 s |
| spills / reloads | 6,653 / 6,652 |
| peak per raw row | 2.0 KiB |

The sequential run finishes in the unlimited-budget time below the budgeted
incremental engine's peak: the intermediate row tables live once, unmemoized,
and each is dropped at its last reader instead of at the end of the pass. The
first sequential measurement of this table (2026-09-17) peaked at 2,407 MiB
and a second the same day at 1,346; the difference is what the pass no longer
holds at its peak: the tracked engine's preflight memos (the decoded raw rows
and their spill copy), the raw decode after the B05 screen construction, the
raw B05 events after the app algorithm, the source-row table after
`index_raw_dates` (the visualization takes a precomputed per-participant
timestamp map), the lineage vector's doubling slack (one exact-size
reservation), the influence witness's seventeen row-sized column builders
(written per 131,072-row batch with the dictionaries seeded from the previous
batch), and the growth slack of the CSV and visualization buffers. Chunking
those output buffers into the payload store was measured and rejected: 16,530
spills and 10,499 reloads, peak up to 1,498 MiB, because the assemble
checkpoint and artifact materialization reload every chunk.

The table above is the fourth measurement (2026-09-18, at the fresh
dependency certificate; the dhat high-water mark is the same 1,123 MiB).
Nothing of a sequential request touches the tracked engine any more: the
scientific preflight runs on the sequential path
(`sequential_scientific_preflight`, the same screen construction and Schoedel
reconstruction, memoizing nothing), so that request peaks at 739 MiB instead
of 1,053 and leaves 112 MiB live instead of 328. The raw bytes, which the
pass never reads after the decode, are parked in the payload store from the
end of the decode until the source-coordinate index leases them, and are
released with the store evicted before the influence witness; the lineage
row's seven optional screen-interval and Schoedel members are one box, so the
two million rows that carry none of them hold a pointer instead of 124 bytes.
The third measurement (1,313 MiB) peaked in the influence witness: 344 MiB of
128-byte records, a 182 MiB `target_id` dictionary builder, a 148 MiB output
cursor, and 400 MiB of reloaded output payloads resident in the store. The
witness record is now 88 bytes (four-byte optionals, search evidence by
index), and the witness, result-cell, row-lineage and source-coordinate
Arrow files are written through the store's chunked writer and digested
chunk by chunk, so no file-sized cursor stands beside its builders; the app
and credited CSVs and the visualization JSON are sized by a counting pass
instead of an estimate. The spill counts in the table are those 64 KiB
chunks leaving and re-entering the store once each. The high-water mark is
now inside the pass, at the credited-usage CSV write: 551 MiB of row cells
(the canonical source rows, and the session rows the app
algorithm's edits copy out of them through `Arc::make_mut`, since the
canonical table stays alive for the credit, contact, placeholder and
date-index readers), the 140 MiB credited CSV
buffer, about 110 MiB of lineage search evidence and 36 MiB of lineage rows,
and 38 MiB of screen-event suffix digests. The 2.5 MiB after the handle drop
is the profiler having handed its only copy of the file to the run; the
incremental row above still shares that copy with the tracked input. Capping
the store budget for sequential runs was measured and rejected (64 MiB: the
pass peak did not move, the spill encoder copies each 147 MiB output, peak
up 1,176 to 1,272 MiB on a working-tree build, spills 48 to 11,983). The row
tables and the lineage are not budgeted by the payload store, so the
sequential peak still scales with the file; that is the ceiling the toggle
exists for.

Measured 2026-09-15 at the fresh dependency certificate. The first budgeted
measurement of this table (2026-09-14) peaked at 2,546 MiB with 1,358 MiB
live after execute and 893 MiB after the artifacts; the second round of
fixes below says where that went.

Three retention bugs the per-call-site residency report
(`PayloadStore::stats_by_type`, printed by the profiler after a forced
eviction pass) exposed on the way, each of which kept whole row tables
resident regardless of budget:

1. The review memos (`ReviewUsageRowsBeforeFloor`, `ReviewStaticAnnotations`,
   `ReviewReconstructedRows`, `ReviewReconstruction`, `ReviewAnnotations`,
   `ReviewAnnotationCheckpointBase`) and the windowed/attributed row wrappers
   held `Arc<Vec<Row>>` directly, so a memo pinned each table for the life of
   the engine; three of them were also published a second time as wrappers
   and spilled uselessly (~200 MiB of postcard each). They hold handles now.
2. The runtime kept every built artifact as owned bytes until the browser
   took it (~600 MB of the 945 MB artifact set). `RuntimeArtifact` bytes are
   `PayloadBytes`; `take_artifact_bytes` moves a single unshared chunk out
   without a copy.
3. A reloaded entry kept its original allocation address in the dedupe
   index, so republishing the reloaded Arc (the timezone stage passes the
   sorted rows through unchanged) created a second entry for the same
   allocation and the two pinned each other forever: two 292 MiB tables on
   this fixture. The index follows the reload; a store unit test pins it.

A second round (2026-09-15) started from a dhat allocation profile taken at
the 2,546 MiB peak, which the store's own accounting could not explain:
1,066 MiB of reloaded row tables were live at once inside a "512 MiB"
store, 253 MiB of edited rows sat in memos outside it, and the JSON text of
the lineage table was the tallest single allocation. Four causes, each
measured on the way down (peak 2,546 → 2,448 → 2,397 → 2,036 → 1,693 →
1,662 MiB at the stale certificate, 1,607 MiB at the fresh one):

1. The charge is producer-supplied and the store keeps unpinned entries
   resident until the charged total crosses the budget, so an undercharged
   table is a table the budget does not see. A row table was charged at
   `capacity × size_of::<Row>()`, about 55 % of what it owns (the `RowInner`
   behind each row plus the source-range and search-evidence components
   behind that). `row_table_bytes` charges full ownership now. A fair-share
   variant that divided each row by its Arc strong count was measured too:
   340 MiB higher peak at the same reload count.
2. `CreditPartition`, `CreditEmissionStep` and `CreditResult` carry row
   tables inside a record and were memoized outside the store, pinning the
   edited credited rows for the life of the engine. They are published
   charged by the tables inside them.
3. The lineage table was JSON-coded because postcard cannot decode the
   `skip_serializing_if` fields of `PipelineRowLineage`; a stored mirror
   (`StoredRowLineageRef` / `StoredRowLineage`) carries every field, the
   decode builds the final rows directly at the encoded length, and the JSON
   wire shape of the lineage is untouched (unit test).
4. The raw CSV was copied three times (request, Salsa input, runtime);
   `RawCsvBytes` shares one allocation, and the request adopts the tracked
   input's copy after execute. The lineage payload is detached from the
   result while the review and reconstruction bases are exported, the base
   builders lease one row table at a time, and the base encoders drop the
   uncompressed bytes before the LZ4 block is written.

What remains at the 512 MiB budget is the working set of one stage: the
row tables it leases (the store charges leases past the budget rather than
failing) plus the decode transient of each reload (the per-table
`RowInner` interner and the rows themselves). The heap-growth ladder at the
1,607 MiB peak is entirely row decoding inside `PayloadStore::lease` (the
reload of a spilled entry). The budgeted run is slower because a stage's
working set exceeds the budget and its inputs reload from the spill; the
reload count is the lever if that matters.

The same fixture in the shipped production build, driven by
`web/scripts/measure_browser_peak_memory.mjs` (node-z, Playwright 1.59.1,
persistent profiles, OPFS spill at the worker's payload budget;
`wasmMemoryBytes` is the worker's `WebAssembly.Memory.buffer.byteLength` when
the file finished, the run's high-water mark since linear memory never
shrinks):

| Engine | worker budget | outcome | WASM memory high-water mark | wall time | rows in / out |
|--------|--------------:|---------|----------------------------:|----------:|--------------:|
| Chromium 147, sequential engine (app default, toggle off), 2026-09-18 after the witness round (4169c9f17) | 512 MiB | complete | 1,729,101,824 bytes (1,649 MiB) | 85 s | 580,793 / 559,488 |
| Firefox 155 (stock), sequential engine (app default, toggle off), 2026-09-18 after the witness round | 512 MiB | complete | 1,729,101,824 bytes (1,649 MiB) | 100 s | 580,793 / 559,488 |
| Chromium 147, incremental engine (toggle on), 2026-09-18 after the witness round | 512 MiB | complete | 1,906,442,240 bytes (1,818 MiB) | 171 s | 580,793 / 559,488 |
| Firefox 155 (stock), incremental engine (toggle on), 2026-09-18 after the witness round | 512 MiB | complete | 1,741,291,520 bytes (1,661 MiB) | 196 s | 580,793 / 559,488 |
| Chromium 147, sequential engine (app default, toggle off), 2026-09-17 evening (leaner pass; the morning build peaked at 2,547,908,608 bytes / 2,430 MiB in 99 s) | 512 MiB | complete | 2,213,543,936 bytes (2,111 MiB) | 96 s | 580,793 / 559,488 |
| Firefox 155 (stock), sequential engine (app default, toggle off), 2026-09-17 evening (morning build: 2,547,908,608 bytes / 2,430 MiB in 115 s) | 512 MiB | complete | 2,146,369,536 bytes (2,047 MiB) | 110 s | 580,793 / 559,488 |
| Chromium 147, incremental engine (toggle on), 2026-09-17 evening (morning build: 2,100,887,552 bytes / 2,004 MiB) | 512 MiB | complete | 1,961,099,264 bytes (1,870 MiB) | 171 s | 580,793 / 559,488 |
| Firefox 155 (stock), incremental engine (toggle on), 2026-09-17 evening (morning build: 2,092,892,160 bytes / 1,996 MiB) | 512 MiB | complete | 2,139,291,648 bytes (2,040 MiB) | 196 s | 580,793 / 559,488 |
| Chromium 147 (Playwright headless) | 512 MiB | complete | 2,097,741,824 bytes (2,001 MiB) | 170 s | 580,793 / 559,488 |
| Firefox 155 (stock Mozilla build, BiDi, fresh context) | 512 MiB | complete | 2,097,741,824 bytes (2,001 MiB) | 196 s | 580,793 / 559,488 |
| Chromium 147, same kernel | 1 GiB | complete | 2,553,741,312 bytes (2,435 MiB) | 130 s | 580,793 / 559,488 |
| Firefox 155, same kernel | 1 GiB | complete | 2,553,741,312 bytes (2,435 MiB) | 150 s | 580,793 / 559,488 |
| Chromium 147, 2026-09-14 kernel | 1 GiB | complete | 2,665,611,264 bytes (2,542 MiB) | 122 s / 209 s (two runs) | 580,793 / 559,488 |
| Firefox 155, 2026-09-14 kernel | 1 GiB | complete | 2,665,611,264 bytes (2,542 MiB) | 151 s | 580,793 / 559,488 |
| Firefox 148 (Playwright's own build), 2026-09-14 kernel | 1 GiB | complete | 2,665,611,264 bytes (2,542 MiB) | 702 s / 706 s | 580,793 / 559,488 |

The worker's high-water mark follows its budget the way the native peak does
(native: 2,185 MiB at 1 GiB, 1,607 MiB at 512 MiB, 1,485 MiB at 256 MiB,
for 159 / 196 / 238 s of execute), and the OPFS spill traffic is cheap
(the 512 MiB run wrote 2.5 GB and read 3.2 GB through the sync-access
handle in 2.4 s on Chromium and 4.7 s on Firefox), so the shipped worker
budget is 512 MiB. The browser's high-water mark sits about 0.4 GiB above
the native peak at the same budget; the linear memory never shrinks and the
wasm32 allocator's fragmentation is not measured here, so that gap is
recorded, not attributed. 2,097,741,824 / 580,793 is about 3.6 KB per raw
row; `BROWSER_ENGINE_ROW_CEILING` is 950,000 rows (about 3.3 GiB at that
rate, inside the 4 GiB a wasm32 worker can address).

The Playwright Firefox row is not a Firefox figure. Its worker reported
(`ProcessedFileResult.workerPayloadSpill`) 4,519 spills / 4,509 reloads,
2,296 MiB written and 1,059 MiB read through the OPFS sync-access handle in
1.6 s + 1.0 s, so the spill path is under 3 s of the 706 s; a 199,980-row
prefix that spills six times (169 MiB) still took 191 s there against 32 s on
Chromium and 37 s on stock Firefox 155. A hot i64 loop
(`WebAssembly` module, 2e9 iterations) takes 13.4 s in Playwright's Firefox
build whether Playwright drives it or it runs standalone headless, 1.2 s in
Chromium, 0.6 s in a stock Firefox ESR 140 and 1.6 s in stock Firefox 155;
JavaScript loops are equal across the engines, and with
`javascript.options.wasm_baselinejit=false` Playwright's build answers "no
WebAssembly compiler available" even for the 2.7 MB semantic-index module.
That build runs WASM on the baseline compiler only. Engine comparisons use a
stock Firefox through `MEASURE_FIREFOX_CHANNEL=moz-firefox` (harness option),
and every Firefox WASM timing taken on the Playwright build before this note
is a test-build artifact.
