use chronicle_preprocessing_runtime_wasm::categorical_threshold_bucketizer;

use categorical_threshold_bucketizer::OrderedThresholdBucketizer;
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/completed_week_thresholds_canonical_source.json");
const REUSED_OWNER_SOURCE: &str = include_str!("../src/categorical_threshold_bucketizer.rs");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    reused_owner: ReusedOwner,
    settings: Vec<Setting>,
    invalid_completed_week_counts: Vec<InvalidCount>,
    invalid_count_error: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReusedOwner {
    component: String,
    source_path: String,
    source_sha256: String,
    semantic_boundary: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Setting {
    source_work_id: String,
    canonical_setting: CanonicalSetting,
    superseded_aliases: Vec<String>,
    source_artifacts: Vec<SourceArtifact>,
    input_measure: String,
    input_boundary: String,
    output_boundary: String,
    minimum_inclusive_weeks: u64,
    cases: Vec<BoundaryCase>,
    limitations: Vec<String>,
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
    role: String,
    locator: String,
    sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BoundaryCase {
    case_id: String,
    completed_week_count: Value,
    expected_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InvalidCount {
    case_id: String,
    completed_week_count: Value,
}

fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn completed_week_count(value: &Value) -> Result<u64, &'static str> {
    value
        .as_u64()
        .ok_or("nonnegative_integer_completed_week_count_required")
}

#[test]
fn exact_integer_week_boundaries_reuse_the_lower_inclusive_bucketizer() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-completed-week-thresholds-canonical-source-fixture/v1"
    );
    assert_eq!(fixture.reused_owner.component, "OrderedThresholdBucketizer");
    assert_eq!(
        fixture.reused_owner.source_path,
        "rust/chronicle_preprocessing_runtime_wasm/src/categorical_threshold_bucketizer.rs"
    );
    assert_eq!(
        sha256(REUSED_OWNER_SOURCE.as_bytes()),
        fixture.reused_owner.source_sha256
    );
    assert!(fixture
        .reused_owner
        .semantic_boundary
        .contains("nonnegative JSON integer"));
    assert_eq!(fixture.settings.len(), 2);

    let socialcom = &fixture.settings[0];
    assert_eq!(socialcom.source_work_id, "doi:10.1109/socialcom.2013.118");
    assert_eq!(
        (
            socialcom.canonical_setting.setting_id.as_str(),
            socialcom.canonical_setting.parameter_key.as_str(),
            socialcom.canonical_setting.source_observed_setting.as_str(),
            socialcom.canonical_setting.source_value_sha256.as_str(),
        ),
        (
            "method-setting-81c5e2881d3b56866842b6c5",
            "collection.minimum_complete_weeks",
            "collection.minimum_complete_weeks: \">8 complete weeks per included subject\"",
            "fecb8ca8561a22b48620faa9f47c4a8f38cceb656738e31dd82805e77ace62ce",
        )
    );
    assert_eq!(
        socialcom.superseded_aliases,
        ["method-setting-b3a290f19214fcb52dbb2410"]
    );
    assert_eq!(socialcom.minimum_inclusive_weeks, 9);
    assert!(socialcom.output_boundary.contains("Strictly more than 8"));
    assert!(socialcom.output_boundary.contains("at least 9"));

    let map_on_tap = &fixture.settings[1];
    assert_eq!(map_on_tap.source_work_id, "doi:10.2139/ssrn.4768783");
    assert_eq!(
        (
            map_on_tap.canonical_setting.setting_id.as_str(),
            map_on_tap.canonical_setting.parameter_key.as_str(),
            map_on_tap
                .canonical_setting
                .source_observed_setting
                .as_str(),
            map_on_tap
                .canonical_setting
                .source_value_sha256
                .as_str(),
        ),
        (
            "method-setting-e8e92790d9b904e0020df18f",
            "study.minimum_collection_duration",
            "study.minimum_collection_duration: {\"value\":2,\"unit\":\"consecutive weeks\",\"instruction\":\"activate MapOnTap\"}",
            "10d6aeede0c189415365aa9029cc66c87977cbb03644465403217d2f2e6fcd65",
        )
    );
    assert!(map_on_tap.superseded_aliases.is_empty());
    assert_eq!(map_on_tap.minimum_inclusive_weeks, 2);
    assert!(map_on_tap.output_boundary.contains("at least 2"));
    assert!(map_on_tap.output_boundary.contains("equality satisfies"));

    for setting in &fixture.settings {
        assert_eq!(
            sha256(setting.canonical_setting.source_observed_setting.as_bytes()),
            setting.canonical_setting.source_value_sha256,
            "{} canonical value hash",
            setting.canonical_setting.setting_id
        );
        assert!(setting.input_measure.contains("week"));
        assert!(setting
            .input_boundary
            .contains("caller-supplied nonnegative integer"));
        assert!(setting
            .limitations
            .iter()
            .any(|limitation| limitation.contains("does not derive")));
        assert!(setting
            .limitations
            .iter()
            .any(|limitation| limitation.contains("participant")));
        for artifact in &setting.source_artifacts {
            assert!(!artifact.role.is_empty());
            assert!(!artifact.locator.is_empty());
            assert_eq!(artifact.sha256.len(), 64);
            assert!(artifact.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()));
        }

        let bucketizer = OrderedThresholdBucketizer::new(
            vec![setting.minimum_inclusive_weeks as f64],
            vec!["does_not_meet_source_boundary", "meets_source_boundary"],
        )
        .expect("one finite lower-inclusive week threshold");
        assert_eq!(
            bucketizer.thresholds(),
            &[setting.minimum_inclusive_weeks as f64]
        );
        for case in &setting.cases {
            let count = completed_week_count(&case.completed_week_count)
                .unwrap_or_else(|error| panic!("{}: {error}", case.case_id));
            assert_eq!(
                bucketizer.category_for(count as f64).copied(),
                Ok(case.expected_disposition.as_str()),
                "{} / {}",
                setting.canonical_setting.setting_id,
                case.case_id
            );
        }
    }

    for case in &fixture.invalid_completed_week_counts {
        assert_eq!(
            completed_week_count(&case.completed_week_count),
            Err(fixture.invalid_count_error.as_str()),
            "{}",
            case.case_id
        );
    }
}
