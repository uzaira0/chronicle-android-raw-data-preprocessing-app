# Thesis outline: processing uncertainty in passive screen-time measurement

**Status:** milestone-zero working outline, 2026-08-11

**Implementation baseline:** private-preview `main` at `312ef63`

**Baseline deployment source:** unverified; `312ef63` is not tied to a deployed artifact

**Production canary:** not run against an artifact proven to come from `312ef63`

**Scientific status:** `claim:H01_VECTOR_STRUCTURE` and `claim:H02_BINDING_DISAGREEMENT` are
unvalidated/unrun hypotheses; `claim:H01A_DISCLOSURE_INSTRUMENT` is proposed and unvalidated;
`claim:C04_HOURLY_PLACEMENT` is externally reported but not reproduced; and
`claim:C05_VENDOR_CALIBRATION` has no data

This outline is a chapter plan, not a claim authority. Stable statements, status tuples, and gate
IDs come from [`claim-ledger.yaml`](./claim-ledger.yaml); scientific components come from
[`measurement-component-rubric.yaml`](./measurement-component-rubric.yaml); delivery IDs and
baseline statuses come from [`delivery-axis-ledger.yaml`](./delivery-axis-ledger.yaml). Primary
sources govern published-method semantics, schemas govern repository terminology, source/tests
govern implementation capability, and deployment records alone govern what shipped.

## 1. Thesis purpose and through-line

Passive screen-time measures are not direct observations of a stable construct. They are outputs
of instruments and processing decisions that select events, reconstruct intervals, group usage,
assign time, filter applications, handle failure, and clean days and participants. The thesis tests
a provisional common vocabulary, implements scientifically admissible alternatives as executable
bindings with orthogonal evidence/conformance fields, measures their consequences if the gates
pass, and develops a reporting framework for passive sensing.

The strongest empirical proposition remains a hypothesis:

> Complete, source-faithful, scientifically admissible method bindings may produce materially
> different episode, session, day, participant, and downstream-analysis results when applied to
> the same authorized real event stream.

The thesis must test that proposition with valid complete bindings and authorized real study data.
It must not substitute synthetic divergence, an engineering defect, a vendor aggregate, or a
correlation between methods for the required test. “Admissible” means listed in an outcome-frozen,
exhaustive registry with target construct/output, required signal and signal-relation stratum,
complete versioned binding, source lineage, dependency/compatibility rules, and enumerated
inclusion, exclusion, or refusal reason. Source-faithful whole methods and controlled component
perturbations are separate analysis families.

### Falsifiers and scope limits

- `claim:H01_VECTOR_STRUCTURE` is weakened by an in-scope typed mobile
  event-to-cleaned-summary rule that the component rubric cannot express.
- `claim:H01A_DISCLOSURE_INSTRUMENT` is weakened if deterministic scoring cannot be applied
  reliably by independent coders or does not identify a determinate measure.
- `claim:H02_BINDING_DISAGREEMENT` is weakened if valid complete bindings agree within
  preregistered practical tolerances on absolute values, ranks, and downstream estimands.
- `claim:C03_CAPABILITY_DEFINABILITY` is weakened if a supposedly lower-capability instrument
  supports the same auditable choices without delegated or hidden construction.
- `claim:C04_HOURLY_PLACEMENT` is removed from the evidentiary thesis if its code, data, and
  reported outputs cannot be independently reproduced.
- `claim:C05_VENDOR_CALIBRATION` remains a planned no-data study unless same-device vendor and
  raw-log data are actually collected.
- Claims are scoped to mobile screen/use measurement from typed or derived device traces. Generic
  web sessions, process logs, or sensor streams are methodological precedents, not members of the
  direct empirical population.

## 2. Canonical claim projections

The thesis uses the canonical statements verbatim by reference to their IDs; it does not redefine
them. The exact status tuples and gate IDs at ledger version `1.0.1` are:

| Claim ID | Exact status tuple | Thesis disposition | Exact required gate IDs |
| --- | --- | --- | --- |
| `claim:C01_LEGACY_MISSING_END` | `WITHDRAWN / INVALIDATED_AS_STATED / NOT_APPLICABLE` | Historical correction only; no evidentiary chapter | `GATE-C01-LEGACY-NO-REVIVAL` |
| `claim:H01_VECTOR_STRUCTURE` | `HYPOTHESIS / UNVALIDATED / UNRUN` | Chapter 5 hypothesis | `GATE-H01-FREEZE`; `GATE-H01-SOURCE-MAP`; `GATE-H01-COUNTEREXAMPLES`; `GATE-H01-PRIOR-ART` |
| `claim:H01A_DISCLOSURE_INSTRUMENT` | `PROPOSED / UNVALIDATED / PRELIMINARY_COUNTS_ONLY` | Chapters 3, 5, and 13 proposed instrument | `GATE-H01A-RUBRIC`; `GATE-H01A-INDEPENDENT-SCORING`; `GATE-H01A-ADJUDICATION`; `GATE-H01A-RECONCILIATION` |
| `claim:C01B_PARAMETER_PROVENANCE` | `CONCEPTUAL / PARTIALLY_SUPPORTED / NOT_APPLICABLE` | Chapters 3, 5, and 7 conceptual bridge | `GATE-C01B-SOURCE-LEDGER`; `GATE-C01B-BOUNDARIES`; `GATE-C01B-BINDING` |
| `claim:H02_BINDING_DISAGREEMENT` | `HYPOTHESIS / UNVALIDATED / UNRUN` | Chapters 8–10 headline empirical hypothesis | `GATE-H02-COMPLETE-BINDINGS`; `GATE-H02-CONFORMANCE`; `GATE-H02-PREREGISTRATION`; `GATE-H02-DATA-AUTHORITY`; `GATE-H02-EXECUTION` |
| `claim:C03_CAPABILITY_DEFINABILITY` | `CONCEPTUAL / PARTIALLY_SUPPORTED / NOT_APPLICABLE` | Chapter 4 conceptual claim | `GATE-C03-MATRIX`; `GATE-C03-PLATFORM-SOURCES`; `GATE-C03-COUNTEREXAMPLES` |
| `claim:C04_HOURLY_PLACEMENT` | `EXTERNAL_REPORT / UNVALIDATED / EXTERNALLY_REPORTED_NOT_REPRODUCED` | Conditional Chapter 11 only | `GATE-C04-ARCHIVE`; `GATE-C04-INDEPENDENT-RERUN`; `GATE-C04-ESTIMANDS`; `GATE-C04-VALIDATION` |
| `claim:C05_VENDOR_CALIBRATION` | `PLANNED / UNVALIDATED / NO_DATA` | Conditional/no-data Chapter 12 only | `GATE-C05-AUTHORITY`; `GATE-C05-ACQUISITION`; `GATE-C05-BINDINGS`; `GATE-C05-PREREGISTRATION`; `GATE-C05-DATA` |

The reconciled fixed-census counts are preliminary and not independently verified: 35/51 full
text and 16/51 abstract/metadata; 2/16 eligible app-level streams declare a reconstruction rule
(only one is empirical); 5/7 eligible device-level streams declare the pair; one threshold
sensitivity analysis appears in the fixed 51-reference frame. They are a coarse declaration screen,
not evidence that the proposed disclosure instrument is usable.

## 3. Thesis architecture

### Chapter 1 — Introduction: screen time as a constructed measure

**Chapter framing (not a claim-ledger ID):** disagreement and non-reproducibility can enter before
statistical analysis because a duration must be constructed from incomplete and platform-dependent
traces.

Content:

1. substantive stakes in child and family screen-time research;
2. observation versus reconstruction;
3. why “objective” does not mean interpretation-free;
4. research questions, canonical claim IDs/status tuples, falsifiers, and planned contributions;
5. Android as the primary executable case and iOS as the observability boundary;
6. ethical, privacy, and data-access constraints;
7. chapter map and evidence-status legend.

### Chapter 2 — Measurement construction, validity, and processing uncertainty

**Chapter framing (not a claim-ledger ID):** reproducible execution and construct validity are
distinct; a fixed pipeline can reproduce a differently defined or invalid quantity.

Content:

1. measurement theory for constructed digital traces;
2. self-report versus logged measures without treating either as automatic ground truth;
3. processing-induced measurement error;
4. multiverse/specification-curve analysis and admissible branches;
5. absolute agreement, rank stability, reliability, and downstream sensitivity as different
   properties;
6. missingness and reactivity as possible signal, failure, or ordinary life;
7. lessons from actigraphy, wearables, psychometrics, neurophysiology, and computable phenotypes.

### Chapter 3 — Systematic evidence synthesis and recovery sources

**Chapter framing (not a claim-ledger ID):** examined reconstruction rules are distributed across
prose, code, platform source, vendors, and inherited citations in forms that complicate direct
comparison.

Content:

1. fixed external sampling frame comprising all 51 W&B bibliography references, fixed before
   screening but not a probability sample;
2. expanded A–F discovery corpus and deduplication;
3. source-access depth and the fixed-census `UNDET = not read in full` rule;
4. separate fields for `DECLARED`/`DELEGATED`/`ABSENT`/`N/A`/`UNDET`, delegation target,
   adjudication, parameter derivation/transfer/source support, and runtime refusal;
5. direct mobile evidence versus transfer evidence;
6. quotation and identifier verification;
7. literature result tables and limitations.

Deliverable: the proposed `claim:H01A_DISCLOSURE_INSTRUMENT` dataset only after independent
scoring, deterministic outcome mapping, adjudication, and reliability gates; until then, only the
qualified preliminary declaration screen.

### Chapter 4 — Instrument capability and platform observability

**Chapter focus:** operationalize `claim:C03_CAPABILITY_DEFINABILITY` without treating capability as
a truth or study-quality ranking.

Content:

1. capability/definability ladder and its partial-order caveat;
2. raw Android UsageEvents and declared semantics;
3. research-app streams and undeclared builders;
4. vendor-derived event predicates and device-class differences;
5. device-only screen/power traces;
6. iOS Screen Time, DeviceActivity, limited export routes, Shortcuts uncertainty, and forensic
   traces;
7. vendor aggregates and downstream analysis;
8. version drift, entitlement/geography, and shared-device attribution.

Deliverable: `claim:C03_CAPABILITY_DEFINABILITY`'s construct-by-instrument matrix after its exact
canonical gates.

### Chapter 5 — An ontology of event-to-measure decisions

**Chapter hypothesis:** `claim:H01_VECTOR_STRUCTURE`, with scope and status copied from the claim
ledger, is tested against source mappings and counterexamples rather than assumed.

Content:

1. exact ontology classes—`PlatformEventOccurrence`, `UsageEventRecord`,
   `UsageEpisodeAssertion`, `UsageInterval`, `ReconstructionExecution`,
   `UsageSessionAssertion`, and `GlanceAssertion`—kept distinct from runtime device-state blocks,
   pickups, grouped `usage_session_id` outputs, summaries, and proposed pre-clean artifacts;
2. the 21 provisional scientific components generated from
   [`measurement-component-rubric.yaml`](./measurement-component-rubric.yaml), plus six recurrent
   rule families and the counterexample protocol;
3. event selection, opener/closer, pairing, unmatched/duplicate handling, and collision policy;
4. device state, shutdown/startup, censoring, timezone/day assignment, and DST;
5. duration bounds, grouping, packages, background attribution, data gaps, and cleaning;
6. parameter provenance and boundary inclusivity;
7. failure and refusal semantics;
8. relationship to ACES, DDI-CDI, OHDSI/Circe, CQL, VTL, OWL-Time, SOSA, PROV-O/P-Plan, and
   adjacent ontologies;
9. counterexample and falsification protocol.

Deliverable: a validated ontology/rubric crosswalk and the evidence needed for
`claim:H01_VECTOR_STRUCTURE`; the 21-component rubric is not itself the LinkML ontology.

### Chapter 6 — Executable semantics and browser artifact

**Engineering proposition:** the ontology and local contract can inform an executable Rust/WASM
workflow without creating a second preprocessing authority in TypeScript.

Content:

1. schema → generated browser vocabulary → Rust/WASM request path;
2. baseline order—episode annotations → interval cleaning → aggregation—and the target pre-clean
   fork that emits/aggregates both pre-clean and cleaned branches;
3. default-off compatibility and byte-identical default behavior;
4. persistence, recovery, cache identity, cancellation, worker replacement, and offline operation;
5. thin manifests that reference existing `ParameterSet`, strategy/execution, query/operation,
   receipt, dependency, and influence records; execution provenance and reason codes are present,
   while row/fragment lineage remains incomplete;
6. comparison, visualization, and complete export;
7. accessibility, large-file behavior, and deployment packaging;
8. architecture rule: no preprocessing implementation in TypeScript.

Deliverable: the validated browser application and reproducible execution package.

### Chapter 7 — Evidence-aware conformance for published-method bindings

**Chapter rule:** a binding can be certified as a published-method replay only when its complete
vector is explicit and independent end-to-end conformance passes. Signal relation, completeness,
execution disposition, source review, component validation, reference/native replay,
independent conformance, triangulation, and parameter provenance remain orthogonal fields.

Content:

1. baseline runtime values—five retention, seven reconstruction, seven grouping, and two quality
   values counting defaults—described as implementation options, not independent method counts;
2. exact canonical evidence tokens from the rubric, including separate parameter derivation,
   transfer, and source-support fields; no scalar “worst fidelity” rule;
3. `delivery:B01`'s four literature-labeled alternatives remain source-unverified until source
   artifacts and membership fixtures land;
4. complete method manifests versus individual strategy selectors and user-named snapshots;
5. primary-code/data oracles, source-derived fixtures, property tests, declared tolerances, and
   independent composite replay;
6. reconstruction strategies and their derivation/independence relationships;
7. event-retention, grouping, interval-quality, screen, temporal, and cleaning components;
8. EYES as an ACTIVE-only partial adaptation: full tagged final-app-usage output is not emitted,
   trailing fragment close reasons are misattributed, reference primary/secondary layering is not
   ported or proven equivalent to `usage_layer`, parameters are largely fixed, and the three
   deliberate reference-defect corrections travel in its manifest;
9. `parry_toth_forward_pairing` as the contributor adaptation rather than the paper alone;
   Culverhouse as a downstream derivative whose source-lineage pairing is distinct from controlled
   compositions with other strategies, cannot express the parent-only 12-hour rule, and narrows
   collapse lineage;
10. explicit refusals for unavailable signals, including conditional `delivery:B13` media
   continuation;
11. versioned expansion hashes and UI transparency; scientific method presets remain withheld until
   complete-vector conformance passes.

Deliverable: the orthogonal evidence/refusal matrix and, only after conformance, certified
scientific bindings. No current user snapshot is promoted to a method preset.

### Chapter 8 — Reconstruction multiverse on authorized real data

**Chapter hypothesis:** `claim:H02_BINDING_DISAGREEMENT` is tested on authorized real data; valid
agreement within the preregistered tolerance narrows the empirical importance of the tested
bindings without validating universal equivalence.

Content:

1. preregistration, dataset authority, privacy, and licensing;
2. an exhaustive, outcome-frozen admissibility registry covering construct/output, required
   signal, signal stratum, complete binding, source lineage, compatibility, and every
   inclusion/exclusion/refusal;
3. source-faithful whole-binding contrasts kept separate from controlled component contrasts;
   one-axis perturbations identify main effects only, while interactions require preregistered
   crossed full-rank subsets varying every interacting axis and fixing the rest;
4. author-published fixtures for conformance versus study data for inference;
5. a binding-independent pre-clean day set `D_i` frozen from study window/raw availability before
   outcomes; covered no-episode days are zero, refusals are not; participants with no paired days
   follow a predeclared input rule;
6. primary `theta_b = median_i mean_(d in D_i) |Y_i,d,b - Y_i,d,0|` and global
   `Theta = max_b theta_b`, with participant-clustered 95% intervals, simultaneous coverage for
   binding-specific estimates, and signal strata never pooled;
7. materiality only when the lower interval bound for `Theta` exceeds predeclared `delta`,
   equivalence only when the upper bound is below it, and otherwise an inconclusive result;
8. episode/session/day/participant outcomes, absolute agreement, ranks, dispersion, identifiable
   variance contrasts, residual error, and heterogeneity;
9. cleaning-induced eligibility and downstream decision changes as separate endpoints;
10. failure/refusal analysis, performance, and reproducibility, with every behaviorally distinct
    strategy represented unless an equivalence proof exists.

Results remain placeholders until the exact canonical set `GATE-H02-COMPLETE-BINDINGS`,
`GATE-H02-CONFORMANCE`, `GATE-H02-PREREGISTRATION`, `GATE-H02-DATA-AUTHORITY`, and
`GATE-H02-EXECUTION` passes:

- `[PLACEHOLDER: episode divergence]`
- `[PLACEHOLDER: session divergence]`
- `[PLACEHOLDER: daily and participant dispersion]`
- `[PLACEHOLDER: agreement and rank stability]`
- `[PLACEHOLDER: variance decomposition]`

### Chapter 9 — Cleaning as a separate source of uncertainty

**`claim:H02_BINDING_DISAGREEMENT` subanalysis (not a separate claim ID):** later cleaning may
change daily and participant results independently of episode reconstruction; this must be tested
through separately addressable branches rather than inferred from the baseline quality-policy
label.

Content:

1. baseline truth: `IntervalQualityPolicy::None` still permits Chronicle's default
   blank/remove/drop cleaning, and the current workflow cleans before aggregation;
2. target truth: expose a pre-clean row checkpoint, fork cleaned and pre-clean outputs, aggregate
   both branches with distinct IDs/digests, and move quality/cleaning controls out of Session
   Detection into a dedicated Cleaning surface;
3. day and participant inclusion, active-day denominators, and minimum active days;
4. implausible daily totals and unexplained gaps;
5. distributional exclusions, winsorization, and median/MAD alternatives;
6. isolation forest only if scientifically justified and deterministically reproducible;
7. cleaning-induced eligibility as a separate endpoint on the frozen input-defined day support;
8. identifiable reconstruction-versus-cleaning contrasts with aliased terms reported;
9. transparent binding expansion without silent cleaning.

Deliverable: separately addressable pre-clean and cleaned row/aggregate outputs plus
`[PLACEHOLDER: cleaning dispersion after the H02 gates pass]`.

### Chapter 10 — Consequences for child screen-time conclusions

**Chapter rule:** the downstream part of `claim:H02_BINDING_DISAGREEMENT` is a separate
preregistered endpoint in estimands child screen-time research actually reports; it is not inferred
from raw minute differences or substituted for the primary materiality rule.

Content:

1. preregistered substantive outcomes and target reported effects;
2. commensurate comparison scale and uncertainty;
3. associations, intervention contrasts, prevalence/cutoff classifications, and app/category
   conclusions;
4. shared-device and attribution sensitivity;
5. direction, magnitude, uncertainty, and decision stability;
6. limits of causal interpretation and external validity.

Result: `[PLACEHOLDER: downstream conclusion sensitivity on authorized real data after
GATE-H02-COMPLETE-BINDINGS, GATE-H02-CONFORMANCE, GATE-H02-PREREGISTRATION,
GATE-H02-DATA-AUTHORITY, and GATE-H02-EXECUTION]`.

### Chapter 11 — Conditional study: recovering placement from hourly vendor bars

**Disposition:** `claim:C04_HOURLY_PLACEMENT` remains
`EXTERNAL_REPORT / UNVALIDATED / EXTERNALLY_REPORTED_NOT_REPRODUCED` unless its four exact gates
pass.

Content:

1. observation model and exact-total constraint;
2. placement algorithms and ground-truth comparison;
3. minute displacement and downstream-statistic preservation;
4. why lambda at 60 minutes is structural;
5. generalization limits and platform/version dependence.

Disposition gate: include as an evidentiary chapter only after `GATE-C04-ARCHIVE`,
`GATE-C04-INDEPENDENT-RERUN`, `GATE-C04-ESTIMANDS`, and `GATE-C04-VALIDATION`; otherwise move it to
future work.

### Chapter 12 — Conditional study: Android vendor-aggregate calibration

**Disposition:** `claim:C05_VENDOR_CALIBRATION` remains `PLANNED / UNVALIDATED / NO_DATA` unless
its five exact gates pass. Raw UsageEvents bindings are constructed comparisons, not ground truth.

Content:

1. Digital Wellbeing acquisition and OCR validation;
2. same-device raw UsageEvents and complete bindings;
3. time, package/category, and day alignment;
4. vendor-versus-binding agreement and version effects;
5. what the Android result can and cannot imply for iOS.

Disposition gate: no-data means design chapter or future work, never a result. Promotion requires
`GATE-C05-AUTHORITY`, `GATE-C05-ACQUISITION`, `GATE-C05-BINDINGS`,
`GATE-C05-PREREGISTRATION`, and `GATE-C05-DATA`.

### Chapter 13 — Reporting standard and general framework

**Proposed contribution:** processing uncertainty may be made more auditable through a compact,
access-aware disclosure, evidence-vector, sensitivity, and provenance profile. Its usability and
transfer to other passive-sensing domains remain validation questions.

Content:

1. minimum reporting checklist;
2. classifiability and meta-analysis implications only after the
   `claim:H01A_DISCLOSURE_INSTRUMENT` gates;
3. method receipts and machine-readable provenance;
4. minimum sensitivity analysis for absolute and relative claims;
5. orthogonal criteria for signal relation, completeness, execution, source review, component
   validation, reference replay, independent conformance, triangulation, and parameter provenance;
6. application to other passive-sensing domains without claiming identical semantics.

Deliverable: human-readable checklist plus machine-readable profile.

### Chapter 14 — Synthesis and conclusion

1. answer each research question and revisit each falsifier;
2. separate conceptual, implementation, literature, and empirical contributions;
3. state which claims were supported, narrowed, refused, or left open;
4. implications for child screen-time research, passive sensing, and evidence synthesis;
5. residual platform, data, conformance, and generalization limits.

## 4. Evidence program and chapter gates

### Canonical claim-ledger gates

| Claim ID | Chapters | Exact gate IDs |
| --- | --- | --- |
| `claim:C01_LEGACY_MISSING_END` | historical note only | `GATE-C01-LEGACY-NO-REVIVAL` |
| `claim:H01_VECTOR_STRUCTURE` | 5, 14 | `GATE-H01-FREEZE`; `GATE-H01-SOURCE-MAP`; `GATE-H01-COUNTEREXAMPLES`; `GATE-H01-PRIOR-ART` |
| `claim:H01A_DISCLOSURE_INSTRUMENT` | 3, 5, 13 | `GATE-H01A-RUBRIC`; `GATE-H01A-INDEPENDENT-SCORING`; `GATE-H01A-ADJUDICATION`; `GATE-H01A-RECONCILIATION` |
| `claim:C01B_PARAMETER_PROVENANCE` | 3, 5, 7 | `GATE-C01B-SOURCE-LEDGER`; `GATE-C01B-BOUNDARIES`; `GATE-C01B-BINDING` |
| `claim:H02_BINDING_DISAGREEMENT` | 8–10, 14 | `GATE-H02-COMPLETE-BINDINGS`; `GATE-H02-CONFORMANCE`; `GATE-H02-PREREGISTRATION`; `GATE-H02-DATA-AUTHORITY`; `GATE-H02-EXECUTION` |
| `claim:C03_CAPABILITY_DEFINABILITY` | 4, 14 | `GATE-C03-MATRIX`; `GATE-C03-PLATFORM-SOURCES`; `GATE-C03-COUNTEREXAMPLES` |
| `claim:C04_HOURLY_PLACEMENT` | 11 | `GATE-C04-ARCHIVE`; `GATE-C04-INDEPENDENT-RERUN`; `GATE-C04-ESTIMANDS`; `GATE-C04-VALIDATION` |
| `claim:C05_VENDOR_CALIBRATION` | 12 | `GATE-C05-AUTHORITY`; `GATE-C05-ACQUISITION`; `GATE-C05-BINDINGS`; `GATE-C05-PREREGISTRATION`; `GATE-C05-DATA` |

### Operational prerequisites (not claim-ledger gate IDs)

| Prerequisite | Chapters | Required proof and current status |
| --- | --- | --- |
| Namespaced delivery axes | 5–9 | `delivery:B01` remains source-unverified. `delivery:B02` historical bytes remain absent after documented recovery; a separately provenance-labeled fresh implementation is accepted on the private feature branch with PR, merge, deploy, canary, compatible-host WebKit, and commit-aware gates still pending. `delivery:B03`–`delivery:B12` and `delivery:B14` are pending; `delivery:B13` is conditional/refused without public or synthetic signal evidence. Each implemented axis needs contract/runtime/UI/persistence/export proof. |
| EYES reportability | 7–10 | ACTIVE-only adaptation, full tagged-output divergence, correct fragment reasons, concurrency non-equivalence, fixed parameters, deliberate defect corrections, and independent comparison all explicit; pending. |
| Cleaning isolation | 6, 9, 10 | Pre-clean row checkpoint, separately aggregated branches, lineage, dedicated UI, and dispersion analysis; pending. |
| Private-preview artifact verification | 6–10, 13 | Enable and verify branch protection first; exact PR-merged `main` source then passes the bounded full local gate, deploys only to private-preview Pages, and has source/artifact provenance plus public/synthetic import → process → view → export and production canary evidence; pending. Direct pushes remain prohibited by campaign policy. This never authorizes touching the intentionally outdated public repository. |

## 5. Planned thesis products

1. Measurement-theory/ontology paper following [`paper-outline.md`](./paper-outline.md).
2. Versioned mobile event-to-measure ontology plus provisional component/disclosure rubric.
3. Published-method binding library and refusal ledger, with certification withheld until
   independent conformance passes.
4. Offline browser artifact for import, reconstruction, comparison, cleaning, visualization, and
   export.
5. Real-data reconstruction/cleaning multiverse and downstream sensitivity analysis.
6. Reporting standard and machine-readable method receipt.
7. Conditional hourly-placement and vendor-calibration studies only if their evidence gates pass.

## 6. Evidence and result hygiene

- Use the consolidated corpus as the source-of-record index; use search slices for quotations and
  per-source details.
- Keep literature evidence, software capability, conformance evidence, synthetic verification,
  and real-data results in visibly different ledgers.
- Keep defect logs out of scientific Results; retain them in engineering provenance so invalid
  values cannot be recycled.
- Distinguish independent published methods, derivative adaptations, implementation strategies,
  and controlled component perturbations.
- State exact code, schema, data, browser, runtime, platform, and deployment revisions.
- Report access, disclosure, signal relation, completeness, execution, source review, validation,
  reference replay, independent conformance, triangulation, and parameter provenance separately.
- Do not fill any result placeholder until its named gate has passed.

## 7. Appendices

1. Full literature search, access, deduplication, and quotation-verification ledgers.
2. Disclosure rubric and per-paper component classifications.
3. LinkML ontology, measurement-component rubric, namespaced `delivery:B01`–`delivery:B14` ledger,
   and all method-binding manifests.
4. Parameter-provenance and boundary-inclusivity ledger.
5. Reference fixtures, conformance outputs, dependency evidence, and generated-artifact digests.
6. Full statistical analysis plan, diagnostics, and sensitivity results.
7. Data governance, restricted-data access, and reproducibility instructions.
8. Engineering defect history explicitly excluded from scientific results.

## 8. Source hierarchy

1. Primary papers, author artifacts, and independently inspected reference implementations govern
   published-method semantics; every use carries a locator and conformance status.
2. [`claim-ledger.yaml`](./claim-ledger.yaml),
   [`measurement-component-rubric.yaml`](./measurement-component-rubric.yaml), and
   [`delivery-axis-ledger.yaml`](./delivery-axis-ledger.yaml) govern stable project IDs and mutable
   statuses at their named versions, not scientific truth.
3. The
   [`research ontology schema`](../../web/schema/chronicle-research-ontology.linkml.yaml) governs
   entity terminology; the [`workflow schema`](../../web/schema/chronicle-workflow.yaml), source,
   and tests govern implementation capability and order.
4. [`consolidated-literature/README.md`](./consolidated-literature/README.md) and
   [`master-review.md`](./consolidated-literature/master-review.md) govern corpus-level synthesis;
   [`census-reconciliation.md`](./citation-chase/census-reconciliation.md) governs the current
   reconciled preliminary counts.
5. [`../handoff-2026-08-11.md`](../handoff-2026-08-11.md) governs campaign control state and private-
   preview boundaries. Deployment records alone govern what shipped.
6. This outline plans chapters and open gates. It is not corrective evidence for itself.
