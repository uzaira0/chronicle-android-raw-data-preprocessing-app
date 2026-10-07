use chronicle_preprocessing_runtime_wasm::categorical_threshold_bucketizer;

use categorical_threshold_bucketizer::{OrderedThresholdBucketizer, ThresholdBucketizerError};
use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/participant_minimum_study_weeks_and_emotion_labels_affectpro.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    exact_canonical_settings: Vec<CanonicalSetting>,
    source_artifacts: Vec<SourceArtifact>,
    input_boundary: String,
    output_boundary: String,
    limitations: Vec<String>,
    minimum_retained_weeks: f64,
    minimum_retained_emotion_labels: u64,
    threshold_dispositions: Vec<String>,
    participants: Vec<ParticipantThresholdInputs>,
    missing_input_cases: Vec<MissingInputCase>,
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
struct ParticipantThresholdInputs {
    participant_id: String,
    source_defined_collection_weeks: f64,
    emotion_label_count_during_six_weeks: u64,
    expected_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MissingInputCase {
    participant_id: String,
    source_defined_collection_weeks: Option<f64>,
    emotion_label_count_during_six_weeks: Option<u64>,
    expected_error: String,
}

fn required_inputs(
    duration_weeks: Option<f64>,
    emotion_label_count: Option<u64>,
) -> Result<(f64, u64), &'static str> {
    let duration_weeks = duration_weeks.ok_or("participant_collection_duration_required")?;
    let emotion_label_count =
        emotion_label_count.ok_or("participant_emotion_label_count_required")?;
    Ok((duration_weeks, emotion_label_count))
}

#[test]
fn excludes_if_either_source_threshold_is_below_minimum_and_retains_equality() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-participant-joint-minimum-thresholds-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1145/3536221.3556603");

    let expected_settings = [
        (
            "method-setting-ba08885d883adcfb1bfe74c7",
            "cohort.exclude_duration",
            "cohort.exclude_duration: {\"operator\":\"<\",\"duration\":\"6 weeks\"}",
            "b26fc48014c0634569362e725385efa03bfcf95a151b2372e94c814d852bd035",
        ),
        (
            "method-setting-f683844ad043f61b6a851a02",
            "cohort.exclude_label_count",
            "cohort.exclude_label_count: {\"operator\":\"<\",\"emotion_labels\":50,\"evaluation_window\":\"6 weeks\"}",
            "e4ac57d84dc76db9134533d32eba33cab57bd0abbad6daaee7e86c559341f159",
        ),
    ];
    assert_eq!(fixture.exact_canonical_settings.len(), 2);
    for (actual, expected) in fixture
        .exact_canonical_settings
        .iter()
        .zip(expected_settings)
    {
        assert_eq!(
            (
                actual.setting_id.as_str(),
                actual.parameter_key.as_str(),
                actual.source_observed_setting.as_str(),
                actual.source_value_sha256.as_str(),
            ),
            expected
        );
    }

    assert_eq!(fixture.source_artifacts.len(), 3);
    assert!(fixture.source_artifacts[0]
        .locator
        .ends_with("text/362.txt:160-169"));
    assert_eq!(
        fixture.source_artifacts[0].sha256,
        "656794ab000f545b4130b0f5fff17223eb93b653ef7c5bda6ed47eee534e54c5"
    );
    assert_eq!(
        fixture.source_artifacts[1].sha256,
        "432e12be1573da8ba9bbd46df3ca00e3214fd228b41b4ab364d2e8994fcf4f09"
    );
    assert_eq!(
        fixture.source_artifacts[2].sha256,
        "7e6f7d3626d9cdeb1a8052d37b9d687e62ebef0623995d77ed56bb5e20767c3a"
    );
    assert!(fixture
        .input_boundary
        .contains("caller supplies a finite source-defined data-collection duration"));
    assert!(fixture
        .output_boundary
        .contains("Exclude the participant when either supplied value is strictly below"));
    for excluded_claim in [
        "does not define whether weeks are calendar or elapsed units",
        "does not disclose label validity",
        "descriptive cohort results",
        "missing input or nonfinite duration fails closed",
        "does not synthesize either value",
        "No released source dataset",
        "Raw Android keyboard/session parsing",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }

    let duration_bucketizer = OrderedThresholdBucketizer::new(
        vec![fixture.minimum_retained_weeks],
        fixture.threshold_dispositions.clone(),
    )
    .expect("source duration threshold is ordered and finite");
    let label_count_bucketizer = OrderedThresholdBucketizer::new(
        vec![fixture.minimum_retained_emotion_labels as f64],
        fixture.threshold_dispositions,
    )
    .expect("source label-count threshold is ordered and finite");

    for participant in fixture.participants {
        let duration_disposition = duration_bucketizer
            .category_for(participant.source_defined_collection_weeks)
            .expect("fixture duration is finite");
        let count_disposition = label_count_bucketizer
            .category_for(participant.emotion_label_count_during_six_weeks as f64)
            .expect("integer fixture count is finite");
        let actual_disposition =
            if duration_disposition == "retain" && count_disposition == "retain" {
                "retain_participant"
            } else {
                "exclude_participant"
            };
        assert_eq!(
            actual_disposition, participant.expected_disposition,
            "{}",
            participant.participant_id
        );
    }

    for missing_case in fixture.missing_input_cases {
        assert_eq!(
            required_inputs(
                missing_case.source_defined_collection_weeks,
                missing_case.emotion_label_count_during_six_weeks,
            ),
            Err(missing_case.expected_error.as_str()),
            "{}",
            missing_case.participant_id
        );
    }
    assert_eq!(
        duration_bucketizer.category_for(f64::NAN),
        Err(ThresholdBucketizerError::NonFiniteObservation)
    );
}
