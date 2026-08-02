//! Chronicle preprocessing algorithms shared by the native test oracle and
//! the production 55-query Salsa runtime.
//!
//! This crate is not a browser API. The only production JavaScript boundary
//! is `chronicle_preprocessing_runtime_wasm`.

use chrono::{DateTime, NaiveDateTime, TimeZone};
use chrono_tz::Tz;

pub mod pipeline_v2;
pub mod step_contract;

pub(crate) fn weekday_chronicle(weekday: chrono::Weekday) -> u8 {
    match weekday {
        chrono::Weekday::Sun => 1,
        chrono::Weekday::Mon => 2,
        chrono::Weekday::Tue => 3,
        chrono::Weekday::Wed => 4,
        chrono::Weekday::Thu => 5,
        chrono::Weekday::Fri => 6,
        chrono::Weekday::Sat => 7,
    }
}

/// Canonical interaction types accepted by the pipeline after normalization.
///
/// Browser controls are generated from this list through the Rust step
/// contract; TypeScript must not keep a second copy of this vocabulary.
pub const CANONICAL_INTERACTION_TYPES: &[&str] = &[
    "Activity Destroyed",
    "Activity Paused",
    "Activity Resumed",
    "Activity Stopped",
    "App Component Used",
    "App Usage",
    "Chooser Action",
    "Configuration Change",
    "Continue Previous Day",
    "Continuing Foreground Service",
    "Device Shutdown",
    "Device Startup",
    "End of Day",
    "End of Usage Missing",
    "Filtered App Paused",
    "Filtered App Resumed",
    "Filtered App Usage",
    "Flush to Disk",
    "Foreground Service Start",
    "Foreground Service Stop",
    "Keyguard Hidden",
    "Keyguard Shown",
    "Locus ID Set",
    "Notification Interruption",
    "Notification Seen",
    "Rollover Foreground Service",
    "Screen Interactive",
    "Screen Non-Interactive",
    "Screen Usage",
    "Shortcut Invocation",
    "Slice Pinned App",
    "Slice Pinned Priv",
    "Standby Bucket Changed",
    "System Interaction",
    "User Interaction",
    "User Stopped",
    "User Unlocked",
];

/// Maps raw Chronicle Android interaction codes to the canonical values used
/// by the production pipeline.
pub fn normalize_interaction_type(value: &str) -> &str {
    match value {
        "Instance of Usage for an App" => "App Usage",
        "Screen Usage" => "Screen Usage",
        "Activity Resumed for a Filtered App" => "Filtered App Resumed",
        "Activity Paused for a Filtered App" => "Filtered App Paused",
        "Instance of Usage for a Filtered App" => "Filtered App Usage",
        "Missing End of Usage after an App Starts Being Used" => "End of Usage Missing",
        "Unknown importance: 1" | "Move to Foreground" => "Activity Resumed",
        "Unknown importance: 2" | "Move to Background" => "Activity Paused",
        "Unknown importance: 3" => "End of Day",
        "Unknown importance: 4" => "Continue Previous Day",
        "Unknown importance: 5" => "Configuration Change",
        "Unknown importance: 6" => "System Interaction",
        "Unknown importance: 7" => "User Interaction",
        "Unknown importance: 8" => "Shortcut Invocation",
        "Unknown importance: 9" => "Chooser Action",
        "Unknown importance: 10" => "Notification Seen",
        "Unknown importance: 11" => "Standby Bucket Changed",
        "Unknown importance: 12" => "Notification Interruption",
        "Unknown importance: 13" => "Slice Pinned Priv",
        "Unknown importance: 14" => "Slice Pinned App",
        "Unknown importance: 15" => "Screen Interactive",
        "Unknown importance: 16" => "Screen Non-Interactive",
        "Unknown importance: 17" => "Keyguard Shown",
        "Unknown importance: 18" => "Keyguard Hidden",
        "Unknown importance: 19" => "Foreground Service Start",
        "Unknown importance: 20" => "Foreground Service Stop",
        "Unknown importance: 21" => "Continuing Foreground Service",
        "Unknown importance: 22" => "Rollover Foreground Service",
        "Unknown importance: 23" => "Activity Stopped",
        "Unknown importance: 24" => "Activity Destroyed",
        "Unknown importance: 25" => "Flush to Disk",
        "Unknown importance: 26" => "Device Shutdown",
        "Unknown importance: 27" => "Device Startup",
        "Unknown importance: 28" => "User Unlocked",
        "Unknown importance: 29" => "User Stopped",
        "Unknown importance: 30" => "Locus ID Set",
        "Unknown importance: 31" => "App Component Used",
        other => other,
    }
}

/// True when the value is either a supported Android spelling or a canonical
/// value produced by [`normalize_interaction_type`].
pub fn is_recognized_interaction_type(value: &str) -> bool {
    normalize_interaction_type(value) != value || CANONICAL_INTERACTION_TYPES.contains(&value)
}

pub fn is_valid_chronicle_timezone(value: &str) -> bool {
    value.parse::<Tz>().is_ok()
}

pub fn parse_chronicle_timestamp_ns(value: &str) -> Option<i64> {
    if value.is_empty() {
        return None;
    }
    let mut normalized = value.replace('T', " ");
    if let Some(stripped) = normalized.strip_suffix('Z') {
        normalized = format!("{stripped}+00:00");
    }
    let has_offset = normalized
        .rfind(['+', '-'])
        .is_some_and(|index| index >= 19);
    let parsed: Option<DateTime<chrono::FixedOffset>> = if has_offset {
        DateTime::parse_from_str(&normalized, "%Y-%m-%d %H:%M:%S%:z")
            .or_else(|_| DateTime::parse_from_str(&normalized, "%Y-%m-%d %H:%M:%S%.f%:z"))
            .ok()
    } else {
        let utc = chrono::FixedOffset::east_opt(0).expect("zero UTC offset is valid");
        NaiveDateTime::parse_from_str(&normalized, "%Y-%m-%d %H:%M:%S")
            .or_else(|_| NaiveDateTime::parse_from_str(&normalized, "%Y-%m-%d %H:%M:%S%.f"))
            .ok()
            .and_then(|timestamp| utc.from_local_datetime(&timestamp).single())
    };
    parsed.map(|timestamp| timestamp.timestamp_nanos_opt().unwrap_or(0))
}

fn needs_csv_quoting(bytes: &[u8]) -> bool {
    bytes
        .iter()
        .any(|byte| matches!(byte, b',' | b'"' | b'\n' | b'\r'))
}

pub(crate) fn write_csv_field(output: &mut Vec<u8>, field: &[u8]) {
    if !needs_csv_quoting(field) {
        output.extend_from_slice(field);
        return;
    }
    output.push(b'"');
    for &byte in field {
        if byte == b'"' {
            output.extend_from_slice(b"\"\"");
        } else {
            output.push(byte);
        }
    }
    output.push(b'"');
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn weekday_mapping_covers_the_complete_chronicle_domain() {
        use chrono::Weekday::*;
        assert_eq!(
            [Sun, Mon, Tue, Wed, Thu, Fri, Sat].map(weekday_chronicle),
            [1, 2, 3, 4, 5, 6, 7],
        );
    }

    #[test]
    fn interaction_recognition_distinguishes_alias_canonical_and_unknown_values() {
        assert_eq!(
            normalize_interaction_type("Unknown importance: 1"),
            "Activity Resumed"
        );
        assert!(is_recognized_interaction_type("Unknown importance: 1"));
        assert!(is_recognized_interaction_type("Activity Resumed"));
        assert!(!is_recognized_interaction_type(
            "Researcher-specific marker"
        ));
    }

    #[test]
    fn timezone_validation_accepts_iana_and_utc_but_rejects_unknown_values() {
        assert!(is_valid_chronicle_timezone("UTC"));
        assert!(is_valid_chronicle_timezone("America/Chicago"));
        assert!(!is_valid_chronicle_timezone("Not/AZone"));
        assert!(!is_valid_chronicle_timezone(""));
    }

    #[test]
    fn csv_fields_are_quoted_and_escaped_exactly_when_rfc4180_requires_it() {
        let render = |field: &str| {
            let mut out = Vec::new();
            write_csv_field(&mut out, field.as_bytes());
            String::from_utf8(out).expect("CSV field stays UTF-8")
        };

        // Plain values are emitted verbatim. Quoting every field instead would
        // change every column of every researcher-facing output file.
        assert_eq!(render("com.example.chat"), "com.example.chat");
        assert_eq!(render(""), "");
        assert_eq!(render(" leading and trailing "), " leading and trailing ");

        // A separator, quote, or record terminator inside a value must be
        // quoted, and an embedded quote must be doubled, or reading the file
        // back silently gains a column or a row.
        assert_eq!(render("Chat, Inc"), "\"Chat, Inc\"");
        assert_eq!(render("say \"hi\""), "\"say \"\"hi\"\"\"");
        assert_eq!(render("\"\""), "\"\"\"\"\"\"");
        assert_eq!(render("line1\nline2"), "\"line1\nline2\"");
        assert_eq!(render("line1\r\nline2"), "\"line1\r\nline2\"");

        // Round trip through a real reader: the emitted record must decode to
        // the original cells.
        let mut record = Vec::new();
        write_csv_field(&mut record, b"Chat, \"Bot\"");
        record.push(b',');
        write_csv_field(&mut record, b"plain");
        record.push(b'\n');
        let mut reader = csv::ReaderBuilder::new()
            .has_headers(false)
            .from_reader(record.as_slice());
        let decoded = reader
            .records()
            .next()
            .expect("one record")
            .expect("well-formed record");
        assert_eq!(decoded.len(), 2);
        assert_eq!(&decoded[0], "Chat, \"Bot\"");
        assert_eq!(&decoded[1], "plain");
    }

    #[test]
    fn chronicle_timestamps_parse_every_accepted_spelling_and_reject_the_rest() {
        // Naive timestamps are read as UTC; the four accepted spellings must
        // land on the same instant so an export's offset notation cannot shift
        // a participant's event.
        let base = parse_chronicle_timestamp_ns("2026-03-07 10:00:00").expect("naive timestamp");
        // 20454 days from the epoch to 2026-01-01, +65 days to 2026-03-07,
        // +10 h = 1_772_877_600 s.
        assert_eq!(base, 1_772_877_600_000_000_000);
        assert_eq!(
            parse_chronicle_timestamp_ns("2026-03-07T10:00:00Z"),
            Some(base)
        );
        assert_eq!(
            parse_chronicle_timestamp_ns("2026-03-07 10:00:00+00:00"),
            Some(base)
        );
        assert_eq!(
            parse_chronicle_timestamp_ns("2026-03-07 04:00:00-06:00"),
            Some(base)
        );
        // Fractional seconds are kept at nanosecond resolution, which is what
        // duplicate-timestamp nudging depends on.
        assert_eq!(
            parse_chronicle_timestamp_ns("2026-03-07 10:00:00.000001"),
            Some(base + 1_000)
        );
        assert_eq!(
            parse_chronicle_timestamp_ns("2026-03-07 10:00:00.000001+00:00"),
            Some(base + 1_000)
        );

        for rejected in [
            "",
            "not-a-timestamp",
            "2026-03-07",
            "2026-13-07 10:00:00",
            "03/07/2026 10:00:00",
        ] {
            assert_eq!(
                parse_chronicle_timestamp_ns(rejected),
                None,
                "{rejected:?} must not parse",
            );
        }
    }
}
