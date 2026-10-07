use chronicle_preprocessing_runtime_wasm::categorical_threshold_bucketizer;

use categorical_threshold_bucketizer::OrderedThresholdBucketizer;
use serde::Deserialize;

const SOURCE_FIXTURE: &str = include_str!("fixtures/carat_daypart_opoku_asare_2021.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    exact_canonical_settings: Vec<CanonicalSetting>,
    source_artifact: SourceArtifact,
    input_boundary: String,
    output_boundary: String,
    limitations: Vec<String>,
    thresholds: Vec<f64>,
    categories: Vec<String>,
    expected_category_by_hour: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CanonicalSetting {
    setting_id: String,
    parameter_key: String,
    source_value: String,
    source_value_sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceArtifact {
    locator: String,
    sha256: String,
}

#[test]
fn existing_threshold_bucketizer_reproduces_all_four_disclosed_dayparts() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-carat-daypart-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.2196/26540");
    assert_eq!(
        fixture.source_artifact.locator,
        ".tmp-literature-review-private/corrective-packet-04-ranks-074-123-20260831/text/100.txt:267-280"
    );
    assert_eq!(
        fixture.source_artifact.sha256,
        "a4683ab2ede60c1fb9ebae8c57bd55fdb71cae47ee1a1ade10318ab943f1ad69"
    );

    let expected_settings = [
        (
            "method-setting-4b06de7d35a34616aee5aca2",
            "feature.daypart.night",
            "hours 0-5",
            "31f8ba3a420fa52f6247f4b64830f927f8a34d915fc8a9b4f39626abfbed4b59",
        ),
        (
            "method-setting-7adc9afe3c538cfce5178098",
            "feature.daypart.morning",
            "hours 6-11",
            "a997501de571a006e8f003b076b35e37eece3b6cdff66c9db4b48c755134c833",
        ),
        (
            "method-setting-3dfc3bf4a0f57e0105cecec5",
            "feature.daypart.afternoon",
            "hours 12-17",
            "915182ace028cf17c6be55b0439f127d74634b62c767e5173fcceca7611cca29",
        ),
        (
            "method-setting-628b56b16dfe48e03f221cd0",
            "feature.daypart.evening",
            "hours 18-23",
            "cdd56a7b01c9e990e805d2815f4e417f7e52900fdbe8b31adc9052bc97d11ccc",
        ),
    ];
    assert_eq!(
        fixture.exact_canonical_settings.len(),
        expected_settings.len()
    );
    for (setting, expected) in fixture
        .exact_canonical_settings
        .iter()
        .zip(expected_settings)
    {
        assert_eq!(
            (
                setting.setting_id.as_str(),
                setting.parameter_key.as_str(),
                setting.source_value.as_str(),
                setting.source_value_sha256.as_str(),
            ),
            expected
        );
    }

    assert!(fixture
        .input_boundary
        .contains("caller-supplied integer hour"));
    assert!(fixture.input_boundary.contains("0 through 23"));
    assert!(fixture.output_boundary.contains("Exactly one"));
    for excluded_claim in ["parse a timestamp", "fractional", "standard deviations"] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }

    assert_eq!(fixture.thresholds, [6.0, 12.0, 18.0]);
    assert_eq!(
        fixture.categories,
        ["night", "morning", "afternoon", "evening"]
    );
    assert_eq!(fixture.expected_category_by_hour.len(), 24);

    let bucketizer = OrderedThresholdBucketizer::new(fixture.thresholds, fixture.categories)
        .expect("the four source dayparts form an ordered threshold configuration");

    for (hour, expected_category) in fixture.expected_category_by_hour.iter().enumerate() {
        assert_eq!(
            bucketizer
                .category_for(hour as f64)
                .expect("fixture hours are finite"),
            expected_category,
            "source daypart at hour {hour}"
        );
    }

    for (boundary_hour, left_category, right_category) in [
        (6_u8, "night", "morning"),
        (12, "morning", "afternoon"),
        (18, "afternoon", "evening"),
    ] {
        assert_eq!(
            bucketizer
                .category_for(f64::from(boundary_hour - 1))
                .map(String::as_str),
            Ok(left_category),
            "hour immediately before {boundary_hour}"
        );
        assert_eq!(
            bucketizer
                .category_for(f64::from(boundary_hour))
                .map(String::as_str),
            Ok(right_category),
            "lower-inclusive boundary at {boundary_hour}"
        );
    }
}
