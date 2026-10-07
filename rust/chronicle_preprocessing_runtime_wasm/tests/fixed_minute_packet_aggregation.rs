use chronicle_preprocessing_runtime_wasm::fixed_minute_packet_aggregation::{
    aggregate_bidirectional_packets_by_fixed_minute, BidirectionalPacketObservation,
    FixedMinuteBinAnchor, FixedMinutePacketAggregate, FixedMinutePacketAggregationError,
    FIXED_MINUTE_NS,
};
use serde::Deserialize;

const FIXTURE_JSON: &str = include_str!("fixtures/fixed_minute_packet_aggregation.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PacketAggregationFixture {
    schema_version: String,
    source_work_id: String,
    source_locators: Vec<String>,
    source_disclosed_semantics: Vec<String>,
    source_blocker: SourceBlocker,
    bounded_fixture_policy: BoundedFixturePolicy,
    packets: Vec<PacketFixture>,
    expected: Vec<AggregateFixture>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceBlocker {
    kind: String,
    detail: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BoundedFixturePolicy {
    anchor_timestamp_ns: i64,
    interval: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PacketFixture {
    phone_key: String,
    phone_address: String,
    timestamp_ns: i64,
    source_address: String,
    destination_address: String,
    payload_bytes: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AggregateFixture {
    phone_key: String,
    external_address: String,
    bin_start_timestamp_ns: i64,
    payload_bytes: u64,
}

#[test]
fn fixture_groups_both_directions_by_phone_address_and_exact_minute_boundary() {
    let fixture: PacketAggregationFixture =
        serde_json::from_str(FIXTURE_JSON).expect("valid fixed-minute fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-fixed-minute-packet-aggregation-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1016/j.smhl.2020.100137");
    assert_eq!(fixture.source_locators.len(), 1);
    assert_eq!(fixture.source_disclosed_semantics.len(), 4);
    assert_eq!(
        fixture.source_blocker.kind,
        "minute_bin_anchor_timezone_and_boundary_undisclosed"
    );
    assert!(fixture.source_blocker.detail.contains("does not disclose"));
    assert_eq!(fixture.bounded_fixture_policy.interval, "half_open");

    let packets = fixture
        .packets
        .into_iter()
        .map(|packet| BidirectionalPacketObservation {
            phone_key: packet.phone_key,
            phone_address: packet.phone_address,
            timestamp_ns: packet.timestamp_ns,
            source_address: packet.source_address,
            destination_address: packet.destination_address,
            payload_bytes: packet.payload_bytes,
        })
        .collect::<Vec<_>>();

    assert_eq!(
        aggregate_bidirectional_packets_by_fixed_minute(
            &packets,
            FixedMinuteBinAnchor::Undisclosed,
        ),
        Err(FixedMinutePacketAggregationError::BinAnchorUndisclosed)
    );

    let actual = aggregate_bidirectional_packets_by_fixed_minute(
        &packets,
        FixedMinuteBinAnchor::ExplicitTimestampNs(
            fixture.bounded_fixture_policy.anchor_timestamp_ns,
        ),
    )
    .expect("fixture-aligned minute aggregation must execute");
    let expected = fixture
        .expected
        .into_iter()
        .map(|aggregate| FixedMinutePacketAggregate {
            phone_key: aggregate.phone_key,
            external_address: aggregate.external_address,
            bin_start_timestamp_ns: aggregate.bin_start_timestamp_ns,
            payload_bytes: aggregate.payload_bytes,
        })
        .collect::<Vec<_>>();

    assert_eq!(actual, expected);
    assert_eq!(actual[0].payload_bytes, 42);
    assert_eq!(actual[1].bin_start_timestamp_ns, FIXED_MINUTE_NS);
}
