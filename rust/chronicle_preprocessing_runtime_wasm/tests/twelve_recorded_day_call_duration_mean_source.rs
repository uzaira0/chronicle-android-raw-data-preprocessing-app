#[path = "../src/grouped_column_summary.rs"]
#[allow(
    dead_code,
    reason = "this source test exercises first-seen summaries, not the sibling factor-order transform"
)]
mod grouped_column_summary;

use std::collections::{BTreeMap, BTreeSet};

use grouped_column_summary::{summarize_columns_by_first_seen_group, GroupedNumericRow};
use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/twelve_recorded_day_call_duration_mean_insights.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    exact_canonical_setting: CanonicalSetting,
    source_artifacts: Vec<SourceArtifact>,
    expected_observed_day_count: usize,
    input_unit: String,
    input_boundary: String,
    output_boundary: String,
    rows: Vec<DailyTotal>,
    expected_participant_means: Vec<ExpectedParticipantMean>,
    limitations: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CanonicalSetting {
    setting_id: String,
    parameter_key: String,
    source_observed_setting: String,
    source_value_sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceArtifact {
    locator: String,
    sha256: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DailyTotal {
    participant_id: String,
    source_day_id: String,
    daily_total_call_duration_minutes: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExpectedParticipantMean {
    participant_id: String,
    mean_daily_total_call_duration_minutes: f64,
}

fn validate_typed_daily_totals(
    rows: &[DailyTotal],
    expected_day_count: usize,
) -> Result<Vec<GroupedNumericRow>, &'static str> {
    let mut days_by_participant = BTreeMap::<&str, BTreeSet<&str>>::new();
    let mut grouped_rows = Vec::with_capacity(rows.len());

    for row in rows {
        if row.participant_id.trim().is_empty() {
            return Err("participant_id_required");
        }
        if row.source_day_id.trim().is_empty() {
            return Err("source_day_id_required");
        }
        let value = row
            .daily_total_call_duration_minutes
            .ok_or("daily_total_call_duration_required")?;
        if !value.is_finite() {
            return Err("daily_total_call_duration_must_be_finite");
        }
        if value < 0.0 {
            return Err("daily_total_call_duration_must_be_nonnegative");
        }
        if !days_by_participant
            .entry(&row.participant_id)
            .or_default()
            .insert(&row.source_day_id)
        {
            return Err("duplicate_participant_day");
        }
        grouped_rows.push(GroupedNumericRow {
            group: Some(row.participant_id.clone()),
            values: vec![Some(value)],
        });
    }

    if days_by_participant.is_empty()
        || days_by_participant
            .values()
            .any(|days| days.len() != expected_day_count)
    {
        return Err("exact_observed_day_count_required");
    }

    Ok(grouped_rows)
}

#[test]
fn twelve_caller_selected_recorded_days_reuse_the_grouped_arithmetic_mean_only() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");

    assert_eq!(
        fixture.schema_version,
        "chronicle-twelve-recorded-day-call-duration-mean-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.3390/j2020008");
    assert_eq!(
        (
            fixture.exact_canonical_setting.setting_id.as_str(),
            fixture.exact_canonical_setting.parameter_key.as_str(),
            fixture
                .exact_canonical_setting
                .source_observed_setting
                .as_str(),
            fixture.exact_canonical_setting.source_value_sha256.as_str(),
        ),
        (
            "method-setting-e686bbf41309953e493a1da0",
            "feature.total_call_duration.twelve_day_mean",
            "feature.total_call_duration.twelve_day_mean: Mean daily total incoming plus outgoing call duration in minutes per day over the selected 12 days",
            "9e5642ef49323f5d1671dcde9d83dcff428923d9108f3136db21b25fc2b68424",
        )
    );
    assert_eq!(fixture.source_artifacts.len(), 2);
    assert!(fixture.source_artifacts[0]
        .locator
        .ends_with("smartphone-social-sciences-app-2019/primary.pdf:pages 11-12"));
    assert_eq!(
        fixture.source_artifacts[0].sha256,
        "a075a49da753982cfb7fd790ff50ac56631ab354b4006a0a27dfcf91ba3bb2d9"
    );
    assert!(fixture.source_artifacts[1]
        .locator
        .ends_with("fulltext/rank135.txt:652-676,717-722,777-779"));
    assert_eq!(
        fixture.source_artifacts[1].sha256,
        "b32b63deee97a6a04d658ad197d3e8f498b686c6de579e3e5dc8ef0aca168cdd"
    );
    assert_eq!(fixture.expected_observed_day_count, 12);
    assert_eq!(fixture.input_unit, "minutes");
    assert!(fixture.input_boundary.contains("need not be consecutive"));
    assert!(fixture.output_boundary.contains("arithmetic mean"));
    for excluded_claim in [
        "does not disclose which days were selected",
        "timezone",
        "never synthesizes zero",
        "fail closed as typed-boundary violations",
        "claims only its arithmetic-mean projection",
        "synthetic and method-shaped",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }

    let grouped_rows =
        validate_typed_daily_totals(&fixture.rows, fixture.expected_observed_day_count)
            .expect("fixture meets the typed twelve-day boundary");
    let summaries = summarize_columns_by_first_seen_group(&grouped_rows)
        .expect("the existing grouped arithmetic-mean primitive accepts the typed rows");
    assert_eq!(summaries.len(), fixture.expected_participant_means.len());
    for (summary, expected) in summaries.iter().zip(&fixture.expected_participant_means) {
        assert_eq!(
            summary.group.as_deref(),
            Some(expected.participant_id.as_str())
        );
        assert_eq!(summary.means.len(), 1);
        assert!(
            (summary.means[0] - expected.mean_daily_total_call_duration_minutes).abs()
                <= f64::EPSILON
        );
    }

    let mut eleven_days = fixture.rows.clone();
    eleven_days.pop();
    assert_eq!(
        validate_typed_daily_totals(&eleven_days, 12),
        Err("exact_observed_day_count_required")
    );
    let mut duplicate_day = fixture.rows.clone();
    duplicate_day.push(fixture.rows[0].clone());
    assert_eq!(
        validate_typed_daily_totals(&duplicate_day, 12),
        Err("duplicate_participant_day")
    );

    let typed_row = |value| DailyTotal {
        participant_id: "participant-boundary".to_owned(),
        source_day_id: "caller-selected-day".to_owned(),
        daily_total_call_duration_minutes: value,
    };
    assert_eq!(
        validate_typed_daily_totals(&[typed_row(None)], 1),
        Err("daily_total_call_duration_required")
    );
    assert_eq!(
        validate_typed_daily_totals(&[typed_row(Some(f64::NAN))], 1),
        Err("daily_total_call_duration_must_be_finite")
    );
    assert_eq!(
        validate_typed_daily_totals(&[typed_row(Some(f64::INFINITY))], 1),
        Err("daily_total_call_duration_must_be_finite")
    );
    assert_eq!(
        validate_typed_daily_totals(&[typed_row(Some(-1.0))], 1),
        Err("daily_total_call_duration_must_be_nonnegative")
    );
}
