#[path = "../src/scoped_quality_exclusion.rs"]
mod scoped_quality_exclusion;
#[path = "../src/screen_bout_daily_summary.rs"]
mod screen_bout_daily_summary;

use scoped_quality_exclusion::{
    evaluate_date_scoped_count_conjunction, exclude_participant_days_over_duration,
    DailyPairedEventCounts, DateEmaScope,
};
use screen_bout_daily_summary::{
    summarize_screen_bouts_by_explicit_day, ObservedScreenDay, PairedScreenBout,
    ScreenBoutDailySummaryConfiguration,
};
use serde::Deserialize;

const FIXTURE: &str = include_str!("fixtures/scoped_quality_exclusion_sources.json");
const HOUR_NS: i64 = 3_600_000_000_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    schema_version: String,
    existing_owner: ExistingOwner,
    participant_day_rule: ParticipantDayRule,
    broken_logging_rule: BrokenLoggingRule,
    limitations: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExistingOwner {
    source_work_id: String,
    method_setting_id: String,
    source_locator: String,
    source_sha256: String,
    operator_id: String,
    fixture_id: String,
    conformance_result_digest: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ParticipantDayRule {
    source_work_id: String,
    method_setting_id: String,
    source_locator: String,
    source_sha256: String,
    maximum_inclusive_duration_ns: u64,
    comparator: String,
    scope: String,
    disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrokenLoggingRule {
    source_work_id: String,
    method_setting_id: String,
    source_locator: String,
    source_sha256: String,
    oracle_runtime: String,
    cases: Vec<BrokenLoggingCase>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrokenLoggingCase {
    case_id: String,
    daily_counts: Vec<DailyCountFixture>,
    date_ema_scopes: Vec<DateEmaScopeFixture>,
    expected_primary_mean: Option<f64>,
    expected_primary_sample_sd: Option<f64>,
    expected_primary_cutoff: Option<f64>,
    expected_secondary_mean: Option<f64>,
    expected_excluded_ema_scope_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DailyCountFixture {
    date: String,
    primary_count: u64,
    secondary_count: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DateEmaScopeFixture {
    date: String,
    ema_scope_id: String,
}

fn fixture() -> Fixture {
    serde_json::from_str(FIXTURE).expect("scoped quality fixture")
}

fn close(actual: f64, expected: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= 1e-12,
        "{label}: {actual} != {expected}"
    );
}

fn close_optional(actual: Option<f64>, expected: Option<f64>, label: &str) {
    match (actual, expected) {
        (Some(actual), Some(expected)) => close(actual, expected, label),
        (None, None) => {}
        _ => panic!("{label}: {actual:?} != {expected:?}"),
    }
}

#[test]
fn existing_single_interval_participant_exclusion_owner_is_source_bound() {
    let fixture = fixture();
    assert_eq!(
        fixture.schema_version,
        "chronicle-scoped-quality-exclusion-source-fixture/v1"
    );
    assert_eq!(
        fixture.existing_owner.source_work_id,
        "doi:10.1016/j.psychres.2023.115298"
    );
    assert_eq!(
        fixture.existing_owner.method_setting_id,
        "method-setting-0e3cf5dcc381e5aba25dc213"
    );
    assert!(fixture.existing_owner.source_locator.ends_with(":227-231"));
    assert_eq!(fixture.existing_owner.source_sha256.len(), 64);
    assert_eq!(
        fixture.existing_owner.operator_id,
        "screen-duration-participant-exclusion-v1"
    );
    assert_eq!(
        fixture.existing_owner.fixture_id,
        "extension.exclude-participant-screen-interval-strict-gt-10h.v1"
    );
    assert_eq!(
        fixture.existing_owner.conformance_result_digest,
        "sha256:deb0765faa4ff7182e0eeb6b8591f95519f4eb5286256a9659087dedb8a49598"
    );
}

#[test]
fn complete_daily_totals_exclude_only_the_over_ten_hour_participant_day() {
    let fixture = fixture();
    let rule = fixture.participant_day_rule;
    assert_eq!(rule.source_work_id, "doi:10.1186/s13104-015-1280-z");
    assert_eq!(
        rule.method_setting_id,
        "method-setting-dd064a91f6fa5b9b002f5984"
    );
    assert!(rule.source_locator.ends_with(":153-165"));
    assert_eq!(rule.source_sha256.len(), 64);
    assert_eq!(rule.comparator, "strict_gt");
    assert_eq!(rule.scope, "participant_day");
    assert_eq!(rule.disposition, "exclude_day");

    let observed_days = [
        ObservedScreenDay {
            participant_id: "P1".into(),
            source_day_id: "equal".into(),
        },
        ObservedScreenDay {
            participant_id: "P1".into(),
            source_day_id: "over".into(),
        },
        ObservedScreenDay {
            participant_id: "P2".into(),
            source_day_id: "control".into(),
        },
    ];
    let bouts = [
        PairedScreenBout {
            bout_id: "equal-a".into(),
            participant_id: "P1".into(),
            source_day_id: "equal".into(),
            screen_on_timestamp_ns: 0,
            screen_off_timestamp_ns: 5 * HOUR_NS,
        },
        PairedScreenBout {
            bout_id: "equal-b".into(),
            participant_id: "P1".into(),
            source_day_id: "equal".into(),
            screen_on_timestamp_ns: 5 * HOUR_NS,
            screen_off_timestamp_ns: 10 * HOUR_NS,
        },
        PairedScreenBout {
            bout_id: "over-a".into(),
            participant_id: "P1".into(),
            source_day_id: "over".into(),
            screen_on_timestamp_ns: 0,
            screen_off_timestamp_ns: 6 * HOUR_NS,
        },
        PairedScreenBout {
            bout_id: "over-b".into(),
            participant_id: "P1".into(),
            source_day_id: "over".into(),
            screen_on_timestamp_ns: 6 * HOUR_NS,
            screen_off_timestamp_ns: 10 * HOUR_NS + 1,
        },
        PairedScreenBout {
            bout_id: "control".into(),
            participant_id: "P2".into(),
            source_day_id: "control".into(),
            screen_on_timestamp_ns: 0,
            screen_off_timestamp_ns: HOUR_NS,
        },
    ];
    let totals = summarize_screen_bouts_by_explicit_day(
        &observed_days,
        &bouts,
        ScreenBoutDailySummaryConfiguration {
            maximum_inclusive_bout_duration_ns: u64::MAX,
            minimum_inclusive_observed_day_count: 1,
        },
    )
    .expect("existing explicit-day aggregation")
    .retained_daily_durations;
    let decisions = exclude_participant_days_over_duration(
        &observed_days,
        &totals,
        rule.maximum_inclusive_duration_ns,
    )
    .expect("complete daily totals");

    assert_eq!(decisions.len(), 3);
    assert!(
        !decisions
            .iter()
            .find(|day| day.source_day_id == "equal")
            .expect("equal day")
            .exclude_day
    );
    assert!(
        decisions
            .iter()
            .find(|day| day.source_day_id == "over")
            .expect("over day")
            .exclude_day
    );
    assert!(
        !decisions
            .iter()
            .find(|day| day.source_day_id == "control")
            .expect("control day")
            .exclude_day
    );
}

#[test]
fn deposited_r_count_conjunction_preserves_both_strict_boundaries_and_ema_scope() {
    let fixture = fixture();
    let rule = fixture.broken_logging_rule;
    assert_eq!(rule.source_work_id, "doi:10.1016/j.chb.2023.107977");
    assert_eq!(
        rule.method_setting_id,
        "method-setting-9c709fc6db3b34ad6ee17557"
    );
    assert!(rule.source_locator.ends_with(":29-41,130-134"));
    assert_eq!(rule.source_sha256.len(), 64);
    assert_eq!(rule.oracle_runtime, "R version 4.1.2 (2021-11-01)");

    for case in rule.cases {
        let counts = case
            .daily_counts
            .into_iter()
            .map(|row| DailyPairedEventCounts {
                date: row.date,
                primary_count: row.primary_count,
                secondary_count: row.secondary_count,
            })
            .collect::<Vec<_>>();
        let scopes = case
            .date_ema_scopes
            .into_iter()
            .map(|scope| DateEmaScope {
                date: scope.date,
                ema_scope_id: scope.ema_scope_id,
            })
            .collect::<Vec<_>>();
        let output = evaluate_date_scoped_count_conjunction(&counts, &scopes)
            .expect("complete R count boundary");
        close_optional(
            output.primary_mean,
            case.expected_primary_mean,
            &format!("{} primary mean", case.case_id),
        );
        close_optional(
            output.primary_sample_sd,
            case.expected_primary_sample_sd,
            &format!("{} primary sample SD", case.case_id),
        );
        close_optional(
            output.primary_cutoff,
            case.expected_primary_cutoff,
            &format!("{} primary cutoff", case.case_id),
        );
        close_optional(
            output.secondary_mean,
            case.expected_secondary_mean,
            &format!("{} secondary mean", case.case_id),
        );
        assert_eq!(
            output
                .excluded_scopes
                .iter()
                .map(|scope| scope.ema_scope_id.clone())
                .collect::<Vec<_>>(),
            case.expected_excluded_ema_scope_ids,
            "{}",
            case.case_id
        );
    }
    assert!(fixture
        .limitations
        .iter()
        .any(|value| value.contains("mean(app_n) missing")));
}

#[test]
fn deposited_r_na_count_edges_select_no_scope() {
    let scopes = [DateEmaScope {
        date: "2020-01-01".into(),
        ema_scope_id: "ema-1".into(),
    }];
    let one_date = evaluate_date_scoped_count_conjunction(
        &[DailyPairedEventCounts {
            date: "2020-01-01".into(),
            primary_count: 7,
            secondary_count: Some(12),
        }],
        &scopes,
    )
    .expect("R defines the one-date edge");
    assert_eq!(one_date.primary_mean, Some(7.0));
    assert_eq!(one_date.primary_sample_sd, None);
    assert_eq!(one_date.primary_cutoff, None);
    assert!(one_date.excluded_scopes.is_empty());

    let missing_app = evaluate_date_scoped_count_conjunction(
        &[
            DailyPairedEventCounts {
                date: "2020-01-01".into(),
                primary_count: 7,
                secondary_count: None,
            },
            DailyPairedEventCounts {
                date: "2020-01-02".into(),
                primary_count: 9,
                secondary_count: Some(10),
            },
        ],
        &scopes,
    )
    .expect("R defines the missing left-join edge");
    assert_eq!(missing_app.secondary_mean, None);
    assert!(missing_app.excluded_scopes.is_empty());

    assert!(exclude_participant_days_over_duration(&[], &[], 10 * HOUR_NS as u64).is_err());

    let observed = [ObservedScreenDay {
        participant_id: "P1".into(),
        source_day_id: "missing-total".into(),
    }];
    assert!(exclude_participant_days_over_duration(&observed, &[], 10 * HOUR_NS as u64).is_err());
}
