//! The product-owned 55-step preprocessing graph.
//!
//! This is the structural source of truth for the Rust pipeline. The fifteen
//! groups are display categories only; execution, dependency checks, and
//! checkpoints operate on the steps below.

use std::collections::{BTreeMap, BTreeSet};

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
pub struct PipelineKnobDefinition {
    pub option_key: &'static str,
    pub edge: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum PipelineCondition {
    Always,
    OptionTrue { option_key: &'static str },
    ArrayNonempty { option_key: &'static str },
    All { terms: Vec<PipelineCondition> },
    Any { terms: Vec<PipelineCondition> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineGroupContractEntry {
    pub id: &'static str,
    pub label: &'static str,
    pub section: &'static str,
    pub knobs: &'static [PipelineKnobDefinition],
    pub support_roles: &'static [&'static str],
    pub applicability: PipelineCondition,
    pub can_bypass: bool,
    pub early_cutoff: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineRootRoleDefinition {
    pub role_id: &'static str,
    pub minimum: usize,
    pub maximum: usize,
    pub media_types: &'static [&'static str],
    pub required: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required_when: Option<PipelineCondition>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub qualification: Option<&'static str>,
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
    pub preprocessor_version: &'static str,
    pub canonical_interaction_types: &'static [&'static str],
    pub unbound_option_keys: &'static [&'static str],
    pub root_roles: Vec<PipelineRootRoleDefinition>,
    pub groups: Vec<PipelineGroupContractEntry>,
    pub steps: Vec<PipelineStepContractEntry>,
    pub output_cell_bindings: Vec<PipelineOutputCellBinding>,
    /// Output cell families whose value is a verbatim copy of exactly one
    /// supplied source column.
    pub exact_cell_contributions: Vec<PipelineExactCellContribution>,
    /// Row-set pseudo-fields every row-addressed output cell additionally
    /// depends on. Consumers must not restate this list.
    pub row_set_fields: &'static [&'static str],
    /// Output kinds whose cells are addressed per row, so `row_set_fields`
    /// applies to them. Consumers must not restate this list.
    pub row_addressed_output_kinds: &'static [&'static str],
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineStepContractEntry {
    pub id: &'static str,
    pub group: &'static str,
    pub inputs: &'static [&'static str],
    pub request_fields: &'static [&'static str],
    pub source_roles: &'static [&'static str],
    pub source_role_bindings: Vec<PipelineSourceRoleBinding>,
    pub field_reads: &'static [&'static str],
    pub field_writes: &'static [&'static str],
    pub field_edges: Vec<PipelineFieldEdge>,
    pub applicability: PipelineCondition,
    pub can_bypass: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineSourceRoleBinding {
    pub role: &'static str,
    pub when_all: &'static [PipelineSourceRolePredicate],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "operator", rename_all = "snake_case")]
pub enum PipelineSourceRolePredicate {
    BooleanEquals {
        request_field: &'static str,
        value: bool,
    },
    StringOneOf {
        request_field: &'static str,
        values: &'static [&'static str],
    },
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

pub fn group_knobs(group_id: &str) -> &'static [PipelineKnobDefinition] {
    match group_id {
        "parse_events" => &[
            PipelineKnobDefinition {
                option_key: "interaction_type_remap",
                edge: "tunes",
            },
            PipelineKnobDefinition {
                option_key: "selected_timezone",
                edge: "tunes",
            },
            PipelineKnobDefinition {
                option_key: "datetime_of_preprocessing",
                edge: "tunes",
            },
        ],
        "normalize_timezones" => &[
            PipelineKnobDefinition {
                option_key: "selected_timezone",
                edge: "tunes",
            },
            PipelineKnobDefinition {
                option_key: "timezone_handling",
                edge: "tunes",
            },
        ],
        "dedup_and_order" => &[
            PipelineKnobDefinition {
                option_key: "deduplicate_exact_rows",
                edge: "gates",
            },
            PipelineKnobDefinition {
                option_key: "correct_duplicate_event_timestamps",
                edge: "gates",
            },
            PipelineKnobDefinition {
                option_key: "same_app_interaction_types_to_stop_usage_at",
                edge: "tunes",
            },
            PipelineKnobDefinition {
                option_key: "other_interaction_types_to_stop_usage_at",
                edge: "tunes",
            },
        ],
        "app_policy" => &[PipelineKnobDefinition {
            option_key: "use_filter_file",
            edge: "gates",
        }],
        "device_state_timeline" => &[
            PipelineKnobDefinition {
                option_key: "process_screen_usage",
                edge: "gates",
            },
            PipelineKnobDefinition {
                option_key: "use_apps_forcing_screen_open_file",
                edge: "gates",
            },
            PipelineKnobDefinition {
                option_key: "screen_usage_auto_lock_timeout_seconds",
                edge: "tunes",
            },
            PipelineKnobDefinition {
                option_key: "screen_usage_auto_lock_tolerance_seconds",
                edge: "tunes",
            },
            PipelineKnobDefinition {
                option_key: "screen_usage_manual_lock_max_tail_gap_seconds",
                edge: "tunes",
            },
            PipelineKnobDefinition {
                option_key: "screen_usage_keyguard_near_stop_seconds",
                edge: "tunes",
            },
        ],
        "reconstruct_episodes" => &[
            PipelineKnobDefinition {
                option_key: "process_app_usage",
                edge: "gates",
            },
            PipelineKnobDefinition {
                option_key: "use_background_apps_file",
                edge: "gates",
            },
            PipelineKnobDefinition {
                option_key: "allow_stop_event_reuse",
                edge: "tunes",
            },
            PipelineKnobDefinition {
                option_key: "use_activity_stopped_as_fallback",
                edge: "tunes",
            },
            PipelineKnobDefinition {
                option_key: "apply_threshold_to_fallback",
                edge: "tunes",
            },
            PipelineKnobDefinition {
                option_key: "long_duration_threshold_hours",
                edge: "tunes",
            },
            PipelineKnobDefinition {
                option_key: "minimum_usage_duration",
                edge: "tunes",
            },
            PipelineKnobDefinition {
                option_key: "proximity_interval_seconds",
                edge: "tunes",
            },
            PipelineKnobDefinition {
                option_key: "model_concurrent_usage",
                edge: "gates",
            },
            PipelineKnobDefinition {
                option_key: "apply_minimum_usage_duration_to_concurrent_subintervals",
                edge: "tunes",
            },
            PipelineKnobDefinition {
                option_key: "same_app_interaction_types_to_stop_usage_at",
                edge: "tunes",
            },
            PipelineKnobDefinition {
                option_key: "other_interaction_types_to_stop_usage_at",
                edge: "tunes",
            },
        ],
        "categorize_apps" => &[
            PipelineKnobDefinition {
                option_key: "process_app_usage",
                edge: "gates",
            },
            PipelineKnobDefinition {
                option_key: "use_app_codebook",
                edge: "gates",
            },
        ],
        "episode_annotations" => &[
            PipelineKnobDefinition {
                option_key: "process_app_usage",
                edge: "gates",
            },
            PipelineKnobDefinition {
                option_key: "long_usage_duration_thresholds",
                edge: "tunes",
            },
            PipelineKnobDefinition {
                option_key: "long_data_time_gap_thresholds",
                edge: "tunes",
            },
            PipelineKnobDefinition {
                option_key: "custom_app_engagement_duration",
                edge: "tunes",
            },
        ],
        "interval_cleaning" => &[
            PipelineKnobDefinition {
                option_key: "process_app_usage",
                edge: "gates",
            },
            PipelineKnobDefinition {
                option_key: "use_filter_file",
                edge: "tunes",
            },
            PipelineKnobDefinition {
                option_key: "interaction_types_to_remove",
                edge: "tunes",
            },
            PipelineKnobDefinition {
                option_key: "long_data_time_gap_thresholds",
                edge: "tunes",
            },
            PipelineKnobDefinition {
                option_key: "filter_zero_duration_sessions",
                edge: "gates",
            },
        ],
        "effective_usage" => &[
            PipelineKnobDefinition {
                option_key: "process_app_usage",
                edge: "gates",
            },
            PipelineKnobDefinition {
                option_key: "enable_screen_gated_crediting",
                edge: "gates",
            },
            PipelineKnobDefinition {
                option_key: "credited_session_cap_minutes",
                edge: "tunes",
            },
            PipelineKnobDefinition {
                option_key: "device_liveness_gap_tolerance_minutes",
                edge: "tunes",
            },
            PipelineKnobDefinition {
                option_key: "auto_lock_bridge_seconds",
                edge: "tunes",
            },
            PipelineKnobDefinition {
                option_key: "no_witness_min_day_apps",
                edge: "tunes",
            },
        ],
        "observation_window" => &[
            PipelineKnobDefinition {
                option_key: "process_app_usage",
                edge: "gates",
            },
            PipelineKnobDefinition {
                option_key: "enable_study_window_filter",
                edge: "gates",
            },
        ],
        "attribute_person" => &[
            PipelineKnobDefinition {
                option_key: "process_app_usage",
                edge: "gates",
            },
            PipelineKnobDefinition {
                option_key: "enable_person_attribution",
                edge: "gates",
            },
        ],
        "day_coverage" => &[
            PipelineKnobDefinition {
                option_key: "process_app_usage",
                edge: "gates",
            },
            PipelineKnobDefinition {
                option_key: "add_no_activity_placeholder_days",
                edge: "gates",
            },
            PipelineKnobDefinition {
                option_key: "enable_day_coverage",
                edge: "gates",
            },
        ],
        "score_compliance" => &[
            PipelineKnobDefinition {
                option_key: "process_app_usage",
                edge: "gates",
            },
            PipelineKnobDefinition {
                option_key: "enable_compliance_scoring",
                edge: "gates",
            },
            PipelineKnobDefinition {
                option_key: "compliance_threshold_percent",
                edge: "tunes",
            },
        ],
        "outputs" => &[
            PipelineKnobDefinition {
                option_key: "study_name",
                edge: "tunes",
            },
            PipelineKnobDefinition {
                option_key: "enable_aggregates",
                edge: "gates",
            },
            PipelineKnobDefinition {
                option_key: "aggregate_shape",
                edge: "tunes",
            },
            PipelineKnobDefinition {
                option_key: "include_category_column",
                edge: "gates",
            },
            PipelineKnobDefinition {
                option_key: "enable_parquet_export",
                edge: "gates",
            },
            PipelineKnobDefinition {
                option_key: "enable_spss_export",
                edge: "gates",
            },
        ],
        _ => &[],
    }
}

pub fn group_support_roles(group_id: &str) -> &'static [&'static str] {
    match group_id {
        "app_policy" => &["filter_file"],
        "device_state_timeline" => &["apps_forcing_screen_open_file"],
        "reconstruct_episodes" => &["background_apps_file"],
        "categorize_apps" => &["app_codebook_file"],
        "observation_window" | "day_coverage" => &["study_dates_file"],
        "attribute_person" => &["device_sharing_file", "survey_attribution_file"],
        "score_compliance" => &["device_sharing_file", "enrolled_devices_file"],
        _ => &[],
    }
}

fn option_true(option_key: &'static str) -> PipelineCondition {
    PipelineCondition::OptionTrue { option_key }
}

fn all(terms: Vec<PipelineCondition>) -> PipelineCondition {
    PipelineCondition::All { terms }
}

fn any(terms: Vec<PipelineCondition>) -> PipelineCondition {
    PipelineCondition::Any { terms }
}

pub fn group_applicability(group_id: &str) -> PipelineCondition {
    match group_id {
        "app_policy" => option_true("use_filter_file"),
        "device_state_timeline" => option_true("process_screen_usage"),
        "reconstruct_episodes" | "episode_annotations" => option_true("process_app_usage"),
        "categorize_apps" => all(vec![
            option_true("process_app_usage"),
            option_true("use_app_codebook"),
        ]),
        "interval_cleaning" => all(vec![
            option_true("process_app_usage"),
            any(vec![
                option_true("use_filter_file"),
                PipelineCondition::ArrayNonempty {
                    option_key: "interaction_types_to_remove",
                },
                option_true("filter_zero_duration_sessions"),
            ]),
        ]),
        "effective_usage" => all(vec![
            option_true("process_app_usage"),
            option_true("enable_screen_gated_crediting"),
        ]),
        "observation_window" => all(vec![
            option_true("process_app_usage"),
            option_true("enable_study_window_filter"),
        ]),
        "attribute_person" => all(vec![
            option_true("process_app_usage"),
            option_true("enable_person_attribution"),
        ]),
        "day_coverage" => all(vec![
            option_true("process_app_usage"),
            any(vec![
                option_true("add_no_activity_placeholder_days"),
                option_true("enable_day_coverage"),
            ]),
        ]),
        "score_compliance" => all(vec![
            option_true("process_app_usage"),
            option_true("enable_compliance_scoring"),
        ]),
        _ => PipelineCondition::Always,
    }
}

pub fn step_applicability(step_id: &str) -> PipelineCondition {
    match step_id {
        "collect_keyguard_timestamps"
        | "walk_screen_state_machine"
        | "build_classified_sessions" => option_true("process_screen_usage"),
        "compute_junk_packages"
        | "junk_blind_fold"
        | "build_matcher_input"
        | "run_matcher"
        | "apply_matcher_output"
        | "relabel_usage_with_floor"
        | "junk_downstream_mark"
        | "sort_episodes"
        | "split_concurrent"
        | "codebook_join"
        | "derive_broad_category"
        | "collapse_genre"
        | "engagement_walk"
        | "flag_and_retain"
        | "blank_junk_timing"
        | "drop_selected_types"
        | "drop_zero_duration"
        | "resolve_participant_windows"
        | "filter_rows_to_window"
        | "resolve_sharing_status"
        | "build_survey_lookup"
        | "attribute_rows"
        | "inject_placeholders"
        | "build_raw_date_index" => option_true("process_app_usage"),
        "partition_credit_sessions"
        | "build_liveness_substrate"
        | "report_screen_incapable"
        | "count_day_apps"
        | "credit_sessions"
        | "emit_credited_rows"
        | "assemble_credit_result" => all(vec![
            option_true("process_app_usage"),
            option_true("enable_screen_gated_crediting"),
        ]),
        "build_coverage_table" => all(vec![
            option_true("process_app_usage"),
            option_true("enable_day_coverage"),
        ]),
        "accumulate_attribution_minutes" | "score_days" => all(vec![
            option_true("process_app_usage"),
            option_true("enable_compliance_scoring"),
        ]),
        _ => PipelineCondition::Always,
    }
}

pub fn root_role_contract() -> Vec<PipelineRootRoleDefinition> {
    let support_media = &[
        "text/csv",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ];
    vec![
        PipelineRootRoleDefinition {
            role_id: "raw_chronicle_csv",
            minimum: 1,
            maximum: 1,
            media_types: &["text/csv"],
            required: true,
            required_when: None,
            qualification: None,
        },
        PipelineRootRoleDefinition {
            role_id: "processing_options",
            minimum: 1,
            maximum: 1,
            media_types: &["application/json"],
            required: true,
            required_when: None,
            qualification: None,
        },
        PipelineRootRoleDefinition {
            role_id: "filter_file",
            minimum: 0,
            maximum: 1,
            media_types: support_media,
            required: false,
            required_when: Some(option_true("use_filter_file")),
            qualification: None,
        },
        PipelineRootRoleDefinition {
            role_id: "apps_forcing_screen_open_file",
            minimum: 0,
            maximum: 1,
            media_types: support_media,
            required: false,
            required_when: Some(option_true("use_apps_forcing_screen_open_file")),
            qualification: None,
        },
        PipelineRootRoleDefinition {
            role_id: "background_apps_file",
            minimum: 0,
            maximum: 1,
            media_types: support_media,
            required: false,
            required_when: Some(option_true("use_background_apps_file")),
            qualification: None,
        },
        PipelineRootRoleDefinition {
            role_id: "app_codebook_file",
            minimum: 0,
            maximum: 1,
            media_types: support_media,
            required: false,
            required_when: Some(option_true("use_app_codebook")),
            qualification: None,
        },
        PipelineRootRoleDefinition {
            role_id: "study_dates_file",
            minimum: 0,
            maximum: 1,
            media_types: support_media,
            required: false,
            required_when: Some(option_true("enable_study_window_filter")),
            qualification: None,
        },
        PipelineRootRoleDefinition {
            role_id: "device_sharing_file",
            minimum: 0,
            maximum: 1,
            media_types: support_media,
            required: false,
            required_when: Some(option_true("enable_person_attribution")),
            qualification: None,
        },
        PipelineRootRoleDefinition {
            role_id: "survey_attribution_file",
            minimum: 0,
            maximum: 1,
            media_types: support_media,
            required: false,
            required_when: None,
            qualification: Some("optional-evidence"),
        },
        PipelineRootRoleDefinition {
            role_id: "enrolled_devices_file",
            minimum: 0,
            maximum: 1,
            media_types: support_media,
            required: false,
            required_when: None,
            qualification: Some("reserved-support"),
        },
    ]
}

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
        inputs: &["stable_sort", "select_timezone_strategy"],
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
        inputs: &["apply_matcher_output", "compute_junk_packages"],
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
        inputs: &["sort_episodes", "compute_junk_packages"],
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
        inputs: &["flag_and_retain", "compute_junk_packages"],
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
        inputs: &[
            "partition_credit_sessions",
            "build_liveness_substrate",
            "credit_sessions",
        ],
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
            "parse_remap_config",
            "csv_parse",
            "drop_empty_timestamp",
            "detect_device_model",
            "resolve_preproc_datetime",
            "build_canonical_rows",
            "stable_sort",
            "collect_timezones",
            "compute_dominant_timezone",
            "select_timezone_strategy",
            "restamp_rows",
            "row_count_report",
            "exact_dedupe",
            "count_dup_groups",
            "nudge_duplicate_timestamps",
            "mark_data_time_gaps",
            "tag_filtered_packages",
            "collect_keyguard_timestamps",
            "walk_screen_state_machine",
            "build_classified_sessions",
            "compute_junk_packages",
            "junk_blind_fold",
            "build_matcher_input",
            "run_matcher",
            "apply_matcher_output",
            "relabel_usage_with_floor",
            "junk_downstream_mark",
            "sort_episodes",
            "split_concurrent",
            "codebook_join",
            "derive_broad_category",
            "collapse_genre",
            "engagement_walk",
            "flag_and_retain",
            "blank_junk_timing",
            "drop_selected_types",
            "drop_zero_duration",
            "partition_credit_sessions",
            "build_liveness_substrate",
            "report_screen_incapable",
            "count_day_apps",
            "credit_sessions",
            "emit_credited_rows",
            "assemble_credit_result",
            "resolve_participant_windows",
            "filter_rows_to_window",
            "resolve_sharing_status",
            "build_survey_lookup",
            "attribute_rows",
            "inject_placeholders",
            "build_raw_date_index",
            "build_coverage_table",
            "accumulate_attribution_minutes",
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
        "nudge_duplicate_timestamps" => &[
            "correct_duplicate_event_timestamps",
            "same_app_stop_types",
            "other_stop_types",
        ],
        "tag_filtered_packages" => &["use_filter_file"],
        "build_classified_sessions" => &[
            "use_apps_forcing_screen_open",
            "screen_auto_lock_timeout_seconds",
            "screen_auto_lock_tolerance_seconds",
            "screen_manual_lock_max_tail_seconds",
            "screen_keyguard_near_stop_seconds",
        ],
        "build_matcher_input" => &[
            "same_app_stop_types",
            "other_stop_types",
            "model_concurrent_usage",
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
        "junk_downstream_mark" => &["use_background_apps_file"],
        "split_concurrent" => &[
            "model_concurrent_usage",
            "minimum_usage_duration",
            "apply_minimum_usage_duration_to_concurrent_subintervals",
            "use_background_apps_file",
        ],
        "codebook_join" | "derive_broad_category" | "collapse_genre" => &["use_app_codebook"],
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
        "credit_sessions" => &[
            "credited_session_cap_minutes",
            "device_liveness_gap_tolerance_minutes",
            "auto_lock_bridge_seconds",
            "no_witness_min_day_apps",
        ],
        "filter_rows_to_window" => &["enable_study_window_filter"],
        "resolve_sharing_status" | "build_survey_lookup" | "attribute_rows" => {
            &["enable_person_attribution"]
        }
        "inject_placeholders" => &["add_no_activity_placeholder_days"],
        "score_days" => &["compliance_threshold_percent"],
        "assemble_result" => &[
            "study_name",
            "timezone",
            "timezone_handling",
            "usage_session_mode",
            "include_app_output",
            "include_screen_output",
            "use_background_apps_file",
            "use_app_codebook",
            "include_category_column",
            "deduplicate_exact_rows",
            "correct_duplicate_event_timestamps",
            "datetime_of_preprocessing",
            "custom_app_engagement_duration",
            "model_concurrent_usage",
            "enable_screen_gated_crediting",
            "enable_day_coverage",
            "enable_compliance_scoring",
            "enable_aggregates",
            "aggregate_shape",
            "materialize_visualization_data",
        ],
        _ => &[],
    }
}

/// Request fields consumed only while materializing derived browser/export
/// artifacts. They do not invalidate the upstream preprocessing queries.
pub const RUNTIME_ARTIFACT_REQUEST_FIELDS: &[&str] = &[
    "enable_parquet_export",
    "enable_spss_export",
    "enable_plotting",
    "enable_interactive_timeline",
    "enable_activity_heatmap",
    "export_plots_as_svg",
    "include_filtered_app_usage_in_plots",
];

const APP_USAGE_MODES: &[&str] = &["app_usage", "app_and_screen_usage"];
const USE_FILTER_FILE: &[PipelineSourceRolePredicate] =
    &[PipelineSourceRolePredicate::BooleanEquals {
        request_field: "use_filter_file",
        value: true,
    }];
const USE_APPS_FORCING_SCREEN_OPEN: &[PipelineSourceRolePredicate] =
    &[PipelineSourceRolePredicate::BooleanEquals {
        request_field: "use_apps_forcing_screen_open",
        value: true,
    }];
const USE_BACKGROUND_APPS_FILE: &[PipelineSourceRolePredicate] =
    &[PipelineSourceRolePredicate::BooleanEquals {
        request_field: "use_background_apps_file",
        value: true,
    }];
const USE_APP_CODEBOOK: &[PipelineSourceRolePredicate] =
    &[PipelineSourceRolePredicate::BooleanEquals {
        request_field: "use_app_codebook",
        value: true,
    }];
const ENABLE_STUDY_WINDOW_FILTER: &[PipelineSourceRolePredicate] =
    &[PipelineSourceRolePredicate::BooleanEquals {
        request_field: "enable_study_window_filter",
        value: true,
    }];
const ENABLE_PERSON_ATTRIBUTION: &[PipelineSourceRolePredicate] =
    &[PipelineSourceRolePredicate::BooleanEquals {
        request_field: "enable_person_attribution",
        value: true,
    }];
const APP_MODE_WITH_COMPLIANCE: &[PipelineSourceRolePredicate] = &[
    PipelineSourceRolePredicate::StringOneOf {
        request_field: "usage_session_mode",
        values: APP_USAGE_MODES,
    },
    PipelineSourceRolePredicate::BooleanEquals {
        request_field: "enable_compliance_scoring",
        value: true,
    },
];

/// Exact root artifacts read directly by a step in addition to upstream step
/// outputs. A support file that has already been compiled into an upstream
/// result is not repeated here.
pub fn step_source_roles(step_id: &str) -> &'static [&'static str] {
    match step_id {
        "csv_parse" => &["raw_chronicle_csv"],
        "tag_filtered_packages" => &["filter_file"],
        "build_classified_sessions" => &["apps_forcing_screen_open_file"],
        "build_matcher_input" | "junk_downstream_mark" | "split_concurrent" => {
            &["background_apps_file"]
        }
        "codebook_join" => &["app_codebook_file"],
        "resolve_participant_windows" | "filter_rows_to_window" | "build_coverage_table" => {
            &["study_dates_file"]
        }
        "resolve_sharing_status" => &["device_sharing_file"],
        "build_survey_lookup" => &["survey_attribution_file"],
        "assemble_result" => &["enrolled_devices_file"],
        _ => &[],
    }
}

/// Exact direct support-file reads for a query, including configuration gates.
/// Upstream query outputs remain represented by `PipelineStepDefinition::inputs`.
pub fn step_source_role_bindings(step_id: &str) -> Vec<PipelineSourceRoleBinding> {
    let binding = |role, when_all| PipelineSourceRoleBinding { role, when_all };
    match step_id {
        "csv_parse" => vec![binding("raw_chronicle_csv", &[])],
        "tag_filtered_packages" => vec![binding("filter_file", USE_FILTER_FILE)],
        "build_classified_sessions" => vec![binding(
            "apps_forcing_screen_open_file",
            USE_APPS_FORCING_SCREEN_OPEN,
        )],
        "build_matcher_input" | "junk_downstream_mark" | "split_concurrent" => {
            vec![binding("background_apps_file", USE_BACKGROUND_APPS_FILE)]
        }
        "codebook_join" => vec![binding("app_codebook_file", USE_APP_CODEBOOK)],
        "resolve_participant_windows" | "build_coverage_table" => {
            vec![binding("study_dates_file", &[])]
        }
        "filter_rows_to_window" => vec![binding("study_dates_file", ENABLE_STUDY_WINDOW_FILTER)],
        "resolve_sharing_status" => vec![binding("device_sharing_file", ENABLE_PERSON_ATTRIBUTION)],
        "build_survey_lookup" => vec![binding(
            "survey_attribution_file",
            ENABLE_PERSON_ATTRIBUTION,
        )],
        "assemble_result" => vec![binding("enrolled_devices_file", APP_MODE_WITH_COMPLIANCE)],
        _ => Vec::new(),
    }
}

// ---- field-level read/write declarations --------------------------------
//
// `step_request_fields` and `step_source_roles` bind each step to whole
// configuration leaves and whole source artifacts. The declarations below go
// one level finer and name the exact *data fields* each step consumes and
// produces, so a supplied raw/support column can be traced to the canonical
// output cells it can reach.
//
// Identifier namespaces:
//   `<role>.<column>`  a column of a supplied source artifact
//                      (`raw_chronicle_csv.event_timestamp`, `filter_file.…`)
//   `<bare_name>`      a data field of the canonical row carrier `RowData`
//                      or of the parsed `RawRow`; the two share names where
//                      the same datum flows through
//   `row.membership`   which rows exist, and
//   `row.order`        their sequence — a canonical cell is addressed by
//                      (row index, column), so both determine every
//                      row-addressed output cell
//   `source.…`         a structural property of a supplied artifact that is
//                      not one of its columns (raw row set and row order)
//   `derived.…`        a product value a step computes and hands to later
//                      steps without storing it on a row
//
// `declared_field_edges_equal_scanned_field_use` proves the non-pseudo part of
// these lists equals what the tracked queries and their reachable Rust
// implementations actually touch, exactly as
// `declared_step_edges_equal_direct_salsa_query_calls` does for option leaves
// and source roles.

/// One declared field-level dependency: the exact inputs that determine one
/// produced field.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineFieldEdge {
    pub to: &'static str,
    pub from: &'static [&'static str],
}

/// Row-set pseudo-fields. Every row-addressed output cell depends on both.
pub const ROW_SET_FIELDS: &[&str] = &["row.membership", "row.order"];

/// Whether an identifier names a modelled pseudo-field rather than a supplied
/// source column or a carrier data field.
pub fn is_pseudo_field(field: &str) -> bool {
    matches!(
        field.split_once('.'),
        Some(("row" | "derived" | "source", _))
    )
}

/// Exact data fields and supplied source columns each step consumes.
pub fn step_field_reads(step_id: &str) -> &'static [&'static str] {
    match step_id {
        "csv_parse" => &[
            "source.raw_row_set",
            "source.raw_row_order",
            "raw_chronicle_csv.study_id",
            "raw_chronicle_csv.participant_id",
            "raw_chronicle_csv.username",
            "raw_chronicle_csv.application_label",
            "raw_chronicle_csv.interaction_type",
            "raw_chronicle_csv.app_package_name",
            "raw_chronicle_csv.event_timestamp",
            "raw_chronicle_csv.timezone",
        ],
        "drop_empty_timestamp" => &["event_timestamp"],
        "detect_device_model" => &["app_package_name"],
        "build_canonical_rows" => &[
            "study_id",
            "participant_id",
            "username",
            "application_label",
            "interaction_type",
            "app_package_name",
            "event_timestamp",
            "event_timestamp_ns",
            "timezone",
            "date",
            "derived.possible_device_model",
        ],
        "stable_sort" => &["event_timestamp_ns"],
        "collect_timezones" => &["timezone"],
        "compute_dominant_timezone" => &["timezone"],
        "select_timezone_strategy" => &["timezone", "derived.dominant_timezone"],
        "restamp_rows" => &[
            "event_timestamp_ns",
            "timezone",
            "date",
            "derived.selected_timezone",
        ],
        "exact_dedupe" => &[
            "participant_id",
            "event_timestamp_ns",
            "interaction_type",
            "app_package_name",
        ],
        "count_dup_groups" => &["event_timestamp_ns"],
        "nudge_duplicate_timestamps" => &["event_timestamp_ns", "interaction_type"],
        "mark_data_time_gaps" => &["event_timestamp_ns", "data_time_gap_hours"],
        "tag_filtered_packages" => &[
            "app_package_name",
            "application_label",
            "interaction_type",
            "filter_file.app_package_name",
            "filter_file.package_name",
            "filter_file.application_label",
            "filter_file.known_application_labels",
            "filter_file.label_or_note",
        ],
        "collect_keyguard_timestamps" => &["event_timestamp_ns", "interaction_type"],
        "walk_screen_state_machine" => &[
            "event_timestamp_ns",
            "interaction_type",
            "app_package_name",
            "timezone",
        ],
        "build_classified_sessions" => &[
            "event_timestamp_ns",
            "start_timestamp_ns",
            "stop_timestamp_ns",
            "duration_seconds",
            "timezone",
            "apps_forcing_screen_open_file.package_name",
            "apps_forcing_screen_open_file.app_package_name",
            "apps_forcing_screen_open_file.label_or_note",
            "apps_forcing_screen_open_file.application_label",
            "derived.screen_state_timeline",
            "derived.keyguard_timestamps",
        ],
        "compute_junk_packages" => &["app_package_name"],
        "junk_blind_fold" => &["interaction_type", "derived.junk_packages"],
        "build_matcher_input" => &[
            "app_package_name",
            "interaction_type",
            "event_timestamp_ns",
            "background_apps_file.package_name",
            "background_apps_file.app_package_name",
        ],
        "run_matcher" => &["derived.matcher_input"],
        "apply_matcher_output" => &[
            "app_package_name",
            "participant_id",
            "interaction_type",
            "event_timestamp_ns",
            "derived.matcher_output",
            "derived.filtered_packages",
        ],
        "relabel_usage_with_floor" => &[
            "app_package_name",
            "interaction_type",
            "start_timestamp_ns",
            "stop_timestamp_ns",
            "derived.junk_packages",
        ],
        "junk_downstream_mark" => &[
            "app_package_name",
            "interaction_type",
            "derived.junk_packages",
            "background_apps_file.package_name",
            "background_apps_file.app_package_name",
        ],
        "sort_episodes" => &["event_timestamp_ns"],
        "split_concurrent" => &[
            "app_package_name",
            "interaction_type",
            "event_timestamp_ns",
            "start_timestamp_ns",
            "stop_timestamp_ns",
            "derived.junk_packages",
            "background_apps_file.package_name",
            "background_apps_file.app_package_name",
        ],
        "codebook_join" => CODEBOOK_JOIN_FIELD_READS,
        "derive_broad_category" => &["codebook_fields", "broad_app_category"],
        "collapse_genre" => &[
            "codebook_fields",
            "codebook_genre_fields_cleared",
            "genre_id_scraped",
        ],
        "engagement_walk" => &[
            "app_package_name",
            "interaction_type",
            "start_timestamp_ns",
            "stop_timestamp_ns",
            "usage_layer",
            "valid_app_new_engage_30s",
            "valid_app_new_engage_custom",
            "valid_app_switched_app",
            "valid_app_usage_time_gap_hours",
            "any_app_new_engage_30s",
            "any_app_new_engage_custom",
            "any_app_switched_app",
            "any_app_usage_time_gap_hours",
        ],
        "flag_and_retain" => &[
            "any_app_usage_flags",
            "data_time_gap_hours",
            "duration_minutes",
        ],
        "blank_junk_timing" => &[
            "interaction_type",
            "start_timestamp_ns",
            "stop_timestamp_ns",
            "duration_seconds",
            "duration_minutes",
            "derived.junk_packages",
        ],
        "drop_selected_types" => &["interaction_type", "data_time_gap_hours"],
        "drop_zero_duration" => &["interaction_type", "duration_seconds"],
        "partition_credit_sessions" => &["interaction_type", "duration_minutes"],
        "build_liveness_substrate" => &[
            "participant_id",
            "interaction_type",
            "event_timestamp_ns",
        ],
        "report_screen_incapable" => &[
            "participant_id",
            "derived.credit_partition",
            "derived.liveness_substrate",
        ],
        "count_day_apps" => &[
            "participant_id",
            "date",
            "app_package_name",
            "derived.credit_partition",
        ],
        "credit_sessions" => &[
            "participant_id",
            "date",
            "start_timestamp_ns",
            "stop_timestamp_ns",
            "derived.credit_partition",
            "derived.liveness_substrate",
            "derived.day_app_counts",
        ],
        "emit_credited_rows" => &[
            "participant_id",
            "event_timestamp_ns",
            "timezone",
            "derived.credit_partition",
            "derived.liveness_substrate",
            "derived.credit_decisions",
        ],
        "assemble_credit_result" => &[
            "duration_minutes",
            "derived.credit_partition",
            "derived.screen_incapable_participants",
        ],
        "resolve_participant_windows" => &[
            "participant_id",
            "study_dates_file.participant_id",
            "study_dates_file.start_date",
            "study_dates_file.end_date",
        ],
        "filter_rows_to_window" => &[
            "participant_id",
            "date",
            "derived.participant_windows",
            "study_dates_file.participant_id",
            "study_dates_file.start_date",
            "study_dates_file.end_date",
        ],
        "resolve_sharing_status" => &[
            "participant_id",
            "device_sharing_file.participant_id",
            "device_sharing_file.sharing_status",
        ],
        "build_survey_lookup" => &[
            "survey_attribution_file.participant_id",
            "survey_attribution_file.event_timestamp",
            "survey_attribution_file.users",
        ],
        "attribute_rows" => &[
            "participant_id",
            "username",
            "interaction_type",
            "app_package_name",
            "event_timestamp_ns",
            "derived.sharing_status",
            "derived.survey_lookup",
        ],
        "inject_placeholders" => &[
            "participant_id",
            "date",
            "interaction_type",
            "event_timestamp_ns",
            "timezone",
        ],
        "build_raw_date_index" => &["participant_id", "date"],
        "build_coverage_table" => &[
            "participant_id",
            "date",
            "interaction_type",
            "duration_minutes",
            "derived.raw_date_index",
            "derived.participant_windows",
            "study_dates_file.participant_id",
            "study_dates_file.start_date",
            "study_dates_file.end_date",
        ],
        "accumulate_attribution_minutes" => &[
            "participant_id",
            "username",
            "date",
            "interaction_type",
            "duration_minutes",
        ],
        "score_days" => &[
            "derived.attribution_minutes",
            "derived.sharing_status",
        ],
        "assemble_result" => ASSEMBLE_RESULT_FIELD_READS,
        // `parse_remap_config`, `resolve_preproc_datetime` and
        // `row_count_report` consume configuration leaves or row counts only;
        // their option bindings already carry their whole dependency.
        _ => &[],
    }
}

/// Exact data fields, row-set properties, and derived product values each step
/// produces.
pub fn step_field_writes(step_id: &str) -> &'static [&'static str] {
    match step_id {
        "csv_parse" => &[
            "row.membership",
            "row.order",
            "study_id",
            "participant_id",
            "username",
            "application_label",
            "interaction_type",
            "app_package_name",
            "event_timestamp",
            "timezone",
        ],
        "drop_empty_timestamp" => &["row.membership"],
        "detect_device_model" => &["derived.possible_device_model"],
        "build_canonical_rows" => CANONICAL_ROW_FIELDS,
        "stable_sort" => &["row.order"],
        "collect_timezones" => &["derived.timezone_set"],
        "compute_dominant_timezone" => &["derived.dominant_timezone"],
        "select_timezone_strategy" => &["derived.selected_timezone"],
        "restamp_rows" => &[
            "row.membership",
            "timezone",
            "date",
            "day",
            "weekday_mf",
            "weekday_mth",
            "weekday_su_th",
            "hour",
            "quarter",
        ],
        "row_count_report" => &["derived.row_count_report"],
        "exact_dedupe" => &["row.membership"],
        "count_dup_groups" => &["derived.duplicate_group_count"],
        "nudge_duplicate_timestamps" => &["row.order", "event_timestamp_ns"],
        "mark_data_time_gaps" => &["data_time_gap_hours"],
        "tag_filtered_packages" => &["interaction_type", "derived.filtered_packages"],
        "collect_keyguard_timestamps" => &["derived.keyguard_timestamps"],
        "walk_screen_state_machine" => &["derived.screen_state_timeline"],
        "build_classified_sessions" => &[
            "row.membership",
            "row.order",
            "app_package_name",
            "application_label",
            "interaction_type",
            "event_timestamp_ns",
            "start_timestamp_ns",
            "stop_timestamp_ns",
            "duration_seconds",
            "duration_minutes",
            "data_time_gap_hours",
            "date",
            "day",
            "weekday_mf",
            "weekday_mth",
            "weekday_su_th",
            "hour",
            "quarter",
            "screen_usage_end_reason",
            "screen_usage_end_reason_confidence",
            "screen_usage_stop_event_type",
            "screen_usage_last_activity_timestamp_ns",
            "screen_usage_tail_gap_seconds",
            "screen_usage_foreground_app_package",
            "screen_usage_apps_forcing_screen_open_label",
            "screen_usage_lock_screen_only",
        ],
        "compute_junk_packages" => &["derived.junk_packages"],
        "junk_blind_fold" => &["interaction_type"],
        "build_matcher_input" => &["derived.matcher_input"],
        "run_matcher" => &["derived.matcher_output"],
        "apply_matcher_output" | "relabel_usage_with_floor" | "junk_downstream_mark" => &[
            "interaction_type",
            "start_timestamp_ns",
            "stop_timestamp_ns",
            "duration_seconds",
            "duration_minutes",
        ],
        "sort_episodes" => &["row.order"],
        "split_concurrent" => &[
            "row.membership",
            "row.order",
            "start_timestamp_ns",
            "stop_timestamp_ns",
            "duration_seconds",
            "duration_minutes",
            "usage_layer",
        ],
        "codebook_join" => &["codebook_fields"],
        "derive_broad_category" => &["broad_app_category"],
        "collapse_genre" => &["genre_id_scraped", "codebook_genre_fields_cleared"],
        "engagement_walk" => &[
            "valid_app_new_engage_30s",
            "valid_app_new_engage_custom",
            "valid_app_switched_app",
            "valid_app_usage_time_gap_hours",
            "any_app_new_engage_30s",
            "any_app_new_engage_custom",
            "any_app_switched_app",
            "any_app_usage_time_gap_hours",
        ],
        "flag_and_retain" => &["any_app_usage_flags"],
        "blank_junk_timing" => &[
            "start_timestamp_ns",
            "stop_timestamp_ns",
            "duration_seconds",
            "duration_minutes",
        ],
        "drop_selected_types" | "drop_zero_duration" | "filter_rows_to_window" => {
            &["row.membership"]
        }
        "partition_credit_sessions" => &["derived.credit_partition"],
        "build_liveness_substrate" => &["derived.liveness_substrate"],
        "report_screen_incapable" => &["derived.screen_incapable_participants"],
        "count_day_apps" => &["derived.day_app_counts"],
        "credit_sessions" => &["derived.credit_decisions"],
        "emit_credited_rows" => &[
            "row.membership",
            "row.order",
            "event_timestamp_ns",
            "start_timestamp_ns",
            "stop_timestamp_ns",
            "duration_seconds",
            "duration_minutes",
            "date",
            "day",
            "weekday_mf",
            "weekday_mth",
            "weekday_su_th",
            "hour",
            "quarter",
        ],
        "assemble_credit_result" => &["derived.credit_result"],
        "resolve_participant_windows" => &["derived.participant_windows"],
        "resolve_sharing_status" => &["derived.sharing_status"],
        "build_survey_lookup" => &["derived.survey_lookup"],
        "attribute_rows" => &["username", "interaction_type"],
        "inject_placeholders" => &[
            "row.membership",
            "row.order",
            "app_package_name",
            "application_label",
            "interaction_type",
            "start_timestamp_ns",
            "stop_timestamp_ns",
            "duration_seconds",
            "duration_minutes",
            "data_time_gap_hours",
            "date",
            "day",
            "weekday_mf",
            "weekday_mth",
            "weekday_su_th",
            "hour",
            "quarter",
        ],
        "build_raw_date_index" => &["derived.raw_date_index"],
        "build_coverage_table" => &["derived.coverage_table"],
        "accumulate_attribution_minutes" => &["derived.attribution_minutes"],
        "score_days" => &["derived.compliance_scores"],
        // `assemble_result` renders rather than transforms: what it produces is
        // declared cell by cell in `PIPELINE_OUTPUT_CELL_BINDINGS`.
        _ => &[],
    }
}

/// Every data field of the canonical row carrier, in `RowData` order.
const CANONICAL_ROW_FIELDS: &[&str] = &[
    "study_id",
    "participant_id",
    "possible_device_model",
    "username",
    "application_label",
    "interaction_type",
    "app_package_name",
    "event_timestamp_ns",
    "timezone",
    "data_time_gap_hours",
    "date",
    "day",
    "weekday_mf",
    "weekday_mth",
    "weekday_su_th",
    "hour",
    "quarter",
    "start_timestamp_ns",
    "stop_timestamp_ns",
    "duration_seconds",
    "duration_minutes",
    "screen_usage_end_reason",
    "screen_usage_end_reason_confidence",
    "screen_usage_stop_event_type",
    "screen_usage_last_activity_timestamp_ns",
    "screen_usage_tail_gap_seconds",
    "screen_usage_foreground_app_package",
    "screen_usage_apps_forcing_screen_open_label",
    "screen_usage_lock_screen_only",
    "any_app_usage_flags",
    "valid_app_new_engage_30s",
    "valid_app_new_engage_custom",
    "valid_app_switched_app",
    "valid_app_usage_time_gap_hours",
    "any_app_new_engage_30s",
    "any_app_new_engage_custom",
    "any_app_switched_app",
    "any_app_usage_time_gap_hours",
    "genre_id_scraped",
    "broad_app_category",
    "codebook_fields",
    "codebook_genre_fields_cleared",
    "usage_layer",
];

const CODEBOOK_JOIN_FIELD_READS: &[&str] = &[
    "app_package_name",
    "codebook_fields",
    "app_codebook_file.app_package_name",
    "app_codebook_file.application_label",
    "app_codebook_file.bcm_play_store_genreId",
    "app_codebook_file.bcm_play_store_genre",
    "app_codebook_file.bcm_play_store_broad_app_category",
    "app_codebook_file.bcm_play_store_developer",
    "app_codebook_file.bcm_play_store_free",
    "app_codebook_file.bcm_play_store_rating",
    "app_codebook_file.bcm_play_store_downloads",
    "app_codebook_file.usc_broad_app_category",
    "app_codebook_file.usc_genreId",
    "app_codebook_file.umich_child_app_category_code",
    "app_codebook_file.umich_child_app_category",
    "app_codebook_file.umich_adult_app_category_code",
    "app_codebook_file.umich_adult_app_category",
    "app_codebook_file.umich_free",
    "app_codebook_file.umich_gambling_app",
    "app_codebook_file.umich_inappropriate_app",
    "app_codebook_file.babyemu_genreId_scraped",
    "app_codebook_file.babyemu_genreId_manual",
    "app_codebook_file.babyemu_broad_app_category",
    "app_codebook_file.babyemu_medium_app_category",
    "app_codebook_file.babyemu_fine_app_category",
    "app_codebook_file.babyemu_alternate_fine_app_category",
    "app_codebook_file.babyemu_kids",
    "app_codebook_file.bcm_cnrc_heuristic_category",
    "app_codebook_file.bcm_cnrc_categorization_source",
    "app_codebook_file.dataset",
];

/// `assemble_result` reads every rendered row field plus the enrolled-device
/// counts that scale the compliance denominators.
const ASSEMBLE_RESULT_FIELD_READS: &[&str] = &[
    "study_id",
    "participant_id",
    "possible_device_model",
    "username",
    "application_label",
    "interaction_type",
    "app_package_name",
    "event_timestamp_ns",
    "timezone",
    "data_time_gap_hours",
    "date",
    "day",
    "weekday_mf",
    "weekday_mth",
    "weekday_su_th",
    "hour",
    "quarter",
    "start_timestamp_ns",
    "stop_timestamp_ns",
    "duration_seconds",
    "duration_minutes",
    "screen_usage_end_reason",
    "screen_usage_end_reason_confidence",
    "screen_usage_stop_event_type",
    "screen_usage_last_activity_timestamp_ns",
    "screen_usage_tail_gap_seconds",
    "screen_usage_foreground_app_package",
    "screen_usage_apps_forcing_screen_open_label",
    "screen_usage_lock_screen_only",
    "any_app_usage_flags",
    "valid_app_new_engage_30s",
    "valid_app_new_engage_custom",
    "valid_app_switched_app",
    "valid_app_usage_time_gap_hours",
    "any_app_new_engage_30s",
    "any_app_new_engage_custom",
    "any_app_switched_app",
    "any_app_usage_time_gap_hours",
    "genre_id_scraped",
    "broad_app_category",
    "codebook_fields",
    "codebook_genre_fields_cleared",
    "usage_layer",
    "derived.row_count_report",
    "derived.duplicate_group_count",
    "derived.timezone_set",
    "derived.selected_timezone",
    "derived.coverage_table",
    "derived.compliance_scores",
    "derived.credit_result",
    "derived.sharing_status",
    "enrolled_devices_file.participant_id",
    "enrolled_devices_file.device_count",
];

/// Steps whose produced fields are *not* each determined by every declared
/// read. A constructor-like step initializes most fields from constants, so a
/// full cross product there would make the field graph vacuous.
fn step_field_edge_overrides(step_id: &str) -> &'static [(&'static str, &'static [&'static str])] {
    match step_id {
        "csv_parse" => &[
            ("row.membership", &["source.raw_row_set"]),
            ("row.order", &["source.raw_row_order"]),
            ("study_id", &["raw_chronicle_csv.study_id"]),
            ("participant_id", &["raw_chronicle_csv.participant_id"]),
            ("username", &["raw_chronicle_csv.username"]),
            ("application_label", &["raw_chronicle_csv.application_label"]),
            ("interaction_type", &["raw_chronicle_csv.interaction_type"]),
            ("app_package_name", &["raw_chronicle_csv.app_package_name"]),
            ("event_timestamp", &["raw_chronicle_csv.event_timestamp"]),
            ("timezone", &["raw_chronicle_csv.timezone"]),
        ],
        // `build_canonical_rows` constructs the carrier: most fields are
        // initialized from constants and gain content only downstream. The
        // `&[]` entries are those constants — `RowData { .., duration_seconds:
        // None, .. }` in `pipeline_v2_incremental::build_canonical_rows`. They
        // must be listed: a produced field missing from this table would
        // silently fall back to "every read determines it", which makes every
        // raw column reach every downstream field.
        "build_canonical_rows" => &[
            ("study_id", &["study_id"]),
            ("participant_id", &["participant_id"]),
            ("possible_device_model", &["derived.possible_device_model"]),
            ("username", &["username"]),
            ("application_label", &["application_label"]),
            ("interaction_type", &["interaction_type"]),
            ("app_package_name", &["app_package_name"]),
            ("event_timestamp_ns", &["event_timestamp"]),
            ("timezone", &["timezone"]),
            ("date", &["event_timestamp_ns", "timezone", "date"]),
            ("day", &["event_timestamp_ns", "timezone"]),
            ("weekday_mf", &["event_timestamp_ns", "timezone"]),
            ("weekday_mth", &["event_timestamp_ns", "timezone"]),
            ("weekday_su_th", &["event_timestamp_ns", "timezone"]),
            ("hour", &["event_timestamp_ns", "timezone"]),
            ("quarter", &["event_timestamp_ns", "timezone"]),
            ("data_time_gap_hours", &[]),
            ("start_timestamp_ns", &[]),
            ("stop_timestamp_ns", &[]),
            ("duration_seconds", &[]),
            ("duration_minutes", &[]),
            ("screen_usage_end_reason", &[]),
            ("screen_usage_end_reason_confidence", &[]),
            ("screen_usage_stop_event_type", &[]),
            ("screen_usage_last_activity_timestamp_ns", &[]),
            ("screen_usage_tail_gap_seconds", &[]),
            ("screen_usage_foreground_app_package", &[]),
            ("screen_usage_apps_forcing_screen_open_label", &[]),
            ("screen_usage_lock_screen_only", &[]),
            ("any_app_usage_flags", &[]),
            ("valid_app_new_engage_30s", &[]),
            ("valid_app_new_engage_custom", &[]),
            ("valid_app_switched_app", &[]),
            ("valid_app_usage_time_gap_hours", &[]),
            ("any_app_new_engage_30s", &[]),
            ("any_app_new_engage_custom", &[]),
            ("any_app_switched_app", &[]),
            ("any_app_usage_time_gap_hours", &[]),
            ("genre_id_scraped", &[]),
            ("broad_app_category", &[]),
            ("codebook_fields", &[]),
            ("codebook_genre_fields_cleared", &[]),
            ("usage_layer", &[]),
        ],
        // The engagement walk keeps the `valid_*` and `any_*` families apart:
        // each family is carried forward from its own previous value.
        "engagement_walk" => &[
            (
                "valid_app_new_engage_30s",
                &[
                    "app_package_name",
                    "interaction_type",
                    "start_timestamp_ns",
                    "stop_timestamp_ns",
                    "usage_layer",
                    "valid_app_new_engage_30s",
                ],
            ),
            (
                "valid_app_new_engage_custom",
                &[
                    "app_package_name",
                    "interaction_type",
                    "start_timestamp_ns",
                    "stop_timestamp_ns",
                    "usage_layer",
                    "valid_app_new_engage_custom",
                ],
            ),
            (
                "valid_app_switched_app",
                &[
                    "app_package_name",
                    "interaction_type",
                    "start_timestamp_ns",
                    "stop_timestamp_ns",
                    "usage_layer",
                    "valid_app_switched_app",
                ],
            ),
            (
                "valid_app_usage_time_gap_hours",
                &[
                    "app_package_name",
                    "interaction_type",
                    "start_timestamp_ns",
                    "stop_timestamp_ns",
                    "usage_layer",
                    "valid_app_usage_time_gap_hours",
                ],
            ),
            (
                "any_app_new_engage_30s",
                &[
                    "app_package_name",
                    "interaction_type",
                    "start_timestamp_ns",
                    "stop_timestamp_ns",
                    "usage_layer",
                    "any_app_new_engage_30s",
                ],
            ),
            (
                "any_app_new_engage_custom",
                &[
                    "app_package_name",
                    "interaction_type",
                    "start_timestamp_ns",
                    "stop_timestamp_ns",
                    "usage_layer",
                    "any_app_new_engage_custom",
                ],
            ),
            (
                "any_app_switched_app",
                &[
                    "app_package_name",
                    "interaction_type",
                    "start_timestamp_ns",
                    "stop_timestamp_ns",
                    "usage_layer",
                    "any_app_switched_app",
                ],
            ),
            (
                "any_app_usage_time_gap_hours",
                &[
                    "app_package_name",
                    "interaction_type",
                    "start_timestamp_ns",
                    "stop_timestamp_ns",
                    "usage_layer",
                    "any_app_usage_time_gap_hours",
                ],
            ),
        ],
        _ => &[],
    }
}

/// The declared field-level dependency edges of one product step. A step
/// absent from `step_field_edge_overrides` is an atomic transformation: every
/// field it produces is determined by every field it reads. A step present
/// there must name every field it produces — `override_tables_cover_every_
/// produced_field` fails otherwise, because a missing entry would silently
/// restore the atomic cross for that one field.
pub fn step_field_edges(step_id: &str) -> Vec<PipelineFieldEdge> {
    let overrides = step_field_edge_overrides(step_id);
    let reads = step_field_reads(step_id);
    step_field_writes(step_id)
        .iter()
        .map(|to| PipelineFieldEdge {
            to,
            from: overrides
                .iter()
                .find(|(field, _)| field == to)
                .map(|(_, from)| *from)
                .unwrap_or(reads),
        })
        .collect()
}

// ---- output cell bindings ------------------------------------------------

/// One canonical output cell family and the data fields that render it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineOutputCellBinding {
    /// Canonical output artifact, as addressed by the changed-cell evidence.
    pub output_kind: &'static str,
    /// CSV column name, or a JSON pointer whose `*` segments match any index
    /// or key.
    pub column: &'static str,
    /// The step that renders it.
    pub emitting_step: &'static str,
    /// Data fields that determine the cell value. Row-addressed cells
    /// additionally depend on `ROW_SET_FIELDS`; see `output_cell_dependencies`.
    pub from: &'static [&'static str],
}

const APP_ROW_COLUMNS: &[(&str, &[&str])] = &[
    ("study_id", &["study_id"]),
    ("study_name", &[]),
    ("participant_id", &["participant_id"]),
    ("possible_device_model", &["possible_device_model"]),
    ("username", &["username"]),
    ("event_timestamp", &["event_timestamp_ns", "timezone"]),
    ("date", &["date"]),
    ("timezone", &["timezone"]),
    ("app_package_name", &["app_package_name"]),
    ("application_label", &["application_label"]),
    ("genreId_scraped", &["genre_id_scraped"]),
    ("broad_app_category", &["broad_app_category"]),
    ("interaction_type", &["interaction_type"]),
    ("start_timestamp", &["start_timestamp_ns", "timezone"]),
    ("stop_timestamp", &["stop_timestamp_ns", "timezone"]),
    ("duration_seconds", &["duration_seconds"]),
    ("duration_minutes", &["duration_minutes"]),
    ("any_app_usage_flags", &["any_app_usage_flags"]),
    ("data_time_gap_hours", &["data_time_gap_hours"]),
    ("day", &["day"]),
    ("weekdayMF", &["weekday_mf"]),
    ("weekdayMTh", &["weekday_mth"]),
    ("weekdaySuTh", &["weekday_su_th"]),
    ("hour", &["hour"]),
    ("quarter", &["quarter"]),
    ("valid_app_new_engage_30s", &["valid_app_new_engage_30s"]),
    (
        "valid_app_new_engage_custom_*s",
        &["valid_app_new_engage_custom"],
    ),
    ("valid_app_switched_app", &["valid_app_switched_app"]),
    (
        "valid_app_usage_time_gap_hours",
        &["valid_app_usage_time_gap_hours"],
    ),
    ("any_app_new_engage_30s", &["any_app_new_engage_30s"]),
    (
        "any_app_new_engage_custom_*s",
        &["any_app_new_engage_custom"],
    ),
    ("any_app_switched_app", &["any_app_switched_app"]),
    (
        "any_app_usage_time_gap_hours",
        &["any_app_usage_time_gap_hours"],
    ),
    ("preprocessor_version", &[]),
    ("datetime_of_preprocessing", &[]),
    ("usage_layer", &["usage_layer"]),
    ("shape/rows", &[]),
];

const SCREEN_ROW_COLUMNS: &[(&str, &[&str])] = &[
    ("study_id", &["study_id"]),
    ("study_name", &[]),
    ("participant_id", &["participant_id"]),
    ("possible_device_model", &["possible_device_model"]),
    ("username", &["username"]),
    ("event_timestamp", &["event_timestamp_ns", "timezone"]),
    ("date", &["date"]),
    ("timezone", &["timezone"]),
    ("app_package_name", &["app_package_name"]),
    ("application_label", &["application_label"]),
    ("interaction_type", &["interaction_type"]),
    ("start_timestamp", &["start_timestamp_ns", "timezone"]),
    ("stop_timestamp", &["stop_timestamp_ns", "timezone"]),
    ("duration_seconds", &["duration_seconds"]),
    ("duration_minutes", &["duration_minutes"]),
    ("screen_usage_end_reason", &["screen_usage_end_reason"]),
    (
        "screen_usage_end_reason_confidence",
        &["screen_usage_end_reason_confidence"],
    ),
    (
        "screen_usage_stop_event_type",
        &["screen_usage_stop_event_type"],
    ),
    (
        "screen_usage_last_activity_timestamp",
        &["screen_usage_last_activity_timestamp_ns", "timezone"],
    ),
    (
        "screen_usage_tail_gap_seconds",
        &["screen_usage_tail_gap_seconds"],
    ),
    (
        "screen_usage_foreground_app_package",
        &["screen_usage_foreground_app_package"],
    ),
    (
        "screen_usage_apps_forcing_screen_open_label",
        &["screen_usage_apps_forcing_screen_open_label"],
    ),
    (
        "screen_usage_lock_screen_only",
        &["screen_usage_lock_screen_only"],
    ),
    ("data_time_gap_hours", &["data_time_gap_hours"]),
    ("day", &["day"]),
    ("weekdayMF", &["weekday_mf"]),
    ("weekdayMTh", &["weekday_mth"]),
    ("weekdaySuTh", &["weekday_su_th"]),
    ("hour", &["hour"]),
    ("quarter", &["quarter"]),
    ("preprocessor_version", &[]),
    ("datetime_of_preprocessing", &[]),
    ("shape/rows", &[]),
];

/// Every day a review-summary metric is accumulated from a complete session.
/// The review summary keys its `participants` array by study and participant,
/// so every `/participants/*/…` address depends on both, even where the value
/// it carries is a copy of only one of them.
const REVIEW_PARTICIPANT_KEY_FIELDS: &[&str] = &["study_id", "participant_id"];

const REVIEW_SESSION_FIELDS: &[&str] = &[
    "study_id",
    "participant_id",
    "date",
    "interaction_type",
    "start_timestamp_ns",
    "stop_timestamp_ns",
    "duration_minutes",
    "usage_layer",
];

const NON_ROW_CELL_BINDINGS: &[PipelineOutputCellBinding] = &[
    PipelineOutputCellBinding {
        output_kind: "compliance-csv",
        column: "participant_id",
        emitting_step: "assemble_result",
        from: &["derived.compliance_scores"],
    },
    PipelineOutputCellBinding {
        output_kind: "compliance-csv",
        column: "date",
        emitting_step: "assemble_result",
        from: &["derived.compliance_scores"],
    },
    PipelineOutputCellBinding {
        output_kind: "compliance-csv",
        column: "known_minutes",
        emitting_step: "assemble_result",
        from: &["derived.compliance_scores"],
    },
    PipelineOutputCellBinding {
        output_kind: "compliance-csv",
        column: "unknown_minutes",
        emitting_step: "assemble_result",
        from: &["derived.compliance_scores"],
    },
    PipelineOutputCellBinding {
        output_kind: "compliance-csv",
        column: "compliance_percent",
        emitting_step: "assemble_result",
        from: &["derived.compliance_scores"],
    },
    PipelineOutputCellBinding {
        output_kind: "compliance-csv",
        column: "zero_real_usage",
        emitting_step: "assemble_result",
        from: &["derived.compliance_scores"],
    },
    PipelineOutputCellBinding {
        output_kind: "compliance-csv",
        column: "sharing_status",
        emitting_step: "assemble_result",
        from: &["derived.compliance_scores", "derived.sharing_status"],
    },
    PipelineOutputCellBinding {
        output_kind: "compliance-csv",
        column: "expected_device_count",
        emitting_step: "assemble_result",
        from: &[
            "derived.compliance_scores",
            "enrolled_devices_file.participant_id",
            "enrolled_devices_file.device_count",
        ],
    },
    PipelineOutputCellBinding {
        output_kind: "compliance-csv",
        column: "is_valid",
        emitting_step: "assemble_result",
        from: &[
            "derived.compliance_scores",
            "derived.sharing_status",
            "enrolled_devices_file.participant_id",
            "enrolled_devices_file.device_count",
        ],
    },
    PipelineOutputCellBinding {
        output_kind: "compliance-csv",
        column: "shape/rows",
        emitting_step: "assemble_result",
        from: &["derived.compliance_scores"],
    },
    PipelineOutputCellBinding {
        output_kind: "day-coverage-csv",
        column: "participant_id",
        emitting_step: "build_coverage_table",
        from: &["derived.coverage_table"],
    },
    PipelineOutputCellBinding {
        output_kind: "day-coverage-csv",
        column: "date",
        emitting_step: "build_coverage_table",
        from: &["derived.coverage_table"],
    },
    PipelineOutputCellBinding {
        output_kind: "day-coverage-csv",
        column: "status",
        emitting_step: "build_coverage_table",
        from: &["derived.coverage_table"],
    },
    PipelineOutputCellBinding {
        output_kind: "day-coverage-csv",
        column: "shape/rows",
        emitting_step: "build_coverage_table",
        from: &["derived.coverage_table"],
    },
    PipelineOutputCellBinding {
        output_kind: "review-summary-json",
        column: "/participants/*/studyId",
        emitting_step: "assemble_result",
        from: REVIEW_PARTICIPANT_KEY_FIELDS,
    },
    PipelineOutputCellBinding {
        output_kind: "review-summary-json",
        column: "/participants/*/participantId",
        emitting_step: "assemble_result",
        from: REVIEW_PARTICIPANT_KEY_FIELDS,
    },
    PipelineOutputCellBinding {
        output_kind: "review-summary-json",
        column: "/participants/*/perDay/*/*",
        emitting_step: "assemble_result",
        from: REVIEW_SESSION_FIELDS,
    },
    PipelineOutputCellBinding {
        output_kind: "review-summary-json",
        column: "/participants/*/perDay/*/flags/*",
        emitting_step: "assemble_result",
        from: REVIEW_SESSION_FIELDS,
    },
    PipelineOutputCellBinding {
        output_kind: "review-summary-json",
        column: "/participants/*/totals/*",
        emitting_step: "assemble_result",
        from: REVIEW_SESSION_FIELDS,
    },
    PipelineOutputCellBinding {
        output_kind: "review-summary-json",
        column: "/participants/*/topAppsByDate",
        emitting_step: "assemble_result",
        from: &[
            "study_id",
            "participant_id",
            "date",
            "duration_minutes",
            "app_package_name",
        ],
    },
    PipelineOutputCellBinding {
        output_kind: "review-summary-json",
        column: "/participants/*/topAppsByDate/*/*/appPackageName",
        emitting_step: "assemble_result",
        from: &[
            "study_id",
            "participant_id",
            "date",
            "duration_minutes",
            "app_package_name",
        ],
    },
    PipelineOutputCellBinding {
        output_kind: "review-summary-json",
        column: "/participants/*/topAppsByDate/*/*/applicationLabel",
        emitting_step: "assemble_result",
        from: &[
            "study_id",
            "participant_id",
            "date",
            "duration_minutes",
            "app_package_name",
            "application_label",
        ],
    },
    PipelineOutputCellBinding {
        output_kind: "review-summary-json",
        column: "/participants/*/topAppsByDate/*/*/category",
        emitting_step: "assemble_result",
        from: &[
            "study_id",
            "participant_id",
            "date",
            "duration_minutes",
            "app_package_name",
            "broad_app_category",
        ],
    },
    PipelineOutputCellBinding {
        output_kind: "review-summary-json",
        column: "/participants/*/topAppsByDate/*/*/minutes",
        emitting_step: "assemble_result",
        from: &[
            "study_id",
            "participant_id",
            "date",
            "duration_minutes",
            "app_package_name",
        ],
    },
    PipelineOutputCellBinding {
        output_kind: "visualization-data-json",
        column: "/appRows/*/*",
        emitting_step: "assemble_result",
        from: VISUALIZATION_ROW_FIELDS,
    },
    PipelineOutputCellBinding {
        output_kind: "visualization-data-json",
        column: "/screenRows/*/*",
        emitting_step: "assemble_result",
        from: VISUALIZATION_ROW_FIELDS,
    },
    PipelineOutputCellBinding {
        output_kind: "visualization-data-json",
        column: "/eventTimestampsByParticipant/*/*",
        emitting_step: "assemble_result",
        from: &["participant_id", "event_timestamp_ns"],
    },
];

/// A row reaches a period/day/participant aggregate group through exactly this
/// grouping key and `pipeline_v2_aggregates::complete`, which requires the
/// kind's interaction type and both session bounds. `usage_layer` splits the
/// foreground group from the background group.
const AGGREGATE_GROUPING_FIELDS: &[&str] = &[
    "study_id",
    "participant_id",
    "date",
    "interaction_type",
    "start_timestamp_ns",
    "stop_timestamp_ns",
    "usage_layer",
];

/// Every accumulated aggregate metric additionally reads the session length and
/// the package identity that `summarize` counts switches on.
const AGGREGATE_METRIC_FIELDS: &[&str] = &[
    "study_id",
    "participant_id",
    "date",
    "interaction_type",
    "start_timestamp_ns",
    "stop_timestamp_ns",
    "usage_layer",
    "duration_minutes",
    "app_package_name",
];

/// `summary_csv` wide/long period columns shared by the daily and weekly
/// aggregates. The period column itself differs and is bound per kind.
const AGGREGATE_SUMMARY_SHARED_COLUMNS: &[(&str, &[&str])] = &[
    ("study_id", AGGREGATE_GROUPING_FIELDS),
    // The value is the `study_name` option, but an aggregate row exists only
    // for a group, so which addresses carry it depends on the grouping fields.
    // `ROW_SET_FIELDS` alone does not cover this: adding a distinct `study_id`
    // to one existing raw row creates a whole aggregate row without changing
    // the raw row set.
    ("study_name", AGGREGATE_GROUPING_FIELDS),
    ("participant_id", AGGREGATE_GROUPING_FIELDS),
    ("timezone", &[
        "study_id",
        "participant_id",
        "date",
        "interaction_type",
        "start_timestamp_ns",
        "stop_timestamp_ns",
        "usage_layer",
        "timezone",
    ]),
    ("total_app_usage_minutes", AGGREGATE_METRIC_FIELDS),
    ("total_background_app_usage_minutes", AGGREGATE_METRIC_FIELDS),
    ("total_screen_usage_minutes", AGGREGATE_METRIC_FIELDS),
    ("app_session_count", AGGREGATE_METRIC_FIELDS),
    ("screen_session_count", AGGREGATE_METRIC_FIELDS),
    ("app_switches", AGGREGATE_METRIC_FIELDS),
    ("pickups", AGGREGATE_METRIC_FIELDS),
    ("mean_app_session_minutes", AGGREGATE_METRIC_FIELDS),
    ("longest_app_session_minutes", AGGREGATE_METRIC_FIELDS),
    ("active_window_minutes", AGGREGATE_METRIC_FIELDS),
    ("first_use", &[
        "study_id",
        "participant_id",
        "date",
        "interaction_type",
        "start_timestamp_ns",
        "stop_timestamp_ns",
        "usage_layer",
        "timezone",
    ]),
    ("last_use", &[
        "study_id",
        "participant_id",
        "date",
        "interaction_type",
        "start_timestamp_ns",
        "stop_timestamp_ns",
        "usage_layer",
        "timezone",
    ]),
    // `aggregate_shape = "long"` replaces the metric columns with a
    // metric-name/value pair over the same accumulated fields.
    ("metric", AGGREGATE_GROUPING_FIELDS),
    ("value", AGGREGATE_METRIC_FIELDS),
    ("shape/rows", AGGREGATE_GROUPING_FIELDS),
];

/// Columns only the daily summary carries: the calendar date it is keyed by and
/// the weekday projections `summarize` samples from the group's first row.
const AGGREGATE_DAILY_ONLY_COLUMNS: &[(&str, &[&str])] = &[
    ("date", AGGREGATE_GROUPING_FIELDS),
    ("day", &[
        "study_id",
        "participant_id",
        "date",
        "interaction_type",
        "start_timestamp_ns",
        "stop_timestamp_ns",
        "usage_layer",
        "day",
    ]),
    ("weekdayMF", &[
        "study_id",
        "participant_id",
        "date",
        "interaction_type",
        "start_timestamp_ns",
        "stop_timestamp_ns",
        "usage_layer",
        "weekday_mf",
    ]),
    ("weekdayMTh", &[
        "study_id",
        "participant_id",
        "date",
        "interaction_type",
        "start_timestamp_ns",
        "stop_timestamp_ns",
        "usage_layer",
        "weekday_mth",
    ]),
    ("weekdaySuTh", &[
        "study_id",
        "participant_id",
        "date",
        "interaction_type",
        "start_timestamp_ns",
        "stop_timestamp_ns",
        "usage_layer",
        "weekday_su_th",
    ]),
];

/// Columns only the weekly summary carries. `iso_period` folds the row date
/// into an ISO year-week, and `week_start_date` is derived back from it.
const AGGREGATE_WEEKLY_ONLY_COLUMNS: &[(&str, &[&str])] = &[
    ("iso_year_week", AGGREGATE_GROUPING_FIELDS),
    ("week_start_date", AGGREGATE_GROUPING_FIELDS),
];

const AGGREGATE_TOP_APPS_COLUMNS: &[(&str, &[&str])] = &[
    ("study_id", AGGREGATE_METRIC_FIELDS),
    ("study_name", AGGREGATE_METRIC_FIELDS),
    ("participant_id", AGGREGATE_METRIC_FIELDS),
    ("date", AGGREGATE_METRIC_FIELDS),
    ("rank", AGGREGATE_METRIC_FIELDS),
    ("app_package_name", AGGREGATE_METRIC_FIELDS),
    ("application_label", &[
        "study_id",
        "participant_id",
        "date",
        "interaction_type",
        "start_timestamp_ns",
        "stop_timestamp_ns",
        "usage_layer",
        "duration_minutes",
        "app_package_name",
        "application_label",
    ]),
    ("foreground_minutes", AGGREGATE_METRIC_FIELDS),
    ("background_minutes", AGGREGATE_METRIC_FIELDS),
    ("total_minutes", AGGREGATE_METRIC_FIELDS),
    ("session_count", AGGREGATE_METRIC_FIELDS),
    ("shape/rows", AGGREGATE_METRIC_FIELDS),
];

const AGGREGATE_CATEGORY_COLUMNS: &[(&str, &[&str])] = &[
    ("study_id", AGGREGATE_CATEGORY_FIELDS),
    ("study_name", AGGREGATE_CATEGORY_FIELDS),
    ("participant_id", AGGREGATE_CATEGORY_FIELDS),
    ("date", AGGREGATE_CATEGORY_FIELDS),
    ("broad_app_category", AGGREGATE_CATEGORY_FIELDS),
    ("foreground_minutes", AGGREGATE_CATEGORY_FIELDS),
    ("background_minutes", AGGREGATE_CATEGORY_FIELDS),
    ("total_minutes", AGGREGATE_CATEGORY_FIELDS),
    ("session_count", AGGREGATE_CATEGORY_FIELDS),
    ("shape/rows", AGGREGATE_CATEGORY_FIELDS),
];

/// `category_csv` groups on the derived category instead of the package.
const AGGREGATE_CATEGORY_FIELDS: &[&str] = &[
    "study_id",
    "participant_id",
    "date",
    "interaction_type",
    "start_timestamp_ns",
    "stop_timestamp_ns",
    "usage_layer",
    "duration_minutes",
    "broad_app_category",
];

const AGGREGATE_CO_USAGE_COLUMNS: &[(&str, &[&str])] = &[
    ("study_id", AGGREGATE_METRIC_FIELDS),
    ("study_name", AGGREGATE_METRIC_FIELDS),
    ("participant_id", AGGREGATE_METRIC_FIELDS),
    ("app_a", AGGREGATE_METRIC_FIELDS),
    ("app_b", AGGREGATE_METRIC_FIELDS),
    ("co_usage_count", AGGREGATE_METRIC_FIELDS),
    ("total_overlap_minutes", AGGREGATE_METRIC_FIELDS),
    ("shape/rows", AGGREGATE_METRIC_FIELDS),
];

/// `visualization_row` projects exactly these fields into every plotted row.
const VISUALIZATION_ROW_FIELDS: &[&str] = &[
    "participant_id",
    "date",
    "start_timestamp_ns",
    "stop_timestamp_ns",
    "event_timestamp_ns",
    "interaction_type",
    "broad_app_category",
    "app_package_name",
    "application_label",
    "username",
    "screen_usage_end_reason",
];

/// Output kinds whose cells are addressed by (row index, column) and therefore
/// also depend on the row-set pseudo-fields.
pub const ROW_ADDRESSED_OUTPUT_KINDS: &[&str] = &[
    "app-csv",
    "credited-app-csv",
    "screen-csv",
    "compliance-csv",
    "day-coverage-csv",
    "review-summary-json",
    "visualization-data-json",
    "aggregate-daily-summary-csv",
    "aggregate-weekly-summary-csv",
    "aggregate-top-apps-csv",
    "aggregate-category-time-budget-csv",
    "aggregate-app-co-usage-csv",
];

/// Every declared canonical output cell family and the data fields that render
/// it. `app-csv` and `credited-app-csv` share one writer; `credited-app-csv`
/// rows are emitted by the screen-gated crediting layer.
pub fn output_cell_bindings() -> Vec<PipelineOutputCellBinding> {
    let mut bindings = Vec::new();
    for (output_kind, emitting_step) in [
        ("app-csv", "assemble_result"),
        ("credited-app-csv", "assemble_credit_result"),
    ] {
        for (column, from) in APP_ROW_COLUMNS {
            bindings.push(PipelineOutputCellBinding {
                output_kind,
                column,
                emitting_step,
                from,
            });
        }
        for (source, output) in crate::pipeline_v2::codebook_column_renames() {
            let _ = source;
            bindings.push(PipelineOutputCellBinding {
                output_kind,
                column: output,
                emitting_step,
                from: &["codebook_fields"],
            });
        }
    }
    for (column, from) in SCREEN_ROW_COLUMNS {
        bindings.push(PipelineOutputCellBinding {
            output_kind: "screen-csv",
            column,
            emitting_step: "assemble_result",
            from,
        });
    }
    bindings.extend_from_slice(NON_ROW_CELL_BINDINGS);
    // `build_aggregate_outputs` renders every aggregate CSV inside
    // `assemble_primary_outputs`, whose product step is `assemble_result`. The
    // daily and weekly summaries share `summary_csv`, so they share its column
    // table and differ only in the period column and its derivation.
    for (output_kind, only_columns) in [
        ("aggregate-daily-summary-csv", AGGREGATE_DAILY_ONLY_COLUMNS),
        ("aggregate-weekly-summary-csv", AGGREGATE_WEEKLY_ONLY_COLUMNS),
    ] {
        for (column, from) in AGGREGATE_SUMMARY_SHARED_COLUMNS
            .iter()
            .chain(only_columns.iter())
        {
            bindings.push(PipelineOutputCellBinding {
                output_kind,
                column,
                emitting_step: "assemble_result",
                from,
            });
        }
    }
    for (output_kind, columns) in [
        ("aggregate-top-apps-csv", AGGREGATE_TOP_APPS_COLUMNS),
        ("aggregate-category-time-budget-csv", AGGREGATE_CATEGORY_COLUMNS),
        ("aggregate-app-co-usage-csv", AGGREGATE_CO_USAGE_COLUMNS),
    ] {
        for (column, from) in columns {
            bindings.push(PipelineOutputCellBinding {
                output_kind,
                column,
                emitting_step: "assemble_result",
                from,
            });
        }
    }
    bindings
}

/// Whether an identifier names a column of a supplied source artifact rather
/// than a carrier data field or a modelled pseudo-field.
pub fn is_supplied_source_column(field: &str) -> bool {
    field.contains('.') && !is_pseudo_field(field)
}

/// Every supplied source column any step declares that it reads.
pub fn declared_source_columns() -> Vec<&'static str> {
    let mut columns = PIPELINE_STEPS
        .iter()
        .flat_map(|step| step_field_reads(step.id).iter().copied())
        .filter(|field| is_supplied_source_column(field))
        .collect::<BTreeSet<_>>();
    // A rendered cell may name a supplied column directly without any step
    // carrying it onto a row.
    columns.extend(
        output_cell_bindings()
            .into_iter()
            .flat_map(|binding| binding.from.iter().copied())
            .filter(|field| is_supplied_source_column(field)),
    );
    columns.into_iter().collect()
}

fn field_writers() -> BTreeMap<&'static str, Vec<&'static [&'static str]>> {
    let mut writers: BTreeMap<&'static str, Vec<&'static [&'static str]>> = BTreeMap::new();
    for step in PIPELINE_STEPS {
        for edge in step_field_edges(step.id) {
            writers.entry(edge.to).or_default().push(edge.from);
        }
    }
    writers
}

/// The single supplied source column a field is a verbatim copy of, or `None`.
/// A field qualifies only when every declared write of it takes exactly one
/// contributor and every one of those chains ends at the same supplied column.
/// A write of a field from itself is the identity carry from the parsed row to
/// the canonical row and introduces no new contributor.
fn pure_copy_source(
    field: &'static str,
    writers: &BTreeMap<&'static str, Vec<&'static [&'static str]>>,
    resolved: &mut BTreeMap<&'static str, Option<&'static str>>,
    stack: &mut Vec<&'static str>,
) -> Option<&'static str> {
    if is_supplied_source_column(field) {
        return Some(field);
    }
    if is_pseudo_field(field) {
        return None;
    }
    if let Some(cached) = resolved.get(field) {
        return *cached;
    }
    if stack.contains(&field) {
        return None;
    }
    stack.push(field);
    let mut found = BTreeSet::new();
    let mut pure = true;
    match writers.get(field) {
        None => pure = false,
        Some(edges) => {
            for from in edges {
                let contributors = from
                    .iter()
                    .copied()
                    .filter(|other| *other != field)
                    .collect::<Vec<_>>();
                match contributors.as_slice() {
                    [] => continue,
                    [only] => match pure_copy_source(only, writers, resolved, stack) {
                        Some(source) => {
                            found.insert(source);
                        }
                        None => {
                            pure = false;
                            break;
                        }
                    },
                    _ => {
                        pure = false;
                        break;
                    }
                }
            }
        }
    }
    stack.pop();
    let answer = if pure && found.len() == 1 {
        found.into_iter().next()
    } else {
        None
    };
    resolved.insert(field, answer);
    answer
}

/// One output cell family whose value is a verbatim copy of exactly one
/// supplied source column. Nothing else in the pipeline can change that value,
/// so when row lineage names exactly one contributing raw record the exact
/// source cell that produced the result cell is pinned.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineExactCellContribution {
    pub output_kind: &'static str,
    pub column: &'static str,
    pub source_field: &'static str,
}

/// Derived from the declared field edges, never hand-listed: widening any
/// step's declared reads immediately removes the affected column here.
pub fn exact_cell_contributions() -> Vec<PipelineExactCellContribution> {
    let writers = field_writers();
    let mut resolved = BTreeMap::new();
    output_cell_bindings()
        .into_iter()
        .filter_map(|binding| {
            let [field] = binding.from else { return None };
            let source = pure_copy_source(field, &writers, &mut resolved, &mut Vec::new())?;
            Some(PipelineExactCellContribution {
                output_kind: binding.output_kind,
                column: binding.column,
                source_field: source,
            })
        })
        .collect()
}

/// Forward closure of the declared field edges from one field.
fn reachable_fields(seed: &'static str) -> BTreeSet<&'static str> {
    let edges = PIPELINE_STEPS
        .iter()
        .flat_map(|step| step_field_edges(step.id))
        .collect::<Vec<_>>();
    let mut reached = BTreeSet::from([seed]);
    let mut grew = true;
    while grew {
        grew = false;
        for edge in &edges {
            if reached.contains(edge.to) {
                continue;
            }
            if edge.from.iter().any(|field| reached.contains(field)) {
                reached.insert(edge.to);
                grew = true;
            }
        }
    }
    reached
}

/// Every canonical output cell family one supplied source column can reach.
pub struct PipelineSourceColumnReach {
    pub source_field: &'static str,
    pub cells: Vec<PipelineOutputCellBinding>,
}

/// The declared column-granular reach of every supplied source column. Output
/// families that carry no row lineage are witnessed at this granularity
/// instead of being reported as one unresolved whole-artifact gap.
pub fn source_column_output_reach() -> Vec<PipelineSourceColumnReach> {
    let bindings = output_cell_bindings();
    declared_source_columns()
        .into_iter()
        .map(|source_field| {
            let reached = reachable_fields(source_field);
            PipelineSourceColumnReach {
                source_field,
                cells: bindings
                    .iter()
                    .filter(|binding| {
                        output_cell_dependencies(binding)
                            .iter()
                            .any(|field| reached.contains(field))
                    })
                    .copied()
                    .collect(),
            }
        })
        .collect()
}

/// Complete dependency set of one output cell family: its rendered fields plus
/// the row-set pseudo-fields when the cell is addressed by row index.
pub fn output_cell_dependencies(binding: &PipelineOutputCellBinding) -> Vec<&'static str> {
    let mut fields = binding.from.to_vec();
    if ROW_ADDRESSED_OUTPUT_KINDS.contains(&binding.output_kind) {
        fields.extend_from_slice(ROW_SET_FIELDS);
    }
    fields
}

pub fn pipeline_step_contract() -> PipelineStepContract {
    PipelineStepContract {
        protocol_version: "chronicle-preprocessing-step-contract/v3",
        preprocessor_version: crate::pipeline_v2::PREPROCESSOR_VERSION,
        canonical_interaction_types: crate::CANONICAL_INTERACTION_TYPES,
        unbound_option_keys: &[
            "enable_plotting",
            "include_filtered_app_usage_in_plots",
            "enable_activity_heatmap",
            "export_plots_as_svg",
            "enable_interactive_timeline",
            "parallel_processing",
            "parallel_max_workers",
        ],
        root_roles: root_role_contract(),
        groups: PIPELINE_GROUPS
            .iter()
            .map(|group| {
                let applicability = group_applicability(group.id);
                PipelineGroupContractEntry {
                    id: group.id,
                    label: group.label,
                    section: group.section,
                    knobs: group_knobs(group.id),
                    support_roles: group_support_roles(group.id),
                    can_bypass: applicability != PipelineCondition::Always,
                    applicability,
                    early_cutoff: matches!(
                        group.id,
                        "parse_events" | "normalize_timezones" | "dedup_and_order" | "app_policy"
                    ),
                }
            })
            .collect(),
        steps: PIPELINE_STEPS
            .iter()
            .map(|step| {
                let applicability = step_applicability(step.id);
                PipelineStepContractEntry {
                    id: step.id,
                    group: step.group,
                    inputs: step.inputs,
                    request_fields: step_request_fields(step.id),
                    source_roles: step_source_roles(step.id),
                    source_role_bindings: step_source_role_bindings(step.id),
                    field_reads: step_field_reads(step.id),
                    field_writes: step_field_writes(step.id),
                    field_edges: step_field_edges(step.id),
                    can_bypass: applicability != PipelineCondition::Always,
                    applicability,
                }
            })
            .collect(),
        output_cell_bindings: output_cell_bindings(),
        exact_cell_contributions: exact_cell_contributions(),
        row_set_fields: ROW_SET_FIELDS,
        row_addressed_output_kinds: ROW_ADDRESSED_OUTPUT_KINDS,
    }
}

#[cfg(all(test, feature = "incremental-v2"))]
mod field_use_scan;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pipeline_v2::PipelineV2OptionsJson;
    use std::collections::{BTreeMap, BTreeSet};

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

    #[cfg(feature = "incremental-v2")]
    #[test]
    fn declared_step_edges_equal_direct_salsa_query_calls() {
        use syn::visit::{self, Visit};

        struct Collector<'a> {
            step_ids: &'a BTreeSet<&'a str>,
            current: Option<String>,
            calls: BTreeMap<String, BTreeSet<String>>,
            method_reads: BTreeMap<String, BTreeSet<String>>,
            local_calls: BTreeMap<String, BTreeSet<String>>,
            internal_queries: BTreeSet<String>,
        }

        impl<'ast> Visit<'ast> for Collector<'_> {
            fn visit_item_mod(&mut self, module: &'ast syn::ItemMod) {
                if module.ident == "tests" {
                    return;
                }
                visit::visit_item_mod(self, module);
            }

            fn visit_item_fn(&mut self, function: &'ast syn::ItemFn) {
                let previous = self.current.replace(function.sig.ident.to_string());
                visit::visit_block(self, &function.block);
                self.current = previous;
            }

            fn visit_expr_call(&mut self, call: &'ast syn::ExprCall) {
                if let (Some(current), syn::Expr::Path(path)) = (&self.current, &*call.func) {
                    if path.qself.is_none() && path.path.segments.len() == 1 {
                        let called = path.path.segments[0].ident.to_string();
                        self.local_calls
                            .entry(current.clone())
                            .or_default()
                            .insert(called.clone());
                        if self.step_ids.contains(called.as_str()) && called != *current {
                            self.calls
                                .entry(current.clone())
                                .or_default()
                                .insert(called);
                        }
                    }
                }
                visit::visit_expr_call(self, call);
            }

            fn visit_expr_method_call(&mut self, call: &'ast syn::ExprMethodCall) {
                if let Some(current) = &self.current {
                    if call.method == "record_internal_query_body" {
                        self.internal_queries.insert(current.clone());
                    }
                    self.method_reads
                        .entry(current.clone())
                        .or_default()
                        .insert(call.method.to_string());
                }
                visit::visit_expr_method_call(self, call);
            }
        }

        let step_ids = PIPELINE_STEPS
            .iter()
            .map(|step| step.id)
            .collect::<BTreeSet<_>>();
        let syntax = syn::parse_file(include_str!("pipeline_v2_incremental.rs"))
            .expect("tracked Rust source must parse");
        let mut collector = Collector {
            step_ids: &step_ids,
            current: None,
            calls: BTreeMap::new(),
            method_reads: BTreeMap::new(),
            local_calls: BTreeMap::new(),
            internal_queries: BTreeSet::new(),
        };
        let tracked_module = syntax
            .items
            .iter()
            .find_map(|item| match item {
                syn::Item::Mod(module) if module.ident == "tracked" => Some(module),
                _ => None,
            })
            .expect("tracked query module");
        collector.visit_item_mod(tracked_module);

        fn collect_step_calls(
            function: &str,
            calls: &BTreeMap<String, BTreeSet<String>>,
            local_calls: &BTreeMap<String, BTreeSet<String>>,
            transparent_edge_aggregates: &BTreeSet<&str>,
            visited: &mut BTreeSet<String>,
        ) -> BTreeSet<String> {
            if !visited.insert(function.to_string()) {
                return BTreeSet::new();
            }
            let mut result = calls.get(function).cloned().unwrap_or_default();
            for called in local_calls.get(function).into_iter().flatten() {
                if transparent_edge_aggregates.contains(called.as_str()) {
                    result.extend(collect_step_calls(
                        called,
                        calls,
                        local_calls,
                        transparent_edge_aggregates,
                        visited,
                    ));
                }
            }
            result
        }

        let transparent_edge_aggregates = BTreeSet::from(["collect_early_assembly"]);
        let mut mismatches = Vec::new();
        for step in PIPELINE_STEPS {
            let declared = step.inputs.iter().copied().collect::<BTreeSet<_>>();
            let observed_owned = collect_step_calls(
                step.id,
                &collector.calls,
                &collector.local_calls,
                &transparent_edge_aggregates,
                &mut BTreeSet::new(),
            );
            let observed = observed_owned.iter().map(String::as_str).collect();
            if declared != observed {
                mismatches.push(format!(
                    "{}: declared={declared:?} observed={observed:?}",
                    step.id
                ));
            }
        }
        assert!(
            mismatches.is_empty(),
            "declared inputs differ from direct Salsa query calls:\n{}",
            mismatches.join("\n")
        );

        fn collect_option_reads(
            function: &str,
            query_boundaries: &BTreeSet<&str>,
            field_universe: &BTreeSet<&str>,
            method_reads: &BTreeMap<String, BTreeSet<String>>,
            local_calls: &BTreeMap<String, BTreeSet<String>>,
            visited: &mut BTreeSet<String>,
        ) -> BTreeSet<String> {
            if !visited.insert(function.to_string()) {
                return BTreeSet::new();
            }
            let mut fields = method_reads
                .get(function)
                .into_iter()
                .flat_map(|methods| methods.iter())
                .filter(|method| field_universe.contains(method.as_str()))
                .cloned()
                .collect::<BTreeSet<_>>();
            for called in local_calls.get(function).into_iter().flatten() {
                if query_boundaries.contains(called.as_str()) {
                    continue;
                }
                fields.extend(collect_option_reads(
                    called,
                    query_boundaries,
                    field_universe,
                    method_reads,
                    local_calls,
                    visited,
                ));
            }
            fields
        }

        let field_universe = PIPELINE_STEPS
            .iter()
            .flat_map(|step| step_request_fields(step.id).iter().copied())
            .collect::<BTreeSet<_>>();
        // These internal Salsa queries memoize parsed support values but do
        // not hide their reads from the product-step contract. Follow through
        // them when deriving each step's actual configuration/source inputs.
        let transparent_support_queries = [
            "background_apps",
            "parsed_filter_rules",
            "parsed_apps_forcing_screen_open",
            "parsed_codebook",
            "parsed_study_windows",
            "parsed_device_sharing",
            "parsed_survey_attribution",
            "parsed_enrolled_devices",
        ]
        .into_iter()
        .collect::<BTreeSet<_>>();
        let query_boundaries = step_ids
            .iter()
            .copied()
            .chain(
                collector
                    .internal_queries
                    .iter()
                    .map(String::as_str)
                    .filter(|query| !transparent_support_queries.contains(query)),
            )
            .collect::<BTreeSet<_>>();
        let mut field_mismatches = Vec::new();
        for step in PIPELINE_STEPS {
            let declared = step_request_fields(step.id)
                .iter()
                .copied()
                .collect::<BTreeSet<_>>();
            let observed = collect_option_reads(
                step.id,
                &query_boundaries,
                &field_universe,
                &collector.method_reads,
                &collector.local_calls,
                &mut BTreeSet::new(),
            );
            let observed = observed.iter().map(String::as_str).collect::<BTreeSet<_>>();
            if declared != observed {
                field_mismatches.push(format!(
                    "{}: declared={declared:?} observed={observed:?}",
                    step.id
                ));
            }
        }
        assert!(
            field_mismatches.is_empty(),
            "declared request fields differ from direct/helper Salsa reads:\n{}",
            field_mismatches.join("\n")
        );

        // Root artifacts are tracked separately from options. Keep this map
        // deliberately small and mechanical: each entry is the generated
        // Salsa accessor for one product role. A query that starts or stops
        // reading one of these byte inputs must change the exported contract.
        let source_accessor_roles = BTreeMap::from([
            ("bytes", "raw_chronicle_csv"),
            ("filter_csv", "filter_file"),
            ("apps_forcing_csv", "apps_forcing_screen_open_file"),
            ("background_apps_csv", "background_apps_file"),
            ("codebook_csv", "app_codebook_file"),
            ("study_dates_csv", "study_dates_file"),
            ("device_sharing_csv", "device_sharing_file"),
            ("survey_attribution_csv", "survey_attribution_file"),
            ("enrolled_devices_csv", "enrolled_devices_file"),
        ]);
        let source_accessor_universe = source_accessor_roles
            .keys()
            .copied()
            .collect::<BTreeSet<_>>();
        let mut source_mismatches = Vec::new();
        for step in PIPELINE_STEPS {
            let declared = step_source_roles(step.id)
                .iter()
                .copied()
                .collect::<BTreeSet<_>>();
            let observed_accessors = collect_option_reads(
                step.id,
                &query_boundaries,
                &source_accessor_universe,
                &collector.method_reads,
                &collector.local_calls,
                &mut BTreeSet::new(),
            );
            let observed = observed_accessors
                .iter()
                .map(|accessor| source_accessor_roles[accessor.as_str()])
                .collect::<BTreeSet<_>>();
            if declared != observed {
                source_mismatches.push(format!(
                    "{}: declared={declared:?} observed={observed:?}",
                    step.id
                ));
            }
        }
        assert!(
            source_mismatches.is_empty(),
            "declared source roles differ from direct/helper Salsa reads:\n{}",
            source_mismatches.join("\n")
        );
    }

    #[cfg(feature = "incremental-v2")]
    #[test]
    #[ignore = "development aid: prints the scanned field usage per step"]
    fn dump_scanned_field_use() {
        let step_ids = PIPELINE_STEPS
            .iter()
            .map(|step| step.id)
            .collect::<BTreeSet<_>>();
        let scan = super::field_use_scan::scan(&step_ids);
        println!(
            "UNIVERSE {:?}",
            super::field_use_scan::data_field_universe()
        );
        for step in PIPELINE_STEPS {
            let use_set = &scan[step.id];
            println!(
                "STEP {}\n  reads   {:?}\n  writes  {:?}\n  columns {:?}",
                step.id, use_set.reads, use_set.writes, use_set.source_columns
            );
        }
    }

    /// Field-level sibling of `declared_step_edges_equal_direct_salsa_query_calls`.
    /// The non-pseudo half of every step's declared field reads and writes must
    /// equal the data fields and supplied source columns its tracked query and
    /// reachable Rust implementation actually touch.
    #[cfg(feature = "incremental-v2")]
    #[test]
    fn declared_field_edges_equal_scanned_field_use() {
        let step_ids = PIPELINE_STEPS
            .iter()
            .map(|step| step.id)
            .collect::<BTreeSet<_>>();
        let scan = super::field_use_scan::scan(&step_ids);
        let universe = super::field_use_scan::data_field_universe();

        let mut mismatches = Vec::new();
        for step in PIPELINE_STEPS {
            let observed = &scan[step.id];
            let mut expected_reads = observed.reads.clone();
            expected_reads.extend(observed.source_columns.iter().cloned());
            let declared_reads = step_field_reads(step.id)
                .iter()
                .copied()
                .filter(|field| !is_pseudo_field(field))
                .map(str::to_string)
                .collect::<BTreeSet<_>>();
            if declared_reads != expected_reads {
                mismatches.push(format!(
                    "{} reads: declared={declared_reads:?} observed={expected_reads:?}",
                    step.id
                ));
            }
            let declared_writes = step_field_writes(step.id)
                .iter()
                .copied()
                .filter(|field| !is_pseudo_field(field))
                .map(str::to_string)
                .collect::<BTreeSet<_>>();
            if declared_writes != observed.writes {
                mismatches.push(format!(
                    "{} writes: declared={declared_writes:?} observed={:?}",
                    step.id, observed.writes
                ));
            }
        }
        assert!(
            mismatches.is_empty(),
            "declared field edges differ from scanned field use:\n{}",
            mismatches.join("\n")
        );

        // No duplicate or unknown identifiers, and every declared edge points at
        // a field the step actually declares as produced.
        for step in PIPELINE_STEPS {
            for list in [step_field_reads(step.id), step_field_writes(step.id)] {
                let unique = list.iter().copied().collect::<BTreeSet<_>>();
                assert_eq!(
                    unique.len(),
                    list.len(),
                    "duplicate field identifier on {}",
                    step.id
                );
                for field in list {
                    assert!(
                        is_pseudo_field(field)
                            || universe.contains(*field)
                            || field.contains('.'),
                        "{}: unknown field identifier {field}",
                        step.id
                    );
                }
            }
            let writes = step_field_writes(step.id)
                .iter()
                .copied()
                .collect::<BTreeSet<_>>();
            let reads = step_field_reads(step.id)
                .iter()
                .copied()
                .collect::<BTreeSet<_>>();
            for edge in step_field_edges(step.id) {
                assert!(
                    writes.contains(edge.to),
                    "{}: edge targets undeclared field {}",
                    step.id,
                    edge.to
                );
                for field in edge.from {
                    assert!(
                        reads.contains(field),
                        "{}: edge into {} reads undeclared field {field}",
                        step.id,
                        edge.to
                    );
                }
            }
        }

        // A partial override table is the dangerous shape: the fields it does
        // list get their real contributors, and the fields it forgets silently
        // fall back to "every read determines it". That fallback is what made
        // `raw_chronicle_csv.username` reach `duration_seconds` through
        // `build_canonical_rows`, so a step that overrides at all must name
        // every field it produces, using `&[]` for a constant initializer.
        for step in PIPELINE_STEPS {
            let overrides = step_field_edge_overrides(step.id);
            if overrides.is_empty() {
                continue;
            }
            let named = overrides
                .iter()
                .map(|(field, _)| *field)
                .collect::<BTreeSet<_>>();
            assert_eq!(
                named.len(),
                overrides.len(),
                "{}: duplicate field in the edge override table",
                step.id
            );
            let produced = step_field_writes(step.id)
                .iter()
                .copied()
                .collect::<BTreeSet<_>>();
            assert_eq!(
                named,
                produced,
                "{}: the edge override table must name exactly the fields the \
                 step produces; a missing entry silently restores the atomic \
                 every-read-determines-every-write cross for that field",
                step.id
            );
        }

        // Every supplied source column named by a step must belong to a role the
        // step already declares, so the two granularities cannot disagree.
        for step in PIPELINE_STEPS {
            let roles = step_source_roles(step.id)
                .iter()
                .copied()
                .collect::<BTreeSet<_>>();
            for field in step_field_reads(step.id) {
                if is_pseudo_field(field) {
                    continue;
                }
                if let Some((role, _column)) = field.split_once('.') {
                    assert!(
                        roles.contains(role),
                        "{} reads {field} but does not declare source role {role}",
                        step.id
                    );
                }
            }
        }
    }

    /// Every declared output cell family must render from fields some step
    /// declares as produced, and must cover the canonical output columns the
    /// writers emit.
    #[test]
    fn output_cell_bindings_cover_the_declared_output_columns() {
        let mut known = PIPELINE_STEPS
            .iter()
            .flat_map(|step| step_field_writes(step.id).iter().copied())
            .collect::<BTreeSet<_>>();
        // Supplied source columns are read, never produced; a rendered cell may
        // still depend on one directly.
        known.extend(
            PIPELINE_STEPS
                .iter()
                .flat_map(|step| step_field_reads(step.id).iter().copied())
                .filter(|field| !is_pseudo_field(field) && field.contains('.')),
        );
        let bindings = output_cell_bindings();
        for binding in &bindings {
            for field in binding.from {
                assert!(
                    known.contains(field),
                    "{}/{} renders from {field}, which no step declares",
                    binding.output_kind,
                    binding.column
                );
            }
            assert!(
                PIPELINE_STEPS
                    .iter()
                    .any(|step| step.id == binding.emitting_step),
                "{}/{} names unknown emitting step {}",
                binding.output_kind,
                binding.column,
                binding.emitting_step
            );
        }

        let declared_app = crate::pipeline_v2::declared_app_output_columns(true, true, true, 300.0);
        let declared_screen = crate::pipeline_v2::declared_screen_output_columns();
        for (kind, columns) in [
            ("app-csv", &declared_app),
            ("credited-app-csv", &declared_app),
            ("screen-csv", &declared_screen),
        ] {
            for column in columns {
                assert!(
                    bindings.iter().any(|binding| {
                        binding.output_kind == kind
                            && output_column_matches(binding.column, column)
                    }),
                    "{kind} column {column} has no declared output cell binding"
                );
            }
        }

        // Both `aggregate_shape` values change which columns `summary_csv`
        // writes, so both must be covered.
        for kind in ROW_ADDRESSED_OUTPUT_KINDS
            .iter()
            .filter(|kind| kind.starts_with("aggregate-"))
        {
            for shape in ["wide", "long"] {
                let columns =
                    crate::pipeline_v2::aggregates::declared_aggregate_output_columns(kind, shape);
                assert!(
                    !columns.is_empty(),
                    "{kind} declares no emitted columns for aggregate_shape={shape}"
                );
                for column in columns {
                    assert!(
                        bindings.iter().any(|binding| {
                            binding.output_kind == *kind
                                && output_column_matches(binding.column, column)
                        }),
                        "{kind} column {column} (aggregate_shape={shape}) has no declared \
                         output cell binding"
                    );
                }
            }
        }
    }

    /// A binding column matches an observed column when it is equal, or when
    /// its `*` segments stand in for the numeric/dynamic parts of the name.
    fn output_column_matches(pattern: &str, observed: &str) -> bool {
        let mut parts = pattern.split('*');
        let first = parts.next().unwrap_or_default();
        if !observed.starts_with(first) {
            return false;
        }
        let mut rest = &observed[first.len()..];
        let mut parts = parts.peekable();
        // A pattern with no `*` is an exact column name, not a prefix.
        if parts.peek().is_none() {
            return rest.is_empty();
        }
        while let Some(part) = parts.next() {
            if parts.peek().is_none() {
                return rest.len() >= part.len() && rest.ends_with(part);
            }
            match rest.find(part) {
                Some(index) => rest = &rest[index + part.len()..],
                None => return false,
            }
        }
        true
    }

    /// The supplied source column a field is a verbatim copy of, re-derived
    /// here straight from the declared field edges. `pure_copy_source` is the
    /// predicate that decides the published membership, so the negative
    /// control below must not call it - re-calling it could only agree with
    /// itself. Every hop of the transitive write chain has to take exactly one
    /// contributor once the field's identity carry onto itself is dropped, no
    /// hop may land on a pseudo-field or on a field nothing declares a write
    /// of, no hop may close a cycle - the declared edges do carry them, for
    /// example `app_package_name` -> `duration_seconds` -> `app_package_name`
    /// through the atomic steps that read and write both - and every branch
    /// has to bottom out at the same supplied column.
    fn write_chain_source(
        field: &'static str,
        writers: &BTreeMap<&'static str, Vec<&'static [&'static str]>>,
        ancestors: &mut Vec<&'static str>,
    ) -> Option<&'static str> {
        if is_supplied_source_column(field) {
            return Some(field);
        }
        if is_pseudo_field(field) || ancestors.contains(&field) {
            return None;
        }
        let edges = writers.get(field)?;
        ancestors.push(field);
        let mut sources = BTreeSet::new();
        let mut every_hop_single = true;
        for from in edges {
            let contributors = from
                .iter()
                .copied()
                .filter(|other| *other != field)
                .collect::<Vec<_>>();
            match contributors.as_slice() {
                [] => {}
                [only] => match write_chain_source(only, writers, ancestors) {
                    Some(source) => {
                        sources.insert(source);
                    }
                    None => {
                        every_hop_single = false;
                        break;
                    }
                },
                _ => {
                    every_hop_single = false;
                    break;
                }
            }
        }
        ancestors.pop();
        let mut sources = sources.into_iter();
        match (every_hop_single, sources.next(), sources.next()) {
            (true, Some(only), None) => Some(only),
            _ => None,
        }
    }

    /// The exact-field class is the only claim in the witness that names a
    /// single source cell. Its membership is pinned here, and the rule behind
    /// it is re-derived from the declared field edges rather than from
    /// `pure_copy_source`, which is the predicate that produced the set:
    /// backwards over `field_writers()` every hop of a claimed cell's write
    /// chain has to take exactly one contributor, and forwards over
    /// `reachable_fields()` the claimed column has to be the only declared
    /// source column that reaches the field.
    #[test]
    fn exact_cell_contributions_are_verbatim_single_source_copies() {
        let contributions = exact_cell_contributions();
        let named = contributions
            .iter()
            .map(|entry| {
                (
                    entry.output_kind,
                    entry.column,
                    entry.source_field,
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(
            named,
            vec![
                ("app-csv", "study_id", "raw_chronicle_csv.study_id"),
                (
                    "app-csv",
                    "participant_id",
                    "raw_chronicle_csv.participant_id"
                ),
                (
                    "credited-app-csv",
                    "study_id",
                    "raw_chronicle_csv.study_id"
                ),
                (
                    "credited-app-csv",
                    "participant_id",
                    "raw_chronicle_csv.participant_id"
                ),
                ("screen-csv", "study_id", "raw_chronicle_csv.study_id"),
                (
                    "screen-csv",
                    "participant_id",
                    "raw_chronicle_csv.participant_id"
                ),
                // `review-summary-json#/participants/*/studyId` and
                // `.../participantId` were here until the review summary's
                // participant addressing was declared. Their *values* are still
                // verbatim copies, but the address they occupy is keyed by both
                // study and participant, so neither is a single-source cell and
                // neither ever produced an exact witness row: exact-field rows
                // are only emitted where kernel row lineage resolves to one
                // output row, which the JSON summary does not have.
            ],
            "the exact-field membership changed; re-derive it from the field \
             edges and explain every added or removed column"
        );

        // Negative side. `pure_copy_source` is the predicate that decided the
        // membership above, so re-calling it here could only agree with
        // itself. Re-derive the rule from the declared edges instead, and do
        // it in both directions: backwards over `field_writers()`, where every
        // hop of the transitive write chain has to take exactly one
        // contributor and every chain has to bottom out at the same supplied
        // column, and forwards over `reachable_fields()`, where that column
        // has to be the only declared source column that reaches the field.
        let writers = field_writers();

        let exact = contributions
            .iter()
            .map(|entry| ((entry.output_kind, entry.column), entry.source_field))
            .collect::<BTreeMap<_, _>>();
        let source_reach = declared_source_columns()
            .into_iter()
            .map(|column| (column, reachable_fields(column)))
            .collect::<Vec<_>>();
        for binding in output_cell_bindings() {
            // A cell rendered from more than one field already carries more
            // than one contributor.
            let single_field = match binding.from {
                [field] => Some(*field),
                _ => None,
            };
            let verbatim =
                single_field.and_then(|field| write_chain_source(field, &writers, &mut Vec::new()));
            assert_eq!(
                exact.get(&(binding.output_kind, binding.column)).copied(),
                verbatim,
                "{}/{} does not agree with the write chain the declared field edges spell out",
                binding.output_kind,
                binding.column
            );
            // Forward direction: the claimed column has to reach the field,
            // and it has to be the only declared source column that does.
            if let (Some(source_field), Some(field)) = (verbatim, single_field) {
                let reaching = source_reach
                    .iter()
                    .filter(|(_, reached)| reached.contains(field))
                    .map(|(column, _)| *column)
                    .collect::<Vec<_>>();
                assert_eq!(
                    reaching,
                    vec![source_field],
                    "{}/{} claims {source_field}, which is not the only declared source column \
                     whose forward closure reaches {field}",
                    binding.output_kind,
                    binding.column
                );
            }
        }
        // `username` is the sharpest negative: it is written verbatim from
        // `raw_chronicle_csv.username` at parse time and then rewritten by
        // `attribute_rows` from the survey and sharing supports, so a hop on
        // its chain takes more than one contributor.
        assert_eq!(
            write_chain_source("username", &writers, &mut Vec::new()),
            None,
            "a field a later step rewrites from other inputs is not a verbatim copy"
        );
        // Every exact contribution's source column must be one the contract
        // already declares as read.
        let declared = declared_source_columns().into_iter().collect::<BTreeSet<_>>();
        for entry in &contributions {
            assert!(
                declared.contains(entry.source_field),
                "{}/{} claims {} which no step declares as read",
                entry.output_kind,
                entry.column,
                entry.source_field
            );
        }
    }

    /// The column-granular reach must agree with the whole-artifact reach the
    /// runtime plan already computes: a source column can never reach an output
    /// column outside its own role's declared cells.
    #[test]
    fn source_column_reach_covers_every_declared_source_column() {
        let reach = source_column_output_reach();
        assert_eq!(
            reach
                .iter()
                .map(|entry| entry.source_field)
                .collect::<Vec<_>>(),
            declared_source_columns(),
        );
        let bindings = output_cell_bindings();
        for entry in &reach {
            for cell in &entry.cells {
                assert!(
                    bindings.contains(cell),
                    "{} reaches a cell outside the declared bindings",
                    entry.source_field
                );
            }
        }
        // The three raw columns the parser never reads must stay outside every
        // reach set, which is the field-level non-influence result.
        for column in [
            "raw_chronicle_csv.possible_device_model",
            "raw_chronicle_csv.start_timestamp",
            "raw_chronicle_csv.stop_timestamp",
        ] {
            assert!(
                !reach.iter().any(|entry| entry.source_field == column),
                "{column} is not read by any step and must not have a declared reach"
            );
        }
    }

    /// The exported contract is a product artifact, not internal metadata:
    /// `src/bin/export_pipeline_step_contract.rs` prints exactly these bytes and
    /// `web/scripts/generate_pipeline_graph_artifacts.mts` and
    /// `web/scripts/check_contract_compat.mts` consume them to build the
    /// browser's option panel, group sections, support-file requirements, and
    /// bypass indicators. Nothing in Rust reads `group_knobs`,
    /// `group_support_roles`, `group_applicability`, or `step_applicability`, so
    /// this is the only place a dropped table entry can be observed on this
    /// side of the boundary — and a dropped entry silently removes a control,
    /// a support-file requirement, or a bypass condition from the app.
    #[test]
    fn exported_step_contract_is_byte_exact() {
        let mut serialized =
            serde_json::to_vec_pretty(&pipeline_step_contract()).expect("serialize contract");
        serialized.push(b'\n');
        crate::golden::assert_matches("pipeline_step_contract.json", &serialized);
    }

    #[test]
    fn serialized_contract_is_deterministic() {
        let first = serde_json::to_vec(&pipeline_step_contract()).expect("serialize contract");
        let second = serde_json::to_vec(&pipeline_step_contract()).expect("serialize contract");
        assert_eq!(first, second);
    }

    #[test]
    fn every_exact_request_field_is_bound_to_a_query_or_runtime_artifact_target() {
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
        let mut bound_fields = PIPELINE_STEPS
            .iter()
            .flat_map(|step| step_request_fields(step.id).iter().copied())
            .collect::<BTreeSet<_>>();
        bound_fields.extend(RUNTIME_ARTIFACT_REQUEST_FIELDS.iter().copied());
        assert_eq!(bound_fields, exact_fields);

        for step in PIPELINE_STEPS {
            let fields = step_request_fields(step.id);
            assert_eq!(
                fields.iter().copied().collect::<BTreeSet<_>>().len(),
                fields.len(),
                "duplicate request field binding on {}",
                step.id
            );
            let declared_roles = step_source_roles(step.id)
                .iter()
                .copied()
                .collect::<BTreeSet<_>>();
            let conditional_bindings = step_source_role_bindings(step.id);
            let bound_roles = conditional_bindings
                .iter()
                .map(|binding| binding.role)
                .collect::<BTreeSet<_>>();
            assert_eq!(
                bound_roles, declared_roles,
                "source-role bindings drifted for {}",
                step.id
            );
            let request_field_set = fields.iter().copied().collect::<BTreeSet<_>>();
            for predicate in conditional_bindings
                .iter()
                .flat_map(|binding| binding.when_all)
            {
                let request_field = match predicate {
                    PipelineSourceRolePredicate::BooleanEquals { request_field, .. }
                    | PipelineSourceRolePredicate::StringOneOf { request_field, .. } => {
                        *request_field
                    }
                };
                assert!(
                    request_field_set.contains(request_field),
                    "{} source-role condition reads undeclared request field {}",
                    step.id,
                    request_field
                );
            }
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
