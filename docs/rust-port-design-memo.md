# Rust Port Design Memo — Chronicle Browser Pipeline

Author: Claude (handoff to future implementer)
Date: 2026-04-27

## 1. TL;DR

We instrumented the existing TypeScript browser pipeline, tagged every `Intl.DateTimeFormat` call site, and built two prototype Rust→WASM crates (`chronicle_chrono_kernel_wasm`, `chronicle_polars_kernels_wasm`) to measure where speed actually comes from. Per-stage WASM kernels lose to the JS baseline on parse and dedup once you add the WASM↔JS marshalling cost; only timestamp formatting wins on its own (4× with Polars, 7× with chrono-tz). The decisive result is that a single end-to-end Rust kernel — CSV bytes in, CSV bytes out, all intermediate columns living in Rust — produces byte-identical output **2.92×** faster than the equivalent TS pipeline at **byteDiff=0** across all five fixtures (407,647 rows). Polars-WASM is rejected: it is 9.17 MB (2.13 MB gzipped), 70% slower than the chrono-tz lean kernel, and brings nothing this workload uses. **Recommendation: build a single end-to-end Rust pipeline crate, reuse `chronicle_app_usage_matcher` via path dep, keep the TS pipeline as the fallback (mirroring how the Python CLI falls back when `_rust_app_usage_matcher` is absent).**

## 2. Current pipeline shape

The repo runs three surfaces — Python desktop, web/PWA, Rust core — that share the matcher algorithm. Today only the matcher is in Rust; everything else is duplicated:

| Surface         | Pipeline location                                       | Language   | Rust used                              |
|-----------------|---------------------------------------------------------|------------|----------------------------------------|
| Python desktop  | `src/chronicle_preprocessing_app/core/preprocessing/`   | Python     | `_rust_app_usage_matcher` (PyO3)       |
| Web/PWA         | `web/src/lib/browserPipeline.ts`                        | TypeScript | `chronicle_app_usage_wasm` (matcher)   |
| Rust core       | `rust/chronicle_app_usage_matcher/`                     | Rust       | —                                       |

The browser pipeline (`browserPipeline.ts`, ~2,085 lines, single file) executes 8 emitted progress stages — `parse → timezone → filter → screen → matcher → codebook → enrich → output`. The Python pipeline has 6 explicit `*Preprocessor` classes chained in `main_preprocessor.py`; the browser splits a few of those into smaller stages but the work is the same.

The matcher is roughly 5% of total wall time on every fixture. Everything else (parsing, timezone formatting, codebook enrichment, CSV writing) is currently TypeScript.

### 2.1 Where the time actually goes

Aggregate across five real Chronicle fixtures (10 MB each, ~80K rows each, total 407K rows), TS pipeline only:

| Stage     | Total time | Share | Notes                                          |
|-----------|-----------:|------:|------------------------------------------------|
| output    | 3.87s      | 37.5% | per-row `Intl` reformat + CSV escape + concat  |
| parse     | 2.39s      | 23.2% | PapaParse + per-row bigint + Intl normalisation |
| timezone  | 2.03s      | 19.7% | per-row Intl on every row                       |
| enrich    | 0.85s      |  8.3% | codebook joins, flag math                       |
| matcher   | 0.57s      |  5.5% | already Rust (PyO3 / WASM) — call overhead only |
| codebook  | 0.36s      |  3.5% | hashmap build + lookups                         |
| screen    | 0.19s      |  1.9% | session-state machine, kitchen-sink heavy       |
| filter    | 0.05s      |  0.5% | small set lookups                               |
| **TOTAL** | **10.31s** | 100%  | `web/.tmp/profile/log.txt`                      |

### 2.2 Intl is the dominant cost in the dominant stages

Re-instrumenting with an `Intl.DateTimeFormat` shim that times every constructor/format/formatToParts/resolvedOptions call (`scripts/profile_intl_breakdown.mts`) attributes the time precisely:

| Stage     | Total   | Intl    | Other   | Intl share |
|-----------|--------:|--------:|--------:|-----------:|
| output    | 4.95s   | 1.94s   | 3.00s   | 39.3%      |
| parse     | 3.29s   | 1.69s   | 1.60s   | 51.4%      |
| timezone  | 2.90s   | 1.68s   | 1.23s   | 57.7%      |
| enrich    | 1.08s   | 0.0ms   | 1.08s   |  0.0%      |
| matcher   | 0.70s   | 0.0ms   | 0.70s   |  0.0%      |
| codebook  | 0.45s   | 0.0ms   | 0.45s   |  0.0%      |
| screen    | 0.39s   | 10.5ms  | 0.38s   |  2.7%      |
| filter    | 0.13s   | 0.0ms   | 0.13s   |  0.0%      |
| **TOTAL** | 13.89s  | 5.32s   | 8.57s   | **38.3%**  |

`web/.tmp/profile/intl_log.txt`. 2,227,602 Intl calls across 5 files — ~5.5 calls per row. That is the per-row Intl tax the Rust port can eliminate.

## 3. Benchmark findings table

All numbers from `web/.tmp/profile/`. Ratios are TS / Rust unless stated. "Parity" = byte- or value-identical output across all rows.

### 3.1 Per-kernel benchmark — `bench_kernels_full.mts`

WASM crate: `chronicle_chrono_kernel_wasm` (lean, no Polars).

| Kernel        | TS aggregate | Rust aggregate | Ratio  | Parity                              |
|---------------|-------------:|---------------:|-------:|-------------------------------------|
| parse         | 686.3ms      | 1.04s          | 0.66×  | rows match, ts_ns identical         |
| format        | 1.42s        | 336.5ms        | 4.23×  | columns identical                   |
| dedup         | 107.1ms      | 121.8ms        | 0.88×  | kept-set identical, byte-for-byte   |

Source: `web/.tmp/profile/kernels_full.log`. Per-fixture breakdown:

| Fixture (rows)                             | parse TS / Rust / × | fmt TS / Rust / × | dedup TS / Rust / × |
|--------------------------------------------|--------------------:|------------------:|--------------------:|
| chronicle_raw_035_dangling.csv (81,415)    | 151.6 / 219.9 / 0.69 | 310.6 / 74.7 / 4.16 | 23.7 / 31.5 / 0.75  |
| chronicle_raw_074_duplicates.csv (81,369)  | 142.8 / 203.0 / 0.70 | 270.5 / 68.8 / 3.93 | 21.7 / 22.9 / 0.95  |
| chronicle_raw_054_kitchen-sink.csv (84,957)| 129.7 / 230.2 / 0.56 | 288.0 / 67.8 / 4.25 | 21.8 / 23.9 / 0.91  |
| chronicle_raw_028_single.csv   (80,138)    | 132.1 / 193.6 / 0.68 | 267.2 / 61.8 / 4.32 | 19.4 / 22.1 / 0.88  |
| chronicle_raw_024_shutdown.csv (79,768)    | 130.0 / 193.1 / 0.67 | 286.6 / 63.4 / 4.52 | 20.5 / 21.5 / 0.95  |

Format kernel wins. Parse and dedup lose. The reason is in §4.

### 3.2 Format-kernel three-way bench — `bench_polars_kernel.mts`

Same five fixtures, three implementations producing the same five columns (`event_timestamp_string`, `date`, `hour`, `day`, `quarter`):

| Path                           | Aggregate | vs Intl | Diff |
|--------------------------------|----------:|--------:|-----:|
| TS Intl (current)              | 2.69s     | 1.00×   | —    |
| WASM lean (chrono-tz)          | 373.7ms   | **7.18×** | 0  |
| WASM polars (Polars LazyFrame) | 636.8ms   | 4.22×   | 0    |

Source: `web/.tmp/profile/bench_log.txt`. All three paths produce identical strings/numbers (`diff=0` per fixture).

Per-fixture detail:

| Fixture (rows)                              | Intl     | Lean     | Lean ×  | Polars   | Polars × |
|---------------------------------------------|---------:|---------:|--------:|---------:|---------:|
| chronicle_raw_035_dangling.csv  (81,415)    | 531.2ms  | 83.5ms   | 6.36×   | 132.8ms  | 4.00×    |
| chronicle_raw_074_duplicates.csv (81,369)   | 540.8ms  | 75.3ms   | 7.19×   | 125.0ms  | 4.33×    |
| chronicle_raw_054_kitchen-sink.csv (84,957) | 561.9ms  | 72.7ms   | 7.73×   | 131.0ms  | 4.29×    |
| chronicle_raw_028_single.csv    (80,138)    | 522.4ms  | 73.6ms   | 7.10×   | 124.0ms  | 4.21×    |
| chronicle_raw_024_shutdown.csv  (79,768)    | 528.7ms  | 68.7ms   | 7.70×   | 124.0ms  | 4.26×    |

The polars path is 70% slower than the lean chrono-tz path despite being inside the same WASM module — the LazyFrame plan + `convert_time_zone` + `strftime` is more work than the inlined `chrono::DateTime<Tz>` formatting loop, and pays for it. The lean kernel does precisely the work needed (one `with_timezone(&tz)` call, one `format!` per row, one weekday lookup) and stops; the LazyFrame allocates a Series per intermediate column, runs the optimizer, materialises a DataFrame, and only then surfaces the strings.

### 3.3 Sort kernel — `bench_sort_and_e2e.mts`

| Path                       | Aggregate | vs TS | Parity |
|----------------------------|----------:|------:|--------|
| TS object-array sort       | 27.2ms    | 1.00× | —      |
| Rust `sort_by_timestamp_stable` (BigInt64Array→Uint32Array) | 1.8ms | **15.17×** | sorted seq identical |

(Re-derived 2026-04-27, `web/.tmp/profile/sort_e2e_log.txt`.)

Sort wins big because the boundary is a single `BigInt64Array` in / `Uint32Array` out — both are zero-copy on the JS side.

### 3.4 End-to-end kernel — `bench_sort_and_e2e.mts`

The decisive bench. Single Rust function `process_pipeline_e2e(csv_bytes, tz) -> csv_bytes` does parse + sort + dedup + format + write entirely in Rust. The TS reference is a faithful equivalent that calls TS parse, TS sort, JS-Set dedup, Intl format, manual CSV escape.

| Fixture (rows)                              | TS e2e   | Rust e2e | Ratio  | byteDiff |
|---------------------------------------------|---------:|---------:|-------:|---------:|
| chronicle_raw_035_dangling.csv  (81,415)    | 554.2ms  | 201.2ms  | 2.75×  | 0        |
| chronicle_raw_074_duplicates.csv (81,369)   | 504.8ms  | 173.9ms  | 2.90×  | 0        |
| chronicle_raw_054_kitchen-sink.csv (84,957) | 528.7ms  | 178.7ms  | 2.96×  | 0        |
| chronicle_raw_028_single.csv    (80,138)    | 506.9ms  | 170.6ms  | 2.97×  | 0        |
| chronicle_raw_024_shutdown.csv  (79,768)    | 515.8ms  | 170.7ms  | 3.02×  | 0        |
| **AGGREGATE**                               | **2.61s**| **895.2ms**| **2.92×** | **0** |

Both the byte length and the SHA-256 (first 12 hex chars) of the output buffer match exactly:

```
ts_sha=88ec636fde70 rust_sha=88ec636fde70   (035)
ts_sha=922bc514c0f8 rust_sha=922bc514c0f8   (074)
ts_sha=c6fa1e700288 rust_sha=c6fa1e700288   (054)
ts_sha=6ebb0d023cdf rust_sha=6ebb0d023cdf   (028)
ts_sha=69fd0a58dc9b rust_sha=69fd0a58dc9b   (024)
```

Byte-identical output is non-negotiable for the parity matrix the project uses with the Python pipeline (see `scripts/run_deterministic_web_parity.py`). The e2e kernel meets it.

### 3.5 WASM artifact sizes (built with `wasm-pack --release`, `wasm-opt -Oz`, LTO=fat, panic=abort)

| Crate                              | Raw size  | gzipped   | Notes                                     |
|------------------------------------|----------:|----------:|-------------------------------------------|
| `chronicle_app_usage_wasm`         | 30,364 B  | 13,156 B  | matcher only — what ships today           |
| `chronicle_chrono_kernel_wasm` (lean) | 1,003,472 B (≈1.00 MB) | 215 KB | parse+sort+format+dedup+writer+e2e in one crate |
| `chronicle_polars_kernels_wasm` (polars) | 9,173,219 B (≈9.17 MB) | 2.04 MB | the polars LazyFrame DataFrame engine for *one* function |

(Sizes from `wc -c` and `gzip -c | wc -c` on the actual `.wasm` files in `web/src/wasm/*/pkg/`. The 197 KB figure cited earlier was an interim build before `dedupe_event_rows` and `process_pipeline_e2e` were added; current size 215 KB gzipped.)

## 4. The WASM boundary insight (this is the architectural finding)

The per-kernel benchmark in §3.1 looks bad on the surface — parse 0.66×, dedup 0.88×, only format wins. That number lies. Here is what actually happens at the boundary.

### 4.1 What costs what at the WASM↔JS edge

| Marshal direction      | Type                    | Cost         | Notes                                  |
|------------------------|-------------------------|--------------|----------------------------------------|
| JS → WASM              | `Uint8Array`/`Int8Array` typed-array | ~free      | shared linear-memory view              |
| JS → WASM              | `BigInt64Array`         | ~free        | shared linear-memory view              |
| JS → WASM              | `&str` (single string)  | trivial      | one UTF-8 encode of a small constant   |
| JS → WASM              | `Vec<String>` arg       | **expensive** | each string is allocated + UTF-8 encoded into linear memory |
| WASM → JS              | `Vec<u8>` return        | one ArrayBuffer copy | cheap, single transfer |
| WASM → JS              | `Vec<u32>` return       | one ArrayBuffer copy | cheap (sort permutation case)        |
| WASM → JS              | struct via serde-wasm-bindgen with `Vec<String>` fields | **very expensive** | each string crosses individually, each one is a fresh JS string allocation |
| WASM → JS              | small struct with scalar fields | cheap     | one Object construction               |

`parse_raw_csv` returns a struct with eight `Vec<String>` columns plus a `Vec<i64>` and counters. On 81K rows that's eight string-vector marshals from WASM→JS — one per column — each allocating ~81K JS strings. The Rust parsing itself is fast; the boundary shipping them out is what eats the speedup.

`dedupe_event_rows` is even more lopsided: the JS side already has the `interaction_type` and `app_package_name` arrays as JS strings, so calling the Rust kernel forces them *across* the boundary into Rust just to test for set membership, then ships indices back. The TS path uses a `Set<string>` directly on the strings already in JS memory. The Rust dedup is faster, but the boundary cost it pays to even start eats the win.

### 4.2 What the format kernel does differently

`format_timestamps` takes a `BigInt64Array` (zero-copy view) plus a tz string (15 bytes), and returns 5 columns. Five string-vectors out is still expensive — but the *replaced work* (~5 Intl calls per row across 81K rows = ~400K Intl calls per fixture, plus per-row JS object construction) is so much heavier that the boundary cost is dominated. Net 4.23× win.

### 4.3 What e2e does

`process_pipeline_e2e` takes the raw CSV bytes (one Uint8Array view, ~10 MB, marshalled as a typed-array — ~free) and returns the processed CSV bytes (one `Vec<u8>`, ~6.6 MB, returned as a single Uint8Array — one copy). All intermediate columns — `event_timestamp_ns`, `app_package_name`, `interaction_type`, sort permutation, dedup hashset, formatted strings, escape buffer — live entirely inside Rust linear memory. The boundary is paid **twice** (in and out), not 8× per stage.

The kernel is laid out so each pass over the data runs straight through `Vec`s of native Rust types:

1. `parse_internal` walks `csv-core::Reader::read_field` once over the CSV bytes, building columnar `Vec<i64>` (timestamps in ns) and `Vec<String>` (everything else).
2. `indices.sort_by_key(|i| event_timestamp_ns[i])` produces a stable sort permutation in a `Vec<u32>`.
3. A single `AHashSet<(i64, &str, &str)>` pass over the sorted permutation builds the kept-index list. The set keys borrow directly from the parsed columns — zero allocation per row.
4. The format+write pass walks the kept indices, calls `chrono::Utc.timestamp_opt().with_timezone(&tz)` per row, writes the CSV escape directly into a single `Vec<u8>` output buffer with `write_csv_field` and a custom `write_u8` (no `format!` in the hot path).

None of those passes leave Rust memory until the final `Vec<u8>` is returned. By contrast, the TS reference does: PapaParse allocates strings into JS-heap row objects, the bigint sort comparator boxes each timestamp, the dedup `Set<string>` allocates a fresh template-literal key per row, and `Intl.DateTimeFormat.formatToParts` allocates an array-of-objects for every row. Each one is fast; doing 81K of each is what costs the second.

This is the dominant lesson: **speedup is a function of how often you cross the boundary, not how fast each kernel is in isolation.** The naive port plan ("port stage by stage, keep the TS pipeline glue") is the worst possible plan for WASM. The right shape is a single fat boundary call.

The numbers prove it directly:

| Approach                                              | Aggregate | vs TS    |
|-------------------------------------------------------|----------:|---------:|
| TS reference (parse + sort + dedup + Intl + write)    | 2.61s     | 1.00×    |
| Sum of per-stage Rust kernels (parse 1.04 + sort 0.002 + fmt 0.34 + dedup 0.12 + (TS write?)) | strictly worse than TS for parse and dedup — does not compose to a win | <1× on parse-heavy steps |
| **Single end-to-end Rust kernel**                     | **0.90s** | **2.92×** |

The "sum of kernels" line is theoretical — once you keep the glue in TS you also have to keep marshalling the `Vec<String>` columns back into JS at every stage boundary, which kills the parse and dedup wins. Don't go there.

### 4.4 Code-shape comparison

What the two architectures actually look like at the call site:

```ts
// SHAPE A — naive port. Each stage is its own boundary call.
const cols = wasm.parse_raw_csv(bytes);              // boundary: 8 Vec<String>s + 1 Vec<i64> out
const sortIdx = wasm.sort_by_timestamp_stable(...);  // boundary: BigInt64Array in, Uint32Array out
const dedupKept = wasm.dedupe_event_rows(cols.event_timestamp_ns, cols.interaction_type, cols.app_package_name);
                                                     // boundary: 3 vectors back in, 1 Vec<u32> out
const formatted = wasm.format_timestamps(...);       // boundary: BigInt64Array in, 5 Vec<String>s out
// + TS-side filter, codebook, enrich, output writer
```

```ts
// SHAPE B — the recommendation. One boundary, all heavy work inside.
const bundle = wasm.process_raw_csv(bytes, optionsJson, supportFiles);
//   boundary: 4× &[u8] views in, 1 Uint8Array out + small stats struct
```

Shape B pays the boundary tax twice (in: bytes; out: bytes). Shape A pays it ten or more times, with the most expensive shape (`Vec<String>` round-tripping) on the worst-case stages.

## 5. Polars-WASM verdict

We built and ran `chronicle_polars_kernels_wasm` to answer: "is the timestamp work fast enough on Polars LazyFrame to justify the binary cost, even if you ignore the column engine you don't use?" The answer is no, by every dimension that matters here.

| Metric                                | Polars WASM   | Lean (chrono-tz) WASM | Verdict for our workload                         |
|---------------------------------------|--------------:|----------------------:|--------------------------------------------------|
| Build artifact (raw)                  | 9.17 MB       | 1.00 MB               | 9.1× larger                                      |
| Build artifact (gzipped, the actual download) | **2.13 MB** | **215 KB**            | 10× larger first-load, on a PWA                  |
| Format-kernel speedup vs Intl         | 4.22×         | 7.18×                 | lean is **70% faster** — Polars is *worse* here  |
| Functions used (out of Polars surface area) | 1 (LazyFrame.dt.strftime path) | n/a            | one feature out of an entire dataframe engine    |
| Brings new capabilities (group-by, joins, parquet, etc.) | yes, at runtime | no              | **none of which this workload needs** — codebook joins are 8 join keys total, dedup is one HashSet pass, sort is a single column |
| Build complexity (transitive deps, getrandom-wasm patch, polars-utils, etc.) | high | low               | already biting us (`getrandom = "0.3", features = ["wasm_js"]` workaround needed) |
| Codegen (`opt-level = "z"`, LTO=fat)  | configured    | configured            | already maxed; further shrink would need Polars feature surgery |

**Skip Polars.** The PWA bundle goes from a ~30 KB gzipped WASM payload today to either ~215 KB (lean) or ~2.13 MB (Polars). 10× larger first-load to get *worse* runtime perf is not a trade. The lean chrono-tz path is the right floor; the e2e kernel built on top of it is the right ceiling.

If a future workload genuinely needs DataFrame primitives (group-by, joins on millions of rows, parquet IO), revisit. Today's pipeline does none of that — every "join" in the pipeline is a HashMap lookup against tables of ≤8 columns, and every aggregation is a single linear pass.

## 6. Recommended architecture for the port

### 6.1 Shape

A single Rust crate `chronicle_browser_pipeline_wasm` (or rename — names are cheap) that exposes one boundary entry point:

```rust
#[wasm_bindgen]
pub fn process_raw_csv(
    csv_bytes: &[u8],
    options_json: &str,
    support_files: SupportFilesPayload, // codebook, filter, screen-open as &[u8] each
) -> Result<ProcessedBundle, JsValue>;

#[derive(Serialize)]
pub struct ProcessedBundle {
    pub app_csv: Vec<u8>,
    pub screen_csv: Option<Vec<u8>>,
    pub stats: ProcessingStats,        // row counts, timezone action, dropped reasons
    pub preview_rows: Vec<PreviewRow>, // small, ~50 rows for the UI
}
```

Inputs: typed-array views (CSV bytes, support-file bytes), one JSON string for options. Outputs: one or two CSV byte buffers + a small stats struct + a small preview slice. **All heavy intermediate state — the parsed columns, the sort permutation, the dedup HashSet, the formatted strings, the codebook lookup map — lives in Rust linear memory and never crosses the boundary.**

### 6.2 Internal layout

The crate composes the existing prototype kernels plus the existing matcher:

| Module                  | Responsibility                                            | Source today                                       |
|-------------------------|-----------------------------------------------------------|----------------------------------------------------|
| `parse`                 | csv-core CSV parser → typed columns, ts ns, drop counters | `chronicle_chrono_kernel_wasm::parse_internal`     |
| `timezone`              | Tz handling (canonicalize, fill, offset-aware re-parse)   | port from `browserPipeline.ts::applyTimezoneHandling` |
| `dedup`                 | (ts, interaction, package) HashSet pass                   | `chronicle_chrono_kernel_wasm::dedupe_event_rows`  |
| `filter`                | apps-to-filter Set lookup                                 | port from `browserPipeline.ts::labelFilteredApps`  |
| `screen`                | screen-usage state machine + apps-forcing-screen-open     | port from `browserPipeline.ts::deriveScreenUsageSessions` |
| `matcher`               | app-usage interval matching                                | **path dep** on `chronicle_app_usage_matcher` (no `python` feature) |
| `codebook`              | codebook map build + per-row lookup                       | port from `browserPipeline.ts::enrichWithCodebookData` |
| `enrich`                | flag math, detail columns, removed interactions           | port from `browserPipeline.ts` enrich block        |
| `format`                | chrono-tz batched formatter for output strings            | `chronicle_chrono_kernel_wasm::format_timestamps`  |
| `output`                | CSV writer, escape, UTF-8 write                           | `chronicle_chrono_kernel_wasm::process_pipeline_e2e` writer half |

### 6.2.1 Stage mapping — TS → Rust

Cross-reference between the current TS implementation and the target Rust module. Use this when porting Step 3:

| TS function (browserPipeline.ts)                | Rust target module | Notes                                           |
|-------------------------------------------------|--------------------|-------------------------------------------------|
| `parseRawRows`                                  | `parse`            | already implemented in prototype                |
| `parseChronicleTimestampNs` + `parseOffsetlessTimestampAsUtcNs` | `parse`  | already implemented; matches TS forms exactly  |
| `dedupeExactRows`                               | `dedup`            | already implemented in prototype                |
| `unalignDuplicateTimestamps`                    | `dedup`            | needs Rust port — small, deterministic          |
| `markDataTimeGaps`                              | `dedup`            | linear-pass column write                        |
| `applyTimezoneHandling`                         | `timezone`         | option-driven; mirror exact decision tree       |
| `discoverTimezonesFromRawCsv`                   | `parse`            | trivial — return `Vec<String>` of unique tz values |
| `buildFilterMap` + `labelFilteredApps`          | `filter`           | hashmap of Sets, single linear pass             |
| `buildAppsForcingScreenOpenMap`                 | `screen`           | hashmap, used inside the screen state machine   |
| `deriveScreenUsageSessions`                     | `screen`           | largest port; verify against kitchen-sink fixture |
| `runAppUsageAlgorithm`                          | `matcher`          | path-dep call into `chronicle_app_usage_matcher` |
| `buildCodebookMap` + `enrichWithCodebookData`   | `codebook`         | hashmap join, linear pass                       |
| `addAppUsageDetailColumns`                      | `enrich`           | derives day/hour/quarter from already-formatted timestamps |
| `markAppUsageFlags`                             | `enrich`           | boolean column writes                           |
| `clearFilteredUsageTiming`                      | `enrich`           | sets timing columns to "" on filtered rows      |
| `removeSelectedInteractionTypes`                | `enrich`           | option-driven row filter                        |
| `eventOffsetFormatter` / `eventFormatter` / `weekdayFormatter` | `format` | replaced by chrono-tz; this is the 38% Intl tax that goes away |
| `formatEventTimestamp` / `formatSessionTimestamp` / `formatScreenTimestamp` | `format` | three small variants over the same chrono-tz core |
| `csvEscape` + `formatCsvScalar` + `formatCsvNumber` | `output`        | already partially implemented (`write_csv_field` + `write_u8`) |
| `buildAppOutputBundle` / `buildScreenOutputBundle` | `output`        | full output schema — port column ordering exactly to preserve byte-identity |
| `deriveOutputFileName`                          | (stays in TS)      | trivial string concat; no need to cross boundary |

### 6.3 Reusing the matcher

`chronicle_app_usage_matcher` already builds with `default = ["python"]` features that gate PyO3 + numpy. The crate is ready to be consumed without those features:

```toml
[dependencies]
chronicle_app_usage_matcher = { path = "../chronicle_app_usage_matcher", default-features = false }
```

This is the same trick `chronicle_app_usage_wasm` already uses today. No fork.

### 6.4 Options and contract

`BrowserProcessingOptions` is currently a TS-side struct (`web/src/lib/types.ts`, mirroring Python's `PreprocessingOptions` from `core/config.py`). For the Rust port, mirror the existing strategy: the canonical shape lives in TS/Python, the Rust kernel deserialises a JSON snapshot of it. Use the existing contract-generation pipeline (`web/scripts/generate_contract_artifacts.mts`, run via `npm run generate:contract`, verified by `npm run check:contract`) so the Rust struct definition is generated from the same schema.

For each option that affects pipeline behaviour, the Rust kernel must produce the same output bytes as the TS pipeline:

| Option                                  | Pipeline branch it controls                                |
|-----------------------------------------|------------------------------------------------------------|
| `usageSessionMode`                      | which output bundles to produce (app, screen, both)        |
| `correctDuplicateEventTimestamps`       | unalign-duplicates pass during timezone stage              |
| `useFilterFile`                         | filter-stage execution                                     |
| `useAppsForcingScreenOpenFile`          | screen-stage variant                                       |
| `useAppCodebook`                        | codebook+enrich stage                                      |
| `interactionTypesToRemove`              | enrich filter pass                                         |
| timezone-handling enum                  | timezone-stage decision tree                               |

Whatever option matrix is enabled in any given test fixture must produce byte-identical output between the Rust e2e kernel and the TS pipeline. The parity harness must cover the matrix, not just the defaults.

A non-exhaustive option-matrix grid for the parity harness:

| #  | usageSessionMode    | useFilterFile | useAppCodebook | correctDuplicateEventTimestamps | useAppsForcingScreenOpenFile | interactionTypesToRemove        |
|----|---------------------|---------------|----------------|---------------------------------|------------------------------|---------------------------------|
| 1  | app_usage           | false         | false          | false                           | false                        | []                              |
| 2  | app_usage           | true          | false          | false                           | false                        | []                              |
| 3  | app_usage           | false         | true           | false                           | false                        | []                              |
| 4  | app_usage           | true          | true           | true                            | false                        | []                              |
| 5  | screen_usage        | false         | false          | false                           | false                        | []                              |
| 6  | screen_usage        | false         | false          | false                           | true                         | []                              |
| 7  | app_and_screen_usage| true          | true           | true                            | true                         | ["DEVICE_SHUTDOWN"]             |
| 8  | app_and_screen_usage| true          | true           | true                            | true                         | ["DEVICE_SHUTDOWN", "POWER_DISCONNECTED"] |

Each row × each fixture = one parity assertion. Failure to match byte-for-byte on any cell blocks merge.

### 6.5 Fallback behaviour (mirror Python)

The Python desktop CLI falls back to a pure-Python matcher when `_rust_app_usage_matcher` is absent. Mirror that in the browser pipeline:

| Path                              | Fallback                                      |
|-----------------------------------|-----------------------------------------------|
| `chronicle_browser_pipeline_wasm` loaded | use it (one boundary call, 2.92× faster) |
| WASM unavailable / failed init    | use the existing `browserPipeline.ts` TS pipeline as-is |

This means **keep `browserPipeline.ts` working, exactly as today.** Don't delete the TS pipeline. The Rust kernel is the fast path; TS is the fallback and the parity reference. Equality between the two is what `scripts/run_deterministic_web_parity.py` already verifies — extend that harness to compare TS-pipeline output vs Rust-pipeline output byte-for-byte on a fixture grid.

### 6.6 WASM size budget

| Component                        | Estimated gzipped contribution                         |
|----------------------------------|--------------------------------------------------------|
| Current `chronicle_app_usage_wasm` | 13 KB (matcher only, as today)                       |
| Lean kernels (chrono-tz, csv-core, ahash, serde) | ~215 KB (measured, current `chronicle_chrono_kernel_wasm`) |
| Add screen-state + codebook + filter logic (Rust ports of TS) | +30–80 KB (small data structures, no new heavy deps)  |
| Add timezone-handling, enrich flags, CSV writer for the wider output schema | +30–60 KB |
| **Total estimate (full e2e port)** | **250–400 KB gzipped**                               |
| Polars path (rejected)           | 2.13 MB gzipped — 5–9× the budget                      |

A 250–400 KB gzipped WASM payload is in the same order of magnitude as a typical app-shell bundle. PWA-acceptable. For comparison the current production wasm payload (matcher only) is 13 KB gzipped; the 250–400 KB target is roughly a 19–30× increase but in absolute terms it is one round-trip on a typical broadband connection and Service-Worker-cacheable on subsequent loads.

Ways to push further down if needed (in order of payoff vs effort):

| Lever                                               | Estimated savings | Cost                                                     |
|-----------------------------------------------------|-------------------|----------------------------------------------------------|
| `wasm-opt -Oz` + LTO=fat + panic=abort              | ~20–40% off raw   | already configured in both prototype crates              |
| Drop unused chrono-tz timezones (compile-time list) | 50–150 KB         | requires committing to a TZ allowlist; uploads from a TZ not on the list will fail to parse |
| Replace `serde-wasm-bindgen` with hand-rolled JsValue construction for the small return struct | 10–30 KB | one-off code-gen work, fragile to schema changes |
| Strip `csv-core` for a hand-rolled parser optimised for Chronicle's exact CSV dialect | 5–15 KB | small win, lose generality |
| Use `wee_alloc` instead of default allocator       | 10–20 KB          | sometimes slower at runtime — measure both ways          |

## 7. Migration steps (in order)

Each step ends with a concrete verification command. Do not advance to the next step until verification passes.

### Step 0 — Stabilize the current parity harness

1. Confirm `scripts/run_deterministic_web_parity.py` passes head against the current TS pipeline.
2. Add an equivalent harness step that runs the *future* Rust e2e kernel and diffs its output against the TS pipeline byte-for-byte on the same fixture grid.

Verify: `python3 scripts/run_deterministic_web_parity.py` exit 0; new Rust-vs-TS diff prints zero across all fixtures.

### Step 1 — Promote `chronicle_chrono_kernel_wasm` to the production crate

1. Rename `chronicle_chrono_kernel_wasm` → `chronicle_browser_pipeline_wasm` (or pick the final name).
2. Move it under `web/`'s build pipeline alongside `chronicle_app_usage_wasm` (`npm run build:wasm` should build both).
3. Add a `dev` feature that wires up `console_error_panic_hook` for browser debugging.
4. Add unit tests for the parse / sort / dedup / format kernels using the existing fixtures.

Verify: `cargo test --manifest-path rust/chronicle_browser_pipeline_wasm/Cargo.toml` green; `npm run build:wasm` green; `npm test` green.

### Step 2 — Wire the e2e kernel behind a feature flag in TS

1. Extend `web/src/lib/chronicleMatcher.ts` (the worker shim) with a `processRawCsvE2e` entry that calls `process_pipeline_e2e` for the subset of options it currently handles.
2. In `processRawCsvContent`, branch on a new `BrowserProcessingOptions.useRustE2ePipeline` boolean (default `false`). Hidden behind a debug-tools toggle in the UI for now.
3. Confirm parity on every fixture: same row count, same SHA-256 of the app CSV, same SHA-256 of the screen CSV.

Verify: e2e Playwright test runs both modes on the same fixture and asserts byte-identical output.

### Step 3 — Port the missing stages into Rust

In this order (smallest blast radius first):

1. **filter** — Set lookup, trivial. Mirror `labelFilteredApps`.
2. **codebook** — HashMap build + lookup. Mirror `buildCodebookMap` + `enrichWithCodebookData`.
3. **enrich** — flag math, detail columns. Mirror `addAppUsageDetailColumns` + `markAppUsageFlags` + `clearFilteredUsageTiming` + `removeSelectedInteractionTypes`.
4. **timezone** — option-driven TZ canonicalization. Mirror `applyTimezoneHandling` exactly. This one has user-facing rules; do not deviate.
5. **screen** — state machine. Largest of the five. Mirror `deriveScreenUsageSessions` and `buildScreenOutputBundle`.
6. **matcher integration** — wire the path-dep matcher into the e2e kernel.
7. **output** — full output schema (not just the 6-column subset the prototype emits). Mirror `buildAppOutputBundle` and `buildScreenOutputBundle`.

After each port: re-run the parity harness on every fixture, confirm byte-identical output, confirm size budget is still under 400 KB gzipped.

### Step 4 — Flip the default

1. `BrowserProcessingOptions.useRustE2ePipeline` default → `true`.
2. Keep the TS pipeline reachable via the same flag (`false`) as the documented fallback.
3. Update `processRawCsvContent` to log a warning if it falls back due to a WASM init failure (mirroring the Python "rust extension absent" path).

Verify: full e2e suite green on Rust path; fallback path explicitly tested by deliberately failing WASM init.

### Step 5 — Drop redundant TS code paths

The TS pipeline stays as the fallback, but anything that exists *only* to wrap the Rust matcher (e.g. the `chronicleMatcher.ts` worker glue specific to the matcher-only WASM) should consolidate against the e2e entry point. `chronicle_app_usage_wasm` continues to ship for backward compatibility with the path-dep matcher build but is no longer the primary entry.

Verify: `npm run build` green, `npm run check:contract` green, bundle size report stable.

### Step 6 — Remove the Polars prototype crate

Once the lean crate is in production:

1. Tag the current `main` (e.g. `prototype/polars-2026-04-27`) so the prototype is recoverable from git history.
2. Delete `rust/chronicle_polars_kernels_wasm/` and `web/scripts/bench_polars_kernel.mts`.
3. Remove the `web/src/wasm/chronicle_polars_kernels_wasm/` build output directory.
4. Update this memo to record the removal date.

Verify: `cargo test --workspace` green; `npm run build` green; `git grep -l polars` returns only this memo and the tag.

### Step 7 — Re-run the cross-surface parity harness

`scripts/run_deterministic_web_parity.py` already verifies determinism between the Python desktop pipeline and the browser pipeline. With the Rust e2e kernel as the browser default, re-run that harness end-to-end:

| Path A (reference)                | Path B (under test)                | Expected diff |
|-----------------------------------|-------------------------------------|---------------|
| Python desktop pipeline           | Browser TS pipeline (fallback path) | byte-identical (already verified pre-port) |
| Browser TS pipeline (fallback)    | Browser Rust e2e kernel             | byte-identical (verified Step 0 + Step 3) |
| Python desktop pipeline           | Browser Rust e2e kernel             | byte-identical (transitively, but verify directly) |

If the third row fails while the first two pass, the regression is in the Rust port — re-bisect within Step 3.

Verify: all three rows green across the full fixture set with the full options matrix.

## 8. What's NOT yet benchmarked

Honest list of what we *don't* know yet:

| Area                                | Status                                                                 |
|-------------------------------------|------------------------------------------------------------------------|
| Screen-usage state machine in Rust  | Not benchmarked. The kitchen-sink fixture (`054`) is the only fixture where `screen` is non-trivial (180.4ms TS). State machine logic is a transcription job, not a perf gamble — but no measurement exists yet. |
| Codebook enrichment in Rust         | Not benchmarked. TS path is 0.36s aggregate (3.5%). The HashMap build is small. Expect a win but not measured. |
| Full enrich block in Rust           | Not benchmarked separately. 0.85s aggregate (8.3%) is mostly per-row column writes — should map cleanly to the e2e kernel pattern but needs a parity harness once ported. |
| Python desktop perf parity          | **Separate task.** Python uses Polars for some stages already (`polars_fast_path.py`). The Rust e2e crate could replace the Python path too via PyO3, but that's a separate decision and a separate bench. Don't bundle it in. |
| Real-pipeline integration           | The bench runs `process_pipeline_e2e` on Node from a script. The browser path crosses the Web Worker boundary (Comlink), and the worker initialises WASM on first use. The 2.92× number is the kernel-only number; worker setup, message-passing, and progress emit will dilute it slightly on first file. Subsequent files in the same worker session reuse the initialised WASM module. |
| Larger fixtures                     | All five fixtures are ~80K rows / ~10 MB CSV. The largest real Chronicle dump observed in the wild is roughly 5–10× this. Linear-time kernels should scale linearly; HashMap rehash is `O(n)` amortised. Worth re-running the e2e bench on a 500K-row fixture once one is available. |
| Memory peak in Rust e2e             | Not measured. Linear-memory growth in WASM is committed and not reclaimable per-file. Worker per-file isolation already exists in the multi-file path; verify peak WASM heap stays below the typical 2 GB linear-memory cap on a 500K-row fixture. |
| Cold-start / WASM compile time      | Not measured for the lean kernel. Expect `<100ms` instantiation on a modern device for a 1 MB module; the e2e kernel adds little. The polars build at 9.17 MB raw would be a real cold-start tax — another reason to skip it. |

If any of these blocks the port, run the missing bench *first* before scaling the work.

### 8.1 Numbers we'd want from a follow-up bench round

| Bench                                                   | What it answers                                          | How to run                                                |
|---------------------------------------------------------|----------------------------------------------------------|-----------------------------------------------------------|
| Screen-state-machine Rust vs TS, kitchen-sink fixture only | Is the TS-to-Rust transcription a perf win or a wash?   | Add a Rust function `derive_screen_sessions`, call it from `bench_kernels_full.mts` against `054`. |
| Codebook+enrich Rust vs TS                              | Does this 12% of total wall time become significant once everything else is Rust? | Extend `process_pipeline_e2e` with codebook joins and re-bench. |
| 500K-row synthetic fixture                              | Does the e2e ratio hold at 5–10× the row count?         | Generate via `web/scripts/generate_sample_raw_csv.mjs`, re-run `bench_sort_and_e2e.mts`. |
| Worker-boundary cost                                    | What does Comlink + WASM init add on first-file vs subsequent files? | Wire the e2e kernel through `chronicle-worker.ts` behind the dev flag, time-stamp the worker round-trips. |
| Cold-start on a low-end device                          | Is 250–400 KB gzipped acceptable on a 2018-class Android Chrome? | Run the deployed PWA on a real device (or use Lighthouse mobile throttling) and measure WASM init time. |
| Memory peak                                             | Does linear-memory grow unboundedly across many files in one worker session? | Drive 50× sequential `process_raw_csv` calls in one worker, observe `WebAssembly.Memory.buffer.byteLength`. |

## 9. Files of record

Everything backing this memo is in the repo:

### Bench scripts (Vite-Node, run with `npx vite-node web/scripts/<name>`)

| Script                                       | Purpose                                           |
|----------------------------------------------|---------------------------------------------------|
| `web/scripts/profile_pipeline_stages.mts`    | 8-stage TS-pipeline wall-clock breakdown          |
| `web/scripts/profile_intl_breakdown.mts`     | per-stage Intl-call attribution                   |
| `web/scripts/bench_kernels_full.mts`         | parse/format/dedup TS-vs-Rust per fixture         |
| `web/scripts/bench_polars_kernel.mts`        | Intl vs lean-WASM vs polars-WASM, format only     |
| `web/scripts/bench_lean_kernel.mts`          | sanity-check standalone lean crate vs polars-bundled lean |
| `web/scripts/bench_sort_and_e2e.mts`         | sort kernel + end-to-end Rust pipeline vs TS      |
| `web/scripts/bench_csv_write.mts`            | CSV-writer kernel bench (write_simple_csv)        |

### Bench output

| File                                          | Bench it came from                  |
|-----------------------------------------------|-------------------------------------|
| `web/.tmp/profile/log.txt`                    | `profile_pipeline_stages.mts`       |
| `web/.tmp/profile/intl_log.txt`               | `profile_intl_breakdown.mts`        |
| `web/.tmp/profile/kernels_full.log`           | `bench_kernels_full.mts`            |
| `web/.tmp/profile/kernels_full.json`          | `bench_kernels_full.mts` (JSON)     |
| `web/.tmp/profile/bench_log.txt`              | `bench_polars_kernel.mts`           |
| `web/.tmp/profile/bench.json`                 | `bench_polars_kernel.mts` (JSON)    |
| `web/.tmp/profile/sort_e2e_log.txt`           | `bench_sort_and_e2e.mts` (re-derived 2026-04-27) |
| `web/.tmp/profile/result.json`                | profile run JSON                    |
| `web/.tmp/profile/intl_result.json`           | Intl-attributed JSON                |

### Prototype Rust crates (the artifacts these benches were run against)

| Crate                                        | Role                                                          |
|----------------------------------------------|---------------------------------------------------------------|
| `rust/chronicle_app_usage_matcher/`          | Matcher core (already production, PyO3 + WASM consumers)      |
| `rust/chronicle_app_usage_wasm/`             | Existing wasm-bindgen wrapper for the matcher                 |
| `rust/chronicle_chrono_kernel_wasm/`         | **Lean kernel crate** — parse, sort, format, dedup, e2e, csv writer. The recommended starting point for the port. |
| `rust/chronicle_polars_kernels_wasm/`        | Polars-WASM prototype. **Reject and remove** once memo is signed off — keep it on a tag if you want, no point keeping it in `main`. |

### Pipeline source being potentially replaced

| File                                          | What it does today                                |
|-----------------------------------------------|---------------------------------------------------|
| `web/src/lib/browserPipeline.ts` (~2,085 lines) | The full TS pipeline. Stays as fallback. Step 5 above does *not* delete it. |
| `web/src/lib/chronicleMatcher.ts`             | Worker-side glue, calls the matcher WASM today. Step 2 extends it. |
| `web/src/workers/chronicle-worker.ts`         | Persistent shared worker. Step 2 wires the e2e entry point through it. |

### Cross-surface parity

| Tool                                          | Purpose                                           |
|-----------------------------------------------|---------------------------------------------------|
| `scripts/run_deterministic_web_parity.py`     | Existing Python↔TS browser parity harness. Extend in Step 0. |

### Acceptance criteria for the port (succeeds when all hold)

1. `cargo test --workspace` green; new e2e module has unit tests for parse / sort / dedup / format / write covering the full Chronicle CSV dialect (with offset, without offset, with `T` separator, with `Z` suffix, with sub-second fractions).
2. `npm run typecheck` and `npm test` (vitest) green with the e2e path enabled.
3. `npm run test:e2e` Playwright suite green on both `useRustE2ePipeline=true` and `useRustE2ePipeline=false`.
4. `python3 scripts/run_deterministic_web_parity.py` green on the full options matrix (not just defaults), comparing all three rows in Step 7's table.
5. Built WASM payload (`web/dist/assets/*.wasm`) is ≤ 400 KB gzipped at the time of merge.
6. The Polars prototype crate is removed from `main`.
7. `web/.tmp/profile/sort_e2e_log.txt` style numbers reproduce within 10% on the same hardware (regression guard against future code changes that re-cross the boundary mid-pipeline).
8. Worker boundary cost is measured and documented in this memo (currently in §8 as an open question).

## 10. Open questions for the implementer

These are decisions left for whoever picks this up — they don't change the recommendation but they need a real answer before code lands:

| Question                                                                  | Default if no answer                                  |
|---------------------------------------------------------------------------|-------------------------------------------------------|
| Crate name for the new e2e crate                                          | `chronicle_browser_pipeline_wasm`                     |
| Whether to keep the Polars prototype crate on a tag or delete it          | Tag `prototype/polars-2026-04-27`, then delete from `main` |
| Whether the Python desktop should also consume the e2e crate via PyO3     | No — separate decision, separate bench, see §8        |
| Whether to extend the parity harness to a full options matrix or stay on default-options parity | Full matrix — see §6.4, the option matrix changes pipeline branches |
| Cold-start budget on a low-end device                                     | Measure on a 2018-class Android Chrome before flipping default in Step 4 |
| Whether to gate the Rust path behind a feature flag in the deployed PWA   | Yes — `BrowserProcessingOptions.useRustE2ePipeline`, dev-only toggle until the parity harness greenlights it |

## 11. Glossary

For an implementer landing cold:

| Term                        | What it means in this repo                                                  |
|-----------------------------|-----------------------------------------------------------------------------|
| Chronicle                   | The data-collection app that produced the raw CSVs this preprocessor consumes |
| Raw CSV                     | A file with `event_timestamp`, `timezone`, `app_package_name`, `interaction_type`, `application_label`, `study_id`, `participant_id`, `username` columns at minimum |
| Matcher                     | The app-usage interval-matching algorithm in `chronicle_app_usage_matcher`. Already Rust. Path-dep'd by both PyO3 (desktop) and wasm-bindgen (browser). |
| Codebook                    | A reference CSV that maps `app_package_name` → categorical metadata (genre, app type, alias names) |
| Filter file                 | A CSV listing apps to mark as "filtered" in the output (typically system / launcher apps) |
| Apps-forcing-screen-open    | A CSV listing apps that force the screen on during a session (used by the screen state machine) |
| Boundary cost               | The per-call overhead of marshalling values across the WASM↔JS edge, dominated by `Vec<String>` cases |
| Lean kernel                 | The chrono-tz-only WASM crate (`chronicle_chrono_kernel_wasm`), no Polars |
| e2e kernel                  | `process_pipeline_e2e` — the single function that takes raw CSV bytes and returns processed CSV bytes |
| TS pipeline                 | `web/src/lib/browserPipeline.ts`, the current production browser preprocessor |
| Parity harness              | `scripts/run_deterministic_web_parity.py`, plus the Step-0 extension that adds Rust-vs-TS browser parity |
| Fallback path               | The TS pipeline, kept reachable when WASM init fails. Mirrors how the Python desktop falls back when `_rust_app_usage_matcher` is missing. |
| Options matrix              | The Cartesian product of `BrowserProcessingOptions` toggles that the parity harness asserts byte-identity over (see §6.4) |
| byteDiff=0                  | The bench harness compared Rust vs TS output byte-by-byte, found zero differences across all rows. The strongest parity signal available. |

## 12. Decision

Build the single end-to-end Rust kernel. Reject Polars. Keep the TS pipeline as the documented fallback. The numbers are 2.92× end-to-end at byteDiff=0 across 407K rows on five real Chronicle fixtures, in a 250–400 KB gzipped WASM budget, with a clear migration path that has byte-identical parity verification at every step.

The work breakdown is well-defined: extend the parity harness, promote the prototype lean crate, wire one feature flag, port the remaining six stages in priority order, flip the default. Each step has a concrete verification command and the parity harness catches any drift the moment it appears.
