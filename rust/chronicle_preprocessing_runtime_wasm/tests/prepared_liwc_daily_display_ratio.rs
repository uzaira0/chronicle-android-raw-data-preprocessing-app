use chronicle_preprocessing_runtime_wasm::literature_input_adapters::literature_component_execution_unit;
use chronicle_preprocessing_runtime_wasm::literature_input_adapters::{
    adapt_literature_inputs, MethodProfileInputBindingReceipt,
};
use chronicle_preprocessing_runtime_wasm::prepared_liwc_daily_display_ratio::FIELDS;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

const COMPONENT: &str = "chronicle.prepared-liwc-daily-display-ratio/v1";

fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "fixtures/prepared_liwc_daily_display_hand.json"
    ))
    .unwrap()
}
fn base() -> Vec<String> {
    vec![
        " P ".into(),
        "work".into(),
        "inventory".into(),
        "supplied score unit".into(),
        "source_qualified_complete_liwc_study_days".into(),
        "true".into(),
        json!(["earlier", " later "]).to_string(),
        fixture()["inputDailyValues"].to_string(),
    ]
}
fn encode(fields: &[&str], rows: &[Vec<String>]) -> Vec<u8> {
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(fields).unwrap();
    for row in rows {
        writer.write_record(row).unwrap();
    }
    writer.into_inner().unwrap()
}
fn run_with(
    rows: &[Vec<String>],
    bindings: &[MethodProfileInputBindingReceipt],
) -> Result<Vec<BTreeMap<String, String>>, String> {
    let raw = encode(FIELDS, rows);
    let digest = format!("sha256:{}", hex::encode(Sha256::digest(&raw)));
    let result = adapt_literature_inputs(&raw, &digest, bindings, |_| &[])?.unwrap();
    assert_eq!(result.receipt.source_row_count as usize, rows.len());
    assert_eq!(result.receipt.emitted_row_count as usize, rows.len());
    assert_eq!(result.receipt.original_input_digest, digest);
    assert_eq!(
        result.receipt.adapted_input_digest,
        format!("sha256:{}", hex::encode(Sha256::digest(&result.csv_bytes)))
    );
    assert_eq!(
        result.derived_result_bytes.as_deref(),
        Some(result.csv_bytes.as_slice())
    );
    assert_eq!(
        result.receipt.derived_result.as_ref().unwrap().row_count as usize,
        rows.len()
    );
    let mut reader = csv::Reader::from_reader(result.csv_bytes.as_slice());
    let headers = reader.headers().unwrap().clone();
    let output = reader.records().collect::<Result<Vec<_>, _>>().unwrap();
    assert_eq!(
        headers.iter().take(FIELDS.len()).collect::<Vec<_>>(),
        FIELDS
    );
    for (before, after) in rows.iter().zip(&output) {
        assert_eq!(
            before.iter().map(String::as_str).collect::<Vec<_>>(),
            after.iter().take(FIELDS.len()).collect::<Vec<_>>()
        );
    }
    Ok(output
        .into_iter()
        .map(|r| {
            headers
                .iter()
                .zip(r.iter())
                .map(|(k, v)| (k.into(), v.into()))
                .collect()
        })
        .collect())
}
fn run(rows: &[Vec<String>]) -> Result<Vec<BTreeMap<String, String>>, String> {
    run_with(
        rows,
        &literature_component_execution_unit(COMPONENT).unwrap().1,
    )
}
fn with_values(values: Value) -> Vec<String> {
    let mut row = base();
    row[7] = values.to_string();
    row
}
fn values(row: &BTreeMap<String, String>) -> Value {
    serde_json::from_str(&row["daily_display_ratios_json"]).unwrap()
}

#[test]
fn supplied_two_and_six_are_quarters_not_percent_word_share_or_day_mean() {
    let result = run(&[base()]).unwrap();
    assert_eq!(result[0]["component_study_total"], "8");
    let ratio = values(&result[0]);
    assert_eq!(ratio[0]["value"], json!(0.25));
    assert_eq!(ratio[1]["value"], json!(0.75));
    assert_eq!(ratio[0]["day_id"], " later ");
    assert_eq!(result[0]["output_unit_relation"], "dimensionless_fraction");
}

#[test]
fn signed_supplied_values_have_no_invented_zero_one_or_score_range() {
    let mut input = fixture()["inputDailyValues"].clone();
    input[0]["value"] = json!("-2");
    let result = run(&[with_values(input)]).unwrap();
    let ratio = values(&result[0]);
    assert_eq!(ratio[0]["value"], json!(-0.5));
    assert_eq!(ratio[1]["value"], json!(1.5));
}

#[test]
fn explicit_zero_is_computed_only_with_nonzero_total_and_zero_total_is_unavailable() {
    let mut input = fixture()["inputDailyValues"].clone();
    input[0]["value"] = json!("0");
    let result = run(&[with_values(input.clone())]).unwrap();
    assert_eq!(values(&result[0])[0]["value"], json!(0.0));
    input[0]["value"] = json!("-6");
    let result = run(&[with_values(input)]).unwrap();
    assert_eq!(result[0]["component_study_total"], "0");
    assert_eq!(result[0]["computation_status"], "source_undefined");
    assert_eq!(values(&result[0])[0]["value"], Value::Null);
    let mut empty = base();
    empty[6] = "[]".into();
    empty[7] = "[]".into();
    let result = run(&[empty]).unwrap();
    assert_eq!(result[0]["component_study_total"], "");
    assert_eq!(result[0]["computation_reason"], "empty_day_inventory");
}

#[test]
fn missing_values_do_not_become_zero_or_get_dropped_from_denominator() {
    for absent in [false, true] {
        let mut input = fixture()["inputDailyValues"].clone();
        if absent {
            input[0].as_object_mut().unwrap().remove("value");
        } else {
            input[0]["value"] = Value::Null;
        }
        let result = run(&[with_values(input)]).unwrap();
        assert_eq!(result[0]["component_study_total"], "");
        assert_eq!(result[0]["computation_status"], "input_unavailable");
        assert!(values(&result[0])
            .as_array()
            .unwrap()
            .iter()
            .all(|v| v["value"].is_null()));
    }
}

#[test]
fn raw_participant_component_scopes_and_day_order_are_preserved() {
    let mut other = base();
    other[0] = "P".into();
    let mut third = base();
    third[1] = "money".into();
    assert_eq!(run(&[base(), other, third]).unwrap().len(), 3);
    assert!(run(&[base(), base()])
        .unwrap_err()
        .contains("duplicate participant/component"));
    let mut permuted = base();
    let mut input = fixture()["inputDailyValues"].as_array().unwrap().clone();
    input.reverse();
    permuted[7] = json!(input).to_string();
    assert_eq!(
        values(&run(&[permuted]).unwrap()[0])[0]["day_id"],
        "earlier"
    );
}

#[test]
fn malformed_unqualified_day_membership_and_unit_changes_are_refused() {
    for (mutation, reason) in [
        ("duplicate", "duplicate daily"),
        ("foreign", "exactly cover"),
        ("absent", "exactly cover"),
        ("unit", "identical supplied units"),
        ("extra", "daily_values_json"),
        ("nonfinite", "nonfinite"),
        ("malformed", "numeric lexical"),
        ("number-not-lexical", "daily_values_json"),
    ] {
        let mut input = fixture()["inputDailyValues"].clone();
        match mutation {
            "duplicate" => input[1]["day_id"] = input[0]["day_id"].clone(),
            "foreign" => input[1]["day_id"] = json!("foreign"),
            "absent" => {
                input.as_array_mut().unwrap().pop();
            }
            "unit" => input[1]["input_unit"] = json!("different units"),
            "extra" => input[0]["clinical_outcome"] = json!(1),
            "nonfinite" => input[0]["value"] = json!("NaN"),
            "malformed" => input[0]["value"] = json!("not a scalar"),
            "number-not-lexical" => input[0]["value"] = json!(2),
            _ => unreachable!(),
        }
        assert!(
            run(&[with_values(input)]).unwrap_err().contains(reason),
            "{mutation}"
        );
    }
    for index in [0, 1, 2, 3] {
        let mut row = base();
        row[index] = " ".into();
        assert!(run(&[row]).unwrap_err().contains("nonblank"));
    }
    let mut row = base();
    row[5] = "unknown".into();
    assert!(run(&[row]).unwrap_err().contains("complete"));
    let mut row = base();
    row[6] = json!(["earlier", "earlier"]).to_string();
    assert!(run(&[row]).unwrap_err().contains("duplicate expected"));
}

#[test]
fn numeric_loss_is_unavailable_without_clamping_or_hiding_computable_ratios() {
    for lex in ["1e-9999", "1e309"] {
        let mut input = fixture()["inputDailyValues"].clone();
        input[0]["value"] = json!(lex);
        let result = run(&[with_values(input)]).unwrap();
        assert_eq!(result[0]["component_study_total"], "");
        assert_eq!(result[0]["computation_reason"], "input_numeric_loss");
    }
    let mut input = fixture()["inputDailyValues"].clone();
    input[0]["value"] = json!("1e308");
    input[1]["value"] = json!("1e308");
    let result = run(&[with_values(input)]).unwrap();
    assert_eq!(result[0]["component_study_total"], "");
    assert_eq!(result[0]["computation_reason"], "nonfinite_study_total");
    let mut row = base();
    row[6] = json!(["a", "b", "c"]).to_string();
    row[7]=json!([{"day_id":"a","input_unit":"supplied score unit","value":"1e308"},{"day_id":"b","input_unit":"supplied score unit","value":"-1e308"},{"day_id":"c","input_unit":"supplied score unit","value":"1e-300"}]).to_string();
    let result = run(&[row]).unwrap();
    let ratio = values(&result[0]);
    assert!(ratio[0]["value"].is_null());
    assert!(ratio[1]["value"].is_null());
    assert_eq!(ratio[2]["value"], json!(1.0));
    let mut input = fixture()["inputDailyValues"].clone();
    input[0]["value"] = json!("5e-324");
    input[1]["value"] = json!("1e308");
    let ratio = values(&run(&[with_values(input)]).unwrap()[0]);
    assert!(ratio[0]["value"].is_null());
    assert_eq!(ratio[1]["value"], json!(1.0));
}

fn assert_accumulation_unavailable(supplied: &[&str]) {
    let mut row = base();
    let days = (0..supplied.len())
        .map(|i| format!("day{i}"))
        .collect::<Vec<_>>();
    row[6] = json!(days).to_string();
    row[7] = json!(days
        .iter()
        .zip(supplied)
        .map(|(day, value)| {
            json!({"day_id": day, "input_unit": "supplied score unit", "value": value})
        })
        .collect::<Vec<_>>())
    .to_string();
    let result = run(&[row]).unwrap();
    assert_eq!(result[0]["component_study_total"], "");
    assert_eq!(result[0]["computation_status"], "arithmetic_unavailable");
    assert_eq!(result[0]["computation_reason"], "study_total_numeric_loss");
    assert!(values(&result[0]).as_array().unwrap().iter().all(|day| {
        day["value"].is_null()
            && day["status"] == "arithmetic_unavailable"
            && day["reason"] == "study_total_numeric_loss"
    }));
}

#[test]
fn finite_accumulation_loss_is_not_a_source_zero() {
    assert_accumulation_unavailable(&["10000000000000000", "1", "-10000000000000000"]);
}

#[test]
fn finite_accumulation_loss_is_not_a_computed_wrong_nonzero_total() {
    assert_accumulation_unavailable(&["10000000000000000", "1", "-10000000000000000", "1"]);
}

#[test]
fn exact_cancellation_and_ordinary_rounded_signed_sums_keep_their_meanings() {
    for (supplied, expected_total, expected_status) in [
        (vec!["-6", "6"], "0", "source_undefined"),
        (vec!["0", "6"], "6", "computed"),
        (vec!["-2", "6"], "4", "computed"),
        (vec!["0.1", "0.2"], "0.30000000000000004", "computed"),
        (
            vec!["10000000000000000", "-10000000000000000", "1"],
            "1",
            "computed",
        ),
    ] {
        let mut row = base();
        let days = (0..supplied.len())
            .map(|i| format!("day{i}"))
            .collect::<Vec<_>>();
        row[6] = json!(days).to_string();
        row[7] = json!(days
            .iter()
            .zip(supplied)
            .map(|(day, value)| {
                json!({"day_id": day, "input_unit": "supplied score unit", "value": value})
            })
            .collect::<Vec<_>>())
        .to_string();
        let result = run(&[row]).unwrap();
        assert_eq!(result[0]["component_study_total"], expected_total);
        assert_eq!(result[0]["computation_status"], expected_status);
    }
}

#[test]
fn exact_narrow_body_composition_and_reserved_transport_headers_are_enforced() {
    let mut bindings = literature_component_execution_unit(COMPONENT).unwrap().1;
    bindings[0].source_value["definition"]["formula"] = json!("divide by word total");
    assert!(run_with(&[base()], &bindings)
        .unwrap_err()
        .contains("disagrees with registered conformance tuple"));
    let mut bindings = literature_component_execution_unit(COMPONENT).unwrap().1;
    bindings.extend(
        literature_component_execution_unit("chronicle.regret-supplied-session-activity/v1")
            .unwrap()
            .1,
    );
    assert!(run_with(&[base()], &bindings)
        .unwrap_err()
        .contains("composition"));
    let mut fields = FIELDS.to_vec();
    fields.push("component_study_total");
    let mut row = base();
    row.push("invented".into());
    let raw = encode(&fields, &[row]);
    assert!(adapt_literature_inputs(
        &raw,
        "sha256:test",
        &literature_component_execution_unit(COMPONENT).unwrap().1,
        |_| &[]
    )
    .err()
    .unwrap()
    .contains("reserved"));
}

#[test]
fn prepared_liwc_ratio_has_its_own_narrow_component_not_broad_daily_scores() {
    let (registration, bindings) =
        literature_component_execution_unit("chronicle.prepared-liwc-daily-display-ratio/v1")
            .expect("separate source-located prepared display ratio");
    assert_eq!(registration.full_profile_execution_status, "blocked");
    assert_eq!(bindings.len(), 1);
    assert_ne!(
        bindings[0].setting_id,
        "method-setting-becdeffcc6e91e394a5037b8"
    );
}
