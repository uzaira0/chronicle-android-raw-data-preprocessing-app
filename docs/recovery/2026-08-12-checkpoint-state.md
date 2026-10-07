# Checkpoint state — 2026-08-12

Recovery checkpoint for the `delivery:B02`–`delivery:B14` convergence campaign. This records
the exact verified state at the moment the campaign's 48k uncommitted lines were committed,
so a later reader can tell what was proven and what was still outstanding.

## Why this checkpoint exists

The campaign ran for ~26 hours without a commit while accumulating 48,020 insertions /
14,028 deletions across 98 tracked files plus 26 untracked paths. None of it was recoverable
from git. Verification before committing found the tree was **red**, in three independent
ways that no session record could have revealed — Codex's code-mode host persists no exit
status, so 22,426 tool calls carried no evidence of pass or fail.

## What verification found and fixed

| # | Problem | Nature | Resolution |
|---|---|---|---|
| 1 | `assemble_result_manifest` declared source roles `{enrolled_devices_file}` but observed `{enrolled_devices_file, raw_chronicle_csv}` | **Real defect** — under-declared dependency, the missing-invalidation class | Declared the role + added `APP_MODE_WITH_EYES_COMPLEMENT` predicate mirroring `eyes_complement_is_active` |
| 2 | 5 contract/digest goldens stale after workflow-contract changes | Derived artifacts never regenerated | Re-recorded with `UPDATE_GOLDEN=1` |
| 3 | Committed WASM was protocol `v1`, Rust source `v2` | Force-tracked artifact never rebuilt; masked campaign behavior across the web suite | `npm run build:wasm` |
| 4 | `fileInspection.test.ts` asserted pre-campaign warning wording | Stale assertion exposed by (3) | Updated assertion + corrected the stale `FU7` comment |

### On (1) — the under-declared read

`pipeline_v2_incremental.rs:14887` (`let raw_bytes = raw.bytes(db)`) reads the raw physical
stream inside `assemble_result_manifest` for the EYES input-partition preflight. It is gated on
`eyes_complement_is_active`: app-mode ∧ `episode_reconstruction_strategy == "eyes_complement"`.
The declaration now mirrors that gate exactly rather than declaring the role unconditionally.

### On (3) — what the stale WASM concealed

The committed WASM predated the entire campaign. Web tests crossing the Rust boundary were
validating pre-campaign behavior. Rebuilding took the web suite from 2 failures to 4 — not a
regression, but the suite finally seeing the campaign's real code. Example: matching became
**participant-scoped**, changing the multi-participant warning; the TS test still asserted the
old wording and passed only because of the stale binary.

**Lesson for the remaining axes:** a force-tracked generated artifact that is not rebuilt turns
its gate into a rubber stamp. `npm run build:wasm` belongs in the per-axis definition of done.

## Scientific-output invariant: HELD

No data golden moved at any point. Verified byte-identical:

`app.csv`, `screen.csv`, `credited_app.csv`, `day_coverage.csv`, `compliance.csv`,
`row_lineage.json`, `review_summary.json`, `visualization_data.json`, `aggregate_kinds.json`,
and all five `aggregate-*.csv`.

Only these moved, all pure contract/digest identity:
`counts.json` (18 keys, **only** `workflowQueryGroupDigests` differs — all 17 count fields
identical), `workflow_contract.json`, `workflow_query_digests.json`,
`workflow_query_checkpoints.json`, `workflow_query_group_checkpoints.json`.

Note: a checking run reports only the *first* stale golden per test, because `assert_matches`
panics on first mismatch. Two of the five above surfaced only under `UPDATE_GOLDEN=1`.

## Verified green at checkpoint

```
cargo test --locked --manifest-path rust/chronicle_chrono_kernel_wasm/Cargo.toml \
  --features incremental-v2
  → test result: ok. 482 passed; 0 failed; 1 ignored     EXIT=0

cd web && npm run typecheck                              EXIT=0
cd web && npm run build:wasm                             EXIT=0
```

## Known red at checkpoint — 4 web test files

Committed deliberately. All four are stale **generated artifacts**, not product defects, and
none touches scientific output.

> **Corrected 2026-08-12.** An earlier revision of this file listed only three files and
> swapped the `fieldLevelProvenance` / `fieldMixedTomography` symptoms. The table below is
> re-derived from `web-test2.log` directly. A wrong red list is worse than none — it sends the
> next reader chasing a phantom regression.

| Test | Symptom |
|---|---|
| `web/src/lib/rustPipelineRuntimeContract.test.ts` | `Rust workflow query contract and embedded product plan disagree: rust_only=["construct_screen_intervals"], plan_only=[]` |
| `web/src/lib/semanticIndex.test.ts` | same error, byte-identical — same root cause |
| `web/src/lib/pipelineGraph/golden/fieldLevelProvenance.test.ts:334` | sha256 digest mismatch |
| `web/src/lib/pipelineGraph/golden/fieldMixedTomography.test.ts:430` | `expected undefined to deeply equal [ …(8) ]` |

Web suite otherwise: **702 passed, 109 skipped** (628 after the B06 oracle prune removed 74
tests — see commit `659f371`; the drop is deleted tests, not breakage).

**One shared root cause.** The WASM embeds
`.semantic-federation/semantic/resources/chronicle.plan.json`, which carries 56 queries and
lacks `construct_screen_intervals` — the query the B03-B05 work added to the Rust contract.
The same omission makes the generated `web/schema/chronicle-workflow.yaml` 89 operations
against Rust's 90. `make dependency-evidence` regenerates both and is expected to clear all
four.

### Blocker

`make dependency-evidence` is the indicated fix and currently **cannot run**:

```
Error: regenerate semantic profile failed to start: spawn semprof ENOENT
make: *** [Makefile:198: dependency-evidence] Error 1
```

`Makefile:33` resolves `SEM_PROF_BIN` to `$(HOME)/semantic-profile-toolchain/target/debug/semprof`,
falling back to a bare `semprof` on PATH. Neither exists. `.semantic-federation/toolchain.lock.json`
pins the toolchain to `uzaira0/semantic-profile-toolchain` @ `d46708a14c49143e783b3ec251850a13c5623533`
(package `semprof-cli` v0.1.0). Only an ephemeral build under `/tmp` exists, left by the campaign.

**Next action:** provision the pinned toolchain at `$HOME/semantic-profile-toolchain`, re-run
`make dependency-evidence`, then re-run the web suite.

Caution: `Makefile:193-196` warns this target rebuilds a *temporary evidence* WASM before the
normal fail-closed package, and dies after that rebuild on ENOENT. After any failed run,
re-run `npm run build:wasm` and confirm the package matches the fail-closed profile before
committing. This was done here and verified against the HEAD baseline's symbol profile.

## Correction — the checkpoint's green list was incomplete

`cargo test --manifest-path rust/chronicle_preprocessing_runtime_wasm/Cargo.toml`
(`Makefile:98`) was **never run** at the checkpoint. The "Verified green" block above
records only the kernel crate, typecheck, and `build:wasm`. Run afterwards, the product
runtime crate was **red at HEAD**: 79 passed, 17 failed.

It also *aborted* rather than reporting: `execute_workspace` maps its error through
`JsValue::from_str`, a non-unwinding panic on non-wasm32, so a single failing request
killed the test process with SIGABRT before any failure detail printed. That is why the
failure count varied between runs (30–35) — the harness died at different points. Fixing
the request fixture removed the abort, and the suite now reports a stable 79/17.

`58c44de` fixes three defects found this way (bound-field omission in the canonical request
fixture; two artifact-campaign expectations that contradicted the campaign's own documented
design). See that commit message for the full reasoning.

**Lesson, and it is the same one as the stale WASM:** a gate that is never run is
indistinguishable from a gate that passes. `make ci` runs this crate; the campaign never
completed one.

## The remaining runtime red has a single cause

All 17 failures share one root: the embedded dependency certificate is stale against this
build — recorded `sha256:521dd7f2…`, built `sha256:64952b3a…`. The runtime then falls back
to `DependencyCacheMode::ConservativeFull` and rebuilds cold on every run, so every
warm-reuse test sees `Recomputed` where it expects `Cached`.

`a_stale_dependency_certificate_names_itself_and_the_command_that_fixes_it` exists precisely
to say this in one place, and its doc comment predicted the symptom exactly.

The cure it names, `make dependency-evidence`, is **not sufficient on its own**, and this is
worth recording because it is not obvious from the target:

- `scripts/generate_semantic_behavior_inventory.py --certificate-only` **reads** the
  implementation receipt from the campaign proof ledgers (`DEPENDENCY_PROOF_LEDGERS`); it
  does not compute it. Re-running it against unchanged ledgers rewrites the same bytes.
- So the campaigns must produce fresh ledgers **first**. `make dependency-evidence` does run
  them, but its `artifact interventions` stage currently fails, so the ledgers never move.
- The implementation digest excludes `#[cfg(test)]` items (`build.rs` parses with `syn`),
  which is why the fixture fix in `58c44de` did not shift it. What did shift it is the
  `workflow_contract.rs` source-role fix committed at the checkpoint — the ledgers predate it.

## Next blocker — a real declared-vs-observed drift — SUPERSEDED 2026-08-13

**Resolution (2026-08-13):** this blocker is closed as superseded, not as fixed, because
the assertion it was filed against no longer exists. `predictExecutedQueries` and the
declared-equals-observed equality below were **removed by design** — `inputs` is a
may-read mirror and Salsa alone owns invalidation, so no declaration can predict a
per-arm execution set. See
[`docs/architecture/authority-and-invalidation.md`](../architecture/authority-and-invalidation.md).

Only one direction of that equality was ever dangerous: a query that *ran* with nothing
upstream of it having changed — the "executed but not declared" row below. That direction
is now covered outright by the justified-execution gate (`unjustifiedExecutions` in
`web/src/testSupport/workflowContract.ts`), asserted per intervention case by every
tomography campaign under `web/src/lib/pipelineGraph/golden/`. The other direction —
declared but not executed, the 13 queries below — costs nothing and is no longer
asserted.

The verifier's 2026-08-13 battery measured **0 unjustified executions across all
intervention cases**, at 39–53 executed queries per case. The three named queries
(`bind_processing_timestamp`, `classify_compliance_days`, `index_survey_responses`) each
executed with a justification present. So the drift this blocker anticipated did not
materialize once the gate was grounded in observation rather than in a hand-rolled
prediction. The record below is retained as the historical diagnosis.

`make dependency-evidence` now reaches its campaign stage (earlier attempts died at semprof
ENOENT, hook timeout, and SIGTERM, so this code had never executed). It fails in
`artifactInterventionCampaign.test.ts` on the assertion the gate exists for:

```
catalog-random:raw-field:study_id: declared inputs and actual Salsa query bodies
must agree exactly: expected [ …(43) ] to deeply equal [ …(53) ]
```

`predictedExecutedQueries` (declared) names 53; the warm target actually executed 43.

| Direction | Queries |
|---|---|
| Declared but not executed (13) | `attach_device_models`, `canonicalize_source_rows`, `coalesce_duplicate_event_keys`, `construct_screen_intervals`, `decode_source_records`, `derive_time_gap_evidence`, `disambiguate_duplicate_timestamps`, `estimate_dominant_timezone`, `infer_screen_session_skeletons`, `order_source_records`, `remove_missing_timestamps`, `resolve_timezone_strategy`, `standardize_event_clock` |
| Executed but not declared (3) | `bind_processing_timestamp`, `classify_compliance_days`, `index_survey_responses` |

The second row is the dangerous direction — three queries that really read the changed input
and are not declared to. Diagnose before touching any expectation: this is the gate working.
[SUPERSEDED 2026-08-13 — the equality this table diagnoses was removed by design; the
2026-08-13 battery found all three of these queries justified, and 0 unjustified executions
overall. See the resolution note at the head of this section.]

## Repair pass, 2026-08-13 — what the parallel run and the follow-up found

A 21-agent parallel run (diagnose → adversarially refute → fix) plus direct follow-up
work. Commits `6c3338e`, `2595c57`, and the conditional-input-edge change after them.

### The defect that mattered most was in neither original diagnosis

`TrackedInputs::update` derives `UsageConfigInput::review_only` from
`materialize_full_outputs`. The preflight passed `false` while `execute` passed `true`,
so the Salsa input revision bumped **twice per request**. Six queries reading
`config.review_only(db)` recomputed on every preflight-bearing request even with
byte-identical raw bytes, identical options, and a chained root. Measured: a warm
identical repeat went from 6 recomputed to 0.

This was user-visible — the Graph panel reported those stages as reused in runs that
recomputed them. Two independent diagnoses each listed these six as "unexplained
always-recompute" and set them aside; only implementation found the shared cause.

### Two tests were weaker than their names, and both are now stronger

`raw_artifact_is_exposed_only_to_the_parse_node` evaluated `active_source_roles` with an
**empty** exact-options map, so every predicated binding evaluated false. It only ever
asserted "no query reads raw *unconditionally*". Two predicated raw readers predating
this campaign — `match_app_episodes` and `assemble_result_manifest` — were invisible to
it and would have failed it. It now carries a named `PERMITTED_RAW_READERS` list with
per-reader justification, evaluated across four option maps covering every predicated
raw binding, with exact set equality so a stale entry cannot license a vanished read.

The four representation/ignored-field controls asserted that no query digest moves under
a CRLF rewrite. `construct_screen_intervals` publishes the raw byte digest as
`applicability.input_digest`, which `validate_screen_construction_output` checks when
resuming a persisted construction — a fail-closed tamper check. A value whose purpose is
byte identity *must* move when bytes move, so that assertion could only have held if the
tamper check did not exist. The controls now assert the scientific claim directly — no
researcher-visible output cell may move — which `changedOutputCellAddresses` already
computed and wrote into the ledger but never checked.

**Operator decision (2026-08-13):** keep the tamper check, fix the checks. The
alternative — dropping the raw binding from the neutral arm — would have cleared all
four controls at the cost of that protection.

### Scope correction (2026-08-13, after operator review)

An earlier revision of this section — and of the code comments — justified the
conditional-edge work with *"`inputs` stays the conservative superset that drives Salsa
invalidation."* **That claim is false and has been corrected everywhere it appeared.**
The 84 `#[salsa::tracked]` functions record their own reads per revision; Salsa's
dependency graph is dynamic and exact by construction, and `WORKFLOW_QUERIES` is never
consulted to decide recomputation — only for registry ordering, counts, and validation.

The real (and smaller) justification: `inputs` is a hand-maintained static mirror
published in the workflow contract and consumed by the plan, `workflow_provenance.rs`,
the semantic index, and the Graph panel. A mirror that states an unconditional edge
where the body branches is inaccurate documentation, and every consumer reasoning over
it over-predicts. The tomography campaigns exist to catch exactly that drift.

The same review surfaced worse: the declared-side expectation was re-implemented in
**five** campaign files, each subtly different, none conditional-edge aware — five
hand-rolled models of graph reachability. All five now delegate to a single
`predictExecutedQueries` in `testSupport/workflowContract.ts`, colocated with the
contract types (`ada843f`). [SUPERSEDED later the same day — the consolidated
`predictExecutedQueries` was itself deleted; the five campaigns now call
`unjustifiedExecutions` in that same file. See the next section.]

### Conditional input edges — SUPERSEDED, then removed (2026-08-13)

The mechanism described below survived roughly two hours. On operator direction
("remove everything hand-rolled"), `QueryConditionalInput`, `query_conditional_inputs`,
`inputEdgeIsActive`, and the consolidated `predictExecutedQueries` were all deleted:
with per-arm execution prediction gone, nothing consumes per-arm edge precision.
`inputs` is now documented as a **may-read** set, and the drift gate is the pair of
observation-grounded properties (justified execution via `unjustifiedExecutions`;
no cached badge with a moved digest) — see
`docs/architecture/authority-and-invalidation.md`, which is the current statement of
this design. The section below is retained as the historical record of the
intermediate state.

### Conditional input edges (historical)

Fixing the controls exposed the next layer: `classify_screen_sessions` and
`match_app_episodes` were predicted to execute but did not. Both reach
`construct_screen_intervals` / `decode_source_records` only on one arm
(`screen_session_construction_strategy != default`, and the Schoedel episode strategy
respectively), while `WorkflowQueryDefinition::inputs` declares those edges
unconditionally and had no predicate mechanism.

`QueryConditionalInput` + `query_conditional_inputs()` now record **when** an edge is
live, mirroring `QuerySourceRoleBinding::when_all` and reusing the same predicate type.
`inputs` is deliberately **not** narrowed: it stays the conservative superset that drives
Salsa invalidation, [RETRACTED 2026-08-13 — false: Salsa never reads this table; `inputs`
is a may-read mirror and drives nothing. See the "Scope correction" above and
[`docs/architecture/authority-and-invalidation.md`](../architecture/authority-and-invalidation.md).]
because a declared-but-skipped edge only costs a recomputation
whereas a missing edge serves a stale result. The declaration is consumed only for
reachability, by the campaign predictor via `inputEdgeIsActive`. [Both the predictor and
`inputEdgeIsActive` were deleted the same day; see the SUPERSEDED note above this
section.]

## Outstanding — found by the WASM-boundary audit, NOT yet fixed

Rebuilding the WASM exposed a class of change that had been invisible. Baseline for this
class is **`e02ab1e`** (the last commit that built `web/src/wasm/*/pkg/`), not `HEAD` —
diffing against `HEAD` misses it, which is why the participant-warning change looked
identical on both sides.

### 1. Thirteen Rust tests are switched off — highest priority

```rust
// rust/chronicle_semantic_index_wasm/src/lib.rs:3629
#[cfg(all(test, any()))]
mod legacy_tests_v5 {
```

`any()` with no arguments is unconditionally false, so the module never compiles.
`Makefile:100` runs `cargo test --manifest-path $(SEMANTIC_INDEX)` and reports success.
The mechanical cause: `rebuild_semantic_index` gained a second parameter
(`scientific_artifact_bundle`) and the module's 25 call sites still pass one argument, so it
was gated off rather than updated.

No longer checked: protocol-version rejection, `executionLedger` / `dependencyCacheDecision`
validation, `missing_query_execution_surface_fails_closed`, digest-tamper detection, rebuild
determinism. Findings 2-4 below are all downstream of this — **fix it first**, then triage.

Related fixture rot inside the disabled module: `complete_source()` declares
`chronicle-semantic-index-source/v5` against a `v7` gate and embeds
`chronicle-eyes-runtime-summary/v1` against a `v2` gate. Re-enabling without fixing these
produces failures that look like protocol bugs but are stale fixtures.

The same signature change also silently mistyped `web/scripts/measure_perf_debt.mts`
(fixed) — one change, three surfaces, each concealed rather than propagated.

### 2. Possible live break in review mode

`rust/chronicle_semantic_index_wasm/src/lib.rs:3392` narrowed accepted execution status to
`"cached" | "recomputed" | "bypassed"`. The runtime still emits `"skipped"` for the 12
queries marked `Omit` (`workflow_contract.rs:4904-4919`) whenever
`materialize_full_outputs` is false, i.e. every `QueryReview` run — and
`semantic-index-source-json` is pushed unconditionally. `semanticIndex.test.ts:39` only
exercises a full execution, so **no test covers a review-mode rebuild**. If a review run
commits a root carrying `skipped`, the Graph/Explorer panel fails. Verify, then either
accept those statuses or filter them before they reach `queryExecutions` — and add the
missing test either way.

### 3. `docs/METHODS.md:238` publishes a claim that is now false

> *"**Suppress short durations** — Blank durations below the configured minimum without
> deleting episodes."*

The contract has since gained `drop_row` (`MINIMUM_DURATION_DISPOSITION_VALUES`) and
`policy.apply_app_inclusion` gained `DropsRows`. The options section of METHODS.md
regenerated correctly; only the DAG table, which flows through the stale
`chronicle-workflow.yaml`, did not. This is a research-correctness problem, not cosmetics.

### 4. `DropsRows` has no coverage

`workflow_contract.rs:875` changed `[Classifies]` to `[Classifies, DropsRows]`.
`graphProjection.ts:83` branches on that value so node rendering changes, but its test uses a
hand-built fixture and never asserts the real contract value. The operation's description was
also not updated to mention dropping.

## Preserved evidence

- `docs/recovery/2026-08-12-precheckpoint.txt` — pre-commit `git status --porcelain` + HEAD
- `/home/opt/chronicle_campaign_backup/worktree-src-2026-08-12.tar.gz` — 928 source files,
  build artifacts excluded (26G worktree is 25.4G regenerable `target/` + `node_modules/`)
- `/home/opt/chronicle_campaign_backup/*.log` — verbatim output of every run above
