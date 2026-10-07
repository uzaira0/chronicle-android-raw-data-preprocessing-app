use chronicle_preprocessing_runtime_wasm::categorical_threshold_bucketizer::OrderedThresholdBucketizer;
use chronicle_preprocessing_runtime_wasm::fixed_grid_categorical_dwell::{
    materialize_complete_fixed_grid_category_dwell, FixedGridAnchor, FixedGridDwellConfiguration,
    FixedGridDwellError, FixedGridScalarObservation, FixedGridWindowProgression,
    IncompleteWindowPolicy,
};
use serde::Deserialize;
use std::time::Duration;

const FIXTURE_JSON: &str = include_str!("fixtures/fixed_grid_categorical_dwell.json");
const NANOS_PER_SECOND: i64 = 1_000_000_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DwellFixture {
    schema_version: String,
    source_work_id: String,
    source_locators: Vec<String>,
    sampling_cadence_seconds: f64,
    window_minutes: Vec<u64>,
    complete_window_count: usize,
    source_policy_status: SourcePolicyStatus,
    bounded_fixture_policy: BoundedFixturePolicy,
    threshold_configurations: Vec<ThresholdConfiguration>,
    expected_category_shares: Vec<f64>,
    rejected_progression: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourcePolicyStatus {
    progression: String,
    grid_anchor: String,
    incomplete_window: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BoundedFixturePolicy {
    anchor_timestamp_ns: i64,
    incomplete_window: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ThresholdConfiguration {
    configuration_id: String,
    thresholds: Vec<f64>,
    categories: Vec<String>,
    repeating_observations: Vec<f64>,
}

fn configuration(
    cadence: Duration,
    window: Duration,
    anchor: FixedGridAnchor,
    progression: FixedGridWindowProgression,
    incomplete_window_policy: IncompleteWindowPolicy,
) -> FixedGridDwellConfiguration {
    FixedGridDwellConfiguration {
        sampling_cadence: cadence,
        window_duration: window,
        progression,
        anchor,
        incomplete_window_policy,
    }
}

fn observations(
    count: usize,
    cadence_ns: i64,
    anchor_ns: i64,
    repeating_values: &[f64],
) -> Vec<FixedGridScalarObservation> {
    (0..count)
        .map(|sample_index| FixedGridScalarObservation {
            timestamp_ns: anchor_ns + sample_index as i64 * cadence_ns,
            value: repeating_values[sample_index % repeating_values.len()],
        })
        .collect()
}

#[test]
fn complete_fixture_aligned_windows_accumulate_exact_categorical_dwell() {
    let fixture: DwellFixture = serde_json::from_str(FIXTURE_JSON).expect("valid fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-fixed-grid-categorical-dwell-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1016/j.jbi.2019.103151");
    assert_eq!(fixture.source_locators.len(), 3);
    assert_eq!(fixture.source_policy_status.progression, "non_overlapping");
    assert!(fixture
        .source_policy_status
        .grid_anchor
        .contains("undisclosed"));
    assert_eq!(
        fixture.source_policy_status.incomplete_window,
        "undisclosed"
    );
    assert_eq!(fixture.bounded_fixture_policy.incomplete_window, "reject");
    assert_eq!(fixture.expected_category_shares, [0.25, 0.5, 0.25]);

    let cadence = Duration::from_secs_f64(fixture.sampling_cadence_seconds);
    let cadence_ns = i64::try_from(cadence.as_nanos()).expect("fixture cadence fits i64");
    for threshold_configuration in &fixture.threshold_configurations {
        assert!(!threshold_configuration.configuration_id.is_empty());
        let bucketizer = OrderedThresholdBucketizer::new(
            threshold_configuration.thresholds.clone(),
            threshold_configuration.categories.clone(),
        )
        .expect("valid threshold fixture");
        for &window_minutes in &fixture.window_minutes {
            let window = Duration::from_secs(window_minutes * 60);
            let samples_per_window = usize::try_from(window.as_nanos() / cadence.as_nanos())
                .expect("fixture sample count fits usize");
            let sample_count = samples_per_window * fixture.complete_window_count;
            let observations = observations(
                sample_count,
                cadence_ns,
                fixture.bounded_fixture_policy.anchor_timestamp_ns,
                &threshold_configuration.repeating_observations,
            );
            let windows = materialize_complete_fixed_grid_category_dwell(
                &observations,
                &bucketizer,
                configuration(
                    cadence,
                    window,
                    FixedGridAnchor::ExplicitTimestampNs(
                        fixture.bounded_fixture_policy.anchor_timestamp_ns,
                    ),
                    FixedGridWindowProgression::NonOverlapping,
                    IncompleteWindowPolicy::Reject,
                ),
            )
            .expect("complete fixture-aligned window must execute");

            assert_eq!(windows.len(), fixture.complete_window_count);
            for (window_index, emitted) in windows.iter().enumerate() {
                assert_eq!(emitted.window_index, window_index);
                assert_eq!(
                    emitted.start_timestamp_ns,
                    i64::try_from(window.as_nanos()).expect("window fits i64")
                        * window_index as i64
                );
                assert_eq!(
                    emitted.end_timestamp_ns,
                    i64::try_from(window.as_nanos()).expect("window fits i64")
                        * (window_index as i64 + 1)
                );
                for (category_index, category) in
                    threshold_configuration.categories.iter().enumerate()
                {
                    let expected_ns = (window_minutes * 60 * NANOS_PER_SECOND as u64)
                        * [1_u64, 2, 1][category_index]
                        / 4;
                    assert_eq!(emitted.category_dwell_ns[category], expected_ns);
                }
                assert_eq!(
                    emitted.category_dwell_ns.values().sum::<u64>(),
                    u64::try_from(window.as_nanos()).expect("window fits u64")
                );
            }
        }
    }
}

#[test]
fn sliding_undisclosed_partial_and_off_cadence_inputs_fail_closed() {
    let fixture: DwellFixture = serde_json::from_str(FIXTURE_JSON).expect("valid fixture");
    assert_eq!(fixture.rejected_progression, "sliding");
    let cadence = Duration::from_secs_f64(fixture.sampling_cadence_seconds);
    let cadence_ns = i64::try_from(cadence.as_nanos()).expect("fixture cadence fits i64");
    let window = Duration::from_secs(fixture.window_minutes[0] * 60);
    let sample_count = usize::try_from(window.as_nanos() / cadence.as_nanos())
        .expect("fixture sample count fits usize");
    let threshold_configuration = &fixture.threshold_configurations[0];
    let bucketizer = OrderedThresholdBucketizer::new(
        threshold_configuration.thresholds.clone(),
        threshold_configuration.categories.clone(),
    )
    .expect("valid threshold fixture");
    let mut complete = observations(
        sample_count,
        cadence_ns,
        fixture.bounded_fixture_policy.anchor_timestamp_ns,
        &threshold_configuration.repeating_observations,
    );

    assert_eq!(
        materialize_complete_fixed_grid_category_dwell(
            &complete,
            &bucketizer,
            configuration(
                cadence,
                window,
                FixedGridAnchor::ExplicitTimestampNs(0),
                FixedGridWindowProgression::Sliding,
                IncompleteWindowPolicy::Reject,
            ),
        ),
        Err(FixedGridDwellError::SlidingWindowUnsupported)
    );
    assert_eq!(
        materialize_complete_fixed_grid_category_dwell(
            &complete,
            &bucketizer,
            configuration(
                cadence,
                window,
                FixedGridAnchor::Undisclosed,
                FixedGridWindowProgression::NonOverlapping,
                IncompleteWindowPolicy::Reject,
            ),
        ),
        Err(FixedGridDwellError::GridAnchorUndisclosed)
    );
    assert_eq!(
        materialize_complete_fixed_grid_category_dwell(
            &complete,
            &bucketizer,
            configuration(
                cadence,
                window,
                FixedGridAnchor::ExplicitTimestampNs(0),
                FixedGridWindowProgression::NonOverlapping,
                IncompleteWindowPolicy::Undisclosed,
            ),
        ),
        Err(FixedGridDwellError::IncompleteWindowPolicyUndisclosed)
    );

    let removed = complete.pop().expect("fixture is non-empty");
    assert_eq!(
        materialize_complete_fixed_grid_category_dwell(
            &complete,
            &bucketizer,
            configuration(
                cadence,
                window,
                FixedGridAnchor::ExplicitTimestampNs(0),
                FixedGridWindowProgression::NonOverlapping,
                IncompleteWindowPolicy::Reject,
            ),
        ),
        Err(FixedGridDwellError::IncompleteWindow {
            sample_count: sample_count - 1,
            samples_per_window: sample_count,
        })
    );

    complete.push(removed);
    complete[1].timestamp_ns += 1;
    assert_eq!(
        materialize_complete_fixed_grid_category_dwell(
            &complete,
            &bucketizer,
            configuration(
                cadence,
                window,
                FixedGridAnchor::ExplicitTimestampNs(0),
                FixedGridWindowProgression::NonOverlapping,
                IncompleteWindowPolicy::Reject,
            ),
        ),
        Err(FixedGridDwellError::ObservationOffCadence {
            sample_index: 1,
            expected_timestamp_ns: cadence_ns,
            observed_timestamp_ns: cadence_ns + 1,
        })
    );
}
