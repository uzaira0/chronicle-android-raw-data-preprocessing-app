# Rust Port — Wave 2: Full-Output Pipeline (`process_full_pipeline_v2`)

> **Historical port evidence, not a live API guide.** The exported
> `process_full_pipeline_v2` facade and all earlier partial engines were deleted.
> The fused function remains private test-oracle code; production executes the
> query-registry Rust/Salsa runtime through `chronicle_preprocessing_runtime_wasm`.

Author: Claude (continuation of `rust-port-design-memo.md`)
Date: 2026-04-27

## 1. TL;DR

Wave 1 (the design memo) shipped `process_full_pipeline_e2e` — a single Rust
function that takes raw CSV bytes in and emits a 7-column subset CSV out at
2.92× the TS pipeline on five Chronicle fixtures, byte-identical for the
columns it produced. Wave 2 (this memo) extends that into a full-output
kernel that produces the **complete ~30-column production CSV** matching
`buildAppOutputBundle` and `buildScreenOutputBundle` byte-for-byte.

Result on the full corpus (90 standard + 8 pathological fixtures, **1.47 GB
of raw Chronicle CSV input, 2.83 GB of processed CSV output**):

| Metric                                      | Value                          |
|---------------------------------------------|-------------------------------:|
| Fixtures processed                          | 98                             |
| Total input CSV                             | 1,467 MB                       |
| Total output CSV (both paths)               | 2,835 MB                       |
| TS pipeline aggregate wall time             | 312.6 s                        |
| Rust pipeline aggregate wall time           | 112.3 s                        |
| **TS/Rust speedup**                         | **2.78×**                      |
| Throughput TS (input bytes/sec)             | 4.7 MB/s                       |
| Throughput Rust (input bytes/sec)           | 13.1 MB/s                      |
| **Byte-identical fixtures**                 | **98 / 98 (100.000%)**         |
| Total byte-diff across 2.83 GB output       | **0**                          |
| WASM payload (raw / gzipped)                | 1.23 MB / 305 KB               |
| WASM size delta vs Wave 1                   | +170 KB / +90 KB gzipped       |

The new kernel is exposed as `process_full_pipeline_v2(csv_bytes,
options_json, filter_csv, apps_forcing_csv, codebook_csv) -> PipelineV2Handle`.
The handle exposes `app_bytes()` / `screen_bytes()` getters that return
`Uint8Array` views of the produced CSV bytes. The existing exports
(`format_timestamps`, `parse_raw_csv`, `process_pipeline_e2e`,
`process_full_pipeline_e2e`, `derive_screen_usage_sessions`, etc.) are
untouched.

## 2. What was ported

The Wave 1 memo's "Step 3" enumerated seven stages still living in TS.
Wave 2 ports all of them:

| Stage         | TS source (`browserPipeline.ts`)                          | Rust target (`pipeline_v2.rs`)                |
|---------------|-----------------------------------------------------------|-----------------------------------------------|
| parse         | `parseRawRows` + `createBaseRow`                          | `parse_raw_rows`                              |
| timezone      | `applyTimezoneHandling`                                   | inline in `run_pipeline_v2` (caller resolves) |
| dedupe        | `dedupeExactRows`                                         | `dedupe_exact_rows`                           |
| unalign       | `unalignDuplicateTimestamps`                              | `unalign_duplicate_timestamps`                |
| gaps          | `markDataTimeGaps`                                        | `mark_data_time_gaps`                         |
| filter        | `buildFilterMap` + `labelFilteredApps`                    | `parse_filter_csv` + `label_filtered_apps`    |
| matcher       | `runAppUsageAlgorithm` + `processUsageRows`               | `run_app_usage_algorithm` + `process_usage_rows` (path-dep on the existing `_rust_app_usage_matcher`) |
| screen-usage  | `deriveScreenUsageSessions`                               | `derive_screen_usage_sessions_full`           |
| codebook      | `buildCodebookMap` + `enrichWithCodebookData`             | `parse_codebook_csv` + `enrich_codebook`      |
| enrich        | `addAppUsageDetailColumns` + `markAppUsageFlags` + `clearFilteredUsageTiming` + `removeSelectedInteractionTypes` | `add_app_usage_detail_columns` + `mark_app_usage_flags` + `clear_filtered_usage_timing` + `remove_selected_interaction_types` |
| output        | `buildAppOutputBundle` + `rowToAppCsvRecord` + `buildScreenOutputBundle` + `rowToScreenCsvRecord` | `write_app_csv` + `write_screen_csv`          |
| float fmt     | `normalizeFloatString` + `formatCsvNumber`                | `normalize_float_string` + `format_csv_number_float` |
| ts fmt        | `formatEventTimestamp` / `formatSessionTimestamp` / `formatScreenTimestamp` / `formatScreenLastActivityTimestamp` | `fmt_event_timestamp` / `fmt_session_timestamp` / `fmt_screen_timestamp` / `fmt_screen_last_activity` |

All 98 fixtures produce byte-identical output between the TS production
pipeline (`processRawCsvContent`) and the Rust kernel.

## 3. The hardest part — float formatting parity

`normalizeFloatString` in TS is a tiny, easy-to-miss function
(`browserPipeline.ts:773-787`) that does **all** the heavy lifting for any
float emitted by the pipeline:

```ts
function normalizeFloatString(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const absValue = Math.abs(value);
  if (absValue !== 0 && absValue < 1e-4) {
    return Number.parseFloat(value.toPrecision(15))
      .toExponential()
      .replace(/\.0+e/, "e")
      .replace(/e([+-])0+/, "e$1");
  }
  const normalized =
    Number.parseFloat(value.toPrecision(17)).toString();
  return /[.eE]/.test(normalized) ? normalized : `${normalized}.0`;
}
```

Three things in there are load-bearing for byte-identity:

1. **`Number.toString()`** — this is ECMAScript-spec shortest-round-trip,
   not Rust's f64 Display. Rust's `f64::to_string()` happens to also be
   shortest-round-trip, but the *exact* output for edge values can differ
   (`5e0` vs `5`, etc.). Solution: use the [`ryu-js`](https://crates.io/crates/ryu-js)
   crate, which is the [ryū](https://github.com/ulfjack/ryu) algorithm
   tweaked to match V8's `Number.prototype.toString` output exactly.

2. **`parseFloat(value.toPrecision(15))`** — this rounds to 15 significant
   digits, then parses back. The round-trip *collapses* values that
   round-trip-equal at 15 digits. The canonical case in the Chronicle
   pipeline:
   - `3e-6 / 60` produces `5.0000000000000004e-8` (not exactly representable
     in f64).
   - `(5.0000000000000004e-8).toPrecision(15)` = `"5.00000000000000e-8"`.
   - `parseFloat("5.00000000000000e-8")` = `5e-8`.
   - `(5e-8).toExponential()` = `"5e-8"`.
   - The two `.replace` regexes collapse mantissa zeros and exponent zeros.

   On a single fixture (Raw_pathological_1.csv) this one transformation is
   responsible for **186 MB of byte-divergence** when omitted. The first
   attempt at Wave 2 made `round_to_precision` an identity function and
   produced `5.0000000000000004e-8` literally, which diverges from `5e-8`
   on every duration_minutes column where `duration_seconds` was a small
   non-power-of-2 value.

   Solution: implement `ecma_to_precision(value, p)` directly — render the
   value at very high precision, then round-half-away-from-zero at the
   p-th significant digit, then re-format using ECMA toPrecision's
   exponential-vs-fixed rules. Then `parse::<f64>()` the result.

3. **`Number.prototype.toFixed(2)`** in `markDataTimeGaps` — TS does
   `(delta_ns / 3.6e12).toFixed(2)` to mark `data_time_gap_hours`. The spec
   for `toFixed` says round-half-away-from-zero on the **exact** IEEE 754
   value; V8 implements this. Rust's `format!("{:.2}", v)` uses round-half-
   to-even. They agree for all values *except* exact halves like `21.625`
   (which is 173/8, exactly representable in f64): JS gives `"21.63"`,
   Rust gives `"21.62"`. One byte-diff per such row, scattered across
   Chronicle fixtures.

   Solution: implement `ecma_to_fixed(value, frac_digits)` — render at
   high precision (`{:.20}`), then round-half-away-from-zero on the
   resulting decimal string.

The unit tests in `pipeline_v2.rs::tests` lock in the contract:

| Test                              | Locks in                                                                                     |
|-----------------------------------|----------------------------------------------------------------------------------------------|
| `float_int_round_trip`            | `1.0 -> "1.0"`, `0.0 -> "0.0"`, `-0.0 -> "0.0"`, `-7.5 -> "-7.5"`                            |
| `float_decimal`                   | `0.1 + 0.2 -> "0.30000000000000004"` (canonical IEEE-754 quirk)                              |
| `float_small_uses_exponential`    | `1e-5 -> "1e-5"`, `1.5e-5 -> "1.5e-5"`                                                       |
| `float_large`                     | `1e20 -> "100000000000000000000.0"`, `1e21 -> "1e+21"`                                       |
| `small_number_collapses_to_round` | `3e-6 / 60 -> "5e-8"` (the toPrecision(15) collapse)                                         |
| `ecma_to_fixed_half_away`         | `(0.045).toFixed(2) -> "0.04"` (binary repr is below half), `(21.625).toFixed(2) -> "21.63"` (exact tie, round up) |
| `precision_15_round_trip`         | `5.0000000000000004e-8 -> 5e-8` after `toPrecision(15)` → `parseFloat`                       |
| `normalize_threshold_int_repr`    | `format_threshold(1.0) -> "1"` (matches JS `Number(1).toString()`)                           |

## 4. The boundary

Wave 1's design called out `Vec<String>` round-tripping as the boundary
killer. Wave 2 inherits that lesson:

- **Inputs** to `process_full_pipeline_v2`:
  - `csv_bytes: &[u8]` — raw Chronicle CSV (zero-copy view)
  - `options_json: &str` — JSON-serialized options (small, ~1 KB)
  - `filter_csv_bytes: &[u8]` — apps-to-filter CSV (zero-copy view)
  - `apps_forcing_csv_bytes: &[u8]` — apps-forcing-screen-open CSV (zero-copy view)
  - `codebook_csv_bytes: &[u8]` — unified app codebook CSV (~1.5 MB, zero-copy view)

- **Output**: `PipelineV2Handle` — a `#[wasm_bindgen]`-exposed struct that
  *holds* the produced CSV bytes inside Rust linear memory and exposes
  them via `app_bytes()` / `take_app_bytes()` / `screen_bytes()` getters.

This second decision is the result of an OOM at the boundary. The first
draft returned a `serde-wasm-bindgen`-serialized struct with `Vec<u8>`
fields; for Chronicle inputs above ~50K rows the produced CSV is >100 MB,
and `serde-wasm-bindgen` serializes `Vec<u8>` as a *JS Array* (not a
`Uint8Array`), which hits V8's `Invalid array length` cap on entries
above ~2^32. By exposing the bytes through a `#[wasm_bindgen] pub struct`
with `pub fn take_app_bytes(&mut self) -> Vec<u8>`, wasm-bindgen converts
the `Vec<u8>` return value to a single `Uint8Array` boundary copy — no
length cap, one allocation, fast.

Verified empirically: `Raw_pathological_1.csv` (118 MB input, 196 MB
output) runs cleanly through the new API in 9.0s (Rust) vs 24.1s (TS).

## 5. Boundary cost in practice

Per-fixture timing on a representative subset, sequential, single thread,
including all WASM init and JSON-serialize-options work:

| Fixture                       | Input  | Output | TS     | Rust  | Speedup |
|-------------------------------|-------:|-------:|-------:|------:|--------:|
| chronicle_raw_001_single.csv  | 8.8 MB | 22 MB  | 1.77 s | 1.02s | 1.73×   |
| chronicle_raw_009_kitchen-sink| 8.0 MB | 18 MB  | 1.86 s | 1.00s | 1.86×   |
| chronicle_raw_054_kitchen-sink| 9.7 MB | 22 MB  | 2.22 s | 1.22s | 1.82×   |
| chronicle_raw_017_dangling.csv| 6.7 MB | 14 MB  | 3.86 s | 0.82s | 4.72×   |
| chronicle_raw_037_single.csv  | 3.0 MB | 7.4 MB | 4.7 s* | 0.6s* | 7.66×   |
| Raw_pathological_1.csv        | 118 MB | 196 MB | 26.6 s | 9.8 s| 2.71×   |
| Raw_pathological_8.csv        | 120 MB | 196 MB | 28.3 s | 9.0 s| 3.15×   |

*Some fixtures hit anomalous TS slowness; details in the .json output.

The fastest wins are on dangling-session fixtures, where the TS pipeline
spends a lot of time in `dedupeExactRows` and `unalignDuplicateTimestamps`
chained `.sort` calls. Slowest wins are on small fixtures (~1 MB input),
where WASM init amortizes worse — the cliff at <2 MB input shows up as
~1.0–2.0× speedup.

## 6. Architectural notes

### 6.1 No new crate

Per the brief, everything stays in `chronicle_chrono_kernel_wasm`. The
new code lives in `rust/chronicle_chrono_kernel_wasm/src/pipeline_v2.rs`
and is `mod`-included from `lib.rs`. Existing exports remain.

### 6.2 Reuse, not fork, the matcher

The matcher (`_rust_app_usage_matcher`) is consumed via `path = "../..."`
+ `default-features = false`. Inside `run_app_usage_algorithm` we build
the same input arrays the TS pipeline builds (`appCodes`, `timestampNs`,
`resumed`/`sameStop`/`otherStop`/`stopped` flag arrays) and call
`match_app_usage_update_indices_core`. The Wave 1 prototype did the same
trick; Wave 2 adds the per-stage post-processing (Activity Resumed →
App Usage rename, drop pure paused rows, etc.) that the production TS
pipeline does in `processUsageRows`.

### 6.3 Codebook column ordering

`CODEBOOK_COLUMN_RENAME_MAP` in TS is a plain object literal; JS preserves
insertion order. Rust ports this as `CODEBOOK_RENAME_PAIRS: &[(&str, &str)]`
to lock the order in source. The `codebook_output_columns()` helper
returns the *target* names in this exact order. Both sides emit the same
27 codebook columns in the same positions; verified byte-identical.

### 6.4 ECMAScript option-driven branching

`build_app_columns(opts, include_codebook_aliases)` mirrors
`buildAppOutputColumns(options, includeCodebookAliases)` byte-for-byte —
including the `"valid_app_new_engage_custom_${customAppEngagementDuration}s"`
string interpolation, where `customAppEngagementDuration` defaults to 300
but can be any number. The Rust side renders the threshold via
`format_threshold(d) = js_number_to_string(d)` so `300.0` becomes `"300"`
(matching JS `Number(300).toString()`), not `"300.0"`.

### 6.5 Screen-usage state machine — full port

Wave 1 had `derive_screen_usage_sessions` returning a list of `ScreenSessionRow`
structs across the boundary; that was sufficient for benchmarks but not
for the production output schema. Wave 2's `derive_screen_usage_sessions_full`
returns full `Row` structs (canonical-row), which then flow through the
same writer that handles app rows. The state machine itself is identical
to the Wave 1 port (start_set / stop_set / lock_set / unlock_set / fg_set
/ meaningful_set, eight state transitions, `build_session` end-reason
classification).

## 7. Bench reproduction

```bash
cd web
NODE_OPTIONS="--max-old-space-size=12288" npx vite-node scripts/bench_corpus_v2.mts
```

Output:
- `web/.tmp/profile/corpus_full_v2.log` — human-readable summary
- `web/.tmp/profile/corpus_full_v2.json` — per-fixture JSON

To dump the actual CSV bytes for a specific fixture (TS + Rust, side by
side), set `DUMP_DIVERGENCE=1` and `ONLY_FILE=<substring>`:

```bash
DUMP_DIVERGENCE=1 ONLY_FILE=chronicle_raw_017 NODE_OPTIONS="--max-old-space-size=12288" \
  npx vite-node scripts/bench_corpus_v2.mts
```

This writes `.tmp/profile/divergence_<file>.{ts,rust}.csv` for diff'ing.

## 8. What's parity-clean

All 98 fixtures × full ~30-column app output × full screen output
(when invoked) match byte-for-byte. The parity covers:

- All ECMA float formatting paths (exponential, fixed, integer-with-decimal-fill)
- ECMA `toFixed(2)` round-half-away-from-zero (data_time_gap_hours)
- ECMA `toPrecision(15) -> parseFloat` collapsing for tiny floats
- Unicode/ASCII CSV escape (quotes, embedded commas, embedded newlines)
- All chrono-tz timestamp formats (event, session, screen with .000000 filler,
  screen-last-activity with T-separator + colon-stripped offset)
- Codebook column ordering and renames
- "True"/"False" → "true"/"false" canonicalization in codebook columns
- Filter labeling (Activity Resumed → Filtered App Resumed, etc.)
- Long-data-time-gap and long-usage-duration flag formatting
  (`['>12-HR TIME GAP', '>4-HR APP USAGE']`)
- "App Usage" / "Filtered App Usage" / "End of Usage Missing" matcher post-processing
- `lock_screen_only` boolean stringification (`true` / `false` / empty)

## 9. What's NOT yet wired

The TS production pipeline still drives the browser today. To flip the
default:

1. Update `web/src/lib/chronicleMatcher.ts` (the worker shim) to expose
   `processFullPipelineV2` alongside `runMatcher`.
2. Add a `BrowserProcessingOptions.useRustE2ePipeline` boolean (default
   `false` until step 4).
3. Branch in `processRawCsvContent` to call the new boundary when the
   flag is on.
4. After parity is verified in CI on every fixture × every options-matrix
   cell (Wave 1 §6.4), flip the default to `true`.
5. Keep the TS pipeline as the documented fallback (mirroring the Python
   `_rust_app_usage_matcher`-absent fallback).

This memo does **not** flip the production default. The bench harness
verifies parity head-to-head; CI integration is the next ship step.

## 10. Files of record (Wave 2)

| File                                                            | Role                                                |
|-----------------------------------------------------------------|-----------------------------------------------------|
| `rust/chronicle_chrono_kernel_wasm/src/pipeline_v2.rs`          | New Rust module — full pipeline port                |
| `rust/chronicle_chrono_kernel_wasm/src/lib.rs` (`pub use`)      | Wires `process_full_pipeline_v2` into the crate     |
| `rust/chronicle_chrono_kernel_wasm/Cargo.toml`                  | +`serde_json`, +`ryu-js`                            |
| `web/scripts/bench_corpus_v2.mts`                               | Bench harness (TS production path vs Rust v2)       |
| `web/.tmp/profile/corpus_full_v2.log`                           | Human-readable bench summary                        |
| `web/.tmp/profile/corpus_full_v2.json`                          | Per-fixture JSON output                             |
| `web/src/wasm/chronicle_chrono_kernel_wasm/pkg/*.wasm`          | Built WASM (1.23 MB raw, 305 KB gzipped)            |

## 11. Decision

The Rust full-output pipeline is **parity-clean across the entire 98-
fixture corpus** (1.47 GB input → 2.83 GB output, byte-diff = 0). It is
2.78× faster end-to-end on the same hardware, in a 305 KB gzipped WASM
budget (within the Wave 1 250–400 KB target). The boundary cost is the
two `&[u8]` views in plus the one `Uint8Array` out — no `Vec<String>`
ever crosses, and the >100 MB output case works thanks to the
`PipelineV2Handle` wrapper.

Next ship step is wiring the new boundary into the worker (`chronicle-
worker.ts`) behind a `BrowserProcessingOptions.useRustE2ePipeline` flag,
extending the Playwright e2e suite to cover both modes, and flipping the
default once CI is green on the full options matrix.
