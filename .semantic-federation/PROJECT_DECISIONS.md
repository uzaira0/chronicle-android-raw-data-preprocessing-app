# Project Decisions

- Product profile: `urn:uzaira0:semantic-federation:chronicle-preprocessing`
- Namespace: `urn:uzaira0:semantic-federation:chronicle-preprocessing:`
- Computational families: `incremental_dataflow`
- Runtime targets: `rust_native, rust_wasm`
- Storage policies: `opfs_cas, append_only_journal, arrow_sidecars`
- Typed view sets: `stage, artifact, obligation, temporal_subject, explanation, assurance`
- Shared semantic authority is limited to the immutable release protocol.
- Family payloads remain product-owned and are never compiled into a universal IR.
- Existing preprocessing-app LinkML and merged SHACL resources are vendored as
  digest-locked product resources; they remain descriptive/conformance
  artifacts, not the executable plan.
- `chronicle.plan.json` identifies all 55 transformations and groups them into
  15 reporting units. The separate `capability-bindings.json` currently binds
  those identities to one fused Rust/WASM entry point. This is a complete Rust
  computation path and logical evidence projection, but it is not yet 55-step
  physical incremental execution: a cache miss still calls the full pipeline,
  and step statuses are calculated after that result exists.
- `semprof-materialize` owns product-neutral role fulfillment and open
  obligations; the preprocessing adapter owns DAG propagation and typed
  product views.
- Oxigraph is the rebuildable RDF/query baseline; Grafeo 0.5.42 is rejected
  because its RDF feature does not compile for browser WASM. Oxigraph is pinned
  to upstream revision `d14ac0b5c4fa67b15d03af945d8669e3497c25a9`
  until a crates.io release includes its `quick-xml 0.41` security update.
- The final scheduler remains product-owned; no generic federation-wide
  scheduler or execution IR is introduced. The existing custom 15-node
  fingerprint scheduler is provisional, not the selected final implementation.
  Chronicle must run the previously approved Salsa product trial against real
  native/WASM steps. If Salsa passes the product gates, it owns actual-read
  tracking, memoization, early cutoff, and execution events. If it fails, a
  bounded Chronicle memo table must satisfy the same tests. TypeScript is
  limited to browser I/O, interaction, visualization, and derived download
  formatting.
- The fused `run_pipeline_v2_with_supports()` path is the cold correctness
  oracle and temporary rollback during migration. Production readiness requires
  55 callable Rust queries with real cached intermediate and terminal results
  plus actual execution events. Mapping 55 step IDs to 15 `PhysicalStage`
  values or one `execute_workspace` entry point does not satisfy that
  requirement.
- The declared step graph supports review, visualization, and mutation tests.
  Runtime invalidation comes from tracked reads. A build/test check compares the
  observed read graph with the declaration and fails on either missing or
  unnecessarily broad dependencies.
- OPFS stores the verified content-addressed closure through a thin browser I/O
  adapter. Rust owns artifact bytes, digests, root/closure semantics, evidence,
  typed views, and registered-query index sources.
- `quality/rust-authority-manifests.txt` names every product-owned Rust
  authority. Its exclusions are limited to the adapter's target-incompatible
  `cfg(wasm)` facade and two exactly matched equivalent runtime mutants whose
  cache/assignment invariants are independently tested. Four exact
  loop-counter mutants detected only by nontermination are excluded so a
  timeout cannot make the release gate permanently red; their terminating
  decrement forms remain scored and caught. The contract-export CLI is covered
  by drift/gate-truth checks, and the matcher's optional Python-only facade is
  excluded from browser-product mutation scoring while its Rust core remains
  included. The native delegate, WASM build, and browser export path remain
  mandatory.
- `quality/deny.toml` denies unknown registries and Git sources, allowlists the
  two immutable Git dependencies, audits the complete license closure, and
  grants only the documented `RUSTSEC-2024-0436` exception for `paste` through
  `parquet 59.1.0` until an upstream replacement exists.

The authoritative implementation backlog and acceptance checks are in
`docs/semantic-federation/55-step-incremental-rust-plan.md`.
