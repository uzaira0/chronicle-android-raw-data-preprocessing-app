# Configuration-family and configuration-space proof

The product goal is a **provenance-complete, variability-aware research
pipeline**: carry every valid research configuration through the product-owned
DAG, preserve choices that matter, collapse choices only when equivalence is
proved, and verify exactly which results a change can affect.

The shorter engineering name is a **variability-aware semantic build system**.
It resembles a build system because configuration and input changes have an
explicit influence cone, but it also records the research method and evidence
even when two methods happen to produce the same bytes.

## First closed proof

Timezone handling is the first deliberately small family. Its complete
contract is the four-value `TimezoneHandlingMode` enum in the LinkML product
contract:

1. `selected-filter`
2. `selected-convert`
3. `primary-filter`
4. `primary-convert`

The Rust constant, the generated TypeScript enum, and the family test must
match. A missing, duplicate, or unexpected variant fails closed; a label is
never accepted as evidence of completeness.

For one fixed raw input, selected timezone, support set, and all other options,
the Rust/WASM runtime executes all four variants from cold state. It partitions
the observations under six different questions:

| Perspective | Concrete question | Why it remains separate |
|---|---|---|
| Declared method | Which policy did the researcher choose? | Equal output must not erase a research decision. |
| Effective target | Which timezone did selected/primary resolution choose? | This is the deterministic qualification result. |
| Retained source rows | Which exact raw rows survived filtering? | This is the input-to-stage correspondence. |
| Normalized events | What exact Chronicle event state entered the next node? | This proves computational convergence at the DAG joint. |
| Published outputs | Are all researcher-visible CSV/JSON outputs byte-identical? | This is observed result equivalence. |
| Provenance identity | Are outputs, lineage, and resolved method evidence identical? | Reproduction identity is intentionally stricter than byte identity. |

This makes the previously vague “holes” concrete for this product:

- the **binding question** is the assignment of `timezone_handling` and
  `selected_timezone` to `normalize_timezones`;
- the **qualification question** is whether that binding resolves to the
  selected or empirically primary timezone;
- the **correspondence question** is which one-based raw source rows populate
  the normalized-event state;
- the **view question** is how wide the family is under each of the six
  perspectives.

No generic `Artifact`, `Role`, or universal graph class is needed to explain
this proof. The reusable mechanism is only finite variants, explicit
perspectives, exact observations, declared influence, and honest uncertainty.

## Width and convergence

The five existing end-to-end golden scenarios are all single-timezone inputs.
Across each scenario, Rust observes this width profile:

```text
declared method       4
effective target      1
retained source rows  1
normalized events     1
published outputs     1
provenance identity   4
```

This is a proved-simple situation. All four choices computationally converge,
so downstream computation has width one. The method width remains four because
a reproducible record must still say which option was selected.

The repository's pre-existing mixed New York/Chicago synthetic fixture widens
instead:

```text
declared method       4
effective target      2
retained source rows  3
normalized events     4
published outputs     4
provenance identity   4
```

That profile is the DAG equivalent of a violin/Sankey envelope: a broad method
family narrows where choices are equivalent and widens where data and policy
interact.

## Exactness and the anti-staleness rule

The product plan derives the conservative timezone influence cone from the two
knob bindings and transitive DAG reachability. `parse_events` is outside the
cone; `normalize_timezones` is the only seed; its downstream nodes lead to
`outputs`.

The timezone report never invents equality at an unobserved node:

- `exact-observed` means a product-local checkpoint was hashed there;
- `exact-unaffected` means the node is outside the declared cone;
- `exact-inferred` means all variants have identical normalized input and no
  downstream node binds either timezone option;
- `bounded-unresolved` means the true width is between the recorded bounds and
  another product-local checkpoint is required to narrow it.

The mixed fixture runs all 12 ordered changes between distinct policies through
the incremental scheduler. Every incremental result must equal the
corresponding cold full-Rust oracle for normalized state, published outputs,
and provenance. Every touched logical node must be inside the declared cone,
every node in the conservative cone must be touched for this widening fixture,
and `parse_events` must stay cached. This is the first explicit
under-invalidation detector: a stale result cannot pass merely because the DAG
declaration says it is current.

The whole-contract proof now goes further: Rust emits a deterministic,
product-local typed checkpoint at every one of the 15 logical nodes. Membership,
order, temporal state, classification state, payload, and schema are committed
independently; the terminal digest commits to all six. The scheduler
percolates a one-factor change only through direct binders and through an edge
whose upstream semantic checkpoint actually changed. Every warm checkpoint and
output must equal an independent cold target, and the observed input-key set
must equal that predicted percolation cluster exactly. This detects both
under-invalidation (stale state) and logical over-invalidation.

The fused Rust executor remains the physical correctness backstop. A cache miss
still performs one complete fused Rust run to obtain checkpoints; the logical
cache can then cut off downstream propagation. Thus logical recomputation is
proved minimal, while partial physical-stage execution is explicitly not
claimed.

## Evidence and commands

The checked corpus report is
`web/src/lib/pipelineGraph/golden/family-expected/timezone-configuration-family.json`.
It is generated from `GOLDEN_SCENARIOS`, not a second set of friendly fixtures.

```sh
# Verify the checked report and Rust family/transition proofs.
cargo test --manifest-path rust/chronicle_preprocessing_runtime_wasm/Cargo.toml
cd web && npm test -- --run src/lib/pipelineGraph/golden/timezoneConfigurationFamily.test.ts

# Intentionally regenerate after reviewing a contract or behavior change.
cd web && UPDATE_CONFIGURATION_FAMILY=1 npm test -- \
  --run src/lib/pipelineGraph/golden/timezoneConfigurationFamily.test.ts

# Regenerate covering arrays/high-order samples and execute the full campaign.
make combinatorial

# Intentionally refresh the reviewed campaign evidence snapshot.
cd web && UPDATE_CONFIGURATION_SPACE=1 npm run test:configuration-space
```

The on-demand WASM entry point is
`analyze_timezone_configuration_family(request, csv, support_files)`. It
returns canonical JSON; TypeScript supplies bytes and renders future views but
does not construct equivalence classes or influence claims.

## Whole-contract synthetic campaign

The timezone family is the exact per-axis partition proof. It is now embedded
in a wider campaign over the 46 computational axes in the complete 54-field
browser contract. It does not call enums, numeric thresholds, arrays, or strings
binary: every axis retains its product-defined equivalence classes.

- all 97 declared values, 4,593 valid pairs, and 141,499 valid triples are
  covered by the 62-row PICT array;
- 128 fixed-seed configurations add replayable higher-order interactions;
- six deterministic data profiles are generated from the shipped 12,531-row
  codebook and the real 80-package filter, four-package background, and
  five-package forcing-screen-open catalogs;
- profiles inject overlapping sessions, exact duplicates, duplicate
  timestamps, out-of-order rows, mixed timezones, long and missing stops,
  threshold boundaries, remappable/removable interaction types, and quoted or
  Unicode labels;
- 500 valid cold configurations execute through the authoritative Rust/WASM
  pipeline;
- all 62 strength-three configurations are replayed incrementally and compared
  with their cold Rust result;
- all 46 computational options are changed independently and each incremental
  result is compared with a separate cold run, including researcher-visible
  artifact bytes;
- the seven view/execution-strategy fields are proved absent from the Rust
  request projection and produce no recomputation or artifact/result change;
- `studyName` is tested separately as an annotation dependency: changing it
  recomputes exactly `outputs`, leaves every upstream computational observation
  unchanged, and changes the app CSV only by the annotation value;
- every conditionally required support role is independently removed, exposed
  as an explicit binding hole, and rejected by `ExecuteWorkspace`;
- a Chicago-only corpus proves that all eight absent-New-York
  `selected-filter` configurations fail at qualification before output gates.

The first independent option transition found a real missing dependency:
`studyName` affected Rust output bytes but was absent from the output node's
plan bindings. The cold oracle failed, the output node was bound to
`studyName`, `enableAggregates`, and `aggregateShape`, and the full transition
matrix now passes. This is the intended empirical ontology loop: discover a
semantic dependency by execution, encode it in the product plan, and retain a
permanent anti-staleness proof.

The checked campaign evidence is
`web/src/lib/pipelineGraph/golden/family-expected/configuration-space-campaign.json`.
It records source catalog counts, corpus seeds/features, unique output widths,
qualification failures, execution counts, and a digest of the complete case
set.

## Controlled intervention ledger

The broad covering campaign is supplemented by the more direct experiment:
**hold the raw input, every support file, every other option, the plan, and the
implementation constant; change exactly one option value.** The experiment is
not limited to one convenient alternate. For every computational axis it:

1. executes every declared equivalence-class value from cold state;
2. executes every ordered value-to-value transition from the immediately
   preceding source workspace;
3. compares the warm target with an independent cold full-Rust target;
4. records the exact logical-stage checkpoints, logical-node input keys that
   changed, non-cached statuses, materialized role/node states, open
   obligations, row/count changes, processing-summary changes, and
   researcher-visible artifact digests;
5. rejects a changed node outside the plan-declared influence cone, a direct
   binder that stays cached, a warm/cold checkpoint difference, a predicted
   versus observed percolation-cluster mismatch, or any final-result difference; and
6. requires at least one branch-activating witness for every axis called
   computational.

The source and target runs bind the same complete support set. A support file
does not appear or disappear merely because the option controlling its use
changed; that would be a two-factor intervention disguised as a one-factor
test. Binding-hole behavior is tested separately by deliberate support removal.

The six corpora include a dedicated deterministic influence-probe corpus. Its
rows are not toy labels: they reproduce the matcher's own hard cases for stop
reuse, overlong fallback stops, teardown proximity, other-app interruption,
literal zero-duration sessions, keyguard-near-stop classification,
screen-capable/no-witness qualification, and shared-device compliance ratios
on both sides of the declared thresholds.

The current checked ledger covers all 46 computational axes, 97 declared
values, 1,380 ordered transitions, 1,194 cold executions, 2,760 incremental
executions, and 1,194 pre-execution requirement evaluations. All 46 axes have a
substantive observed witness; none are classified as computational only because
their option key reached a node. The complete experiment is 3,954 Rust/WASM
executions and has a canonical case-set digest. It performs 1,380 exact
warm/cold comparisons of all 15 semantic checkpoints and 1,380 exact predicted-
versus-observed percolation-cluster comparisons, with zero stale checkpoints
and zero cluster mismatches. Each transition additionally proves that the set
of changed typed-checkpoint nodes equals the set of changed terminal-checkpoint
nodes and records the exact changed components.

That checkpoint proof exposed and permanently fixed dependencies that final
bytes or a declared DAG alone could hide: the no-usage mode previously ran
screen computation; output visualization consumed app-policy state without a
direct edge; `includeCategoryColumn` altered output schema without an output
binding; and shared-participant qualification affected compliance through
state absent from the attribution checkpoint. Together with the earlier
`studyName`, Parquet, and SPSS findings, these are concrete examples of the
empirical ontology loop doing useful work.

Tracing every production step port against the product plan found two more
observed-but-undeclared direct dependencies: output assembly reads both
`attribute_person` and `observation_window`. Those edges are now explicit even
though the current one-factor corpora cannot isolate them from their parallel
indirect paths through coverage and compliance. The same comparison found the
opposite problem in reconstruction: `useFilterFile` was declared as a direct
option dependency even though its only semantic effect was already completely
represented by the upstream app-policy rows. Reconstruction now derives that
fact from its input data, so the redundant option edge has been removed rather
than preserved as over-invalidation.

This is the permanent empirical ontology loop:

```text
declared value domain
  -> controlled intervention
  -> observed binding/invalidation/state/output effect
  -> product plan knob binding and cone check
  -> checked digest-bound ledger
  -> rerun whenever contract, plan, fixture, or implementation identity changes
```

“Forever” therefore means for the exact contract classes and implementation
receipt recorded in the ledger. Any relevant code or semantic-plan change
changes the receipt or evidence bytes and forces review. It does not mean that
two sampled numeric boundary classes prove every real number equivalent.

The receipt deliberately keeps `implementationDigest` and
`productContractDigest` distinct. The former identifies production Rust source
tokens plus the compiler/target/profile environment; the latter identifies the
product plan and runtime-authority contract. Both participate in scheduler
cache identity, so neither executable drift nor semantic drift can inherit an
older warm result. The semantic-mutation ledger also requires all three source
ledgers to carry the same complete receipt before it will use their observations.

The checked semantic-model mutation gate then falsifies the learned model
itself. It removes and reverses all 23 declared DAG edges, removes all 59
recorded computational-option bindings, and removes all 11 raw/support role
bindings. All 116 mutants are killed: empirical percolation-cluster mismatches
kill the behaviorally distinguishable cases; seven reversed edges are rejected
as cycles; 21 option deletions violate an explicit applicability condition; and
two otherwise empirically confounded output-edge deletions violate required
cross-unit typed step ports. The ledger never relabels those two structural
witnesses as empirical observations.

The checked evidence is
`web/src/lib/pipelineGraph/golden/family-expected/configuration-influence-ledger.json`.
It claims exact logical-stage output correspondence and minimal percolation only
inside its digest-bound implementation/domain/context/corpus scope. It does not
claim that untested real-world inputs cannot reveal a new branch, nor that the
fused physical kernel executes only the changed stages.

## Exhaustive two-factor interaction tomography

Single-factor influence is now supplemented by a complete pair sweep over
every non-baseline declared equivalence-class value for each of the 46
computational axes. This enumerates 1,269 value-level pair contrasts: 1,222
valid and 47 invalid selected-timezone combinations. Every valid contrast
executes through four relevant corners: the shared cold baseline, each valid
single-factor cold result, the pair cold result, and a baseline-to-pair warm
transition. The checked campaign performs 3,717 Rust/WASM executions and 1,222
exact warm/cold and predicted/observed cluster comparisons.

There are 51 declared non-baseline values. Fifty are valid in isolation. The
`selectedTimezone=none` contrast is invalid under the baseline selected policy;
paired with either primary-timezone policy it becomes valid, producing two
explicit qualification-enabled interaction cases. Invalid combinations are
retained with a deterministic reason rather than silently excluded.

The comparison is structural, not a claim of numeric statistical additivity.
For each pair it computes the union of typed-checkpoint components changed by
the two isolated interventions, then compares that union with the components
changed when both interventions are applied. A component appearing only in the
pair is introduced by context; a component present in an isolated effect but
absent from the pair is masked by context.

The deterministic influence-probe corpus currently exposes three such
value-level pairs:

- `selectedTimezone=america_new_york + timezoneHandling=selected_filter`
  introduces an output/temporal-policy component effect;
- `selectedTimezone=america_new_york + timezoneHandling=primary_convert`
  masks thirteen isolated component effects; and
- `otherInteractionTypesToStopUsageAt + modelConcurrentUsage` masks a broad
  downstream row/classification effect because the combined policy converges
  differently from the isolated branches.

The evidence is
`web/src/lib/pipelineGraph/golden/family-expected/interaction-influence-ledger.json`.
It is exhaustive for every valid pair of declared finite equivalence-class
contrasts on this corpus, not for open-domain values, every corpus, or
interactions of arity three and above. Strength-three covering arrays exercise
every valid declared triple elsewhere, but do not claim isolated three-factor
percolation additivity.

Raw temporal behavior is independently checked at 21 adjacent-gap values and
six calendar/DST joints across all six synthetic corpora. Those 162
interventions add 648 Rust/WASM executions and prove exact warm/cold results,
typed-checkpoint changes, qualification correspondence, and predicted versus
observed percolation clusters. This is deliberately separate from option
covering arrays: it tests data-domain boundaries while holding the method
constant.

“Complete configuration space” here means complete over the declared finite
computational equivalence domains at interaction strength three, plus
deterministic higher-order sampling and every single-computational-option
transition. Annotation, view, and execution strategy are separate dimensions
with their own proofs. Literal Cartesian enumeration would be false precision:
string and numeric settings have open domains, and even their finite testing
classes have an enormous product. A closed, low-cardinality family such as
timezone is still fully enumerated.

## How this becomes the larger scaffold

Additional product axes should use the same narrow protocol only after their own
closed value sets, qualification rules, correspondence checkpoints, and cold
oracles are identified. Axes may then be composed with covering arrays or full
enumeration according to their cardinality. A shared abstraction is promoted
only when two real product axes require the same contract; Chronicle's timezone
vocabulary and node semantics remain Chronicle-owned.
