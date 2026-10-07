#![recursion_limit = "256"]

use chronicle_preprocessing_runtime_wasm::{
    execute_workspace_native, scientific_preflight_native, RuntimeArtifactMetadata,
    RuntimeManifest, RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND, RUNTIME_PROTOCOL_VERSION,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

const MANIFEST_JSON: &str = include_str!("fixtures/literature_native_conformance.json");
const HEADER: &str = "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FixtureManifest {
    schema_version: String,
    fixtures: Vec<Fixture>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Fixture {
    fixture_id: String,
    method_setting_ids: Vec<String>,
    browser_contract_bindings: BTreeMap<String, Value>,
    #[serde(default)]
    output_bindings: Vec<FixtureOutputBinding>,
    result_digest: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FixtureOutputBinding {
    method_setting_id: String,
    chronicle_output_kind: String,
    source_output_field: String,
    chronicle_output_column: String,
    source_output_position: usize,
}

fn receipt_output_bindings(fixture: &Fixture) -> Vec<Value> {
    fixture
        .output_bindings
        .iter()
        .map(|binding| {
            json!({
                "settingId": binding.method_setting_id,
                "outputKind": binding.chronicle_output_kind,
                "sourceField": binding.source_output_field,
                "sourcePosition": binding.source_output_position,
                "canonicalField": binding.chronicle_output_column,
                "conformanceFixtureId": fixture.fixture_id,
                "conformanceResultDigest": fixture.result_digest,
            })
        })
        .collect()
}

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn prior_blank_classification_layout(screen: &[u8]) -> Vec<u8> {
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .from_reader(screen);
    let records = reader
        .byte_records()
        .collect::<Result<Vec<_>, _>>()
        .expect("screen CSV records");
    let index = records[0]
        .iter()
        .position(|field| field == b"screen_usage_foreground_app_package")
        .expect("screen foreground column")
        + 1;
    let mut writer = csv::Writer::from_writer(Vec::new());
    for (ordinal, record) in records.iter().enumerate() {
        let mut fields = record.iter().map(<[u8]>::to_vec).collect::<Vec<_>>();
        fields.insert(
            index,
            if ordinal == 0 {
                b"screen_usage_session_classification".to_vec()
            } else {
                Vec::new()
            },
        );
        writer
            .write_record(fields)
            .expect("prior screen CSV record");
    }
    writer.into_inner().expect("prior screen CSV bytes")
}

fn input(rows: &str) -> Vec<u8> {
    format!("{HEADER}{rows}").into_bytes()
}

fn support_for_fixture(fixture_id: &str, raw: &[u8]) -> RuntimeSupportFiles {
    let capabilities = match fixture_id {
        "extension.unlock-to-lock-boundaries.v1" => &[
            "android_usage_event_17_keyguard_shown",
            "android_usage_event_18_keyguard_hidden",
            "separate_screen_keyguard_event_rows",
            "full_unfiltered_source_event_stream",
            "source_record_order_preserved",
            "single_device_stream_per_participant",
            "complete_observation_window_chunk",
        ][..],
        "extension.unlock-to-off-or-lock-boundaries.v1" => &[
            "android_usage_event_16_screen_non_interactive",
            "android_usage_event_17_keyguard_shown",
            "android_usage_event_18_keyguard_hidden",
            "separate_screen_keyguard_event_rows",
            "full_unfiltered_source_event_stream",
            "source_record_order_preserved",
            "single_device_stream_per_participant",
            "complete_observation_window_chunk",
        ][..],
        _ => return RuntimeSupportFiles::default(),
    };
    let mut csv = String::from(
        "schema_version,raw_input_sha256,participant_id,capability_id,state,evidence_basis,evidence_reference,evidence_sha256\n",
    );
    for capability in capabilities {
        csv.push_str(&format!(
            "chronicle-input-capability-evidence/v1,{},P01,{capability},capable,study_protocol,urn:chronicle:fixture:{fixture_id},\n",
            sha256(raw),
        ));
    }
    let mut support = RuntimeSupportFiles::default();
    support
        .put("input_capability_evidence_file", csv.as_bytes())
        .expect("fixture capability evidence");
    support
}

fn base_options() -> Value {
    json!({
        "study_name": "Literature native conformance",
        "timezone": "UTC",
        "timezone_handling": "selected-filter",
        "usage_session_mode": "app_usage",
        "include_app_output": true,
        "include_screen_output": false,
        "use_filter_file": false,
        "use_apps_forcing_screen_open": false,
        "use_background_apps_file": false,
        "use_app_codebook": false,
        "include_category_column": false,
        "include_app_usage_end_reason": true,
        "deduplicate_exact_rows": true,
        "interaction_type_remap": [],
        "correct_duplicate_event_timestamps": false,
        "allow_stop_event_reuse": false,
        "use_activity_stopped_as_fallback": true,
        "apply_threshold_to_fallback": true,
        "long_duration_threshold_ns": 43200000000000_i64,
        "proximity_interval_ns": 0_i64,
        "custom_app_engagement_duration": 300.0,
        "long_data_time_gap_thresholds": [1.0, 2.0],
        "long_usage_duration_thresholds": [1.0, 2.0],
        "same_app_stop_types": ["Activity Paused", "Activity Resumed"],
        "other_stop_types": ["Activity Resumed", "Device Shutdown"],
        "interaction_types_to_remove": [],
        "screen_auto_lock_timeout_seconds": 120.0,
        "screen_auto_lock_tolerance_seconds": 30.0,
        "screen_manual_lock_max_tail_seconds": 30.0,
        "screen_keyguard_near_stop_seconds": 2.0,
        "datetime_of_preprocessing": "2026-08-31 00:00:00 UTC",
        "model_concurrent_usage": false,
        "micro_use_classification_policy": "none",
        "minimum_usage_duration": 0.0,
        "minimum_duration_comparator": "strict_lt",
        "minimum_duration_disposition": "chronicle_blank_keep_row",
        "apply_minimum_usage_duration_to_concurrent_subintervals": false,
        "filter_zero_duration_sessions": false,
        "enable_aggregates": false,
        "enable_plotting": false,
        "enable_activity_heatmap": false,
        "materialize_visualization_data": false
    })
}

fn case(fixture_id: &str) -> (Vec<u8>, Value) {
    let mut options = base_options();
    let rows = match fixture_id {
        "output-schema.phone-app-session-tuple.v1" => {
            concat!(
                "Study,P01,Participant,Target,Activity Resumed,com.example.target,2026-03-07 10:00:00,UTC\n",
                "Study,P01,Participant,Target,Activity Paused,com.example.target,2026-03-07 10:00:07,UTC\n"
            )
        }
        "output-schema.phone-session-tuple.v1" => {
            options["usage_session_mode"] = "screen_usage".into();
            options["include_app_output"] = false.into();
            options["include_screen_output"] = true.into();
            options["screen_session_construction_strategy"] =
                "chronicle_screen_interactive_v1".into();
            concat!(
                "Study,P01,Participant,System,Screen Interactive,android.system,2026-03-07 10:00:00,UTC\n",
                "Study,P01,Participant,System,Screen Non-Interactive,android.system,2026-03-07 10:00:20,UTC\n"
            )
        }
        "reconstruction.screen-on-next-screen-off.v1" => {
            options["usage_session_mode"] = "screen_usage".into();
            options["include_app_output"] = false.into();
            options["include_screen_output"] = true.into();
            options["screen_session_construction_strategy"] =
                "chronicle_screen_interactive_v1".into();
            concat!(
                "Study,P01,Child,System,Screen Interactive,android.system,2026-03-07 10:00:00.000000000,UTC\n",
                "Study,P01,Child,System,Screen Interactive,android.system,2026-03-07 10:00:10.000000000,UTC\n",
                "Study,P01,Child,System,Screen Non-Interactive,android.system,2026-03-07 10:00:20.000000000,UTC\n"
            )
        }
        "reconstruction.session-gap-strict-45s.v1" => {
            options["session_grouping_policy"] = "van_berkel_45s".into();
            options["session_gap_basis"] = "previous_episode_stop_v1".into();
            options["session_boundary_scope"] = "participant_v1".into();
            concat!(
                "Study,P01,Child,One,Activity Resumed,com.example.one,2026-03-07 10:00:00.000000000,UTC\n",
                "Study,P01,Child,One,Activity Paused,com.example.one,2026-03-07 10:00:05.000000000,UTC\n",
                "Study,P01,Child,Two,Activity Resumed,com.example.two,2026-03-07 10:00:50.000000000,UTC\n",
                "Study,P01,Child,Two,Activity Paused,com.example.two,2026-03-07 10:00:55.000000000,UTC\n",
                "Study,P01,Child,Three,Activity Resumed,com.example.three,2026-03-07 10:01:40.000000001,UTC\n",
                "Study,P01,Child,Three,Activity Paused,com.example.three,2026-03-07 10:01:45.000000001,UTC\n"
            )
        }
        "extension.session-gap-strict-lt5s.v1" => {
            options["session_grouping_policy"] = "smartphone_wellbeing_strict_lt_5s".into();
            options["session_gap_basis"] = "previous_episode_stop_v1".into();
            options["session_boundary_scope"] = "participant_v1".into();
            concat!(
                "Study,P01,Child,One,Activity Resumed,com.example.one,2026-03-07 10:00:00.000,UTC\n",
                "Study,P02,Adult,Alpha,Activity Resumed,com.example.alpha,2026-03-07 10:00:10.000,UTC\n",
                "Study,P02,Adult,Alpha,Activity Paused,com.example.alpha,2026-03-07 10:00:11.000,UTC\n",
                "Study,P02,Adult,Beta,Activity Resumed,com.example.beta,2026-03-07 10:00:15.999,UTC\n",
                "Study,P02,Adult,Beta,Activity Paused,com.example.beta,2026-03-07 10:00:16.999,UTC\n",
                "Study,P01,Child,One,Activity Paused,com.example.one,2026-03-07 10:00:20.000,UTC\n",
                "Study,P01,Child,Two,Activity Resumed,com.example.two,2026-03-07 10:00:24.999,UTC\n",
                "Study,P01,Child,Two,Activity Paused,com.example.two,2026-03-07 10:00:25.999,UTC\n",
                "Study,P01,Child,Three,Activity Resumed,com.example.three,2026-03-07 10:00:30.999,UTC\n",
                "Study,P01,Child,Three,Activity Paused,com.example.three,2026-03-07 10:00:31.999,UTC\n"
            )
        }
        "reconstruction.minimum-foreground-strict-gt5s.v1" => {
            options["minimum_usage_duration"] = 5.into();
            options["minimum_duration_comparator"] = "inclusive_le".into();
            options["minimum_duration_disposition"] = "drop_row".into();
            concat!(
                "Study,P01,Child,Equal,Activity Resumed,com.example.equal,2026-03-07 10:00:00.000000000,UTC\n",
                "Study,P01,Child,Equal,Activity Paused,com.example.equal,2026-03-07 10:00:05.000000000,UTC\n",
                "Study,P01,Child,Over,Activity Resumed,com.example.over,2026-03-07 10:01:00.000000000,UTC\n",
                "Study,P01,Child,Over,Activity Paused,com.example.over,2026-03-07 10:01:05.000000001,UTC\n"
            )
        }
        "reconstruction.foreground-background-pair.v1" => {
            options["event_retention_set"] = "foreground_background_only".into();
            options["opener_set"] = "activity_resumed_only".into();
            options["episode_reconstruction_strategy"] = "foreground_background_pairing".into();
            concat!(
                "Study,P01,Child,Target,Activity Resumed,com.example.target,2026-03-07 10:00:00,UTC\n",
                "Study,P01,Child,Other,Activity Paused,com.example.other,2026-03-07 10:00:03,UTC\n",
                "Study,P01,Child,Target,Activity Paused,com.example.target,2026-03-07 10:00:07,UTC\n",
                "Study,P01,Child,Unmatched,Activity Resumed,com.example.unmatched,2026-03-07 10:00:10,UTC\n"
            )
        }
        "reconstruction.each-app-opening-event.v1" => {
            options["opener_set"] = "activity_resumed_only".into();
            concat!(
                "Study,P01,Child,Alpha,Activity Resumed,com.example.alpha,2026-03-07 10:00:00,UTC\n",
                "Study,P01,Child,Alpha,Activity Paused,com.example.alpha,2026-03-07 10:00:05,UTC\n",
                "Study,P01,Child,Beta,Activity Resumed,com.example.beta,2026-03-07 10:01:00,UTC\n",
                "Study,P01,Child,Beta,Activity Paused,com.example.beta,2026-03-07 10:01:07,UTC\n",
                "Study,P02,Adult,Gamma,Activity Resumed,com.example.gamma,2026-03-07 10:02:00,UTC\n",
                "Study,P02,Adult,Gamma,Activity Paused,com.example.gamma,2026-03-07 10:02:03,UTC\n"
            )
        }
        "quality.stop-arrays-exclude-standby.v1" => {
            options["other_stop_types"] = json!(["Activity Resumed", "Screen Non-Interactive"]);
            concat!(
                "Study,P01,Child,One,Activity Resumed,com.example.one,2026-03-07 10:00:00,UTC\n",
                "Study,P01,Child,Two,Activity Resumed,com.example.two,2026-03-07 10:00:05,UTC\n",
                "Study,P01,Child,System,Screen Non-Interactive,android.system,2026-03-07 10:00:08,UTC\n"
            )
        }
        "quality.minimum-duration-strict-lt-1s.v1" => {
            options["minimum_usage_duration"] = 1.into();
            options["minimum_duration_comparator"] = "strict_lt".into();
            options["minimum_duration_disposition"] = "drop_row".into();
            concat!(
                "Study,P01,Child,Under,Activity Resumed,com.example.under,2026-03-07 10:00:00.000000000,UTC\n",
                "Study,P01,Child,Under,Activity Paused,com.example.under,2026-03-07 10:00:00.999999999,UTC\n",
                "Study,P01,Child,Equal,Activity Resumed,com.example.equal,2026-03-07 10:01:00.000000000,UTC\n",
                "Study,P01,Child,Equal,Activity Paused,com.example.equal,2026-03-07 10:01:01.000000000,UTC\n",
                "Study,P01,Child,Over,Activity Resumed,com.example.over,2026-03-07 10:02:00.000000000,UTC\n",
                "Study,P01,Child,Over,Activity Paused,com.example.over,2026-03-07 10:02:01.000000001,UTC\n"
            )
        }
        "quality.maximum-duration-strict-gt-6h.v1" => {
            for (key, value) in [
                (
                    "maximum_duration_policy",
                    "post_reconstruction_strict_max_v1",
                ),
                ("maximum_duration_disposition", "drop_row"),
                ("maximum_duration_threshold_source", "fixed_parameter"),
                ("maximum_duration_threshold_ns", "21600000000000"),
                ("b06_legacy_threshold_hours_canonical", "12"),
                ("b06_legacy_threshold_ns_canonical", "43200000000000"),
            ] {
                options[key] = value.into();
            }
            concat!(
                "Study,P01,Child,Below,Activity Resumed,com.example.below,2026-03-07 00:00:00.000000000,UTC\n",
                "Study,P01,Child,Below,Activity Paused,com.example.below,2026-03-07 05:59:59.999999999,UTC\n",
                "Study,P01,Child,Equal,Activity Resumed,com.example.equal,2026-03-08 00:00:00.000000000,UTC\n",
                "Study,P01,Child,Equal,Activity Paused,com.example.equal,2026-03-08 06:00:00.000000000,UTC\n",
                "Study,P01,Child,Over,Activity Resumed,com.example.over,2026-03-09 00:00:00.000000000,UTC\n",
                "Study,P01,Child,Over,Activity Paused,com.example.over,2026-03-09 06:00:00.000000001,UTC\n"
            )
        }
        "quality.zero-duration-exact-cleanup.v1" => {
            options["filter_zero_duration_sessions"] = true.into();
            concat!(
                "Study,P01,Child,Zero,Activity Resumed,com.example.zero,2026-03-07 10:00:00.000000000,UTC\n",
                "Study,P01,Child,Zero,Activity Paused,com.example.zero,2026-03-07 10:00:00.000000000,UTC\n",
                "Study,P01,Child,Positive,Activity Resumed,com.example.positive,2026-03-07 10:01:00.000000000,UTC\n",
                "Study,P01,Child,Positive,Activity Paused,com.example.positive,2026-03-07 10:01:01.000000000,UTC\n"
            )
        }
        "quality.background-apps-disabled.v1" => {
            options["use_background_apps_file"] = false.into();
            concat!(
                "Study,P01,Child,Foreground,Activity Resumed,com.example.foreground,2026-03-07 10:00:00.000000000,UTC\n",
                "Study,P01,Child,Foreground,Activity Paused,com.example.foreground,2026-03-07 10:00:05.000000000,UTC\n",
                "Study,P01,Child,Next,Activity Resumed,com.example.next,2026-03-07 10:00:10.000000000,UTC\n",
                "Study,P01,Child,Next,Activity Paused,com.example.next,2026-03-07 10:00:11.000000000,UTC\n"
            )
        }
        "aggregate.daily-event-count-and-window.v1" => {
            options["enable_aggregates"] = true.into();
            concat!(
                "Study,P01,Child,First,Activity Resumed,com.example.first,2026-03-07 00:00:00.000000000,UTC\n",
                "Study,P01,Child,First,Activity Paused,com.example.first,2026-03-07 00:01:00.000000000,UTC\n",
                "Study,P01,Child,Last,Activity Resumed,com.example.last,2026-03-07 23:58:00.000000000,UTC\n",
                "Study,P01,Child,Last,Activity Paused,com.example.last,2026-03-07 23:59:00.000000000,UTC\n"
            )
        }
        "aggregate.daily-screen-time-sum.v1" => {
            options["usage_session_mode"] = "screen_usage".into();
            options["include_app_output"] = false.into();
            options["include_screen_output"] = true.into();
            options["screen_session_construction_strategy"] =
                "chronicle_screen_interactive_v1".into();
            options["enable_aggregates"] = true.into();
            concat!(
                "Study,P01,Child,System,Screen Interactive,android.system,2026-03-07 12:00:00.000000000,UTC\n",
                "Study,P01,Child,System,Screen Non-Interactive,android.system,2026-03-07 12:10:00.000000000,UTC\n"
            )
        }
        "extension.behapp-half-open-1s.v1" => {
            options["interval_expansion_method"] = "behapp_start_anchored_half_open_1s_v1".into();
            concat!(
                "Study,P01,Child,Exact,Activity Resumed,com.example.exact,2026-03-07 10:00:00.000000000,UTC\n",
                "Study,P01,Child,Exact,Activity Paused,com.example.exact,2026-03-07 10:00:03.000000000,UTC\n",
                "Study,P01,Child,Fractional,Activity Resumed,com.example.fractional,2026-03-07 10:01:00.000000000,UTC\n",
                "Study,P01,Child,Fractional,Activity Paused,com.example.fractional,2026-03-07 10:01:03.900000000,UTC\n",
                "Study,P01,Child,Subsecond,Activity Resumed,com.example.subsecond,2026-03-07 10:02:00.000000000,UTC\n",
                "Study,P01,Child,Subsecond,Activity Paused,com.example.subsecond,2026-03-07 10:02:00.900000000,UTC\n"
            )
        }
        "extension.application-label-exclusion.v1" => {
            options["filter_match_field"] = "application_label".into();
            options["application_label_exclusions"] = json!(["YouTube Vanced", "Basic Daydreams"]);
            options["enable_aggregates"] = true.into();
            concat!(
                "Study,P01,Child,YouTube Vanced,Activity Resumed,com.example.shared,2026-03-07 10:00:00,UTC\n",
                "Study,P01,Child,YouTube Vanced,Activity Paused,com.example.shared,2026-03-07 10:00:01,UTC\n",
                "Study,P01,Child,Basic Daydreams,Activity Resumed,com.example.shared,2026-03-07 10:01:00,UTC\n",
                "Study,P01,Child,Basic Daydreams,Activity Paused,com.example.shared,2026-03-07 10:01:02,UTC\n",
                "Study,P01,Child,youtube vanced,Activity Resumed,com.example.shared,2026-03-07 10:02:00,UTC\n",
                "Study,P01,Child,youtube vanced,Activity Paused,com.example.shared,2026-03-07 10:02:03,UTC\n",
                "Study,P01,Child,YouTube Vanced Premium,Activity Resumed,com.example.shared,2026-03-07 10:03:00,UTC\n",
                "Study,P01,Child,YouTube Vanced Premium,Activity Paused,com.example.shared,2026-03-07 10:03:04,UTC\n",
                "Study,P01,Child,Control,Activity Resumed,com.example.shared,2026-03-07 10:04:00,UTC\n",
                "Study,P01,Child,Control,Activity Paused,com.example.shared,2026-03-07 10:04:05,UTC\n"
            )
        }
        "extension.daily-top-apps-top5.v1" => {
            options["enable_aggregates"] = true.into();
            options["aggregate_top_apps_limit"] = 5.into();
            concat!(
                "Study,P01,Child,A,Activity Resumed,com.example.a,2026-03-07 10:00:00,UTC\n",
                "Study,P01,Child,A,Activity Paused,com.example.a,2026-03-07 10:06:00,UTC\n",
                "Study,P01,Child,B,Activity Resumed,com.example.b,2026-03-07 10:10:00,UTC\n",
                "Study,P01,Child,B,Activity Paused,com.example.b,2026-03-07 10:15:00,UTC\n",
                "Study,P01,Child,C,Activity Resumed,com.example.c,2026-03-07 10:20:00,UTC\n",
                "Study,P01,Child,C,Activity Paused,com.example.c,2026-03-07 10:24:00,UTC\n",
                "Study,P01,Child,D,Activity Resumed,com.example.d,2026-03-07 10:30:00,UTC\n",
                "Study,P01,Child,D,Activity Paused,com.example.d,2026-03-07 10:33:00,UTC\n",
                "Study,P01,Child,E,Activity Resumed,com.example.e,2026-03-07 10:40:00,UTC\n",
                "Study,P01,Child,E,Activity Paused,com.example.e,2026-03-07 10:42:00,UTC\n",
                "Study,P01,Child,F,Activity Resumed,com.example.f,2026-03-07 10:50:00,UTC\n",
                "Study,P01,Child,F,Activity Paused,com.example.f,2026-03-07 10:51:00,UTC\n"
            )
        }
        "extension.strict-visual-screen-gate.v1" => {
            options["usage_session_mode"] = "app_and_screen_usage".into();
            options["include_screen_output"] = true.into();
            options["enable_screen_gated_crediting"] = true.into();
            options["screen_gating_rule"] = "strict_visual_only".into();
            options["auto_lock_bridge_seconds"] = 0.into();
            concat!(
                "Study,P01,Witnessed,System,Screen Interactive,android.system,2026-03-07 09:59:00,UTC\n",
                "Study,P01,Witnessed,Visible,Activity Resumed,com.example.visible,2026-03-07 10:00:00,UTC\n",
                "Study,P01,Witnessed,System,Screen Non-Interactive,android.system,2026-03-07 10:00:30,UTC\n",
                "Study,P01,Witnessed,Visible,Activity Paused,com.example.visible,2026-03-07 10:01:00,UTC\n",
                "Study,P02,Unwitnessed,Hidden,Activity Resumed,com.example.hidden,2026-03-07 11:00:00,UTC\n",
                "Study,P02,Unwitnessed,Hidden,Activity Paused,com.example.hidden,2026-03-07 11:01:00,UTC\n"
            )
        }
        "extension.unlock-to-lock-boundaries.v1"
        | "extension.unlock-to-off-or-lock-boundaries.v1" => {
            options["usage_session_mode"] = "app_and_screen_usage".into();
            options["include_screen_output"] = true.into();
            options["screen_session_construction_strategy"] =
                if fixture_id == "extension.unlock-to-lock-boundaries.v1" {
                    "unlock_to_lock_v1"
                } else {
                    "unlock_to_off_or_lock_v1"
                }
                .into();
            concat!(
                "Study,P01,Child,System,Screen Interactive,android.system,2026-03-07 10:00:00,UTC\n",
                "Study,P01,Child,System,Keyguard Hidden,android.system,2026-03-07 10:00:10,UTC\n",
                "Study,P01,Child,Inside,Activity Resumed,com.example.inside,2026-03-07 10:00:15,UTC\n",
                "Study,P01,Child,Inside,Activity Paused,com.example.inside,2026-03-07 10:00:20,UTC\n",
                "Study,P01,Child,System,Screen Non-Interactive,android.system,2026-03-07 10:00:30,UTC\n",
                "Study,P01,Child,System,Keyguard Shown,android.system,2026-03-07 10:00:40,UTC\n"
            )
        }
        "extension.drop-out-of-source-order-events.v1" => {
            options["drop_out_of_source_order_events"] = true.into();
            concat!(
                "Study,P01,Child,Keep,Activity Resumed,com.example.keep,2026-03-07 10:00:10,UTC\n",
                "Study,P02,Adult,Other,Activity Resumed,com.example.other,2026-03-07 10:00:01,UTC\n",
                "Study,P02,Adult,Other,Activity Paused,com.example.other,2026-03-07 10:00:02,UTC\n",
                "Study,P01,Child,Drop,Activity Resumed,com.example.drop,2026-03-07 10:00:05,UTC\n",
                "Study,P01,Child,Keep,Activity Paused,com.example.keep,2026-03-07 10:00:20,UTC\n"
            )
        }
        "extension.screen-session-phone-check-15s.v1" => {
            options["usage_session_mode"] = "screen_usage".into();
            options["include_app_output"] = false.into();
            options["include_screen_output"] = true.into();
            options["screen_session_construction_strategy"] =
                "chronicle_screen_interactive_v1".into();
            options["screen_session_classification_policy"] = "phone_check_inclusive_15s".into();
            concat!(
                "Study,P01,Equal,System,Screen Interactive,android.system,2026-03-07 10:00:00.000000000,UTC\n",
                "Study,P01,Equal,System,Screen Non-Interactive,android.system,2026-03-07 10:00:15.000000000,UTC\n",
                "Study,P02,Over,System,Screen Interactive,android.system,2026-03-07 11:00:00.000000000,UTC\n",
                "Study,P02,Over,System,Screen Non-Interactive,android.system,2026-03-07 11:00:15.000000001,UTC\n"
            )
        }
        "extension.screen-session-null-app-15s.v1" => {
            options["usage_session_mode"] = "screen_usage".into();
            options["include_app_output"] = false.into();
            options["include_screen_output"] = true.into();
            options["screen_session_construction_strategy"] =
                "chronicle_screen_interactive_v1".into();
            options["screen_session_classification_policy"] =
                "null_no_app_strict_gt15s_vs_app".into();
            concat!(
                "Study,P01,Equal,System,Screen Interactive,android.system,2026-03-07 10:00:00.000000000,UTC\n",
                "Study,P01,Equal,System,Screen Non-Interactive,android.system,2026-03-07 10:00:15.000000000,UTC\n",
                "Study,P02,Null,System,Screen Interactive,android.system,2026-03-07 11:00:00.000000000,UTC\n",
                "Study,P02,Null,System,Screen Non-Interactive,android.system,2026-03-07 11:00:15.000000001,UTC\n",
                "Study,P03,App,System,Screen Interactive,android.system,2026-03-07 12:00:00.000000000,UTC\n",
                "Study,P03,App,Target,Activity Resumed,com.example.target,2026-03-07 12:00:01.000000000,UTC\n",
                "Study,P03,App,System,Screen Non-Interactive,android.system,2026-03-07 12:00:15.000000000,UTC\n"
            )
        }
        "extension.screen-session-cap-60m.v1" => {
            options["usage_session_mode"] = "screen_usage".into();
            options["include_app_output"] = false.into();
            options["include_screen_output"] = true.into();
            options["screen_session_construction_strategy"] =
                "chronicle_screen_interactive_v1".into();
            options["screen_session_maximum_duration_minutes"] = 60.into();
            options["screen_session_maximum_duration_disposition"] = "truncate".into();
            concat!(
                "Study,P01,Equal,System,Screen Interactive,android.system,2026-03-07 10:00:00.000000000,UTC\n",
                "Study,P01,Equal,System,Screen Non-Interactive,android.system,2026-03-07 11:00:00.000000000,UTC\n",
                "Study,P02,Over,System,Screen Interactive,android.system,2026-03-07 12:00:00.000000000,UTC\n",
                "Study,P02,Over,System,Screen Non-Interactive,android.system,2026-03-07 13:00:00.000000001,UTC\n"
            )
        }
        "extension.exclude-participant-screen-interval-strict-gt-10h.v1" => {
            options["usage_session_mode"] = "app_usage".into();
            options["include_screen_output"] = false.into();
            options["screen_session_construction_strategy"] =
                "chronicle_screen_interactive_v1".into();
            options["screen_session_maximum_duration_minutes"] = 600.into();
            options["screen_session_maximum_duration_disposition"] = "exclude_participant".into();
            options["notification_proxy_rule"] = "any_notification_contact_v1".into();
            options["enable_participant_amount_summary"] = true.into();
            options["enable_plotting"] = true.into();
            options["materialize_visualization_data"] = true.into();
            concat!(
                "Study,P01,Equal,System,Screen Interactive,android.system,2026-03-07 00:00:00.000000000,UTC\n",
                "Study,P01,Equal,Keep,Activity Resumed,com.example.keep,2026-03-07 00:01:00.000000000,UTC\n",
                "Study,P01,Equal,Keep,Notification Seen,com.example.keep,2026-03-07 00:01:30.000000000,UTC\n",
                "Study,P01,Equal,Keep,Activity Paused,com.example.keep,2026-03-07 00:02:00.000000000,UTC\n",
                "Study,P01,Equal,System,Screen Non-Interactive,android.system,2026-03-07 10:00:00.000000000,UTC\n",
                "Study,P02,Over,System,Screen Interactive,android.system,2026-03-07 00:00:00.000000000,UTC\n",
                "Study,P02,Over,Drop,Activity Resumed,com.example.drop,2026-03-07 00:01:00.000000000,UTC\n",
                "Study,P02,Over,Drop,Notification Seen,com.example.drop,2026-03-07 00:01:30.000000000,UTC\n",
                "Study,P02,Over,Drop,Activity Paused,com.example.drop,2026-03-07 00:02:00.000000000,UTC\n",
                "Study,P02,Over,System,Screen Non-Interactive,android.system,2026-03-07 10:00:00.000000001,UTC\n",
                "Study,P03,Control,System,Screen Interactive,android.system,2026-03-07 00:00:00.000000000,UTC\n",
                "Study,P03,Control,Control,Activity Resumed,com.example.control,2026-03-07 00:01:00.000000000,UTC\n",
                "Study,P03,Control,Control,Activity Paused,com.example.control,2026-03-07 00:02:00.000000000,UTC\n",
                "Study,P03,Control,System,Screen Non-Interactive,android.system,2026-03-07 01:00:00.000000000,UTC\n"
            )
        }
        "extension.locked-screen-audio-exclusion.v1" => {
            options["usage_session_mode"] = "app_and_screen_usage".into();
            options["include_screen_output"] = true.into();
            options["screen_session_construction_strategy"] =
                "chronicle_screen_interactive_v1".into();
            options["locked_screen_audio_disposition"] =
                "exclude_from_phone_and_app_sessions".into();
            concat!(
                "Study,P01,Unlocked,System,Screen Interactive,android.system,2026-03-07 10:00:00,UTC\n",
                "Study,P01,Unlocked,Music,Activity Resumed,com.example.music,2026-03-07 10:00:01,UTC\n",
                "Study,P01,Unlocked,System,Screen Non-Interactive,android.system,2026-03-07 10:00:10,UTC\n",
                "Study,P01,Unlocked,Music,Activity Paused,com.example.music,2026-03-07 10:00:20,UTC\n",
                "Study,P02,Locked,System,Screen Interactive,android.system,2026-03-07 11:00:00,UTC\n",
                "Study,P02,Locked,System,Keyguard Shown,android.system,2026-03-07 11:00:01,UTC\n",
                "Study,P02,Locked,Music,Activity Resumed,com.example.music,2026-03-07 11:00:02,UTC\n",
                "Study,P02,Locked,System,Screen Non-Interactive,android.system,2026-03-07 11:00:10,UTC\n",
                "Study,P02,Locked,Music,Activity Paused,com.example.music,2026-03-07 11:00:20,UTC\n"
            )
        }
        other => panic!("unknown fixture {other}"),
    };
    (input(rows), options)
}

fn rows(csv_bytes: &[u8]) -> Vec<BTreeMap<String, String>> {
    let mut reader = csv::Reader::from_reader(csv_bytes);
    let headers = reader.headers().expect("CSV header").clone();
    reader
        .records()
        .map(|record| {
            headers
                .iter()
                .zip(record.expect("CSV record").iter())
                .map(|(key, value)| (key.to_owned(), value.to_owned()))
                .collect()
        })
        .collect()
}

fn values(rows: &[BTreeMap<String, String>], key: &str) -> Vec<String> {
    rows.iter()
        .map(|row| {
            row.get(key)
                .unwrap_or_else(|| panic!("missing {key}"))
                .clone()
        })
        .collect()
}

fn assert_semantics(
    fixture_id: &str,
    app: &[u8],
    screen: &[u8],
    interval_expansion: &[u8],
    daily_aggregate: &[u8],
    top_apps_aggregate: &[u8],
    credited_app: &[u8],
) {
    let app = rows(app);
    let screen = rows(screen);
    let interval_expansion = rows(interval_expansion);
    match fixture_id {
        "output-schema.phone-app-session-tuple.v1" => {
            let completed = app
                .iter()
                .filter(|row| row.get("interaction_type").map(String::as_str) == Some("App Usage"))
                .cloned()
                .collect::<Vec<_>>();
            assert_eq!(completed.len(), 1);
            assert_eq!(values(&completed, "participant_id"), ["P01"]);
            assert_eq!(values(&completed, "application_label"), ["Target"]);
            assert_eq!(
                values(&completed, "start_timestamp"),
                ["03-07-2026 10:00:00"]
            );
            assert_eq!(
                values(&completed, "stop_timestamp"),
                ["03-07-2026 10:00:07"]
            );
        }
        "output-schema.phone-session-tuple.v1" => {
            assert_eq!(screen.len(), 1);
            assert_eq!(values(&screen, "participant_id"), ["P01"]);
            assert_eq!(
                values(&screen, "start_timestamp"),
                ["2026-03-07 10:00:00.000000+00:00"]
            );
            assert_eq!(
                values(&screen, "stop_timestamp"),
                ["2026-03-07 10:00:20.000000+00:00"]
            );
        }
        "reconstruction.screen-on-next-screen-off.v1" => {
            assert_eq!(screen.len(), 1);
            assert_eq!(
                values(&screen, "start_timestamp"),
                ["2026-03-07 10:00:00.000000+00:00"]
            );
            assert_eq!(
                values(&screen, "stop_timestamp"),
                ["2026-03-07 10:00:20.000000+00:00"]
            );
            assert_eq!(values(&screen, "duration_seconds"), ["20.0"]);
        }
        "reconstruction.session-gap-strict-45s.v1" => {
            assert_eq!(values(&app, "usage_session_id"), ["0", "0", "1"]);
        }
        "extension.session-gap-strict-lt5s.v1" => {
            let p01 = app
                .iter()
                .filter(|row| row.get("participant_id").map(String::as_str) == Some("P01"))
                .cloned()
                .collect::<Vec<_>>();
            let p02 = app
                .iter()
                .filter(|row| row.get("participant_id").map(String::as_str) == Some("P02"))
                .cloned()
                .collect::<Vec<_>>();
            assert_eq!(values(&p01, "usage_session_id"), ["0", "0", "1"]);
            assert_eq!(values(&p02, "usage_session_id"), ["0", "0"]);
        }
        "reconstruction.minimum-foreground-strict-gt5s.v1" => {
            assert_eq!(values(&app, "app_package_name"), ["com.example.over"]);
            assert_eq!(values(&app, "duration_seconds"), ["5.000000001"]);
        }
        "reconstruction.foreground-background-pair.v1" => {
            let completed = app
                .iter()
                .filter(|row| row.get("interaction_type").map(String::as_str) == Some("App Usage"))
                .cloned()
                .collect::<Vec<_>>();
            assert_eq!(
                values(&completed, "app_package_name"),
                ["com.example.target"]
            );
            assert_eq!(values(&completed, "duration_seconds"), ["7.0"]);
        }
        "reconstruction.each-app-opening-event.v1" => {
            let completed = app
                .iter()
                .filter(|row| row.get("interaction_type").map(String::as_str) == Some("App Usage"))
                .cloned()
                .collect::<Vec<_>>();
            assert_eq!(
                values(&completed, "app_package_name"),
                ["com.example.alpha", "com.example.beta", "com.example.gamma"]
            );
        }
        "quality.stop-arrays-exclude-standby.v1" => {
            let completed = app
                .iter()
                .filter(|row| row.get("interaction_type").map(String::as_str) == Some("App Usage"))
                .cloned()
                .collect::<Vec<_>>();
            assert_eq!(
                values(&completed, "app_package_name"),
                ["com.example.one", "com.example.two"]
            );
            assert_eq!(values(&completed, "duration_seconds"), ["5.0", "3.0"]);
        }
        "quality.minimum-duration-strict-lt-1s.v1" => {
            assert_eq!(
                values(&app, "app_package_name"),
                ["com.example.equal", "com.example.over"]
            );
            assert_eq!(values(&app, "duration_seconds"), ["1.0", "1.000000001"]);
        }
        "quality.maximum-duration-strict-gt-6h.v1" => {
            assert_eq!(
                values(&app, "app_package_name"),
                ["com.example.below", "com.example.equal"]
            );
        }
        "quality.zero-duration-exact-cleanup.v1" => {
            assert_eq!(values(&app, "app_package_name"), ["com.example.positive"]);
            assert_eq!(values(&app, "duration_seconds"), ["1.0"]);
        }
        "quality.background-apps-disabled.v1" => {
            assert_eq!(
                values(&app, "app_package_name"),
                ["com.example.foreground", "com.example.next"]
            );
            assert_eq!(values(&app, "duration_seconds"), ["5.0", "1.0"]);
        }
        "aggregate.daily-event-count-and-window.v1" => {
            let daily = rows(daily_aggregate);
            assert_eq!(daily.len(), 1);
            assert_eq!(values(&daily, "date"), ["2026-03-07"]);
            assert_eq!(values(&daily, "app_session_count"), ["2"]);
            assert_eq!(values(&daily, "total_app_usage_minutes"), ["2"]);
        }
        "aggregate.daily-screen-time-sum.v1" => {
            let daily = rows(daily_aggregate);
            assert_eq!(daily.len(), 1);
            assert_eq!(values(&daily, "date"), ["2026-03-07"]);
            assert_eq!(values(&daily, "screen_session_count"), ["1"]);
            assert_eq!(values(&daily, "total_screen_usage_minutes"), ["10"]);
        }
        "extension.behapp-half-open-1s.v1" => {
            assert_eq!(values(&app, "duration_seconds"), ["3.0", "3.9", "0.9"]);
            assert_eq!(interval_expansion.len(), 6);
            assert_eq!(
                values(&interval_expansion, "event_timestamp"),
                [
                    "2026-03-07 10:00:00+00:00",
                    "2026-03-07 10:00:01+00:00",
                    "2026-03-07 10:00:02+00:00",
                    "2026-03-07 10:01:00+00:00",
                    "2026-03-07 10:01:01+00:00",
                    "2026-03-07 10:01:02+00:00",
                ]
            );
            assert_eq!(
                values(&interval_expansion, "duration_seconds"),
                ["1.0", "1.0", "1.0", "1.0", "1.0", "1.0"]
            );
        }
        "extension.application-label-exclusion.v1" => {
            assert_eq!(
                values(&app, "application_label"),
                [
                    "YouTube Vanced",
                    "Basic Daydreams",
                    "youtube vanced",
                    "YouTube Vanced Premium",
                    "Control",
                ],
                "filtered lineage and all same-package comparison rows remain present",
            );
            assert_eq!(
                values(&app, "interaction_type"),
                [
                    "Filtered App Usage",
                    "Filtered App Usage",
                    "App Usage",
                    "App Usage",
                    "App Usage",
                ],
                "only exact case-sensitive full-label matches are filtered",
            );
            let daily = rows(daily_aggregate);
            assert_eq!(daily.len(), 1);
            assert_eq!(values(&daily, "total_app_usage_minutes"), ["0.2"]);
            for row in app.iter().take(2) {
                for field in ["start_timestamp", "stop_timestamp", "duration_seconds", "duration_minutes"] {
                    assert_eq!(row[field], "", "exact-label filtered timing must be blank: {field}");
                }
            }
            assert!(!app[2]["start_timestamp"].is_empty(), "same-package nonmatching label keeps timing");
        }
        "extension.daily-top-apps-top5.v1" => {
            let top_apps = rows(top_apps_aggregate);
            assert_eq!(top_apps.len(), 5);
            assert_eq!(values(&top_apps, "rank"), ["1", "2", "3", "4", "5"]);
            assert_eq!(
                values(&top_apps, "app_package_name"),
                [
                    "com.example.a",
                    "com.example.b",
                    "com.example.c",
                    "com.example.d",
                    "com.example.e",
                ]
            );
        }
        "extension.strict-visual-screen-gate.v1" => {
            let credited = rows(credited_app);
            assert!(
                credited
                    .iter()
                    .all(|row| row.get("participant_id").map(String::as_str) == Some("P01")),
                "the participant with no screen witness must receive no credited rows",
            );
            let app_usage = credited
                .iter()
                .filter(|row| row.get("interaction_type").map(String::as_str) == Some("App Usage"))
                .cloned()
                .collect::<Vec<_>>();
            assert_eq!(
                values(&app_usage, "app_package_name"),
                ["com.example.visible"]
            );
            assert_eq!(values(&app_usage, "duration_seconds"), ["30.0"]);
            assert_eq!(
                values(&app_usage, "start_timestamp"),
                ["03-07-2026 10:00:00"]
            );
            assert_eq!(
                values(&app_usage, "stop_timestamp"),
                ["03-07-2026 10:00:30"]
            );
        }
        "extension.unlock-to-lock-boundaries.v1"
        | "extension.unlock-to-off-or-lock-boundaries.v1" => {
            assert_eq!(screen.len(), 1);
            assert_eq!(
                values(&screen, "start_timestamp"),
                ["2026-03-07 10:00:10.000000+00:00"]
            );
            let expected_stop = if fixture_id == "extension.unlock-to-lock-boundaries.v1" {
                "2026-03-07 10:00:40.000000+00:00"
            } else {
                "2026-03-07 10:00:30.000000+00:00"
            };
            assert_eq!(values(&screen, "stop_timestamp"), [expected_stop]);
            assert!(
                values(&app, "app_package_name")
                    .iter()
                    .any(|package| package == "com.example.inside"),
                "foreground app evidence inside the screen interval is retained",
            );
        }
        "extension.drop-out-of-source-order-events.v1" => {
            assert_eq!(values(&app, "application_label"), ["Other", "Keep"]);
            assert_eq!(
                values(&app, "app_package_name"),
                ["com.example.other", "com.example.keep"]
            );
        }
        "extension.screen-session-phone-check-15s.v1" => {
            assert_eq!(screen.len(), 2);
            assert_eq!(
                values(&screen, "duration_seconds"),
                ["15.0", "15.000000001"]
            );
            assert_eq!(
                values(&screen, "screen_usage_session_classification"),
                ["phone_check", ""]
            );
        }
        "extension.screen-session-null-app-15s.v1" => {
            assert_eq!(screen.len(), 3);
            assert_eq!(
                values(&screen, "screen_usage_session_classification"),
                ["", "null", "app"]
            );
        }
        "extension.screen-session-cap-60m.v1" => {
            assert_eq!(screen.len(), 2);
            assert_eq!(values(&screen, "duration_minutes"), ["60.0", "60.0"]);
            assert_eq!(
                values(&screen, "screen_usage_end_reason"),
                ["unknown", "duration_cap"]
            );
            assert_eq!(
                values(&screen, "stop_timestamp"),
                [
                    "2026-03-07 11:00:00.000000+00:00",
                    "2026-03-07 13:00:00.000000+00:00",
                ]
            );
        }
        "extension.exclude-participant-screen-interval-strict-gt-10h.v1" => {
            assert!(
                screen.is_empty(),
                "screen publication is deliberately disabled"
            );
            assert!(
                app.iter()
                    .all(|row| { row.get("participant_id").map(String::as_str) != Some("P02") }),
                "every row for a participant with an over-cap screen interval is excluded",
            );
            let retained = app
                .iter()
                .filter_map(|row| row.get("participant_id").cloned())
                .collect::<BTreeSet<_>>();
            assert_eq!(retained, BTreeSet::from(["P01".into(), "P03".into()]));
            let completed = app
                .iter()
                .filter(|row| row.get("interaction_type").map(String::as_str) == Some("App Usage"))
                .cloned()
                .collect::<Vec<_>>();
            assert_eq!(
                values(&completed, "app_package_name"),
                ["com.example.keep", "com.example.control"]
            );
        }
        "extension.locked-screen-audio-exclusion.v1" => {
            assert_eq!(values(&screen, "participant_id"), ["P01"]);
            assert_eq!(values(&app, "participant_id"), ["P01"]);
            assert_eq!(values(&app, "app_package_name"), ["com.example.music"]);
            assert_eq!(values(&app, "duration_seconds"), ["9.0"]);
            assert_eq!(values(&app, "stop_timestamp"), ["03-07-2026 10:00:10"]);
        }
        other => panic!("unknown fixture {other}"),
    }
}

fn take_artifact(
    handle: &mut chronicle_preprocessing_runtime_wasm::RuntimeHandle,
    kind: &str,
) -> Option<Vec<u8>> {
    let index = (0..handle.artifact_count()).find(|index| {
        serde_json::from_str::<RuntimeArtifactMetadata>(
            &handle
                .artifact_metadata_json(*index)
                .expect("artifact metadata"),
        )
        .expect("artifact metadata JSON")
        .kind
            == kind
    })?;
    Some(handle.take_artifact_bytes(index).expect("artifact bytes"))
}

#[test]
fn package_support_and_direct_label_exclusions_do_not_cross_contaminate_matching() {
    let raw = input(concat!(
        "Study,P01,Child,Package Filtered,Activity Resumed,com.example.package-filtered,2026-03-07 10:00:00,UTC\n",
        "Study,P01,Child,Package Filtered,Activity Paused,com.example.package-filtered,2026-03-07 10:01:00,UTC\n",
        "Study,P01,Child,Direct Label,Activity Resumed,com.example.shared,2026-03-07 10:02:00,UTC\n",
        "Study,P01,Child,Direct Label,Activity Paused,com.example.shared,2026-03-07 10:03:00,UTC\n",
        "Study,P01,Child,Same Package Control,Activity Resumed,com.example.shared,2026-03-07 10:04:00,UTC\n",
        "Study,P01,Child,Same Package Control,Activity Paused,com.example.shared,2026-03-07 10:05:00,UTC\n",
    ));
    let mut options = base_options();
    options["use_filter_file"] = true.into();
    options["application_label_exclusions"] = json!(["Direct Label"]);
    let request = json!({
        "protocolVersion": RUNTIME_PROTOCOL_VERSION,
        "requestId": "literature-conformance:mixed-package-and-direct-label",
        "command": EXECUTE_WORKSPACE_COMMAND,
        "workspaceRootDigest": null,
        "workspaceId": sha256(b"mixed-package-and-direct-label"),
        "inputFileName": "mixed-package-and-direct-label.csv",
        "inputSha256": sha256(&raw),
        "options": options
    })
    .to_string();
    let mut support = RuntimeSupportFiles::default();
    support
        .put(
            "filter_file",
            b"app_package_name\ncom.example.package-filtered\n",
        )
        .expect("package support file");
    let mut handle = execute_workspace_native(&request, &raw, &support)
        .expect("mixed package and direct-label execution");
    let app = rows(&take_artifact(&mut handle, "app-csv").expect("mixed app CSV"));
    assert_eq!(
        values(&app, "application_label"),
        ["Package Filtered", "Direct Label", "Same Package Control"],
    );
    assert_eq!(
        values(&app, "interaction_type"),
        ["Filtered App Usage", "Filtered App Usage", "App Usage"],
        "package rules may relabel early, but direct labels must wait for post-reconstruction exact matching",
    );
}

#[test]
fn exact_audited_native_bindings_execute_their_source_boundary_fixtures() {
    let fixture_manifest: FixtureManifest =
        serde_json::from_str(MANIFEST_JSON).expect("fixture manifest");
    assert_eq!(
        fixture_manifest.schema_version,
        "chronicle-literature-native-conformance/v1"
    );
    assert_eq!(fixture_manifest.fixtures.len(), 27);
    let setting_ids = fixture_manifest
        .fixtures
        .iter()
        .flat_map(|fixture| fixture.method_setting_ids.iter())
        .collect::<BTreeSet<_>>();
    assert_eq!(setting_ids.len(), 71);

    let mut digest_mismatches = Vec::new();
    let mut paired_results = BTreeMap::new();
    for fixture in fixture_manifest.fixtures {
        let engines: &[Option<&str>] = if matches!(fixture.fixture_id.as_str(),
            "extension.application-label-exclusion.v1"
            | "extension.exclude-participant-screen-interval-strict-gt-10h.v1") {
            &[None, Some("incremental")]
        } else {
            &[None]
        };
        for engine in engines {
        let (raw, options) = case(&fixture.fixture_id);
        let mut bindings = Vec::new();
        for setting_id in &fixture.method_setting_ids {
            for (slot, value) in &fixture.browser_contract_bindings {
                bindings.push(json!({
                    "settingId": setting_id,
                    "slot": slot,
                    "value": value,
                    "conformanceFixtureId": fixture.fixture_id,
                    "conformanceResultDigest": fixture.result_digest
                }));
            }
        }
        let output_bindings = receipt_output_bindings(&fixture);
        let workspace_id = sha256(fixture.fixture_id.as_bytes());
        let mut request = json!({
            "protocolVersion": RUNTIME_PROTOCOL_VERSION,
            "requestId": format!("literature-conformance:{}", fixture.fixture_id),
            "command": EXECUTE_WORKSPACE_COMMAND,
            "workspaceRootDigest": null,
            "workspaceId": workspace_id,
            "inputFileName": format!("{}.csv", fixture.fixture_id),
            "inputSha256": sha256(&raw),
            "methodProfileReceipt": {
                "methodProfileId": format!("conformance-fixture:{}", fixture.fixture_id),
                "sourceWorkId": format!("conformance-fixture:{}", fixture.fixture_id),
                "sourceMethodVariantId": fixture.fixture_id,
                "sourceMethodVariantIds": [fixture.fixture_id],
                "methodProfileVersion": "v1",
                "settingIds": fixture.method_setting_ids,
                "bindings": bindings,
                "outputBindings": output_bindings.clone()
            },
            "options": options
        });
        if let Some(engine) = engine {
            request["executionEngine"] = (*engine).into();
        }
        let baseline_request =
            (fixture.fixture_id == "extension.behapp-half-open-1s.v1").then(|| {
                let mut baseline = request.clone();
                baseline
                    .as_object_mut()
                    .expect("request object")
                    .remove("methodProfileReceipt");
                baseline["requestId"] =
                    format!("literature-conformance:{}:disabled", fixture.fixture_id).into();
                baseline["options"]["interval_expansion_method"] = "none".into();
                baseline.to_string()
            });
        let disabled_label_request =
            (fixture.fixture_id == "extension.application-label-exclusion.v1").then(|| {
                let mut baseline = request.clone();
                baseline
                    .as_object_mut()
                    .expect("request object")
                    .remove("methodProfileReceipt");
                baseline["requestId"] =
                    "literature-conformance:application-label-exclusion:disabled".into();
                baseline["options"]
                    .as_object_mut()
                    .expect("options object")
                    .remove("application_label_exclusions");
                baseline["options"]
                    .as_object_mut()
                    .expect("options object")
                    .remove("filter_match_field");
                baseline.to_string()
            });
        let forged_label_request =
            (fixture.fixture_id == "extension.application-label-exclusion.v1").then(|| {
                let mut forged = request.clone();
                forged["methodProfileReceipt"]["settingIds"] = json!(["method-setting-forged"]);
                for binding in forged["methodProfileReceipt"]["bindings"]
                    .as_array_mut()
                    .expect("binding array")
                {
                    binding["settingId"] = "method-setting-forged".into();
                }
                forged.to_string()
            });
        let support = support_for_fixture(&fixture.fixture_id, &raw);
        let request = request.to_string();
        scientific_preflight_native(&request, &raw, &support)
            .unwrap_or_else(|error| panic!("{} preflight: {error}", fixture.fixture_id));
        if let Some(forged_label_request) = forged_label_request {
            assert!(
                scientific_preflight_native(&forged_label_request, &raw, &support)
                    .unwrap_err()
                    .contains("requires both registered setting IDs"),
                "matching runtime values must not authorize a forged source identity tuple",
            );
        }
        let mut handle = execute_workspace_native(&request, &raw, &support)
            .unwrap_or_else(|error| panic!("{} execution: {error}", fixture.fixture_id));
        let manifest: RuntimeManifest =
            serde_json::from_str(&handle.manifest_json()).expect("runtime manifest");
        if fixture.fixture_id == "extension.exclude-participant-screen-interval-strict-gt-10h.v1" {
            assert_eq!(manifest.counts.original, 14);
            assert_eq!(manifest.counts.processed, 9);
        }
        let app = take_artifact(&mut handle, "app-csv").unwrap_or_default();
        let screen = take_artifact(&mut handle, "screen-csv").unwrap_or_default();
        let interval_expansion =
            take_artifact(&mut handle, "interval-expansion-csv").unwrap_or_default();
        let daily_aggregate =
            take_artifact(&mut handle, "aggregate-daily-summary-csv").unwrap_or_default();
        let top_apps_aggregate =
            take_artifact(&mut handle, "aggregate-top-apps-csv").unwrap_or_default();
        let participant_amount =
            take_artifact(&mut handle, "aggregate-participant-amount-summary-csv")
                .unwrap_or_default();
        let notification_contact =
            take_artifact(&mut handle, "notification-contact-csv").unwrap_or_default();
        let visualization =
            take_artifact(&mut handle, "visualization-data-json").unwrap_or_default();
        let credited_app = take_artifact(&mut handle, "credited-app-csv").unwrap_or_default();
        let receipt = take_artifact(&mut handle, "method-profile-receipt-json")
            .expect("method-profile receipt artifact");
        let receipt: Value = serde_json::from_slice(&receipt).expect("method-profile receipt");
        assert_eq!(receipt["sourceMethodVariantId"], fixture.fixture_id);
        assert_eq!(
            receipt["sourceMethodVariantIds"],
            json!([fixture.fixture_id])
        );
        assert_eq!(receipt["settingIds"], json!(fixture.method_setting_ids));
        assert_eq!(receipt["outputBindings"], json!(output_bindings));
        let output_headers = match fixture
            .output_bindings
            .first()
            .map(|binding| binding.chronicle_output_kind.as_str())
        {
            Some("app-csv") => rows(&app),
            Some("screen-csv") => rows(&screen),
            None => Vec::new(),
            Some(kind) => panic!("unsupported output binding kind: {kind}"),
        };
        for binding in &fixture.output_bindings {
            assert!(
                output_headers
                    .first()
                    .is_some_and(|row| row.contains_key(&binding.chronicle_output_column)),
                "{} emits {}",
                fixture.fixture_id,
                binding.chronicle_output_column,
            );
        }
        for setting_id in &fixture.method_setting_ids {
            for (slot, value) in &fixture.browser_contract_bindings {
                assert!(
                    receipt["bindings"].as_array().is_some_and(|bindings| {
                        bindings.iter().any(|binding| {
                            binding["settingId"] == *setting_id
                                && binding["slot"] == *slot
                                && binding["value"] == *value
                                && binding["conformanceFixtureId"] == fixture.fixture_id
                                && binding["conformanceResultDigest"] == fixture.result_digest
                        })
                    }),
                    "{} receipt retains {setting_id} -> {slot}",
                    fixture.fixture_id,
                );
            }
        }
        assert_semantics(
            &fixture.fixture_id,
            &app,
            &screen,
            &interval_expansion,
            &daily_aggregate,
            &top_apps_aggregate,
            &credited_app,
        );
        if fixture.fixture_id == "reconstruction.each-app-opening-event.v1" {
            assert_eq!(
                manifest
                    .processing_summary
                    .opener_set_receipt
                    .selected_opener_type_counts
                    .get("Activity Resumed"),
                Some(&3),
            );
            assert_eq!(
                manifest
                    .processing_summary
                    .opener_set_receipt
                    .materialized_opener_type_counts
                    .get("Activity Resumed"),
                Some(&3),
            );
        }
        if fixture.fixture_id == "extension.exclude-participant-screen-interval-strict-gt-10h.v1" {
            let foundational: Value = serde_json::from_slice(
                &take_artifact(&mut handle, "foundational-semantics-receipt-json").expect("foundational census")
            ).expect("foundational receipt JSON");
            assert_eq!(foundational["microUse"]["checkpoint"], "episode_materialized_pre_concurrency");
            assert_eq!(foundational["microUse"]["classCounts"]["not_classifiable"], 3);
            assert_eq!(foundational["minimumDuration"]["boundedEpisodeCount"], 3);
            assert_eq!(foundational["minimumDuration"]["retainedCreditedCount"], 3);
            for (kind, bytes) in [
                ("participant amount", participant_amount.as_slice()),
                ("notification contact", notification_contact.as_slice()),
                ("visualization", visualization.as_slice()),
            ] {
                assert!(
                    !String::from_utf8_lossy(bytes).contains("P02"),
                    "excluded participant leaked into {kind}",
                );
            }
            assert_eq!(
                values(&rows(&notification_contact), "participant_id"),
                ["P01"]
            );
            let retained = rows(&participant_amount)
                .iter()
                .filter_map(|row| row.get("participant_id").cloned())
                .collect::<BTreeSet<_>>();
            assert_eq!(retained, BTreeSet::from(["P01".into(), "P03".into()]));
        }

        if let Some(baseline_request) = baseline_request {
            scientific_preflight_native(&baseline_request, &raw, &RuntimeSupportFiles::default())
                .expect("disabled interval expansion preflight");
            let mut baseline =
                execute_workspace_native(&baseline_request, &raw, &RuntimeSupportFiles::default())
                    .expect("disabled interval expansion execution");
            let baseline_app = take_artifact(&mut baseline, "app-csv").expect("baseline app CSV");
            assert_eq!(app, baseline_app, "headline App CSV must be byte-identical");
            assert!(
                take_artifact(&mut baseline, "interval-expansion-csv").is_none(),
                "disabled expansion must not emit a secondary artifact"
            );
        }
        if let Some(disabled_label_request) = disabled_label_request {
            let mut absent = execute_workspace_native(
                &disabled_label_request,
                &raw,
                &RuntimeSupportFiles::default(),
            )
            .expect("absent exact-label option execution");
            let absent_app =
                take_artifact(&mut absent, "app-csv").expect("absent exact-label option app CSV");
            let mut explicit_default: Value =
                serde_json::from_str(&disabled_label_request).expect("baseline request");
            explicit_default["requestId"] =
                "literature-conformance:application-label-exclusion:explicit-default".into();
            explicit_default["options"]["application_label_exclusions"] = json!([]);
            explicit_default["options"]["filter_match_field"] = "app_package_name".into();
            let mut explicit_default = execute_workspace_native(
                &explicit_default.to_string(),
                &raw,
                &RuntimeSupportFiles::default(),
            )
            .expect("explicit empty exact-label option execution");
            let explicit_default_app = take_artifact(&mut explicit_default, "app-csv")
                .expect("explicit empty exact-label option app CSV");
            assert_eq!(
                absent_app, explicit_default_app,
                "absent and explicit-empty exact-label options must leave baseline output byte-identical",
            );
        }

        let mut result = json!({
            "fixture_id": fixture.fixture_id,
            "app_csv_sha256": sha256(&app),
            "screen_csv_sha256": sha256(&screen),
            "counts": manifest.counts,
            "foundational_semantics_artifact_digest": manifest.scientific_evidence.foundational_semantics_artifact_digest,
            "b05_screen_construction_artifact_digest": manifest.scientific_evidence.b05_screen_construction_artifact_digest,
            "maximum_duration_receipt": manifest.processing_summary.maximum_duration_receipt
        });
        if fixture.fixture_id == "extension.behapp-half-open-1s.v1" {
            result["interval_expansion_csv_sha256"] = sha256(&interval_expansion).into();
        }
        if fixture.fixture_id == "extension.application-label-exclusion.v1"
            || fixture.fixture_id.starts_with("aggregate.daily-")
        {
            result["daily_aggregate_csv_sha256"] = sha256(&daily_aggregate).into();
        }
        if fixture.fixture_id == "extension.daily-top-apps-top5.v1" {
            result["top_apps_aggregate_csv_sha256"] = sha256(&top_apps_aggregate).into();
        }
        if fixture.fixture_id == "extension.strict-visual-screen-gate.v1" {
            result["credited_app_csv_sha256"] = sha256(&credited_app).into();
        }
        if fixture.fixture_id == "extension.exclude-participant-screen-interval-strict-gt-10h.v1" {
            result["participant_amount_csv_sha256"] = sha256(&participant_amount).into();
            result["notification_contact_csv_sha256"] = sha256(&notification_contact).into();
            result["visualization_data_json_sha256"] = sha256(&visualization).into();
        }
        if fixture.fixture_id == "reconstruction.each-app-opening-event.v1" {
            result["opener_set_receipt"] =
                serde_json::to_value(&manifest.processing_summary.opener_set_receipt)
                    .expect("opener-set receipt JSON");
        }
        let actual_digest = sha256(&serde_jcs::to_vec(&result).expect("canonical result"));
        if engines.len() == 2 {
            if engine.is_some() {
                assert_eq!(result, paired_results[&fixture.fixture_id], "scientific artifacts and census must agree across schedulers");
            } else {
                paired_results.insert(fixture.fixture_id.clone(), result.clone());
            }
        }
        if actual_digest != fixture.result_digest {
            if !screen.is_empty() {
                let mut prior_layout_only = result.clone();
                prior_layout_only["screen_csv_sha256"] =
                    sha256(&prior_blank_classification_layout(&screen)).into();
                let prior_digest =
                    sha256(&serde_jcs::to_vec(&prior_layout_only).expect("prior-layout result"));
                println!(
                    "blank-classification-only reconstruction: {} prior={} expected={} exact={}",
                    fixture.fixture_id,
                    prior_digest,
                    fixture.result_digest,
                    prior_digest == fixture.result_digest
                );
            }
            digest_mismatches.push((
                fixture.fixture_id.clone(),
                fixture.result_digest.clone(),
                actual_digest,
                serde_jcs::to_string(&result).expect("canonical result"),
            ));
        }
        }
    }
    assert!(
        digest_mismatches.is_empty(),
        "literature conformance result digest mismatches: {digest_mismatches:#?}"
    );
}
