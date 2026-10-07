use super::*;
use serde_json::{json, Value};

const FIXTURE: &str = include_str!("../tests/fixtures/supplied_notification_call_timing.json");
fn fixture() -> Value {
    serde_json::from_str(FIXTURE).unwrap()
}
fn adapter(kind: &str) -> &'static str {
    match kind {
        "call" => CALL,
        "message" => MESSAGE,
        "insitu" => INSITU,
        "median" => MEDIAN,
        "snooze" => SNOOZE,
        "idl" => IDL,
        _ => panic!("unknown fixture kind"),
    }
}
fn source(kind: &str) -> (&'static str, &'static str, usize) {
    match kind {
        "call" => (
            "doi:10.1145/2556288.2557066",
            "source-audit-configuration-space-e8323b5196dbda09941c4099",
            2,
        ),
        "message" => (
            "doi:10.1145/2556288.2556973",
            "source-audit-configuration-space-ac9d613ce0e277945cfd4a71",
            3,
        ),
        "insitu" => (
            "doi:10.1145/2628363.2628364",
            "source-audit-configuration-space-702d3aa46192bb8c26a983d5",
            3,
        ),
        "median" => (
            "doi:10.1145/2628363.2628364",
            "source-audit-configuration-space-702d3aa46192bb8c26a983d5",
            1,
        ),
        "snooze" => (
            "doi:10.1145/3229434.3229436",
            "source-audit-configuration-space-3a451a218c20d86dfb6c8fea",
            1,
        ),
        "idl" => (
            "doi:10.3390/s24082612",
            "source-audit-configuration-space-38288a3345a67d3251f59f89",
            3,
        ),
        _ => panic!("unknown fixture source"),
    }
}
fn fields(kind: &str) -> &'static [&'static str] {
    match kind {
        "message" | "insitu" => &PENDING_FIELDS,
        "median" => &MEDIAN_FIELDS,
        _ => &PAIR_FIELDS,
    }
}
fn encoded(value: &Value) -> String {
    // Exact full-range test tokens are embedded without a JavaScript/f64 round trip.
    if let Some(value) = value.as_str() {
        return value.into();
    }
    fn exact(value: &Value, out: &mut String) {
        if let Some(token) = value.get("i64Exact").and_then(Value::as_str) {
            out.push_str(token);
        } else if let Some(object) = value.as_object() {
            out.push('{');
            for (index, (key, value)) in object.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                out.push_str(&serde_json::to_string(key).unwrap());
                out.push(':');
                exact(value, out);
            }
            out.push('}');
        } else if let Some(array) = value.as_array() {
            out.push('[');
            for (index, value) in array.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                exact(value, out);
            }
            out.push(']');
        } else {
            out.push_str(&value.to_string());
        }
    }
    let mut out = String::new();
    exact(value, &mut out);
    out
}
fn input(case: &Value) -> Vec<u8> {
    let mut fields = fields(case["kind"].as_str().unwrap()).to_vec();
    fields.push("opaque");
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(&fields).unwrap();
    for row in case["rows"].as_array().unwrap() {
        writer
            .write_record(fields.iter().map(|field| {
                row.get(*field).map(encoded).unwrap_or_else(|| {
                    if *field == "opaque" {
                        "keep  ".into()
                    } else {
                        String::new()
                    }
                })
            }))
            .unwrap();
    }
    writer.into_inner().unwrap()
}
fn table(bytes: &[u8]) -> (csv::StringRecord, Vec<csv::StringRecord>) {
    let mut reader = csv::Reader::from_reader(bytes);
    (
        reader.headers().unwrap().clone(),
        reader.records().collect::<Result<Vec<_>, _>>().unwrap(),
    )
}
fn assert_output(case: &Value, raw: &[u8], output: &[u8]) {
    let (before_header, before) = table(raw);
    let (after_header, after) = table(output);
    let kind = case["kind"].as_str().unwrap();
    let outputs = if kind == "median" {
        MEDIAN_OUT.as_slice()
    } else if matches!(kind, "message" | "insitu") {
        PENDING_OUT.as_slice()
    } else {
        PAIR_OUT.as_slice()
    };
    let mut expected_header = before_header.clone();
    expected_header.extend(outputs.iter().copied());
    assert_eq!(after_header, expected_header, "{} headers", case["id"]);
    if let Some(expected) = case["expected"].as_array() {
        assert_eq!(after.len(), expected.len(), "{} rows", case["id"]);
        let kept = if kind == "idl" && after.is_empty() {
            Vec::new()
        } else {
            before.clone()
        };
        for ((source, result), expected) in kept.iter().zip(&after).zip(expected) {
            assert_eq!(
                source.iter().collect::<Vec<_>>(),
                result.iter().take(before_header.len()).collect::<Vec<_>>()
            );
            let expected: Vec<String> = serde_json::from_value(expected.clone()).unwrap();
            assert_eq!(
                result.iter().skip(before_header.len()).collect::<Vec<_>>(),
                expected.iter().map(String::as_str).collect::<Vec<_>>(),
                "{}",
                case["id"]
            );
        }
    } else {
        let expected = case["attributed"].as_array().unwrap();
        assert_eq!(after.len(), expected.len());
        for ((source, result), expected) in before.iter().zip(&after).zip(expected) {
            assert_eq!(
                source.iter().collect::<Vec<_>>(),
                result.iter().take(before_header.len()).collect::<Vec<_>>()
            );
            let items: Value = serde_json::from_str(&result[before_header.len()]).unwrap();
            assert_eq!(
                items.as_array().unwrap().len(),
                expected.as_array().unwrap().len()
            );
            assert_eq!(
                &result[before_header.len() + 1],
                expected.as_array().unwrap().len().to_string()
            );
            for (actual, expected) in items
                .as_array()
                .unwrap()
                .iter()
                .zip(expected.as_array().unwrap())
            {
                assert_eq!(actual["source_item_id"], expected["id"]);
                assert_eq!(actual["elapsed_seconds"], expected["seconds"]);
                assert_eq!(actual["observed_reading_or_notification_click"], false);
            }
        }
    }
}
#[test]
fn supplied_notification_call_primary_hand_cases() {
    for case in fixture()["cases"].as_array().unwrap() {
        let raw = input(case);
        let result = execute_csv(&raw, adapter(case["kind"].as_str().unwrap()));
        if let Some(error) = case["error"].as_str() {
            assert!(result.unwrap_err().contains(error), "{}", case["id"]);
        } else {
            let (output, source, emitted, _) =
                result.unwrap_or_else(|e| panic!("{}: {e}", case["id"]));
            assert_eq!(source, case["rows"].as_array().unwrap().len());
            assert_eq!(emitted, table(&output).1.len());
            assert_output(case, &raw, &output);
        }
    }
}
#[test]
fn supplied_notification_call_known_fact_guards_and_header_guards() {
    let f = fixture();
    let base = f["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "lab-postpone-included")
        .unwrap()
        .clone();
    for field in ["timestamp", "role", "clock_id", "precision"] {
        let mut case = base.clone();
        let mut second = case["rows"][0].clone();
        second["end_anchor_json"][field] = match field {
            "timestamp" => json!(7001),
            "role" => json!("conversation_start"),
            "clock_id" => json!("other"),
            _ => json!(8),
        };
        if field == "role" {
            second["start_anchor_json"]["event_id"] = second["end_anchor_json"]["event_id"].clone();
        }
        case["rows"].as_array_mut().unwrap().push(second);
        assert!(
            execute_csv(&input(&case), CALL).is_err(),
            "{field} contradiction"
        );
    }
    let mut case = base.clone();
    let mut second = case["rows"][0].clone();
    second["source_item_id"] = json!("same-arrival-other-item");
    case["rows"].as_array_mut().unwrap().push(second);
    assert!(execute_csv(&input(&case), CALL)
        .unwrap_err()
        .contains("event item attribution"));
    let mut case = base.clone();
    let mut second = case["rows"][0].clone();
    second["source_item_id"] = json!("other item sharing a nonshared final event");
    second["start_anchor_json"]["event_id"] = json!("other first");
    case["rows"].as_array_mut().unwrap().push(second);
    assert!(execute_csv(&input(&case), CALL)
        .unwrap_err()
        .contains("event item attribution"));
    let mut case = base.clone();
    let mut second = case["rows"][0].clone();
    second["end_anchor_json"]["event_id"] = json!("a different claimed final endpoint");
    case["rows"].as_array_mut().unwrap().push(second);
    assert!(execute_csv(&input(&case), CALL)
        .unwrap_err()
        .contains("final/outcome pair"));
    let mut case = f["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "message-matching-app-literal")
        .unwrap()
        .clone();
    let mut second = case["rows"][0].clone();
    second["opened_app_id"] = json!("chat ");
    case["rows"].as_array_mut().unwrap().push(second);
    assert!(execute_csv(&input(&case), MESSAGE)
        .unwrap_err()
        .contains("opened-app action facts"));
    let mut case = f["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "message-drawer-all")
        .unwrap()
        .clone();
    let mut second = case["rows"][0].clone();
    second["pending_items_json"][0]["app_id"] = json!("chat ");
    case["rows"].as_array_mut().unwrap().push(second);
    assert!(execute_csv(&input(&case), MESSAGE)
        .unwrap_err()
        .contains("item/app/initial-anchor facts"));
    let mut case = base.clone();
    let mut second = case["rows"][0].clone();
    second["source_item_id"] = json!("other item");
    second["start_anchor_json"]["event_id"] = json!("other first");
    second["end_anchor_json"]["event_id"] = json!("other last");
    second["app_id"] = json!("app");
    case["rows"].as_array_mut().unwrap().push(second);
    let (output, _, _, _) = execute_csv(&input(&case), CALL).unwrap();
    assert_output(
        &json!({"kind":"call","id":"lexical-scope","expected":[base["expected"][0],base["expected"][0]]}),
        &input(&case),
        &output,
    );
    for adapter in ADAPTERS {
        let fields = if adapter == MEDIAN {
            MEDIAN_FIELDS.as_slice()
        } else if matches!(adapter, MESSAGE | INSITU) {
            PENDING_FIELDS.as_slice()
        } else {
            PAIR_FIELDS.as_slice()
        };
        assert!(execute_csv(
            format!("{},{}\n", fields.join(","), fields[0]).as_bytes(),
            adapter
        )
        .is_err());
        assert!(execute_csv(
            format!("{},claim_scope\n", fields.join(",")).as_bytes(),
            adapter
        )
        .is_err());
        assert!(execute_csv(format!("{}\n", fields[1..].join(",")).as_bytes(), adapter).is_err());
    }
}
#[test]
fn supplied_notification_call_registered_csv_exact_sources_and_receipts() {
    use super::super::{
        adapt_literature_inputs, literature_component_execution_unit, validate_input_bindings,
    };
    for kind in ["call", "message", "insitu", "median", "snooze", "idl"] {
        let adapter = adapter(kind);
        let (registration, bindings) =
            literature_component_execution_unit(&format!("{adapter}/v1")).unwrap();
        assert_eq!(registration.full_profile_execution_status, "blocked");
        assert_eq!(registration.source_work_id, source(kind).0);
        assert_eq!(registration.source_method_variant_id, source(kind).1);
        assert_eq!(
            registration.method_profile_version,
            "literature-sublation-v3-atomic+source-complete-v1"
        );
        assert_eq!(bindings.len(), source(kind).2);
        assert_eq!(
            registration.source_oracle_id,
            format!(
                "supplied-notification-call-hand-oracle-v1/{}",
                crate::sha256(FIXTURE.as_bytes())
            )
        );
        for case in fixture()["cases"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|c| c["kind"] == kind && c.get("error").is_none())
        {
            let raw = input(case);
            let digest = crate::sha256(&raw);
            let result = adapt_literature_inputs(&raw, &digest, &bindings, |_| &[])
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
                result.receipt.emitted_row_count as usize,
                table(&result.csv_bytes).1.len()
            );
            assert_eq!(result.receipt.duplicate_source_ids_removed, 0);
            assert_eq!(result.receipt.setting_ids.len(), bindings.len());
            assert_eq!(
                result.derived_result_bytes.as_deref(),
                Some(result.csv_bytes.as_slice())
            );
            assert_eq!(
                result.receipt.derived_result.as_ref().unwrap().digest,
                crate::sha256(&result.csv_bytes)
            );
            println!("notification_timing_receipt kind={kind} case={} input={} output={} source_rows={} output_rows={}",case["id"],digest,result.receipt.adapted_input_digest,result.receipt.source_row_count,result.receipt.emitted_row_count);
        }
        let mut forged = bindings;
        forged[0].source_value = json!("invented raw queue or observed read");
        assert!(validate_input_bindings(&forged).is_err());
    }
}
fn public_runner_case(case: &Value) -> bool {
    use crate::{
        execute_literature_component_native, LiteratureComponentExecutionReceipt,
        LiteratureComponentMethodReceipt, LiteratureComponentRuntimeManifest,
        RuntimeArtifactMetadata, RuntimeRequest, RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND,
        RUNTIME_PROTOCOL_VERSION,
    };
    let kind = case["kind"].as_str().unwrap();
    let raw = input(case);
    let request=RuntimeRequest {
        execution_engine: crate::ExecutionEngine::Sequential, provenance_evidence: false,
        protocol_version:RUNTIME_PROTOCOL_VERSION.into(),request_id:format!("notification-timing-{kind}"),command:EXECUTE_WORKSPACE_COMMAND.into(),
        workspace_root_digest:None,workspace_id:crate::sha256(b"notification-timing-hand-workspace"),input_file_name:"supplied-notification-anchors.csv".into(),
        input_sha256:crate::sha256(&raw),known_review_summary_digests:None,participant_partition_batch_id:None,fragmented_participant_tokens:Vec::new(),
        method_profile_receipt:None,method_profile_receipts:Vec::new(),options:serde_json::from_value(json!({
            "study_name":"Supplied source timing","timezone":"UTC","usage_session_mode":"app_usage","include_app_output":true,"include_screen_output":false,
            "use_filter_file":false,"use_apps_forcing_screen_open":false,"use_app_codebook":false,"correct_duplicate_event_timestamps":false,
            "allow_stop_event_reuse":false,"use_activity_stopped_as_fallback":true,"apply_threshold_to_fallback":true,
            "long_duration_threshold_ns":43_200_000_000_000_i64,"custom_app_engagement_duration":300.0,"long_data_time_gap_thresholds":[1.0,2.0],
            "long_usage_duration_thresholds":[1.0,2.0],"same_app_stop_types":["Activity Paused","Activity Resumed"],"other_stop_types":["Activity Resumed","Device Shutdown"],
            "interaction_types_to_remove":[],"screen_auto_lock_timeout_seconds":120.0,"screen_auto_lock_tolerance_seconds":30.0,"screen_manual_lock_max_tail_seconds":30.0,
            "screen_keyguard_near_stop_seconds":2.0,"datetime_of_preprocessing":"2026-09-29 00:00:00 UTC","minimum_usage_duration":0.0
        })).unwrap()
    };
    // Ordinary canonical-parent gate stays intact. Isolated absence is a real failure, never a bypass.
    let result = execute_literature_component_native(
        &format!("{}/v1", adapter(kind)),
        &serde_json::to_string(&request).unwrap(),
        &raw,
        &RuntimeSupportFiles::default(),
    );
    if let Some(expected) = case["error"].as_str() {
        let error = match result {
            Err(error) => error,
            Ok(_) => {
                println!(
                    "notification_timing_public_incorrect_acceptance kind={kind} case={} input={}",
                    case["id"],
                    crate::sha256(&raw)
                );
                return false;
            }
        };
        assert!(error.contains(expected), "{}: {error}", case["id"]);
        println!(
            "notification_timing_public_refusal kind={kind} case={} input={} error={error}",
            case["id"],
            crate::sha256(&raw)
        );
        return true;
    }
    let mut handle = result.unwrap();
    let manifest: LiteratureComponentRuntimeManifest =
        serde_json::from_str(&handle.manifest_json()).unwrap();
    assert_eq!(manifest.input_digest, crate::sha256(&raw));
    assert_eq!(
        manifest.source_row_count as usize,
        case["rows"].as_array().unwrap().len()
    );
    let mut artifacts = BTreeMap::new();
    for index in 0..handle.artifact_count() {
        let metadata: RuntimeArtifactMetadata =
            serde_json::from_str(&handle.artifact_metadata_json(index).unwrap()).unwrap();
        let bytes = handle.take_artifact_bytes(index).unwrap();
        assert_eq!(metadata.digest, crate::sha256(&bytes));
        artifacts.insert(metadata.kind, bytes);
    }
    let (expected, _, emitted, kind_result) = execute_csv(&raw, adapter(kind)).unwrap();
    let output = &artifacts[kind_result];
    assert_eq!(output, &expected);
    assert_output(case, &raw, output);
    assert_eq!(manifest.derived_result_row_count as usize, emitted);
    let method: LiteratureComponentMethodReceipt =
        serde_json::from_slice(&artifacts["literature-component-method-receipt-json"]).unwrap();
    let execution: LiteratureComponentExecutionReceipt =
        serde_json::from_slice(&artifacts["literature-component-execution-receipt-json"]).unwrap();
    let adaptation: Value =
        serde_json::from_slice(&artifacts["literature-input-adaptation-receipt-json"]).unwrap();
    assert_eq!(method.parent_profile_execution_status, "blocked");
    assert_eq!(method.component_id, format!("{}/v1", adapter(kind)));
    assert_eq!(method.source_work_id, source(kind).0);
    assert_eq!(method.source_method_variant_id, source(kind).1);
    assert_eq!(
        method.method_profile_version,
        "literature-sublation-v3-atomic+source-complete-v1"
    );
    assert_eq!(method.setting_ids.len(), source(kind).2);
    assert_eq!(execution.source_work_id, method.source_work_id);
    assert_eq!(
        execution.source_method_variant_id,
        method.source_method_variant_id
    );
    assert_eq!(
        execution.method_profile_version,
        method.method_profile_version
    );
    assert_eq!(
        execution.component_method_receipt_digest,
        crate::sha256(&artifacts["literature-component-method-receipt-json"])
    );
    assert_eq!(
        execution.adaptation_receipt_digest,
        crate::sha256(&artifacts["literature-input-adaptation-receipt-json"])
    );
    assert_eq!(execution.full_profile_execution_status, "blocked");
    assert!(!execution.kernel_input_eligible);
    assert_eq!(execution.setting_ids, method.setting_ids);
    assert_eq!(execution.original_input_digest, crate::sha256(&raw));
    assert_eq!(execution.derived_result_digest, crate::sha256(output));
    assert_eq!(adaptation["originalInputDigest"], crate::sha256(&raw));
    assert_eq!(
        adaptation["sourceRowCount"],
        case["rows"].as_array().unwrap().len()
    );
    assert_eq!(adaptation["emittedRowCount"], emitted);
    assert_eq!(adaptation["adaptedInputDigest"], crate::sha256(output));
    println!(
        "notification_timing_public kind={kind} input={} output={} source_rows={} output_rows={}",
        crate::sha256(&raw),
        crate::sha256(output),
        manifest.source_row_count,
        emitted
    );
    true
}
fn public_runner(kind: &str, case_id: &str) {
    let f = fixture();
    let case = f["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["kind"] == kind && c["id"] == case_id)
        .unwrap();
    public_runner_case(case);
}
#[test]
fn supplied_notification_call_public_call() {
    for id in [
        "lab-postpone-included",
        "field-accepted",
        "field-declined",
        "field-unanswered",
        "missing-clock-local",
    ] {
        public_runner("call", id);
    }
}
#[test]
fn supplied_notification_call_public_message() {
    for id in [
        "message-drawer-all",
        "message-matching-app-literal",
        "message-explicit-empty",
        "message-whole-occurrences-retained",
    ] {
        public_runner("message", id);
    }
}
#[test]
fn supplied_notification_call_public_insitu() {
    for id in [
        "insitu-drawer-all",
        "insitu-matching-app-literal",
        "insitu-explicit-empty",
        "insitu-whole-occurrences-retained",
    ] {
        public_runner("insitu", id);
    }
}
#[test]
fn supplied_notification_call_public_median() {
    for id in ["median-even-minutes", "median-duplicate-weights"] {
        public_runner("median", id);
    }
}
#[test]
fn supplied_notification_call_public_snooze() {
    public_runner("snooze", "snooze-first-to-final");
}
#[test]
fn supplied_notification_call_public_idl() {
    for id in [
        "idl-integer-positive",
        "idl-zero-excluded",
        "idl-negative-excluded",
    ] {
        public_runner("idl", id);
    }
}

fn repair_base(id: &str) -> Value {
    fixture()["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == id)
        .unwrap()
        .clone()
}
// Source roles and ownership come from the pinned primary hand oracle above:
// Boehmer pp5/8, Snooze p6/Fig5, MessageMonitor pp5–6, InSitu p4.
// Complementary declarations never authorize output imputation or new pairing.
fn repair_chronology_cases(negative: bool) -> Vec<Value> {
    let mut cases = Vec::new();
    for (kind, base) in [
        ("call", "lab-postpone-included"),
        ("snooze", "snooze-first-to-final"),
        ("message", "message-drawer-all"),
        ("insitu", "insitu-drawer-all"),
    ] {
        for metadata in [false, true] {
            for reverse in [false, true] {
                let mut case = repair_base(base);
                let pending = matches!(kind, "message" | "insitu");
                if pending {
                    case["rows"][0]["pending_items_json"]
                        .as_array_mut()
                        .unwrap()
                        .truncate(1);
                }
                let mut first = case["rows"][0].clone();
                let mut second = first.clone();
                let (first_start, first_end) = if pending {
                    first["pending_items_json"][0]["arrival"]["timestamp"] = json!(10);
                    first["action_anchor_json"]["timestamp"] = Value::Null;
                    second["pending_items_json"][0]["arrival"]["timestamp"] = Value::Null;
                    second["action_anchor_json"]["timestamp"] =
                        json!(if negative { 5 } else { 15 });
                    ("arrival", "action_anchor_json")
                } else {
                    first["start_anchor_json"]["timestamp"] = json!(10);
                    first["end_anchor_json"]["timestamp"] = Value::Null;
                    second["start_anchor_json"]["timestamp"] = Value::Null;
                    second["end_anchor_json"]["timestamp"] = json!(if negative { 5 } else { 15 });
                    ("start_anchor_json", "end_anchor_json")
                };
                if metadata {
                    for field in ["clock_id", "time_unit", "precision"] {
                        first[first_end][field] = Value::Null;
                        if pending {
                            second["pending_items_json"][0][first_start][field] = Value::Null;
                        } else {
                            second[first_start][field] = Value::Null;
                        }
                    }
                }
                case["rows"] = if reverse {
                    json!([second, first])
                } else {
                    json!([first, second])
                };
                case["id"] = json!(format!("repair-chronology-{kind}-negative{negative}-metadata{metadata}-reverse{reverse}"));
                if negative {
                    case["error"] = json!("collectively known endpoint order");
                } else if pending {
                    case["attributed"] =
                        json!([[{"id":"one","seconds":""}], [{"id":"one","seconds":""}]]);
                } else {
                    let scope = case["expected"][0][4].clone();
                    let status = if metadata {
                        "unavailable:missing_clock_id"
                    } else {
                        "unavailable:missing_timestamp"
                    };
                    case["expected"] =
                        json!([["", "", "", status, scope], ["", "", "", status, scope]]);
                }
                cases.push(case);
            }
        }
    }
    cases
}
fn repair_membership_cases() -> Vec<Value> {
    let mut cases = Vec::new();
    for kind in ["message", "insitu"] {
        for action in ["drawer-all", "matching-app-literal"] {
            for empty in [false, true] {
                for reverse in [false, true] {
                    let mut case = repair_base(&format!("{kind}-{action}"));
                    let mut first = case["rows"][0].clone();
                    let mut second = first.clone();
                    let members = first["pending_items_json"].as_array_mut().unwrap();
                    members.truncate(if empty { 0 } else { 1 });
                    let other = second["pending_items_json"][1].clone();
                    second["pending_items_json"] = json!([other]);
                    case["rows"] = if reverse {
                        json!([second, first])
                    } else {
                        json!([first, second])
                    };
                    case["id"] = json!(format!(
                        "repair-complete-set-{kind}-{action}-empty{empty}-reverse{reverse}"
                    ));
                    case["error"] = json!("contradictory complete supplied pending membership");
                    cases.push(case);
                }
            }
        }
    }
    cases
}
fn repair_refusal(case: &Value, registered: bool) -> bool {
    let raw = input(case);
    let expected = case["error"].as_str().unwrap();
    let kind = case["kind"].as_str().unwrap();
    let error = if registered {
        let (_, bindings) =
            super::super::literature_component_execution_unit(&format!("{}/v1", adapter(kind)))
                .unwrap();
        match super::super::adapt_literature_inputs(&raw, &crate::sha256(&raw), &bindings, |_| &[])
        {
            Err(error) => error,
            Ok(_) => {
                println!("notification_timing_repair_incorrect_acceptance registered={registered} case={} input={}", case["id"], crate::sha256(&raw));
                return false;
            }
        }
    } else {
        match execute_csv(&raw, adapter(kind)) {
            Err(error) => error,
            Ok(_) => {
                println!("notification_timing_repair_incorrect_acceptance registered={registered} case={} input={}", case["id"], crate::sha256(&raw));
                return false;
            }
        }
    };
    assert!(error.contains(expected), "{}: {error}", case["id"]);
    println!(
        "notification_timing_repair_refusal registered={registered} case={} input={} error={error}",
        case["id"],
        crate::sha256(&raw)
    );
    true
}
fn repair_refusals(cases: Vec<Value>, level: &str) {
    let mut accepted = Vec::new();
    for case in cases {
        let refused = if level == "public" {
            public_runner_case(&case)
        } else {
            repair_refusal(&case, level == "registered")
        };
        if !refused {
            accepted.push(case["id"].clone());
        }
    }
    assert!(
        accepted.is_empty(),
        "{level} accepted contradictory declarations: {accepted:?}"
    );
}
#[test]
fn supplied_notification_call_repair_chronology_helper() {
    repair_refusals(repair_chronology_cases(true), "helper");
}
#[test]
fn supplied_notification_call_repair_chronology_registered() {
    repair_refusals(repair_chronology_cases(true), "registered");
}
#[test]
fn supplied_notification_call_repair_chronology_public() {
    repair_refusals(repair_chronology_cases(true), "public");
}
#[test]
fn supplied_notification_call_repair_membership_helper() {
    repair_refusals(repair_membership_cases(), "helper");
}
#[test]
fn supplied_notification_call_repair_membership_registered() {
    repair_refusals(repair_membership_cases(), "registered");
}
#[test]
fn supplied_notification_call_repair_membership_public() {
    repair_refusals(repair_membership_cases(), "public");
}
#[test]
fn supplied_notification_call_repair_positive_incomplete_and_independent_sets() {
    for case in repair_chronology_cases(false) {
        let raw = input(&case);
        let (output, _, _, _) = execute_csv(&raw, adapter(case["kind"].as_str().unwrap())).unwrap();
        assert_output(&case, &raw, &output);
        if matches!(case["kind"].as_str().unwrap(), "message" | "insitu") {
            for row in table(&output).1 {
                let items: Value = serde_json::from_str(&row[fields("message").len() + 1]).unwrap();
                assert!(items[0]["timing_status"]
                    .as_str()
                    .unwrap()
                    .starts_with("unavailable:"));
                assert_eq!(items[0]["elapsed_coordinate"], "");
                assert_eq!(items[0]["elapsed_unit"], "");
            }
        }
        public_runner_case(&case);
    }
    for kind in ["message", "insitu"] {
        let mut case = repair_base(&format!("{kind}-drawer-all"));
        let mut reordered = case["rows"][0].clone();
        reordered["pending_items_json"]
            .as_array_mut()
            .unwrap()
            .reverse();
        case["rows"].as_array_mut().unwrap().push(reordered.clone());
        case["rows"].as_array_mut().unwrap().push(reordered); // Duplicate whole occurrence remains.
        let mut expected = case["attributed"][0].clone();
        expected.as_array_mut().unwrap().reverse();
        case["attributed"]
            .as_array_mut()
            .unwrap()
            .extend([expected.clone(), expected]);
        case["id"] = json!(format!("repair-equal-sets-reordered-{kind}"));
        public_runner_case(&case);

        let mut case = repair_base(&format!("{kind}-drawer-all"));
        let app = repair_base(&format!("{kind}-matching-app-literal"));
        let mut row = app["rows"][0].clone();
        for member in row["pending_items_json"].as_array_mut().unwrap() {
            member["source_item_id"] = json!(format!(
                "independent {}",
                member["source_item_id"].as_str().unwrap()
            ));
            member["arrival"]["event_id"] = json!(format!(
                "independent {}",
                member["arrival"]["event_id"].as_str().unwrap()
            ));
        }
        case["rows"].as_array_mut().unwrap().push(row);
        case["attributed"]
            .as_array_mut()
            .unwrap()
            .push(json!([{"id":"independent one","seconds":"0.9"}]));
        case["id"] = json!(format!("repair-independent-drawer-app-populations-{kind}"));
        public_runner_case(&case);
    }
    // Sensors p7§3.2/p21§5.2: signed integer seconds remain positive-filter arithmetic.
    for id in [
        "idl-integer-positive",
        "idl-zero-excluded",
        "idl-negative-excluded",
    ] {
        public_runner("idl", id);
    }
}
