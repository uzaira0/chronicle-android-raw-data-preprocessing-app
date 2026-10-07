#[path = "../src/finite_scalar_pivot_classifier.rs"]
mod finite_scalar_pivot_classifier;

use finite_scalar_pivot_classifier::FiniteScalarPivotClassifier;
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/loneliness_and_attendance_cutoffs_canonical_source.json");
const REUSED_OWNER_SOURCE: &str = include_str!("../src/finite_scalar_pivot_classifier.rs");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    reused_owner: ReusedOwner,
    settings: Vec<Setting>,
    invalid_loneliness_scores: Vec<InvalidInput>,
    invalid_loneliness_score_error: String,
    invalid_attendance_hours: Vec<InvalidInput>,
    invalid_attendance_hours_error: String,
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
    pivot: f64,
    below_disposition: String,
    equal_disposition: String,
    above_disposition: String,
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
    value: Value,
    expected_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InvalidInput {
    case_id: String,
    value: Value,
}

fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn loneliness_score(value: &Value) -> Result<u64, &'static str> {
    let score = value
        .as_u64()
        .ok_or("integer_loneliness_score_20_through_80_required")?;
    if !(20..=80).contains(&score) {
        return Err("integer_loneliness_score_20_through_80_required");
    }
    Ok(score)
}

fn attendance_hours(value: &Value) -> Result<f64, &'static str> {
    let hours = value
        .as_f64()
        .ok_or("finite_nonnegative_attendance_hours_required")?;
    if !hours.is_finite() || hours < 0.0 {
        return Err("finite_nonnegative_attendance_hours_required");
    }
    Ok(hours)
}

fn classify(setting: &Setting, value: f64) -> &str {
    let classifier = FiniteScalarPivotClassifier::new(
        setting.pivot,
        setting.below_disposition.as_str(),
        setting.equal_disposition.as_str(),
        setting.above_disposition.as_str(),
    )
    .expect("finite source pivot");
    classifier
        .category_for(value)
        .copied()
        .expect("validated finite source input")
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
fn loneliness_40_is_low_and_attendance_10_is_not_excluded() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-loneliness-and-attendance-cutoffs-canonical-source-fixture/v1"
    );
    assert_eq!(
        fixture.reused_owner.component,
        "FiniteScalarPivotClassifier"
    );
    assert_eq!(
        fixture.reused_owner.source_path,
        "rust/chronicle_preprocessing_runtime_wasm/src/finite_scalar_pivot_classifier.rs"
    );
    assert_eq!(
        sha256(REUSED_OWNER_SOURCE.as_bytes()),
        fixture.reused_owner.source_sha256
    );
    assert!(fixture
        .reused_owner
        .semantic_boundary
        .contains("below, equal to, or above"));
    assert_eq!(fixture.settings.len(), 2);

    let loneliness = &fixture.settings[0];
    assert_eq!(loneliness.source_work_id, "doi:10.2196/13209");
    assert_eq!(
        (
            loneliness.canonical_setting.setting_id.as_str(),
            loneliness.canonical_setting.parameter_key.as_str(),
            loneliness.canonical_setting.source_observed_setting.as_str(),
            loneliness.canonical_setting.source_value_sha256.as_str(),
            loneliness.pivot,
        ),
        (
            "method-setting-5b202c5e8f680f2ea695b403",
            "outcome.binary_loneliness",
            "outcome.binary_loneliness: {\"low\":\"score <= 40\",\"high\":\"score > 40\",\"justification\":\"conceptual midpoint chosen because no standard cutoff\"}",
            "5b350db509a2ab2f1a4470ba538b513a79bec2b2585d321e43bd467b2351d108",
            40.0,
        )
    );
    assert!(loneliness.superseded_aliases.is_empty());
    assert_eq!(
        (
            loneliness.below_disposition.as_str(),
            loneliness.equal_disposition.as_str(),
            loneliness.above_disposition.as_str(),
        ),
        ("low_loneliness", "low_loneliness", "high_loneliness")
    );
    assert!(loneliness.input_measure.contains("integer total"));
    assert!(loneliness.input_boundary.contains("20 through 80"));
    for case in &loneliness.cases {
        let score = loneliness_score(&case.value)
            .unwrap_or_else(|error| panic!("{}: {error}", case.case_id));
        assert_eq!(
            classify(loneliness, score as f64),
            case.expected_disposition,
            "{}",
            case.case_id
        );
    }
    assert_eq!(classify(loneliness, 40.0), "low_loneliness");
    assert_eq!(classify(loneliness, 41.0), "high_loneliness");
    assert_artifact(
        loneliness,
        "primary paper text",
        ".tmp-literature-review-private/strict-screen-native-ranks37-73-20260831T0415Z/text/59-loneliness.txt:275-305",
        "4a7cb9208c6a732dba9581c2e8cf6967606a11e879882eff9522ecf8ba87874d",
    );
    assert_artifact(
        loneliness,
        "canonical source-completeness audit",
        ".tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits/doi-10.2196-13209.json",
        "174e6192af25e54716967f9988590a133dfb3e10ff558e1c1d7dd3f53c547a96",
    );

    let attendance = &fixture.settings[1];
    assert_eq!(attendance.source_work_id, "doi:10.1177/0956797620956613");
    assert_eq!(
        (
            attendance.canonical_setting.setting_id.as_str(),
            attendance.canonical_setting.parameter_key.as_str(),
            attendance
                .canonical_setting
                .source_observed_setting
                .as_str(),
            attendance.canonical_setting.source_value_sha256.as_str(),
            attendance.pivot,
        ),
        (
            "method-setting-c97a93da0da2fef6edb1aa85",
            "quality.exclusion_attendance_lt_10h",
            "quality.exclusion_attendance_lt_10h: {\"comparator\":\"less_than\",\"hours\":10}",
            "e2fe7abc003d9e223fc3e87bccf229d639df1f93aebca0652f7ddab5c038b1e0",
            10.0,
        )
    );
    assert!(attendance.superseded_aliases.is_empty());
    assert_eq!(
        (
            attendance.below_disposition.as_str(),
            attendance.equal_disposition.as_str(),
            attendance.above_disposition.as_str(),
        ),
        (
            "exclude_by_attendance_criterion",
            "not_excluded_by_attendance_criterion",
            "not_excluded_by_attendance_criterion",
        )
    );
    assert!(attendance.input_measure.contains("attendance hours"));
    assert!(attendance.input_boundary.contains("attendance inference"));
    for case in &attendance.cases {
        let hours = attendance_hours(&case.value)
            .unwrap_or_else(|error| panic!("{}: {error}", case.case_id));
        assert_eq!(
            classify(attendance, hours),
            case.expected_disposition,
            "{}",
            case.case_id
        );
    }
    assert_eq!(
        classify(attendance, 10.0),
        "not_excluded_by_attendance_criterion"
    );
    assert_artifact(
        attendance,
        "primary paper text",
        ".tmp-literature-review-private/corrective-packet-09-ranks330-381-20260831/text/365.txt:183-191",
        "81c59576e9f9c54e3929c235a6acb7888afa9dc9d69a9e2e466e81c47b261ff1",
    );
    assert_artifact(
        attendance,
        "canonical source-completeness audit",
        ".tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits/doi-10.1177-0956797620956613.json",
        "6454d548944d7a3988cc31b70646f6af82c62cfb916dc47000ac3e1a1ba8c1d1",
    );

    for setting in &fixture.settings {
        assert_eq!(
            sha256(setting.canonical_setting.source_observed_setting.as_bytes()),
            setting.canonical_setting.source_value_sha256,
            "{} canonical value hash",
            setting.canonical_setting.setting_id
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
    }
    assert!(loneliness
        .limitations
        .iter()
        .any(|limitation| limitation.contains("does not validate individual")));
    assert!(attendance
        .limitations
        .iter()
        .any(|limitation| limitation.contains("does not infer attendance")));
    assert!(attendance
        .limitations
        .iter()
        .any(|limitation| limitation.contains("does not mean retained")));

    for case in &fixture.invalid_loneliness_scores {
        assert_eq!(
            loneliness_score(&case.value),
            Err(fixture.invalid_loneliness_score_error.as_str()),
            "{}",
            case.case_id
        );
    }
    for case in &fixture.invalid_attendance_hours {
        assert_eq!(
            attendance_hours(&case.value),
            Err(fixture.invalid_attendance_hours_error.as_str()),
            "{}",
            case.case_id
        );
    }
}
