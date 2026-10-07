//! Constructed supplied inventories with independent hand outcomes, not study rows.
use chronicle_preprocessing_runtime_wasm::literature_input_adapters::{
    adapt_literature_inputs, literature_component_execution_unit, MethodProfileInputBindingReceipt,
};
use chronicle_preprocessing_runtime_wasm::supplied_android_usage_statistics::{
    BJERRE_FIELDS, CAUGHT_FIELDS, MAPONTAP_FIELDS, REGRET_FIELDS, S3_FIELDS,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

const COMPONENTS: [&str; 5] = [
    "chronicle.caught-supplied-window-usage/v1",
    "chronicle.regret-supplied-session-activity/v1",
    "chronicle.s3-supplied-app-window-statistics/v1",
    "chronicle.mapontap-supplied-timestamp-normalization/v1",
    "chronicle.bjerre-supplied-long-session-class-exposure/v1",
];

#[test]
fn five_supplied_families_have_separate_source_owned_component_registrations() {
    for component in COMPONENTS {
        let (registration, bindings) = literature_component_execution_unit(component)
            .unwrap_or_else(|error| panic!("{component}: {error}"));
        assert_eq!(registration.component_id, component);
        assert_eq!(registration.full_profile_execution_status, "blocked");
        assert!(!registration.limitations.is_empty());
        assert!(!bindings.is_empty());
    }
}

fn hand() -> Value {
    serde_json::from_str(include_str!(
        "fixtures/supplied_android_usage_statistics_hand.json"
    ))
    .unwrap()
}

fn encode(fields: &[&str], rows: &[Vec<String>]) -> Vec<u8> {
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(fields).unwrap();
    for row in rows {
        writer.write_record(row).unwrap();
    }
    writer.into_inner().unwrap()
}

fn fields(component: &str) -> &'static [&'static str] {
    match component {
        c if c == COMPONENTS[0] => CAUGHT_FIELDS,
        c if c == COMPONENTS[1] => REGRET_FIELDS,
        c if c == COMPONENTS[2] => S3_FIELDS,
        c if c == COMPONENTS[3] => MAPONTAP_FIELDS,
        c if c == COMPONENTS[4] => BJERRE_FIELDS,
        _ => panic!("unknown hand fixture component"),
    }
}

fn bindings(component: &str) -> Vec<MethodProfileInputBindingReceipt> {
    literature_component_execution_unit(component).unwrap().1
}

fn run_with_bindings(
    component: &str,
    rows: &[Vec<String>],
    bindings: &[MethodProfileInputBindingReceipt],
) -> Result<Vec<BTreeMap<String, String>>, String> {
    let input_fields = fields(component);
    let raw = encode(input_fields, rows);
    let digest = format!("sha256:{}", hex::encode(Sha256::digest(&raw)));
    let adapted = adapt_literature_inputs(&raw, &digest, bindings, |_| &[])?.unwrap();
    assert_eq!(adapted.receipt.source_row_count as usize, rows.len());
    assert_eq!(adapted.receipt.emitted_row_count as usize, rows.len());
    assert_eq!(
        adapted.receipt.derived_result.as_ref().unwrap().row_count as usize,
        rows.len()
    );
    assert_eq!(adapted.receipt.original_input_digest, digest);
    assert_eq!(
        adapted.receipt.adapted_input_digest,
        format!("sha256:{}", hex::encode(Sha256::digest(&adapted.csv_bytes)))
    );
    assert_eq!(
        adapted.derived_result_bytes.as_deref(),
        Some(adapted.csv_bytes.as_slice())
    );
    let mut reader = csv::Reader::from_reader(adapted.csv_bytes.as_slice());
    let headers = reader.headers().unwrap().clone();
    assert_eq!(
        headers.iter().take(input_fields.len()).collect::<Vec<_>>(),
        input_fields
    );
    let output = reader.records().collect::<Result<Vec<_>, _>>().unwrap();
    assert_eq!(output.len(), rows.len());
    for (before, after) in rows.iter().zip(&output) {
        assert_eq!(
            before.iter().map(String::as_str).collect::<Vec<_>>(),
            after.iter().take(input_fields.len()).collect::<Vec<_>>()
        );
    }
    Ok(output
        .into_iter()
        .map(|r| {
            headers
                .iter()
                .zip(r.iter())
                .map(|(k, v)| (k.to_owned(), v.to_owned()))
                .collect()
        })
        .collect())
}

fn run(component: &str, rows: &[Vec<String>]) -> Result<Vec<BTreeMap<String, String>>, String> {
    run_with_bindings(component, rows, &bindings(component))
}

fn caught(stream: &str, members: Value) -> Vec<String> {
    vec![
        " P ".into(),
        " D ".into(),
        " W ".into(),
        "response-prior".into(),
        "response-next".into(),
        "clock".into(),
        stream.into(),
        if stream == "notifications" {
            "count"
        } else {
            "minutes, no conversion"
        }
        .into(),
        "2".into(),
        "source_qualified_completed_response_window".into(),
        "true".into(),
        members.to_string(),
    ]
}

fn regret(members: Value) -> Vec<String> {
    vec![
        " P ".into(),
        " D ".into(),
        " S ".into(),
        " app ".into(),
        "labels".into(),
        "source_qualified_screenshot_activity_membership".into(),
        "true".into(),
        members.to_string(),
    ]
}

fn s3(statistic: &str, members: Value) -> Vec<String> {
    let minute = statistic.contains("minute");
    vec![
        " P ".into(),
        " D ".into(),
        if minute {
            "minute-window"
        } else {
            "day-window"
        }
        .into(),
        "clock".into(),
        if minute { "last_minute" } else { "last_day" }.into(),
        statistic.into(),
        "source_qualified_foreground_app_window".into(),
        "true".into(),
        members.to_string(),
    ]
}

fn mapontap(samples: Value) -> Vec<String> {
    vec![
        " P ".into(),
        " D ".into(),
        " S ".into(),
        " series ".into(),
        "clock".into(),
        "opaque epoch unit".into(),
        "source_qualified_timestamp_series".into(),
        "true".into(),
        samples.to_string(),
    ]
}

fn bjerre(courses: Value) -> Vec<String> {
    vec![
        " P ".into(),
        " D ".into(),
        "class-inventory".into(),
        "clock".into(),
        "source_qualified_disjoint_class_overlap_inventory".into(),
        "true".into(),
        courses.to_string(),
    ]
}

#[test]
fn caught_seven_qualified_usage_families_reduce_occurrences_and_positive_exposure_not_answers() {
    let h = hand();
    let mut rows = [
        "total",
        "social_media",
        "messengers",
        "video_streaming",
        "browsers",
        "games",
    ]
    .iter()
    .map(|stream| caught(stream, h["caught"]["durationMembers"].clone()))
    .collect::<Vec<_>>();
    rows.push(caught(
        "notifications",
        h["caught"]["notificationMembers"].clone(),
    ));
    let output = run(COMPONENTS[0], &rows).unwrap();
    for row in &output[..6] {
        assert_eq!(row["usage_numerator"], "18");
        assert_eq!(row["per_hour_value"], "9");
        assert_eq!(row["normalization_status"], "computed");
        assert_eq!(row["output_unit_relation"], "input_unit_per_hour");
    }
    assert_eq!(output[6]["usage_numerator"], "3");
    assert_eq!(output[6]["per_hour_value"], "1.5");
    // Unnormalized source sums still own exactly their bare atoms; the narrow
    // sibling alone owns per-hour division, not broad all-pattern/fragmentation.
    let sum_binding = bindings(COMPONENTS[0])
        .into_iter()
        .filter(|b| b.setting_id == "method-setting-cb2571f7964ab2e4f112ffae")
        .collect::<Vec<_>>();
    let output = run_with_bindings(COMPONENTS[0], &rows[..1], &sum_binding).unwrap();
    assert_eq!(output[0]["usage_numerator"], "18");
    assert_eq!(output[0]["per_hour_value"], "");
    assert_eq!(output[0]["normalization_status"], "not_selected");
    assert!(!bindings(COMPONENTS[0])
        .iter()
        .any(|b| b.setting_id == "method-setting-afe8009f6faf347319012713"));
}

#[test]
fn caught_known_empty_zero_and_fractional_exposure_are_not_missing_or_false_zero() {
    for stream in ["total", "notifications"] {
        let output = run(COMPONENTS[0], &[caught(stream, json!([]))]).unwrap();
        assert_eq!(output[0]["usage_numerator"], "0");
        assert_eq!(output[0]["per_hour_value"], "0");
        assert_eq!(output[0]["normalization_status"], "computed");
    }
    let mut row = caught("total", hand()["caught"]["durationMembers"].clone());
    row[8] = "0.5".into();
    assert_eq!(
        run(COMPONENTS[0], &[row]).unwrap()[0]["per_hour_value"],
        "36"
    );
}

#[test]
fn caught_missing_negative_nonfinite_duplicate_and_fragmentation_inputs_are_refused() {
    let base = caught("total", hand()["caught"]["durationMembers"].clone());
    for (index, value, reason) in [
        (8, "0", "exposure_hours"),
        (8, "NaN", "exposure_hours"),
        (8, "-1", "exposure_hours"),
        (10, "false", "complete"),
        (9, "raw_window", "complete"),
        (6, "fragmentation", "feature_stream"),
        (11, "", "members_json"),
        (11, "null", "members_json"),
    ] {
        let mut row = base.clone();
        row[index] = value.into();
        assert!(
            run(COMPONENTS[0], &[row]).unwrap_err().contains(reason),
            "{index} {value}"
        );
    }
    for (members, reason) in [
        (json!([{"occurrence_id":"a","duration":-1}]), "nonnegative"),
        (
            json!([{"occurrence_id":"a","duration":null}]),
            "members_json",
        ),
        (
            json!([{"occurrence_id":"a","duration":1,"guessed_category":"games"}]),
            "members_json",
        ),
        (
            json!([{"occurrence_id":"a","duration":1},{"occurrence_id":"a","duration":2}]),
            "duplicate",
        ),
    ] {
        assert!(run(COMPONENTS[0], &[caught("total", members)])
            .unwrap_err()
            .contains(reason));
    }
    assert!(run(COMPONENTS[0], &[base.clone(), base])
        .unwrap_err()
        .contains("duplicate"));
}

#[test]
fn caught_overflow_or_nonzero_division_underflow_does_not_hide_other_windows() {
    let overflow = caught(
        "total",
        json!([{"occurrence_id":"a","duration":1e308},{"occurrence_id":"b","duration":1e308}]),
    );
    let mut tiny = caught("total", json!([{"occurrence_id":"tiny","duration":5e-324}]));
    tiny[2] = "tiny-window".into();
    let mut ordinary = caught("total", hand()["caught"]["durationMembers"].clone());
    ordinary[2] = "ordinary-window".into();
    let rows = run(COMPONENTS[0], &[overflow, tiny, ordinary]).unwrap();
    assert_eq!(rows[0]["usage_numerator"], "");
    assert_eq!(rows[0]["normalization_status"], "arithmetic_unavailable");
    assert_eq!(rows[0]["computation_reason"], "nonfinite_sum");
    assert_eq!(rows[1]["per_hour_value"], "");
    assert_eq!(
        rows[1]["computation_reason"],
        "nonfinite_or_underflow_division"
    );
    assert_eq!(rows[2]["per_hour_value"], "9");
}

#[test]
fn regret_unique_mode_counts_repeated_labels_not_distinct_labels_or_last_label() {
    let row = run(
        COMPONENTS[1],
        &[regret(hand()["regret"]["screenshots"].clone())],
    )
    .unwrap()
    .remove(0);
    assert_eq!(row["session_activity"], "Search");
    assert_eq!(row["activity_frequency"], "3");
    assert_eq!(row["screenshot_count"], "5");
}

#[test]
fn regret_ties_and_complete_empty_membership_are_unavailable_without_suppressing_other_sessions() {
    let tie = regret(
        json!([{"screenshot_id":"a","activity":"Other"},{"screenshot_id":"b","activity":"Search"}]),
    );
    let mut empty = regret(json!([]));
    empty[2] = "empty".into();
    let mut valid = regret(hand()["regret"]["screenshots"].clone());
    valid[2] = "valid".into();
    let output = run(COMPONENTS[1], &[tie, empty, valid]).unwrap();
    assert_eq!(output[0]["session_activity"], "");
    assert_eq!(
        output[0]["computation_reason"],
        "tied_most_prevalent_activity"
    );
    assert_eq!(output[1]["computation_reason"], "empty_activity_membership");
    assert_eq!(output[2]["session_activity"], "Search");
}

#[test]
fn regret_no_annotation_inference_for_invalid_labels_duplicate_screenshots_or_unknown_inventory() {
    for (members, reason) in [
        (
            json!([{"screenshot_id":"a","activity":"search"}]),
            "seven supplied",
        ),
        (
            json!([{"screenshot_id":"a","activity":null}]),
            "screenshots_json",
        ),
        (
            json!([{"screenshot_id":"a","activity":"Search"},{"screenshot_id":"a","activity":"Other"}]),
            "duplicate",
        ),
        (
            json!([{"screenshot_id":"","activity":"Search"}]),
            "nonblank",
        ),
    ] {
        assert!(run(COMPONENTS[1], &[regret(members)])
            .unwrap_err()
            .contains(reason));
    }
    let mut unknown = regret(hand()["regret"]["screenshots"].clone());
    unknown[6] = "unknown".into();
    assert!(run(COMPONENTS[1], &[unknown])
        .unwrap_err()
        .contains("complete"));
}

#[test]
fn s3_minute_and_day_totals_distinct_counts_unique_app_and_frequency_match_hand_results() {
    let h = hand();
    let mut rows = Vec::new();
    for window in ["minute", "day"] {
        for name in ["total_apps", "distinct_apps", "common_app"] {
            rows.push(s3(
                &format!("statistics.{name}_{window}"),
                h["s3"][window].clone(),
            ));
        }
        rows.push(s3(
            &format!("statistics.common_app_{window}_count"),
            h["s3"][window].clone(),
        ));
    }
    let output = run(COMPONENTS[2], &rows).unwrap();
    assert_eq!(
        [
            output[0]["app_statistic_value"].as_str(),
            output[1]["app_statistic_value"].as_str(),
            output[2]["most_common_app_id"].as_str(),
            output[3]["app_statistic_value"].as_str()
        ],
        ["3", "2", "A", "2"]
    );
    assert_eq!(
        [
            output[4]["app_statistic_value"].as_str(),
            output[5]["app_statistic_value"].as_str(),
            output[6]["most_common_app_id"].as_str(),
            output[7]["app_statistic_value"].as_str()
        ],
        ["4", "3", "B", "2"]
    );
    assert!(output.iter().all(|r| r["computation_status"] == "computed"));
}

#[test]
fn s3_complete_empty_counts_are_zero_while_empty_or_tied_modes_are_not_invented() {
    let output = run(
        COMPONENTS[2],
        &[
            s3("statistics.total_apps_minute", json!([])),
            s3("statistics.distinct_apps_minute", json!([])),
            s3("statistics.common_app_minute", json!([])),
            s3("statistics.common_app_minute_count", json!([])),
        ],
    )
    .unwrap();
    assert_eq!(output[0]["app_statistic_value"], "0");
    assert_eq!(output[1]["app_statistic_value"], "0");
    for row in &output[2..] {
        assert_eq!(row["computation_status"], "source_undefined");
        assert_eq!(row["most_common_app_id"], "");
    }
    let tie = json!([{"occurrence_id":"a","app_id":" A "},{"occurrence_id":"b","app_id":"A"}]);
    let output = run(COMPONENTS[2], &[s3("statistics.common_app_day_count", tie)]).unwrap();
    assert_eq!(output[0]["computation_reason"], "tied_most_common_app");
    assert_eq!(output[0]["app_statistic_value"], "");
}

#[test]
fn s3_membership_permutation_is_allowed_but_wrong_window_or_contradictory_membership_is_not() {
    let members = hand()["s3"]["minute"].clone();
    let mut reversed = members.clone();
    reversed.as_array_mut().unwrap().reverse();
    assert!(run(
        COMPONENTS[2],
        &[
            s3("statistics.total_apps_minute", members.clone()),
            s3("statistics.distinct_apps_minute", reversed)
        ]
    )
    .is_ok());
    let mut wrong = s3("statistics.total_apps_minute", members.clone());
    wrong[4] = "last_day".into();
    assert!(run(COMPONENTS[2], &[wrong])
        .unwrap_err()
        .contains("minute/day"));
    let mut conflicting = members.clone();
    conflicting[0]["app_id"] = json!("other");
    assert!(run(
        COMPONENTS[2],
        &[
            s3("statistics.total_apps_minute", members.clone()),
            s3("statistics.distinct_apps_minute", conflicting)
        ]
    )
    .unwrap_err()
    .contains("consistent occurrence"));
    let duplicate = json!([{"occurrence_id":"a","app_id":"A"},{"occurrence_id":"a","app_id":"A"}]);
    assert!(run(
        COMPONENTS[2],
        &[s3("statistics.total_apps_minute", duplicate)]
    )
    .unwrap_err()
    .contains("duplicate"));
}

#[test]
fn mapontap_reuses_minmax_arithmetic_and_preserves_timestamp_order_and_identity() {
    let h = hand();
    let output = run(
        COMPONENTS[3],
        &[mapontap(h["mapontap"]["timestamps"].clone())],
    )
    .unwrap();
    let values: Value = serde_json::from_str(&output[0]["normalized_timestamps_json"]).unwrap();
    assert_eq!(
        values
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v["value"].as_f64().unwrap())
            .collect::<Vec<_>>(),
        [0.0, 1.0, 0.25]
    );
    assert_eq!(
        values
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v["sample_id"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["t0", "t1", "t2"]
    );
    assert_eq!(output[0]["output_unit_relation"], "dimensionless");
    assert_eq!(output[0]["input_unit"], "opaque epoch unit");
    let signed=run(COMPONENTS[3],&[mapontap(json!([{"sample_id":"a","timestamp":-2},{"sample_id":"b","timestamp":-1},{"sample_id":"c","timestamp":2}]))]).unwrap();
    let values: Value = serde_json::from_str(&signed[0]["normalized_timestamps_json"]).unwrap();
    assert_eq!(values[1]["value"], json!(0.25));
}

#[test]
fn mapontap_constant_range_nonfinite_arithmetic_and_nonzero_underflow_remain_unavailable() {
    let output = run(
        COMPONENTS[3],
        &[mapontap(
            json!([{"sample_id":"a","timestamp":4},{"sample_id":"b","timestamp":4}]),
        )],
    )
    .unwrap();
    let values: Value = serde_json::from_str(&output[0]["normalized_timestamps_json"]).unwrap();
    assert_eq!(values[0]["value"], Value::Null);
    assert_eq!(values[0]["reason"], "zero_range_behavior_undisclosed");
    let output = run(
        COMPONENTS[3],
        &[mapontap(
            json!([{"sample_id":"a","timestamp":-1e308},{"sample_id":"b","timestamp":1e308}]),
        )],
    )
    .unwrap();
    let values: Value = serde_json::from_str(&output[0]["normalized_timestamps_json"]).unwrap();
    assert_eq!(values[0]["reason"], "nonfinite_arithmetic");
    let output=run(COMPONENTS[3],&[mapontap(json!([{"sample_id":"a","timestamp":0},{"sample_id":"tiny","timestamp":5e-324},{"sample_id":"b","timestamp":1e308}]))]).unwrap();
    let values: Value = serde_json::from_str(&output[0]["normalized_timestamps_json"]).unwrap();
    assert_eq!(
        values[1]["reason"],
        "floating_point_normalization_underflow"
    );
    assert_eq!(values[0]["value"], json!(0.0));
    assert_eq!(values[2]["value"], json!(1.0));
}

#[test]
fn mapontap_empty_missing_duplicate_or_unqualified_samples_are_not_reconstructed() {
    for (members, reason) in [
        (json!([]), "nonempty"),
        (
            json!([{"sample_id":"a","timestamp":null}]),
            "timestamps_json",
        ),
        (
            json!([{"sample_id":"a","timestamp":1},{"sample_id":"a","timestamp":2}]),
            "duplicate",
        ),
        (
            json!([{"sample_id":"a","timestamp":1,"guessed_epoch":"UTC"}]),
            "timestamps_json",
        ),
    ] {
        assert!(run(COMPONENTS[3], &[mapontap(members)])
            .unwrap_err()
            .contains(reason));
    }
    let mut row = mapontap(hand()["mapontap"]["timestamps"].clone());
    row[7] = "false".into();
    assert!(run(COMPONENTS[3], &[row]).unwrap_err().contains("complete"));
}

#[test]
fn bjerre_original_duration_gate_class_denominators_and_unweighted_course_mean_match_hand() {
    let h = hand();
    let rows = run(COMPONENTS[4], &[bjerre(h["bjerre"]["courses"].clone())]).unwrap();
    let eligible: Value = serde_json::from_str(&rows[0]["long_session_eligibility_json"]).unwrap();
    assert_eq!(
        eligible
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v["eligible"].as_bool().unwrap())
            .collect::<Vec<_>>(),
        [false, true, true, true]
    );
    let courses: Value = serde_json::from_str(&rows[0]["course_percentages_json"]).unwrap();
    assert_eq!(courses[0]["long_overlap_seconds"], json!(40.0));
    assert_eq!(courses[0]["percent"], json!(40.0));
    assert_eq!(courses[1]["long_overlap_seconds"], json!(100.0));
    assert_eq!(courses[1]["percent"], json!(10.0));
    assert_eq!(rows[0]["mean_course_percent"], "25"); // NOT pooled 140/1100*100.
    assert_eq!(
        rows[0]["output_unit_relation"],
        "percent_not_screen_day_share"
    );
    let threshold = bindings(COMPONENTS[4])
        .into_iter()
        .filter(|b| b.setting_id == "method-setting-a284080cd1a1c61e0f7957fe")
        .collect::<Vec<_>>();
    let output = run_with_bindings(
        COMPONENTS[4],
        &[bjerre(h["bjerre"]["courses"].clone())],
        &threshold,
    )
    .unwrap();
    assert_eq!(output[0]["mean_course_percent"], "");
    assert_eq!(output[0]["course_percentages_json"], "");
}

#[test]
fn bjerre_empty_overlap_is_known_zero_and_an_unavailable_course_is_not_dropped() {
    let mut courses = hand()["bjerre"]["courses"].clone();
    courses[1]["overlaps"] = json!([]);
    let output = run(COMPONENTS[4], &[bjerre(courses)]).unwrap();
    assert_eq!(output[0]["mean_course_percent"], "20");
    let courses = json!([{"course_id":"tiny","class_exposure_seconds":1e308,"overlaps":[{"session_id":"s","overlap_id":"o","original_duration_seconds":35,"overlap_seconds":5e-324}]},
        {"course_id":"normal","class_exposure_seconds":100,"overlaps":[{"session_id":"t","overlap_id":"p","original_duration_seconds":35,"overlap_seconds":10}]}]);
    let output = run(COMPONENTS[4], &[bjerre(courses)]).unwrap();
    assert_eq!(output[0]["mean_course_percent"], "");
    let detail: Value = serde_json::from_str(&output[0]["course_percentages_json"]).unwrap();
    assert_eq!(detail[0]["percent"], Value::Null);
    assert_eq!(detail[1]["percent"], json!(10.0));
}

#[test]
fn bjerre_invalid_class_exposure_overlap_ownership_and_incomplete_membership_are_refused() {
    let base = hand()["bjerre"]["courses"].clone();
    for (change, reason) in [
        ("zero-exposure", "positive finite"),
        ("overlap-too-long", "no longer"),
        ("duplicate-course", "duplicate"),
        ("duplicate-overlap", "duplicate"),
        ("inconsistent-session", "consistent original"),
        ("excess-class-time", "exceed class exposure"),
        ("overflowing-class-time", "exceed class exposure"),
        ("extra-guess", "courses_json"),
        ("empty-courses", "nonempty"),
    ] {
        let mut courses = base.clone();
        match change {
            "zero-exposure" => courses[0]["class_exposure_seconds"] = json!(0),
            "overlap-too-long" => courses[0]["overlaps"][0]["overlap_seconds"] = json!(100),
            "duplicate-course" => courses[1]["course_id"] = courses[0]["course_id"].clone(),
            "duplicate-overlap" => {
                courses[0]["overlaps"][1]["overlap_id"] =
                    courses[0]["overlaps"][0]["overlap_id"].clone()
            }
            "inconsistent-session" => {
                courses[1]["overlaps"][0]["session_id"] =
                    courses[0]["overlaps"][0]["session_id"].clone()
            }
            "excess-class-time" => courses[0]["class_exposure_seconds"] = json!(1),
            "overflowing-class-time" => {
                courses = json!([{"course_id":"overflow","class_exposure_seconds":1e308,"overlaps":[
                    {"session_id":"a","overlap_id":"a","original_duration_seconds":1e308,"overlap_seconds":1e308},
                    {"session_id":"b","overlap_id":"b","original_duration_seconds":1e308,"overlap_seconds":1e308}]}]);
            }
            "extra-guess" => courses[0]["guessed_attendance"] = json!(true),
            "empty-courses" => courses = json!([]),
            _ => unreachable!(),
        }
        assert!(
            run(COMPONENTS[4], &[bjerre(courses)])
                .unwrap_err()
                .contains(reason),
            "{change}"
        );
    }
    let mut row = bjerre(base);
    row[5] = "unknown".into();
    assert!(run(COMPONENTS[4], &[row]).unwrap_err().contains("complete"));
}

#[test]
fn exact_source_definitions_foreign_bindings_and_reserved_headers_are_not_weakened() {
    let rows = [
        caught("total", hand()["caught"]["durationMembers"].clone()),
        regret(hand()["regret"]["screenshots"].clone()),
        s3(
            "statistics.total_apps_minute",
            hand()["s3"]["minute"].clone(),
        ),
        mapontap(hand()["mapontap"]["timestamps"].clone()),
        bjerre(hand()["bjerre"]["courses"].clone()),
    ];
    for (component, row) in COMPONENTS.iter().zip(&rows) {
        let mut tampered = bindings(component);
        tampered[0].source_value = json!("different source definition");
        assert!(
            run_with_bindings(component, std::slice::from_ref(row), &tampered).is_err(),
            "{component}"
        );
        let mut incomplete = row.clone();
        let index = fields(component)
            .iter()
            .position(|f| *f == "inventory_complete")
            .unwrap();
        incomplete[index] = "false".into();
        assert!(run(component, &[incomplete]).is_err());
    }
    let mut composite = bindings(COMPONENTS[0]);
    composite.extend(bindings(COMPONENTS[1]));
    assert!(run_with_bindings(COMPONENTS[0], &rows[..1], &composite)
        .unwrap_err()
        .contains("composition"));
    let mut headers = CAUGHT_FIELDS.to_vec();
    headers.push("usage_numerator");
    let mut row = rows[0].clone();
    row.push("injected".into());
    let raw = encode(&headers, &[row]);
    assert!(
        adapt_literature_inputs(&raw, "sha256:test", &bindings(COMPONENTS[0]), |_| &[])
            .err()
            .unwrap()
            .contains("reserved output")
    );
}
