use chronicle_preprocessing_runtime_wasm::screen_bout_daily_summary::{
    summarize_screen_bouts_by_explicit_day, ObservedScreenDay, PairedScreenBout,
    ScreenBoutDailySummaryConfiguration, ScreenBoutParticipantExclusionReason,
};

const HOUR_NS: i64 = 3_600_000_000_000;

fn days(participant: &str, count: usize) -> Vec<ObservedScreenDay> {
    (1..=count)
        .map(|day| ObservedScreenDay {
            participant_id: participant.into(),
            source_day_id: format!("day-{day:02}"),
        })
        .collect()
}

#[test]
fn strict_boundaries_daily_sum_and_explicit_day_mean_are_exact() {
    let mut observed_days = days("retained", 14);
    observed_days.extend(days("over-ten-hours", 14));
    observed_days.extend(days("thirteen-days", 13));
    let bouts = vec![
        PairedScreenBout {
            bout_id: "exact-ten".into(),
            participant_id: "retained".into(),
            source_day_id: "day-01".into(),
            screen_on_timestamp_ns: 0,
            screen_off_timestamp_ns: 10 * HOUR_NS,
        },
        PairedScreenBout {
            bout_id: "sum-a".into(),
            participant_id: "retained".into(),
            source_day_id: "day-02".into(),
            screen_on_timestamp_ns: 0,
            screen_off_timestamp_ns: 2 * HOUR_NS,
        },
        PairedScreenBout {
            bout_id: "sum-b".into(),
            participant_id: "retained".into(),
            source_day_id: "day-02".into(),
            screen_on_timestamp_ns: 2 * HOUR_NS,
            screen_off_timestamp_ns: 4 * HOUR_NS,
        },
        PairedScreenBout {
            bout_id: "over".into(),
            participant_id: "over-ten-hours".into(),
            source_day_id: "day-01".into(),
            screen_on_timestamp_ns: 0,
            screen_off_timestamp_ns: 10 * HOUR_NS + 1,
        },
        PairedScreenBout {
            bout_id: "short-cohort".into(),
            participant_id: "thirteen-days".into(),
            source_day_id: "day-01".into(),
            screen_on_timestamp_ns: 0,
            screen_off_timestamp_ns: HOUR_NS,
        },
    ];
    let summary = summarize_screen_bouts_by_explicit_day(
        &observed_days,
        &bouts,
        ScreenBoutDailySummaryConfiguration {
            maximum_inclusive_bout_duration_ns: (10 * HOUR_NS) as u64,
            minimum_inclusive_observed_day_count: 14,
        },
    )
    .expect("bounded post-reconstruction summary");

    assert_eq!(summary.retained_participant_means.len(), 1);
    assert_eq!(
        summary.retained_participant_means[0].participant_id,
        "retained"
    );
    assert_eq!(summary.retained_participant_means[0].observed_day_count, 14);
    assert_eq!(
        summary.retained_participant_means[0].total_duration_ns,
        14 * HOUR_NS as u64
    );
    assert_eq!(
        summary.retained_participant_means[0].mean_daily_duration_ns,
        HOUR_NS as f64
    );
    assert_eq!(
        summary
            .retained_daily_durations
            .iter()
            .find(|day| day.source_day_id == "day-02")
            .expect("summed day")
            .duration_ns,
        4 * HOUR_NS as u64
    );
    assert_eq!(summary.retained_daily_durations.len(), 14);
    assert_eq!(summary.excluded_participants.len(), 2);
    assert_eq!(
        summary.excluded_participants[0].reasons,
        [ScreenBoutParticipantExclusionReason::BoutExceedsMaximum]
    );
    assert_eq!(
        summary.excluded_participants[1].reasons,
        [ScreenBoutParticipantExclusionReason::FewerThanMinimumObservedDays]
    );
}

#[test]
fn unregistered_day_and_non_positive_pair_fail_closed() {
    let observed_days = days("p", 14);
    let unregistered = PairedScreenBout {
        bout_id: "unknown-day".into(),
        participant_id: "p".into(),
        source_day_id: "day-15".into(),
        screen_on_timestamp_ns: 0,
        screen_off_timestamp_ns: HOUR_NS,
    };
    let error = summarize_screen_bouts_by_explicit_day(
        &observed_days,
        &[unregistered],
        ScreenBoutDailySummaryConfiguration {
            maximum_inclusive_bout_duration_ns: (10 * HOUR_NS) as u64,
            minimum_inclusive_observed_day_count: 14,
        },
    )
    .expect_err("unregistered day must fail closed");
    assert!(error.to_string().contains("unregistered day"));

    let invalid = PairedScreenBout {
        bout_id: "reversed".into(),
        participant_id: "p".into(),
        source_day_id: "day-01".into(),
        screen_on_timestamp_ns: HOUR_NS,
        screen_off_timestamp_ns: HOUR_NS,
    };
    let error = summarize_screen_bouts_by_explicit_day(
        &observed_days,
        &[invalid],
        ScreenBoutDailySummaryConfiguration {
            maximum_inclusive_bout_duration_ns: (10 * HOUR_NS) as u64,
            minimum_inclusive_observed_day_count: 14,
        },
    )
    .expect_err("non-positive pair must fail closed");
    assert!(error.to_string().contains("does not end after"));
}
