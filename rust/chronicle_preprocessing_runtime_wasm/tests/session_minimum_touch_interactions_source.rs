#[path = "../src/categorical_threshold_bucketizer.rs"]
mod categorical_threshold_bucketizer;

use categorical_threshold_bucketizer::OrderedThresholdBucketizer;
use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/session_minimum_touch_interactions_acii_2019.json");

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
    sessions: Vec<SessionCount>,
    missing_count_case: MissingCountCase,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CanonicalSetting {
    setting_id: String,
    parameter_key: String,
    legacy_source_parameter_key: String,
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
struct SessionCount {
    session_id: String,
    touch_interaction_count: u64,
    expected_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MissingCountCase {
    session_id: String,
    touch_interaction_count: Option<u64>,
    expected_error: String,
}

fn required_touch_count(count: Option<u64>) -> Result<u64, &'static str> {
    count.ok_or("session_touch_interaction_count_required")
}

#[test]
fn excludes_only_sessions_strictly_below_eighty_touch_interactions() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-session-minimum-touch-interactions-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1109/acii.2019.8925518");
    assert_eq!(
        (
            fixture.exact_canonical_setting.setting_id.as_str(),
            fixture.exact_canonical_setting.parameter_key.as_str(),
            fixture
                .exact_canonical_setting
                .legacy_source_parameter_key
                .as_str(),
            fixture
                .exact_canonical_setting
                .source_observed_setting
                .as_str(),
            fixture.exact_canonical_setting.source_clause.as_str(),
            fixture.exact_canonical_setting.source_value_sha256.as_str(),
        ),
        (
            "method-setting-733de83da57da36a570a9f1b",
            "corpus.minimum_touches",
            "session_minimum_touches",
            "corpus.minimum_touches: {\"exclude_if\":\"less_than\",\"threshold\":80,\"unit\":\"touch interactions\"}",
            "sessions having less than 80 interactions are eliminated",
            "dc66e24e3d1829c116fd186b4027dab407df62f26b68cdf86cb961ac2171361a",
        )
    );
    assert_eq!(fixture.source_artifacts.len(), 2);
    assert!(fixture.source_artifacts[0]
        .locator
        .ends_with("source-pdfs/214-primary.txt:240-247"));
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
        .contains("nonnegative integer count of touch interactions"));
    assert!(fixture.output_boundary.contains("strictly less than 80"));
    for excluded_claim in [
        "does not construct or identify keyboard sessions",
        "No Response is a separate predicate",
        "missing session count fails closed",
        "requires a nonnegative integer count",
        "less-than-40 emotion-label gate",
        "SMOTE, train-test splitting",
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
    assert_eq!(bucketizer.thresholds(), &[80.0]);
    assert_eq!(
        bucketizer.categories(),
        &["exclude".to_owned(), "retain".to_owned()]
    );

    for session in fixture.sessions {
        assert_eq!(
            bucketizer
                .category_for(session.touch_interaction_count as f64)
                .map(String::as_str),
            Ok(session.expected_disposition.as_str()),
            "{}",
            session.session_id
        );
    }

    assert_eq!(
        required_touch_count(fixture.missing_count_case.touch_interaction_count),
        Err(fixture.missing_count_case.expected_error.as_str()),
        "{}",
        fixture.missing_count_case.session_id
    );
}
