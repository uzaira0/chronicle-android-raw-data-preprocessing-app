# Workflow Design Knowledge Base

> Historical design record. Its July 2026 TypeScript execution-engine choices
> are superseded by the
> [incremental Rust runtime](../semantic-federation/incremental-runtime-plan.md).
> The current production path is a count-neutral Rust workflow contract and
> Salsa query registry. Former TypeScript graph material is migration history.

Transferred knowledge for the effort to (1) separate **cleaning** from **preprocessing**,
(2) modularize the browser pipeline into a **typed dependency graph** (declared DAG with
incremental recompute + a rendered interactive view), and (3) wire the research-pipeline-only
features (screen-gated valid-usage credit, attribution, compliance, study-window,
placeholders) into
this app's web UI, client-side.

All content is sanitized: no participant identifiers, no cohort-level data values, no study
credentials. Study names (TECH/GNSM) appear only as configuration labels, as they already do
in this repo's own defaults.

| Doc | Contents |
|---|---|
| [feature-inventory.md](feature-inventory.md) | Feature coverage and the original wiring gap |
| [phase-taxonomy.md](phase-taxonomy.md) | Preprocess / Clean / Analyze interpretation |
| [artifact-port-semantics.md](artifact-port-semantics.md) | Crediting, attribution, compliance, windows, and placeholders |
| [webapp-architecture-map.md](webapp-architecture-map.md) | Worker, WASM, options, and persistence architecture |
| [decision-ledger.md](decision-ledger.md) | Historical and current build/adopt/compose decisions |
| [typed-edge-ontology.md](typed-edge-ontology.md) | Typed edges and derived path queries |
| [design-draft.md](design-draft.md) | Historical graph design and open items |
| [prior-art-vocabulary.md](prior-art-vocabulary.md) | Community-grounded vocabulary |
| [sublation-audit.md](sublation-audit.md) | Mapping and ontology expansion audit |
| [multistream-superset.md](multistream-superset.md) | Streams, witnesses, fused state, and gap taxonomy |
| [device-state-machine.md](device-state-machine.md) | Factored device state and overlays |
| [settings-sublation-ledger.md](settings-sublation-ledger.md) | Settings-to-ontology mapping |
| [research-ontology-design.md](research-ontology-design.md) | Research ontology design |
| [boundary-memory-map.md](boundary-memory-map.md) | Prior knowledge and boundary hypotheses |
| [workflow-semantics-and-recomputation.md](workflow-semantics-and-recomputation.md) | Recalculation-boundary research |
| [contract-and-dag-migration-plan.md](contract-and-dag-migration-plan.md) | Implemented migration plan and acceptance criteria |

Status date: 2026-07-14.
