#[path = "../src/bjerre_sparse_panel_support.rs"]
mod bjerre_sparse_panel_support;

use bjerre_sparse_panel_support::{
    filter_bjerre_sparse_panel_support, BjerreSparsePanelRow, BJERRE_SPARSE_PANEL_SUPPORT_THRESHOLD,
};
use serde::Deserialize;

const SOURCE_FIXTURE: &str = include_str!("fixtures/iterative_sparse_group_filter_source.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    source_code_sha256: String,
    source_locator: String,
    source_oracle_receipt: String,
    exact_canonical_setting_ids: Vec<String>,
    caller_threshold: usize,
    input_boundary: String,
    output_boundary: String,
    source_oracle_iteration_trace: Vec<IterationTrace>,
    rows: Vec<FixtureRow>,
    expected_retained_row_ids: Vec<u8>,
    limitations: Vec<String>,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct IterationTrace {
    before: usize,
    after_course: usize,
    after_user: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureRow {
    row_id: u8,
    user_idx: Option<String>,
    course_num_sem: Option<String>,
    study: String,
    payload: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Payload {
    row_id: u8,
    study: String,
    value: String,
}

#[test]
fn existing_owner_matches_the_released_fixed_point_source_oracle() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("source fixture JSON");

    assert_eq!(
        fixture.schema_version,
        "chronicle-iterative-sparse-group-filter-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1177/0956797620956613");
    assert_eq!(
        fixture.source_code_sha256,
        "b2c12ecb356742dd05c23abb9c7ca78013125a87f24bf279c0b38f778e16302c"
    );
    assert!(fixture.source_locator.ends_with("load_data.R:31-57"));
    assert!(fixture
        .source_oracle_receipt
        .ends_with("receipts/execution.json"));
    assert_eq!(
        fixture.exact_canonical_setting_ids,
        ["method-setting-d6ec2c28ae4396099857ded7"]
    );
    assert_eq!(
        fixture.caller_threshold,
        BJERRE_SPARSE_PANEL_SUPPORT_THRESHOLD
    );
    assert!(fixture.input_boundary.contains("course_ind_df"));
    assert!(fixture.output_boundary.contains("filter_sparse_groups(2)"));
    assert_eq!(fixture.limitations.len(), 2);

    // This trace was emitted by the unchanged released R assignment. It proves
    // course pruning precedes participant pruning and that one pass is not
    // enough: the operator must run through the final 12 -> 12 fixed point.
    assert_eq!(
        fixture.source_oracle_iteration_trace,
        [
            IterationTrace {
                before: 16,
                after_course: 16,
                after_user: 15,
            },
            IterationTrace {
                before: 15,
                after_course: 14,
                after_user: 13,
            },
            IterationTrace {
                before: 13,
                after_course: 12,
                after_user: 12,
            },
            IterationTrace {
                before: 12,
                after_course: 12,
                after_user: 12,
            },
        ]
    );

    let rows = fixture
        .rows
        .into_iter()
        .map(|row| BjerreSparsePanelRow {
            user_idx: row.user_idx,
            course_num_sem: row.course_num_sem,
            row: Payload {
                row_id: row.row_id,
                study: row.study,
                value: row.payload,
            },
        })
        .collect();

    let retained = filter_bjerre_sparse_panel_support(rows);
    let retained_ids = retained
        .iter()
        .map(|row| row.row.row_id)
        .collect::<Vec<_>>();

    assert_eq!(retained_ids, fixture.expected_retained_row_ids);
    assert_eq!(retained[1].row.value, "duplicate-1");
    assert_eq!(retained[5].row.study, "S1");
    assert_eq!(retained[11].row.study, "S2");
}
