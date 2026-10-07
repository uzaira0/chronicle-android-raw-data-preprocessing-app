//! Typed parsing for a three-axis motion-sensor vector.
//!
//! The parser preserves the three numeric axes on one record. It intentionally
//! does not assign units, a coordinate frame, cadence, calibration, gravity
//! handling, or a scalar/magnitude transformation.

use std::collections::BTreeMap;
use std::fmt;

pub const MOTION_VECTOR_REQUIRED_FIELDS: [&str; 3] =
    ["acceleration_x", "acceleration_y", "acceleration_z"];

const OPTIONAL_IDENTITY_FIELDS: [&str; 3] = ["participant_id", "event_timestamp", "source_row_id"];

#[derive(Debug, Clone, PartialEq)]
pub struct MotionSensorVectorRecord {
    /// One-based input-record index, excluding the header.
    pub source_record_index: usize,
    /// Optional transport identity; not part of the three-axis vector.
    pub participant_id: Option<String>,
    /// Preserved lexically because the source does not disclose a timestamp
    /// representation, clock, timezone, or sampling cadence.
    pub event_timestamp: Option<String>,
    /// Optional caller-provided stable row identity.
    pub source_row_id: Option<String>,
    pub acceleration_x: f64,
    pub acceleration_y: f64,
    pub acceleration_z: f64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MotionSensorVectorParseError {
    Csv(String),
    DuplicateColumn(String),
    MissingRequiredColumn(String),
    MissingRequiredValue {
        source_record_index: usize,
        field: String,
    },
    NonFiniteOrInvalidNumeric {
        source_record_index: usize,
        field: String,
        value: String,
    },
}

impl fmt::Display for MotionSensorVectorParseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Csv(error) => write!(formatter, "invalid motion-vector CSV: {error}"),
            Self::DuplicateColumn(field) => {
                write!(formatter, "duplicate motion-vector column {field}")
            }
            Self::MissingRequiredColumn(field) => {
                write!(formatter, "missing required motion-vector column {field}")
            }
            Self::MissingRequiredValue {
                source_record_index,
                field,
            } => write!(
                formatter,
                "motion-vector record {source_record_index} is missing required field {field}"
            ),
            Self::NonFiniteOrInvalidNumeric {
                source_record_index,
                field,
                value,
            } => write!(
                formatter,
                "motion-vector record {source_record_index} field {field} is not a finite number: {value}"
            ),
        }
    }
}

impl std::error::Error for MotionSensorVectorParseError {}

fn finite_number(
    record: &csv::StringRecord,
    source_record_index: usize,
    field: &str,
    index: usize,
) -> Result<f64, MotionSensorVectorParseError> {
    let value = record.get(index).unwrap_or_default();
    if value.is_empty() {
        return Err(MotionSensorVectorParseError::MissingRequiredValue {
            source_record_index,
            field: field.to_owned(),
        });
    }
    value
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite())
        .ok_or_else(|| MotionSensorVectorParseError::NonFiniteOrInvalidNumeric {
            source_record_index,
            field: field.to_owned(),
            value: value.to_owned(),
        })
}

fn optional_identity(record: &csv::StringRecord, index: Option<usize>) -> Option<String> {
    index
        .and_then(|index| record.get(index))
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

/// Parse CSV rows carrying an inseparable X/Y/Z acceleration vector.
///
/// Additional columns are accepted. Optional participant, timestamp, and
/// source-row identity are preserved verbatim when present. All three axes are
/// required and must be finite numbers. No unit, range, frame, cadence, or
/// derived scalar is imposed.
pub fn parse_motion_sensor_vectors(
    csv_bytes: &[u8],
) -> Result<Vec<MotionSensorVectorRecord>, MotionSensorVectorParseError> {
    let mut reader = csv::ReaderBuilder::new()
        .trim(csv::Trim::None)
        .from_reader(csv_bytes);
    let headers = reader
        .headers()
        .map_err(|error| MotionSensorVectorParseError::Csv(error.to_string()))?
        .clone();
    let mut indices = BTreeMap::<String, usize>::new();
    for (index, header) in headers.iter().enumerate() {
        if indices.insert(header.to_owned(), index).is_some() {
            return Err(MotionSensorVectorParseError::DuplicateColumn(
                header.to_owned(),
            ));
        }
    }
    for field in MOTION_VECTOR_REQUIRED_FIELDS {
        if !indices.contains_key(field) {
            return Err(MotionSensorVectorParseError::MissingRequiredColumn(
                field.to_owned(),
            ));
        }
    }

    let index = |field: &str| *indices.get(field).expect("required field checked");
    let participant = indices.get(OPTIONAL_IDENTITY_FIELDS[0]).copied();
    let timestamp = indices.get(OPTIONAL_IDENTITY_FIELDS[1]).copied();
    let source_row = indices.get(OPTIONAL_IDENTITY_FIELDS[2]).copied();
    let mut output = Vec::new();
    for (zero_based_index, record) in reader.records().enumerate() {
        let source_record_index = zero_based_index + 1;
        let record =
            record.map_err(|error| MotionSensorVectorParseError::Csv(error.to_string()))?;
        output.push(MotionSensorVectorRecord {
            source_record_index,
            participant_id: optional_identity(&record, participant),
            event_timestamp: optional_identity(&record, timestamp),
            source_row_id: optional_identity(&record, source_row),
            acceleration_x: finite_number(
                &record,
                source_record_index,
                "acceleration_x",
                index("acceleration_x"),
            )?,
            acceleration_y: finite_number(
                &record,
                source_record_index,
                "acceleration_y",
                index("acceleration_y"),
            )?,
            acceleration_z: finite_number(
                &record,
                source_record_index,
                "acceleration_z",
                index("acceleration_z"),
            )?,
        });
    }
    Ok(output)
}
