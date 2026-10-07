#[path = "../src/call_state_summary.rs"]
#[allow(
    dead_code,
    reason = "this source test exercises overlap durations, not the sibling state-count summary"
)]
mod call_state_summary;

use call_state_summary::{
    summarize_call_overlap_durations, CallDurationSummary, CallDurationSummaryError, CallOverlap,
};
use serde::Deserialize;

const SOURCE_FIXTURE: &str = include_str!("fixtures/call_duration_summary_source.json");

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
    units_per_minute: String,
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
    rows: Vec<FixtureRow>,
    expected: ExpectedSummary,
}

#[derive(Debug, Deserialize)]
struct FixtureRow {
    state: Option<String>,
    overlap: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExpectedSummary {
    incoming_minutes: String,
    total_minutes: String,
    outgoing_minutes: String,
}

fn numeric(value: &str) -> f64 {
    value.parse::<f64>().expect("fixture numeric value")
}

#[test]
fn primitive_matches_released_call_duration_summary_semantics() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("source fixture JSON");

    assert_eq!(
        fixture.schema_version,
        "chronicle-call-duration-summary-source-fixture/v1"
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
    assert!(fixture.source_locator.ends_with("state.py:163-196"));
    assert!(fixture
        .source_test_locator
        .ends_with("test_state.py:24-43,84-101,103-119"));
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
            "method-setting-7a424fa095bbb01fe0436a78",
            "method-setting-4df11f716c5968d5e6f3a76a",
            "method-setting-763c45045b37b0a8a4e1120b",
        ]
    );
    assert_eq!(fixture.limitations.len(), 3);

    let units_per_minute = numeric(&fixture.units_per_minute);
    for case in fixture.cases {
        let rows = case
            .rows
            .iter()
            .map(|row| CallOverlap {
                state: row.state.as_deref(),
                overlap: numeric(&row.overlap),
            })
            .collect::<Vec<_>>();
        let actual = summarize_call_overlap_durations(&rows, units_per_minute)
            .expect("source fixture has a finite positive unit scale");
        assert_summary(&case.case_id, actual, &case.expected);
    }
}

#[test]
fn rejects_nonpositive_or_nonfinite_unit_scales() {
    let rows = [CallOverlap {
        state: Some("incoming"),
        overlap: 60_000.0,
    }];

    for invalid in [0.0, -60_000.0, f64::NAN, f64::INFINITY] {
        assert_eq!(
            summarize_call_overlap_durations(&rows, invalid),
            Err(CallDurationSummaryError::InvalidUnitsPerMinute)
        );
    }
}

fn assert_summary(case_id: &str, actual: CallDurationSummary, expected: &ExpectedSummary) {
    assert_number(
        case_id,
        "incomingMinutes",
        actual.incoming_minutes,
        &expected.incoming_minutes,
    );
    assert_number(
        case_id,
        "totalMinutes",
        actual.total_minutes,
        &expected.total_minutes,
    );
    assert_number(
        case_id,
        "outgoingMinutes",
        actual.outgoing_minutes,
        &expected.outgoing_minutes,
    );
}

fn assert_number(case_id: &str, field: &str, actual: f64, expected: &str) {
    let expected = numeric(expected);
    if expected.is_nan() {
        assert!(actual.is_nan(), "case {case_id}, field {field}");
    } else {
        assert_eq!(actual, expected, "case {case_id}, field {field}");
    }
}
