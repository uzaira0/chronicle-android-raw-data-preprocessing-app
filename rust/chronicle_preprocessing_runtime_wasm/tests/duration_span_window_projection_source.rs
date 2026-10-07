#[path = "../src/duration_span_window_projection.rs"]
mod duration_span_window_projection;

use duration_span_window_projection::{
    project_duration_spans_to_window, DurationSpan, WindowProjectedSpan,
};
use serde::Deserialize;

const SOURCE_FIXTURE: &str = include_str!("fixtures/duration_span_window_projection_source.json");

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
    window_start: String,
    window_end: String,
    rows: Vec<FixtureRow>,
    expected: Vec<ExpectedRow>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureRow {
    row_id: String,
    start: String,
    duration: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExpectedRow {
    row_id: String,
    overlap: String,
}

fn numeric(value: &str) -> f64 {
    value.parse::<f64>().expect("fixture numeric value")
}

#[test]
fn primitive_matches_released_clipping_and_retention_semantics() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("source fixture JSON");

    assert_eq!(
        fixture.schema_version,
        "chronicle-duration-span-window-projection-source-fixture/v1"
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
    assert!(fixture.source_locator.ends_with("state.py:145-159"));
    assert!(fixture
        .source_test_locator
        .ends_with("test_state.py:83-101"));
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
        ["method-setting-41cd423bea34eb27d528548b"]
    );
    assert_eq!(fixture.limitations.len(), 3);

    for case in fixture.cases {
        let rows = case
            .rows
            .into_iter()
            .map(|row| DurationSpan {
                start: numeric(&row.start),
                duration: numeric(&row.duration),
                payload: row.row_id,
            })
            .collect();

        let actual = project_duration_spans_to_window(
            rows,
            numeric(&case.window_start),
            numeric(&case.window_end),
        );
        assert_projection(&case.case_id, &actual, &case.expected);
    }
}

fn assert_projection(
    case_id: &str,
    actual: &[WindowProjectedSpan<String>],
    expected: &[ExpectedRow],
) {
    assert_eq!(actual.len(), expected.len(), "case {case_id}");
    for (actual, expected) in actual.iter().zip(expected) {
        assert_eq!(actual.payload, expected.row_id, "case {case_id}");
        assert_eq!(actual.overlap, numeric(&expected.overlap), "case {case_id}");
    }
}
