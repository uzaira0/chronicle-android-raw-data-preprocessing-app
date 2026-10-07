# Constructing Screen Time: From Typed Android Events to Cross-Platform Measures

**Detailed manuscript outline**

**Status:** Milestone-zero authoring plan, 2026-08-11. The headline empirical analyses have not
been run. Empty Results fields are deliberate and must not be replaced with synthetic magnitudes.

**Paper type:** Measurement methods and empirical validation, not a software paper.

**Primary reader artifact:** `output/doc/constructing-screen-time-paper-outline.docx`

> **Authoring control.** This outline organizes the manuscript but does not authorize scientific
> claims. Canonical claim statements and gates live in
> [`claim-ledger.yaml`](./claim-ledger.yaml); scientific component definitions live in
> [`measurement-component-rubric.yaml`](./measurement-component-rubric.yaml); and implementation
> delivery status lives in [`delivery-axis-ledger.yaml`](./delivery-axis-ledger.yaml). Primary
> sources, independently inspected code and data, and executed analyses govern what can enter the
> submitted paper.

## Abstract

**Target length:** 250-300 words. Use a conventional Background, Objective, Methods, Results,
Conclusion sequence without visible subheadings unless the target journal requires them.

### Background

- Smartphone use is often described as objectively measured, but event logs, vendor summaries,
  and screenshots expose different signals and already encode different definitions of use.
- Typed Android events do not become app episodes, device sessions, daily totals, or participant
  summaries until analysts choose event, pairing, grouping, time, denominator, and cleaning rules.
- iOS Screen Time screenshots expose rendered hourly summaries whose upstream aggregation rule is
  not auditable from the screenshot. This creates both a comparability problem and a temporal
  resolution problem.

### Objective

- Formalize the complete event-to-summary decision vector.
- determine which components published methods disclose;
- execute scientifically admissible Android bindings on common data;
- test how one-hour observation changes recoverable temporal information; and
- evaluate whether measurement choices alter descriptive and substantive conclusions.

### Methods

- Study 1: fixed literature census plus expanded discovery corpus, coded with an access-aware
  21-component rubric.
- Study 2: source-reviewed Android method bindings executed on the same authorized event streams,
  with explicit conformance, refusal, and provenance.
- Study 3: iOS Screen Time screenshot extraction and quality control, paired with an Android
  coarsening experiment that converts fine-resolution event-derived occupancy to hourly totals and
  evaluates recovery at 1, 5, 10, 15, 30, and 60 minutes.
- Study 4: downstream sensitivity of associations, classifications, and conclusions.

### Results

`[LOCKED: report no magnitude until the relevant claim-ledger gates pass. The 60-minute
mass-conservation equality is a mathematical identity, not an empirical accuracy result.]`

### Conclusion

`[CONDITIONAL: state only what the completed disclosure, conformance, Android multiverse,
screenshot-validation, resolution, and downstream analyses support.]`

## 1. Introduction

### 1.1 Screen time is a constructed measure

- Open with the distinction between observing a platform event and asserting continuous app or
  device use.
- Explain the path from typed occurrences to event records, app episodes, device-use sessions,
  grouped app sessions, day-level totals, and cleaned participant summaries.
- Show why an algorithm name alone does not identify a measure: numeric thresholds, boundary
  inclusivity, package policy, time zone, missing-event behavior, and cleaning are part of the
  binding.
- Motivate the substantive stakes with child and family screen-time research, where minutes,
  temporal patterning, cutoffs, and associations can support different conclusions.

### 1.2 Android and iOS expose different measurement problems

- Android `UsageEvents` can expose typed, timestamped events that permit alternative auditable
  reconstructions.
- Android Digital Wellbeing and iOS Screen Time expose vendor-computed summaries with hidden
  upstream decisions.
- iOS Screen Time screenshot workflows commonly yield hourly bars and daily summaries, not the raw
  event stream from which those bars were computed.
- Therefore, cross-platform pooling can combine different observation models even when both
  columns are labelled screen time.
- Screenshots add a second measurement layer: capture compliance, page selection, cropping, OCR or
  human transcription, hour alignment, category mapping, and platform-version drift.

### 1.3 Prior work and the unresolved gap

- Review self-report versus device-derived measures without treating device-derived values as
  interpretation-free ground truth.
- Review published Android event-reconstruction methods, device-session rules, grouping rules,
  cleaning rules, and downstream multiverse analyses.
- Review iOS Screen Time donation, screenshot, forensic, and DeviceActivity routes, distinguishing
  rendered summaries from event-level stores and privacy-constrained APIs.
- Review temporal coarsening and disaggregation validation in adjacent fields. The validation
  design - coarsen fine observations, reconstruct, and compare with retained fine observations - is
  established and must not be claimed as novel.
- State the remaining contribution narrowly: an integrated, typed event-to-summary decision model;
  complete executable bindings; explicit failures and conformance; a same-stream Android
  comparison; and an explicit bridge to screenshot-derived one-hour observations.

### 1.4 Research questions

1. **RQ1 - Decision structure.** Which decisions must be settled before typed Android events become
   app episodes, device-use sessions, grouped sessions, daily totals, and cleaned participant
   summaries?
2. **RQ2 - Disclosure and reproducibility.** Which decision components are declared, delegated,
   absent, not applicable, or undetermined in the fixed literature census and expanded corpus,
   conditional on source access?
3. **RQ3 - Complete-binding disagreement.** How much do source-faithful, scientifically admissible
   Android bindings disagree at episode, session, day, participant, and downstream-analysis levels?
4. **RQ4 - One-hour resolution reliability.** When fine-resolution Android event data are
   deliberately coarsened to hourly totals that mimic the temporal resolution available from iOS
   Screen Time screenshots, how well can within-hour placement and downstream temporal structure be
   recovered at 1, 5, 10, 15, 30, and 60 minutes?
5. **RQ5 - Cross-platform comparability.** After independently validating screenshot extraction and
   harmonizing time windows, what can and cannot be compared between iOS Screen Time screenshot
   outputs, Android vendor summaries, and Android event-derived bindings at common hourly and daily
   resolutions?
6. **RQ6 - Substantive sensitivity.** Do scientifically admissible bindings or observation
   resolutions change participant ranks, agreement statistics, model estimates, classifications,
   or substantive conclusions on authorized real study data?
7. **RQ7 - Reporting standard.** What minimum reporting checklist would make future passive-sensing
   measures classifiable, reproducible, and appropriately qualified by instrument capability?

### 1.5 Hypotheses and planned contributions

- `claim:H01_VECTOR_STRUCTURE` is an unvalidated hypothesis that the scoped event-to-cleaned-summary
  methods can be represented as a complete decision vector.
- `claim:H01A_DISCLOSURE_INSTRUMENT` is a proposed, unvalidated literature-scoring instrument.
- `claim:H02_BINDING_DISAGREEMENT` is the unrun empirical hypothesis that admissible complete
  bindings can materially change results on the same authorized stream.
- `claim:C04_HOURLY_PLACEMENT` is the conditional resolution study. Externally reported results are
  not manuscript evidence until archived and independently reproduced.
- `claim:C05_VENDOR_CALIBRATION` is a planned same-device Android vendor-summary study with no data;
  it could distinguish vendor-versus-binding disagreement from within-binding coarsening and
  placement loss, conditional on the chosen Android binding.
- The paper will contribute only the subset that passes its source, rubric, conformance, data,
  execution, and validation gates.

### Table 1. Study aims, evidence streams, and present status

| Module | Primary question | Evidence stream | Main output | Present status |
| --- | --- | --- | --- | --- |
| Study 1: decision and disclosure model | RQ1-RQ2 | Fixed 51-reference census plus expanded discovery corpus | Component rubric, coverage and disclosure estimates | Rubric proposed; preliminary counts not independently verified |
| Study 2: Android binding multiverse | RQ3 and part of RQ6 | Authorized Android event streams plus source/reference fixtures | Episode-to-participant disagreement and conformance | Runtime branches exist; headline real-data run unperformed |
| Study 3A: iOS screenshot extraction | RQ5 | Versioned iOS Screen Time screenshots plus human reference coding | Extraction error, missingness, and usable hourly outputs | Conditional; acquisition and validation gates open |
| Study 3B: one-hour coarsening and recovery | RQ4 | Fine Android event-derived occupancy coarsened to hourly totals | Resolution-specific displacement, error, reliability, and structural-statistic recovery | Externally reported analysis not independently reproduced |
| Study 3C: common-resolution comparison | RQ5 | Validated iOS screenshot outputs, Android vendor summaries where available, and Android bindings | Hourly/daily agreement and non-equivalence characterization | Conditional; no claim of ground truth |
| Study 4: substantive sensitivity | RQ6 | Authorized study outcomes joined to preregistered measurement outputs | Model, classification, and conclusion sensitivity | Unrun |

## 2. Methods

### 2.1 Overall design

- Use four linked studies rather than one undifferentiated multiverse.
- Keep literature evidence, source-conformance evidence, real-study inference, and synthetic defect
  fixtures in separate roles.
- Freeze research questions, admissible bindings, resolution estimands, common time support, and
  materiality thresholds before inspecting outcome differences.
- Never convert a refused or unavailable binding into a zero outcome.
- Keep source-faithful whole-method contrasts separate from controlled one-component contrasts.

### 2.2 Instruments, observable signals, and inferential roles

#### Table 2. Instrument and output comparison

| Instrument or output | What is directly observed | Temporal detail available to this study | Hidden or delegated decisions | Permitted role |
| --- | --- | --- | --- | --- |
| Android `UsageEvents` | Typed, timestamped platform event records | Event timestamps; derived occupancy at the executable pipeline's precision | Logging coverage, OEM behavior, retained vocabulary, and every reconstruction choice | Primary executable reconstruction case; reference for the coarsening experiment, not universal ground truth |
| Android Digital Wellbeing screenshot | Rendered vendor summary | Displayed hourly and daily summaries where captured | Vendor usage predicate, aggregation, category mapping, and rendering | Planned same-device calibration; no data currently held |
| iOS Screen Time screenshot | Rendered Screen Time bars and summaries | Displayed hourly bars and daily totals where captured and legible | Apple's usage predicate, sessionization, aggregation, cross-device behavior, rounding, and rendering | Real coarse observation after capture/OCR validation; never raw truth |
| iOS DeviceActivity aggregate, where authorized | Privacy-constrained vendor activity aggregates | Hourly is the finest documented aggregate in the current evidence snapshot | Apple's upstream builder, regional/entitlement access, version support, and first-party surface differences | Optional screenshot-surface agreement study; still not raw event truth |
| iOS forensic or `App.InFocus`-type record | Vendor-derived per-app records where legally and technically accessible | Record-level timestamps depend on platform version and extraction route | Apple's in-focus predicate, retention, device-specific semantics, schema migration, and unmatched-event handling | Capability and sensitivity evidence only unless independently validated for the target version |
| Research-app event stream | Collector-defined events | Collector cadence and vocabulary | Collector implementation, permissions, duty cycle, and upstream filtering | Source-specific method input; never silently equated with `UsageEvents` |

### 2.3 Units and event-to-measure process

- Preserve the distinction among `PlatformEventOccurrence`, `UsageEventRecord`,
  `UsageEpisodeAssertion`, and the `UsageInterval` it denotes.
- Model device-state blocks separately from device-use sessions, glances, pickups, and grouped
  app-usage sessions.
- Expose a pre-clean reconstructed checkpoint, then fork pre-clean and each declared cleaning branch
  before aggregation.
- Define day and participant summaries with explicit time zone, day boundary, denominator,
  coverage, inclusion, and missingness rules.

#### Figure 1. Event-to-summary decision graph

```text
platform occurrence -> usage-event record -> event selection -> episode reconstruction
device-state blocks -------------------------------------------> bounds or credits episode
episode assertion -> grouped app session -> pre-clean rows ----> pre-clean aggregates
                                          `-> cleaning branch --> cleaned aggregates
all branches -> day assignment -> participant summary -> downstream analysis
```

### 2.4 Complete decision vector and 21-component rubric

- Generate the complete Table 3 definitions from `measurement-component-rubric.yaml` version 0.2.0
  rather than paraphrasing a second authority in prose.
- The vector spans instrument and acquisition semantics, event selection, episode reconstruction,
  device and grouped-session construction, temporal assignment, aggregation and denominators,
  cleaning, and parameter provenance.
- Treat all numeric thresholds and boundary operators as typed method arguments with units,
  inclusivity, source, fitting context, and inheritance.
- Audit counterexamples: if a scoped method requires a component outside the frozen rubric, update
  the rubric before empirical analysis rather than forcing the method into an incomplete vector.

#### Table 3. Event-to-measure component rubric

| Component ID | Canonical component | Decision recorded | Unit or vocabulary | Parameter provenance |
| --- | --- | --- | --- | --- |
| `[generated]` | `[generated from rubric]` | `[generated definition]` | `[as applicable]` | Author-set, inherited, cited, data-derived, engineering constant, repository default, or unresolved |

### 2.5 Literature census and expanded discovery corpus

- Fixed sampling frame: all 51 references in Winklbauer and Batinic, fixed before screening. This
  is a bibliography census, not a probability sample of the field.
- Expanded corpus: prespecified search slices, stable identifiers, deduplication, source-of-record
  rules, and direct-versus-transfer evidence.
- Record source access as full text, abstract/metadata, or unavailable.
- Code component disclosure as `DECLARED`, `DELEGATED`, `ABSENT`, `N/A`, or `UNDET`. Material not
  read in full is `UNDET`, never silently `ABSENT`.
- Independently verify load-bearing quotations, duplicate-code a prespecified sample, adjudicate
  disagreements, and report component-level reliability with access-conditioned denominators.
- Keep app-level and device-level denominators separate.

### 2.6 Executable Android bindings

- Define a published method as a complete, versioned binding vector, not a reconstruction-strategy
  label.
- Resolve the binding through schema, browser configuration, Rust/WASM request, execution,
  provenance, export, and independent conformance evidence.
- Retain explicit refusal when the required signal or compatible component combination is absent.
- Require default-byte compatibility, source-derived fixtures, boundary and failure fixtures,
  sequential versus incremental parity, persisted-cache identity, and end-to-end replay.
- Separate reconstruction from interval cleaning and from later aggregation.
- Treat current source-derived gaps honestly: source-unverified retention lists, partial EYES replay,
  contributor-derived Parry-Toth/Culverhouse lineage, and delivery axes not yet independently
  implemented.

#### Table 4. Complete binding evidence and conformance matrix

| Binding ID | Source lineage and required signal | Completeness and execution | Source/component validation | Reference and independent replay | Included outputs or refusal |
| --- | --- | --- | --- | --- | --- |
| `[binding]` | `[source, version, signal stratum]` | `[complete, partial, refused]` | `[source review and component oracle]` | `[reference replay and independent end-to-end conformance]` | `[outputs, exclusions, reason code]` |

### 2.7 Admissibility, identifiability, and preregistration

- Freeze an exhaustive registry of all candidate cells before outcome inspection.
- For each cell, record target construct, applicable output, required signal, signal-relation
  stratum, complete binding, source lineage, compatibility, and inclusion/exclusion/refusal reason.
- Estimate whole-binding differences without attributing them to individual components.
- Estimate a component main effect only where one compatible axis changes and all other components
  remain fixed.
- Estimate an interaction only in a full-rank crossed subset that varies every interacting axis.
- Check the design matrix separately for each output; report aliases and structurally absent axes as
  unidentifiable rather than estimating them implicitly.

### 2.8 Data sources, ethics, and common support

- Authorized real Android study data provide the headline binding and downstream analyses.
- iOS screenshots require explicit data authority, privacy protection, capture instructions, and a
  versioned platform/device record.
- Public or author-provided fixtures establish conformance, not population inference.
- Synthetic fixtures establish invariants and failure behavior, not scientific effect magnitude.
- Freeze each participant's binding-independent paired-day set using study window, raw-input
  availability, and participant criteria that never inspect a binding output.
- Preserve observed zero-use days as zero when the binding executed successfully; keep execution
  refusal, missing input, unreadable screenshot, and excluded output as distinct states.

### 2.9 Study 2: Android complete-binding comparison

#### 2.9.1 Experimental arms

- Include only source-faithful bindings and prespecified controlled perturbations that pass the
  admissibility and conformance gates.
- Enumerate held-fixed, varied, bundled, structurally unavailable, and refused axes.
- Run the same authorized event stream through every executable arm.

#### 2.9.2 Outcomes

- Episode: start, end, duration, close reason, censoring, split, merge, and repair.
- Session: count, duration, fragmentation, gap structure, pickups, and device-active time.
- Day: app-active minutes, device-active minutes, category/app distribution, timing, and coverage.
- Participant: central tendency, dispersion, active-day denominator, and inclusion.
- Cleaning: pre-clean versus each separately aggregated cleaning branch.
- Downstream: coefficient, uncertainty, direction, ranking, classification, and decision.

#### 2.9.3 Primary disagreement estimand

- Let `Y_i,d,b` be pre-clean daily app-active minutes for participant `i`, paired day `d`, and
  binding `b`.
- For each preregistered binding `b` versus baseline `0`, define
  `theta_b = median_i mean_d |Y_i,d,b - Y_i,d,0|` on the frozen paired-day support.
- Define `Theta = max_b theta_b` over the frozen primary binding family.
- Use participant-clustered resampling and simultaneous intervals for the binding family.
- Set a smallest consequential difference `delta` before outcome inspection. Declare materiality
  only when the lower interval bound for `Theta` exceeds `delta`; declare practical equivalence only
  when the upper bound is below it; otherwise report an inconclusive result.

### 2.10 Study 3A: iOS Screen Time screenshot extraction and validation

- No iOS screenshot/OCR ingestion, hourly Screen Time import, or inverse-placement implementation
  currently exists in this repository. This section is an explicit build-and-validation protocol,
  not a description of implemented capability or collected evidence.

#### 2.10.1 Acquisition protocol

- Record iOS version, device model/class, locale, time zone, 12/24-hour clock, date, screenshot page,
  selected day/week, and whether Share Across Devices is enabled.
- Prespecify capture timing, required views, image resolution, duplicate handling, resubmission,
  and missing-page rules.
- Preserve the original screenshot, immutable digest, crop coordinates, extraction version, and
  human adjudication record.

#### 2.10.2 OCR and human-reference validation

- Build a stratified validation set across device sizes, light/dark modes, locales, hour labels,
  low-use bars, overlapping labels, and platform versions.
- Double-code the validation set without using OCR output as the reference.
- Score hour-bar detection, bar height or value extraction, text recognition, daily-total
  extraction, category/app label mapping, date/window recognition, and missingness classification.
- Report exact agreement, absolute and relative error, missed/extra cells, adjudication rate, and
  uncertainty. Do not rely on correlation alone.
- Define fail-closed thresholds for an unreadable screenshot or an unsupported platform layout.

#### Table 5. Screenshot extraction validation plan

| Extracted element | Independent reference | Primary metric | Acceptance rule | Failure disposition |
| --- | --- | --- | --- | --- |
| Hourly bar/cell presence | Double human annotation | Sensitivity, precision, missed/extra cells | `[preregister]` | Exclude cell or screenshot with explicit reason |
| Hourly minutes/value | Human transcription or validated geometric reference | MAE, median absolute error, exact agreement | `[preregister]` | Retain uncertainty or refuse numeric use |
| Daily total | Double human transcription | Absolute and relative error | `[preregister]` | Refuse daily comparison |
| App/category label | Adjudicated label set | Exact and hierarchical agreement | `[preregister]` | Map to explicit unknown/unmatched class |
| Date, time zone, and window | Metadata plus human check | Exact agreement | `100% for analytic inclusion` | Exclude or recapture |
| Platform layout/version | Recorded device metadata | Supported-layout coverage | `Supported and versioned` | Typed unsupported-layout refusal |

### 2.11 Study 3B: one-hour coarsening and resolution-recovery experiment

#### 2.11.1 Purpose

- Reproduce the temporal information loss imposed when a fine event-derived series is observed only
  as hourly mass, the practical resolution available from Screen Time screenshot bars.
- Call this a **coarsening experiment**, not a simulation of human behavior. The observed Android
  event stream remains fixed; only its temporal resolution is reduced.
- Use Android event-derived occupancy as retained fine-resolution reference for this experiment,
  while stating that it is not universal behavioral ground truth and still depends on its complete
  binding.

#### 2.11.2 Procedure

1. Construct fine-resolution reference occupancy `T` from each admissible Android binding.
2. Sum `T` within clock-hour bins to create hourly observations `H`.
3. Apply each prespecified placement method to `H` to obtain reconstructed within-hour occupancy
   `P` while preserving each hourly total exactly.
4. Aggregate `T` and `P` separately to 1, 5, 10, 15, 30, and 60-minute bins.
5. Compare `P` with retained `T` at every resolution and for downstream temporal summaries.
6. Repeat across participants, days, usage intensities, boundary-crossing patterns, and admissible
   Android bindings.

#### 2.11.3 Placement methods

- Include the externally reported TECH/GNSM procedure only after its code, inputs, outputs, and
  environment are archived and independently reproduced.
- Prespecify simpler reference placements such as beginning-loaded, uniform, midpoint, or
  boundary-aware methods only where their definitions and feasibility constraints are exact.
- Keep method-ranking resolution checks separate from reliability estimation.

#### 2.11.4 Resolution-specific estimands

- Per-bin MAE and RMSE.
- Mass-weighted absolute temporal displacement and signed displacement.
- Reliability or signal-fraction statistic `lambda(Delta)` with its exact definition.
- Recovery of total mass, active-bin count, bout count and duration, autocorrelation, entropy,
  time-of-day profile, peak timing, and prespecified downstream statistics.
- Participant/day heterogeneity and participant-clustered uncertainty.

#### 2.11.5 The 60-minute identity

- Because every placement method is constrained to preserve the input hourly total,
  `P_60 = T_60` by construction when bins and clocks align.
- Therefore `lambda(60) = 1`, zero 60-minute mass error, or perfect hour-level agreement is a
  structural identity. It is not evidence that the placement method reconstructs within-hour use,
  matches Apple's hidden aggregation rule, or validates the underlying Android binding.
- The empirical questions begin below 60 minutes and in structural or downstream statistics that
  the exact-total constraint does not force to agree.

#### Table 6. Resolution-recovery analysis shell

| Resolution | Forced agreement from hourly mass? | Primary empirical quantities | Secondary structure | Manuscript interpretation |
| --- | --- | --- | --- | --- |
| 1 minute | No | Displacement, MAE/RMSE, `lambda(1)` | Bouts, peak timing, entropy | Fine-grained recovery; estimate and validate |
| 5 minutes | No | Displacement, MAE/RMSE, `lambda(5)` | Bouts, ACF, timing | Estimate and validate |
| 10 minutes | No | Displacement, MAE/RMSE, `lambda(10)` | Bouts, ACF, timing | Estimate and validate |
| 15 minutes | No | Displacement, MAE/RMSE, `lambda(15)` | Time-of-day and downstream summaries | Estimate and validate |
| 30 minutes | No | Displacement, MAE/RMSE, `lambda(30)` | Time-of-day and downstream summaries | Estimate and validate |
| 60 minutes | Yes, if bins align | Identity check only | Statistics not forced by total mass | Report as structural identity, never empirical validation |

#### Figure 2. Coarsening and recovery design

```text
fine Android events
  -> complete binding
  -> fine occupancy T
       |-> retain T at Delta
       `-> exact hourly totals H
            -> placement method
            -> P at Delta

compare T and P at 1/5/10/15/30/60 minutes

iOS screenshot
  -> validated extraction
  -> observed hourly totals
  -> conditional placement outputs

no unobserved iOS event truth is implied
```

### 2.12 Study 3C: common-resolution Android and iOS comparison

- Compare only outputs that refer to a compatible construct, clock window, device scope, and unit.
- Use validated iOS screenshot-derived hourly and daily outputs as observations, not criterion truth.
- Produce Android comparison series by aggregating each admissible event-derived binding to the same
  hour/day boundaries and, where collected, by independently extracting Digital Wellbeing
  screenshots.
- Harmonize time zone, daylight-saving transitions, cross-midnight use, partial first/last days,
  app/category vocabulary, Share Across Devices, and missing screenshot cells.
- If no paired or otherwise justified design exists, limit cross-platform results to measurement
  characterization and distributional comparison rather than causal or individual-level agreement.
- Never use successful recovery on Android-coarsened data to assert that Apple's hidden raw-to-bar
  transformation is correct or equivalent.

#### Table 7. Common-resolution comparison plan

| Comparison | Common unit and support | Primary statistic | Required validation | Permitted inference |
| --- | --- | --- | --- | --- |
| Android binding vs Android binding | Same participant-day/hour and raw stream | Absolute difference, agreement, rank change | Complete binding conformance | Binding sensitivity on Android |
| Android event-derived vs Digital Wellbeing | Same device, hour/day, and version | Paired difference and agreement | Screenshot/OCR validation plus paired collection | Vendor-versus-explicit binding characterization; neither is ground truth |
| iOS Screen Time screenshot vs harmonized Android output | Common displayed hour/day and construct where justified | Distributional difference, rank/agreement only in a paired design | iOS extraction validation, window and construct harmonization | Cross-platform comparability limits, not platform truth ranking |
| Reconstructed sub-hour iOS series vs observed iOS hourly mass | Within screenshot hour | Exact mass preservation plus sensitivity across placements | Valid screenshot extraction | Conditional temporal allocation only; no direct sub-hour accuracy claim |

### 2.13 Study 4: downstream model and conclusion sensitivity

- Preregister the substantive outcomes, covariates, estimands, models, and decision thresholds before
  joining them to measurement outputs.
- Refit the same analysis under every admissible binding and, where scientifically justified, every
  supported temporal resolution.
- Report coefficient magnitude, interval, direction, participant rank, classification, threshold
  crossing, and substantive conclusion.
- Keep downstream decision change separate from the primary measurement-disagreement estimand.
- Do not infer causal sensitivity from a model that was not causally identified in the source study.

### 2.14 Robustness, missingness, and sensitivity analyses

- Logging gaps, unsupported event labels, unmatched open/close events, device restarts, clock changes,
  time zones, daylight-saving transitions, query-window censoring, and cross-midnight episodes.
- Shared devices, person attribution, app/package exclusions, background or media activity, and
  observation reactivity.
- Screenshot nonresponse, duplicate or partial screenshots, unreadable bars, OCR uncertainty,
  cross-device aggregation, and platform-layout changes.
- Coarsening bin alignment, alternative feasible placements, participant/day heterogeneity, and
  resolution-specific use cases.
- Cleaning-induced day and participant eligibility analyzed on the same frozen input-defined
  support.

### 2.15 Reproducibility and artifact provenance

- Record exact source revision, configuration, complete binding, input digest, support-file digest,
  runtime/WASM identity, refusal or execution receipt, output digest, and environment.
- Archive the screenshot extraction model/rules, validation annotations, original image digests,
  crop geometry, and adjudication log without publishing restricted images.
- Archive the coarsening and placement code, retained fine reference, hourly inputs, resolution
  outputs, estimand code, and original rendered results.
- Publish machine-readable manifests, source locators, conformance vectors, and a restricted-data
  access statement.

## 3. Results

**Results rule:** Do not fill a subsection merely because the software branch exists. Each result
requires the corresponding source, validation, data-authority, preregistration, and execution gates.
Synthetic fixtures may appear only as validation evidence.

### 3.1 Corpus access, eligibility, and coding reliability

- Participant/study flow equivalent for the literature corpus.
- Access depth and eligibility by app-level versus device-level method.
- Independent coding agreement, adjudication, and unresolved fields.
- Preliminary reconciled counts may be shown only as preliminary and not independently verified
  until the scoring gates pass.

#### Table 8. Literature disclosure and scoring results

| Component | Eligible records | Declared | Delegated | Absent | N/A | Undetermined | Reliability/adjudication |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `[component]` | `[n with access-conditioned denominator]` | `[n/%]` | `[n/%]` | `[n/%]` | `[n]` | `[n]` | `[estimate and unresolved n]` |

### 3.2 Decision-vector coverage and counterexamples

- Report which methods fit the frozen vector, which require a new component, and which remain
  undetermined because of access.
- Report parameter provenance and boundary operators separately from component presence.
- `claim:H01_VECTOR_STRUCTURE`: `[UNFILLED until vector, source-map, counterexample, and prior-art
  gates pass]`.

### 3.3 Binding executability, conformance, and refusal

- Flow from candidate bindings to source-reviewed, component-validated, reference-replayed,
  independently conformant, executed, refused, or excluded bindings.
- Evidence vector for every included binding.
- Refusal reasons and structurally impossible cells.
- `claim:H02_BINDING_DISAGREEMENT` prerequisites:
  `[UNFILLED until complete-binding and conformance gates pass]`.

### 3.4 Android episode, session, day, and participant disagreement

- Episode boundary and close-reason divergence.
- Session counts, durations, fragmentation, pickups, and device-active time.
- Daily and participant app-active minutes on common paired-day support.
- Whole-binding contrasts and only those component contrasts that pass the full-rank gate.
- Pre-clean versus separately aggregated cleaning branches.
- Primary `theta_b`, global `Theta`, simultaneous uncertainty, and decision relative to `delta`.
- `[UNFILLED until authorized real-data execution passes]`.

#### Table 9. Primary and secondary binding-disagreement results

| Binding or contrast | Signal stratum | Participants and paired days | Estimate and 95% interval | Decision versus `delta` | Rank/agreement and downstream change |
| --- | --- | --- | --- | --- | --- |
| `[binding vs baseline]` | `[stratum]` | `[n participants / n paired days]` | `[theta_b or named secondary]` | `[material, equivalent, inconclusive]` | `[prespecified secondary results]` |

### 3.5 iOS screenshot acquisition and extraction reliability

- Screenshot flow: expected, submitted, complete, readable, supported, extracted, adjudicated, and
  analytically included.
- Validation performance for every element in Table 5.
- Error and missingness by device, iOS version, layout, mode, locale, and usage intensity.
- `[UNFILLED until screenshot authority, acquisition, and validation pass]`.

### 3.6 One-hour coarsening and resolution reliability

- Report retained fine-resolution reference coverage and hourly coarsening checks.
- Lead with temporal displacement and per-bin error, then structural-statistic and downstream
  preservation; use correlation-family statistics only as secondary evidence.
- Present separate estimates at 1, 5, 10, 15, and 30 minutes.
- Present the 60-minute row in a visually separate identity panel labelled **forced by exact hourly
  mass preservation**, not as empirical reliability.
- Report variation by participant, day, usage intensity, boundary-crossing pattern, Android binding,
  and placement method.
- `claim:C04_HOURLY_PLACEMENT`: `[UNFILLED until archive, independent rerun, estimand, and validation
  gates pass]`.

#### Figure 3. Resolution-specific recovery

- Panel A: distribution of mass-weighted temporal displacement.
- Panel B: MAE/RMSE and `lambda(Delta)` by resolution with the 60-minute identity visually marked.
- Panel C: recovery of bout count, autocorrelation, entropy, and time-of-day summaries.
- Panel D: participant/day heterogeneity and intended-use regions.

### 3.7 Common-resolution iOS and Android comparison

- Validated hourly and daily iOS Screenshot outputs.
- Android binding outputs aggregated to identical clock windows.
- Digital Wellbeing comparison only if same-device paired data are collected.
- Agreement or distributional results only for construct-compatible outputs; otherwise report the
  incompatibility itself.
- Separate screenshot extraction error, vendor aggregation uncertainty, Android reconstruction
  uncertainty, and within-hour placement uncertainty.
- `[UNFILLED; no cross-platform ground-truth claim is currently permitted]`.

#### Figure 4. Cross-platform measurement bridge

- Panel A: observed output and hidden-decision layers by instrument.
- Panel B: hourly/daily common-scale comparison where admissible.
- Panel C: uncertainty budget partitioned into capture, aggregation, reconstruction, and placement
  layers without claiming unidentified components are separable.

### 3.8 Downstream model and conclusion sensitivity

- Coefficient and interval changes across admissible bindings and supported resolutions.
- Participant-rank and threshold-classification changes.
- Changes in direction, significance language, or substantive conclusion.
- `[UNFILLED until preregistration, data authority, and execution gates pass]`.

### 3.9 Robustness, failure, and performance results

- Report missingness and sensitivity to clock alignment, partial days, shared devices,
  package/cleaning policy, and screenshot uncertainty.
- Treat runtime and reproducibility as operational evidence, not the scientific contribution.

## 4. Discussion

### 4.1 Principal findings by research question

- Answer RQ1-RQ7 in the same order used in the Introduction and Results.
- Distinguish unsupported, inconclusive, practically equivalent, and materially different findings.
- Do not substitute high correlation or stable ranks for absolute agreement.

### 4.2 What one-hour reliability means - and does not mean

- Exact agreement at 60 minutes follows from the mass-preserving constraint.
- The relevant empirical evidence is below-hour placement, structural-statistic recovery, and
  downstream stability.
- A method can preserve daily or hourly totals yet misplace use enough to alter bedtime windows,
  fragmentation, pickups, sequence, or intervention-trigger analyses.
- Resolution must therefore be selected for the intended claim, not described as globally valid.

### 4.3 Android and iOS are not interchangeable measurement channels

- Android event logs permit alternative auditable bindings but remain incomplete observations.
- iOS screenshots provide real rendered outputs but hide upstream semantics and add extraction
  error.
- Android coarsening validates a recovery procedure under retained Android timing; it does not
  reveal Apple's raw-to-bar transformation.
- A same-device Android Digital Wellbeing comparison could calibrate a vendor-summary layer, but it
  cannot be transferred to iOS without a separate design.

### 4.4 Implications for screen-time research

- Explain implications for child and family studies, shared devices, temporal-pattern research,
  intervention thresholds, prevalence estimates, and cross-study pooling.
- Report reconstruction and observation uncertainty alongside estimates used for substantive
  claims.
- Distinguish reproducibility, agreement, validity, and transportability.

### 4.5 Minimum reporting standard

- Instrument, platform and version, acquisition path, observable event/output vocabulary, cadence,
  and coverage.
- Event retention, opener, closer, pairing, orphan, duplicate, collision, device-state, reboot,
  censoring, time-zone, and day-boundary rules.
- Grouping, thresholds, caps/floors, package policy, aggregation, denominators, and cleaning.
- Screenshot capture, OCR/human validation, missingness, layout/version support, and cross-device
  settings where vendor summaries are used.
- Parameter provenance, complete binding, implementation revision, conformance, uncertainty, and
  sensitivity analysis.

#### Table 10. Minimum reporting checklist

| Reporting domain | Required disclosure | Scientific component IDs | Machine-readable evidence |
| --- | --- | --- | --- |
| Instrument and acquisition | Platform/version, signal/output, cadence, permissions, coverage | `[generated mapping]` | Input and acquisition manifest |
| Reconstruction | Event, opener/closer, pairing, orphan/duplicate/collision/device-state policies | `[generated mapping]` | Complete binding and execution receipt |
| Time and aggregation | Time zone, DST, day boundary, bins, denominator, partial-day rules | `[generated mapping]` | Aggregation manifest |
| Cleaning and inclusion | Filters, caps/floors, exclusions, missingness, participant/day rules | `[generated mapping]` | Cleaning and attrition receipt |
| Screenshot/vendor output | Capture protocol, OCR/human validation, version/layout, cross-device setting | `[generated mapping]` | Image digest, extraction and adjudication record |
| Validation and reporting | Source review, conformance, uncertainty, sensitivity, code/data revision | `[generated mapping]` | Evidence vector and reproducibility bundle |

### 4.6 Strengths and limitations

- Strengths: common raw stream, complete bindings, explicit conformance and refusal, multi-level
  outcomes, retained fine timing for coarsening validation, and separation of capture,
  reconstruction, placement, and cleaning.
- Limitations: no universal behavioral ground truth; incomplete source/code access; iOS hidden
  aggregation; screenshot error and nonresponse; Android-to-iOS transport assumptions; platform and
  layout drift; shared-device attribution; restricted-data reproducibility; and incomplete delivery
  axes or conformance where applicable.
- State explicitly whether the iOS and Digital Wellbeing studies remained protocols rather than
  empirical results.

## 5. Conclusion

- Return to the distinction between observing an event or summary and defining a measure.
- State which components, bindings, resolutions, and outputs were empirically supported.
- State whether measurement choice changed absolute estimates, ranks, agreement, or substantive
  conclusions, without extrapolating beyond the authorized instruments and cohorts.
- End with the reporting implication: a screen-time number is reproducible only when its instrument,
  complete decision vector, validation evidence, and uncertainty are reportable.

## Planned figures and tables at a glance

### Main-text tables

1. Table 1. Study aims, evidence streams, and present status.
2. Table 2. Instrument and output comparison.
3. Table 3. Event-to-measure component rubric.
4. Table 4. Complete binding evidence and conformance matrix.
5. Table 5. Screenshot extraction validation plan/results.
6. Table 6. Resolution-recovery results at 1, 5, 10, 15, 30, and 60 minutes.
7. Table 7. Common-resolution Android and iOS comparison.
8. Table 8. Literature disclosure and scoring results.
9. Table 9. Primary and secondary binding-disagreement results.
10. Table 10. Minimum reporting checklist.

### Main-text figures

1. Figure 1. Event-to-summary decision graph.
2. Figure 2. Android coarsening, recovery, and iOS screenshot observation design.
3. Figure 3. Resolution-specific temporal recovery.
4. Figure 4. Cross-platform measurement bridge and uncertainty layers.
5. Figure 5. Literature component-disclosure heat map.
6. Figure 6. Android binding specification curve and pairwise disagreement.
7. Figure 7. Downstream model and conclusion sensitivity.

## Supplementary material and authoring appendices

### Appendix A. Canonical claim and gate crosswalk

- Generate from `claim-ledger.yaml`; do not hand-maintain alternate canonical statements.
- Include all exact status tuples, required gate IDs, prohibited inferences, and result eligibility.
- Keep engineering implementation and deployment status out of scientific Results.

### Appendix B. Full component rubric and coding instrument

- All 21 canonical components and definitions.
- Access, eligibility, disclosure, adjudication, and parameter-provenance rules.
- Independent scoring and reconciliation protocol.

### Appendix C. Complete binding registry

- Source lineage, full parameter expansion, compatibility, signal stratum, and version.
- Source/component/replay/conformance evidence vector.
- Included, excluded, structurally unavailable, and refused cells with reasons.

### Appendix D. iOS screenshot and one-hour resolution protocol

- Capture instructions and supported-layout inventory.
- Annotation manual, OCR validation set, and adjudication rules.
- Coarsening, placement, and resolution-analysis specification.
- Structural 60-minute identity proof and prohibited interpretation.
- Common-resolution Android/iOS harmonization rules.

### Appendix E. Reproducibility and data availability

- Source, environment, runtime, configuration, input and output digests.
- Public fixtures and restricted-data access route.
- Machine-readable manifests, codebooks, conformance receipts, and analysis scripts.

### Authoring-only annex

- Current delivery-axis and branch status, recovery history, PR/merge/deploy/canary records, source
  hierarchy, defect-history exclusions, and invalid pre-fix results.
- These controls support auditability but do not appear as scientific findings in the manuscript.
