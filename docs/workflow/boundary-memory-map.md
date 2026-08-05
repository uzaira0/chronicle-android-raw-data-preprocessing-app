# Step-Boundary Grep-Weights Artifact

This is the required pre-research memory map for the pipeline-boundary review. It records
repo observations and recalled concepts as hypotheses, not as external evidence. It was
frozen before web discovery so later source selection cannot silently rewrite the prior.

## 1. Disambiguation

The request is not principally to find a better fixed total. It is to stop one list from
doing four incompatible jobs:

1. describe the scientific and data-processing meaning of the workflow;
2. choose execution and memoization boundaries;
3. explain the workflow to nontechnical users; and
4. record detailed retrospective provenance.

The repository began with executable transformations inside coarser memoized units. The
same word, *step*, is used for both scales, while the UI projects both as alternate views of
one graph. The useful question is therefore: what semantic operations and typed artifacts
exist, which of those deserve checkpoints, and which projection should each audience see?

“Affected by a setting” is also ambiguous. It may mean directly reads the setting, must
re-run because an input changed, may produce a different value, changes only an output
schema, or changes only whether an artifact is emitted. Those relations must not share one
edge type.

## 2. Canonical Answer

My current best model is a multi-resolution pipeline contract with independent axes:

- **Semantic operation:** one stable verb with explicit input and output artifacts.
- **Artifact:** a named, typed state of the data, including support inputs and output sinks.
- **Parameter binding:** the smallest operation that directly reads a setting, with its
  downstream impact derived from artifact edges.
- **Execution/checkpoint plan:** a performance projection that may fuse operations or cache
  selected artifacts without changing the semantic graph.
- **Presentation hierarchy:** plain-language phases and expandable operation groups.
- **Run provenance:** what actually executed, bypassed, reused, generated, or lost rows.

A semantic boundary is justified when at least one of these changes at the boundary: named
artifact contract, exact parameter dependencies, consumer fan-out, evidence-versus-policy
role, loss/inference behavior, independently testable invariant, recovery behavior, or
material recomputation value. A helper function is not automatically a graph operation.

A checkpoint is justified separately. Its expected avoided recomputation must outweigh
hashing, equality, memory, serialization, and invalidation-management costs. This suggests
seven or so user-facing phases, a finer semantic/audit DAG whose count is emergent, and a
smaller profiled set of materialized checkpoints.

## 3. Adjacent and Competing Options

- Keep only the coarse units and improve their labels. Simple, but parameter impact and
  intra-unit recomputation remain opaque.
- Cache every existing transformation. Improves granularity, but treats historical
  function boundaries as semantics and can make memory/equality overhead dominate.
- Make every helper and output encoder a node. Maximizes trace detail but creates an
  unreadable and unstable public contract.
- Adopt an external workflow engine. It may supply lineage and caching, but risks losing the
  browser-local typed-array execution model and byte-exact parity.
- Use a compiler-like intermediate representation. Strong for dependency analysis and
  fusion, but it needs a separate human vocabulary and scientific provenance projection.
- Use only artifact/asset nodes, with transforms represented as edges. Strong for data-state
  storytelling but weak for naming policies, algorithms, and execution records.
- Use only task nodes, with artifacts implicit. Familiar, but it hides schemas, loss points,
  and reusable checkpoints.
- Maintain separate hand-authored graphs for users, execution, and provenance. Flexible but
  invites drift; projections should instead derive from one contract.

## 4. Commonly Confused Items

- A workflow DAG is a data-dependency graph here, not a causal-inference DAG.
- A semantic operation is not necessarily a scheduled job, cache entry, UI card, or trace
  span.
- A cache entry is not automatically a durable scientific checkpoint.
- Provenance answers what produced an assertion; invalidation answers what must be
  reconsidered after a change.
- A direct parameter reader is not the same as every downstream result that may change.
- A bypassed operation, disabled capability, cache hit, no-op result, and early-cutoff result
  are different states.
- Raw-event cleaning, episode reconstruction, measurement-policy curation, and study-cohort
  filtering should not all be called simply “preprocessing” or “cleaning.”
- Evidence derived from the device should remain distinct from the policy defining what the
  study counts, even when both appear in one current function.
- A user-friendly label is not a replacement for a stable machine identifier.

## 5. Fuzzy or Uncertain Recall

These recalled ideas need direct verification before they influence the recommendation:

- Provenance vocabularies appear to distinguish prospective plans from retrospective
  activities and may support nested steps, variables, and generated entities.
- Scientific workflow specifications appear to support subworkflows, conditional steps,
  typed ports, and parameterized tools, but their treatment of UI projections is uncertain.
- Incremental-computation systems appear to use exact dependency tracking, content or value
  identity, backdating, and durability/change-frequency hints; applicability to large browser
  arrays is uncertain.
- Data-lineage standards appear to distinguish jobs, runs, datasets, parent runs, and column
  lineage, but parameter-to-field impact may be underspecified.
- Process-notation standards appear to support collapsed subprocesses; whether their visual
  semantics fit an artifact DAG is doubtful.
- Research on intermediate-result materialization appears to use workload frequency,
  compute cost, storage cost, and reuse probability. The most applicable current formulation
  is not recalled confidently.
- “Semantic zoom,” compound graphs, and focus-plus-context visualization may offer the right
  UI vocabulary, but empirical guidance for nontechnical pipeline users is uncertain.

## 6. Best Traps

1. Replace one arbitrary fixed total with another target number.
2. Split every long function even when no stable artifact or reuse opportunity exists.
3. Cache every operation and regress the fast path through cloning, hashing, or equality.
4. Let current unit bindings stand in for exact per-operation parameter dependencies.
5. Claim the UI shows every setting effect while output-only settings and sinks remain
   outside the graph.
6. Hide disabled nodes by splicing edges, thereby concealing why configuration changed the
   workflow.
7. Mix evidence extraction with measurement policy, making policy-dependent assertions look
   like observed facts.
8. Treat counters, reports, sorts, and result assembly as peer scientific transformations
   solely because they are executable functions.
9. Rename stable identifiers without aliases, versions, or provenance compatibility.
10. Infer recomputation savings from cold-run timings rather than representative edit
    sequences and cache costs.
11. Keep mutable artifacts across finer cache boundaries without ownership guarantees.
12. Add an external orchestrator whose runtime assumptions conflict with offline browser
    execution and existing parity requirements.

## 7. Historical and Dead Ends

The repository already records several useful rejected directions: a flat node-state UI,
causal-role labels for this dataflow graph, timestamp-only cache invalidation, hashing full
outputs during early cutoff, and adopting a general visual-programming framework. Those
rejections should stand unless new evidence changes their premises.

The current history also demonstrates a partial success and a caution. Unit-level
memoization plus early cutoff gives deterministic reuse, but the coarse units were acknowledged
as arbitrary grouping. Previous full-output hashing was too expensive; therefore a more
granular graph must not assume that finer caching is free.

## 8. Search Handoff

Unbiased discovery will start with these generic queries before searching any remembered
product, project, or vocabulary name:

1. `scientific workflow hierarchical task graph artifact dependency configuration invalidation provenance standard`
2. `data pipeline cache boundary selection intermediate materialization cost model`
3. `workflow DAG user interface progressive disclosure nested composite tasks nontechnical users`
4. `configuration option impact analysis dataflow pipeline affected outputs`
5. `incremental computation dependency graph stable intermediate representation checkpoints`
6. `data cleaning preprocessing distinction measurement policy data provenance research`
7. `scientific workflow provenance prospective retrospective nested activities standard`
8. `build system minimal recomputation content addressed artifacts dynamic dependencies paper`
9. `pipeline lineage transformation field level configuration parameters outputs`
10. `workflow visualization multilevel graph semantic zoom compound nodes`
11. `data validation transformation policy separation raw canonical derived datasets`
12. `workflow artifact based orchestration task based distinction caching`
13. `reproducible computational pipeline parameter provenance sensitivity analysis`
14. `nested workflow interoperability specification subworkflow provenance`
15. `data pipeline materialized intermediate selection recomputation cost workload`

Discovery exclusions, because they are recalled candidates rather than independently found
evidence: W3C PROV, P-Plan, ProvONE, CWL, WDL, OpenLineage, RO-Crate, BPMN, OpenTelemetry,
Bazel, Salsa, Dagster, dbt, Snakemake, Nextflow, Make, `targets`, React Flow, and Graphviz.
After generic discovery produces a shortlist, direct searches may verify those candidates
against primary specifications, official documentation, source repositories, and papers.

### Current best hypothesis

Use one typed semantic operation/artifact DAG as the source of truth; derive separate story,
configuration-impact, execution, and audit projections. Bind settings to direct readers,
derive downstream cones, move every material sink into the graph, and select checkpoints by
measured edit workloads rather than semantic granularity.

### Highest-risk unknowns

- Whether step-level dependency capture can be made complete without invasive runtime
  instrumentation.
- Whether finer cached artifacts remain cheap and immutable enough in the browser.
- Which current compound transformations yield meaningful intermediate artifacts rather
  than implementation leakage.
- Whether researchers and nontechnical users agree on the proposed evidence/policy and
  seven-phase vocabulary.
- Whether an existing standard can model the contract directly enough to reduce custom
  machinery without constraining execution.

### Search should change my mind if...

- a maintained standard directly models semantic operations, artifacts, parameters,
  multi-resolution presentation, and retrospective runs with usable browser tooling;
- representative edit traces show finer checkpoints cost more than the work they avoid;
- user testing shows a single flat graph communicates configuration impact more accurately;
- static or instrumented reads show the present boundaries already align with stable
  artifacts and exact parameter sets; or
- output construction is intentionally outside the reproducible computation boundary and
  the shipped provenance already captures it completely.
