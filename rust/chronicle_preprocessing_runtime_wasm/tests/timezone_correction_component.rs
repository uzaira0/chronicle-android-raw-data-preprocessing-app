#[path = "../src/timezone_correction_component.rs"]
mod timezone_correction_component;
#[path = "../src/timezone_offset_knn.rs"]
mod timezone_offset_knn;

use serde::Deserialize;
use std::collections::BTreeMap;
use timezone_correction_component::{
    execute_timestamp_correction_csv, TimestampCorrectionConfiguration,
};

const FIXTURE: &str = include_str!("fixtures/schoedel_timestamp_correction_r_oracle.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    source_method_variant_id: String,
    exact_canonical_setting_ids: Vec<String>,
    source_artifacts: Vec<SourceArtifact>,
    oracle: Oracle,
    configuration: TimestampCorrectionConfiguration,
    raw_csv: String,
    oracle_output_csv: String,
    expected_input_row_count: usize,
    expected_output_row_count: usize,
    expected_wrong_year_or_missing_timestamp_row_count: usize,
    expected_duplicate_id_row_count: usize,
    limitations: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct SourceArtifact {
    path: String,
    sha256: String,
    locator: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Oracle {
    container_image: String,
    runtime: String,
    packages: BTreeMap<String, String>,
}

fn records(csv: &[u8]) -> (csv::StringRecord, Vec<csv::StringRecord>) {
    let mut reader = csv::Reader::from_reader(csv);
    let header = reader.headers().expect("CSV header").clone();
    let rows = reader
        .records()
        .collect::<Result<Vec<_>, _>>()
        .expect("CSV rows");
    (header, rows)
}

#[test]
fn deposited_r_4_1_2_timestamp_correction_is_replayed_semantically() {
    let fixture: Fixture = serde_json::from_str(FIXTURE).expect("timestamp-correction fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-schoedel-timestamp-correction-r-oracle/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1016/j.chb.2023.107977");
    assert_eq!(
        fixture.source_method_variant_id,
        "source-audit-configuration-space-8b14e63d69954819163df993"
    );
    assert_eq!(fixture.exact_canonical_setting_ids.len(), 5);
    assert_eq!(fixture.source_artifacts.len(), 3);
    assert!(fixture.source_artifacts.iter().all(|artifact| {
        !artifact.path.is_empty() && artifact.sha256.len() == 64 && !artifact.locator.is_empty()
    }));
    assert_eq!(fixture.oracle.runtime, "R version 4.1.2 (2021-11-01)");
    assert!(fixture
        .oracle
        .container_image
        .ends_with("879098acd5a8277f3c368a1e2c431019d00d952959a588da12cdaaee9d968b8b"));
    assert_eq!(fixture.oracle.packages["lubridate"], "1.8.0");
    assert_eq!(fixture.oracle.packages["dplyr"], "1.0.8");
    assert!(fixture
        .limitations
        .iter()
        .any(|value| value.contains("ESM plus-or-minus-30-minute")));

    let output =
        execute_timestamp_correction_csv(fixture.raw_csv.as_bytes(), &fixture.configuration)
            .expect("bounded timestamp correction executes");
    assert_eq!(output.input_row_count, fixture.expected_input_row_count);
    assert_eq!(output.output_row_count, fixture.expected_output_row_count);
    assert_eq!(
        output.wrong_year_or_missing_timestamp_row_count,
        fixture.expected_wrong_year_or_missing_timestamp_row_count
    );
    assert_eq!(
        output.duplicate_id_row_count,
        fixture.expected_duplicate_id_row_count
    );

    let (actual_header, actual_rows) = records(&output.derived_csv);
    let (oracle_header, oracle_rows) = records(fixture.oracle_output_csv.as_bytes());
    assert_eq!(actual_header, oracle_header);
    assert_eq!(actual_rows.len(), oracle_rows.len());
    for (actual, oracle) in actual_rows.iter().zip(&oracle_rows) {
        for index in 0..actual.len() {
            if matches!(index, 4 | 10 | 11) {
                let actual_number = actual[index].parse::<f64>().expect("actual number");
                let oracle_number = oracle[index].parse::<f64>().expect("oracle number");
                assert!(
                    (actual_number - oracle_number).abs() <= 1e-10,
                    "numeric column {index}: {actual_number} != {oracle_number}"
                );
            } else {
                assert_eq!(actual[index], oracle[index], "column {index}");
            }
        }
    }
}

#[test]
fn source_boundary_and_fixed_configuration_fail_closed() {
    let fixture: Fixture = serde_json::from_str(FIXTURE).expect("timestamp-correction fixture");

    let multiple_participants =
        fixture
            .raw_csv
            .replacen("p-source-01,r-late", "p-source-02,r-late", 1);
    let error =
        execute_timestamp_correction_csv(multiple_participants.as_bytes(), &fixture.configuration)
            .expect_err("the source function is scoped to one participant");
    assert!(error.contains("exactly one participant"));

    let mut changed = fixture.configuration.clone();
    changed.study_year = 2021;
    let error = execute_timestamp_correction_csv(fixture.raw_csv.as_bytes(), &changed)
        .expect_err("the source-bound study year cannot drift");
    assert!(error.contains("study year 2020"));

    let mut changed = fixture.configuration.clone();
    changed.timezone_knn_k = 9;
    let error = execute_timestamp_correction_csv(fixture.raw_csv.as_bytes(), &changed)
        .expect_err("the source-bound k cannot drift");
    assert!(error.contains("timezone k=10"));
}
