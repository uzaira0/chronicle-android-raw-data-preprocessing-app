#[path = "../src/finite_scalar_pivot_classifier.rs"]
mod finite_scalar_pivot_classifier;

use finite_scalar_pivot_classifier::{
    FiniteScalarPivotClassifier, FiniteScalarPivotClassifierError,
};
use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/music_minimum_duration_descriptive_filter_challenge.json");

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
    duration_pivot_seconds: f64,
    dispositions: Vec<String>,
    playback_records: Vec<PlaybackRecord>,
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
struct PlaybackRecord {
    record_id: String,
    listened_duration_seconds: f64,
    expected_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InvalidInputCase {
    record_id: String,
    listened_duration_seconds: Option<f64>,
    expected_error: String,
}

fn required_listened_duration_seconds(value: Option<f64>) -> Result<f64, &'static str> {
    let value = value.ok_or("music_playback_listened_duration_required")?;
    if !value.is_finite() {
        return Err("music_playback_listened_duration_must_be_finite");
    }
    if value < 0.0 {
        return Err("music_playback_listened_duration_must_be_nonnegative");
    }
    Ok(value)
}

#[test]
fn retains_only_music_playback_records_strictly_longer_than_thirty_seconds_for_descriptive_counts()
{
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-music-duration-descriptive-filter-source-fixture/v1"
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
            "method-setting-59fda2b48095a571041dd10c",
            "music.descriptive_filter",
            "music.descriptive_filter: {\"predicate\":\"duration > 30 seconds\",\"scope\":\"descriptive music counts\"}",
            "16b2c3ad3064c9a9980a9d125f12e642266b770964ac670864a9cacb531ef3f9",
        )
    );
    for expected_locator in [
        "ontology-sublation-20260831/work/s13673-fulltext-layout.txt:250-256",
        "ontology-sublation-20260831/work/s13673-fulltext-layout.txt:342-360",
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
        .contains("already-derived music-playback log record"));
    assert!(fixture
        .output_boundary
        .contains("strictly greater than 30 seconds"));
    assert!(fixture.output_boundary.contains("equality is excluded"));
    for excluded_claim in [
        "does not collect or parse",
        "does not infer playback segmentation",
        "does not construct last-24-hour",
        "does not group retained playback records",
        "missing, non-finite, or negative listened duration fails closed",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }

    let classifier = FiniteScalarPivotClassifier::new(
        fixture.duration_pivot_seconds,
        fixture.dispositions[0].clone(),
        fixture.dispositions[1].clone(),
        fixture.dispositions[2].clone(),
    )
    .expect("the disclosed duration pivot is finite");
    assert_eq!(classifier.pivot(), 30.0);
    assert_eq!(
        classifier.categories(),
        (
            &"excluded".to_owned(),
            &"excluded".to_owned(),
            &"retained".to_owned()
        )
    );

    for record in fixture.playback_records {
        let duration = required_listened_duration_seconds(Some(record.listened_duration_seconds))
            .expect("valid fixture playback duration");
        assert_eq!(
            classifier.category_for(duration).map(String::as_str),
            Ok(record.expected_disposition.as_str()),
            "{}",
            record.record_id
        );
    }

    for invalid in fixture.invalid_input_cases {
        assert_eq!(
            required_listened_duration_seconds(invalid.listened_duration_seconds),
            Err(invalid.expected_error.as_str()),
            "{}",
            invalid.record_id
        );
    }
    assert_eq!(
        required_listened_duration_seconds(Some(f64::NAN)),
        Err("music_playback_listened_duration_must_be_finite")
    );
    assert_eq!(
        classifier.category_for(f64::NAN),
        Err(FiniteScalarPivotClassifierError::NonFiniteObservation)
    );
}
