# `delivery:B06` maximum-duration policy — grep-weights preflight

**Status:** frozen pre-search hypothesis inventory; local observations are repository evidence, while
all recalled external claims remain hypotheses until the companion research decision verifies them
from primary sources.

**Frozen:** 2026-08-11, before any B06-specific external discovery query was run.

**Local evidence snapshot:** commit
`7093e7bf20a568fdb970fc485d219ca3334384c9`. A local locator of the form
`git:<commit>#<path>::<selector>` names a blob plus a stable schema key, function, type, or UI ID.
No dirty-worktree line offset is evidence for that commit.

This artifact follows the repository's `research-before-building` and `grep-weights` gates. It is
deliberately not an implementation specification. The verified decision, candidate ledger, and
source relations belong in
[`b06-maximum-duration-research-decision.md`](b06-maximum-duration-research-decision.md); executable
acceptance belongs in
[`b06-maximum-duration-proof-matrix.md`](b06-maximum-duration-proof-matrix.md).

## 1. Disambiguation

### Exact object under investigation

`delivery:B06` asks Chronicle to make **maximum-duration handling explicit, parameterized, and
receipted**. The primary unit is a bounded or candidate app-usage episode produced by the selected
reconstruction strategy. The decision must identify, independently:

1. the stage at which a maximum applies;
2. the eligible target unit and scope;
3. the threshold and unit;
4. the comparator, including equality;
5. the disposition when the comparator matches;
6. whether an observed but over-threshold close is distinguished from a truly absent close;
7. the relation to the selected source method or project baseline;
8. applicability or refusal for each reconstruction strategy;
9. row, run, receipt, lineage, aggregation, and persistence effects; and
10. default scientific-payload compatibility and causal build/provenance/container identity drift.

The delivery axis is not automatically identical to `component:C15 maximum_duration` in
`docs/paper/measurement-component-rubric.yaml`. The delivery ledger explicitly declares the two
systems non-isomorphic. B06 may eventually map to C15, but the mapping must be recorded rather than
assumed.

### Plausible interpretations that must remain separate

- **Reconstruction plausibility bound:** reject a candidate close because the implied interval is
  longer than a threshold.
- **Missing-close timeout:** synthesize an end at `start + threshold` when no acceptable close was
  observed.
- **Post-reconstruction quality policy:** retain, flag, cap, truncate, blank, exclude, or drop an
  already-bounded interval.
- **Credit cap:** limit a downstream credited intersection without changing the reconstructed
  episode.
- **Long-duration annotation:** flag a row while leaving its interval and aggregate eligibility
  unchanged.
- **App- or package-specific bound:** apply a policy only to declared apps or classes.
- **Session-grouping maximum:** constrain a higher-level grouped session, not an app episode.
- **Daily plausibility/exclusion rule:** exclude a participant/day with excessive total use or one
  extreme episode; this is not an episode disposition.
- **Inactivity timeout:** end or split after silence; this is not a maximum total episode duration.
- **Observation-window censoring:** handle an interval crossing a query or study boundary; this is
  component C13-adjacent and is not B06 by default. It is also not `delivery:B14`, whose authority
  is day-boundary and timezone semantics.
- **Statistical outlier handling:** winsorize or transform analysis values after measurement; this
  cannot silently become event-to-episode semantics.

### Ambiguous names

- **Cap** may mean truncate the interval to the threshold, replace its duration with another cap,
  reject the interval, or merely constrain downstream credit.
- **Timeout** may be a missing-close synthetic endpoint, an inactivity gap, or a processing/network
  timeout.
- **Maximum session duration** may target a device-use bout, app episode, grouped cross-app session,
  website visit, participant-day, or analysis record.
- **Drop/remove/exclude** may remove the row, retain a row but exclude it from totals, null timing,
  or exclude a participant/day.
- **Long session** may be a diagnostic category with no action.
- **Observed close** may refer to a native event, a next-event proxy, an end-of-stream anchor, or a
  synthesized clock instant.
- **Source-native** must mean the same source method, signal, target unit, stage, comparator,
  threshold, and disposition—not merely the same number.

### Local baseline observations

The following are repository observations, not evidence that the behavior is scientifically
preferable:

- The canonical delivery ledger defines B06 as an explicit, parameterized, receipted
  maximum-duration policy and marks it `pending`
  (`git:7093e7bf20a568fdb970fc485d219ca3334384c9#docs/paper/delivery-axis-ledger.yaml::delivery:B06`).
- The local contract exposes `long_duration_threshold_hours`, defaults it to 12 hours, and describes
  long sessions as “flagged,” although the matcher uses the value to decide whether a close is valid
  (`git:7093e7bf20a568fdb970fc485d219ca3334384c9#web/schema/chronicle-local-contract.linkml.yaml::slots.long_duration_threshold_hours`).
- The browser exposes a numeric 1–48 hour input in half-hour steps
  (`git:7093e7bf20a568fdb970fc485d219ca3334384c9#web/src/components/SessionDetectionCard.tsx::SessionDetectionCard#long-duration-threshold-input`). Browser persistence accepts any finite
  binary64 numeric option—including below/above-range and off-grid `1.25`—while nonfinite or
  non-number input takes the generated default; its sanitizer does not reproduce the UI range/step
  (`git:7093e7bf20a568fdb970fc485d219ca3334384c9#web/src/lib/settingsPersistence.ts::sanitizeOptions`).
- The TypeScript boundary converts hours to nanoseconds with JavaScript binary64 multiplication by
  `3_600_000_000_000`; that legacy compatibility path does not itself define canonical decimal
  spelling, fractional-nanosecond refusal, or overflow provenance
  (`git:7093e7bf20a568fdb970fc485d219ca3334384c9#web/src/lib/rustPipelineRuntime.ts::buildRustV2Options.long_duration_threshold_ns`). The Rust workflow declares the nanosecond field
  as a direct reader of `match_app_episodes`
  (`git:7093e7bf20a568fdb970fc485d219ca3334384c9#docs/METHODS.md::match_app_episodes.long_duration_threshold_ns`).
- The matcher accepts a nonnegative duration when it is **less than or equal to** the threshold;
  therefore the intervention comparator is strict `>` and equality survives
  (`git:7093e7bf20a568fdb970fc485d219ca3334384c9#rust/chronicle_app_usage_matcher/src/lib.rs::is_valid_duration`).
- Normal same-app and other-app stops always enforce the threshold. An `Activity Stopped` row is a
  fallback candidate only when `use_activity_stopped_as_fallback` is true; if admitted, it enforces
  the threshold only when `apply_threshold_to_fallback` is true. Both default true
  (`git:7093e7bf20a568fdb970fc485d219ca3334384c9#rust/chronicle_app_usage_matcher/src/lib.rs::is_compatible_open_start_for_stop` and
  `::sparse_stop_mode;git:7093e7bf20a568fdb970fc485d219ca3334384c9#rust/chronicle_app_usage_matcher/src/lib.rs::sparse_stop_enforces_threshold`). Stop-event reuse selects
  one versus every compatible opener, while the re-resume proximity comparison can keep a fallback
  opener alive and reads the immediately preceding same-app event
  (`git:7093e7bf20a568fdb970fc485d219ca3334384c9#rust/chronicle_app_usage_matcher/src/lib.rs::match_sorted_app_usage_update_indices_with_proximity`).
- The end-of-stream sweep also uses the threshold: it may accept the last observed event as an end
  when within the threshold, or leave the episode missing when it is beyond the threshold
  (`git:7093e7bf20a568fdb970fc485d219ca3334384c9#rust/chronicle_app_usage_matcher/src/lib.rs::SparseOpenStarts.finish_open_starts`).
- The resulting missing row is materialized as `End of Usage Missing` with no stop or duration. Its
  generic close reason is `Unobserved`, and its lineage-search reason is `no-qualifying-stop`; neither
  currently distinguishes an observed over-threshold candidate from no observed candidate
  (`git:7093e7bf20a568fdb970fc485d219ca3334384c9#rust/chronicle_chrono_kernel_wasm/src/pipeline_v2_incremental.rs::materialize_candidate_episodes_in_place.missing_indices`).
- The scalar is consumed only by the fused-matcher strategy. The fixed published reconstruction
  arms at the pinned baseline use their own rules and constants
  (`git:7093e7bf20a568fdb970fc485d219ca3334384c9#rust/chronicle_chrono_kernel_wasm/src/pipeline_v2_incremental.rs::match_app_episodes_with_strategy`).
  Schoedel scientific authority is the tracked B03–B05 decision and proof contract.
- The pinned Chronicle GESIS adapter is not exact real arithmetic at the top of the i64 timestamp
  domain: it tests next-global deltas with `saturating_sub` and constructs the timeout with
  `saturating_add`. For starts above `i64::MAX−600000000000`, the endpoint is `i64::MAX`, not exact
  mathematical `start+600 s`
  (`git:7093e7bf20a568fdb970fc485d219ca3334384c9#rust/chronicle_app_usage_matcher/src/lib.rs::match_app_usage_gesis_with_openers_indices_core`).
- `long_usage_duration_thresholds` is a separate flag-and-retain annotation family. The
  `culverhouse_trim_and_log` interval-quality policy is a separate post-reconstruction quality axis.
  The 360-minute screen-gated credit cap limits a side-by-side derived output. None is automatically
  B06 (`git:7093e7bf20a568fdb970fc485d219ca3334384c9#docs/workflow/prior-art-vocabulary.md::heading["Culverhouse chronicle-preprocessed-cleaning (downstream trim-and-log)"]` and
  `git:7093e7bf20a568fdb970fc485d219ca3334384c9#web/schema/chronicle-local-contract.linkml.yaml::slots.long_usage_duration_thresholds`).
- There is no B06-specific relation enum, applicability decision, row evidence, standalone receipt,
  runtime artifact, semantic projection, or proof matrix.

### Scope boundaries

In scope:

- app-episode maximum-duration policies and source-specific close timeouts that must be represented
  distinctly;
- exact threshold/comparator/stage/disposition provenance;
- source-native, source-aligned adapter, controlled derivative, project-native, not-applicable, and
  refused relations;
- behavior across every executable reconstruction strategy and opener crossing;
- effects on B03 classification, B04 disposition, B05/Schoedel/EYES semantics, B07 credit, package
  policy, grouping, aggregates, review, lineage, and persistence; and
- default scientific-payload/canonical-projection, causal identity-drift, and cold/warm/browser
  closure.

Out of scope except as adjacent or rejected evidence:

- choosing a universally “correct” duration;
- treating any threshold as a platform fact or clinical cutoff;
- B07's credited-session cap;
- B11 inactivity grouping;
- implementing B12 learned/adaptive thresholds (their supply/refusal boundary with B06 still has to
  be frozen here);
- implementing B14 day-boundary/timezone splitting (its downstream crossing with B06 still has to
  be frozen here);
- observation/query-window censoring, which is neither B06 nor B14;
- generic statistical winsorization after the measurement is built; and
- changing product code during this research gate.

## 2. Canonical answer from prior knowledge

### High-confidence primitives

1. A maximum-duration policy is not a scalar. At minimum it is
   `(target, stage, threshold, unit, comparator, disposition, relation)`.
2. A synthetic timeout end, rejection to missing, truncation to the threshold, truncation to a
   different cap, flag-only annotation, aggregate exclusion, and row deletion are scientifically
   different outcomes.
3. Equality must be explicit and integer-exact at the runtime unit; display rounding must never own
   the comparison.
4. Source-specific reconstruction constants stay inside the source method unless a separate
   controlled-derivative override is selected.
5. A source-native label requires target, stage, comparator, threshold, and disposition agreement,
   not numerical resemblance.
6. An over-threshold observed close must remain auditable. It cannot be collapsed without evidence
   into the same state as “no close was observed.”
7. Default omission must preserve the current Chronicle researcher-visible scientific output and
   persistence semantics exactly.
8. Every non-default action needs stable row and run evidence, input/source lineage, counts, and a
   requested/effective/applicability receipt.
9. A strategy that owns a fixed maximum or no maximum must either expose that native behavior,
   explicitly accept a derivative override, or refuse the requested crossing.
10. Threshold sensitivity is an empirical analysis, not proof that one value is correct.

### Medium-confidence composition choices

- Freeze a project-owned `maximum_duration_policy` vocabulary separate from the numeric threshold.
- Use `strategy_native` as the relation-preserving control, while a separately named Chronicle
  compatibility arm preserves today's fused-matcher behavior. Whether either is the omitted/default
  wire value needs detached scientific-projection plus causal-identity proof.
- Represent source-specific maximum behavior in strategy receipts even when it is not selectable as
  a generic B06 override.
- If a generic post-reconstruction policy is built, derive qualification once from immutable raw
  episode bounds and fan out dispositions, mirroring B04's separation of qualification from action.
- Expose raw versus effective duration and aggregate eligibility explicitly instead of inferring
  disposition from nulls.
- Keep fixed source policies immutable; create a new controlled-derivative binding to tune them.

### Assumptions requiring verification

- Whether published mobile methods use 2-, 5-, 6-, 10-, 12-, or 24-hour bounds, and whether those
  values target app episodes, screen bouts, participant-days, or something else.
- Whether a remembered five-hour app-session cutoff deletes rows, rejects a session, nulls timing,
  or acts only in analysis.
- Whether a remembered six-hour source rule nulls rows strictly above six hours and whether equality
  survives.
- Whether a remembered 600-second rule is a fixed synthetic endpoint after missing repair rather
  than a post-reconstruction cap.
- Whether a remembered trim-and-log pipeline flags at equality but acts only above the threshold and
  truncates to a different package cap.
- Whether direct mobile trace sensitivity studies publish exact cap grids and output effects.
- Whether source code, revision identity, licensing, fixtures, and participant data are available.
- Whether any standard defines the necessary provenance fields without defining the mobile policy.
- Whether browser/WASM numeric and persistence boundaries need additional validation beyond existing
  nanosecond integers.

## 3. Adjacent and competing options

| Recalled option | Relationship | Likely strength | Likely limitation | Confidence | Confirm or eliminate with |
|---|---|---|---|---|---|
| Keep current Chronicle 12-hour close rejection | Compatibility baseline | Existing scientific behavior | Fused-only, misleading prose, no specific receipt | high local | Detached scientific oracle, causal identity, and exact matcher path |
| Strategy-native maximum/no-maximum | Source control | Preserves method identity | Heterogeneous and sometimes non-tunable | high | Primary paper/code per strategy |
| Synthetic close at `start + max` | Missing-close timeout | Bounded output, explicit instant | Invents an endpoint and duration | high | Source code and close-reason fixture |
| Truncate stop to threshold | Post-reconstruction cap | Preserves some credit | Changes observed bound | high | Primary action and equality rule |
| Truncate to a smaller package cap | Quality action | Retains brief plausible use | Threshold and replacement value differ | medium | Primary cleaning code |
| Flag and retain | Annotation | Lossless, sensitivity-friendly | Does not protect headline totals | high | Output and aggregation contract |
| Retain row, exclude aggregate | Auditable exclusion | Preserves bounds | Consumers may ignore eligibility | high | Source or project-owned decision |
| Blank timing, keep row | Compatibility disposition | Preserves row identity | Conflates implausibility with missingness | high local | Exact baseline oracle |
| Drop row with exclusion lineage | Destructive source action | Matches some filters | Audit artifact becomes mandatory | high | Primary source and attrition receipt |
| Package-specific cap | B10/quality crossing | Accounts for navigation/media/system apps | Policy can become anecdotal or label-sensitive | medium | Public registry/code and package semantics |
| Quantile or fitted cap | B12-adjacent | Adapts to observed distribution | Dataset-dependent identity and leakage | medium | Reproducible fit protocol/data |
| Robust statistical winsorization | Analysis-layer alternative | Familiar outlier treatment | Wrong stage for event construction | high | Reject unless target is analysis value |
| Observation-window right censoring | C13 adjacent; not B14 | Avoids invented tail | Does not resolve an internal long episode | high | Window-policy source and censor receipt |
| Screen/device-active intersection | B07/EYES adjacent | Uses independent state evidence | Different construct and capability | high | Signal-capability and source rule |
| No cap | Explicit control | Never hides legitimate long use | Propagates instrumentation failures | high | Source evidence and sensitivity arm |

## 4. Commonly confused items

- Chronicle's `long_duration_threshold_hours` close-rejection path is not its
  `long_usage_duration_thresholds` flag family.
- Chronicle's 360-minute B07 credited-session cap truncates a derived sidecar; it does not change
  the reconstructed app episode.
- A source method's missing-close timeout is part of reconstruction; a generic B06 quality action
  on an already-bounded row is downstream.
- A ten-minute inactivity end is not a ten-minute maximum total duration.
- A long daily total exclusion is not an episode cap.
- A five-hour cutoff inherited because another paper called a duration “very long” is not a
  validated natural constant.
- A package-specific navigation-app cap is not a global app-episode rule.
- B04 minimum-duration disposition and B06 maximum-duration disposition can share an abstraction
  shape without sharing qualification, target, or source identity.
- EYES ACTIVE-only fragments and Schoedel app-within-screen intervals already have source/derivative
  boundaries; a B06 override must not silently rewrite either.
- GESIS-style force-close provenance and Chronicle `End of Usage Missing` are opposite dispositions
  even when both use a maximum number.

## 5. Fuzzy or uncertain recall

- **Five-hour Android app-session cutoff** — remembered claim needs source; exact comparator,
  deletion/nulling action, code revision, and license uncertain.
- **Six-hour nulling in a recent integrative preprocessing pipeline** — remembered claim needs source;
  exact target rows, equality, and whether this occurs before or after summaries uncertain.
- **A grid of notification filters and long-session caps in an objective-versus-self-report study** —
  remembered claim needs source; exact cap values and action uncertain.
- **Thirty-minute phone-state bout cap with six-hour/no-cap comparators** — remembered claim needs
  source; screen-level portability to app episodes is doubtful.
- **Two-hour removal in an open usage logger** — remembered claim needs source; whether the action is
  code-only and whether equality is defined uncertain.
- **Forty-minute navigation-app limit in a Python package** — current status and canonical repository
  uncertain; likely wrong target/scope for B06 global policy.
- **Ten-hour screen episode causing participant exclusion** — target is probably participant-level,
  not B06; exact comparator/action needs source.
- **Generic standards for interval validity/provenance** — existence likely, but none recalled as a
  mobile maximum-duration conformance standard.

## 6. Best traps

1. Rename the existing scalar and call B06 complete without distinguishing stage, disposition, or
   strategy applicability.
2. Apply the 12-hour Chronicle rule to every published strategy, silently turning each into a
   derivative.
3. Call every numeric upper bound a cap and equate rejection, synthesis, truncation, blanking,
   exclusion, deletion, and annotation.
4. Treat a screen-bout threshold, participant-day exclusion, website-visit outlier, or inactivity
   timeout as source-native app-episode evidence.
5. Reuse a source number while changing its unit, target, comparator, stage, or action.
6. Hide an observed over-threshold close under generic `Unobserved` evidence.
7. Let B06 operate after B03/B04 in a way that makes qualification order-dependent.
8. Double-apply a source-native timeout plus a generic cap without a composite receipt.
9. Allow invalid persisted/direct thresholds that the browser UI itself cannot create.
10. Use floating display units for exact equality at the runtime boundary.
11. Update goldens to bless unexplained scientific drift, or preserve stale build/runtime identity to
    force whole-artifact equality.
12. Count a synthetic-fixture magnitude as scientific sensitivity evidence.
13. Present a recurring threshold as a natural, platform, clinical, or recommended constant.
14. Copy source code whose license is absent or incompatible instead of independently adapting the
    documented rule.

## 7. Historical and dead ends

- Generic 30-minute web-session inactivity conventions are useful adjacent evidence about inherited
  defaults but target gaps, not maximum episode length.
- Statistical outlier deletion and winsorization are mature but occur after the measurement and do
  not solve event-level missing-close provenance.
- Platform dashboards and vendor aggregates expose completed values without their upstream maximum
  rule; they cannot validate raw-event disposition.
- “Anything longer than a workday is impossible” heuristics are domain intuition, not a portable
  method.
- Treating the last query event as an observed end moves the missingness problem rather than solving
  it.
- A universal fixed cap is unlikely to serve navigation, video, games, calls, screen bouts, and app
  lifecycle episodes equally; package-specific heuristics do not rescue an untyped global policy.

## 8. Search handoff

### Proper nouns and spellings to verify after unbiased discovery

- Chronicle `long_duration_threshold_hours` and `End of Usage Missing`
- GESIS Methods Hub / Zerrer, Wieland & de Alwis
- Culverhouse `chronicle-preprocessed-cleaning`
- Schoedel, Sust, Sterner & Goretzko / PhoneStudy preprocessing
- Toth & Trifonova / *Somebody's Watching Me*
- Andrews, Ellis, Shaw & Piwek
- Karas et al. / Beiwe screen-time preprocessing
- Katapally & Chu
- Geyer et al. / Usage Logger
- ActivityWatch Android
- mobileDNA
- Ochoa & Revilla digital-trace multiverse
- Android `UsageEvents` documentation
- PROV-O, OWL-Time, QUDT, DDI-CDI, and VTL as possible provenance/interval hosts

### Generic discovery queries frozen before searching

The following capability-first queries were written before external discovery. Recalled candidate
names above are deliberately absent.

1. `standard specification maximum interval duration comparator truncation missing endpoint provenance conformance`
2. `measurement rule language interval upper bound equality disposition lineage standard`
3. `peer reviewed mobile device event logs implausibly long app use episode maximum duration cleaning rule`
4. `smartphone screen state event preprocessing long continuous use cap sensitivity analysis`
5. `open source mobile usage event preprocessing maximum duration truncate discard flag`
6. `reference implementation event interval maximum duration missing close timeout close reason`
7. `open smartphone event dataset malformed missing close long duration ground truth fixture`
8. `benchmark event session duration cap exact boundary comparator reproducibility corpus`
9. `mobile operating system usage event API missing foreground end retention rollover documentation`
10. `browser WebAssembly exact integer timestamp threshold persistence compatibility`
11. `digital trace meter visit maximum duration outlier handling multiverse`
12. `wearable event bout maximum duration cap censoring transferable measurement policy`
13. `software registry smartphone usage preprocessing package maximum session duration`
14. `research artifact registry mobile sensing preprocessing long duration code data`
15. `issue tracker mobile usage parser missing pause extremely long session cap`
16. `maintainer discussion screen time preprocessing outlier cap truncation false positive`
17. `low power mobile logger missing events reboot clock discontinuity duration plausibility`
18. `web runtime nanosecond timestamp exact comparison maximum safe integer browser`
19. `historical smartphone tracking software long session cutoff missing screen off`
20. `deprecated mobile usage event rollover constants previous day missing close`

### Discovery-category coverage plan

| Required category | Queries | B06 relevance |
|---|---|---|
| Standards/specifications/conformance | 1, 2 | Typed interval, comparator, provenance, refusal vocabulary; likely compose-only |
| Papers/reference algorithms/reproducibility | 3, 4, 6 | Direct mobile methods and sensitivity evidence |
| Maintained open-source implementations | 5, 6 | Exact executable stage/comparator/action and license |
| Datasets/fixtures/evaluation corpora | 7, 8 | Long/missing-close falsifiers and ground truth |
| Platforms/APIs/deployment targets | 9, 10 | Signal limits and browser/WASM boundary |
| Adjacent fields | 11, 12 | Multiverse/outlier architectures without false source equivalence |
| Registries | 13, 14 | Packages, artifacts, versions, licenses, data |
| Maintainer/community evidence | 15, 16 | Failure modes and abandoned heuristics; not final authority alone |
| Hardware/runtime/portability | 17, 18 | Missing events, clocks, exact numbers, browser portability |
| Historical/deprecated predecessors | 19, 20 | Threshold inheritance and obsolete platform semantics |

### Primary-source targets

- final peer-reviewed articles or stable accepted manuscripts;
- authors' deposited code, data, README, and revision metadata;
- canonical repositories with immutable commits, releases, and license files;
- official platform API documentation for event semantics only;
- standards-body specifications for reusable provenance/interval vocabulary;
- official package/artifact registries for version and license metadata; and
- exact local implementation paths and detached compatibility artifacts for Chronicle behavior.

Discovery pages, search snippets, reviews, and repository summaries may locate a candidate but cannot
verify its technical claim.

### Falsification questions

1. Does any source define a reusable app-episode maximum policy with exact target, stage, comparator,
   action, provenance, and executable conformance fixtures?
2. Is Chronicle's current 12-hour rule actually a flag, or does it reject a close and create missing
   end semantics?
3. Does equality survive in each candidate?
4. Does the threshold apply to normal observed closes, only missing-close fallback, every row type,
   or a later aggregate?
5. Does a source synthesize `start + max`, truncate to `max`, truncate to another cap, blank, exclude,
   delete, or only flag?
6. Can an observed over-threshold close be distinguished from no close in source output and Chronicle
   output?
7. Is the candidate app-level, screen-level, package-specific, grouped-session-level, or daily?
8. Is the value source-derived, inherited, fitted, heuristic, sensitivity-only, or project default?
9. Can the public artifacts reproduce the rule, and what inputs are missing?
10. Does the source license permit reuse, or is independent adaptation required?
11. Which Chronicle reconstruction strategies own a native maximum, explicitly have none, ignore the
    current scalar, or require refusal?
12. Can B06 qualify the same immutable raw bounds as B03/B04 without order effects?
13. Can threshold-minus-one, exact, and threshold-plus-one be represented at integer nanosecond
    precision across browser, WASM, Rust, persistence, and resumed review?
14. Does changing B06 invalidate exactly its real workflow readers and no B05/EYES-only sidecar?

### Do not search as a discovery query

Until the generic discovery pass is complete, do not use the recalled proper nouns listed above as
discovery queries. They may be queried directly only during shortlisted primary-source verification.
Also do not begin with remembered values such as `12 hours`, `6 hours`, `5 hours`, `600 seconds`, or
`30 minutes`; doing so would anchor the candidate set.

### Prioritized verification queue

1. Freeze the local Chronicle behavior and strategy-consumption matrix.
2. Run the twenty generic queries and deduplicate genuinely new candidates against the local corpus.
3. Verify direct mobile app-episode candidates from final articles plus code.
4. Verify source-specific timeout, cleaning, and nulling rules that must remain distinct.
5. Verify direct mobile screen-bout sensitivity work as adjacent evidence, not app-source arms.
6. Verify open-source candidates and exact licenses/releases.
7. Verify standards and adjacent multiverse work only for composition/proof design.
8. Resolve equality, stage, target, disposition, and unavailable artifacts for every shortlist row.
9. Freeze relation/applicability and the proof matrix before recommending any implementation.

## Current best hypothesis

B06 should not create one universal cap. It should make the current fused-matcher behavior explicit
and receipted, preserve each selected strategy's native maximum or no-maximum semantics, and allow
only separately named controlled derivatives to impose another policy. Qualification and disposition
must remain separate; source-specific timeouts and downstream quality/credit caps remain distinct.
Omitted legacy hours must retain the historically accepted finite-binary64 path, while an explicit
binding must derive one exact, baseline-equal decimal-hours/integer-ns pair or refuse without
rounding. Omission must leave the scientific output unchanged.

## Highest-risk unknowns

- Exact comparator and disposition in the remembered five- and six-hour mobile methods.
- Whether any direct method exposes rejected close lineage rather than only a final cleaned table.
- Whether a tunable cross-strategy override can be scientifically admissible or should be refused for
  all source-native bindings.
- Whether Chronicle can preserve the legacy fused matcher while adding a distinct reason for an
  over-threshold observed candidate without changing the omitted scientific output.
- Source-code licensing and public input availability for the closest candidates.

## Search should change my mind if...

- a current primary source already defines the complete typed B06 contract and conformance suite;
- a source proves that the same maximum policy is genuinely native across multiple existing
  Chronicle strategies;
- primary code contradicts the recalled comparator, stage, target, or disposition;
- no accessible primary artifact supports a candidate, in which case it must remain `Investigate`
  or be refused rather than implemented; or
- browser/WASM exactness makes the proposed nanosecond boundary unportable, requiring a different
  wire representation.
