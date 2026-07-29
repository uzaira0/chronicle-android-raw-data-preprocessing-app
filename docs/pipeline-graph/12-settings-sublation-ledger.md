# Settings Sublation Ledger — every existing setting → its place in the new ontology

Acceptance test set by the owner (2026-07-14): the design stands only if EVERY setting of
(a) this app's browser pipeline, (b) the consuming research pipeline, and (c) EYES / Parry
& Toth / Culverhouse maps to an element of the new ontology (node / knob / strategy /
policy rule / support file / output contract / runtime config). This ledger enumerates all
of them. Sources: the LinkML options contract (all 44 BrowserProcessingOptions slots), the
research pipeline's engine-invocation knobs and post-engine steps, and the prior-art
glossaries (docs 08/09).

Legend for the "maps to" column: node ids from doc 08; *strategy* = named reconstruction
algorithm (doc 11 change #2); *rule* = ordered app-policy/interval-quality rule row;
*runtime* = execution scheduling, orthogonal to pipeline semantics; *sink* = declared
presentation/export node.

## A. This app's options contract (all 44 slots)

| Setting | Maps to |
|---|---|
| `study_name` | run metadata → lineage ledger + report headers |
| `process_app_usage` | gates the `reconstruct_episodes` output branch |
| `process_screen_usage` | gates the `device_state_timeline` screen-session output |
| `allow_stop_event_reuse` | tune on strategy `chronicle_lifecycle_matcher` |
| `use_activity_stopped_as_fallback` | tune on `chronicle_lifecycle_matcher` |
| `apply_threshold_to_fallback` | censoring contract: over-threshold fallback ⇒ RIGHT-CENSORED interval (missing-end-of-usage), not a real close — expansion #7 |
| `long_duration_threshold_hours` | `interval_quality` flag threshold |
| `correct_duplicate_event_timestamps` | `dedup_and_order` |
| `deduplicate_exact_rows` | `dedup_and_order` |
| `selected_timezone`, `timezone_handling` | `normalize_timezones` (with `validate_clock` preserving raw timestamp + original timezone upstream) |
| `use_filter_file` (+ filter support file) | `app_policy` rules: disposition = relabel-filtered (kept, flagged) |
| `use_apps_forcing_screen_open_file` (+ file) | config of strategy `native_screen_end_reason_v1` on `device_state_timeline` (held-open display witnesses) |
| `use_background_apps_file` (+ file) | `app_policy` rule with stage = reconstruction, disposition = background-continue (episode stays open to its own stop; overlap → concurrency split) — exactly why rules carry a STAGE field |
| `use_app_codebook` (+ file), `include_category_column` | `categorize_apps` |
| `enable_plotting`, `include_filtered_app_usage_in_plots`, `enable_activity_heatmap`, `export_plots_as_svg`, `enable_interactive_timeline` | sink nodes (presentation) downstream of `effective_usage` / `device_usage` |
| `enable_aggregates`, `aggregate_shape` | named output contracts (daily/weekly summaries; the pickups metric feeds from `device_usage`) |
| `enable_parquet_export`, `enable_spss_export` | sink encoders (format metadata on output contracts) |
| `minimum_usage_duration` | tune on `reconstruct_episodes` (null-duration-keep-row = flag-don't-drop; recorded in lineage) |
| `apply_minimum_usage_duration_to_concurrent_subintervals` | same tune, scoped to concurrency sub-intervals |
| `filter_zero_duration_sessions` | `interval_quality` drop rule (device-artifact class) |
| `custom_app_engagement_duration` | tune on `reconstruct_episodes` (engagement window) |
| `long_usage_duration_thresholds` | `interval_quality` multi-threshold flag columns |
| `long_data_time_gap_thresholds` | observability overlay: gap flags surfaced via `day_coverage` |
| `screen_usage_auto_lock_timeout_seconds`, `…_tolerance_seconds`, `…_manual_lock_max_tail_gap_seconds`, `…_keyguard_near_stop_seconds` | tunes on strategy `native_screen_end_reason_v1` (`device_state_timeline`) |
| `parallel_processing`, `parallel_max_workers` | runtime (graph scheduler), not pipeline semantics |
| `same_app_interaction_types_to_stop_usage_at`, `other_interaction_types_to_stop_usage_at` | closer vocabulary of `chronicle_lifecycle_matcher` |
| `model_concurrent_usage` | gates the concurrency split in `reconstruct_episodes` (primary/secondary layers) |
| `interaction_types_to_remove` | `parse_events` whitelist knob (the P&T event-whitelist analog) |
| `interaction_type_remap` | `parse_events` vendor remap |
| `proximity_interval_seconds` | tune on `chronicle_lifecycle_matcher` (intra-app teardown grace — NOT EYES proximity; doc 09) |
| `add_no_activity_placeholder_days` | `day_coverage` placeholder spine |
| `plot_only_target_child_data` | sink filter consuming `attribute_person` output |
| `datetime_of_preprocessing` (internal) | lineage/report stamping |

## B. Research-pipeline features and knobs (the wiring gap being ported)

| Feature/knob | Maps to |
|---|---|
| Eligibility filtering (which participants/devices enter) | roster/eligibility support file → `observation_window` |
| Pre-engine dedup/sort, ms rendering, dtype normalization | `parse_events` + `dedup_and_order` |
| Engine matcher knobs (teardown grace, min duration) | same contract slots as §A |
| Post-engine filtered-app relabel | `app_policy` rule (disposition = relabel, stage = post-reconstruction) |
| Kids-shell launcher relabel (Fire tablets) | `app_policy` CONDITIONAL rule (condition on device class — expansion #5) |
| Screen-gated usage credit: enable flag | gates `effective_usage` |
| — credited-session cap (minutes) | tune on `effective_usage` truncation |
| — device-liveness gap tolerance | tune on `device_state_timeline` liveness |
| — auto-lock inference window | tune on screen-off inference (state timeline) |
| — no-witness day min-app rule | `effective_usage` policy conditioned on `screen_witness_coverage` (recorded as policy + evidence basis, per doc 11) |
| — long-interval cap disable (set to ∞) | `interval_quality` rule row |
| Shared-tablet stream variant (long cap, no screen-gating) | stream-conditional preset (conditional bindings, expansion #5) |
| Shared-tablet foreground state machine over raw events (separate vocabulary) | a named `reconstruct_episodes` strategy — expansion #6 exists precisely for algorithm-level variants |
| Person attribution (shared devices, survey-driven) | `attribute_person` + sharing table + survey-attribution support file |
| Non-target raw-row deletion variant | stage = raw `app_policy`/attribution rule, disposition = exclude, with lineage entries |
| Compliance scoring (per-study formulas) | `score_compliance` + enrolled/expected-device denominator support file |
| Study-window filtering | `observation_window` + study-dates support file |
| Missing-day accounting + coverage invariant | `day_coverage` (invariant = hard error, doc 07 §6) |

## C. Prior-art tools (settings level; concept level in docs 08/09)

| Tool setting | Maps to |
|---|---|
| P&T event whitelist | `interaction_types_to_remove` complement |
| P&T start-only forward pairing | strategy `parry_toth_forward_pair_2025` |
| P&T bracket clipping + background discard | `effective_usage` (mask = brackets, action = clip/drop) |
| P&T keep-launchers doctrine | `app_policy` (launcher = metadata, disposition = keep) |
| P&T totals/IDs/sequences/repertoires/trajectories | `device_usage` + named output contracts (doc 11 change #12) |
| EYES triplet binding (2 s), T=∞ closes, inference tags | strategy `eyes_triplet_v1` (tags → lineage) |
| EYES 60 s glue / ≥3 h gap / 10 s reconcile / 1 s reboot-adjacency / 5 s pickup floor+fill | tunes on `device_state_timeline` + `device_usage` (complement-based `state_inference`) |
| EYES SHUTDOWN>IDLE>GAP precedence | fusion precedence table (doc 10) |
| EYES FAU | `effective_usage` (episodes ∩ ACTIVE) |
| Culverhouse 1 s same-app collapse | episode merge-gap tune |
| Culverhouse bad_apps per-package 10-min cap (42 pkgs) | `app_policy` cap rules |
| Culverhouse long_3h/long_6h flags + action + scope=all | `interval_quality` (applies to episode AND session AND glance rows) |
| Culverhouse partial-day (parent-only 12 h rule) + DST day flags | `day_coverage` + conditional binding |
| Culverhouse timezone modal filter | `timezone_handling` mode |

## Verdict

Every enumerated setting maps. Nothing in the three columns required a new ontology
element beyond the expansions already adopted (docs 09/11) — and two settings are direct
evidence FOR those expansions: `apply_threshold_to_fallback` needs the censoring contract,
and `use_background_apps_file` needs stage-scoped policy rules. Residue is unchanged:
presentation internals of the prior tools only. EYES/P&T preset EXACTNESS remains gated on
fixture conformance (doc 09) — the mapping above is the semantic account, not the parity
proof.
