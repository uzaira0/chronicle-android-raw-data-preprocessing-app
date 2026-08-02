# Measured performance: recorded debt items 5 and 6

Two entries under "Remaining production blockers or bounded debt" in
`docs/semantic-federation/final-review-matrix.md` are recorded as *measurable
optimization targets, not correctness defects*:

> 5. The semantic index is reconstructed for each query; a root-digest keyed
>    cache should be added if repeated interactive queries become material.
> 6. Parquet and SPSS export paths independently parse CSV output, and
>    visualization payloads are eagerly materialized. These are measurable
>    optimization targets, not correctness defects at the current fixture size.

This file records the measurements and the decision each one produced. Two of
the three findings are negative results: the harness and the numbers are
committed, and no product code changed. The third — the duplicate CSV parse
when Parquet and SPSS are both enabled — was material and was removed, with
byte-identical output proven.

## How to reproduce

Machine for every number below: Apple M3 Ultra, arm64 macOS 26.2,
Node v22.23.1, rustc 1.97.1. The box was not idle — several other agent lanes
were building and testing throughout — so absolute times are generous and
run-to-run comparison of two separate processes carries a noise floor worth
about 30 ms at the 60k fixture. Every conclusion below therefore rests either
on a within-process A/B (the native harnesses measure both arms in one run) or
on a ratio, never on a bare millisecond count from one run against another.

Two fixtures, both used by every measurement:

| Fixture | Raw rows | Input bytes | Provenance |
|---|---:|---:|---|
| `contract-600` | 600 | 58,610 | Generated in-process; byte-for-byte the runtime crate's `representative_600_event_csv()` |
| `synthetic-60k` | 60,015 | 11,423,944 | `npm run generate:benchmark-fixture -- --sessions 19800 --seed 424242`, `sha256:1664037e6e053b5798d6108c8f444aa212798b31ab10fc985bb34eb56adb7cda` |

Product-level costs (the shipped WASM, driven from Node):

```bash
cd web
npm run measure:perf-debt -- --label contract-600 \
  --execute-iterations 15 --query-iterations 40 --rebuild-iterations 20 \
  --dump-semantic-source ../.tmp-perf-lane/semantic-source.json
npm run measure:perf-debt -- --raw <60k fixture> --label synthetic-60k \
  --execute-iterations 25
```

`web/scripts/measure_perf_debt.mts` interleaves its `execute_workspace`
configurations round-robin. Sampling one configuration to exhaustion charged
whole V8 GC pauses to whichever configuration was unlucky (24 ms runs next to
240 ms runs for the same options); the reported minimum and p25 are the
GC-free cost.

Function-level splits (native release, so the private functions can be timed
separately). Both are `#[ignore]`d and never run in `cargo test`:

```bash
CHRONICLE_SEMANTIC_INDEX_SOURCE=.tmp-perf-lane/semantic-source.json \
  cargo test --release --manifest-path rust/chronicle_semantic_index_wasm/Cargo.toml \
  perf_measurement -- --ignored --nocapture

CHRONICLE_PERF_RAW_CSV=<60k fixture> \
  cargo test --release --manifest-path rust/chronicle_preprocessing_runtime_wasm/Cargo.toml \
  binary_exports::perf_measurement -- --ignored --nocapture
```

Harness locations:

- `web/scripts/measure_perf_debt.mts` (npm script `measure:perf-debt`)
- `rust/chronicle_semantic_index_wasm/src/perf_measurement.rs`
- `rust/chronicle_preprocessing_runtime_wasm/src/binary_exports/perf_measurement.rs`

## Debt item 5 — semantic index reconstruction per query

### What actually happens

`chronicle_semantic_index_wasm::query()` calls `store_from_nquads()` on every
call, so each registered query parses the whole derived N-Quads index into a
fresh Oxigraph `Store` before evaluating any SPARQL. The *index bytes* are
already cached: `getSemanticIndex()` in `web/src/workers/chronicle-worker.ts`
keeps them in a bounded per-workspace map keyed on the workspace root digest
and drops the entry when the head digest moves. What is rebuilt per query is
the Oxigraph store, inside the WASM module.

### Numbers

The index is **not** a function of workspace size. It describes the 55-step
execution, qualification, obligation and reason structure, which is fixed per
workspace:

| Fixture | Raw rows | `semantic-index-source-json` | Derived N-Quads index |
|---|---:|---:|---:|
| `contract-600` | 600 | 115,359 B | 221,057 B |
| `synthetic-60k` | 60,015 | 115,362 B | 221,057 B |

Product cost in the shipped WASM (minimum / median ms):

| Measurement | `contract-600` | `synthetic-60k` |
|---|---:|---:|
| `rebuild_semantic_index` (source JSON to N-Quads) | 3.61 / 3.89 | 3.96 / 4.14 |
| One registered query, slowest of the seven (`actual-executions`) | 2.34 / 2.58 | 2.49 / 2.64 |
| One registered query, fastest (`has-open-obligations`) | 2.04 / 2.17 | 2.09 / 2.14 |
| All seven registered queries once (a full panel refresh) | 15.76 / 16.30 | 15.64 / 16.26 |

Native split of one query into reconstruction and evaluation
(`store_reconstruction_share_of_each_registered_query`, minimum ms). Both
columns run the product's own code — `query()` and `query_on_store()` — so the
evaluation column includes solution materialization and JSON building.
(Oxigraph's `execute()` is lazy; timing that call alone understates evaluation
by roughly a third, which is why the harness does not.)

| Query | Whole `query()` | `query_on_store()` only | Reconstruction share |
|---|---:|---:|---:|
| `open-obligations` | 1.3729 | 0.0630 | 95.4% |
| `actual-executions` | 1.4330 | 0.1808 | 87.4% |
| `role-assignments` | 1.3309 | 0.0597 | 95.5% |
| `qualification-traces` | 1.3577 | 0.1010 | 92.6% |
| `requirement-traces` | 1.3875 | 0.1425 | 89.7% |
| `reason-trace` | 1.3867 | 0.1427 | 89.7% |
| `has-open-obligations` | 1.2836 | 0.0401 | 96.9% |
| **All seven** | **9.5523** | **0.7299** | **92.4%** |

`store_from_nquads` alone: 1.2655 ms minimum. The 60k index source reproduces
the same split (10.8152 ms whole, 0.7912 ms evaluation, 92.7% reconstruction),
which is the point: the split does not move with the workspace.

### Decision: no cache. Negative result.

A root-digest keyed store cache would remove 92.4% of the measured query cost —
about 14.6 ms of a 15.8 ms panel refresh in WASM. It was still not built,
because the measurement says that saving is not material:

1. **No product surface issues repeated interactive queries.** `queryRegistered`
   and `rebuildIndex` are defined in `web/src/workers/chronicle-worker.ts` and
   have no caller anywhere in `web/src`. The premise of the recorded debt item
   ("if repeated interactive queries become material") has no traffic to become
   material with.
2. **The cost does not grow with the workspace.** 60,015 raw rows and 600 raw
   rows produce the same 221,057-byte index and the same ~15.7 ms panel
   refresh. There is no scale at which this degrades.
3. **It is off the main thread and one-shot per root.** The worst realistic
   load is all seven queries answered once when the workspace root changes.
   That is 15.8 ms in a worker, 0.9% of the 1,730 ms pipeline run that produced
   the new root.

Threshold used: material means a single user-visible interaction spends more
than one 60 Hz frame (16.7 ms) reconstructing the index **on the main thread**,
or the cost grows with workspace size so large workspaces degrade. Neither
holds. When a UI surface starts issuing these queries per interaction, the
numbers above are the input to that decision and the harness re-runs unchanged.

## Debt item 6a — Parquet and SPSS independently parse the CSV output

### What actually happens

`parquet_from_csv` and `sav_from_csv` in
`rust/chronicle_preprocessing_runtime_wasm/src/binary_exports.rs` each began
with their own `parse_csv` of the same canonical CSV. With both exports
enabled, `append_binary_exports` parsed the app CSV twice and the screen CSV
twice.

### Numbers (native, `synthetic-60k`, app CSV: 40,355 rows x 33 columns, 12,693,415 B)

| Measurement | Minimum ms | Median ms | Share |
|---|---:|---:|---:|
| `parse_csv` alone | 44.581 | 50.121 | — |
| `parquet_from_csv` total | 128.852 | 135.813 | parse is 34.6% |
| `sav_from_csv` total | 99.595 | 103.751 | parse is 44.8% |

The intermediate `CsvTable` holds every cell as an owned `String`:
**44,275,343 bytes for a 12,693,415-byte CSV (3.49x)**. The screen CSV
(2,477 rows, 1,091,727 B) adds `parse_csv` 2.653 ms and 2,974,983 B (2.73x).

The decisive measurement is the within-process A/B in
`both_exports_shared_table_versus_independent_reparse`: two `*_from_csv` calls
(the old path, two parses) against one `parse_csv` plus both `*_from_table`
calls (the new path, one parse), interleaved in a single run, with the outputs
asserted byte-identical inside the measurement.

| Fixture / family | Two parses (min ms) | One parse (min ms) | Saving | Duplicate `CsvTable` avoided |
|---|---:|---:|---:|---:|
| `synthetic-60k` app | 234.639 | 184.284 | 50.355 ms (21.5%) | 44,275,343 B |
| `synthetic-60k` screen | 12.302 | 9.345 | 2.957 ms (24.0%) | 2,974,983 B |
| `contract-600` app | 1.353 | 0.996 | 0.357 ms (26.4%) | 322,170 B |
| `contract-600` screen | 0.078 | 0.067 | 0.011 ms (13.9%) | 1,331 B |

Product cost of enabling the exports at all, in the shipped WASM
(`synthetic-60k`, 25 interleaved iterations, minimum ms), before and after the
change:

| Configuration | Before: delta vs `exports-off` | After: delta vs `exports-off` |
|---|---:|---:|
| `parquet-on` | +178.0 (+9.9%) | +209.7 (+12.1%) |
| `spss-on` | +143.1 (+8.0%) | +136.3 (+7.9%) |
| `parquet-and-spss-on` | +374.2 (+20.9%) | +296.4 (+17.1%) |

(`exports-off` baseline: 1,791.0 ms before, 1,730.5 ms after.) Read these as
corroboration of direction only. `parquet-on` performs exactly one parse in
both builds and is untouched by the change, yet its delta moved by +32 ms
between the two runs — that is the cross-run noise floor on a loaded machine.
The both-exports delta falling by 78 ms is consistent with the 53 ms the
in-process A/B attributes to the removed parses; the A/B is the measurement,
this table is the sanity check.

At `contract-600` after the change (baseline `exports-off` 22.8 ms): parquet
+1.05 ms (+4.6%), SPSS +0.62 ms (+2.7%), both +1.90 ms (+8.3%).

### Decision: share the parse. Built.

The duplicate parse is 21-26% of the both-exports path at every fixture size
and duplicates a 44 MB transient allocation. `append_binary_exports` now parses each canonical CSV
family once, writes every enabled encoding of it from that one `CsvTable`, and
drops the table before the next family is parsed. Peak memory therefore still
holds at most one `CsvTable` — the same as before the change — while the parse
count for the both-exports configuration halves. The artifact order
(`app-parquet`, `screen-parquet`, `app-spss`, `screen-spss`) is unchanged; the
four encoded byte vectors are held briefly before being appended in that order,
and they were retained in the artifact list either way.

`parquet_from_csv` and `sav_from_csv` are kept as `#[cfg(test)]` wrappers: they
are the independently reparsed reference that the byte-identity test compares
the shared table against. They are gated because the product no longer calls
them and `cargo clippy --all-targets -- -D warnings` (`Makefile`,
`scripts/check-rust.sh`) fails on dead code.

The larger restructure named in the debt item — having the exports consume the
typed Rust values instead of any CSV — was measured and rejected. It is not a
local change: `PipelineV2Result` in
`rust/chronicle_chrono_kernel_wasm/src/pipeline_v2.rs` carries only
`app_csv_bytes` / `screen_csv_bytes`, no typed row table. Retaining typed rows
to feed the exports would hold that data across the whole Salsa-cached result
in the default configuration where **both exports are off**, trading a
transient 44 MB for a retained one, and would change the persisted resume
format (v8, magic `CHRRX008`) and the 55-step contract. That is a peak-memory
regression for every default run in exchange for at most the remaining ~50 ms
on a non-default path.

### Byte-identity proof

`binary_exports::perf_measurement::export_reparse_share_of_parquet_and_spss_paths`
prints the SHA-256 of every Parquet and SAV output. The digests before and
after the change are identical on both fixtures:

| Fixture / output | SHA-256 (before and after) |
|---|---|
| `contract-600` app Parquet | `sha256:e10f1c9eb7b3e9071d576c4ab46e7a440804b02a84c197fc27fe73b6e38024d4` |
| `contract-600` app SAV | `sha256:c8e579132bf2b22ac2b171681c0a78fbe19b5a2b9e4ae05e558c4274ee85f60e` |
| `contract-600` screen Parquet | `sha256:1630b7157006a14acbe0641639fbeedb1801b0338c012f1d8887036ced150667` |
| `contract-600` screen SAV | `sha256:fc655104ca1b3bbcea608987e96e6b5bd5925a6232084fe38dc1d7495d6282d0` |
| `synthetic-60k` app Parquet | `sha256:8ec7187e2cbd3b2b5449d588235b41832f4a347b29facaa2da5f2b66e823a4f0` |
| `synthetic-60k` app SAV | `sha256:02abc53f82357f68b570dfbb1d2de815d305a5d351b25b8a7863ceebbc40d76a` |
| `synthetic-60k` screen Parquet | `sha256:154caa70ae4ec47127fa154b2f65a541261001826dafd2084421d929050628d1` |
| `synthetic-60k` screen SAV | `sha256:57e4395582186511609fcc733cd8eadbc3fd285838955a0f9a7d1596bf84dc94` |

`binary_exports::tests::shared_export_table_is_byte_identical_to_independent_reparse`
pins the same property as a normal (non-ignored) test, for the app and screen
column families and for reusing one table across three writes.

The shipped WASM confirms it end to end through `execute_workspace`: every
exported artifact has the same byte length before and after the change, at both
fixture sizes.

| Artifact | `contract-600` bytes | `synthetic-60k` bytes |
|---|---:|---:|
| `app-parquet` | 31,850 | 3,356,273 |
| `screen-parquet` | 4,316 | 470,792 |
| `app-spss` | 94,081 | 15,343,457 |
| `screen-spss` | 2,774 | 1,243,862 |

(These byte counts differ from the native harness's because the harness runs
its own explicit option set; the before/after comparison is within each
column.)

## Debt item 6b — eagerly materialized visualization payloads

### What actually happens

`visualization_data_json_bytes` is built during `run_pipeline_v2*` when
`materialize_visualization_data` is set, and `RuntimeRequest::validate_fields`
in `rust/chronicle_preprocessing_runtime_wasm/src/lib.rs` **requires** that
flag to equal `enablePlotting || enableInteractiveTimeline`. So the payload is
already gated on the two view options; it is not built when both are off.
`enablePlotting` defaults to true, so the default run does materialize it.

### Numbers (shipped WASM, minimum ms of 25 interleaved iterations)

`synthetic-60k`, measured twice (two separate runs of the same harness):

| Configuration | Run A delta | Run B delta | `visualization-data-json` |
|---|---:|---:|---:|
| `visualization-off` | — (1,770.9 ms) | — (1,700.3 ms) | 0 B |
| `enablePlotting` only | +20.1 (+1.1%) | +30.2 (+1.8%) | 8,613,124 B |
| `enableInteractiveTimeline` only | +89.5 (+5.1%) | +14.5 (+0.9%) | 8,613,124 B |

The two "on" rows produce the identical artifact — the flags only decide
*whether* it is built, not what it contains — and their order swaps between
runs, which is the clearest statement of how much of this is sampling noise.
The honest reading is 15-90 ms, at most 5% of a 60k run.

`contract-600`, baseline `visualization-off` = 22.35 ms: +0.15 ms (+0.7%) with
the timeline on, +0.46 ms (+2.1%) with plotting on, for a 58,520-byte payload.

### Decision: no change. Negative result.

1. Materialization costs 0.9-5.1% of a 60k run and under half a millisecond at
   600 rows.
2. It is already avoidable: turning off both view options removes it entirely,
   and the gate is enforced, not advisory.
3. Making it lazy is not free. `visualization-data-json` is a member of the
   verified artifact closure, so deferring it changes closure membership, the
   workspace root digest, and the checked goldens — and
   `configurationSpaceCampaign` pins `enablePlotting` as the option whose
   perturbation invalidates exactly `outputs`. A golden change is exactly what
   the repository forbids for a performance edit.

Threshold used: material means more than 10% of the run, or unavoidable when
unwanted. Neither holds.
