# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Preprocessing and plotting for Chronicle Android raw-data exports (app-usage and screen-usage events). The same preprocessing semantics are implemented across **three surfaces** that must produce identical output:

- **Python desktop** — PyQt6 GUI + Polars pipeline (`src/chronicle_preprocessing_app/`)
- **Web** — React + Vite PWA running the whole pipeline in-browser via Rust→WASM (`web/`)
- **Rust** — shared algorithm crate compiled to both a PyO3 extension (desktop) and WASM (web) (`rust/`)

**The web surface is canonical for new features.** New options are designed to be a **no-op on the parity fixture** so the cross-surface gate stays green untouched; desktop and Rust are aligned to match the web's behavior. Do not design new work around the Python/desktop "oracle" or chase Python parity for net-new capability.

## Cross-surface parity is the central constraint

`scripts/run_deterministic_web_parity.py` (run via `make parity`) builds a deterministic pathological fixture, runs it through both the Python desktop pipeline and the in-browser TS/WASM pipeline, and compares CSV outputs **row-by-row, column-by-column**. A single differing cell blocks the change.

Consequences for how you work:
- A new flag/option must default such that, **with the flag off (its fixture default), output is byte-identical** to before. Add capability as opt-in.
- The matcher algorithm itself is shared Rust (one source of truth), so its behavior is automatically identical across surfaces. Everything *around* it (CSV parse, timestamp formatting, codebook enrichment, plotting) is implemented **independently** in Python and TypeScript and must be kept in lockstep by hand + the parity gate.
- Green self-validation has shipped real logic bugs before. For logic-dense changes, get an independent review (spawn a code-reviewer subagent / use an independent oracle) before merging — do not trust a green parity run alone.

## Commands

All CI is **local** (remote GitHub Actions were removed; only `web-pwa-deploy.yml` remains, and it only builds + deploys to GitHub Pages — it does not run tests). `make all` is the gate.

```bash
make ci        # python tests + rust tests + all security scanners
make all       # ci + web checks + cross-surface parity + e2e smoke + deploy-artifact validation
make web       # typecheck + web unit tests + contract check
make security  # semgrep ast-grep bandit pip-audit cargo-audit trivy gitleaks
make help      # list every target
```

Point `PYTHON` at an interpreter that has the deps (polars, etc.):
```bash
make ci PYTHON=/home/opt/eyes-parity-venv/bin/python
```

### Python
```bash
PYTHONPATH=src python -m pytest -q                          # all tests (pythonpath also set in pyproject)
PYTHONPATH=src python -m pytest tests/test_polars_fast_path.py -q      # one file
PYTHONPATH=src python -m pytest tests/test_polars_fast_path.py::test_name   # one test
python main.py                                              # launch the PyQt6 GUI
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
npm run build:wasm     # rebuild chronicle_app_usage_wasm via wasm-pack
```

Most npm scripts wrap the real command in `node scripts/run-clean-env.mjs` to strip a polluted env.

## Architecture

### Python pipeline (`src/chronicle_preprocessing_app/`)
- `core/` — framework-agnostic logic. `config.py` holds `PreprocessingOptions` (the master config dataclass, ~250 fields) and `ProcessingStats`.
- `core/preprocessing/main_preprocessor.py` — `MainPreprocessor` orchestrates the run. When `supports_polars_fast_path()` is true (the standard case), it delegates to the **fast path** and skips the legacy sequential preprocessors.
- `core/preprocessing/polars_fast_path.py` — `PolarsFastPathPreprocessor`, the canonical Polars-native implementation (CSV load → codebook enrichment → app-usage matching → concurrent-usage layering → output). This is where the canonical semantics live; the per-stage preprocessors (`timestamp_preprocessor.py`, `screen_usage_preprocessor.py`, `app_usage_preprocessor.py`, `timezone_preprocessor.py`, etc.) are the legacy fallback path used only when the fast path is unavailable (e.g. survey data, custom date providers).
- `core/preprocessing/algorithms/` — `OptimizedAppUsageAlgorithm` (session derivation) and `rust_app_usage_matcher.py` (the PyO3 bridge: `process_app_usage_with_rust()` converts Polars columns to numpy, calls `_rust_app_usage_matcher`, falls back to Python if the extension is absent and not in strict mode).
- `core/plotting/plotting_manager.py` — matplotlib PNG daily bar charts (desktop only; the web does its own plotting).
- `config/` — `constants.py` (enums like `InteractionType`, `TimezoneHandlingOption`, `Column`), `defaults.py`, `version.py`.
- `gui/` — PyQt6 (windows / panels / dialogs / workers). `gui/workers/preprocessing_thread.py` runs `MainPreprocessor` off the UI thread. `cli/` and `web/` packages are placeholders.

### Rust (`rust/`)
- `chronicle_app_usage_matcher` — **the single source of truth for session matching**. Core functions (`match_app_usage_core`, `split_overlapping_sessions` — an O(N log N) sweep-line) are binding-agnostic. A `python` feature (default on) gates PyO3 + numpy.
- `chronicle_app_usage_wasm` — wasm-bindgen wrapper around the matcher (path dep, `default-features = false` to exclude PyO3). Used by the web worker.
- `chronicle_chrono_kernel_py` / `chronicle_chrono_kernel_wasm` — chrono-tz timestamp/CSV kernels (PyO3 and WASM twins). The matcher is the only algorithm shared cross-surface today; parse/format/dedupe kernels remain separately implemented per surface.
- Prebuilt WASM packages are committed under `web/src/wasm/*/pkg/` so the web build needs only Node (no Rust toolchain). They are **force-tracked** (`.gitignore` excludes `pkg/`); after `npm run build:wasm` you must `git add -f` the regenerated pkg.

### Web (`web/src/`)
- `App.tsx` + `components/WorkflowNav.tsx` — tab UI: **settings → files → process → view**.
- `lib/browserPipeline.ts` — orchestrates the in-browser pipeline (CSV parse → timezone → session split → WASM matching → codebook enrichment → plotting → aggregation → Parquet/SPSS/CSV output).
- `lib/chronicleMatcher.ts` + `workers/chronicle-worker.ts` — a Comlink-managed `WorkerPool`; each worker holds warm WASM + codebook and runs the matcher off the main thread.
- `lib/plotGenerator.ts` + `lib/plotScene.ts` — a resolution-independent **Scene** model feeds both PNG (canvas) and SVG exports *and* the interactive surfaces, so they cannot drift. Plot types: app timeline, screen timeline, activity heatmap.
- `components/TimelineViewPanel.tsx` — the current **"view" tab**: an interactive zoomable waterfall timeline built from the Scene model. `buildAppTimelineViews()` / `buildScreenTimelineViews()` in `plotGenerator.ts` are the switch points that feed both the View tab and the exported interactive HTML (`lib/timelineViewer.ts`).
- Persistence: IndexedDB projects (`lib/projectsStore.ts`, file bundling opt-in), localStorage settings/presets (`lib/settingsPersistence.ts`). Service worker (`public/sw.js`) caches for offline use.

### The contract (web defaults & option keys)
`web/schema/chronicle-local-contract.linkml.yaml` (LinkML) is the source of truth for web option keys, defaults, and tooltips. `npm run check:contract` regenerates and validates `web/src/lib/generatedContract.ts` (`BROWSER_PROCESSING_OPTION_KEYS`, `DEFAULT_BROWSER_OPTIONS`, `BROWSER_OPTION_TOOLTIPS`). **Edit the LinkML schema, not the generated file**, then regenerate.

## Gotchas

- `npm run typecheck` is three separate `tsc` invocations (not `tsc -b`). Composite/project-reference builds fail because scripts import `src/*` (TS6307). Only the `*.mjs` config sets `allowJs`/`checkJs`.
- `web/src/lib/progressReducer.ts`: `applyProgressEvent` must **never** revert a terminal status (complete/error) back to running — a Comlink dual-port race otherwise sticks the UI at "Building output 100%". `progressReducer.test.ts` pins this; don't simplify the reducer.
- App category in plots is **derived** by coalescing four per-source columns + normalizing UPPERCASE; the old `broad_app_category` input column is deprecated. The derived `include_category_column` output is opt-in and parity-checked.
- `main` is protected (`enforce_admins`). Land via PR (squash). Merge to `main` auto-deploys the web PWA to GitHub Pages; the deploy does **not** run tests, so `make all` locally is the real gate.

## Conventions (from user's global rules)

- **Never** `git stash` (any subcommand). To check whether errors are pre-existing, read with `git diff` — don't manipulate the working tree.
- **Never** override commit authorship (`--author`, `GIT_AUTHOR_*`/`GIT_COMMITTER_*`, `git config user.*`) and **never** add `Co-Authored-By` lines. Commits use the user's git identity as-is.
- Commit / push only when asked.
