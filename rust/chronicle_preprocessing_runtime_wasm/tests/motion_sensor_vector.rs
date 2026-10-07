#[path = "../src/motion_sensor_vector.rs"]
mod motion_sensor_vector;

use motion_sensor_vector::{
    parse_motion_sensor_vectors, MotionSensorVectorRecord, MOTION_VECTOR_REQUIRED_FIELDS,
};
use serde::Deserialize;

const SOURCE_FIXTURE: &str = include_str!("fixtures/motion_sensor_vector_inffus_2018_09_002.json");

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
    invalid_numeric_cases: Vec<InvalidNumericCase>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourceSemantics {
    record_shape: String,
    source_representation: String,
    carrier_boundary: String,
    undisclosed: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InvalidNumericCase {
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
    acceleration_x: f64,
    acceleration_y: f64,
    acceleration_z: f64,
}

impl From<MotionSensorVectorRecord> for ExpectedRecord {
    fn from(record: MotionSensorVectorRecord) -> Self {
        Self {
            source_record_index: record.source_record_index,
            participant_id: record.participant_id,
            event_timestamp: record.event_timestamp,
            source_row_id: record.source_row_id,
            acceleration_x: record.acceleration_x,
            acceleration_y: record.acceleration_y,
            acceleration_z: record.acceleration_z,
        }
    }
}

fn csv_bytes(lines: &[String]) -> Vec<u8> {
    let mut text = lines.join("\n");
    text.push('\n');
    text.into_bytes()
}

fn required_only_csv(field_override: Option<(&str, &str)>) -> Vec<u8> {
    let values = ["-1.5", "0", "2.75"];
    let values = MOTION_VECTOR_REQUIRED_FIELDS
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
        MOTION_VECTOR_REQUIRED_FIELDS.join(","),
        values.join(",")
    )
    .into_bytes()
}

#[test]
fn xyz_axes_remain_one_typed_record_without_an_invented_scalar_or_sensor_policy() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("T14 fixture JSON");
    assert_eq!(
        fixture.schema_version,
        "chronicle-motion-sensor-vector-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1016/j.inffus.2018.09.002");
    assert_eq!(
        fixture.source_sha256,
        "18776767465d1a1f9fa482f4194a29f2598cf2b8ac6817a3aa68910fc9760f55"
    );
    assert!(fixture
        .source_locator
        .ends_with("huang-phd-proposal-slides.txt:510-660"));
    assert_eq!(
        fixture.exact_canonical_setting_ids,
        [
            "method-setting-cf5961c49b8d305a459526ee",
            "method-setting-9a8ba59dc00b30423cf610e8",
            "method-setting-1d31b1e737addc50136f27ed",
        ]
    );
    assert_eq!(
        fixture.source_semantics.record_shape,
        "one inseparable three-axis X/Y/Z acceleration vector"
    );
    assert!(fixture
        .source_semantics
        .source_representation
        .contains("Y(3xT)"));
    assert!(fixture
        .source_semantics
        .carrier_boundary
        .contains("synthetic Chronicle carrier"));
    for undisclosed in [
        "accelerometer units",
        "device coordinate frame and orientation",
        "sampling cadence",
        "gravity handling",
        "missing-row policy",
        "any scalar or magnitude transformation",
    ] {
        assert!(fixture
            .source_semantics
            .undisclosed
            .iter()
            .any(|item| item == undisclosed));
    }

    let actual = parse_motion_sensor_vectors(&csv_bytes(&fixture.valid_csv_lines))
        .expect("valid XYZ vectors")
        .into_iter()
        .map(ExpectedRecord::from)
        .collect::<Vec<_>>();
    assert_eq!(actual, fixture.expected_records);
    assert!(actual[0].acceleration_z < 0.0);
    assert!(actual[1].acceleration_z > 0.0);

    let required_only = parse_motion_sensor_vectors(&required_only_csv(None))
        .expect("transport identity columns are optional");
    assert_eq!(required_only.len(), 1);
    assert_eq!(required_only[0].participant_id, None);
    assert_eq!(required_only[0].event_timestamp, None);
    assert_eq!(required_only[0].source_row_id, None);
}

#[test]
fn every_axis_is_required_and_non_finite_or_invalid_values_fail_closed() {
    for missing_field in MOTION_VECTOR_REQUIRED_FIELDS {
        let headers = MOTION_VECTOR_REQUIRED_FIELDS
            .iter()
            .copied()
            .filter(|field| *field != missing_field)
            .collect::<Vec<_>>();
        let values = vec!["0"; headers.len()];
        let input = format!("{}\n{}\n", headers.join(","), values.join(","));
        let error = parse_motion_sensor_vectors(input.as_bytes())
            .expect_err("missing axis column must fail");
        assert!(
            error.to_string().contains(missing_field),
            "missing column {missing_field}: {error}"
        );

        let error = parse_motion_sensor_vectors(&required_only_csv(Some((missing_field, ""))))
            .expect_err("empty axis value must fail");
        assert!(
            error.to_string().contains(missing_field),
            "empty cell {missing_field}: {error}"
        );
    }

    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("T14 fixture JSON");
    for invalid in fixture.invalid_numeric_cases {
        let error =
            parse_motion_sensor_vectors(&required_only_csv(Some((&invalid.field, &invalid.value))))
                .expect_err(&format!("{} should fail", invalid.case_id));
        assert!(
            error.to_string().contains(&invalid.expected_reason),
            "{}: {error}",
            invalid.case_id
        );
    }

    for invalid in ["not-a-number", " 1", "1 "] {
        let error =
            parse_motion_sensor_vectors(&required_only_csv(Some(("acceleration_x", invalid))))
                .expect_err("invalid lexical numeric must fail");
        assert!(error.to_string().contains("not a finite number"));
    }

    let duplicate = b"acceleration_x,acceleration_y,acceleration_z,acceleration_x\n1,2,3,4\n";
    let error = parse_motion_sensor_vectors(duplicate).expect_err("duplicate header must fail");
    assert!(error.to_string().contains("duplicate motion-vector column"));
}
