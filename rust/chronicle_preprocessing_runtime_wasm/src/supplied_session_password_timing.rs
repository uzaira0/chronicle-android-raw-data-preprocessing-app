//! Van Berkel CHI2016 author PDF p5 / layout text258–282: supplied adjacent
//! resolved device-session Gap (ms) and strict Gap<T. Password MUM2012
//! text303–307,391–397: supplied corrected first/last-character timing (ms).
//! Neither endpoint reconstruction, eligibility, correction nor threshold
//! learning is performed. Input coordinates are declared i64 milliseconds,
//! not a recovered raw collector clock. Existing unit-independent widening
//! subtraction and signed decimal duration formatting are reused unchanged.

use super::{format_duration_seconds_from_ns, supplied_anchor_elapsed_nanoseconds};
use std::collections::BTreeSet;

pub(super) const GAP_ADAPTER: &str = "chronicle.van-berkel-resolved-session-gap";
pub(super) const PASSWORD_ADAPTER: &str = "chronicle.corrected-password-entry-time";
const GAP_FIELDS: [&str; 22] = [
    "source_row_id",
    "previous_participant_id",
    "current_participant_id",
    "previous_device_id",
    "current_device_id",
    "previous_source_stream_id",
    "current_source_stream_id",
    "previous_source_sequence_id",
    "current_source_sequence_id",
    "previous_session_id",
    "current_session_id",
    "previous_end_clock_id",
    "current_begin_clock_id",
    "previous_end_timestamp_ms",
    "current_begin_timestamp_ms",
    "previous_end_precision_ms",
    "current_begin_precision_ms",
    "time_unit",
    "previous_endpoint_role",
    "current_endpoint_role",
    "session_pairing_stage",
    "threshold_ms",
];
const PASSWORD_FIELDS: [&str; 29] = [
    "source_row_id",
    "first_participant_id",
    "last_participant_id",
    "first_device_id",
    "last_device_id",
    "first_source_stream_id",
    "last_source_stream_id",
    "first_task_id",
    "last_task_id",
    "first_password_id",
    "last_password_id",
    "first_attempt_id",
    "last_attempt_id",
    "first_app_id",
    "last_app_id",
    "first_source_sequence_id",
    "last_source_sequence_id",
    "first_event_id",
    "last_event_id",
    "first_clock_id",
    "last_clock_id",
    "first_timestamp_ms",
    "last_timestamp_ms",
    "first_precision_ms",
    "last_precision_ms",
    "time_unit",
    "first_endpoint_role",
    "last_endpoint_role",
    "endpoint_resolution_stage",
];
const GAP_OUTPUTS: [&str; 6] = [
    "gap_ms",
    "gap_seconds",
    "gap_timing_status",
    "continuous",
    "gap_classification_status",
    "timing_claim_scope",
];
const PASSWORD_OUTPUTS: [&str; 4] = [
    "password_entry_time_ms",
    "password_entry_time_seconds",
    "password_timing_status",
    "timing_claim_scope",
];
const COMPUTED: &str = "computed_supplied_endpoint_arithmetic";

fn integer(raw: &str, field: &str) -> Result<Option<i64>, String> {
    if raw.is_empty() {
        return Ok(None);
    }
    raw.parse().map(Some).map_err(|_| {
        format!("{field} requires an i64 integer millisecond coordinate or empty missing cell")
    })
}
fn precision(raw: &str) -> Result<Option<u64>, String> {
    if raw.is_empty() {
        return Ok(None);
    }
    raw.parse::<u64>()
        .ok()
        .filter(|value| *value > 0)
        .map(Some)
        .ok_or_else(|| {
            "precision requires positive integer millisecond metadata or empty missing cell".into()
        })
}

fn difference(
    start: Option<i64>,
    end: Option<i64>,
    clocks: [&str; 2],
    precisions: [Option<u64>; 2],
) -> [String; 3] {
    let unavailable = if clocks.iter().any(|clock| clock.is_empty()) {
        Some("missing_clock_id")
    } else if clocks[0] != clocks[1] {
        Some("incompatible_clock_ids")
    } else if precisions.contains(&None) {
        Some("missing_precision_metadata")
    } else if start.is_none() || end.is_none() {
        Some("missing_timestamp")
    } else {
        None
    };
    if let Some(reason) = unavailable {
        return [
            String::new(),
            String::new(),
            format!("unavailable:{reason}"),
        ];
    }
    // The helper's operation is unit-independent i128(end)-i128(start).
    // ms->ns is only for the existing exact decimal formatter; even the full
    // i64 coordinate difference times1e6 is safely within i128.
    let ms = supplied_anchor_elapsed_nanoseconds(start.unwrap(), end.unwrap());
    [
        ms.to_string(),
        format_duration_seconds_from_ns(ms * 1_000_000),
        COMPUTED.into(),
    ]
}

pub(super) fn execute_csv(
    raw: &[u8],
    adapter: &str,
) -> Result<(Vec<u8>, usize, &'static str), String> {
    let gap = match adapter {
        GAP_ADAPTER => true,
        PASSWORD_ADAPTER => false,
        _ => return Err("unregistered session/password timing adapter".into()),
    };
    let fields: &[&str] = if gap { &GAP_FIELDS } else { &PASSWORD_FIELDS };
    let outputs: &[&str] = if gap { &GAP_OUTPUTS } else { &PASSWORD_OUTPUTS };
    let mut reader = csv::ReaderBuilder::new()
        .trim(csv::Trim::None)
        .from_reader(raw);
    let mut headers = reader.headers().map_err(|error| error.to_string())?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() {
        return Err(format!("{adapter} requires unique column names"));
    }
    if outputs
        .iter()
        .any(|field| headers.iter().any(|header| header == *field))
    {
        return Err(format!(
            "{adapter} refuses supplied computed output columns"
        ));
    }
    let columns = fields
        .iter()
        .map(|field| {
            headers
                .iter()
                .position(|header| header == *field)
                .ok_or_else(|| format!("{adapter} requires column {field}"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let records = reader
        .records()
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    headers.extend(outputs.iter().copied());
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer
        .write_record(&headers)
        .map_err(|error| error.to_string())?;
    for record in &records {
        // Lexical IDs are never trimmed, normalized, sorted, joined or deduplicated.
        let value = |index: usize| &record[columns[index]];
        let identity_end = if gap { 11 } else { 19 };
        if (0..identity_end).any(|index| value(index).is_empty()) {
            return Err(format!(
                "{adapter} requires nonempty supplied lexical ownership"
            ));
        }
        let paired_owner_end = if gap { 9 } else { 17 };
        for index in (1..paired_owner_end).step_by(2) {
            if value(index) != value(index + 1) {
                return Err(format!(
                    "{adapter} requires matching literal endpoint ownership"
                ));
            }
        }
        if gap && value(9) == value(10) {
            return Err("resolved adjacent device sessions require distinct session IDs".into());
        }
        let (clock, timestamp, meta, unit, role, stage) = if gap {
            (11, 13, 15, 17, 18, 20)
        } else {
            (19, 21, 23, 25, 26, 28)
        };
        let roles = if gap {
            ["previous_session_end", "current_session_begin"]
        } else {
            ["first_password_character", "last_password_character"]
        };
        let expected_stage = if gap {
            "caller-resolved-adjacent-device-sessions"
        } else {
            "caller-resolved-corrected-password-endpoints"
        };
        if value(unit) != "ms"
            || value(role) != roles[0]
            || value(role + 1) != roles[1]
            || value(stage) != expected_stage
        {
            return Err(format!("{adapter} requires explicit millisecond coordinates and qualified endpoint roles/stage"));
        }
        let delta = difference(
            integer(value(timestamp), fields[timestamp])?,
            integer(value(timestamp + 1), fields[timestamp + 1])?,
            [value(clock), value(clock + 1)],
            [precision(value(meta))?, precision(value(meta + 1))?],
        );
        let mut output = record.clone();
        output.extend(delta.iter().map(String::as_str));
        if gap {
            let threshold = integer(value(21), "threshold_ms")?;
            let (continuous, status) = if delta[2] != COMPUTED {
                (String::new(), delta[2].clone())
            } else if let Some(threshold) = threshold {
                let ms: i128 = delta[0].parse().expect("computed exact integer delta");
                (
                    (ms < i128::from(threshold)).to_string(),
                    "computed_supplied_gap_strict_less_than_T".into(),
                )
            } else {
                (String::new(), "unavailable:threshold_not_supplied".into())
            };
            output.push_field(&continuous);
            output.push_field(&status);
            output.push_field(
                "supplied_pair_only_not_session_constructor_threshold_learning_or_legacy_app_merge",
            );
        } else {
            output.push_field(
                "supplied_corrected_endpoints_only_not_correction_completion_gate_or_aggregation",
            );
        }
        writer
            .write_record(&output)
            .map_err(|error| error.to_string())?;
    }
    Ok((
        writer.into_inner().map_err(|error| error.to_string())?,
        records.len(),
        if gap {
            "literature-van-berkel-resolved-session-gap-csv"
        } else {
            "literature-corrected-password-entry-time-csv"
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::super::{
        adapt_literature_inputs, literature_component_execution_unit, validate_input_bindings,
    };
    use super::*;
    use serde_json::{json, Value};

    const FIXTURE: &str = include_str!("../tests/fixtures/supplied_session_password_timing.json");
    fn fixture() -> Value {
        serde_json::from_str(FIXTURE).unwrap()
    }
    fn adapter(kind: &str) -> &'static str {
        if kind == "gap" {
            GAP_ADAPTER
        } else {
            PASSWORD_ADAPTER
        }
    }
    fn input(case: &Value) -> Vec<u8> {
        let fixture = fixture();
        let kind = case["kind"].as_str().unwrap();
        let mut fields = if kind == "gap" {
            GAP_FIELDS.to_vec()
        } else {
            PASSWORD_FIELDS.to_vec()
        };
        if let Some(extra) = case["extraColumns"].as_array() {
            fields.extend(extra.iter().map(|value| value.as_str().unwrap()));
        }
        let mut writer = csv::Writer::from_writer(Vec::new());
        writer.write_record(&fields).unwrap();
        for row in case["rows"].as_array().unwrap() {
            writer
                .write_record(fields.iter().map(|field| {
                    row.get(*field)
                        .or_else(|| fixture["defaults"][kind].get(*field))
                        .and_then(Value::as_str)
                        .unwrap_or("")
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
        let mut expected_header = before_header.clone();
        expected_header.extend(
            if case["kind"] == "gap" {
                GAP_OUTPUTS.as_slice()
            } else {
                PASSWORD_OUTPUTS.as_slice()
            }
            .iter()
            .copied(),
        );
        assert_eq!(after_header, expected_header);
        assert_eq!(before.len(), after.len());
        let expected: Vec<Vec<String>> = serde_json::from_value(case["expected"].clone()).unwrap();
        assert_eq!(after.len(), expected.len());
        for ((before, after), expected) in before.iter().zip(&after).zip(expected) {
            assert_eq!(
                before.iter().collect::<Vec<_>>(),
                after.iter().take(before_header.len()).collect::<Vec<_>>(),
                "{} lexical source",
                case["id"]
            );
            assert_eq!(
                after.iter().skip(before_header.len()).collect::<Vec<_>>(),
                expected.iter().map(String::as_str).collect::<Vec<_>>(),
                "{} hand arithmetic",
                case["id"]
            );
        }
    }

    #[test]
    fn supplied_session_password_primary_hand_cases_and_role_failures() {
        for case in fixture()["cases"].as_array().unwrap() {
            let raw = input(case);
            let result = execute_csv(&raw, adapter(case["kind"].as_str().unwrap()));
            if let Some(error) = case["error"].as_str() {
                assert!(result.unwrap_err().contains(error), "{}", case["id"]);
            } else {
                let (output, count, _) =
                    result.unwrap_or_else(|error| panic!("{}: {error}", case["id"]));
                assert_eq!(count, case["rows"].as_array().unwrap().len());
                assert_output(case, &raw, &output);
            }
        }
    }

    #[test]
    fn supplied_session_password_reuses_exact_signed_elapsed_and_formatter() {
        assert_eq!(
            supplied_anchor_elapsed_nanoseconds(i64::MIN, i64::MAX),
            18_446_744_073_709_551_615_i128
        );
        assert_eq!(
            supplied_anchor_elapsed_nanoseconds(i64::MAX, i64::MIN),
            -18_446_744_073_709_551_615_i128
        );
        assert_eq!(format_duration_seconds_from_ns(-1_i128), "-0.000000001");
        assert_eq!(format_duration_seconds_from_ns(1_i64), "0.000000001");
        assert_eq!(format_duration_seconds_from_ns(-1_500_000_000_i64), "-1.5");
        assert_eq!(
            format_duration_seconds_from_ns(i128::MIN),
            "-170141183460469231731687303715.884105728"
        );
        assert_eq!(
            format_duration_seconds_from_ns(i128::MAX),
            "170141183460469231731687303715.884105727"
        );
    }

    #[test]
    fn supplied_session_password_header_and_numeric_guards_are_not_defaults() {
        for (adapter, fields, outputs) in [
            (GAP_ADAPTER, GAP_FIELDS.as_slice(), GAP_OUTPUTS.as_slice()),
            (
                PASSWORD_ADAPTER,
                PASSWORD_FIELDS.as_slice(),
                PASSWORD_OUTPUTS.as_slice(),
            ),
        ] {
            let header = fields.join(",");
            assert!(execute_csv(format!("{header},{}\n", fields[0]).as_bytes(), adapter).is_err());
            assert!(execute_csv(format!("{header},{}\n", outputs[0]).as_bytes(), adapter).is_err());
            assert!(
                execute_csv(format!("{}\n", fields[1..].join(",")).as_bytes(), adapter).is_err()
            );
        }
    }

    #[test]
    fn supplied_session_password_registered_csv_exact_sources_and_receipts() {
        for kind in ["gap", "password"] {
            let adapter = adapter(kind);
            let (registration, bindings) =
                literature_component_execution_unit(&format!("{adapter}/v1")).unwrap();
            assert_eq!(
                registration.source_work_id,
                if kind == "gap" {
                    "doi:10.1145/2858036.2858348"
                } else {
                    "doi:10.1145/2406367.2406384"
                }
            );
            assert_eq!(registration.full_profile_execution_status, "blocked");
            assert_eq!(bindings.len(), if kind == "gap" { 2 } else { 1 });
            assert_eq!(
                registration.source_oracle_id,
                format!(
                    "supplied-session-password-hand-oracle-v1/{}",
                    crate::sha256(FIXTURE.as_bytes())
                )
            );
            for case in fixture()["cases"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|case| case["kind"] == kind && case.get("expected").is_some())
            {
                let raw = input(case);
                let digest = crate::sha256(&raw);
                let result = adapt_literature_inputs(&raw, &digest, &bindings, |_| &[])
                    .unwrap()
                    .unwrap();
                assert_output(case, &raw, &result.csv_bytes);
                assert_eq!(
                    result.receipt.source_row_count as usize,
                    case["rows"].as_array().unwrap().len()
                );
                assert_eq!(
                    result.receipt.emitted_row_count,
                    result.receipt.source_row_count
                );
                assert_eq!(result.receipt.original_input_digest, digest);
                assert_eq!(
                    result.receipt.adapted_input_digest,
                    crate::sha256(&result.csv_bytes)
                );
                assert_eq!(result.receipt.duplicate_source_ids_removed, 0);
                assert_eq!(result.receipt.setting_ids.len(), bindings.len());
                assert_eq!(
                    result.receipt.derived_result.as_ref().unwrap().digest,
                    crate::sha256(&result.csv_bytes)
                );
                assert_eq!(
                    result.derived_result_bytes.as_deref(),
                    Some(result.csv_bytes.as_slice())
                );
                println!("paired_timing_receipt kind={kind} case={} input={} output={} source_rows={} output_rows={}", case["id"], digest, result.receipt.adapted_input_digest, result.receipt.source_row_count, result.receipt.emitted_row_count);
            }
            let mut forged = bindings;
            forged[0].source_value = json!("invented <=45-second app merge or send timing");
            assert!(validate_input_bindings(&forged).is_err());
        }
    }

    fn public_runner(kind: &str) {
        use crate::{
            execute_literature_component_native, LiteratureComponentExecutionReceipt,
            LiteratureComponentMethodReceipt, LiteratureComponentRuntimeManifest,
            RuntimeArtifactMetadata, RuntimeRequest, RuntimeSupportFiles,
            EXECUTE_WORKSPACE_COMMAND, RUNTIME_PROTOCOL_VERSION,
        };
        use std::collections::BTreeMap;
        let fixture = fixture();
        let case = fixture["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|case| case["kind"] == kind && case.get("expected").is_some())
            .unwrap();
        let raw = input(case);
        let request = RuntimeRequest {
            execution_engine: crate::ExecutionEngine::Sequential, provenance_evidence: false,
            protocol_version:RUNTIME_PROTOCOL_VERSION.into(), request_id:format!("paired-timing-{kind}"), command:EXECUTE_WORKSPACE_COMMAND.into(),
            workspace_root_digest:None, workspace_id:crate::sha256(b"paired-timing-hand-workspace"), input_file_name:"supplied-resolved-endpoints.csv".into(),
            input_sha256:crate::sha256(&raw), known_review_summary_digests:None, participant_partition_batch_id:None, fragmented_participant_tokens:Vec::new(),
            method_profile_receipt:None, method_profile_receipts:Vec::new(), options:serde_json::from_value(json!({
                "study_name":"Supplied source timing", "timezone":"UTC", "usage_session_mode":"app_usage", "include_app_output":true, "include_screen_output":false,
                "use_filter_file":false, "use_apps_forcing_screen_open":false, "use_app_codebook":false, "correct_duplicate_event_timestamps":false,
                "allow_stop_event_reuse":false, "use_activity_stopped_as_fallback":true, "apply_threshold_to_fallback":true,
                "long_duration_threshold_ns":43_200_000_000_000_i64, "custom_app_engagement_duration":300.0, "long_data_time_gap_thresholds":[1.0,2.0],
                "long_usage_duration_thresholds":[1.0,2.0], "same_app_stop_types":["Activity Paused","Activity Resumed"], "other_stop_types":["Activity Resumed","Device Shutdown"],
                "interaction_types_to_remove":[], "screen_auto_lock_timeout_seconds":120.0, "screen_auto_lock_tolerance_seconds":30.0,
                "screen_manual_lock_max_tail_seconds":30.0, "screen_keyguard_near_stop_seconds":2.0, "datetime_of_preprocessing":"2026-09-29 00:00:00 UTC", "minimum_usage_duration":0.0
            })).unwrap(),
        };
        // This ordinary public gate is intentionally not bypassed when the
        // isolated checkout lacks canonical generated parent registration.
        let mut handle = execute_literature_component_native(
            &format!("{}/v1", adapter(kind)),
            &serde_json::to_string(&request).unwrap(),
            &raw,
            &RuntimeSupportFiles::default(),
        )
        .unwrap();
        let manifest: LiteratureComponentRuntimeManifest =
            serde_json::from_str(&handle.manifest_json()).unwrap();
        assert_eq!(manifest.input_digest, crate::sha256(&raw));
        assert_eq!(
            manifest.source_row_count as usize,
            case["rows"].as_array().unwrap().len()
        );
        assert_eq!(manifest.source_row_count, manifest.derived_result_row_count);
        let mut artifacts = BTreeMap::new();
        for index in 0..handle.artifact_count() {
            let metadata: RuntimeArtifactMetadata =
                serde_json::from_str(&handle.artifact_metadata_json(index).unwrap()).unwrap();
            let bytes = handle.take_artifact_bytes(index).unwrap();
            assert_eq!(metadata.digest, crate::sha256(&bytes));
            artifacts.insert(metadata.kind, bytes);
        }
        let result_kind = if kind == "gap" {
            "literature-van-berkel-resolved-session-gap-csv"
        } else {
            "literature-corrected-password-entry-time-csv"
        };
        let output = &artifacts[result_kind];
        assert_output(case, &raw, output);
        let method: LiteratureComponentMethodReceipt =
            serde_json::from_slice(&artifacts["literature-component-method-receipt-json"]).unwrap();
        let execution: LiteratureComponentExecutionReceipt =
            serde_json::from_slice(&artifacts["literature-component-execution-receipt-json"])
                .unwrap();
        let adaptation: Value =
            serde_json::from_slice(&artifacts["literature-input-adaptation-receipt-json"]).unwrap();
        assert_eq!(
            method.source_work_id,
            if kind == "gap" {
                "doi:10.1145/2858036.2858348"
            } else {
                "doi:10.1145/2406367.2406384"
            }
        );
        assert_eq!(method.parent_profile_execution_status, "blocked");
        assert_eq!(method.setting_ids.len(), if kind == "gap" { 2 } else { 1 });
        assert_eq!(execution.setting_ids, method.setting_ids);
        assert_eq!(execution.full_profile_execution_status, "blocked");
        assert!(!execution.kernel_input_eligible);
        assert_eq!(execution.original_input_digest, crate::sha256(&raw));
        assert_eq!(execution.derived_result_digest, crate::sha256(output));
        assert_eq!(
            adaptation["sourceRowCount"].as_u64().unwrap(),
            manifest.source_row_count as u64
        );
        assert_eq!(adaptation["emittedRowCount"], adaptation["sourceRowCount"]);
        assert_eq!(adaptation["originalInputDigest"], crate::sha256(&raw));
        assert_eq!(adaptation["derivedResult"]["digest"], crate::sha256(output));
    }
    #[test]
    fn supplied_session_password_public_native_gap_artifacts() {
        public_runner("gap");
    }
    #[test]
    fn supplied_session_password_public_native_password_artifacts() {
        public_runner("password");
    }
}
