use chronicle_chrono_kernel_wasm::pipeline_v2::{
    run_pipeline_v2_with_supports, PipelineV2Options, PipelineV2SupportFiles, UsageSessionMode,
};
use chrono::{TimeZone, Utc};
use sha2::{Digest, Sha256};
use std::hint::black_box;
use std::time::Instant;

const RAW_HEADER: &str = "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n";
const FILTER_CSV: &[u8] = b"app_package_name,known_application_labels\ncom.example.app0,App 00\n";
const APPS_FORCING_CSV: &[u8] = b"package_name,label_or_note\ncom.example.app1,Synthetic video\n";
const BACKGROUND_APPS_CSV: &[u8] =
    b"package_name,label_or_note\ncom.example.app2,Synthetic background audio\n";

#[derive(Debug, Clone, Copy)]
struct Args {
    rows: usize,
    iterations: usize,
}

fn usage() -> &'static str {
    "usage: profile_pipeline_v2 [--rows N] [--iterations N]"
}

fn positive_usize(flag: &str, value: Option<String>) -> Result<usize, String> {
    let value = value.ok_or_else(|| format!("{flag} requires a value"))?;
    let parsed = value
        .parse::<usize>()
        .map_err(|error| format!("invalid {flag} value {value:?}: {error}"))?;
    if parsed == 0 {
        return Err(format!("{flag} must be greater than zero"));
    }
    Ok(parsed)
}

fn parse_args() -> Result<Args, String> {
    let mut rows = 10_000;
    let mut iterations = 1;
    let mut args = std::env::args().skip(1);
    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--rows" => rows = positive_usize("--rows", args.next())?,
            "--iterations" => iterations = positive_usize("--iterations", args.next())?,
            "--help" | "-h" => {
                println!("{}", usage());
                std::process::exit(0);
            }
            _ => return Err(format!("unknown argument {flag:?}; {}", usage())),
        }
    }
    Ok(Args { rows, iterations })
}

fn interaction(index: usize) -> &'static str {
    match index % 16 {
        0 | 8 => "Unknown importance: 15",    // Screen Interactive
        1 | 4 | 9 => "Unknown importance: 1", // Activity Resumed
        2 => "Unknown importance: 7",         // User Interaction
        3 | 10 => "Unknown importance: 2",    // Activity Paused
        5 => "Unknown importance: 5",         // Configuration Change
        6 => "Unknown importance: 23",        // Activity Stopped
        7 | 12 => "Unknown importance: 16",   // Screen Non-Interactive
        11 => "Unknown importance: 17",       // Keyguard Shown
        13 => "Unknown importance: 27",       // Device Startup
        14 => "Unknown importance: 10",       // Notification Seen
        _ => "Unknown importance: 26",        // Device Shutdown
    }
}

fn synthetic_raw_csv(rows: usize) -> Vec<u8> {
    let mut csv = String::with_capacity(RAW_HEADER.len() + rows.saturating_mul(145));
    csv.push_str(RAW_HEADER);
    let base_seconds = Utc
        .with_ymd_and_hms(2026, 1, 1, 0, 0, 0)
        .single()
        .expect("fixed UTC timestamp")
        .timestamp();
    for index in 0..rows {
        let app = (index / 4) % 32;
        let timestamp = Utc
            .timestamp_opt(base_seconds + index as i64, 0)
            .single()
            .expect("synthetic timestamp remains representable");
        csv.push_str("Synthetic Study,P001,Target Child,");
        csv.push_str(&format!("App {app:02},"));
        csv.push_str(interaction(index));
        csv.push(',');
        csv.push_str(&format!("com.example.app{app},"));
        csv.push_str(&timestamp.format("%Y-%m-%d %H:%M:%S+00:00").to_string());
        csv.push_str(",UTC\n");
    }
    csv.into_bytes()
}

fn synthetic_codebook_csv() -> Vec<u8> {
    let mut csv = String::from(
        "app_package_name,application_label,bcm_play_store_genreId,bcm_play_store_broad_app_category,dataset\n",
    );
    for app in 0..32 {
        csv.push_str(&format!(
            "com.example.app{app},App {app:02},Synthetic Genre {},Synthetic Category {},synthetic-profile\n",
            app % 8,
            app % 4,
        ));
    }
    csv.into_bytes()
}

fn options() -> PipelineV2Options {
    PipelineV2Options {
        study_name: "Synthetic Profile".into(),
        timezone: "UTC".into(),
        timezone_handling: "selected-convert".into(),
        usage_session_mode: UsageSessionMode::AppAndScreenUsage,
        include_app_output: true,
        include_screen_output: true,
        use_filter_file: true,
        use_apps_forcing_screen_open: true,
        use_background_apps_file: true,
        use_app_codebook: true,
        include_category_column: true,
        deduplicate_exact_rows: true,
        interaction_type_remap: Vec::new(),
        correct_duplicate_event_timestamps: true,
        allow_stop_event_reuse: false,
        use_activity_stopped_as_fallback: true,
        apply_threshold_to_fallback: true,
        long_duration_threshold_ns: 43_200_000_000_000,
        proximity_interval_ns: 2_000_000_000,
        custom_app_engagement_duration: 300.0,
        long_data_time_gap_thresholds: (1..=12).map(f64::from).collect(),
        long_usage_duration_thresholds: (1..=12).map(f64::from).collect(),
        same_app_stop_types: vec!["Activity Paused".into(), "Activity Resumed".into()],
        other_stop_types: vec![
            "Activity Resumed".into(),
            "Filtered App Resumed".into(),
            "Filtered App Usage".into(),
            "Device Shutdown".into(),
        ],
        interaction_types_to_remove: Vec::new(),
        screen_auto_lock_timeout_seconds: 120.0,
        screen_auto_lock_tolerance_seconds: 30.0,
        screen_manual_lock_max_tail_seconds: 30.0,
        screen_keyguard_near_stop_seconds: 2.0,
        datetime_of_preprocessing: "2026-07-22 00:00:00 UTC".into(),
        model_concurrent_usage: true,
        minimum_usage_duration: 0.0,
        apply_minimum_usage_duration_to_concurrent_subintervals: false,
        filter_zero_duration_sessions: false,
        add_no_activity_placeholder_days: false,
        enable_study_window_filter: false,
        enable_person_attribution: false,
        enable_day_coverage: true,
        enable_compliance_scoring: true,
        compliance_threshold_percent: 70.0,
        enable_screen_gated_crediting: true,
        enable_aggregates: true,
        aggregate_shape: "wide".into(),
        credited_session_cap_minutes: 360.0,
        device_liveness_gap_tolerance_minutes: 120.0,
        auto_lock_bridge_seconds: 120.0,
        no_witness_min_day_apps: 2,
    }
}

fn main() -> Result<(), String> {
    let args = parse_args()?;
    let raw_csv = synthetic_raw_csv(args.rows);
    let codebook_csv = synthetic_codebook_csv();
    let options = options();
    let support = PipelineV2SupportFiles {
        filter_csv: FILTER_CSV,
        apps_forcing_csv: APPS_FORCING_CSV,
        background_apps_csv: BACKGROUND_APPS_CSV,
        codebook_csv: &codebook_csv,
        ..PipelineV2SupportFiles::default()
    };

    let started = Instant::now();
    let mut checksum = Sha256::new();
    let mut app_rows = 0_u32;
    let mut screen_rows = 0_u32;
    for _ in 0..args.iterations {
        let result =
            run_pipeline_v2_with_supports(black_box(&raw_csv), black_box(&options), support)?;
        app_rows = result.app_row_count;
        screen_rows = result.screen_row_count;
        checksum.update(&result.app_csv_bytes);
        checksum.update(&result.screen_csv_bytes);
        checksum.update(&result.review_summary_json_bytes);
        for digest in result.pipeline_step_digests.values() {
            checksum.update(digest.as_bytes());
        }
        black_box(&result);
    }
    let elapsed = started.elapsed();
    let processed_rows = args.rows.saturating_mul(args.iterations);
    let rows_per_second = processed_rows as f64 / elapsed.as_secs_f64();
    println!(
        "rows={} iterations={} input_bytes={} elapsed_ns={} elapsed_ms={:.3} rows_per_second={:.3} app_rows={} screen_rows={} checksum={}",
        args.rows,
        args.iterations,
        raw_csv.len(),
        elapsed.as_nanos(),
        elapsed.as_secs_f64() * 1_000.0,
        rows_per_second,
        app_rows,
        screen_rows,
        hex::encode(checksum.finalize()),
    );
    Ok(())
}
