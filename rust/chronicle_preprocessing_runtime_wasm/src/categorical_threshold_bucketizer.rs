//! Generic categorical threshold bucketing for finite scalar observations.
//!
//! Ordered cut points define half-open buckets:
//! `(-infinity, t0)`, `[t0, t1)`, ..., `[tn, infinity)`. A value equal to a
//! cut point therefore belongs to the bucket on its right. Upstream transforms
//! that produce the scalar, temporal aggregation, and missing-row policy stay
//! outside this operator.

use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ThresholdBucketizerError {
    CategoryCountMismatch {
        threshold_count: usize,
        category_count: usize,
    },
    NonFiniteThreshold {
        threshold_index: usize,
    },
    NonIncreasingThreshold {
        threshold_index: usize,
    },
    NonFiniteObservation,
}

impl fmt::Display for ThresholdBucketizerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CategoryCountMismatch {
                threshold_count,
                category_count,
            } => write!(
                formatter,
                "categorical threshold bucketizer requires exactly one more category than thresholds; got {threshold_count} thresholds and {category_count} categories"
            ),
            Self::NonFiniteThreshold { threshold_index } => write!(
                formatter,
                "categorical threshold bucketizer threshold {threshold_index} is not finite"
            ),
            Self::NonIncreasingThreshold { threshold_index } => write!(
                formatter,
                "categorical threshold bucketizer threshold {threshold_index} is not strictly greater than its predecessor"
            ),
            Self::NonFiniteObservation => {
                formatter.write_str("categorical threshold bucketizer observation is not finite")
            }
        }
    }
}

impl std::error::Error for ThresholdBucketizerError {}

/// A validated scalar-to-category mapping with lower-inclusive cut points.
///
/// The category type belongs to the caller so the operator can be reused
/// without imposing a paper-specific label vocabulary.
#[derive(Debug, Clone, PartialEq)]
pub struct OrderedThresholdBucketizer<Category> {
    thresholds: Vec<f64>,
    categories: Vec<Category>,
}

impl<Category> OrderedThresholdBucketizer<Category> {
    pub fn new(
        thresholds: Vec<f64>,
        categories: Vec<Category>,
    ) -> Result<Self, ThresholdBucketizerError> {
        if categories.len() != thresholds.len() + 1 {
            return Err(ThresholdBucketizerError::CategoryCountMismatch {
                threshold_count: thresholds.len(),
                category_count: categories.len(),
            });
        }
        for (threshold_index, threshold) in thresholds.iter().copied().enumerate() {
            if !threshold.is_finite() {
                return Err(ThresholdBucketizerError::NonFiniteThreshold { threshold_index });
            }
            if threshold_index > 0 && threshold <= thresholds[threshold_index - 1] {
                return Err(ThresholdBucketizerError::NonIncreasingThreshold { threshold_index });
            }
        }
        Ok(Self {
            thresholds,
            categories,
        })
    }

    pub fn category_for(&self, observation: f64) -> Result<&Category, ThresholdBucketizerError> {
        if !observation.is_finite() {
            return Err(ThresholdBucketizerError::NonFiniteObservation);
        }
        let category_index = self
            .thresholds
            .partition_point(|threshold| observation >= *threshold);
        Ok(&self.categories[category_index])
    }

    pub fn thresholds(&self) -> &[f64] {
        &self.thresholds
    }

    pub fn categories(&self) -> &[Category] {
        &self.categories
    }
}
