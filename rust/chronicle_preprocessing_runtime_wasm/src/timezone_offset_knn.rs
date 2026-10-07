//! Exact replay of the deposited Schoedel `impute.knn` helper for timezone offsets.
//!
//! The source first converts zero millisecond offsets to missing values. Its
//! first ten missing entries use a growing prefix; later entries use a
//! position-centered ±10-row window. Earlier imputations can therefore affect
//! later ones. This is not conventional nearest-neighbor imputation.

use std::fmt;

pub const SCHOEDEL_TIMEZONE_K: usize = 10;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NonFiniteTimezoneOffset {
    pub source_index: usize,
}

impl fmt::Display for NonFiniteTimezoneOffset {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "timezone offset at source index {} is not finite",
            self.source_index
        )
    }
}

impl std::error::Error for NonFiniteTimezoneOffset {}

fn source_mode(values: &[Option<f64>]) -> Option<f64> {
    let observed = values.iter().flatten().copied().collect::<Vec<_>>();
    // ponytail: the source window is at most 21 rows, so the direct O(n²)
    // first-occurrence mode exactly matches R's unique/match/tabulate tie rule.
    let mut best = None;
    let mut best_count = 0;
    for candidate in observed.iter().copied() {
        let count = observed.iter().filter(|value| **value == candidate).count();
        if count > best_count {
            best = Some(candidate);
            best_count = count;
        }
    }
    best
}

/// Convert zero to missing and replay `impute.knn(y, k = 10)` in source order.
///
/// Input order is significant and must already be chronological, as it is at
/// the deposited caller boundary. All-missing neighborhoods remain missing.
pub fn impute_schoedel_timezone_offsets_ms(
    source_offsets_ms: &[Option<f64>],
) -> Result<Vec<Option<f64>>, NonFiniteTimezoneOffset> {
    let mut offsets = source_offsets_ms
        .iter()
        .copied()
        .enumerate()
        .map(|(source_index, value)| {
            if value.is_some_and(|value| !value.is_finite()) {
                return Err(NonFiniteTimezoneOffset { source_index });
            }
            Ok(value.filter(|value| *value != 0.0))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let missing_indices = offsets
        .iter()
        .enumerate()
        .filter_map(|(index, value)| value.is_none().then_some(index))
        .collect::<Vec<_>>();

    for (missing_ordinal, source_index) in missing_indices.into_iter().enumerate() {
        let start = if missing_ordinal >= SCHOEDEL_TIMEZONE_K {
            source_index - SCHOEDEL_TIMEZONE_K
        } else {
            0
        };
        let stop = source_index
            .saturating_add(SCHOEDEL_TIMEZONE_K + 1)
            .min(offsets.len());
        offsets[source_index] = source_mode(&offsets[start..stop]);
    }

    Ok(offsets)
}
