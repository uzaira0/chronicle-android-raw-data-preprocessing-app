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

⚠ **Consumer coupling:** the `research-pipeline` monorepo installs this repo as an **editable path dependency** (`chronicle-android-preprocessor = { path = "/home/opt/chronicle-android-raw-data-preprocessing-app", editable = true }`) and imports `chronicle_preprocessing_app` from this working tree (`v1_engine.py`). Do not check this branch out on the production machine, and do not merge it, until that consumer is repointed (vendored copy or pinned pre-removal ref).

## Commands

All CI is **local** (remote GitHub Actions were removed; only `web-pwa-deploy.yml` remains, and it only builds + deploys to GitHub Pages — it does not run tests). `make all` is the gate.

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

## Architecture

### Rust (`rust/`)
- `chronicle_app_usage_matcher` — **the single source of truth for session matching**. Core functions (`match_app_usage_core`, `split_overlapping_sessions` — an O(N log N) sweep-line) are binding-agnostic. A `python` feature (default on) gates PyO3 + numpy; the web crates depend on it with `default-features = false`, and `make rust` tests it feature-free.
- `chronicle_chrono_kernel_wasm` — the 55-step processing library used by the
  production runtime. It uses `chronicle_app_usage_matcher` directly and has
  no standalone browser entry point.
- `chronicle_chrono_kernel_wasm/src/pipeline_v2_incremental.rs` — the physical
  preprocessing engine: exactly 55 Salsa `0.28.1` tracked Rust computations.
  Their actual reads control invalidation; Salsa execution events are the only
  source of physical cached/recomputed status. The complete sequential
  `run_pipeline_v2_with_supports()` path is an independent cold oracle and
  temporary rollback, not the warm execution path.
- `chronicle_preprocessing_runtime_wasm` — product contract, qualification,
  execution, evidence, typed views, and verified artifact closure. Salsa state
  is an in-worker cache only; a replacement worker recalculates from verified
  OPFS inputs because snapshot restore was measured slower than a cold run.
- Generated WASM packages under `web/src/wasm/*/pkg/` are ignored build
  outputs. `npm run build` rebuilds them from the reviewed Rust sources and
  therefore requires the Rust WASM toolchain.

### Web (`web/src/`)
- `App.tsx` + `components/WorkflowNav.tsx` — tab UI: **settings → files → process → view**.
- `lib/rustPipelineRuntime.ts` + `workers/chronicle-worker.ts` — the production
  Comlink worker boundary. Rust/WASM owns parsing, qualification, all 55
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
**valid-usage-window paradigm** this engine does not yet implement. Captured here so the
matcher's behavior and the planned change are both on the record.

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

**Planned paradigm (decided by the researcher, NOT yet built — implement as opt-in /
parity-safe, default no-op on the fixture):**
1. feed Screen-Non-Interactive into the matcher as a session closer, with a **blip-bridge**
   (an off shorter than the 2-min auto-lock followed by the same app within 2 min is
   bridged — it cannot be an auto-lock);
2. switch the 6 h threshold from **zero-out** to **truncate-to-6 h** (keep the first 6 h);
3. no-true-end (runs to shutdown/death with no screen-off) → credit screen-on to the last
   engagement, not a blanket zero.
This makes held-open video/games count as usage (screen-on), so the n-file becomes moot
for app-usage. Within a continuous screen-on span Chronicle cannot distinguish attentive
watching from a left-on device (no presence signal during playback), so the 6 h cap — not
an attention timeout — bounds the tail. See `docs/chronicle-decisions-made.md` §14 in the
consumer repo.

## Gotchas

- `npm run typecheck` is three separate `tsc` invocations (not `tsc -b`). Composite/project-reference builds fail because scripts import `src/*` (TS6307). Only the `*.mjs` config sets `allowJs`/`checkJs`.
- `web/src/lib/progressReducer.ts`: `applyProgressEvent` must **never** revert a terminal status (complete/error) back to running — a Comlink dual-port race otherwise sticks the UI at "Building output 100%". `progressReducer.test.ts` pins this; don't simplify the reducer.
- App category in plots is **derived** by coalescing four per-source columns + normalizing UPPERCASE; the old `broad_app_category` input column is deprecated. The derived `include_category_column` output is opt-in and golden-checked.
- `main` is protected (`enforce_admins`). Land via PR (squash). Merge to `main` auto-deploys the web PWA to GitHub Pages; the deploy does **not** run tests, so `make all` locally is the real gate.

## Conventions (from user's global rules)

- **Never** `git stash` (any subcommand). To check whether errors are pre-existing, read with `git diff` — don't manipulate the working tree.
- **Never** override commit authorship (`--author`, `GIT_AUTHOR_*`/`GIT_COMMITTER_*`, `git config user.*`) and **never** add `Co-Authored-By` lines. Commits use the user's git identity as-is.
- Commit / push only when asked.
