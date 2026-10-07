#[path = "../src/grouped_scalar_extrema.rs"]
mod grouped_scalar_extrema;

use grouped_scalar_extrema::{
    finite_scalar_extrema_by_group, GroupedScalarExtrema, GroupedScalarExtremaError,
};
use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/daily_first_last_foreground_app_minutes_opoku_asare_2021.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    exact_canonical_settings: Vec<CanonicalSetting>,
    source_artifacts: Vec<SourceArtifact>,
    input_boundary: String,
    output_boundary: String,
    limitations: Vec<String>,
    observations: Vec<Observation>,
    expected_extrema: Vec<ExpectedExtrema>,
    explicitly_absent_group: Group,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CanonicalSetting {
    setting_id: String,
    parameter_key: String,
    source_observed_setting: String,
    source_value_sha256: String,
    source_locator: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceArtifact {
    locator: String,
    sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Observation {
    participant_id: String,
    source_day_id: String,
    minutes_from_hour_zero: f64,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Group {
    participant_id: String,
    source_day_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExpectedExtrema {
    participant_id: String,
    source_day_id: String,
    first_use_minutes: f64,
    last_use_minutes: f64,
}

#[test]
fn binds_daily_first_and_last_foreground_app_minutes_without_inventing_clock_semantics() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-daily-first-last-foreground-app-minutes-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.2196/26540");

    let expected_settings = [
        (
            "method-setting-14cb0448e56480a00b2d0400",
            "feature.first_last_app_minutes",
            "feature.first_last_app_minutes: minutes from hour 0 to first and last foreground-app use per day",
            "b297fd7594594b73cb3195864b2f16f42b7f9b5737101dc5ec458abbe8f890ba",
            "100.txt:282-288",
        ),
        (
            "method-setting-bb801a6f54629c17a9364a0a",
            "output.app_timeOfFirstUse",
            "output.app_timeOfFirstUse: minutes from hour 0 to first foreground-app use",
            "3f3cc88ca8f56440e40b788e44765384e3d6542f9f1b5ff0b3dd3bc5c4ad672d",
            "100-app1.pdf:pages 1-2",
        ),
        (
            "method-setting-92122010fb7d055d808726d2",
            "output.app_timeOfLastUse",
            "output.app_timeOfLastUse: minutes from hour 0 to last foreground-app use",
            "bcabe153150abd467b8894cd938a4b1e349e8dad2fee38d0cebbe30cbf0820ab",
            "100-app1.pdf:pages 1-2",
        ),
    ];
    assert_eq!(fixture.exact_canonical_settings.len(), 3);
    for (setting, expected) in fixture
        .exact_canonical_settings
        .iter()
        .zip(expected_settings)
    {
        assert_eq!(
            (
                setting.setting_id.as_str(),
                setting.parameter_key.as_str(),
                setting.source_observed_setting.as_str(),
                setting.source_value_sha256.as_str(),
            ),
            (expected.0, expected.1, expected.2, expected.3)
        );
        assert!(setting.source_locator.contains(expected.4));
    }

    assert_eq!(fixture.source_artifacts.len(), 2);
    assert!(fixture.source_artifacts[0]
        .locator
        .ends_with("100.txt:282-288"));
    assert_eq!(
        fixture.source_artifacts[0].sha256,
        "a4683ab2ede60c1fb9ebae8c57bd55fdb71cae47ee1a1ade10318ab943f1ad69"
    );
    assert!(fixture.source_artifacts[1]
        .locator
        .ends_with("100-app1.pdf:pages 1-2"));
    assert_eq!(
        fixture.source_artifacts[1].sha256,
        "b122f1467e8c44107223201cd1b5a349f3ca198c8f30ce06800ab0052d8f4275"
    );
    assert!(fixture.input_boundary.contains("caller-reconstructed"));
    assert!(fixture.output_boundary.contains("minimum and maximum"));
    for excluded_claim in [
        "does not classify",
        "does not parse timestamps",
        "no sub-minute rounding",
        "not synthesized or zero-filled",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }

    let observations = fixture.observations.into_iter().map(|observation| {
        assert!(!observation.participant_id.is_empty());
        assert!(!observation.source_day_id.is_empty());
        assert!(observation.minutes_from_hour_zero.is_finite());
        assert_eq!(observation.minutes_from_hour_zero.fract(), 0.0);
        assert!((0.0..1440.0).contains(&observation.minutes_from_hour_zero));
        (
            Group {
                participant_id: observation.participant_id,
                source_day_id: observation.source_day_id,
            },
            observation.minutes_from_hour_zero,
        )
    });
    let actual = finite_scalar_extrema_by_group(observations).expect("all values are finite");
    let expected = fixture
        .expected_extrema
        .into_iter()
        .map(|extrema| GroupedScalarExtrema {
            group: Group {
                participant_id: extrema.participant_id,
                source_day_id: extrema.source_day_id,
            },
            minimum: extrema.first_use_minutes,
            maximum: extrema.last_use_minutes,
        })
        .collect::<Vec<_>>();
    assert_eq!(actual, expected);
    assert!(!actual
        .iter()
        .any(|extrema| extrema.group == fixture.explicitly_absent_group));

    assert_eq!(
        finite_scalar_extrema_by_group(vec![("P01/day-3", f64::INFINITY)]),
        Err(GroupedScalarExtremaError::NonFiniteValue {
            group: "P01/day-3",
            value: f64::INFINITY,
        })
    );
    assert!(finite_scalar_extrema_by_group::<String, _>(Vec::new())
        .expect("empty input is valid")
        .is_empty());
}
