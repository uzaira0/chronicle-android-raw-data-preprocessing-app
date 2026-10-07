#[path = "../src/finite_scalar_pivot_classifier.rs"]
mod finite_scalar_pivot_classifier;

use finite_scalar_pivot_classifier::{
    FiniteScalarPivotClassifier, FiniteScalarPivotClassifierError,
};
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/pilot_item_selection_thresholds_canonical_source.json");
const REUSED_OWNER_SOURCE: &str = include_str!("../src/finite_scalar_pivot_classifier.rs");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    reused_owner: ReusedOwner,
    source_work_id: String,
    source_artifacts: Vec<SourceArtifact>,
    input_boundary: String,
    settings: Vec<Setting>,
    invalid_statistic_inputs: Vec<InvalidStatistic>,
    invalid_statistic_error: String,
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
    input_measure: String,
    pivot: f64,
    exclusion_relation: String,
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
    statistic: Value,
    expected_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InvalidStatistic {
    case_id: String,
    statistic: Value,
}

fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn finite_numeric_statistic(value: &Value) -> Result<f64, &'static str> {
    let statistic = value
        .as_f64()
        .ok_or("finite_numeric_item_statistic_required")?;
    if !statistic.is_finite() {
        return Err("finite_numeric_item_statistic_required");
    }
    Ok(statistic)
}

fn exclusion_disposition(
    setting: &Setting,
    statistic: f64,
) -> Result<&'static str, FiniteScalarPivotClassifierError> {
    let classifier = FiniteScalarPivotClassifier::new(setting.pivot, "below", "equal", "above")?;
    let relation = classifier.category_for(statistic)?;
    let excluded = match setting.exclusion_relation.as_str() {
        "below_or_equal" => *relation == "below" || *relation == "equal",
        "equal_or_above" => *relation == "equal" || *relation == "above",
        unknown => panic!("unsupported fixture relation {unknown}"),
    };
    Ok(if excluded {
        "exclude"
    } else {
        "retain_by_this_predicate"
    })
}

#[test]
fn released_loading_and_icc_exclusions_preserve_both_equalities() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-pilot-item-selection-thresholds-canonical-source-fixture/v1"
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
    assert_eq!(fixture.source_work_id, "doi:10.1177/2050157921993896");
    assert!(fixture.input_boundary.contains("caller-supplied finite"));
    assert!(fixture.input_boundary.contains("established upstream"));
    assert_eq!(fixture.settings.len(), 2);

    let loading = &fixture.settings[0];
    assert_eq!(
        (
            loading.canonical_setting.setting_id.as_str(),
            loading.canonical_setting.parameter_key.as_str(),
            loading.canonical_setting.source_observed_setting.as_str(),
            loading.canonical_setting.source_value_sha256.as_str(),
            loading.pivot,
            loading.exclusion_relation.as_str(),
        ),
        (
            "method-setting-7bc9bf701e7cf62359ec8660",
            "pilot.selection.factor_loading_threshold",
            "pilot.selection.factor_loading_threshold: exclude within loading <= 0.4",
            "9ec11d375298d2b6ddff24208f05698c8d75ec1ba82ee744f413c766897a8536",
            0.4,
            "below_or_equal",
        )
    );
    assert!(loading.superseded_aliases.is_empty());
    assert!(loading.input_measure.contains("within-person"));
    assert!(loading.output_boundary.contains("below or equal to 0.4"));
    assert!(loading.output_boundary.contains("equality is excluded"));

    let icc = &fixture.settings[1];
    assert_eq!(
        (
            icc.canonical_setting.setting_id.as_str(),
            icc.canonical_setting.parameter_key.as_str(),
            icc.canonical_setting.source_observed_setting.as_str(),
            icc.canonical_setting.source_value_sha256.as_str(),
            icc.pivot,
            icc.exclusion_relation.as_str(),
        ),
        (
            "method-setting-f532c6dee5fccdb9a802ede1",
            "pilot.selection.icc_threshold",
            "pilot.selection.icc_threshold: exclude ICC >= 0.5",
            "eb86f85ebdf72dcb68fd7aff5ab9b1e584a8c834a4683bc120918ef3a5e01656",
            0.5,
            "equal_or_above",
        )
    );
    assert!(icc.superseded_aliases.is_empty());
    assert_eq!(icc.input_measure, "ICC for one candidate item");
    assert!(icc.output_boundary.contains("equal to or above 0.5"));
    assert!(icc.output_boundary.contains("equality is excluded"));

    for setting in &fixture.settings {
        assert_eq!(
            sha256(setting.canonical_setting.source_observed_setting.as_bytes()),
            setting.canonical_setting.source_value_sha256,
            "{} canonical value hash",
            setting.canonical_setting.setting_id
        );
        for case in &setting.cases {
            let statistic = finite_numeric_statistic(&case.statistic)
                .unwrap_or_else(|error| panic!("{}: {error}", case.case_id));
            assert_eq!(
                exclusion_disposition(setting, statistic),
                Ok(case.expected_disposition.as_str()),
                "{} / {}",
                setting.canonical_setting.setting_id,
                case.case_id
            );
        }
        let equality = setting
            .cases
            .iter()
            .find(|case| case.statistic.as_f64() == Some(setting.pivot))
            .expect("explicit equality case");
        assert_eq!(equality.expected_disposition, "exclude");
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
        .any(|limitation| limitation.contains("does not compute ICCs")));
    assert!(fixture
        .limitations
        .iter()
        .any(|limitation| limitation.contains("does not reproduce")));
    assert!(fixture
        .limitations
        .iter()
        .any(|limitation| limitation.contains("does not mean")));

    for case in &fixture.invalid_statistic_inputs {
        assert_eq!(
            finite_numeric_statistic(&case.statistic),
            Err(fixture.invalid_statistic_error.as_str()),
            "{}",
            case.case_id
        );
    }
    assert_eq!(
        FiniteScalarPivotClassifier::new(0.5, false, false, true)
            .expect("finite pivot")
            .category_for(f64::NAN),
        Err(FiniteScalarPivotClassifierError::NonFiniteObservation)
    );
    assert_eq!(
        FiniteScalarPivotClassifier::new(0.5, false, false, true)
            .expect("finite pivot")
            .category_for(f64::INFINITY),
        Err(FiniteScalarPivotClassifierError::NonFiniteObservation)
    );
}
