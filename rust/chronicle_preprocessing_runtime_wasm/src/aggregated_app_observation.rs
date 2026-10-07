//! Source-native, already-aggregated application observations.
//!
//! This carrier starts after collection and aggregation. It preserves the
//! paper-disclosed screen-time and launch-count values lexically because their
//! units, numeric representation, ranges, and aggregation cadence are not
//! disclosed. It does not derive either value from Android event rows.

use std::collections::BTreeMap;
use std::fmt;

pub const AGGREGATED_APP_OBSERVATION_FIELDS: [&str; 5] = [
    "user_id",
    "date",
    "application_name",
    "screen_time",
    "launch_count",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AggregatedAppObservation {
    pub user_id: String,
    /// Preserved lexically: the source does not disclose format or timezone.
    pub date: String,
    pub application_name: String,
    /// Already-aggregated source value with no disclosed unit or range.
    pub screen_time: String,
    /// Already-aggregated source value with no disclosed representation/range.
    pub launch_count: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AggregatedAppObservationParseError {
    Csv(String),
    DuplicateColumn(String),
    MissingRequiredColumn(String),
    UnexpectedColumn(String),
    MissingRequiredValue {
        source_record_index: usize,
        field: String,
    },
}

impl fmt::Display for AggregatedAppObservationParseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Csv(error) => write!(formatter, "invalid aggregated-app CSV: {error}"),
            Self::DuplicateColumn(field) => {
                write!(formatter, "duplicate aggregated-app column {field}")
            }
            Self::MissingRequiredColumn(field) => {
                write!(formatter, "missing required aggregated-app column {field}")
            }
            Self::UnexpectedColumn(field) => {
                write!(formatter, "unexpected aggregated-app column {field}")
            }
            Self::MissingRequiredValue {
                source_record_index,
                field,
            } => write!(
                formatter,
                "aggregated-app record {source_record_index} is missing required field {field}"
            ),
        }
    }
}

impl std::error::Error for AggregatedAppObservationParseError {}

fn required_value(
    record: &csv::StringRecord,
    source_record_index: usize,
    field: &str,
    index: usize,
) -> Result<String, AggregatedAppObservationParseError> {
    let value = record.get(index).unwrap_or_default();
    if value.is_empty() {
        return Err(AggregatedAppObservationParseError::MissingRequiredValue {
            source_record_index,
            field: field.to_owned(),
        });
    }
    Ok(value.to_owned())
}

/// Parse the five fields disclosed for the paper's published app-usage stream.
///
/// The field labels are Chronicle's explicit carrier contract, not claimed
/// source column names. No extra identity or measurement fields are accepted.
pub fn parse_aggregated_app_observations(
    csv_bytes: &[u8],
) -> Result<Vec<AggregatedAppObservation>, AggregatedAppObservationParseError> {
    let mut reader = csv::ReaderBuilder::new()
        .trim(csv::Trim::None)
        .from_reader(csv_bytes);
    let headers = reader
        .headers()
        .map_err(|error| AggregatedAppObservationParseError::Csv(error.to_string()))?
        .clone();
    let mut indices = BTreeMap::<String, usize>::new();
    for (index, header) in headers.iter().enumerate() {
        if indices.insert(header.to_owned(), index).is_some() {
            return Err(AggregatedAppObservationParseError::DuplicateColumn(
                header.to_owned(),
            ));
        }
        if !AGGREGATED_APP_OBSERVATION_FIELDS.contains(&header) {
            return Err(AggregatedAppObservationParseError::UnexpectedColumn(
                header.to_owned(),
            ));
        }
    }
    for field in AGGREGATED_APP_OBSERVATION_FIELDS {
        if !indices.contains_key(field) {
            return Err(AggregatedAppObservationParseError::MissingRequiredColumn(
                field.to_owned(),
            ));
        }
    }

    let index = |field: &str| *indices.get(field).expect("required field checked");
    let mut observations = Vec::new();
    for (zero_based_index, record) in reader.records().enumerate() {
        let source_record_index = zero_based_index + 1;
        let record =
            record.map_err(|error| AggregatedAppObservationParseError::Csv(error.to_string()))?;
        let value = |field: &str| required_value(&record, source_record_index, field, index(field));
        observations.push(AggregatedAppObservation {
            user_id: value("user_id")?,
            date: value("date")?,
            application_name: value("application_name")?,
            screen_time: value("screen_time")?,
            launch_count: value("launch_count")?,
        });
    }
    Ok(observations)
}
