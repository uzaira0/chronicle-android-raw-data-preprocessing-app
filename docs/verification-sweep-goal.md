# Goal: prove the app end to end before any manuscript work

**Status: COMPLETE 2026-08-27 — endgame chain green end to end on branch
`verification-sweep-endgame`.** build:wasm -> dependency-evidence (run 3,
exit 0; run 1 measured the cells-widening wrong and run 2 was starved by
external host load) -> `make all` fully green (run 9: every Rust crate, all
scanners, 850 web unit tests, 46/46 e2e on chromium+firefox, federation,
17/17 + 3/3 published figures, deploy artifact; runs 1-4 and 7-8 each peeled
one pinned figure or test-strength gate, while runs 5-6 were load-sensitive
Playwright per-test-budget timeouts on the two 3-round @opfs firefox tests --
the 30 s default budget, not any expect timeout, was the binding ceiling, now
owned by playwright.config.ts; zero logic regressions) -> profile A/B
vs PRE_REF (all 8 hot/warm/cold cases: exact query name sets, digests equal
and stable, hot stays 0-query, medians 0.40-0.69x pre-ref — no performance
or validity regression; cold digest == sequential oracle). Opened 2026-08-27;
all four ordered-work sections resolved 2026-08-27 by the five-lane
orchestration + review panels — per-item disposition below and in the
verdicts ledger. Standing directive from the operator:
the manuscript is blocked until the app itself is verified — multiple sweeps,
ontology reasoning that makes the implicit explicit, frontend and backend
concordant and fully contracted, and Salsa properly set up **and verified**.

## Done criteria

1. Every candidate from the four sweeps has an adversarial verdict (CONFIRMED /
   PLAUSIBLE / REFUTED), not just a finder's claim.
2. Every CONFIRMED finding is either fixed with a regression test that fails
   without the fix, or recorded here with the reason it is deliberately not fixed.
3. No verification claim rests on a proxy: no badge, count, or log string standing
   in for a Salsa execution event, and no test whose name is stronger than its
   assertion.
4. `make all` green, with `make dependency-evidence` run **once** at the end of the
   Rust work (not per edit), and the two digest pins harvested afterwards.

## Evidence and working records

- Candidates + verdicts: `/home/opt/chronicle_campaign_backup/sweep_verdicts.md`
  (46 banked candidates; Phase-2 verdicts appended under dated headings).
- Rules that constrain the work: `docs/architecture/authority-and-invalidation.md`,
  `docs/postmortems/2026-08-convergence-campaign.md`, and the CLAUDE.md hard rules.

## Ordered work

### 1. Salsa verification (the priority — sweep 3)

The systemic finding first, because the rest are instances of it:

- **Only the safe direction is gated.** `unjustifiedExecutions`
  (`web/src/testSupport/workflowContract.ts:200`) catches "ran without
  justification"; `cachedWithChangedOutput` (`campaignManifest.ts:132`) catches a
  cached badge whose digest moved. Nothing asserts the dangerous direction — a
  query bound to a changed input that did **not** run. Add that check.
- **The event reconciliation compares counts, not sets**
  (`pipeline_v2_incremental.rs:16211`, also `:15866`, `:16289`): one body recorded
  that did not execute plus one that executed unrecorded cancel out silently —
  the exact pattern the postmortem names. Compare ordered sets.
- **Both cold references leak.** `run_pipeline_v2_with_supports` shares ~88 of 106
  algorithm bodies with the tracked path (an independent *scheduler*, not an
  independent implementation — the docs' "independent cold oracle" overstates it;
  correct the wording). `TrackedEngine::default()` shares the eight thread-local
  alternation caches, so the "cold" arm of ~60 tests is not cold.

Then the concrete defects, each of which needs a failing-first test:

- Alternation-cache hit in `assemble_primary_outputs` returns at `:14570` before
  the `index_raw_dates` read at `:14655` that exists to preserve a declared edge →
  Salsa records a smaller dependency set than the contract declares.
- `ReviewAnnotations::eq` (`:12449`) compares 7 of 12 fields, omitting
  `remove_zero_duration_rows_executed` → backdating on a real change, and a
  requested product step reported as not executed.
- Row-checkpoint accessors (`pipeline_v2.rs:2962`) return `&mut RowData` while
  clearing only their own memoized part, and `RowCheckpointCache` is copied on
  `Clone`. Live near-miss already in tree: the concurrency splitter
  (`:12308-12323`) writes `data.index` (identity) through `edit_temporal()`.
  Prefer the compile-time fix — a bucket-scoped view — over a test alone.
- `ReviewStaticAnnotations::eq` compares only `input_key`, and its covering test
  is a tautology over hard-coded `"blake3:aa"` / `"blake3:bb"`.
- `assert_result_parity` (`:26682`) omits 11 of 40 `PipelineV2Result` fields,
  including both B08 and B09 output surfaces and `workflow_query_digests`.
- G5: `update()` itself is complete today, but its "exhaustive" test covers 56 of
  75 options and has no exhaustiveness gate; five options appear zero times as
  edits. Derive the edit list from a compile-time destructure and assert each edit
  is non-vacuous.
- G6: no rollback on the post-`update` failure paths; only one test reuses an
  engine after an error.
- G3: the persisted-base *key* gate is strong; the resume *path* is swept on
  hand-picked shapes only.
- G4: randomized deep intervention walks are **entirely absent** (no proptest /
  quickcheck / rand in the kernel crate).

Discipline for this section: all production Rust edits → clippy → `build:wasm` →
`make dependency-evidence` **once** → harvest digest pins → `make all`. Test-only
edits are free (build.rs strips `#[cfg(test)]` before hashing).

### 2. Ontology (sweep 2) — 10 banked candidates, none verified

Strongest: no ontology term for the compliance measure the engine actually
computes (and its denominator silently excludes filtered and sub-floor minutes,
while non-shared / zero-usage days are set to 100 in a way that reads as
measured); Dekker cited for keeping uncapped *episode* durations when they kept
extreme participant *daily totals*; `ross_15s` presented without the
polled-instrument caveat the ontology attaches to the same paper elsewhere; the
GESIS repair description omits the ten-intervening-event threshold the kernel
implements.

### 3. Remaining app findings (sweep 4) — confirmed by one agent, not panel-verified

Dead raw-CSV column validation (`validation.ts` exports called from nowhere;
`hasRequiredColumns` never read); support-file schema failure surfacing as
"unresolved binding holes for required roles: {}"; heatmap legend printing
"0 min" at both ends for a sparse participant; app-timeline PNG/SVG not stamping
its timezone; `.xls` accepted by the picker then refused by the runtime; OPFS
hard-block with no ephemeral fallback.

### 4. Worker-boundary leftovers (sweep 1) — after the three refutations

Still open: `PipelineV2OptionsJson` lacks `deny_unknown_fields` while the
enclosing request has it; screen/credit `f64` seconds options unvalidated for
finiteness (`1e999` → `Infinity` into `.to_bits()` Salsa keying); the review-summary
reuse cache's outer map is never evicted; a concurrent eviction can turn a valid
review into a hard "client no longer holds" failure.

## Resolution (2026-08-27, five-lane orchestration)

Every item in sections 1-4 above is now dispositioned; full records in
`/home/opt/chronicle_campaign_backup/sweep_verdicts.md` and the per-lane
audits under `sweepwork/`. Highlights, in the order of the sections:

1. **Salsa**: dangerous direction implemented empirically (warm-vs-cold cell
   AND raw-byte value oracles across all 72 single-option transitions, the t3
   warm chain, and one pair per tomography shard, with anti-vacuity counters);
   reconciliation is now one shared ordered name-multiset compare; alternation
   caches are engine-owned (`Arc<Mutex<AlternationCaches>>`, try_lock so
   re-entry panics by name instead of deadlocking); the `index_raw_dates` edge
   hoisted above the cache hit + digest added to the key (fails-first witness:
   stale participant-amount summary missing row P02); `ReviewAnnotations::eq`
   and `assert_result_parity` rebuilt on exhaustive destructures, and the
   idiom extended to ALL nine hand-written review-cone `PartialEq` impls;
   row-checkpoint bucket views landed compile-time (caught the named splitter
   defect + three more); G5 edit catalog derived from a 75-field destructure;
   G6 invariant (a) pinned; G6b drain unconditional — and the review panel
   found + fixed the SAME leak on the sibling `base_export_executed_queries`
   buffer; G3 mechanical resume sweep off the same catalog; G4 proptest walks
   + starvation shapes + exhaustive pair soak (seeded-defect matrix recorded,
   incl. the measured limitation of random search on 2-option conjunctions).
   "Independent cold oracle" wording corrected to "independent scheduler"
   (88/103 shared helpers, measured).
2. **Ontology**: new terms (ComplianceDayAssessment + basis/sharing/coverage
   vocabulary, TimezoneNormalizationPolicyId), EffectiveUsageMeasure reshaped
   to the credited episode, EventTypeCode corrected, `research_ontology_enum`
   drift gate added (mutation-proven), Dekker/ross_15s/GESIS descriptions
   corrected to what the kernel implements; refusals recorded (no proximity
   axis — no vocabulary to name it).
3. **App findings**: all six fixed web-first (TS column authority deleted in
   favour of Rust's `hasRequiredColumns`; support-file error splice; legend +
   timezone stamp via the shared Scene builder; `.xls` blocked at pick time;
   OPFS degradation fail-closed-classified `unsupported` vs `indeterminate`
   with pre/post-open structural sets) + the 19-finding panel round and a
   verify-the-fixes pass.
4. **Worker boundary**: `deny_unknown_fields` + finiteness guard landed (the
   1e999-ingress claim measured FALSE both directions and asserted in-test);
   outer cache map byte-budget bounded (256 MB derived from the pool's own
   sizing); concurrent-eviction failure fixed by pinned offers; panel added:
   stored admitted sizes (counter cannot drift on detach), offer-time purge,
   offer taken inside the pool slot. Arm-B e2e red DIAGNOSED pre-existing and
   fixed (integrity vs measurement-identity split; retry token reaches the
   web fallback).

**Coverage hole found by the panel, fixed 2026-08-27**: `notification-contact-csv`
and `polled-emulation-csv` were in no researcher-output kind list — the value
oracles skipped exactly the CSVs the B13/B09 axes produce, and the runtime's
correspondence graph omitted their edges. Both added to
`is_researcher_output_kind` (correspondence edges) and `OUTPUT_ARTIFACT_KINDS`
(byte-level warm-vs-cold oracle; subset still pinned by a unit test). An
initial widening of `CANONICAL_OUTPUT_KINDS` was measured wrong and reverted:
the first depev run (2026-08-27, exit 2) failed `fieldMixedTomography`'s
declared-reach gate with 65 undeclared cells per affected source column,
because cell capture admits only cells the contract's `output_cell_bindings()`
declare, and these two kinds have no bindings. Cell-addressing for both kinds
is therefore a single recorded operator decision carrying the full
four-declaration discipline (contract bindings + `ROW_ADDRESSED_OUTPUT_KINDS`
+ `CANONICAL_OUTPUT_KINDS` + declared field reach) — byte coverage and
the researcher-output `publishes` provenance edges are live now; cell coverage
is deliberately deferred with this record as the authority.

**Escalated to the operator with this record (found by the endgame sweep,
2026-08-27):** the runtime crate already HALF-includes both kinds on the cell
side, from their original B08/B09 commits (029e3130a, 2e0b963f0):
`canonical_cell_outputs()` in `chronicle_preprocessing_runtime_wasm/src/lib.rs`
lists them as cell-index candidates, so with either axis ON their cells land in
`result-cell-correspondence-arrow` and their digests in its `derived_from` —
while `is_canonical_cell_output_kind` (untouched since #81) excludes them, so
no `indexes-cells-of` edge is published and the `expected_cell_dependencies`
assertion in the runtime tests would red on the first fixture that enables
either axis. A third disagreement: the researcher-output edge attribution maps
them to query group "outputs" while `canonical_cell_outputs()` declares
"notification_proxy" / "polled_emulation". All shipped fixtures and gates leave
both axes OFF, so every surface is green today and the pinned correspondence
figures (10,202 cells / 46,258 bytes) are unaffected. Both fix directions are
substantive and stale the dependency certificate: stripping the cell-side
half-inclusion (must reconcile the influence-witness scope and four other kind
lists in the same crate, or it re-opens the byte-coverage hole), or full
promotion (requires the four contract declarations first, or the
declared-reach gate reds as measured). This belongs to the same operator
decision as the cell-addressing deferral and must not be resolved as a
drive-by.

**Residuals deliberately not fixed** (each with its reason in the ledger):
alias-table-to-recording-site binding; the union-vs-partition reconciliation
direction (a product body recorded as internal is ungated — needs a
registry-aware check, design decision); Slot-newtype/rg gate for view-field
rebinds; NotAReal marker trait; refused-preflight execution attribution;
runtime projection maps outside invariant (a); G-d non-ALL_ON case shapes for
rawBoundary/artifactIntervention (recorded verbatim in the worker-boundary
report for the depev-authorized run); `make -C web/schema check`
(repro-check + methods-doc-check + LinkML validation) is not wired into the
root `make all` gate — run it explicitly when the schema or ontology moves.

## Already done (2026-08-27, pre-orchestration)

- Sweeps 1–4 discovery complete; 46 candidates banked.
- Adversarial panel refuted three high-severity claims (header-truncated review
  base; failed-query-reported-as-success; ConservativeFull vacuity) — see the
  verdicts file for why each is safe.
- Fixed + tested: the missing settings-validation gate (bounds now single-sourced
  in `validation.ts`, enforced on the Process button *and* pre-dispatch);
  non-destructive file reorder; partial/cancelled batches restored as incomplete;
  `ResultPanel` reads run-scoped options. 8 new regression tests.
- `timezone_handling` default corrected to `selected-convert` (contract v4,
  settings schema v13, release note in `app-usage-semantic-decisions.md`).
- 18 pre-existing lint errors cleared (lint is not part of the `make` gate).

## Open question worth its own investigation

`npm run build` runs `build:wasm`, and Playwright's webServer runs
`npm run build` — so running e2e locally rebuilds the force-tracked WASM even with
no Rust change, and the rebuild is **not byte-identical** (runtime +48 bytes,
semantic index +64 on 2026-08-27). A deploy input that moves without a source
change undermines the commit-the-WASM rule and the pinned byte figures in
`docs/perf/BASELINE.md`. Find the source of the nondeterminism before trusting
either number.
