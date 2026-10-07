#[path = "../src/categorical_threshold_bucketizer.rs"]
mod categorical_threshold_bucketizer;

use categorical_threshold_bucketizer::OrderedThresholdBucketizer;
use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/participant_minimum_emotion_label_count_acii_2019.json");

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
    minimum_retained_count: u64,
    dispositions: Vec<String>,
    participants: Vec<ParticipantCount>,
    missing_count_case: MissingCountCase,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CanonicalSetting {
    setting_id: String,
    parameter_key: String,
    source_observed_setting: String,
    source_clause: String,
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
struct ParticipantCount {
    participant_id: String,
    emotion_label_count: u64,
    expected_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MissingCountCase {
    participant_id: String,
    emotion_label_count: Option<u64>,
    expected_error: String,
}

fn required_complete_period_count(count: Option<u64>) -> Result<u64, &'static str> {
    count.ok_or("participant_complete_period_emotion_label_count_required")
}

#[test]
fn excludes_only_participants_strictly_below_forty_complete_period_labels() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-participant-minimum-emotion-label-count-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1109/acii.2019.8925518");
    assert_eq!(
        (
            fixture.exact_canonical_setting.setting_id.as_str(),
            fixture.exact_canonical_setting.parameter_key.as_str(),
            fixture
                .exact_canonical_setting
                .source_observed_setting
                .as_str(),
            fixture.exact_canonical_setting.source_clause.as_str(),
            fixture
                .exact_canonical_setting
                .source_value_sha256
                .as_str(),
        ),
        (
            "method-setting-ec87781289767a090935fe87",
            "cohort.lt40_excluded",
            "cohort.lt40_excluded: {\"participants\":2,\"rule\":\"fewer than 40 emotion samples during entire period\"}",
            "2 participants entered less than 40 emotion samples during entire period; data from the remaining participants were retained",
            "344db3415da7b966eaf8f2d9c3ca284ca761a4b23268f04c8e9bebb45f335664",
        )
    );
    assert_eq!(fixture.source_artifacts.len(), 2);
    assert!(fixture.source_artifacts[0]
        .locator
        .ends_with("source-pdfs/214-primary.txt:211-225"));
    assert_eq!(
        fixture.source_artifacts[0].sha256,
        "e7541b1d4d0c67e705b9b60fbb80e486931dda3240fc28c9ee53a6b3358560dd"
    );
    assert!(fixture.source_artifacts[1]
        .locator
        .contains("214-primary.pdf"));
    assert_eq!(
        fixture.source_artifacts[1].sha256,
        "8e067249f2f1c5800cdac260be9edfabe5ea2e6c6165ee4d59587dbd5b38f792"
    );
    assert!(fixture
        .input_boundary
        .contains("nonnegative integer count of emotion labels"));
    assert!(fixture.output_boundary.contains("strictly less than 40"));
    for excluded_claim in [
        "does not identify, deduplicate, or count",
        "missing participant count fails closed",
        "four mid-study dropouts are a separate",
        "less-than-80-touch session filter",
        "two participants met the exclusion rule",
        "requires a nonnegative integer count",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }

    let bucketizer = OrderedThresholdBucketizer::new(
        vec![fixture.minimum_retained_count as f64],
        fixture.dispositions,
    )
    .expect("the source count threshold is ordered and finite");
    assert_eq!(bucketizer.thresholds(), &[40.0]);
    assert_eq!(
        bucketizer.categories(),
        &["exclude".to_owned(), "retain".to_owned()]
    );

    for participant in fixture.participants {
        assert_eq!(
            bucketizer
                .category_for(participant.emotion_label_count as f64)
                .map(String::as_str),
            Ok(participant.expected_disposition.as_str()),
            "{}",
            participant.participant_id
        );
    }

    assert_eq!(
        required_complete_period_count(fixture.missing_count_case.emotion_label_count),
        Err(fixture.missing_count_case.expected_error.as_str()),
        "{}",
        fixture.missing_count_case.participant_id
    );
}
