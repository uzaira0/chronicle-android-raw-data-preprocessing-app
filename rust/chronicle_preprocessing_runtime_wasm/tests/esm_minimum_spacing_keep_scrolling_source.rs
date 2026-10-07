#[path = "../src/categorical_threshold_bucketizer.rs"]
mod categorical_threshold_bucketizer;

use categorical_threshold_bucketizer::{OrderedThresholdBucketizer, ThresholdBucketizerError};
use serde::Deserialize;

const SOURCE_FIXTURE: &str = include_str!("fixtures/esm_minimum_spacing_keep_scrolling.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    exact_canonical_setting: CanonicalSetting,
    source_artifacts: Vec<SourceArtifact>,
    input_boundary: String,
    output_boundary: String,
    limitations: Vec<String>,
    minimum_retained_gap_minutes: f64,
    dispositions: Vec<String>,
    lagged_rows: Vec<LaggedRow>,
    invalid_gap_cases: Vec<InvalidGapCase>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CanonicalSetting {
    setting_id: String,
    parameter_key: String,
    source_observed_setting: String,
    source_value_sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceArtifact {
    locator: String,
    sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LaggedRow {
    case_id: String,
    gap_minutes: f64,
    expected_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InvalidGapCase {
    case_id: String,
    gap_minutes: Option<f64>,
    expected_error: String,
}

fn validated_gap_minutes(value: Option<f64>) -> Result<f64, &'static str> {
    let value = value.ok_or("esm_lag_gap_minutes_required")?;
    if !value.is_finite() || value < 0.0 {
        return Err("esm_lag_gap_minutes_must_be_nonnegative_finite");
    }
    Ok(value)
}

#[test]
fn excludes_the_later_prefilter_row_only_for_a_strictly_sub_sixty_minute_gap() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-esm-minimum-spacing-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1016/j.chb.2023.107977");
    assert_eq!(
        (
            fixture.exact_canonical_setting.setting_id.as_str(),
            fixture.exact_canonical_setting.parameter_key.as_str(),
            fixture
                .exact_canonical_setting
                .source_observed_setting
                .as_str(),
            fixture.exact_canonical_setting.source_value_sha256.as_str(),
        ),
        (
            "method-setting-00df33a6d005b66b496e1aca",
            "profile.esm_spacing",
            "profile.esm_spacing: Exclude ESM observations spaced less than 60 minutes apart",
            "7f8eb49abebf3045be4d75d96f8b91e1285e9b0d24dbfa0fc4a2e52b997388f0",
        )
    );

    assert_eq!(fixture.source_artifacts.len(), 4);
    assert!(fixture.source_artifacts[0]
        .locator
        .ends_with("fulltext/rank287-supplement.txt:63-75"));
    assert_eq!(
        fixture.source_artifacts[0].sha256,
        "7e8088c9ff442f7df17706781d74db55ac485735d072ffbfbdfd0ba452b083db"
    );
    assert_eq!(
        fixture.source_artifacts[1].sha256,
        "418fde38159e1ffdf4dfe2683ba4fd6e29c1e8901f80658c4b6feb8ac947efdf"
    );
    assert_eq!(
        fixture.source_artifacts[2].sha256,
        "a7f32264046ee953d1aa8aefef01dd8af7ea338754a776e377677fb48aa426b9"
    );
    assert_eq!(
        fixture.source_artifacts[3].sha256,
        "d8373a36a2e56fe0ee44fed23b8ea8b196a883638245d93ffe3de85a6e17e56c"
    );
    assert!(fixture
        .input_boundary
        .contains("one-time ordering by raw questionnaire-start timestamp"));
    assert!(fixture
        .output_boundary
        .contains("strictly less than 60 minutes"));
    for excluded_claim in [
        "does not sort rows",
        "immediately previous prefilter row",
        "first ordered row",
        "only the preceding-row gap",
        "No timestamp precision",
        "fails closed",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }

    let bucketizer = OrderedThresholdBucketizer::new(
        vec![fixture.minimum_retained_gap_minutes],
        fixture.dispositions,
    )
    .expect("source gap threshold is ordered and finite");
    assert_eq!(bucketizer.thresholds(), &[60.0]);
    assert_eq!(
        bucketizer.categories(),
        &["exclude_later_row".to_owned(), "retain_row".to_owned()]
    );

    for row in fixture.lagged_rows {
        let gap = validated_gap_minutes(Some(row.gap_minutes))
            .expect("fixture gap satisfies the source adapter boundary");
        assert_eq!(
            bucketizer.category_for(gap).map(String::as_str),
            Ok(row.expected_disposition.as_str()),
            "{}",
            row.case_id
        );
    }
    for invalid in fixture.invalid_gap_cases {
        assert_eq!(
            validated_gap_minutes(invalid.gap_minutes),
            Err(invalid.expected_error.as_str()),
            "{}",
            invalid.case_id
        );
    }
    assert_eq!(
        bucketizer.category_for(f64::NAN),
        Err(ThresholdBucketizerError::NonFiniteObservation)
    );
}
