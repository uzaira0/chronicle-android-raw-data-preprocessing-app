use chronicle_preprocessing_runtime_wasm::screenomics_text_image_statistics::{
    execute_screenomics_statistics_csv, grayscale_entropy_bits, new_unique_word_count, word_count,
    FIVE_SECOND_PRIOR, NO_PRIOR, OUTPUT_FIELDS, TEMPORAL_PRIOR,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const FIXTURE: &str = include_str!("fixtures/screenomics_text_image_hand_oracle.json");
const COMPONENT: &str = "chronicle.screenomics-text-image-statistics/v1";
const SOURCE: &str = "doi:10.1016/j.chb.2020.106570";

fn fixture() -> Value {
    serde_json::from_str(FIXTURE).unwrap()
}
fn raw() -> Vec<u8> {
    let fixture = fixture();
    let lines = fixture["cases"][0]["rawCsvLines"]
        .as_array()
        .unwrap()
        .iter()
        .map(|line| line.as_str().unwrap())
        .collect::<Vec<_>>();
    format!("{}\n", lines.join("\n")).into_bytes()
}
fn digest(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}
fn table(bytes: &[u8]) -> (csv::StringRecord, Vec<csv::StringRecord>) {
    let mut reader = csv::Reader::from_reader(bytes);
    let headers = reader.headers().unwrap().clone();
    let rows = reader.records().collect::<Result<Vec<_>, _>>().unwrap();
    (headers, rows)
}
fn cell<'a>(headers: &csv::StringRecord, row: &'a csv::StringRecord, name: &str) -> &'a str {
    &row[headers.iter().position(|field| field == name).unwrap()]
}
fn edited(input: &[u8], changes: &[(usize, &str, String)]) -> Vec<u8> {
    let (headers, rows) = table(input);
    let mut rows = rows
        .iter()
        .map(|row| row.iter().map(str::to_owned).collect::<Vec<_>>())
        .collect::<Vec<_>>();
    for (row, field, value) in changes {
        rows[*row][headers.iter().position(|name| name == *field).unwrap()] = value.clone();
    }
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(&headers).unwrap();
    for row in rows {
        writer.write_record(row).unwrap();
    }
    writer.into_inner().unwrap()
}
fn assert_hand_output(bytes: &[u8]) {
    let input = raw();
    let (before_headers, before) = table(&input);
    let (after_headers, after) = table(bytes);
    let mut expected_header = before_headers.clone();
    expected_header.extend(OUTPUT_FIELDS);
    assert_eq!(after_headers, expected_header);
    assert_eq!(after.len(), 4);
    let fixture = fixture();
    let expected = fixture["cases"][0]["expectedAppendedRows"]
        .as_array()
        .unwrap();
    for ((before, after), expected) in before.iter().zip(&after).zip(expected) {
        assert_eq!(
            before.iter().collect::<Vec<_>>(),
            after.iter().take(before_headers.len()).collect::<Vec<_>>()
        );
        assert_eq!(
            after.iter().skip(before_headers.len()).collect::<Vec<_>>(),
            expected
                .as_array()
                .unwrap()
                .iter()
                .map(|value| value.as_str().unwrap())
                .collect::<Vec<_>>()
        );
    }
    assert_eq!(after[1], after[2]); // Repeated whole rows/source IDs remain occurrences.
}

#[test]
fn primary_hand_oracle_preserves_lexical_words_captures_row_order_and_duplicates() {
    let result = execute_screenomics_statistics_csv(&raw()).unwrap();
    assert_eq!(result.row_count, 4);
    assert_hand_output(&result.csv_bytes);
}

#[test]
fn independent_entropy_math_uses_bits_and_zero_bin_limits_without_empty_image_zero() {
    let mut bins = vec![0; 256];
    bins[255] = 9;
    assert_eq!(grayscale_entropy_bits(&bins), Ok(0.0));
    bins[0] = 9;
    assert_eq!(grayscale_entropy_bits(&bins), Ok(1.0));
    bins.fill(1);
    assert_eq!(grayscale_entropy_bits(&bins), Ok(8.0));
    bins.fill(0);
    bins[0] = 3;
    bins[1] = 1;
    // -(3/4)log2(3/4)-(1/4)log2(1/4), calculated independently.
    assert!((grayscale_entropy_bits(&bins).unwrap() - 0.8112781244591328).abs() < 1e-14);
    bins.fill(u64::MAX); // Exact u128 total prevents overflow before probabilities.
    assert_eq!(grayscale_entropy_bits(&bins), Ok(8.0));
    assert!(grayscale_entropy_bits(&[0; 256]).is_err());
    assert!(grayscale_entropy_bits(&[1; 255]).is_err());
    let current = ["old", "old", "A"].map(str::to_owned);
    let prior = ["A", "new", "new"].map(str::to_owned);
    assert_eq!(word_count(&current), 3);
    assert_eq!(new_unique_word_count(&current, &prior), 1);
    assert_eq!(word_count(&[]), 0);
    assert_eq!(new_unique_word_count(&[], &prior), 0);
    // These are uncapped source atoms. The separately owned 150 cap is not
    // silently imported into their independent arithmetic.
    let many = (0..151).map(|i| format!("word{i}")).collect::<Vec<_>>();
    assert_eq!(word_count(&many), 151);
    assert_eq!(new_unique_word_count(&many, &[]), 151);
}

#[test]
fn explicit_relation_not_raw_clock_sorting_or_precision_controls_pair_calculations() {
    let input = edited(
        &raw(),
        &[
            (1, "prior_relation", TEMPORAL_PRIOR.into()),
            (
                1,
                "capture_timestamp",
                "a nonnumeric unsorted opaque token".into(),
            ),
            (
                1,
                "prior_capture_timestamp",
                "999999999999999999999999999999999999".into(),
            ),
            (1, "time_precision", "7".into()),
            (1, "prior_time_precision", "11".into()),
        ],
    );
    let result = execute_screenomics_statistics_csv(&input).unwrap();
    let (headers, rows) = table(&result.csv_bytes);
    assert_eq!(cell(&headers, &rows[1], "word_count"), "8");
    assert_eq!(cell(&headers, &rows[1], "new_unique_word_count"), "");
    assert_eq!(
        cell(&headers, &rows[1], "new_unique_word_count_status"),
        "unavailable:prior_five_second_relation_not_supplied"
    );
    assert_eq!(cell(&headers, &rows[1], "absolute_entropy_delta_bits"), "1");
    assert_eq!(cell(&headers, &rows[1], "time_precision"), "7");
    assert_eq!(cell(&headers, &rows[1], "prior_time_precision"), "11");
    assert_eq!(
        cell(&headers, &rows[1], "capture_timestamp"),
        "a nonnumeric unsorted opaque token"
    );
    // Nothing decodes raw clocks; the caller explicitly supplies the5s relation.
    let input = edited(&input, &[(1, "prior_relation", FIVE_SECOND_PRIOR.into())]);
    let result = execute_screenomics_statistics_csv(&input).unwrap();
    let (headers, rows) = table(&result.csv_bytes);
    assert_eq!(cell(&headers, &rows[1], "new_unique_word_count"), "6");
    let input = edited(
        &input,
        &[(1, "prior_clock_id", "clock-with-other-origin".into())],
    );
    let result = execute_screenomics_statistics_csv(&input).unwrap();
    let (headers, rows) = table(&result.csv_bytes);
    assert_eq!(cell(&headers, &rows[1], "image_entropy_bits"), "1");
    assert_eq!(cell(&headers, &rows[1], "word_count"), "8");
    assert_eq!(
        cell(&headers, &rows[1], "absolute_entropy_delta_status"),
        "unavailable:incompatible_supplied_clock_or_unit_metadata"
    );
    // Decreasing entropy 0 minus 2 must produce absolute delta 2, not -2 or
    // division by an invented timestamp difference.
    let mut mono = vec![0; 256];
    mono[0] = 4;
    let mut four = vec![0; 256];
    four[..4].fill(1);
    let input = edited(
        &raw(),
        &[
            (
                1,
                "grayscale_histogram_json",
                serde_json::to_string(&mono).unwrap(),
            ),
            (
                1,
                "prior_grayscale_histogram_json",
                serde_json::to_string(&four).unwrap(),
            ),
        ],
    );
    let result = execute_screenomics_statistics_csv(&input).unwrap();
    let (headers, rows) = table(&result.csv_bytes);
    assert_eq!(cell(&headers, &rows[1], "image_entropy_bits"), "0");
    assert_eq!(cell(&headers, &rows[1], "absolute_entropy_delta_bits"), "2");
}

#[test]
fn missing_modalities_predecessors_and_zero_total_are_not_fabricated_zero() {
    let blank = edited(
        &raw(),
        &[
            (1, "words_json", "".into()),
            (1, "grayscale_histogram_json", "".into()),
        ],
    );
    let result = execute_screenomics_statistics_csv(&blank).unwrap();
    let (headers, rows) = table(&result.csv_bytes);
    assert_eq!(
        cell(&headers, &rows[1], "word_count_status"),
        "unavailable:current_word_ensemble_not_supplied"
    );
    assert_eq!(
        cell(&headers, &rows[1], "image_entropy_status"),
        "unavailable:current_histogram_not_supplied"
    );
    let zero = edited(
        &raw(),
        &[(
            1,
            "grayscale_histogram_json",
            serde_json::to_string(&vec![0; 256]).unwrap(),
        )],
    );
    let result = execute_screenomics_statistics_csv(&zero).unwrap();
    let (headers, rows) = table(&result.csv_bytes);
    assert_eq!(cell(&headers, &rows[1], "word_count"), "8");
    assert_eq!(cell(&headers, &rows[1], "new_unique_word_count"), "6");
    assert_eq!(cell(&headers, &rows[1], "image_entropy_bits"), "");
    assert_eq!(cell(&headers, &rows[1], "absolute_entropy_delta_bits"), "");
    assert_eq!(
        cell(&headers, &rows[1], "image_entropy_status"),
        "unavailable:zero_total_histogram_source_behavior_undisclosed"
    );
    for kept_payload in ["words_json", "grayscale_histogram_json"] {
        let (headers, rows) = table(&raw());
        let selected = headers
            .iter()
            .enumerate()
            .filter(|(_, name)| !name.ends_with("_json") || *name == kept_payload)
            .map(|(index, _)| index)
            .collect::<Vec<_>>();
        let mut writer = csv::Writer::from_writer(Vec::new());
        writer
            .write_record(selected.iter().map(|&index| &headers[index]))
            .unwrap();
        for row in &rows {
            writer
                .write_record(selected.iter().map(|&index| &row[index]))
                .unwrap();
        }
        let input = writer.into_inner().unwrap();
        assert_eq!(
            execute_screenomics_statistics_csv(&input)
                .unwrap()
                .row_count,
            4
        );
    }
}

#[test]
fn malformed_payloads_or_forged_pair_ownership_fail_closed_without_normalizing() {
    for words in ["null", "[1]", "[\"\"]", "[\"two words\"]", "not-json"] {
        assert!(execute_screenomics_statistics_csv(&edited(
            &raw(),
            &[(1, "words_json", words.into())]
        ))
        .is_err());
    }
    for histogram in ["null", "[]", "[1]", "[-1]", "[0.5]", "not-json"] {
        assert!(execute_screenomics_statistics_csv(&edited(
            &raw(),
            &[(1, "grayscale_histogram_json", histogram.into())]
        ))
        .is_err());
    }
    for field in [
        "prior_participant_id",
        "prior_device_id",
        "prior_source_stream_id",
        "prior_capture_id",
    ] {
        let changed = if field == "prior_capture_id" {
            "capture1"
        } else {
            "foreign-owner"
        };
        assert!(
            execute_screenomics_statistics_csv(&edited(&raw(), &[(1, field, changed.into())]))
                .is_err()
        );
    }
    // Trailing whitespace is distinct ownership, not a trimmed match.
    assert!(execute_screenomics_statistics_csv(&edited(
        &raw(),
        &[(1, "prior_participant_id", "P".into())]
    ))
    .is_err());
    assert!(execute_screenomics_statistics_csv(&edited(
        &raw(),
        &[(1, "prior_relation", "ordinary_usage_events".into())]
    ))
    .is_err());
    assert!(execute_screenomics_statistics_csv(&edited(
        &raw(),
        &[(1, "prior_relation", NO_PRIOR.into())]
    ))
    .is_err());
    let (headers, _) = table(&raw());
    let header = headers.iter().collect::<Vec<_>>().join(",");
    assert!(
        execute_screenomics_statistics_csv(format!("{header},word_count\n").as_bytes()).is_err()
    );
    assert!(
        execute_screenomics_statistics_csv(format!("{header},participant_id\n").as_bytes())
            .is_err()
    );
    let empty = execute_screenomics_statistics_csv(format!("{header}\n").as_bytes()).unwrap();
    assert_eq!(empty.row_count, 0);
    assert!(table(&empty.csv_bytes).1.is_empty());
}

#[test]
fn registered_csv_adapter_computes_exact_owners_and_source_bound_receipt_without_forgery() {
    use chronicle_preprocessing_runtime_wasm::literature_input_adapters::{
        adapt_literature_inputs, literature_component_execution_unit, validate_input_bindings,
    };
    let (registration, bindings) = literature_component_execution_unit(COMPONENT).unwrap();
    assert_eq!(registration.source_work_id, SOURCE);
    assert_eq!(registration.full_profile_execution_status, "blocked");
    assert_eq!(bindings.len(), 4);
    let input = raw();
    let result = adapt_literature_inputs(&input, &digest(&input), &bindings, |_| &[])
        .unwrap()
        .unwrap();
    assert_hand_output(&result.csv_bytes);
    assert_eq!(result.receipt.original_input_digest, digest(&input));
    assert_eq!(
        result.receipt.adapted_input_digest,
        digest(&result.csv_bytes)
    );
    assert_eq!(result.receipt.source_row_count, 4);
    assert_eq!(result.receipt.emitted_row_count, 4);
    assert_eq!(result.receipt.duplicate_source_ids_removed, 0);
    assert_eq!(result.receipt.setting_ids.len(), 4);
    println!(
        "screenomics_adapter_proof input={} output={} source_rows={} output_rows={} settings={}",
        result.receipt.original_input_digest,
        result.receipt.adapted_input_digest,
        result.receipt.source_row_count,
        result.receipt.emitted_row_count,
        result.receipt.setting_ids.len()
    );
    assert_eq!(
        result.receipt.derived_result.as_ref().unwrap().digest,
        digest(&result.csv_bytes)
    );
    assert_eq!(
        result.derived_result_bytes.as_ref().unwrap(),
        &result.csv_bytes
    );
    let mut forged = bindings;
    forged[0].source_value = json!("invented source normalization");
    assert!(validate_input_bindings(&forged).is_err());
}

#[test]
fn ordinary_public_runtime_exports_hand_values_and_verified_artifact_receipts() {
    use chronicle_preprocessing_runtime_wasm::{
        execute_literature_component_native, LiteratureComponentExecutionReceipt,
        LiteratureComponentMethodReceipt, LiteratureComponentRuntimeManifest,
        RuntimeArtifactMetadata, RuntimeRequest, RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND,
        RUNTIME_PROTOCOL_VERSION,
    };
    use std::collections::BTreeMap;
    let input = raw();
    let request = RuntimeRequest {
        protocol_version:RUNTIME_PROTOCOL_VERSION.into(), request_id:"screenomics-hand-case".into(),
        command:EXECUTE_WORKSPACE_COMMAND.into(), workspace_root_digest:None,
        workspace_id:digest(b"screenomics-hand-workspace"), input_file_name:"supplied-capture-statistics.csv".into(),
        input_sha256:digest(&input), known_review_summary_digests:None, participant_partition_batch_id:None,
        fragmented_participant_tokens:Vec::new(), method_profile_receipt:None, method_profile_receipts:Vec::new(),
        execution_engine: chronicle_preprocessing_runtime_wasm::ExecutionEngine::Sequential,
        provenance_evidence: false,
        options:serde_json::from_value(json!({
            "study_name":"Screenomics typed statistics", "timezone":"UTC", "usage_session_mode":"app_usage",
            "include_app_output":true, "include_screen_output":false, "use_filter_file":false,
            "use_apps_forcing_screen_open":false, "use_app_codebook":false,
            "correct_duplicate_event_timestamps":false, "allow_stop_event_reuse":false,
            "use_activity_stopped_as_fallback":true, "apply_threshold_to_fallback":true,
            "long_duration_threshold_ns":43_200_000_000_000_i64, "custom_app_engagement_duration":300.0,
            "long_data_time_gap_thresholds":[1.0,2.0], "long_usage_duration_thresholds":[1.0,2.0],
            "same_app_stop_types":["Activity Paused","Activity Resumed"], "other_stop_types":["Activity Resumed","Device Shutdown"],
            "interaction_types_to_remove":[], "screen_auto_lock_timeout_seconds":120.0,
            "screen_auto_lock_tolerance_seconds":30.0, "screen_manual_lock_max_tail_seconds":30.0,
            "screen_keyguard_near_stop_seconds":2.0, "datetime_of_preprocessing":"2026-09-29 00:00:00 UTC",
            "minimum_usage_duration":0.0
        })).unwrap(),
    };
    let mut handle = execute_literature_component_native(
        COMPONENT,
        &serde_json::to_string(&request).unwrap(),
        &input,
        &RuntimeSupportFiles::default(),
    )
    .unwrap();
    let manifest: LiteratureComponentRuntimeManifest =
        serde_json::from_str(&handle.manifest_json()).unwrap();
    assert_eq!(manifest.input_digest, digest(&input));
    assert_eq!(
        (manifest.source_row_count, manifest.derived_result_row_count),
        (4, 4)
    );
    let mut artifacts = BTreeMap::new();
    for index in 0..handle.artifact_count() {
        let metadata: RuntimeArtifactMetadata =
            serde_json::from_str(&handle.artifact_metadata_json(index).unwrap()).unwrap();
        let bytes = handle.take_artifact_bytes(index).unwrap();
        assert_eq!(metadata.digest, digest(&bytes));
        artifacts.insert(metadata.kind, bytes);
    }
    let output = &artifacts["literature-screenomics-text-image-statistics-csv"];
    assert_hand_output(output);
    let method: LiteratureComponentMethodReceipt =
        serde_json::from_slice(&artifacts["literature-component-method-receipt-json"]).unwrap();
    let execution: LiteratureComponentExecutionReceipt =
        serde_json::from_slice(&artifacts["literature-component-execution-receipt-json"]).unwrap();
    let adaptation: Value =
        serde_json::from_slice(&artifacts["literature-input-adaptation-receipt-json"]).unwrap();
    assert_eq!(method.source_work_id, SOURCE);
    assert_eq!(method.parent_profile_execution_status, "blocked");
    assert_eq!(method.setting_ids.len(), 4);
    assert_eq!(execution.setting_ids, method.setting_ids);
    assert_eq!(execution.full_profile_execution_status, "blocked");
    assert!(!execution.kernel_input_eligible);
    assert_eq!(execution.original_input_digest, digest(&input));
    assert_eq!(execution.derived_result_digest, digest(output));
    assert_eq!(adaptation["originalInputDigest"], digest(&input));
    assert_eq!(adaptation["derivedResult"]["digest"], digest(output));
    assert_eq!(adaptation["sourceRowCount"], 4);
    assert_eq!(adaptation["emittedRowCount"], 4);
}
