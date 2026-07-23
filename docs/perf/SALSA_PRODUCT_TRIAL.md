# Salsa trial against the real preprocessing code

Captured: 2026-07-23.

This is a dependency trial, not a second Chronicle pipeline and not a claim
that the 55 transformations are incremental already. The trial lives in
`rust/chronicle_incremental_query_spike` so it cannot change the production
runtime identity while the engine decision is still open.

## What the trial actually calls

Six Salsa queries call existing product code:

- `discover_timezones_v2_native` for raw-data parsing;
- `evaluate_workspace_requirements_native` for qualification and missing
  support-file roles;
- the existing support-file loader;
- `run_pipeline_v2_with_supports` for the complete fused Rust computation;
- `plan_stage_view_native` for the typed 55-step view.

The inputs are separate raw bytes, raw display name, base options, selected
timezone, timezone behavior, concurrent-usage setting, filter-file setting,
study name, and filter-file presence/name/bytes. Each query reads only the
fields it uses. Salsa's `WillExecute` events are checked against a query-body
log, so a cached label cannot be confused with physical execution.

Salsa is pinned to `0.28.1`, has default features disabled, and uses only its
macro and persistence features. Ingredients are registered explicitly instead
of adding Salsa's inventory feature. The browser build uses no Rayon, WASM
threads, or network access.

## Correctness results

Native tests: 4 passed. Headless-Chrome WASM tests: 1 passed.

The controlled changes produced these physical query executions:

| Change | Query bodies that ran |
|---|---|
| First request | timezone discovery, selected-timezone check, qualification report, qualification readiness, fused pipeline, stage view |
| Identical request | none |
| Study name only | stage view only |
| Concurrent-usage setting only | fused pipeline only |
| Raw browser display name only | none |
| Enable a present filter support file | qualification report, qualification readiness, fused pipeline |
| Rename the same support bytes | qualification report only; its equal result stops propagation |
| Add a newline while retaining the same timezone set | timezone discovery reruns; its equal result prevents the selected-timezone check from rerunning |
| Require a missing filter support file | qualification reports the open `filter_file` role and the pipeline is not called |

The verified Salsa snapshot is bound to a supplied implementation/contract/
profile identity and a SHA-256 payload digest. An identical restored database
reused all six results without executing a body. Wrong identity and corrupted
payload tests both failed closed.

The browser test used Chrome `150.0.7871.130` with ChromeDriver
`150.0.7871.129`. `wasm-pack test` had selected an incompatible cached version
151 driver, so the successful test invoked `wasm-bindgen-test-runner` directly
through `make salsa-browser-test`'s explicit driver inputs. The test itself ran
in headless Chrome and completed in 0.12 seconds.

## Large-fixture measurement

Fixture: 60,624 data rows, 11,525,930 bytes,
`sha256:8bf14d199724ad7df3cb8822241b4d6355d20977e0c7eb0e92799f06dd2b8e60`.

Command:

```text
make salsa-benchmark
```

One representative release run measured:

| Case | Wall time | Query bodies | Result |
|---|---:|---:|---|
| Cold | 2,778.46 ms | 6 | Complete fused result |
| Identical | 0.0049 ms | 0 | Exact same digest |
| Study name only | 0.366 ms | 1 | Only the view digest changed |
| Concurrent-usage setting | 3,015.99 ms | 1 | Fused result changed |
| Raw display name | 0.0068 ms | 0 | Exact same digest |
| Raw bytes plus a trailing newline | 3,145.49 ms | 4 | Final result was equal |
| Enable present filter support | 3,075.01 ms | 3 | Final result was equal for this data |

The whole seven-case program had a Hyperfine median of 11.980 seconds over
three runs, with a range of 11.953–12.283 seconds. One `/usr/bin/time -l` run
reported 778,256,384 bytes maximum resident set size and 519,013,432 bytes peak
memory footprint.

The middle, raw-byte, and support cases are still slow because the complete
current pipeline is one `pipeline_probe` query. The equal final results in the
last two rows are especially important: Salsa cannot stop inside that query.
The speed and precise invalidation required by the product arrive only after
the existing 55 Rust transformations become separate typed queries.

## Optimized WASM size

`wasm-pack build --release --target web` with `wasm-opt` produced:

| Module | Raw | gzip -9 | Brotli 11 |
|---|---:|---:|---:|
| Current production runtime | 4,762,609 | 1,473,847 | 1,006,827 |
| Trial module, including real product calls and Salsa | 5,829,172 | 1,795,628 | 1,189,999 |
| Difference | 1,066,563 | 321,781 | 183,172 |

The raw difference is 17,987 bytes over the provisional 1 MiB limit; the
compressed differences are well below it. This is an upper-bound comparison,
not a clean Salsa-only delta, because the two modules export different public
entry points. The final decision uses an integrated production build and must
either meet the raw deploy budget or explicitly revise that budget with the
deploy artifact as evidence.

## Supply-chain result

`cargo audit` found no vulnerability. It repeated the existing allowed
`RUSTSEC-2024-0436` unmaintained warning from `parquet -> paste`; Salsa does not
introduce it. `cargo deny` passed advisories, licenses, bans, and sources using
the repository policy.

## Decision now

Salsa has passed the representative native/WASM, actual-read, event, early
cutoff, qualification-hole, and verified-snapshot tests. It has not yet passed
the complete product decision because these checks remain:

- all 55 callable transformations and exact invalidation sets;
- byte-for-byte fused-oracle equality for outputs, states, lineage, and
  correspondence data;
- persistence through the existing alternating OPFS roots, including crash
  injection;
- an apples-to-apples integrated WASM size and incremental-memory comparison.

Therefore Salsa remains the selected implementation candidate, while the fused
pipeline remains production authority and the bounded memo-table fallback
remains available.
