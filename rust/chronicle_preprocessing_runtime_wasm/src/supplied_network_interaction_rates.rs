//! RTT: traffic-smartphones-1879176.txt:423-431, last SYN to SYN-ACK.
//! Tap rate: zingaro-2024-ssrn.txt:1986-2005, session taps / seconds.
//! Supplied identities/stages are qualifications, not packet/session matching.
use super::supplied_anchor_elapsed_nanoseconds;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Stage {
    Rtt,
    TapRate,
}
impl Stage {
    pub(super) fn selected(active: &BTreeSet<&str>) -> Option<Self> {
        [Self::Rtt, Self::TapRate]
            .into_iter()
            .find(|s| active.contains(s.adapter_id()))
    }
    pub(super) fn adapter_id(self) -> &'static str {
        match self {
            Self::Rtt => "chronicle.supplied-last-syn-rtt",
            Self::TapRate => "chronicle.supplied-app-session-tap-rate",
        }
    }
    pub(super) fn result_kind(self) -> &'static str {
        match self {
            Self::Rtt => "literature-supplied-last-syn-rtt-csv",
            Self::TapRate => "literature-supplied-app-session-tap-rate-csv",
        }
    }
    fn outputs(self) -> &'static [&'static str] {
        match self {
            Self::Rtt => &["rtt_duration_in_declared_units", "rtt_status"],
            Self::TapRate => &["taps_per_second", "tap_rate_status"],
        }
    }
}
pub(super) const RTT_FIELDS: &[&str] = &[
    "source_row_id",
    "participant_id",
    "source_device_id",
    "source_stream_id",
    "source_stream_role",
    "source_platform",
    "clock_id",
    "time_unit",
    "time_precision",
    "input_stage",
    "transfer_id",
    "initial_syn_event_id",
    "initial_syn_transfer_id",
    "initial_syn_event_kind",
    "initial_syn_timestamp",
    "last_syn_event_id",
    "last_syn_transfer_id",
    "last_syn_event_kind",
    "last_syn_timestamp",
    "synack_event_id",
    "synack_transfer_id",
    "synack_event_kind",
    "synack_timestamp",
    "syn_selection_stage",
];
pub(super) const TAP_FIELDS: &[&str] = &[
    "source_row_id",
    "participant_id",
    "source_device_id",
    "source_stream_id",
    "source_stream_role",
    "source_platform",
    "clock_id",
    "time_unit",
    "time_precision",
    "input_stage",
    "app_session_id",
    "app_id",
    "total_taps",
    "session_duration_seconds",
];

/// A scalar denominator, not an integer count denominator. Preserve fractions.
/// Finite binary64 projection is explicit; do not silently round a tap count.
pub(super) fn taps_per_second(taps: u64, seconds: f64) -> Result<f64, &'static str> {
    if seconds == 0.0 {
        return Err("zero_duration_source_behavior_unknown");
    }
    if !seconds.is_finite() || seconds < 0.0 {
        return Err("invalid_duration_seconds");
    }
    let numerator = taps as f64;
    if numerator as u128 != u128::from(taps) {
        return Err("tap_count_not_exactly_representable_as_binary64");
    }
    let value = numerator / seconds;
    if !value.is_finite() {
        return Err("nonfinite_quotient");
    }
    Ok(value)
}

fn integer(raw: &str, field: &str) -> Result<Option<i64>, String> {
    if raw.is_empty() {
        return Ok(None);
    }
    raw.parse()
        .map(Some)
        .map_err(|_| format!("{field} requires exact i64 coordinates or an empty missing cell"))
}

pub(super) fn csv(raw: &[u8], stage: Stage) -> Result<(Vec<u8>, usize), String> {
    let mut reader = csv::ReaderBuilder::new()
        .trim(csv::Trim::None)
        .from_reader(raw);
    let headers = reader.headers().map_err(|e| e.to_string())?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() {
        return Err("duplicate CSV headers".into());
    }
    if headers.iter().any(|h| stage.outputs().contains(&h)) {
        return Err("supplied computed output columns are refused".into());
    }
    let fields = match stage {
        Stage::Rtt => RTT_FIELDS,
        Stage::TapRate => TAP_FIELDS,
    };
    let columns = fields
        .iter()
        .map(|field| {
            headers
                .iter()
                .position(|h| h == *field)
                .map(|i| (*field, i))
                .ok_or_else(|| format!("{} requires {field}", stage.adapter_id()))
        })
        .collect::<Result<BTreeMap<_, _>, _>>()?;
    let records = reader
        .records()
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut output_headers = headers.clone();
    output_headers.extend(stage.outputs().iter().copied());
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer
        .write_record(&output_headers)
        .map_err(|e| e.to_string())?;
    let mut scopes = BTreeMap::new();
    let mut device_owners = BTreeMap::new();
    let mut clocks = BTreeMap::new();
    let mut source_rows = BTreeMap::new();
    // Packet identity is device+packet, not a notification item or inferred flow.
    type PacketFacts = (String, String, String, String, String, String, Option<i64>);
    let mut packets: BTreeMap<_, PacketFacts> =
        BTreeMap::new();
    let mut transfers = BTreeMap::new();
    let mut sessions = BTreeMap::new();
    for record in &records {
        let value = |name: &str| &record[columns[name]];
        for name in [
            "source_row_id",
            "participant_id",
            "source_device_id",
            "source_stream_id",
        ] {
            if value(name).trim().is_empty() {
                return Err(format!("{name} must be nonempty"));
            }
        }
        if value("source_platform") != "Android" {
            return Err("requires explicitly Android supplied rows; mixed study results are not Android-only".into());
        }
        let participant = value("participant_id").to_owned();
        let device = value("source_device_id").to_owned();
        let scope = (device.clone(), value("source_stream_id").to_owned());
        if scopes
            .insert(participant.clone(), scope.clone())
            .is_some_and(|old| old != scope)
        {
            return Err("one stable device/source stream per participant is required".into());
        }
        if device_owners
            .insert(device.clone(), participant.clone())
            .is_some_and(|old| old != participant)
        {
            return Err("source device cannot change participant ownership".into());
        }
        let row_key = (participant.clone(), value("source_row_id").to_owned());
        if source_rows.get(&row_key).is_some_and(|old| old != record) {
            return Err("source row identity has conflicting lexical input".into());
        }
        source_rows.insert(row_key, record.clone());
        if !value("clock_id").trim().is_empty() {
            let clock = (value("clock_id").to_owned(), value("time_unit").to_owned());
            if clocks
                .insert(participant.clone(), clock.clone())
                .is_some_and(|old| old != clock)
            {
                return Err("declared participant stream clock/unit must stay stable".into());
            }
        }
        let mut output = record.clone();
        if stage == Stage::Rtt {
            if value("source_stream_role") != "caller_resolved_transfer_syn_anchors"
                || value("input_stage") != "caller-resolved-tcp-transfer"
                || value("syn_selection_stage") != "caller-qualified-last-syn"
                || !matches!(value("time_unit"), "ns" | "us" | "ms" | "s")
            {
                return Err("RTT requires explicit resolved transfer/last-SYN roles and coherent declared coordinate units".into());
            }
            if value("time_precision")
                .parse::<i64>()
                .ok()
                .filter(|v| *v > 0)
                .is_none()
            {
                return Err("RTT requires positive precision metadata in its declared unit".into());
            }
            let transfer = value("transfer_id");
            if transfer.trim().is_empty() {
                return Err("transfer_id must be supplied".into());
            }
            let mut times = Vec::new();
            for (prefix, role) in [
                ("initial_syn", "TCP_SYN"),
                ("last_syn", "TCP_SYN"),
                ("synack", "TCP_SYN_ACK"),
            ] {
                let event = value(&format!("{prefix}_event_id"));
                if event.trim().is_empty()
                    || value(&format!("{prefix}_transfer_id")) != transfer
                    || value(&format!("{prefix}_event_kind")) != role
                {
                    return Err("supplied initial/last SYN and SYN-ACK require matching transfer and exact packet roles".into());
                }
                let timestamp = integer(
                    value(&format!("{prefix}_timestamp")),
                    &format!("{prefix}_timestamp"),
                )?;
                let key = (device.clone(), event.to_owned());
                let mut identity = (
                    participant.clone(),
                    value("source_stream_id").to_owned(),
                    transfer.to_owned(),
                    role.to_owned(),
                    value("clock_id").to_owned(),
                    value("time_unit").to_owned(),
                    timestamp,
                );
                if let Some(prior) = packets.get(&key) {
                    let known_clock_conflict = !prior.4.trim().is_empty()
                        && !identity.4.trim().is_empty()
                        && prior.4 != identity.4;
                    let known_time_conflict =
                        matches!((prior.6, identity.6), (Some(a), Some(b)) if a != b);
                    if prior.0 != identity.0
                        || prior.1 != identity.1
                        || prior.2 != identity.2
                        || prior.3 != identity.3
                        || prior.5 != identity.5
                        || known_clock_conflict
                        || known_time_conflict
                    {
                        return Err("packet identity has conflicting transfer/role/device/clock/unit/time attribution".into());
                    }
                    // Keep known facts for contradiction checks only. Row inputs stay absent.
                    if identity.4.trim().is_empty() {
                        identity.4 = prior.4.clone();
                    }
                    identity.6 = identity.6.or(prior.6);
                }
                packets.insert(key, identity);
                times.push(timestamp);
            }
            // A resolved transfer has one qualified anchor tuple, not row snapshots.
            let key = (device.clone(), transfer.to_owned());
            let identity = (
                value("initial_syn_event_id").to_owned(),
                value("last_syn_event_id").to_owned(),
                value("synack_event_id").to_owned(),
            );
            if transfers.get(&key).is_some_and(|prior| prior != &identity) {
                return Err(
                    "transfer identity has conflicting qualified initial/last-SYN/SYN-ACK anchors"
                        .into(),
                );
            }
            transfers.insert(key, identity);
            // Initial SYN is retained context, never substituted for the last SYN.
            let result = if value("clock_id").trim().is_empty() {
                Err("missing_clock_id")
            } else if let (Some(initial), Some(last)) = (times[0], times[1]) {
                if initial > last {
                    Err("backward_supplied_syn_order")
                } else {
                    rtt(times[1], times[2])
                }
            } else {
                rtt(times[1], times[2])
            };
            match result {
                Ok(value) => {
                    output.push_field(&value.to_string());
                    output.push_field("computed_supplied_last_syn");
                }
                Err(reason) => {
                    output.push_field("");
                    output.push_field(&format!("unavailable:{reason}"));
                }
            }
        } else {
            if value("source_stream_role") != "caller_resolved_app_session_totals"
                || value("input_stage") != "caller-resolved-app-session-totals"
                || value("time_unit") != "s"
            {
                return Err(
                    "tap rate requires supplied app-session totals and explicit seconds".into(),
                );
            }
            if !value("time_precision")
                .parse::<f64>()
                .is_ok_and(|v| v.is_finite() && v > 0.0)
            {
                return Err(
                    "tap rate requires positive finite precision metadata in seconds".into(),
                );
            }
            for name in ["app_session_id", "app_id"] {
                if value(name).trim().is_empty() {
                    return Err(format!("{name} must be nonempty"));
                }
            }
            let taps = if value("total_taps").is_empty() {
                None
            } else {
                Some(
                    value("total_taps")
                        .parse::<u64>()
                        .map_err(|_| "total_taps requires unsigned integer counts")?,
                )
            };
            let seconds = if value("session_duration_seconds").is_empty() {
                None
            } else {
                Some(
                    value("session_duration_seconds")
                        .parse::<f64>()
                        .map_err(|_| "session_duration_seconds requires a numeric scalar")?,
                )
            };
            let key = (participant.clone(), value("app_session_id").to_owned());
            let identity = (
                device.clone(),
                value("source_stream_id").to_owned(),
                value("app_id").to_owned(),
                value("clock_id").to_owned(),
                value("total_taps").to_owned(),
                value("session_duration_seconds").to_owned(),
            );
            if sessions.get(&key).is_some_and(|prior| prior != &identity) {
                return Err(
                    "app-session identity has conflicting supplied app/device/clock/totals".into(),
                );
            }
            sessions.insert(key, identity);
            let result = if value("clock_id").trim().is_empty() {
                Err("missing_clock_id")
            } else {
                match (taps, seconds) {
                    (None, _) => Err("missing_total_taps"),
                    (_, None) => Err("missing_duration_seconds"),
                    (Some(taps), Some(seconds)) => taps_per_second(taps, seconds),
                }
            };
            match result {
                Ok(value) => {
                    output.push_field(&value.to_string());
                    output.push_field("computed_binary64_scalar_quotient");
                }
                Err(reason) => {
                    output.push_field("");
                    output.push_field(&format!("unavailable:{reason}"));
                }
            }
        }
        writer.write_record(&output).map_err(|e| e.to_string())?;
    }
    Ok((
        writer.into_inner().map_err(|e| e.to_string())?,
        records.len(),
    ))
}

fn rtt(last: Option<i64>, ack: Option<i64>) -> Result<i128, &'static str> {
    let last = last.ok_or("missing_last_syn_timestamp")?;
    let ack = ack.ok_or("missing_synack_timestamp")?;
    // Existing helper is pure widened subtraction; no unit conversion is made.
    let difference = supplied_anchor_elapsed_nanoseconds(last, ack);
    if difference < 0 {
        Err("synack_precedes_supplied_last_syn")
    } else {
        Ok(difference)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn oracle() -> Value {
        serde_json::from_str(include_str!(
            "../tests/fixtures/supplied_network_interaction_rates_hand_oracle.json"
        ))
        .unwrap()
    }
    fn lines(value: &Value) -> Vec<u8> {
        (value
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect::<Vec<_>>()
            .join("\n")
            + "\n")
            .into_bytes()
    }
    fn input(index: usize) -> Vec<u8> {
        lines(&oracle()["cases"][index]["raw_csv_lines"])
    }
    fn edited(index: usize, row: usize, field: &str, replacement: &str) -> Vec<u8> {
        let input = input(index);
        let mut reader = csv::Reader::from_reader(input.as_slice());
        let headers = reader.headers().unwrap().clone();
        let column = headers.iter().position(|h| h == field).unwrap();
        let mut writer = csv::Writer::from_writer(Vec::new());
        writer.write_record(&headers).unwrap();
        for (i, record) in reader.records().enumerate() {
            let record = record.unwrap();
            writer
                .write_record(record.iter().enumerate().map(|(j, v)| {
                    if i == row && j == column {
                        replacement
                    } else {
                        v
                    }
                }))
                .unwrap();
        }
        writer.into_inner().unwrap()
    }
    #[test]
    fn csv_requires_unique_raw_headers_and_refuses_computed_inputs() {
        for (index, stage) in [(0, Stage::Rtt), (1, Stage::TapRate)] {
            let input = input(index);
            let text = String::from_utf8(input).unwrap();
            let duplicate = text.replacen("participant_id", "source_row_id", 1);
            assert!(csv(duplicate.as_bytes(), stage).is_err());
            let computed = text
                .lines()
                .enumerate()
                .map(|(i, line)| {
                    format!("{line},{}", if i == 0 { stage.outputs()[0] } else { "0" })
                })
                .collect::<Vec<_>>()
                .join("\n")
                + "\n";
            assert!(csv(computed.as_bytes(), stage).is_err());
            let missing = text.replacen("source_stream_id", "omitted_source_stream_id", 1);
            assert!(csv(missing.as_bytes(), stage).is_err());
        }
    }
    #[test]
    fn independent_hand_csv_oracles_preserve_every_lexical_input_row() {
        for (index, stage) in [(0, Stage::Rtt), (1, Stage::TapRate)] {
            let (bytes, count) = csv(&input(index), stage).unwrap();
            assert_eq!(
                bytes,
                lines(&oracle()["cases"][index]["expected_csv_lines"])
            );
            assert_eq!(count, if index == 0 { 4 } else { 7 });
        }
    }
    #[test]
    fn exact_elapsed_reuse_full_range_last_syn_ties_and_missingness() {
        assert_eq!(rtt(Some(2), Some(5)).unwrap(), 3);
        assert_eq!(
            rtt(Some(i64::MIN), Some(i64::MAX)).unwrap(),
            18_446_744_073_709_551_615_i128
        );
        assert_eq!(rtt(Some(-1), Some(-1)).unwrap(), 0);
        assert_eq!(rtt(None, Some(5)), Err("missing_last_syn_timestamp"));
        assert_eq!(rtt(Some(2), None), Err("missing_synack_timestamp"));
        assert_eq!(
            rtt(Some(5), Some(2)),
            Err("synack_precedes_supplied_last_syn")
        );
        let (bytes, _) = csv(&edited(0, 0, "clock_id", ""), Stage::Rtt).unwrap();
        assert!(String::from_utf8(bytes)
            .unwrap()
            .contains("unavailable:missing_clock_id"));
        // Initial history is not necessary for the already qualified last pair.
        let (bytes, _) = csv(&edited(0, 0, "initial_syn_timestamp", ""), Stage::Rtt).unwrap();
        assert!(String::from_utf8(bytes)
            .unwrap()
            .contains(",3,computed_supplied_last_syn"));
    }
    #[test]
    fn scalar_quotient_never_integer_truncates_duration_or_imputes_zero() {
        assert_eq!(taps_per_second(6, 3.0).unwrap(), 2.0);
        assert_eq!(taps_per_second(3, 1.5).unwrap(), 2.0);
        assert_eq!(taps_per_second(7, 2.5).unwrap(), 2.8);
        assert_eq!(taps_per_second(0, 3.0).unwrap(), 0.0);
        assert_eq!(
            taps_per_second(6, 0.0),
            Err("zero_duration_source_behavior_unknown")
        );
        assert_eq!(
            taps_per_second(6, -0.0),
            Err("zero_duration_source_behavior_unknown")
        );
        for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, -1.0] {
            assert_eq!(taps_per_second(6, value), Err("invalid_duration_seconds"));
        }
        assert_eq!(taps_per_second(6, 1e-308), Err("nonfinite_quotient"));
        assert_eq!(
            taps_per_second(u64::MAX, 1.0),
            Err("tap_count_not_exactly_representable_as_binary64")
        );
        let (bytes, _) = csv(
            &edited(1, 0, "session_duration_seconds", "NaN"),
            Stage::TapRate,
        )
        .unwrap();
        assert!(String::from_utf8(bytes)
            .unwrap()
            .contains("unavailable:invalid_duration_seconds"));
    }
    #[test]
    fn rtt_requires_supplied_transfer_packet_clock_units_and_last_syn_roles() {
        for (row, field, value) in [
            (0, "last_syn_transfer_id", "foreign"),
            (0, "synack_event_kind", "TCP_ACK"),
            (0, "syn_selection_stage", "automatic-retry-choice"),
            (0, "input_stage", "raw-tcp"),
            (0, "source_platform", "Windows Mobile"),
            (0, "source_stream_role", "all-packets"),
            (0, "time_unit", "ticks"),
            (0, "time_precision", "0"),
            (0, "last_syn_timestamp", "2.5"),
            (0, "synack_event_id", "l1"),
            (2, "initial_syn_event_id", "i1"),
            (2, "clock_id", "other"),
            (2, "source_device_id", "other"),
            (2, "source_stream_id", "other"),
            (2, "time_unit", "ms"),
            (2, "source_row_id", "r1"),
            (1, "source_device_id", "dA"),
        ] {
            assert!(
                csv(&edited(0, row, field, value), Stage::Rtt).is_err(),
                "{field}={value}"
            );
        }
        let (bytes, _) = csv(&edited(0, 0, "last_syn_timestamp", "6"), Stage::Rtt).unwrap();
        assert!(String::from_utf8(bytes)
            .unwrap()
            .contains("unavailable:synack_precedes_supplied_last_syn"));
    }
    #[test]
    fn one_resolved_transfer_cannot_declare_conflicting_qualified_anchors() {
        let append_first_to = |raw: &[u8], changes: &[(&str, &str)]| {
            let mut reader = csv::Reader::from_reader(raw);
            let headers = reader.headers().unwrap().clone();
            let records = reader.records().collect::<Result<Vec<_>, _>>().unwrap();
            let mut appended = records[0].iter().map(str::to_owned).collect::<Vec<_>>();
            appended[headers.iter().position(|h| h == "source_row_id").unwrap()] = "r5".into();
            for (field, value) in changes {
                appended[headers.iter().position(|h| h == *field).unwrap()] = (*value).into();
            }
            let mut writer = csv::Writer::from_writer(Vec::new());
            writer.write_record(&headers).unwrap();
            for record in &records {
                writer.write_record(record).unwrap();
            }
            writer.write_record(appended).unwrap();
            writer.into_inner().unwrap()
        };
        let append_first = |changes: &[(&str, &str)]| append_first_to(&input(0), changes);
        // A new source row may repeat the same resolved transfer declaration.
        let (_, count) = csv(&append_first(&[]), Stage::Rtt).unwrap();
        assert_eq!(count, 5);
        // Fresh packet IDs evade packet-key checks, but cannot redefine f1's last SYN.
        let conflicting = append_first(&[
            ("last_syn_event_id", "l5"),
            ("last_syn_timestamp", "4"),
            ("synack_event_id", "a5"),
        ]);
        assert!(csv(&conflicting, Stage::Rtt)
            .unwrap_err()
            .contains("transfer identity"));
        // A different ACK under the same qualified transfer is contradictory too.
        let conflicting_ack = append_first(&[("synack_event_id", "a5")]);
        assert!(csv(&conflicting_ack, Stage::Rtt)
            .unwrap_err()
            .contains("transfer identity"));
        for (field, status) in [
            (
                "last_syn_timestamp",
                "unavailable:missing_last_syn_timestamp",
            ),
            ("synack_timestamp", "unavailable:missing_synack_timestamp"),
            ("clock_id", "unavailable:missing_clock_id"),
        ] {
            let (bytes, count) = csv(&append_first(&[(field, "")]), Stage::Rtt).unwrap();
            assert_eq!(count, 5);
            let mut reader = csv::Reader::from_reader(bytes.as_slice());
            let headers = reader.headers().unwrap().clone();
            let last = reader.records().last().unwrap().unwrap();
            assert_eq!(&last[headers.iter().position(|h| h == field).unwrap()], "");
            assert_eq!(&last[headers.len() - 2], "");
            assert_eq!(&last[headers.len() - 1], status);
        }
        // Missing history is not zero and never erases a previously known fact.
        let missing_middle = append_first(&[("last_syn_timestamp", "")]);
        let later_conflict = append_first_to(
            &missing_middle,
            &[("source_row_id", "r6"), ("last_syn_timestamp", "4")],
        );
        assert!(csv(&later_conflict, Stage::Rtt)
            .unwrap_err()
            .contains("packet identity"));
        // An unknown declaration preceding the known one also retains its absence.
        let unknown_first = edited(0, 0, "last_syn_timestamp", "");
        let known_later = append_first_to(&unknown_first, &[("last_syn_timestamp", "2")]);
        let (bytes, _) = csv(&known_later, Stage::Rtt).unwrap();
        let text = String::from_utf8(bytes).unwrap();
        assert!(text.contains("unavailable:missing_last_syn_timestamp"));
        assert!(text
            .lines()
            .last()
            .unwrap()
            .ends_with(",3,computed_supplied_last_syn"));
    }
    #[test]
    fn tap_rate_keeps_exact_session_attribution_and_scalar_domains() {
        for (row, field, value) in [
            (0, "time_unit", "ms"),
            (0, "time_precision", "NaN"),
            (0, "source_platform", "iOS"),
            (0, "total_taps", "1.5"),
            (0, "total_taps", "-1"),
            (0, "total_taps", "18446744073709551616"),
            (0, "session_duration_seconds", "unknown"),
            (0, "input_stage", "raw-taps"),
            (0, "source_stream_role", "one-second-bins"),
            (0, "app_id", ""),
            (2, "clock_id", "other"),
            (2, "app_session_id", "s1"),
            (2, "source_device_id", "other"),
            (2, "source_stream_id", "other"),
        ] {
            assert!(
                csv(&edited(1, row, field, value), Stage::TapRate).is_err(),
                "{field}={value}"
            );
        }
    }
    #[test]
    fn duplicate_rows_and_precision_metadata_are_preserved_not_normalized() {
        for (index, stage) in [(0, Stage::Rtt), (1, Stage::TapRate)] {
            let mut raw = input(index);
            let first = oracle()["cases"][index]["raw_csv_lines"][1]
                .as_str()
                .unwrap()
                .to_owned();
            raw.extend_from_slice((first + "\n").as_bytes());
            let (_, count) = csv(&raw, stage).unwrap();
            assert_eq!(count, if index == 0 { 5 } else { 8 });
            assert!(csv(&edited(index, 0, "time_precision", "0"), stage).is_err());
        }
        assert!(csv(&edited(0, 0, "time_precision", "999"), Stage::Rtt).is_ok());
        assert!(csv(&edited(1, 0, "time_precision", "0.7"), Stage::TapRate).is_ok());
    }
}
