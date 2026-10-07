#[path = "../src/finite_scalar_pivot_classifier.rs"]
mod finite_scalar_pivot_classifier;

use finite_scalar_pivot_classifier::{
    FiniteScalarPivotClassifier, FiniteScalarPivotClassifierError,
};
use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/activity_minimum_duration_filter_challenge.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    exact_canonical_setting: CanonicalSetting,
    source_artifact: SourceArtifact,
    input_boundary: String,
    output_boundary: String,
    limitations: Vec<String>,
    duration_pivot_minutes: f64,
    dispositions: Vec<String>,
    activity_occurrences: Vec<ActivityOccurrence>,
    invalid_input_cases: Vec<InvalidInputCase>,
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
    locators: Vec<String>,
    sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ActivityOccurrence {
    observation_id: String,
    duration_minutes: f64,
    expected_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InvalidInputCase {
    observation_id: String,
    duration_minutes: Option<f64>,
    expected_error: String,
}

fn required_activity_duration_minutes(value: Option<f64>) -> Result<f64, &'static str> {
    let value = value.ok_or("activity_occurrence_duration_required")?;
    if !value.is_finite() {
        return Err("activity_occurrence_duration_must_be_finite");
    }
    if value < 0.0 {
        return Err("activity_occurrence_duration_must_be_nonnegative");
    }
    Ok(value)
}

#[test]
fn retains_only_activity_occurrences_strictly_longer_than_three_minutes() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-activity-duration-filter-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1186/s13673-016-0072-3");
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
            "method-setting-12675df881758501e89e89b8",
            "activity.duration_filter",
            "activity.duration_filter: {\"comparator\":\">\",\"value\":3,\"unit\":\"minutes\",\"wording_status\":\"question section says example; evaluation applies it\"}",
            "7217b6922d71184c5f09f96ea386d877463c510b9c5d53f9e81842320c2490ba",
        )
    );
    for expected_locator in [
        "ontology-sublation-20260831/work/s13673-fulltext-layout.txt:250-256",
        "ontology-sublation-20260831/work/s13673-fulltext-layout.txt:362-370",
        "ontology-sublation-20260831/work/s13673-fulltext-layout.txt:1015-1024",
    ] {
        assert!(fixture
            .source_artifact
            .locators
            .iter()
            .any(|locator| locator.ends_with(expected_locator)));
    }
    assert_eq!(
        fixture.source_artifact.sha256,
        "dc076e537744bea22bb6f50f28cb4f635dadcdc90378e5e299a6200b13b1a190"
    );
    assert!(fixture
        .input_boundary
        .contains("already-segmented physical-activity log occurrence"));
    assert!(fixture
        .output_boundary
        .contains("strictly greater than three minutes"));
    for excluded_claim in [
        "does not collect or parse",
        "does not segment activity observations",
        "does not infer activity type",
        "does not construct the last-24-hour",
        "does not aggregate retained occurrences",
        "missing, non-finite, or negative occurrence duration fails closed",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }
    assert_eq!(fixture.dispositions.len(), 3);

    let classifier = FiniteScalarPivotClassifier::new(
        fixture.duration_pivot_minutes,
        fixture.dispositions[0].clone(),
        fixture.dispositions[1].clone(),
        fixture.dispositions[2].clone(),
    )
    .expect("the source duration pivot is finite");
    assert_eq!(classifier.pivot(), 3.0);
    assert_eq!(
        classifier.categories(),
        (
            &"excluded".to_owned(),
            &"excluded".to_owned(),
            &"retained".to_owned()
        )
    );

    for occurrence in fixture.activity_occurrences {
        let duration = required_activity_duration_minutes(Some(occurrence.duration_minutes))
            .expect("valid fixture occurrence duration");
        assert_eq!(
            classifier.category_for(duration).map(String::as_str),
            Ok(occurrence.expected_disposition.as_str()),
            "{}",
            occurrence.observation_id
        );
    }

    for invalid in fixture.invalid_input_cases {
        assert_eq!(
            required_activity_duration_minutes(invalid.duration_minutes),
            Err(invalid.expected_error.as_str()),
            "{}",
            invalid.observation_id
        );
    }
    assert_eq!(
        required_activity_duration_minutes(Some(f64::NAN)),
        Err("activity_occurrence_duration_must_be_finite")
    );
    assert_eq!(
        classifier.category_for(f64::NAN),
        Err(FiniteScalarPivotClassifierError::NonFiniteObservation)
    );
}
