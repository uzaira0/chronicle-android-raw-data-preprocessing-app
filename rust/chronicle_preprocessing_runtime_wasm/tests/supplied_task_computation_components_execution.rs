use chronicle_chrono_kernel_wasm::pipeline_v2::PipelineV2OptionsJson;
use chronicle_preprocessing_runtime_wasm::{
    execute_literature_component_native, LiteratureComponentExecutionReceipt,
    LiteratureComponentMethodReceipt, LiteratureComponentRuntimeManifest, RuntimeArtifactMetadata,
    RuntimeRequest, RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND, RUNTIME_PROTOCOL_VERSION,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

const PVT: &str = "chronicle.pvt-relative-response-time/v1";
const MAGNITUDE: &str = "chronicle.touchstroke-sensor-magnitude/v1";
const TIMING: &str = "chronicle.touchstroke-four-stroke-timing/v1";
const RABBIT: &str = "chronicle.rabbit-hole-prepared-features/v1";

#[test]
fn public_shin_and_hamilton_refuse_duplicate_fields_after_a_valid_row() {
    let fixtures:Value=serde_json::from_str(include_str!("fixtures/literature_input_adapter_conformance.json")).unwrap();
    for (component,input) in [
        ("chronicle.shin-prepared-no-app-day/v1",r#"{"sessions":[{"session_id":"s","on_event_id":"on","off_event_id":"off","on_timestamp_ns":0,"off_timestamp_ns":1,"app_identities":["app.a"],"app_identities":[]}]}"#),
        ("chronicle.hamilton-supplied-no-use-hour-policy/v1",r#"{"hour_id":"h","category_scope_id":"c","complete":false,"complete":true,"segment_minutes":60,"valid_yielded_minutes":30,"no_usage_captured":true}"#),
    ] {
        let group=fixtures["groups"].as_array().unwrap().iter().find(|g|g["adapterId"]==component).unwrap();
        let csv=group["cases"][0]["rawCsvLines"].as_array().unwrap().iter().map(|s|s.as_str().unwrap()).collect::<Vec<_>>().join("\n")+"\n";
        let mut reader=csv::Reader::from_reader(csv.as_bytes());let header=reader.headers().unwrap().clone();
        let valid=reader.records().next().unwrap().unwrap();let mut invalid=valid.iter().map(str::to_owned).collect::<Vec<_>>();
        invalid[0].push_str("-second");invalid[3].push_str("-second");invalid[7]=input.into();
        let mut writer=csv::Writer::from_writer(Vec::new());writer.write_record(&header).unwrap();
        writer.write_record(&valid).unwrap();writer.write_record(&invalid).unwrap();let raw=writer.into_inner().unwrap();
        let error=execute_literature_component_native(component,&request(component,&raw),&raw,&RuntimeSupportFiles::default()).err().unwrap();
        assert!(error.contains("duplicate field"),"{component}: {error}");
    }
}

// Independently calculated synthetic inputs; no author code, cohorts or models.
// PVT: pvt.py at 1beeef8560c3df6cbbb94c2675c258c8f11dc41b,
// SHA256 ba82eec49f45e77b6fbe8bcca4dba0e5c370c1f64096336a8130a7d73611beb3.
// Touchstroke: Eq.1/Fig.1, printed p.30/PDF p.4, primary PDF
// SHA256 13974058ec36916d7907400d178a88a6f1aaec5769bdd15a99c24d4087857a42.
// Rabbit-Hole: prediction.py:131-152 at c9e3238c1d15d7e9837287e3c98a4b8b012c4ece,
// SHA256 adb01866c722f2de0936c64fa7a444eb0060672bfb00af1968d53260f21665d6.

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn request(component: &str, raw: &[u8]) -> String {
    let options: PipelineV2OptionsJson = serde_json::from_value(json!({
        "study_name": "Supplied task computation components",
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
        "datetime_of_preprocessing": "2026-09-29 00:00:00 UTC",
        "minimum_usage_duration": 0.0
    })).expect("ordinary runtime options");
    serde_json::to_string(&RuntimeRequest {
        protocol_version: RUNTIME_PROTOCOL_VERSION.into(),
        request_id: component.replace(['.', '/'], "-"),
        command: EXECUTE_WORKSPACE_COMMAND.into(),
        workspace_root_digest: None,
        workspace_id: sha256(format!("{component}-workspace").as_bytes()),
        input_file_name: "supplied-computation.csv".into(),
        input_sha256: sha256(raw),
        known_review_summary_digests: None,
        participant_partition_batch_id: None,
        fragmented_participant_tokens: Vec::new(),
        method_profile_receipt: None,
        method_profile_receipts: Vec::new(),
        execution_engine: chronicle_preprocessing_runtime_wasm::ExecutionEngine::Sequential,
        provenance_evidence: false,
        options,
    }).expect("ordinary request without supplied method receipts")
}

fn public_output(
    component: &str,
    raw: &[u8],
    result_kind: &str,
    row_counts: (u32, u32),
    source_identity: (&str, &str, usize),
) -> Vec<u8> {
    let mut handle = execute_literature_component_native(
        component, &request(component, raw), raw, &RuntimeSupportFiles::default(),
    ).unwrap_or_else(|error| panic!("{component}: public execution failed: {error}"));
    let manifest: LiteratureComponentRuntimeManifest =
        serde_json::from_str(&handle.manifest_json()).expect("component manifest");
    assert_eq!(manifest.component_id, component);
    assert_eq!(manifest.input_digest, sha256(raw));
    assert_eq!((manifest.source_row_count, manifest.derived_result_row_count), row_counts);
    assert_eq!(manifest.artifacts.len(), handle.artifact_count() as usize);
    let mut payloads = BTreeMap::new();
    for index in 0..handle.artifact_count() {
        let metadata: RuntimeArtifactMetadata = serde_json::from_str(
            &handle.artifact_metadata_json(index).expect("artifact metadata"),
        ).expect("artifact metadata JSON");
        let bytes = handle.take_artifact_bytes(index).expect("artifact bytes");
        assert_eq!(metadata.digest, sha256(&bytes));
        assert_eq!(manifest.artifacts[index as usize].digest, metadata.digest);
        if metadata.kind == result_kind {
            assert_eq!(metadata.row_count, Some(row_counts.1));
        }
        assert!(payloads.insert(metadata.kind, bytes).is_none());
    }
    let method_bytes = &payloads["literature-component-method-receipt-json"];
    let method: LiteratureComponentMethodReceipt =
        serde_json::from_slice(method_bytes).expect("method receipt");
    let adaptation_bytes = &payloads["literature-input-adaptation-receipt-json"];
    let adaptation: Value = serde_json::from_slice(adaptation_bytes).expect("adaptation receipt");
    let execution_bytes = &payloads["literature-component-execution-receipt-json"];
    let execution: LiteratureComponentExecutionReceipt =
        serde_json::from_slice(execution_bytes).expect("execution receipt");
    let output = &payloads[result_kind];
    assert_eq!(method.component_id, component);
    assert_eq!(method.source_work_id, source_identity.0);
    let expected_parent = match component {
        "chronicle.sdu-supplied-period-reductions/v1" | "chronicle.sdu-supplied-validation-arithmetic/v1" => "outside143:sdu-device-tracker:v1".to_owned(),
        "chronicle.usage-logger-released-numeric/v1" => "outside143:usage-logger:v1".to_owned(),
        _ => format!("method-profile:{}", source_identity.0),
    };
    assert_eq!(method.parent_method_profile_id, expected_parent);
    assert_eq!(method.parent_profile_execution_status, "blocked");
    assert_eq!(method.setting_ids.len(), source_identity.2);
    assert!(!method.limitations.is_empty());
    assert_eq!(execution.component_id, component);
    assert_eq!(execution.source_work_id, source_identity.0);
    assert_eq!(execution.oracle_id, source_identity.1);
    assert_eq!(execution.component_execution_status, "executed");
    assert_eq!(execution.full_profile_execution_status, "blocked");
    assert_eq!(execution.setting_ids, method.setting_ids);
    assert_eq!(execution.source_method_variant_id, method.source_method_variant_id);
    assert_eq!(execution.method_profile_version, method.method_profile_version);
    assert_eq!(execution.original_input_digest, sha256(raw));
    assert_eq!(execution.component_method_receipt_digest, sha256(method_bytes));
    assert_eq!(execution.adaptation_receipt_digest, sha256(adaptation_bytes));
    assert_eq!(execution.derived_result_kind, result_kind);
    assert_eq!(execution.derived_result_digest, sha256(output));
    assert_eq!(execution.derived_result_row_count, row_counts.1);
    assert!(!execution.kernel_input_eligible);
    assert_eq!(execution.canonical_kernel_input_digest, None);
    assert_eq!(adaptation["originalInputDigest"], sha256(raw));
    assert_eq!(adaptation["adaptedInputDigest"], sha256(output));
    assert_eq!(adaptation["sourceRowCount"], row_counts.0);
    assert_eq!(adaptation["emittedRowCount"], row_counts.1);
    assert_eq!(adaptation["sourceOracleId"], source_identity.1);
    assert_eq!(adaptation["derivedResult"]["digest"], sha256(output));
    assert_eq!(adaptation["derivedResult"]["rowCount"], row_counts.1);
    assert_eq!(manifest.component_execution_receipt_digest, sha256(execution_bytes));
    assert_eq!(manifest.artifact_closure_digest, sha256(&payloads["artifact-closure-json"]));
    assert_eq!(manifest.workspace_root_digest, sha256(&payloads["workspace-root-json"]));
    output.clone()
}

#[test]
fn pvt_public_runner_computes_recursive_mrt_mmrt_and_rrt() {
    let raw = format!("user_id,session,response_time\n{}", [100,101,102,103,104,105,106,107,200,1000]
        .iter().enumerate().map(|(index, value)| format!("A,s{},{value}\n", index + 1))
        .collect::<String>());
    let output = public_output(PVT, raw.as_bytes(), "literature-pvt-relative-response-time-csv", (10,8), (
        "doi:10.1145/2971648.2971712",
        "abdullah-pvt-source-semantics-1beeef8560c3/sha256:ba82eec49f45e77b6fbe8bcca4dba0e5c370c1f64096336a8130a7d73611beb3", 8,
    ));
    let mut reader = csv::Reader::from_reader(output.as_slice());
    assert_eq!(reader.headers().unwrap().iter().collect::<Vec<_>>(),
        ["user_id","session","mrt_ms","mmrt_ms","rrt_percent"]);
    let records = reader.records().collect::<Result<Vec<_>, _>>().unwrap();
    assert_eq!(records.len(), 8);
    for (index, record) in records.iter().enumerate() {
        assert_eq!(&record[0], "A");
        assert_eq!(&record[1], format!("s{}", index + 1));
        assert_eq!(record[2].parse::<f64>().unwrap(), 100.0 + index as f64);
        assert_eq!(record[3].parse::<f64>().unwrap(), 103.5);
        let expected = (700.0 - 200.0 * index as f64) / 207.0;
        assert!((record[4].parse::<f64>().unwrap() - expected).abs() < 1e-12);
    }
}

#[test]
fn touchstroke_public_runner_computes_sensor_magnitude() {
    let raw = b"participant_id,attempt_id,sensor_stream_id,sample_id,sensor_unit,x,y,z\nP1,A1,sensor.stream.raw_accelerometer,S1,m/s^2,3,4,0\n";
    let output = public_output(MAGNITUDE, raw, "literature-touchstroke-sensor-magnitude-csv", (1,1), (
        "doi:10.1007/978-3-319-23222-5_4",
        "touchstroke-eq1-hand-oracle-v1/primary-pdf-sha256:13974058ec36916d7907400d178a88a6f1aaec5769bdd15a99c24d4087857a42", 1,
    ));
    assert_eq!(String::from_utf8(output).unwrap(),
        "participant_id,attempt_id,sensor_stream_id,sample_id,sensor_unit,x,y,z,magnitude\nP1,A1,sensor.stream.raw_accelerometer,S1,m/s^2,3,4,0,5\n");
}

#[test]
fn touchstroke_public_runner_computes_all_fourteen_timing_values() {
    let raw = b"participant_id,attempt_id,clock_id,time_unit,time_precision,P1,R1,P2,R2,P3,R3,P4,R4\nP1,A1,monotonic-supplied,ms,1,0,50,100,150,220,300,400,450\n";
    let output = public_output(TIMING, raw, "literature-touchstroke-four-stroke-timing-csv", (1,1), (
        "doi:10.1007/978-3-319-23222-5_4",
        "touchstroke-figure1-hand-oracle-v1/primary-pdf-sha256:13974058ec36916d7907400d178a88a6f1aaec5769bdd15a99c24d4087857a42", 14,
    ));
    assert_eq!(String::from_utf8(output).unwrap(), concat!(
        "participant_id,attempt_id,clock_id,time_unit,time_precision,P1,R1,P2,R2,P3,R3,P4,R4,",
        "D1,D2,D3,D4,F1Type1,F2Type1,F3Type1,F1Type2,F2Type2,F3Type2,F1Type3,F2Type3,F3Type3,FType4\n",
        "P1,A1,monotonic-supplied,ms,1,0,50,100,150,220,300,400,450,",
        "50,50,80,50,50,70,100,100,150,150,100,120,180,450\n",
    ));
}

#[test]
fn rabbit_public_runner_computes_prepared_weights_rates_and_absent_indicators() {
    // 0.25*8 + 0.75*16 = 14; 0.5*2 + 0.5*6 = 4; 12/4=3, 8/4=2.
    // A separate supplied row has no indicator columns: existing hour/weekday
    // values 99 are overwritten with zero; duration units are not invented.
    for (raw, expected) in [
        (b"source_row_id,f_clicks,f_scrolls,f_session_length,f_hour_of_day_8,f_hour_of_day_16,f_weekday_2,f_weekday_6\nweighted,12,8,4,0.25,0.75,0.5,0.5\n".as_slice(), "weighted,14,4,3,2\n"),
        (b"source_row_id,f_clicks,f_scrolls,f_session_length,f_hour_of_day,f_weekday\nno_indicators,6,2,2,99,99\n".as_slice(), "no_indicators,0,0,3,1\n"),
    ] {
        let output = public_output(RABBIT, raw, "literature-rabbit-hole-prepared-features-csv", (1,1), (
            "doi:10.1145/3604241",
            "rabbit-hole-prepared-features-source-read-hand-fixture-v1/sha256:e6e34595f764ddb941b8b8bec57caa8fbe59167614accdd7eca05f5c62c8cdc8", 1,
        ));
        assert_eq!(String::from_utf8(output).unwrap(), format!(
            "source_row_id,f_hour_of_day,f_weekday,f_click_frequency,f_scroll_frequency\n{expected}"
        ));
    }
}

#[test]
fn public_runner_rejects_nonnumeric_pvt_response() {
    let raw = b"user_id,session,response_time\nA,1,not-a-number\n";
    let error = execute_literature_component_native(PVT, &request(PVT, raw), raw,
        &RuntimeSupportFiles::default()).err().expect("nonnumeric response must fail");
    assert!(error.contains("Python numeric response_time in milliseconds"), "{error}");
}

#[test]
fn public_runner_rejects_missing_four_stroke_clock() {
    let raw = b"participant_id,attempt_id,clock_id,time_unit,time_precision,P1,R1,P2,R2,P3,R3,P4,R4\nP1,A1,,ms,1,0,50,100,150,220,300,400,450\n";
    let error = execute_literature_component_native(TIMING, &request(TIMING, raw), raw,
        &RuntimeSupportFiles::default()).err().expect("missing clock must fail");
    assert!(error.contains("empty required value"), "{error}");
}
#[test]
fn frozen_android_batch_executes_ordinary_public_components_with_exact_artifacts() {
    // Component transport/admission proof. Independent formula/domain hand
    // oracles remain in their named source tests and closed fixture mappings.
    let contract: Value = serde_json::from_str(include_str!("../../../web/schema/literature-input-adapter-contract.json")).unwrap();
    let fixtures: Value = serde_json::from_str(include_str!("fixtures/literature_input_adapter_conformance.json")).unwrap();
    let selected = [
        "chronicle.clear-all-active-notification-grouping/v1",
        "chronicle.notification-payload-cleaning/v1",
        "chronicle.on-bounded-short-off-bridge/v1",
        "chronicle.ethica-foreground-interval-preparation/v1",
        "chronicle.touchstroke-sensor-magnitude/v1",
        "chronicle.touchstroke-four-stroke-timing/v1",
        "chronicle.pvt-relative-response-time/v1",
        "chronicle.rabbit-hole-prepared-features/v1",
        "chronicle.clear-all-unique-notification-items/v1",
        "chronicle.clear-all-notification-appearance-age/v1",
        "chronicle.clear-all-empty-snapshot-fractions/v1",
        "chronicle.hmog-sensor-magnitude/v1",
        "chronicle.hmog-supplied-window-reductions/v1",
        "chronicle.hmog-supplied-stability-search/v1",
        "chronicle.hmog-paired-key-hold/v1",
        "chronicle.hmog-consecutive-press-digraph/v1",
        "chronicle.keyboard-stress-axis-statistics/v1",
        "chronicle.class-ringer-fractions/v1",
        "chronicle.app-postpone-fraction/v1",
        "chronicle.twenty-trial-time-mean/v1",
        "chronicle.non-country-unicity-mean/v1",
        "chronicle.country-unicity-mean/v1",
        "chronicle.frame-unique-app-count/v1",
        "chronicle.session-unique-app-count/v1",
        "chronicle.idle-compressed-clock/v1",
        "chronicle.screenlife-capture-gap-partition/v1",
        "chronicle.resolved-unlock-upper-bound/v1",
        "chronicle.smartphone-usage-reductions/v1",
        "chronicle.prosit-unlock-reductions/v1",
        "chronicle.batterylogger-weighted-estimate/v1",
        "chronicle.attelia-activity-transition-lookup/v1",
        "chronicle.backapp-runtime-arithmetic/v1",
        "chronicle.healthymind-notification-rates/v1",
        "chronicle.healthymind-response-delay/v1",
        "chronicle.fischer-notification-phase-times/v1",
        "chronicle.s3-prepared-sensor-window/v1",
        "chronicle.autosen-prepared-normalization/v1",
        "chronicle.s-adl-literal-selection/v1",
        "chronicle.affectpro-ordered-touch-features/v1",
        "chronicle.supplied-app-fingerprint-unicity/v1",
        "chronicle.s-adl-pair-differences/v1",
        "chronicle.okoshi-notification-latencies/v1",
        "chronicle.large-scale-notification-click-time/v1",
        "chronicle.content-notification-removal-time/v1",
        "chronicle.screen-missing-second-repair/v1",
        "chronicle.fukazawa-supplied-acceleration-magnitude/v1",
        "chronicle.accessibility-phrase-set-difference/v1",
        "chronicle.bod-shape-direction-run-collapse/v1",
        "chronicle.uniform-five-minute-byte-allocation/v1",
        "chronicle.capped-closed-screen-packet-gate/v1",
        "chronicle.ohapp-matched-navigation-time/v1",
        "chronicle.jones-ordered-interlaunch-time/v1",
        "chronicle.touch-box-displacement/v1",
        "chronicle.screenomics-text-image-statistics/v1",
        "chronicle.dismissed-supplied-burst-last/v1",
        "chronicle.annotif-supplied-summary-hash-filter/v1",
        "chronicle.dingler-supplied-foreground-exclusion/v1",
        "chronicle.myphoneme-supplied-response-times/v1",
        "chronicle.monarca-prepared-rms/v1",
        "chronicle.moa2-prepared-calendar/v1",
        "chronicle.rapids-supplied-foreground-reductions/v1",
        "chronicle.rapids-supplied-data-yield/v1",
        "chronicle.nextapp-supplied-opening-counts/v1",
        "chronicle.van-berkel-resolved-session-gap/v1",
        "chronicle.corrected-password-entry-time/v1",
        "chronicle.ordered-app-presence-vector/v1",
        "chronicle.supplied-pre-sample-longest-window/v1",
        "chronicle.habitual-android-duration-bag/v1",
        "chronicle.finesse-later-feature-time/v1",
        "chronicle.supplied-last-syn-rtt/v1",
        "chronicle.supplied-app-session-tap-rate/v1",
        "chronicle.carat-normalized-entropy/v1",
        "chronicle.carat-pair-regularity/v1",
        "chronicle.carat-day-regularity-mean/v1",
        "chronicle.stdd-prepared-axis/v1",
        "chronicle.touchstroke-prepared-mean/v1",
    ];
    assert_eq!(selected.len(), 76);
    for component in selected {
        let group = contract["groups"].as_array().unwrap().iter()
            .find(|g| g["componentExecution"]["componentId"] == component).unwrap();
        let registration = &group["componentExecution"];
        let fixture = &fixtures["groups"].as_array().unwrap().iter()
            .find(|g| g["adapterId"] == component).unwrap()["cases"][0];
        let raw = fixture["rawCsvLines"].as_array().unwrap().iter()
            .map(|v| v.as_str().unwrap()).collect::<Vec<_>>().join("\n") + "\n";
        let raw = raw.as_bytes();
        let expected_rows = match component {
            "chronicle.keyboard-stress-axis-statistics/v1" => 18,
            "chronicle.s3-prepared-sensor-window/v1" => 16,
            "chronicle.monarca-prepared-rms/v1" => 5,
            "chronicle.stdd-prepared-axis/v1" => 9,
            _ => fixture["expected"]["emittedRowCount"].as_u64().unwrap() as u32,
        };
        let mut support = RuntimeSupportFiles::default();
        for role in registration["requiredSupportRoles"].as_array().unwrap() {
            let role = role.as_str().unwrap();
            assert_eq!(role, "study_dates_file");
            let bytes = fixture["supportCsvLines"][role].as_array().unwrap().iter()
                .map(|v| v.as_str().unwrap()).collect::<Vec<_>>().join("\n") + "\n";
            support.put_with_name(role, "component-configuration.csv", bytes.as_bytes()).unwrap();
        }
        let mut handle = execute_literature_component_native(component, &request(component, raw), raw, &support)
            .unwrap_or_else(|e| panic!("{component}: ordinary public execution: {e}"));
        let manifest: LiteratureComponentRuntimeManifest = serde_json::from_str(&handle.manifest_json()).unwrap();
        assert_eq!(manifest.component_id, component);
        assert_eq!(manifest.input_digest, sha256(raw));
        assert_eq!(manifest.source_row_count, fixture["expected"]["sourceRowCount"].as_u64().unwrap() as u32);
        assert_eq!(manifest.derived_result_row_count, expected_rows, "{component}");
        let mut artifacts = BTreeMap::new();
        for index in 0..handle.artifact_count() {
            let metadata: RuntimeArtifactMetadata = serde_json::from_str(&handle.artifact_metadata_json(index).unwrap()).unwrap();
            let bytes = handle.take_artifact_bytes(index).unwrap();
            assert_eq!(metadata.digest, sha256(&bytes), "{component}: artifact bytes");
            assert_eq!(manifest.artifacts[index as usize].digest, metadata.digest);
            assert!(artifacts.insert(metadata.kind, bytes).is_none());
        }
        let execution: LiteratureComponentExecutionReceipt = serde_json::from_slice(
            &artifacts["literature-component-execution-receipt-json"]).unwrap();
        let method: LiteratureComponentMethodReceipt = serde_json::from_slice(
            &artifacts["literature-component-method-receipt-json"]).unwrap();
        let adaptation: Value = serde_json::from_slice(&artifacts["literature-input-adaptation-receipt-json"]).unwrap();
        let output = &artifacts[registration["derivedResultKind"].as_str().unwrap()];
        let text = std::str::from_utf8(output).unwrap();
        assert!(!text.trim().is_empty());
        for value in fixture["expected"]["outputContains"].as_array().unwrap() {
            assert!(text.contains(value.as_str().unwrap()), "{component}: expected {value}");
        }
        for value in fixture["expected"]["outputExcludes"].as_array().unwrap() {
            assert!(!text.contains(value.as_str().unwrap()), "{component}: excluded {value}");
        }
        let expected_settings: Vec<String> = group["methodSettingIds"].as_array().unwrap().iter()
            .chain(registration["additionalMethodSettingIds"].as_array().into_iter().flatten())
            .map(|v| v.as_str().unwrap().to_owned()).collect();
        assert_eq!(execution.component_id, component);
        assert_eq!(execution.setting_ids, expected_settings);
        assert_eq!(method.setting_ids, expected_settings);
        assert_eq!(execution.component_execution_status, "executed");
        assert_eq!(execution.full_profile_execution_status, "blocked");
        assert_eq!(method.parent_profile_execution_status, "blocked");
        assert_eq!(execution.source_work_id, registration["sourceWorkId"].as_str().unwrap());
        assert_eq!(execution.source_method_variant_id, registration["sourceMethodVariantId"].as_str().unwrap());
        assert_eq!(execution.method_profile_version, registration["methodProfileVersion"].as_str().unwrap());
        assert_eq!(execution.oracle_id, registration["sourceOracleId"].as_str().unwrap());
        assert_eq!(execution.original_input_digest, sha256(raw));
        assert_eq!(execution.derived_result_digest, sha256(output));
        assert_eq!(execution.derived_result_row_count, expected_rows);
        assert_eq!(execution.component_method_receipt_digest, sha256(&artifacts["literature-component-method-receipt-json"]));
        assert_eq!(execution.adaptation_receipt_digest, sha256(&artifacts["literature-input-adaptation-receipt-json"]));
        assert_eq!(manifest.component_execution_receipt_digest, sha256(&artifacts["literature-component-execution-receipt-json"]));
        assert_eq!(adaptation["sourceRowCount"], manifest.source_row_count);
        assert_eq!(adaptation["emittedRowCount"], expected_rows);
        assert_eq!(adaptation["originalInputDigest"], sha256(raw));
        assert_eq!(adaptation["adaptedInputDigest"], sha256(output));
        assert!(!execution.kernel_input_eligible);
        assert_eq!(execution.canonical_kernel_input_digest, None);
        assert!(!method.limitations.is_empty());
        println!("ANDROID_COMPONENT_PUBLIC_PROOF {}", json!({
            "component_id":component, "fixture_id":fixture["fixtureId"],
            "input_digest":sha256(raw), "output_digest":sha256(output),
            "source_rows":manifest.source_row_count,"output_rows":expected_rows,
            "setting_ids":expected_settings,"full_profile_status":"blocked",
        }));
    }
}

#[test]
fn nine_paper_no_app_and_zero_na_rules_execute_through_public_runner() {
    let contract:Value=serde_json::from_str(include_str!("../../../web/schema/literature-input-adapter-contract.json")).unwrap();
    let fixtures:Value=serde_json::from_str(include_str!("fixtures/literature_input_adapter_conformance.json")).unwrap();
    for component in ["chronicle.shin-prepared-no-app-day/v1","chronicle.hamilton-supplied-no-use-hour-policy/v1","chronicle.rapids-prepared-resample-categories/v1"] {
        let group=contract["groups"].as_array().unwrap().iter().find(|g|g["componentExecution"]["componentId"]==component).unwrap();
        let registration=&group["componentExecution"];
        let fixture=&fixtures["groups"].as_array().unwrap().iter().find(|g|g["adapterId"]==component).unwrap()["cases"][0];
        let raw=fixture["rawCsvLines"].as_array().unwrap().iter().map(|v|v.as_str().unwrap()).collect::<Vec<_>>().join("\n")+"\n";
        let output=public_output(component,raw.as_bytes(),registration["derivedResultKind"].as_str().unwrap(),
            (fixture["expected"]["sourceRowCount"].as_u64().unwrap() as u32,fixture["expected"]["emittedRowCount"].as_u64().unwrap() as u32),
            (registration["sourceWorkId"].as_str().unwrap(),registration["sourceOracleId"].as_str().unwrap(),group["methodSettingIds"].as_array().unwrap().len()));
        let text=std::str::from_utf8(&output).unwrap();
        for expected in fixture["expected"]["outputContains"].as_array().unwrap() {
            assert!(text.contains(expected.as_str().unwrap()),"{component}: {expected}");
        }
    }
}

#[test]
fn usage_logger_mixed_rows_and_cross_midnight_execute_without_foreground_pairing() {
    // Released Prospective Analysis.ipynb cells3/5/7 and R lines12–86.
    // Calendar keys are supplied source day-of-month, not full date identities.
    let input=json!({"analysis_variant":"continuous_python","calendar_id":"UTC-test-source-local-calendar",
        "complete":true,"events":[
            {"row_id":"on","timestamp_ms":1609545599000_i64,"event":"screen on","day_of_month":1},
            {"row_id":"app","timestamp_ms":1609545599500_i64,"event":"App: Alpha","day_of_month":1},
            {"row_id":"counter","timestamp_ms":1609545600000_i64,"event":"counter: 1","day_of_month":2},
            {"row_id":"off","timestamp_ms":1609545601000_i64,"event":"screen off","day_of_month":2},
            {"row_id":"unmatched","timestamp_ms":1609545610000_i64,"event":"screen on","day_of_month":2}]});
    let mut writer=csv::Writer::from_writer(Vec::new());
    writer.write_record(["source_row_id","participant_id","device_id","source_context_id","clock_id","value_unit_id","input_stage","prepared_input_json"]).unwrap();
    writer.write_record(["r","p","d","window","clock","milliseconds",
        "caller_qualified_usage_logger_analysis_rows_and_calendar",&input.to_string()]).unwrap();
    let raw=writer.into_inner().unwrap();
    let output=public_output("chronicle.usage-logger-released-numeric/v1",&raw,
        "literature-usage-logger-released-numeric-csv",(1,1),(
            "doi:10.3758/s13428-021-01585-7",
            "usage-logger-released-numeric-v1/source-commit:6d1f4d44560ccd9a158c04adb37c6fc988bbbd35",1));
    let row=csv::Reader::from_reader(output.as_slice()).records().next().unwrap().unwrap();
    let result:Value=serde_json::from_str(&row[8]).unwrap();
    assert_eq!(result["screen_duration"],2000);
    assert_eq!(result["daily_screen_duration"][0]["duration"],0);
    assert_eq!(result["daily_screen_duration"][1]["duration"],0);
    assert_eq!(result["apps"][0]["duration"],500);
    assert_eq!(result["retained_rows"][4]["duration"],0);
}

#[test]
fn sdu_outside_freeze_sums_fragments_without_counting_them_as_activations() {
    // SDU §2.4.3: independent daily/hourly screen time and activation totals.
    // One bout crosses an hour: two duration fragments, only one activation.
    let input=json!({"periods":[
        {"period_kind":"day","source_period_id":"supplied-day","complete":true,
         "duration_fragments":[{"fragment_id":"f1","screen_bout_id":"bout","duration_ns":30_000_000_000_u64},
                               {"fragment_id":"f2","screen_bout_id":"bout","duration_ns":30_000_000_001_u64}],
         "activation_ids":["wake"]},
        {"period_kind":"hour","source_period_id":"supplied-hour-2","complete":true,
         "duration_fragments":[{"fragment_id":"f2","screen_bout_id":"bout","duration_ns":30_000_000_001_u64}],
         "activation_ids":[]},
        {"period_kind":"day","source_period_id":"known-empty-day","complete":true,
         "duration_fragments":[],"activation_ids":[]}
    ]});
    let mut writer=csv::Writer::from_writer(Vec::new());
    writer.write_record(["source_row_id","participant_id","device_id","source_context_id","clock_id",
        "value_unit_id","input_stage","prepared_input_json"]).unwrap();
    writer.write_record(["r","p","d","supplied-window","clock","nanoseconds",
        "caller_qualified_complete_sdu_android_period_contributions",&input.to_string()]).unwrap();
    let raw=writer.into_inner().unwrap();
    let output=public_output("chronicle.sdu-supplied-period-reductions/v1",&raw,
        "literature-sdu-supplied-period-reductions-csv",(1,1),
        ("doi:10.1016/j.chbr.2021.100164",
         "sdu-primary-supplied-period-reductions-v1/primary-pdf-sha256:31c48a45306cbc1f9bb9675185bd8aa05e35940999a9b8744e4aa378fe5ae04a",1));
    let row=csv::Reader::from_reader(output.as_slice()).records().next().unwrap().unwrap();
    let result:Value=serde_json::from_str(&row[8]).unwrap();
    assert_eq!(result["periods"][0]["screen_duration_nanoseconds"],"60000000001");
    assert_eq!(result["periods"][0]["screen_duration_seconds"],"60.000000001");
    assert_eq!(result["periods"][0]["screen_activation_count"],1);
    assert_eq!(result["periods"][1]["screen_activation_count"],0);
    assert_eq!(result["periods"][2]["screen_duration_nanoseconds"],"0");
}

#[test]
fn sdu_outside_freeze_validation_transforms_execute_both_operations_with_public_receipts() {
    let fixture:Value=serde_json::from_str(include_str!("fixtures/literature_input_adapter_conformance.json")).unwrap();
    let case=&fixture["groups"].as_array().unwrap().iter()
        .find(|g|g["adapterId"]=="chronicle.sdu-supplied-validation-arithmetic/v1").unwrap()["cases"][0];
    let raw=(case["rawCsvLines"].as_array().unwrap().iter().map(|s|s.as_str().unwrap()).collect::<Vec<_>>().join("\n")+"\n").into_bytes();
    let output=public_output("chronicle.sdu-supplied-validation-arithmetic/v1",&raw,
        "literature-sdu-supplied-validation-arithmetic-csv",(2,2),
        ("doi:10.1016/j.chbr.2021.100164",
         "sdu-primary-supplied-validation-arithmetic-v1/primary-pdf-sha256:31c48a45306cbc1f9bb9675185bd8aa05e35940999a9b8744e4aa378fe5ae04a",1));
    let results=csv::Reader::from_reader(output.as_slice()).records().map(|row|
        serde_json::from_str::<Value>(&row.unwrap()[8]).unwrap()).collect::<Vec<_>>();
    assert_eq!(results[0]["percentage_of_pair_mean"],-20.0);
    assert_eq!(results[0]["difference_orientation"],"supplied SDU minus ActionDash");
    for (i,expected) in [7.0/3.0,4.0,9.0].into_iter().enumerate() {
        assert!((results[1]["targets"][i]["fractional_required_days"].as_f64().unwrap()-expected).abs()<1e-12);
    }
}
