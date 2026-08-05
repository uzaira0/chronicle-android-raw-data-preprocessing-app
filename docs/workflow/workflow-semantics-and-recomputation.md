# Harmonizing Pipeline Meaning, Execution, and Presentation

## 1. Executive summary

The former fixed total is accidental. It is the count of functions that happened to be declared as
`Step`s, not a defensible count of scientific stages, cache boundaries, user decisions, or
provenance claims. Replacing it with another target count would repeat the mistake.

Chronicle should instead have one typed **semantic operation/artifact DAG** and derive four
different projections from it:

- a seven-phase plain-language story for most users;
- a setting-impact view showing direct readers and downstream consequences;
- an execution plan showing fused units, checkpoints, cache hits, and costs; and
- a full audit/provenance view of fine operations and generated artifacts.

The semantic DAG should be finer wherever a current function mixes evidence extraction with
policy, reads independently changeable settings, or creates a reusable artifact. The physical
executor should remain free to fuse adjacent semantic operations. Checkpoints should be
selected by measured edit workloads, not by caching every operation.

The first implementation tranche should fix dependency truth before changing algorithms:
declare exact per-operation parameter reads, model support inputs and output encoders as
artifacts, validate undeclared reads, and preserve byte-exact output parity.

## 2. What the request is really asking for

The desired outcome is not merely “better step names.” It is a pipeline whose explanations at
different levels agree without pretending they are identical:

1. **Epistemic interpretation:** what was observed, repaired, inferred, defined by study
   policy, analyzed, or merely formatted.
2. **Data interpretation:** which named artifact exists before and after an operation.
3. **Semantic interpretation:** the stable scientific/data operation that transforms it.
4. **Execution interpretation:** which operations run together and which outputs are cached.
5. **Configuration interpretation:** which setting is read directly, what it can change, and
   what must be reconsidered transitively.
6. **Presentation interpretation:** what a first-time user needs to see versus an auditor.
7. **Retrospective interpretation:** what actually ran, reused a value, bypassed, lost rows,
   or generated a deliverable.

The pre-research hypothesis, alternatives, traps, and falsification conditions are frozen in
[`boundary-memory-map.md`](boundary-memory-map.md).

## 3. Current-state evidence

The repository already acknowledges that the execution groups are arbitrary memoization
groups and calls the flat step graph the DAG of record
(`web/src/lib/pipelineGraph/stepTypes.ts:12-15`). The engine nevertheless caches only those
those groups. Its key combines upstream stamps, bound options, support-file hashes,
and the source hash (`engine.ts:246-251`); all steps in an invalid unit execute in sequence.
Unit-level backdating can stop later units only after the entire invalid unit reruns
(`engine.ts:271-287`).

The query-registry view is not a complete configuration graph:

- every projected step has `knobs: []` (`stepGraph.ts:112-125`), intentionally pinned by a
  test (`stepGraph.test.ts:799-807`);
- a step displays its containing unit's status, not its own cache status
  (`GraphPanel.tsx:475-477`);
- disabled nodes are hidden and spliced out by default (`GraphPanel.tsx:241-246`);
- the UI nevertheless says it shows every step and what settings act on
  (`GraphPanel.tsx:550-558`);
- support-file loading/parsing occurs outside the graph (`browserPipeline.ts:2941-2967`);
- table projection, CSV/Parquet/SPSS encoding, plots, heatmaps, aggregates, interactive
  timeline, review summary, and bundle construction occur after the graph run; and
- 12 generated options for presentation, output, and scheduling have no graph binding
  (`graphDef.ts:490-508`).

The physical query registry and generated option registry are independent sets.
`includeCategoryColumn` is currently bound to `categorize_apps`
(`graphDef.ts:264-268`), but the value is consumed while constructing output columns in
`browserPipeline.ts`. It therefore causes needless category/downstream invalidation while the
actual output-schema effect is absent from the graph.

Performance confirms that boundary choice matters. On the 30,880-row baseline, canonical-row
construction is 139.2 ms, gap marking 53.5 ms, timezone restamping 40.3 ms, raw-date indexing
34.0 ms, the engagement walk 32.7 ms, CSV parsing 28.9 ms, and codebook joining 28.4 ms
(`docs/perf/BASELINE.md:40-58`). Fine caching can save real work, but prior full-output hashing
already cost 44% on a larger fixture (`graphTypes.ts:61-68`), so every-step materialization
would be unsafe.

## 4. The harmonized contract

Use these entities as separate, linked concepts:

| Entity | Meaning | Must not be confused with |
|---|---|---|
| `ArtifactDef` | Named, typed data state or support/output artifact | A function or UI box |
| `OperationDef` | Deterministic semantic transform with explicit ports | A cache entry |
| `CompositeDef` | Authored semantic grouping of operations | An arbitrary execution batch |
| `ParameterBinding` | Exact direct read and effect type | The whole downstream cone |
| `ExecutionGroup` | Operations fused for one runtime | A scientific stage |
| `CheckpointPolicy` | Whether/how an artifact is retained and compared | Every operation output |
| `OperationExecution` | What happened in one run | The prospective plan |
| `ViewProjection` | Audience-specific graph selection and labels | The source of truth |

`OperationDef` should add, at minimum: stable id and version; plain, short, and technical
labels; `role`; `artifactLevel`; `epistemicRole`; typed input/output ports; exact parameter and
support reads; `enabledWhen`; loss/synthetic-row/inference declarations; determinism and input
mutation contract; parent composite; executor reference; and audience tags.

`ArtifactDef` should declare schema/type, producer, consumers, observed/inferred/policy status,
whether it is ephemeral or materializable, size/cost observations, and an equality strategy
(`identity`, cheap structural comparison, supplied fingerprint, or none).

Keep P-Plan/PROV for the prospective/retrospective scientific model, but stop representing an
arbitrary execution group as the same conceptual thing as a semantic step. A composite phase
may be a nested plan step; an `ExecutionGroup` is a separate physical projection. That is the
central harmonization change.

## 5. Rules for carving at the joints

Split a current operation when at least one boundary is real:

1. its output has a stable name and type useful to another consumer;
2. its subparts read different independently changeable parameters;
3. evidence extraction becomes a policy decision;
4. inference, loss, synthesis, or schema change begins;
5. a subpart has an independently testable invariant or failure mode;
6. fan-out begins or branches later rejoin;
7. the intermediate result is a plausible recovery/reuse checkpoint; or
8. provenance users need to distinguish the claims.

Do **not** create a public operation merely because a helper function exists, a loop has
multiple statements, or a report counter is computed. Such work can remain an internal event
or audit metric.

Checkpoint selection is a different decision. For candidate artifact `a`, profile:

`expected benefit(a) = Σ edit_frequency(e) × avoided_cost(a,e) × reuse_probability(a,e)`

and compare it with retention, cloning, equality/fingerprint, serialization, and bookkeeping
cost. A semantic boundary can exist without a checkpoint; adjacent semantic operations can be
physically fused without being collapsed in the contract.

## 6. Assessment of the former physical list

Legend: **Keep** = sound semantic joint; **Split** = more than one responsibility/parameter
set; **Demote** = retain as audit/internal work, not a default story node; **Replace** = current
carrier mechanism should disappear; **Fuse** = model separately but allow one physical pass.
Proposed labels are user-facing; stable ids should initially remain as aliases.

### `parse_events` (8)

| Current step → proposed label | Verdict | Recommended joint |
|---|---|---|
| `parse_remap_config` → Read event-name corrections | Demote | A validated parameter artifact in Decisions/Audit, not a main data stage. |
| `csv_parse` → Read uploaded event file | Keep/checkpoint | Reusable decoded-source artifact; changing remap rules must not reparse bytes. |
| `drop_empty_timestamp` → Remove events without a time | Keep | Explicit irreversible quality/loss boundary. |
| `detect_device_model` → Identify device family | Keep/branch | Side-derived evidence artifact, not part of the linear row transform. |
| `resolve_preproc_datetime` → Record processing time | Demote | Runtime/provenance input; it should not look like data cleaning. |
| `build_canonical_rows` → Decode canonical events | **Split** | Decode/normalize fields and nanosecond timestamps; apply event-name remap; derive local calendar fields only after clock policy. The first artifact is the high-value checkpoint. |
| `stable_sort` → Order events by time | Keep, hide by default | A technical invariant and possible checkpoint, not a user decision. Require immutable output ownership. |
| `collect_timezones` → Find time zones in this file | Keep/branch | UI/source-summary artifact parallel to the main chain. |

### `normalize_timezones` (4)

| Current step → proposed label | Verdict | Recommended joint |
|---|---|---|
| `compute_dominant_timezone` → Find the primary time zone | Keep | Evidence derived from the file. |
| `select_timezone_strategy` → Apply the time-zone rule | **Split** | Resolve the chosen policy separately from the lossy row-selection operation; show removed-row effects explicitly. |
| `restamp_rows` → Convert event times | Keep/checkpoint | Produce the definitive standardized clock and calendar artifact. |
| `row_count_report` → Time-zone removal summary | Demote | Audit metric attached to the lossy operation. |

### `dedup_and_order` (4)

| Current step → proposed label | Verdict | Recommended joint |
|---|---|---|
| `exact_dedupe` → Remove exact duplicate events | Keep | Independent gated loss rule. |
| `count_dup_groups` → Assess simultaneous events | Demote | Quality/audit result, not a peer transform. |
| `nudge_duplicate_timestamps` → Resolve same-time event order | Keep | Separate ordering policy. Share an explicit event-precedence artifact with matching rather than binding the whole unit to stop vocabularies. |
| `mark_data_time_gaps` → Measure gaps in recorded data | Keep/checkpoint | Expensive, broadly reused derived field. |

### `app_policy` (1)

| Current step → proposed label | Verdict | Recommended joint |
|---|---|---|
| `tag_filtered_packages` → Identify excluded apps | **Replace** | Produce a package-policy membership artifact/annotation. Do not mutate raw event types as a transport mechanism. |

### `device_state_timeline` (3)

| Current step → proposed label | Verdict | Recommended joint |
|---|---|---|
| `collect_keyguard_timestamps` → Index lock-screen evidence | Keep | Independent evidence stream. |
| `walk_screen_state_machine` → Reconstruct candidate screen sessions | Keep/checkpoint | Configuration-light structural inference with explicit evidence. |
| `build_classified_sessions` → Explain how screen sessions ended | **Split** | Materialize session rows separately from threshold/support-driven end-reason classification. Threshold edits can reuse candidate sessions. |

### `reconstruct_episodes` (9)

| Current step → proposed label | Verdict | Recommended joint |
|---|---|---|
| `compute_junk_packages` → Build app-policy membership | Replace/merge | Reuse the explicit app-policy artifact; do not rediscover membership from mutated event labels. |
| `junk_blind_fold` → Restore events for matching | Remove | Becomes unnecessary when source evidence was never relabeled. This removes the tag→fold→remark circuit. |
| `build_matcher_input` → Prepare app-event evidence | **Split/Fuse** | Model (a) app-event indexing/factorization, (b) stop/background masks, and (c) matcher parameters as distinct artifacts; one pass may physically produce them. |
| `run_matcher` → Match app starts to stops | Keep/checkpoint | Compact structural pairing result with broad downstream reuse. |
| `apply_matcher_output` → Build candidate app episodes | Keep | Convert pairings to episode assertions and explicit missing-end evidence. |
| `relabel_usage_with_floor` → Finalize candidate episodes | **Split** | Separate structural episode materialization/removal from the minimum-duration policy. |
| `junk_downstream_mark` → Apply app inclusion policy | Keep after redesign | The actual policy decision belongs after reconstruction and must cite membership; avoid the word “junk.” |
| `sort_episodes` → Restore episode order | Demote | Technical invariant; retain in Audit and executor. |
| `split_concurrent` → Model overlapping app use | **Split** | Separate overlap segmentation/layering from the optional minimum-duration treatment of generated subintervals. |

### `categorize_apps` (3)

| Current step → proposed label | Verdict | Recommended joint |
|---|---|---|
| `codebook_join` → Add app reference details | Keep/checkpoint | Expensive enrichment driven only by episode identity and codebook content. |
| `derive_broad_category` → Choose a common app category | Keep | Clear coalescing rule and output field. |
| `collapse_genre` → Reconcile app genre sources | Keep | Clear agreement/disagreement rule. |

`includeCategoryColumn` belongs in the table-schema projection, not any of these operations.

### `episode_annotations` (2)

| Current step → proposed label | Verdict | Recommended joint |
|---|---|---|
| `engagement_walk` → Measure transitions between app episodes | **Split/Fuse/checkpoint** | Compute invariant gaps and app switches once; classify 30-second/custom engagement in separate cheap projections. |
| `flag_and_retain` → Flag unusual intervals | **Split/Fuse** | Long-usage flags and long-data-gap flags have different settings and meanings. Model two operations, optionally execute one pass. |

### `interval_cleaning` (3)

| Current step → proposed label | Verdict | Recommended joint |
|---|---|---|
| `blank_junk_timing` → Suppress timing for excluded apps | Keep/rehome | A field-level measurement-policy loss, not generic cleaning; preserve the reason and prior provenance. |
| `drop_selected_types` → Remove selected record types | Keep | Explicit row-loss policy with its large-gap exception. |
| `drop_zero_duration` → Remove zero-length episodes | Keep | Independent gated row-loss policy. |

### `effective_usage` (7)

| Current step → proposed label | Verdict | Recommended joint |
|---|---|---|
| `partition_credit_sessions` → Select episodes for observed-use adjustment | Keep | Explicit eligibility artifact; can remain a cheap physical helper. |
| `build_liveness_substrate` → Collect device-observation evidence | **Split/Fuse/checkpoint** | Semantically distinguish screen witnesses, reboot witnesses, and general event presence; produce them in one physical index pass. |
| `report_screen_incapable` → Assess screen-witness coverage | Rehome | Scientific data-quality assertion, not a report helper; attach to the evidence artifact and surface as a warning/badge. |
| `count_day_apps` → Measure daily app diversity | Keep, hide by default | Explicit input to the no-witness fallback. |
| `credit_sessions` → Determine supported-use intervals | **Split** | Separate session cap, device-observable intervals, screen-creditable intervals/bridge, evidence intersection, and no-witness fallback. Each has a distinct setting and audit meaning. |
| `emit_credited_rows` → Materialize supported-use intervals | Keep | Converts interval decisions to delivered row artifacts. |
| `assemble_credit_result` → Package usage-adjustment results | Demote | Replace wrapper assembly with named multi-output ports and attached metrics. |

### `observation_window` (2)

| Current step → proposed label | Verdict | Recommended joint |
|---|---|---|
| `resolve_participant_windows` → Match participants to study dates | Keep | Lookup/provenance boundary with explicit unmatched participants. |
| `filter_rows_to_window` → Keep activity inside study dates | Keep | Explicit study-policy loss boundary. |

### `attribute_person` (3)

| Current step → proposed label | Verdict | Recommended joint |
|---|---|---|
| `resolve_sharing_status` → Resolve device-sharing status | Keep | Required support-derived assertion; never silently default. |
| `build_survey_lookup` → Index user-identification answers | Keep/checkpoint | Stable support artifact keyed by participant and exact event time. |
| `attribute_rows` → Attribute activity to people | **Split/Fuse** | Separate default/kids-shell inference, survey override, and target/non-target/unresolved classification for truthful provenance. One pass can execute them initially. |

### `day_coverage` (3)

| Current step → proposed label | Verdict | Recommended joint |
|---|---|---|
| `inject_placeholders` → Represent observed days with no activity | Keep/rehome | Synthetic-row operation; mark generated rows explicitly and keep separate from cleaning. |
| `build_raw_date_index` → Find dates with recorded events | Keep/checkpoint | Expensive evidence artifact reusable across study-window/coverage edits. |
| `build_coverage_table` → Assess participant-day coverage | **Split/Fuse** | Build the participant-day spine, classify days, then validate/summarize. Study-date edits need not rebuild raw-date evidence. |

### `score_compliance` (2)

| Current step → proposed label | Verdict | Recommended joint |
|---|---|---|
| `accumulate_attribution_minutes` → Total identified and unidentified minutes | Keep/checkpoint | Threshold-independent numerator/denominator artifact. |
| `score_days` → Assess attribution completeness | **Split** | Compute percentage/zero-use status separately from threshold pass/fail, so threshold edits are cheap. |

### `outputs` (1)

| Current step → proposed label | Verdict | Recommended joint |
|---|---|---|
| `assemble_result` → Collect result datasets | Demote/expand sinks | Retain a typed result manifest, but add the real table projection, CSV, Parquet, SPSS, aggregate, plot, heatmap, timeline, review-summary, provenance, and bundle sinks to the semantic graph. |

The likely result is more audit operations, fewer default user phases, and a measured subset
of durable physical checkpoints. None of those quantities is a target or an
acceptance criterion.

## 7. A clearer taxonomy for preprocessing and cleaning

Use two independent classifications rather than one `preprocess / clean / analyze / output`
label.

**Artifact level** answers “what kind of data is this?”

1. uploaded bytes and support files;
2. decoded source records;
3. typed canonical events;
4. standardized ordered events;
5. evidence indexes;
6. candidate app/screen intervals;
7. enriched and policy-adjusted intervals;
8. study-scoped person/day assertions; and
9. delivery datasets and files.

**Operation role** answers “what are we doing to it?”

- ingest/validate;
- standardize/repair;
- reconstruct/infer;
- enrich/annotate;
- apply measurement policy;
- analyze/assess; and
- publish/encode.

“Cleaning” should be reserved for declared quality repair or removal (missing timestamps,
exact duplicates, selected invalid records). App exclusion, minimum duration, concurrency,
screen-gated crediting, and study windows are **measurement policies**, not neutral cleaning.
The matcher and screen state machine are **reconstruction/inference**, not preprocessing in the
same sense as CSV decoding. Categorization and attribution are **enrichment/assertion**.

The default user story can then be seven stable phases:

1. **Import and verify data** — read files and report unusable input.
2. **Standardize the event timeline** — clocks, duplicates, ordering, and gaps.
3. **Reconstruct activity** — infer app episodes and screen sessions.
4. **Apply measurement rules** — decide exclusions, minimums, overlaps, and supported use.
5. **Add app and person context** — categories, engagement, and attribution.
6. **Assess study coverage** — study dates, missing days, and completeness.
7. **Create deliverables** — tables, statistics, plots, timelines, and provenance.

## 8. Configuration-impact model

Every generated option should have a declared effect class:

- `source_selects`: chooses or enables a support artifact;
- `enables`: controls whether a semantic operation contributes an output;
- `tunes`: changes a scientific/measurement rule;
- `projects`: changes fields or rows in a delivery dataset;
- `formats`: changes encoding/rendering only; or
- `schedules`: changes runtime parallelism without changing scientific results.

For a setting, distinguish four derived relations:

1. **Direct read** — code consumes this exact value.
2. **Must reconsider** — transitive operations whose input stamp may change.
3. **May change result** — semantic impact cone, possibly stopped by value equality.
4. **Changes presence/schema/format only** — output impact, not measurement impact.

Examples of the desired explanation:

- `minimumUsageDuration`: directly changes “Apply minimum-duration rule” and, separately,
  “Apply minimum to overlap segments”; it reuses matched candidate episodes.
- `complianceThresholdPercent`: directly changes only “Classify attribution completeness”;
  minute totals and percentages remain reusable.
- `includeCategoryColumn`: changes the app-output schema only; it does not rerun the codebook
  join or alter episode values.
- `parallelMaxWorkers`: changes scheduling only; it has no scientific downstream cone.
- `useFilterFile`: selects an app-policy source and changes the post-reconstruction inclusion
  decision; matcher inputs should remain unchanged under the proposed evidence-preserving
  design unless background-app policy independently requires them.

The complete proposed direct-impact map is below. Options share a row only when they genuinely
feed the same semantic operation; downstream consequences are derived from artifact edges.

| Option(s) | Proposed direct reader/effect | Class | Upstream result that should remain reusable |
|---|---|---|---|
| `studyName` | Stamp study identity into delivery datasets and manifest | `projects` | All scientific data values |
| `processAppUsage` | Enable the app-activity branch and its dependent deliverables | `enables` | Standardized event timeline |
| `processScreenUsage` | Enable candidate screen-session reconstruction and screen deliverables | `enables` | Standardized event timeline |
| `selectedTimezone`, `timezoneHandling` | Resolve clock policy; select/convert event rows | `tunes` | Decoded typed events before clock/calendar projection |
| `deduplicateExactRows` | Remove exact duplicate events | `enables` | Clock-standardized events |
| `correctDuplicateEventTimestamps` | Resolve same-time event order | `enables` | Deduplicated events |
| `interactionTypeRemap` | Apply event-name corrections | `tunes` | Parsed/typed source records |
| `sameAppInteractionTypesToStopUsageAt`, `otherInteractionTypesToStopUsageAt` | Build event-precedence and matcher stop masks | `tunes` | Indexed/factorized app events |
| `useFilterFile` | Select the app-policy source; identify and later suppress/exclude listed apps | `source_selects` | Candidate episodes from policy-neutral matching |
| `useAppsForcingScreenOpenFile` | Select kept-awake evidence used by screen end-reason classification | `source_selects` | Candidate screen sessions |
| `useBackgroundAppsFile` | Select background-app policy used in matcher masks and overlap segmentation | `source_selects` | Indexed/factorized app events |
| `useAppCodebook` | Enable the codebook source and app-reference enrichment | `source_selects` / `enables` | Candidate/policy-adjusted episodes |
| `allowStopEventReuse`, `useActivityStoppedAsFallback`, `applyThresholdToFallback`, `longDurationThresholdHours`, `proximityIntervalSeconds` | Configure start/stop pairing | `tunes` | Indexed app-event evidence and masks |
| `minimumUsageDuration` | Apply the base episode-duration rule and supply the threshold to optional overlap-segment treatment | `tunes` | Matched candidate episodes; segmented overlaps before their floor |
| `modelConcurrentUsage` | Enable overlap segmentation/layer assignment | `enables` | Candidate app episodes |
| `applyMinimumUsageDurationToConcurrentSubintervals` | Apply the duration rule to generated overlap segments | `tunes` | Segmented overlap intervals |
| `customAppEngagementDuration` | Classify custom engagement starts from invariant inter-episode gaps | `tunes` | Gap/switch basis |
| `longUsageDurationThresholds` | Classify long-usage quality flags | `tunes` | Enriched episode rows |
| `longDataTimeGapThresholds` | Classify long-gap flags and set the large-gap exception for selected-type removal | `tunes` | Measured event gaps; input to each cheap policy projection |
| `interactionTypesToRemove` | Remove selected record types subject to the gap exception | `tunes` | Annotated intervals/events |
| `filterZeroDurationSessions` | Remove zero-length usage episodes | `enables` | Episodes before this loss rule |
| `screenUsageAutoLockTimeoutSeconds`, `screenUsageAutoLockToleranceSeconds`, `screenUsageManualLockMaxTailGapSeconds`, `screenUsageKeyguardNearStopSeconds` | Classify candidate screen-session end reasons | `tunes` | Candidate screen sessions and evidence indexes |
| `enableScreenGatedCrediting` | Enable the supported-use measurement branch | `enables` | Policy-adjusted app episodes and device evidence |
| `creditedSessionCapMinutes` | Cap candidate usage intervals | `tunes` | Selected eligible episodes |
| `deviceLivenessGapToleranceMinutes` | Derive device-observable intervals | `tunes` | Raw device-witness index |
| `autoLockBridgeSeconds` | Derive screen-creditable intervals across short lock gaps | `tunes` | Screen-witness index |
| `noWitnessMinDayApps` | Apply the no-screen-witness fallback | `tunes` | Evidence-intersected intervals and daily app counts |
| `addNoActivityPlaceholderDays` | Synthesize observed-day/no-activity rows | `enables` | Raw participant-date index and usage rows |
| `enableStudyWindowFilter` | Enable participant-window resolution and row filtering | `enables` | Measurement rows and parsed study-date lookup |
| `enablePersonAttribution` | Enable sharing/survey lookup and person-attribution policies | `enables` | Study-scoped rows and parsed attribution inputs |
| `enableDayCoverage` | Build/classify the participant-day coverage spine | `enables` | Raw date index and parsed study dates |
| `enableComplianceScoring` | Enable attribution-completeness outputs | `enables` | Attributed study rows and parsed sharing/enrollment inputs |
| `complianceThresholdPercent` | Classify precomputed attribution percentages as pass/fail | `tunes` | Attribution minute totals and percentages |
| `includeCategoryColumn` | Select app-output columns | `projects` | Codebook-enriched rows |
| `enablePlotting`, `includeFilteredAppUsageInPlots` | Enable plot-data projection and choose included rows | `projects` / `enables` | Final app/screen datasets |
| `enableActivityHeatmap` | Enable heatmap projection/rendering | `enables` | Final app/screen datasets |
| `exportPlotsAsSvg` | Encode plot scenes as SVG deliverables | `formats` | Plot scenes/data |
| `enableAggregates`, `aggregateShape` | Enable aggregate tables and choose their layout | `projects` / `enables` | Final scientific datasets |
| `enableParquetExport` | Encode projected tables as Parquet | `formats` | Projected output tables |
| `enableSpssExport` | Encode projected tables as SPSS | `formats` | Projected output tables |
| `enableInteractiveTimeline` | Build the timeline scene and HTML deliverable | `projects` / `enables` | Final app/screen datasets |
| `parallelProcessing`, `parallelMaxWorkers` | Schedule file-level work | `schedules` | Everything scientific; cache identity must ignore them |

Add a development-time `Proxy` around options/support access during each operation and fail a
test on undeclared reads. Static declarations alone tend toward both missing dependencies
(wrong reuse) and broad dependencies (excess recomputation); execution tracing is an
appropriate completeness oracle. Keep declarations as the portable contract and compare the
trace against them.

## 9. Checkpoints and minimal recomputation

Initial **candidates to benchmark**, not commitments:

1. parsed raw rows;
2. typed timestamp/base-event records before event-name remapping;
3. standardized ordered events with gap fields;
4. parsed, validated support artifacts keyed by content;
5. indexed app-event evidence before matcher policy masks;
6. matcher pairings/candidate app episodes before duration and inclusion policies;
7. candidate screen sessions before end-reason thresholds;
8. codebook-enriched base episodes before output-column selection;
9. invariant inter-episode gaps/switches before engagement thresholds;
10. raw participant-date and device-witness indexes;
11. attribution minute totals before the compliance threshold; and
12. projected output tables before encoding into CSV/Parquet/SPSS.

Do not use one generic deep-equality strategy. Compact pairings, policy objects, counters, and
date indexes can be compared cheaply. Large row arrays should normally receive a new stamp
when recomputed; an operation may supply a fingerprint only if it can produce it cheaply as
part of work already being done. Cache values may also be dropped while retaining dependency
metadata, as memory pressure requires.

Make ownership explicit before introducing more cache boundaries. A cached artifact must be
immutable to downstream consumers, or an operation must declare exclusive ownership and
produce a new identity. In-place sorts and shared row objects otherwise make reuse incorrect.

Benchmark edit sequences, not just cold runs: remap only, timezone only, minimum duration only,
concurrency-floor only, codebook only, engagement threshold only, flag threshold only, each
crediting rule, study dates only, attribution inputs only, compliance threshold only, and each
output toggle. Report `reused through <artifact>` and measured avoided milliseconds.

## 10. DAG and UI design

Replace the `Steps / Units` scale toggle with task-oriented projections derived from the same
contract:

- **Overview** — seven phases and final deliverables.
- **Decisions** — settings/support inputs → direct operations → affected artifacts/outputs.
- **Data lineage** — named artifacts, schema/loss/synthetic/inference badges, and producers.
- **Execution** — physical groups, checkpoints, cache state, duration, rows, and next reusable
  boundary.
- **Audit** — every semantic operation, assertion, parameter binding, and run record.

Use compound nodes with authored parentage. Collapsing a group must preserve proxy edges to
the real underlying paths; never rebuild an unrelated coarse graph. Keep disabled operations
visible but faded in Decisions/Audit, with `off because <setting>` and their alternate path.
Overview may omit them, but omission must be a projection choice rather than graph splicing
presented as the full truth.

Selecting a setting should show:

- current value and plain-language meaning;
- direct readers in a strong color;
- downstream “may change” cone in a lighter color;
- fields/files whose presence, schema, or values may change;
- the last reusable checkpoint before each direct reader;
- estimated rerun work from the most recent execution; and
- “does not change” facts, especially for scheduling and formatting options.

Selecting an operation should show `What it uses`, `What it produces`, `Why it exists`,
`Settings`, `Can remove or synthesize data?`, `Observed / inferred / policy`, and last-run
status. Technical ids and implementation units belong under an expandable developer section.
The existing React Flow + dagre stack is sufficient for a first implementation; no UI-library
replacement is justified.

## 11. Prior-art research and candidate comparison

The discovery pass deliberately began with generic, name-neutral queries covering nested
workflow graphs, materialization cost, parameter impact, incremental computation, scientific
provenance, data-policy separation, and multi-level graph visualization. The exact query log
and the excluded recalled candidates are preserved in the grep-weights artifact. Shortlisted
concepts were then checked against primary specifications, official documentation, source
repositories, and papers.

| Candidate | Verified useful idea | Fit and lifecycle | Decision |
|---|---|---|---|
| PROV + P-Plan | Plans/steps/variables are prospective; activities/entities describe a run and its derivations. P-Plan models steps consuming/producing variables. | Already embedded in this repo; stable semantic foundation. [PROV](https://www.w3.org/TR/prov-o/), [P-Plan model](https://www.opmw.org/model/p-plan/) | **Keep/adapt.** Use for semantic hierarchy and run provenance, not physical cache groups. |
| CWL 1.2 | Typed input/output ports, data-link dependencies, labels/docs, conditional steps, and nested subworkflows; processes are function-like. It explicitly leaves checkpointing out of scope and warns about destructive input mutation. | Maintained open standard, Apache-2.0, but centered on portable tools/files and external runners. [Specification](https://www.commonwl.org/v1.2/Workflow.html) | **Borrow contract patterns; reject runtime adoption.** |
| Workflow Run RO-Crate | Packages actual inputs, parameters, software, outputs, and run actions at multiple granularities. | RO-Crate 1.3 is the current long-term release. The Workflow Run profile is Apache-2.0, numbered 0.5, and currently declares conformance to a draft RO-Crate base, so I treat it as evolving. [RO-Crate](https://www.researchobject.org/ro-crate/specification.html), [Workflow Run profile](https://www.researchobject.org/workflow-run-crate/profiles/workflow_run_crate/ro-crate-preview.html) | **Optional export alignment later.** Do not make the internal engine depend on a draft profile. |
| OpenLineage | Separates job, run, and dataset facets; parent runs preserve hierarchy; field lineage distinguishes direct value derivation from indirect filter/sort/conditional impact; temporary intermediate datasets may be hidden by consumers. | Actively released, Apache-2.0; optimized for cross-system event transport and dataset jobs. [Object model](https://openlineage.io/docs/spec/object-model), [column lineage](https://openlineage.io/docs/spec/facets/dataset-facets/column_lineage_facet/) | **Borrow impact vocabulary; reject dependency/event backend.** |
| Salsa | Tracks actual input reads, memoizes pure functions, backdates unchanged results, and uses durability as a change-frequency optimization. | Active Rust project, dual MIT/Apache-2.0, but its repository still calls it work in progress and its database model is invasive here. [Algorithm](https://salsa-rs.github.io/salsa/reference/algorithm.html), [repository](https://github.com/salsa-rs/salsa) | **Adapt exact-read tests/backdating ideas; do not adopt the crate now.** |
| Bazel/build-system model | Separates actions from artifacts; cache keys include declared inputs/outputs/environment; content-addressed outputs are reusable. Research shows missing deps cause incorrectness and broad deps cause excessive rebuilds. | Mature model but wrong runtime domain. [Bazel caching](https://bazel.build/remote/caching), [perfect dependencies paper](https://arxiv.org/abs/2007.12737) | **Borrow dependency completeness and action/artifact separation.** |
| Beam/Dataflow fusion | The authored transform graph can differ from the optimized execution graph; fusion avoids materializing every intermediate, while explicit materialization can break fusion where worthwhile. | Distributed managed runtime, not applicable as a dependency. [Pipeline lifecycle](https://docs.cloud.google.com/dataflow/docs/pipeline-lifecycle) | **Adopt the semantic-versus-physical distinction.** |
| Materialization research | Select artifacts under a storage budget using future workload reuse and runtime cost, rather than materializing every operator. | Directly supports profiling-based checkpoint choice. [SIGMOD 2022 paper record](https://www.dfki.de/web/forschung/projekte-publikationen/publikation/12706) | **Adopt the decision method, not its ML system.** |
| Provenance/compound-graph visualization | Semantic zoom, roll-up/drill-down, predecessor/successor highlighting, animated continuity, and proxy/meta edges preserve paths through collapsed groups. Manual and automatic abstractions can disagree about retained data artifacts. | Research patterns; compatible with current UI stack. [AVOCADO](https://pmc.ncbi.nlm.nih.gov/articles/PMC6027754/), [compound graph framework](https://journals.sagepub.com/doi/10.1177/14738716251383173), [abstraction comparison](https://arxiv.org/abs/1605.06669) | **Adopt authored compound hierarchy and multiple projections.** |

No candidate provides Chronicle's required combination of offline browser execution,
typed-array/Rust-WASM calls, study-specific epistemic distinctions, current LinkML ontology,
and byte-parity guarantees. A small internal extension is therefore better than a new workflow
runtime dependency.

## 12. Decision ledger

| Decision | Status | Rationale | Revisit trigger |
|---|---|---|---|
| Do not target a replacement count | Adopt | Counts should emerge from defensible contracts and projections. | None; only boundary rules may change. |
| Make artifacts and semantic operations the source of truth | Adopt | Required for exact dependency, lineage, loss, and checkpoint reasoning. | A verified standard fits the browser/runtime contract better. |
| Separate semantic composites, execution groups, and UI projections | Adopt | They answer different questions and currently contradict one another. | Evidence that one representation serves all user tasks. |
| Preserve stable ids with aliases/versioned replacements | Adopt | Existing provenance, tests, and documentation cite them. | Only at a deliberate schema major version. |
| Keep current engine initially | Adopt | It already provides deterministic DAG execution, cache stamps, and parity. | Profiled architecture cannot meet edit-latency/memory goals. |
| Add exact per-operation read auditing | Adopt | Prevents both stale reuse and broad invalidation. | Type/code generation can prove completeness statically. |
| Model support parsing and every material output sink | Adopt | Current “every step” claim is otherwise false. | None. |
| Replace filtered-event relabel/fold transport | Proposed, high value | Separates source evidence from policy and can preserve matcher results on filter edits. | Golden/parity analysis reveals intentional label-sensitive matcher behavior. |
| Select checkpoints empirically | Adopt | Large artifacts make generic step caching risky. | None. |
| Keep React Flow + dagre for first UI tranche | Adopt | Already integrated, MIT-licensed, and capable of derived compound projections. | Required interactions prove infeasible or layout fails measured usability. |
| Do not adopt CWL/OpenLineage/Salsa as runtime dependencies | Adopt now | Their best concepts fit; their execution/deployment assumptions do not. | Major distributed/server execution requirement emerges. |

## 13. Migration plan and risks

**Tranche 0 — lock behavior.** Preserve all golden outputs, option defaults, current ids, and
provenance validation. Add an id-alias/version map before removing or replacing a step.

**Tranche 1 — make dependencies truthful without changing execution.** Extend LinkML/step
definitions with artifacts, roles, epistemic class, exact parameters, effects, and audience
labels. Add the option/support read-audit harness. Bind `includeCategoryColumn` to output
projection and represent all output/runtime settings.

**Tranche 2 — complete the graph.** Add support-source parse/validation artifacts and actual
delivery sinks. Keep them collapsed by default. Generate the graph, documentation, config
impact index, and provenance definitions from the same contract.

**Tranche 3 — carve semantic composites while preserving physical units.** Start with
`build_canonical_rows`, `build_classified_sessions`, matcher preparation, minimum-duration
policy, concurrent segmentation, engagement basis, `credit_sessions`, attribution, coverage,
and compliance thresholding. Initially fuse new operations inside existing execution groups
to isolate semantic correctness from cache changes.

**Tranche 4 — benchmark and introduce selected checkpoints.** Replay representative setting
edits on small/30k/123k fixtures, record artifact size/clone/equality cost, and promote only
positive candidates. Add memory-budget/LRU behavior.

**Tranche 5 — ship the projections.** Default to Overview; add Decisions, Data lineage,
Execution, and Audit. Test tasks with first-time users: explain what a setting changes, find
where rows were removed, identify observed versus inferred data, and predict what will rerun.

Main risks are silent mutation across caches, incomplete option reads, schema/provenance churn,
new checkpoint overhead, and renaming away domain meaning. Mitigate them with immutable
artifact contracts, traced-read gates, aliases and schema versions, edit-sequence benchmarks,
golden parity, and user testing. The filtered-app redesign has the highest semantic risk and
should be implemented behind parity-focused characterization tests.

## 14. Smoke and proof plan

The design is ready to build only when these proofs are specified and automated:

1. **Contract count/bijection:** every executable semantic operation, artifact port, support
   source, and material sink appears exactly once in generated artifacts.
2. **Dependency completeness:** for each operation, an instrumented run observes no undeclared
   option or support read; every declared direct read is exercised by at least one scenario.
3. **Option-impact snapshots:** all generated options have an effect class, direct readers,
   downstream artifacts, and a known no-op/disabled case where applicable.
4. **Invalidation matrix:** change one option at a time and assert which operations recompute,
   which checkpoints are reused, and where backdating stops propagation.
5. **Scientific parity:** existing golden outputs remain byte-identical through semantic
   refactors; intentional algorithm changes require separate reviewed goldens.
6. **Cross-engine parity:** Python, TypeScript, and Rust/WASM paths retain current cell/byte
   equivalence for all covered configurations.
7. **Artifact immutability:** development tests freeze or fingerprint cached inputs and fail on
   downstream mutation.
8. **Loss/conservation:** every row deletion, field suppression, synthetic row, and interval
   split has a typed reason and reconciled counts.
9. **Provenance validation:** prospective hierarchy, exact parameters, generated artifacts,
   and retrospective executions conform to LinkML/SHACL; old ids resolve through aliases.
10. **Performance gate:** no-change warm runs regress by no more than an agreed budget, and
    targeted edit traces demonstrate measured upstream work avoided. Set the numeric budget
    only after collecting the current trace baseline.
11. **Memory gate:** peak browser memory and cache retention stay within an explicit budget on
    the 123k-row and multi-file scenarios.
12. **UI truth tests:** collapsed edges retain reachability; disabled nodes remain explainable;
    step status is never inherited from a physical group; selecting every setting reaches the
    correct fields/files; and the “every step” claim is removed until the graph is complete.

The proof bundle should include the generated semantic graph, physical execution plan,
configuration-impact matrix, edit-trace benchmark, golden parity results, provenance validation,
and a human-readable change ledger. That bundle—not a new node count—is the acceptance
criterion.
