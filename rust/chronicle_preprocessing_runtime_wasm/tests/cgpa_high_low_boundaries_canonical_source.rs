#[path = "../src/finite_scalar_pivot_classifier.rs"]
mod finite_scalar_pivot_classifier;

use finite_scalar_pivot_classifier::{
    FiniteScalarPivotClassifier, FiniteScalarPivotClassifierError,
};
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/cgpa_high_low_boundaries_canonical_source.json");
const REUSED_OWNER_SOURCE: &str = include_str!("../src/finite_scalar_pivot_classifier.rs");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    reused_owner: ReusedOwner,
    source_work_id: String,
    source_artifacts: Vec<SourceArtifact>,
    input_measure: String,
    input_boundary: String,
    settings: Vec<Setting>,
    joint_cases: Vec<JointCase>,
    invalid_cgpa_inputs: Vec<InvalidCgpa>,
    invalid_cgpa_error: String,
    limitations: Vec<String>,
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
#[serde(deny_unknown_fields)]
struct SourceArtifact {
    role: String,
    locator: String,
    sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Setting {
    canonical_setting: CanonicalSetting,
    superseded_aliases: Vec<String>,
    pivot: f64,
    predicate: String,
    output_boundary: String,
    cases: Vec<BoundaryCase>,
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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BoundaryCase {
    case_id: String,
    cgpa: Value,
    expected_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct JointCase {
    case_id: String,
    cgpa: Value,
    expected_low: bool,
    expected_high: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InvalidCgpa {
    case_id: String,
    cgpa: Value,
}

fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn finite_numeric_cgpa(value: &Value) -> Result<f64, &'static str> {
    let cgpa = value.as_f64().ok_or("finite_numeric_cgpa_required")?;
    if !cgpa.is_finite() {
        return Err("finite_numeric_cgpa_required");
    }
    Ok(cgpa)
}

fn source_rule_matches(
    setting: &Setting,
    cgpa: f64,
) -> Result<bool, FiniteScalarPivotClassifierError> {
    let classifier = FiniteScalarPivotClassifier::new(setting.pivot, "below", "equal", "above")?;
    let relation = classifier.category_for(cgpa)?;
    Ok(match setting.predicate.as_str() {
        "below" => *relation == "below",
        "equal_or_above" => *relation == "equal" || *relation == "above",
        unknown => panic!("unsupported fixture predicate {unknown}"),
    })
}

#[test]
fn low_and_high_rules_preserve_both_equalities_and_the_unclaimed_gap() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-cgpa-high-low-boundaries-canonical-source-fixture/v1"
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
        .contains("finite scalar"));
    assert_eq!(fixture.source_work_id, "doi:10.1145/3429360.3468192");
    assert_eq!(fixture.input_measure, "caller-supplied finite numeric CGPA");
    assert!(fixture.input_boundary.contains("scale validator"));
    assert_eq!(fixture.settings.len(), 2);

    let low = &fixture.settings[0];
    assert_eq!(
        (
            low.canonical_setting.setting_id.as_str(),
            low.canonical_setting.parameter_key.as_str(),
            low.canonical_setting.source_observed_setting.as_str(),
            low.canonical_setting.source_value_sha256.as_str(),
            low.pivot,
            low.predicate.as_str(),
        ),
        (
            "method-setting-b47a396b2c20b57cb06a9836",
            "cohort.low_rule",
            "cohort.low_rule: CGPA < 3.0",
            "b3d4ab1f0792f8d6f30f858e308837b6a31504897191bae8bc424ae606febed6",
            3.0,
            "below",
        )
    );
    assert!(low.superseded_aliases.is_empty());
    assert!(low.output_boundary.contains("strictly below 3.0"));
    assert!(low.output_boundary.contains("Equality does not satisfy"));

    let high = &fixture.settings[1];
    assert_eq!(
        (
            high.canonical_setting.setting_id.as_str(),
            high.canonical_setting.parameter_key.as_str(),
            high.canonical_setting.source_observed_setting.as_str(),
            high.canonical_setting.source_value_sha256.as_str(),
            high.pivot,
            high.predicate.as_str(),
        ),
        (
            "method-setting-a1c7539b39b1734039f95e9a",
            "cohort.high_rule",
            "cohort.high_rule: CGPA >= 3.5",
            "83ef24684e029420d6861f4f6362853f79bf7db9f3debb6e7f8c1be3445a0a43",
            3.5,
            "equal_or_above",
        )
    );
    assert!(high.superseded_aliases.is_empty());
    assert!(high.output_boundary.contains("at least 3.5"));
    assert!(high.output_boundary.contains("Equality satisfies"));

    for setting in &fixture.settings {
        assert_eq!(
            sha256(setting.canonical_setting.source_observed_setting.as_bytes()),
            setting.canonical_setting.source_value_sha256,
            "{} canonical value hash",
            setting.canonical_setting.setting_id
        );
        for case in &setting.cases {
            let cgpa = finite_numeric_cgpa(&case.cgpa)
                .unwrap_or_else(|error| panic!("{}: {error}", case.case_id));
            let expected = match case.expected_disposition.as_str() {
                "matches_source_rule" => true,
                "does_not_match_source_rule" => false,
                unknown => panic!("unsupported expected disposition {unknown}"),
            };
            assert_eq!(
                source_rule_matches(setting, cgpa),
                Ok(expected),
                "{} / {}",
                setting.canonical_setting.setting_id,
                case.case_id
            );
        }
    }

    for case in &fixture.joint_cases {
        let cgpa = finite_numeric_cgpa(&case.cgpa)
            .unwrap_or_else(|error| panic!("{}: {error}", case.case_id));
        let matches_low = source_rule_matches(low, cgpa).expect("finite low-rule input");
        let matches_high = source_rule_matches(high, cgpa).expect("finite high-rule input");
        assert_eq!(matches_low, case.expected_low, "{} low", case.case_id);
        assert_eq!(matches_high, case.expected_high, "{} high", case.case_id);
        assert!(!(matches_low && matches_high), "{} overlap", case.case_id);
    }
    for gap_value in [3.0, 3.25, 3.499] {
        assert!(!source_rule_matches(low, gap_value).expect("finite gap value"));
        assert!(!source_rule_matches(high, gap_value).expect("finite gap value"));
    }

    for artifact in &fixture.source_artifacts {
        assert!(!artifact.role.is_empty());
        assert!(!artifact.locator.is_empty());
        assert_eq!(artifact.sha256.len(), 64);
        assert!(artifact.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()));
    }
    assert!(fixture
        .limitations
        .iter()
        .any(|limitation| limitation.contains("does not derive CGPA")));
    assert!(fixture
        .limitations
        .iter()
        .any(|limitation| limitation.contains("middle-excluded")));
    assert!(fixture
        .limitations
        .iter()
        .any(|limitation| limitation.contains("match neither")));

    for case in &fixture.invalid_cgpa_inputs {
        assert_eq!(
            finite_numeric_cgpa(&case.cgpa),
            Err(fixture.invalid_cgpa_error.as_str()),
            "{}",
            case.case_id
        );
    }
    assert_eq!(
        FiniteScalarPivotClassifier::new(3.0, false, false, true)
            .expect("finite pivot")
            .category_for(f64::NAN),
        Err(FiniteScalarPivotClassifierError::NonFiniteObservation)
    );
    assert_eq!(
        FiniteScalarPivotClassifier::new(3.0, false, false, true)
            .expect("finite pivot")
            .category_for(f64::INFINITY),
        Err(FiniteScalarPivotClassifierError::NonFiniteObservation)
    );
}
