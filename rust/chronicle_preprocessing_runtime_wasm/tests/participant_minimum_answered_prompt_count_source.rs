#[path = "../src/categorical_threshold_bucketizer.rs"]
mod categorical_threshold_bucketizer;

use categorical_threshold_bucketizer::OrderedThresholdBucketizer;
use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/participant_minimum_answered_prompt_count_15213269_2020.json");

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
    answered_survey_count: u64,
    expected_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MissingCountCase {
    participant_id: String,
    answered_survey_count: Option<u64>,
    expected_error: String,
}

fn required_count(count: Option<u64>) -> Result<u64, &'static str> {
    count.ok_or("participant_answered_survey_count_required")
}

#[test]
fn retains_participants_at_the_eight_answered_survey_boundary() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-participant-minimum-count-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1080/15213269.2020.1768122");
    assert_eq!(
        (
            fixture.exact_canonical_setting.setting_id.as_str(),
            fixture.exact_canonical_setting.parameter_key.as_str(),
            fixture
                .exact_canonical_setting
                .source_observed_setting
                .as_str(),
            fixture
                .exact_canonical_setting
                .source_value_sha256
                .as_str(),
        ),
        (
            "method-setting-5ee37808c3aec49494279731",
            "cohort.minimum_answered_surveys",
            "cohort.minimum_answered_surveys: {\"comparator\":\"at_least\",\"value\":8,\"basis\":\"20% of 40 scheduled surveys\"}",
            "efaf7163f9fef061ec2a84719482a4bd5517cd1b05dddc605a10223a6ec21799",
        )
    );
    assert!(fixture.source_artifact.locator.ends_with(
        "screened-include-oa-recovery-wave/texts/208-WYR8XW2N-the-relationship-between-online-vigilance-and-affective-well-being-in-ev.txt:402-412"
    ));
    assert_eq!(
        fixture.source_artifact.sha256,
        "555f350be5655fb6daf9f3ceb23448010a3e956f87336c11742e860d7b0187dc"
    );
    assert!(fixture
        .input_boundary
        .contains("count of answered scheduled surveys"));
    assert!(fixture.output_boundary.contains("answered at least eight"));
    for excluded_claim in [
        "does not identify, validate, or deduplicate",
        "does not reconstruct the schedule",
        "separate upstream eligibility condition",
        "69 non-duplicate surveys",
        "Android recruitment eligibility is separate",
        "missing participant count fails closed",
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
    assert_eq!(bucketizer.thresholds(), &[8.0]);
    assert_eq!(
        bucketizer.categories(),
        &["exclude".to_owned(), "retain".to_owned()]
    );

    for participant in fixture.participants {
        assert_eq!(
            bucketizer
                .category_for(participant.answered_survey_count as f64)
                .map(String::as_str),
            Ok(participant.expected_disposition.as_str()),
            "{}",
            participant.participant_id
        );
    }

    assert_eq!(
        required_count(fixture.missing_count_case.answered_survey_count),
        Err(fixture.missing_count_case.expected_error.as_str()),
        "{}",
        fixture.missing_count_case.participant_id
    );
}
