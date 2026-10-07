//! Categorical dwell integration over complete, non-overlapping fixed windows.
//!
//! This operator intentionally requires a caller-provided grid anchor and an
//! explicit incomplete-window policy. It accepts only contiguous observations
//! exactly on the configured cadence. It does not infer calendar boundaries,
//! fill missing samples, construct sliding windows, or decide what a partial
//! window means.

use crate::categorical_threshold_bucketizer::{
    OrderedThresholdBucketizer, ThresholdBucketizerError,
};
use std::collections::BTreeMap;
use std::fmt;
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FixedGridWindowProgression {
    NonOverlapping,
    Sliding,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FixedGridAnchor {
    ExplicitTimestampNs(i64),
    Undisclosed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IncompleteWindowPolicy {
    Reject,
    Undisclosed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FixedGridDwellConfiguration {
    pub sampling_cadence: Duration,
    pub window_duration: Duration,
    pub progression: FixedGridWindowProgression,
    pub anchor: FixedGridAnchor,
    pub incomplete_window_policy: IncompleteWindowPolicy,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FixedGridScalarObservation {
    pub timestamp_ns: i64,
    /// A scalar already produced by any required upstream transformation.
    pub value: f64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FixedGridCategoryDwell<Category> {
    pub window_index: usize,
    pub start_timestamp_ns: i64,
    pub end_timestamp_ns: i64,
    /// Exact one-hot integral by category in nanoseconds.
    pub category_dwell_ns: BTreeMap<Category, u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FixedGridDwellError {
    SlidingWindowUnsupported,
    GridAnchorUndisclosed,
    IncompleteWindowPolicyUndisclosed,
    ZeroSamplingCadence,
    ZeroWindowDuration,
    DurationOutsideTimestampRange,
    WindowNotWholeCadences,
    WindowSampleCountOutsidePlatformRange,
    TimestampOverflow {
        sample_index: usize,
    },
    ObservationOffCadence {
        sample_index: usize,
        expected_timestamp_ns: i64,
        observed_timestamp_ns: i64,
    },
    IncompleteWindow {
        sample_count: usize,
        samples_per_window: usize,
    },
    CategoryDwellOverflow {
        sample_index: usize,
    },
    ThresholdBucketizer {
        sample_index: usize,
        source: ThresholdBucketizerError,
    },
}

impl fmt::Display for FixedGridDwellError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SlidingWindowUnsupported => {
                formatter.write_str("fixed-grid categorical dwell requires non-overlapping windows")
            }
            Self::GridAnchorUndisclosed => formatter.write_str(
                "fixed-grid categorical dwell requires an explicit caller-provided grid anchor",
            ),
            Self::IncompleteWindowPolicyUndisclosed => formatter.write_str(
                "fixed-grid categorical dwell requires an explicit incomplete-window policy",
            ),
            Self::ZeroSamplingCadence => {
                formatter.write_str("fixed-grid categorical dwell sampling cadence must be positive")
            }
            Self::ZeroWindowDuration => {
                formatter.write_str("fixed-grid categorical dwell window duration must be positive")
            }
            Self::DurationOutsideTimestampRange => formatter.write_str(
                "fixed-grid categorical dwell cadence or window exceeds the timestamp range",
            ),
            Self::WindowNotWholeCadences => formatter.write_str(
                "fixed-grid categorical dwell window must contain a whole number of cadences",
            ),
            Self::WindowSampleCountOutsidePlatformRange => formatter.write_str(
                "fixed-grid categorical dwell sample count exceeds the platform range",
            ),
            Self::TimestampOverflow { sample_index } => write!(
                formatter,
                "fixed-grid categorical dwell expected timestamp overflows at sample {sample_index}"
            ),
            Self::ObservationOffCadence {
                sample_index,
                expected_timestamp_ns,
                observed_timestamp_ns,
            } => write!(
                formatter,
                "fixed-grid categorical dwell sample {sample_index} is off cadence: expected {expected_timestamp_ns}, observed {observed_timestamp_ns}"
            ),
            Self::IncompleteWindow {
                sample_count,
                samples_per_window,
            } => write!(
                formatter,
                "fixed-grid categorical dwell received {sample_count} samples, not a whole number of {samples_per_window}-sample windows"
            ),
            Self::CategoryDwellOverflow { sample_index } => write!(
                formatter,
                "fixed-grid categorical dwell accumulation overflows at sample {sample_index}"
            ),
            Self::ThresholdBucketizer {
                sample_index,
                source,
            } => write!(
                formatter,
                "fixed-grid categorical dwell cannot classify sample {sample_index}: {source}"
            ),
        }
    }
}

impl std::error::Error for FixedGridDwellError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::ThresholdBucketizer { source, .. } => Some(source),
            _ => None,
        }
    }
}

fn positive_duration_ns(
    duration: Duration,
    zero_error: FixedGridDwellError,
) -> Result<i64, FixedGridDwellError> {
    let duration_ns = duration.as_nanos();
    if duration_ns == 0 {
        return Err(zero_error);
    }
    i64::try_from(duration_ns).map_err(|_| FixedGridDwellError::DurationOutsideTimestampRange)
}

/// Integrate caller-provided scalar observations into categorical dwell time.
///
/// The bounded contract accepts only a complete contiguous run beginning at
/// the explicit anchor. Windows are `[start, end)` and advance by exactly one
/// window duration. Each classified observation contributes one cadence to its
/// category. Missing or extra timestamps are rejected instead of being filled,
/// shifted, or silently dropped.
pub fn materialize_complete_fixed_grid_category_dwell<Category: Clone + Ord>(
    observations: &[FixedGridScalarObservation],
    bucketizer: &OrderedThresholdBucketizer<Category>,
    configuration: FixedGridDwellConfiguration,
) -> Result<Vec<FixedGridCategoryDwell<Category>>, FixedGridDwellError> {
    if configuration.progression != FixedGridWindowProgression::NonOverlapping {
        return Err(FixedGridDwellError::SlidingWindowUnsupported);
    }
    let anchor_ns = match configuration.anchor {
        FixedGridAnchor::ExplicitTimestampNs(anchor_ns) => anchor_ns,
        FixedGridAnchor::Undisclosed => return Err(FixedGridDwellError::GridAnchorUndisclosed),
    };
    if configuration.incomplete_window_policy == IncompleteWindowPolicy::Undisclosed {
        return Err(FixedGridDwellError::IncompleteWindowPolicyUndisclosed);
    }

    let cadence_ns = positive_duration_ns(
        configuration.sampling_cadence,
        FixedGridDwellError::ZeroSamplingCadence,
    )?;
    let window_ns = positive_duration_ns(
        configuration.window_duration,
        FixedGridDwellError::ZeroWindowDuration,
    )?;
    if window_ns % cadence_ns != 0 {
        return Err(FixedGridDwellError::WindowNotWholeCadences);
    }
    let samples_per_window = usize::try_from(window_ns / cadence_ns)
        .map_err(|_| FixedGridDwellError::WindowSampleCountOutsidePlatformRange)?;
    if !observations.len().is_multiple_of(samples_per_window) {
        return Err(FixedGridDwellError::IncompleteWindow {
            sample_count: observations.len(),
            samples_per_window,
        });
    }

    for (sample_index, observation) in observations.iter().enumerate() {
        let sample_offset = i64::try_from(sample_index)
            .ok()
            .and_then(|index| index.checked_mul(cadence_ns))
            .ok_or(FixedGridDwellError::TimestampOverflow { sample_index })?;
        let expected_timestamp_ns = anchor_ns
            .checked_add(sample_offset)
            .ok_or(FixedGridDwellError::TimestampOverflow { sample_index })?;
        if observation.timestamp_ns != expected_timestamp_ns {
            return Err(FixedGridDwellError::ObservationOffCadence {
                sample_index,
                expected_timestamp_ns,
                observed_timestamp_ns: observation.timestamp_ns,
            });
        }
    }

    let window_count = observations.len() / samples_per_window;
    let mut windows = Vec::with_capacity(window_count);
    for window_index in 0..window_count {
        let window_offset = i64::try_from(window_index)
            .ok()
            .and_then(|index| index.checked_mul(window_ns))
            .ok_or(FixedGridDwellError::TimestampOverflow {
                sample_index: window_index.saturating_mul(samples_per_window),
            })?;
        let start_timestamp_ns =
            anchor_ns
                .checked_add(window_offset)
                .ok_or(FixedGridDwellError::TimestampOverflow {
                    sample_index: window_index.saturating_mul(samples_per_window),
                })?;
        let end_timestamp_ns = start_timestamp_ns.checked_add(window_ns).ok_or(
            FixedGridDwellError::TimestampOverflow {
                sample_index: window_index.saturating_mul(samples_per_window),
            },
        )?;
        windows.push(FixedGridCategoryDwell {
            window_index,
            start_timestamp_ns,
            end_timestamp_ns,
            category_dwell_ns: bucketizer
                .categories()
                .iter()
                .cloned()
                .map(|category| (category, 0))
                .collect(),
        });
    }

    let cadence_ns = u64::try_from(cadence_ns)
        .map_err(|_| FixedGridDwellError::DurationOutsideTimestampRange)?;
    for (sample_index, observation) in observations.iter().enumerate() {
        let category = bucketizer
            .category_for(observation.value)
            .map_err(|source| FixedGridDwellError::ThresholdBucketizer {
                sample_index,
                source,
            })?;
        let dwell_ns = windows[sample_index / samples_per_window]
            .category_dwell_ns
            .entry(category.clone())
            .or_default();
        *dwell_ns = dwell_ns
            .checked_add(cadence_ns)
            .ok_or(FixedGridDwellError::CategoryDwellOverflow { sample_index })?;
    }
    Ok(windows)
}
