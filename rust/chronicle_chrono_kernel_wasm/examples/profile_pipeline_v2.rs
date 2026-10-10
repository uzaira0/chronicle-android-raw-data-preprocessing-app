use chronicle_chrono_kernel_wasm::pipeline_v2::{
    run_pipeline_v2_with_supports, MicroUseClassificationPolicy, MinimumDurationComparator,
    MinimumDurationDisposition, PipelineV2Options, PipelineV2SupportFiles, UsageSessionMode,
};
#[cfg(feature = "incremental-v2")]
use chronicle_chrono_kernel_wasm::pipeline_v2::{IncrementalPipelineV2Engine, PipelineV2Result};
use chrono::{TimeZone, Utc};
#[cfg(feature = "incremental-v2")]
use serde_json::json;
use sha2::{Digest, Sha256};
use std::hint::black_box;
#[cfg(feature = "incremental-v2")]
use std::time::Duration;
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
    seed: Option<u32>,
    browser_review_options: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Mode {
    Sequential,
    Incremental,
}

fn usage() -> &'static str {
    "usage: profile_pipeline_v2 [--rows N] [--seed N] [--raw PATH] [--iterations N] [--mode sequential|incremental] [--case NAME] [--browser-review-options]"
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
    let mut seed = None;
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
            "--seed" => {
                let value = args
                    .next()
                    .ok_or_else(|| "--seed requires a value".to_string())?;
                seed = Some(
                    value
                        .parse::<u32>()
                        .map_err(|error| format!("invalid --seed value {value:?}: {error}"))?,
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
    if raw.is_some() && seed.is_some() {
        return Err("--seed selects a synthetic fixture and cannot be combined with --raw".into());
    }
    Ok(Args {
        rows,
        iterations,
        mode,
        case,
        raw,
        seed,
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

/// The synthetic fixture: one event per second, the app changing every four
/// rows over 32 apps, the interaction cycling through `interaction()`.
///
/// Seed 0 (the default) reproduces the fixture this example generated before
/// it took a seed, byte for byte, so the default invocation measures the same
/// bytes across commits. Any other seed rotates which app and which
/// interaction each row carries, moves the calendar by `seed % 3650` whole
/// days and gives the participant its own id (`P{seed + 1}`), so every seed
/// yields distinct bytes. The rotation also changes which apps the filter,
/// forcing and background lists name and which interactions open and close
/// each app's sessions, so seeds are different workloads, not only different
/// bytes: at 60,624 rows seeds 1-5 reconstruct 53,046 to 71,986 app rows and
/// their cold executes differ by up to 1.7x. Compare costs within one seed;
/// across seeds, report per-seed figures rather than only a pooled one.
fn synthetic_raw_csv(rows: usize, seed: u32) -> Vec<u8> {
    let seed = u64::from(seed);
    let app_offset = (seed % 32) as usize;
    // 5 is coprime with 16, so seeds 0..15 reach every interaction offset.
    let interaction_offset = ((seed * 5) % 16) as usize;
    let participant = format!("Synthetic Study,P{:03},Target Child,", seed + 1);
    let mut csv = String::with_capacity(RAW_HEADER.len() + rows.saturating_mul(145));
    csv.push_str(RAW_HEADER);
    let base_seconds = Utc
        .with_ymd_and_hms(2026, 1, 1, 0, 0, 0)
        .single()
        .expect("fixed UTC timestamp")
        .timestamp()
        + (seed % 3650) as i64 * 86_400;
    for index in 0..rows {
        let app = (index / 4 + app_offset) % 32;
        let timestamp = Utc
            .timestamp_opt(base_seconds + index as i64, 0)
            .single()
            .expect("synthetic timestamp remains representable");
        csv.push_str(&participant);
        csv.push_str(&format!("App {app:02},"));
        csv.push_str(interaction(index + interaction_offset));
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
        screen_session_construction_strategy:
            chronicle_chrono_kernel_wasm::b05_foundational_semantics::ScreenSessionConstructionStrategyId::default(),
        screen_session_construction_strategy_explicit: false,
        screen_session_classification_policy: Default::default(),
        screen_session_maximum_duration_minutes: 0.0,
        screen_session_maximum_duration_disposition: Default::default(),
        locked_screen_audio_disposition: Default::default(),
        event_retention_set: chronicle_chrono_kernel_wasm::pipeline_v2::EventRetentionSet::None,
        maximum_duration: chronicle_chrono_kernel_wasm::b06_maximum_duration::MaximumDurationRequest::default(),
        opener_set: chronicle_chrono_kernel_wasm::pipeline_v2::OpenerSet::StrategyDefined,
        episode_reconstruction_strategy:
            chronicle_chrono_kernel_wasm::pipeline_v2::EpisodeReconstructionStrategy::FusedMatcher,
        session_grouping_policy:
            chronicle_chrono_kernel_wasm::pipeline_v2::SessionGroupingPolicy::None,
        session_gap_basis: Default::default(),
        session_boundary_scope: Default::default(),
        emit_session_break_lineage: false,
        interval_quality_policy:
            chronicle_chrono_kernel_wasm::pipeline_v2::IntervalQualityPolicy::None,
        include_app_output: true,
        include_screen_output: true,
        use_filter_file: true,
        use_apps_forcing_screen_open: true,
        use_background_apps_file: true,
        use_app_codebook: true,
        include_category_column: true,
        include_app_usage_end_reason: false,
        neutralize_spreadsheet_formulas: false,
        deduplicate_exact_rows: true,
        drop_out_of_source_order_events: false,
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
        interaction_type_removal_mode: Default::default(),
        screen_auto_lock_timeout_seconds: 120.0,
        screen_auto_lock_tolerance_seconds: 30.0,
        screen_manual_lock_max_tail_seconds: 30.0,
        screen_keyguard_near_stop_seconds: 2.0,
        datetime_of_preprocessing: "2026-07-22 00:00:00 UTC".into(),
        model_concurrent_usage: true,
        micro_use_classification_policy: MicroUseClassificationPolicy::None,
        micro_use_classification_policy_explicit: false,
        minimum_usage_duration: 0.0,
        minimum_usage_duration_explicit: false,
        minimum_duration_comparator: MinimumDurationComparator::StrictLt,
        minimum_duration_comparator_explicit: false,
        minimum_duration_disposition: MinimumDurationDisposition::ChronicleBlankKeepRow,
        minimum_duration_disposition_explicit: false,
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
        enable_participant_amount_summary: false,
        aggregate_shape: "wide".into(),
        aggregate_top_apps_limit: 0,
        materialize_visualization_data: true,
        credited_session_cap_minutes: 360.0,
        device_liveness_gap_tolerance_minutes: 120.0,
        auto_lock_bridge_seconds: 120.0,
        bridge_screen_off_to_session_end: false,
        no_witness_min_day_apps: 2,
        screen_gating_rule: Default::default(),
        day_boundary_attribution: Default::default(),
        filter_match_field: Default::default(),
        application_label_exclusions: Vec::new(),
        package_exclusion_preset: Default::default(),
        notification_proxy_rule: Default::default(),
        polled_emulation_method: Default::default(),
        polled_emulation_interval_seconds: 10.0,
        polled_emulation_gap_seconds: 15.0,
        interval_expansion_method: Default::default(),
    }
}

#[cfg(feature = "incremental-v2")]
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
        bytes
            .for_each_chunk(|chunk| digest.update(chunk))
            .expect("output payload readable");
    }
    digest.update(
        serde_json::to_vec(&result.workflow_query_checkpoints).expect("serialize step checkpoints"),
    );
    digest.update(
        serde_json::to_vec(&result.workflow_query_group_checkpoints)
            .expect("serialize stage checkpoints"),
    );
    digest.update(serde_json::to_vec(&result.row_lineage).expect("serialize row lineage"));
    for aggregate in result.aggregate_csv_outputs.iter() {
        digest.update(aggregate.kind.as_bytes());
        digest.update(aggregate.row_count.to_le_bytes());
        digest.update(aggregate.bytes.to_vec());
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

/// Process probes read through libc. `getrusage(RUSAGE_SELF)` gives the
/// process's resident-set high-water mark; `getloadavg` the system load, so
/// every published timing carries the load it was taken under. The layout
/// below is `struct rusage` on 64-bit macOS and Linux: two 16-byte `timeval`s,
/// then fourteen `long`s of which `ru_maxrss` is the first.
#[cfg(all(feature = "incremental-v2", unix, target_pointer_width = "64"))]
mod os_probe {
    #[repr(C)]
    struct ResourceUsage {
        user_time: [i64; 2],
        system_time: [i64; 2],
        max_resident_set: i64,
        remaining: [i64; 13],
    }

    extern "C" {
        fn getrusage(who: i32, usage: *mut ResourceUsage) -> i32;
        fn getloadavg(loadavg: *mut f64, count: i32) -> i32;
    }

    const RUSAGE_SELF: i32 = 0;

    /// Resident-set high-water mark of this process so far, in bytes. macOS
    /// reports `ru_maxrss` in bytes, Linux in KiB.
    pub fn peak_resident_bytes() -> Option<u64> {
        let mut usage = ResourceUsage {
            user_time: [0; 2],
            system_time: [0; 2],
            max_resident_set: 0,
            remaining: [0; 13],
        };
        // SAFETY: `usage` is a live, exclusively borrowed value with the
        // `struct rusage` layout documented above; getrusage only writes it.
        let status = unsafe { getrusage(RUSAGE_SELF, &mut usage) };
        if status != 0 {
            return None;
        }
        let value = u64::try_from(usage.max_resident_set).ok()?;
        if cfg!(target_os = "macos") {
            Some(value)
        } else {
            value.checked_mul(1024)
        }
    }

    pub fn load_average() -> Option<[f64; 3]> {
        let mut values = [0.0_f64; 3];
        // SAFETY: `values` has room for the three doubles requested and
        // getloadavg writes at most that many.
        let written = unsafe { getloadavg(values.as_mut_ptr(), 3) };
        (written == 3).then_some(values)
    }
}

#[cfg(all(
    feature = "incremental-v2",
    not(all(unix, target_pointer_width = "64"))
))]
mod os_probe {
    pub fn peak_resident_bytes() -> Option<u64> {
        None
    }

    pub fn load_average() -> Option<[f64; 3]> {
        None
    }
}

/// What the run read: the bytes, where they came from, and their identity.
struct Fixture {
    raw_csv: Vec<u8>,
    rows: usize,
    seed: Option<u32>,
    source: &'static str,
    sha256: String,
}

impl Fixture {
    #[cfg(feature = "incremental-v2")]
    fn json(&self) -> serde_json::Value {
        json!({
            "source": self.source,
            "seed": self.seed,
            "rows": self.rows,
            "bytes": self.raw_csv.len(),
            "sha256": self.sha256,
        })
    }

    fn key_values(&self) -> String {
        let seed = self
            .seed
            .map_or_else(|| "none".to_string(), |seed| seed.to_string());
        format!(
            "input_source={} seed={seed} input_sha256={}",
            self.source, self.sha256
        )
    }
}

#[cfg(feature = "incremental-v2")]
fn milliseconds(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1_000.0
}

/// Order statistics of the per-iteration samples. The median of an even count
/// is the mean of the two middle samples; p90 is the nearest-rank value (the
/// ceil(0.9 n)-th smallest), so for n < 10 it is the maximum.
#[cfg(feature = "incremental-v2")]
fn distribution(samples: &[Duration]) -> serde_json::Value {
    let mut sorted: Vec<f64> = samples.iter().copied().map(milliseconds).collect();
    sorted.sort_by(f64::total_cmp);
    let count = sorted.len();
    let median = if count % 2 == 1 {
        sorted[count / 2]
    } else {
        (sorted[count / 2 - 1] + sorted[count / 2]) / 2.0
    };
    let p90_rank = (count * 9).div_ceil(10).max(1);
    json!({
        "n": count,
        "min_ms": sorted[0],
        "median_ms": median,
        "p90_nearest_rank_ms": sorted[p90_rank - 1],
        "max_ms": sorted[count - 1],
        "mean_ms": sorted.iter().sum::<f64>() / count as f64,
    })
}

/// The executed-query sets of one iteration. Every iteration of one case runs
/// the same request on a fresh engine, so the sets must not differ between
/// iterations; a difference fails the run rather than being averaged away.
#[cfg(feature = "incremental-v2")]
#[derive(PartialEq, Eq)]
struct ExecutedSets {
    product: Vec<String>,
    internal: Vec<String>,
}

#[cfg(feature = "incremental-v2")]
fn record_executed_sets(
    label: &str,
    recorded: &mut Option<ExecutedSets>,
    product: &[String],
    internal: &[String],
) -> Result<(), String> {
    let current = ExecutedSets {
        product: product.to_vec(),
        internal: internal.to_vec(),
    };
    match recorded {
        None => *recorded = Some(current),
        Some(first) if *first != current => {
            return Err(format!(
                "{label}: executed queries differ between iterations: first={:?}/{:?} now={:?}/{:?}",
                first.product, first.internal, current.product, current.internal
            ));
        }
        Some(_) => {}
    }
    Ok(())
}

/// The payload store does not free a dropped row table at once: it queues it
/// until the store's next trim, which otherwise runs at the first publish
/// inside the next timed execute. With the native default (no budget) this
/// call only drains that queue, so a timed region never pays for freeing an
/// earlier request's results.
#[cfg(feature = "incremental-v2")]
fn release_dropped_payloads() -> Result<(), String> {
    chronicle_chrono_kernel_wasm::payload_store::current_store().evict_unpinned()
}

/// Compare every iteration's digest with the sequential scheduler's result for
/// the same request. The oracle runs after the timed loop, never inside it.
#[cfg(feature = "incremental-v2")]
fn check_against_sequential_oracle(
    label: &str,
    digests: &[String],
    raw_csv: &[u8],
    options: &PipelineV2Options,
    supports: PipelineV2SupportFiles<'_>,
) -> Result<serde_json::Value, String> {
    let oracle = run_pipeline_v2_with_supports(raw_csv, options, supports)?;
    let oracle_digest = result_digest(&oracle);
    drop(oracle);
    for (iteration, digest) in digests.iter().enumerate() {
        if *digest != oracle_digest {
            return Err(format!(
                "{label} iteration {} differs from the sequential oracle: actual={digest} oracle={oracle_digest}",
                iteration + 1
            ));
        }
    }
    Ok(json!({
        "engine": "run_pipeline_v2_with_supports (sequential scheduler over the same stage functions)",
        "result_digest": oracle_digest,
        "iterations_matched": digests.len(),
    }))
}

/// Cold execution: a fresh engine executes the baseline request. Iteration 1
/// is the first pipeline execution in the process; later iterations build a
/// fresh engine in a process whose allocator and caches are already warm, so
/// the first one is also reported on its own.
#[cfg(feature = "incremental-v2")]
fn measure_cold(
    label: &str,
    iterations: usize,
    fixture: &Fixture,
    codebook_csv: &[u8],
    options: &PipelineV2Options,
) -> Result<(), String> {
    let load_before = os_probe::load_average();
    let peak_before = os_probe::peak_resident_bytes();
    let mut samples = Vec::with_capacity(iterations);
    let mut digests = Vec::with_capacity(iterations);
    let mut executed = None;
    let mut peak_after_first = None;
    for iteration in 0..iterations {
        let started = Instant::now();
        let mut engine = IncrementalPipelineV2Engine::default();
        let cold = engine.execute(&fixture.raw_csv, options, support(codebook_csv, FILTER_CSV))?;
        samples.push(started.elapsed());
        if iteration == 0 {
            peak_after_first = os_probe::peak_resident_bytes();
        }
        digests.push(result_digest(&cold.result));
        record_executed_sets(
            label,
            &mut executed,
            &cold.executed_queries,
            &cold.internal_executed_queries,
        )?;
        drop(cold);
        drop(engine);
        release_dropped_payloads()?;
    }
    let load_after = os_probe::load_average();
    let oracle = check_against_sequential_oracle(
        label,
        &digests,
        &fixture.raw_csv,
        options,
        support(codebook_csv, FILTER_CSV),
    )?;
    let executed = executed.expect("at least one iteration ran");
    println!(
        "{}",
        json!({
            "case": label,
            "timing_scope": "in-process cold execute: IncrementalPipelineV2Engine::default() + execute() of the baseline request on a fresh engine; excludes process start, fixture construction, result digesting, freeing earlier iterations' results (drained before the timer) and the oracle. Iteration 1 is the first pipeline execution in the process (first_iteration_ms); iterations 2..N run in a process that has already executed it, and `distribution` pools all iterations",
            "input": fixture.json(),
            "iterations": iterations,
            "elapsed_ns": samples.iter().map(Duration::as_nanos).collect::<Vec<_>>(),
            "first_iteration_ms": milliseconds(samples[0]),
            "distribution": distribution(&samples),
            "distribution_after_first": (samples.len() > 1).then(|| distribution(&samples[1..])),
            "executed_count": executed.product.len(),
            "executed_queries": executed.product,
            "internal_executed_count": executed.internal.len(),
            "internal_executed_queries": executed.internal,
            "process_peak_resident_bytes": {
                "scope": "getrusage ru_maxrss: high-water mark of the whole process (binary, fixture and everything allocated so far), not an execute-only peak",
                "before_first_execute": peak_before,
                "after_first_execute": peak_after_first,
            },
            "oracle": oracle,
            "load_average_1m_5m_15m": {"before": load_before, "after_timed_loop": load_after},
        })
    );
    Ok(())
}

/// One A/B change: each iteration builds a fresh engine, executes the baseline
/// request (untimed), then times only the changed request on that engine.
#[cfg(feature = "incremental-v2")]
#[allow(clippy::too_many_arguments)]
fn measure_incremental_case(
    label: &str,
    iterations: usize,
    fixture: &Fixture,
    codebook_csv: &[u8],
    baseline_options: &PipelineV2Options,
    changed_raw_csv: &[u8],
    changed_filter_csv: &[u8],
    changed_options: &PipelineV2Options,
) -> Result<(), String> {
    let load_before = os_probe::load_average();
    let mut samples = Vec::with_capacity(iterations);
    let mut digests = Vec::with_capacity(iterations);
    let mut executed = None;
    for _ in 0..iterations {
        let mut engine = IncrementalPipelineV2Engine::default();
        engine.execute(
            &fixture.raw_csv,
            baseline_options,
            support(codebook_csv, FILTER_CSV),
        )?;
        release_dropped_payloads()?;
        let started = Instant::now();
        let execution = engine.execute(
            changed_raw_csv,
            changed_options,
            support(codebook_csv, changed_filter_csv),
        )?;
        samples.push(started.elapsed());
        digests.push(result_digest(&execution.result));
        record_executed_sets(
            label,
            &mut executed,
            &execution.executed_queries,
            &execution.internal_executed_queries,
        )?;
        drop(execution);
        drop(engine);
        release_dropped_payloads()?;
    }
    let load_after = os_probe::load_average();
    let oracle = check_against_sequential_oracle(
        label,
        &digests,
        changed_raw_csv,
        changed_options,
        support(codebook_csv, changed_filter_csv),
    )?;
    let executed = executed.expect("at least one iteration ran");
    println!(
        "{}",
        json!({
            "case": label,
            "timing_scope": "in-process: one execute() of the changed request on a fresh engine that has just executed the baseline request; excludes the baseline execute, freeing the baseline result (drained before the timer), result digesting and the oracle. Every iteration runs after at least one execute in the same process",
            "input": fixture.json(),
            "iterations": iterations,
            "elapsed_ns": samples.iter().map(Duration::as_nanos).collect::<Vec<_>>(),
            "distribution": distribution(&samples),
            "executed_count": executed.product.len(),
            "executed_queries": executed.product,
            "internal_executed_count": executed.internal.len(),
            "internal_executed_queries": executed.internal,
            "oracle": oracle,
            "load_average_1m_5m_15m": {"before": load_before, "after_timed_loop": load_after},
        })
    );
    Ok(())
}

#[cfg(feature = "incremental-v2")]
const AB_CASES: [&str; 7] = [
    "unchanged",
    "upstream_timezone_policy",
    "middle_concurrent_usage",
    "downstream_day_coverage",
    "output_study_name",
    "raw_representation_only",
    "support_filter_add_absent_app",
];

#[cfg(feature = "incremental-v2")]
fn measure_ab_case(
    label: &str,
    iterations: usize,
    fixture: &Fixture,
    codebook_csv: &[u8],
    baseline_options: &PipelineV2Options,
) -> Result<(), String> {
    let mut changed_options = baseline_options.clone();
    let mut changed_raw = fixture.raw_csv.clone();
    let mut changed_filter: &[u8] = FILTER_CSV;
    match label {
        "unchanged" => {}
        "upstream_timezone_policy" => changed_options.timezone_handling = "primary-convert".into(),
        "middle_concurrent_usage" => changed_options.model_concurrent_usage = false,
        "downstream_day_coverage" => changed_options.enable_day_coverage = false,
        "output_study_name" => changed_options.study_name = "Synthetic Profile Renamed".into(),
        "raw_representation_only" => changed_raw.push(b'\n'),
        "support_filter_add_absent_app" => {
            changed_filter = b"app_package_name,known_application_labels\ncom.example.app0,App 00\ncom.example.absent,Absent\n";
        }
        other => return Err(format!("unknown A/B case {other:?}")),
    }
    measure_incremental_case(
        label,
        iterations,
        fixture,
        codebook_csv,
        baseline_options,
        &changed_raw,
        changed_filter,
        &changed_options,
    )
}

#[cfg(feature = "incremental-v2")]
fn profile_incremental(
    iterations: usize,
    fixture: &Fixture,
    codebook_csv: &[u8],
    baseline_options: &PipelineV2Options,
    selected_case: Option<&str>,
) -> Result<(), String> {
    match selected_case {
        Some(case @ ("cold" | "cold_benchmark")) => {
            return measure_cold(case, iterations, fixture, codebook_csv, baseline_options);
        }
        Some(case) if AB_CASES.contains(&case) => {
            return measure_ab_case(case, iterations, fixture, codebook_csv, baseline_options);
        }
        None => {
            measure_cold("cold", iterations, fixture, codebook_csv, baseline_options)?;
            for case in AB_CASES {
                measure_ab_case(case, iterations, fixture, codebook_csv, baseline_options)?;
            }
            return Ok(());
        }
        Some(
            "cached_review_profile"
            | "cached_minimum_review_profile"
            | "middle_profile_loop"
            | "middle_review_profile_loop"
            | "middle_minimum_review_profile_loop",
        ) => {}
        Some(other) => return Err(format!("unknown --case {other:?}; {}", usage())),
    }
    let rows = fixture.rows;
    let raw_csv = fixture.raw_csv.as_slice();
    let input = fixture.key_values();
    let mut cold_engine = IncrementalPipelineV2Engine::default();
    let cold = cold_engine.execute(raw_csv, baseline_options, support(codebook_csv, FILTER_CSV))?;
    if matches!(
        selected_case,
        Some("cached_review_profile" | "cached_minimum_review_profile")
    ) {
        let export_started = Instant::now();
        let review_base = cold_engine
            .export_review_base()?
            .ok_or("profile fixture review base exceeded its ceiling")?;
        let reconstruction_base = cold_engine
            .export_reconstruction_base()?
            .ok_or("profile fixture reconstruction base exceeded its ceiling")?;
        let export_elapsed = export_started.elapsed();
        drop(cold);
        drop(cold_engine);

        let mut changed = baseline_options.clone();
        if selected_case == Some("cached_minimum_review_profile") {
            changed.minimum_usage_duration = 2.0;
        } else {
            changed.model_concurrent_usage = false;
        }
        let mut oracle_engine = IncrementalPipelineV2Engine::default();
        let oracle =
            oracle_engine.execute_review(raw_csv, &changed, support(codebook_csv, FILTER_CSV))?;
        let oracle_digest = result_digest(&oracle.result);
        drop(oracle);
        drop(oracle_engine);

        let started = Instant::now();
        let mut executed = 0_usize;
        let mut internal_executed = 0_usize;
        for _ in 0..iterations {
            let mut engine = IncrementalPipelineV2Engine::default();
            let execution = engine.execute_review_with_bases(
                raw_csv,
                &review_base,
                &reconstruction_base,
                &changed,
                support(codebook_csv, FILTER_CSV),
            )?;
            let actual_digest = result_digest(&execution.result);
            if actual_digest != oracle_digest {
                return Err(format!(
                    "cached review differs from cold review: actual={actual_digest} oracle={oracle_digest}"
                ));
            }
            executed += execution.executed_queries.len();
            internal_executed += execution.internal_executed_queries.len();
            black_box(execution);
        }
        let elapsed = started.elapsed();
        println!(
            "case={} rows={rows} {input} iterations={iterations} review_base_bytes={} reconstruction_base_bytes={} export_ms={:.3} elapsed_ns={} elapsed_ms={:.3} average_ms={:.3} average_executed_count={:.1} average_internal_executed_count={:.1} result_digest={oracle_digest}",
            selected_case.expect("cached review case"),
            review_base.len(),
            reconstruction_base.len(),
            export_elapsed.as_secs_f64() * 1_000.0,
            elapsed.as_nanos(),
            elapsed.as_secs_f64() * 1_000.0,
            elapsed.as_secs_f64() * 1_000.0 / iterations as f64,
            executed as f64 / iterations as f64,
            internal_executed as f64 / iterations as f64,
        );
        return Ok(());
    }
    // The three middle loops: alternate the changed and baseline requests on
    // one warm engine.
    let review_only = matches!(
        selected_case,
        Some("middle_review_profile_loop" | "middle_minimum_review_profile_loop")
    );
    if review_only {
        cold_engine = IncrementalPipelineV2Engine::default();
        cold_engine.execute_review(raw_csv, baseline_options, support(codebook_csv, FILTER_CSV))?;
    }
    let mut changed = baseline_options.clone();
    if selected_case == Some("middle_minimum_review_profile_loop") {
        changed.minimum_usage_duration = 2.0;
    } else {
        changed.model_concurrent_usage = false;
    }
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
        executed += execution.executed_queries.len();
        black_box(execution);
    }
    let elapsed = started.elapsed();
    println!(
        "case={} rows={rows} {input} iterations={iterations} elapsed_ns={} elapsed_ms={:.3} average_ms={:.3} executed_count={executed}",
        selected_case.unwrap_or("middle_profile_loop"),
        elapsed.as_nanos(),
        elapsed.as_secs_f64() * 1_000.0,
        elapsed.as_secs_f64() * 1_000.0 / iterations as f64,
    );
    drop(cold);
    Ok(())
}

fn main() -> Result<(), String> {
    let args = parse_args()?;
    if args.mode == Mode::Sequential && args.case.is_some() {
        return Err("--case selects an incremental profile and requires --mode incremental".into());
    }
    let fixture = match &args.raw {
        Some(raw) => {
            let raw_csv = std::fs::read(raw).map_err(|error| format!("read {raw}: {error}"))?;
            Fixture {
                // Line count: a quoted field with an embedded newline over-counts.
                rows: raw_csv
                    .iter()
                    .filter(|byte| **byte == b'\n')
                    .count()
                    .saturating_sub(1),
                sha256: hex::encode(Sha256::digest(&raw_csv)),
                raw_csv,
                seed: None,
                source: "file",
            }
        }
        None => {
            let seed = args.seed.unwrap_or(0);
            let raw_csv = synthetic_raw_csv(args.rows, seed);
            Fixture {
                rows: args.rows,
                sha256: hex::encode(Sha256::digest(&raw_csv)),
                raw_csv,
                seed: Some(seed),
                source: "synthetic",
            }
        }
    };
    let rows = fixture.rows;
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
                args.iterations,
                &fixture,
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
    let mut app_csv_bytes = 0_usize;
    let mut screen_csv_bytes = 0_usize;
    let mut visualization_bytes = 0_usize;
    let mut run_elapsed = std::time::Duration::ZERO;
    for _ in 0..args.iterations {
        let run_started = Instant::now();
        let result = run_pipeline_v2_with_supports(
            black_box(&fixture.raw_csv),
            black_box(&options),
            support,
        )?;
        run_elapsed += run_started.elapsed();
        app_rows = result.app_row_count;
        screen_rows = result.screen_row_count;
        app_csv_bytes = result.app_csv_bytes.len();
        screen_csv_bytes = result.screen_csv_bytes.len();
        visualization_bytes = result.visualization_data_json_bytes.len();
        result
            .app_csv_bytes
            .for_each_chunk(|chunk| checksum.update(chunk))
            .expect("output payload readable");
        result
            .screen_csv_bytes
            .for_each_chunk(|chunk| checksum.update(chunk))
            .expect("output payload readable");
        result
            .review_summary_json_bytes
            .for_each_chunk(|chunk| checksum.update(chunk))
            .expect("output payload readable");
        for digest in result.workflow_query_digests.values() {
            checksum.update(digest.as_bytes());
        }
        black_box(&result);
    }
    let elapsed = started.elapsed();
    let processed_rows = rows.saturating_mul(args.iterations);
    let rows_per_second = processed_rows as f64 / elapsed.as_secs_f64();
    println!(
        "rows={} {} iterations={} input_bytes={} elapsed_ns={} elapsed_ms={:.3} run_ms={:.3} rows_per_second={:.3} app_rows={} screen_rows={} app_csv_bytes={} screen_csv_bytes={} visualization_bytes={} checksum={}",
        rows,
        fixture.key_values(),
        args.iterations,
        fixture.raw_csv.len(),
        elapsed.as_nanos(),
        elapsed.as_secs_f64() * 1_000.0,
        run_elapsed.as_secs_f64() * 1_000.0 / args.iterations as f64,
        rows_per_second,
        app_rows,
        screen_rows,
        app_csv_bytes,
        screen_csv_bytes,
        visualization_bytes,
        hex::encode(checksum.finalize()),
    );
    Ok(())
}
