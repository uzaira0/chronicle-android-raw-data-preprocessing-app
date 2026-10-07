use chronicle_chrono_kernel_wasm::pipeline_v2::PipelineV2OptionsJson;
use chronicle_preprocessing_runtime_wasm::literature_input_adapters::literature_component_execution_unit;
use chronicle_preprocessing_runtime_wasm::{
    execute_literature_component_native, LiteratureComponentExecutionReceipt,
    LiteratureComponentMethodReceipt, LiteratureComponentRuntimeManifest, RuntimeArtifactMetadata,
    RuntimeRequest, RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND, RUNTIME_PROTOCOL_VERSION,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

const COMPONENT_ID: &str = "chronicle.anchor-relative-category-window/v1";
const FIXTURE: &str =
    include_str!("fixtures/langener_anchor_relative_category_window_component.json");

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn fixture_csv(fixture: &Value, key: &str) -> Vec<u8> {
    let mut csv = fixture[key]
        .as_array()
        .expect("fixture CSV lines")
        .iter()
        .map(|line| line.as_str().expect("fixture CSV line"))
        .collect::<Vec<_>>()
        .join("\n");
    csv.push('\n');
    csv.into_bytes()
}

fn options() -> PipelineV2OptionsJson {
    serde_json::from_value(json!({
        "study_name": "Anchor-relative category-window component",
        "timezone": "UTC",
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
        "long_data_time_gap_thresholds": [1.0, 2.0],
        "long_usage_duration_thresholds": [1.0, 2.0],
        "same_app_stop_types": ["Activity Paused", "Activity Resumed"],
        "other_stop_types": ["Activity Resumed", "Device Shutdown"],
        "interaction_types_to_remove": [],
        "screen_auto_lock_timeout_seconds": 120.0,
        "screen_auto_lock_tolerance_seconds": 30.0,
        "screen_manual_lock_max_tail_seconds": 30.0,
        "screen_keyguard_near_stop_seconds": 2.0,
        "datetime_of_preprocessing": "2026-09-03 00:00:00 UTC",
        "minimum_usage_duration": 0.0
    }))
    .expect("valid component options")
}

fn request(raw: &[u8]) -> String {
    serde_json::to_string(&RuntimeRequest {
        protocol_version: RUNTIME_PROTOCOL_VERSION.into(),
        request_id: "anchor-relative-category-window-component".into(),
        command: EXECUTE_WORKSPACE_COMMAND.into(),
        workspace_root_digest: None,
        workspace_id: sha256(b"anchor-relative-category-window-workspace"),
        input_file_name: "post_clean_categorized_intervals.csv".into(),
        input_sha256: sha256(raw),
        known_review_summary_digests: None,
        participant_partition_batch_id: None,
        fragmented_participant_tokens: Vec::new(),
        method_profile_receipt: None,
        method_profile_receipts: Vec::new(),
        execution_engine: chronicle_preprocessing_runtime_wasm::ExecutionEngine::Sequential,
        provenance_evidence: false,
        options: options(),
    })
    .expect("request JSON")
}

#[test]
fn public_component_matches_source_oracle_values_and_binds_anchor_support() {
    let fixture: Value = serde_json::from_str(FIXTURE).expect("source-oracle fixture JSON");
    let raw = fixture_csv(&fixture, "rawCsvLines");
    let anchors = fixture_csv(&fixture, "anchorCsvLines");
    let (registration, _) = literature_component_execution_unit(COMPONENT_ID)
        .expect("registered component execution unit");
    assert_eq!(registration.required_support_roles, ["anchor_events_file"]);

    let mut support = RuntimeSupportFiles::default();
    support
        .put_with_name("anchor_events_file", "anchor_events.csv", &anchors)
        .map_err(|_| "support insertion failed")
        .expect("anchor support CSV");
    let mut handle =
        execute_literature_component_native(COMPONENT_ID, &request(&raw), &raw, &support)
            .expect("component execution");
    let manifest: LiteratureComponentRuntimeManifest =
        serde_json::from_str(&handle.manifest_json()).expect("component manifest");
    assert_eq!(manifest.source_row_count, 16);
    assert_eq!(manifest.derived_result_row_count, 54);

    let mut payloads = BTreeMap::new();
    for index in 0..handle.artifact_count() {
        let metadata: RuntimeArtifactMetadata = serde_json::from_str(
            &handle
                .artifact_metadata_json(index)
                .expect("artifact metadata"),
        )
        .expect("artifact metadata JSON");
        let bytes = handle.take_artifact_bytes(index).expect("artifact payload");
        assert_eq!(metadata.digest, sha256(&bytes));
        payloads.insert(metadata.kind, bytes);
    }

    let derived = std::str::from_utf8(&payloads["literature-anchor-relative-category-window-csv"])
        .expect("derived UTF-8");
    for expected in fixture["expectedDerivedCsvContains"]
        .as_array()
        .expect("source-oracle expected values")
    {
        assert!(
            derived.contains(expected.as_str().expect("expected derived row")),
            "derived output omitted source-oracle row {expected}; output:\n{derived}"
        );
    }
    assert_eq!(derived.lines().count(), 55);
    let mut reader = csv::Reader::from_reader(derived.as_bytes());
    let threshold_column = reader
        .headers()
        .unwrap()
        .iter()
        .position(|name| name == "missing_hour_threshold")
        .unwrap();
    let thresholds = reader
        .records()
        .map(|row| row.unwrap()[threshold_column].to_owned())
        .collect::<Vec<_>>();
    assert_eq!(
        thresholds,
        ["18", "12", "24"]
            .into_iter()
            .flat_map(|threshold| std::iter::repeat_n(threshold.to_owned(), 18))
            .collect::<Vec<_>>()
    );

    let method: LiteratureComponentMethodReceipt =
        serde_json::from_slice(&payloads["literature-component-method-receipt-json"])
            .expect("method receipt");
    let execution: LiteratureComponentExecutionReceipt =
        serde_json::from_slice(&payloads["literature-component-execution-receipt-json"])
            .expect("execution receipt");
    let expected_setting_ids = fixture["exactCanonicalSettingIds"]
        .as_array()
        .expect("exact setting IDs")
        .iter()
        .map(|value| value.as_str().expect("setting ID").to_owned())
        .collect::<BTreeSet<_>>();
    assert_eq!(
        method.setting_ids.iter().cloned().collect::<BTreeSet<_>>(),
        expected_setting_ids
    );
    assert_eq!(execution.setting_ids, method.setting_ids);
    assert_eq!(execution.oracle_id, fixture["sourceOracleId"]);
    assert_eq!(
        execution.support_artifact_digests["anchor_events_file"],
        sha256(&anchors)
    );
    assert_eq!(
        execution.support_adapter_input_digests["anchor_events_file"],
        sha256(&anchors)
    );
    assert_eq!(execution.derived_result_row_count, 54);
    assert!(!execution.kernel_input_eligible);
    assert_eq!(execution.full_profile_execution_status, "blocked");
    assert_eq!(method.limitations, execution.limitations);
    assert_eq!(method.limitations.len(), 4);
    for omitted_stage in ["app_cleaning", "taxonomy", "notebook", "statistical models"] {
        assert!(
            method
                .limitations
                .iter()
                .any(|limitation| limitation.contains(omitted_stage)),
            "missing limitation for {omitted_stage}"
        );
    }

    let error = execute_literature_component_native(
        COMPONENT_ID,
        &request(&raw),
        &raw,
        &RuntimeSupportFiles::default(),
    )
    .err()
    .expect("missing anchor support must fail closed");
    assert!(error.contains("anchor_events_file"));
}

#[test]
fn public_component_matches_all_source_rows_without_zero_filling_foreign_categories() {
    let inputs: Value =
        serde_json::from_str(include_str!("fixtures/anchor_category_hour_gap_cases.json")).unwrap();
    let oracle: Value = serde_json::from_str(include_str!(
        "fixtures/anchor_category_hour_gap_expected.json"
    ))
    .unwrap();
    let timestamp = |seconds: i64| {
        chronicle_chrono_kernel_wasm::format_chronicle_timestamp_ns(seconds * 1_000_000_000)
            .unwrap()
    };
    let mut raw = String::from("participant_id,recorded_naive,duration,category\n");
    let mut anchors = String::from("participant_id,anchor_timestamp\n");
    for case in inputs["cases"].as_array().unwrap() {
        let id = case["id"].as_str().unwrap();
        for interval in case["intervals"].as_array().unwrap() {
            raw.push_str(&format!(
                "{id},{},{},{}\n",
                timestamp(interval["start_seconds"].as_i64().unwrap()),
                interval["duration_seconds"],
                interval["category"].as_str().unwrap()
            ));
        }
        for anchor in case["anchors_seconds"].as_array().unwrap() {
            anchors.push_str(&format!("{id},{}\n", timestamp(anchor.as_i64().unwrap())));
        }
    }
    let mut support = RuntimeSupportFiles::default();
    support
        .put_with_name("anchor_events_file", "anchors.csv", anchors.as_bytes())
        .unwrap();
    let mut result = execute_literature_component_native(
        COMPONENT_ID,
        &request(raw.as_bytes()),
        raw.as_bytes(),
        &support,
    )
    .unwrap();
    let mut output = None;
    for index in 0..result.artifact_count() {
        let metadata: RuntimeArtifactMetadata =
            serde_json::from_str(&result.artifact_metadata_json(index).unwrap()).unwrap();
        if metadata.kind == "literature-anchor-relative-category-window-csv" {
            output = Some(result.take_artifact_bytes(index).unwrap());
        }
    }
    let output = output.unwrap();
    let mut reader = csv::Reader::from_reader(output.as_slice());
    let headers = reader.headers().unwrap().clone();
    let columns = headers
        .iter()
        .enumerate()
        .map(|(i, name)| (name.to_owned(), i))
        .collect::<BTreeMap<_, _>>();
    let rows = reader.records().collect::<Result<Vec<_>, _>>().unwrap();
    assert_eq!(
        rows.len(),
        oracle["results"]
            .as_array()
            .unwrap()
            .iter()
            .map(|run| run["rows"].as_array().unwrap().len())
            .sum::<usize>()
    );
    for run in oracle["results"].as_array().unwrap() {
        let threshold_hours = run["threshold_hours"].to_string();
        let actual = rows
            .iter()
            .filter(|row| {
                row[0] == *run["case"].as_str().unwrap()
                    && row[columns["direction"]] == *run["direction"].as_str().unwrap()
                    && row[columns["missing_hour_threshold"]] == threshold_hours
            })
            .collect::<Vec<_>>();
        let expected = run["rows"].as_array().unwrap();
        assert_eq!(actual.len(), expected.len());
        for (actual, expected) in actual.into_iter().zip(expected) {
            assert_eq!(
                actual[columns["anchor_timestamp"]],
                timestamp(expected["anchor_seconds"].as_i64().unwrap())
            );
            assert_eq!(
                actual[columns["window_minutes"]],
                expected["window_minutes"].to_string()
            );
            for (name, index) in columns.iter().filter(|(name, _)| name.ends_with("_min")) {
                let value = if name == "app_usage_min" {
                    &expected["app_usage_min"]
                } else {
                    &expected["category_minutes"][name]
                };
                let observed = &actual[*index];
                if value.is_null() {
                    assert_eq!(observed, "", "foreign category {name} must remain absent");
                } else if value.as_str() == Some("NaN") {
                    assert_eq!(observed, "NaN", "source mask is a literal sentinel");
                } else {
                    assert!(
                        (observed.parse::<f64>().unwrap() - value.as_f64().unwrap()).abs() <= 1e-12,
                        "{} / {} / {name}: {observed} != {value}",
                        run["case"],
                        run["threshold_hours"]
                    );
                }
            }
        }
    }
}
