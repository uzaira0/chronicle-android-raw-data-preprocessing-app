#[path = "../src/grouped_category_count.rs"]
mod grouped_category_count;

use grouped_category_count::{count_categories_by_group, GroupedCategoryCount};
use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/daily_categorical_counts_opoku_asare_2021.json");

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
    streams: Vec<CountStream>,
    explicitly_absent_count: AbsentCount,
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
struct CountStream {
    stream_id: String,
    observations: Vec<Observation>,
    expected_counts: Vec<ExpectedCount>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Observation {
    participant_id: String,
    source_day_id: String,
    category: String,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct Group {
    participant_id: String,
    source_day_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExpectedCount {
    participant_id: String,
    source_day_id: String,
    category: String,
    count: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AbsentCount {
    participant_id: String,
    source_day_id: String,
    category: String,
}

#[test]
fn counts_every_supplied_state_or_use_instance_within_its_participant_day() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-daily-categorical-counts-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.2196/26540");
    let expected_settings = [
        (
            "method-setting-50478a371ba022b67e2e5dc6",
            "output.screen_onCount",
            "count of instances where screen was on",
            "5909f3f8a1af01924c7c905a65a31389c839a53dbc08b60a48a460a36ee9a3bd",
        ),
        (
            "method-setting-66cceba329f0393e7d73f395",
            "output.screen_offCount",
            "count of instances where screen was off",
            "36bb6cde3e5c288948eefc063df44dea6601a89cb3a9f789c8d882238b7ad8c0",
        ),
        (
            "method-setting-473c8f4c5145e4c2332cc28a",
            "output.internet_connectedCount",
            "count of connected instances",
            "251ec271f9cfc59f11f47c86d4b17f5f677764876b7e2f3c83bdb6d0a26951b3",
        ),
        (
            "method-setting-c2e09f6fb72e82a070824d46",
            "output.internet_disconnectedCount",
            "count of disconnected instances",
            "4cfb7b9ba29e4037fc475fb124bdd8643d4152a47b747e4f04d644625a13e743",
        ),
        (
            "method-setting-780c2f0eb3dd7067b0774dfe",
            "output.app_count",
            "count of foreground applications used",
            "11e0b158e4f3dea4912e7b6b84b6a8bcde4ad4a297e31d982863d87b4b2ee7f2",
        ),
    ];
    assert_eq!(fixture.exact_canonical_settings.len(), 5);
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
    assert_eq!(fixture.source_artifacts.len(), 2);
    assert!(fixture.source_artifacts[0]
        .locator
        .contains("100-app1.pdf:pages 1-2"));
    assert_eq!(
        fixture.source_artifacts[0].sha256,
        "b122f1467e8c44107223201cd1b5a349f3ca198c8f30ce06800ab0052d8f4275"
    );
    assert!(fixture.source_artifacts[1]
        .locator
        .ends_with("100.txt:281-288"));
    assert_eq!(
        fixture.source_artifacts[1].sha256,
        "a4683ab2ede60c1fb9ebae8c57bd55fdb71cae47ee1a1ade10318ab943f1ad69"
    );
    assert!(fixture.input_boundary.contains("Already-classified"));
    assert!(fixture.output_boundary.contains("participant"));
    for excluded_claim in [
        "does not classify",
        "does not parse",
        "count repeatedly",
        "not synthesized or zero-filled",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }

    let mut all_actual = Vec::new();
    for stream in fixture.streams {
        assert!(matches!(
            stream.stream_id.as_str(),
            "screen" | "internet" | "foreground_app_use"
        ));
        let observations = stream.observations.into_iter().map(|observation| {
            assert!(!observation.participant_id.is_empty());
            assert!(!observation.source_day_id.is_empty());
            assert!(!observation.category.is_empty());
            (
                Group {
                    participant_id: observation.participant_id,
                    source_day_id: observation.source_day_id,
                },
                observation.category,
            )
        });
        let actual = count_categories_by_group(observations);
        let expected = stream
            .expected_counts
            .into_iter()
            .map(|count| GroupedCategoryCount {
                group: Group {
                    participant_id: count.participant_id,
                    source_day_id: count.source_day_id,
                },
                category: count.category,
                observation_count: count.count,
            })
            .collect::<Vec<_>>();
        assert_eq!(actual, expected, "{}", stream.stream_id);
        all_actual.extend(actual);
    }

    let absent = fixture.explicitly_absent_count;
    assert!(!all_actual.iter().any(|count| {
        count.group.participant_id == absent.participant_id
            && count.group.source_day_id == absent.source_day_id
            && count.category == absent.category
    }));
}
