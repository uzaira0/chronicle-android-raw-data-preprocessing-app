#[path = "../src/touch_keyboard_event_vector.rs"]
mod touch_keyboard_event_vector;

use serde::Deserialize;
use touch_keyboard_event_vector::{
    parse_touch_keyboard_event_vectors, TouchKeyboardEventVector, TOUCH_VECTOR_REQUIRED_FIELDS,
};

const SOURCE_FIXTURE: &str = include_str!("fixtures/touch_keyboard_event_vector_acii_8925518.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    source_sha256: String,
    source_locator: String,
    exact_canonical_setting_ids: Vec<String>,
    source_semantics: SourceSemantics,
    valid_csv_lines: Vec<String>,
    expected_records: Vec<ExpectedRecord>,
    invalid_lexical_cases: Vec<InvalidLexicalCase>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourceSemantics {
    row_cardinality: String,
    fields: serde_json::Value,
    undisclosed: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InvalidLexicalCase {
    case_id: String,
    field: String,
    value: String,
    expected_reason: String,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct ExpectedRecord {
    source_record_index: usize,
    participant_id: Option<String>,
    event_timestamp: Option<String>,
    source_row_id: Option<String>,
    inter_tap_duration: f64,
    alphanumeric: bool,
    special_character: bool,
    backspace: bool,
    pressure: f64,
    speed: f64,
    touch_time: f64,
}

impl From<TouchKeyboardEventVector> for ExpectedRecord {
    fn from(record: TouchKeyboardEventVector) -> Self {
        Self {
            source_record_index: record.source_record_index,
            participant_id: record.participant_id,
            event_timestamp: record.event_timestamp,
            source_row_id: record.source_row_id,
            inter_tap_duration: record.inter_tap_duration,
            alphanumeric: record.alphanumeric,
            special_character: record.special_character,
            backspace: record.backspace,
            pressure: record.pressure,
            speed: record.speed,
            touch_time: record.touch_time,
        }
    }
}

fn csv_bytes(lines: &[String]) -> Vec<u8> {
    let mut text = lines.join("\n");
    text.push('\n');
    text.into_bytes()
}

fn required_only_csv(field_override: Option<(&str, &str)>) -> Vec<u8> {
    let values = ["0.1", "1", "0", "0", "0.2", "0.3", "0.4"];
    let values = TOUCH_VECTOR_REQUIRED_FIELDS
        .iter()
        .zip(values)
        .map(|(field, default)| {
            field_override
                .filter(|(override_field, _)| override_field == field)
                .map(|(_, value)| value)
                .unwrap_or(default)
        })
        .collect::<Vec<_>>();
    format!(
        "{}\n{}\n",
        TOUCH_VECTOR_REQUIRED_FIELDS.join(","),
        values.join(",")
    )
    .into_bytes()
}

#[test]
fn seven_fields_remain_one_typed_row_without_invented_units_or_ranges() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("T15 fixture JSON");
    assert_eq!(
        fixture.schema_version,
        "chronicle-touch-keyboard-event-vector-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1109/acii.2019.8925518");
    assert_eq!(
        fixture.source_sha256,
        "e7541b1d4d0c67e705b9b60fbb80e486931dda3240fc28c9ee53a6b3358560dd"
    );
    assert!(fixture.source_locator.ends_with("214-primary.txt:134-160"));
    assert_eq!(
        fixture.exact_canonical_setting_ids,
        [
            "method-setting-293e63181b72ee0e0b7cc5bc",
            "method-setting-54dfd51fa90147857f7f2522",
            "method-setting-7d8c397698c8e6a833b3f65f",
            "method-setting-a2b695eb8449919ee41d5b04",
            "method-setting-d46f6478867dec906dac2b80",
            "method-setting-e6ca0f6eda4ab9ca31f87d46",
            "method-setting-ea0c43ce79fd78c9089ee6a7",
        ]
    );
    assert_eq!(
        fixture.source_semantics.row_cardinality,
        "one seven-dimensional vector per current touch interaction"
    );
    assert_eq!(
        fixture
            .source_semantics
            .fields
            .as_object()
            .expect("field semantics")
            .len(),
        7
    );
    assert!(fixture
        .source_semantics
        .undisclosed
        .iter()
        .any(|item| item == "numeric units and ranges"));

    let actual = parse_touch_keyboard_event_vectors(&csv_bytes(&fixture.valid_csv_lines))
        .expect("valid seven-field vectors")
        .into_iter()
        .map(ExpectedRecord::from)
        .collect::<Vec<_>>();
    assert_eq!(actual, fixture.expected_records);
    assert!(
        actual[1].pressure < 0.0,
        "undisclosed ranges are not invented"
    );

    let required_only = parse_touch_keyboard_event_vectors(&required_only_csv(None))
        .expect("transport identity columns are optional");
    assert_eq!(required_only.len(), 1);
    assert_eq!(required_only[0].participant_id, None);
    assert_eq!(required_only[0].event_timestamp, None);
    assert_eq!(required_only[0].source_row_id, None);
}

#[test]
fn every_vector_field_is_required_and_lexical_types_fail_closed() {
    for missing_field in TOUCH_VECTOR_REQUIRED_FIELDS {
        let headers = TOUCH_VECTOR_REQUIRED_FIELDS
            .iter()
            .copied()
            .filter(|field| *field != missing_field)
            .collect::<Vec<_>>();
        let values = headers
            .iter()
            .map(|field| if field.ends_with("_flag") { "0" } else { "0.1" })
            .collect::<Vec<_>>();
        let input = format!("{}\n{}\n", headers.join(","), values.join(","));
        let error = parse_touch_keyboard_event_vectors(input.as_bytes())
            .expect_err("missing vector column must fail");
        assert!(
            error.to_string().contains(missing_field),
            "missing column {missing_field}: {error}"
        );

        let error =
            parse_touch_keyboard_event_vectors(&required_only_csv(Some((missing_field, ""))))
                .expect_err("empty vector cell must fail");
        assert!(
            error.to_string().contains(missing_field),
            "empty cell {missing_field}: {error}"
        );
    }

    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("T15 fixture JSON");
    for invalid in fixture.invalid_lexical_cases {
        let error = parse_touch_keyboard_event_vectors(&required_only_csv(Some((
            &invalid.field,
            &invalid.value,
        ))))
        .expect_err(&format!("{} should fail", invalid.case_id));
        assert!(
            error.to_string().contains(&invalid.expected_reason),
            "{}: {error}",
            invalid.case_id
        );
    }
}
