//! Source-neutral duplicate decision for already-ordered adjacent records.

use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum AdjacentRecordDuplicateError {
    InvalidExclusiveInterval {
        value: f64,
    },
    NonFiniteTimestamp {
        record_role: &'static str,
        value: f64,
    },
    CurrentPrecedesPrevious {
        current_timestamp: f64,
        previous_timestamp: f64,
    },
}

impl fmt::Display for AdjacentRecordDuplicateError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidExclusiveInterval { value } => {
                write!(formatter, "exclusive duplicate interval is invalid: {value}")
            }
            Self::NonFiniteTimestamp { record_role, value } => {
                write!(formatter, "{record_role} record timestamp is not finite: {value}")
            }
            Self::CurrentPrecedesPrevious {
                current_timestamp,
                previous_timestamp,
            } => write!(
                formatter,
                "current record timestamp {current_timestamp} precedes previous timestamp {previous_timestamp}"
            ),
        }
    }
}

impl std::error::Error for AdjacentRecordDuplicateError {}

/// Decide whether to suppress a current record relative to its immediate
/// source-order predecessor.
///
/// `compared_fields_equal` and `retain_current_exception` are supplied by the
/// source-specific adapter. The interval is exclusive: equality is retained.
pub fn should_suppress_adjacent_record(
    current_timestamp: f64,
    previous_timestamp: Option<f64>,
    exclusive_interval: f64,
    compared_fields_equal: bool,
    retain_current_exception: bool,
) -> Result<bool, AdjacentRecordDuplicateError> {
    if !exclusive_interval.is_finite() || exclusive_interval <= 0.0 {
        return Err(AdjacentRecordDuplicateError::InvalidExclusiveInterval {
            value: exclusive_interval,
        });
    }
    if !current_timestamp.is_finite() {
        return Err(AdjacentRecordDuplicateError::NonFiniteTimestamp {
            record_role: "current",
            value: current_timestamp,
        });
    }
    let Some(previous_timestamp) = previous_timestamp else {
        return Ok(false);
    };
    if !previous_timestamp.is_finite() {
        return Err(AdjacentRecordDuplicateError::NonFiniteTimestamp {
            record_role: "previous",
            value: previous_timestamp,
        });
    }
    if current_timestamp < previous_timestamp {
        return Err(AdjacentRecordDuplicateError::CurrentPrecedesPrevious {
            current_timestamp,
            previous_timestamp,
        });
    }
    if current_timestamp - previous_timestamp >= exclusive_interval {
        return Ok(false);
    }
    Ok(compared_fields_equal && !retain_current_exception)
}
