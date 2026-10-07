//! Summary rates over nested signal observations from an explicit scan slice.
//!
//! Each outer row is one scan and each inner value is one observation. The
//! predicates are intentionally independent and preserve ordinary IEEE/Python
//! comparisons: NaN matches neither, positive infinity can exceed a finite
//! threshold, and negative infinity matches neither finite bounded interval.

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ScanSignalProximityConfig {
    pub(crate) above_exclusive_lower: f64,
    pub(crate) inclusive_lower: f64,
    pub(crate) inclusive_upper: f64,
    pub(crate) above_weight: f64,
    pub(crate) within_weight: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ScanSignalProximitySummary {
    pub(crate) observations_per_scan: f64,
    pub(crate) above_per_scan: f64,
    pub(crate) within_per_scan: f64,
    pub(crate) weighted_proximity_mean: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ScanSignalProximityError {
    NonFiniteConfiguration,
    ReversedInclusiveRange,
}

pub(crate) fn summarize_scan_signal_proximity(
    scans: &[Vec<f64>],
    config: ScanSignalProximityConfig,
) -> Result<ScanSignalProximitySummary, ScanSignalProximityError> {
    if !config.above_exclusive_lower.is_finite()
        || !config.inclusive_lower.is_finite()
        || !config.inclusive_upper.is_finite()
        || !config.above_weight.is_finite()
        || !config.within_weight.is_finite()
    {
        return Err(ScanSignalProximityError::NonFiniteConfiguration);
    }
    if config.inclusive_lower > config.inclusive_upper {
        return Err(ScanSignalProximityError::ReversedInclusiveRange);
    }

    let scan_count = scans.len() as f64;
    let observation_count = scans.iter().map(Vec::len).sum::<usize>();
    let above_count = scans
        .iter()
        .flatten()
        .filter(|value| **value > config.above_exclusive_lower)
        .count();
    let within_count = scans
        .iter()
        .flatten()
        .filter(|value| **value >= config.inclusive_lower && **value <= config.inclusive_upper)
        .count();
    let classified_count = above_count + within_count;

    Ok(ScanSignalProximitySummary {
        observations_per_scan: observation_count as f64 / scan_count,
        above_per_scan: above_count as f64 / scan_count,
        within_per_scan: within_count as f64 / scan_count,
        weighted_proximity_mean: (above_count as f64 * config.above_weight
            + within_count as f64 * config.within_weight)
            / classified_count as f64,
    })
}
