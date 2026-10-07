//! Structure-aware input for the `structured_workspace` fuzz target.
//!
//! Raw fuzz bytes almost never survive `RuntimeRequest` parsing
//! (`deny_unknown_fields`, required option keys, digest checks), so a byte-level
//! target would spend its whole budget on the first `serde_json` error. This
//! module turns an `Arbitrary` value into a well-formed Chronicle CSV and an
//! `ExecuteWorkspace` request whose `inputSha256` matches it, so every run
//! reaches `execute_workspace_native`'s ingress and pipeline stages. The tests
//! below pin that the generated request is admitted.
//!
//! [`journal`] holds the input for the `closure_evidence_journal` target.

pub mod journal;

use arbitrary::Arbitrary;
use chronicle_preprocessing_runtime_wasm::{
    execute_workspace_native, scientific_preflight_native, RuntimeHandle, RuntimeSupportFiles,
    EXECUTE_WORKSPACE_COMMAND, RUNTIME_PROTOCOL_VERSION,
};
use sha2::{Digest, Sha256};

pub const MAX_ROWS: usize = 64;

const INTERACTIONS: [&str; 9] = [
    "Activity Resumed",
    "Activity Paused",
    "Activity Stopped",
    "Device Shutdown",
    "Device Startup",
    "Screen Interactive",
    "Screen Non-interactive",
    "Keyguard Hidden",
    "Unknown importance: 1",
];

const TIMEZONES: [&str; 3] = ["America/Chicago", "Etc/UTC", "America/New_York"];

#[derive(Debug, Clone, Arbitrary)]
pub struct FuzzRow {
    pub participant: u8,
    pub application: String,
    pub package: String,
    pub interaction: u8,
    pub month: u8,
    pub day: u8,
    pub hour: u8,
    pub minute: u8,
    pub second: u8,
    pub timezone: u8,
}

#[derive(Debug, Clone, Arbitrary)]
pub struct StructuredWorkspaceInput {
    #[arbitrary(with = |u: &mut arbitrary::Unstructured| {
        let len = u.int_in_range(0..=MAX_ROWS)?;
        (0..len)
            .map(|_| u.arbitrary::<FuzzRow>())
            .collect::<arbitrary::Result<Vec<_>>>()
    })]
    pub rows: Vec<FuzzRow>,
    pub include_screen_output: bool,
    pub allow_stop_event_reuse: bool,
    pub use_activity_stopped_as_fallback: bool,
    pub apply_threshold_to_fallback: bool,
    pub model_concurrent_usage: bool,
    pub enable_aggregates: bool,
    pub proximity_seconds: u8,
}

fn bounded_ascii(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_ascii_graphic() || *ch == ' ')
        .take(64)
        .collect()
}

fn digest(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

/// A Chronicle raw export with the required columns and bounded field values.
pub fn synthetic_csv(input: &StructuredWorkspaceInput) -> Vec<u8> {
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer
        .write_record([
            "study_id",
            "participant_id",
            "username",
            "application_label",
            "interaction_type",
            "app_package_name",
            "event_timestamp",
            "timezone",
        ])
        .expect("in-memory CSV header");
    for row in input.rows.iter().take(MAX_ROWS) {
        let interaction = INTERACTIONS[usize::from(row.interaction) % INTERACTIONS.len()];
        let timezone = TIMEZONES[usize::from(row.timezone) % TIMEZONES.len()];
        // January-March 2026: real exports span at most 84 days, and this
        // window still crosses the US daylight-saving start (March 8). A
        // multi-decade span only makes per-day stages slow, not more varied.
        let timestamp = format!(
            "2026-{:02}-{:02} {:02}:{:02}:{:02}",
            1 + row.month % 3,
            1 + row.day % 28,
            row.hour % 24,
            row.minute % 60,
            row.second % 60,
        );
        writer
            .write_record([
                "Synthetic Study",
                &format!("P{:03}", row.participant % 4),
                "Synthetic User",
                &bounded_ascii(&row.application),
                interaction,
                &bounded_ascii(&row.package),
                &timestamp,
                timezone,
            ])
            .expect("in-memory CSV row");
    }
    writer.into_inner().expect("in-memory CSV flush")
}

/// An `ExecuteWorkspace` request for `csv`, carrying every option key the
/// runtime requires (the options document refuses unknown keys).
pub fn workspace_request_json(input: &StructuredWorkspaceInput, csv: &[u8]) -> String {
    let usage_session_mode = if input.include_screen_output {
        "app_and_screen_usage"
    } else {
        "app_usage"
    };
    serde_json::json!({
        "protocolVersion": RUNTIME_PROTOCOL_VERSION,
        "requestId": "fuzz-request",
        "command": EXECUTE_WORKSPACE_COMMAND,
        "workspaceRootDigest": null,
        "workspaceId": format!("sha256:{}", "a".repeat(64)),
        "inputFileName": "synthetic.csv",
        "inputSha256": digest(csv),
        "options": {
            "study_name": "Synthetic Study",
            "timezone": "America/Chicago",
            "usage_session_mode": usage_session_mode,
            "include_app_output": true,
            "include_screen_output": input.include_screen_output,
            "use_filter_file": false,
            "use_apps_forcing_screen_open": false,
            "use_app_codebook": false,
            "correct_duplicate_event_timestamps": true,
            "allow_stop_event_reuse": input.allow_stop_event_reuse,
            "use_activity_stopped_as_fallback": input.use_activity_stopped_as_fallback,
            "apply_threshold_to_fallback": input.apply_threshold_to_fallback,
            "long_duration_threshold_ns": 43_200_000_000_000_i64,
            "proximity_interval_ns": i64::from(input.proximity_seconds % 5) * 1_000_000_000,
            "custom_app_engagement_duration": 300.0,
            "long_data_time_gap_thresholds": [1.0, 2.0],
            "long_usage_duration_thresholds": [1.0, 2.0],
            "same_app_stop_types": ["Activity Paused", "Activity Resumed"],
            "other_stop_types": ["Activity Resumed", "Device Shutdown"],
            "interaction_types_to_remove": [],
            "screen_auto_lock_timeout_seconds": 120.0,
            "screen_auto_lock_tolerance_seconds": 30.0,
            "screen_manual_lock_max_tail_seconds": 30.0,
            "screen_keyguard_near_stop_seconds": 2.0,
            "datetime_of_preprocessing": "2026-08-06 12:00:00 UTC",
            "model_concurrent_usage": input.model_concurrent_usage,
            "micro_use_classification_policy": "none",
            "minimum_usage_duration": 60.0,
            "minimum_duration_comparator": "strict_lt",
            "minimum_duration_disposition": "chronicle_blank_keep_row",
            "apply_minimum_usage_duration_to_concurrent_subintervals": false,
            "enable_aggregates": input.enable_aggregates,
            "enable_plotting": false
        }
    })
    .to_string()
}

/// Build the CSV and request for `input` and run them the way the browser
/// worker does: the scientific preflight over the verified raw bytes first
/// (screen usage arms the B05 preflight, and execution refuses to run without
/// its receipt), then `execute_workspace_native`.
pub fn execute_structured_workspace(
    input: &StructuredWorkspaceInput,
) -> Result<RuntimeHandle, String> {
    let csv = synthetic_csv(input);
    let request = workspace_request_json(input, &csv);
    let support = RuntimeSupportFiles::default();
    scientific_preflight_native(&request, &csv, &support)?;
    execute_workspace_native(&request, &csv, &support)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(interaction: u8, minute: u8, second: u8) -> FuzzRow {
        FuzzRow {
            participant: 1,
            application: "Chat".into(),
            package: "com.example.chat".into(),
            interaction,
            month: 7,
            day: 5,
            hour: 12,
            minute,
            second,
            timezone: 0,
        }
    }

    fn input(flags: u8) -> StructuredWorkspaceInput {
        StructuredWorkspaceInput {
            rows: vec![
                row(5, 0, 0),
                row(0, 0, 5),
                row(1, 3, 10),
                row(2, 3, 11),
                row(6, 4, 0),
            ],
            include_screen_output: flags & 1 != 0,
            allow_stop_event_reuse: flags & 2 != 0,
            use_activity_stopped_as_fallback: flags & 4 != 0,
            apply_threshold_to_fallback: flags & 8 != 0,
            model_concurrent_usage: flags & 16 != 0,
            enable_aggregates: flags & 32 != 0,
            proximity_seconds: flags >> 6,
        }
    }

    /// Every generated configuration is admitted and executes: the target's
    /// budget goes to the pipeline, not to request-parse rejections.
    #[test]
    fn every_generated_request_executes_past_request_admission() {
        for flags in 0..=u8::MAX {
            if let Err(error) = execute_structured_workspace(&input(flags)) {
                panic!("flags {flags:#010b} rejected: {error}");
            }
        }
    }

    /// A header-only export passes request admission and is refused by the
    /// pipeline itself, not by request parsing or option validation.
    #[test]
    fn an_empty_export_reaches_the_pipeline() {
        let mut empty = input(0);
        empty.rows.clear();
        match execute_structured_workspace(&empty) {
            Ok(_) => {}
            Err(error) => assert_eq!(error, "No valid app usage data during the study period"),
        }
    }
}
