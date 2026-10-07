#[path = "../src/timezone_offset_knn.rs"]
mod timezone_offset_knn;

use serde::Deserialize;
use timezone_offset_knn::{impute_schoedel_timezone_offsets_ms, SCHOEDEL_TIMEZONE_K};

const FIXTURE: &str = include_str!("fixtures/timezone_offset_knn_schoedel.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    source_method_variant_id: String,
    exact_canonical_setting_ids: Vec<String>,
    source_artifacts: Vec<SourceArtifact>,
    oracle_runtime: String,
    k: usize,
    missing_sentinel_ms: f64,
    cases: Vec<Case>,
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
struct Case {
    case_id: String,
    source_offsets_ms: Vec<Option<f64>>,
    expected_offsets_ms: Vec<Option<f64>>,
}

#[test]
fn deposited_r_4_1_2_timezone_imputation_is_replayed_exactly() {
    let fixture: Fixture = serde_json::from_str(FIXTURE).expect("timezone oracle fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-schoedel-timezone-offset-knn-oracle/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1016/j.chb.2023.107977");
    assert_eq!(
        fixture.source_method_variant_id,
        "source-audit-configuration-space-8b14e63d69954819163df993"
    );
    assert_eq!(
        fixture.exact_canonical_setting_ids,
        ["method-setting-f023abce9be53100e2dd22a6"]
    );
    assert_eq!(fixture.oracle_runtime, "R version 4.1.2 (2021-11-01)");
    assert_eq!(fixture.k, SCHOEDEL_TIMEZONE_K);
    assert_eq!(fixture.missing_sentinel_ms, 0.0);
    assert_eq!(fixture.source_artifacts.len(), 2);
    assert!(fixture.source_artifacts.iter().all(|artifact| {
        !artifact.path.is_empty() && artifact.sha256.len() == 64 && !artifact.locator.is_empty()
    }));
    assert!(fixture
        .limitations
        .iter()
        .any(|value| { value.contains("chronologically ordered participant offset series") }));

    for case in fixture.cases {
        assert_eq!(
            impute_schoedel_timezone_offsets_ms(&case.source_offsets_ms)
                .expect("finite source offsets"),
            case.expected_offsets_ms,
            "{}",
            case.case_id
        );
    }
}

#[test]
fn nonfinite_source_offsets_fail_closed() {
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let error = impute_schoedel_timezone_offsets_ms(&[Some(3_600_000.0), Some(value)])
            .expect_err("nonfinite source offset must fail");
        assert_eq!(error.source_index, 1);
    }
}
