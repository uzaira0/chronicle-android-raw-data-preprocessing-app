# Decision Ledger + Prior-Art Research

> Historical ledger. Decisions 1, 3, 5, 8, 9, and 11 describe the former
> TypeScript/15-stage physical engine. They are retained to explain how the
> current contract and tests evolved, but they no longer authorize production
> execution. The current decision is Salsa `0.28.1` with exactly 55 tracked
> Rust/WASM product computations; internal derived caches are reported
> separately and do not add product steps. See the
> [authoritative plan](../semantic-federation/55-step-incremental-rust-plan.md#existing-software-decision).

## Decisions made (2026-07-14, with the project owner)

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Execution model for ported features | **Client-side TS/WASM port** (no backend) | Keeps zero-backend, offline, static-hosting deployment; parity guarded by golden-output tests vs the Python originals |
| 2 | Section taxonomy | **Three sections: Preprocess (locked) / Clean (tunable) / Analyze (study inputs)** | Attribution/window/compliance are study-structural, not stream cleaning; they need external tables |
| 3 | Dependency graph role | **Both**: one declared graph drives incremental recompute AND renders as an interactive typed-edge panel | Single source of truth; the rendered graph cannot rot because it IS the executable graph |
| 4 | Scope of first spec | **Full system, one spec** (all three sections, all ports, DAG engine + panel, parity harness) | Owner preference |
| 5 | Architecture | **Approach A — retrofit: the DAG becomes the pipeline's only execution spine** (decompose `processRawCsvContent` into declared nodes; new features join as first-class nodes) | Stage seams already exist; a bolt-on DAG would lie about upstream structure and kill incremental recompute where users tweak most; a generic-engine-first rewrite is YAGNI |
| 6 | Derived causal roles | mediates/confounds/collides are **computed path properties**, never hand-drawn edges | Provable consistency with the executable graph |
| 7 | Analyze-tier external data | Two new **user-uploaded support files**: device-sharing table + study-dates table | Browser has no access to the research pipeline's tracking systems |
| 8 | (2026-07-19) `NodeStatus` alphabet | **Removed `"dirty"`** — audit showed the engine never emitted it (dirtiness is implicit: a changed cache key recomputes immediately, so a node is only ever cached/recomputed/error/skipped/bypassed) | A status value that can never appear misleads UI code (`STATUS_LABELS` carried a dead "needs re-run" badge) and the new `ExecutionLedger`, whose records reuse `NodeStatus` |
| 9 | (2026-07-19) Runtime lineage SSOT | **`executionRecords.ts` ExecutionLedger**: engine emits generic `UnitExecutionRecord`s in `RunReport.executions`; `runUnit` emits `StepExecutionRecord`s through optional `ctx.stepRecorder`; `assembleLedger` joins once in browserPipeline | Two-channel design keeps the 55 step signatures, 15 node bodies and the AST dataflow checker byte-compatible; deterministic core (`StepExecutionCore`) is kept apart from wall-clock `StepTiming` so determinism assertions can exclude timing; records are observation-only (warn-only expectations, never behavior-changing) |
| 10 | (2026-07-19) Test-suite rule: no fallible computation at collection scope | Test files must call the code under test **inside `it()` bodies**, not at module/describe scope | A mutant activated during vitest file COLLECTION throws before any test registers → zero test results → mutation tooling counts it Survived. Moving `buildStepGraph` calls from describe scope into the tests took `stepGraph.ts` from a fake 3.88% to a real 95.15% mutation score with the same assertions |
| 11 | (2026-07-19) Early cutoff mechanism | **`NodeDef.earlyCutoff: boolean` + `valuesEqual` deep equality against the held cached value** replaced `outputHash` (stableStringify + FNV over the full output) | The ledger profiler attributed 44.5% of pipeline wall time to the four `outputHash` nodes serializing ~528 MB of JSON per 4-file run; equality against the cached value costs nothing on a first run and exits at the first difference on a changed rerun. Same backdating semantics (engine + property tests unchanged in intent), 4-fixture wall 8.99s → 5.79s (→ 4.64s with the Intl weekday/restamp eliminations). Contract slot renamed `has_output_hash` → `has_early_cutoff`. See docs/perf/BASELINE.md + rust-port-design-memo §13 |

## Build / Adopt / Compose ledger

| Capability | Decision | Evidence |
|---|---|---|
| Graph rendering/interaction | **Adopt** `@xyflow/react` (React Flow 12; verified 12.11.2, MIT, peer react>=17) | Dominant, active, React-19-compatible |
| Auto-layout | **Adopt** `@dagrejs/dagre` (verified 3.0.0, MIT) | Simple layered DAG layout; elkjs (EPL-2.0) as fallback if layout quality demands |
| Recompute engine (typed edges, dirty-prop, content-hash memo) | **Superseded: adopt Salsa `0.28.1`** | The original bounded TypeScript engine is historical. The real 55-query Rust/WASM trial passed and now owns physical invalidation and memoization; the existing plan remains the product contract and grouped view. |
| Options/knob contract | **Adopt existing** LinkML contract pipeline | Already in repo, CI-checked |
| §14/attribution/compliance logic | **Port** from Python with golden-fixture parity | Decided in #1 |
| Session matcher | **Keep** shared Rust core (WASM + Python) | Existing byte-parity mechanism |

## Prior-art research (discovery searches, 2026-07-14)

Evaluated and REJECTED for the engine (with reasons):
- **Rete.js 2** (MIT, active): editor + DataflowEngine, but a whole visual-programming
  framework with its own rendering/plugin universe — we need our semantics on our UI.
- **behave-graph / behave-flow**: event-driven behavior-graph engine (game-logic model),
  not memoized data-pipeline stages.
- **NoFlo / Node-RED / Total.js Flow**: server/runtime-oriented flow-based programming;
  wrong grain.
- **Flume** (MIT): React node editor; smaller ecosystem than React Flow.
- **TC39 signal-polyfill**: explicitly not production-ready; signals are sync/fine-grained —
  our nodes are async worker stages caching large arrays.

Conceptual prior art ADOPTED as design references (not dependencies):
- **drake / `targets` (R)**: make-for-data-pipelines — declared DAG of targets,
  **content-hash invalidation** (not timestamps), stored intermediates, and
  `vis_drake_graph`/`tar_visnetwork` rendering the pipeline with outdated nodes highlighted.
  Direct validation of the coarse-node + content-hash + truthful-staleness-view design.
- **DAGitty** (epidemiology): browser causal-DAG tool; its vocabulary (mediator/confounder/
  collider) and "select a node → see affected paths/adjustment sets" interaction model
  inspire the analysis sidebar. Our derived-role computation is the pipeline-knob analogue.
- **Build Systems à la Carte** (Mokhov et al.): the theory frame — our engine is a
  "suspending scheduler + verifying traces" build system at toy scale.
- **Dagster/dbt** (the consuming pipeline's own stack): asset-graph mental model;
  section metadata ≈ asset groups.

## Sanity constraints carried over from the consuming pipeline's hard-won lessons

- Fail loud, never default-to-empty (a silent empty set mislabels everything downstream).
- One SSOT per decision; parallel implementations drift — hence golden-parity tests, not
  re-derived logic.
- Optional, number-changing steps stay optional + side-by-side; never mutate the headline
  output in place.
- Millisecond precision end-to-end; participant/device identifiers are always strings.
- Generated artifacts (filter list, contract types) are regenerated, never hand-edited.
