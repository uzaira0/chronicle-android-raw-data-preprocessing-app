#[path = "../src/grouped_distinct_count.rs"]
mod grouped_distinct_count;

use grouped_distinct_count::{count_distinct_members_by_group, GroupedDistinctCount};
use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/hourly_distinct_foreground_apps_opoku_asare_2021.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    exact_canonical_setting_id: String,
    parameter_key: String,
    source_value: String,
    source_value_sha256: String,
    source_artifact: SourceArtifact,
    input_boundary: String,
    output_boundary: String,
    limitations: Vec<String>,
    observations: Vec<Observation>,
    expected_observed_groups: Vec<ExpectedGroup>,
    explicitly_absent_group: Group,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceArtifact {
    locator: String,
    sha256: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Observation {
    participant_id: String,
    source_day_id: String,
    hour_of_day: u8,
    foreground_app_identity: String,
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
struct ExpectedGroup {
    participant_id: String,
    source_day_id: String,
    hour_of_day: u8,
    distinct_foreground_app_count: usize,
}

#[test]
fn counts_distinct_foreground_app_identities_within_each_observed_hour_group() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-hourly-distinct-foreground-apps-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.2196/26540");
    assert_eq!(
        fixture.exact_canonical_setting_id,
        "method-setting-9d9b2409732251983bc1658d"
    );
    assert_eq!(fixture.parameter_key, "feature.hourly_app_state");
    assert_eq!(
        fixture.source_value,
        "number of distinct foreground apps used in each hour"
    );
    assert_eq!(
        fixture.source_value_sha256,
        "fd6ae82047745540af5a89aa3ad681237eb63b5792838aa31fd105499853c126"
    );
    assert_eq!(
        fixture.source_artifact.locator,
        ".tmp-literature-review-private/corrective-packet-04-ranks-074-123-20260831/text/100.txt:243-256"
    );
    assert_eq!(
        fixture.source_artifact.sha256,
        "a4683ab2ede60c1fb9ebae8c57bd55fdb71cae47ee1a1ade10318ab943f1ad69"
    );
    assert!(fixture.input_boundary.contains("already classified"));
    assert!(fixture.output_boundary.contains("observed in the input"));
    for excluded_claim in [
        "does not decide",
        "does not parse",
        "identity is supplied opaquely",
        "not synthesized or zero-filled",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }

    let rows = fixture.observations.into_iter().map(|observation| {
        assert!(!observation.participant_id.is_empty());
        assert!(!observation.source_day_id.is_empty());
        assert!(observation.hour_of_day <= 23);
        assert!(!observation.foreground_app_identity.is_empty());
        (
            Group {
                participant_id: observation.participant_id,
                source_day_id: observation.source_day_id,
                hour_of_day: observation.hour_of_day,
            },
            observation.foreground_app_identity,
        )
    });
    let actual = count_distinct_members_by_group(rows);
    let expected = fixture
        .expected_observed_groups
        .into_iter()
        .map(|group| GroupedDistinctCount {
            group: Group {
                participant_id: group.participant_id,
                source_day_id: group.source_day_id,
                hour_of_day: group.hour_of_day,
            },
            distinct_member_count: group.distinct_foreground_app_count,
        })
        .collect::<Vec<_>>();

    assert_eq!(actual, expected);
    assert!(!actual
        .iter()
        .any(|count| count.group == fixture.explicitly_absent_group));
    assert!(count_distinct_members_by_group::<String, String, _>([]).is_empty());
}
