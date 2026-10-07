use chronicle_preprocessing_runtime_wasm::categorical_threshold_bucketizer;

use categorical_threshold_bucketizer::OrderedThresholdBucketizer;
use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/app_usage_and_participant_threshold_challenge.json");

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
    minimum_retained_app_use_count: u64,
    minimum_retained_distinct_participant_count: u64,
    threshold_dispositions: Vec<String>,
    app_aggregates: Vec<AppAggregate>,
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
struct AppAggregate {
    app_id: String,
    app_use_count: u64,
    distinct_participant_count: u64,
    expected_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MissingInputCase {
    app_id: String,
    app_use_count: Option<u64>,
    distinct_participant_count: Option<u64>,
    expected_error: String,
}

fn required_counts(
    app_use_count: Option<u64>,
    distinct_participant_count: Option<u64>,
) -> Result<(u64, u64), &'static str> {
    let app_use_count = app_use_count.ok_or("app_use_count_required")?;
    let distinct_participant_count =
        distinct_participant_count.ok_or("distinct_participant_count_required")?;
    Ok((app_use_count, distinct_participant_count))
}

#[test]
fn retains_only_apps_with_more_than_fifty_uses_and_at_least_three_distinct_participants() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-app-usage-participant-conjunction-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1145/3706598.3713724");
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
            "method-setting-746c132b321541ed6a104a7b",
            "social_filter.usage_threshold",
            "social_filter.usage_threshold: {\"app_uses\":\">50\",\"participants\":\">=3\"}",
            "2797c16831d9e44fe3a3593dcb6b55d7e7b3d4021058eccfdca740188c8a72b7",
        )
    );
    assert!(fixture
        .source_artifact
        .locator
        .ends_with("text/225.txt:313-317,399-420"));
    assert_eq!(
        fixture.source_artifact.sha256,
        "5c1852eb8a69571d0804dc990333ab4d1a2a603e0b105a0e0233f0e6b393fe94"
    );
    for input_claim in [
        "One already-aggregated source-dataset row per app identity",
        "source-defined app sessions (one foreground period)",
        "distinct study participants",
    ] {
        assert!(fixture.input_boundary.contains(input_claim));
    }
    for output_claim in [
        "strictly greater than 50",
        "at least 3",
        "represents >50 exactly as >=51",
    ] {
        assert!(fixture.output_boundary.contains(output_claim));
    }
    for excluded_claim in [
        "does not collect screenshots",
        "does not choose an app-identity representation",
        "caller must supply one source-dataset aggregate row",
        "exclusion of apps without a feed feature",
        "quantitative regret analysis remain downstream",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }

    let app_use_gate = OrderedThresholdBucketizer::new(
        vec![fixture.minimum_retained_app_use_count as f64],
        fixture.threshold_dispositions.clone(),
    )
    .expect("source app-use integer threshold is finite");
    let participant_gate = OrderedThresholdBucketizer::new(
        vec![fixture.minimum_retained_distinct_participant_count as f64],
        fixture.threshold_dispositions,
    )
    .expect("source distinct-participant integer threshold is finite");
    assert_eq!(app_use_gate.thresholds(), &[51.0]);
    assert_eq!(participant_gate.thresholds(), &[3.0]);

    for aggregate in fixture.app_aggregates {
        let app_use_category = app_use_gate
            .category_for(aggregate.app_use_count as f64)
            .expect("fixture app-use count is an unsigned integer");
        let participant_category = participant_gate
            .category_for(aggregate.distinct_participant_count as f64)
            .expect("fixture participant count is an unsigned integer");
        let disposition =
            if app_use_category == "requirement_met" && participant_category == "requirement_met" {
                "retain_app"
            } else {
                "reject_app"
            };
        assert_eq!(
            disposition, aggregate.expected_disposition,
            "{}",
            aggregate.app_id
        );
    }

    for missing in fixture.missing_input_cases {
        assert_eq!(
            required_counts(missing.app_use_count, missing.distinct_participant_count),
            Err(missing.expected_error.as_str()),
            "{}",
            missing.app_id
        );
    }
}
