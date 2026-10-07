use chronicle_preprocessing_runtime_wasm::source_timestamp_sessions::{
    compress_idle_gaps, execute_timestamp_stage_csv, partition_captures,
    unlock_cost_upper_bound_ns, TimestampObservation, TimestampStage, FRIDMAN_STREAM_ROLE,
    SCREENLIFE_STREAM_ROLE,
};

fn stage(value: &str) -> TimestampStage {
    match value {
        "idle_compressed_clock" => TimestampStage::IdleCompressedClock,
        "capture_gap_partition" => TimestampStage::CaptureGapPartition,
        "resolved_unlock_upper_bound" => TimestampStage::ResolvedUnlockUpperBound,
        _ => panic!("unknown hand-oracle stage"),
    }
}

#[test]
fn independent_hand_oracles_preserve_every_source_field_and_row() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "fixtures/source_timestamp_sessions_hand_oracle.json"
    ))
    .unwrap();
    for case in fixture["cases"].as_array().unwrap() {
        let input = case["input_csv"].as_str().unwrap().as_bytes();
        let prepared =
            execute_timestamp_stage_csv(input, stage(case["stage"].as_str().unwrap())).unwrap();
        let mut input_reader = csv::Reader::from_reader(input);
        let original_width = input_reader.headers().unwrap().len();
        let original = input_reader
            .records()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        let mut output_reader = csv::Reader::from_reader(prepared.csv_bytes.as_slice());
        let output = output_reader
            .records()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(prepared.row_count, original.len());
        assert_eq!(output.len(), original.len());
        assert_eq!(
            case["expected_extra_rows"].as_array().unwrap().len(),
            output.len()
        );
        for ((before, after), expected) in original
            .iter()
            .zip(&output)
            .zip(case["expected_extra_rows"].as_array().unwrap())
        {
            assert_eq!(
                after.iter().take(original_width).collect::<Vec<_>>(),
                before.iter().collect::<Vec<_>>()
            );
            assert_eq!(
                after.iter().skip(original_width).collect::<Vec<_>>(),
                expected
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|value| value.as_str().unwrap())
                    .collect::<Vec<_>>()
            );
        }
    }
}

fn row(participant: &str, id: &str, clock: &str, timestamp: i64) -> TimestampObservation {
    TimestampObservation {
        participant_id: participant.into(),
        source_row_id: id.into(),
        source_device_id: "device".into(),
        source_stream_id: "stream".into(),
        source_stream_role: FRIDMAN_STREAM_ROLE.into(),
        clock_id: clock.into(),
        timestamp_precision_ns: 1000,
        timestamp_ns: timestamp,
    }
}

fn captures(rows: &[TimestampObservation]) -> Vec<TimestampObservation> {
    rows.iter()
        .cloned()
        .map(|mut row| {
            row.source_stream_role = SCREENLIFE_STREAM_ROLE.into();
            row
        })
        .collect()
}

#[test]
fn no_timestamp_sorting_clock_conversion_or_row_deduplication_is_guessed() {
    for rows in [
        vec![row("A", "a", "c", 2), row("A", "b", "c", 1)],
        vec![row("A", "a", "c", 1), row("A", "b", "other-clock", 2)],
        vec![row("A", "a", "c", 1), row("A", "a", "c", 2)],
        vec![row("", "a", "c", 1)],
        vec![row("A", "a", "", 1)],
    ] {
        assert!(compress_idle_gaps(&rows).is_err());
        assert!(partition_captures(&captures(&rows)).is_err());
    }
    assert!(compress_idle_gaps(&[]).unwrap().is_empty());
    assert!(partition_captures(&[]).unwrap().is_empty());
    let same_timestamp = [row("A", "a", "c", 5), row("A", "b", "c", 5)];
    assert_eq!(
        partition_captures(&captures(&same_timestamp))
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn capture_threshold_is_not_app_usage_or_proximity_gap() {
    let rows = [
        row("A", "a", "c", 0),
        row("A", "b", "c", 7_000_000_000),
        row("A", "c", "c", 14_000_000_001),
    ];
    assert_eq!(
        partition_captures(&captures(&rows))
            .unwrap()
            .iter()
            .map(|value| value.session_ordinal)
            .collect::<Vec<_>>(),
        vec![1, 1, 2]
    );
    assert_eq!(
        compress_idle_gaps(&rows).unwrap()[2].active_interaction_elapsed_ns,
        14_000_000_001
    );
}

#[test]
fn unresolved_wrong_state_noninteger_and_backward_pairs_fail_closed() {
    let header = "participant_id,source_row_id,source_device_id,source_stream_id,source_stream_role,clock_id,timestamp_precision_ns,start_source_row_id,end_source_row_id,start_state,end_state,start_timestamp_ns,end_timestamp_ns\n";
    for record in [
        "A,p,d,s,hardlock_resolved_state_pairs,c,1000,a,b,OFF_LOCKED,ON_UNLOCKED,0,1\n",
        "A,p,d,s,hardlock_resolved_state_pairs,c,1000,a,b,ON_LOCKED,ON_UNLOCKED,0,\n",
        "A,p,d,s,hardlock_resolved_state_pairs,c,1000,a,b,ON_LOCKED,ON_UNLOCKED,1,0\n",
        "A,p,d,s,hardlock_resolved_state_pairs,c,1000,a,b,ON_LOCKED,ON_UNLOCKED,0,1.5\n",
        "A,p,d,s,hardlock_resolved_state_pairs,c,1000,a,a,ON_LOCKED,ON_UNLOCKED,0,1\n",
    ] {
        assert!(execute_timestamp_stage_csv(
            format!("{header}{record}").as_bytes(),
            TimestampStage::ResolvedUnlockUpperBound
        )
        .is_err());
    }
    assert_eq!(
        unlock_cost_upper_bound_ns(i64::MIN, i64::MAX).unwrap(),
        18_446_744_073_709_551_615_i128
    );
}

#[test]
fn csv_rejects_duplicate_columns_computed_inputs_and_precision_loss() {
    for input in [
        "participant_id,source_row_id,source_device_id,source_stream_id,source_stream_role,clock_id,timestamp_precision_ns,timestamp_ns,timestamp_ns\nA,a,d,s,fridman_joint_analyzed_events,c,1000,0,0\n",
        "participant_id,source_row_id,source_device_id,source_stream_id,source_stream_role,clock_id,timestamp_precision_ns,timestamp_ns,active_interaction_elapsed_ns\nA,a,d,s,fridman_joint_analyzed_events,c,1000,0,0\n",
        "participant_id,source_row_id,source_device_id,source_stream_id,source_stream_role,clock_id,timestamp_precision_ns,timestamp_ns\nA,a,d,s,fridman_joint_analyzed_events,c,1000,0.1\n",
        "participant_id,source_row_id,source_device_id,source_stream_id,source_stream_role,clock_id,timestamp_precision_ns,timestamp_ns\nA,a,d,s,fridman_joint_analyzed_events,c,1000,9223372036854775808\n",
    ] {
        assert!(execute_timestamp_stage_csv(input.as_bytes(), TimestampStage::IdleCompressedClock).is_err());
    }
}

#[test]
fn contract_owns_only_existing_source_atoms_and_pins_the_independent_oracle() {
    use sha2::{Digest, Sha256};
    let contract: serde_json::Value = serde_json::from_str(include_str!(concat!(
        env!("CHRONICLE_REPOSITORY_ROOT"),
        "/web/schema/literature-input-adapter-contract.json"
    )))
    .unwrap();
    let digest = hex::encode(Sha256::digest(include_bytes!(
        "fixtures/source_timestamp_sessions_hand_oracle.json"
    )));
    for (stage, source, settings) in [
        (
            TimestampStage::IdleCompressedClock,
            "doi:10.1109/jsyst.2015.2472579",
            vec![
                "method-setting-4eadf32f10dbd271403548bf",
                "method-setting-atomic-3f760ab5e7a2a2a09a98",
                "method-setting-atomic-941f976e5db6d697b337",
                "method-setting-atomic-ad727dbff4371b1f3f33",
            ],
        ),
        (
            TimestampStage::CaptureGapPartition,
            "doi:10.3758/s13428-022-02006-z",
            vec!["method-setting-fa10071bcf13337961f19e36"],
        ),
        (
            TimestampStage::ResolvedUnlockUpperBound,
            "usenix:soups2014:harbach-hard-lock-life",
            vec!["method-setting-210a4202c4b9df1fe287540b"],
        ),
    ] {
        let matches = contract["groups"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|group| group["adapterId"] == stage.adapter_id())
            .collect::<Vec<_>>();
        assert_eq!(matches.len(), 1);
        let group = matches[0];
        assert_eq!(group["methodSettingIds"], serde_json::json!(settings));
        assert_eq!(group["componentExecution"]["sourceWorkId"], source);
        assert_eq!(
            group["componentExecution"]["derivedResultKind"],
            stage.derived_result_kind()
        );
        assert_eq!(
            group["componentExecution"]["fullProfileExecutionStatus"],
            "blocked"
        );
        assert_eq!(
            group["componentExecution"]["sourceOracleId"],
            format!("source-timestamp-sessions-hand-oracle-v1/sha256:{digest}")
        );
    }
}

#[test]
fn same_participant_device_or_stream_interleaving_and_wrong_roles_fail_closed() {
    let baseline = vec![row("A", "a", "c", 100), row("A", "b", "c", 101)];
    for field in [
        "device",
        "stream",
        "role",
        "empty_role",
        "precision",
        "empty_device",
        "empty_stream",
    ] {
        let mut rows = baseline.clone();
        match field {
            "device" => rows[1].source_device_id = "another-device".into(),
            "stream" => rows[1].source_stream_id = "another-stream".into(),
            "role" => rows[1].source_stream_role = "arbitrary_projected_events".into(),
            "empty_role" => rows[1].source_stream_role.clear(),
            "precision" => rows[1].timestamp_precision_ns = 0,
            "empty_device" => rows[1].source_device_id.clear(),
            "empty_stream" => rows[1].source_stream_id.clear(),
            _ => unreachable!(),
        }
        assert!(compress_idle_gaps(&rows).is_err(), "{field}");
        let mut capture_rows = captures(&rows);
        if field == "role" || field == "empty_role" {
            capture_rows[1].source_stream_role = rows[1].source_stream_role.clone();
        }
        assert!(partition_captures(&capture_rows).is_err(), "{field}");
    }
    let header = "participant_id,source_row_id,source_device_id,source_stream_id,source_stream_role,clock_id,timestamp_precision_ns,timestamp_ns";
    for field in [
        "source_device_id",
        "source_stream_id",
        "source_stream_role",
        "timestamp_precision_ns",
    ] {
        let reduced = header
            .split(',')
            .filter(|value| *value != field)
            .collect::<Vec<_>>()
            .join(",");
        assert!(execute_timestamp_stage_csv(
            format!("{reduced}\n").as_bytes(),
            TimestampStage::IdleCompressedClock
        )
        .is_err());
        assert!(execute_timestamp_stage_csv(
            format!("{reduced}\n").as_bytes(),
            TimestampStage::CaptureGapPartition
        )
        .is_err());
    }
}

#[test]
fn declared_precision_is_metadata_not_an_invented_quantization_gate() {
    let mut rows = vec![row("A", "a", "c", -101), row("A", "b", "c", -100)];
    rows[1].timestamp_precision_ns = 2000;
    assert_eq!(
        compress_idle_gaps(&rows).unwrap()[1].active_interaction_elapsed_ns,
        1
    );
    assert_eq!(
        partition_captures(&captures(&rows)).unwrap()[1].preceding_gap_ns,
        Some(1)
    );
    let header = "participant_id,source_row_id,source_device_id,source_stream_id,source_stream_role,clock_id,timestamp_precision_ns,start_source_row_id,end_source_row_id,start_state,end_state,start_timestamp_ns,end_timestamp_ns";
    let prepared = execute_timestamp_stage_csv(format!("{header}\nA,p,d,s,hardlock_resolved_state_pairs,c,1000,a,b,ON_LOCKED,ON_UNLOCKED,-101,-100\nA,q,d,s,hardlock_resolved_state_pairs,c,2000,x,y,ON_LOCKED,ON_UNLOCKED,13,14\n").as_bytes(), TimestampStage::ResolvedUnlockUpperBound).unwrap();
    let output = String::from_utf8(prepared.csv_bytes).unwrap();
    assert!(output.contains(
        "A,p,d,s,hardlock_resolved_state_pairs,c,1000,a,b,ON_LOCKED,ON_UNLOCKED,-101,-100,1\n"
    ));
    assert!(output.contains(
        "A,q,d,s,hardlock_resolved_state_pairs,c,2000,x,y,ON_LOCKED,ON_UNLOCKED,13,14,1\n"
    ));
}

#[test]
fn resolved_pairs_require_explicit_stable_source_scope_not_raw_fsm_inference() {
    let header = "participant_id,source_row_id,source_device_id,source_stream_id,source_stream_role,clock_id,timestamp_precision_ns,start_source_row_id,end_source_row_id,start_state,end_state,start_timestamp_ns,end_timestamp_ns";
    let first = "A,p,d,s,hardlock_resolved_state_pairs,c,1000,a,b,ON_LOCKED,ON_UNLOCKED,0,1";
    for second in [
        "A,q,other,s,hardlock_resolved_state_pairs,c,1000,x,y,ON_LOCKED,ON_UNLOCKED,2,3",
        "A,q,d,other,hardlock_resolved_state_pairs,c,1000,x,y,ON_LOCKED,ON_UNLOCKED,2,3",
        "A,q,d,s,raw_android_events,c,1000,x,y,ON_LOCKED,ON_UNLOCKED,2,3",
        "A,q,d,s,,c,1000,x,y,ON_LOCKED,ON_UNLOCKED,2,3",
        "A,q,d,s,hardlock_resolved_state_pairs,c,0,x,y,ON_LOCKED,ON_UNLOCKED,2,3",
        "A,q,d,s,hardlock_resolved_state_pairs,other,1000,x,y,ON_LOCKED,ON_UNLOCKED,2,3",
    ] {
        assert!(execute_timestamp_stage_csv(
            format!("{header}\n{first}\n{second}\n").as_bytes(),
            TimestampStage::ResolvedUnlockUpperBound
        )
        .is_err());
    }
    for field in [
        "source_device_id",
        "source_stream_id",
        "source_stream_role",
        "timestamp_precision_ns",
    ] {
        let reduced = header
            .split(',')
            .filter(|value| *value != field)
            .collect::<Vec<_>>()
            .join(",");
        assert!(execute_timestamp_stage_csv(
            format!("{reduced}\n").as_bytes(),
            TimestampStage::ResolvedUnlockUpperBound
        )
        .is_err());
    }
}

#[test]
fn source_locked_cases_execute_through_the_normal_public_component_runner() {
    use chronicle_preprocessing_runtime_wasm::{
        execute_literature_component_native, RuntimeArtifactMetadata, RuntimeRequest,
        RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND, RUNTIME_PROTOCOL_VERSION,
    };
    use sha2::{Digest, Sha256};
    let digest = |bytes: &[u8]| format!("sha256:{}", hex::encode(Sha256::digest(bytes)));
    let fixtures: serde_json::Value = serde_json::from_str(include_str!(
        "fixtures/literature_input_adapter_conformance.json"
    ))
    .unwrap();
    for stage in [
        TimestampStage::IdleCompressedClock,
        TimestampStage::CaptureGapPartition,
        TimestampStage::ResolvedUnlockUpperBound,
    ] {
        let component = format!("{}/v1", stage.adapter_id());
        let group = fixtures["groups"]
            .as_array()
            .unwrap()
            .iter()
            .find(|g| g["adapterId"] == component)
            .unwrap();
        let case = &group["cases"][0];
        let raw = case["rawCsvLines"]
            .as_array()
            .unwrap()
            .iter()
            .map(|line| line.as_str().unwrap())
            .collect::<Vec<_>>()
            .join("\n")
            + "\n";
        let request = RuntimeRequest {
            protocol_version: RUNTIME_PROTOCOL_VERSION.into(),
            request_id: component.clone(),
            command: EXECUTE_WORKSPACE_COMMAND.into(),
            workspace_root_digest: None,
            workspace_id: digest(b"source-timestamp-sessions-hand-workspace"),
            input_file_name: "qualified-source-timestamps.csv".into(),
            input_sha256: digest(raw.as_bytes()),
            known_review_summary_digests: None,
            participant_partition_batch_id: None,
            fragmented_participant_tokens: Vec::new(),
            method_profile_receipt: None,
            method_profile_receipts: Vec::new(),
            execution_engine: chronicle_preprocessing_runtime_wasm::ExecutionEngine::Sequential,
            provenance_evidence: false,
            options: serde_json::from_value(serde_json::json!({
                "study_name": "Source timestamp component hand oracle",
                "timezone": "UTC", "usage_session_mode": "app_usage",
                "include_app_output": true, "include_screen_output": false,
                "use_filter_file": false, "use_apps_forcing_screen_open": false,
                "use_app_codebook": false, "correct_duplicate_event_timestamps": false,
                "allow_stop_event_reuse": false, "use_activity_stopped_as_fallback": true,
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
            }))
            .unwrap(),
        };
        let mut handle = execute_literature_component_native(
            &component,
            &serde_json::to_string(&request).unwrap(),
            raw.as_bytes(),
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let manifest: serde_json::Value = serde_json::from_str(&handle.manifest_json()).unwrap();
        assert_eq!(
            manifest["sourceRowCount"],
            case["expected"]["sourceRowCount"]
        );
        assert_eq!(
            manifest["derivedResultRowCount"],
            case["expected"]["emittedRowCount"]
        );
        let mut output = None;
        for index in 0..handle.artifact_count() {
            let metadata: RuntimeArtifactMetadata =
                serde_json::from_str(&handle.artifact_metadata_json(index).unwrap()).unwrap();
            let bytes = handle.take_artifact_bytes(index).unwrap();
            assert_eq!(metadata.digest, digest(&bytes));
            if metadata.kind == stage.derived_result_kind() {
                output = Some(String::from_utf8(bytes).unwrap());
            }
        }
        let output = output.unwrap();
        for text in case["expected"]["outputContains"].as_array().unwrap() {
            assert!(
                output.contains(text.as_str().unwrap()),
                "{component}: {output}"
            );
        }
    }
}
