# Pipeline-Graph Initiative — Knowledge Base

> Historical design record. Its July 2026 TypeScript execution-engine choices
> are superseded by the
> [55-step incremental Rust plan](../semantic-federation/55-step-incremental-rust-plan.md).
> The current production path is 55 Salsa-tracked Rust/WASM computations; the
> 15 groups and this directory's old TypeScript graph remain views, fixtures,
> and migration history only.

Transferred knowledge for the effort to (1) separate **cleaning** from **preprocessing**,
(2) modularize the browser pipeline into a **typed dependency graph** (declared DAG with
incremental recompute + a rendered interactive view), and (3) wire the research-pipeline-only
features (§14 valid-usage credit, attribution, compliance, study-window, placeholders) into
this app's web UI, client-side.

All content is sanitized: no participant identifiers, no cohort-level data values, no study
credentials. Study names (TECH/GNSM) appear only as configuration labels, as they already do
in this repo's own defaults.

| Doc | Contents |
|---|---|
| [01-feature-inventory.md](01-feature-inventory.md) | Which features exist in this engine vs only in the consuming research pipeline; the wiring gap |
| [02-section-taxonomy.md](02-section-taxonomy.md) | Preprocess / Clean / Analyze split; which knobs vary across populations (adult/child, shift workers, device fleets) |
| [03-port-semantics.md](03-port-semantics.md) | The §14 valid-usage algorithm, post-engine relabels, attribution + compliance semantics (the features to port) |
| [04-webapp-architecture-map.md](04-webapp-architecture-map.md) | How the web app executes today: worker pipeline, options contract, WASM coverage, persistence |
| [05-decision-ledger.md](05-decision-ledger.md) | Decisions made + prior-art research (build/adopt/compose), incl. drake/targets, DAGitty, React Flow |
| [06-typed-edge-ontology.md](06-typed-edge-ontology.md) | The typed-edge model: primitive edges (feeds/gates/tunes) + derived path queries (visual, no taxonomy) |
| [07-design-draft.md](07-design-draft.md) | The in-progress design (Approach A), approved sections + open items |
| [08-prior-art-vocabulary.md](08-prior-art-vocabulary.md) | Parry & Toth / EYES / Culverhouse glossaries, convergence table, final community-grounded node naming |
| [09-sublation-audit.md](09-sublation-audit.md) | Sublation audit: what maps cleanly + the five required ontology expansions + the preset claim |
| [10-multistream-superset.md](10-multistream-superset.md) | Streams → witnesses → fused state timeline; refined gap taxonomy; stream-availability gating |
| [11-device-state-machine.md](11-device-state-machine.md) | Second-audit verdicts (all spot-checks verified): factored device state + overlays, 8-state projection, 12 adopted changes |
| [12-settings-sublation-ledger.md](12-settings-sublation-ledger.md) | Every setting of this app (44 contract slots), the research pipeline, and EYES/P&T/Culverhouse → its ontology element |

Status date: 2026-07-14.
