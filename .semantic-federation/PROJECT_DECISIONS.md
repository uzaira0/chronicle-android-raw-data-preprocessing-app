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
  `capability-bindings.json` records the selected composed Rust/WASM runtime as
  the sole computational authority. The fused physical kernel remains visible
  beneath complete Rust logical scheduling and evidence rather than being
  mistaken for the logical graph itself.
- `semprof-materialize` owns product-neutral role fulfillment and open
  obligations; the preprocessing adapter owns DAG propagation and typed
  product views.
- Oxigraph is the rebuildable RDF/query baseline; Grafeo 0.5.42 is rejected
  because its RDF feature does not compile for browser WASM. Oxigraph is pinned
  to upstream revision `d14ac0b5c4fa67b15d03af945d8669e3497c25a9`
  until a crates.io release includes its `quick-xml 0.41` security update.
- The product-owned Rust scheduler is selected; no generic federation-wide
  scheduler or execution IR is introduced. TypeScript is limited to browser
  I/O, interaction, visualization, and derived download formatting.
- OPFS stores the verified content-addressed closure through a thin browser I/O
  adapter. Rust owns artifact bytes, digests, root/closure semantics, evidence,
  typed views, and registered-query index sources.
- `quality/rust-authority-manifests.txt` names the three product-owned Rust
  authorities. The only mutation exclusion is the adapter's `cfg(wasm)` facade;
  the native delegate, WASM build, and browser export path remain mandatory.
- `quality/deny.toml` denies unknown registries and Git sources, allowlists the
  two immutable Git dependencies, audits the complete license closure, and
  grants only the documented `RUSTSEC-2024-0436` exception for `paste` through
  `parquet 59.1.0` until an upstream replacement exists.
