//! Typed ingress for carrier voice-call/SMS communication records.
//!
//! The source discloses two linked nodes and the communication modality, but
//! not direction, timestamps, duration, weighting, or aggregation semantics.

use std::collections::BTreeMap;
use std::fmt;

pub const COMMUNICATION_DETAIL_REQUIRED_FIELDS: [&str; 3] =
    ["endpoint_1_id", "endpoint_2_id", "communication_modality"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommunicationModality {
    VoiceCall,
    Sms,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommunicationDetailRecord {
    /// One-based input-record index, excluding the header.
    pub source_record_index: usize,
    /// Opaque caller-supplied endpoint identities. Their order is preserved but
    /// does not assert communication direction.
    pub endpoint_1_id: String,
    pub endpoint_2_id: String,
    pub modality: CommunicationModality,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommunicationDetailRecordParseError {
    Csv(String),
    DuplicateColumn(String),
    MissingRequiredColumn(String),
    MissingRequiredValue {
        source_record_index: usize,
        field: String,
    },
    UnknownModality {
        source_record_index: usize,
        value: String,
    },
}

impl fmt::Display for CommunicationDetailRecordParseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Csv(error) => write!(formatter, "invalid communication-detail CSV: {error}"),
            Self::DuplicateColumn(field) => {
                write!(formatter, "duplicate communication-detail column {field}")
            }
            Self::MissingRequiredColumn(field) => {
                write!(formatter, "missing required communication-detail column {field}")
            }
            Self::MissingRequiredValue {
                source_record_index,
                field,
            } => write!(
                formatter,
                "communication-detail record {source_record_index} is missing required field {field}"
            ),
            Self::UnknownModality {
                source_record_index,
                value,
            } => write!(
                formatter,
                "communication-detail record {source_record_index} has unknown modality {value:?}; expected voice_call or sms"
            ),
        }
    }
}

impl std::error::Error for CommunicationDetailRecordParseError {}

fn required_value<'a>(
    record: &'a csv::StringRecord,
    source_record_index: usize,
    field: &str,
    index: usize,
) -> Result<&'a str, CommunicationDetailRecordParseError> {
    let value = record.get(index).unwrap_or_default();
    if value.is_empty() {
        return Err(CommunicationDetailRecordParseError::MissingRequiredValue {
            source_record_index,
            field: field.to_owned(),
        });
    }
    Ok(value)
}

/// Parse one carrier schema that supports voice-call and SMS records.
///
/// A particular input may contain either or both supported modalities. Endpoint
/// order and duplicate rows are preserved. Additional carrier columns are
/// accepted but are outside this source-backed claim. The function does not
/// infer direction, time, duration, weight, deduplication, or graph edges.
pub fn parse_joint_voice_sms_communication_details(
    csv_bytes: &[u8],
) -> Result<Vec<CommunicationDetailRecord>, CommunicationDetailRecordParseError> {
    let mut reader = csv::ReaderBuilder::new()
        .trim(csv::Trim::None)
        .from_reader(csv_bytes);
    let headers = reader
        .headers()
        .map_err(|error| CommunicationDetailRecordParseError::Csv(error.to_string()))?
        .clone();
    let mut indices = BTreeMap::<String, usize>::new();
    for (index, header) in headers.iter().enumerate() {
        if indices.insert(header.to_owned(), index).is_some() {
            return Err(CommunicationDetailRecordParseError::DuplicateColumn(
                header.to_owned(),
            ));
        }
    }
    for field in COMMUNICATION_DETAIL_REQUIRED_FIELDS {
        if !indices.contains_key(field) {
            return Err(CommunicationDetailRecordParseError::MissingRequiredColumn(
                field.to_owned(),
            ));
        }
    }

    let index = |field: &str| *indices.get(field).expect("required field checked");
    let mut output = Vec::new();
    for (zero_based_index, record) in reader.records().enumerate() {
        let source_record_index = zero_based_index + 1;
        let record =
            record.map_err(|error| CommunicationDetailRecordParseError::Csv(error.to_string()))?;
        let modality_value = required_value(
            &record,
            source_record_index,
            "communication_modality",
            index("communication_modality"),
        )?;
        let modality = match modality_value {
            "voice_call" => CommunicationModality::VoiceCall,
            "sms" => CommunicationModality::Sms,
            value => {
                return Err(CommunicationDetailRecordParseError::UnknownModality {
                    source_record_index,
                    value: value.to_owned(),
                });
            }
        };
        output.push(CommunicationDetailRecord {
            source_record_index,
            endpoint_1_id: required_value(
                &record,
                source_record_index,
                "endpoint_1_id",
                index("endpoint_1_id"),
            )?
            .to_owned(),
            endpoint_2_id: required_value(
                &record,
                source_record_index,
                "endpoint_2_id",
                index("endpoint_2_id"),
            )?
            .to_owned(),
            modality,
        });
    }

    Ok(output)
}
