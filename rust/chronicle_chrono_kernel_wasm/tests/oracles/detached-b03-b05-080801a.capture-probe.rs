#![recursion_limit = "256"]

use chronicle_chrono_kernel_wasm::pipeline_v2::{
    run_pipeline_v2_with_supports, PipelineV2OptionsJson, PipelineV2Result, PipelineV2SupportFiles,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const BASELINE_COMMIT: &str = "080801a0232a6a2c97daba0c986094f6cf48fe08";
const HEADER: &str =
    "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n";
const HISTORICAL_STRATEGIES: [&str; 7] = [
    "fused_matcher",
    "parry_toth_forward_pairing",
    "eyes_complement",
    "gesis_start_stop_repair",
    "foreground_background_pairing",
    "draxler_interruption_aware",
    "morrison_lock_tolerant",
];
const HISTORICAL_OPENERS: [&str; 3] = [
    "strategy_defined",
    "activity_resumed_only",
    "gesis_app_scoped_starts",
];

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn commitment(bytes: &[u8]) -> Value {
    json!({
        "len": bytes.len(),
        "sha256": sha256(bytes),
    })
}

fn aggregate_manifest(result: &PipelineV2Result) -> Vec<u8> {
    result
        .aggregate_csv_outputs
        .iter()
        .map(|output| {
            format!(
                "{}|{}|{}|sha256:{}\n",
                output.kind,
                output.row_count,
                output.bytes.len(),
                hex::encode(Sha256::digest(&output.bytes)),
            )
        })
        .collect::<String>()
        .into_bytes()
}

fn member_commitments(
    result: &PipelineV2Result,
    primary_name: &str,
    primary_bytes: &[u8],
) -> Vec<Value> {
    let aggregates = aggregate_manifest(result);
    let lineage = serde_json::to_vec(&*result.row_lineage).expect("lineage serializes");
    [
        (primary_name, primary_bytes),
        ("review_json", result.review_summary_json_bytes.as_slice()),
        (
            "visualization_json",
            result.visualization_data_json_bytes.as_slice(),
        ),
        ("aggregate_manifest", aggregates.as_slice()),
        ("lineage_json", lineage.as_slice()),
    ]
    .into_iter()
    .map(|(name, bytes)| {
        json!({
            "name": name,
            "len": bytes.len(),
            "sha256": sha256(bytes),
        })
    })
    .collect()
}

fn options(request: &Value) -> chronicle_chrono_kernel_wasm::pipeline_v2::PipelineV2Options {
    serde_json::from_value::<PipelineV2OptionsJson>(request.clone())
        .expect("historical request parses")
        .into_pipeline_options()
}

fn app_fixture(strategy: &str) -> (&'static str, Vec<u8>) {
    let (fixture_id, rows) = match strategy {
        "fused_matcher" | "parry_toth_forward_pairing" | "morrison_lock_tolerant" => (
            "app-handover",
            concat!(
                "Study,P01,Target Child,Service,Foreground Service Start,com.example.service,2026-03-07 10:00:00,America/Chicago\n",
                "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:10,America/Chicago\n",
                "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:00:20,America/Chicago\n",
            ),
        ),
        "foreground_background_pairing" | "draxler_interruption_aware" => (
            "app-pause",
            concat!(
                "Study,P01,Target Child,Service,Foreground Service Start,com.example.service,2026-03-07 10:00:00,America/Chicago\n",
                "Study,P01,Target Child,Service,Activity Paused,com.example.service,2026-03-07 10:00:10,America/Chicago\n",
                "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:20,America/Chicago\n",
                "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:00:30,America/Chicago\n",
            ),
        ),
        "gesis_start_stop_repair" => (
            "app-gesis",
            concat!(
                "Study,P01,Target Child,Service,Foreground Service Start,com.example.service,2026-03-07 10:00:00,America/Chicago\n",
                "Study,P01,Target Child,Service,Foreground Service Stop,com.example.service,2026-03-07 10:00:10,America/Chicago\n",
                "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:20,America/Chicago\n",
                "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:00:30,America/Chicago\n",
            ),
        ),
        "eyes_complement" => (
            "app-eyes",
            concat!(
                "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
                "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:00:10,America/Chicago\n",
            ),
        ),
        _ => panic!("unknown historical strategy {strategy}"),
    };
    (fixture_id, format!("{HEADER}{rows}").into_bytes())
}

fn b02_request(strategy: &str, opener: &str) -> Value {
    json!({
        "study_name": "B02 default compatibility",
        "timezone": "America/Chicago",
        "usage_session_mode": "app_usage",
        "include_app_output": true,
        "include_screen_output": false,
        "use_filter_file": false,
        "use_apps_forcing_screen_open": false,
        "use_app_codebook": false,
        "correct_duplicate_event_timestamps": false,
        "allow_stop_event_reuse": false,
        "use_activity_stopped_as_fallback": true,
        "apply_threshold_to_fallback": true,
        "long_duration_threshold_ns": 43_200_000_000_000_i64,
        "custom_app_engagement_duration": 300.0,
        "long_data_time_gap_thresholds": [1.0],
        "long_usage_duration_thresholds": [1.0],
        "same_app_stop_types": ["Activity Paused", "Activity Resumed"],
        "other_stop_types": ["Activity Resumed", "Device Shutdown"],
        "interaction_types_to_remove": [],
        "screen_auto_lock_timeout_seconds": 120.0,
        "screen_auto_lock_tolerance_seconds": 30.0,
        "screen_manual_lock_max_tail_seconds": 30.0,
        "screen_keyguard_near_stop_seconds": 2.0,
        "datetime_of_preprocessing": "2026-07-23 00:00:00 UTC",
        "materialize_visualization_data": true,
        "enable_aggregates": true,
        "minimum_usage_duration": 0.0,
        "episode_reconstruction_strategy": strategy,
        "opener_set": opener,
    })
}

fn historical_default_request(mode: &str, include_app: bool, include_screen: bool) -> Value {
    json!({
        "study_name": "Shadow Study",
        "timezone": "UTC",
        "timezone_handling": "selected-convert",
        "usage_session_mode": mode,
        "include_app_output": include_app,
        "include_screen_output": include_screen,
        "use_filter_file": false,
        "use_apps_forcing_screen_open": false,
        "use_background_apps_file": false,
        "use_app_codebook": false,
        "include_category_column": false,
        "include_app_usage_end_reason": false,
        "deduplicate_exact_rows": true,
        "interaction_type_remap": [],
        "correct_duplicate_event_timestamps": false,
        "allow_stop_event_reuse": false,
        "use_activity_stopped_as_fallback": true,
        "apply_threshold_to_fallback": true,
        "long_duration_threshold_ns": 43_200_000_000_000_i64,
        "proximity_interval_ns": 0,
        "custom_app_engagement_duration": 300.0,
        "long_data_time_gap_thresholds": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0],
        "long_usage_duration_thresholds": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0],
        "same_app_stop_types": ["Activity Paused", "Activity Resumed"],
        "other_stop_types": ["Activity Resumed", "Device Shutdown"],
        "interaction_types_to_remove": [],
        "screen_auto_lock_timeout_seconds": 120.0,
        "screen_auto_lock_tolerance_seconds": 30.0,
        "screen_manual_lock_max_tail_seconds": 30.0,
        "screen_keyguard_near_stop_seconds": 2.0,
        "datetime_of_preprocessing": "2026-07-21 12:00:00 UTC",
        "model_concurrent_usage": false,
        "minimum_usage_duration": 60.0,
        "apply_minimum_usage_duration_to_concurrent_subintervals": false,
        "filter_zero_duration_sessions": false,
        "add_no_activity_placeholder_days": false,
        "enable_study_window_filter": false,
        "enable_person_attribution": false,
        "enable_day_coverage": false,
        "enable_compliance_scoring": false,
        "compliance_threshold_percent": 70.0,
        "enable_screen_gated_crediting": false,
        "enable_parquet_export": false,
        "enable_spss_export": false,
        "enable_aggregates": true,
        "aggregate_shape": "wide",
        "enable_plotting": true,
        "enable_activity_heatmap": false,
        "export_plots_as_svg": false,
        "enable_interactive_timeline": false,
        "include_filtered_app_usage_in_plots": false,
        "materialize_visualization_data": true,
        "credited_session_cap_minutes": 360.0,
        "device_liveness_gap_tolerance_minutes": 120.0,
        "auto_lock_bridge_seconds": 120.0,
        "no_witness_min_day_apps": 2,
        "opener_set": "strategy_defined",
        "episode_reconstruction_strategy": "fused_matcher",
        "interval_quality_policy": "none",
        "session_grouping_policy": "none",
        "event_retention_set": "none",
    })
}

fn b04_fixture() -> Vec<u8> {
    concat!(
        "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
        "Study,P01,Child,Under,Activity Resumed,com.example.under,2026-03-07 10:00:00.000000000,UTC\n",
        "Study,P01,Child,Under,Activity Paused,com.example.under,2026-03-07 10:00:59.999999999,UTC\n",
        "Study,P01,Child,Equal,Activity Resumed,com.example.equal,2026-03-07 10:02:00.000000000,UTC\n",
        "Study,P01,Child,Equal,Activity Paused,com.example.equal,2026-03-07 10:03:00.000000000,UTC\n",
        "Study,P01,Child,Over,Activity Resumed,com.example.over,2026-03-07 10:04:00.000000000,UTC\n",
        "Study,P01,Child,Over,Activity Paused,com.example.over,2026-03-07 10:05:00.000000001,UTC\n",
    )
    .as_bytes()
    .to_vec()
}

fn screen_fixture() -> Vec<u8> {
    concat!(
        "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
        "Study,P01,Target Child,,Screen Non-Interactive,android,2026-03-07 10:00:00,UTC\n",
        "Study,P01,Target Child,,Screen Interactive,android,2026-03-07 10:01:00,UTC\n",
        "Study,P01,Target Child,,Screen Interactive,android,2026-03-07 10:01:01,UTC\n",
        "Study,P01,Target Child,,Screen Non-Interactive,android,2026-03-07 10:01:10,UTC\n",
        "Study,P01,Target Child,,Screen Interactive,android,2026-03-07 10:02:00,UTC\n",
        "Study,P01,Target Child,,User Interaction,android,2026-03-07 10:02:05,UTC\n",
        "Study,P01,Target Child,,Screen Non-Interactive,android,2026-03-07 10:02:10,UTC\n",
        "Study,P01,Target Child,,Screen Interactive,android,2026-03-07 10:03:00,UTC\n",
        "Study,P01,Target Child,,Device Shutdown,android,2026-03-07 10:03:05,UTC\n",
        "Study,P01,Target Child,,Device Startup,android,2026-03-07 10:03:20,UTC\n",
        "Study,P01,Target Child,,Screen Non-Interactive,android,2026-03-07 10:03:30,UTC\n",
        "Study,P01,Target Child,,Screen Interactive,android,2026-03-07 10:04:00,UTC\n",
    )
    .as_bytes()
    .to_vec()
}

fn emit_success(
    case_id: &str,
    profile: &str,
    fixture_id: &str,
    fixture: &[u8],
    request: &Value,
    primary_name: &str,
    result: &PipelineV2Result,
) {
    let primary = match primary_name {
        "app_csv" => result.app_csv_bytes.as_slice(),
        "screen_csv" => result.screen_csv_bytes.as_slice(),
        _ => panic!("unknown primary member {primary_name}"),
    };
    let request_bytes = serde_json::to_vec(request).expect("request serializes");
    let record = json!({
        "baselineCommit": BASELINE_COMMIT,
        "captureProbeSha256": std::env::var("CAPTURE_PROBE_SHA256")
            .expect("CAPTURE_PROBE_SHA256 is set"),
        "caseId": case_id,
        "profile": profile,
        "fixture": fixture_id,
        "fixtureCommitment": commitment(fixture),
        "requestCommitment": commitment(&request_bytes),
        "expect": {
            "status": "success",
            "members": member_commitments(result, primary_name, primary),
        },
    });
    println!(
        "CHRONICLE_DETACHED_ORACLE\t{}",
        serde_json::to_string(&record).expect("record serializes")
    );
}

fn emit_refusal(
    case_id: &str,
    profile: &str,
    fixture_id: &str,
    fixture: &[u8],
    request: &Value,
    error: &str,
) {
    let request_bytes = serde_json::to_vec(request).expect("request serializes");
    let record = json!({
        "baselineCommit": BASELINE_COMMIT,
        "captureProbeSha256": std::env::var("CAPTURE_PROBE_SHA256")
            .expect("CAPTURE_PROBE_SHA256 is set"),
        "caseId": case_id,
        "profile": profile,
        "fixture": fixture_id,
        "fixtureCommitment": commitment(fixture),
        "requestCommitment": commitment(&request_bytes),
        "expect": {
            "status": "refused",
            "error": error,
        },
    });
    println!(
        "CHRONICLE_DETACHED_ORACLE\t{}",
        serde_json::to_string(&record).expect("record serializes")
    );
}

#[test]
fn capture_detached_b03_b05_oracle() {
    let support = PipelineV2SupportFiles::default();
    let mut success_count = 0_u32;
    let mut refusal_count = 0_u32;
    for strategy in HISTORICAL_STRATEGIES {
        let (fixture_id, fixture) = app_fixture(strategy);
        for opener in HISTORICAL_OPENERS {
            let request = b02_request(strategy, opener);
            let case_id = format!("app/{strategy}/{opener}");
            match run_pipeline_v2_with_supports(&fixture, &options(&request), support) {
                Ok(result) => {
                    success_count += 1;
                    assert!(result.app_row_count > 0, "{case_id} must be non-vacuous");
                    assert_eq!(result.aggregate_csv_outputs.len(), 3, "{case_id}");
                    emit_success(
                        &case_id,
                        "b02-matrix-min0",
                        fixture_id,
                        &fixture,
                        &request,
                        "app_csv",
                        &result,
                    );
                }
                Err(error) => {
                    refusal_count += 1;
                    assert_eq!(
                        error,
                        "opener_set_refused:gesis_app_scoped_starts:eyes_complement:eyes_requires_lifecycle_triplets",
                        "only the historical EYES wider-opener cell may refuse",
                    );
                    emit_refusal(
                        &case_id,
                        "b02-matrix-min0",
                        fixture_id,
                        &fixture,
                        &request,
                        &error,
                    );
                }
            }
        }
    }
    assert_eq!((success_count, refusal_count), (20, 1));

    let fixture = b04_fixture();
    let request = historical_default_request("app_usage", true, false);
    let result = run_pipeline_v2_with_supports(&fixture, &options(&request), support)
        .expect("historical B04 boundary run");
    assert_eq!(result.app_row_count, 3);
    assert_eq!(result.aggregate_csv_outputs.len(), 3);
    emit_success(
        "app/b04-boundary",
        "b04-default-min60",
        "b04-boundary",
        &fixture,
        &request,
        "app_csv",
        &result,
    );

    let fixture = screen_fixture();
    let request = historical_default_request("screen_usage", false, true);
    let result = run_pipeline_v2_with_supports(&fixture, &options(&request), support)
        .expect("historical Chronicle screen run");
    assert_eq!(result.screen_row_count, 4);
    assert_eq!(result.aggregate_csv_outputs.len(), 3);
    emit_success(
        "screen/chronicle-default",
        "b05-default-min60",
        "screen-chronicle",
        &fixture,
        &request,
        "screen_csv",
        &result,
    );
}
