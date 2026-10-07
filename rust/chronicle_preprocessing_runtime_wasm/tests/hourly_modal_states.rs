#[path = "../src/grouped_unique_mode.rs"]
mod grouped_unique_mode;

use grouped_unique_mode::{unique_mode_by_group, GroupedUniqueMode, GroupedUniqueModeError};
use serde::Deserialize;

const SOURCE_FIXTURE: &str = include_str!("fixtures/hourly_modal_states_opoku_asare_2021.json");

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
    streams: Vec<StateStream>,
    tie_cases: Vec<TieCase>,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StateStream {
    parameter_key: String,
    observations: Vec<StateObservation>,
    expected_observed_groups: Vec<ExpectedMode>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StateObservation {
    participant_id: String,
    source_day_id: String,
    hour_of_day: u8,
    category: String,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Group {
    participant_id: String,
    source_day_id: String,
    hour_of_day: u8,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExpectedMode {
    participant_id: String,
    source_day_id: String,
    hour_of_day: u8,
    category: String,
    frequency: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TieCase {
    case_id: String,
    group: Group,
    categories: Vec<String>,
    expected_maximum_frequency: usize,
    expected_tied_category_count: usize,
}

fn group(participant_id: String, source_day_id: String, hour_of_day: u8) -> Group {
    assert!(!participant_id.is_empty());
    assert!(!source_day_id.is_empty());
    assert!(hour_of_day <= 23);
    Group {
        participant_id,
        source_day_id,
        hour_of_day,
    }
}

#[test]
fn computes_unique_hourly_modes_and_refuses_the_undisclosed_tie_case() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-hourly-modal-states-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.2196/26540");
    assert_eq!(
        fixture.source_artifact.locator,
        ".tmp-literature-review-private/corrective-packet-04-ranks-074-123-20260831/text/100.txt:243-256"
    );
    assert_eq!(
        fixture.source_artifact.sha256,
        "a4683ab2ede60c1fb9ebae8c57bd55fdb71cae47ee1a1ade10318ab943f1ad69"
    );
    let expected_settings = [
        (
            "method-setting-30a656701f4f3ab15c76e2f6",
            "feature.hourly_screen_state",
            "modal screen status for each hour",
            "78aa4df17339273af360ccb7ca7903865e364dc618aa99a6c8a4de1b4bd860fe",
        ),
        (
            "method-setting-4ba32f01e20f10d7a52c7259",
            "feature.hourly_internet_state",
            "modal internet-connectivity state for each hour",
            "c442e8784aa9b05d16d02c16ef306388148bda65b6256658e9151b3b318d9412",
        ),
    ];
    assert_eq!(fixture.exact_canonical_settings.len(), 2);
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
    assert!(fixture.input_boundary.contains("already assigned"));
    assert!(fixture.output_boundary.contains("uniquely most frequent"));
    for excluded_claim in [
        "does not parse",
        "does not derive",
        "fail closed",
        "not synthesized or zero-filled",
        "no duration weighting",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }

    for stream in fixture.streams {
        assert!(expected_settings
            .iter()
            .any(|setting| setting.1 == stream.parameter_key));
        let observations = stream.observations.into_iter().map(|observation| {
            assert!(!observation.category.is_empty());
            (
                group(
                    observation.participant_id,
                    observation.source_day_id,
                    observation.hour_of_day,
                ),
                observation.category,
            )
        });
        let actual = unique_mode_by_group(observations).expect("fixture groups have unique modes");
        let expected = stream
            .expected_observed_groups
            .into_iter()
            .map(|mode| GroupedUniqueMode {
                group: group(mode.participant_id, mode.source_day_id, mode.hour_of_day),
                category: mode.category,
                frequency: mode.frequency,
            })
            .collect::<Vec<_>>();
        assert_eq!(actual, expected, "{}", stream.parameter_key);
    }

    for tie_case in fixture.tie_cases {
        assert!(!tie_case.case_id.is_empty());
        let observations = tie_case
            .categories
            .into_iter()
            .map(|category| (tie_case.group.clone(), category));
        assert_eq!(
            unique_mode_by_group(observations),
            Err(GroupedUniqueModeError::NonUniqueMaximum {
                group: tie_case.group,
                maximum_frequency: tie_case.expected_maximum_frequency,
                tied_category_count: tie_case.expected_tied_category_count,
            }),
            "{}",
            tie_case.case_id
        );
    }

    assert!(unique_mode_by_group::<String, String, _>([])
        .expect("empty input has no tied group")
        .is_empty());
}
