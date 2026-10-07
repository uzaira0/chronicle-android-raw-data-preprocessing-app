#[path = "../src/categorical_threshold_bucketizer.rs"]
mod categorical_threshold_bucketizer;

use categorical_threshold_bucketizer::OrderedThresholdBucketizer;
use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/app_top_ten_minimum_participant_support_classroom.json");

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
    participant_count: u64,
    minimum_support_percent: u64,
    expected_minimum_support_count: u64,
    dispositions: Vec<String>,
    candidate_apps: Vec<CandidateApp>,
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
struct CandidateApp {
    observation_id: String,
    supporting_participant_count: u64,
    expected_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InvalidInputCase {
    observation_id: String,
    supporting_participant_count: Option<u64>,
    participant_count: Option<u64>,
    expected_error: String,
}

fn minimum_inclusive_support_count(
    participant_count: u64,
    support_percent: u64,
) -> Result<u64, &'static str> {
    if participant_count == 0 {
        return Err("participant_denominator_must_be_positive");
    }
    if support_percent == 0 || support_percent > 100 {
        return Err("support_percent_out_of_range");
    }
    participant_count
        .checked_mul(support_percent)
        .and_then(|product| product.checked_add(99))
        .map(|rounded_numerator| rounded_numerator / 100)
        .ok_or("support_threshold_overflow")
}

fn required_support_inputs(
    support_count: Option<u64>,
    participant_count: Option<u64>,
) -> Result<(u64, u64), &'static str> {
    let support_count = support_count.ok_or("app_support_count_required")?;
    let participant_count = participant_count.ok_or("participant_denominator_required")?;
    if participant_count == 0 {
        return Err("participant_denominator_must_be_positive");
    }
    if support_count > participant_count {
        return Err("app_support_count_exceeds_participant_denominator");
    }
    Ok((support_count, participant_count))
}

#[test]
fn retains_a_candidate_at_seventeen_of_eighty_four_participants() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-app-participant-support-threshold-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1016/j.compedu.2019.103611");
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
            "method-setting-ff33809b707c5562646ed8ce",
            "apps.initial_support",
            "apps.initial_support: retain candidates appearing in the top 10 apps of at least 20% of participants (n=17)",
            "5792187f5052639e8e4c781c73f08e1ce6ae93dc9ef8e72b45a4c61abd17983c",
        )
    );
    assert!(fixture
        .source_artifact
        .locators
        .iter()
        .any(|locator| locator.ends_with(
            "corrective-packet-08-ranks277-329-20260831/fulltext/rank288-primary.txt:287-302"
        )));
    assert!(fixture
        .source_artifact
        .locators
        .iter()
        .any(|locator| locator.ends_with(
            "corrective-packet-08-ranks277-329-20260831/fulltext/rank288-primary.txt:461-475"
        )));
    assert_eq!(
        fixture.source_artifact.sha256,
        "5444bf55d60696984c74e676bfc3dacd388e81074b3f5f09ba07120d2c3e414b"
    );
    assert!(fixture.input_boundary.contains("top-10 app lists"));
    assert!(fixture.output_boundary.contains("ceil(16.8) = 17"));
    for excluded_claim in [
        "does not derive application-use events",
        "does not normalize or rank",
        "does not construct each participant's top-10",
        "does not reproduce the manual 5-percentage-point",
        "does not rank retained candidates",
        "missing support count or participant denominator",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }

    let minimum_count =
        minimum_inclusive_support_count(fixture.participant_count, fixture.minimum_support_percent)
            .expect("source participant denominator and percentage are valid");
    assert_eq!(minimum_count, fixture.expected_minimum_support_count);
    assert_eq!(minimum_count, 17);

    let bucketizer =
        OrderedThresholdBucketizer::new(vec![minimum_count as f64], fixture.dispositions)
            .expect("the source support threshold is ordered and finite");
    assert_eq!(bucketizer.thresholds(), &[17.0]);
    assert_eq!(
        bucketizer.categories(),
        &[
            "below_initial_support".to_owned(),
            "retained_candidate".to_owned(),
        ]
    );

    for app in fixture.candidate_apps {
        let (support_count, participant_count) = required_support_inputs(
            Some(app.supporting_participant_count),
            Some(fixture.participant_count),
        )
        .expect("complete source support inputs");
        assert_eq!(participant_count, fixture.participant_count);
        assert_eq!(
            bucketizer
                .category_for(support_count as f64)
                .map(String::as_str),
            Ok(app.expected_disposition.as_str()),
            "{}",
            app.observation_id
        );
    }

    for invalid in fixture.invalid_input_cases {
        assert_eq!(
            required_support_inputs(
                invalid.supporting_participant_count,
                invalid.participant_count,
            ),
            Err(invalid.expected_error.as_str()),
            "{}",
            invalid.observation_id
        );
    }
}
