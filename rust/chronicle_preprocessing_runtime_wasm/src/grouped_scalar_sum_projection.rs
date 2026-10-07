//! Ordered grouped scalar sums followed by a caller-supplied partition projection.
//!
//! This primitive deliberately receives opaque group keys and an explicit
//! projection function. It does not parse dates, choose a time zone, filter
//! source records, or infer missing partitions.

use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum RCompatibleScalar {
    Missing,
    Finite(f64),
    NotANumber,
    PositiveInfinity,
    NegativeInfinity,
}

impl RCompatibleScalar {
    fn add(self, other: Self) -> Self {
        use RCompatibleScalar::{Finite, Missing, NegativeInfinity, NotANumber, PositiveInfinity};

        match (self, other) {
            (Missing, _) | (_, Missing) => Missing,
            (NotANumber, _) | (_, NotANumber) => NotANumber,
            (PositiveInfinity, NegativeInfinity) | (NegativeInfinity, PositiveInfinity) => {
                NotANumber
            }
            (PositiveInfinity, _) | (_, PositiveInfinity) => PositiveInfinity,
            (NegativeInfinity, _) | (_, NegativeInfinity) => NegativeInfinity,
            (Finite(left), Finite(right)) => Self::from_f64(left + right),
        }
    }

    fn divide(self, divisor: f64) -> Self {
        match self {
            Self::Missing => Self::Missing,
            Self::Finite(value) => Self::from_f64(value / divisor),
            Self::NotANumber => Self::NotANumber,
            Self::PositiveInfinity if divisor.is_sign_positive() => Self::PositiveInfinity,
            Self::PositiveInfinity => Self::NegativeInfinity,
            Self::NegativeInfinity if divisor.is_sign_positive() => Self::NegativeInfinity,
            Self::NegativeInfinity => Self::PositiveInfinity,
        }
    }

    fn from_f64(value: f64) -> Self {
        if value.is_nan() {
            Self::NotANumber
        } else if value == f64::INFINITY {
            Self::PositiveInfinity
        } else if value == f64::NEG_INFINITY {
            Self::NegativeInfinity
        } else {
            Self::Finite(value)
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SequentialDivisionConfiguration {
    pub first_divisor: f64,
    pub second_divisor: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct GroupedScalarInput<Entity, RawPartition, Passthrough> {
    pub entity: Entity,
    pub raw_partition: RawPartition,
    pub passthrough: Passthrough,
    pub value: RCompatibleScalar,
}

#[derive(Debug, Clone, PartialEq)]
pub struct GroupedScalarProjection<Entity, ProjectedPartition, Passthrough> {
    pub entity: Entity,
    pub passthrough: Passthrough,
    pub projected_partition: ProjectedPartition,
    pub sum: RCompatibleScalar,
    pub first_scaled_value: RCompatibleScalar,
    pub second_scaled_value: RCompatibleScalar,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GroupedScalarSumProjectionError {
    InvalidFirstDivisor,
    InvalidSecondDivisor,
    ProjectionFailed { source_record_index: usize },
}

impl fmt::Display for GroupedScalarSumProjectionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidFirstDivisor => {
                formatter.write_str("the first divisor must be finite and nonzero")
            }
            Self::InvalidSecondDivisor => {
                formatter.write_str("the second divisor must be finite and nonzero")
            }
            Self::ProjectionFailed {
                source_record_index,
            } => write!(
                formatter,
                "partition projection failed for source record {source_record_index}"
            ),
        }
    }
}

impl std::error::Error for GroupedScalarSumProjectionError {}

/// Sums in input order by `(entity, raw_partition)`, then projects partitions.
///
/// Every input row remains eligible for output after receiving its raw-group
/// sum. Exact duplicate projected rows are removed in first-occurrence order.
/// Missing values and IEEE-754 exceptional values follow R's `sum()` behavior
/// without `na.rm`: missing dominates, `NaN` propagates, opposing infinities
/// become `NaN`, and a single infinity propagates through division.
pub fn grouped_scalar_sum_then_project_unique<
    Entity,
    RawPartition,
    Passthrough,
    ProjectedPartition,
    Project,
>(
    rows: &[GroupedScalarInput<Entity, RawPartition, Passthrough>],
    configuration: SequentialDivisionConfiguration,
    mut project_partition: Project,
) -> Result<
    Vec<GroupedScalarProjection<Entity, ProjectedPartition, Passthrough>>,
    GroupedScalarSumProjectionError,
>
where
    Entity: Clone + PartialEq,
    RawPartition: Clone + PartialEq,
    Passthrough: Clone + PartialEq,
    ProjectedPartition: PartialEq,
    Project: FnMut(&RawPartition) -> Option<ProjectedPartition>,
{
    if !configuration.first_divisor.is_finite() || configuration.first_divisor == 0.0 {
        return Err(GroupedScalarSumProjectionError::InvalidFirstDivisor);
    }
    if !configuration.second_divisor.is_finite() || configuration.second_divisor == 0.0 {
        return Err(GroupedScalarSumProjectionError::InvalidSecondDivisor);
    }

    let mut group_totals: Vec<(Entity, RawPartition, RCompatibleScalar)> = Vec::new();
    for row in rows {
        if let Some((_, _, total)) = group_totals.iter_mut().find(|(entity, raw_partition, _)| {
            *entity == row.entity && *raw_partition == row.raw_partition
        }) {
            *total = total.add(row.value);
        } else {
            group_totals.push((
                row.entity.clone(),
                row.raw_partition.clone(),
                RCompatibleScalar::Finite(0.0).add(row.value),
            ));
        }
    }

    let mut output = Vec::new();
    for (source_record_index, row) in rows.iter().enumerate() {
        let sum = group_totals
            .iter()
            .find(|(entity, raw_partition, _)| {
                *entity == row.entity && *raw_partition == row.raw_partition
            })
            .expect("each input row has an accumulated group")
            .2;
        let projected_partition = project_partition(&row.raw_partition).ok_or(
            GroupedScalarSumProjectionError::ProjectionFailed {
                source_record_index: source_record_index + 1,
            },
        )?;
        let first_scaled_value = sum.divide(configuration.first_divisor);
        let candidate = GroupedScalarProjection {
            entity: row.entity.clone(),
            passthrough: row.passthrough.clone(),
            projected_partition,
            sum,
            first_scaled_value,
            second_scaled_value: first_scaled_value.divide(configuration.second_divisor),
        };

        if !output.contains(&candidate) {
            output.push(candidate);
        }
    }

    Ok(output)
}
