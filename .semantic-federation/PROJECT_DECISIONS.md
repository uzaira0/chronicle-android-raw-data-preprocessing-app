# Project Decisions

- Product profile: `urn:uzaira0:semantic-federation:chronicle-preprocessing`
- Namespace: `urn:uzaira0:semantic-federation:chronicle-preprocessing:`
- Computational families: `incremental_dataflow`
- Runtime targets: `rust_native, rust_wasm`
- Storage policies: `opfs_cas, append_only_journal, arrow_sidecars`
- Typed view sets: `stage, artifact, obligation, temporal_subject, explanation, assurance`
- Shared semantic authority is limited to the immutable release protocol.
- Family payloads remain product-owned and are never compiled into a universal IR.
- Existing Chronicle LinkML and merged SHACL resources are vendored as
  digest-locked product resources; they remain descriptive/conformance
  artifacts, not the executable plan.
- `chronicle.plan.json` binds all 15 units and 55 steps to product Rust
  capability IDs while the current TypeScript bodies remain an explicit
  shadow oracle.
- Oxigraph is the rebuildable RDF/query baseline; Grafeo 0.5.42 is rejected
  because its RDF feature does not compile for browser WASM.
- Salsa 0.28.0 is a provisional Chronicle-only scheduler substrate pending the
  complete product dirty-cone and resource-budget gate.
