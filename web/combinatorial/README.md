# Combinatorial coverage of the processing-option contract

Implements §S3 of `docs/workflow/dag-validate-ontologize-productize-research.md`: measure
how much of the option space the executed test suite actually reaches (NIST CCM),
then close the gap with generated covering arrays (Microsoft PICT).

Everything here derives from the LinkML contract via
`web/scripts/generate_combinatorial_model.mts`. The product contract has 80
browser fields, but only 72 are preprocessing-computational axes. Those 72 map
to named equivalence classes (booleans → true/false, enums → every value,
numbers → default plus product-relevant boundaries, arrays → default plus
empty/alternate classes, presence markers → `unset`/`true`). The generator
still requires a declared domain for all 80 fields and fails loudly when the
contract grows a key it does not know.

Eight orthogonal fields are intentionally absent from the covering-array
denominator:

- `studyName` is an annotation axis. It is proven to invalidate exactly output
  assembly and to change only the emitted annotation while leaving upstream
  computation unchanged.
- `enablePlotting`, `includeFilteredAppUsageInPlots`, `enableActivityHeatmap`,
  `exportPlotsAsSvg`, and `enableInteractiveTimeline` are view/rendering axes.
- `parallelProcessing` and `parallelMaxWorkers` are execution-strategy axes.

The seven view/execution fields have exact request-projection and executable
Rust-result invariance tests. They are factored out because no-effect is proved,
not because they happen to look boolean or label-like.

Regenerate, remeasure, and execute the Rust/WASM campaign with
`make combinatorial` (repo root). The command has a
portable, exact valid-tuple coverage verifier and uses the checked-in arrays
when PICT is unavailable. If `pict` is on `PATH` (or `PICT_BIN` is set), it also
regenerates them. NIST CCM is an optional independent differential measurement,
not a workstation-specific prerequisite. Tool build instructions are in
`scripts/run_combinatorial_coverage.sh`.

## Files

| file | role |
|------|------|
| `model.pict` | Microsoft PICT model (equivalence classes + illegal-combo constraints) |
| `model.acts.txt` | Same model in NIST ACTS format, consumed by CCM |
| `existing_tests.csv` | The 150 EXECUTED test configs (6 parity scenarios + 128 exec-gate sweep + 16 analyze-gate sweep), projected onto the classes |
| `covering_t2.tsv` / `covering_t3.tsv` | PICT covering arrays (all pairs / all triples) |
| `covering_array_t2.json` / `covering_array_t3.json` | Decoded full option objects, executed by `web/src/lib/pipelineGraph/golden/configurationSpaceCampaign.test.ts` |
| `seeded_high_order_00c0ffee.json` | 128 replayable, legal high-order configurations sampled from the same equivalence-class authority |

Constraints model the illegal/inert regions: `selected-*` timezone handling
requires a selected timezone; `primary-*` ignores it (pinned to `none` so inert
variation stays out of the coverage denominator); and the four B06
maximum-duration keys travel as one vector with five legal shapes (omitted;
explicit `strategy_native`; `chronicle_observed_close_rejection_v1`, which
additionally requires the fused reconstruction strategy; and the generic
`post_reconstruction_strict_max_v1` with an active disposition and a fixed
threshold). Every other pairing is refused before reconstruction and is
excluded from the model rather than counted as an uncovered tuple. The
`b12_adaptive_participant` threshold source is a standing refusal (no
provider) and is therefore not a model class.

## Exact checked coverage

The counts below describe the recorded incremental campaign revision, not
acceptance of the merged source; regenerate implementation-bound evidence before
publishing merged counts.

| array | rows | one-way tuples | two-way tuples | three-way tuples |
|------|------|----------------|----------------|------------------|
| PICT t=2 | 48 | 179/179 | 15,680/15,680 | 816,505/896,745 |
| PICT t=3 | 268 | 179/179 | 15,680/15,680 | 896,745/896,745 |

The hand-written sweeps varied only the 11 gate booleans around two base
points (ALL_ON and the parity defaults) — every pair involving a non-gate knob
(thresholds, timeouts, enum values, array shapes) was untested until the
covering arrays. The 268 t=3 configs (which also cover every t=2 tuple) plus
the 128-row seeded sample execute in the unit suite
(`configurationSpaceCampaign.test.ts`) against six synthetic corpora through
the Rust/WASM runtime: configuration-only opener refusals are committed before
execution, and a source-sensitive screen strategy that refuses a corpus's
non-monotonic timestamps is committed per corpus with warm/cold receipt
identity rather than executed.

Notes:
- The full Cartesian product is intentionally not enumerated: several fields
  have open numeric/string domains, and even the finite equivalence-class
  product is enormous. The checked-in campaign instead proves every valid
  one-, two-, and three-way tuple exactly, then adds a fixed 128-row high-order
  sample. Every executable configuration runs against multiple seeded
  synthetic corpora through the authoritative Rust/WASM runtime; the exact
  EYES/wide-opener incompatibilities are retained as typed refusals and never
  enter reconstruction.
- The campaign changes all 72 computational options independently and compares
  every incremental result with a cold Rust run. `studyName` has a separate
  exact output-node dependency proof. The seven view/execution options must
  leave the Rust projection, semantic result, artifacts, and recomputation set
  unchanged.
- A second controlled-intervention ledger executes all 179 declared
  computational values and all 3,876 ordered one-factor transitions against
  six deterministic corpora. Source and target use identical raw/support
  inputs; 2,170 cold and 7,712 incremental Rust/WASM runs prove warm/cold parity,
  compare every checkpoint projected by the runtime, require the observed invalidation
  set to equal the deterministic semantic percolation cluster, enforce the plan
  cone, and retain the exact observed effect set. A dedicated influence-probe
  corpus makes every one of the 72 computational axes produce at least one
  substantive witness. Within these explicitly incremental campaign requests,
  recomputation status comes from actual Salsa query bodies plus explicitly
  instrumented product-step evaluations inside review-only fused queries. The
  separate sequential Rust run is an independent scheduler comparison that
  shares the scientific stage functions; it is not an independent algorithm implementation.
- The artifact dependency tomography ledger then holds the full configuration
  constant across all eleven raw columns, four raw-row mutation classes, eight
  substantive support-role mutations, and nine byte-different representation
  controls. Its 32 intervention kinds are applied to all six synthetic corpora:
  192 cases and 768 Rust/WASM executions require exact warm/cold checkpoint
  parity plus exact declared-versus-observed percolation. The companion raw
  boundary campaign adds 162 timestamp cases and 648 executions at adjacent-
  gap, calendar, and DST joints. Both campaigns also compare canonical
  Rust-produced CSV/JSON cells warm versus cold. Their compressed,
  digest-addressed correspondence sidecars retain 910,212 exact changed-cell
  addresses (221,609 artifact + 678,905 raw-boundary) in the recorded 2026-10-01 campaign,
  without inflating the human-reviewable ledgers. These revision-bound receipts
  do not establish final merged-source application acceptance.
- Exact two-factor tomography enumerates all 5,617 non-baseline value-level
  pair contrasts across the 72 computational axes (2,556 axis pairs): 5,505
  executable warm/cold proofs, 103 deterministic invalid qualification cases,
  nine typed refusals (one opener-set, eight maximum-duration policy ×
  reconstruction-strategy incompatibilities), 16,622 Rust/WASM executions, and
  explicit non-additive or qualification-enabled interactions.
- The semantic-model mutation gate then treats the declared dependency model as
  falsifiable data: all 164 edges are deleted and reversed, all 172 computational
  option bindings and all 20 raw/support bindings are deleted, and all 520
  mutants must be killed. Empirical mismatch, structural cycle, applicability
  condition, and required typed-step-port witnesses remain distinguishable.
- CCM's stock `ccmcl.jar` cannot run headless (Swing `JFrame` in a static
  initializer). The repository therefore does not require a private patched
  build: its exact verifier is the gate, while a `ccm` on `PATH` or `CCM_CMD`
  enables a differential measurement.
- CCM at t=4 with constraints is slow (choco solver per combination); measure
  t≤3 routinely, t=4 only when needed (`TWAY=2,3,4`).
