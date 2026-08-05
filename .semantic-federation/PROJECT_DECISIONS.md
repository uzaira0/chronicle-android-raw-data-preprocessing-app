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
- `chronicle.plan.json` identifies all registered transformations and groups them into
  query-group units. `pipeline_v2_incremental.rs` now implements a registry-derived set of
  Salsa-tracked computations in that order, and complete kernel parity passes
  for all four usage modes. The runtime executes those queries before building
  its query-group compatibility artifacts, and generated bindings give every step
  one exact Rust query entrypoint.
- `semprof-materialize` owns product-neutral role fulfillment and open
  obligations; the preprocessing adapter owns DAG propagation and typed
  product views.
- Oxigraph is the rebuildable RDF/query baseline; Grafeo 0.5.42 is rejected
  because its RDF feature does not compile for browser WASM. Oxigraph is pinned
  to upstream revision `d14ac0b5c4fa67b15d03af945d8669e3497c25a9`
  until a crates.io release includes its `quick-xml 0.41` security update.
- The scheduler remains product-owned; no generic federation-wide scheduler or
  execution IR is introduced. Salsa `0.28.1` passed the real native/browser-WASM
  product trial and now owns actual-read tracking, memoization, early cutoff,
  and query execution in the registered-query kernel. The old fingerprint
  scheduler has no physical execution authority; query-group artifacts are
  projections only.
  TypeScript is limited to browser I/O, interaction, visualization, and derived
  download formatting.
- The incremental-engine decision is closed. Salsa is the sole selected
  physical engine. `incremental-rs` and `comemo` are prior art only; `depends`
  is a proof-of-concept and not a production candidate; `incremental-query`
  requires unstable Rust and is not selected. The completed Salsa trial crate
  was deleted after the production choice was made. A bounded product-owned
  memo table is allowed only if a mandatory Salsa acceptance check fails, and
  it must satisfy the identical registry-derived correctness and durability tests.
- The fused `run_pipeline_v2_with_supports()` path is the cold correctness
  oracle and temporary rollback during migration. The callable Rust queries
  and in-worker typed intermediate reuse now exist. Persisted Salsa state was
  rejected by measurement and deleted; worker replacement recalculates from
  verified OPFS inputs. Production readiness still requires current empirical
  evidence, full quality gates, and preview verification.
  Mapping query IDs to reporting groups or one `execute_workspace` entry
  point never satisfies that requirement.
- The declared step graph supports review, visualization, and mutation tests.
  Runtime invalidation comes from tracked reads. A build/test check compares the
  observed read graph with the declaration and fails on either missing or
  unnecessarily broad dependencies.
- OPFS stores the verified content-addressed closure through a thin browser I/O
  adapter. Rust owns artifact bytes, digests, root/closure semantics, evidence,
  typed views, and registered-query index sources.
- Salsa persistence is an optional acceleration cache, never workspace
  authority. Restore requires an exact implementation/contract/profile/
  workspace/base-root identity and a verified payload digest. The runtime
  verifies the authoritative alternating OPFS workspace root first, then may
  restore the matching cache. Missing, stale, corrupt, partial, or incompatible
  cache data is discarded and the registered queries run cold. Cache-save failure
  cannot invalidate a successfully committed workspace result.
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
`docs/semantic-federation/incremental-runtime-plan.md`.
