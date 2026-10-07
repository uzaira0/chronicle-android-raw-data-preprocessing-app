//! Independent constructed inventories and hand outcomes. No author code or cohort data.
//! Primary p3, rank132:132–149, SHA256
//! 59639ddbada613877a6750bac09df32160d5567744ab9e7cb0ff8e39cdf55e4a.
//! Audit required_execution_proofs: minimum-missing-window / eligibility-boundaries.

use chronicle_preprocessing_runtime_wasm::literature_input_adapters::{
    adapt_literature_inputs, literature_component_execution_unit,
};
use chronicle_preprocessing_runtime_wasm::supplied_hourly_screen_window_selection::{
    execute_supplied_hourly_screen_window_selection_csv, INPUT_FIELDS,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const COMPONENT: &str = "chronicle.supplied-hourly-screen-window-selection/v1";

fn day(order: i64, missing_hours: &[usize]) -> Value {
    // 24 hours are fixture data, NOT the product's assumed day length.
    let ids = (0..24).map(|hour| format!("H{hour}")).collect::<Vec<_>>();
    let states = ids
        .iter()
        .enumerate()
        .map(|(hour, id)| {
            json!([
                id,
                if missing_hours.contains(&hour) {
                    "missing"
                } else {
                    "valid_empty"
                }
            ])
        })
        .collect::<Vec<_>>();
    json!({"source_day_id":format!("D{order}"),"day_order":order,
        "expected_hour_ids":ids,"hour_states":states})
}

fn candidate(id: &str, start: i64) -> Value {
    json!({"candidate_id":id,"start_day_order":start,
        "source_day_ids":(0..30).map(|offset|format!("D{}",start+offset)).collect::<Vec<_>>()})
}

fn row(participant: &str, app_days: &str, days: Vec<Value>, candidates: Vec<Value>) -> Vec<String> {
    vec![
        participant.into(),
        "device".into(),
        "stream".into(),
        "clock".into(),
        "inventory".into(),
        app_days.into(),
        "complete".into(),
        serde_json::to_string(
            &days
                .iter()
                .map(|d| d["source_day_id"].as_str().unwrap())
                .collect::<Vec<_>>(),
        )
        .unwrap(),
        serde_json::to_string(&days).unwrap(),
        serde_json::to_string(
            &candidates
                .iter()
                .map(|c| c["candidate_id"].as_str().unwrap())
                .collect::<Vec<_>>(),
        )
        .unwrap(),
        serde_json::to_string(&candidates).unwrap(),
    ]
}

fn encode(rows: &[Vec<String>]) -> Vec<u8> {
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(INPUT_FIELDS).unwrap();
    for row in rows {
        writer.write_record(row).unwrap();
    }
    writer.into_inner().unwrap()
}

fn run(rows: &[Vec<String>]) -> Result<Vec<csv::StringRecord>, String> {
    let prepared = execute_supplied_hourly_screen_window_selection_csv(&encode(rows))?;
    assert_eq!(prepared.row_count, rows.len());
    let output = csv::Reader::from_reader(prepared.csv_bytes.as_slice())
        .records()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(output.len(), rows.len());
    for (input, output) in rows.iter().zip(&output) {
        assert_eq!(
            input.iter().map(String::as_str).collect::<Vec<_>>(),
            output.iter().take(INPUT_FIELDS.len()).collect::<Vec<_>>()
        );
    }
    Ok(output)
}

fn valid_days() -> Vec<Value> {
    (0..30).map(|order| day(order, &[])).collect()
}

#[test]
fn lower_missing_hour_count_wins_despite_equal_observed_date_counts() {
    // Both windows have data on ALL 30 dates. Common D1..D29 has 696 valid
    // hours. D0 has two missing and D30 one: early=2, late=1, each total720.
    let days = (0..31)
        .map(|order| match order {
            0 => day(order, &[0, 1]),
            30 => day(order, &[0]),
            _ => day(order, &[]),
        })
        .collect();
    let result = run(&[row(
        "P",
        "31",
        days,
        vec![candidate("early", 0), candidate("late", 1)],
    )])
    .unwrap();
    assert_eq!(
        result[0].iter().skip(11).take(6).collect::<Vec<_>>(),
        ["selected", "late", "1", "30", "1", "720"]
    );
    let selected: Value = serde_json::from_str(&result[0][18]).unwrap();
    assert_eq!(selected.as_array().unwrap().len(), 30);
    assert_eq!(selected[0]["source_day_id"], "D1");
    assert_eq!(selected[29]["source_day_id"], "D30");
    assert_eq!(selected[29]["hour_states"][0], json!(["H0", "missing"]));
}

#[test]
fn exact_objective_tie_uses_earliest_supplied_order_not_input_or_lexical_order() {
    // Both=1 missing,720 total; late appears FIRST and its ID sorts first.
    let days = (0..31)
        .map(|order| day(order, if order == 0 || order == 30 { &[0] } else { &[] }))
        .collect();
    let result = run(&[row(
        "P",
        "31",
        days,
        vec![candidate("A-late", 1), candidate("Z-early", 0)],
    )])
    .unwrap();
    assert_eq!(
        result[0].iter().skip(11).take(6).collect::<Vec<_>>(),
        ["selected", "Z-early", "0", "29", "1", "720"]
    );
}

#[test]
fn observation_days_and_valid_empty_hours_are_not_observed_date_proxies() {
    let mut fully_missing_day = valid_days();
    fully_missing_day[0] = day(0, &(0..24).collect::<Vec<_>>());
    let results = run(&[
        row("29", "29", valid_days(), vec![candidate("window", 0)]),
        row(
            "fractional",
            "29.5",
            valid_days(),
            vec![candidate("window", 0)],
        ),
        row(
            "30-zero-use",
            "30",
            valid_days(),
            vec![candidate("window", 0)],
        ),
        row(
            "30-with-missing-day",
            "30",
            fully_missing_day,
            vec![candidate("window", 0)],
        ),
    ])
    .unwrap();
    assert_eq!(&results[0][11], "excluded-less-than-30-observation-days");
    assert_eq!(&results[1][11], "excluded-less-than-30-observation-days");
    // Valid zero-use is DATA; no fake screen-time amount is required to select.
    assert_eq!((&results[2][11], &results[2][15]), ("selected", "0"));
    // App observation30 is not 30 distinct dates containing valid screen data.
    assert_eq!((&results[3][11], &results[3][15]), ("selected", "24"));
}

#[test]
fn all_missing_exclusion_uses_full_hour_inventory_not_candidate_only() {
    let missing = (0..30)
        .map(|order| day(order, &(0..24).collect::<Vec<_>>()))
        .collect::<Vec<_>>();
    let result = run(&[row(
        "P",
        "30",
        missing.clone(),
        vec![candidate("all-missing", 0)],
    )])
    .unwrap();
    assert_eq!(&result[0][11], "excluded-100-percent-missing");
    assert!(result[0].iter().skip(12).all(str::is_empty));
    let mut some_elsewhere = missing;
    some_elsewhere.push(day(30, &[]));
    let result = run(&[row(
        "P",
        "31",
        some_elsewhere,
        vec![candidate("missing-candidate", 0)],
    )])
    .unwrap();
    // Data outside supplied candidates makes this participant NOT100%missing.
    // Unknown candidate-grid construction is not repaired by fabricating another.
    assert_eq!(
        (&result[0][11], &result[0][12], &result[0][15]),
        ("selected", "missing-candidate", "720")
    );
}

#[test]
fn known_empty_unknown_absent_and_zero_are_distinct() {
    let mut empty = row("P", "29", vec![], vec![]);
    empty[6] = "known_empty".into();
    assert_eq!(
        &run(&[empty.clone()]).unwrap()[0][11],
        "excluded-less-than-30-observation-days"
    );
    empty[5] = "30".into();
    assert!(run(&[empty.clone()])
        .unwrap_err()
        .contains("cannot establish"));
    empty[5] = "29".into();
    empty[6] = "unknown".into();
    assert!(run(&[empty.clone()])
        .unwrap_err()
        .contains("unknown is not empty"));
    empty[6] = "complete".into();
    assert!(run(&[empty]).unwrap_err().contains("must be nonempty"));
    let mut absent = row("P", "30", valid_days(), vec![candidate("window", 0)]);
    absent[8] = String::new();
    assert!(run(&[absent])
        .unwrap_err()
        .contains("invalid hourly_days_json"));
    // Zero subjects is a valid typed table, NOT evidence about any participant.
    assert!(run(&[]).unwrap().is_empty());
}

#[test]
fn missing_expected_members_unknown_states_and_duplicate_hours_fail_closed() {
    let base = row("P", "30", valid_days(), vec![candidate("window", 0)]);
    for change in [
        "absent-hour",
        "unknown",
        "partial",
        "duplicate-hour",
        "absent-day",
        "absent-candidate",
        "extra-field",
    ] {
        let mut input = base.clone();
        let mut days: Value = serde_json::from_str(&input[8]).unwrap();
        match change {
            "absent-hour" => {
                days[0]["hour_states"].as_array_mut().unwrap().pop();
            }
            "unknown" | "partial" => {
                days[0]["hour_states"][0][1] = json!(change);
            }
            "duplicate-hour" => {
                days[0]["hour_states"][1] = days[0]["hour_states"][0].clone();
            }
            "absent-day" => {
                days.as_array_mut().unwrap().pop();
            }
            "absent-candidate" => {
                input[10] = "[]".into();
            }
            "extra-field" => {
                days[0]["guessed_timezone"] = json!("UTC");
            }
            _ => unreachable!(),
        }
        input[8] = days.to_string();
        assert!(run(&[input]).is_err(), "{change}");
    }
}

#[test]
fn candidate_length_order_bounds_and_duplicate_starts_are_not_guessed() {
    for change in [
        "29-days",
        "31-days",
        "swapped-days",
        "absent-reference",
        "duplicate-start",
    ] {
        let mut input = row("P", "30", valid_days(), vec![candidate("window", 0)]);
        let mut candidates: Value = serde_json::from_str(&input[10]).unwrap();
        match change {
            "29-days" => {
                candidates[0]["source_day_ids"]
                    .as_array_mut()
                    .unwrap()
                    .pop();
            }
            "31-days" => {
                candidates[0]["source_day_ids"]
                    .as_array_mut()
                    .unwrap()
                    .push(json!("D30"));
            }
            "swapped-days" => {
                candidates[0]["source_day_ids"]
                    .as_array_mut()
                    .unwrap()
                    .swap(0, 1);
            }
            "absent-reference" => {
                candidates[0]["source_day_ids"][0] = json!("absent");
            }
            "duplicate-start" => {
                candidates
                    .as_array_mut()
                    .unwrap()
                    .push(candidate("duplicate", 0));
                input[9] = json!(["window", "duplicate"]).to_string();
            }
            _ => unreachable!(),
        }
        input[10] = candidates.to_string();
        assert!(run(&[input]).is_err(), "{change}");
    }
    // Exact integer arithmetic at both limits; overflow must not wrap chronology.
    let start = i64::MAX - 29;
    let days = (0..30).map(|offset| day(start + offset, &[])).collect();
    let result = run(&[row("P", "30", days, vec![candidate("limit", start)])]).unwrap();
    assert_eq!(&result[0][14], i64::MAX.to_string());
    let mut input = row("P", "30", valid_days(), vec![candidate("window", 0)]);
    let mut days: Value = serde_json::from_str(&input[8]).unwrap();
    days[0]["day_order"] = json!(i64::MAX);
    input[8] = days.to_string();
    let mut candidates: Value = serde_json::from_str(&input[10]).unwrap();
    candidates[0]["start_day_order"] = json!(i64::MAX);
    input[10] = candidates.to_string();
    assert!(run(&[input]).unwrap_err().contains("overflow"));
    let start = i64::MIN;
    let days = (0..30).map(|offset| day(start + offset, &[])).collect();
    assert_eq!(
        &run(&[row("P", "30", days, vec![candidate("min", start)])]).unwrap()[0][13],
        start.to_string()
    );
}

#[test]
fn supplied_hour_multiplicity_and_variable_day_lengths_are_preserved_not_inferred() {
    let mut days = valid_days();
    // Caller supplies23hours for one day,25 for another; total remains720.
    days[0]["expected_hour_ids"].as_array_mut().unwrap().pop();
    days[0]["hour_states"].as_array_mut().unwrap().pop();
    days[1]["expected_hour_ids"]
        .as_array_mut()
        .unwrap()
        .push(json!("H1-fold2"));
    days[1]["hour_states"]
        .as_array_mut()
        .unwrap()
        .push(json!(["H1-fold2", "missing"]));
    let result = run(&[row("P", "30", days, vec![candidate("window", 0)])]).unwrap();
    assert_eq!((&result[0][15], &result[0][16]), ("1", "720"));
    let selected: Value = serde_json::from_str(&result[0][18]).unwrap();
    assert_eq!(selected[0]["hour_states"].as_array().unwrap().len(), 23);
    assert_eq!(
        selected[1]["hour_states"][24],
        json!(["H1-fold2", "missing"])
    );
}

#[test]
fn missing_count_not_fraction_is_the_objective_and_observed_hours_are_data() {
    // Early has2/719 missing; late has2/720. Counts tie, so early wins even
    // though the late candidate has the smaller missing fraction.
    let mut days = (0..31)
        .map(|order| {
            day(
                order,
                if order == 0 || order == 30 {
                    &[0, 1]
                } else {
                    &[]
                },
            )
        })
        .collect::<Vec<_>>();
    days[0]["expected_hour_ids"].as_array_mut().unwrap().pop();
    days[0]["hour_states"].as_array_mut().unwrap().pop();
    days[1]["hour_states"][0][1] = json!("valid_observed");
    let output = run(&[row(
        "P",
        "31",
        days,
        vec![candidate("late", 1), candidate("early", 0)],
    )])
    .unwrap();
    assert_eq!(
        output[0].iter().skip(11).take(6).collect::<Vec<_>>(),
        ["selected", "early", "0", "29", "2", "719"]
    );
    let selected: Value = serde_json::from_str(&output[0][18]).unwrap();
    assert_eq!(
        selected[1]["hour_states"][0],
        json!(["H0", "valid_observed"])
    );
}

#[test]
fn blank_and_duplicate_expected_scope_members_are_not_normalized_or_deduplicated() {
    let base = row("P", "30", valid_days(), vec![candidate("window", 0)]);
    for field in [7, 9] {
        let mut input = base.clone();
        let mut ids: Value = serde_json::from_str(&input[field]).unwrap();
        let duplicate = ids[0].clone();
        ids.as_array_mut().unwrap().push(duplicate);
        input[field] = ids.to_string();
        assert!(run(&[input]).is_err());
    }
    for change in [
        "blank-day",
        "blank-hour",
        "blank-candidate",
        "duplicate-day-order",
        "duplicate-expected-hour",
    ] {
        let mut input = base.clone();
        let mut days: Value = serde_json::from_str(&input[8]).unwrap();
        let mut candidates: Value = serde_json::from_str(&input[10]).unwrap();
        match change {
            "blank-day" => {
                days[0]["source_day_id"] = json!(" ");
            }
            "blank-hour" => {
                days[0]["hour_states"][0][0] = json!(" ");
            }
            "blank-candidate" => {
                candidates[0]["candidate_id"] = json!(" ");
            }
            "duplicate-day-order" => {
                days[1]["day_order"] = days[0]["day_order"].clone();
            }
            "duplicate-expected-hour" => {
                days[0]["expected_hour_ids"][1] = days[0]["expected_hour_ids"][0].clone();
            }
            _ => unreachable!(),
        }
        input[8] = days.to_string();
        input[10] = candidates.to_string();
        assert!(run(&[input]).is_err(), "{change}");
    }
}

#[test]
fn lexical_identity_and_participant_device_stream_clock_scopes_do_not_merge() {
    let left = row("P", "30", valid_days(), vec![candidate("window", 0)]);
    let mut right = row(" P ", "30", valid_days(), vec![candidate(" window ", 0)]);
    right[1] = " device ".into();
    right[2] = " stream ".into();
    right[3] = " clock ".into();
    right[4] = " inventory ".into();
    let output = run(&[left.clone(), right]).unwrap();
    assert_eq!(
        (
            &output[1][0],
            &output[1][1],
            &output[1][2],
            &output[1][3],
            &output[1][4],
            &output[1][12]
        ),
        (
            " P ",
            " device ",
            " stream ",
            " clock ",
            " inventory ",
            " window "
        )
    );
    for position in 1..5 {
        let mut conflicting = left.clone();
        conflicting[position] = "other".into();
        assert!(run(&[left.clone(), conflicting])
            .unwrap_err()
            .contains("one complete inventory"));
    }
    for position in 0..5 {
        let mut blank = left.clone();
        blank[position] = " \t ".into();
        assert!(run(&[blank]).unwrap_err().contains("nonblank"));
    }
    // Raw lexical day/hour identities are references, not normalized labels.
    let mut input = left;
    let mut days: Value = serde_json::from_str(&input[8]).unwrap();
    days[0]["source_day_id"] = json!(" D0 ");
    days[0]["expected_hour_ids"][0] = json!(" H0 ");
    days[0]["hour_states"][0][0] = json!(" H0 ");
    input[8] = days.to_string();
    let mut expected: Value = serde_json::from_str(&input[7]).unwrap();
    expected[0] = json!(" D0 ");
    input[7] = expected.to_string();
    let mut candidates: Value = serde_json::from_str(&input[10]).unwrap();
    candidates[0]["source_day_ids"][0] = json!(" D0 ");
    input[10] = candidates.to_string();
    let output = run(&[input.clone()]).unwrap();
    let selected: Value = serde_json::from_str(&output[0][18]).unwrap();
    assert_eq!(selected[0]["source_day_id"], " D0 ");
    assert_eq!(selected[0]["hour_states"][0][0], " H0 ");
    candidates[0]["source_day_ids"][0] = json!("D0");
    input[10] = candidates.to_string();
    assert!(run(&[input]).unwrap_err().contains("absent source day"));
}

#[test]
fn invalid_duration_and_column_inventories_are_rejected() {
    for value in ["NaN", "inf", "-1", "", "unknown"] {
        assert!(run(&[row("P", value, valid_days(), vec![candidate("window", 0)])]).is_err());
    }
    let raw = encode(&[row("P", "30", valid_days(), vec![candidate("window", 0)])]);
    let text = String::from_utf8(raw).unwrap();
    assert!(execute_supplied_hourly_screen_window_selection_csv(
        text.replacen("clock_id", "source_stream_id", 1).as_bytes()
    )
    .is_err());
}

#[test]
fn registered_csv_adapter_executes_the_exact_reserved_setting_and_conformance() {
    let (registration, bindings) = literature_component_execution_unit(COMPONENT).unwrap();
    assert_eq!(
        registration.source_work_id,
        "doi:10.1371/journal.pone.0165331"
    );
    assert_eq!(
        registration.source_method_variant_id,
        "source-audit-configuration-space-be21ec1a1be1e1b8a204ee5a"
    );
    assert_eq!(registration.full_profile_execution_status, "blocked");
    assert_eq!(bindings.len(), 1);
    assert_eq!(
        bindings[0].setting_id,
        "method-setting-f3a91215d6dd05d6a693451f"
    );
    assert_eq!(
        bindings[0].source_value["definition"]["candidate_length_source_days"],
        30
    );
    let raw = encode(&[row("P", "30", valid_days(), vec![candidate("window", 0)])]);
    let digest = format!("sha256:{}", hex::encode(Sha256::digest(&raw)));
    let adapted = adapt_literature_inputs(&raw, &digest, &bindings, |_| &[])
        .unwrap()
        .unwrap();
    assert_eq!(adapted.receipt.original_input_digest, digest);
    assert_eq!(adapted.receipt.source_row_count, 1);
    assert_eq!(adapted.receipt.emitted_row_count, 1);
    assert_eq!(adapted.receipt.mapped_event_row_count, 0);
    assert_eq!(adapted.receipt.materialized_interval_count, 0);
    assert_eq!(adapted.receipt.participants_removed, 0);
    let bytes = adapted.derived_result_bytes.unwrap();
    assert_eq!(adapted.csv_bytes, bytes);
    assert_eq!(
        adapted.receipt.adapted_input_digest,
        format!("sha256:{}", hex::encode(Sha256::digest(&bytes)))
    );
    let output = csv::Reader::from_reader(bytes.as_slice())
        .records()
        .next()
        .unwrap()
        .unwrap();
    assert_eq!(
        output.iter().skip(11).take(6).collect::<Vec<_>>(),
        ["selected", "window", "0", "29", "0", "720"]
    );
    let mut tampered = bindings.clone();
    tampered[0].source_value["definition"]["candidate_length_source_days"] = json!(29);
    assert!(adapt_literature_inputs(&raw, &digest, &tampered, |_| &[]).is_err());
}

#[test]
fn public_runner_requires_normal_generated_registration_and_materializes_selection() {
    use chronicle_chrono_kernel_wasm::pipeline_v2::PipelineV2OptionsJson;
    use chronicle_preprocessing_runtime_wasm::{
        execute_literature_component_native, RuntimeArtifactMetadata, RuntimeRequest,
        RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND, RUNTIME_PROTOCOL_VERSION,
    };
    let raw = encode(&[row("P", "30", valid_days(), vec![candidate("window", 0)])]);
    let digest = format!("sha256:{}", hex::encode(Sha256::digest(&raw)));
    let options: PipelineV2OptionsJson = serde_json::from_value(json!({
        "study_name":"Supplied hourly window selection", "timezone":"UTC", "usage_session_mode":"app_usage",
        "include_app_output":true, "include_screen_output":false, "use_filter_file":false,
        "use_apps_forcing_screen_open":false, "use_app_codebook":false,
        "correct_duplicate_event_timestamps":false, "allow_stop_event_reuse":false,
        "use_activity_stopped_as_fallback":true, "apply_threshold_to_fallback":true,
        "long_duration_threshold_ns":43_200_000_000_000_i64, "custom_app_engagement_duration":300.0,
        "long_data_time_gap_thresholds":[1.0,2.0], "long_usage_duration_thresholds":[1.0,2.0],
        "same_app_stop_types":["Activity Paused","Activity Resumed"], "other_stop_types":["Activity Resumed","Device Shutdown"],
        "interaction_types_to_remove":[], "screen_auto_lock_timeout_seconds":120.0,
        "screen_auto_lock_tolerance_seconds":30.0, "screen_manual_lock_max_tail_seconds":30.0,
        "screen_keyguard_near_stop_seconds":2.0, "datetime_of_preprocessing":"2026-09-29 00:00:00 UTC", "minimum_usage_duration":0.0
    })).unwrap();
    let request = serde_json::to_string(&RuntimeRequest {
        protocol_version: RUNTIME_PROTOCOL_VERSION.into(),
        request_id: COMPONENT.into(),
        command: EXECUTE_WORKSPACE_COMMAND.into(),
        workspace_root_digest: None,
        workspace_id: digest.clone(),
        input_file_name: "supplied-hourly-inventory.csv".into(),
        input_sha256: digest,
        known_review_summary_digests: None,
        participant_partition_batch_id: None,
        fragmented_participant_tokens: Vec::new(),
        method_profile_receipt: None,
        method_profile_receipts: Vec::new(),
        execution_engine: chronicle_preprocessing_runtime_wasm::ExecutionEngine::Sequential,
        provenance_evidence: false,
        options,
    })
    .unwrap();
    let (registration, bindings) = literature_component_execution_unit(COMPONENT).unwrap();
    let expected = adapt_literature_inputs(&raw, "fixture-input", &bindings, |_| &[])
        .unwrap()
        .unwrap()
        .derived_result_bytes
        .unwrap();
    let mut handle=execute_literature_component_native(COMPONENT,&request,&raw,&RuntimeSupportFiles::default())
        .expect("sole canonical integration must normally regenerate the closed source registry before public-runner proof");
    let manifest: Value = serde_json::from_str(&handle.manifest_json()).unwrap();
    assert_eq!(manifest["sourceRowCount"], 1);
    assert_eq!(manifest["derivedResultRowCount"], 1);
    let mut found = false;
    for index in 0..handle.artifact_count() {
        let metadata: RuntimeArtifactMetadata =
            serde_json::from_str(&handle.artifact_metadata_json(index).unwrap()).unwrap();
        let bytes = handle.take_artifact_bytes(index).unwrap();
        assert_eq!(
            metadata.digest,
            format!("sha256:{}", hex::encode(Sha256::digest(&bytes)))
        );
        if metadata.kind == registration.derived_result_kind {
            assert_eq!(bytes, expected);
            found = true;
        }
    }
    assert!(found);
}
