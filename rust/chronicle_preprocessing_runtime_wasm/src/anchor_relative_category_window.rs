//! Strict-open anchor-relative category-minute aggregation.
//!
//! Categories are caller data; this operator never classifies a package or
//! invents one.

use std::collections::{BTreeMap, BTreeSet};

const NANOS_PER_SECOND: i64 = 1_000_000_000;

#[derive(Debug, Clone, PartialEq)]
pub struct CategorizedDurationInterval {
    /// Source `recorded_naive`, already normalized to integer nanoseconds.
    pub start_ns: i64,
    /// Source `duration`; the released code interprets it as seconds and
    /// truncates it toward zero before constructing the episode end.
    pub duration_seconds: f64,
    /// Already-joined source category. Taxonomy construction and the missing
    /// package-to-`unknown` merge are upstream of this bounded operator.
    pub category: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnchorWindowDirection {
    Before,
    After,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AnchorRelativeCategoryMinutes {
    pub anchor_index: usize,
    pub anchor_time_ns: i64,
    pub direction: AnchorWindowDirection,
    pub window_minutes: u16,
    /// Dynamic source column names such as `social media_min`.
    pub category_minutes: BTreeMap<String, f64>,
    pub app_usage_min: f64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AnchorRelativeCategoryWindowError {
    NonFiniteDuration { episode_index: usize },
    TimestampOverflow,
    NoSelectedSecondsForWindow { window_minutes: u16 },
}

/// Emit configured windows for one participant and direction, preserving the
/// caller-provided anchor order.
///
/// Durations are truncated toward zero before one-second expansion over
/// `[start, end)`. Both selection endpoints are open. A caller can skip the
/// final anchor's computation while retaining the source's timestamp right
/// join: unmatched anchors are zero-filled, but duplicate timestamps can recover
/// computed features and multiply rows.
/// With an occupied-hour threshold, invalid days retain their anchors and
/// encode missing feature cells as NaN (serialized as the source's `NaN` text).
pub fn materialize_strict_open_anchor_category_minutes(
    intervals: &[CategorizedDurationInterval],
    anchor_times_ns: &[i64],
    window_minutes: &[u16],
    direction: AnchorWindowDirection,
    skip_final_anchor: bool,
    missing_hour_threshold: Option<u8>,
) -> Result<Vec<AnchorRelativeCategoryMinutes>, AnchorRelativeCategoryWindowError> {
    let mut expanded_seconds = Vec::<(i64, &str)>::new();
    for (episode_index, interval) in intervals.iter().enumerate() {
        if !interval.duration_seconds.is_finite() {
            return Err(AnchorRelativeCategoryWindowError::NonFiniteDuration { episode_index });
        }
        let duration_seconds = interval.duration_seconds.trunc() as i64;
        for offset_seconds in 0..duration_seconds {
            let offset_ns = offset_seconds
                .checked_mul(NANOS_PER_SECOND)
                .ok_or(AnchorRelativeCategoryWindowError::TimestampOverflow)?;
            let timestamp_ns = interval
                .start_ns
                .checked_add(offset_ns)
                .ok_or(AnchorRelativeCategoryWindowError::TimestampOverflow)?;
            expanded_seconds.push((timestamp_ns, interval.category.as_str()));
        }
    }

    let valid_days = missing_hour_threshold.map(|threshold| {
        let mut occupied_hours = BTreeMap::<i64, BTreeSet<i64>>::new();
        for (timestamp_ns, _) in &expanded_seconds {
            let hour = timestamp_ns.div_euclid(3_600 * NANOS_PER_SECOND);
            occupied_hours
                .entry(hour.div_euclid(24))
                .or_default()
                .insert(hour.rem_euclid(24));
        }
        let first_day = occupied_hours.keys().next().copied();
        occupied_hours
            .into_iter()
            .filter_map(|(day, hours)| {
                let hours = hours.into_iter().collect::<Vec<_>>();
                let threshold = i64::from(threshold);
                // Match_ESM_App.py:119-138, 274-293: only the first occupied
                // row's leading gap is suppressed. Writing at shape[0] creates
                // a new row; it does not suppress the actual last trailing gap.
                let leading_valid = Some(day) == first_day || hours[0] <= threshold;
                let trailing_valid = 24 - hours[hours.len() - 1] <= threshold;
                let interior_valid = hours.windows(2).all(|pair| pair[1] - pair[0] <= threshold);
                (leading_valid && trailing_valid && interior_valid).then_some(day)
            })
            .collect::<BTreeSet<_>>()
    });

    let processed_anchor_count = anchor_times_ns.len().saturating_sub(usize::from(
        skip_final_anchor && !anchor_times_ns.is_empty(),
    ));
    let mut counts_by_window = Vec::with_capacity(window_minutes.len());
    let mut emitted_categories = BTreeSet::<String>::new();

    for &window_minutes in window_minutes {
        let window_ns = i64::from(window_minutes)
            .checked_mul(60)
            .and_then(|seconds| seconds.checked_mul(NANOS_PER_SECOND))
            .ok_or(AnchorRelativeCategoryWindowError::TimestampOverflow)?;
        let mut counts_by_anchor = vec![BTreeMap::<String, u64>::new(); anchor_times_ns.len()];

        for (anchor_index, anchor_time_ns) in anchor_times_ns
            .iter()
            .copied()
            .take(processed_anchor_count)
            .enumerate()
        {
            let lower = anchor_time_ns
                .checked_sub(window_ns)
                .ok_or(AnchorRelativeCategoryWindowError::TimestampOverflow)?;
            let upper = anchor_time_ns
                .checked_add(window_ns)
                .ok_or(AnchorRelativeCategoryWindowError::TimestampOverflow)?;
            for (timestamp_ns, category) in &expanded_seconds {
                let selected = match direction {
                    AnchorWindowDirection::Before => {
                        *timestamp_ns > lower && *timestamp_ns < anchor_time_ns
                    }
                    AnchorWindowDirection::After => {
                        *timestamp_ns > anchor_time_ns && *timestamp_ns < upper
                    }
                };
                if selected {
                    *counts_by_anchor[anchor_index]
                        .entry((*category).to_owned())
                        .or_default() += 1;
                }
            }
            emitted_categories.extend(counts_by_anchor[anchor_index].keys().cloned());
        }

        // The released pd.concat([]) fails before its right join when an
        // entire rule has no selected app second.
        if counts_by_anchor
            .iter()
            .take(processed_anchor_count)
            .all(BTreeMap::is_empty)
        {
            return Err(
                AnchorRelativeCategoryWindowError::NoSelectedSecondsForWindow { window_minutes },
            );
        }
        counts_by_window.push((window_minutes, counts_by_anchor));
    }

    let mut output = Vec::with_capacity(anchor_times_ns.len() * window_minutes.len());
    for (window_minutes, counts_by_anchor) in counts_by_window {
        let window_categories = counts_by_anchor
            .iter()
            .flat_map(|counts| counts.keys())
            .collect::<BTreeSet<_>>();
        for (anchor_index, anchor_time_ns) in anchor_times_ns.iter().copied().enumerate() {
            // The released right merge is on Date, not row index. Duplicate
            // dates multiply matching computed rows, including a skipped final
            // anchor whose timestamp occurred earlier.
            let matching_indices = anchor_times_ns
                .iter()
                .enumerate()
                .take(processed_anchor_count)
                .filter(|(index, time)| {
                    **time == anchor_time_ns && !counts_by_anchor[*index].is_empty()
                })
                .map(|(index, _)| index)
                .collect::<Vec<_>>();
            let counts =
                &counts_by_anchor[matching_indices.first().copied().unwrap_or(anchor_index)];
            let missing_day = valid_days.as_ref().is_some_and(|days| {
                !days.contains(&anchor_time_ns.div_euclid(86_400 * NANOS_PER_SECOND))
            });
            let category_minutes = emitted_categories
                .iter()
                .map(|category| {
                    (
                        format!("{category}_min"),
                        // The source masks before concatenating windows:
                        // columns introduced only by another window stay zero.
                        if missing_day && window_categories.contains(category) {
                            f64::NAN
                        } else {
                            counts.get(category).copied().unwrap_or_default() as f64 / 60.0
                        },
                    )
                })
                .collect::<BTreeMap<_, _>>();
            let app_usage_min = category_minutes.values().copied().sum();
            for _ in 0..matching_indices.len().max(1) {
                output.push(AnchorRelativeCategoryMinutes {
                    anchor_index,
                    anchor_time_ns,
                    direction,
                    window_minutes,
                    category_minutes: category_minutes.clone(),
                    app_usage_min,
                });
            }
        }
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::{
        materialize_strict_open_anchor_category_minutes, AnchorRelativeCategoryMinutes,
        AnchorRelativeCategoryWindowError, AnchorWindowDirection, CategorizedDurationInterval,
    };

    fn ns(seconds: i64) -> i64 {
        seconds * 1_000_000_000
    }

    fn episode(
        start_seconds: i64,
        duration_seconds: f64,
        category: &str,
    ) -> CategorizedDurationInterval {
        CategorizedDurationInterval {
            start_ns: ns(start_seconds),
            duration_seconds,
            category: category.to_owned(),
        }
    }

    fn assert_close(actual: f64, expected: f64) {
        assert!((actual - expected).abs() <= 1e-12, "{actual} != {expected}");
    }

    fn assert_categories(row: &AnchorRelativeCategoryMinutes, expected: &[(&str, f64)]) {
        assert_eq!(
            row.category_minutes
                .keys()
                .map(String::as_str)
                .collect::<Vec<_>>(),
            expected
                .iter()
                .map(|(category, _)| *category)
                .collect::<Vec<_>>()
        );
        for (category, minutes) in expected {
            assert_close(row.category_minutes[*category], *minutes);
        }
    }

    #[test]
    fn occupied_hour_mask_matches_unchanged_released_python() {
        use sha2::{Digest, Sha256};
        let input_json = include_str!("../tests/fixtures/anchor_category_hour_gap_cases.json");
        let inputs: serde_json::Value = serde_json::from_str(input_json).unwrap();
        let expected: serde_json::Value = serde_json::from_str(include_str!(
            "../tests/fixtures/anchor_category_hour_gap_expected.json"
        ))
        .unwrap();
        assert_eq!(
            expected["fixture_sha256"],
            hex::encode(Sha256::digest(input_json.as_bytes()))
        );
        assert_eq!(
            expected["results"].as_array().unwrap().len(),
            inputs["cases"].as_array().unwrap().len()
                * inputs["threshold_hours"].as_array().unwrap().len()
                * 2
        );
        let windows = inputs["windows_minutes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|value| value.as_u64().unwrap() as u16)
            .collect::<Vec<_>>();
        for run in expected["results"].as_array().unwrap() {
            let case = inputs["cases"]
                .as_array()
                .unwrap()
                .iter()
                .find(|case| case["id"] == run["case"])
                .unwrap();
            let intervals = case["intervals"]
                .as_array()
                .unwrap()
                .iter()
                .map(|row| {
                    episode(
                        row["start_seconds"].as_i64().unwrap(),
                        row["duration_seconds"].as_f64().unwrap(),
                        row["category"].as_str().unwrap(),
                    )
                })
                .collect::<Vec<_>>();
            let anchors = case["anchors_seconds"]
                .as_array()
                .unwrap()
                .iter()
                .map(|value| ns(value.as_i64().unwrap()))
                .collect::<Vec<_>>();
            let direction = if run["direction"] == "before" {
                AnchorWindowDirection::Before
            } else {
                AnchorWindowDirection::After
            };
            let actual = materialize_strict_open_anchor_category_minutes(
                &intervals,
                &anchors,
                &windows,
                direction,
                true,
                Some(run["threshold_hours"].as_u64().unwrap() as u8),
            )
            .unwrap();
            let rows = run["rows"].as_array().unwrap();
            assert_eq!(actual.len(), rows.len());
            for (actual, expected) in actual.iter().zip(rows) {
                assert_eq!(
                    actual.anchor_time_ns,
                    ns(expected["anchor_seconds"].as_i64().unwrap())
                );
                assert_eq!(
                    u64::from(actual.window_minutes),
                    expected["window_minutes"].as_u64().unwrap()
                );
                let categories = expected["category_minutes"].as_object().unwrap();
                assert_eq!(
                    actual.category_minutes.keys().collect::<Vec<_>>(),
                    categories.keys().collect::<Vec<_>>()
                );
                for (field, value) in categories
                    .iter()
                    .map(|(key, value)| (key.as_str(), value))
                    .chain(std::iter::once((
                        "app_usage_min",
                        &expected["app_usage_min"],
                    )))
                {
                    let observed = if field == "app_usage_min" {
                        actual.app_usage_min
                    } else {
                        actual.category_minutes[field]
                    };
                    if value.as_str() == Some("NaN") {
                        assert!(
                            observed.is_nan(),
                            "{} / {}h / {} / anchor {} / {field}: expected missing, got {observed}",
                            run["case"],
                            run["threshold_hours"],
                            run["direction"],
                            actual.anchor_index
                        );
                    } else {
                        assert_close(observed, value.as_f64().unwrap());
                    }
                }
            }
        }
    }

    #[test]
    fn released_before_and_after_callers_match_the_bounded_oracle() {
        // DOI 10.1037/emo0001485, deposited `Match_ESM_App.py` functions
        // `App_BeforeESM` and `App_AfterESM` at their post-clean boundary:
        // `.tmp-literature-review-private/ontology-sublation-20260831/
        // elmer-langener-behapp-esm-window-oracle/released-Match_ESM_App.py:16,173`.
        let day = 86_400;
        let episodes = vec![
            episode(-5_400, 2.0, "interaction"),
            episode(-3_600, 2.0, "social media"),
            episode(-1_800, 2.0, "other"),
            episode(-900, 1.9, "unknown"),
            episode(-600, 0.0, "interaction"),
            episode(-540, -1.0, "interaction"),
            episode(-2, 2.0, "interaction"),
            episode(0, 1.0, "social media"),
            episode(1, 2.0, "social media"),
            episode(1_800, 2.0, "other"),
            episode(3_600, 2.0, "interaction"),
            episode(5_400, 2.0, "unknown"),
            episode(day - 1, 1.0, "interaction"),
            episode(day + 1, 1.0, "social media"),
            episode(2 * day - 1, 1.0, "other"),
            episode(2 * day + 1, 1.0, "other"),
        ];
        let esm_times = [ns(0), ns(day), ns(2 * day)];

        let before = materialize_strict_open_anchor_category_minutes(
            &episodes,
            &esm_times,
            &[30, 60, 90],
            AnchorWindowDirection::Before,
            true,
            None,
        )
        .expect("source-shaped before window must execute");
        let after = materialize_strict_open_anchor_category_minutes(
            &episodes,
            &esm_times,
            &[30, 60, 90],
            AnchorWindowDirection::After,
            true,
            None,
        )
        .expect("source-shaped after window must execute");

        assert_eq!(before.len(), 9);
        assert_eq!(after.len(), 9);
        assert_eq!(
            before
                .iter()
                .map(|row| (row.window_minutes, row.anchor_index))
                .collect::<Vec<_>>(),
            vec![
                (30, 0),
                (30, 1),
                (30, 2),
                (60, 0),
                (60, 1),
                (60, 2),
                (90, 0),
                (90, 1),
                (90, 2)
            ]
        );
        assert_eq!(
            after
                .iter()
                .map(|row| (row.window_minutes, row.anchor_index))
                .collect::<Vec<_>>(),
            vec![
                (30, 0),
                (30, 1),
                (30, 2),
                (60, 0),
                (60, 1),
                (60, 2),
                (90, 0),
                (90, 1),
                (90, 2)
            ]
        );

        // Fractional 1.9 s contributes one second. Exact lower bounds and the
        // exact ESM instant are excluded; the near-before episode contributes
        // its two [start,end) seconds.
        assert_categories(
            &before[0],
            &[
                ("interaction_min", 2.0 / 60.0),
                ("other_min", 1.0 / 60.0),
                ("social media_min", 0.0),
                ("unknown_min", 1.0 / 60.0),
            ],
        );
        assert_categories(
            &before[3],
            &[
                ("interaction_min", 2.0 / 60.0),
                ("other_min", 2.0 / 60.0),
                ("social media_min", 1.0 / 60.0),
                ("unknown_min", 1.0 / 60.0),
            ],
        );
        assert_categories(
            &before[6],
            &[
                ("interaction_min", 3.0 / 60.0),
                ("other_min", 2.0 / 60.0),
                ("social media_min", 2.0 / 60.0),
                ("unknown_min", 1.0 / 60.0),
            ],
        );
        for (row, seconds) in before
            .iter()
            .zip([4.0, 1.0, 0.0, 6.0, 1.0, 0.0, 8.0, 1.0, 0.0])
        {
            assert_close(row.app_usage_min, seconds / 60.0);
            assert_eq!(row.direction, AnchorWindowDirection::Before);
        }

        // Each larger strict-open after window admits the next boundary
        // episode only from its second point onward or from the smaller bound.
        assert_categories(
            &after[0],
            &[
                ("interaction_min", 0.0),
                ("other_min", 0.0),
                ("social media_min", 2.0 / 60.0),
            ],
        );
        assert_categories(
            &after[3],
            &[
                ("interaction_min", 0.0),
                ("other_min", 2.0 / 60.0),
                ("social media_min", 2.0 / 60.0),
            ],
        );
        assert_categories(
            &after[6],
            &[
                ("interaction_min", 2.0 / 60.0),
                ("other_min", 2.0 / 60.0),
                ("social media_min", 2.0 / 60.0),
            ],
        );
        for (row, seconds) in after
            .iter()
            .zip([2.0, 1.0, 0.0, 4.0, 1.0, 0.0, 6.0, 1.0, 0.0])
        {
            assert_close(row.app_usage_min, seconds / 60.0);
            assert_eq!(row.direction, AnchorWindowDirection::After);
        }
        assert!(!after[0].category_minutes.contains_key("unknown_min"));

        // The last ESM is skipped even though matching episodes exist, then
        // restored by the right-join equivalent with every emitted column 0.
        for row in before
            .iter()
            .chain(&after)
            .filter(|row| row.anchor_index == 2)
        {
            assert_close(row.app_usage_min, 0.0);
            assert!(row.category_minutes.values().all(|minutes| *minutes == 0.0));
            assert_eq!(row.anchor_time_ns, ns(2 * day));
        }

        let mut invalid = episodes.clone();
        invalid.push(episode(10, f64::NAN, "source-error"));
        assert_eq!(
            materialize_strict_open_anchor_category_minutes(
                &invalid,
                &esm_times,
                &[30, 60, 90],
                AnchorWindowDirection::Before,
                true,
                None,
            ),
            Err(AnchorRelativeCategoryWindowError::NonFiniteDuration {
                episode_index: episodes.len()
            })
        );

        // The released function reaches pd.concat([]) and aborts on its first
        // rule when 30 minutes selects nothing, even if a later rule would.
        assert_eq!(
            materialize_strict_open_anchor_category_minutes(
                &[episode(-3_599, 1.0, "only-in-60-min")],
                &[ns(0), ns(day)],
                &[30, 60, 90],
                AnchorWindowDirection::Before,
                true,
                None,
            ),
            Err(
                AnchorRelativeCategoryWindowError::NoSelectedSecondsForWindow {
                    window_minutes: 30
                }
            )
        );
    }
}
