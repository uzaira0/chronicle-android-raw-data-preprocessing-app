#[path = "../src/ema_screen_session_materialization.rs"]
mod ema_screen_session_materialization;

use ema_screen_session_materialization::{
    materialize_ema_screen_sessions, EmaMaterializedRowKind, EmaScreenSessionConfiguration,
    EmaScreenSessionKind, LabeledScreenStateRow, QuestionnaireWindow,
};
use serde::Deserialize;

const ORACLE: &str = include_str!("fixtures/screen_usage_within_60m_r_oracle.json");
const MINUTE_NS: i64 = 60_000_000_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OracleFixture {
    schema_version: String,
    source_work_id: String,
    source_sha256: OracleSourceDigests,
    execution_boundary: OracleBoundary,
    cases: Vec<OracleCase>,
    runtime: OracleRuntime,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OracleSourceDigests {
    screen_usage_within: String,
    add_time_limits: String,
    occur_helper: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OracleBoundary {
    window_minutes: i64,
    input_stage: String,
    output_stage: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OracleRuntime {
    r_version: String,
    dplyr_version: String,
    lubridate_version: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OracleCase {
    case_id: String,
    questionnaire_id: String,
    start_timestamp_ns: i64,
    end_timestamp_ns: i64,
    input_rows: Vec<OracleInputRow>,
    expected_internal_rows: Vec<OracleInternalRow>,
    expected_sessions: Vec<OracleSession>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OracleInputRow {
    source_row_id: String,
    timestamp_ns: i64,
    questionnaire_id: Option<String>,
    usage_id: Option<i64>,
    nonusage_id: Option<i64>,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct OracleInternalRow {
    source_row_id: Option<String>,
    timestamp_ns: i64,
    usage_id: Option<i64>,
    nonusage_id: Option<i64>,
    row_kind: String,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct OracleSession {
    kind: String,
    session_id: i64,
    start_timestamp_ns: i64,
    end_timestamp_ns: i64,
}

fn row_kind(kind: EmaMaterializedRowKind) -> &'static str {
    match kind {
        EmaMaterializedRowKind::Source => "source",
        EmaMaterializedRowKind::StartBoundary => "start_boundary",
        EmaMaterializedRowKind::EndBoundary => "end_boundary",
        EmaMaterializedRowKind::GhostNonusage => "ghost_nonusage",
    }
}

fn session_kind(kind: EmaScreenSessionKind) -> &'static str {
    match kind {
        EmaScreenSessionKind::Usage => "usage",
        EmaScreenSessionKind::Nonusage => "nonusage",
    }
}

fn configuration() -> EmaScreenSessionConfiguration {
    EmaScreenSessionConfiguration {
        expected_window_duration_ns: 60 * MINUTE_NS,
        ghost_offset_ns: 500_000_000,
        ghost_nonusage_id_offset: 1_000_000,
        minimum_inclusive_mixed_usage_row_count: 2,
    }
}

#[test]
fn all_released_r_branch_cells_match_the_locked_source_oracle() {
    let oracle: OracleFixture = serde_json::from_str(ORACLE).expect("R oracle JSON");
    assert_eq!(
        oracle.schema_version,
        "chronicle-screen-usage-within-source-oracle/v1"
    );
    assert_eq!(oracle.source_work_id, "doi:10.1016/j.chb.2023.107977");
    assert_eq!(
        oracle.source_sha256.screen_usage_within,
        "51b0f06c317c8473a07eb3a11cbc5f29529b9714a58a1b7e0fca92b75522e519"
    );
    assert_eq!(
        oracle.source_sha256.add_time_limits,
        "1c2819cc55e604a644070a732a5227175e38dff3e673be87c0d773940aa94244"
    );
    assert_eq!(
        oracle.source_sha256.occur_helper,
        "61a921f5f8b8e2b0c6c60f24d3ae13de477a340f8967e21e74707daeebba873a"
    );
    assert_eq!(oracle.execution_boundary.window_minutes, 60);
    assert_eq!(
        oracle.execution_boundary.input_stage,
        "post_daytime_filter_post_questionnaire_membership_post_usage_nonusage_ids"
    );
    assert_eq!(
        oracle.execution_boundary.output_stage,
        "pre_summary_usage_nonusage_sessions"
    );
    assert_eq!(oracle.runtime.r_version, "R version 4.1.2 (2021-11-01)");
    assert_eq!(oracle.runtime.dplyr_version, "1.0.8");
    assert_eq!(oracle.runtime.lubridate_version, "1.8.0");
    assert_eq!(
        oracle
            .cases
            .iter()
            .map(|case| case.case_id.as_str())
            .collect::<Vec<_>>(),
        ["all_usage", "all_nonusage", "mixed"]
    );

    for case in oracle.cases {
        let rows = case
            .input_rows
            .into_iter()
            .map(|row| LabeledScreenStateRow {
                source_row_id: row.source_row_id,
                timestamp_ns: row.timestamp_ns,
                questionnaire_id: row.questionnaire_id,
                usage_id: row.usage_id,
                nonusage_id: row.nonusage_id,
            })
            .collect::<Vec<_>>();
        let result = materialize_ema_screen_sessions(
            &rows,
            &QuestionnaireWindow {
                questionnaire_id: case.questionnaire_id,
                start_timestamp_ns: case.start_timestamp_ns,
                end_timestamp_ns: case.end_timestamp_ns,
            },
            configuration(),
        )
        .unwrap_or_else(|error| panic!("{} failed: {error}", case.case_id));
        let actual_rows = result
            .rows
            .into_iter()
            .map(|row| OracleInternalRow {
                source_row_id: row.source_row_id,
                timestamp_ns: row.timestamp_ns,
                usage_id: row.usage_id,
                nonusage_id: row.nonusage_id,
                row_kind: row_kind(row.kind).to_owned(),
            })
            .collect::<Vec<_>>();
        let actual_sessions = result
            .sessions
            .into_iter()
            .map(|session| OracleSession {
                kind: session_kind(session.kind).to_owned(),
                session_id: session.session_id,
                start_timestamp_ns: session.start_timestamp_ns,
                end_timestamp_ns: session.end_timestamp_ns,
            })
            .collect::<Vec<_>>();
        assert_eq!(
            actual_rows, case.expected_internal_rows,
            "{} rows",
            case.case_id
        );
        assert_eq!(
            actual_sessions, case.expected_sessions,
            "{} sessions",
            case.case_id
        );
        if case.case_id == "mixed" {
            assert!(actual_rows.iter().any(|row| {
                row.row_kind == "ghost_nonusage"
                    && row.timestamp_ns == 31_200_500_000_000
                    && row.nonusage_id == Some(1_000_010)
            }));
            assert!(!actual_sessions
                .iter()
                .any(|session| { session.kind == "usage" && session.session_id == 12 }));
        }
    }
}

#[test]
fn non_60_minute_window_and_boundary_collision_fail_closed() {
    let rows = vec![
        LabeledScreenStateRow {
            source_row_id: "before".into(),
            timestamp_ns: -1,
            questionnaire_id: None,
            usage_id: Some(1),
            nonusage_id: None,
        },
        LabeledScreenStateRow {
            source_row_id: "inside".into(),
            timestamp_ns: 1,
            questionnaire_id: Some("q".into()),
            usage_id: Some(1),
            nonusage_id: None,
        },
        LabeledScreenStateRow {
            source_row_id: "after".into(),
            timestamp_ns: 60 * MINUTE_NS + 1,
            questionnaire_id: None,
            usage_id: Some(1),
            nonusage_id: None,
        },
    ];
    let error = materialize_ema_screen_sessions(
        &rows,
        &QuestionnaireWindow {
            questionnaire_id: "q".into(),
            start_timestamp_ns: 0,
            end_timestamp_ns: 15 * MINUTE_NS,
        },
        configuration(),
    )
    .expect_err("15-minute sensitivity variant is outside this bounded operator");
    assert!(error.to_string().contains("unexpected duration"));

    let mut colliding = rows;
    colliding[1].timestamp_ns = 0;
    colliding[1].questionnaire_id = None;
    let error = materialize_ema_screen_sessions(
        &colliding,
        &QuestionnaireWindow {
            questionnaire_id: "q".into(),
            start_timestamp_ns: 0,
            end_timestamp_ns: 60 * MINUTE_NS,
        },
        configuration(),
    )
    .expect_err("a pre-existing boundary row makes released helper indexing ambiguous");
    assert!(error.to_string().contains("collides"));
}
