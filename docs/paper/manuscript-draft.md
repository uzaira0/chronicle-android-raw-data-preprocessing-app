# Constructing Screen Time: From Typed Android Events to Cross-Platform Measures

**Manuscript draft.** Drafted 2026-08-24 from `paper-outline.md` (milestone-zero authoring
plan, 2026-08-11) under the authoring controls of `claim-ledger.yaml` **ledger_version
1.0.4** (as_of 2026-08-25), `measurement-component-rubric.yaml` **0.2.0**, and
`delivery-axis-ledger.yaml` **2026-08-25.1**.

> **Draft status and rules of use.** The headline empirical analyses have not been run.
> Every Results field that depends on an unpassed gate is left explicitly unfilled; none
> may be replaced with synthetic magnitudes. Where this draft quotes a canonical claim
> statement it quotes it exactly and cites the claim id; all other text is non-canonical
> prose. Claim status tuples are reproduced as (lifecycle / validation / empirical) at
> ledger 1.0.4. This is a measurement-methods paper, not a software paper: implementation
> and delivery status appear only in the authoring annex, never as scientific findings.

## Abstract

*(Target 250–300 words when the locked fields are filled.)*

**Background.** Smartphone use is routinely described as objectively measured, yet event
logs, vendor summaries, and screenshots expose different signals and already encode
different definitions of use. Typed Android events do not become app episodes, device
sessions, daily totals, or participant summaries until an analyst settles event,
pairing, grouping, time, denominator, and cleaning rules. iOS Screen Time screenshots
expose rendered hourly summaries whose upstream aggregation rule cannot be audited from
the screenshot, creating both a comparability problem and a temporal-resolution problem.

**Objective.** To formalize the complete event-to-summary decision vector; to determine
which components published methods disclose; to execute scientifically admissible
Android bindings on common data; to test how one-hour observation changes recoverable
temporal information; and to evaluate whether measurement choices alter descriptive and
substantive conclusions.

**Methods.** Study 1 codes a fixed literature census plus an expanded discovery corpus
with an access-aware 21-component rubric. Study 2 executes source-reviewed Android
method bindings on the same authorized event streams with explicit conformance,
refusal, and provenance. Study 3 pairs iOS Screen Time screenshot extraction and
quality control with an Android coarsening experiment that converts fine-resolution
event-derived occupancy to hourly totals and evaluates recovery at 1, 5, 10, 15, 30,
and 60 minutes. Study 4 tests downstream sensitivity of associations, classifications,
and conclusions.

**Results.** `[LOCKED: report no magnitude until the relevant claim-ledger gates pass.
The 60-minute mass-conservation equality is a mathematical identity, not an empirical
accuracy result.]`

**Conclusion.** `[CONDITIONAL: state only what the completed disclosure, conformance,
Android multiverse, screenshot-validation, resolution, and downstream analyses
support.]`

## 1. Introduction

### 1.1 Screen time is a constructed measure

There is a difference between observing a platform event and asserting continuous app
or device use. An Android device records that an activity resumed at a particular
instant; a research paper reports that a child used a tablet for 214 minutes on a
Tuesday. Everything between those two statements is construction: typed occurrences
become event records; event records are selected and paired into app episodes; episodes
are bounded, repaired, or refused; episodes are grouped into device-use sessions and
app-usage sessions; sessions are assigned to days under a time zone and a day-boundary
convention; day totals are aggregated over a denominator of eligible days; and cleaning
rules discard, cap, winsorize, or reclassify what remains. Each step is a decision, and
most steps admit several published answers.

An algorithm name alone therefore does not identify a measure. Two studies can both
cite the same reconstruction rule and still disagree, because numeric thresholds,
boundary inclusivity, package policy, time zone, missing-event behavior, and cleaning
are part of the binding — the complete, versioned assignment of every free slot the
method leaves open. The stakes are not hypothetical bookkeeping: in child and family
screen-time research, minutes, temporal patterning, cutoff classifications, and
model associations can each support different substantive conclusions, and each is
reachable from the same raw stream by admissible combinations of these decisions.

### 1.2 Android and iOS expose different measurement problems

Android's `UsageEvents` API can expose typed, timestamped events, which permits
alternative, auditable reconstructions of the same stream. Android Digital Wellbeing
and iOS Screen Time instead expose vendor-computed summaries whose upstream decisions
are hidden. iOS Screen Time screenshot workflows in particular yield rendered hourly
bars and daily summaries — not the raw event stream from which those bars were
computed. Cross-platform pooling can therefore combine different observation models
even when both columns are labelled "screen time." Screenshots also add a second
measurement layer of their own: capture compliance, page selection, cropping, OCR or
human transcription, hour alignment, category mapping, and platform-version drift.

### 1.3 Prior work and the unresolved gap

Prior work falls into four strands, none of which resolves the construction problem.
First, comparisons of self-report against device-derived measures consistently find
divergence, but typically treat the device-derived value as interpretation-free ground
truth rather than as one constructed measure among several. Second, published Android
event-reconstruction methods — device-session rules, episode-pairing rules, grouping
rules, and cleaning rules — each disclose some decisions and leave others implicit,
delegated, or absent; downstream multiverse analyses have varied model-level choices
far more often than measurement-level ones. Third, iOS Screen Time access routes
(donation, screenshot, forensic, and DeviceActivity) differ in what they observe;
rendered summaries must be distinguished from event-level stores and from
privacy-constrained APIs. Fourth, temporal coarsening and disaggregation validation is
established in adjacent fields: the design of coarsening fine observations,
reconstructing, and comparing against the retained fine series is not novel and is not
claimed as such here.

The remaining contribution is deliberately narrow: an integrated, typed
event-to-summary decision model; complete executable bindings with explicit failures
and conformance; a same-stream Android comparison; and an explicit bridge to
screenshot-derived one-hour observations.

### 1.4 Research questions

1. **RQ1 — Decision structure.** Which decisions must be settled before typed Android
   events become app episodes, device-use sessions, grouped sessions, daily totals, and
   cleaned participant summaries?
2. **RQ2 — Disclosure and reproducibility.** Which decision components are declared,
   delegated, absent, not applicable, or undetermined in the fixed literature census
   and expanded corpus, conditional on source access?
3. **RQ3 — Complete-binding disagreement.** How much do source-faithful,
   scientifically admissible Android bindings disagree at episode, session, day,
   participant, and downstream-analysis levels?
4. **RQ4 — One-hour resolution reliability.** When fine-resolution Android event data
   are deliberately coarsened to hourly totals that mimic the temporal resolution
   available from iOS Screen Time screenshots, how well can within-hour placement and
   downstream temporal structure be recovered at 1, 5, 10, 15, 30, and 60 minutes?
5. **RQ5 — Cross-platform comparability.** After independently validating screenshot
   extraction and harmonizing time windows, what can and cannot be compared between
   iOS Screen Time screenshot outputs, Android vendor summaries, and Android
   event-derived bindings at common hourly and daily resolutions?
6. **RQ6 — Substantive sensitivity.** Do scientifically admissible bindings or
   observation resolutions change participant ranks, agreement statistics, model
   estimates, classifications, or substantive conclusions on authorized real study
   data?
7. **RQ7 — Reporting standard.** What minimum reporting checklist would make future
   passive-sensing measures classifiable, reproducible, and appropriately qualified by
   instrument capability?

### 1.5 Hypotheses and planned contributions

The claims below are cited with their exact ledger 1.0.4 status tuples. Inclusion in
the ledger gives a claim a stable identity and an auditable status; it is not evidence
for the claim.

**`claim:H01_VECTOR_STRUCTURE`** (HYPOTHESIS / UNVALIDATED / UNRUN). Canonical
statement, quoted exactly:

> Within the scoped corpus, every typed mobile event-to-cleaned-summary
> operationalization examined is hypothesized to be representable as a vector spanning
> instrument and acquisition semantics, event selection, episode reconstruction,
> session construction, temporal assignment, aggregation and denominators, cleaning,
> and parameter provenance.

This is the primary conceptual hypothesis. It is result-eligible only after the
frozen-rubric, source-mapping, and counterexample gates pass (GATE-H01-FREEZE,
GATE-H01-SOURCE-MAP, GATE-H01-COUNTEREXAMPLES, GATE-H01-PRIOR-ART). It must not be
generalized from "rules examined" to all published rules, and the absence of an
observed counterexample in the draft corpus is not proof of universal expressiveness.

**`claim:H01A_DISCLOSURE_INSTRUMENT`** (PROPOSED / UNVALIDATED /
PRELIMINARY_COUNTS_ONLY). Canonical statement, quoted exactly:

> The proposed vector and scoring rubric may function as an access-aware instrument for
> classifying whether a publication declares, delegates, omits, or leaves undetermined
> the components required to identify its constructed measure.

Reconciled fixed-census counts exist but are PRELIMINARY_NOT_INDEPENDENTLY_VERIFIED
and appear in this draft only with that qualifier.

**`claim:C01B_PARAMETER_PROVENANCE`** (CONCEPTUAL / PARTIALLY_SUPPORTED /
NOT_APPLICABLE). Canonical statement, quoted exactly:

> Numeric thresholds and boundary operators are typed arguments to a method binding;
> their origin, units, inclusivity, inheritance chain, and fitting context are part of
> the measure's identity rather than facts about phones in general.

**`claim:H02_BINDING_DISAGREEMENT`** (HYPOTHESIS / UNVALIDATED / UNRUN). Canonical
statement, quoted exactly:

> Complete, source-faithful, scientifically admissible method bindings may produce
> materially different episode, session, day, participant, and downstream-analysis
> results when applied to the same authorized real event stream.

Results for this claim remain unfilled until all of GATE-H02-COMPLETE-BINDINGS,
GATE-H02-CONFORMANCE, GATE-H02-PREREGISTRATION, GATE-H02-DATA-AUTHORITY, and
GATE-H02-EXECUTION pass.

**`claim:C03_CAPABILITY_DEFINABILITY`** (CONCEPTUAL / PARTIALLY_SUPPORTED /
NOT_APPLICABLE). Canonical statement, quoted exactly:

> The signals an instrument exposes constrain which usage constructs and processing
> decisions can be defined or audited; capability is multidimensional and should be
> represented as a partial order where a single ladder would imply a false total
> ranking.

**`claim:C04_HOURLY_PLACEMENT`** (EXTERNAL_REPORT / UNVALIDATED /
EXTERNALLY_REPORTED_NOT_REPRODUCED). Canonical statement, quoted exactly:

> When only hourly totals are observed, a specified placement procedure can be
> evaluated below the hour using displacement and downstream-statistic preservation,
> provided its implementation, ground-truth inputs, estimands, and uncertainty are
> independently reproducible.

The externally reported TECH/GNSM results are not manuscript evidence until archived
and independently reproduced (GATE-C04-ARCHIVE, GATE-C04-INDEPENDENT-RERUN,
GATE-C04-ESTIMANDS, GATE-C04-VALIDATION); this paper's Results omit them.

**`claim:C05_VENDOR_CALIBRATION`** (PLANNED / UNVALIDATED / NO_DATA). Canonical
statement, quoted exactly:

> A planned Android study could compare a versioned Digital Wellbeing aggregate with
> raw UsageEvents bindings on the same device and window to characterize differences
> between an opaque vendor measure and explicit reconstruction policies.

No Digital Wellbeing data are held; this remains a future-work design.

One retired claim is cited only as a guardrail. **`claim:C01_LEGACY_MISSING_END`**
(WITHDRAWN / INVALIDATED_AS_STATED / NOT_APPLICABLE) asserted that every published
reconstruction rule examined was a special case of one structure whose single free slot
was what bounds an episode with no observed end; it conflated unmatched-open episode
reconstruction with a downstream interval-quality transform and is not revived here
(GATE-C01-LEGACY-NO-REVIVAL). Its withdrawal is not evidence that the replacement
vector hypothesis is true.

The paper will contribute only the subset of these claims that passes its source,
rubric, conformance, data, execution, and validation gates.

### Table 1. Study aims, evidence streams, and present status

| Module | Primary question | Evidence stream | Main output | Present status |
| --- | --- | --- | --- | --- |
| Study 1: decision and disclosure model | RQ1–RQ2 | Fixed 51-reference census plus expanded discovery corpus | Component rubric, coverage and disclosure estimates | Rubric proposed (0.2.0); preliminary counts not independently verified |
| Study 2: Android binding multiverse | RQ3 and part of RQ6 | Authorized Android event streams plus source/reference fixtures | Episode-to-participant disagreement and conformance | Runtime branches exist; headline real-data run unperformed |
| Study 3A: iOS screenshot extraction | RQ5 | Versioned iOS Screen Time screenshots plus human reference coding | Extraction error, missingness, and usable hourly outputs | Conditional; acquisition and validation gates open |
| Study 3B: one-hour coarsening and recovery | RQ4 | Fine Android event-derived occupancy coarsened to hourly totals | Resolution-specific displacement, error, reliability, and structural-statistic recovery | Externally reported analysis not independently reproduced |
| Study 3C: common-resolution comparison | RQ5 | Validated iOS screenshot outputs, Android vendor summaries where available, and Android bindings | Hourly/daily agreement and non-equivalence characterization | Conditional; no claim of ground truth |
| Study 4: substantive sensitivity | RQ6 | Authorized study outcomes joined to preregistered measurement outputs | Model, classification, and conclusion sensitivity | Unrun |

## 2. Methods

### 2.1 Overall design

Four linked studies replace one undifferentiated multiverse. Literature evidence,
source-conformance evidence, real-study inference, and synthetic defect fixtures are
kept in separate roles throughout. Research questions, admissible bindings, resolution
estimands, common time support, and materiality thresholds are frozen before outcome
differences are inspected. A refused or unavailable binding is never converted into a
zero outcome. Source-faithful whole-method contrasts are kept separate from controlled
one-component contrasts, because only the latter can support a component attribution.

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

This instrument table is the practical face of `claim:C03_CAPABILITY_DEFINABILITY`
(CONCEPTUAL / PARTIALLY_SUPPORTED / NOT_APPLICABLE): capability is multidimensional,
and the table's rows are not a total order. "Not recorded," "not documented," "not
accessible," and "not definable" are kept as distinct states, and higher capability is
never read as greater truth, validity, or study quality.

### 2.3 Units and event-to-measure process

The unit vocabulary preserves four distinctions that are routinely collapsed: a
`PlatformEventOccurrence` (something happened on the device), a `UsageEventRecord`
(the collector wrote a row), a `UsageEpisodeAssertion` (a reconstruction rule claims
an episode), and the `UsageInterval` that assertion denotes. Device-state blocks are
modeled separately from device-use sessions, glances, pickups, and grouped app-usage
sessions. The pipeline exposes a pre-clean reconstructed checkpoint, then forks
pre-clean and each declared cleaning branch before aggregation, so that cleaning is a
branch on the graph rather than an in-place mutation. Day and participant summaries
carry explicit time zone, day boundary, denominator, coverage, inclusion, and
missingness rules.

#### Figure 1. Event-to-summary decision graph

```text
platform occurrence -> usage-event record -> event selection -> episode reconstruction
device-state blocks -------------------------------------------> bounds or credits episode
episode assertion -> grouped app session -> pre-clean rows ----> pre-clean aggregates
                                          `-> cleaning branch --> cleaned aggregates
all branches -> day assignment -> participant summary -> downstream analysis
```

### 2.4 Complete decision vector and 21-component rubric

Table 3 is generated from `measurement-component-rubric.yaml` version 0.2.0 — the
single authority for component IDs and definitions — rather than paraphrased as a
second authority in prose. The vector spans instrument and acquisition semantics,
event selection, episode reconstruction, device and grouped-session construction,
temporal assignment, aggregation and denominators, cleaning, and parameter
provenance. All numeric thresholds and boundary operators are typed method arguments
with units, inclusivity, source, fitting context, and inheritance
(`claim:C01B_PARAMETER_PROVENANCE`). The rubric is audited by counterexample: if a
scoped method requires a component outside the frozen rubric, the rubric is updated
and versioned before empirical analysis rather than forcing the method into an
incomplete vector.

#### Table 3. Event-to-measure component rubric (generated from rubric 0.2.0)

| Component ID | Canonical component | Decision recorded |
| --- | --- | --- |
| `component:C01` | Event selection | Which raw event types are read at all before reconstruction begins. |
| `component:C02` | Opener set | Which event types open an episode. |
| `component:C03` | Closer set | Which event types close an episode. |
| `component:C04` | Pairing discipline | How openers bind to closers to form episode assertions and intervals. |
| `component:C05` | Unmatched open | What happens when an opener has no closing event. |
| `component:C06` | Unmatched close | What happens when a closer has no preceding opener. |
| `component:C07` | Duplicate opens | What happens when two openers for the same package occur without an intervening closer. |
| `component:C08` | Duplicate closes | What happens when more than one closer is available for one opener. |
| `component:C09` | Same-package runs | Whether consecutive openers for the same package collapse into one episode or remain separate episode assertions. |
| `component:C10` | Collision policy | How overlapping episode assertions across packages are represented or resolved. |
| `component:C11` | Device-state coupling | Whether and how device-state transitions, such as screen-off or lock, end or constrain an app episode or its credited duration. |
| `component:C12` | Shutdown and startup | How open episodes and unmatched events are handled across shutdown and startup. |
| `component:C13` | Window censoring | How episodes crossing an observation-query or reporting-window boundary are censored, truncated, carried, dropped, or allocated. |
| `component:C14` | Timezone and day assignment | Which timezone and boundary convention assign events or intervals to days, including daylight-saving and timezone-change behavior. |
| `component:C15` | Maximum-duration policy | Whether a maximum episode duration applies and what action occurs when it is exceeded. |
| `component:C16` | Minimum-duration exclusion | Whether episodes below a minimum duration are excluded, reclassified, or retained, and with what boundary inclusivity. |
| `component:C17` | Inactivity gap and session grouping | Whether completed episodes are grouped into sessions using an inactivity-gap rule and, if so, the threshold, comparison operator, and package-change behavior. |
| `component:C18` | Package policy | How launcher, system, keyboard, excluded, or otherwise special packages are retained, removed, capped, or classified. |
| `component:C19` | Background attribution | Whether background events or inferred background activity count toward usage. |
| `component:C20` | Data-gap policy | How logging gaps and device silence affect episode continuity, day validity, flagging, or imputation. |
| `component:C21` | Parameter provenance | For every numeric threshold or boundary operator, where the value and convention came from. |

Parameter-provenance vocabulary (derivation kind, transfer kind, source support) is
owned by the rubric's `census_scoring_contract.parameter_provenance` block and is not
redefined here.

### 2.5 Literature census and expanded discovery corpus

The fixed sampling frame is all 51 references in Winklbauer and Batinic, fixed before
screening; it is a bibliography census, not a probability sample of the field. The
expanded corpus adds prespecified search slices with stable identifiers,
deduplication, source-of-record rules, and direct-versus-transfer evidence. Source
access is recorded independently of disclosure as full text, abstract/metadata, or
unavailable. Component disclosure is coded `DECLARED`, `DELEGATED`, `ABSENT`, `N/A`,
or `UNDET`; material not read in full is `UNDET`, never silently `ABSENT`.
Load-bearing quotations are independently verified, a prespecified sample is
duplicate-coded, disagreements are adjudicated, and component-level reliability is
reported with access-conditioned denominators. App-level and device-level
denominators are kept separate throughout.

#### 2.5.1 Separate fixed-143 implementation-coverage evaluation

**Current scope clarification (2026-09-29).** The operator's objective is
Android-device-extractable data and processing derived from those records,
including separately supplied sensor, screenshot, packet and counter channels;
it is not restricted to Chronicle's ordinary app/screen event columns. This
clarification corrects the assistant's earlier overbroad interpretation, not a
change to the user's intended scope or a replacement of the goal's completion
criteria. Survey
instrumentation, questionnaire scoring and clinical assessment are not new
implementation goals. Their labels may be external analysis context for an
Android feature or model, but do not establish that its device processing is
implemented. The historical representation checkpoint below preserves earlier
work; it is not a claim that every Android algorithm executes. The current paper-level
algorithm/resource dispositions in [the coverage authority](android-143-coverage.md)
cover the same 143 identities and distinguish bounded executed owners,
implementable missing operations, concrete source/input blockers and genuinely
inspected absence. Unassessed resource usability is not counted as absent.
The inspected 16 code-paper resources contain 12 posthoc Android-processing
releases, one objective dedicated-PVT processing release, two live
collector/framework-policy releases and one questionnaire-only release; seven
of the 12 posthoc papers have a confirmed bounded current computation in that
source comparison. Nine dataset-paper resources overlap those same 16 papers;
most are prepared data and Time-Killing's sample is synthetic. These resource
counts are not an exhaustive availability census, complete-pipeline execution
claim or license determination. Separately supplied typed inputs can support
exact transformations without the original participant data; absent collector
signals and unreported algorithm semantics remain different limits. The subsequent
bounded component implementation executes Clear All's source-exact notification-group
reducer, BeyondBuzz payload cleaning, ON-bounded short-OFF repair and Ethica
foreground-interval preparation through the existing app runner; it does not claim
complete source-paper computation. No new questionnaire or clinical scoring is claimed.

**Source-limited coverage result: 143/143 rows finalized; aggregate acceptance pending.**
The ontology/application coverage evaluation uses the separate frozen manifest
of exactly 143 source identities in `android-143-corpus.json`, with one coverage
row per identity in `android-143-coverage.md`. This denominator is not the
historical 51-reference disclosure census in Sections 2.5 and 3.1, and the two
evaluations are not pooled.

Coverage is limited to in-scope Android data-processing meanings, variations and
relationships disclosed in the inspected source versions or explicitly identified
retained source evidence. Each finalized row records source locators, access
limitations, ontology mappings, applicable populated-record support and product
proofs. A source-limited finalization does not certify inaccessible text,
unreported serializers, original study inputs, deployment settings or unstated
clock, join, scoring or reconstruction rules. Documentary definitions and
constructed supplied-record examples are distinguished from executed methods and
original participant observations.

For supplied research records, application evidence concerns import, selected-owner
display, IndexedDB save, reload and reparse, with relevant ownership and
missing/null/empty counterexamples. Existing configuration or component-output
export/reopen evidence is reported separately; it is not a supplied-record export
claim. Generated-model checks apply to the exercised record classes, not to every
possible schema path. At the final working revision, all 143 rows are finalized
with explicit source limits, with zero remaining known unexplained disclosed
Android representation gaps. The [authoritative coverage table](android-143-coverage.md)
and its [2026-09-29 acceptance continuation](../../.tmp-literature-review-private/ontology-sublation-20260831/work/task-references-proof-20260928.md#native-byte-provenance-and-acceptance-20260929)
record the preserved identities, current canonical/generated/dependency build,
3,206 passing unit tests with one explicitly identified optional oracle
skip, and 53 distinct passing application workflows on the refreshed app.
The prior 3,202-test/52-workflow checkpoint remains historical. This result neither
reproduces the papers' scientific results nor resolves the separately unvalidated
H01/H02 hypothesis and novelty gates; all 165 scientific execution configurations
remain separately blocked.
The actual repository-wide `make all` run exited2 at a stale published campaign
summary after CI and unit/contract checks passed; the unchanged claim checker
now passes after that summary correction. The downstream run passed published
figures, B03/B05 checks, 49 smoke tests (23 explicit WebKit-durable capability
skips) and the normal fresh build, but exited2 on the correct-but-uncommitted
semantic-artifact guard and five unchanged historical size limits. Scoped
local-commit authorization and the operator's budget/optimization choice remain
pending. This paragraph is not the final goal-completion declaration.

### 2.6 Executable Android bindings

A published method is defined as a complete, versioned binding vector, not a
reconstruction-strategy label. A binding is resolved through schema, browser
configuration, Rust/WASM request, execution, provenance, export, and independent
conformance evidence. When the required signal or a compatible component combination
is absent, the binding refuses explicitly; refusal is a typed outcome, never a zero.
The runtime discipline requires default-byte compatibility (with every new option
absent or at default, output is byte-identical to the baseline), source-derived
fixtures, boundary and failure fixtures, sequential-versus-incremental parity,
persisted-cache identity, and end-to-end replay.

Current source-derived gaps are stated rather than smoothed over: some retained-event
alternatives are source-unverified transcriptions; the current EYES arm is an
ACTIVE-only partial replay/adaptation, not a certified EYES preset; and the
Parry–Toth/Culverhouse lineage is contributor-linked — the Culverhouse preprocessor is
an adaptation of the Parry & Toth example implementation and its cleaner is a
downstream pass over that adaptation's output, so the count of independent
reconstruction lineages in the comparator set is three (Parry & Toth with Culverhouse
as a derivative, EYES, and this repository's), not four. A contributor to this
repository also contributed to that artifact, so the comparison is reported as a
derivative-lineage check, never as fully independent external validation.

#### Table 4. Complete binding evidence and conformance matrix (shell)

| Binding ID | Source lineage and required signal | Completeness and execution | Source/component validation | Reference and independent replay | Included outputs or refusal |
| --- | --- | --- | --- | --- | --- |
| `[binding]` | `[source, version, signal stratum]` | `[complete, partial, refused]` | `[source review and component oracle]` | `[reference replay and independent end-to-end conformance]` | `[outputs, exclusions, reason code]` |

This table remains a shell until GATE-H02-COMPLETE-BINDINGS and GATE-H02-CONFORMANCE
pass; runtime enum values are not equivalent to independently validated published
methods, and the current strategy count is never reported as a count of independent
published methods.

### 2.7 Admissibility, identifiability, and preregistration

An exhaustive registry of all candidate cells is frozen before outcome inspection.
Each cell records target construct, applicable output, required signal,
signal-relation stratum, complete binding, source lineage, compatibility, and
inclusion/exclusion/refusal reason. Whole-binding differences are estimated without
attributing them to individual components. A component main effect is estimated only
where one compatible axis changes and all other components remain fixed; an
interaction only in a full-rank crossed subset that varies every interacting axis.
The design matrix is checked separately for each output; aliases and structurally
absent axes are reported as unidentifiable rather than estimated implicitly.

### 2.8 Data sources, ethics, and common support

Authorized real Android study data provide the headline binding and downstream
analyses. iOS screenshots require explicit data authority, privacy protection,
capture instructions, and a versioned platform/device record. Public or
author-provided fixtures establish conformance, not population inference; synthetic
fixtures establish invariants and failure behavior, not scientific effect magnitude.
Each participant's binding-independent paired-day set is frozen using study window,
raw-input availability, and participant criteria that never inspect a binding output.
Observed zero-use days are preserved as zero when the binding executed successfully;
execution refusal, missing input, unreadable screenshot, and excluded output are kept
as distinct states.

### 2.9 Study 2: Android complete-binding comparison

**Arms.** Only source-faithful bindings and prespecified controlled perturbations that
pass the admissibility and conformance gates are included. Held-fixed, varied,
bundled, structurally unavailable, and refused axes are enumerated per arm, and the
same authorized event stream is run through every executable arm.

**Outcomes.** Episode-level (start, end, duration, close reason, censoring, split,
merge, repair); session-level (count, duration, fragmentation, gap structure,
pickups, device-active time); day-level (app-active minutes, device-active minutes,
category/app distribution, timing, coverage); participant-level (central tendency,
dispersion, active-day denominator, inclusion); cleaning (pre-clean versus each
separately aggregated cleaning branch); and downstream (coefficient, uncertainty,
direction, ranking, classification, decision).

**Primary disagreement estimand.** Let `Y_i,d,b` be pre-clean daily app-active
minutes for participant `i`, paired day `d`, and binding `b`. For each preregistered
binding `b` versus baseline `0`,

```
theta_b = median_i mean_d | Y_i,d,b − Y_i,d,0 |
```

on the frozen paired-day support, and `Theta = max_b theta_b` over the frozen primary
binding family. Uncertainty uses participant-clustered resampling with simultaneous
intervals over the binding family. A smallest consequential difference `delta` is set
before outcome inspection; materiality is declared only when the lower interval bound
for `Theta` exceeds `delta`, practical equivalence only when the upper bound is below
it, and an inconclusive result otherwise.

### 2.10 Study 3A: iOS Screen Time screenshot extraction and validation

No iOS screenshot/OCR ingestion, hourly Screen Time import, or inverse-placement
implementation currently exists in this repository. This section is an explicit
build-and-validation protocol, not a description of implemented capability or
collected evidence.

**Acquisition protocol.** Record iOS version, device model/class, locale, time zone,
12/24-hour clock, date, screenshot page, selected day/week, and whether Share Across
Devices is enabled. Prespecify capture timing, required views, image resolution,
duplicate handling, resubmission, and missing-page rules. Preserve the original
screenshot, immutable digest, crop coordinates, extraction version, and human
adjudication record.

**OCR and human-reference validation.** Build a stratified validation set across
device sizes, light/dark modes, locales, hour labels, low-use bars, overlapping
labels, and platform versions; double-code it without using OCR output as the
reference; score hour-bar detection, bar height or value extraction, text
recognition, daily-total extraction, category/app label mapping, date/window
recognition, and missingness classification; report exact agreement, absolute and
relative error, missed/extra cells, adjudication rate, and uncertainty, never
correlation alone; and define fail-closed thresholds for an unreadable screenshot or
an unsupported platform layout.

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

**Purpose.** Reproduce the temporal information loss imposed when a fine
event-derived series is observed only as hourly mass — the practical resolution
available from Screen Time screenshot bars. This is a **coarsening experiment**, not
a simulation of human behavior: the observed Android event stream remains fixed and
only its temporal resolution is reduced. Android event-derived occupancy serves as
the retained fine-resolution reference for this experiment while remaining a
constructed measure that depends on its own complete binding; it is not universal
behavioral ground truth.

**Procedure.**

1. Construct fine-resolution reference occupancy `T` from each admissible Android
   binding.
2. Sum `T` within clock-hour bins to create hourly observations `H`.
3. Apply each prespecified placement method to `H` to obtain reconstructed
   within-hour occupancy `P` while preserving each hourly total exactly.
4. Aggregate `T` and `P` separately to 1, 5, 10, 15, 30, and 60-minute bins.
5. Compare `P` with retained `T` at every resolution and for downstream temporal
   summaries.
6. Repeat across participants, days, usage intensities, boundary-crossing patterns,
   and admissible Android bindings.

**Placement methods.** The externally reported TECH/GNSM procedure is included only
after its code, inputs, outputs, and environment are archived and independently
reproduced (`claim:C04_HOURLY_PLACEMENT`, EXTERNAL_REPORT / UNVALIDATED /
EXTERNALLY_REPORTED_NOT_REPRODUCED; GATE-C04-ARCHIVE and GATE-C04-INDEPENDENT-RERUN
are open). Simpler reference placements — beginning-loaded, uniform, midpoint, or
boundary-aware — are prespecified only where their definitions and feasibility
constraints are exact. Method-ranking resolution checks are kept separate from
reliability estimation.

**Resolution-specific estimands.** Per-bin MAE and RMSE; mass-weighted absolute and
signed temporal displacement; a reliability or signal-fraction statistic
`lambda(Delta)` with its exact definition; recovery of total mass, active-bin count,
bout count and duration, autocorrelation, entropy, time-of-day profile, peak timing,
and prespecified downstream statistics; and participant/day heterogeneity with
participant-clustered uncertainty.

**The 60-minute identity.** Because every placement method is constrained to
preserve the input hourly total, `P_60 = T_60` by construction when bins and clocks
align. `lambda(60) = 1`, zero 60-minute mass error, or perfect hour-level agreement
is therefore a structural identity. It is not evidence that the placement method
reconstructs within-hour use, matches Apple's hidden aggregation rule, or validates
the underlying Android binding. The empirical questions begin below 60 minutes and
in structural or downstream statistics that the exact-total constraint does not
force to agree.

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

Only outputs that refer to a compatible construct, clock window, device scope, and
unit are compared. Validated iOS screenshot-derived hourly and daily outputs are
observations, not criterion truth. Android comparison series are produced by
aggregating each admissible event-derived binding to the same hour/day boundaries
and, where collected, by independently extracting Digital Wellbeing screenshots.
Harmonization covers time zone, daylight-saving transitions, cross-midnight use,
partial first/last days, app/category vocabulary, Share Across Devices, and missing
screenshot cells. If no paired or otherwise justified design exists, cross-platform
results are limited to measurement characterization and distributional comparison
rather than causal or individual-level agreement. Successful recovery on
Android-coarsened data is never used to assert that Apple's hidden raw-to-bar
transformation is correct or equivalent.

#### Table 7. Common-resolution comparison plan

| Comparison | Common unit and support | Primary statistic | Required validation | Permitted inference |
| --- | --- | --- | --- | --- |
| Android binding vs Android binding | Same participant-day/hour and raw stream | Absolute difference, agreement, rank change | Complete binding conformance | Binding sensitivity on Android |
| Android event-derived vs Digital Wellbeing | Same device, hour/day, and version | Paired difference and agreement | Screenshot/OCR validation plus paired collection | Vendor-versus-explicit binding characterization; neither is ground truth |
| iOS Screen Time screenshot vs harmonized Android output | Common displayed hour/day and construct where justified | Distributional difference, rank/agreement only in a paired design | iOS extraction validation, window and construct harmonization | Cross-platform comparability limits, not platform truth ranking |
| Reconstructed sub-hour iOS series vs observed iOS hourly mass | Within screenshot hour | Exact mass preservation plus sensitivity across placements | Valid screenshot extraction | Conditional temporal allocation only; no direct sub-hour accuracy claim |

### 2.13 Study 4: downstream model and conclusion sensitivity

Substantive outcomes, covariates, estimands, models, and decision thresholds are
preregistered before being joined to measurement outputs. The same analysis is refit
under every admissible binding and, where scientifically justified, every supported
temporal resolution. Reported quantities are coefficient magnitude, interval,
direction, participant rank, classification, threshold crossing, and substantive
conclusion. Downstream decision change is kept separate from the primary
measurement-disagreement estimand, and causal sensitivity is not inferred from a
model that was not causally identified in the source study.

### 2.14 Robustness, missingness, and sensitivity analyses

Robustness analyses cover: logging gaps, unsupported event labels, unmatched
open/close events, device restarts, clock changes, time zones, daylight-saving
transitions, query-window censoring, and cross-midnight episodes; shared devices,
person attribution, app/package exclusions, background or media activity, and
observation reactivity; screenshot nonresponse, duplicate or partial screenshots,
unreadable bars, OCR uncertainty, cross-device aggregation, and platform-layout
changes; coarsening bin alignment, alternative feasible placements, participant/day
heterogeneity, and resolution-specific use cases; and cleaning-induced day and
participant eligibility analyzed on the same frozen input-defined support.

### 2.15 Reproducibility and artifact provenance

Every execution records exact source revision, configuration, complete binding,
input digest, support-file digest, runtime/WASM identity, refusal or execution
receipt, output digest, and environment. The screenshot pipeline archives the
extraction model/rules, validation annotations, original image digests, crop
geometry, and adjudication log without publishing restricted images. The coarsening
pipeline archives placement code, retained fine reference, hourly inputs, resolution
outputs, estimand code, and original rendered results. Machine-readable manifests,
source locators, conformance vectors, and a restricted-data access statement are
published.

## 3. Results

**Results rule.** A subsection is not filled merely because the software branch
exists. Each result requires the corresponding source, validation, data-authority,
preregistration, and execution gates. Synthetic fixtures may appear only as
validation evidence.

### 3.1 Corpus access, eligibility, and coding reliability

The only values eligible to appear at this ledger revision are the reconciled
fixed-census counts, and they carry their required qualifier verbatim: they are
**preliminary and not independently verified** (reconciliation status
PRELIMINARY_NOT_INDEPENDENTLY_VERIFIED; `claim:H01A_DISCLOSURE_INSTRUMENT`, PROPOSED
/ UNVALIDATED / PRELIMINARY_COUNTS_ONLY). No independent coder has yet reproduced
the eligibility classifications or declaration scores.

Preliminary reconciled counts, fixed 51-reference frame: full-text access 35 of 51,
abstract/metadata-only 16 of 51. App-level: 16 eligible streams, of which 2 declare
a reconstruction rule and 1 is an empirical study declaring the rule. Device-level:
7 eligible streams, of which 5 declare the device-level pair. Threshold sensitivity
analyses: 1 in the fixed 51-reference frame. The app-level, device-level, access,
and sensitivity denominators are not pooled into any single "N of 51 declare"
statistic. The preliminary tally covers selected declaration questions, not all
vector components.

#### Table 8. Literature disclosure and scoring results

`[UNFILLED beyond the preliminary counts above until GATE-H01A-RUBRIC,
GATE-H01A-INDEPENDENT-SCORING, GATE-H01A-ADJUDICATION, and GATE-H01A-RECONCILIATION
pass.]`

### 3.2 Decision-vector coverage and counterexamples

`claim:H01_VECTOR_STRUCTURE` (HYPOTHESIS / UNVALIDATED / UNRUN):
`[UNFILLED until the vector, source-map, counterexample, and prior-art gates pass
(GATE-H01-FREEZE, GATE-H01-SOURCE-MAP, GATE-H01-COUNTEREXAMPLES,
GATE-H01-PRIOR-ART).]`

### 3.3 Binding executability, conformance, and refusal

`claim:H02_BINDING_DISAGREEMENT` prerequisites:
`[UNFILLED until the complete-binding and conformance gates pass
(GATE-H02-COMPLETE-BINDINGS, GATE-H02-CONFORMANCE).]`

### 3.4 Android episode, session, day, and participant disagreement

`[UNFILLED until authorized real-data execution passes (GATE-H02-PREREGISTRATION,
GATE-H02-DATA-AUTHORITY, GATE-H02-EXECUTION). No synthetic or pre-fix magnitude may
appear here.]`

#### Table 9. Primary and secondary binding-disagreement results

`[UNFILLED — shell retained in outline.]`

### 3.5 iOS screenshot acquisition and extraction reliability

`[UNFILLED until screenshot authority, acquisition, and validation pass.]`

### 3.6 One-hour coarsening and resolution reliability

`claim:C04_HOURLY_PLACEMENT` (EXTERNAL_REPORT / UNVALIDATED /
EXTERNALLY_REPORTED_NOT_REPRODUCED): `[UNFILLED until the archive, independent
rerun, estimand, and validation gates pass (GATE-C04-ARCHIVE,
GATE-C04-INDEPENDENT-RERUN, GATE-C04-ESTIMANDS, GATE-C04-VALIDATION).]` When filled,
the 60-minute row is presented in a visually separate identity panel labelled
**forced by exact hourly mass preservation**, never as empirical reliability.

### 3.7 Common-resolution iOS and Android comparison

`[UNFILLED; no cross-platform ground-truth claim is currently permitted.]`

### 3.8 Downstream model and conclusion sensitivity

`[UNFILLED until preregistration, data authority, and execution gates pass.]`

### 3.9 Robustness, failure, and performance results

Runtime and reproducibility behavior are operational evidence, not the scientific
contribution, and are reported in the reproducibility appendix rather than here.

## 4. Discussion

*(All Discussion prose is non-canonical and conditional: paragraphs that interpret
unrun results are written as interpretive frames, not findings.)*

### 4.1 Principal findings by research question

RQ1–RQ7 will be answered here in the order introduced, distinguishing unsupported,
inconclusive, practically equivalent, and materially different findings. High
correlation or stable ranks are never substituted for absolute agreement. At this
draft's ledger revision no research question has passed its evidence gates, so this
section carries frames only.

### 4.2 What one-hour reliability means — and does not mean

Exact agreement at 60 minutes follows from the mass-preserving constraint; the
relevant empirical evidence is below-hour placement, structural-statistic recovery,
and downstream stability. A method can preserve daily or hourly totals yet misplace
use within the day enough to alter bedtime windows, fragmentation, pickups,
sequence, or intervention-trigger analyses. Resolution must therefore be selected
for the intended claim, not described as globally valid.

### 4.3 Android and iOS are not interchangeable measurement channels

Android event logs permit alternative auditable bindings but remain incomplete
observations. iOS screenshots provide real rendered outputs but hide upstream
semantics and add extraction error. Android coarsening validates a recovery
procedure under retained Android timing; it does not reveal Apple's raw-to-bar
transformation. A same-device Android Digital Wellbeing comparison
(`claim:C05_VENDOR_CALIBRATION`, PLANNED / UNVALIDATED / NO_DATA) could calibrate a
vendor-summary layer, but it cannot be transferred to iOS without a separate design.

### 4.4 Implications for screen-time research

For child and family studies, shared devices, temporal-pattern research,
intervention thresholds, prevalence estimates, and cross-study pooling, the
practical implication is the same: reconstruction and observation uncertainty
belong alongside the estimates used for substantive claims, and reproducibility,
agreement, validity, and transportability are distinct properties that must be
established separately.

### 4.5 Minimum reporting standard

The proposed checklist requires: instrument, platform and version, acquisition
path, observable event/output vocabulary, cadence, and coverage; event retention,
opener, closer, pairing, orphan, duplicate, collision, device-state, reboot,
censoring, time-zone, and day-boundary rules; grouping, thresholds, caps/floors,
package policy, aggregation, denominators, and cleaning; screenshot capture,
OCR/human validation, missingness, layout/version support, and cross-device
settings where vendor summaries are used; and parameter provenance, complete
binding, implementation revision, conformance, uncertainty, and sensitivity
analysis.

#### Table 10. Minimum reporting checklist

| Reporting domain | Required disclosure | Scientific component IDs | Machine-readable evidence |
| --- | --- | --- | --- |
| Instrument and acquisition | Platform/version, signal/output, cadence, permissions, coverage | `component:C01`, `component:C20` | Input and acquisition manifest |
| Reconstruction | Event, opener/closer, pairing, orphan/duplicate/collision/device-state policies | `component:C02`–`component:C12` | Complete binding and execution receipt |
| Time and aggregation | Time zone, DST, day boundary, bins, denominator, partial-day rules | `component:C13`, `component:C14` | Aggregation manifest |
| Cleaning and inclusion | Filters, caps/floors, exclusions, missingness, participant/day rules | `component:C15`–`component:C18`, `component:C20` | Cleaning and attrition receipt |
| Screenshot/vendor output | Capture protocol, OCR/human validation, version/layout, cross-device setting | instrument rows of Table 2 | Image digest, extraction and adjudication record |
| Validation and reporting | Source review, conformance, uncertainty, sensitivity, code/data revision | `component:C21` | Evidence vector and reproducibility bundle |

*(The component-ID mapping above is drafted from rubric 0.2.0 and is provisional
until the GATE-H01-FREEZE crosswalk is frozen; see Appendix A.)*

### 4.6 Strengths and limitations

**Strengths.** A common raw stream; complete bindings; explicit conformance and
refusal; multi-level outcomes; retained fine timing for coarsening validation; and
separation of capture, reconstruction, placement, and cleaning.

**Limitations.** No universal behavioral ground truth; incomplete source and code
access (including source-unverified retained-event alternatives and the
contributor-linked Parry–Toth/Culverhouse lineage); iOS hidden aggregation;
screenshot error and nonresponse; Android-to-iOS transport assumptions; platform
and layout drift; shared-device attribution; restricted-data reproducibility; and
incomplete delivery axes or conformance where applicable. The submitted version
must state explicitly whether the iOS and Digital Wellbeing studies remained
protocols rather than empirical results.

## 5. Conclusion

The distinction that opens this paper — between observing a platform event or a
rendered summary and defining a measure — is also its conclusion. Which components,
bindings, resolutions, and outputs are empirically supported, and whether
measurement choice changed absolute estimates, ranks, agreement, or substantive
conclusions, will be stated here only from the completed gated analyses, without
extrapolating beyond the authorized instruments and cohorts. The reporting
implication stands independently of those results: a screen-time number is
reproducible only when its instrument, complete decision vector, validation
evidence, and uncertainty are reportable.

## Appendix A. Canonical claim and gate crosswalk

Generated from `claim-ledger.yaml` 1.0.4. Statements are quoted exactly in §1.5;
this table carries the status tuples, gates, and result eligibility.

| Claim ID | Lifecycle | Validation | Empirical | Result-eligible | Open gates |
| --- | --- | --- | --- | --- | --- |
| `claim:C01_LEGACY_MISSING_END` | WITHDRAWN | INVALIDATED_AS_STATED | NOT_APPLICABLE | No | GATE-C01-LEGACY-NO-REVIVAL (standing guardrail) |
| `claim:H01_VECTOR_STRUCTURE` | HYPOTHESIS | UNVALIDATED | UNRUN | Yes, conditional | GATE-H01-FREEZE, GATE-H01-SOURCE-MAP, GATE-H01-COUNTEREXAMPLES, GATE-H01-PRIOR-ART |
| `claim:H01A_DISCLOSURE_INSTRUMENT` | PROPOSED | UNVALIDATED | PRELIMINARY_COUNTS_ONLY | Yes, with preliminary qualifier | GATE-H01A-RUBRIC, GATE-H01A-INDEPENDENT-SCORING, GATE-H01A-ADJUDICATION, GATE-H01A-RECONCILIATION |
| `claim:C01B_PARAMETER_PROVENANCE` | CONCEPTUAL | PARTIALLY_SUPPORTED | NOT_APPLICABLE | Yes, source-verified counts only | GATE-C01B-SOURCE-LEDGER, GATE-C01B-BOUNDARIES, GATE-C01B-BINDING |
| `claim:H02_BINDING_DISAGREEMENT` | HYPOTHESIS | UNVALIDATED | UNRUN | Yes, conditional | GATE-H02-COMPLETE-BINDINGS, GATE-H02-CONFORMANCE, GATE-H02-PREREGISTRATION, GATE-H02-DATA-AUTHORITY, GATE-H02-EXECUTION |
| `claim:C03_CAPABILITY_DEFINABILITY` | CONCEPTUAL | PARTIALLY_SUPPORTED | NOT_APPLICABLE | Yes, versioned entries only | GATE-C03-MATRIX, GATE-C03-PLATFORM-SOURCES, GATE-C03-COUNTEREXAMPLES |
| `claim:C04_HOURLY_PLACEMENT` | EXTERNAL_REPORT | UNVALIDATED | EXTERNALLY_REPORTED_NOT_REPRODUCED | No | GATE-C04-ARCHIVE, GATE-C04-INDEPENDENT-RERUN, GATE-C04-ESTIMANDS, GATE-C04-VALIDATION |
| `claim:C05_VENDOR_CALIBRATION` | PLANNED | UNVALIDATED | NO_DATA | No | GATE-C05-AUTHORITY, GATE-C05-ACQUISITION, GATE-C05-BINDINGS, GATE-C05-PREREGISTRATION, GATE-C05-DATA |

Engineering implementation and deployment status stay out of scientific Results;
current delivery-axis status lives in `delivery-axis-ledger.yaml` (2026-08-25.1)
and appears only in the authoring annex.

## Authoring-only annex

Non-canonical engineering context for auditability, never scientific findings: the
delivery axes delivery:B02–delivery:B12 and delivery:B14 are merged to the private
preview main (through d5fee649a, 2026-08-24); delivery:B13 remains a conditional
refusal by design; delivery:B12's cap-scope adaptive source remains a standing typed
refusal, with the corpus's only individualized threshold
(peng_zhu_2020_participant_median) implemented at the sessionization step instead.
Selectable runtime values at that revision include five retention-set values, eight
reconstruction strategies, eight grouping values, and two interval-quality values,
counting defaults — a count of runtime enum values, not of independent published
methods. Defect history (including the pre-fix Parry–Toth and EYES arm anomalies
recorded in `thesis.md` §2) is excluded from Results permanently; pre-fix numbers
are never cited as measurements.
