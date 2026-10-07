use chronicle_preprocessing_runtime_wasm::categorical_threshold_bucketizer;

use categorical_threshold_bucketizer::OrderedThresholdBucketizer;
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/dekker_tracking_row_count_thresholds_canonical_source.json");
const REUSED_OWNER_SOURCE: &str = include_str!("../src/categorical_threshold_bucketizer.rs");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    reused_owner: ReusedOwner,
    settings: Vec<Setting>,
    invalid_tracking_row_counts: Vec<InvalidCount>,
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
    minimum_inclusive_rows: u64,
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
    tracking_row_count: Value,
    expected_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InvalidCount {
    case_id: String,
    tracking_row_count: Value,
}

fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn tracking_row_count(value: &Value) -> Result<u64, &'static str> {
    value
        .as_u64()
        .ok_or("nonnegative_integer_tracking_row_count_required")
}

fn assert_artifact(setting: &Setting, role: &str, locator: &str, sha256: &str) {
    let artifact = setting
        .source_artifacts
        .iter()
        .find(|artifact| artifact.role == role)
        .unwrap_or_else(|| panic!("missing {role} artifact"));
    assert_eq!(artifact.locator, locator);
    assert_eq!(artifact.sha256, sha256);
}

#[test]
fn exact_grouped_row_count_boundaries_reuse_the_lower_inclusive_bucketizer() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-dekker-tracking-row-count-thresholds-canonical-source-fixture/v1"
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
        .contains("nonnegative JSON integer count"));
    assert_eq!(fixture.settings.len(), 2);

    let baseline = &fixture.settings[0];
    assert_eq!(baseline.source_work_id, "doi:10.1080/15213269.2024.2334025");
    assert_eq!(
        (
            baseline.canonical_setting.setting_id.as_str(),
            baseline.canonical_setting.parameter_key.as_str(),
            baseline.canonical_setting.source_observed_setting.as_str(),
            baseline.canonical_setting.source_value_sha256.as_str(),
        ),
        (
            "method-setting-3cf495b8511d8c26e267fd60",
            "clean.include.baseline_tracking",
            "clean.include.baseline_tracking: within tr_daily retain IDs with n() >= 8, then intersect installed IDs",
            "e74b3470b0b3e348f95dc9febc52988298eff736b83c6683d6405d8194e4206e",
        )
    );
    assert_eq!(baseline.minimum_inclusive_rows, 8);
    assert!(baseline.superseded_aliases.is_empty());
    assert!(baseline.output_boundary.contains("Equality at 8"));
    assert!(baseline.output_boundary.contains("not performed"));
    assert_artifact(
        baseline,
        "released R cleaning script",
        ".tmp-literature-review-private/corrective-packet-06-ranks174-223-20260831/artifacts/rank209-osf-45q72/osfstorage/Notification-disabling intervention study/Data & Analyses/(2) R script data cleaning [raw survey & tracking data].R:444-456",
        "2bd5bab0c9a917a64f347093972bff72e2b0b5cfd38539a1df229c65cdbd383b",
    );

    let intervention = &fixture.settings[1];
    assert_eq!(
        intervention.source_work_id,
        "doi:10.1080/15213269.2024.2334025"
    );
    assert_eq!(
        (
            intervention.canonical_setting.setting_id.as_str(),
            intervention.canonical_setting.parameter_key.as_str(),
            intervention.canonical_setting.source_observed_setting.as_str(),
            intervention.canonical_setting.source_value_sha256.as_str(),
        ),
        (
            "method-setting-7e8f2af3a154b7a2ac3a308a",
            "clean.include.intervention_tracking",
            "clean.include.intervention_tracking: within tr_daily retain IDs with n() >= 15, then intersect T1-complete IDs",
            "221f77a173b2f2f84bf70b92e18d1d5861a7e77b6d8a914d9725066acff2be56",
        )
    );
    assert_eq!(intervention.minimum_inclusive_rows, 15);
    assert!(intervention.superseded_aliases.is_empty());
    assert!(intervention.output_boundary.contains("Equality at 15"));
    assert!(intervention.output_boundary.contains("not performed"));
    assert_artifact(
        intervention,
        "released R cleaning script",
        ".tmp-literature-review-private/corrective-packet-06-ranks174-223-20260831/artifacts/rank209-osf-45q72/osfstorage/Notification-disabling intervention study/Data & Analyses/(2) R script data cleaning [raw survey & tracking data].R:471-485",
        "2bd5bab0c9a917a64f347093972bff72e2b0b5cfd38539a1df229c65cdbd383b",
    );

    for setting in &fixture.settings {
        assert_eq!(
            sha256(setting.canonical_setting.source_observed_setting.as_bytes()),
            setting.canonical_setting.source_value_sha256,
            "{} canonical value hash",
            setting.canonical_setting.setting_id
        );
        assert!(setting.input_measure.contains("tr_daily row count"));
        assert!(setting
            .input_boundary
            .contains("caller-supplied nonnegative integer count"));
        assert!(setting
            .limitations
            .iter()
            .any(|limitation| limitation.contains("does not construct")));
        assert!(setting
            .limitations
            .iter()
            .any(|limitation| limitation.contains("does not group")));
        assert!(setting
            .limitations
            .iter()
            .any(|limitation| limitation.contains("not final participant inclusion")));
        assert_artifact(
            setting,
            "canonical source-completeness audit",
            ".tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits/doi-10.1080-15213269.2024.2334025.json",
            "ee986e5c3f85f39bdc33d17a0198505510536a15f5ef316846588d6565dbeb3d",
        );
        assert_artifact(
            setting,
            "canonical method-setting assertions",
            ".tmp-literature-review-private/ontology-sublation-20260831/adjudicated-method-setting-assertions.jsonl",
            "a3d676d9282b28f1f71687b1366ebf073796ae0e4c5c8bc0757096e173a1fcf5",
        );
        assert_artifact(
            setting,
            "alias and tombstone ledger",
            ".tmp-literature-review-private/ontology-sublation-20260831/method-setting-alias-tombstones.json",
            "018221f6036218887355a0a2dcd9d6d54a9e90eb93f380b4e1b81cc75c0f76b5",
        );
        for artifact in &setting.source_artifacts {
            assert!(!artifact.role.is_empty());
            assert!(!artifact.locator.is_empty());
            assert_eq!(artifact.sha256.len(), 64);
            assert!(artifact.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()));
        }

        let bucketizer = OrderedThresholdBucketizer::new(
            vec![setting.minimum_inclusive_rows as f64],
            vec!["does_not_meet_source_boundary", "meets_source_boundary"],
        )
        .expect("one finite lower-inclusive row-count threshold");
        assert_eq!(
            bucketizer.thresholds(),
            &[setting.minimum_inclusive_rows as f64]
        );
        for case in &setting.cases {
            let count = tracking_row_count(&case.tracking_row_count)
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

    for case in &fixture.invalid_tracking_row_counts {
        assert_eq!(
            tracking_row_count(&case.tracking_row_count),
            Err(fixture.invalid_count_error.as_str()),
            "{}",
            case.case_id
        );
    }
}
