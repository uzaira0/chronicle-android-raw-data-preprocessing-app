# Web App Architecture Map (as of 2026-07-14)

> **Historical snapshot, superseded.** The TypeScript processing engine and
> matcher-only WASM paths described here were deleted. Current processing is the
> single query-registry Rust/Salsa runtime; the graph is a Rust-derived UI view.

How `web/` executes today. This is the substrate the pipeline-graph work modifies.

## Shape

Single-page React 19 app; ALL processing runs in-browser inside Web Workers. The heavy
pipeline is plain TypeScript (`src/lib/browserPipeline.ts`); only two hot kernels are WASM
(Rust session matcher + overlap splitter). No server. Plain `useState` in one `App.tsx`
(~20 hooks, no state library). LinkML contract is the options source of truth.

## Processing flow

- `App.processUploadedFiles()` (`App.tsx` ~440-624) → `WorkerPool` fan-out over whole files
  (file-level parallelism, not stage-level).
- Worker: `src/workers/chronicle-worker.ts`, Comlink-exposed
  (`processRawCsv`, `processRawCsvBytes`, `discoverTimezones`, `matcherVersion`);
  computes input SHA-256; lazy WASM init.
- **The pipeline is one linear staged function**: `processRawCsvContent`
  (`browserPipeline.ts` ~2373-2793), stages delimited by `emit(ProgressStepKind)`:
  1. `parse` — Papa Parse → `CanonicalRow[]`, interaction-type remap, bigint-ns timestamps, sort.
  2. `timezone` — handling option, exact dedup, duplicate-timestamp unalign, gap marking.
  3. `filter` — support files loaded; `labelFilteredApps`.
  4. `screen` — `deriveScreenUsageSessions` (TS state machine).
  5. `matcher` — `buildMatcherInput` → WASM `matchAppUsageUpdateIndices` (indices in/out) or
     the JS proximity matcher when `proximityIntervalSeconds > 0` (WASM path lacks proximity);
     WASM `splitOverlappingSessions` when concurrent/background modeling is on.
  6. `codebook` — codebook map build.
  7. `enrich` — codebook columns, engagement/switch details, flags, per-file no-activity
     placeholders, zero-duration filter, interaction-type removals.
  8. `output` — CSV bundles (streamed BlobParts), optional Parquet (hyparquet-writer),
     SPSS .sav, plots, aggregates, interactive timeline, `reviewSummary`.
- Stages operate on immutable snapshots between boundaries — the natural decomposition seam.

## Options model

- `BrowserProcessingOptions` (~44 fields) GENERATED into `src/lib/generatedContract.ts` from
  the LinkML schema `web/schema/chronicle-local-contract.linkml.yaml` via
  `scripts/generate_contract_artifacts.mts` (also emits OpenAPI).
  `scripts/check_contract_consistency.mts` cross-verifies LinkML ↔ TS ↔ OpenAPI (CI:
  `npm run check:contract`). Never hand-edit generated files.
- Only a small subset reaches WASM (`buildMatcherInput`): stop-reuse, fallback flags,
  long-duration threshold (ns), proximity (routes to JS matcher), concurrent masks.
- Persistence: options → localStorage (`chronicle.processingOptions.v1`, versioned envelope,
  `sanitizeOptions` validator); presets → localStorage; config import/export as JSON;
  shareable `?config=` URL carrying the diff-from-defaults; Projects (options + support
  files + raw files as Blobs) → IndexedDB `chronicle-projects`; last-run cache → IndexedDB
  (artifacts stripped).

## WASM coverage

`rust/chronicle_app_usage_wasm` = thin wasm-bindgen wrapper over the shared core crate
`chronicle_app_usage_matcher`, which ALSO compiles to the Python extension — browser and
desktop run byte-identical core matching. Exports: `matchAppUsageUpdateIndices`,
`splitOverlappingSessions`, `matcherVersion`. Everything else is TS.

## Results / view

`ProcessedFileResult` → `ResultPanel` (outputs by kind, ZIPs, warnings, staleness banner,
JSON report) and `ViewPanel` (review timelines per participant, metrics, and an A/B "Arm B"
comparison that re-processes one file under override options and interleaves both runs).

## Parity mechanisms (already exist — extend, don't reinvent)

- Layer A (types): LinkML → TS + OpenAPI with CI consistency check.
- Layer B (algorithm): shared Rust crate compiled to WASM; historically also a Python
  build with fixture-matrix parity scripts (`run_deterministic_web_parity.py`,
  `run_web_parity_matrix.py`) — removed with the desktop engine; final evidence frozen
  in `docs/validation/CORPUS_SOAK.md`.

## What does NOT exist yet

- No DAG/staged-recompute: every option change re-runs the whole pipeline per file. The only
  adjacent concepts: `resultsStale` (JSON.stringify compare → banner), Arm-B comparison,
  last-run cache.
- No section taxonomy in the UI (cards group by topic).
- None of the Clean/Analyze ports (see the [feature inventory](feature-inventory.md)).
