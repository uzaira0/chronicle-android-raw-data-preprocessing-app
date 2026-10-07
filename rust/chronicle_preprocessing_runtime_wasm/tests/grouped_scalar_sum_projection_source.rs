#[path = "../src/grouped_scalar_sum_projection.rs"]
mod grouped_scalar_sum_projection;

use std::collections::BTreeMap;

use grouped_scalar_sum_projection::{
    grouped_scalar_sum_then_project_unique, GroupedScalarInput, GroupedScalarProjection,
    GroupedScalarSumProjectionError, RCompatibleScalar, SequentialDivisionConfiguration,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/grouped_scalar_sum_projection_dekker_2024.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    source_code_sha256: String,
    source_locator: String,
    source_group_sha256: String,
    identity_disposition: String,
    alias_tombstone_registry_sha256: String,
    exact_canonical_settings: Vec<CanonicalSetting>,
    input_boundary: String,
    configuration: FixtureConfiguration,
    projection_by_raw_time: BTreeMap<String, String>,
    rows: Vec<FixtureRow>,
    expected: Vec<ExpectedRow>,
    invalid_projection_raw_time: String,
    limitations: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CanonicalSetting {
    id: String,
    parameter_key: String,
    source_value: String,
    source_value_sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureConfiguration {
    first_divisor: f64,
    second_divisor: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureRow {
    id: String,
    raw_time: String,
    sample: String,
    app_seconds: String,
}

#[derive(Debug, Deserialize)]
struct ExpectedRow {
    id: String,
    sample: String,
    date: String,
    seconds: String,
    minutes: String,
    hours: String,
}

#[test]
fn source_pipeline_groups_before_date_projection_and_preserves_r_values() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("source fixture JSON");

    assert_eq!(
        fixture.schema_version,
        "chronicle-grouped-scalar-sum-projection-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1080/15213269.2024.2334025");
    assert_eq!(
        fixture.source_code_sha256,
        "2bd5bab0c9a917a64f347093972bff72e2b0b5cfd38539a1df229c65cdbd383b"
    );
    assert!(fixture
        .source_locator
        .ends_with("(2) R script data cleaning [raw survey & tracking data].R:323-335"));
    assert_eq!(
        fixture.source_group_sha256,
        "61c0572cd92afe05d5c094ef751ec503cf65ca51d33d6105d5e38fbc0e3bd4e5"
    );
    assert_eq!(
        fixture.identity_disposition,
        "three_current_joint_pipeline_settings; no_aliases_or_tombstones"
    );
    assert_eq!(
        fixture.alias_tombstone_registry_sha256,
        "018221f6036218887355a0a2dcd9d6d54a9e90eb93f380b4e1b81cc75c0f76b5"
    );

    let expected_settings = [
        (
            "method-setting-47a31487d53fcbbfb3599681",
            "daily_screen_time.variant.1",
            "sum APP_USAGE seconds by participant",
            "12b5d84b86fab854680ffda61f7e0c29386b2809c6213e9ca9b457776ae4397e",
        ),
        (
            "method-setting-c6d932d27437255c0c67f9ec",
            "daily_screen_time.variant.2",
            "date, convert to minutes",
            "3d1b3b81b7bcc135ba1e50c7919504e88de3f3984a74108181810ea712c3b26a",
        ),
        (
            "method-setting-af3dc29b102335bbb62f6e7f",
            "daily_screen_time.variant.3",
            "hours",
            "4c1f72a6691d59d311cc09835b6a9ea6c94cbd58cab0f641a4cc45b38e8dd70c",
        ),
    ];
    assert_eq!(fixture.exact_canonical_settings.len(), 3);
    for (setting, expected) in fixture
        .exact_canonical_settings
        .iter()
        .zip(expected_settings)
    {
        assert_eq!(setting.id, expected.0);
        assert_eq!(setting.parameter_key, expected.1);
        assert_eq!(setting.source_value, expected.2);
        assert_eq!(setting.source_value_sha256, expected.3);
        assert_eq!(
            sha256(format!(
                "{}: {}",
                setting.parameter_key,
                serde_json::to_string(&setting.source_value).expect("source value JSON")
            )),
            setting.source_value_sha256
        );
    }
    assert!(fixture.input_boundary.contains("original raw time"));
    assert!(fixture.input_boundary.contains("as.Date"));
    assert_eq!(fixture.limitations.len(), 4);

    let configuration = SequentialDivisionConfiguration {
        first_divisor: fixture.configuration.first_divisor,
        second_divisor: fixture.configuration.second_divisor,
    };
    let rows = fixture
        .rows
        .iter()
        .map(|row| GroupedScalarInput {
            entity: row.id.clone(),
            raw_partition: row.raw_time.clone(),
            passthrough: row.sample.clone(),
            value: parse_scalar(&row.app_seconds),
        })
        .collect::<Vec<_>>();
    let actual = grouped_scalar_sum_then_project_unique(&rows, configuration, |raw_time| {
        fixture.projection_by_raw_time.get(raw_time).cloned()
    })
    .expect("source-shaped rows have explicit projections");

    assert_eq!(actual.len(), 9);
    assert_outputs(&actual, &fixture.expected);
    assert_eq!(actual[0].entity, "B");
    assert_eq!(actual[0].sum, RCompatibleScalar::Finite(40.0));
    assert_eq!(actual[1].entity, "A");
    assert_eq!(actual[1].sum, RCompatibleScalar::Finite(60.0));
    assert_eq!(actual[2].entity, "Z");
    assert_eq!(actual[3].entity, "Z");
    assert_eq!(actual[2].sum, RCompatibleScalar::Finite(30.0));
    assert_eq!(actual[3].sum, RCompatibleScalar::Finite(30.0));

    let invalid_row = [GroupedScalarInput {
        entity: "X".to_owned(),
        raw_partition: fixture.invalid_projection_raw_time.clone(),
        passthrough: "lab".to_owned(),
        value: RCompatibleScalar::Finite(1.0),
    }];
    assert_eq!(
        grouped_scalar_sum_then_project_unique(&invalid_row, configuration, |_| None::<String>),
        Err(GroupedScalarSumProjectionError::ProjectionFailed {
            source_record_index: 1
        })
    );
    assert_eq!(
        grouped_scalar_sum_then_project_unique(
            &invalid_row,
            SequentialDivisionConfiguration {
                first_divisor: 0.0,
                second_divisor: 60.0,
            },
            |_| Some("2024-02-09".to_owned()),
        ),
        Err(GroupedScalarSumProjectionError::InvalidFirstDivisor)
    );
    assert_eq!(
        grouped_scalar_sum_then_project_unique(
            &invalid_row,
            SequentialDivisionConfiguration {
                first_divisor: 60.0,
                second_divisor: f64::NAN,
            },
            |_| Some("2024-02-09".to_owned()),
        ),
        Err(GroupedScalarSumProjectionError::InvalidSecondDivisor)
    );
    let empty: Vec<GroupedScalarInput<String, String, String>> = Vec::new();
    assert_eq!(
        grouped_scalar_sum_then_project_unique(&empty, configuration, |_| Some(String::new())),
        Ok(Vec::new())
    );
}

fn parse_scalar(value: &str) -> RCompatibleScalar {
    match value {
        "NA" => RCompatibleScalar::Missing,
        "NaN" => RCompatibleScalar::NotANumber,
        "+Inf" => RCompatibleScalar::PositiveInfinity,
        "-Inf" => RCompatibleScalar::NegativeInfinity,
        value => RCompatibleScalar::Finite(value.parse().expect("finite scalar")),
    }
}

fn assert_outputs(
    actual: &[GroupedScalarProjection<String, String, String>],
    expected: &[ExpectedRow],
) {
    assert_eq!(actual.len(), expected.len());
    for (actual, expected) in actual.iter().zip(expected) {
        assert_eq!(actual.entity, expected.id);
        assert_eq!(actual.passthrough, expected.sample);
        assert_eq!(actual.projected_partition, expected.date);
        assert_scalar(actual.sum, &expected.seconds);
        assert_scalar(actual.first_scaled_value, &expected.minutes);
        assert_scalar(actual.second_scaled_value, &expected.hours);
    }
}

fn assert_scalar(actual: RCompatibleScalar, expected: &str) {
    match (actual, expected) {
        (RCompatibleScalar::Missing, "NA")
        | (RCompatibleScalar::NotANumber, "NaN")
        | (RCompatibleScalar::PositiveInfinity, "+Inf")
        | (RCompatibleScalar::NegativeInfinity, "-Inf") => {}
        (RCompatibleScalar::Finite(actual), expected) => {
            let expected = expected.parse::<f64>().expect("finite expected scalar");
            assert_eq!(actual, expected);
        }
        _ => panic!("expected {expected}, got {actual:?}"),
    }
}

fn sha256(value: String) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}
