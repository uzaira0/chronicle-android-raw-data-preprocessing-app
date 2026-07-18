# 13 — The research ontology for Android event-log usage measurement (design)

**Status:** design draft 2026-07-18, for adversarial review (gpt-5.6-sol xhigh) before build.
**Scope:** the best-possible research ontology for THIS pipeline — Android UsageStatsManager
event logs → usage measurement. NOT an ecosystem-unification effort (that is
`research-pipeline/docs/chronicle-ontology-ecosystem.md`); this document takes every
relevant input into ONE contract for this one pipeline. Prior-art inputs verified via web
research 2026-07-18 (see §"Inputs").

## Goal

Turn the pipeline-graph (**14 processing nodes + 1 `outputs` sink = 15 graph nodes**; a
**54-key** option contract [`BROWSER_PROCESSING_OPTION_KEYS`, generatedContract.ts:25-80];
bypass predicates, memoized incremental recompute, dual web/desktop engines with byte-exact
parity) plus the
measurement model (`chronicle-ontology.md`: 5 layers, 6 behavioral + 3 integrity
parameters, absence semantics, person attribution) into a formal, standards-grounded,
machine-checkable ontology that makes every screen-time figure a reproducible claim with
explicit provenance, uncertainty, and construct grounding.

## North star (non-negotiable): reproduce the same outputs

The bundle is **DAG + state machine + ontology + algorithm, verified together and shipped as
one provenance-declared package.** But the acceptance test above all others is:
**re-running the packaged pipeline reproduces the exact algorithm outputs we already
produced** — byte-for-byte, same as the existing web/desktop byte-exact parity. The ontology,
provenance graph, LinkML schema, uncertainty layer, and visualizations are **descriptive
scaffolding around the existing algorithm — they exist to justify, visualize, check, and
bug-fix the outputs, NOT to change them.** They are non-mutating by construction:
- Nothing in this ontology work alters `graphDef.ts` node math, the 54-key contract's
  defaults, or the bypass predicates. If a modeling choice would change a number, it does not
  belong in the core — it goes in an **optional, side-by-side** layer that is off by default
  (same rule as the pipeline's number-changing steps).
- The reproduction check is a first-class artifact: a golden-output fixture + a test that the
  packaged run is bit-identical to the recorded baseline. Any ontology/refactor change must
  keep that test green. A green ontology that changed an output is a **failure**, not progress.
  **Built** (`web/src/lib/pipelineGraph/golden/`): `goldenScenario.ts` runs the real algorithm
  end-to-end (real in-process proximity matcher — `runMatcher`/`runSplitter` stubs throw to
  prove the real path; pinned `datetimeOfPreprocessing`; canvas plotting off) on two
  single-participant scenarios (single-user + shared device covering all three attribution
  buckets), and `goldenParity.test.ts` locks every text output (app / screen / compliance /
  coverage CSV) byte-for-byte against `expected/`. Re-record intentional changes with
  `UPDATE_GOLDEN=1` and review the golden diff. One participant per scenario — the matcher keys
  sessions on `app_package_name`, not participant.
- Provenance is recorded *after the fact* over the real run; it describes what the algorithm
  did, it never decides what it does.

Everything below serves this ordering: reproduce first, then justify/visualize/verify.

## Build status (2026-07-18)

- **Reproduction harness — DONE.** `web/src/lib/pipelineGraph/golden/` (see below). 5
  single-participant scenarios (single-user, shared-device-all-3-buckets, filter-file,
  aggregates, screen-gated crediting) → 25 golden text outputs locked byte-for-byte; verified
  to catch a 1-byte drift. Suite 393/393, typecheck clean.
- **LinkML generator toolchain — DONE.** `web/schema/` is now a self-contained,
  `linkml==1.10.0`-pinned (`uvx`, no venv) generator project mirroring sleep-scoring:
  `make all` emits OWL / SHACL / Pydantic / JSON-Schema / SQL-DDL from the one schema;
  `tools/canonicalize_ttl.py` (ported from sleep-scoring) makes the TTL byte-reproducible
  (`make repro-check` green). Fixed two schema blockers found while wiring: comma-in-inline-
  description YAML flow-mapping breaks, and an enum-ranged identifier slot that crashed
  gen-pydantic (split into a string id + `strategy_kind` enum slot).
- **Hand-authored SHACL contract axioms — DONE.** `web/schema/axioms/contract.shacl.ttl`
  encodes the invariants LinkML can't: closed & conservative attribution (unresolved ⇒ no named
  person), explicit endpoint absence (observed ⇒ instant present), no-data needs an expectation,
  and provenance completeness (episodes reconstructed_by an execution; effective-usage cites a
  ParameterSet + node execution). `make merge-axioms` folds them into `merged.shacl.ttl`;
  pyshacl confirms they fire (violating instance fails, conforming passes).
- **External-framework mappings — DONE (from verified anchors only).** The `engagement` layer
  carries `skos:relatedMatch` to BCIO `participant engagement with behaviour change intervention`
  (`BCIO_013000`, verified via EBI OLS) — relatedMatch, NOT closeMatch, because BCIO engagement
  is intervention-scoped and a chronicle app generally isn't an intervention. The Shaleha 2026
  framework (no class IRIs) is referenced via `rdfs:seeAlso` its DOI + a `skos:note` on the
  objective-log modality axis, not class-mapped. Verified the CURIE expands to the full BCIO IRI.
- **Still deferred (documented, NOT invented):** BFO-vs-DOLCE upper grounding — federate later via
  an SSSOM mapping set, don't re-ground this module (doc 13 D2).

## Inputs taken into account (every one)

| Input | What it contributes | Source |
|---|---|---|
| **P&T (Parry & Toth 2025)** | glances/sessions/episodes taxonomy; forward-pairing as a named strategy | doc 08; OSF mfnu9 |
| **EYES** (ACOI-UofSC) | complement device-state model (SHUTDOWN/IDLE/GAP/GLANCE), FAU=App∩ACTIVE, mass-based | doc 08; ported `device_states.py` |
| **Culverhouse** | downstream trim-and-log; bad-app caps; day flags | doc 08; ported `cleaning.py` |
| **Our engine** | 14 nodes, knobs, absence semantics, person layer, integrity params | `chronicle-ontology.md`, `graphDef.ts` |
| **SOSA/SSN** (W3C) | Observation/Procedure/Result/ObservableProperty/FeatureOfInterest backbone; SOSA-PROV + SOSA-OBOE alignment modules | w3.org/TR/vocab-ssn |
| **OWL-Time** | time:Interval + Allen relations for episode/session/glance/block topology | w3.org/TR/owl-time |
| **PROV-O** + **P-Plan / ProvONE** | processing provenance; **prospective plan (ParameterSet) vs retrospective run** — P-Plan `p-plan:Plan`/`Step`/`Variable`, ProvONE for workflow structure | w3.org/TR/prov-o; P-Plan; ProvONE |
| **IEEE 1752.1-2021** (Open mHealth) | standardized mHealth measure + minimum-metadata + survey representation — export target for the effective-usage figure | standards.ieee.org/ieee/1752.1 |
| **OBOE** (NCEAS) | derived-measurement pattern (Observation/Measurement/Entity/Characteristic/Standard) | github NCEAS/oboe |
| **BCIO Engagement Ontology** (OBO, Michie/HBCP) | ⚠ scope = engagement *with behaviour-change interventions*, NOT generic app/screen engagement (codex). Use `skos:closeMatch` only where an app genuinely IS such an intervention; do not assert equivalence | bciontology.org; HumanBehaviourChangeProject/ontologies |
| **Shaleha, Roque, Andrews, Calfee & Lee 2026 "Screen Use Measurement Tools"** | field measurement *framework* (NOT an ontology with stable IRIs). Axes: construct × modality (objective-log/self/proxy) × temporal specificity × **framing valence** × **opportunity cost** × dyadic/social context × **developmental focus** × validity. First author **Shaleha** | doi:10.1177/21522715261417288 |
| **SKOS** | concept schemes for Android event-type / API-version / app-category code lists | w3.org/TR/skos-reference |
| **QUDT / UCUM** | units on every duration/count measurement | qudt.org / unitsofmeasure.org |
| **DQV** (W3C Data Quality Vocabulary) | stream/measurement quality + coverage annotations (replaces the credal layer's honest core) | w3.org/TR/vocab-dqv |
| **XES** (IEEE 1849-2016) | standard event-log exchange format — candidate for raw UsageEvent interchange | tf-pm.org/xes |
| **Screenomics ontology** (Stanford) | screen-behavior typology (adjacent construct vocabulary) | mediaX |
| **ipad-research credal DAG** | assumption_cost/directness/prior_strength/epistemic-level L0–L4; mutation-probed SHACL; ontology-as-SSOT-generates-docs discipline; DPV-2.0 | `/home/opt/ipad-research`; CREDAL_DAG_METHODOLOGY.md |
| **sleep-scoring-ontology** | LinkML→OWL/SHACL/pydantic/sqlddl/json-schema toolchain; ROBOT/ELK reasoning; byte-repro artifacts; pipeline-steps.yaml (ProcessingStep≡prov:Activity) | `/home/opt/sleep-scoring-web/.../sleep-scoring-ontology` |
| **chronicle-server ontology** | CollectionModuleId × CollectionPrivacyClass = input provenance root (usage_events→BEHAVIORAL_METADATA) | `/home/opt/chronicle/ontology/chronicle.linkml.yaml` |
| **CAFE / DREAMER** | the study/measurement context this instrument serves | doc 08 |

## Design decisions (for review)

### D1 — Serialization SSOT = LinkML
Keep `web/schema/*.linkml.yaml` as the single source; generate OWL / SHACL / Pydantic /
JSON-Schema / SQL-DDL. Rationale: matches every sibling ontology (sleep-scoring,
chronicle-server, ipad), gives typed runtime models + RDF reasoning from one source, and
the drift-gate generate-or-check already exists. **Low risk.**

### D2 — Backbone = SOSA/SSN + OWL-Time + PROV-O; DO NOT pick BFO-vs-DOLCE at the top
The pipeline is intrinsically *observations → procedures → results over time intervals with
provenance*. SOSA supplies `Observation / ObservableProperty / Procedure / Result /
FeatureOfInterest`; OWL-Time supplies `Interval` + Allen relations (episode `during`
session, glance, block `meets`/`overlaps`); PROV-O supplies the processing chain.
Critically, **SOSA core makes no hard upper-ontology commitment** — the DUL alignment ships as
a *separate optional* module (`ssn/dul`), and SOSA has SOSA-PROV and SOSA-OBOE modules — so this
pipeline ontology can later federate with either the sleep-scoring (BFO) or ipad (DOLCE) stack
via SSSOM without re-grounding. (Third-party SSN↔BFO alignments have been published but are not
a W3C module; treat that bridge as a follow-up to verify, not a given.) **This is the
load-bearing decision to review.**
- Alternative A: adopt BFO/IAO like sleep-scoring (pro: sibling parity; con: commits the
  war, heavier for a sensor/observation domain).
- Alternative B: adopt DOLCE/DUL like ipad (pro: fusion-ready; con: overkill for a single
  pipeline, ties to the construct meta-layer prematurely).
- Chosen: **SOSA-first, upper-neutral.** Map key classes to BFO/DUL via `exact_mappings`
  only where free, defer the commitment.

### D3 — Mint a local `ScreenUseMeasurementSpecification`; only `skos:closeMatch` to BCIO/Shaleha
**REVISED per review.** Do NOT assert OWL equivalence or SSSOM exact-mappings to BCIO — its
engagement classes are scoped to *behaviour-change interventions*, not generic app/screen
engagement, so an exact mapping would be false. Mint local operational constructs
(`ScreenUseMeasurementSpecification` and its measures) and attach conservative,
provenance-annotated `skos:closeMatch` links to BCIO engagement terms *only* where an app
genuinely is such an intervention. Classify each measure along the Shaleha/Roque 2026
framework axes (construct, modality=objective-log, temporal specificity, framing valence,
opportunity cost, dyadic/social context, developmental focus, validity) as SKOS/annotation
metadata — the framework is a classification scheme, not a class-IRI source. Our measurement
layers (Construct→Validity→Presence→Engagement→Person→Attribution) become a
`MeasurementLayer` enum. Honors "name things in community vocabulary" AND the ipad
anti-pattern "do not invent top-level states" — local mint + documented close mappings is
the correct middle path (do not over-claim external equivalence).

### D4 — Core entity model (the classes) — REVISED: separate occurrence / record / assertion / execution / interval
**The single biggest correction from review.** Do NOT collapse real-world events, logged
records, procedures, executions, inferred assertions, and time intervals into
`sosa:Observation`/`sosa:Result` — that loses the observed-vs-reconstructed boundary,
makes censoring indistinguishable from missing RDF, and lets a valid-looking graph drop
unresolved people / silent device-days from denominators.

**Raw event — three entities, not one:**
- `PlatformEventOccurrence` — the Android lifecycle/system occurrence in the world
  (Activity Resumed/Paused/Stopped, Screen on/off, Keyguard, Shutdown/Startup). A
  `time:Instant`-anchored occurrent.
- `UsageEventRecord` ≡ `prov:Entity` — the logged information artifact (timestamp,
  event_type, package, class). Event-type = full EYES/P&T vocabulary with **both spellings**
  (labels + `Unknown importance: N`, codes 26/27/28/29…) as a **SKOS concept scheme**.
- `LoggingObservation` ≡ `sosa:Observation` — *optional*, only if we genuinely model the OS
  logger's act of observing a property. Do NOT type the event record itself as an Observation.

**Derived intervals — assertion ≠ interval ≠ execution:**
- `UsageEpisodeAssertion` / `UsageSessionAssertion` / `GlanceAssertion` ≡ `prov:Entity`
  (a derived information entity — what the pipeline *claims*).
- the phenomenon time it denotes ≡ `time:ProperInterval` (topology via OWL-Time Allen
  relations: `episode intervalDuring session`).
- `ReconstructionExecution` ≡ `sosa:Execution` **and** `prov:Activity` (the run that
  produced the assertion); the strategy it follows ≡ `sosa:Procedure` / `p-plan:Step`.
- `effectiveUsage` is an assertion whose interval = episode ∩ active-coverage — with the
  policy that produced it named (NOT asserted as physical truth; see gaps below).

**Pipeline structure (P-Plan, corrected from D7):**
- `PipelinePlan` ≡ `p-plan:Plan` / `prov:Plan`; `StepDefinition` ≡ `p-plan:Step` — the 14
  processing nodes (+ `outputs`), following sleep-scoring's `ProcessingStep` shape (id, verb,
  engine, consumes, produces, depends_on, phase, fatal).
- `NodeExecution` ≡ `prov:Activity` with `used`/`generated` edges.
- `ReconstructionStrategy` — **hybrid**: a strategy *class* for the semantic category +
  named, versioned *individuals* for concrete algorithms (P&T-forward-pairing / our-matcher /
  EYES-complement); the runtime enum carries the canonical procedure IRI. Subclasses ONLY
  where a strategy has genuinely different formal restrictions, not just a different id.
- `ParameterSet` ≡ `prov:Entity` **configuration** (a set of `ParameterBinding`s over the
  Plan's variables), content-addressed `parameterSetSha256`. **It is NOT a Plan** — the Plan
  is the workflow; the ParameterSet binds its variables.

**Absence / censoring — explicit status, never a null result** (open-world: missing triples
= unknown, not observed-absent):
- Every endpoint carries `EndpointStatus` ∈ {`observed`, `unobserved`, `right_censored`,
  `interval_censored`} with censor-time, lower/upper bound or duration bounds, reason, rule,
  supporting evidence. `EndOfUsageMissing` is `right_censored` **only** when observation ends
  while usage is believed open; a fallback bounded by later evidence is `interval_censored`.
- `CoverageAssessment` (replaces "GapBlock as device state") — a coverage/observability
  judgement over a stream window: expected vs actual availability, threshold, bounding
  events, cause. **A gap may CONCEAL usage** — never assert it disjoint from real usage, only
  how the measurement policy treats it. `NoData` cannot be inferred from UsageStats silence
  alone — it requires a collector heartbeat / declared availability expectation.
- This restores (does not regress) the factored device-state model of doc 11: a gap is an
  observability condition, shutdown is a runtime boundary (not proof the device was OFF),
  glance is a derived interaction construct.

**Person attribution — mandatory status + optional person, denominator conservation:**
- `AttributionAssertion` with required `status` ∈ {`target`, `known_non_target`,
  `unresolved`} + an *optional* actual person (attached only when known). **No `UnknownPerson`
  class, no null person.**
- Materialize a participant-device-day spine from **enrollment data**, outer-join
  measurements, and enforce the conservation invariant:
  `target + known_non_target + unresolved = eligible` duration.
- **What the code actually does (verified against `attributePerson.ts` /
  `scoreCompliance.ts`):** attribution is a CLOSED vocabulary — `"Target Child"`, `"Other"`
  (survey answers arrive as `"Other (From Survey)"`), or `"None"`/blank. Unresolved usage on a
  shared device (unlabeled, non-kids-shell) is written as `"None"` — there is **no `"unknown"`
  string and no participant-ID collapse**. The old code re-derived target/other/unknown from
  username substrings in `scoreCompliance`; because the vocabulary is closed this was not
  mis-bucketing, but it duplicated the classification. **Done this session:** a single
  `classifyAttribution()` SSOT in `attributePerson.ts` now decides
  `target`/`known_non_target`/`unresolved`, and `scoreCompliance` consumes it (behavior-
  preserving refactor aligning the code with this ontology's `AttributionStatus`).
- **Remaining modeling gap (the actual work here):** a day with zero real usage scores 100 and
  is **flagged** (`zeroRealUsage`) — it is *not* silently perfect — but a flagged zero-usage day
  still counts as valid. Promoting that flag to an explicit endpoint/coverage status (so
  "no data" is representable as *not evaluable*, not as a 100% score) is the D4 `EndpointStatus`
  / `CoverageAssessment` work, not a silent bug to patch.
- **Input-integrity parameters** (validity layer, kept): `TimestampFidelity` (ms vs 1s),
  `CanonicalOrder`, `EventMultiplicity` — measurement parameters with declared
  direction-of-error.
- **Input provenance:** chronicle-server `CollectionModuleId=usage_events` /
  `CollectionPrivacyClass=BEHAVIORAL_METADATA` as the `prov:Entity` the pipeline `used`.

### D5 — DROP credal annotations from the core (keep provenance + quality + calibrated bounds)
**REVISED per review: removed from core.** `assumptionCost` / `directness` / `priorStrength`
/ `epistemicLevel` have no operational definitions, no calibration data, no composition
rules, and no demonstrated link to belief masses — pathfinding over normalized subjective
scores is a ranking heuristic, not credal inference. Keep instead: named inference rules,
evidence links, **DQV-style quality measurements**, confidence intervals, and reconstruction
bounds. Dempster-Shafer / multistream fusion lives in a *separate optional* ontology, added
only if calibrated external signals (sleep, gaze, presence) are later introduced.

### D6 — Validation = generated SHACL + SHACL-SPARQL conservation + OWL consistency + mutation probes
- LinkML-generated SHACL for local cardinalities/datatypes.
- Hand-authored **SHACL-SPARQL / runtime queries** for the aggregate invariants: **A1**
  every `effectiveUsage` assertion cites a `ParameterSet` + `ReconstructionExecution`; **A2**
  every measure carries its Shaleha/Roque axis classification (mappings documented, not
  asserted equivalent); **A3** every input-integrity parameter declared before any duration
  result; **A4** the measurement policy for every gap/EoUM interval is explicit (NOT "gap
  disjoint from usage"); **A5** exactly-one attribution status + **duration conservation** +
  enrollment-spine completeness (no silent denominator drops); **A6** DPV legal-basis as
  inherited run/processing-context metadata (not duplicated on every technical node); **A7**
  a named reconstruction strategy on every episode assertion.
- **Every shape gets a mutation probe** (ipad discipline — the single most valuable check).
- OWL consistency tests + positive/negative ABox fixtures; competency queries; topology/count
  drift tests against the executable `graphDef.ts` (reconcile the node/knob counts first).

### D7 — Reproducibility / export — REVISED
Model provenance with **PROV-O + P-Plan**: the **`PipelinePlan` is the prospective
`p-plan:Plan`** (steps = `p-plan:Step`, parameters = variables/bindings); the `ParameterSet`
supplies the variable *bindings* (a configuration entity, content-addressed
`parameterSetSha256`); each run is a retrospective `prov:Activity`. Prospective-plan vs
retrospective-run is the established pattern (P-Plan, ProvONE, REPRODUCE-ME). Add ProvONE
only if a concrete competency question needs it. PROV-O JSON-LD export already built.
- **Primary interop target = a faithful, versioned JSON-LD/PROV research package** (not
  FHIR/IEEE as the core representation).
- **FHIR R5 Observation** only via a *defined profile* (subject, effective period, method,
  code, units, provenance, censoring extensions) — and do **not** reuse self-report
  screen-time LOINC codes for an objectively reconstructed event-log measure.
- **IEEE 1752.1** = reuse its *minimum-metadata pattern* only; it does not semantically
  cover arbitrary objective screen-use measures, so don't claim direct coverage.

## Review by gpt-5.6-sol (xhigh), 2026-07-18 — verdicts

| Decision | Verdict | Action taken |
|---|---|---|
| D1 LinkML SSOT | **KEEP** | unchanged |
| D2 SOSA/Time/PROV, upper-neutral | **KEEP with caveat** | keep neutral BUT define local categorical distinctions now + isolate BFO/DUL in optional bridges (neutrality ≠ postponing design) |
| D3 constructs | **REVISE** | local mint + `skos:closeMatch` only; BCIO is intervention-scoped; first author = Shaleha; framework not ontology |
| D4 core model | **REVISE (major)** | split occurrence / record / (optional) observation / assertion / execution / interval; ParameterSet = config not Plan |
| D5 credal | **DROP from core** | keep provenance + DQV quality + calibrated bounds; DS in optional module |
| D6 validation | **REVISE** | SHACL-SPARQL for conservation/attribution/spine; gaps not disjoint from usage; DPV inherited; OWL consistency + ABox fixtures |
| D7 export | **REVISE** | Plan≠ParameterSet; JSON-LD/PROV package first; FHIR via profile; IEEE 1752 metadata-only |

**Answers to the open questions:** (1) minimum SOSA subset — Procedure/Execution/Sensor +
observed-property/result only where justified; do NOT type event records or inferred
intervals as Observations. (2) upper-neutral now, but define local categories immediately.
(3) remove credal from core. (4) pin each imported ontology version+IRI, record mapping
provenance in SSSOM, test bridges independently, never let external alignments redefine the
core. (5) target a versioned JSON-LD/PROV package first; FHIR = profiled export; IEEE 1752 =
metadata influence.

**Missing standards it added:** SKOS (code schemes), QUDT/UCUM (units), **DQV** (quality —
the honest replacement for the credal layer), **XES / IEEE 1849** (raw event-log exchange).

## Prioritized build order (post-review)
1. Split `UsageEvent` → occurrence / record / (optional) logging-observation / derivation-
   execution / derived-assertion classes.
2. Separate PipelinePlan / StepDefinition / Procedure / Execution / ParameterSet /
   ParameterBinding.
3. Redesign endpoint absence with explicit observed/unobserved/right-/interval-censored +
   quantitative bounds.
4. Move gaps & NoData into an observability/coverage model backed by an enrolled
   participant-device-day spine.
5. Replace UnknownPerson with mandatory attribution status + optional person; enforce
   duration-conservation + denominator queries (fixes the `attributePerson.ts` /
   `scoreCompliance.ts` contract gap).
6. Remove D5 from core; keep evidence, provenance, DQV quality, calibrated bounds.
7. Mint local `ScreenUseMeasurementSpecification`; BCIO/Shaleha as documented close mappings.
8. Restore doc-11 factored device-state model; forbid gap/shutdown → physical-state assertions.
9. Reconcile the source-of-truth counts (15 graph nodes / 54 keys) + add generated-artifact
   drift checks.
10. Add SKOS (code lists), QUDT/UCUM (units), DQV (quality), optionally XES (raw log exchange).

## Single biggest risk (from review)
Collapsing records, real-world events, procedures, executions, inferred assertions, and
temporal intervals into `sosa:Observation`/`sosa:Result`. Lose that boundary and provenance
can't say what was *observed* vs *reconstructed*, censoring becomes indistinguishable from
missing RDF, and validation can certify a graph while unresolved people and silent
device-days silently vanish from denominators. D4's five-way split is the mitigation.
