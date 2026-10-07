#[path = "../src/finite_scalar_pivot_classifier.rs"]
mod finite_scalar_pivot_classifier;

use finite_scalar_pivot_classifier::FiniteScalarPivotClassifier;
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/loneliness_motion_step_pivots_canonical_source.json");
const REUSED_OWNER_SOURCE: &str = include_str!("../src/finite_scalar_pivot_classifier.rs");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    reused_owner: ReusedOwner,
    source_work_id: String,
    source_artifacts: Vec<SourceArtifact>,
    settings: Vec<Setting>,
    invalid_speed_inputs: Vec<InvalidInput>,
    invalid_speed_error: String,
    invalid_step_count_inputs: Vec<InvalidInput>,
    invalid_step_count_error: String,
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
    canonical_setting: CanonicalSetting,
    superseded_aliases: Vec<String>,
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

fn finite_nonnegative_speed_kmh(value: &Value) -> Result<f64, &'static str> {
    let speed = value
        .as_f64()
        .ok_or("finite_nonnegative_speed_kmh_required")?;
    if !speed.is_finite() || speed < 0.0 {
        return Err("finite_nonnegative_speed_kmh_required");
    }
    Ok(speed)
}

fn nonnegative_integer_step_count(value: &Value) -> Result<u64, &'static str> {
    value
        .as_u64()
        .ok_or("nonnegative_integer_step_count_required")
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

fn assert_artifact(fixture: &Fixture, role: &str, locator: &str, sha256: &str) {
    let artifact = fixture
        .source_artifacts
        .iter()
        .find(|artifact| artifact.role == role)
        .unwrap_or_else(|| panic!("missing {role} artifact"));
    assert_eq!(artifact.locator, locator);
    assert_eq!(artifact.sha256, sha256);
}

#[test]
fn speed_equality_is_static_while_step_equality_remains_source_unclassified() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-loneliness-motion-step-pivots-canonical-source-fixture/v1"
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
    assert_eq!(fixture.source_work_id, "doi:10.2196/13209");
    assert_eq!(fixture.settings.len(), 2);

    assert_artifact(
        &fixture,
        "primary paper text",
        ".tmp-literature-review-private/strict-screen-native-ranks37-73-20260831T0415Z/text/59-loneliness.txt:335-353",
        "4a7cb9208c6a732dba9581c2e8cf6967606a11e879882eff9522ecf8ba87874d",
    );
    assert_artifact(
        &fixture,
        "primary paper full-text HTML",
        ".tmp-literature-review-private/strict-screen-native-ranks37-73-20260831T0415Z/artifacts/59-loneliness.fulltext.html",
        "6af819e534d6dd9c3012cabd2c12765c7f85910a640ecd2829d997b5dbb813e8",
    );
    assert_artifact(
        &fixture,
        "canonical source-completeness audit",
        ".tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits/doi-10.2196-13209.json",
        "174e6192af25e54716967f9988590a133dfb3e10ff558e1c1d7dd3f53c547a96",
    );
    assert_artifact(
        &fixture,
        "canonical method-setting assertions",
        ".tmp-literature-review-private/ontology-sublation-20260831/adjudicated-method-setting-assertions.jsonl",
        "a3d676d9282b28f1f71687b1366ebf073796ae0e4c5c8bc0757096e173a1fcf5",
    );
    assert_artifact(
        &fixture,
        "alias and tombstone ledger",
        ".tmp-literature-review-private/ontology-sublation-20260831/method-setting-alias-tombstones.json",
        "018221f6036218887355a0a2dcd9d6d54a9e90eb93f380b4e1b81cc75c0f76b5",
    );

    let speed = &fixture.settings[0];
    assert_eq!(
        (
            speed.canonical_setting.setting_id.as_str(),
            speed.canonical_setting.parameter_key.as_str(),
            speed.canonical_setting.source_observed_setting.as_str(),
            speed.canonical_setting.source_value_sha256.as_str(),
            speed.pivot,
        ),
        (
            "method-setting-b2c40553a9f91ffa6183a1e9",
            "location.motion_threshold",
            "location.motion_threshold: {\"moving\":\"speed > 1 km/h\",\"static\":\"speed <= 1 km/h\"}",
            "44aab881b05740366f227d80766e265998568249c124879702de7c47491ceebd",
            1.0,
        )
    );
    assert!(speed.superseded_aliases.is_empty());
    assert_eq!(
        (
            speed.below_disposition.as_str(),
            speed.equal_disposition.as_str(),
            speed.above_disposition.as_str(),
        ),
        ("static", "static", "moving")
    );
    assert!(speed.input_measure.contains("kilometers per hour"));
    assert!(speed.input_boundary.contains("Distance"));
    for case in &speed.cases {
        let value = finite_nonnegative_speed_kmh(&case.value)
            .unwrap_or_else(|error| panic!("{}: {error}", case.case_id));
        assert_eq!(
            classify(speed, value),
            case.expected_disposition,
            "{}",
            case.case_id
        );
    }
    assert_eq!(classify(speed, 1.0), "static");

    let steps = &fixture.settings[1];
    assert_eq!(
        (
            steps.canonical_setting.setting_id.as_str(),
            steps.canonical_setting.parameter_key.as_str(),
            steps.canonical_setting.source_observed_setting.as_str(),
            steps.canonical_setting.source_value_sha256.as_str(),
            steps.pivot,
        ),
        (
            "method-setting-1a0c647be1910bebaf0ceabf",
            "steps.bout_state_rule",
            "steps.bout_state_rule: sedentary while each five-minute count is <10; active starts when a count is >10; the ==10 state is not disclosed",
            "79cd1c960ed13249f4d7c3b50ac33aa6f33b8932228996b1cf5818541da8e5d7",
            10.0,
        )
    );
    assert!(steps.superseded_aliases.is_empty());
    assert_eq!(
        (
            steps.below_disposition.as_str(),
            steps.equal_disposition.as_str(),
            steps.above_disposition.as_str(),
        ),
        ("sedentary", "source_unclassified", "active")
    );
    assert!(steps
        .input_measure
        .contains("nonnegative integer step count"));
    assert!(steps.input_boundary.contains("Window construction"));
    for case in &steps.cases {
        let value = nonnegative_integer_step_count(&case.value)
            .unwrap_or_else(|error| panic!("{}: {error}", case.case_id));
        assert_eq!(
            classify(steps, value as f64),
            case.expected_disposition,
            "{}",
            case.case_id
        );
    }
    assert_eq!(classify(steps, 10.0), "source_unclassified");

    for setting in &fixture.settings {
        assert_eq!(
            sha256(setting.canonical_setting.source_observed_setting.as_bytes()),
            setting.canonical_setting.source_value_sha256,
            "{} canonical value hash",
            setting.canonical_setting.setting_id
        );
    }
    for artifact in &fixture.source_artifacts {
        assert!(!artifact.role.is_empty());
        assert!(!artifact.locator.is_empty());
        assert_eq!(artifact.sha256.len(), 64);
        assert!(artifact.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()));
    }
    assert!(speed
        .limitations
        .iter()
        .any(|limitation| limitation.contains("does not derive speed")));
    assert!(steps
        .limitations
        .iter()
        .any(|limitation| limitation.contains("Exactly 10 steps")));
    assert!(steps
        .limitations
        .iter()
        .any(|limitation| limitation.contains("multi-interval bouts")));

    for case in &fixture.invalid_speed_inputs {
        assert_eq!(
            finite_nonnegative_speed_kmh(&case.value),
            Err(fixture.invalid_speed_error.as_str()),
            "{}",
            case.case_id
        );
    }
    for case in &fixture.invalid_step_count_inputs {
        assert_eq!(
            nonnegative_integer_step_count(&case.value),
            Err(fixture.invalid_step_count_error.as_str()),
            "{}",
            case.case_id
        );
    }
}
