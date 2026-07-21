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
- `chronicle.plan.json` identifies all 15 units and 55 steps. The separate
  `capability-bindings.json` truthfully records the active Rust matcher, the
  active browser graph/orchestration path, and the parity-clean fused Rust v2
  implementation that exists but is not yet selected by the browser worker.
- `semprof-materialize` owns product-neutral role fulfillment and open
  obligations; the preprocessing adapter owns DAG propagation and typed
  product views.
- Oxigraph is the rebuildable RDF/query baseline; Grafeo 0.5.42 is rejected
  because its RDF feature does not compile for browser WASM.
- No new scheduler substrate is selected. The existing preprocessing DAG and
  fused Rust pipeline remain the product execution authorities until an
  evidence-backed cutover changes the binding set.
