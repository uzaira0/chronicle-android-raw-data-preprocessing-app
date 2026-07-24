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
    pub unbound_option_keys: &'static [&'static str],
    pub root_roles: Vec<PipelineRootRoleDefinition>,
    pub groups: Vec<PipelineGroupContractEntry>,
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
    pub source_role_bindings: Vec<PipelineSourceRoleBinding>,
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
        inputs: &["tag_filtered_packages"],
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
        "resolve_sharing_status" | "build_survey_lookup" => &["enable_person_attribution"],
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
        ],
        _ => &[],
    }
}

/// Request fields consumed by the browser runtime when it serializes optional
/// output artifacts. They do not change any of the 55 Rust computation results.
pub const RUNTIME_ARTIFACT_REQUEST_FIELDS: &[&str] =
    &["enable_parquet_export", "enable_spss_export"];

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
const APP_MODE_WITH_CODEBOOK: &[PipelineSourceRolePredicate] = &[
    PipelineSourceRolePredicate::StringOneOf {
        request_field: "usage_session_mode",
        values: APP_USAGE_MODES,
    },
    PipelineSourceRolePredicate::BooleanEquals {
        request_field: "use_app_codebook",
        value: true,
    },
];
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
        "assemble_result" => &["app_codebook_file", "enrolled_devices_file"],
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
        "assemble_result" => vec![
            binding("app_codebook_file", APP_MODE_WITH_CODEBOOK),
            binding("enrolled_devices_file", APP_MODE_WITH_COMPLIANCE),
        ],
        _ => Vec::new(),
    }
}

pub fn pipeline_step_contract() -> PipelineStepContract {
    PipelineStepContract {
        protocol_version: "chronicle-preprocessing-step-contract/v3",
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
                    can_bypass: applicability != PipelineCondition::Always,
                    applicability,
                }
            })
            .collect(),
    }
}

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

        let mut mismatches = Vec::new();
        for step in PIPELINE_STEPS {
            let declared = step.inputs.iter().copied().collect::<BTreeSet<_>>();
            let observed = collector
                .calls
                .get(step.id)
                .into_iter()
                .flat_map(|calls| calls.iter().map(String::as_str))
                .collect::<BTreeSet<_>>();
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
            step_ids: &BTreeSet<&str>,
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
                if step_ids.contains(called.as_str()) {
                    continue;
                }
                fields.extend(collect_option_reads(
                    called,
                    step_ids,
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
        let mut field_mismatches = Vec::new();
        for step in PIPELINE_STEPS {
            let declared = step_request_fields(step.id)
                .iter()
                .copied()
                .collect::<BTreeSet<_>>();
            let observed = collect_option_reads(
                step.id,
                &step_ids,
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
                &step_ids,
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
