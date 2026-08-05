# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Preprocessing and plotting for Chronicle Android raw-data exports (app-usage and screen-usage events). Two surfaces:

- **Web** — React + Vite PWA running the whole pipeline in-browser via Rust→WASM (`web/`). **This is the single engine.**
- **Rust** — shared algorithm crate compiled to WASM (`rust/`); `chronicle_app_usage_matcher` is the matcher's source of truth.

The Python desktop engine (PyQt6 GUI + Polars pipeline), its pytest suite, and the cross-engine parity/metamorphic/corpus-soak harnesses were **removed as fully deprecated**. Their final evidence is frozen in `docs/validation/CORPUS_SOAK.md` (124-file dual-engine byte-parity, zero mismatches after the five documented fixes) and `docs/perf/BASELINE.md`; the removal commit message names the last ref that still carries the desktop tree.

## Behavioral reference after the desktop removal

The Rust/WASM cold-oracle and dependency campaigns are now the **sole executable behavioral reference**. Their checked evidence remains under `web/src/lib/pipelineGraph/golden/family-expected/`; the directory name is historical and contains data, not a TypeScript graph engine. Consequences:
- A new flag/option must default such that, **with the flag off, golden output is byte-identical** to before. Add capability as opt-in. Goldens are re-recorded only deliberately (`UPDATE_GOLDEN=1`), never to make a red run green.
- Green self-validation has shipped real logic bugs before. For logic-dense changes, get an independent review (spawn a code-reviewer subagent / use an independent oracle) before merging.

⚠ **Consumer coupling:** the `research-pipeline` monorepo installs this repo as an **editable path dependency** (`chronicle-android-preprocessor = { path = "/home/opt/chronicle-android-raw-data-preprocessing-app", editable = true }`) and imports `chronicle_preprocessing_app` (`v1_engine.py`) — a Python surface that no longer exists on `main`. Until that consumer is repointed (vendored copy or pinned ref), the production machine's checkout must stay on the tag **`last-python-engine`** (81e626d, the final Python-bearing commit); do not pull current `main` there.

## Commands

All CI is **local**. `make all` is the gate. The remaining remote workflows are `codeql.yml` / `security.yml` (scanners, on push + PR), `canary.yml` (6-hourly Playwright smoke against the deployed app), and `web-pwa-deploy.yml`, which runs no tests and is **manual dispatch only** — see the deploy note in Conventions below.

```bash
make ci        # rust tests + all security scanners
make all       # ci + web checks + e2e smoke + deploy-artifact validation
make web       # typecheck + web unit tests + contract check
make security  # semgrep ast-grep cargo-audit trivy gitleaks
make help      # list every target
```

### Rust
```bash
cargo test --manifest-path rust/chronicle_app_usage_matcher/Cargo.toml --no-default-features
```
`--no-default-features` drops the `python` feature so the core tests run without a libpython on PATH. The default feature links PyO3.

### Web (run from `web/`)
```bash
npm run dev            # vite dev server
npm run build          # production build
npm run typecheck      # THREE tsc --noEmit passes (root + tsconfig.node.json for *.mts + tsconfig.mjs.json for *.mjs)
npm run test           # vitest unit tests
npm run test:e2e:smoke # playwright @smoke tests
npm run check:contract # regenerate + validate the generated contract (see below)
npm run build:wasm     # rebuild the WASM packages used by the app and tests
```

Most npm scripts wrap the real command in `node scripts/run-clean-env.mjs` to strip a polluted env.

### Incremental-engine gates and evidence
```bash
make dependency-evidence   # regenerate implementation-bound dependency data (rebuilds the
                           # temporary evidence WASM, then the normal fail-closed package).
                           # REQUIRED after any pipeline_v2*.rs / workflow_contract.rs change —
                           # tests fail if declared graph and observed Salsa reads drift.
make combinatorial         # combinatorial option-influence campaigns
make gate-truth            # execution-claim / evidence truth gate
make mutation              # mutation testing (mutation-web + mutation-rust; long-running)
make coverage-all          # web + rust coverage
make profile-current       # focused performance profile of the current build
```

Incremental Rust tests run with the feature flag:
```bash
cargo test --locked --manifest-path rust/chronicle_chrono_kernel_wasm/Cargo.toml --features incremental-v2
```

### Benchmarks (run from `web/`)
```bash
npm run measure:unique-review-batch -- <dir> <workers> <case>  # 100-DISTINCT-input review benchmark with cold-oracle check
npm run measure:review-batch       # same-raw-path batch (duplicate-content reuse only)
npm run benchmark:many-files       # duplicate-content fixture (NOT distinct-input evidence)
npm run benchmark:runtime-wasm     # runtime microbenchmark
```
**Benchmark truthfulness:** `verify-many-files.mjs`, `measure_review_batch.mjs`, and
`benchmark_runtime_wasm.mts` reuse identical bytes/SHA-256 — they prove duplicate-content
reuse, never the cost of distinct files. Only `measure_unique_review_batch.mjs` over files
from `generate_benchmark_fixture.mts` with different seeds is distinct-input evidence; it
requires unique SHA-256s, cold-oracle matches, and exact query-registry statuses.

## Architecture

### Rust (`rust/`)
- `chronicle_app_usage_matcher` — **the single source of truth for session matching**. Core functions (`match_app_usage_core`, `split_overlapping_sessions` — an O(N log N) sweep-line) are binding-agnostic. A `python` feature (default on) gates PyO3 + numpy; the web crates depend on it with `default-features = false`, and `make rust` tests it feature-free.
- `chronicle_chrono_kernel_wasm` — the query-registry processing library used by the
  production runtime. It uses `chronicle_app_usage_matcher` directly and has
  no standalone browser entry point.
- `chronicle_chrono_kernel_wasm/src/pipeline_v2_incremental.rs` — the physical
  preprocessing engine: a registry-derived set of Salsa `0.28.1` tracked Rust product computations;
  internal derived caches are reported separately and are not product steps.
  Their actual reads control invalidation; Salsa execution events are the only
  source of physical cached/recomputed status. The complete sequential
  `run_pipeline_v2_with_supports()` path is an independent cold oracle and
  temporary rollback, not the warm execution path.
- `chronicle_preprocessing_runtime_wasm` — product contract, qualification,
  execution, evidence, typed views, and verified artifact closure. Salsa state
  is an in-worker cache only and an opaque Salsa database is **never**
  serialized. What *is* persisted: typed Rust review and reconstruction resume
  values (reconstruction format v8, magic `CHRRX008`, row dispositions as
  reuse/replacement/drop) stored in the existing OPFS content-addressed store.
  A replacement worker verifies the saved header, object digest, options,
  implementation, contract, schema, and row count before resuming from the
  first downstream invalid query; any mismatch fails closed to the normal full
  Rust path.
- WASM package files under `web/src/wasm/*/pkg/` are generated but
  force-tracked deploy inputs. `npm run build:wasm` regenerates them from the
  reviewed Rust sources; commit the resulting package changes whenever the
  Rust or export boundary changes. The deploy workflow runs `npm run build:app`
  and consumes these committed files without rebuilding Rust, while a full
  local `npm run build` requires the Rust WASM toolchain.

### Web (`web/src/`)
- `App.tsx` + `components/WorkflowNav.tsx` — tab UI: **settings → files → process → view**.
- `lib/rustPipelineRuntime.ts` + `workers/chronicle-worker.ts` — the production
  Comlink worker boundary. Rust/WASM owns parsing, qualification, all registered
  transformations, incremental execution, evidence, and result artifacts.
- `lib/opfsArtifactStore.ts` — thin browser persistence for Rust-owned
  content-addressed objects, complete root history, and alternating
  authoritative workspace roots. It does not persist opaque scheduler state.
- `lib/rustWorkerClient.ts` — browser-facing worker lifecycle, transferables,
  pooling, and fault handling. It contains no preprocessing implementation.
- `components/GraphPanel/viewGraph.ts` — UI-only path/highlight operations over
  the Rust-projected stage view. It never schedules or computes pipeline data.
- `lib/plotGenerator.ts` + `lib/plotScene.ts` — a resolution-independent **Scene** model feeds both PNG (canvas) and SVG exports *and* the interactive surfaces, so they cannot drift. Plot types: app timeline, screen timeline, activity heatmap.
- `components/TimelineViewPanel.tsx` — the current **"view" tab**: an interactive zoomable waterfall timeline built from the Scene model. `buildAppTimelineViews()` / `buildScreenTimelineViews()` in `plotGenerator.ts` are the switch points that feed both the View tab and the exported interactive HTML (`lib/timelineViewer.ts`).
- Persistence: IndexedDB projects (`lib/projectsStore.ts`, file bundling opt-in), localStorage settings/presets (`lib/settingsPersistence.ts`). Service worker (`public/sw.js`) caches for offline use.

### The contract (web defaults & option keys)
`web/schema/chronicle-local-contract.linkml.yaml` (LinkML) is the source of truth for web option keys, defaults, and tooltips. `npm run check:contract` regenerates and validates `web/src/lib/generatedContract.ts` (`BROWSER_PROCESSING_OPTION_KEYS`, `DEFAULT_BROWSER_OPTIONS`, `BROWSER_OPTION_TOOLTIPS`). **Edit the LinkML schema, not the generated file**, then regenerate.

`npm run check:authority-boundary` fails if the deleted TypeScript engine,
graph scheduler, shadow path, or provenance builder is reintroduced.

## Usage-window semantics (research-pipeline consumer)

The (now-removed) desktop engine is consumed by the `research-pipeline` monorepo
(`apps/pipeline/research_pipeline/lib/android/chronicle/v1_engine.py`) to score child
screen time for the TECH / GNSM studies — see the consumer-coupling warning above; the
`polars_fast_path.py` line references below resolve at the last pre-removal ref. That consumer froze a **locked config** and, in
2026-06, ran a per-instance audit (`analyses/chronicle-window-definition/`) that landed a
**valid-usage-window paradigm**, now implemented on this branch as the opt-in
screen-gated crediting layer (status below). Captured here so the matcher's behavior
and the paradigm mapping are both on the record.

**Locked config (the consumer's frozen `PreprocessingOptions` for app-usage):**
`long_duration_threshold_hours=6` (engine default is 12), `proximity_interval_seconds=2`,
`minimum_usage_duration=60`, `allow_stop_event_reuse=off`,
`use_activity_stopped_as_fallback=on`, `apply_threshold_to_activity_stopped_fallback=on`,
`use_filter_file=on`, plus a post-engine Amazon-Kids-as-launcher relabel. `proximity=2 s`
is load-bearing (off fragments video teardown-churn below the 60 s floor). The tablet
stream also requires `proximity=2 s` (stock prox0 collapses PBS sessions).

**Matcher facts the audit leaned on (cite, don't re-derive):**
- The app-usage matcher consumes only ~6 of ~46 raw `InteractionType` values. **Screen
  Interactive / Non-Interactive feed only `screen_usage_preprocessor.py`, never the
  matcher** — so screen-off does NOT currently close an app-usage session.
- `polars_fast_path.py` `is_fallback_stop` (~:1025): an Activity-Stopped of the same app
  closes an open session — this **prevents** End-of-Usage-Missing by supplying an
  observed end. EoUM (`missing_indices`, ~:1118) is driven by the `long_duration_threshold_hours`
  cap, **not** by the fallback. A >6 h session is currently **zeroed** via EoUM (null
  start/stop → 0 TDM min through the dbt split gate), not truncated.
- The forces-screen-open ("n-file",
  `apps_forcing_screen_open_files/...apps_forcing_screen_open.csv`, shipped = youtube /
  netflix / hulu / disney / twitch) is consumed **only** by
  `screen_usage_preprocessor.py` (`APP_KEPT_AWAKE_OR_EXTENDED`, ~:294, gated on
  `screen_usage_auto_lock_timeout_seconds`, default 2 min) — it has **zero** app-usage
  consumers today.

**Paradigm status: LANDED on this branch as opt-in "Screen-gated usage credit"**
(`enable_screen_gated_crediting`, off by default; kernel entry
`apply_screen_gated_credit_incremental` in `pipeline_v2.rs`; options in
`web/schema/chronicle-local-contract.linkml.yaml`). The implementation credits each
app session only for intervals where the screen was witnessed ON and the device was
demonstrably alive, emitted as a **side-by-side "Credited App Usage" CSV** — the
headline app-usage output is never changed. It maps to the researcher's decisions as:
1. blip-bridge → `auto_lock_bridge_seconds` (default 120 s: a screen-OFF blip shorter
   than the auto-lock cannot be a real lock, so credit bridges across it);
2. truncate-not-zero → `credited_session_cap_minutes` (default 360; credit is
   truncated at the cap from session start, never zeroed);
3. no-true-end → `device_liveness_gap_tolerance_minutes` (default 120; a Device
   Startup inside a silence always breaks the chain) plus the `no_witness_*`
   fallback options for sessions with no screen witness at all.
Held-open video/games count while the screen is lit, so the n-file is moot for
app-usage crediting. Within a continuous screen-on span Chronicle cannot distinguish
attentive watching from a left-on device (no presence signal during playback), so the
credited-session cap — not an attention timeout — bounds the tail. See
`docs/chronicle-decisions-made.md` §14 in the consumer repo for the decision record.

## Gotchas

- `npm run typecheck` is three separate `tsc` invocations (not `tsc -b`). Composite/project-reference builds fail because scripts import `src/*` (TS6307). Only the `*.mjs` config sets `allowJs`/`checkJs`.
- `web/src/lib/progressReducer.ts`: `applyProgressEvent` must **never** revert a terminal status (complete/error) back to running — a Comlink dual-port race otherwise sticks the UI at "Building output 100%". `progressReducer.test.ts` pins this; don't simplify the reducer.
- App category in plots is **derived** by coalescing four per-source columns + normalizing UPPERCASE; the old `broad_app_category` input column is deprecated. The derived `include_category_column` output is opt-in and golden-checked.
- `main` is protected (`enforce_admins`). Land via PR (squash).
- **Merging does NOT deploy.** `web-pwa-deploy.yml` is `workflow_dispatch` only — publishing to the live GitHub Pages app is an explicit decision, never a side effect of landing a PR. Review builds are local: `npm run host:local` serves the production build on `127.0.0.1:4173`. Do not add a `push` trigger, and do not run the deploy workflow without being asked to. The deploy also runs **no** tests, so `make all` locally is the real gate.
- **Development deployment goes to preview only** (`uzaira0/chronicle-web-preview` `gh-pages`), never production Pages. The old `codex/chronicle-query-registry-authority` lane landed via #81 and its branch is deleted; the consumer-coupling constraint above (production checkout pinned to `last-python-engine`) is what remains of that warning.
- GitHub Pages does not provide cross-origin isolation, so shared-memory WASM threads are unavailable. File-level parallelism (independent files across workers) is the browser concurrency model.

## Conventions (from user's global rules)

- **Never** `git stash` (any subcommand). To check whether errors are pre-existing, read with `git diff` — don't manipulate the working tree.
- **Never** override commit authorship (`--author`, `GIT_AUTHOR_*`/`GIT_COMMITTER_*`, `git config user.*`) and **never** add `Co-Authored-By` lines. Commits use the user's git identity as-is.
- Commit / push only when asked.
