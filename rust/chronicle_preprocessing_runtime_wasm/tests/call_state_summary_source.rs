#[path = "../src/call_state_summary.rs"]
#[allow(
    dead_code,
    reason = "this source test exercises state counts, not the sibling overlap-duration summary"
)]
mod call_state_summary;

use call_state_summary::{summarize_call_states, CallStateSummary};
use serde::Deserialize;

const SOURCE_FIXTURE: &str = include_str!("fixtures/call_state_summary_source.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    source_code_sha256: String,
    source_test_sha256: String,
    source_locator: String,
    source_test_locator: String,
    source_runtime: SourceRuntime,
    exact_canonical_setting_ids: Vec<String>,
    cases: Vec<FixtureCase>,
    limitations: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourceRuntime {
    container_image: String,
    container_image_id: String,
    python: String,
    numpy: String,
    pandas: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureCase {
    case_id: String,
    states: Vec<Option<String>>,
    expected: ExpectedSummary,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExpectedSummary {
    incoming_count: usize,
    outgoing_count: usize,
    total_count: usize,
    missed_count: usize,
    incoming_response_rate: String,
}

#[test]
fn primitive_matches_released_call_state_summary_semantics() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("source fixture JSON");

    assert_eq!(
        fixture.schema_version,
        "chronicle-call-state-summary-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1002/per.2309");
    assert_eq!(
        fixture.source_code_sha256,
        "74de549e3b9c068339d4a68d94dae623b63e2a8120f06886427ce491a1175532"
    );
    assert_eq!(
        fixture.source_test_sha256,
        "8257552c5fa29eb72ede03b884be65e4cb4a091212f477509928a81a5d7907c6"
    );
    assert!(fixture.source_locator.ends_with("state.py:161-205"));
    assert!(fixture
        .source_test_locator
        .ends_with("test_state.py:20-49,104-125"));
    assert_eq!(
        fixture.source_runtime.container_image,
        "chronicle/rueegger-per2309:python3.7.1"
    );
    assert_eq!(
        fixture.source_runtime.container_image_id,
        "sha256:1ef375425fbba3b0f47c7c07838c12c78d94bea31e06307ed3cfa7834b80f58d"
    );
    assert_eq!(fixture.source_runtime.python, "3.7.1");
    assert_eq!(fixture.source_runtime.numpy, "1.16.2");
    assert_eq!(fixture.source_runtime.pandas, "1.0.5");
    assert_eq!(
        fixture.exact_canonical_setting_ids,
        [
            "method-setting-4076eae725c960ecbe100733",
            "method-setting-2a03e83df7b172a01f2f79ac",
            "method-setting-fab7ec8a3c91721486072c70",
            "method-setting-c4e83c85eeecb32c9bb15808",
            "method-setting-f037a13808ebed4bdf17177c",
        ]
    );
    assert_eq!(fixture.limitations.len(), 3);

    for case in fixture.cases {
        let states = case
            .states
            .iter()
            .map(|state| state.as_deref())
            .collect::<Vec<_>>();
        let actual = summarize_call_states(&states);
        assert_summary(&case.case_id, actual, &case.expected);
    }
}

fn assert_summary(case_id: &str, actual: CallStateSummary, expected: &ExpectedSummary) {
    assert_eq!(
        actual.incoming_count, expected.incoming_count,
        "case {case_id}"
    );
    assert_eq!(
        actual.outgoing_count, expected.outgoing_count,
        "case {case_id}"
    );
    assert_eq!(actual.total_count, expected.total_count, "case {case_id}");
    assert_eq!(actual.missed_count, expected.missed_count, "case {case_id}");
    if expected.incoming_response_rate == "NaN" {
        assert!(actual.incoming_response_rate.is_nan(), "case {case_id}");
    } else {
        let expected_rate = expected
            .incoming_response_rate
            .parse::<f64>()
            .expect("finite expected response rate");
        assert_eq!(
            actual.incoming_response_rate, expected_rate,
            "case {case_id}"
        );
    }
}
