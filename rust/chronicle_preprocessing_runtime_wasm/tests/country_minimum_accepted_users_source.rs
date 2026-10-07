#[path = "../src/categorical_threshold_bucketizer.rs"]
mod categorical_threshold_bucketizer;

use categorical_threshold_bucketizer::OrderedThresholdBucketizer;
use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/country_minimum_accepted_users_s41598_2021.json");

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
    minimum_included_count: u64,
    dispositions: Vec<String>,
    countries: Vec<CountryCount>,
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
struct CountryCount {
    country_id: String,
    accepted_user_count: u64,
    expected_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MissingCountCase {
    country_id: String,
    accepted_user_count: Option<u64>,
    expected_error: String,
}

fn required_count(count: Option<u64>) -> Result<u64, &'static str> {
    count.ok_or("country_accepted_user_count_required")
}

#[test]
fn includes_countries_at_the_twenty_thousand_accepted_user_boundary() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-group-minimum-count-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1038/s41598-021-82294-1");
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
            "method-setting-atomic-16230674bb01ce59dc91",
            "country.eligibility",
            "country.eligibility: {\"minimum_users\":20000,\"comparator\":\"at_least\"}",
            "dafc8e3ecc6305a1723193bcf806455230fcfde8ab52c5965a0a87930cbc42fe",
        )
    );
    assert!(fixture.source_artifact.locator.ends_with(
        "source-completeness-audits/artifacts/doi-10.1038-s41598-021-82294-1/primary.txt:491-506"
    ));
    assert_eq!(
        fixture.source_artifact.sha256,
        "b7ddc9b09bd959c6f3dd5195abd23bf9b96f5890d76f24fd66995b26d822aba1"
    );
    assert!(fixture.input_boundary.contains("accepted the study terms"));
    assert!(fixture.output_boundary.contains("at least 20,000"));
    for excluded_claim in [
        "does not determine whether a user accepted",
        "does not identify or deduplicate users",
        "does not group records",
        "missing country count fails closed",
        "public sample is not used as evidence",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }

    let bucketizer = OrderedThresholdBucketizer::new(
        vec![fixture.minimum_included_count as f64],
        fixture.dispositions,
    )
    .expect("the source count threshold is ordered and finite");
    assert_eq!(bucketizer.thresholds(), &[20_000.0]);
    assert_eq!(
        bucketizer.categories(),
        &["exclude_country".to_owned(), "include_country".to_owned()]
    );

    for country in fixture.countries {
        assert_eq!(
            bucketizer
                .category_for(country.accepted_user_count as f64)
                .map(String::as_str),
            Ok(country.expected_disposition.as_str()),
            "{}",
            country.country_id
        );
    }

    assert_eq!(
        required_count(fixture.missing_count_case.accepted_user_count),
        Err(fixture.missing_count_case.expected_error.as_str()),
        "{}",
        fixture.missing_count_case.country_id
    );
}
