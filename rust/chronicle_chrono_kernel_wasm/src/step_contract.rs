//! The product-owned 55-step preprocessing graph.
//!
//! This is the structural source of truth for the Rust pipeline. The fifteen
//! groups are display categories only; execution, dependency checks, and
//! checkpoints operate on the steps below.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineGroupDefinition {
    pub id: &'static str,
    pub label: &'static str,
    pub section: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineStepDefinition {
    pub id: &'static str,
    pub group: &'static str,
    pub inputs: &'static [&'static str],
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineStepContract {
    pub protocol_version: &'static str,
    pub groups: &'static [PipelineGroupDefinition],
    pub steps: Vec<PipelineStepContractEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineStepContractEntry {
    pub id: &'static str,
    pub group: &'static str,
    pub inputs: &'static [&'static str],
    pub request_fields: &'static [&'static str],
    pub source_roles: &'static [&'static str],
}

pub const PIPELINE_GROUPS: &[PipelineGroupDefinition] = &[
    PipelineGroupDefinition {
        id: "parse_events",
        label: "Event parsing",
        section: "preprocess",
    },
    PipelineGroupDefinition {
        id: "normalize_timezones",
        label: "Timezone normalization",
        section: "preprocess",
    },
    PipelineGroupDefinition {
        id: "dedup_and_order",
        label: "Event dedup & ordering",
        section: "preprocess",
    },
    PipelineGroupDefinition {
        id: "app_policy",
        label: "App policy — tag filtered packages",
        section: "clean",
    },
    PipelineGroupDefinition {
        id: "device_state_timeline",
        label: "Device-state timeline (screen sessions)",
        section: "preprocess",
    },
    PipelineGroupDefinition {
        id: "reconstruct_episodes",
        label: "Usage-episode reconstruction",
        section: "preprocess",
    },
    PipelineGroupDefinition {
        id: "categorize_apps",
        label: "App categorization",
        section: "preprocess",
    },
    PipelineGroupDefinition {
        id: "episode_annotations",
        label: "Episode annotation (engagement & flags)",
        section: "preprocess",
    },
    PipelineGroupDefinition {
        id: "interval_cleaning",
        label: "Interval cleaning (blank & drop)",
        section: "clean",
    },
    PipelineGroupDefinition {
        id: "effective_usage",
        label: "Effective usage (screen-gated credit)",
        section: "clean",
    },
    PipelineGroupDefinition {
        id: "observation_window",
        label: "Observation-window filtering",
        section: "analyze",
    },
    PipelineGroupDefinition {
        id: "attribute_person",
        label: "Person attribution (shared devices)",
        section: "analyze",
    },
    PipelineGroupDefinition {
        id: "day_coverage",
        label: "Day coverage & placeholders",
        section: "analyze",
    },
    PipelineGroupDefinition {
        id: "score_compliance",
        label: "Compliance scoring",
        section: "analyze",
    },
    PipelineGroupDefinition {
        id: "outputs",
        label: "Outputs",
        section: "output",
    },
];

pub const PIPELINE_STEPS: &[PipelineStepDefinition] = &[
    PipelineStepDefinition {
        id: "parse_remap_config",
        group: "parse_events",
        inputs: &[],
    },
    PipelineStepDefinition {
        id: "csv_parse",
        group: "parse_events",
        inputs: &[],
    },
    PipelineStepDefinition {
        id: "drop_empty_timestamp",
        group: "parse_events",
        inputs: &["csv_parse"],
    },
    PipelineStepDefinition {
        id: "detect_device_model",
        group: "parse_events",
        inputs: &["drop_empty_timestamp"],
    },
    PipelineStepDefinition {
        id: "resolve_preproc_datetime",
        group: "parse_events",
        inputs: &[],
    },
    PipelineStepDefinition {
        id: "build_canonical_rows",
        group: "parse_events",
        inputs: &[
            "drop_empty_timestamp",
            "resolve_preproc_datetime",
            "detect_device_model",
            "parse_remap_config",
        ],
    },
    PipelineStepDefinition {
        id: "stable_sort",
        group: "parse_events",
        inputs: &["build_canonical_rows"],
    },
    PipelineStepDefinition {
        id: "collect_timezones",
        group: "parse_events",
        inputs: &["stable_sort"],
    },
    PipelineStepDefinition {
        id: "compute_dominant_timezone",
        group: "normalize_timezones",
        inputs: &["stable_sort"],
    },
    PipelineStepDefinition {
        id: "select_timezone_strategy",
        group: "normalize_timezones",
        inputs: &["stable_sort", "compute_dominant_timezone"],
    },
    PipelineStepDefinition {
        id: "restamp_rows",
        group: "normalize_timezones",
        inputs: &["select_timezone_strategy"],
    },
    PipelineStepDefinition {
        id: "row_count_report",
        group: "normalize_timezones",
        inputs: &["select_timezone_strategy", "restamp_rows"],
    },
    PipelineStepDefinition {
        id: "exact_dedupe",
        group: "dedup_and_order",
        inputs: &["restamp_rows"],
    },
    PipelineStepDefinition {
        id: "count_dup_groups",
        group: "dedup_and_order",
        inputs: &["exact_dedupe"],
    },
    PipelineStepDefinition {
        id: "nudge_duplicate_timestamps",
        group: "dedup_and_order",
        inputs: &["exact_dedupe"],
    },
    PipelineStepDefinition {
        id: "mark_data_time_gaps",
        group: "dedup_and_order",
        inputs: &["nudge_duplicate_timestamps"],
    },
    PipelineStepDefinition {
        id: "tag_filtered_packages",
        group: "app_policy",
        inputs: &["mark_data_time_gaps"],
    },
    PipelineStepDefinition {
        id: "collect_keyguard_timestamps",
        group: "device_state_timeline",
        inputs: &["tag_filtered_packages"],
    },
    PipelineStepDefinition {
        id: "walk_screen_state_machine",
        group: "device_state_timeline",
        inputs: &["tag_filtered_packages"],
    },
    PipelineStepDefinition {
        id: "build_classified_sessions",
        group: "device_state_timeline",
        inputs: &[
            "tag_filtered_packages",
            "walk_screen_state_machine",
            "collect_keyguard_timestamps",
        ],
    },
    PipelineStepDefinition {
        id: "compute_junk_packages",
        group: "reconstruct_episodes",
        inputs: &["tag_filtered_packages"],
    },
    PipelineStepDefinition {
        id: "junk_blind_fold",
        group: "reconstruct_episodes",
        inputs: &["tag_filtered_packages", "compute_junk_packages"],
    },
    PipelineStepDefinition {
        id: "build_matcher_input",
        group: "reconstruct_episodes",
        inputs: &["junk_blind_fold"],
    },
    PipelineStepDefinition {
        id: "run_matcher",
        group: "reconstruct_episodes",
        inputs: &["build_matcher_input"],
    },
    PipelineStepDefinition {
        id: "apply_matcher_output",
        group: "reconstruct_episodes",
        inputs: &["junk_blind_fold", "run_matcher", "compute_junk_packages"],
    },
    PipelineStepDefinition {
        id: "relabel_usage_with_floor",
        group: "reconstruct_episodes",
        inputs: &["apply_matcher_output"],
    },
    PipelineStepDefinition {
        id: "junk_downstream_mark",
        group: "reconstruct_episodes",
        inputs: &["relabel_usage_with_floor", "compute_junk_packages"],
    },
    PipelineStepDefinition {
        id: "sort_episodes",
        group: "reconstruct_episodes",
        inputs: &["junk_downstream_mark"],
    },
    PipelineStepDefinition {
        id: "split_concurrent",
        group: "reconstruct_episodes",
        inputs: &["sort_episodes"],
    },
    PipelineStepDefinition {
        id: "codebook_join",
        group: "categorize_apps",
        inputs: &["split_concurrent"],
    },
    PipelineStepDefinition {
        id: "derive_broad_category",
        group: "categorize_apps",
        inputs: &["codebook_join"],
    },
    PipelineStepDefinition {
        id: "collapse_genre",
        group: "categorize_apps",
        inputs: &["derive_broad_category"],
    },
    PipelineStepDefinition {
        id: "engagement_walk",
        group: "episode_annotations",
        inputs: &["collapse_genre"],
    },
    PipelineStepDefinition {
        id: "flag_and_retain",
        group: "episode_annotations",
        inputs: &["engagement_walk"],
    },
    PipelineStepDefinition {
        id: "blank_junk_timing",
        group: "interval_cleaning",
        inputs: &["flag_and_retain"],
    },
    PipelineStepDefinition {
        id: "drop_selected_types",
        group: "interval_cleaning",
        inputs: &["blank_junk_timing"],
    },
    PipelineStepDefinition {
        id: "drop_zero_duration",
        group: "interval_cleaning",
        inputs: &["drop_selected_types"],
    },
    PipelineStepDefinition {
        id: "partition_credit_sessions",
        group: "effective_usage",
        inputs: &["drop_zero_duration"],
    },
    PipelineStepDefinition {
        id: "build_liveness_substrate",
        group: "effective_usage",
        inputs: &["tag_filtered_packages"],
    },
    PipelineStepDefinition {
        id: "report_screen_incapable",
        group: "effective_usage",
        inputs: &["partition_credit_sessions", "build_liveness_substrate"],
    },
    PipelineStepDefinition {
        id: "count_day_apps",
        group: "effective_usage",
        inputs: &["partition_credit_sessions"],
    },
    PipelineStepDefinition {
        id: "credit_sessions",
        group: "effective_usage",
        inputs: &[
            "partition_credit_sessions",
            "build_liveness_substrate",
            "count_day_apps",
        ],
    },
    PipelineStepDefinition {
        id: "emit_credited_rows",
        group: "effective_usage",
        inputs: &["credit_sessions"],
    },
    PipelineStepDefinition {
        id: "assemble_credit_result",
        group: "effective_usage",
        inputs: &[
            "partition_credit_sessions",
            "report_screen_incapable",
            "emit_credited_rows",
        ],
    },
    PipelineStepDefinition {
        id: "resolve_participant_windows",
        group: "observation_window",
        inputs: &["drop_zero_duration"],
    },
    PipelineStepDefinition {
        id: "filter_rows_to_window",
        group: "observation_window",
        inputs: &["drop_zero_duration", "resolve_participant_windows"],
    },
    PipelineStepDefinition {
        id: "resolve_sharing_status",
        group: "attribute_person",
        inputs: &["filter_rows_to_window"],
    },
    PipelineStepDefinition {
        id: "build_survey_lookup",
        group: "attribute_person",
        inputs: &[],
    },
    PipelineStepDefinition {
        id: "attribute_rows",
        group: "attribute_person",
        inputs: &[
            "filter_rows_to_window",
            "resolve_sharing_status",
            "build_survey_lookup",
        ],
    },
    PipelineStepDefinition {
        id: "inject_placeholders",
        group: "day_coverage",
        inputs: &["attribute_rows", "tag_filtered_packages"],
    },
    PipelineStepDefinition {
        id: "build_raw_date_index",
        group: "day_coverage",
        inputs: &["tag_filtered_packages"],
    },
    PipelineStepDefinition {
        id: "build_coverage_table",
        group: "day_coverage",
        inputs: &["inject_placeholders", "build_raw_date_index"],
    },
    PipelineStepDefinition {
        id: "accumulate_attribution_minutes",
        group: "score_compliance",
        inputs: &["inject_placeholders"],
    },
    PipelineStepDefinition {
        id: "score_days",
        group: "score_compliance",
        inputs: &["accumulate_attribution_minutes", "attribute_rows"],
    },
    PipelineStepDefinition {
        id: "assemble_result",
        group: "outputs",
        inputs: &[
            "tag_filtered_packages",
            "inject_placeholders",
            "build_coverage_table",
            "build_classified_sessions",
            "assemble_credit_result",
            "filter_rows_to_window",
            "attribute_rows",
            "score_days",
        ],
    },
];

/// Exact serialized `PipelineV2OptionsJson` fields read by each Rust step.
/// These are cache/provenance bindings, not UI labels or semantic aliases.
pub fn step_request_fields(step_id: &str) -> &'static [&'static str] {
    match step_id {
        "parse_remap_config" => &["interaction_type_remap"],
        "resolve_preproc_datetime" => &["datetime_of_preprocessing"],
        "build_canonical_rows" => &["timezone"],
        "select_timezone_strategy" => &["timezone", "timezone_handling"],
        "exact_dedupe" => &["deduplicate_exact_rows"],
        "nudge_duplicate_timestamps" => &["correct_duplicate_event_timestamps"],
        "tag_filtered_packages" => &["use_filter_file"],
        "build_classified_sessions" => &[
            "usage_session_mode",
            "use_apps_forcing_screen_open",
            "screen_auto_lock_timeout_seconds",
            "screen_auto_lock_tolerance_seconds",
            "screen_manual_lock_max_tail_seconds",
            "screen_keyguard_near_stop_seconds",
        ],
        "compute_junk_packages" => &["usage_session_mode"],
        "build_matcher_input" => &[
            "same_app_stop_types",
            "other_stop_types",
            "use_background_apps_file",
        ],
        "run_matcher" => &[
            "allow_stop_event_reuse",
            "use_activity_stopped_as_fallback",
            "apply_threshold_to_fallback",
            "long_duration_threshold_ns",
            "proximity_interval_ns",
        ],
        "relabel_usage_with_floor" => &["minimum_usage_duration"],
        "split_concurrent" => &[
            "model_concurrent_usage",
            "minimum_usage_duration",
            "apply_minimum_usage_duration_to_concurrent_subintervals",
        ],
        "codebook_join" => &["use_app_codebook", "include_category_column"],
        "derive_broad_category" | "collapse_genre" => {
            &["use_app_codebook", "include_category_column"]
        }
        "engagement_walk" => &["custom_app_engagement_duration"],
        "flag_and_retain" => &[
            "long_data_time_gap_thresholds",
            "long_usage_duration_thresholds",
        ],
        "drop_selected_types" => &[
            "interaction_types_to_remove",
            "long_data_time_gap_thresholds",
        ],
        "drop_zero_duration" => &["filter_zero_duration_sessions"],
        "partition_credit_sessions" => &["enable_screen_gated_crediting"],
        "credit_sessions" => &[
            "credited_session_cap_minutes",
            "device_liveness_gap_tolerance_minutes",
            "auto_lock_bridge_seconds",
            "no_witness_min_day_apps",
        ],
        "filter_rows_to_window" => &["enable_study_window_filter"],
        "resolve_sharing_status" => &["enable_person_attribution"],
        "inject_placeholders" => &["add_no_activity_placeholder_days"],
        "build_coverage_table" => &["enable_day_coverage"],
        "accumulate_attribution_minutes" => &["enable_compliance_scoring"],
        "score_days" => &["compliance_threshold_percent"],
        "assemble_result" => &[
            "study_name",
            "usage_session_mode",
            "include_app_output",
            "include_screen_output",
            "use_background_apps_file",
            "use_app_codebook",
            "include_category_column",
            "datetime_of_preprocessing",
            "model_concurrent_usage",
            "enable_parquet_export",
            "enable_spss_export",
            "enable_aggregates",
            "aggregate_shape",
        ],
        _ => &[],
    }
}

/// Exact root artifacts read directly by a step in addition to upstream step
/// outputs. A support file that has already been compiled into an upstream
/// result is not repeated here.
pub fn step_source_roles(step_id: &str) -> &'static [&'static str] {
    match step_id {
        "csv_parse" => &["raw_chronicle_csv"],
        "tag_filtered_packages" => &["filter_file"],
        "build_classified_sessions" => &["apps_forcing_screen_open_file"],
        "build_matcher_input" => &["background_apps_file"],
        "codebook_join" => &["app_codebook_file"],
        "resolve_participant_windows" | "build_coverage_table" => &["study_dates_file"],
        "resolve_sharing_status" => &["device_sharing_file"],
        "build_survey_lookup" => &["survey_attribution_file"],
        "assemble_result" => &["enrolled_devices_file"],
        _ => &[],
    }
}

pub fn pipeline_step_contract() -> PipelineStepContract {
    PipelineStepContract {
        protocol_version: "chronicle-preprocessing-step-contract/v1",
        groups: PIPELINE_GROUPS,
        steps: PIPELINE_STEPS
            .iter()
            .map(|step| PipelineStepContractEntry {
                id: step.id,
                group: step.group,
                inputs: step.inputs,
                request_fields: step_request_fields(step.id),
                source_roles: step_source_roles(step.id),
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pipeline_v2::PipelineV2OptionsJson;
    use std::collections::BTreeSet;

    #[test]
    fn contract_has_fifty_five_topologically_ordered_steps_and_fifteen_groups() {
        assert_eq!(PIPELINE_GROUPS.len(), 15);
        assert_eq!(PIPELINE_STEPS.len(), 55);

        let group_ids = PIPELINE_GROUPS
            .iter()
            .map(|group| group.id)
            .collect::<BTreeSet<_>>();
        assert_eq!(group_ids.len(), PIPELINE_GROUPS.len());

        let mut step_ids = BTreeSet::new();
        for step in PIPELINE_STEPS {
            assert!(
                group_ids.contains(step.group),
                "unknown group for {}",
                step.id
            );
            assert!(step_ids.insert(step.id), "duplicate step {}", step.id);
            for input in step.inputs {
                assert!(
                    step_ids.contains(input),
                    "{} depends on unknown or later step {}",
                    step.id,
                    input
                );
            }
        }
    }

    #[test]
    fn serialized_contract_is_deterministic() {
        let first = serde_json::to_vec(&pipeline_step_contract()).expect("serialize contract");
        let second = serde_json::to_vec(&pipeline_step_contract()).expect("serialize contract");
        assert_eq!(first, second);
    }

    #[test]
    fn every_exact_request_field_and_source_role_is_bound_to_a_step() {
        let options: PipelineV2OptionsJson = serde_json::from_value(serde_json::json!({
            "study_name": "binding-test",
            "timezone": "America/Chicago",
            "usage_session_mode": "app_usage",
            "include_app_output": true,
            "include_screen_output": false,
            "use_filter_file": false,
            "use_apps_forcing_screen_open": false,
            "use_app_codebook": false,
            "correct_duplicate_event_timestamps": true,
            "allow_stop_event_reuse": false,
            "use_activity_stopped_as_fallback": true,
            "apply_threshold_to_fallback": true,
            "long_duration_threshold_ns": 1,
            "custom_app_engagement_duration": 1.0,
            "long_data_time_gap_thresholds": [],
            "long_usage_duration_thresholds": [],
            "same_app_stop_types": [],
            "other_stop_types": [],
            "interaction_types_to_remove": [],
            "screen_auto_lock_timeout_seconds": 1.0,
            "screen_auto_lock_tolerance_seconds": 1.0,
            "screen_manual_lock_max_tail_seconds": 1.0,
            "screen_keyguard_near_stop_seconds": 1.0,
            "datetime_of_preprocessing": "2026-07-21 12:00:00 UTC"
        }))
        .unwrap();
        let serialized = serde_json::to_value(options).unwrap();
        let exact_fields = serialized
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect::<BTreeSet<_>>();
        let bound_fields = PIPELINE_STEPS
            .iter()
            .flat_map(|step| step_request_fields(step.id).iter().copied())
            .collect::<BTreeSet<_>>();
        assert_eq!(bound_fields, exact_fields);

        for step in PIPELINE_STEPS {
            let fields = step_request_fields(step.id);
            assert_eq!(
                fields.iter().copied().collect::<BTreeSet<_>>().len(),
                fields.len(),
                "duplicate request field binding on {}",
                step.id
            );
        }

        let source_roles = PIPELINE_STEPS
            .iter()
            .flat_map(|step| step_source_roles(step.id).iter().copied())
            .collect::<BTreeSet<_>>();
        assert_eq!(
            source_roles,
            BTreeSet::from([
                "raw_chronicle_csv",
                "filter_file",
                "apps_forcing_screen_open_file",
                "background_apps_file",
                "app_codebook_file",
                "study_dates_file",
                "device_sharing_file",
                "survey_attribution_file",
                "enrolled_devices_file",
            ])
        );
    }
}
