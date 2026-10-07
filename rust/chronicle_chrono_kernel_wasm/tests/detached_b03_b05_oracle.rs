#![recursion_limit = "256"]

use chronicle_chrono_kernel_wasm::pipeline_v2::{
    run_pipeline_v2_with_supports, EpisodeReconstructionStrategy, OpenerSet, PipelineV2Options,
    PipelineV2OptionsJson, PipelineV2Result, PipelineV2SupportFiles,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

const INVENTORY_JSON: &str = include_str!("oracles/detached-b03-b05-080801a.json");
const CAPTURE_PROBE_SOURCE: &[u8] =
    include_bytes!("oracles/detached-b03-b05-080801a.capture-probe.rs");
const CAPTURE_JSONL: &[u8] = include_bytes!("oracles/detached-b03-b05-080801a.capture.jsonl");
const CAPTURE_PROCEDURE: &[u8] = include_bytes!("oracles/recapture-detached-b03-b05-080801a.sh");
const BASELINE_COMMIT: &str = "080801a0232a6a2c97daba0c986094f6cf48fe08";
const BASELINE_PARENT: &str = "e02ab1e710edffb4c48019e7aaf9bf6af6e54e2b";
const BASELINE_TREE: &str = "git-sha1:ef7b3fc573be0913e984309c90ac92899d876ae0";
const CAPTURE_PROBE_SHA256: &str =
    "sha256:9dc2e7b4d94bb2433b8f59f784443faa525e4b2b676e5039107889406d13b514";
const CAPTURE_JSONL_SHA256: &str =
    "sha256:91769aa3dbfddc01881b62805118b30504e7e0231daa6c95a19c2cad8ed20ec8";
const CAPTURE_PROCEDURE_SHA256: &str =
    "sha256:e8f4f88fafc58a130a007eb575dfa3d82bcd3372ac3274cea17ad0c883a388e0";
const CAPTURE_PREFIX: &str = "CHRONICLE_DETACHED_ORACLE\t";
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
const AGGREGATE_KINDS: [&str; 3] = [
    "aggregate-daily-summary-csv",
    "aggregate-weekly-summary-csv",
    "aggregate-top-apps-csv",
];
const APP_MEMBER_NAMES: [&str; 5] = [
    "app_csv",
    "review_json",
    "visualization_json",
    "aggregate_manifest",
    "lineage_json",
];
const SCREEN_MEMBER_NAMES: [&str; 5] = [
    "screen_csv",
    "review_json",
    "visualization_json",
    "aggregate_manifest",
    "lineage_json",
];
const HISTORICAL_REFUSAL: &str =
    "opener_set_refused:gesis_app_scoped_starts:eyes_complement:eyes_requires_lifecycle_triplets";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OracleInventory {
    schema_version: String,
    source: OracleSource,
    fixtures: BTreeMap<String, ByteCommitment>,
    historical_domain: HistoricalDomain,
    cases: Vec<OracleCase>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OracleSource {
    commit: String,
    parent: String,
    tree: String,
    capture_probe_sha256: String,
    capture_jsonl_sha256: String,
    capture_procedure_sha256: String,
    blobs: OracleBlobs,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OracleBlobs {
    pipeline_v2: String,
    pipeline_v2_incremental: String,
    pipeline_v2_aggregates: String,
    manifest: String,
    lockfile: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HistoricalDomain {
    strategies: Vec<String>,
    openers: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct ByteCommitment {
    len: usize,
    sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct MemberCommitment {
    name: String,
    len: usize,
    sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct OracleCase {
    id: String,
    profile: String,
    fixture: String,
    request: ByteCommitment,
    expect: ExpectedOutcome,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum ExpectedOutcome {
    Success { members: Vec<MemberCommitment> },
    Refused { error: String },
}

#[derive(Clone, Copy)]
enum PrimaryMember {
    App,
    Screen,
}

impl PrimaryMember {
    fn name(self) -> &'static str {
        match self {
            Self::App => "app_csv",
            Self::Screen => "screen_csv",
        }
    }
}

fn inventory() -> OracleInventory {
    serde_json::from_str(INVENTORY_JSON).expect("the frozen detached oracle inventory parses")
}

fn canonical_capture_from_inventory() -> Vec<u8> {
    let inventory: Value =
        serde_json::from_str(INVENTORY_JSON).expect("the frozen inventory parses as JSON");
    let source = inventory
        .get("source")
        .and_then(Value::as_object)
        .expect("the frozen inventory has a source object");
    let fixtures = inventory
        .get("fixtures")
        .and_then(Value::as_object)
        .expect("the frozen inventory has a fixture object");
    let cases = inventory
        .get("cases")
        .and_then(Value::as_array)
        .expect("the frozen inventory has a case array");

    let mut capture = Vec::new();
    for case in cases {
        let fixture_id = case
            .get("fixture")
            .and_then(Value::as_str)
            .expect("each frozen case names its fixture");
        let record = json!({
            "baselineCommit": source.get("commit").expect("source commit").clone(),
            "captureProbeSha256": source
                .get("captureProbeSha256")
                .expect("capture probe digest")
                .clone(),
            "caseId": case.get("id").expect("case id").clone(),
            "expect": case.get("expect").expect("case outcome").clone(),
            "fixture": fixture_id,
            "fixtureCommitment": fixtures
                .get(fixture_id)
                .expect("fixture commitment")
                .clone(),
            "profile": case.get("profile").expect("case profile").clone(),
            "requestCommitment": case
                .get("request")
                .expect("request commitment")
                .clone(),
        });
        capture.extend_from_slice(CAPTURE_PREFIX.as_bytes());
        serde_json::to_writer(&mut capture, &record).expect("capture record serializes");
        capture.push(b'\n');
    }
    capture
}

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn assert_sha256_format(value: &str, label: &str) {
    let digest = value
        .strip_prefix("sha256:")
        .unwrap_or_else(|| panic!("{label}: digest must use the sha256: carrier"));
    assert_eq!(digest.len(), 64, "{label}: SHA-256 must have 64 hex digits");
    assert!(
        digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)),
        "{label}: SHA-256 must be lowercase hexadecimal",
    );
}

fn assert_git_sha1_format(value: &str, label: &str) {
    let digest = value
        .strip_prefix("git-sha1:")
        .unwrap_or_else(|| panic!("{label}: Git object must use the git-sha1: carrier"));
    assert_eq!(
        digest.len(),
        40,
        "{label}: Git SHA-1 must have 40 hex digits"
    );
    assert!(
        digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)),
        "{label}: Git SHA-1 must be lowercase hexadecimal",
    );
}

fn assert_commitment(bytes: &[u8], expected: &ByteCommitment, label: &str) {
    assert_sha256_format(&expected.sha256, label);
    assert_eq!(bytes.len(), expected.len, "{label}: byte length drift");
    assert_eq!(sha256(bytes), expected.sha256, "{label}: byte digest drift");
}

fn assert_member_commitment(bytes: &[u8], expected: &MemberCommitment, label: &str) {
    assert_sha256_format(&expected.sha256, label);
    assert_eq!(bytes.len(), expected.len, "{label}: byte length drift");
    assert_eq!(sha256(bytes), expected.sha256, "{label}: byte digest drift");
}

fn oracle_case<'a>(inventory: &'a OracleInventory, id: &str) -> &'a OracleCase {
    inventory
        .cases
        .iter()
        .find(|case| case.id == id)
        .unwrap_or_else(|| panic!("missing detached oracle case {id}"))
}

fn fixture_commitment<'a>(inventory: &'a OracleInventory, fixture_id: &str) -> &'a ByteCommitment {
    inventory
        .fixtures
        .get(fixture_id)
        .unwrap_or_else(|| panic!("missing detached fixture commitment {fixture_id}"))
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
                hex::encode(Sha256::digest(output.bytes.to_vec())),
            )
        })
        .collect::<String>()
        .into_bytes()
}

fn scientific_members(
    result: &PipelineV2Result,
    primary: PrimaryMember,
) -> Vec<(&'static str, Vec<u8>)> {
    let primary_bytes = match primary {
        PrimaryMember::App => result.app_csv_bytes.to_vec(),
        PrimaryMember::Screen => result.screen_csv_bytes.to_vec(),
    };
    vec![
        (primary.name(), primary_bytes),
        ("review_json", result.review_summary_json_bytes.to_vec()),
        (
            "visualization_json",
            result.visualization_data_json_bytes.to_vec(),
        ),
        ("aggregate_manifest", aggregate_manifest(result)),
        (
            "lineage_json",
            serde_json::to_vec(&*result.row_lineage).expect("row lineage serializes"),
        ),
    ]
}

fn assert_aggregate_kind_closure(result: &PipelineV2Result, label: &str) {
    assert_eq!(
        result
            .aggregate_csv_outputs
            .iter()
            .map(|output| output.kind.as_str())
            .collect::<Vec<_>>(),
        AGGREGATE_KINDS,
        "{label}: aggregate member order or domain drift",
    );
}

fn assert_detached_members_first(
    result: &PipelineV2Result,
    case: &OracleCase,
    primary: PrimaryMember,
) -> Vec<(&'static str, Vec<u8>)> {
    let ExpectedOutcome::Success { members: expected } = &case.expect else {
        panic!("{}: success result has a refusal oracle", case.id);
    };
    let actual = scientific_members(result, primary);
    assert_eq!(
        actual.iter().map(|(name, _)| *name).collect::<Vec<_>>(),
        expected
            .iter()
            .map(|member| member.name.as_str())
            .collect::<Vec<_>>(),
        "{}: exact scientific member closure drift",
        case.id,
    );
    for ((name, bytes), commitment) in actual.iter().zip(expected) {
        assert_eq!(*name, commitment.name, "{}: member order drift", case.id);
        assert_member_commitment(bytes, commitment, &format!("{}:{name}", case.id));
    }
    actual
}

fn parse_options(request: &Value) -> PipelineV2Options {
    serde_json::from_value::<PipelineV2OptionsJson>(request.clone())
        .expect("the historical request parses through the current envelope")
        .into_pipeline_options()
}

fn assert_request_commitment(request: &Value, case: &OracleCase) {
    let request_bytes = serde_json::to_vec(request).expect("request serializes compactly");
    assert_commitment(
        &request_bytes,
        &case.request,
        &format!("{}:historical_request", case.id),
    );
}

fn with_explicit_foundational_defaults(mut request: Value) -> Value {
    let object = request
        .as_object_mut()
        .expect("the compatibility request is an object");
    object.insert("micro_use_classification_policy".into(), json!("none"));
    object.insert("minimum_duration_comparator".into(), json!("strict_lt"));
    object.insert(
        "minimum_duration_disposition".into(),
        json!("chronicle_blank_keep_row"),
    );
    object.insert(
        "screen_session_construction_strategy".into(),
        json!("chronicle_screen_interactive_v1"),
    );
    request
}

fn assert_historical_presence(options: &PipelineV2Options, threshold: f64) {
    assert!(!options.micro_use_classification_policy_explicit);
    assert!(
        options.minimum_usage_duration_explicit,
        "minimum_usage_duration predates B03-B05 and is deliberately explicit",
    );
    assert!(!options.minimum_duration_comparator_explicit);
    assert!(!options.minimum_duration_disposition_explicit);
    assert!(!options.screen_session_construction_strategy_explicit);
    assert_eq!(options.minimum_usage_duration, threshold);
}

fn assert_explicit_presence(options: &PipelineV2Options, threshold: f64) {
    assert!(options.micro_use_classification_policy_explicit);
    assert!(options.minimum_usage_duration_explicit);
    assert!(options.minimum_duration_comparator_explicit);
    assert!(options.minimum_duration_disposition_explicit);
    assert!(options.screen_session_construction_strategy_explicit);
    assert_eq!(options.minimum_usage_duration, threshold);
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

fn csv_rows(bytes: &[u8]) -> Vec<BTreeMap<String, String>> {
    let mut reader = csv::ReaderBuilder::new().from_reader(bytes);
    let headers = reader.headers().expect("CSV header parses").clone();
    reader
        .records()
        .map(|record| {
            let record = record.expect("CSV record parses");
            headers
                .iter()
                .zip(record.iter())
                .map(|(header, value)| (header.to_owned(), value.to_owned()))
                .collect()
        })
        .collect()
}

fn assert_b04_boundary_behavior(result: &PipelineV2Result) {
    let rows = csv_rows(&result.app_csv_bytes.to_vec());
    let row = |package: &str| {
        rows.iter()
            .find(|row| row["app_package_name"] == package)
            .unwrap_or_else(|| panic!("missing B04 boundary row for {package}"))
    };
    assert_eq!(row("com.example.under")["duration_seconds"], "");
    assert_eq!(row("com.example.under")["duration_minutes"], "");
    assert_eq!(row("com.example.equal")["duration_seconds"], "60.0");
    assert_eq!(row("com.example.equal")["duration_minutes"], "1.0");
    assert_eq!(row("com.example.over")["duration_seconds"], "60.000000001");
    assert_eq!(
        row("com.example.over")["duration_minutes"],
        "1.0000000000166667"
    );
}

fn assert_screen_fixture_behavior(result: &PipelineV2Result) {
    let rows = csv_rows(&result.screen_csv_bytes.to_vec());
    assert_eq!(rows.len(), 4);
    let observed = rows
        .iter()
        .map(|row| {
            (
                row["start_timestamp"].as_str(),
                row["stop_timestamp"].as_str(),
                row["screen_usage_end_reason"].as_str(),
                row["screen_usage_stop_event_type"].as_str(),
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        observed,
        vec![
            (
                "2026-03-07 10:01:00.000000+00:00",
                "2026-03-07 10:01:10.000000+00:00",
                "unknown",
                "Screen Non-Interactive",
            ),
            (
                "2026-03-07 10:02:00.000000+00:00",
                "2026-03-07 10:02:10.000000+00:00",
                "probable_manual_lock",
                "Screen Non-Interactive",
            ),
            (
                "2026-03-07 10:03:00.000000+00:00",
                "2026-03-07 10:03:30.000000+00:00",
                "unknown",
                "Screen Non-Interactive",
            ),
            ("2026-03-07 10:04:00.000000+00:00", "", "missing_stop", "",),
        ],
        "orphan, duplicate-start, valid-close, reboot-spanning, or right-edge semantics drifted",
    );
    assert_eq!(result.row_lineage.len(), 4);
    assert_eq!(
        result
            .row_lineage
            .iter()
            .map(|lineage| {
                lineage
                    .source_data_row_ranges
                    .iter()
                    .map(|range| (range.first, range.last))
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>(),
        vec![vec![(2, 4)], vec![(5, 7)], vec![(8, 11)], vec![(12, 12)],],
        "screen source-row membership drifted",
    );
}

#[test]
fn detached_capture_artifacts_and_transform_are_repository_closed() {
    let inventory = inventory();
    assert_eq!(
        sha256(CAPTURE_PROBE_SOURCE),
        inventory.source.capture_probe_sha256,
        "the committed probe bytes must be the exact reviewed detached probe",
    );
    assert_eq!(
        sha256(CAPTURE_JSONL),
        inventory.source.capture_jsonl_sha256,
        "the committed JSONL must be the exact two-run detached capture",
    );
    assert_eq!(
        sha256(CAPTURE_PROCEDURE),
        inventory.source.capture_procedure_sha256,
        "the locked/offline recapture procedure must remain frozen",
    );
    assert_eq!(
        canonical_capture_from_inventory().as_slice(),
        CAPTURE_JSONL,
        "the inventory transform must be a byte-exact, lossless projection of the canonical JSONL",
    );

    let capture_body = CAPTURE_JSONL
        .strip_suffix(b"\n")
        .expect("canonical capture has one final LF");
    let records = capture_body
        .split(|byte| *byte == b'\n')
        .collect::<Vec<_>>();
    assert_eq!(
        records.len(),
        23,
        "canonical capture must contain 23 records"
    );
    for (record, case) in records.iter().zip(&inventory.cases) {
        let payload = record
            .strip_prefix(CAPTURE_PREFIX.as_bytes())
            .expect("each capture record has the exact filter prefix");
        let parsed: Value = serde_json::from_slice(payload).expect("capture record parses");
        assert_eq!(parsed["baselineCommit"], inventory.source.commit);
        assert_eq!(
            parsed["captureProbeSha256"],
            inventory.source.capture_probe_sha256,
        );
        assert_eq!(parsed["caseId"], case.id);
    }

    let procedure = std::str::from_utf8(CAPTURE_PROCEDURE).expect("capture procedure is UTF-8");
    for required_contract in [
        "readonly capture_toolchain=\"1.94.0\"",
        "git -C \"$repo_root\" archive --format=tar \"$baseline_commit\"",
        "for run in a b; do",
        "rustup which --toolchain \"$capture_toolchain\" rustc",
        "rustc +1.94.0 --version --verbose",
        "cargo +1.94.0 --version --verbose",
        "git hash-object --no-filters \"$expected_config\"",
        "assert_cargo_config_closure \"$detached_crate_root\"",
        "cd -- \"$detached_crate_root\"",
        "CARGO_NET_OFFLINE=true",
        "CARGO_TARGET_DIR=\"$target_root\"",
        "cargo +1.94.0 test",
        "--locked",
        "--offline",
        "--exact",
        "--nocapture",
        "--test-threads=1",
        "rg -o 'CHRONICLE_DETACHED_ORACLE\\t.*$'",
        "cmp -- \"$canonical_capture\" \"$filtered_jsonl\"",
    ] {
        assert!(
            procedure.contains(required_contract),
            "capture procedure lost required contract: {required_contract}",
        );
    }
    let hermetic_cargo_prefix = concat!(
        "env -i \\\n",
        "      CAPTURE_PROBE_SHA256=\"sha256:$probe_sha256\" \\\n",
        "      CARGO_HOME=\"$isolated_cargo_home\" \\\n",
        "      CARGO_INCREMENTAL=0 \\\n",
        "      CARGO_NET_OFFLINE=true \\\n",
        "      CARGO_TARGET_DIR=\"$target_root\" \\\n",
        "      HOME=\"$isolated_home\" \\\n",
        "      LC_ALL=C \\\n",
        "      PATH=\"$capture_path\" \\\n",
        "      RUSTC=\"$rustc_toolchain_bin\" \\\n",
        "      RUSTUP_DIST_SERVER=file:///nonexistent \\\n",
        "      RUSTUP_HOME=\"$capture_rustup_home\" \\\n",
        "      RUSTUP_UPDATE_ROOT=file:///nonexistent \\\n",
        "      TMPDIR=\"$isolated_tmp\" \\\n",
        "      TZ=UTC \\\n",
        "      cargo +1.94.0 test \\\n",
    );
    assert_eq!(
        procedure.matches(hermetic_cargo_prefix).count(),
        2,
        "both Cargo invocations must use the complete scrubbed environment",
    );
    assert_eq!(
        procedure
            .matches("assert_cargo_config_closure \"$detached_crate_root\"")
            .count(),
        1,
        "the detached Cargo configuration closure must be checked exactly once per run body",
    );
    for forbidden_contract in ["cargo +stable", "rustc +stable", "env -u UPDATE_GOLDEN"] {
        assert!(
            !procedure.contains(forbidden_contract),
            "capture procedure retained ambient/floating contract: {forbidden_contract}",
        );
    }
}

#[test]
fn detached_oracle_inventory_closes_historical_domain() {
    let inventory = inventory();
    assert_eq!(
        inventory.schema_version,
        "chronicle-detached-scientific-oracle/v1"
    );
    assert_eq!(inventory.source.commit, BASELINE_COMMIT);
    assert_eq!(inventory.source.parent, BASELINE_PARENT);
    assert_eq!(inventory.source.tree, BASELINE_TREE);
    assert_eq!(inventory.source.capture_probe_sha256, CAPTURE_PROBE_SHA256);
    assert_eq!(inventory.source.capture_jsonl_sha256, CAPTURE_JSONL_SHA256);
    assert_eq!(
        inventory.source.capture_procedure_sha256,
        CAPTURE_PROCEDURE_SHA256,
    );
    assert_sha256_format(&inventory.source.capture_probe_sha256, "capture probe");
    assert_sha256_format(&inventory.source.capture_jsonl_sha256, "capture JSONL");
    assert_sha256_format(
        &inventory.source.capture_procedure_sha256,
        "capture procedure",
    );
    for (label, object) in [
        ("pipeline_v2", inventory.source.blobs.pipeline_v2.as_str()),
        (
            "pipeline_v2_incremental",
            inventory.source.blobs.pipeline_v2_incremental.as_str(),
        ),
        (
            "pipeline_v2_aggregates",
            inventory.source.blobs.pipeline_v2_aggregates.as_str(),
        ),
        ("manifest", inventory.source.blobs.manifest.as_str()),
        ("lockfile", inventory.source.blobs.lockfile.as_str()),
    ] {
        assert_git_sha1_format(object, label);
    }
    assert_eq!(
        (
            inventory.source.blobs.pipeline_v2.as_str(),
            inventory.source.blobs.pipeline_v2_incremental.as_str(),
            inventory.source.blobs.pipeline_v2_aggregates.as_str(),
            inventory.source.blobs.manifest.as_str(),
            inventory.source.blobs.lockfile.as_str(),
        ),
        (
            "git-sha1:1bfb75ae0515114878b666abd0fc345d13e0bf44",
            "git-sha1:ff446fe6e07ad9a8d53c0688330462013fcfabd0",
            "git-sha1:dee0ba82ef1363df06237f421335be801ace254e",
            "git-sha1:1e85dc917fba1b9a95cb0c71496abc214614bbf9",
            "git-sha1:14b598f6f86b73a47d334cec4804d1cec9040b7a",
        ),
    );

    assert_eq!(
        inventory.historical_domain.strategies,
        HISTORICAL_STRATEGIES
    );
    assert_eq!(inventory.historical_domain.openers, HISTORICAL_OPENERS);
    assert_eq!(
        EpisodeReconstructionStrategy::ALL
            .iter()
            .map(|strategy| strategy.canonical_id())
            .filter(|id| *id != "schoedel_2026_app_within_screen_prose_v1")
            .collect::<Vec<_>>(),
        HISTORICAL_STRATEGIES,
        "the detached oracle must close over exactly the seven pre-B03-B05 strategies",
    );
    assert_eq!(
        OpenerSet::ALL
            .iter()
            .map(|opener| opener.canonical_id())
            .collect::<Vec<_>>(),
        HISTORICAL_OPENERS,
    );

    let expected_fixture_ids = [
        "app-eyes",
        "app-gesis",
        "app-handover",
        "app-pause",
        "b04-boundary",
        "screen-chronicle",
    ]
    .into_iter()
    .collect::<BTreeSet<_>>();
    assert_eq!(
        inventory
            .fixtures
            .keys()
            .map(String::as_str)
            .collect::<BTreeSet<_>>(),
        expected_fixture_ids,
    );
    for (fixture, commitment) in &inventory.fixtures {
        assert_sha256_format(&commitment.sha256, &format!("fixture:{fixture}"));
        assert!(commitment.len > 0, "fixture:{fixture}: empty commitment");
    }

    let mut expected_case_ids = Vec::new();
    for strategy in HISTORICAL_STRATEGIES {
        for opener in HISTORICAL_OPENERS {
            expected_case_ids.push(format!("app/{strategy}/{opener}"));
        }
    }
    expected_case_ids.push("app/b04-boundary".into());
    expected_case_ids.push("screen/chronicle-default".into());
    assert_eq!(
        inventory
            .cases
            .iter()
            .map(|case| case.id.clone())
            .collect::<Vec<_>>(),
        expected_case_ids,
        "detached case order or closure drifted",
    );
    assert_eq!(
        inventory
            .cases
            .iter()
            .map(|case| case.id.as_str())
            .collect::<BTreeSet<_>>()
            .len(),
        23,
        "detached case IDs must be unique",
    );

    let mut success_count = 0;
    let mut refusal_count = 0;
    for case in &inventory.cases {
        assert!(
            inventory.fixtures.contains_key(&case.fixture),
            "{}: unknown fixture {}",
            case.id,
            case.fixture,
        );
        assert_sha256_format(&case.request.sha256, &format!("{}:request", case.id));
        assert!(case.request.len > 0, "{}: empty request", case.id);
        let expected_profile = if case.id == "app/b04-boundary" {
            "b04-default-min60"
        } else if case.id == "screen/chronicle-default" {
            "b05-default-min60"
        } else {
            "b02-matrix-min0"
        };
        assert_eq!(case.profile, expected_profile, "{}: profile drift", case.id);
        match &case.expect {
            ExpectedOutcome::Success { members } => {
                success_count += 1;
                let expected_names = if case.id == "screen/chronicle-default" {
                    SCREEN_MEMBER_NAMES.as_slice()
                } else {
                    APP_MEMBER_NAMES.as_slice()
                };
                assert_eq!(
                    members
                        .iter()
                        .map(|member| member.name.as_str())
                        .collect::<Vec<_>>(),
                    expected_names,
                    "{}: member domain or order drift",
                    case.id,
                );
                for member in members {
                    assert!(member.len > 0, "{}:{} is empty", case.id, member.name);
                    assert_sha256_format(&member.sha256, &format!("{}:{}", case.id, member.name));
                }
            }
            ExpectedOutcome::Refused { error } => {
                refusal_count += 1;
                assert_eq!(case.id, "app/eyes_complement/gesis_app_scoped_starts");
                assert_eq!(error, HISTORICAL_REFUSAL);
            }
        }
    }
    assert_eq!((success_count, refusal_count), (22, 1));
}

#[test]
fn detached_app_matrix_matches_080801a_before_explicit_defaults() {
    let inventory = inventory();
    for strategy in HISTORICAL_STRATEGIES {
        let (fixture_id, raw) = app_fixture(strategy);
        assert_commitment(
            &raw,
            fixture_commitment(&inventory, fixture_id),
            &format!("fixture:{fixture_id}"),
        );
        for opener in HISTORICAL_OPENERS {
            let case_id = format!("app/{strategy}/{opener}");
            let case = oracle_case(&inventory, &case_id);
            assert_eq!(case.fixture, fixture_id);
            let request = b02_request(strategy, opener);
            assert_request_commitment(&request, case);
            let historical_options = parse_options(&request);
            assert_historical_presence(&historical_options, 0.0);
            assert_eq!(
                historical_options
                    .episode_reconstruction_strategy
                    .canonical_id(),
                strategy,
            );
            assert_eq!(historical_options.opener_set.canonical_id(), opener);

            let historical = run_pipeline_v2_with_supports(
                &raw,
                &historical_options,
                PipelineV2SupportFiles::default(),
            );
            match &case.expect {
                ExpectedOutcome::Refused { error } => {
                    let historical_error = historical
                        .err()
                        .unwrap_or_else(|| panic!("{case_id}: historical request must refuse"));
                    assert_eq!(
                        historical_error, *error,
                        "{case_id}: detached refusal drift"
                    );

                    let explicit_request = with_explicit_foundational_defaults(request);
                    let explicit_options = parse_options(&explicit_request);
                    assert_explicit_presence(&explicit_options, 0.0);
                    let explicit_error = run_pipeline_v2_with_supports(
                        &raw,
                        &explicit_options,
                        PipelineV2SupportFiles::default(),
                    )
                    .err()
                    .unwrap_or_else(|| panic!("{case_id}: explicit defaults must still refuse"));
                    assert_eq!(explicit_error, historical_error, "{case_id}: refusal drift");
                }
                ExpectedOutcome::Success { .. } => {
                    let historical = historical.unwrap_or_else(|error| {
                        panic!("{case_id}: historical run failed: {error}")
                    });
                    assert!(
                        historical.app_row_count > 0,
                        "{case_id}: vacuous app fixture"
                    );
                    assert_aggregate_kind_closure(&historical, &case_id);
                    let historical_members =
                        assert_detached_members_first(&historical, case, PrimaryMember::App);

                    let explicit_request = with_explicit_foundational_defaults(request);
                    let explicit_options = parse_options(&explicit_request);
                    assert_explicit_presence(&explicit_options, 0.0);
                    let explicit = run_pipeline_v2_with_supports(
                        &raw,
                        &explicit_options,
                        PipelineV2SupportFiles::default(),
                    )
                    .unwrap_or_else(|error| panic!("{case_id}: explicit run failed: {error}"));
                    assert_eq!(
                        scientific_members(&explicit, PrimaryMember::App),
                        historical_members,
                        "{case_id}: explicit defaults changed scientific product bytes",
                    );
                }
            }
        }
    }
}

#[test]
fn detached_b04_boundary_matches_080801a_before_explicit_defaults() {
    let inventory = inventory();
    let case = oracle_case(&inventory, "app/b04-boundary");
    let raw = b04_fixture();
    assert_eq!(case.fixture, "b04-boundary");
    assert_commitment(
        &raw,
        fixture_commitment(&inventory, &case.fixture),
        "fixture:b04-boundary",
    );
    let request = historical_default_request("app_usage", true, false);
    assert_request_commitment(&request, case);
    let historical_options = parse_options(&request);
    assert_historical_presence(&historical_options, 60.0);
    let historical =
        run_pipeline_v2_with_supports(&raw, &historical_options, PipelineV2SupportFiles::default())
            .expect("historical B04 request succeeds");
    assert_eq!(historical.app_row_count, 3);
    assert_aggregate_kind_closure(&historical, &case.id);
    let historical_members = assert_detached_members_first(&historical, case, PrimaryMember::App);
    assert_b04_boundary_behavior(&historical);

    let explicit_request = with_explicit_foundational_defaults(request);
    let explicit_options = parse_options(&explicit_request);
    assert_explicit_presence(&explicit_options, 60.0);
    let explicit =
        run_pipeline_v2_with_supports(&raw, &explicit_options, PipelineV2SupportFiles::default())
            .expect("explicit B04 defaults succeed");
    assert_eq!(
        scientific_members(&explicit, PrimaryMember::App),
        historical_members,
        "explicit B03-B05 defaults changed the detached B04 boundary bytes",
    );
}

#[test]
fn detached_chronicle_screen_matches_080801a_before_explicit_default() {
    let inventory = inventory();
    let case = oracle_case(&inventory, "screen/chronicle-default");
    let raw = screen_fixture();
    assert_eq!(case.fixture, "screen-chronicle");
    assert_commitment(
        &raw,
        fixture_commitment(&inventory, &case.fixture),
        "fixture:screen-chronicle",
    );
    let request = historical_default_request("screen_usage", false, true);
    assert_request_commitment(&request, case);
    let historical_options = parse_options(&request);
    assert_historical_presence(&historical_options, 60.0);
    let historical =
        run_pipeline_v2_with_supports(&raw, &historical_options, PipelineV2SupportFiles::default())
            .expect("historical Chronicle screen request succeeds");
    assert_eq!(historical.screen_row_count, 4);
    assert_aggregate_kind_closure(&historical, &case.id);
    let historical_members =
        assert_detached_members_first(&historical, case, PrimaryMember::Screen);
    assert_screen_fixture_behavior(&historical);

    let explicit_request = with_explicit_foundational_defaults(request);
    let explicit_options = parse_options(&explicit_request);
    assert_explicit_presence(&explicit_options, 60.0);
    let explicit =
        run_pipeline_v2_with_supports(&raw, &explicit_options, PipelineV2SupportFiles::default())
            .expect("explicit Chronicle screen default succeeds");
    assert_eq!(
        scientific_members(&explicit, PrimaryMember::Screen),
        historical_members,
        "explicit B03-B05 defaults changed detached Chronicle screen bytes",
    );
}
