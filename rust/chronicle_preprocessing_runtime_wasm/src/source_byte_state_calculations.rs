//! Two supplied-data stages, not counter decoding or a screen state machine.
//! Five-minute uniform allocation: primary 114-raw.txt:391-415.
//! First-hour Android screen cap before packet selection: 102.txt:319-343.
//! Exact nanosecond coordinates and bytes are caller-qualified. Positive
//! timestamp precision is metadata, not a quantization or rounding rule.

use std::collections::{BTreeMap, BTreeSet};

pub const FIVE_MINUTES_NS: i128 = 300_000_000_000;
pub const FIRST_HOUR_NS: i128 = 3_600_000_000_000;

/// Exact rational bytes; fractional allocation is not rounded to whole bytes.
pub fn uniform_allocated_bytes(
    bytes: u64,
    state_dwell_ns: i128,
    window_duration_ns: i128,
) -> Result<(u128, u128), String> {
    if window_duration_ns != FIVE_MINUTES_NS
        || state_dwell_ns < 0
        || state_dwell_ns > window_duration_ns
    {
        return Err("requires a five-minute window and an in-window nonnegative dwell".into());
    }
    Ok((
        u128::from(bytes)
            .checked_mul(state_dwell_ns as u128)
            .ok_or("uniform byte numerator overflow")?,
        window_duration_ns as u128,
    ))
}

/// Supplied observed OFF endpoint is preserved separately by the CSV stage.
/// No missing endpoint, orphan repair, eligibility or app duration is inferred.
pub fn capped_closed_screen_interval_end_ns(start: i64, end: i64) -> Result<i64, String> {
    if end < start {
        return Err("closed screen OFF endpoint precedes ON endpoint".into());
    }
    i64::try_from(i128::from(end).min(i128::from(start) + FIRST_HOUR_NS))
        .map_err(|_| "capped screen endpoint outside i64 range".into())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ByteStateStage {
    UniformFiveMinuteAllocation,
    CappedClosedScreenPacketGate,
}

impl ByteStateStage {
    pub fn adapter_id(self) -> &'static str {
        match self {
            Self::UniformFiveMinuteAllocation => "chronicle.uniform-five-minute-byte-allocation",
            Self::CappedClosedScreenPacketGate => "chronicle.capped-closed-screen-packet-gate",
        }
    }
    pub fn derived_result_kind(self) -> &'static str {
        match self {
            Self::UniformFiveMinuteAllocation => {
                "literature-uniform-five-minute-byte-allocation-csv"
            }
            Self::CappedClosedScreenPacketGate => {
                "literature-capped-closed-screen-gated-packets-csv"
            }
        }
    }
    fn role(self) -> &'static str {
        match self {
            Self::UniformFiveMinuteAllocation => "resolved_five_minute_joint_state_dwells",
            Self::CappedClosedScreenPacketGate => {
                "closed_android_screen_interval_packet_candidates"
            }
        }
    }
    fn computed_fields(self) -> &'static [&'static str] {
        match self {
            Self::UniformFiveMinuteAllocation => &[
                "state_dwell_ns",
                "window_duration_ns",
                "allocated_bytes_numerator",
                "allocated_bytes_denominator",
            ],
            Self::CappedClosedScreenPacketGate => &[
                "capped_screen_off_timestamp_ns",
                "capped_screen_on_duration_ns",
            ],
        }
    }
}

pub struct PreparedByteStateStage {
    pub csv_bytes: Vec<u8>,
    pub source_row_count: usize,
    pub emitted_row_count: usize,
}

struct Window {
    id: String,
    metadata: Vec<String>,
    start: i64,
    end: i64,
    cursor: i64,
}

/// CSV transports already resolved window totals/dwells or CLOSED screen
/// intervals associated by the caller with candidate packets. All supplied
/// columns survive on emitted rows, and no input ordering is changed.
pub fn execute_source_byte_state_csv(
    raw: &[u8],
    stage: ByteStateStage,
) -> Result<PreparedByteStateStage, String> {
    let mut reader = csv::ReaderBuilder::new()
        .trim(csv::Trim::None)
        .from_reader(raw);
    let headers = reader.headers().map_err(|e| e.to_string())?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() {
        return Err("duplicate CSV column names".into());
    }
    if stage
        .computed_fields()
        .iter()
        .any(|field| headers.iter().any(|h| h == *field))
    {
        return Err("supplied computed columns are refused".into());
    }
    let column = |name: &str| {
        headers
            .iter()
            .position(|h| h == name)
            .ok_or_else(|| format!("{} requires {name}", stage.adapter_id()))
    };
    let mut indices = BTreeMap::new();
    let common = [
        "participant_id",
        "source_row_id",
        "source_device_id",
        "source_stream_id",
        "source_stream_role",
        "clock_id",
        "timestamp_unit",
        "timestamp_precision_ns",
        "byte_unit",
    ];
    let specific: &[&str] = match stage {
        ByteStateStage::UniformFiveMinuteAllocation => &[
            "window_id",
            "poll_start_source_row_id",
            "poll_end_source_row_id",
            "window_start_timestamp_ns",
            "window_end_timestamp_ns",
            "window_bytes",
            "counter_status",
            "network_technology",
            "state_start_timestamp_ns",
            "state_end_timestamp_ns",
            "rssi_dbm",
            "screen_state",
        ],
        ByteStateStage::CappedClosedScreenPacketGate => &[
            "screen_interval_id",
            "screen_on_source_row_id",
            "screen_off_source_row_id",
            "screen_on_timestamp_ns",
            "screen_off_timestamp_ns",
            "packet_endpoint_policy",
            "phone_key",
            "phone_address",
            "timestamp_ns",
            "source_address",
            "destination_address",
            "payload_bytes",
        ],
    };
    for name in common.iter().chain(specific) {
        indices.insert(*name, column(name)?);
    }
    let value = |record: &csv::StringRecord, name: &str| record[indices[name]].to_owned();
    let integer = |record: &csv::StringRecord, name: &str| {
        record[indices[name]]
            .parse::<i64>()
            .map_err(|_| format!("{name} requires an exact i64 integer"))
    };
    let bytes = |record: &csv::StringRecord, name: &str| {
        record[indices[name]]
            .parse::<u64>()
            .map_err(|_| format!("{name} requires unsigned integer bytes"))
    };
    let records = reader
        .records()
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut scopes = BTreeMap::<String, (String, String, String)>::new();
    let mut device_owners = BTreeMap::<String, String>::new();
    let mut identities = BTreeSet::new();
    let mut windows = BTreeMap::<String, Window>::new();
    let mut window_ids = BTreeSet::new();
    let mut intervals = BTreeMap::<String, (String, Vec<String>, i64, i64)>::new();
    let mut interval_ids = BTreeSet::new();
    let mut packet_previous = BTreeMap::new();
    let mut selected = Vec::new();
    for record in &records {
        for name in [
            "participant_id",
            "source_row_id",
            "source_device_id",
            "source_stream_id",
            "clock_id",
        ] {
            if value(record, name).trim().is_empty() {
                return Err(format!("{name} must be nonempty"));
            }
        }
        let participant = value(record, "participant_id");
        let device = value(record, "source_device_id");
        let scope = (
            device.clone(),
            value(record, "source_stream_id"),
            value(record, "clock_id"),
        );
        if scopes
            .insert(participant.clone(), scope.clone())
            .is_some_and(|old| old != scope)
        {
            return Err("participant must declare one device/source stream/common clock".into());
        }
        if device_owners
            .insert(device.clone(), participant.clone())
            .is_some_and(|old| old != participant)
        {
            return Err("source device must belong to one declared participant".into());
        }
        if !identities.insert((participant.clone(), value(record, "source_row_id"))) {
            return Err("duplicate participant/source_row_id".into());
        }
        if value(record, "source_stream_role") != stage.role()
            || value(record, "timestamp_unit") != "nanoseconds"
            || value(record, "byte_unit") != "bytes"
            || integer(record, "timestamp_precision_ns")? <= 0
        {
            return Err("requires the qualified source role, nanoseconds, bytes and positive precision metadata".into());
        }
        if stage == ByteStateStage::UniformFiveMinuteAllocation {
            let id = value(record, "window_id");
            let poll_start = value(record, "poll_start_source_row_id");
            let poll_end = value(record, "poll_end_source_row_id");
            if [id.as_str(), poll_start.as_str(), poll_end.as_str()]
                .iter()
                .any(|v| v.trim().is_empty())
                || poll_start == poll_end
                || value(record, "counter_status") != "resolved_nonnegative_window_total"
                || !matches!(value(record, "network_technology").as_str(), "3G" | "WiFi")
                || !matches!(value(record, "screen_state").as_str(), "ON" | "OFF")
            {
                return Err("requires explicit poll/window IDs, resolved total, 3G/WiFi and ON/OFF joint states".into());
            }
            if !value(record, "rssi_dbm")
                .parse::<f64>()
                .is_ok_and(f64::is_finite)
            {
                return Err("rssi_dbm must be a supplied finite state value".into());
            }
            let start = integer(record, "window_start_timestamp_ns")?;
            let end = integer(record, "window_end_timestamp_ns")?;
            let duration = i128::from(end) - i128::from(start);
            let total_bytes = bytes(record, "window_bytes")?;
            let state_start = integer(record, "state_start_timestamp_ns")?;
            let state_end = integer(record, "state_end_timestamp_ns")?;
            let dwell = i128::from(state_end) - i128::from(state_start);
            let allocation = uniform_allocated_bytes(total_bytes, dwell, duration)?;
            let metadata = [
                "poll_start_source_row_id",
                "poll_end_source_row_id",
                "window_start_timestamp_ns",
                "window_end_timestamp_ns",
                "window_bytes",
                "network_technology",
            ]
            .iter()
            .map(|name| value(record, name))
            .collect::<Vec<_>>();
            let is_new = windows.get(&participant).is_none_or(|w| w.id != id);
            if is_new {
                if windows
                    .get(&participant)
                    .is_some_and(|w| w.cursor != w.end || start < w.end)
                    || !window_ids.insert((participant.clone(), id.clone()))
                {
                    return Err("windows must be complete, nonoverlapping and ordered; reopening is refused".into());
                }
                windows.insert(
                    participant.clone(),
                    Window {
                        id,
                        metadata: metadata.clone(),
                        start,
                        end,
                        cursor: start,
                    },
                );
            }
            let window = windows.get_mut(&participant).unwrap();
            if window.metadata != metadata
                || state_start != window.cursor
                || state_start < window.start
                || state_end < state_start
                || state_end > window.end
            {
                return Err(
                    "state rows must exactly partition a stable supplied window in caller order"
                        .into(),
                );
            }
            window.cursor = state_end;
            selected.push((
                record.clone(),
                vec![
                    dwell.to_string(),
                    duration.to_string(),
                    allocation.0.to_string(),
                    allocation.1.to_string(),
                ],
            ));
        } else {
            let id = value(record, "screen_interval_id");
            let on_id = value(record, "screen_on_source_row_id");
            let off_id = value(record, "screen_off_source_row_id");
            for name in [
                "screen_interval_id",
                "screen_on_source_row_id",
                "screen_off_source_row_id",
                "phone_key",
                "phone_address",
                "source_address",
                "destination_address",
            ] {
                if value(record, name).trim().is_empty() {
                    return Err(format!("{name} must be nonempty"));
                }
            }
            if on_id == off_id || value(record, "phone_key") != device {
                return Err("closed endpoints require distinct IDs and phone_key must equal source_device_id".into());
            }
            let phone = value(record, "phone_address");
            if (value(record, "source_address") == phone)
                == (value(record, "destination_address") == phone)
            {
                return Err("packet must have its declared phone as exactly one endpoint".into());
            }
            bytes(record, "payload_bytes")?;
            let start = integer(record, "screen_on_timestamp_ns")?;
            let end = integer(record, "screen_off_timestamp_ns")?;
            let capped_end = capped_closed_screen_interval_end_ns(start, end)?;
            let timestamp = integer(record, "timestamp_ns")?;
            if packet_previous
                .insert(participant.clone(), timestamp)
                .is_some_and(|previous| timestamp < previous)
            {
                return Err(
                    "packet rows must be nondecreasing per participant in caller order".into(),
                );
            }
            let policy = value(record, "packet_endpoint_policy");
            if !matches!(
                policy.as_str(),
                "left_closed_right_open" | "left_closed_right_closed"
            ) {
                return Err("source does not pin packet endpoint equality; explicit caller endpoint policy required".into());
            }
            let metadata = [
                "screen_on_source_row_id",
                "screen_off_source_row_id",
                "screen_on_timestamp_ns",
                "screen_off_timestamp_ns",
                "packet_endpoint_policy",
                "phone_address",
            ]
            .iter()
            .map(|name| value(record, name))
            .collect::<Vec<_>>();
            let is_new = intervals.get(&participant).is_none_or(|old| old.0 != id);
            if is_new {
                if intervals.get(&participant).is_some_and(|old| start < old.3)
                    || !interval_ids.insert((participant.clone(), id.clone()))
                {
                    return Err("closed candidate intervals must be ordered/nonoverlapping; reopening is refused".into());
                }
                intervals.insert(participant.clone(), (id, metadata.clone(), start, end));
            }
            if intervals[&participant].1 != metadata {
                return Err(
                    "closed interval metadata must not change between candidate packets".into(),
                );
            }
            // This tests the capped endpoint, never the original OFF endpoint.
            let retained = timestamp >= start
                && match policy.as_str() {
                    "left_closed_right_open" => timestamp < capped_end,
                    "left_closed_right_closed" => timestamp <= capped_end,
                    _ => unreachable!(),
                };
            if retained {
                selected.push((
                    record.clone(),
                    vec![
                        capped_end.to_string(),
                        (i128::from(capped_end) - i128::from(start)).to_string(),
                    ],
                ));
            }
        }
    }
    if windows.values().any(|w| w.cursor != w.end) {
        return Err("final supplied dwell window is incomplete".into());
    }
    let mut writer = csv::WriterBuilder::new().from_writer(Vec::new());
    let mut output_header = headers;
    for name in stage.computed_fields() {
        output_header.push_field(name);
    }
    writer
        .write_record(&output_header)
        .map_err(|e| e.to_string())?;
    for (record, computed) in &selected {
        let mut output = record.clone();
        for field in computed {
            output.push_field(field);
        }
        writer.write_record(&output).map_err(|e| e.to_string())?;
    }
    Ok(PreparedByteStateStage {
        csv_bytes: writer.into_inner().map_err(|e| e.to_string())?,
        source_row_count: records.len(),
        emitted_row_count: selected.len(),
    })
}
