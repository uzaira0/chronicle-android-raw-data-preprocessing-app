//! Typed parsing for a seven-field touch/keyboard event vector.
//!
//! Numeric values are preserved without invented units or ranges. The three
//! key-class indicators use the source-disclosed one-hot representation and
//! therefore accept only the exact lexical values `0` and `1`.

use std::collections::BTreeMap;
use std::fmt;

pub const TOUCH_VECTOR_REQUIRED_FIELDS: [&str; 7] = [
    "inter_tap_duration",
    "alphanumeric_flag",
    "special_character_flag",
    "backspace_flag",
    "pressure",
    "speed",
    "touch_time",
];

const OPTIONAL_IDENTITY_FIELDS: [&str; 3] = ["participant_id", "event_timestamp", "source_row_id"];

#[derive(Debug, Clone, PartialEq)]
pub struct TouchKeyboardEventVector {
    /// One-based data-record index, excluding the header.
    pub source_record_index: usize,
    /// Optional transport identity; not part of the seven-dimensional vector.
    pub participant_id: Option<String>,
    /// Preserved lexically because the source does not disclose a timestamp
    /// representation, clock, timezone, or unit for this input record.
    pub event_timestamp: Option<String>,
    /// Optional caller-provided stable row identity.
    pub source_row_id: Option<String>,
    pub inter_tap_duration: f64,
    pub alphanumeric: bool,
    pub special_character: bool,
    pub backspace: bool,
    pub pressure: f64,
    pub speed: f64,
    pub touch_time: f64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TouchKeyboardVectorParseError {
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
    InvalidOneHotValue {
        source_record_index: usize,
        field: String,
        value: String,
    },
}

impl fmt::Display for TouchKeyboardVectorParseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Csv(error) => write!(formatter, "invalid touch-vector CSV: {error}"),
            Self::DuplicateColumn(field) => {
                write!(formatter, "duplicate touch-vector column {field}")
            }
            Self::MissingRequiredColumn(field) => {
                write!(formatter, "missing required touch-vector column {field}")
            }
            Self::MissingRequiredValue {
                source_record_index,
                field,
            } => write!(
                formatter,
                "touch-vector record {source_record_index} is missing required field {field}"
            ),
            Self::NonFiniteOrInvalidNumeric {
                source_record_index,
                field,
                value,
            } => write!(
                formatter,
                "touch-vector record {source_record_index} field {field} is not a finite number: {value}"
            ),
            Self::InvalidOneHotValue {
                source_record_index,
                field,
                value,
            } => write!(
                formatter,
                "touch-vector record {source_record_index} field {field} is not exact one-hot 0 or 1: {value}"
            ),
        }
    }
}

impl std::error::Error for TouchKeyboardVectorParseError {}

fn required_value<'a>(
    record: &'a csv::StringRecord,
    source_record_index: usize,
    field: &str,
    index: usize,
) -> Result<&'a str, TouchKeyboardVectorParseError> {
    let value = record.get(index).unwrap_or_default();
    if value.is_empty() {
        return Err(TouchKeyboardVectorParseError::MissingRequiredValue {
            source_record_index,
            field: field.to_owned(),
        });
    }
    Ok(value)
}

fn finite_number(
    record: &csv::StringRecord,
    source_record_index: usize,
    field: &str,
    index: usize,
) -> Result<f64, TouchKeyboardVectorParseError> {
    let value = required_value(record, source_record_index, field, index)?;
    value
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite())
        .ok_or_else(
            || TouchKeyboardVectorParseError::NonFiniteOrInvalidNumeric {
                source_record_index,
                field: field.to_owned(),
                value: value.to_owned(),
            },
        )
}

fn one_hot(
    record: &csv::StringRecord,
    source_record_index: usize,
    field: &str,
    index: usize,
) -> Result<bool, TouchKeyboardVectorParseError> {
    let value = required_value(record, source_record_index, field, index)?;
    match value {
        "0" => Ok(false),
        "1" => Ok(true),
        _ => Err(TouchKeyboardVectorParseError::InvalidOneHotValue {
            source_record_index,
            field: field.to_owned(),
            value: value.to_owned(),
        }),
    }
}

fn optional_identity(record: &csv::StringRecord, index: Option<usize>) -> Option<String> {
    index
        .and_then(|index| record.get(index))
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

/// Parse a CSV carrying all seven fields on every touch-event row.
///
/// Additional columns are accepted, while the optional participant, timestamp,
/// and source-row identity fields are preserved verbatim when present. Empty or
/// malformed vector cells fail closed. No numeric range or unit is imposed.
pub fn parse_touch_keyboard_event_vectors(
    csv_bytes: &[u8],
) -> Result<Vec<TouchKeyboardEventVector>, TouchKeyboardVectorParseError> {
    let mut reader = csv::ReaderBuilder::new()
        .trim(csv::Trim::None)
        .from_reader(csv_bytes);
    let headers = reader
        .headers()
        .map_err(|error| TouchKeyboardVectorParseError::Csv(error.to_string()))?
        .clone();
    let mut indices = BTreeMap::<String, usize>::new();
    for (index, header) in headers.iter().enumerate() {
        if indices.insert(header.to_owned(), index).is_some() {
            return Err(TouchKeyboardVectorParseError::DuplicateColumn(
                header.to_owned(),
            ));
        }
    }
    for field in TOUCH_VECTOR_REQUIRED_FIELDS {
        if !indices.contains_key(field) {
            return Err(TouchKeyboardVectorParseError::MissingRequiredColumn(
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
            record.map_err(|error| TouchKeyboardVectorParseError::Csv(error.to_string()))?;
        output.push(TouchKeyboardEventVector {
            source_record_index,
            participant_id: optional_identity(&record, participant),
            event_timestamp: optional_identity(&record, timestamp),
            source_row_id: optional_identity(&record, source_row),
            inter_tap_duration: finite_number(
                &record,
                source_record_index,
                "inter_tap_duration",
                index("inter_tap_duration"),
            )?,
            alphanumeric: one_hot(
                &record,
                source_record_index,
                "alphanumeric_flag",
                index("alphanumeric_flag"),
            )?,
            special_character: one_hot(
                &record,
                source_record_index,
                "special_character_flag",
                index("special_character_flag"),
            )?,
            backspace: one_hot(
                &record,
                source_record_index,
                "backspace_flag",
                index("backspace_flag"),
            )?,
            pressure: finite_number(&record, source_record_index, "pressure", index("pressure"))?,
            speed: finite_number(&record, source_record_index, "speed", index("speed"))?,
            touch_time: finite_number(
                &record,
                source_record_index,
                "touch_time",
                index("touch_time"),
            )?,
        });
    }
    Ok(output)
}
