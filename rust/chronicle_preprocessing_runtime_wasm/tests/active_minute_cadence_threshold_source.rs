#[path = "../src/categorical_threshold_bucketizer.rs"]
mod categorical_threshold_bucketizer;

use categorical_threshold_bucketizer::{OrderedThresholdBucketizer, ThresholdBucketizerError};
use serde::Deserialize;

const SOURCE_FIXTURE: &str = include_str!("fixtures/active_minute_cadence_threshold_pastime.json");

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
    minimum_mvpa_cadence: f64,
    categories: Vec<String>,
    minutes: Vec<Minute>,
    invalid_cadence_cases: Vec<InvalidCadenceCase>,
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
struct Minute {
    case_id: String,
    cadence_steps_per_minute: f64,
    expected_category: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InvalidCadenceCase {
    case_id: String,
    cadence_steps_per_minute: Option<f64>,
    expected_error: String,
}

fn validated_cadence(value: Option<f64>) -> Result<f64, &'static str> {
    let value = value.ok_or("minute_cadence_required")?;
    if !value.is_finite() || value < 0.0 {
        return Err("minute_cadence_must_be_nonnegative_finite");
    }
    Ok(value)
}

#[test]
fn classifies_a_minute_as_mvpa_at_one_hundred_steps_per_minute() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-active-minute-cadence-threshold-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1007/s10865-024-00499-x");
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
            "method-setting-1b02c4e7cc0b9197d171d7d6",
            "activpal.mvpa_rule",
            "activpal.mvpa_rule: Minutes with cadence >=100 steps/min",
            "a84f41e14ca9c6e4447002ecc8f2e7da3db3db83c7dd7ffb4d6574f76cc27908",
        )
    );

    assert_eq!(fixture.source_artifacts.len(), 2);
    assert!(fixture.source_artifacts[0]
        .locator
        .ends_with("text/60-pastime.txt:158-165"));
    assert_eq!(
        fixture.source_artifacts[0].sha256,
        "b1dc48785f5c0db64bb3b19349ed7304a315ea8c0abb50d9a8a5a073471bbd53"
    );
    assert_eq!(
        fixture.source_artifacts[1].sha256,
        "d738093ba4c17e471b5c368bccc2f464c5bbf07dcd2192927000cba4333d4e15"
    );
    assert!(fixture
        .input_boundary
        .contains("already-constructed activPAL minute"));
    assert!(fixture.output_boundary.contains("equal to or above 100"));
    for excluded_claim in [
        "proprietary activPAL algorithm",
        "summing classified minutes",
        "No cadence rounding",
        "mixed-platform analysis",
        "fails closed",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }

    let bucketizer =
        OrderedThresholdBucketizer::new(vec![fixture.minimum_mvpa_cadence], fixture.categories)
            .expect("source cadence threshold is ordered and finite");
    assert_eq!(bucketizer.thresholds(), &[100.0]);
    assert_eq!(
        bucketizer.categories(),
        &["below_mvpa".to_owned(), "mvpa".to_owned()]
    );

    for minute in fixture.minutes {
        let cadence = validated_cadence(Some(minute.cadence_steps_per_minute))
            .expect("fixture cadence satisfies the source adapter boundary");
        assert_eq!(
            bucketizer.category_for(cadence).map(String::as_str),
            Ok(minute.expected_category.as_str()),
            "{}",
            minute.case_id
        );
    }
    for invalid in fixture.invalid_cadence_cases {
        assert_eq!(
            validated_cadence(invalid.cadence_steps_per_minute),
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
