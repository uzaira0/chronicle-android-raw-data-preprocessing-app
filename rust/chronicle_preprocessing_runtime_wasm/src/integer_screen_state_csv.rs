use chronicle_chrono_kernel_wasm::b05_foundational_semantics::{AndroidUsageSignal, RawB05Event};

const REQUIRED_COLUMNS: [&str; 3] = ["timestamp", "device_id", "screen_status"];
const MILLISECONDS_TO_NANOSECONDS: i64 = 1_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum IntegralEpochMillisecondsError {
    Invalid,
    OutOfRange,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IntegerScreenStateCsvError {
    Csv(String),
    MissingRequiredColumn(&'static str),
    DuplicateRequiredColumn(&'static str),
    MissingRequiredValue {
        source_data_row: u32,
        column: &'static str,
    },
    InvalidEpochMilliseconds {
        source_data_row: u32,
        value: String,
    },
    EpochMillisecondsOutOfRange {
        source_data_row: u32,
        value: String,
    },
    UnknownScreenStatus {
        source_data_row: u32,
        value: String,
    },
}

impl IntegerScreenStateCsvError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Csv(_) => "invalid_csv",
            Self::MissingRequiredColumn(_) => "missing_required_column",
            Self::DuplicateRequiredColumn(_) => "duplicate_required_column",
            Self::MissingRequiredValue { .. } => "missing_required_value",
            Self::InvalidEpochMilliseconds { .. } => "invalid_epoch_milliseconds",
            Self::EpochMillisecondsOutOfRange { .. } => "epoch_milliseconds_out_of_range",
            Self::UnknownScreenStatus { .. } => "unknown_screen_status",
        }
    }
}

/// Decode an ordered device-level screen-state CSV into the existing B05 raw
/// event boundary. Required headers are name-addressed so an optional source
/// row identifier or other preserved source columns may remain in the CSV.
///
/// The accepted status domain is deliberately closed. Its meanings are:
/// `0=screen non-interactive`, `1=screen interactive`, `2=keyguard shown`, and
/// `3=keyguard hidden`. Timestamps are exact signed epoch milliseconds and are
/// converted with checked arithmetic; no floating-point rounding is allowed.
pub fn parse_integer_screen_state_csv(
    csv_bytes: &[u8],
) -> Result<Vec<RawB05Event>, IntegerScreenStateCsvError> {
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .flexible(false)
        .from_reader(csv_bytes);
    let headers = reader
        .headers()
        .map_err(|error| IntegerScreenStateCsvError::Csv(error.to_string()))?
        .clone();

    let mut required_indices = [0_usize; REQUIRED_COLUMNS.len()];
    for (slot, required) in required_indices.iter_mut().zip(REQUIRED_COLUMNS) {
        let matches = headers
            .iter()
            .enumerate()
            .filter_map(|(index, header)| (header == required).then_some(index))
            .collect::<Vec<_>>();
        match matches.as_slice() {
            [] => return Err(IntegerScreenStateCsvError::MissingRequiredColumn(required)),
            [index] => *slot = *index,
            _ => {
                return Err(IntegerScreenStateCsvError::DuplicateRequiredColumn(
                    required,
                ))
            }
        }
    }
    let [timestamp_index, device_index, status_index] = required_indices;

    let mut events = Vec::new();
    for (index, record) in reader.records().enumerate() {
        let source_data_row = u32::try_from(index + 1).map_err(|_| {
            IntegerScreenStateCsvError::Csv("source row count exceeds u32".to_owned())
        })?;
        let record = record.map_err(|error| IntegerScreenStateCsvError::Csv(error.to_string()))?;
        let timestamp = required_value(&record, timestamp_index, source_data_row, "timestamp")?;
        let device_id = required_value(&record, device_index, source_data_row, "device_id")?;
        let screen_status =
            required_value(&record, status_index, source_data_row, "screen_status")?;

        let timestamp_ms =
            parse_integral_epoch_milliseconds(timestamp).map_err(|error| match error {
                IntegralEpochMillisecondsError::Invalid => {
                    IntegerScreenStateCsvError::InvalidEpochMilliseconds {
                        source_data_row,
                        value: timestamp.to_owned(),
                    }
                }
                IntegralEpochMillisecondsError::OutOfRange => {
                    IntegerScreenStateCsvError::EpochMillisecondsOutOfRange {
                        source_data_row,
                        value: timestamp.to_owned(),
                    }
                }
            })?;
        let timestamp_ns = timestamp_ms
            .checked_mul(MILLISECONDS_TO_NANOSECONDS)
            .ok_or_else(|| IntegerScreenStateCsvError::EpochMillisecondsOutOfRange {
                source_data_row,
                value: timestamp.to_owned(),
            })?;
        let signal = match screen_status {
            "0" => AndroidUsageSignal::ScreenNonInteractive,
            "1" => AndroidUsageSignal::ScreenInteractive,
            "2" => AndroidUsageSignal::KeyguardShown,
            "3" => AndroidUsageSignal::KeyguardHidden,
            value => {
                return Err(IntegerScreenStateCsvError::UnknownScreenStatus {
                    source_data_row,
                    value: value.to_owned(),
                })
            }
        };

        events.push(RawB05Event {
            participant_id: device_id.to_owned(),
            timestamp_ns: Some(timestamp_ns),
            source_data_row,
            source_data_rows: vec![source_data_row],
            raw_interaction_type: screen_status.to_owned(),
            signal,
            package_name: None,
            app_opener_eligible: false,
        });
    }
    Ok(events)
}

/// Parse a SQLite `REAL` text rendering without a floating-point round trip.
/// Only values whose exact decimal/exponent representation is an integer are
/// accepted, because the collector inserted epoch milliseconds. This accepts
/// forms such as `1000`, `1000.0`, and `1e3`, but refuses `1000.5`.
fn parse_integral_epoch_milliseconds(value: &str) -> Result<i64, IntegralEpochMillisecondsError> {
    let (negative, unsigned) = match value.as_bytes().first() {
        Some(b'-') => (true, &value[1..]),
        Some(b'+') => (false, &value[1..]),
        _ => (false, value),
    };
    if unsigned.is_empty() {
        return Err(IntegralEpochMillisecondsError::Invalid);
    }

    let mut exponent_split = unsigned.split(['e', 'E']);
    let significand = exponent_split
        .next()
        .ok_or(IntegralEpochMillisecondsError::Invalid)?;
    let exponent_text = exponent_split.next();
    if exponent_split.next().is_some() {
        return Err(IntegralEpochMillisecondsError::Invalid);
    }
    let exponent = match exponent_text {
        None => 0_i64,
        Some(text)
            if !text.is_empty()
                && text != "+"
                && text != "-"
                && text
                    .trim_start_matches(['+', '-'])
                    .bytes()
                    .all(|byte| byte.is_ascii_digit()) =>
        {
            text.parse::<i64>()
                .map_err(|_| IntegralEpochMillisecondsError::OutOfRange)?
        }
        Some(_) => return Err(IntegralEpochMillisecondsError::Invalid),
    };

    let mut decimal_split = significand.split('.');
    let integer_digits = decimal_split
        .next()
        .ok_or(IntegralEpochMillisecondsError::Invalid)?;
    let fractional_digits = decimal_split.next().unwrap_or("");
    if decimal_split.next().is_some()
        || integer_digits.is_empty() && fractional_digits.is_empty()
        || !integer_digits.bytes().all(|byte| byte.is_ascii_digit())
        || !fractional_digits.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(IntegralEpochMillisecondsError::Invalid);
    }

    let digits = format!("{integer_digits}{fractional_digits}");
    let significant = digits.trim_start_matches('0');
    if significant.is_empty() {
        return Ok(0);
    }
    let scale = exponent
        .checked_sub(
            i64::try_from(fractional_digits.len())
                .map_err(|_| IntegralEpochMillisecondsError::OutOfRange)?,
        )
        .ok_or(IntegralEpochMillisecondsError::OutOfRange)?;
    let integral_digits = if scale < 0 {
        let removed = usize::try_from(scale.unsigned_abs())
            .map_err(|_| IntegralEpochMillisecondsError::OutOfRange)?;
        if removed > significant.len()
            || !significant[significant.len() - removed..]
                .bytes()
                .all(|byte| byte == b'0')
        {
            return Err(IntegralEpochMillisecondsError::Invalid);
        }
        &significant[..significant.len() - removed]
    } else {
        significant
    };

    let mut magnitude = 0_i128;
    for digit in integral_digits.bytes() {
        magnitude = magnitude
            .checked_mul(10)
            .and_then(|number| number.checked_add(i128::from(digit - b'0')))
            .ok_or(IntegralEpochMillisecondsError::OutOfRange)?;
    }
    if scale > 0 {
        for _ in 0..scale {
            magnitude = magnitude
                .checked_mul(10)
                .ok_or(IntegralEpochMillisecondsError::OutOfRange)?;
        }
    }
    let signed = if negative { -magnitude } else { magnitude };
    i64::try_from(signed).map_err(|_| IntegralEpochMillisecondsError::OutOfRange)
}

fn required_value<'a>(
    record: &'a csv::StringRecord,
    index: usize,
    source_data_row: u32,
    column: &'static str,
) -> Result<&'a str, IntegerScreenStateCsvError> {
    let value = record.get(index).unwrap_or_default();
    if value.is_empty() {
        return Err(IntegerScreenStateCsvError::MissingRequiredValue {
            source_data_row,
            column,
        });
    }
    Ok(value)
}
