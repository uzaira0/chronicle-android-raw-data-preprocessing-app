# Feature Inventory — engine vs consuming pipeline vs web app

Where each processing feature lives today. "Engine" = this repo's Python/Rust core.
"Pipeline" = the consuming research data pipeline (Dagster/dbt monorepo) that subprocess-invokes
this engine and bolts study logic on top. "Web" = `web/` in this repo (browser pipeline in TS).

## Already in this repo's engine (native config surface)

`DataFramePreprocessingConfig` + `PreprocessingOptions` (`src/chronicle_preprocessing_app/core/config.py`):

| Feature | Knob(s) |
|---|---|
| Session matcher (opener/closer state machine) | core algorithm (`polars_fast_path.py`, shared Rust crate) |
| Interaction-type canonicalization (`Unknown importance: N` → labels) | `ALL_INTERACTION_TYPES_MAP` |
| Duplicate-timestamp correction | `correct_duplicate_event_timestamps` |
| Proximity teardown grace | `proximity_interval_seconds` (native option) |
| Minimum-usage floor (null duration, keep row) | `minimum_usage_duration` |
| Activity-Stopped fallback (+ threshold) | `use_activity_stopped_as_fallback`, `apply_threshold_to_activity_stopped_fallback` |
| Long-duration cap | `long_duration_threshold_hours` |
| Stop-event reuse toggle | `allow_stop_event_reuse` |
| Zero-duration filter | `filter_zero_duration_sessions` |
| App-codebook category join | `use_app_codebook` (28-column unified codebook; a 5-column stub silently yields "Unknown" — fail loud) |
| App-filter file (which packages) | `use_filter_file` |
| Timezone handling (incl. convert-all-to-selected) | `TimezoneHandlingOption` enum |
| Concurrent/PiP layering + background-audio apps | `model_concurrent_usage`, `background_apps` |
| Closer vocabulary (what closes a session) | `same_app_/other_interaction_types_to_stop_usage_at` |
| Wakelock / apps-forcing-screen-open whitelist | `apps_forcing_screen_open` |
| Screen-usage session derivation (auto-lock / keyguard inference) | `derive_screen_usage_sessions` + `screen_usage_*` |

## Only in the consuming pipeline (Python, NOT in this repo) — the wiring gap

| Feature | What it does | Pipeline module |
|---|---|---|
| **§14 valid-usage credit** | Rewrites each App-Usage session into screen-ON ∩ device-alive intervals, 6 h truncate (see doc 03) | `s14_credit.py` |
| **App-filter relabel → output** | Relabels filtered packages' output sessions to `Filtered App Usage` (the engine fast path doesn't carry the relabel to output) | orchestrator post-pass |
| **Amazon-Kids launcher relabel** | Kids-shell package treated as launcher ONLY on device-days that also have other app usage (else kept as sole evidence of use) | orchestrator post-pass |
| **Person attribution (shared devices)** | Device-sharing lookup, survey-username relabel, non-target marking, kids-shell→target-child on shared devices | `attribution.py` |
| **Study-window filter** | Local-midnight day-window filter per participant (study-period length) | study post-pass |
| **Study-day placeholders** | "No Activity" vs "No Data" rows for every study day with no usage | study post-pass |
| **Per-day compliance** | Shared devices: known/(known+unknown); non-shared: 100. Threshold-based day validity | `attribution.py` |
| Determinism prep | exact-row dedup + total-order sort before the engine (tie-break by input order) | orchestrator |
| Unknown-interaction-type guard | WARN on raw types outside the engine vocabulary (future Android event codes pass through unmapped and are silently ignored by the matcher) | orchestrator |

## Already in the web app (TS `browserPipeline.ts`) — do not re-port

- Parse (+ interaction-type remap), timezone handling, exact-row dedup,
  duplicate-timestamp unalignment, data-time-gap marking.
- Filtered-app labeling (`labelFilteredApps`) — the browser DOES carry the filter to output,
  unlike the Python fast path.
- Screen-usage session derivation (pure TS state machine).
- Matcher (shared Rust crate via WASM; JS fallback path when proximity > 0).
- Codebook enrich, engagement/switch detail columns, per-file no-activity placeholders
  (note: per-FILE placeholders — the study-day No-Data/No-Activity distinction needs study dates
  and is NOT present).
- Outputs: CSV/Parquet/SPSS/plots/aggregates/review timeline.

## Consequences

The features to port client-side are exactly: §14 credit, kids relabel, study-window filter,
study-day placeholders, attribution, per-day compliance — plus surfacing the determinism prep
and unknown-type guard. The Analyze-tier features require two new user-supplied support files
(device-sharing table, study-dates table) since the browser has no access to the research
pipeline's tracking data.
