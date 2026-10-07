#[path = "../src/grouped_distinct_count.rs"]
mod grouped_distinct_count;

use grouped_distinct_count::count_distinct_members_by_group;
use serde::Deserialize;
use serde_json::Value;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/call_contact_distinct_counts_per2309_source.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    canonical_settings_in_source_execution_order: Vec<CanonicalSetting>,
    source_artifacts: Vec<SourceArtifact>,
    source_pipeline_order: Vec<String>,
    input_boundary: String,
    output_boundary: String,
    limitations: Vec<String>,
    cases: Vec<Case>,
    fail_closed_contact_identity_examples: Vec<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CanonicalSetting {
    method_setting_id: String,
    parameter_key: String,
    output_name: String,
    source_value: Value,
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
struct Case {
    case_id: String,
    rows: Vec<SourceRow>,
    expected_counts_in_source_execution_order: Vec<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceRow {
    source_row_index: usize,
    contact_identity: Option<ContactIdentity>,
    call_type: String,
    day_class: DayClass,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Deserialize)]
#[serde(untagged)]
enum ContactIdentity {
    Text(String),
    Integer(i64),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
enum DayClass {
    Weekday,
    Weekend,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum OutputSlot {
    Overall,
    Incoming,
    Outgoing,
    Missed,
    Weekday,
    Weekend,
}

const OUTPUT_SLOTS_IN_SOURCE_EXECUTION_ORDER: [OutputSlot; 6] = [
    OutputSlot::Overall,
    OutputSlot::Incoming,
    OutputSlot::Outgoing,
    OutputSlot::Missed,
    OutputSlot::Weekday,
    OutputSlot::Weekend,
];

fn counts_in_source_execution_order(rows: &[SourceRow]) -> Vec<usize> {
    let mut observations = Vec::new();
    for row in rows {
        let identity = row.contact_identity.clone();
        observations.push((OutputSlot::Overall, identity.clone()));
        match row.call_type.as_str() {
            "incoming" => observations.push((OutputSlot::Incoming, identity.clone())),
            "outgoing" => observations.push((OutputSlot::Outgoing, identity.clone())),
            "missed" => observations.push((OutputSlot::Missed, identity.clone())),
            _ => {}
        }
        observations.push((
            match row.day_class {
                DayClass::Weekday => OutputSlot::Weekday,
                DayClass::Weekend => OutputSlot::Weekend,
            },
            identity,
        ));
    }

    let observed = count_distinct_members_by_group(observations);
    OUTPUT_SLOTS_IN_SOURCE_EXECUTION_ORDER
        .iter()
        .map(|slot| {
            observed
                .iter()
                .find(|count| count.group == *slot)
                .map(|count| count.distinct_member_count)
                .unwrap_or(0)
        })
        .collect()
}

#[test]
fn reuses_grouped_distinct_count_for_the_six_released_call_contact_outputs() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-call-contact-distinct-counts-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1002/per.2309");

    let expected_settings = [
        (
            "method-setting-3b19005f5f32678199cf2d77",
            "feature.stachl_number_of_call_contacts",
            "Stachl_number_of_call_contacts",
            "2356e0ffe1c1830bf9a12d27af75c7a027789a6a949343a3a331752c3d793a72",
        ),
        (
            "method-setting-c12c5da24d254ed6174b3f5c",
            "feature.stachl_number_of_call_contacts_incoming",
            "Stachl_number_of_call_contacts_incoming",
            "6d6ccb6150bc7c78fb24669c5ea11211c5f4d9d9f8fd6503d3f2d3c113b3fef5",
        ),
        (
            "method-setting-2f3f7b71ccbf11cbd2e214bf",
            "feature.stachl_number_of_call_contacts_outgoing",
            "Stachl_number_of_call_contacts_outgoing",
            "7ea98c7b44a8571620c0701f8bae373a21dd5dbe7ffd46f4415f90c29cead4a8",
        ),
        (
            "method-setting-531e05e0b94cbed7f2cdce95",
            "feature.stachl_number_of_call_contacts_missed",
            "Stachl_number_of_call_contacts_missed",
            "c87333bf86da5433b472c6e69e969d8ee51f8e66cbad39e949dcbe98449b3ae6",
        ),
        (
            "method-setting-5efeddccbdfe825e34d7da63",
            "feature.stachl_number_of_call_contacts_weekday",
            "Stachl_number_of_call_contacts_weekday",
            "68ae0cf37656084a1dfb40a84c0fb3386fd4ff05353c197593680c80da3c256c",
        ),
        (
            "method-setting-97063ad355df039b405c0a7a",
            "feature.stachl_number_of_call_contacts_weekend",
            "Stachl_number_of_call_contacts_weekend",
            "dad02f4e4b256f449e79d4b3e18a74dd680e94b51637b011a2106eadd3ceab68",
        ),
    ];
    assert_eq!(
        fixture.canonical_settings_in_source_execution_order.len(),
        6
    );
    for (actual, expected) in fixture
        .canonical_settings_in_source_execution_order
        .iter()
        .zip(expected_settings)
    {
        assert_eq!(
            (
                actual.method_setting_id.as_str(),
                actual.parameter_key.as_str(),
                actual.output_name.as_str(),
                actual.source_value_sha256.as_str(),
            ),
            expected
        );
        assert_eq!(
            actual.source_value["feature"].as_str(),
            Some(actual.output_name.as_str())
        );
        assert_eq!(actual.source_value["source_sensor"].as_str(), Some("calls"));
        assert_eq!(actual.source_value["level"].as_str(), Some("state"));
        assert_eq!(actual.source_value["status"].as_str(), Some("included"));
    }

    let expected_artifacts = [
        (
            "183-1-b3facb592d62.txt",
            "990b3f3289030e18c5ed2abf6b0766af6616787a020f529545f2fb9f4d9c780b",
        ),
        (
            "state.py",
            "74de549e3b9c068339d4a68d94dae623b63e2a8120f06886427ce491a1175532",
        ),
        (
            "test_state.py",
            "8257552c5fa29eb72ede03b884be65e4cb4a091212f477509928a81a5d7907c6",
        ),
        (
            "feature_metadata.csv",
            "145925c5780646c3501487658c2f6b292e3b5541bdac6f673485dc1803d1711e",
        ),
    ];
    assert_eq!(fixture.source_artifacts.len(), expected_artifacts.len());
    for (actual, expected) in fixture.source_artifacts.iter().zip(expected_artifacts) {
        assert!(actual.locator.contains(expected.0));
        assert_eq!(actual.sha256, expected.1);
    }

    assert_eq!(fixture.source_pipeline_order.len(), 7);
    assert!(fixture.source_pipeline_order[0].contains("validate"));
    assert!(fixture.source_pipeline_order[1].contains("data_with_neighbors"));
    assert!(fixture.source_pipeline_order[2].contains("response_of_user_label"));
    assert!(fixture.source_pipeline_order[3].contains("positive-overlap"));
    assert!(fixture.source_pipeline_order[4].contains("incoming, outgoing, and missed"));
    assert!(fixture.source_pipeline_order[5].contains("Zurich-local"));
    assert!(fixture.source_pipeline_order[6].contains("overall, incoming, outgoing, missed"));
    assert!(fixture.input_boundary.contains("already validated"));
    assert!(fixture.input_boundary.contains("interval-selected"));
    assert!(fixture.output_boundary.contains("zero"));
    for required_residue in [
        "does not validate call logs",
        "does not derive Zurich-local",
        "incoming, outgoing, and missed",
        "Repeated null is one",
        "do not reproduce call labeling",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(required_residue)));
    }

    assert_eq!(fixture.cases.len(), 2);
    for case in &fixture.cases {
        assert!(!case.case_id.is_empty());
        for (expected_index, row) in case.rows.iter().enumerate() {
            assert_eq!(row.source_row_index, expected_index + 1);
        }
        assert_eq!(
            counts_in_source_execution_order(&case.rows),
            case.expected_counts_in_source_execution_order,
            "{}",
            case.case_id
        );
    }

    assert_eq!(fixture.fail_closed_contact_identity_examples.len(), 4);
    for value in fixture.fail_closed_contact_identity_examples {
        assert!(serde_json::from_value::<ContactIdentity>(value).is_err());
    }
    assert!(serde_json::from_str::<DayClass>("\"weekday\"").is_ok());
    assert!(serde_json::from_str::<DayClass>("\"weekend\"").is_ok());
    assert!(serde_json::from_str::<DayClass>("\"Weekday\"").is_err());
    assert!(serde_json::from_str::<DayClass>("\"holiday\"").is_err());
}
