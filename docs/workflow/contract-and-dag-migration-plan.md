# Workflow Contract and DAG Migration Plan

## Objective

Replace the fixed, count-branded preprocessing list with one count-neutral workflow
contract that harmonizes scientific operations, typed artifacts, Salsa queries,
plain-language phases, configuration impact, UI projections, and run evidence.
Completion is defined by parity and dependency coverage, never by reaching a
particular number of operations, phases, queries, or checkpoints.

Scientific tables and encodings remain byte-compatible with the `origin/main`
baseline. Workflow protocols, explorer payloads, provenance envelopes, and local
workspace storage intentionally receive a breaking version change. Legacy state is
detected but never parsed, migrated, reinterpreted, or deleted; users are directed
to reselect inputs and reprocess.

## Implementation Status

Implemented on 2026-08-03. Rust now owns the count-neutral workflow registry and
generates the schema, TypeScript projection, semantic resources, explorer plan, and
proof inputs. The runtime records query and query-group execution separately from
semantic operation state, derives configuration impact transitively, and keys reuse
from exact dependency closures. Attribution completeness and compliance threshold
classification are independent invalidation boundaries.

The Pipeline Explorer exposes overview, decisions, lineage, execution, and audit
projections without presenting a topology count as product identity. Legacy storage
is detected by namespace existence only. Contract compatibility, count neutrality,
semantic federation, focused UI/runtime tests, and the dedicated sharded dependency
campaigns are the release evidence; the aggregate test command is not the campaign
runner because it repeats those exhaustive campaigns without sharding.

## Interpretation Layers

| Layer | Responsibility | Authority |
|---|---|---|
| Phase | Nontechnical overview and navigation | Presentation contract |
| Operation | Meaningful scientific action or decision | Semantic contract |
| Artifact | Typed state passed between operations | Semantic contract |
| Query | Actual computation and memoization boundary | Execution contract |
| Checkpoint | Optional durable reuse boundary | Checkpoint policy |
| Evidence | What happened in one run | Runtime evidence contract |

The initial presentation phases are `import_verify`, `standardize_timeline`,
`reconstruct_activity`, `apply_measurement_rules`, `add_context`, `assess_coverage`,
and `create_deliverables`. Their count and membership are derived from the registry.
Relabeling or regrouping them must not invalidate computation.

Reserve “cleaning” for explicit removal or repair. Filtering, duration minimums,
concurrency handling, crediting, and study windows are measurement policy. Matchers
and state machines are inference. Every operation declares whether it preserves,
drops, rewrites, splits, synthesizes, classifies, aggregates, or encodes data.

## Canonical Contract

Replace the step contract with a Rust-owned `workflow_contract.rs`. Authored LinkML
under `web/schema/` defines shapes; Rust defines the workflow instance. TypeScript,
JSON, JSON-LD, documentation, semantic-federation resources, and graph data are
one-way generated projections. A generator must never read labels or descriptions
back from generated output.

The public surface is:

- protocol `chronicle-workflow-contract/v1` from `workflow_contract_json()`;
- protocol `chronicle-workflow-explorer/v1` from
  `plan_workflow_explorer_view_json(request)`;
- run artifact `workflow-explorer-view-json`;
- generated TypeScript value `workflowExplorerView`.

Remove the old stage/step APIs, wire fields, artifact keys, and aliases. Stable IDs
are lowercase, namespaced, canonically ordered, and never reused after retirement.

The contract defines `PhaseDefinition`, `OperationDefinition`,
`ArtifactDefinition`, and `QueryDefinition`. Operations carry their phase, role,
epistemic role, typed ports, applicability, direct option/support/field reads, and
data effects. Artifacts carry their schema, producer, consumers, epistemic status,
materialization policy, equality policy, and audience visibility. Queries carry
physical dependencies, operation mappings, output ports, review behavior, and
resume policy.

Use one Rust-owned applicability grammar: `always`, option boolean/equality/nonempty,
support-role presence, `all`, `any`, and `not`. Classify every option and support
role as semantic, output/presentation, runtime-only, or reserved/no-current-effect.
Only direct reads are authored; transitive impact is graph-derived.

Canonical serialization produces separate semantic, presentation, execution,
checkpoint-policy, and evidence digests. Each operation, artifact, query, and output
port also receives a local definition digest and dependency-closure digest. Salsa
keys use exact effective inputs and upstream artifact identities. Aggregate digests
identify workspaces and gate evidence compatibility but never invalidate unrelated
computation. Presentation and evidence digests never enter scientific cache keys.

## Boundary Refactoring

### Import and timeline

- Turn remapping configuration into a validated input artifact and CSV parsing into
  “Decode source records.”
- Keep missing-timestamp removal as an explicit loss boundary.
- Split canonical-row construction into typed decoding, missing-timezone handling,
  username normalization, device-model attachment, lineage/output initialization,
  interaction-name normalization, and target-calendar derivation.
- Keep stable sorting as an executable artifact boundary unless sortedness becomes
  type-enforced.
- Separate timezone observation, dominant-timezone evidence, policy resolution,
  lossy row selection, and clock standardization.
- Replace the misleading exact-deduplication name with key-based row coalescing: the
  first row for participant, timestamp, interaction type, and package is retained
  while lineage is merged.
- Keep duplicate-timestamp disambiguation and time-gap derivation independently
  addressable; make event precedence a versioned code-owned rule artifact.
- Move remapping only behind timestamp decoding and ordering, never behind
  deduplication without parity proof. Move calendar derivation only after
  midnight-edge parity proof.

### Screen and app reconstruction

- Replace package tags and junk folding with two explicit artifacts: matching source
  rows and the resulting effective package set. Remove tag transport only after a
  policy-neutral reconstruction path proves parity.
- Feed policy-neutral standardized events to both screen and matcher branches so a
  filter-file change does not reconsider screen reconstruction.
- Split screen processing into session skeletons, evidence features, rule
  classification, and materialized classified sessions. Threshold and forcing-rule
  edits reuse skeletons.
- Split matcher preparation into an app-event index and rule masks; keep matching and
  candidate-episode materialization separate.
- Split episode relabeling into structural-row removal, episode classification, and
  minimum-duration suppression. The duration minimum does not delete episodes.
- Keep episode ordering executable. Separate overlap segmentation from the generated
  segment floor, preserving the current background-evidence applicability.

### Context and measurement policy

- Preserve codebook join, broad-category derivation, and genre collapse as distinct
  enrichment operations.
- Split the invariant engagement basis from threshold classification.
- Split long-usage and long-gap flags, retaining the long-gap exception dependency
  in selected-type removal.
- Expose timing suppression, selected-type removal, and zero-duration removal as
  separate policy/loss operations.

### Crediting, study context, and coverage

- Preserve eligible-session partitioning and separate device-activity, reboot, and
  screen-witness indexes, even if one physical query initially emits all ports.
- Separate session capping, liveness, screen intersection, screen-incapable policy,
  capable-but-unwitnessed policy, fallback behavior, and credited-row emission.
- Separate participant-window resolution/application, sharing status, survey lookup,
  default-person inference, survey override, and attribution classification.
- Mark placeholders as synthetic and preserve their raw-date dependency and current
  ability to reintroduce out-of-window rows during the parity tranche.
- Split the participant-day spine, day classification, coverage summarization,
  attribution-minute aggregation, completeness computation, and compliance decision.
  Enrollment affects compliance encoding rather than scoring.
- Preserve the real branch topology: credited output does not flow through study
  windows, person attribution, or placeholders.

### Deliverables and rules

Replace the all-predecessor result carrier with typed ports for scientific tables,
aggregates, encoders, review data, visualization data, lineage, source coordinates,
cell correspondence, influence, provenance, evidence, and the workspace bundle.
Changing one encoder must not rerun scientific computation or other encoders.

Support parsers become conditional validation operations. An unused malformed
optional source must not newly fail a run. Built-in screen vocabularies, engagement
intervals, kids-shell packages, device-family markers, missing-timezone behavior,
and compliance defaults become versioned code-owned rule artifacts visible in Audit
and included only in relevant local digests.

## Recalculation and Persistence

Required reuse points include decoded/ordered rows before remapping, timezone evidence
before timezone policy, session skeletons before screen rules, app-event indexes
before matching, candidate episodes before app inclusion and duration policy,
overlap segments before segment flooring, engagement bases before thresholds,
witness indexes before credit policy, completeness aggregates before compliance, and
scientific tables before output encoders. Scheduling is orchestration-only.

Semantic operation state and physical query state remain independent. A fused query
running does not prove every mapped operation was applied. Keep applicability,
operation, artifact, and query states explicit, including reuse reason and checkpoint
source.

Every semantic joint is mandatory. Splitting a Salsa query is a separate engineering
choice; making that query durable is a further benchmark-gated choice. Promote a
checkpoint only when median and p95 improvement both exceed
`max(0.05 × baseline median milliseconds, 2 × pooled MAD milliseconds)`, no target
edit regresses beyond that noise threshold, and memory/storage budgets pass.

Persist artifact-semantic resume points, not ordinal positions. Multi-output queries
receive independently comparable output-port identities.

## Pipeline Explorer

Retain React Flow and dagre, but replace Steps/Units with:

- **Overview**: default phase graph and deliverables;
- **Decisions**: settings/support inputs, direct readers, and transitive effects;
- **Data lineage**: sources, artifacts, operations, outputs, and typed edges;
- **Execution**: query/checkpoint state, timing, size, and reuse reasons;
- **Audit**: searchable technical registry and focused graph.

Overview does not expose a giant operation list. Disabled operations remain visible
and explain why they are off. Phase collapse contracts the actual graph and preserves
cross-boundary reachability. Every configuration control receives “Show impact,”
distinguishing direct reads, physical reconsideration, semantic changes, and
schema/presence/format effects.

Selected-run evidence may merge with a plan only when semantic, execution,
checkpoint, and evidence compatibility digests agree. Presentation-only changes may
reuse stable semantic IDs and apply current labels.

## Delivery Sequence

1. Install the semantic and presentation contract over unchanged physical queries.
2. Replace old protocols, types, generated projections, graph APIs, and storage keys.
3. Add mandatory in-memory query boundaries with a parity check after every carve.
4. Remove policy-tag transport, junk folding, and all-predecessor carriers.
5. Implement the Pipeline Explorer and derived configuration-impact traversal.
6. Benchmark checkpoint candidates and promote only qualifying boundaries.
7. Regenerate schemas, semantic resources, certificates, provenance, JSON-LD,
   goldens, and count-neutral performance baselines.
8. Ship runtime, UI, generated artifacts, and the new storage namespace atomically,
   with no fallback reader, writer, alias, or feature flag.

Keep `PREPROCESSOR_VERSION` unchanged during parity work and introduce a separate
`workflow_model_version` for the new contract/storage generation.

## Naming and Documentation Cleanup

Move pipeline-graph research under `docs/workflow/` without numeric prefixes. Rewrite
the count-branded incremental runtime plan as `incremental-runtime-plan.md`; do not
merely rename stale claims. Remove obsolete count-branded performance results and
generate fresh `chronicle-incremental-runtime-*` baselines. Rename the measured-debt
document to `semantic-index-and-export-performance.md`.

Remove active uses of `step_contract`, `PipelineStep*`, `step_id`, `step_states`,
`part_of_step`, `unit_id`, `NodeExecution`, `rustStepContract`, `stage-view-json`,
`field-level-step-contract`, ordinal checkpoint prose, and old generated keys.
Replace the broken TypeScript sidecar loop with Rust-owned JSON-LD export validated
against authored SHACL shapes.

Add CI rejecting numeric workflow filenames, exact topology totals in active prose,
registry-length literals, positional registry access, ordinal-derived IDs, and old
workflow names. Protocol versions, dates, scientific thresholds, fixture
cardinalities, and calculated diagnostic counts remain valid.

## Acceptance

- IDs are unique, resolved, acyclic, canonically ordered, and reproducibly serialized.
- Every derived artifact has one producer; sources, outputs, operations, queries,
  options, and support roles are classified by set equality rather than totals.
- AST audits prove exact upstream, option, support, and field reads.
- Presentation and unrelated contract changes cause no scientific invalidation;
  output-port changes invalidate only their consumers.
- Scientific output matches the baseline byte-for-byte across native and WASM while
  intentionally replaced workflow/provenance envelopes are excluded from that oracle.
- Parity fixtures cover deduplication, remapping order, midnight timestamp nudging,
  package-wide exclusion, filter/screen independence, concurrency applicability,
  long-gap exceptions, credit branch topology, placeholders, disabled window
  filtering, and enrollment encoding.
- JSON-LD passes generated and hand-authored SHACL tests, including negative cases.
- Legacy state fails visibly and is never parsed, rewritten, or deleted.
- Explorer behavior passes DOM/text, keyboard, accessibility, responsive, and
  offline tests without image or video inspection.
- Existing performance, memory, deploy, coverage, mutation, parity, and security
  gates continue to pass.
