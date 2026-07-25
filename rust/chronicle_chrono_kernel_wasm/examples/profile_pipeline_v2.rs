#[cfg(feature = "incremental-v2")]
use chronicle_chrono_kernel_wasm::pipeline_v2::IncrementalPipelineV2Engine;
use chronicle_chrono_kernel_wasm::pipeline_v2::{
    run_pipeline_v2_with_supports, PipelineV2Options, PipelineV2Result, PipelineV2SupportFiles,
    UsageSessionMode,
};
use chrono::{TimeZone, Utc};
use sha2::{Digest, Sha256};
use std::hint::black_box;
use std::process::Command;
use std::time::Instant;

const RAW_HEADER: &str = "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n";
const FILTER_CSV: &[u8] = b"app_package_name,known_application_labels\ncom.example.app0,App 00\n";
const APPS_FORCING_CSV: &[u8] = b"package_name,label_or_note\ncom.example.app1,Synthetic video\n";
const BACKGROUND_APPS_CSV: &[u8] =
    b"package_name,label_or_note\ncom.example.app2,Synthetic background audio\n";

#[derive(Debug, Clone)]
struct Args {
    rows: usize,
    iterations: usize,
    mode: Mode,
    case: Option<String>,
    raw: Option<String>,
    browser_review_options: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Mode {
    Sequential,
    Incremental,
}

fn usage() -> &'static str {
    "usage: profile_pipeline_v2 [--rows N] [--raw PATH] [--iterations N] [--mode sequential|incremental] [--case NAME] [--browser-review-options]"
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
    let mut mode = Mode::Sequential;
    let mut case = None;
    let mut raw = None;
    let mut browser_review_options = false;
    let mut args = std::env::args().skip(1);
    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--rows" => rows = positive_usize("--rows", args.next())?,
            "--iterations" => iterations = positive_usize("--iterations", args.next())?,
            "--mode" => {
                mode = match args.next().as_deref() {
                    Some("sequential") => Mode::Sequential,
                    Some("incremental") => Mode::Incremental,
                    value => {
                        return Err(format!(
                            "invalid --mode value {value:?}; expected sequential or incremental"
                        ));
                    }
                }
            }
            "--case" => {
                case = Some(
                    args.next()
                        .ok_or_else(|| "--case requires a value".to_string())?,
                );
            }
            "--raw" => {
                raw = Some(
                    args.next()
                        .ok_or_else(|| "--raw requires a path".to_string())?,
                );
            }
            "--browser-review-options" => browser_review_options = true,
            "--help" | "-h" => {
                println!("{}", usage());
                std::process::exit(0);
            }
            _ => return Err(format!("unknown argument {flag:?}; {}", usage())),
        }
    }
    Ok(Args {
        rows,
        iterations,
        mode,
        case,
        raw,
        browser_review_options,
    })
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

fn result_digest(result: &PipelineV2Result) -> String {
    let mut digest = Sha256::new();
    for bytes in [
        &result.app_csv_bytes,
        &result.screen_csv_bytes,
        &result.day_coverage_csv_bytes,
        &result.compliance_csv_bytes,
        &result.credited_app_csv_bytes,
        &result.review_summary_json_bytes,
        &result.visualization_data_json_bytes,
    ] {
        digest.update((bytes.len() as u64).to_le_bytes());
        digest.update(bytes.as_slice());
    }
    digest.update(
        serde_json::to_vec(&result.pipeline_step_checkpoints).expect("serialize step checkpoints"),
    );
    digest.update(
        serde_json::to_vec(&result.logical_stage_checkpoints).expect("serialize stage checkpoints"),
    );
    digest.update(serde_json::to_vec(&result.row_lineage).expect("serialize row lineage"));
    for aggregate in result.aggregate_csv_outputs.iter() {
        digest.update(aggregate.kind.as_bytes());
        digest.update(aggregate.row_count.to_le_bytes());
        digest.update(&aggregate.bytes);
    }
    for value in [
        result.original_row_count,
        result.processed_row_count,
        result.app_row_count,
        result.screen_row_count,
        result.day_coverage_row_count,
        result.compliance_row_count,
        result.credited_app_row_count,
        result.duplicate_timestamps_corrected,
        result.exact_duplicate_rows_removed,
        result.rows_before_timezone_handling,
        result.rows_after_timezone_handling,
        result.rows_removed_by_timezone,
    ] {
        digest.update(value.to_le_bytes());
    }
    for value in [
        &result.timezone,
        &result.timezone_action,
        &result.timezone_retained_source_rows_digest,
        &result.timezone_stage_digest,
    ] {
        digest.update(value.as_bytes());
    }
    for timezone in &result.available_timezones {
        digest.update(timezone.as_bytes());
    }
    format!("sha256:{}", hex::encode(digest.finalize()))
}

fn support<'a>(codebook_csv: &'a [u8], filter_csv: &'a [u8]) -> PipelineV2SupportFiles<'a> {
    PipelineV2SupportFiles {
        filter_csv,
        apps_forcing_csv: APPS_FORCING_CSV,
        background_apps_csv: BACKGROUND_APPS_CSV,
        codebook_csv,
        ..PipelineV2SupportFiles::default()
    }
}

#[cfg(target_os = "macos")]
fn resident_memory_kib() -> Option<u64> {
    let output = Command::new("/bin/ps")
        .args(["-o", "rss=", "-p", &std::process::id().to_string()])
        .output()
        .ok()?;
    std::str::from_utf8(&output.stdout)
        .ok()?
        .trim()
        .parse()
        .ok()
}

#[cfg(not(target_os = "macos"))]
fn resident_memory_kib() -> Option<u64> {
    None
}

fn report_memory(label: &str) {
    if let Some(kib) = resident_memory_kib() {
        println!("memory={label} resident_kib={kib}");
    }
}

#[cfg(feature = "incremental-v2")]
fn measure_incremental_case(
    label: &str,
    raw_csv: &[u8],
    codebook_csv: &[u8],
    baseline_options: &PipelineV2Options,
    changed_raw_csv: &[u8],
    changed_filter_csv: &[u8],
    changed_options: &PipelineV2Options,
) -> Result<(), String> {
    let mut engine = IncrementalPipelineV2Engine::default();
    engine.execute(raw_csv, baseline_options, support(codebook_csv, FILTER_CSV))?;
    let started = Instant::now();
    let execution = engine.execute(
        changed_raw_csv,
        changed_options,
        support(codebook_csv, changed_filter_csv),
    )?;
    let elapsed = started.elapsed();
    let oracle = run_pipeline_v2_with_supports(
        changed_raw_csv,
        changed_options,
        support(codebook_csv, changed_filter_csv),
    )?;
    let actual_digest = result_digest(&execution.result);
    let oracle_digest = result_digest(&oracle);
    if actual_digest != oracle_digest {
        return Err(format!(
            "{label} incremental result differs from cold oracle: actual={actual_digest} oracle={oracle_digest}"
        ));
    }
    println!(
        "case={label} elapsed_ns={} elapsed_ms={:.3} executed_count={} executed_steps={} internal_executed_count={} internal_executed_queries={} result_digest={actual_digest}",
        elapsed.as_nanos(),
        elapsed.as_secs_f64() * 1_000.0,
        execution.executed_steps.len(),
        execution.executed_steps.join(","),
        execution.internal_executed_queries.len(),
        execution.internal_executed_queries.join(","),
    );
    Ok(())
}

#[cfg(feature = "incremental-v2")]
fn profile_incremental(
    rows: usize,
    iterations: usize,
    raw_csv: &[u8],
    codebook_csv: &[u8],
    baseline_options: &PipelineV2Options,
    selected_case: Option<&str>,
) -> Result<(), String> {
    let cold_started = Instant::now();
    let mut cold_engine = IncrementalPipelineV2Engine::default();
    let cold = cold_engine.execute(raw_csv, baseline_options, support(codebook_csv, FILTER_CSV))?;
    let cold_elapsed = cold_started.elapsed();
    if selected_case == Some("cold_benchmark") {
        let cold_digest = result_digest(&cold.result);
        println!(
            "case=cold_benchmark rows={rows} input_bytes={} elapsed_ns={} elapsed_ms={:.3} executed_count={} internal_executed_count={} internal_executed_queries={} result_digest={cold_digest}",
            raw_csv.len(),
            cold_elapsed.as_nanos(),
            cold_elapsed.as_secs_f64() * 1_000.0,
            cold.executed_steps.len(),
            cold.internal_executed_queries.len(),
            cold.internal_executed_queries.join(","),
        );
        return Ok(());
    }
    if matches!(
        selected_case,
        Some("middle_profile_loop" | "middle_review_profile_loop")
    ) {
        let review_only = selected_case == Some("middle_review_profile_loop");
        if review_only {
            cold_engine = IncrementalPipelineV2Engine::default();
            cold_engine.execute_review(
                raw_csv,
                baseline_options,
                support(codebook_csv, FILTER_CSV),
            )?;
        }
        let mut changed = baseline_options.clone();
        changed.model_concurrent_usage = false;
        let started = Instant::now();
        let mut executed = 0_usize;
        for iteration in 0..iterations {
            let options = if iteration % 2 == 0 {
                &changed
            } else {
                baseline_options
            };
            let execution = if review_only {
                cold_engine.execute_review(raw_csv, options, support(codebook_csv, FILTER_CSV))?
            } else {
                cold_engine.execute(raw_csv, options, support(codebook_csv, FILTER_CSV))?
            };
            executed += execution.executed_steps.len();
            black_box(execution);
        }
        let elapsed = started.elapsed();
        println!(
            "case={} rows={rows} iterations={iterations} elapsed_ns={} elapsed_ms={:.3} average_ms={:.3} executed_count={executed}",
            selected_case.unwrap_or("middle_profile_loop"),
            elapsed.as_nanos(),
            elapsed.as_secs_f64() * 1_000.0,
            elapsed.as_secs_f64() * 1_000.0 / iterations as f64,
        );
        return Ok(());
    }
    let cold_oracle = run_pipeline_v2_with_supports(
        raw_csv,
        baseline_options,
        support(codebook_csv, FILTER_CSV),
    )?;
    let cold_digest = result_digest(&cold.result);
    if cold_digest != result_digest(&cold_oracle) {
        return Err("cold incremental result differs from sequential oracle".into());
    }
    drop(cold_oracle);
    println!(
        "case=cold rows={rows} input_bytes={} elapsed_ns={} elapsed_ms={:.3} executed_count={} executed_steps={} internal_executed_count={} internal_executed_queries={} result_digest={cold_digest}",
        raw_csv.len(),
        cold_elapsed.as_nanos(),
        cold_elapsed.as_secs_f64() * 1_000.0,
        cold.executed_steps.len(),
        cold.executed_steps.join(","),
        cold.internal_executed_queries.len(),
        cold.internal_executed_queries.join(","),
    );
    if selected_case == Some("cold") {
        return Ok(());
    }
    drop(cold);
    report_memory("after_cold");

    if selected_case.is_none() || selected_case == Some("unchanged") {
        measure_incremental_case(
            "unchanged",
            raw_csv,
            codebook_csv,
            baseline_options,
            raw_csv,
            FILTER_CSV,
            baseline_options,
        )?;
    }

    let mut upstream = baseline_options.clone();
    upstream.timezone_handling = "primary-convert".into();
    if selected_case.is_none() || selected_case == Some("upstream_timezone_policy") {
        measure_incremental_case(
            "upstream_timezone_policy",
            raw_csv,
            codebook_csv,
            baseline_options,
            raw_csv,
            FILTER_CSV,
            &upstream,
        )?;
    }

    let mut middle = baseline_options.clone();
    middle.model_concurrent_usage = false;
    if selected_case.is_none() || selected_case == Some("middle_concurrent_usage") {
        measure_incremental_case(
            "middle_concurrent_usage",
            raw_csv,
            codebook_csv,
            baseline_options,
            raw_csv,
            FILTER_CSV,
            &middle,
        )?;
    }

    let mut downstream = baseline_options.clone();
    downstream.enable_day_coverage = false;
    if selected_case.is_none() || selected_case == Some("downstream_day_coverage") {
        measure_incremental_case(
            "downstream_day_coverage",
            raw_csv,
            codebook_csv,
            baseline_options,
            raw_csv,
            FILTER_CSV,
            &downstream,
        )?;
    }

    let mut output = baseline_options.clone();
    output.study_name = "Synthetic Profile Renamed".into();
    if selected_case.is_none() || selected_case == Some("output_study_name") {
        measure_incremental_case(
            "output_study_name",
            raw_csv,
            codebook_csv,
            baseline_options,
            raw_csv,
            FILTER_CSV,
            &output,
        )?;
    }

    let mut changed_raw = raw_csv.to_vec();
    changed_raw.push(b'\n');
    if selected_case.is_none() || selected_case == Some("raw_representation_only") {
        measure_incremental_case(
            "raw_representation_only",
            raw_csv,
            codebook_csv,
            baseline_options,
            &changed_raw,
            FILTER_CSV,
            baseline_options,
        )?;
    }

    let changed_filter = b"app_package_name,known_application_labels\ncom.example.app0,App 00\ncom.example.absent,Absent\n";
    if selected_case.is_none() || selected_case == Some("support_filter_add_absent_app") {
        measure_incremental_case(
            "support_filter_add_absent_app",
            raw_csv,
            codebook_csv,
            baseline_options,
            raw_csv,
            changed_filter,
            baseline_options,
        )?;
    }

    Ok(())
}

fn main() -> Result<(), String> {
    let args = parse_args()?;
    let raw_csv = match &args.raw {
        Some(raw) => std::fs::read(raw).map_err(|error| format!("read {raw}: {error}"))?,
        None => synthetic_raw_csv(args.rows),
    };
    let rows = if args.raw.is_some() {
        raw_csv
            .iter()
            .filter(|byte| **byte == b'\n')
            .count()
            .saturating_sub(1)
    } else {
        args.rows
    };
    let codebook_csv = synthetic_codebook_csv();
    let mut options = options();
    if args.browser_review_options {
        options.study_name = "Synthetic benchmark".into();
        options.timezone = "America/Chicago".into();
        options.timezone_handling = "selected-filter".into();
        options.use_filter_file = false;
        options.use_apps_forcing_screen_open = false;
        options.use_background_apps_file = false;
        options.use_app_codebook = false;
        options.include_category_column = false;
        options.enable_day_coverage = false;
        options.enable_compliance_scoring = false;
        options.enable_screen_gated_crediting = true;
        options.enable_aggregates = true;
    }
    if args.mode == Mode::Incremental {
        #[cfg(feature = "incremental-v2")]
        {
            return profile_incremental(
                rows,
                args.iterations,
                &raw_csv,
                &codebook_csv,
                &options,
                args.case.as_deref(),
            );
        }
        #[cfg(not(feature = "incremental-v2"))]
        {
            return Err("--mode incremental requires --features incremental-v2".into());
        }
    }
    let support = support(&codebook_csv, FILTER_CSV);

    let started = Instant::now();
    let mut checksum = Sha256::new();
    let mut app_rows = 0_u32;
    let mut screen_rows = 0_u32;
    for _ in 0..args.iterations {
        let result =
            run_pipeline_v2_with_supports(black_box(&raw_csv), black_box(&options), support)?;
        app_rows = result.app_row_count;
        screen_rows = result.screen_row_count;
        checksum.update(result.app_csv_bytes.as_slice());
        checksum.update(result.screen_csv_bytes.as_slice());
        checksum.update(result.review_summary_json_bytes.as_slice());
        for digest in result.pipeline_step_digests.values() {
            checksum.update(digest.as_bytes());
        }
        black_box(&result);
    }
    let elapsed = started.elapsed();
    let processed_rows = rows.saturating_mul(args.iterations);
    let rows_per_second = processed_rows as f64 / elapsed.as_secs_f64();
    println!(
        "rows={} iterations={} input_bytes={} elapsed_ns={} elapsed_ms={:.3} rows_per_second={:.3} app_rows={} screen_rows={} checksum={}",
        rows,
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
