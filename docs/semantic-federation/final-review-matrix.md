# Production-readiness sweep and test matrix

This report records the post-implementation sweep of the Chronicle raw-data
preprocessing app as the first complete consumer of the generalized semantic
federation scaffold. It distinguishes verified behavior from remaining release
obligations; a high aggregate coverage percentage is not treated as a substitute
for boundary, failure, architecture, security, or performance evidence.

## Fixed during the sweep

- Durable imports and garbage collection now take the same exclusive workspace
  lock as execution commits.
- OPFS recovery fails closed when both roots are corrupt, preserves the older
  valid root, and garbage collection retains both crash-recovery closures.
- Full local-data reset removes the Rust OPFS workspace tree.
- Failed bundled-resource fetches no longer poison the process-wide cache.
- Workspace identity includes the raw-input digest, preventing same-name data
  from reusing an unrelated workspace.
- Runtime and worker caches are bounded; repeated execution reuses a cached
  result digest instead of hashing the complete result many times.
- Rust evidence distinguishes cached, recomputed, error, skipped, and bypassed
  nodes truthfully; cached nodes no longer claim that their steps ran.
- The verified artifact closure now retains ingress, support/config assignments,
  logical-node artifacts, four typed views, lineage inputs, and root metadata.
- Registered semantic queries are compiled from the versioned resource at build
  time, eliminating a second hard-coded query authority.
- Semantic projections now reuse PROV-O and P-Plan for execution/entity/step
  correspondences while preserving product-local execution semantics.
- Screen-credit lineage uses indexed interval windows and a prior-state witness
  instead of rescanning and retaining cumulative raw-event prefixes.
- Production builds rebuild every Rust/WASM package from source before Vite, so
  ignored generated packages cannot make a deployment stale.
- Browser file processing and backup transport transfer owned buffers across the
  worker boundary instead of adding avoidable copies.
- The production profiler now exercises the actual service-worker-controlled
  browser workflow and enforces time, heap, completeness, and no-network checks.
- The generalized scaffold now supports product-injected performance gates and
  explicit per-crate Rust coverage/mutation ratchets; core kernels can no longer
  be omitted from the authority list.

## Test Encyclopedia matrix

| Surface | Reproduction | Unit | Boundary / negative | Integration / contract | End-to-end / health | Security | Performance | Architecture / advanced | Status |
|---|---|---|---|---|---|---|---|---|---|
| Profile and lock protocol | deterministic fixtures | schema and digest tests | tamper, cycle, license, missing resource | offline exact closure | scaffold smoke | secret/license checks | resolve budget | no product ontology in protocol | Verified by federation gates |
| Rust product contract | 15-node plan fixture | binding and graph tests | unknown/duplicate/cyclic bindings | generated-registry drift | native/WASM contract load | profiles cannot inject code | compile/build budget | Chronicle-owned semantics | Verified |
| Rust preprocessing runtime | golden raw CSVs | Rust suites | malformed request/artifact states | native/WASM parity and shadow suites | full browser processing | bounded inputs and fail-closed digests | browser baseline, cached digest | property/mutation rails | Verified; coverage debt below |
| Incremental materializer | warm/cold replay | node/role/status tests | changed support/config/input cones | persisted prior-root execution | graph/status/explanation views | immutable assignment evidence | exact-cone checks | deterministic replay | Verified for current fixtures |
| OPFS durability | alternating-root fixtures | store tests | corruption, missing objects, both roots bad | closure export/import and verification | reload/recovery browser flows | digest/path/size/object limits | GC retains two roots | crash/fault-injection matrix | Verified in Chromium |
| Worker protocol | real transferred CSV | dispatcher tests | malformed/unsupported commands | Comlink plus Rust/WASM | Playwright workflow | UI cannot write evidence | transfer and cache bounds | TypeScript renderer boundary | Verified |
| Typed semantic views | root-bound fixtures | registered-query tests | missing/wrong-root view rejected | Rust index plus UI projection | graph and result panels | no arbitrary production SPARQL | query benchmarks sampled | view is derived, not authority | Verified; cache opportunity remains |
| Deploy artifact | exact source build | manifest checks | stale/missing WASM rejected by build | Pages preparation contract | service worker offline smoke | CSP/default-deny network | bundle budget | Rust rebuilt before Vite | Verified |
| Supply chain | lockfile reproduction | dependency checks | known advisory review | license and audit rails | fresh-build smoke | gitleaks/audit/deny | dependency/bundle budgets | generated code drift | Verified; one allowed unmaintained transitive dependency |
| General scaffold | representative render | rail script tests | empty/missing command fails closed | Copier update/smoke | fresh generated project | no secret defaults | injected performance commands | no universal graph runtime | Verified across all scaffold slices and update lifecycle |

## Final sweep evidence

- The complete Playwright suite passed 97/97 browser journeys, including
  processing, reload, recovery, backup, graph, and offline-service-worker flows.
- Vitest passed 981 tests in 69 files. Coverage is 99.18% statements, 95.00%
  branches, 99.34% functions, and 99.48% lines.
- The Rust semantic adapter, runtime, and semantic index all exceed 97% line
  coverage. The lower core-kernel baselines are measured and ratcheted rather
  than excluded from the authority manifest.
- All 31 viable semantic-index mutants and all 92 viable runtime mutants were
  killed. Fifteen runtime mutants were compiler-unviable; none survived.
- The optimized screen-lineage function killed all five of its direct mutants.
  Cargo Mutants also generated seven surviving field-deletion mutants in the
  existing `run_pipeline_v2*` wrapper expressions; these are retained as explicit
  equivalence-test debt rather than presented as a perfect mutation score.
- The production browser profile completed the entire 600-event input in
  374.5 ms, produced 4,197 app rows and 3,845 screen rows, remained under all
  enforced budgets, used the service worker, and made no external requests.
- Cargo audit, cargo deny, Semgrep, ast-grep, Trivy, gitleaks, exact-source WASM
  builds, artifact validation, bundle budgets, and offline federation checks
  passed. `paste 1.0.15`, an unmaintained transitive dependency of Parquet, is
  explicitly allowed; there are no known vulnerability findings in the active
  dependency graph.

## Remaining production blockers or bounded debt

1. Core Rust coverage is now measured honestly but is not yet at the desired
   floor: the chrono kernel is 40.63% line/39.89% region/39.95% function
   coverage; the matcher is 85.44%/84.53%/86.05%. The rails ratchet these real baselines and
   forbid omission, but additional tests are required before claiming 95% for
   all computational authority.
2. Browser durability and E2E evidence is Chromium-only. WebKit/Firefox support
   and OPFS crash behavior require explicit capability decisions and tests.
3. Runtime JSON returned across the WASM boundary is integrity-checked but still
   relies on manually maintained TypeScript shapes rather than a generated
   runtime decoder.
4. Timezone discovery still reads the file to select a default. Multiple
   discovered timezones require explicit user confirmation instead of silently
   selecting the first candidate.
5. The semantic projection uses standards for shared correspondences, but the
   product profile still needs richer declared mappings and conformance fixtures
   before it should be advertised as broadly interoperable RDF.
6. The semantic index is reconstructed for each query; a root-digest keyed cache
   should be added if repeated interactive queries become material.
7. Parquet and SPSS export paths independently parse CSV output, and visualization
   payloads are eagerly materialized. These are measurable optimization targets,
   not correctness defects at the current fixture size.
8. Workspace archive export/import still materializes the full closure in memory.
   Large-workspace streaming remains a release-scale memory obligation.
9. Large-file peak WASM memory and crash/fault injection across all supported
   browsers have not yet been demonstrated.
10. Seven generated mutation cases can delete fields from the existing
    `run_pipeline_v2*` support-wrapper expressions without a failing equivalence
    test. Direct mutants in the optimized lineage function are killed, but the
    wrapper-level survivors remain release debt for the core-kernel suite.

Database migration, server-concurrency load, mobile-device, container, and
cluster tests are not applicable: this proof is a local-first browser/WASM app
and introduces no server database or production infrastructure.
