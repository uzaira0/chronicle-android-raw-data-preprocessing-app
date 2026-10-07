//! Independent hand arithmetic from retained primary sections, not participant data.
//! Okoshi2017 pp8 VIII-C2/3: content arrival→post and post→click;
//! .tmp-literature-review-private/open-index-exact-keyword-wave6/retrieved/text/10.1109_percom.2017.7917856.txt, SHA256 97ad08520de0369cebde81e4790c17fbca640ce520f6763c4789491d4597588a.
//! LargeScaleNotifications2014 p4 Click time: presentation→explicit drawer click;
//! .tmp-literature-review-private/wave3-reference-frontier-followup-wave7/artifacts/extracted/10.1145_2556288.2557189.txt, SHA256 c6054a1f743fb8738cab87925ed39cdfe93466374064557e77ff503c458823a9.
//! ContentNotifications2015 p3 Table1: arrival→removal, not inferred tap;
//! .tmp-literature-review-private/reference-frontier-packet08-wave4/retrieved/designing-notifications-2015.txt, SHA256 dc9cd6e8924d0ca4e55fec6e8c6a37c9f6dad6b5c954ffa6e0cf3e5d230c6753.

use chronicle_preprocessing_runtime_wasm::literature_input_adapters::{
    adapt_literature_inputs, literature_component_execution_unit,
};
use sha2::{Digest, Sha256};

const OKOSHI: &str = "chronicle.okoshi-notification-latencies/v1";
const CLICK: &str = "chronicle.large-scale-notification-click-time/v1";
const REMOVE: &str = "chronicle.content-notification-removal-time/v1";
const HEADER: [&str; 15] = [
    "source_row_id", "measurement", "start_participant_id", "end_participant_id",
    "start_notification_id", "end_notification_id", "start_event_id", "end_event_id",
    "start_event_kind", "end_event_kind", "start_clock_id", "end_clock_id",
    "start_timestamp_ns", "end_timestamp_ns", "anchor_pairing_stage",
];

fn row(component: &str, start: i64, end: i64) -> Vec<String> {
    let (measurement, first, last) = match component {
        OKOSHI => ("delivery_delay", "content_arrival_at_client", "notification_posting"),
        CLICK => ("click_time", "notification_presentation", "notification_drawer_click"),
        REMOVE => ("arrival_to_removal_latency", "notification_bar_arrival", "notification_bar_removal"),
        _ => panic!("test component not specified"),
    };
    ["r", measurement, "p", "p", "n", "n", "first", "last", first, last, "clock", "clock", &start.to_string(), &end.to_string(), "caller-resolved"]
        .into_iter().map(str::to_owned).collect()
}

fn transport(rows: &[Vec<String>]) -> Vec<u8> {
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(HEADER).unwrap();
    for row in rows { writer.write_record(row).unwrap(); }
    writer.into_inner().unwrap()
}

fn adapt(component: &str, raw: &[u8]) -> Result<(Vec<u8>, u32, u32), String> {
    let (registration, bindings) = literature_component_execution_unit(component)?;
    assert_eq!(registration.full_profile_execution_status, "blocked");
    assert_eq!(bindings.len(), 1, "only the bounded source formula is owned");
    let digest = format!("sha256:{}", hex::encode(Sha256::digest(raw)));
    let result = adapt_literature_inputs(raw, &digest, &bindings, |_| &[])?
        .ok_or("missing source component output")?;
    assert_eq!(result.receipt.original_input_digest, digest);
    assert_eq!(result.receipt.source_oracle_id, Some(registration.source_oracle_id));
    assert_eq!(result.receipt.materialized_interval_count, 0);
    assert_eq!(result.receipt.duplicate_source_ids_removed, 0);
    Ok((result.derived_result_bytes.ok_or("missing derived CSV")?, result.receipt.source_row_count, result.receipt.emitted_row_count))
}

fn outputs(bytes: &[u8]) -> Vec<csv::StringRecord> {
    csv::Reader::from_reader(bytes).records().collect::<Result<_, _>>().unwrap()
}

#[test]
fn separate_delivery_and_response_anchors_share_only_the_posted_event() {
    let mut delivery = row(OKOSHI, 100_000_000_000, 110_000_000_000);
    delivery[6] = "arrival".into(); delivery[7] = "post".into();
    let mut response = row(OKOSHI, 110_000_000_000, 140_000_000_000);
    response[0] = "response".into(); response[1] = "response_latency".into();
    response[6] = "post".into(); response[7] = "click".into();
    response[8] = "notification_posting".into(); response[9] = "notification_user_click".into();
    let (bytes, input, emitted) = adapt(OKOSHI, &transport(&[delivery, response])).unwrap();
    assert_eq!((input, emitted), (2, 2));
    let rows = outputs(&bytes);
    assert_eq!((&rows[0][15], &rows[0][16]), ("10000000000", "10"));
    assert_eq!((&rows[1][15], &rows[1][16]), ("30000000000", "30"));
}

#[test]
fn click_and_removal_definitions_remain_distinct_despite_equivalent_subtraction() {
    for (component, end, ns, seconds) in [(CLICK, 40_000_000_000, "30000000000", "30"), (REMOVE, 25_000_000_000, "15000000000", "15")] {
        let bytes = adapt(component, &transport(&[row(component, 10_000_000_000, end)])).unwrap().0;
        let rows = outputs(&bytes);
        assert_eq!((&rows[0][15], &rows[0][16]), (ns, seconds));
        let mut wrong = row(component, 0, 1);
        wrong[9] = if component == CLICK { "notification_bar_removal" } else { "notification_drawer_click" }.into();
        assert!(adapt(component, &transport(&[wrong])).unwrap_err().contains("endpoint kinds"));
    }
}

#[test]
fn exact_signed_arithmetic_has_no_clamp_censor_rounding_or_overflow() {
    // These are signed arithmetic outputs, not claims about source population admission.
    for (start, end, ns, seconds) in [
        (1, 0, "-1", "-0.000000001"),
        (1_500_000_000, 1_000_000_000, "-500000000", "-0.5"),
        (0, 1, "1", "0.000000001"),
        (0, 0, "0", "0"),
        (0, 4_000_000_000_000, "4000000000000", "4000"),
        (i64::MIN, i64::MAX, "18446744073709551615", "18446744073.709551615"),
        (i64::MAX, i64::MIN, "-18446744073709551615", "-18446744073.709551615"),
    ] {
        let rows = outputs(&adapt(OKOSHI, &transport(&[row(OKOSHI, start, end)])).unwrap().0);
        assert_eq!((&rows[0][15], &rows[0][16]), (ns, seconds));
    }
}

#[test]
fn pair_identity_and_clock_are_required_not_inferred() {
    for (column, value) in [(3, "other-person"), (5, "other-notification"), (11, "other-clock"), (14, "first-attendance-inferred"), (6, "last"), (1, "arrival_to_removal_latency"), (12, "1.0"), (13, ""), (7, " ")] {
        let mut input = row(CLICK, 0, 1);
        input[column] = value.into();
        assert!(adapt(CLICK, &transport(&[input])).is_err(), "column {} must fail", HEADER[column]);
    }
}

#[test]
fn reused_event_identity_cannot_change_notification_clock_kind_or_timestamp() {
    for column in [4, 10, 12] {
        let first = row(CLICK, 0, 1);
        let mut second = first.clone(); second[0] = "second".into();
        match column {
            4 => { second[4] = "other".into(); second[5] = "other".into(); },
            10 => { second[10] = "other".into(); second[11] = "other".into(); },
            12 => second[12] = "2".into(),
            _ => unreachable!(),
        }
        assert!(adapt(CLICK, &transport(&[first, second])).unwrap_err().contains("conflicting supplied event attribution"));
    }
}

#[test]
fn duplicates_and_participant_scopes_are_preserved_without_constructing_missing_pairs() {
    let first = row(REMOVE, 10, 20);
    let mut other = first.clone(); other[2] = "other".into(); other[3] = "other".into();
    let (bytes, input, emitted) = adapt(REMOVE, &transport(&[first.clone(), first, other])).unwrap();
    assert_eq!((input, emitted), (3, 3));
    let rows = outputs(&bytes); assert_eq!(rows[0], rows[1]); assert_eq!(&rows[2][2], "other");
    let (bytes, input, emitted) = adapt(REMOVE, &transport(&[])).unwrap();
    assert_eq!((input, emitted), (0, 0)); assert!(outputs(&bytes).is_empty());
}

#[test]
fn supplied_elapsed_outputs_and_duplicate_headers_cannot_replace_typed_anchors() {
    for suffix in [",elapsed_seconds", ",elapsed_nanoseconds", ",start_timestamp_ns"] {
        let header = HEADER.join(",") + suffix + "\n";
        assert!(adapt(CLICK, header.as_bytes()).is_err());
    }
}
