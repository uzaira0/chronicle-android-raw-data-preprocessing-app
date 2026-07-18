# Validate / Ontologize / Productize the Pipeline DAG — Discovery Report

Date: 2026-07-17. Method: weight dump (grep-weights) → exclusion-list-disciplined web
discovery (2 passes) → local prior-art mining of `/home/opt/{knowledge-base,
research-standards, sleep-scoring-web(+ggir-ontology-extraction worktree),
stanford-screenomics, eyes-toolbox}` (all fetched/pulled first). Builds on the shipped
graph validation suite (`web/src/lib/pipelineGraph/graphValidation.test.ts`, 68 tests)
and the zero-mismatch web↔desktop parity harness.

Ground truth about THIS repo that shapes everything below:
- LinkML is ALREADY the options SSOT: `web/schema/chronicle-local-contract.linkml.yaml`
  → `generate_contract_artifacts.mts` → `generatedContract.ts` + OpenAPI. The DAG itself
  (`graphDef.ts`) is hand-authored and NOT covered by the schema.
- A run-manifest foundation exists (`processingReport.ts` → `chronicle-processing-report.json`
  in every output ZIP); FEATURE_IDEAS #25 already plans hashes/runId/environment.

---

## 1. VALIDATE — beyond the 68-test suite

### V1. Incremental ≡ from-scratch oracle (property test) — HIGHEST VALUE
The build-systems literature (Mokhov et al. "Build systems à la carte"; BuildFs, FSE 2020)
names the exact bug classes of a memoized DAG: under-approximated deps ⇒ stale reads,
over-approximated ⇒ wasted recompute. The canonical oracle: after ANY sequence of option
flips / support-file swaps / input changes, the incremental engine's outputs must equal a
fresh engine run with the same final state. Implement as a fast-check property on the web
engine: generate random mutation sequences, compare against a cold GraphEngine, assert
byte-equal outputs AND minimality (recomputed set ⊆ dirty cone — we already compute the
expected cone in the dirty-cone tests; this generalizes it from single flips to sequences).

### V2. Metamorphic relation suite (tests correctness, not just agreement)
Byte-parity proves the engines agree; it never proves either is right. MetaCDP (IEEE Cloud
Summit 2024) catalogs 10 metamorphic relations for data pipelines. Domain-instantiated for
Chronicle event streams:
- input row-order shuffle → identical output (sort keys make this a theorem to enforce);
- split a raw CSV at a day boundary → concat of outputs ≡ output of concat;
- duplicate an entire participant under a new ID → both outputs identical modulo ID;
- timezone-shift equivariance (shift all timestamps + tz setting by k hours);
- junk-blind (ALREADY PROVEN — it is MR #1 of this family; the suite generalizes it);
- idempotence: re-processing an already-processed output's episode set is a no-op.
Run each MR through BOTH engines via the parity harness — every MR doubles as a
differential fuzz scenario.

### V3. Covering-array sampling of the full 55-knob space
The 2^12 bypass enumeration is exhaustive over gates, but nothing guarantees interaction
coverage across all 55 knobs (the sentinel bug was an interaction: filter ON × walk
columns). Generate a constrained t-way (t=2 or 3) covering array — Microsoft PICT
(single C++ binary, constraint language, `/o:N` strength) or CAgen (SBA Research, faster,
web/CLI) — over the whole contract, encode illegal combos as constraints, and feed each
row through the parity harness + MR suite. Tens-to-hundreds of configs with guaranteed
pairwise/3-way coverage instead of 7 hand-picked scenarios.

### V4. Detector-truth fixture pairs (from research-standards)
`tests/test_detector_truth.py` discipline: every gate must have a true-positive fixture
(must fire) AND a true-negative fixture (must not fire); "a detector that passes its own
violation fixture is a dishonest gate." Apply to: every bypass predicate, every parity
assertion, every graphValidation invariant. The read-tracing proxies verify reads; this
verifies each check can actually FAIL. (Their `_CONFESSION` anti-pattern — a check
satisfied by text merely mentioning the property — is the exact bug class.)

### V5. Model-based transition sequences
The static 128-state execution sweep covers states, not paths. Generate shortest-path
transition WALKS over the gate-state machine (XState `@xstate/graph`, or plain fast-check
command sequences) so cache interactions between successive states get exercised —
this is where memoization bugs live (V1 is the oracle; this is a smarter generator).

### V6. Structural lints pinning the fixed bugs' code shapes + meta-tests
sleep-scoring-web pattern (ast-grep-rules/ + `test_static_analysis_guards.py`): one
ast-grep rule per fixed parity bug, scoped to the offending files, plus a meta-test that
the rule file exists, contains its pattern, and is wired into CI (their rules once
silently never ran — lowercase `stopby:`). Immediate candidates from this repo's history:
- forbid arithmetic on `MISSING_INT64` / sentinel columns outside the walk;
- forbid `toPrecision(` in float serialization paths;
- forbid `/ 60` true-division at duration sites (must be `* RECIP_60`);
- forbid blanking Filtered App Usage timing anywhere except `clearFilteredUsageTiming`.

### V7. DAG-SSOT ⇔ implementation parity test
sleep-scoring-web `test_pipeline_registry.py` model: once the DAG is declared in a schema
(O1 below), assert bijection with `graphDef.ts` — node ids, edges, knob bindings,
bypass gates — acyclicity via one topological sort, no orphan knobs. Complements
graphValidation (which validates the declared graph against the ENGINE); this locks the
declared graph to the SCHEMA.

---

## 2. ONTOLOGIZE — formal vocabulary for nodes, knobs, columns, provenance

### O1. Extend the existing LinkML schema to cover the DAG itself — KEYSTONE
`chronicle-local-contract.linkml.yaml` models options but not the graph. Add
`PipelineNode` / `PipelineEdge` classes (id, title, description, knobs, bypassed_when as a
declared expression over gate knobs, support_files, outputs) and either GENERATE
`graphDef.ts` from it or emit a JSON the V7 test checks against. Prior art in-fleet:
research-standards `ontology/` (BFO-grounded LinkML, deterministic-codegen Makefile with
the sort-post-process gotcha) and sleep-scoring-web's GGIR extraction (config surface →
LinkML classes + a coverage BIJECTION test, `test_ggir_config_coverage.py` — every formal
↔ slot, both directions). Verified current: LinkML ships stable `gen-typescript` AND
`gen-pydantic` — one YAML can emit both engines' types.

### O2. Column-semantics layer (the outputs are the product)
Every output CSV column becomes a LinkML slot with: definition, units
(seconds/minutes/hours — the `_minutes` naming rule becomes schema, not convention),
filter-dependence flag (`valid_app_*` filter-dependent vs `any_app_*` filter-invariant —
the theorem the junk-blind work proved becomes a machine-readable column property),
nullability semantics, and which node emits it. Community-vocabulary alignment:
- Android `UsageEvents` constant names as the ground-truth event ontology (the
  "Unknown importance: N" map in `interactionTypes.ts` should cite ACTIVITY_RESUMED=1,
  SCREEN_INTERACTIVE=15, etc. — EYES manual Table 2 confirms this is the shared codebook);
- EYES constructs where we have equivalents (their FAU = usage ∩ ACTIVE; GLANCE;
  pickups; primary/secondary usage for multi-window);
- IEEE 1752 / Open mHealth measurand schemas + DDI-Lifecycle (ISO/PAS 25955:2026) for
  variable-level codebook semantics.
Junk-app package filtering has NO prior-art name anywhere surveyed — it is this
pipeline's genuine contribution; name it deliberately.

### O3. Content-hashed ParameterSet as identity
research-standards `ontology/schema/traceability.yaml`: a ParameterSet is a
canonical-JSON, SHA-256-identified snapshot that IS its own identity — memoization key
and reproducibility anchor in one. The GraphEngine cache stamps are an informal version;
formalize one canonical hash of (options, support-file hashes, input hash, app version)
and print it in every manifest: "same hash ⇒ replay."

### O4. PROV-O run provenance sidecar
Upgrade `processingReport.ts` output to a PROV-DM-shaped JSON-LD: Entities = input files
(with sha256) + each output file; Activities = node executions (with the O3 ParameterSet
hash, node id, engine version); derivations = the DAG edges actually taken (bypassed
nodes recorded as pass-throughs). knowledge-base already catalogs the in-fleet pattern
("PROV-DM as nested Pydantic", CloudEvents+PROV audit envelope). Zero parity impact —
sidecar only.

### O5. Grounding taxonomy per knob
research-standards' `fleet-observed` / `source-log` / `best-practice` labels, applied to
all 55 knobs: which are exercised by production (locked defaults), which by tests only,
which are aspirational. The read-tracing suite already knows which knobs each node reads;
cross-reference with TRACE_CONFIGS + production defaults to compute exercised-ness
mechanically, and fail if a knob is unreachable by any test config.

### O6. Answer the EYES critique in the divergence doc
The EYES manual (April 2026, p.4 §3) critiques "the Uzair tool" by name: resume→next-pause
matching "does not differentiate the activities of the same app well and is not able to
handle multi-window applications such as Youtube." A vocabulary-alignment doc should state
where this is stale (`model_concurrent_usage` + the WASM concurrent splitter exist
precisely for overlap) and where their constructs (primary/secondary duration columns,
device_status join, inference-state vocabulary for malformed streams) are worth
evaluating. Also surface END_OF_DAY(3)/CONTINUE_PREVIOUS_DAY(4) — platform-emitted day
markers we may be recomputing.

### O7. Graph-structure analytics over the DAG (cheap, from knowledge-base)
`_tools/derive.py` patterns applied to the 14-node graph + 55 knobs: articulation points
(mandatory stages), betweenness (load-bearing nodes), alias-collision detection over
knob/column names across BOTH engines (the "one string means two things" hazard is
exactly a parity risk), and a generated glossary.

---

## 3. PRODUCTIZE — contract, docs, packaging

### P1. Generated researcher-facing codebook
From O2's column schema, generate the codebook (markdown + xlsx) — column, definition,
units, formula, filter-dependence, engine parity status. Prior art: DDI-Codebook, the R
`codebook` package (JSON-LD emitting), Stanford Screenomics' `04_Events.md`. Kills the
"what does any_app_usage_time_gap_hours mean" class of researcher question and makes the
sentinel-bug fix legible (the old wrapped values were undocumented semantics).

### P2. RO-Crate output packaging
FEATURE_IDEAS #25 (run manifest) upgraded: emit `ro-crate-metadata.json` in the output
ZIP — inputs with hashes, outputs, the O3 ParameterSet, app version, timestamps.
`ro-crate-py` verified healthy (v0.15.1, 2026-07-10); web side is a small JSON-LD
serializer (no library needed — the crate is just structured JSON-LD).

### P3. Hash-manifest + idempotent regen `--check` (CONTRACTS.md pattern)
sleep-scoring-web's wall: `generated-manifest.txt` of sha256s (Source/Generated tagged),
one idempotent regen script, CI job that regens into a tempdir and asserts in-tree ==
fresh == manifest, no waivers. Apply to: generatedContract.ts, OpenAPI yaml, and (post-O1)
graphDef artifacts. `check:contract` exists; this generalizes and hardens it.

### P4. Published, versioned data contract
The LinkML schema → JSON Schema already exists in-tree; publish it as a versioned
artifact (the gh-pages site already exists) with a changelog, so collaborators consume
the contract without the repo. The Data Contract Specification (datacontract.com v3.1)
and Ordaze (typed registry → 13-language codegen → CI drift gate) are the external models;
we need no new tool — LinkML + the existing generator is the same architecture.

### P5. Report-shape-as-schema for every tool
Every JSON-emitting script (parity harness results, processing report, future diff
packets) gets a LinkML class; each tool's contract test asserts `model_validate(output)`.
sleep-scoring-web applies this to ALL its bots; it prevents silent report-shape drift.

### P6. Fleet gap report burn-down (already exists!)
research-standards already grades this repo:
`parity/gap-report-chronicle-android-raw-data-preprocessing-app.md` — 3 required gaps
(AI-attribution trailers in commit history is one; note the monorepo-side session config
appends those trailers — this REPO's convention forbids them) + 89 recommended, each with
fix + evidence lines, including `data-lineage-provenance` (= O4) and
`docs-adr-decision-records`. The registry's `evolution.md` flow means passing more
standards is tracked automatically.

---

## Decision ledger

| Capability | Decision | Evidence | Follow-up |
|---|---|---|---|
| Incremental≡scratch + sequence property tests | Compose (fast-check + existing engine/harness) | fast-check already a fit for TS; BuildFs oracle framing | V1 suite in pipelineGraph tests |
| Metamorphic suite | Adapt (MetaCDP MR catalog → domain MRs) | no released tool; catalog transfers directly | V2 scenarios through parity harness |
| Config-space coverage | Adopt PICT (or CAgen) | PICT: single binary, constraints, n-way; maintained-enough (v3.7.4) | model file over 55 knobs + constraint list |
| DAG ontology + codegen | Adopt LinkML (extend EXISTING schema) | gen-typescript + gen-pydantic verified stable; in-fleet prior art ×2 | O1 classes + V7 bijection test |
| Column semantics / codebook | Compose (LinkML slots + generator; align IEEE 1752 / DDI names) | verified standards current | O2 + P1 |
| Run provenance | Build-small (PROV-shaped JSON-LD sidecar; RO-Crate layout) | ro-crate-py healthy; sidecar = no parity impact | O3 + O4 + P2 |
| Structural lints | Adopt ast-grep (already fleet-standard) + meta-tests | sleep-scoring-web wiring incl. dead-rule incident | V6 rules |
| Regen drift wall | Adapt CONTRACTS.md pattern | proven in-fleet | P3 |

## Smoke plan
- PICT: download binary → run a 10-knob model with 2 constraints → verify row count/coverage.
- LinkML gen-typescript: run over the EXISTING contract yaml → diff against generatedContract.ts shape.
- fast-check: one trivial property over GraphEngine in vitest (already a dev-dep candidate; check package.json).
- RO-Crate: hand-write one crate JSON for a sample run → validate with ro-crate-py in the desktop venv.

---

# SOTA deep-dive (second pass, 2026-07-17) — latest/best iterations of the validation concepts

Three targeted verification passes (named lookups allowed) upgraded V1–V5 to the current
state of the art. This section supersedes the tool choices sketched above.

## S1. Incremental-engine correctness — canonical properties + tools

The headline property is **from-scratch consistency** (Acar, self-adjusting computation;
= "correctness" in Build Systems à la Carte): after ANY edit sequence, every node's stored
value equals a from-scratch build on the final inputs. The named property set:

| # | Property | Test pattern | Status here |
|---|---|---|---|
| 1 | From-scratch consistency | random MUTATION-SEQUENCE parity vs cold rebuild (fast-check `fc.commands`) | GAP — we only test single flips + fixed states |
| 2 | Early cutoff ("backdating" in Salsa) | value-equal re-run ⇒ zero downstream recompute | GAP — requires stamp backdating on value-equality (the "outputHash early-cutoff" idea in FEATURE_IDEAS); Salsa's event-hook tests are the model |
| 3 | Minimality | recompute-set SET-EQUALITY vs independent reachability walk, both directions, per-node counter ≤ 1 | PARTIAL — dirty-cone tests check one direction on single flips |
| 4 | Determinism/purity | run twice byte-identical; freeze clock (`@sinonjs/fake-timers`), seed RNG (`pure-rand`) | implicit via parity; make explicit |
| 5 | Dependency soundness (BuildFS class) | traced reads ⊆ cache key | DONE (proxy read-tracing) — promote to explicit key-coverage assertion |
| 6 | Engine metamorphic battery | idempotent re-run; disjoint-cone edit commutativity (E₁;E₂ ≡ E₂;E₁); edit+inverse restores memo state; batch ≡ one-at-a-time; bypass-toggle-to-same-decision ⇒ no downstream change | GAP |

Tools (verified current): **fast-check v4.9.0** (2026-07-08; `fc.commands`, `fc.scheduler` —
scheduler + fake-timers + seeded PRNG = deterministic-simulation testing for a
single-threaded engine, no Antithesis-class framework needed; run worker logic in-process,
schedule postMessage delivery), **@fast-check/vitest 0.4.1**, **StrykerJS 9.6.1** (TS
mutation testing, scoped to invalidation/cache-key/bypass modules, nightly) and
**mutmut 3.6.0** (Python twin) to mutation-score the validation suite itself,
**Quint v0.32.0** (npm, TS-like syntax, Apalache/TLC backends) as the pragmatic formal-spec
choice — model `always(materialized ⇒ output == fromScratch)` + minimal-recompute over the
14-node graph. XState `xstate/graph` path enumeration optional second axis (note:
standalone `@xstate/test`/`@xstate/graph` packages are deprecated; import from `xstate/graph`).

SKIP (evaluated, not worth it): Jazzer.js (maintenance mode; edge-feedback fuzzing wins on
opaque parsers, not typed enumerable DAGs), JS concolic/symbolic (no maintained tool),
LLM test-sequence tools (nothing installable), heavyweight DST frameworks
(madsim/turmoil/VOPR — disproportionate), snapshot-fuzz hybrids (weaker than the existing
byte-parity pseudo-oracle), TLA+/Alloy as FIRST choice (Quint gives the same backends with
npm workflow; Alloy 6.2 runner-up for visual counterexamples).

## S2. Metamorphic + differential — the 24-MR catalog

Key architectural point: run every MR as **metamorphic-differential** — assert the relation
per engine AND cross-engine parity on the transformed input. Engines diverge ⇒ one is
wrong; engines agree but MR fails ⇒ SHARED bug (the class byte-parity can never catch).
This is what DBMS testing converged on (SQLancer's oracles are metamorphic).

Catalog (domain-instantiated; provenance: MetaCDP 2024 MR classes, Segura MRP catalogs,
Ying 2025 STVR pattern catalog, DBMS duplicate-sensitivity oracle):

- **Order**: (1) row-shuffle invariance; (2) tie-break determinism (permute only
  equal-timestamp rows — isolates polars stable sort vs Array.sort divergence);
  (3) column-reorder invariance.
- **Composition/partition**: (4) disjoint-participant union locality f(A∪B)=f(A)⊎f(B);
  (5) per-participant file concat; (6) split at gap ≫ threshold ⇒ concat of halves;
  (7) mid-episode split MUST differ (negative MR — documents never-split-mid-stream).
- **Time equivariance**: (8) +k×24h shift ⇒ pure shift, durations/counts/structure
  invariant; (9) sub-day +Δ ⇒ durations/counts invariant, day membership moves only
  across local midnight; (10) same instants re-expressed in different tz offset ⇒
  identical (normalization keys on instant, not wall string).
- **Subset/monotonicity**: (11) time-tail deletion ⇒ subset (modulo truncated final
  episode); (12) participant removal ⇒ exact complement; (13) gap-threshold ↑ ⇒ session
  count monotonically non-increasing, coarser partition; (14) window narrowing ⇒ subset.
- **Idempotence/noise**: (15) re-run byte-identical; (16) redundant same-state transition
  collapse; (17) exact-duplicate rows per spec, identical across engines;
  (18) filtered-noise invariance (junk packages, out-of-window rows) — the junk-blind
  theorem is this MR, already proven; (19) CSV-formatting invariance (quoting, CRLF, BOM —
  prime polars-vs-TS parser divergence spot).
- **Relabeling/conservation**: (20) participant-ID bijection equivariance; (21) package
  bijection equivariance; (22) duration conservation Σ output durations = Σ paired
  transition intervals (mass conservation — a true oracle-free invariant).
- **Degenerate**: (23) empty/singleton (lone unpaired start ⇒ held-open per 6h-truncate
  rule, identical across engines); (24) malformed pairing (stop-before-start, overlap) ⇒
  deterministic identical handling.

Verdict on automated-MR tooling: **hand-write these; do NOT adopt a tool.** GenMorph is
Java/scalar-only; MR-Adopt solves MR *reuse* not discovery (JUnit-centric); MR-Coupler/
NOETHER (2026) are theory; LLM MR derivation = brainstorming aid only. SQLancer is
SQL-only — borrow its oracle patterns (TLP partition-recombine ≈ MR-6, duplicate
sensitivity ≈ MR-17), not the tool. (Caveat: MetaCDP's literal 10-MR list is paywalled —
IEEE Cloud Summit 2024 pp.135-142, DOI 10.1109/CLOUD-Summit61220.2024.00029; the classes
above are reconstructed from the abstract + the broader MT literature.)

Fixture generation, two tracks: **Track A (workhorse)** Hypothesis `RuleBasedStateMachine`
emitting device-plausible event streams (interleaved screen/app events, out-of-order,
duplicates, unpaired transitions, sub-second ties, tz offsets, threshold-straddling gaps) +
`hypothesis.extra.pandas`/Pandera `schema.strategy()` — shrinking turns a 50k-row engine
divergence into a 3-row repro; fast-check arbitraries mirror it web-side. **Track B (bulk
realism)**: PM4Py play-out / PLG2 / PURPLE process-mining log generators mapped to the
Chronicle schema for volume/drift fixtures; never Track B alone (happy-path logs don't
trip parser/tz/tie bugs).

## S3. Combinatorial interaction testing — final picks

**Generator: Microsoft PICT** (MIT; compile the single C++ binary once; constraint DSL
`IF [a]=x THEN [b]<>y`; mixed strength via sub-models — critical knobs at t=3, rest t=2;
weights/seeding/negative tests). Drive from both engines: `pict-node` v1.3.2 (npm) in
vitest, `pypict`/subprocess in pytest, ONE SSOT model file for the 55 keys. **CAgen**
(SBA Research, Rust mFIPOG, won CT-Competition 2022+2023) as minimality benchmark —
not on npm/PyPI, license unconfirmed; ask SBA before committing. NIST ACTS = public-domain
Java fallback. Research SOTA on minimality (FastCA/SamplingCA; Krupke et al. TOSEM 2025
provably-optimal pairwise) = not turnkey, ignore unless suite size becomes a goal.

**Coverage measurement — do this FIRST: NIST CCM** (public domain, Java CLI, no
registration) computes the t-way coverage of an EXISTING test set. Express the 55-knob
contract as the PICT model, feed the current 7 hand scenarios + 128-state gate sweep in as
CSV rows, and get a before-number at t=2/3/4 — then generate arrays to close the gap.
(Alternative: CAmetrics for tuple-distribution diagnostics.)

## Updated recommended sequence (each its own both-engines-where-relevant change)
1. **S1 gaps first**: fast-check mutation-sequence parity (from-scratch consistency) +
   recompute-set set-equality with ≤1 counters + the engine MR battery (S1 #6). Direct
   continuation of the bug-hunt that just paid off; tests the ENGINE.
   ✅ DONE 2026-07-17 — enginePropertyValidation.test.ts + validationHarness.ts; found and
   fixed the wall-clock `datetime_of_preprocessing` purity bug (session-stable stamp in
   browserPipeline.ts).
2. **S2 MR suite** (the 24 relations, metamorphic-differential through the parity
   harness, Hypothesis/fast-check Track-A generators). Tests the SEMANTICS — the class of
   shared bugs byte-parity can never catch.
   ✅ DONE 2026-07-17 (battery v1: MR-1/2/8/17/19/20) — scripts/run_metamorphic_suite.py +
   `make metamorphic`; all relations hold, cross-engine parity clean on every transform.
3. **S3**: NIST CCM coverage measurement of the existing scenarios, then PICT covering
   arrays to close the measured gap. ✅ DONE 2026-07-17 — `web/combinatorial/` +
   `make combinatorial`. Before: 43.5% 2-way / 26.4% 3-way (150 executed configs).
   After adding PICT arrays (18 t=2 + 62 t=3 rows, executed in
   coveringArrayValidation.test.ts): 100% at both strengths. CCM needed a headless
   recompile (JFrame in static init) — patched build at /home/opt/nist-ccm.
4. **O1 + V7** (DAG into the existing LinkML SSOT + bijection test) — makes the graph a
   schema-governed artifact instead of hand-authored TS.
5. **O2 + P1** (column semantics + generated codebook) — the researcher-facing product.
6. **O3/O4 + P2** (ParameterSet hash + PROV/RO-Crate sidecar) — reproducibility story,
   zero parity risk.
7. **V4 + V6 + P3** (detector-truth pairs, bug-shape lints, regen wall) + StrykerJS/mutmut
   mutation-scoring of the whole validation suite — hardening, incremental.
8. **Early-cutoff/backdating** (S1 #2) — an ENGINE change (stamp backdating on
   value-equality), do it with its own property tests once #1's harness exists to guard it.
