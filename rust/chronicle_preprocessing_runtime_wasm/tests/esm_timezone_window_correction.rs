#[path = "../src/esm_timezone_window_correction.rs"]
mod esm_timezone_window_correction;

use esm_timezone_window_correction::{
    execute_esm_timezone_window_correction_csv, EsmTimezoneWindowCorrectionConfiguration,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};

const FIXTURE: &str =
    include_str!("fixtures/schoedel_esm_timezone_window_correction_r_oracle.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    source_method_variant_id: String,
    exact_canonical_setting_id: String,
    source_observed_setting: String,
    source_value: String,
    source_value_sha256: String,
    source_artifacts: Vec<SourceArtifact>,
    configuration: EsmTimezoneWindowCorrectionConfiguration,
    sensing_csv: String,
    esm_csv: String,
    oracle_output_csv: String,
    expected_sensing_input_row_count: usize,
    expected_esm_input_row_count: usize,
    expected_corrected_esm_row_count: usize,
    expected_missing_mode_row_count: usize,
    limitations: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct SourceArtifact {
    path: String,
    sha256: String,
    locator: String,
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
fn released_r_strict_window_first_seen_tie_and_na_semantics_are_replayed() {
    let fixture: Fixture = serde_json::from_str(FIXTURE).expect("source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-esm-timezone-window-correction-r-oracle/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1016/j.chb.2023.107977");
    assert_eq!(
        fixture.source_method_variant_id,
        "source-audit-configuration-space-8b14e63d69954819163df993"
    );
    assert_eq!(
        fixture.exact_canonical_setting_id,
        "method-setting-d6cf2e011a5d485758d44fc5"
    );
    assert_eq!(
        fixture.source_value,
        "Infer ESM timezone from sensor records in ±30-minute window"
    );
    assert_eq!(
        fixture.source_value_sha256,
        "73c658cefe3272afa3bacb3fa91b9a7d91479b88c36cefe643be8f3f3225744b"
    );
    assert_eq!(
        hex::encode(Sha256::digest(fixture.source_observed_setting.as_bytes())),
        fixture.source_value_sha256
    );
    assert_eq!(fixture.source_artifacts.len(), 3);
    assert!(fixture.source_artifacts.iter().all(|artifact| {
        !artifact.path.is_empty() && artifact.sha256.len() == 64 && !artifact.locator.is_empty()
    }));
    assert!(fixture
        .limitations
        .iter()
        .any(|value| value.contains("comment says plus-or-minus 30 seconds")));

    let output = execute_esm_timezone_window_correction_csv(
        fixture.sensing_csv.as_bytes(),
        fixture.esm_csv.as_bytes(),
        &fixture.configuration,
    )
    .expect("source-faithful ESM correction executes");
    assert_eq!(
        output.sensing_input_row_count,
        fixture.expected_sensing_input_row_count
    );
    assert_eq!(
        output.esm_input_row_count,
        fixture.expected_esm_input_row_count
    );
    assert_eq!(
        output.corrected_esm_row_count,
        fixture.expected_corrected_esm_row_count
    );
    assert_eq!(
        output.missing_mode_row_count,
        fixture.expected_missing_mode_row_count
    );

    let (actual_header, actual_rows) = records(&output.derived_csv);
    let (oracle_header, oracle_rows) = records(fixture.oracle_output_csv.as_bytes());
    assert_eq!(actual_header, oracle_header);
    assert_eq!(actual_rows, oracle_rows);

    let actual = String::from_utf8(output.derived_csv).expect("UTF-8 output");
    assert!(
        actual.contains("tie,2020-01-01 12:00:00,2020-01-01 12:05:00,2020-01-01 12:10:00,3600000")
    );
    assert!(
        !actual.contains("tie,2020-01-01 12:00:00,2020-01-01 12:05:00,2020-01-01 12:10:00,7200000")
    );
    assert!(actual.contains("no-mode,2020-01-01 15:00:00"));
    assert!(actual.contains(",NA,NA,NA,NA,NA,3"));
}

#[test]
fn typed_input_and_fixed_source_configuration_fail_closed() {
    let fixture: Fixture = serde_json::from_str(FIXTURE).expect("source fixture");

    let mut drift = fixture.configuration.clone();
    drift.window_radius_minutes = 29;
    let error = execute_esm_timezone_window_correction_csv(
        fixture.sensing_csv.as_bytes(),
        fixture.esm_csv.as_bytes(),
        &drift,
    )
    .expect_err("source configuration must be fixed");
    assert!(error.contains("drifts"));

    let wrong_participant = fixture
        .esm_csv
        .replacen("p-source-01,tie", "p-source-02,tie", 1);
    let error = execute_esm_timezone_window_correction_csv(
        fixture.sensing_csv.as_bytes(),
        wrong_participant.as_bytes(),
        &fixture.configuration,
    )
    .expect_err("cross-participant pairing must fail closed");
    assert!(error.contains("same single participant"));

    let nonfinite = fixture.sensing_csv.replacen(",3600000\n", ",+Inf\n", 1);
    let error = execute_esm_timezone_window_correction_csv(
        nonfinite.as_bytes(),
        fixture.esm_csv.as_bytes(),
        &fixture.configuration,
    )
    .expect_err("non-finite offsets must fail closed");
    assert!(error.contains("not finite"));
}
