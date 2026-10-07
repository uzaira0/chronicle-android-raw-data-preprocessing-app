#[path = "../src/finite_scalar_pivot_classifier.rs"]
mod finite_scalar_pivot_classifier;

use finite_scalar_pivot_classifier::{
    FiniteScalarPivotClassifier, FiniteScalarPivotClassifierError,
};
use serde::Deserialize;

const SOURCE_FIXTURE: &str = include_str!("fixtures/excessive_daily_epoch_frequency_lin_2017.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    canonical_identity: CanonicalIdentity,
    exact_canonical_setting: CanonicalSetting,
    source_artifacts: Vec<SourceArtifact>,
    input_boundary: String,
    output_boundary: String,
    limitations: Vec<String>,
    pivot_epochs_per_day: f64,
    categories: Categories,
    observations: Vec<Observation>,
    invalid_observations: Vec<InvalidObservation>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CanonicalIdentity {
    setting_id: String,
    source_current_setting_id: String,
    source_extraction_id: String,
    #[serde(rename = "sourceExecutionUnitId")]
    source_execution_unit: String,
    alias_resolution: String,
    superseded_alias_setting_ids: Vec<String>,
    tombstone_registry_sha256: String,
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
#[serde(deny_unknown_fields)]
struct Categories {
    below: String,
    equal: String,
    above: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Observation {
    case_id: String,
    epochs_per_day: f64,
    expected_class: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InvalidObservation {
    case_id: String,
    epochs_per_day: Option<f64>,
    expected_error: String,
}

fn validated_epochs_per_day(value: Option<f64>) -> Result<f64, &'static str> {
    let value = value.ok_or("daily_epoch_frequency_required")?;
    if !value.is_finite() {
        return Err("daily_epoch_frequency_must_be_finite");
    }
    Ok(value)
}

fn artifact<'a>(fixture: &'a Fixture, fragment: &str) -> &'a SourceArtifact {
    fixture
        .source_artifacts
        .iter()
        .find(|artifact| artifact.locator.contains(fragment))
        .unwrap_or_else(|| panic!("missing source artifact containing {fragment}"))
}

#[test]
fn excessive_use_requires_frequency_strictly_above_68_point_4_epochs_per_day() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-excessive-daily-epoch-frequency-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.4088/jcp.15m10310");

    let identity = &fixture.canonical_identity;
    assert_eq!(
        (
            identity.setting_id.as_str(),
            identity.source_current_setting_id.as_str(),
            identity.source_extraction_id.as_str(),
            identity.source_execution_unit.as_str(),
            identity.alias_resolution.as_str(),
            identity.tombstone_registry_sha256.as_str(),
        ),
        (
            "method-setting-36820121d28fe36b6ae1ca5b",
            "method-setting-36820121d28fe36b6ae1ca5b",
            "extraction-ed0490b2d5b9b4e60b69",
            "screen-epoch-frequency-15m10310:protocol.excessive_use_threshold",
            "canonical_current_two_superseded_aliases",
            "018221f6036218887355a0a2dcd9d6d54a9e90eb93f380b4e1b81cc75c0f76b5",
        )
    );
    assert_eq!(
        identity.superseded_alias_setting_ids,
        [
            "method-setting-814e56a2dba8752a8ca3e7bf",
            "method-setting-atomic-211caed123b1536e760c",
        ]
    );
    assert_eq!(
        fixture.exact_canonical_setting.setting_id,
        identity.setting_id
    );
    assert_eq!(
        (
            fixture.exact_canonical_setting.parameter_key.as_str(),
            fixture
                .exact_canonical_setting
                .source_observed_setting
                .as_str(),
            fixture.exact_canonical_setting.source_value_sha256.as_str(),
        ),
        (
            "protocol.excessive_use_threshold",
            "protocol.excessive_use_threshold: {\"criterion\":\"criterionapp A7\",\"feature\":\"frequency\",\"operator\":\"strictly greater than\",\"threshold\":68.4,\"unit\":\"epochs/day\",\"inherited_from_reference\":12}",
            "d9b45a75384e82de0fdcb9be1e21de021a043c748931413a1fc004a7766a05f6",
        )
    );

    assert_eq!(fixture.source_artifacts.len(), 4);
    assert_eq!(
        artifact(&fixture, "lin-2017-app-measures.txt").sha256,
        "776fa598cac4d28b198263bd5ea5a984d11515e67564444b242df0d1e0723e6e"
    );
    assert_eq!(
        artifact(&fixture, "app-measures-addiction-2017/primary.pdf").sha256,
        "1396f31fd2d4028a17fd643b534d820e0f5e48d69205787a43f096b41be9409e"
    );
    assert_eq!(
        artifact(&fixture, "source-completeness-audits").sha256,
        "769abdeaa949dfd90569c022865f30d8c5d9e9d5d5d5e922f0d382c9ed2792a8"
    );
    assert_eq!(
        artifact(&fixture, "method-setting-alias-tombstones.json").sha256,
        identity.tombstone_registry_sha256
    );
    assert!(fixture.input_boundary.contains("screen-on"));
    assert!(fixture
        .output_boundary
        .contains("strictly greater than 68.4"));
    for residue in [
        "psychiatric diagnosis",
        "inherited from reference 12",
        "table labels daily use frequency",
        "missing or nonfinite frequency fails closed",
    ] {
        assert!(
            fixture
                .limitations
                .iter()
                .any(|limitation| limitation.contains(residue)),
            "missing limitation for {residue}"
        );
    }

    let classifier = FiniteScalarPivotClassifier::new(
        fixture.pivot_epochs_per_day,
        fixture.categories.below,
        fixture.categories.equal,
        fixture.categories.above,
    )
    .expect("source pivot is finite");
    assert_eq!(classifier.pivot(), 68.4);
    let (below, equal, above) = classifier.categories();
    assert_eq!(
        (below.as_str(), equal.as_str(), above.as_str()),
        ("not_excessive", "not_excessive", "excessive")
    );

    for observation in fixture.observations {
        let frequency = validated_epochs_per_day(Some(observation.epochs_per_day))
            .expect("fixture frequency is finite");
        assert_eq!(
            classifier.category_for(frequency).map(String::as_str),
            Ok(observation.expected_class.as_str()),
            "{}",
            observation.case_id
        );
    }
    for observation in fixture.invalid_observations {
        assert_eq!(
            validated_epochs_per_day(observation.epochs_per_day),
            Err(observation.expected_error.as_str()),
            "{}",
            observation.case_id
        );
    }
    assert_eq!(
        validated_epochs_per_day(Some(f64::NAN)),
        Err("daily_epoch_frequency_must_be_finite")
    );
    assert_eq!(
        classifier.category_for(f64::NAN),
        Err(FiniteScalarPivotClassifierError::NonFiniteObservation)
    );
}
