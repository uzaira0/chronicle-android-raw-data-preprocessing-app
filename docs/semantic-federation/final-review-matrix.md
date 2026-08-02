# Current verification sweep and production-readiness matrix

This report records what the Chronicle raw-data preprocessing app currently
proves as the first full implementation target for the generalized semantic
federation scaffold. The branch now has 55 real tracked Rust computations,
complete four-mode fused-oracle parity, zero-body unchanged reuse, and exact
output-only reuse. Runtime reporting now consumes actual executed-step IDs. It
is not yet a completed production-incrementality claim: persistence,
regenerated campaigns, saved-view proof, and final gates remain. The
[55-step incremental Rust plan](55-step-incremental-rust-plan.md) is the active
release plan. A high aggregate coverage percentage is not a substitute for
boundary, failure, architecture, security, performance, or actual-execution
evidence.

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
- The four-mode timezone family now has Rust-owned method, qualification,
  retained-row, normalized-event, published-output and provenance partitions;
  five existing goldens prove convergence and the existing mixed fixture proves
  widening across all 12 ordered incremental transitions.
- A multi-timezone upload no longer lets TypeScript select the lexicographically
  first candidate. The sole discovered value may fill the unambiguous input;
  multiple candidates remain an explicit binding hole until the user chooses a
  research-protocol value, with a browser regression proving fail-closed behavior.
- The Rust/WASM manifest boundary now decodes every identity, cache decision,
  logical checkpoint, materialization trace, role assignment, node execution,
  and artifact descriptor before TypeScript may consume it. It rejects protocol,
  request, workspace, input, prior-root, implementation, certificate, checkpoint,
  row-accounting, and artifact-catalog disagreement while retaining the
  distinction between structural narrowing and release-blocking empirical
  currency; the negative suite runs
  against the actual compiled WASM manifest rather than a TypeScript-only fixture.
- The 54-field contract is partitioned into 46 computational, one annotation,
  five view, and two execution-strategy axes. The computational model has exact
  coverage of 97 values, 4,593 valid pairs, and 141,499 valid triples plus 128
  replayable high-order configurations across five catalog-derived pathological
  corpora plus a branch-activating influence corpus. The controlled ledger runs
  all 1,380 ordered one-factor transitions with identical raw/support inputs,
  records the exact observed effect set, and requires a substantive witness for
  every computational option; the factored axes have explicit no-effect or
  exact-dependency proofs. That rail found and fixed missing `studyName`,
  Parquet-export, and SPSS-export DAG bindings.
- Rust now exposes requirements without executing and rejects unresolved
  conditional support roles at `ExecuteWorkspace`, so binding holes cannot be
  hidden by browser-only validation.
- Rust now hashes the complete product-local state at all 15 logical DAG joints.
  Every one of the 1,380 one-factor transitions matches an independent cold
  target at every checkpoint and has exactly the predicted percolation cluster.
  The proof found and fixed hidden no-usage, app-policy/output,
  category-column/output, and shared-participant/compliance dependencies.
- Semantic-model mutation now kills all 116 plan mutants: 23 edge removals, 23
  reversals, 59 option-binding removals, and 11 raw/support-role binding
  removals. Empirical, cycle, applicability-condition, and typed-step-port
  witnesses remain separately attributed. The sweep added two missing direct
  output edges and removed one redundant reconstruction option dependency.
- Narrow cache reuse is now guarded by a generated dependency certificate that
  independently reconciles all 54 LinkML axes, 47 cache-relevant values, seven
  factored view/execution values, ten root roles, the complete plan binding
  surface, and all six empirical proof ledgers. Unknown/missing options or a
  structural mismatch force full logical recomputation; unknown roles fail
  closed; stale empirical receipts block release.
- Artifact dependency tomography now changes exactly one source artifact across
  all raw columns, raw row operations, every support role, and representation-
  only controls. Its 32 intervention kinds across six corpora produce exact
  warm/cold checkpoint and declared/observed percolation agreement across 192
  cases and 768 Rust/WASM executions. A separate 162-case, 648-execution raw
  boundary proof covers adjacent gaps plus calendar/DST joints.
- The runtime now emits a normalized, compressed result-cell correspondence
  table. Exact canonical cell identities join to the existing row-lineage keys
  without relabeling conservative raw-row contributors as exact. A 600-event
  storage-ratio gate pins 13,834 cells at 278,602 bytes (1.39× canonical
  output bytes) and the correspondence index exposes exact output/index edges.
- The complementary `source-coordinate-index-arrow` assigns stable exact
  coordinates to every qualified raw/support CSV cell and canonical
  configuration JSON leaf. Artifact byte identity, decoded coordinate identity,
  normalization, and value identity remain separate, and the artifact explicitly
  refuses to imply an output contribution without a dependency witness.
- The normalized `source-result-influence-arrow` now provides that bridge at
  the strongest precision currently justified: exact single raw cell→output
  cell contributions, conservative raw-row-range→output-row lineage,
  conservative lineage-search windows, declared source-column→output-column
  scope for the result families that carry no row lineage, declared
  source-scope→checkpoint edges, and the explicit gaps that survive all of
  them. Protocol `chronicle-source-result-influence/v2`; its 986 rows occupy
  61,778 bytes on the 600-event fixture, two orders of magnitude smaller than
  the rejected Cartesian expansion.
- Declared per-step field reads/writes now exist for all 55 computations and
  are reconciled against the recorded per-column changed-cell evidence. An
  observed changed cell that is not reachable from the intervened column fails
  the build; a declared reach no intervention exercised is enumerated as
  structurally declared but unwitnessed. The gate found and fixed a partial
  edge-override table on `build_canonical_rows` that made every raw column
  reach every downstream field, and missing grouping-key dependencies on the
  aggregate `study_name` column and the review summary's participant
  addressing.
- Per-field mixed tomography crosses twenty supplied source columns with the
  configuration axes their declared field cone predicts, plus a control sample
  of axes it does not: 729 predicted axis crossings, 65 controls, 1,682
  Rust/WASM executions in twenty process-recycled shards, no cell outside the
  declared reach and no control-axis widening. Two filter-file columns are
  recorded as read by no step rather than dropped.
- Mixed source×configuration tomography now crosses an empirically activating
  intervention for every raw/support role with all 50 valid alternate values
  of the 46 computational axes. Both transition orders pass cold parity across
  450 role/value pairs; 150 context-dependent widening/masking cases are pinned
  rather than collapsed into unconditional edges. Nine three-way-parallel,
  process-recycled shards prevent the proof runner's WASM memory from growing
  without bound.

## Test Encyclopedia matrix

| Surface | Reproduction | Unit | Boundary / negative | Integration / contract | End-to-end / health | Security | Performance | Architecture / advanced | Status |
|---|---|---|---|---|---|---|---|---|---|
| Profile and lock protocol | deterministic fixtures | schema and digest tests | tamper, cycle, license, missing resource | offline exact closure | scaffold smoke | secret/license checks | resolve budget | no product ontology in protocol | Verified by federation gates |
| Rust product contract | 15-node plan fixture | binding and graph tests | unknown/duplicate/cyclic bindings | generated-registry drift | native/WASM contract load | profiles cannot inject code | compile/build budget | Chronicle-owned semantics | Verified |
| Rust preprocessing runtime | synthetic raw CSVs | Rust suites | malformed request/artifact states | native/WASM and cold/incremental parity suites | full browser processing | bounded inputs and fail-closed digests | browser baseline, cached digest | property/mutation checks | Verified; coverage debt below |
| Incremental materializer | warm/cold replay | node/role/status tests | changed support/config/input cones | persisted prior-root execution | graph/status/explanation views | immutable assignment evidence | declared-cone checks | deterministic replay | Role/qualification behavior verified; tracked runtime integration active |
| Physical 55-step executor | fused Rust oracle | one callable/query test per step | missing/duplicate/untracked input and under/over-invalidation | real intermediate and terminal cache | actual execution events in graph/status/explanation views | cache cannot bypass input/contract verification | cold/no-change/upstream/middle/downstream/binding budgets | random mutation sequences, early cutoff, native/WASM parity | 55 queries and four-mode parity verified; root-bound cache persistence is implemented; read-set campaigns, real-WASM reload/crash, runtime views, and performance remain release blockers |
| OPFS durability | alternating-root fixtures | store tests | corruption, missing objects, both roots bad | closure export/import and verification | reload/recovery browser flows | digest/path/size/object limits | GC retains two roots | crash/fault-injection matrix | Verified in Chromium |
| Worker protocol | real transferred CSV | dispatcher tests | malformed/unsupported commands | Comlink plus Rust/WASM | Playwright workflow | UI cannot write evidence | transfer and cache bounds | TypeScript renderer boundary | Verified |
| Typed semantic views | root-bound fixtures | registered-query tests | missing/wrong-root view rejected | Rust index plus UI projection | graph and result panels | no arbitrary production SPARQL | query benchmarks sampled | view is derived, not authority | Verified; cache opportunity remains |
| Deploy artifact | exact source build | manifest checks | stale/missing WASM rejected by build | Pages preparation contract | service worker offline smoke | CSP/default-deny network | bundle budget | Rust rebuilt before Vite | Verified |
| Supply chain | lockfile reproduction | dependency checks | known advisory review | license and audit rails | fresh-build smoke | gitleaks/audit/deny | dependency/bundle budgets | generated code drift | Verified; one allowed unmaintained transitive dependency |
| General scaffold | representative render | rail script tests | empty/missing command fails closed | Copier update/smoke | fresh generated project | no secret defaults | injected performance commands | no universal graph runtime | Verified across all scaffold slices and update lifecycle |
| Configuration space | five goldens, mixed-timezone fixture, five seeded pathological corpora, dedicated influence probes | generator and execution tests | missing support bindings, absent timezone qualifications, and computational axes without an activating case fail closed | LinkML/PICT domains ⇄ Rust/WASM evidence snapshots | 500 campaign cold runs; controlled ledger: 1,194 cold + 2,760 incremental runs across 1,380 ordered transitions; all 15 stage checkpoints compared warm/cold; seven preprocessing-invariance proofs; one annotation dependency proof | canonical case-set digests, implementation receipt, and no TS computational authority | full Rust cold oracle, exact logical invalidation/minimality and artifact effects; actual Salsa execution recorded separately | exact t=3 plus 128 high-order cases and exhaustive one-factor transitions over 97 declared values | Verified for the recorded implementation/domain/context/corpus scope |
| Raw/support artifact tomography | six catalog-derived synthetic corpora | all 11 raw columns, four row mutations, eight support mutations, nine representation controls, 21 adjacent-gap values and six calendar/DST joints | exactly one source artifact changes; unresolved roles and failed stages fail closed | plan role owners ⇄ Rust input keys ⇄ 15 typed semantic checkpoints ⇄ canonical output cells | artifact: 384 cold + 384 incremental; boundary: 324 cold + 324 incremental; every warm target and cell map compared with a cold oracle | source digests, implementation receipt, case-set digests, compressed cell-evidence digests | exact predicted/observed percolation; component orthogonality; 864,557 changed-cell addresses; computational and correspondence identity remain distinct | branch-activating, context-convergent, boundary, and exact no-effect controls | Verified for the recorded fixtures/intervention catalogs |
| Per-result backward correspondence | 600-event deterministic fixture plus complete runtime fixture | exact source and result CSV/JSON addresses, value digests, terminal nodes, row keys, deterministic Arrow bytes | malformed canonical JSON fails closed; unresolved joins are labeled; absence of an influence edge is never a non-influence claim; a cell not justified as exact never carries the exact-field class | qualified source artifacts ⇄ source-coordinate index ⇄ normalized influence witness ⇄ logical checkpoints/output rows/output columns ⇄ result-cell and row-lineage indexes | emitted, closure-bound, digest-verified, browser-WASM transported, and researcher-exportable on every run | no raw values are copied into indexes; hashes, normalization, precision classes, and unresolved scopes are explicit | result-cell index: 9,902 cells, 45,810 bytes, 0.51× canonical bytes; source index: 4,885 coordinates, 37,866 bytes, 0.62× the 60,719-byte raw/config source; influence witness: 986 rows, 61,778 bytes, two orders of magnitude smaller than Cartesian expansion | exact single raw cell→output cell contribution where the write chain is a verbatim single-source copy and row lineage is a singleton with no search; exact coordinate and row-join identity; conservative raw-row ranges and lineage-search windows; declared column scope for lineage-free families; declared-transitive checkpoint reachability | Verified, including exact raw-field-to-output-cell contribution for the six columns that qualify; support-record-to-output-cell contribution remains conservative |
| Field-level provenance | declared per-step field reads/writes for all 55 computations, reconciled against the checked artifact and raw-boundary changed-cell sidecars | reachability closure, output-cell binding coverage for both aggregate shapes, pure-copy chain derivation | an observed changed cell unreachable from the intervened column fails the build; a mutation confined to unread columns must change no cell; a partial edge-override table fails the build | LinkML option keys ⇄ step contract field edges ⇄ output cell bindings ⇄ recorded changed-cell addresses | regenerated by `make dependency-evidence` after every pipeline/contract source change | declarations are Rust constants checked against a `syn` scan of the step implementations | closure and reconciliation run over the existing sidecars; no new execution | three unread raw columns and two unread filter-file columns are checked non-reachability results, not omissions | Verified for the recorded intervention catalog; declared reach that no intervention exercised is enumerated, not claimed |
| Per-field source×configuration tomography | twenty supplied source columns, one activating intervention each, from the six synthetic corpora | declared field cone, declared output-cell reach, axis prediction from the cone's request fields | a changed cell outside the declared reach fails; a control axis that widens the reach fails; a column no configuration activates fails | field contract ⇄ `buildRustV2Options` axis mapping ⇄ canonical output cells | 729 predicted axis crossings, 65 control axes, 1,682 Rust/WASM executions | one implementation receipt shared by every shard, digest-bound per column | twenty process-recycled shards, three in parallel | step checkpoints recorded as carry-inclusive context, never asserted as a read-level claim | Verified for one activating intervention per column; the full record×field×configuration space remains open |
| Mixed source×configuration interactions | nine empirically activated role fixtures from six existing corpora | all 50 valid alternate values across 46 computational axes for every raw/support role | one invalid selected-timezone value retained with qualification reason | data-first and configuration-first input-key cones ⇄ cold target checkpoints/artifacts/cells | 450 role/value pairs; 3,620 Rust/WASM executions; 2,700 warm/cold comparisons | exact implementation/contract receipt and digest-bound role shards | three isolated shards in parallel; 900 exact cone comparisons | 150 introduced/masked checkpoint-or-cell interactions retained | Verified for one activating mutation per role; the per-field row above narrows this to one activating intervention per supplied column, and the full record×field×configuration space remains open |
| Semantic dependency model | checked source ledgers and generated product plan | graph, port, condition, and binding inventory tests | every declared edge is removed and reversed; every option/role binding is removed | structural typed ports ⇄ declared nodes ⇄ empirical percolation observations | 1,734 checked observations from configuration, artifact, and raw-boundary ledgers | all observations require one identical implementation/contract receipt | 116/116 semantic mutants killed; witness class retained | distinguishes empirical non-identifiability from structural necessity | Verified for the checked plan and evidence receipt |
| Proof-carrying cache firewall | generated dependency certificate | exact option/role/binding-surface reconciliation | unknown or missing option, stale plan, malformed certificate, unbound role | LinkML axes ⇄ plan knobs/roles ⇄ scheduler keys ⇄ workspace closure | certified narrow and conservative-full transition tests; deploy-current receipt check | certificate and all six ledger digests retained in the artifact closure | full-context key is deterministic; no silent partial fallback | structural certification is separate from release-blocking empirical currency | Verified |

## Final sweep evidence

- The complete Playwright suite passed 97/97 browser journeys, including
  processing, reload, recovery, backup, graph, and offline-service-worker flows.
- Parallel offline cold-start stress exposed and fixed a real Cache API mismatch:
  the static host's `Vary: Origin` made headerless precache entries invisible to
  later module and stylesheet requests. Same-origin shell lookup now ignores that
  irrelevant variation, and the readiness oracle verifies non-empty response
  bodies before disconnecting. Sixteen simultaneous cold starts passed.
- The final fixed-point check also found that TypeScript test/golden files were
  contaminating the retired reference-harness build digest. Build identity now
  excludes proof outputs, tests, snapshots, mutation reports, and other
  non-executable material; the combinatorial gate finishes by verifying that it
  did not perturb capability bindings or the semantic behavior inventory.
- The active Rust scheduler now commits every node key to separate executable
  implementation and semantic-contract identities. Dedicated tests prove that
  either change invalidates all 15 logical nodes; test-only Rust tokens are
  excluded from the production implementation digest.
- The aggregate gate caught semantic-index schema drift after qualification
  traces became runtime authority. Semantic-index source v2 now projects
  candidate qualification, every rule evaluation, and all ten role-requirement
  traces, with two new registered queries verified through browser WASM.
- Vitest passed 1,039 tests in 78 files. Coverage is 99.11% statements, 95.04%
  branches, 99.36% functions, and 99.38% lines. The runtime-manifest boundary
  now has adversarial cases for malformed qualifications, requirements,
  obligations, checkpoint domains, cache claims, identity fields, row
  accounting, artifact catalogs, and scalar/array option-shape drift; its
  decoder is not excluded from the coverage floor.
- The Rust semantic adapter, runtime, and semantic index remain above their
  enforced line/region floors. The product runtime measures
  98.54% lines and 99.43% regions. The lower core-kernel baselines are measured
  and ratcheted rather than excluded from the authority manifest.
- All 31 semantic-index mutants and all 194 viable product-runtime mutants were
  killed. Twenty-one runtime mutants were compiler-unviable; none survived.
  The requirements-report facade initially admitted two arbitrary-success
  mutants; a direct exported-facade contract test now kills both.
- The optimized screen-lineage function killed all five of its direct mutants.
  Cargo Mutants also generated seven surviving field-deletion mutants in the
  existing `run_pipeline_v2*` wrapper expressions; these are retained as explicit
  equivalence-test debt rather than presented as a perfect mutation score.
- The production browser profile completed the reproducible 601-line
  (600-data-row) input in 549.1 ms, produced 4,272 app rows and 3,892
  screen rows, remained under all
  enforced budgets, used the service worker, and made no external requests.
- Cargo audit, cargo deny, Semgrep, ast-grep, Trivy, gitleaks, exact-source WASM
  builds, artifact validation, bundle budgets, and offline federation checks
  passed. `paste 1.0.15`, an unmaintained transitive dependency of Parquet, is
  explicitly allowed; there are no known vulnerability findings in the active
  dependency graph.

## Remaining production blockers or bounded debt

1. Core Rust coverage is now measured honestly but is not yet at the desired
   floor: the chrono kernel is 41.54% line/40.80% region/40.71% function
   coverage; the matcher is 85.44%/84.53%/86.05%. The rails ratchet these real baselines and
   forbid omission, but additional tests are required before claiming 95% for
   all computational authority.
2. Browser durability and E2E evidence is Chromium-only. WebKit/Firefox support
   and OPFS crash behavior require explicit capability decisions and tests.
3. Runtime JSON returned across the WASM boundary now has a fail-closed decoder
   and real-WASM drift tests, but the validator is still manually maintained.
   Generating its schema/decoder from the Rust serialization model remains a
   maintainability improvement; malformed or incompatible data is no longer
   accepted unchecked in the meantime.
4. The semantic projection uses standards for shared correspondences, but the
   product profile still needs richer declared mappings and conformance fixtures
   before it should be advertised as broadly interoperable RDF.
5. The semantic index is reconstructed for each query; a root-digest keyed cache
   should be added if repeated interactive queries become material.
6. Parquet and SPSS export paths independently parse CSV output, and visualization
   payloads are eagerly materialized. These are measurable optimization targets,
   not correctness defects at the current fixture size.
7. Workspace archive export/import still materializes the full closure in memory.
   Large-workspace streaming remains a release-scale memory obligation.
8. Large-file peak WASM memory and crash/fault injection across all supported
   browsers have not yet been demonstrated.
9. The all-authority mutation target is not clean. The semantic adapter,
    product runtime and semantic
    index have zero survivors, but a partial current chrono-kernel campaign
    exposed surviving timestamp-formatting, CSV parsing/sorting, WASM-facade,
    and existing `run_pipeline_v2*` wrapper mutants before the expensive
    1,258-mutant campaign was stopped. The earlier seven-wrapper-only inventory
    was incomplete; a full core-kernel mutation burn-down remains release debt.
10. **Release blocker:** the 55 callable tracked Rust computations, typed
    in-worker reuse, four-mode parity, unchanged reuse, output-only exact
    invalidation, version-bound Salsa snapshot, optional OPFS cache roots, and
    browser restore/save path now exist. Production readiness still requires
    current empirical dependency campaigns to run against actual query events,
    real-WASM worker-replacement/crash/size proof, and the full mutation,
    browser, security, and performance gates. A step may be reported cached
    only when its tracked body did not execute.

Database migration, server-concurrency load, mobile-device, container, and
cluster tests are not applicable: this proof is a local-first browser/WASM app
and introduces no server database or production infrastructure.
