# Incremental Rust Runtime

## Current authority

Rust/WASM is the only preprocessing authority. The fused
`run_pipeline_v2_with_supports()` path remains the independent cold oracle;
`IncrementalPipelineV2Engine` is the production Salsa runtime. TypeScript owns
browser I/O, rendering, and download packaging, never scientific scheduling.

The registry size is deliberately not part of this contract. CI proves set
equality between the Rust workflow contract, Salsa product-query bodies, the
semantic plan, generated capability bindings, runtime query events, and
checkpoint maps.

## Interpretation model

The runtime exposes distinct layers:

- phases are plain-language navigation;
- operations describe scientific actions and decisions;
- artifacts are typed values between operations;
- queries are physical computation and memoization boundaries;
- checkpoints are optional durable reuse boundaries;
- evidence reports what happened in a run.

Only operations and artifacts describe scientific meaning. Query groups are an
internal reporting projection and never schedule work.

## Cache identity

Each query key commits to its implementation, build environment, local workflow
dependency-closure digest, applicability, direct upstream artifact identities,
exact request fields, active support-role digests, and output mode. It does not
include presentation or evidence labels and does not include a global contract
digest. An unrelated contract edit therefore cannot invalidate scientific work.

Review behavior (`execute`, `passthrough`, or `omit`) is declared on each query
in `workflow_contract.rs`; the runtime contains no parallel hardcoded query
lists. Query status comes from actual Salsa execution events. Semantic operation
state remains separate because a fused query running does not prove every mapped
operation was applied.

## Persistence

The workflow model uses a new OPFS namespace and content-derived workspace IDs.
Workspace roots commit to `workflow_model_version` and the workflow compatibility
digest. Previous storage is never parsed, migrated, rewritten, or deleted. A
fresh run rebuilds state from selected inputs.

Durable promotion is benchmark-gated. A candidate checkpoint is accepted only
when median and p95 improvement exceed the declared noise threshold, scientific
parity is exact, and memory/storage budgets pass. Ordinal positions never enter
persisted identities.

## Workflow boundary policy

Every semantic joint in the workflow contract is mandatory even when several
operations initially map to one physical query. Splitting a query and persisting
its output are separate engineering decisions.

High-value reuse boundaries include decoded and ordered rows before remapping,
timezone evidence before policy, screen skeletons before screen rules, app-event
indexes before matching, candidate episodes before inclusion and duration
policy, overlap segments before flooring, engagement bases before thresholds,
witness indexes before crediting policy, completeness aggregates before
compliance, and scientific tables before encoders.

## Verification

Required gates are count-neutral:

1. IDs are unique, resolved, acyclic, and deterministically serialized.
2. Every derived artifact has one producer.
3. Operation/query mappings and option/support classifications match by set
   equality.
4. AST audits match declared direct reads and dependency edges.
5. Cold and incremental native/WASM outputs match byte-for-byte, excluding only
   intentionally versioned workflow and evidence envelopes.
6. Warm edits recompute only the affected dependency closure.
7. The Pipeline Explorer presents Overview, Decisions, Data lineage, Execution,
   and Audit from the same runtime projection.
8. Generated schemas, semantic resources, bindings, certificates, and goldens
   are drift-free.

The active implementation plan and acceptance details are in
[`docs/workflow/contract-and-dag-migration-plan.md`](../workflow/contract-and-dag-migration-plan.md).
