#![no_main]

use arbitrary::Arbitrary;
use chronicle_preprocessing_runtime_wasm::{
    execute_workspace_native, RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND,
    RUNTIME_PROTOCOL_VERSION,
};
use libfuzzer_sys::fuzz_target;
use sha2::{Digest, Sha256};

#[derive(Debug, Arbitrary)]
struct FuzzRow {
    participant: u8,
    application: String,
    package: String,
    interaction: u8,
    year: u16,
    month: u8,
    day: u8,
    hour: u8,
    minute: u8,
    second: u8,
    timezone: u8,
}

#[derive(Debug, Arbitrary)]
struct FuzzInput {
    #[arbitrary(with = |u: &mut arbitrary::Unstructured| {
        let len = u.int_in_range(0..=64)?;
        (0..len)
            .map(|_| u.arbitrary::<FuzzRow>())
            .collect::<arbitrary::Result<Vec<_>>>()
    })]
    rows: Vec<FuzzRow>,
    allow_stop_event_reuse: bool,
    use_activity_stopped_as_fallback: bool,
    apply_threshold_to_fallback: bool,
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

fuzz_target!(|input: FuzzInput| {
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
        .unwrap();
    for row in input.rows {
        let interaction = match row.interaction % 6 {
            0 => "Activity Resumed",
            1 => "Activity Paused",
            2 => "Activity Stopped",
            3 => "Device Shutdown",
            4 => "Screen Interactive",
            _ => "Unknown importance: 1",
        };
        let timezone = match row.timezone % 3 {
            0 => "America/Chicago",
            1 => "Etc/UTC",
            _ => "America/New_York",
        };
        let year = 2000 + row.year % 31;
        let month = 1 + row.month % 12;
        let day = 1 + row.day % 28;
        let hour = row.hour % 24;
        let minute = row.minute % 60;
        let second = row.second % 60;
        let timestamp = format!(
            "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
            year, month, day, hour, minute, second
        );
        writer
            .write_record([
                "Synthetic Study",
                &format!("P{:03}", row.participant),
                "Synthetic User",
                &bounded_ascii(&row.application),
                interaction,
                &bounded_ascii(&row.package),
                &timestamp,
                timezone,
            ])
            .unwrap();
    }
    let csv = writer.into_inner().unwrap();
    let request = serde_json::json!({
        "protocolVersion": RUNTIME_PROTOCOL_VERSION,
        "requestId": "fuzz-request",
        "command": EXECUTE_WORKSPACE_COMMAND,
        "workspaceRootDigest": null,
        "workspaceId": format!("sha256:{}", "a".repeat(64)),
        "inputFileName": "synthetic.csv",
        "inputSha256": digest(&csv),
        "options": {
            "study_name": "Synthetic Study",
            "timezone": "America/Chicago",
            "usage_session_mode": "app_usage",
            "include_app_output": true,
            "include_screen_output": false,
            "use_filter_file": false,
            "use_apps_forcing_screen_open": false,
            "use_app_codebook": false,
            "correct_duplicate_event_timestamps": true,
            "allow_stop_event_reuse": input.allow_stop_event_reuse,
            "use_activity_stopped_as_fallback": input.use_activity_stopped_as_fallback,
            "apply_threshold_to_fallback": input.apply_threshold_to_fallback,
            "long_duration_threshold_ns": 43_200_000_000_000_i64,
            "proximity_interval_ns": 0_i64,
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
            "model_concurrent_usage": false,
            "minimum_usage_duration": 60.0,
            "apply_minimum_usage_duration_to_concurrent_subintervals": false
        }
    });

    let _ = execute_workspace_native(&request.to_string(), &csv, &RuntimeSupportFiles::default());
});
