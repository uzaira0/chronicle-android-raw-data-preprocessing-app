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

## Authority and invalidation — read before touching `pipeline_v2*`, `workflow_contract.rs`, or campaign tests

Full explanation: `docs/architecture/authority-and-invalidation.md`. The measured
failures behind every rule here: `docs/postmortems/2026-08-convergence-campaign.md`.

- **Salsa is the only invalidation authority.** The `#[salsa::tracked]` functions in
  `pipeline_v2_incremental.rs` record their real reads per revision; the dependency
  graph is dynamic and exact. No table anywhere makes Salsa recompute more or less.
- **`WORKFLOW_QUERIES.inputs` is a may-read mirror**, published for the contract, plan,
  provenance, and Graph panel — never consulted for invalidation. Its only failure mode
  is drift from the code; the drift gates are `unjustifiedExecutions` (every executed
  query must have a justification — the empty-set assertion in the tomography
  campaigns) and the cached-badge-vs-moved-digest check. **Never build a
  predictor, oracle, conditional-edge table, or any other re-derivation of graph
  reachability** — 2026-08 accumulated three generations of these and all were removed.
- **Evidence chain order:** campaigns (record mode) → proof ledgers → dependency
  certificate → embedded at build. The certificate *reads* its receipt from the
  ledgers; regenerating it against unchanged ledgers is a no-op. A stale certificate
  flips the runtime to `ConservativeFull` and ~17 warm-reuse tests fail with one cause
  (`a_stale_dependency_certificate_names_itself_…` says so by name). Heavy runs:
  `CHRONICLE_CAMPAIGN_WORKERS=4 CAP_MEM=12G cap make dependency-evidence`, no Rust
  edit in flight.

### Hard rules — each one is a measured 2026-08 failure

- Never infer success from absent output. Capture the real exit code of the real
  command; piping through `tail`/`head` and reading `$?` reports the pager's status.
- A gate never run is indistinguishable from a gate that passes. `make check` picks its
  phases from the diff (every crate when any Rust changed); hand-picked partial suites
  are not the gate. A suite that *aborts* mid-run is the first bug — a truncated count
  is not a result.
- Gate economy (2026-09-25, after 17 heavy runs in one day): one gate per change, run
  last. Independent review of logic diffs happens **before** the gate. Figures drift
  → `make pin-figures`, never a rerun. A failed gate reruns only the failing test
  after a fix, never the whole gate without a code change. Mutation, coverage and
  campaign targets are never part of a routine change.
- Never disable tests to absorb a signature change — update every call site.
  `#[cfg(all(test, any()))]` is banned; `rg '^\s*#\[cfg\(all\(test, any\(\)\)\)\]' rust` must
  stay empty (a doc comment in `chronicle_semantic_index_wasm` mentions it, so a looser grep hits).
- `npm run build:wasm` is part of the definition of done of **every** Rust change. A
  stale force-tracked WASM turns the entire web suite into a rubber stamp (it validated
  pre-campaign behavior for 35 hours). `make wasm-fresh` (run by `make check` on any
  Rust change) fails if the committed packages differ from a fresh build.
- When a fail-closed layer rejects something, the default hypothesis is that the input
  is wrong, not the check (bound request fields; the resume-time raw-digest tamper check).
- No parallel authority: no hand-authored model of behavior the runtime or contract
  already owns. `npm run check:authority-boundary` now polices `testSupport/` too.
- Two self-issued review cycles per axis, then escalate to the operator with the
  specific blocker. An axis is done only when its option key exists in the LinkML
  contract **and** is read in the kernel's production modules (`pipeline_v2.rs`
  and `src/pipeline/**`) — docs and tests alone are `pending`.
- Commit at each verified milestone. 26 hours and 48k uncommitted lines happened; the
  gate that blocked ten review cycles was opened by `git commit`.
- A test's strength must match its name (the raw-exposure test asserted nothing for
  months under an empty options map). Assert scientific claims directly, not via proxies.
- Within one request, every derived Salsa input gets one consistent value — the
  preflight/execute `review_only` double-flip silently recomputed six queries per run
  while the UI reported them reused.

**Consumer coupling (RESOLVED 2026-08-25):** the `research-pipeline` monorepo consumed this repo as an editable path dependency importing `chronicle_preprocessing_app` (`v1_engine.py`) — a Python surface that no longer exists on `main`. That consumer is now repointed at a frozen detached worktree pinned at **431f326bc** (the July-16 production ref; the earlier note citing tag `last-python-engine`/81e626d described a pin this one superseded). The 2026-10-03 history rewrite, which removed AI co-author lines from commit messages, gave that commit the new ID **b003bae6c** with an identical tree; tag `july16-production-engine` now points there, and `last-python-engine` moved from 81e626d to bd8caed77. The frozen worktree still holds the old ID locally at `/home/opt/chronicle-last-python-engine` (`chronicle-android-preprocessor = { path = "/home/opt/chronicle-last-python-engine", editable = true }` in both its pyprojects plus its `uv.lock`, editable-reinstalled into its venv with the compiled `_rust_app_usage_matcher` ext). This repo's checkouts no longer carry any branch constraint for that consumer; do not delete the frozen worktree.

## Commands

All CI is **local**. `make check` is the PR gate; `make all` is the pre-deploy gate. The remaining remote workflows are `codeql.yml` / `security.yml` (scanners, on push + PR), `canary.yml` (6-hourly Playwright smoke against the deployed app), and `web-pwa-deploy.yml`, which runs no tests and is **manual dispatch only** — see the deploy note in Conventions below.

```bash
make check     # PR gate: phases chosen from the diff vs origin/main (web-only change:
               # web checks + chromium smoke on the committed WASM; Rust change: + rust
               # tests + wasm-fresh; lockfile: + dependency scanners). Rewrites drifted figures.
make all       # pre-deploy: ci + web checks + e2e smoke + deploy-artifact + wasm-fresh
make ci        # rust tests + all security scanners
make pin-figures  # rewrite drifted published figures from their producers
make web       # typecheck + web unit tests + contract check
make security  # semgrep (+ registry packs) ast-grep shellcheck actionlint cargo-audit
               # cargo-deny trivy gitleaks
make udeps     # unused Rust dependencies (cargo-udeps, nightly)
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
npm run test           # scripts/run_test_suite.mjs: test:unit (vitest, the four golden
                       # campaign suites excluded) + the fail-closed config-space contract slice
npm run test:e2e:smoke # playwright @smoke tests
npm exec -- node scripts/run-clean-env.mjs vitest run src/lib/foo.test.ts -t 'name'  # one test file / case
npm exec -- node scripts/run-clean-env.mjs playwright test e2e/foo.spec.ts           # one e2e spec
# (bare `node scripts/run-clean-env.mjs vitest` fails `spawn vitest ENOENT`: it needs npm's PATH)
npm run check:contract # regenerate + validate the generated contract (see below)
npm run build:wasm     # rebuild the WASM packages used by the app and tests
```

Most npm scripts wrap the real command in `node scripts/run-clean-env.mjs` to strip a polluted env.

### Incremental-engine gates and evidence
```bash
make dependency-evidence   # regenerate implementation-bound dependency data (rebuilds the
                           # temporary evidence WASM, then the normal fail-closed package).
                           # Footprint selection (web/scripts/footprint_selection.mjs) skips
                           # campaigns whose recorded executed-file coverage proves nothing
                           # they ran changed; FULL=1 forces a complete re-measure. Requires
                           # nightly + llvm-tools (rustup component add llvm-tools
                           # --toolchain nightly). minicov 0.3.8 writes LLVM-22 profraws,
                           # so a nightly on LLVM 23+ cannot merge them: set
                           # CHRONICLE_NIGHTLY_TOOLCHAIN=nightly-2026-04-23 (a dated
                           # nightly with llvm-tools + wasm32 target). Never a Salsa authority — see
                           # docs/architecture/authority-and-invalidation.md.
                           # REQUIRED after any pipeline_v2*.rs / workflow_contract.rs change —
                           # the campaigns fail on an unjustified execution (undeclared read)
                           # or a cached badge with a moved digest. NOTE the chain order:
                           # campaigns write the ledgers FIRST, the certificate is read from
                           # them (see the Authority section) — after a failed run, re-run
                           # npm run build:wasm and re-derive the certificate from fresh ledgers.
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
`benchmark_runtime_wasm.mts` reuse identical bytes/SHA-256 — they measure duplicate
content, never the cost of distinct files. Only `measure_unique_review_batch.mjs` over files
from `generate_benchmark_fixture.mts` with different seeds is distinct-input evidence; it
requires unique SHA-256s, cold-oracle matches, and exact query-registry statuses.
`benchmark_runtime_wasm.mts` drives the app's own runtime functions (`executeRustRuntime`,
`queryPersistedRustReview` → `queryRustReview`) with the app's toggles (sequential engine),
over an in-memory OPFS; the batch harnesses spawn it, so none of them builds requests.
The generator's default corpus is the *pathology* corpus (~24 rows a day, nearly all
app events), so its row count buys calendar span, not density: 100k rows is ~11 years.
Real exports are dense and short (124 real files: median 5,752 rows over 14 days, max
73,568 rows over 84 days, 29% app transitions). Performance figures use `--realistic
--days D --rows-per-day R`, which is calibrated to that corpus.

## Architecture

### Rust (`rust/`)
- `chronicle_app_usage_matcher` — **the single source of truth for session matching**. Core functions (`match_app_usage_core`, `split_overlapping_sessions` — an O(N log N) sweep-line) are binding-agnostic. A `python` feature (default on) gates PyO3 + numpy; the web crates depend on it with `default-features = false`, and `make rust` tests it feature-free.
- `chronicle_chrono_kernel_wasm` — the query-registry processing library used by the
  production runtime. It uses `chronicle_app_usage_matcher` directly and has
  no standalone browser entry point.
- `chronicle_chrono_kernel_wasm/src/pipeline_v2_incremental.rs` — the physical
  preprocessing engine: a registry-derived set of Salsa `0.28.5` tracked Rust product computations;
  internal derived caches are reported separately and are not product steps.
  Their actual reads control invalidation; Salsa execution events are the only
  source of physical cached/recomputed status. The complete sequential
  `run_pipeline_v2_with_supports()` path (`pipeline/sequential.rs`) is an
  independent **scheduler** and the **default engine**: the runtime request
  field `executionEngine` defaults to `sequential` when absent, and the web
  app never sends `incremental`: its "Keep results warm" toggle was removed
  (2026-09-29) because at the 1.5 GiB worker budget Salsa's ~2.6 GB live set
  on a 100k-row file spills on every warm run and loses to sequential. Only an
  injected test runtime can still ask for it. Tests, campaigns and benchmarks that mean Salsa request
  `incremental` explicitly. It is not an independent *implementation*: both
  schedulers call the same stage functions, so comparing the two proves the
  incremental scheduling and checkpointing, never the algorithms themselves.
  A genuinely independent value oracle has to come from outside this crate.
- Kernel layout: `pipeline_v2.rs` is the public façade (`pipeline_v2::X`
  paths keep resolving). Shared code lives in `src/pipeline/`: `options`,
  `model`, `row_codec`, `checkpoint`, `output`, `scientific`, `payload`,
  `execution`, `stage_functions`, and `stages/{source,support,reconstruction,
  annotations,screen,credit,notification,polled,attribution}.rs`. The two
  schedulers are `pipeline/sequential.rs` and the tracked bodies, which stay
  in `pipeline_v2_incremental.rs` (authority records pin that file); the
  non-query Salsa infrastructure is in `pipeline/incremental/{inputs,db,
  persistence,checkpoints}.rs`. Logic both engines need has one owner there,
  and each engine keeps only its own scheduling, reads and checkpoint
  recording.
- Dependencies are injected, not ambient: `StageFunctions` (the five
  replaceable stage functions) is passed to a sequential run and held by the
  Salsa database for its lifetime; each sequential run, Salsa database and
  runtime request (`ExecutionServices`) captures one `PayloadStore` and
  publishes only into it, and a cached workspace engine built on another store
  is rebuilt; checkpoints go to a `CheckpointRecorder`. The default
  constructors use `StageFunctions::production()` and the thread-local store.
  Non-production stage functions carry no certified implementation identity.
- `chronicle_preprocessing_runtime_wasm` — product contract, qualification,
  execution, evidence, typed views, and verified artifact closure. Salsa state
  is an in-worker cache only and an opaque Salsa database is **never**
  serialized. What *is* persisted: typed Rust review and reconstruction resume
  values (`REVIEW_BASE_MAGIC` / `RECONSTRUCTION_BASE_MAGIC`, `CHRRB0nn` / `CHRRX0nn`, in
  `pipeline/incremental/persistence.rs` — read them there, they bump with every format change; row dispositions as
  reuse/replacement/drop) stored in the existing OPFS content-addressed store.
  A replacement worker verifies the saved header, object digest, options,
  implementation, contract, schema, and row count before resuming from the
  first downstream invalid query; any mismatch fails closed to the normal full
  Rust path. The `provenanceEvidence` request flag is off by default; the
  Performance card's “Build provenance evidence” toggle enables the three
  optional Arrow artifacts, and campaigns request them explicitly.
- WASM package files under `web/src/wasm/*/pkg/` are generated but
  force-tracked deploy inputs. `npm run build:wasm` regenerates them from the
  reviewed Rust sources; commit the resulting package changes whenever the
  Rust or export boundary changes. The deploy workflow runs `npm run build:app`
  and consumes these committed files without rebuilding Rust, while a full
  local `npm run build` requires the Rust WASM toolchain.
- `chronicle_preprocessing_semantic_adapter` — product contract, deterministic
  qualification/materialization rules, evidence records and typed views
  (semantic-federation adapter). No scheduler or preprocessing engine of its own.
- `chronicle_semantic_index_wasm` — a *derived* RDF/SPARQL index (N-Quads
  projection, product-registered SPARQL only) consumed by `web/src/lib/semanticIndex.ts`.
  The OPFS artifact closure and evidence journal stay the authority.
- Every crate is its own manifest (no workspace). `make rust` tests all five; the
  manifest variables (`MATCHER`, `CHRONO_KERNEL`, `SEMANTIC_RUNTIME`,
  `PRODUCT_RUNTIME`, `SEMANTIC_INDEX`) are at the top of the `Makefile`.

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
- `components/ViewPanel.tsx` (+ `components/review/`) — the current **"view" tab**: an interactive zoomable waterfall timeline built from the Scene model. `buildAppTimelineViews()` / `buildScreenTimelineViews()` in `plotGenerator.ts` are the switch points that feed both the View tab and the exported interactive HTML (`lib/timelineViewer.ts`).
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

**Locked config (TECH / GNSM, `research-pipeline` `v1_engine.py` knobs on the frozen
July-16 Python engine):** `proximity_interval_seconds=2`, `minimum_usage_duration=60`,
`allow_stop_event_reuse=off`, `use_activity_stopped_as_fallback=on`,
`apply_threshold_to_activity_stopped_fallback=on`, `use_filter_file=on`,
`correct_duplicate_event_timestamps=on`, timezone America/Chicago. Personal phones (§14):
`long_duration_threshold_hours=1e6` (never fires) plus the §14 credit (truncate at 6 h,
credit screen-ON ∩ device-alive minutes), Amazon Kids counted as a regular app. GNSM
study tablets: `long_duration_threshold_hours=6`, no credit. This app's defaults differ
on the filter (off), the cap (12 h) and screen-gated credit (off). `proximity=2 s`
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
`apply_screen_gated_credit_incremental` in `pipeline/sequential.rs`; options in
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
- **Merging does NOT deploy.** `web-pwa-deploy.yml` is `workflow_dispatch` only — publishing to the live GitHub Pages app is an explicit decision, never a side effect of landing a PR. Review builds are local: `npm run host:local` serves the production build on `127.0.0.1:4173`. Do not add a `push` trigger, and do not run the deploy workflow without being asked to. The deploy also runs **no** tests, so `make all` locally is the real gate before a deploy.
- **Development deployment goes to preview only** (`uzaira0/chronicle-android-preprocessing-app-preview` `gh-pages`, formerly `chronicle-web-preview`), never production Pages. Deploy, what-is-live and rollback steps for both sites: `docs/web-deployment.md`. The old `codex/chronicle-query-registry-authority` lane landed via #81 and its branch is deleted; the consumer-coupling item above is resolved (consumer repointed to the frozen `last-python-engine` worktree), so no branch constraint remains from that warning.
- `.tmp-literature-review-private/` (gitignored, ~28 GB, main checkout only) holds copyrighted paper full texts and the 66 MB adjudicated method-profile library. Tests that read it go through `web/src/testSupport/privateCorpus.ts`: vitest `itWithPrivateCorpus`/`describeWithPrivateCorpus` (`privateCorpusGates.ts`), Playwright `test.skip(!privateCorpusAvailable, PRIVATE_CORPUS_SKIP_REASON)`, and never at module/describe scope (use `lazyPrivateCorpusJson`). Without it they are skipped and the run prints one `[private literature corpus] ABSENT` line; symlink it into a worktree root to run them. Coverage thresholds are only met with the corpus present. `shippedLocalPaths.test.ts` fails if a shipped web file contains a home-directory or absolute corpus path; locators ship repository-relative (`repositoryRelativeSourceLocator`).
- GitHub Pages does not provide cross-origin isolation, so shared-memory WASM threads are unavailable. File-level parallelism (independent files across workers) is the browser concurrency model.

## Conventions (from user's global rules)

- **Never** `git stash` (any subcommand). To check whether errors are pre-existing, read with `git diff` — don't manipulate the working tree.
- **Never** override commit authorship (`--author`, `GIT_AUTHOR_*`/`GIT_COMMITTER_*`, `git config user.*`) and **never** add `Co-Authored-By` lines. Commits use the user's git identity as-is.
- Commit / push only when asked.
