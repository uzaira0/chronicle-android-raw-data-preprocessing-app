# `delivery:B03`–`delivery:B05` foundational semantics — grep-weights preflight

**Status:** pre-search hypothesis inventory; not scientific evidence

**Prepared:** 2026-08-11

**Private baseline:** `origin/main` at
`312ef636e3bd03d63bc5d8b2fd84b86fa5251cbc`

**Feature-branch starting point:** `080801a0232a6a2c97daba0c986094f6cf48fe08`

**Scope:** `delivery:B03` micro-use classification, `delivery:B04` minimum-duration
exclusion, `delivery:B05` screen-session construction, the requested Schoedel 2026
app-reconstruction arm, and the EYES conformance obligations that travel with this milestone.

No external discovery or primary-source verification was performed before freezing this file.
Local repository observations below establish the integration baseline; every methodological
interpretation remains a hypothesis until the companion research decision record verifies it.

## 1. Disambiguation

### Exact decisions under investigation

- `delivery:B03` asks whether and how an already reconstructed app-use episode is labelled
  **micro-use**. Classification is not automatically exclusion.
- `delivery:B04` asks whether an episode below a declared duration floor is retained, retained but
  excluded from a measure, or removed. This is a loss/inclusion rule, not an episode boundary rule.
- `delivery:B05` asks which device events construct a screen session and how every start, stop,
  orphan, lock, unlock, shutdown, and query-boundary disposition is exposed.
- The requested Schoedel 2026 arm is provisionally an **app-episode reconstruction** rule rather
  than a micro-use or screen-session policy: open on an app launch and close at the next launch or
  screen-off.
- EYES conformance concerns the reference device-state segmentation and its tagged app-usage
  fragments. It must not be collapsed into the B05 screen-session selector merely because both read
  screen and lock events.

### Plausible interpretations that must remain separate

1. **Micro-use as a descriptive label** versus **micro-use as an analytical exclusion**.
2. A fixed threshold specified by an author versus a breakpoint fitted from a study sample.
3. A device-level screen session versus an app-level usage episode.
4. A lock-state session versus an interactive-state interval versus an inactivity-grouped session.
5. A sub-threshold app episode versus a locked-screen glance.
6. A zero/negative-duration artifact versus a short but valid episode.
7. A screen-off event that closes an app episode versus a screen-off event that closes a device
   screen session.
8. A published method preset versus one independently selectable component of that method.

### Ambiguous names

- **Schoedel** may refer to the 2022 package-categorisation paper, the 2024 methods chapter,
  Reiter–Schoedel work, or the 2026 integrative-preprocessing paper. Only the last is the candidate
  reconstruction arm in this milestone.
- **Session** may mean an app episode, device-unlocked interval, screen-on interval, grouped run,
  ESM window, or vendor summary.
- **Micro-use**, **micro-usage**, **check**, **glance**, **pickup**, **short session**, and
  **fragment** are not presumed synonyms.
- **Minimum duration** may apply before or after concurrency splitting, same-app collapse, window
  clipping, or cleaning. The stage is part of the decision.

### Local baseline observations (repository evidence, not recalled prior art)

- The canonical delivery requirements are in `docs/paper/delivery-axis-ledger.yaml`; they are not
  the separate twenty-one-component rubric.
- `classify_episode_durations` currently nulls `duration_seconds` and `duration_minutes` for an app
  row below `minimum_usage_duration`, while retaining its boundaries and row
  (`rust/chronicle_chrono_kernel_wasm/src/pipeline_v2_incremental.rs`). It emits no explicit
  micro-use label or threshold receipt at row level.
- `minimum_usage_duration` is a persisted integer browser option with default 60 seconds. The
  current tooltip describes blanking below the threshold and keeping the row
  (`web/schema/chronicle-local-contract.linkml.yaml`).
- `filter_zero_duration_sessions` is a separate boolean that deletes exactly zero/negative rows;
  it is not a micro-use policy.
- The screen path already separates policy-neutral skeleton inference from end-reason
  classification. Starts are `Screen Interactive` variants; stops include non-interactive/screen
  off variants; the classifier records reason, confidence, stop type, last activity, tail gap,
  forcing-app evidence, and source-row lineage.
- No explicit screen-session construction strategy or micro-use classification enum exists in the
  current contract.

## 2. Canonical answer from prior knowledge

These are hypotheses, not verified facts.

### High-confidence primitives

- B03 and B04 must be separate axes. A row can be classified as micro-use while remaining present
  and credited, or it can be excluded without erasing the fact that reconstruction produced it.
- The raw duration and boundaries must survive any classification. Classification should add an
  explicit category/reason and provenance rather than overwrite the observed interval.
- B04 needs an explicit disposition vocabulary. A scalar threshold alone cannot distinguish
  `retain`, `exclude-from-measure-but-keep-row`, and `drop-row`.
- B05 must operate on device-level evidence and retain source-row lineage. App-reconstruction
  strategies must not silently redefine screen-session boundaries.
- Default behavior must preserve the detached `312ef63` scientific output bytes, while new receipts
  may make the newly requested decision observable in dedicated evidence.
- Every non-default method cell must execute, be structurally unavailable, or refuse with a stable
  typed reason; silent ignore is unacceptable.

### Medium-confidence composition choices

- Introduce a `MicroUseClassificationPolicyId` with a no-classification/default arm, one or more
  source-named fixed-threshold arms, and a controlled custom-threshold arm only if it can be kept
  scientifically distinct from the existing B04 floor.
- Emit row fields such as classification, threshold, operator, and evidence status, plus a run
  receipt with category counts. Classification should influence comparison/exports without
  changing duration by itself.
- Introduce a `MinimumDurationPolicyId` whose default reproduces the existing “blank timing, keep
  row” behavior and whose other arms are limited to source-supported dispositions.
- Evaluate duration at a declared checkpoint. The likely canonical checkpoint is after episode
  materialization but before optional concurrency segmentation and interval cleaning; any second
  floor on generated subintervals remains separately receipted.
- Introduce a `ScreenSessionConstructionStrategyId` only if current primary sources prove more than
  one behaviorally distinct, implementable device-session rule. Otherwise expose the existing rule
  as an explicit versioned strategy and refuse unsupported named methods.
- Add the Schoedel arm to the existing episode-reconstruction strategy enum, with native resume
  opening and native screen-off/next-launch closure, rather than hiding it inside B05.
- Treat EYES as a complete binding vector/adaptation with explicit options and conformance status,
  not as a certified preset merely because `eyes_complement` is selectable.

### Assumptions requiring verification

- A five-second threshold is a published micro-use **label**, not an exclusion rule.
- A roughly twenty-one-second breakpoint was fitted with two-cluster k-means and should not become
  a universal fixed constant without the original fitting population and operator.
- A fifteen-second definition exists in older micro-usage work but may refer to an interaction
  construct or sampling trigger rather than a post-reconstruction label.
- The 2026 Schoedel rule closes on the next retained app launch or screen-off, but boundary
  inclusivity, same-package behavior, orphan handling, retention vocabulary, and query-tail
  behavior are not yet verified.
- Strict screen-interactive→screen-noninteractive pairing and lock/unlock session construction are
  distinct published rules on Chronicle’s observable vocabulary.
- Published screen-session methods may omit enough failure semantics that some named arms must be
  source-faithful partial replays or explicit refusals rather than invented completions.

## 3. Adjacent and competing options

| Candidate idea | Relationship | Likely strength | Likely limitation | Recall confidence | Decisive check |
|---|---|---|---|---|---|
| Fixed duration threshold | B03 classifier | Simple, auditable, portable | Threshold may be study-specific | high | Verify operator, unit, stage, and label in primary method |
| Source-fitted two-cluster breakpoint | B03 classifier | Preserves an empirical derivation | Population-dependent; fitting may be unstable | medium | Recover exact features, transform, initialization, and reported cut |
| Duration bins | B03 descriptive alternative | More information than binary label | May be sampling strata rather than a construct | high | Verify whether bins define use or only select prompts |
| Mixture model / change-point | B03 learned alternative | Can model multimodality | Adds unverified modelling and nondeterminism | medium | Find a direct published screen-use implementation and replay proof |
| Participant-specific quantile/median | B03/B12 adjacent | Adapts to individual behavior | Confounds B03 with adaptive-threshold B12 | medium | Reject from B03 unless source makes it the micro-use construct |
| Keep row and add exclusion flag | B04 | Auditable and reversible | Downstream consumers must honor the flag | high | Prove raw and included totals side by side |
| Blank timing but retain boundaries | Existing B04 behavior | Preserves row identity and baseline | Null duration can be misread as missing reconstruction | high | Add explicit disposition/reason and backward-compatibility oracle |
| Drop sub-threshold row | B04 alternative | Matches some analysis filters | Erases reconstructability unless lineage artifact retains it | high | Require source support and attrition receipt |
| Set duration to zero | B04 alternative | Easy aggregation | Conflates exclusion with observed zero | high | Reject unless a source explicitly defines this semantics |
| Screen interactive→noninteractive pairing | B05 strategy | Direct observable boundaries | Missing stops/query tails remain unresolved | high | Primary code/paper plus orphan fixture |
| Unlock→lock session with locked glances | B05 strategy | Separates sessions and glances | Android-version/keyguard vocabulary constraints | medium | Verify exact event predicates and partial cases |
| Complement device-state model | EYES/B05 adjacent | Represents idle/gap/shutdown/glance explicitly | Not equivalent to a screen-session table | high | Keep as separate device-state binding unless source says otherwise |
| Inactivity-gap screen session | B05 adjacent | Works when stop events are sparse | Threshold and retroactive endpoint vary | high | Verify whether it constructs screen or interaction sessions |
| Vendor-preformed screen interval | B05 input alternative | Avoids raw pairing | Not present in Chronicle input; semantics opaque | high | Refuse unless typed input contract exists |
| Generic custom event lists | B05 configuration | Flexible | Allows scientifically incoherent, unversioned methods | high | Prefer named strategies; reject arbitrary production arm |
| Existing Rust state machine | B05 baseline | Rich evidence and lineage already implemented | Its scientific lineage and failure policy are not named | high | Freeze default bytes; source-map every branch |

Adjacent fields worth checking after unbiased discovery: behavioral bout ontologies, web/activity
idle-session construction, operating-system lifecycle conformance tests, event-sourced interval
materialization, survival/censoring notation, and deterministic classification pipelines.

## 4. Commonly confused items

- **Micro-use threshold vs session gap:** one classifies a completed interval; the other merges or
  separates intervals.
- **Micro-use vs glance:** a short unlocked app episode can be micro-use; a glance is normally a
  device-state/lock construct and may contain no app episode.
- **Minimum duration vs zero-duration cleanup:** a valid four-second episode is not a duplicate
  timestamp artifact.
- **Minimum duration vs maximum-duration cap:** B04 and B06 have different scientific effects and
  receipts.
- **Minimum duration vs sampling window:** 30-minute ESM windows or prompt delays do not define
  episode duration.
- **Screen on/off vs lock/unlock:** display interactivity and user-present/keyguard state can diverge.
- **Screen session vs app session:** device-level total usage can be episode-free.
- **Screen-off closure in an app strategy vs B05:** the same raw event can feed different semantic
  branches without making the branches equivalent.
- **EYES pickups export vs pickups proper:** the reference export may contain every qualifying block;
  only ACTIVE rows are pickups under its internal naming.
- **Source-equivalent vs controlled derivative:** a complete vector may reproduce a method; crossing
  one source component with another strategy is an experiment, not that named method.

## 5. Fuzzy or uncertain recall

- “Contextual Experience Sampling of Mobile Application Micro-Usage” may define 15 seconds as
  micro-usage; exact title, operator, and role need source verification. **Remembered claim needs
  source; applicability uncertain.**
- Morrison’s reported 21.4-second value may be the intersection of two fitted clusters rather than a
  direct k-means centroid boundary. **Operator and derivation uncertain.**
- Okoshi/Cyberoception may label `<5 s` rather than `≤5 s`, and may classify before or after pairing
  into 30-minute windows. **Boundary inclusivity uncertain.**
- Schoedel 2026 may say “next event” rather than “next launch,” and screen-off might first partition
  device sessions that later clip app episodes. **Rule composition uncertain.**
- Parry–Toth’s session/glance builder may rely on keyguard shown/hidden in addition to screen events,
  with Android-version exclusions. **Exact vocabulary uncertain.**
- Current B05 end-reason thresholds may derive from legacy Chronicle behavior rather than a single
  published method. **Lineage uncertain.**
- EYES production still may assign a device-state close reason to a trailing fragment whose true
  endpoint is the app episode’s observed stop. **Current implementation concern requiring direct
  proof.**
- EYES primary/secondary concurrency and configurable duration/device-state thresholds may not be
  reachable from the production selector. **Completeness uncertain.**

## 6. Best traps

1. Implement B03 by reusing `minimum_usage_duration`, causing a label choice to delete or blank data.
2. Treat the existing 60-second locked study setting as a published universal micro-use threshold.
3. Turn every remembered literature number into an enum arm before proving it is a construction
   parameter rather than a reporting bin, prompt delay, or cleaning rule.
4. Fit a threshold on the same participant data used for outcome analysis without a frozen derivation
   or independent validation.
5. Let B04 erase boundaries or lineage, making excluded episodes impossible to audit.
6. Apply the floor twice—before and after same-app collapse or concurrency segmentation—without
   declaring which population each application targets.
7. Call null duration “micro-use,” even when it resulted from filtering, missing closure, or package
   exclusion.
8. Expose arbitrary opener/closer event lists for screen sessions and label them published methods.
9. Reuse the B05 screen-session selector to change app-episode screen-off behavior.
10. Describe EYES ACTIVE-only output as full reference replay when tagged non-ACTIVE fragments,
    concurrency, parameters, or end-reason provenance remain unported.
11. Regenerate goldens after a red default-compatibility test instead of diagnosing semantic drift.
12. Run dependency evidence while another writer is changing Rust or workflow dependencies.
13. Use private participant exports to infer missing method semantics or decide B13 feasibility.
14. Claim source conformance from synthetic separation alone.

## 7. Historical and dead ends

- Generic web-style 30-second idle timeouts are useful historical comparators but are not evidence
  for an Android micro-use classifier.
- “Any interaction within N seconds” rules from network flows or browser sessions solve different
  observability problems and cannot be imported without adaptation.
- The removed Python engine is historical parity evidence only. New semantics must live in the
  Rust/WASM engine; reintroducing a Python or TypeScript preprocessing path is rejected.
- A binary `filter_zero_duration_sessions` control cannot stand in for B03 or B04.
- User-named settings snapshots are not scientific presets and cannot certify a source method.
- Vendor Screen Time/Digital Wellbeing aggregates cannot validate raw-event episode truth; they are
  comparison surfaces with their own hidden construction.
- The absent historical B02 commits are not a basis for inferring B03–B05 design.

## 8. Search handoff

### Proper nouns and spellings to verify after unbiased discovery

- Schoedel / Schödel, Sust, Sterner, Goretzko — 2026 integrative preprocessing
- Okoshi et al. — Cyberoception
- Morrison et al. 2018
- Ferreira et al. 2014 — contextual experience sampling / mobile application micro-usage
- Parry and Toth 2025
- Reiter and Schoedel 2024/2026
- PULSE 2025
- EYES / ACOI-UofSC reference code
- Android `UsageEvents.Event`, `ACTIVITY_RESUMED`, `ACTIVITY_PAUSED`,
  `SCREEN_INTERACTIVE`, `SCREEN_NON_INTERACTIVE`, keyguard and shutdown/startup events

### Generic discovery queries frozen before searching

1. `raw mobile lifecycle events short foreground interval classification reproducible method`
2. `passive smartphone sensing define micro usage duration operator threshold source code`
3. `mobile application episode minimum duration retain exclude drop provenance`
4. `android event log screen session start stop lock unlock algorithm`
5. `smartphone screen on off interval reconstruction unmatched event failure policy`
6. `mobile sensing device session glance pickup formal definition implementation`
7. `event stream interval classification fitted breakpoint deterministic replay`
8. `usage episode duration threshold sensitivity analysis participant outcomes`
9. `screen interaction session reconstruction open dataset reference implementation`
10. `event sourced interval materialization censoring orphan duplicate collision semantics`
11. `behavioral bout ontology minimum duration qualifying evidence gap provenance`
12. `mobile operating system lifecycle event pairing conformance test corpus`
13. `passive sensing preprocessing screen session package app episode open source`
14. `short digital interaction taxonomy classification reliability validation`
15. `device state complement segmentation active idle gap glance reference implementation`
16. `screen off next foreground event application usage reconstruction method`
17. `deterministic mixture breakpoint short duration mobile interaction`
18. `minimum duration exclusion denominator bias passive sensing study`

### Discovery-category coverage plan

1. Standards/specifications/conformance: Android event API and lifecycle semantics; event-time and
   provenance standards. Conformance suite availability is unknown.
2. Papers/reference algorithms: direct micro-use, minimum-duration, screen-session, app-episode,
   and device-state methods.
3. Maintained open source: raw-event builders, sessionizers, and reference ports.
4. Datasets/fixtures/registries: public raw Android logs or synthetic conformance corpora; method
   identifier and package-filter registries.
5. Platforms/APIs/deployment: Android event vocabulary and browser/WASM limits; no new deployment
   platform is being selected.
6. Adjacent fields: activity bouts, web idle sessions, event sourcing, censoring.
7. Registries/security: package/license/advisory checks for any adopted implementation; otherwise
   not applicable to the scientific rule itself.
8. Maintainer evidence: issues, code comments, release notes, and version history for shortlisted
   implementations.
9. Hardware/runtime: not a method-selection driver; browser portability and deterministic WASM
   execution remain required.
10. Historical/deprecated: superseded Android event constants, abandoned collectors, and earlier
    threshold traditions.

### Primary-source targets

- Original papers and supplements.
- Author-owned repositories and pinned source revisions.
- Official Android API source/documentation for event identities and availability.
- Public datasets or exact synthetic fixtures shipped by authors.
- Package/project license files and release metadata.
- Existing Chronicle corpus entries only as a discovery/deduplication map; final claims must point
  to the primary source they summarize.

### Falsification questions

1. Does any source explicitly make micro-use classification alter inclusion, or are all known uses
   descriptive labels?
2. Is the reported threshold strict `<`, inclusive `≤`, rounded, or derived after transformation?
3. Is duration measured on raw app intervals, reconstructed episodes, grouped sessions, or clipped
   ESM windows?
4. Can a fitted classifier be replayed without the original participant distribution and random
   state?
5. Does a source define failure behavior for missing pause/screen-off, duplicate starts/stops,
   reboot, query boundaries, and equal timestamps?
6. Are screen and lock events observable in every supported Chronicle/Android version?
7. Is the Schoedel screen-off rule direct, or inherited through a delegated device-session builder?
8. Does any B05 candidate produce behavior distinct from the current Rust state machine on a
   canonical fixture?
9. Can every accepted method emit exact row/source lineage and a typed refusal when its required
   signal is absent?
10. Does the EYES reference require non-ACTIVE tagged fragments or concurrency in the reported
    surface selected for this product?

### Do not search as a discovery query

To avoid anchoring, do not begin broad discovery with: Schoedel, Schödel, Okoshi, Cyberoception,
Morrison, Ferreira, Parry, Toth, PULSE, EYES, ACOI-UofSC, Chronicle, Usage Logger, or
Culverhouse. Use those names only after the generic discovery pass to verify or falsify recalled
candidates.

### Prioritized verification queue

1. Verify direct published micro-use operators, thresholds, inclusivity, stage, and intended effect.
2. Verify the 2026 Schoedel app-reconstruction rule and locate any reference code/data.
3. Verify screen-session construction vocabularies and failure semantics in the strongest methods.
4. Inspect current EYES reference code/options/output contract against the production arm.
5. Determine which candidate arms are source-native, controlled derivatives, or must refuse.
6. Freeze the axis vocabularies, compatibility matrix, row/run receipts, and default-compatibility
   oracle before product-code edits.

## Current best hypothesis

B03 should be a non-destructive, explicitly receipted classification layer; B04 should be a
separate inclusion/disposition layer that preserves excluded-row lineage; B05 should make the
existing device-session builder explicit and add only source-proven alternative strategies.
Schoedel belongs in app reconstruction, not B05. EYES remains a separately conformed complete
binding rather than a screen-session shortcut.

## Highest-risk unknowns

- Whether remembered thresholds classify, exclude, sample, or merely report.
- Exact operator inclusivity and processing stage.
- Reproducibility of any fitted micro-use breakpoint.
- Whether published screen-session methods specify enough failure behavior to execute without
  invention.
- Schoedel 2026 source/code availability and its exact use of screen-off.
- Remaining EYES output/reason/concurrency/parameter deviations.

## Search should change my mind if...

- a primary method proves classification and exclusion are intentionally one inseparable operator;
- a maintained source implementation exposes a better complete, portable screen-session contract;
- the 2026 Schoedel rule is not behaviorally distinct from an existing strategy;
- no source supports an executable B05 alternative beyond the current state machine; or
- EYES reference evidence shows the product’s intended reported surface is already complete and
  independently conformant.
