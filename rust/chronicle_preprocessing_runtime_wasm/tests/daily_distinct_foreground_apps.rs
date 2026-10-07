#[path = "../src/grouped_distinct_count.rs"]
mod grouped_distinct_count;

use grouped_distinct_count::{count_distinct_members_by_group, GroupedDistinctCount};
use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/daily_distinct_foreground_apps_opoku_asare_2021.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    exact_canonical_setting_id: String,
    parameter_key: String,
    source_value: String,
    source_value_sha256: String,
    source_artifacts: Vec<SourceArtifact>,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Observation {
    participant_id: String,
    source_day_id: String,
    foreground_app_identity: String,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Group {
    participant_id: String,
    source_day_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExpectedGroup {
    participant_id: String,
    source_day_id: String,
    distinct_foreground_app_count: usize,
}

#[test]
fn reuses_grouped_distinct_count_at_the_disclosed_participant_day_boundary() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-daily-distinct-foreground-apps-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.2196/26540");
    assert_eq!(
        fixture.exact_canonical_setting_id,
        "method-setting-3a39bfe2f5f374a5a1dadc13"
    );
    assert_eq!(fixture.parameter_key, "output.app_distinctCount");
    assert_eq!(
        fixture.source_value,
        "count of distinct foreground applications used"
    );
    assert_eq!(
        fixture.source_value_sha256,
        "300c9945dbb3481fda44937a38514ab8a85dbd4815e65e853ca33398e77b1e3b"
    );
    assert_eq!(fixture.source_artifacts.len(), 2);
    assert_eq!(
        fixture.source_artifacts[0].sha256,
        "b122f1467e8c44107223201cd1b5a349f3ca198c8f30ce06800ab0052d8f4275"
    );
    assert!(fixture.source_artifacts[0]
        .locator
        .contains("100-app1.pdf:pages 1-2"));
    assert_eq!(
        fixture.source_artifacts[1].sha256,
        "a4683ab2ede60c1fb9ebae8c57bd55fdb71cae47ee1a1ade10318ab943f1ad69"
    );
    assert!(fixture.source_artifacts[1]
        .locator
        .ends_with("100.txt:281-288"));
    assert!(fixture.input_boundary.contains("already classified"));
    assert!(fixture.output_boundary.contains("participant/day group"));
    for excluded_claim in [
        "does not classify",
        "does not parse",
        "identity is supplied opaquely",
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
        assert!(!observation.foreground_app_identity.is_empty());
        (
            Group {
                participant_id: observation.participant_id,
                source_day_id: observation.source_day_id,
            },
            observation.foreground_app_identity,
        )
    });
    let actual = count_distinct_members_by_group(observations);
    let expected = fixture
        .expected_observed_groups
        .into_iter()
        .map(|group| GroupedDistinctCount {
            group: Group {
                participant_id: group.participant_id,
                source_day_id: group.source_day_id,
            },
            distinct_member_count: group.distinct_foreground_app_count,
        })
        .collect::<Vec<_>>();

    assert_eq!(actual, expected);
    assert!(!actual
        .iter()
        .any(|count| count.group == fixture.explicitly_absent_group));
}
