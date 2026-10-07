//! Fixed-minute payload aggregation keyed by phone and external address.
//!
//! This primitive only resolves packet direction, assigns packets to an
//! explicitly anchored one-minute grid, and sums payload bytes. It does not
//! remove keepalives, gate on device state, construct sessions, classify
//! addresses, calculate features, or apply quality-control rules.

use std::collections::BTreeMap;
use std::fmt;

pub const FIXED_MINUTE_NS: i64 = 60_000_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FixedMinuteBinAnchor {
    ExplicitTimestampNs(i64),
    Undisclosed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BidirectionalPacketObservation {
    /// Stable identity for the phone whose traffic was observed.
    pub phone_key: String,
    /// Address assigned to the phone for this observation.
    pub phone_address: String,
    pub timestamp_ns: i64,
    pub source_address: String,
    pub destination_address: String,
    pub payload_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct FixedMinutePacketAggregate {
    pub phone_key: String,
    pub external_address: String,
    pub bin_start_timestamp_ns: i64,
    pub payload_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FixedMinutePacketAggregationError {
    BinAnchorUndisclosed,
    InvalidPhoneEndpoint {
        packet_index: usize,
    },
    BinStartOutsideTimestampRange {
        packet_index: usize,
    },
    PayloadBytesOverflow {
        packet_index: usize,
        phone_key: String,
        external_address: String,
        bin_start_timestamp_ns: i64,
    },
}

impl fmt::Display for FixedMinutePacketAggregationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::BinAnchorUndisclosed => formatter.write_str(
                "fixed-minute packet aggregation requires an explicit caller-provided bin anchor",
            ),
            Self::InvalidPhoneEndpoint { packet_index } => write!(
                formatter,
                "packet {packet_index} must have the phone address as exactly one endpoint"
            ),
            Self::BinStartOutsideTimestampRange { packet_index } => write!(
                formatter,
                "fixed-minute bin start for packet {packet_index} is outside the timestamp range"
            ),
            Self::PayloadBytesOverflow {
                packet_index,
                phone_key,
                external_address,
                bin_start_timestamp_ns,
            } => write!(
                formatter,
                "payload-byte sum overflows at packet {packet_index} for phone {phone_key}, external address {external_address}, bin {bin_start_timestamp_ns}"
            ),
        }
    }
}

impl std::error::Error for FixedMinutePacketAggregationError {}

fn external_address(
    packet: &BidirectionalPacketObservation,
    packet_index: usize,
) -> Result<&str, FixedMinutePacketAggregationError> {
    let source_is_phone = packet.source_address == packet.phone_address;
    let destination_is_phone = packet.destination_address == packet.phone_address;
    match (source_is_phone, destination_is_phone) {
        (true, false) => Ok(&packet.destination_address),
        (false, true) => Ok(&packet.source_address),
        _ => Err(FixedMinutePacketAggregationError::InvalidPhoneEndpoint { packet_index }),
    }
}

fn fixed_minute_start(
    timestamp_ns: i64,
    anchor_ns: i64,
    packet_index: usize,
) -> Result<i64, FixedMinutePacketAggregationError> {
    let timestamp_ns = i128::from(timestamp_ns);
    let anchor_ns = i128::from(anchor_ns);
    let minute_ns = i128::from(FIXED_MINUTE_NS);
    let bin_index = (timestamp_ns - anchor_ns).div_euclid(minute_ns);
    let bin_start_ns = anchor_ns + bin_index * minute_ns;
    i64::try_from(bin_start_ns).map_err(|_| {
        FixedMinutePacketAggregationError::BinStartOutsideTimestampRange { packet_index }
    })
}

/// Sum bidirectional packet payloads in `[minute_start, minute_start + 1m)`.
///
/// Direction is intentionally absent from the output key: a packet whose
/// source is the phone and a packet whose destination is the phone aggregate
/// together when their phone, external address, and minute are equal. Exactly
/// one endpoint must equal `phone_address`, so ambiguous packet ownership is
/// rejected rather than inferred. Timestamp timezone/coordinate interpretation
/// remains the caller's responsibility and is made visible through `anchor`.
pub fn aggregate_bidirectional_packets_by_fixed_minute(
    packets: &[BidirectionalPacketObservation],
    anchor: FixedMinuteBinAnchor,
) -> Result<Vec<FixedMinutePacketAggregate>, FixedMinutePacketAggregationError> {
    let anchor_ns = match anchor {
        FixedMinuteBinAnchor::ExplicitTimestampNs(anchor_ns) => anchor_ns,
        FixedMinuteBinAnchor::Undisclosed => {
            return Err(FixedMinutePacketAggregationError::BinAnchorUndisclosed)
        }
    };

    let mut payload_bytes_by_key = BTreeMap::<(String, String, i64), u64>::new();
    for (packet_index, packet) in packets.iter().enumerate() {
        let external_address = external_address(packet, packet_index)?.to_owned();
        let bin_start_timestamp_ns =
            fixed_minute_start(packet.timestamp_ns, anchor_ns, packet_index)?;
        let key = (
            packet.phone_key.clone(),
            external_address.clone(),
            bin_start_timestamp_ns,
        );
        let payload_bytes = payload_bytes_by_key.entry(key).or_default();
        *payload_bytes = payload_bytes
            .checked_add(packet.payload_bytes)
            .ok_or_else(|| FixedMinutePacketAggregationError::PayloadBytesOverflow {
                packet_index,
                phone_key: packet.phone_key.clone(),
                external_address,
                bin_start_timestamp_ns,
            })?;
    }

    Ok(payload_bytes_by_key
        .into_iter()
        .map(
            |((phone_key, external_address, bin_start_timestamp_ns), payload_bytes)| {
                FixedMinutePacketAggregate {
                    phone_key,
                    external_address,
                    bin_start_timestamp_ns,
                    payload_bytes,
                }
            },
        )
        .collect())
}
