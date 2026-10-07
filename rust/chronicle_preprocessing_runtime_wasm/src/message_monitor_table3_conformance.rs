use super::*;
use serde_json::{json, Value};

const FIXTURE: &str = include_str!("../tests/fixtures/message_monitor_table3_hand_oracle.json");
fn fixture() -> Value {
    serde_json::from_str(FIXTURE).unwrap()
}
fn adapter(kind: &str) -> &'static str {
    if kind == "recency" {
        RECENCY
    } else {
        COUNT
    }
}
fn fields(kind: &str) -> &'static [&'static str] {
    if kind == "recency" {
        &RECENCY_FIELDS
    } else {
        &COUNT_FIELDS
    }
}
fn case(id: &str) -> Value {
    fixture()["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == id)
        .unwrap()
        .clone()
}
fn input(case: &Value) -> Vec<u8> {
    let mut f = fields(case["kind"].as_str().unwrap()).to_vec();
    f.push("opaque");
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(&f).unwrap();
    for row in case["rows"].as_array().unwrap() {
        writer
            .write_record(f.iter().map(|field| {
                row.get(*field)
                    .and_then(Value::as_str)
                    .unwrap_or(if *field == "opaque" { "keep  " } else { "" })
            }))
            .unwrap();
    }
    writer.into_inner().unwrap()
}
fn table(bytes: &[u8]) -> (csv::StringRecord, Vec<csv::StringRecord>) {
    let mut r = csv::Reader::from_reader(bytes);
    (
        r.headers().unwrap().clone(),
        r.records().collect::<Result<_, _>>().unwrap(),
    )
}
fn assert_output(case: &Value, raw: &[u8], output: &[u8]) {
    let (h, rows) = table(raw);
    let (out_h, out_rows) = table(output);
    let mut expected_h = h.clone();
    expected_h.extend(
        if case["kind"] == "recency" {
            RECENCY_OUT.as_slice()
        } else {
            COUNT_OUT.as_slice()
        }
        .iter()
        .copied(),
    );
    assert_eq!(out_h, expected_h);
    assert_eq!(out_rows.len(), rows.len());
    for (i, (before, after)) in rows.iter().zip(&out_rows).enumerate() {
        assert_eq!(
            before.iter().collect::<Vec<_>>(),
            after.iter().take(h.len()).collect::<Vec<_>>()
        );
        assert_eq!(
            &after[h.len()],
            case["values"][i].as_str().unwrap(),
            "{} row{i}",
            case["id"]
        );
        if case["kind"] == "recency" {
            assert_eq!(&after[h.len() + 1], case["statuses"][i].as_str().unwrap());
        }
    }
}
#[test]
fn message_monitor_table3_primary_hand_math() {
    for case in fixture()["cases"].as_array().unwrap() {
        let raw = input(case);
        let (output, n, _) = execute_csv(&raw, adapter(case["kind"].as_str().unwrap())).unwrap();
        assert_eq!(n, case["rows"].as_array().unwrap().len());
        assert_output(case, &raw, &output);
    }
}
fn refusal(case: &Value, expected: &str) {
    let raw = input(case);
    let kind = case["kind"].as_str().unwrap();
    assert!(execute_csv(&raw, adapter(kind))
        .unwrap_err()
        .contains(expected));
    let (_, bindings) =
        super::super::literature_component_execution_unit(&format!("{}/v1", adapter(kind)))
            .unwrap();
    match super::super::adapt_literature_inputs(&raw, &crate::sha256(&raw), &bindings, |_| &[]) {
        Err(error) => assert!(error.contains(expected), "{error}"),
        Ok(_) => panic!("contradictory Table3 input adapted"),
    }
    println!(
        "table3_refusal case={} input={} expected={expected}",
        case["id"],
        crate::sha256(&raw)
    );
}
#[test]
fn message_monitor_table3_known_fact_role_and_membership_guards() {
    let base = case("positive-complementary-remains-unavailable");
    for reverse in [false, true] {
        let mut c = base.clone();
        c["rows"][1]["evaluation_timestamp"] = json!("5");
        if reverse {
            c["rows"].as_array_mut().unwrap().reverse();
        }
        refusal(&c, "known last anchor follows");
    }
    let mut c = case("eight-source-recencies-and-whole-duplicate");
    c["rows"][0]["last_event_role"] = json!("screen_on");
    refusal(&c, "eligible unique-last anchor role");
    let mut c = case("eight-source-recencies-and-whole-duplicate");
    c["rows"][2]["last_event_id"] = json!("screen_off source event");
    c["rows"][2]["last_event_role"] = json!("screen_off");
    c["rows"][2]["last_timestamp"] = json!("3000");
    refusal(&c, "later eligible anchor");
    for field in [
        "evaluation_timestamp",
        "evaluation_clock_id",
        "evaluation_precision",
    ] {
        let mut c = case("eight-source-recencies-and-whole-duplicate");
        c["rows"][1][field] = json!(if field == "evaluation_timestamp" {
            "10001"
        } else if field == "evaluation_precision" {
            "12"
        } else {
            "other"
        });
        refusal(&c, "contradictory known Table3 coordinate");
    }
    let mut c = case("eight-source-recencies-and-whole-duplicate");
    let mut row = c["rows"][0].clone();
    row["last_event_id"] = json!("different selected last");
    c["rows"].as_array_mut().unwrap().push(row);
    refusal(&c, "unique-last selection");
    for reverse in [false, true] {
        let mut c = case("complete-unveiled-inventory-known-empty-and-occurrences");
        c["rows"].as_array_mut().unwrap().truncate(2);
        c["rows"][1]["pending_item_ids_json"] = json!("[]");
        if reverse {
            c["rows"].as_array_mut().unwrap().reverse();
        }
        refusal(&c, "contradictory complete Table3 inventory");
    }
    for (field, value, error) in [
        ("last_timestamp", "1.5", "signed i64"),
        ("last_precision", "0", "positive integer"),
        ("last_time_unit", "ticks", "ns/us/ms/s"),
        (
            "last_anchor_selection_stage",
            "automatic-latest-by-sort",
            "eligible unique-last",
        ),
        ("feature_name", "IsInPocket", "unknown named"),
    ] {
        let mut c = case("eight-source-recencies-and-whole-duplicate");
        c["rows"][0][field] = json!(value);
        refusal(&c, error);
    }
    let mut c = case("complete-unveiled-inventory-known-empty-and-occurrences");
    c["rows"][0]["pending_membership_stage"] = json!("raw-notification-queue");
    refusal(&c, "complete caller-qualified");
}
#[test]
fn message_monitor_table3_literal_independent_owners_and_metadata_only_precision() {
    let mut c = case("complete-unveiled-inventory-known-empty-and-occurrences");
    c["rows"].as_array_mut().unwrap().truncate(1);
    let mut row = c["rows"][0].clone();
    row["participant_id"] = json!("P");
    row["pending_item_ids_json"] = json!("[]");
    c["rows"].as_array_mut().unwrap().push(row);
    c["values"] = json!(["3", "0"]);
    let raw = input(&c);
    assert_output(&c, &raw, &execute_csv(&raw, COUNT).unwrap().0);
    let mut c = case("eight-source-recencies-and-whole-duplicate");
    c["rows"].as_array_mut().unwrap().truncate(1);
    c["values"] = json!(["9"]);
    c["statuses"] = json!(["computed_supplied_Table3_anchor_arithmetic"]);
    c["rows"][0]["last_precision"] = json!("999999");
    c["rows"][0]["evaluation_precision"] = json!("12345");
    let raw = input(&c);
    assert_output(&c, &raw, &execute_csv(&raw, RECENCY).unwrap().0); // No modulo/constant-precision gate.
    for a in ADAPTERS {
        let f = if a == RECENCY {
            RECENCY_FIELDS.as_slice()
        } else {
            COUNT_FIELDS.as_slice()
        };
        assert!(execute_csv(format!("{},{}\n", f.join(","), f[0]).as_bytes(), a).is_err());
        let out = if a == RECENCY {
            RECENCY_OUT[0]
        } else {
            COUNT_OUT[0]
        };
        assert!(execute_csv(format!("{},{out}\n", f.join(",")).as_bytes(), a).is_err());
    }
}
#[test]
fn message_monitor_table3_registered_source_tuples_and_receipts() {
    for case in fixture()["cases"].as_array().unwrap() {
        let a = adapter(case["kind"].as_str().unwrap());
        let (registration, bindings) =
            super::super::literature_component_execution_unit(&format!("{a}/v1")).unwrap();
        assert_eq!(bindings.len(), 1);
        assert_eq!(registration.full_profile_execution_status, "blocked");
        assert_eq!(registration.source_work_id, "doi:10.1145/2556288.2556973");
        assert_eq!(
            registration.source_method_variant_id,
            "source-audit-configuration-space-ac9d613ce0e277945cfd4a71"
        );
        assert_eq!(
            registration.source_oracle_id,
            format!(
                "message-monitor-Table3-hand-oracle-v1/{}",
                crate::sha256(FIXTURE.as_bytes())
            )
        );
        let raw = input(case);
        let digest = crate::sha256(&raw);
        let result = super::super::adapt_literature_inputs(&raw, &digest, &bindings, |_| &[])
            .unwrap()
            .unwrap();
        assert_output(case, &raw, &result.csv_bytes);
        assert_eq!(result.receipt.original_input_digest, digest);
        assert_eq!(
            result.receipt.adapted_input_digest,
            crate::sha256(&result.csv_bytes)
        );
        assert_eq!(
            result.receipt.source_row_count as usize,
            case["rows"].as_array().unwrap().len()
        );
        assert_eq!(
            result.receipt.emitted_row_count,
            result.receipt.source_row_count
        );
        assert_eq!(result.receipt.duplicate_source_ids_removed, 0);
        assert_eq!(
            result.derived_result_bytes.as_deref(),
            Some(result.csv_bytes.as_slice())
        );
        assert_eq!(
            result.receipt.derived_result.as_ref().unwrap().digest,
            crate::sha256(&result.csv_bytes)
        );
        println!(
            "table3_registered case={} input={} output={} rows={}",
            case["id"],
            digest,
            result.receipt.adapted_input_digest,
            result.receipt.emitted_row_count
        );
        let mut forged = bindings;
        forged[0].source_value = json!("invented raw pending/history constructor");
        assert!(super::super::validate_input_bindings(&forged).is_err());
    }
}
fn public(case: &Value) {
    use crate::{
        LiteratureComponentExecutionReceipt, LiteratureComponentMethodReceipt,
        LiteratureComponentRuntimeManifest, RuntimeArtifactMetadata, RuntimeRequest,
        RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND, RUNTIME_PROTOCOL_VERSION,
    };
    let raw = input(case);
    let a = adapter(case["kind"].as_str().unwrap());
    let request=RuntimeRequest {execution_engine:crate::ExecutionEngine::Sequential,provenance_evidence:false,protocol_version:RUNTIME_PROTOCOL_VERSION.into(),request_id:"message-monitor-table3".into(),command:EXECUTE_WORKSPACE_COMMAND.into(),workspace_root_digest:None,workspace_id:crate::sha256(b"table3-hand-workspace"),input_file_name:"prepared-table3.csv".into(),input_sha256:crate::sha256(&raw),known_review_summary_digests:None,participant_partition_batch_id:None,fragmented_participant_tokens:vec![],method_profile_receipt:None,method_profile_receipts:vec![],options:serde_json::from_value(json!({
        "study_name":"Supplied Table3","timezone":"UTC","usage_session_mode":"app_usage","include_app_output":true,"include_screen_output":false,"use_filter_file":false,"use_apps_forcing_screen_open":false,"use_app_codebook":false,"correct_duplicate_event_timestamps":false,"allow_stop_event_reuse":false,"use_activity_stopped_as_fallback":true,"apply_threshold_to_fallback":true,"long_duration_threshold_ns":43_200_000_000_000_i64,"custom_app_engagement_duration":300.0,"long_data_time_gap_thresholds":[1.0,2.0],"long_usage_duration_thresholds":[1.0,2.0],"same_app_stop_types":["Activity Paused","Activity Resumed"],"other_stop_types":["Activity Resumed","Device Shutdown"],"interaction_types_to_remove":[],"screen_auto_lock_timeout_seconds":120.0,"screen_auto_lock_tolerance_seconds":30.0,"screen_manual_lock_max_tail_seconds":30.0,"screen_keyguard_near_stop_seconds":2.0,"datetime_of_preprocessing":"2026-09-29 00:00:00 UTC","minimum_usage_duration":0.0
    })).unwrap()};
    let result = crate::execute_literature_component_native(
        &format!("{a}/v1"),
        &serde_json::to_string(&request).unwrap(),
        &raw,
        &RuntimeSupportFiles::default(),
    );
    if let Some(expected) = case["error"].as_str() {
        let error = match result {
            Err(e) => e,
            Ok(_) => panic!("contradictory Table3 public input returned a handle"),
        };
        assert!(error.contains(expected), "{error}");
        println!(
            "table3_public_refusal input={} error={error}",
            crate::sha256(&raw)
        );
        return;
    }
    let mut handle = result.unwrap();
    let manifest: LiteratureComponentRuntimeManifest =
        serde_json::from_str(&handle.manifest_json()).unwrap();
    assert_eq!(manifest.input_digest, crate::sha256(&raw));
    assert_eq!(
        manifest.source_row_count as usize,
        case["rows"].as_array().unwrap().len()
    );
    assert_eq!(manifest.derived_result_row_count, manifest.source_row_count);
    let mut artifacts = BTreeMap::new();
    for i in 0..handle.artifact_count() {
        let meta: RuntimeArtifactMetadata =
            serde_json::from_str(&handle.artifact_metadata_json(i).unwrap()).unwrap();
        let bytes = handle.take_artifact_bytes(i).unwrap();
        assert_eq!(meta.digest, crate::sha256(&bytes));
        artifacts.insert(meta.kind, bytes);
    }
    let (_, _, kind) = execute_csv(&raw, a).unwrap();
    let output = &artifacts[kind];
    assert_output(case, &raw, output);
    let method: LiteratureComponentMethodReceipt =
        serde_json::from_slice(&artifacts["literature-component-method-receipt-json"]).unwrap();
    let execution: LiteratureComponentExecutionReceipt =
        serde_json::from_slice(&artifacts["literature-component-execution-receipt-json"]).unwrap();
    let adaptation: Value =
        serde_json::from_slice(&artifacts["literature-input-adaptation-receipt-json"]).unwrap();
    assert_eq!(method.component_id, format!("{a}/v1"));
    assert_eq!(method.source_work_id, "doi:10.1145/2556288.2556973");
    assert_eq!(
        method.source_method_variant_id,
        "source-audit-configuration-space-ac9d613ce0e277945cfd4a71"
    );
    assert_eq!(
        method.method_profile_version,
        "literature-sublation-v3-atomic+source-complete-v1"
    );
    assert_eq!(method.setting_ids.len(), 1);
    assert_eq!(method.parent_profile_execution_status, "blocked");
    assert_eq!(execution.full_profile_execution_status, "blocked");
    assert!(!execution.kernel_input_eligible);
    assert_eq!(execution.source_work_id, method.source_work_id);
    assert_eq!(
        execution.source_method_variant_id,
        method.source_method_variant_id
    );
    assert_eq!(
        execution.method_profile_version,
        method.method_profile_version
    );
    assert_eq!(execution.setting_ids, method.setting_ids);
    assert_eq!(
        execution.component_method_receipt_digest,
        crate::sha256(&artifacts["literature-component-method-receipt-json"])
    );
    assert_eq!(
        execution.adaptation_receipt_digest,
        crate::sha256(&artifacts["literature-input-adaptation-receipt-json"])
    );
    assert_eq!(execution.original_input_digest, crate::sha256(&raw));
    assert_eq!(execution.derived_result_digest, crate::sha256(output));
    assert_eq!(
        adaptation["sourceRowCount"],
        case["rows"].as_array().unwrap().len()
    );
    assert_eq!(
        adaptation["emittedRowCount"],
        case["rows"].as_array().unwrap().len()
    );
    assert_eq!(adaptation["originalInputDigest"], crate::sha256(&raw));
    assert_eq!(adaptation["adaptedInputDigest"], crate::sha256(output));
    println!(
        "table3_public case={} input={} output={} rows={}",
        case["id"],
        crate::sha256(&raw),
        crate::sha256(output),
        manifest.source_row_count
    );
}
#[test]
fn message_monitor_table3_public_native_recencies() {
    for case in fixture()["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|case| case["kind"] == "recency")
    {
        public(case);
    }
    for reverse in [false, true] {
        let mut c = case("positive-complementary-remains-unavailable");
        c["rows"][1]["evaluation_timestamp"] = json!("5");
        if reverse {
            c["rows"].as_array_mut().unwrap().reverse();
        }
        c["error"] = json!("known last anchor follows");
        public(&c);
    }
}
#[test]
fn message_monitor_table3_public_native_pending_count() {
    for case in fixture()["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|case| case["kind"] == "count")
    {
        public(case);
    }
    for reverse in [false, true] {
        let mut c = case("complete-unveiled-inventory-known-empty-and-occurrences");
        c["rows"].as_array_mut().unwrap().truncate(2);
        c["rows"][1]["pending_item_ids_json"] = json!("[]");
        if reverse {
            c["rows"].as_array_mut().unwrap().reverse();
        }
        c["error"] = json!("contradictory complete Table3 inventory");
        public(&c);
    }
}

fn cross_evaluation_case() -> Value {
    let mut a = case("eight-source-recencies-and-whole-duplicate")["rows"][0].clone();
    a["source_row_id"] = json!("cross A");
    a["evaluation_id"] = json!("evaluation A");
    a["last_event_id"] = json!("event a");
    a["last_timestamp"] = json!("10");
    a["evaluation_timestamp"] = json!("100");
    a["last_time_unit"] = json!("s");
    a["evaluation_time_unit"] = json!("s");
    let mut b = a.clone();
    b["source_row_id"] = json!("cross B");
    b["evaluation_id"] = json!("evaluation B");
    b["last_event_id"] = json!("event b");
    b["last_timestamp"] = json!("50");
    b["evaluation_timestamp"] = json!("200");
    json!({
        "id":"cross-evaluation-fully-known", "kind":"recency",
        "sourceLocator":"MessageMonitor primary PDFp7/printed3325 Table3 row01; known supplied last<candidate<evaluation only",
        "rows":[a,b], "values":["90","150"],
        "statuses":["computed_supplied_Table3_anchor_arithmetic","computed_supplied_Table3_anchor_arithmetic"]
    })
}
fn cross_evaluation_negative_cases() -> Vec<Value> {
    let base = cross_evaluation_case();
    let mut declarations = vec![base.clone()];
    for field in [
        "last_clock_id",
        "last_time_unit",
        "last_precision",
        "evaluation_clock_id",
        "evaluation_time_unit",
        "evaluation_precision",
        "complementary_timestamps",
    ] {
        let mut c = base.clone();
        c["id"] = json!(format!("cross-evaluation-merged-{field}"));
        let mut rows = Vec::new();
        for row in base["rows"].as_array().unwrap() {
            let mut first = row.clone();
            let mut second = row.clone();
            second["source_row_id"] = json!(format!(
                "{} complementary",
                row["source_row_id"].as_str().unwrap()
            ));
            if field == "complementary_timestamps" {
                first["evaluation_timestamp"] = json!("");
            } else {
                first[field] = json!("");
            }
            second["last_timestamp"] = json!("");
            rows.extend([first, second]);
        }
        c["rows"] = json!(rows);
        declarations.push(c);
    }
    declarations
        .into_iter()
        .flat_map(|c| {
            [false, true].map(move |reverse| {
                let mut c = c.clone();
                c["id"] = json!(format!(
                    "{}-{}",
                    c["id"].as_str().unwrap(),
                    if reverse { "reverse" } else { "forward" }
                ));
                if reverse {
                    c["rows"].as_array_mut().unwrap().reverse();
                }
                c
            })
        })
        .collect()
}
fn registered(case: &Value, raw: &[u8]) -> Result<super::super::AdaptedLiteratureInput, String> {
    let (_, bindings) = super::super::literature_component_execution_unit(&format!(
        "{}/v1",
        adapter(case["kind"].as_str().unwrap())
    ))?;
    super::super::adapt_literature_inputs(raw, &crate::sha256(raw), &bindings, |_| &[])?
        .ok_or_else(|| "missing registered Table3 adaptation".into())
}
#[test]
fn message_monitor_table3_repair_cross_evaluation_refusals() {
    let mut accepted = 0;
    for c in cross_evaluation_negative_cases() {
        let raw = input(&c);
        let helper = execute_csv(&raw, RECENCY);
        let adapter = registered(&c, &raw);
        let helper_error = helper.as_ref().err().map(String::as_str);
        let adapter_error = adapter.as_ref().err().map(String::as_str);
        // One diagnostic point records both actual paths before asserting. No
        // public registration refusal is counted as an arithmetic reproduction.
        println!(
            "table3_cross_eval case={} input={} helper={} registered={}",
            c["id"],
            crate::sha256(&raw),
            helper_error.unwrap_or("INCORRECTLY_ACCEPTED"),
            adapter_error.unwrap_or("INCORRECTLY_ACCEPTED")
        );
        for result in [helper_error, adapter_error] {
            if let Some(error) = result {
                assert!(error.contains("later eligible anchor"), "{error}");
            } else {
                accepted += 1;
            }
        }
    }
    assert_eq!(
        accepted, 0,
        "known strict-interior supplied events incorrectly accepted at helper/registered paths"
    );
}
fn cross_evaluation_retained_cases() -> Vec<Value> {
    let base = cross_evaluation_case();
    let mut cases = Vec::new();
    let mut add = |id: &str, row: Value, value: &str, status: &str| {
        let mut c = base.clone();
        c["id"] = json!(format!("cross-evaluation-retained-{id}"));
        c["rows"][1] = row;
        c["values"][1] = json!(value);
        c["statuses"][1] = json!(status);
        cases.push(c);
    };
    for (id, timestamp, evaluation, value) in [
        ("equal-selected-boundary", "10", "200", "190"),
        ("equal-evaluation-boundary", "100", "200", "100"),
        ("after-evaluation", "150", "200", "50"),
        ("before-selected-and-prior-evaluation", "5", "7", "2"),
    ] {
        let mut row = base["rows"][1].clone();
        row["last_timestamp"] = json!(timestamp);
        row["evaluation_timestamp"] = json!(evaluation);
        add(id, row, value, "computed_supplied_Table3_anchor_arithmetic");
    }
    for field in [
        "participant_id",
        "device_id",
        "source_stream_id",
        "source_sequence_id",
    ] {
        let mut row = base["rows"][1].clone();
        row[field] = json!(format!("{} independent", row[field].as_str().unwrap()));
        add(
            field,
            row,
            "150",
            "computed_supplied_Table3_anchor_arithmetic",
        );
    }
    let mut row = base["rows"][1].clone();
    row["feature_name"] = json!("TimeSinceLastScreenOn");
    row["last_event_role"] = json!("screen_on");
    add(
        "independent-eligible-role",
        row,
        "150",
        "computed_supplied_Table3_anchor_arithmetic",
    );
    let mut row = base["rows"][1].clone();
    row["last_clock_id"] = json!("incompatible clock");
    row["evaluation_clock_id"] = json!("incompatible clock");
    add(
        "incompatible-known-clock",
        row,
        "150",
        "computed_supplied_Table3_anchor_arithmetic",
    );
    let mut row = base["rows"][1].clone();
    row["last_time_unit"] = json!("ms");
    row["evaluation_time_unit"] = json!("ms");
    add(
        "incompatible-known-unit",
        row,
        "0.15",
        "computed_supplied_Table3_anchor_arithmetic",
    );
    for (field, status) in [
        ("last_clock_id", "unavailable:missing_clock_id"),
        ("last_time_unit", "unavailable:missing_coordinate_unit"),
        ("last_precision", "unavailable:missing_precision_metadata"),
        ("last_timestamp", "unavailable:missing_timestamp"),
    ] {
        let mut row = base["rows"][1].clone();
        row[field] = json!("");
        add(field, row, "", status);
    }
    for (field, status) in [
        ("last_clock_id", "unavailable:missing_clock_id"),
        ("last_time_unit", "unavailable:missing_coordinate_unit"),
        ("last_precision", "unavailable:missing_precision_metadata"),
        ("last_timestamp", "unavailable:missing_timestamp"),
        ("evaluation_clock_id", "unavailable:missing_clock_id"),
        (
            "evaluation_time_unit",
            "unavailable:missing_coordinate_unit",
        ),
        (
            "evaluation_precision",
            "unavailable:missing_precision_metadata",
        ),
        ("evaluation_timestamp", "unavailable:missing_timestamp"),
    ] {
        let mut c = base.clone();
        c["id"] = json!(format!("cross-evaluation-retained-selected-{field}"));
        c["rows"][0][field] = json!("");
        c["values"][0] = json!("");
        c["statuses"][0] = json!(status);
        cases.push(c);
    }
    let mut c = base.clone();
    c["id"] = json!("cross-evaluation-retained-same-event-across-evaluations");
    c["rows"][1]["last_event_id"] = c["rows"][0]["last_event_id"].clone();
    c["rows"][1]["last_timestamp"] = json!("10");
    c["values"][1] = json!("190");
    cases.push(c);
    let mut c = base;
    c["id"] = json!("cross-evaluation-retained-equal-boundary-with-whole-duplicate");
    c["rows"][1]["last_timestamp"] = json!("10");
    c["values"][1] = json!("190");
    let duplicate = c["rows"][0].clone();
    c["rows"].as_array_mut().unwrap().push(duplicate);
    c["values"].as_array_mut().unwrap().push(json!("90"));
    c["statuses"]
        .as_array_mut()
        .unwrap()
        .push(json!("computed_supplied_Table3_anchor_arithmetic"));
    cases.push(c);
    cases
        .into_iter()
        .flat_map(|c| {
            [false, true].map(move |reverse| {
                let mut c = c.clone();
                c["id"] = json!(format!(
                    "{}-{}",
                    c["id"].as_str().unwrap(),
                    if reverse { "reverse" } else { "forward" }
                ));
                if reverse {
                    for field in ["rows", "values", "statuses"] {
                        c[field].as_array_mut().unwrap().reverse();
                    }
                }
                c
            })
        })
        .collect()
}
#[test]
fn message_monitor_table3_repair_valid_neighbors() {
    for c in cross_evaluation_retained_cases() {
        let raw = input(&c);
        let (output, rows, _) = execute_csv(&raw, RECENCY).unwrap();
        assert_output(&c, &raw, &output);
        let result = registered(&c, &raw).unwrap();
        assert_output(&c, &raw, &result.csv_bytes);
        assert_eq!(rows, c["rows"].as_array().unwrap().len());
        assert_eq!(result.receipt.original_input_digest, crate::sha256(&raw));
        assert_eq!(
            result.receipt.adapted_input_digest,
            crate::sha256(&result.csv_bytes)
        );
        assert_eq!(result.receipt.source_row_count as usize, rows);
        assert_eq!(result.receipt.emitted_row_count as usize, rows);
        assert_eq!(result.receipt.duplicate_source_ids_removed, 0);
        assert_eq!(
            result.derived_result_bytes.as_deref(),
            Some(result.csv_bytes.as_slice())
        );
        assert_eq!(
            result.receipt.derived_result.as_ref().unwrap().digest,
            crate::sha256(&result.csv_bytes)
        );
        println!(
            "table3_cross_eval_retained case={} input={} output={} rows={}",
            c["id"],
            crate::sha256(&raw),
            result.receipt.adapted_input_digest,
            rows
        );
    }
}
