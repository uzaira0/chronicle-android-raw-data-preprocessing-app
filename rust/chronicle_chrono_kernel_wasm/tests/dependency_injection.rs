#![cfg(feature = "incremental-v2")]

use chronicle_chrono_kernel_wasm::payload_store::{current_store, MemorySpillBackend, PayloadStore};
use chronicle_chrono_kernel_wasm::pipeline_v2::{
    run_pipeline_v2_with_supports_and_dependencies, IncrementalPipelineV2Engine,
    PipelineV2Options, PipelineV2OptionsJson, PipelineV2Result, PipelineV2SupportFiles,
    Row, ScreenClassificationSettings, ScreenSessionClose, ScreenSessionClassificationPolicy,
    StageFunctions, UsageSessionMode,
};
use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, atomic::{AtomicUsize, Ordering}};

const RAW: &[u8] = concat!(
    "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
    "Study,P01,Target Child,,Screen Interactive,android,2026-03-07 10:00:00,UTC\n",
    "Study,P01,Target Child,,Keyguard Hidden,android,2026-03-07 10:00:01,UTC\n",
    "Study,P01,Target Child,App A,Activity Resumed,app.a,2026-03-07 10:00:02,UTC\n",
    "Study,P01,Target Child,App A,Activity Paused,app.a,2026-03-07 10:00:30,UTC\n",
    "Study,P01,Target Child,,Keyguard Shown,android,2026-03-07 10:01:00,UTC\n",
    "Study,P01,Target Child,,Screen Non-Interactive,android,2026-03-07 10:01:01,UTC\n",
).as_bytes();

fn options() -> PipelineV2Options {
    serde_json::from_value::<PipelineV2OptionsJson>(serde_json::json!({
        "study_name": "Dependency injection",
        "timezone": "America/Chicago",
        "timezone_handling": "selected-convert",
        "usage_session_mode": "app_and_screen_usage",
        "include_app_output": true,
        "include_screen_output": true,
        "use_filter_file": false,
        "use_apps_forcing_screen_open": false,
        "use_app_codebook": false,
        "correct_duplicate_event_timestamps": true,
        "allow_stop_event_reuse": false,
        "use_activity_stopped_as_fallback": true,
        "apply_threshold_to_fallback": true,
        "long_duration_threshold_ns": 43_200_000_000_000_i64,
        "custom_app_engagement_duration": 300.0,
        "long_data_time_gap_thresholds": [1.0],
        "long_usage_duration_thresholds": [1.0],
        "interaction_types_to_remove": [],
        "screen_auto_lock_timeout_seconds": 120.0,
        "screen_auto_lock_tolerance_seconds": 30.0,
        "screen_manual_lock_max_tail_seconds": 30.0,
        "screen_keyguard_near_stop_seconds": 2.0,
        "same_app_stop_types": ["Activity Paused", "Activity Resumed"],
        "other_stop_types": ["Activity Resumed", "Device Shutdown"],
        "datetime_of_preprocessing": "2026-07-23 00:00:00 UTC",
        "enable_aggregates": true,
        "enable_participant_amount_summary": true,
        "materialize_visualization_data": true
    })).unwrap().into_pipeline_options()
}

fn store() -> PayloadStore {
    PayloadStore::new(0, Arc::new(MemorySpillBackend::default()))
}

fn accounting(store: &PayloadStore) -> (u64, u64, u64, u64, u64, u64) {
    let stats = store.stats();
    (stats.resident_bytes, store.stats_by_type().iter().map(|entry| entry.resident_bytes).sum(),
        stats.spilled_count, stats.reload_count, stats.dedupe_count, stats.failure_count)
}

fn bytes(result: &PipelineV2Result) -> Vec<u8> {
    // Includes all artifacts, aggregate bytes, lineage, metadata and checkpoints.
    serde_json::to_vec(result).unwrap()
}

#[test]
fn actual_android_screen_off_closes_at_the_observed_endpoint() {
    let raw = concat!(
        "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
        "Study,P01,Target Child,,Screen Interactive,android,2026-03-07 10:00:00,UTC\n",
        "Study,P01,Target Child,,Screen Non-interactive,android,2026-03-07 10:01:00,UTC\n",
    ).as_bytes();
    let mut screen_options = options();
    screen_options.usage_session_mode = UsageSessionMode::ScreenUsage;
    screen_options.include_app_output = false;
    let result = run_pipeline_v2_with_supports_and_dependencies(
        StageFunctions::production(), store(), raw, &screen_options, PipelineV2SupportFiles::default(),
    ).unwrap();
    let mut reader = csv::Reader::from_reader(result.screen_csv_bytes.reader());
    let headers = reader.headers().unwrap().clone();
    let records = reader.records().collect::<Result<Vec<_>, _>>().unwrap();
    assert_eq!(records.len(), 1);
    let value = |name: &str| records[0].get(headers.iter().position(|h| h == name).unwrap()).unwrap();
    assert_eq!(value("stop_timestamp"), "2026-03-07 04:01:00.000000-06:00");
    assert_eq!(value("duration_seconds"), "60.0");
    assert_eq!(value("screen_usage_stop_event_type"), "Screen Non-Interactive");
}

#[test]
fn no_app_classification_preserves_interval_evidence_without_filling_foreground_identity() {
    for (events, expected_classification, expected_foreground, expected_lock_only) in [
        (concat!(
            "Study,P01,Target Child,App A,Activity Resumed,app.a,2026-03-07 10:00:01,UTC\n",
            "Study,P01,Target Child,,Activity Resumed,,2026-03-07 10:00:02,UTC\n",
        ), "app", "", "false"),
        ("Study,P01,Target Child,,Activity Resumed,,2026-03-07 10:00:02,UTC\n", "", "", "false"),
        ("", "null", "", "true"),
        ("Study,P01,Target Child,App A,Activity Resumed,app.a,2026-03-07 10:00:01,UTC\n", "app", "app.a", "false"),
    ] {
        let raw = format!(concat!(
            "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
            "Study,P01,Target Child,,Screen Interactive,android,2026-03-07 10:00:00,UTC\n",
            "Study,P01,Target Child,,Keyguard Shown,android,2026-03-07 10:00:00.500,UTC\n",
            "{}",
            "Study,P01,Target Child,,Screen Non-interactive,android,2026-03-07 10:00:20,UTC\n",
        ), events);
        let mut screen_options = options();
        screen_options.usage_session_mode = UsageSessionMode::ScreenUsage;
        screen_options.include_app_output = false;
        screen_options.screen_session_classification_policy =
            ScreenSessionClassificationPolicy::NullNoAppStrictGt15sVsApp;
        let sequential = run_pipeline_v2_with_supports_and_dependencies(
            StageFunctions::production(), store(), raw.as_bytes(), &screen_options,
            PipelineV2SupportFiles::default(),
        ).unwrap();
        let mut reader = csv::Reader::from_reader(sequential.screen_csv_bytes.reader());
        let headers = reader.headers().unwrap().clone();
        let records = reader.records().collect::<Result<Vec<_>, _>>().unwrap();
        assert_eq!(records.len(), 1);
        let value = |name: &str| records[0].get(headers.iter().position(|h| h == name).unwrap()).unwrap();
        assert_eq!(value("screen_usage_session_classification"), expected_classification, "{events}");
        assert_eq!(value("screen_usage_foreground_app_package"), expected_foreground);
        assert_eq!(value("screen_usage_lock_screen_only"), expected_lock_only);
        let mut engine = IncrementalPipelineV2Engine::with_dependencies(StageFunctions::production(), store());
        let incremental = engine.execute(raw.as_bytes(), &screen_options, PipelineV2SupportFiles::default()).unwrap();
        assert_eq!(bytes(&sequential), bytes(&incremental.result));
    }
}

#[test]
fn two_store_isolation_for_sequential_runs_and_salsa_engines() {
    let options = options();
    let ambient = current_store();
    let untouched = accounting(&ambient);
    let a = store();
    let b = store();
    let sequential_a = run_pipeline_v2_with_supports_and_dependencies(
        StageFunctions::production(), a.clone(), RAW, &options, PipelineV2SupportFiles::default(),
    ).unwrap();
    let a_before = accounting(&a);
    assert!(a_before.0 > 0 && a_before.1 > 0);
    assert_eq!(accounting(&b), (0, 0, 0, 0, 0, 0));
    let sequential_b = run_pipeline_v2_with_supports_and_dependencies(
        StageFunctions::production(), b.clone(), RAW, &options, PipelineV2SupportFiles::default(),
    ).unwrap();
    assert_eq!(accounting(&a), a_before);
    assert!(accounting(&b).0 > 0 && accounting(&b).1 > 0);
    assert_eq!(bytes(&sequential_a), bytes(&sequential_b));
    assert_eq!(accounting(&ambient), untouched);

    let a = store();
    let b = store();
    let mut engine_a = IncrementalPipelineV2Engine::with_dependencies(StageFunctions::production(), a.clone());
    let mut engine_b = IncrementalPipelineV2Engine::with_dependencies(StageFunctions::production(), b.clone());
    let result_a = engine_a.execute(RAW, &options, PipelineV2SupportFiles::default()).unwrap();
    let a_before = accounting(&a);
    assert!(a_before.0 > 0 && a_before.1 > 0);
    assert_eq!(accounting(&b), (0, 0, 0, 0, 0, 0));
    let result_b = engine_b.execute(RAW, &options, PipelineV2SupportFiles::default()).unwrap();
    assert_eq!(accounting(&a), a_before);
    assert!(accounting(&b).0 > 0 && accounting(&b).1 > 0);
    assert_eq!(bytes(&result_a.result), bytes(&result_b.result));
    let b_before = accounting(&b);
    let warm = engine_a.execute(RAW, &options, PipelineV2SupportFiles::default()).unwrap();
    assert!(warm.executed_queries.is_empty());
    assert_eq!(bytes(&warm.result), bytes(&result_a.result));
    assert_eq!(accounting(&b), b_before);
    assert_eq!(accounting(&ambient), untouched);
}

static SCREEN_CALLS: AtomicUsize = AtomicUsize::new(0);

fn counted_screen(rows: &[Row], closes: &[ScreenSessionClose], keyguard: &BTreeMap<String, Vec<i64>>,
    forcing: &HashMap<String, String>, settings: ScreenClassificationSettings) -> Vec<Row> {
    SCREEN_CALLS.fetch_add(1, Ordering::SeqCst);
    (StageFunctions::production().classify_screen_sessions)(rows, closes, keyguard, forcing, settings)
}

#[test]
fn substituted_screen_stage_is_used_by_sequential_and_salsa() {
    let options = options();
    let production = run_pipeline_v2_with_supports_and_dependencies(
        StageFunctions::production(), store(), RAW, &options, PipelineV2SupportFiles::default(),
    ).unwrap();
    assert!(production.screen_row_count > 0);
    let stages = StageFunctions { classify_screen_sessions: counted_screen, ..StageFunctions::production() };
    SCREEN_CALLS.store(0, Ordering::SeqCst);
    let sequential = run_pipeline_v2_with_supports_and_dependencies(
        stages, store(), RAW, &options, PipelineV2SupportFiles::default(),
    ).unwrap();
    assert_eq!(SCREEN_CALLS.load(Ordering::SeqCst), 1);
    assert_eq!(bytes(&production), bytes(&sequential));
    let mut engine = IncrementalPipelineV2Engine::with_stage_functions(stages);
    let incremental = engine.execute(RAW, &options, PipelineV2SupportFiles::default()).unwrap();
    assert_eq!(SCREEN_CALLS.load(Ordering::SeqCst), 2);
    assert_eq!(bytes(&production), bytes(&incremental.result));
    let warm = engine.execute(RAW, &options, PipelineV2SupportFiles::default()).unwrap();
    assert_eq!(SCREEN_CALLS.load(Ordering::SeqCst), 2);
    assert!(warm.executed_queries.is_empty());
    assert_eq!(bytes(&production), bytes(&warm.result));
}

#[test]
fn fixed_time_sequential_and_incremental_outputs_are_byte_identical() {
    let options = options();
    assert_eq!(options.datetime_of_preprocessing, "2026-07-23 00:00:00 UTC");
    let sequential = run_pipeline_v2_with_supports_and_dependencies(
        StageFunctions::production(), store(), RAW, &options, PipelineV2SupportFiles::default(),
    ).unwrap();
    let mut engine = IncrementalPipelineV2Engine::with_dependencies(StageFunctions::production(), store());
    let incremental = engine.execute(RAW, &options, PipelineV2SupportFiles::default()).unwrap();
    assert!(sequential.app_row_count > 0);
    assert!(sequential.screen_row_count > 0);
    assert_eq!(bytes(&sequential), bytes(&incremental.result));
}
