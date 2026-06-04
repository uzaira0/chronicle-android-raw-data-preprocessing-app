# Feature Ideas & Implementation Plan

Curated backlog for the Chronicle Android Raw Data Preprocessor, selected
2026-06-04. Tags: **[infra]** = builds on existing infrastructure (low-friction);
**[net-new]** = new subsystem. Each feature notes its **surface impact** —
whether it touches the parity-checked output (Python oracle `polars_fast_path.py`
+ Rust/WASM matcher + web `browserPipeline.ts`) or is web-only.

> **Parity rule:** any change to output **rows or columns** must land on all
> three surfaces and stay byte-identical under `make parity`
> (`scripts/run_deterministic_web_parity.py`). View-only, format-only, and
> UI-only features have **no parity impact**.

---

## Selected features (this round)

### Data processing & correctness

#### 1. Event-integrity pre-flight validator — [infra]
Scan uploaded CSVs *before* processing for malformed rows, out-of-order
timestamps, missing/renamed columns, and unexpected interaction types. Surface
an actionable per-file report (row numbers, the specific problem, suggested fix)
instead of failing mid-pipeline or silently dropping rows.
*Surface impact: web-only preflight (no parity impact). Extends the existing file-inspection step.*

#### 2. Duplicate-event detection & dedup — [net-new]
Flag exact-duplicate raw rows (same participant/timestamp/app/interaction —
common in re-exported Chronicle data) and offer an opt-in collapse. Builds on
the existing `correctDuplicateEventTimestamps` option but targets whole-row
duplicates, not just timestamp collisions.
*Surface impact: changes output rows → all three surfaces, parity-checked.*

#### 4. Custom interaction-type remapping — [infra]
A UI to map vendor-specific raw interaction-type strings onto the canonical set
the matcher understands (resumed / stopped / etc.), for non-standard Chronicle
exports. Extends the existing `sameAppInteractionTypesToStopUsageAt`-style config.
*Surface impact: changes matcher input → all three surfaces, parity-checked.*

### Output formats

#### 7. Parquet / Arrow export — [net-new]
Export the cleaned output as Parquet (and/or Arrow IPC) alongside CSV — far
faster downstream loads in R/Python for large cohorts, with preserved dtypes.
*Surface impact: serialization wrapper over existing rows (no row/column change → no parity impact, but the bytes themselves should be verified equivalent to the CSV content).*

#### 8. Daily / weekly aggregate summaries — [infra]
A separate output: per-participant-per-day (and per-week) screen time, total
sessions, top-N apps, total app-usage time. Derived from the same cleaned rows.
*Surface impact: new derived output. Decide one canonical surface to compute it, then parity-check the aggregate across surfaces.*

#### 9. SPSS `.sav` / Stata `.dta` export — [net-new]
Export in the statistical formats most used in behavioral-science workflows,
with variable labels sourced from the schema/codebook.
*Surface impact: serialization wrapper (no parity impact on row content).*

#### 10. Codebook-joined output column — [infra]
Optionally inline the resolved app **category** as a column in the main output
(categories are already derived for plots by coalescing per-source columns).
*Surface impact: new output column → all three surfaces, parity-checked.*

#### 12. Long ⇄ wide format toggle — [infra]
Toggle daily aggregates between long (tidy, one row per participant/day/metric)
and wide (one row per participant/day, metrics as columns) shapes.
*Surface impact: reshape of the aggregate output (depends on #8); parity-check the chosen shapes.*

### Analysis & metrics

#### 13. Fragmentation metrics — [infra]
Per-participant-per-day: number of app switches, pickups/day, mean session
length, longest session. Standard screen-time-research measures.
*Surface impact: new derived metrics (part of the #8 aggregate family); parity-checked.*

#### 15. First-unlock / last-use-of-day — [infra]
Per participant per day: timestamp of first unlock / first app use and last use,
plus the active window span.
*Surface impact: derived metric (#8 family); parity-checked.*

#### 16. App co-usage matrix — [infra]
Which apps are used concurrently, leveraging the concurrent-usage layer
(primary/secondary) already shipped. Output as a pairwise matrix / edge list.
*Surface impact: new derived output built on the concurrent-usage layer; parity-checked.*

#### 17. Category-level time budgets — [infra]
Total time per app **category** per participant per day (depends on the codebook
join, #10).
*Surface impact: derived metric (#8 family); parity-checked.*

### Visualization (web-only — no parity impact)

#### 18. Interactive timeline (zoom / pan / hover) — [infra] — *elaborated*
**Today:** `plotGenerator.ts` renders **static** raster timelines to a Canvas
(per-participant day rows, app-usage / screen bands, gap bands, category
colours) and exports PNG. There is no zoom, pan, or hover detail.

**Proposal — an interactive in-browser timeline explorer:**
- **Layout:** horizontal axis = time; rows = days (or one continuous scrollable
  timeline). Each session is a band coloured by app/category (reusing the
  existing category-colour logic).
- **Zoom:** wheel / pinch zooms the time axis, from whole-study overview down to
  seconds; quick buttons for fit-day / fit-week / fit-all.
- **Pan:** click-drag or shift-scroll along time; keyboard arrows; an
  overview+detail "brush" strip for fast navigation across long studies.
- **Hover tooltip:** app label, package name, category, start/end (in the
  participant's timezone), duration, interaction type, and concurrent-usage
  layer (primary/secondary).
- **Click-to-inspect:** clicking a session opens a detail panel and/or
  highlights the underlying raw rows.
- **Layer toggles:** show/hide screen-usage, app-usage, background apps, gaps;
  toggle concurrent-usage layering live.
- **Rendering:** keep Canvas for performance (thousands of sessions) but add a
  **hit-test layer** — a spatial index mapping rendered rects → session
  metadata — for hover/click. **Virtualize** by drawing only the visible time
  window for large datasets.
- **Reuse / consistency:** drive it from the **same data model** the static
  plots consume, so the interactive view and the PNG/vector exports stay
  consistent; gap bands from the gap sidecar; colours from the existing
  coalescing logic.
- **Surface impact:** web-only, view over already-computed output — **no parity
  impact.**

#### 19. Hour × day activity heatmap — [infra]
Per-participant heatmap (hour-of-day × calendar-day) of screen/app activity
intensity — a fast visual read of daily rhythms.
*Surface impact: web-only plot.*

#### 21. Vector plot export (SVG / PDF) — [infra]
Export plots as SVG/PDF (vector) for publication figures, in addition to PNG.
*Surface impact: web-only; a vector rendering path alongside the Canvas path in `plotGenerator.ts`.*

### Workflow, reproducibility & scale (web-only unless noted)

#### 22. Named "projects" — [infra]
Persist a full processing config **plus the uploaded file set** to IndexedDB
under a name, so a researcher can close the tab and resume later.
*Surface impact: web-only; extends settings persistence.*

#### 23. Shareable config (URL or JSON) — [infra]
Encode the full settings into a shareable URL and/or a downloadable JSON, so a
collaborator can reproduce an exact run configuration.
*Surface impact: web-only; serialize/deserialize the settings schema.*

#### 24. Folder / ZIP import + ZIP-of-all-outputs export — [infra]
Drag a whole folder (or a ZIP) of participant CSVs in; download every output
(CSVs, plots, sidecars, manifest) as a single ZIP.
*Surface impact: web-only; extends file input and output download.*

#### 25. Run-manifest provenance sidecar — [infra]
Emit a JSON sidecar for every run recording app/preprocessor version, the full
settings, input file names + hashes, and the run timestamp — generalizing the
plot-version stamping from PR #22 to *all* outputs, for reproducibility.
*Surface impact: new sidecar output; generated from settings/inputs (no parity impact on the data rows, but the manifest content should be deterministic/verifiable).*

---

## Deferred (not selected this round)
3 (per-participant timezone override), 5 (configurable gap threshold + gap
report), 6 (midnight-spanning session toggle), 11 (output column
selection/reordering), 14 (night-time usage flag), 20 (two-up comparison view).

---

## Implementation Plan

### Architecture grounding (from codebase exploration)

Three surfaces; **output rows/columns must stay byte-identical** under
`make parity`:
- **Python oracle:** `src/chronicle_preprocessing_app/core/preprocessing/polars_fast_path.py`
- **Rust/WASM matcher:** `rust/chronicle_app_usage_matcher/` (concurrent-split SSOT; *none of these features change the matcher*)
- **Web pipeline:** `web/src/lib/browserPipeline.ts` (the deployed surface)

Mechanics that every output-affecting feature must follow:
- **Output columns are hardcoded in two places, kept in sync by hand:** Python
  `_build_output_columns()` (`polars_fast_path.py` ~L1308) and web
  `buildAppOutputColumns()` / `buildScreenOutputColumns()` (`browserPipeline.ts`
  ~L1808/L1855). A new column must be inserted at the **exact same position** on
  both; the parity test catches drift.
- **Processing options have one source of truth:** the LinkML schema
  `web/schema/chronicle-local-contract.linkml.yaml` →
  `web/scripts/generate_contract_artifacts.mts` regenerates
  `web/src/lib/generatedContract.ts` + `web/openapi/chronicle-local-api.yaml`;
  mirror the field in Python `core/config.py` (`PreprocessingOptions`). Adding an
  option = add slot → regenerate (`npm run check:contract` verifies) → implement
  on all surfaces.
- **Parity harness:** `scripts/run_deterministic_web_parity.py` compares
  `app_usage` + `screen_usage` CSVs row/column-exact over a pathological fixture.
  New conditional columns/outputs need an additive scenario here.

### Already-built foundations (these "features" are extensions, not net-new)

Exploration found substantial reuse — honest effort framing:
- **#23 shareable config:** `buildConfigExportBlob()` / `readConfigFile()` +
  a presets library (`chronicle.processingPresets.v1`) already exist in
  `settingsPersistence.ts`. → Only the **URL-encode/decode** path is new.
- **#24 ZIP export:** `web/src/lib/zip.ts createZipBlob()` (store mode) +
  `downloadZip()` already bundle every output. → Only the **import** half
  (folder drop + reading input ZIPs) is new.
- **#25 run manifest:** `buildProcessingReport()` already emits
  `chronicle-processing-report.json` (version, options, per-file stats) into
  every ZIP. → This is an **enhancement** (add file hashes, runId, environment).
- **#10 category column:** `deriveBroadAppCategory()` already computes the
  category for plots. → Just an **opt-in flag + emit the existing value** as a
  column.

### Cross-cutting decision: aggregation parity (the one genuinely hard risk)

The aggregate family (#8/#12/#13/#15/#16/#17) is net-new and parity-sensitive.
**Standard = strict byte-identical** (this project's default), made cheap by a
design constraint, not a later patch:
- **Integer accumulation.** Sum durations as **integer nanoseconds/microseconds**
  and keep **integer counts**; divide to seconds/minutes **exactly once at the
  end**, using the same micro→second division the row code already uses
  (`polars_fast_path.py:773`), with one defined rounding rule. Means =
  `integer_sum / integer_count`, rounded once. This avoids polars-vs-JS
  float summation-order drift (which this codebase has already hit for single
  durations).
- **Canonical group sort:** `(participant_id, date|week[, app|category])` so row
  order matches across surfaces.
- Aggregation parity is a **separate, simpler scenario** than matcher parity —
  pure post-processing over already-parity'd rows, Rust uninvolved — **additive**
  to `run_deterministic_web_parity.py`.

### Per-feature actionable spec

Legend: **Surfaces** = py(thon oracle) / web / rust · **Opt** = new LinkML
option · **Parity** = needs a parity scenario · **Dep** = depends on.

| # | Feature | Surfaces | Opt | Parity | Libs to add | Dep |
|---|---------|----------|-----|--------|-------------|-----|
| 1 | Preflight validator | web | no | no | — | — |
| 2 | Whole-row dedup | py+web | yes | yes (extend) | — | — |
| 4 | Interaction-type remap | py+web | yes | yes | — | — |
| 10 | Category output column | py+web | yes | yes (new column) | — | category derivation (exists) |
| 8 | Daily/weekly aggregates | py+web | yes | **yes (new agg scenario)** | — | integer-accum strategy |
| 13 | Fragmentation metrics | py+web | yes | yes | — | #8 |
| 15 | First-unlock / last-use | py+web | yes | yes | — | #8 |
| 17 | Category time budgets | py+web | yes | yes | — | #8 + #10 |
| 16 | App co-usage matrix | py+web | yes | yes (new scenario) | — | concurrent-usage layer (exists) |
| 12 | Long ⇄ wide toggle | py+web | yes | yes | — | #8 |
| 7 | Parquet export | web (py opt) | maybe | content-equiv test | parquet writer (**spike**: hyparquet / parquet-wasm) | #8 (opt) |
| 9 | SPSS/Stata export | web or py | maybe | content test | `.sav`/`.dta` writer (**feasibility spike** — scarce in JS) | — |
| 18 | Interactive timeline | web | no | no | — (canvas hit-test util) | plot data model (exists) |
| 19 | Hour×day heatmap | web | maybe (toggle) | no | — | plotGenerator |
| 21 | SVG/PDF vector export | web | maybe (format) | no | maybe svg→pdf (or browser print) | plotGenerator |
| 22 | Named projects | web | no (own store) | no | IndexedDB (native / `idb-keyval`) | — |
| 23 | Shareable config URL | web | no | no | — | config export (exists) |
| 24 | Folder/ZIP import | web | no | no | ZIP **decoder** (`fflate`) | zip.ts export (exists) |
| 25 | Run-manifest enhance | web | no | no | — (`SubtleCrypto` for hashes) | `buildProcessingReport` (exists) |

### Phased sequence (de-risks the hard parity work behind a trivial instance of the same pattern)

**Phase 1 — Web-only quick wins / extensions (no parity risk; build momentum).**
#25 manifest enhancement → #23 config URL → #1 preflight validator → #19
heatmap → #21 SVG/PDF export. All are isolated web changes, several extending
code that already exists.

**Phase 2 — Establish the "add option/column + parity scenario" pattern.**
#10 category column first (cleanest — value is already computed, so it's purely
the add-column-on-both-surfaces + parity-scenario dance), then #2 whole-row
dedup, then #4 interaction-type remap. After this, the parity workflow is
muscle memory.

**Phase 3 — Aggregation subsystem (apply the integer-accumulation strategy).**
#8 foundation (new aggregate output + canonical sort + integer accum + new
parity scenario) → then #13 / #15 / #17 (#17 needs #10) / #12 as columns/shapes
on the same aggregate → #16 co-usage matrix (new output off the concurrent-usage
layer).

**Phase 4 — Output formats (once there's rich output worth exporting).**
#7 Parquet (library spike + content-equivalence test against the CSV) → #9
SPSS/Stata (**feasibility-gated**; if no viable in-browser writer, fall back to
Python-side export or document a Parquet→`.sav` conversion path — the plan must
not hinge on a library that may not exist).

**Phase 5 — Heavy lift.**
#18 interactive timeline (React/Web-component refactor of `plotGenerator.ts`
with a hit-test spatial index + viewport virtualization) → #22 named projects
(IndexedDB store for config + uploaded file blobs).

### Risks, spikes & design constraints

- **Aggregation float parity** → integer accumulation + canonical sort (above).
  This is the single most important constraint; design it in from #8.
- **#9 writer feasibility** → spike before committing; in-browser `.sav`/`.dta`
  *writers* are scarce (readers aren't). Fallback ready.
- **#7 Parquet** → evaluate library + bundle-size impact in a spike.
- **#25 file hashing** → run SHA-256 **in the worker**, not the main thread
  (batches can be 90+ files).
- **#22 projects** → storing raw CSV blobs in IndexedDB has **quota/eviction**
  implications; cap sizes and warn the user; consider storing only config +
  file metadata with an opt-in for full blobs.
- **Every parity-affecting feature** follows the same checklist: LinkML slot →
  regenerate contract → Python `config.py` + logic → web logic → identical
  output-column position → new/extended parity scenario → tests on all surfaces.

### Testing approach (per `testing-encyclopedia`)

- **Cross-surface parity** scenario for every output-affecting feature, additive
  to `run_deterministic_web_parity.py` (the existing `make parity` gate).
- **Python pytest** for aggregation/dedup/remap on the oracle.
- **Web vitest** for new pure functions (aggregation, dedup, URL-encode, ZIP
  import, hashing) and **plot-geometry tests** (in the style of the existing
  `drawDataGaps.test.ts`) for heatmap cells and timeline hit-testing.
- **e2e smoke** additions for new download buttons and the import flow.
- **No Rust changes** expected — the matcher is untouched by this backlog.

### Status

**Phase 1 — in progress.** Delivered (web-only, no parity risk):
- ✅ **#25** Run-manifest provenance — runId, per-file input SHA-256 (hashed in
  the worker), environment; report builder extracted to a pure tested lib.
- ✅ **#23** Shareable settings via URL (`?config=` diff-from-defaults link).
- ✅ **#1** Preflight validator — out-of-order timestamps + unrecognized
  interaction types; interaction-type map extracted to `interactionTypes.ts`.
- ✅ **#19** Hour×day activity heatmap (pure tested `computeHourDayMatrix` +
  scene/Canvas renderer), now behind a default-on `enable_activity_heatmap`
  toggle so it doesn't silently double the plot file count.
- ✅ **#21** Vector SVG export (separate PR, stacked on Phase 1). A shared
  `plotScene` model (rect/text/line/poly primitives) is rendered to either
  Canvas (PNG) or SVG, so the two can't drift; the timeline + heatmap now route
  through `buildTimelineScene` / `buildHeatmapScene`. Emitted as `.svg` siblings
  behind a default-off `export_plots_as_svg` toggle.

**UX self-review fixes folded into the Phase-1 PR** (things that would surprise a
real user, found on review):
- **#1** out-of-order detection was global across the whole file → false-flagged
  every participant boundary in a multi-participant export. Now scoped per
  `participant_id`. Also: the warning pointed users at "interaction-type
  remapping", **a feature that doesn't exist** — reworded to point at the
  stop-type / remove lists that do.
- **#23** opening a shared `?config=` link silently overwrote the recipient's own
  saved settings on mount. Now the first persist is skipped on shared-init, so
  saved settings survive until the recipient actually edits one.
- **#19** heatmap dropped a midnight-crossing session's post-midnight slice when
  that date had no other activity. The axis now spans each session's actual
  dates. Plus the default-on toggle above.
- **#25** runId/generatedAt are memoized on `[results, options]`, so Copy-report
  and every ZIP download share one value (the feared divergence was not real);
  the full userAgent stays in the local-only report as provenance.

Validation: `tsc --noEmit` clean, vitest 87 passed, contract check ok,
production build ok, Playwright e2e 32 passed (real canvas plot path verified
after the scene refactor).

**Phase 2 — in progress (parity-affecting).**
- ✅ **#10** Opt-in normalized `broad_app_category` output column (PR #28). Established the add-option-on-both-surfaces + parity-scenario pattern: ported the web `deriveBroadAppCategory` normalization into the Polars oracle (`_normalized_broad_category_expr`) so the emitted value is byte-identical; added a default-run `category_app` parity scenario. Deterministic parity exit 0; web 96 / py 79 / e2e 32 green. The derivation was previously divergent (web normalized, Python raw) but masked because the column was suppressed when the codebook was loaded.
- ✅ **#2** Whole-row dedup — opt-in (default-on) `deduplicateExactRows` toggle that
  collapses fully-identical raw rows (participant + timestamp + app + interaction;
  first kept) and reports the collapsed count in the result card + run manifest.
  Web-first: formalizes the previously-unconditional `dedupeExactRows` into a
  user-controllable, participant-aware step. Participant-aware key is a no-op on the
  single-participant parity fixture, so default behavior is unchanged.
- ⏭️ **#4** interaction-type remap — next.

**Later phases unchanged:** Phase 3 (aggregation subsystem with integer
accumulation), Phase 4 (formats), Phase 5 (interactive timeline #18, projects
#22).
