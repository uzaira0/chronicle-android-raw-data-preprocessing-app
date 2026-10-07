#![recursion_limit = "256"]

use chronicle_chrono_kernel_wasm::pipeline_v2::{
    IncrementalPipelineV2Engine, PipelineV2OptionsJson, PipelineV2SupportFiles,
};
use chronicle_preprocessing_runtime_wasm::literature_input_adapters::{
    adapt_literature_inputs, validate_input_bindings_for_source,
};
use chronicle_preprocessing_runtime_wasm::{
    execute_literature_component_native, execute_workspace_native_conformance_attempt,
    execute_workspace_native_shared, execute_workspace_native_warm_review,
    scientific_preflight_native_shared, scientific_preflight_native_conformance_attempt,
    ExecutionEngine, MethodProfileReceipt, RuntimeArtifactMetadata, RuntimeRequest, RuntimeSupportFiles,
    EXECUTE_WORKSPACE_COMMAND, QUERY_REVIEW_COMMAND, RUNTIME_PROTOCOL_VERSION,
};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::alloc::{GlobalAlloc, Layout, System};
use std::env;
use std::fs;
use std::hint::black_box;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

/// Counting allocator so one run reports its live-heap high-water mark per
/// phase, and the call stack that set it (`CHRONICLE_HEAP_BACKTRACE=1`, build
/// with `--profile profiling` for symbols). Example-only; nothing shipped.
struct PeakTracking;

static LIVE: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);
static CAPTURING: AtomicBool = AtomicBool::new(false);
static BACKTRACE_ENABLED: AtomicBool = AtomicBool::new(false);
static PEAK_BACKTRACES: Mutex<Vec<(usize, String)>> = Mutex::new(Vec::new());
const BACKTRACE_STEP: usize = 64 << 20;

unsafe impl GlobalAlloc for PeakTracking {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let pointer = System.alloc(layout);
        if !pointer.is_null() {
            Self::grew(layout.size());
        }
        pointer
    }
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        // Keep the calloc fast path; the default falls back to alloc + memset.
        let pointer = System.alloc_zeroed(layout);
        if !pointer.is_null() {
            Self::grew(layout.size());
        }
        pointer
    }
    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        LIVE.fetch_sub(layout.size(), Ordering::Relaxed);
        System.dealloc(pointer, layout)
    }
    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        let new_pointer = System.realloc(pointer, layout, new_size);
        if !new_pointer.is_null() {
            if new_size >= layout.size() {
                Self::grew(new_size - layout.size());
            } else {
                LIVE.fetch_sub(layout.size() - new_size, Ordering::Relaxed);
            }
        }
        new_pointer
    }
}

impl PeakTracking {
    fn grew(bytes: usize) {
        let live = LIVE.fetch_add(bytes, Ordering::Relaxed) + bytes;
        let peak = PEAK.fetch_max(live, Ordering::Relaxed);
        if live <= peak {
            return;
        }
        // Everything below allocates; the flag keeps re-entrant growth out.
        if !BACKTRACE_ENABLED.load(Ordering::Relaxed) || CAPTURING.swap(true, Ordering::AcqRel) {
            return;
        }
        let recorded = PEAK_BACKTRACES
            .lock()
            .ok()
            .and_then(|slots| slots.last().map(|(at, _)| *at))
            .unwrap_or(0);
        if live >= recorded + BACKTRACE_STEP {
            // Keep only the crate frames: enough to name the phase, cheap to print.
            let trace = std::backtrace::Backtrace::force_capture()
                .to_string()
                .lines()
                .filter(|line| {
                    [
                        "chronicle_",
                        "slice::sort",
                        "arrow",
                        "lz4",
                        "hashbrown",
                        "alloc::raw_vec",
                    ]
                    .iter()
                    .any(|needle| line.contains(needle))
                        && !line.contains("PeakTracking")
                })
                .map(|line| {
                    line.trim()
                        .trim_start_matches(|c: char| c.is_ascii_digit() || c == ':')
                        .trim()
                        .to_string()
                })
                .filter(|line| !line.starts_with("at "))
                // Deep enough to reach the tracked stage under the
                // serde/postcard frames of a payload reload.
                .take(24)
                .collect::<Vec<_>>()
                .join(" <- ");
            if let Ok(mut slots) = PEAK_BACKTRACES.lock() {
                slots.push((live, trace));
            }
        }
        CAPTURING.store(false, Ordering::Release);
    }
}

#[global_allocator]
static GLOBAL: PeakTracking = PeakTracking;

fn heap_mib() -> (f64, f64) {
    let mib = |bytes: usize| bytes as f64 / (1024.0 * 1024.0);
    (
        mib(LIVE.load(Ordering::Relaxed)),
        mib(PEAK.load(Ordering::Relaxed)),
    )
}

struct Arguments {
    raw: PathBuf,
    options: Option<PathBuf>,
    receipt: Option<PathBuf>,
    diagnostic_receipt: Option<PathBuf>,
    support: Vec<(String, PathBuf)>,
    iterations: usize,
    consume_artifacts: bool,
    list_artifacts: bool,
    stable_workspace: bool,
    keep_engine: bool,
    review: bool,
    review_bases_dir: Option<PathBuf>,
    export_review_bases_dir: Option<PathBuf>,
    export_artifacts_dir: Option<PathBuf>,
    change: Option<String>,
    direct_engine: bool,
    component: Option<String>,
    conformance_attempt: bool,
    sequential_engine: bool,
    provenance_evidence: bool,
}

fn arguments() -> Result<Arguments, String> {
    let mut raw = None;
    let mut options = None;
    let mut receipt = None;
    let mut diagnostic_receipt = None;
    let mut support = Vec::new();
    let mut iterations = 1_usize;
    let mut consume_artifacts = false;
    let mut list_artifacts = false;
    let mut stable_workspace = false;
    let mut keep_engine = false;
    let mut review = false;
    let mut review_bases_dir = None;
    let mut export_review_bases_dir = None;
    let mut export_artifacts_dir = None;
    let mut change = None;
    let mut direct_engine = false;
    let mut component = None;
    let mut conformance_attempt = false;
    let mut sequential_engine = false;
    let mut provenance_evidence = false;
    let mut values = env::args().skip(1);
    while let Some(argument) = values.next() {
        match argument.as_str() {
            "--raw" => raw = values.next().map(PathBuf::from),
            "--options" => {
                options = Some(PathBuf::from(
                    values
                        .next()
                        .ok_or_else(|| "--options requires a path".to_string())?,
                ))
            }
            "--receipt" => {
                receipt = Some(PathBuf::from(
                    values
                        .next()
                        .ok_or_else(|| "--receipt requires a path".to_string())?,
                ))
            }
            "--diagnostic-receipt" => {
                diagnostic_receipt =
                    Some(PathBuf::from(values.next().ok_or_else(|| {
                        "--diagnostic-receipt requires a path".to_string()
                    })?))
            }
            "--support" => {
                let value = values
                    .next()
                    .ok_or_else(|| "--support requires ROLE=PATH".to_string())?;
                let (role, path) = value
                    .split_once('=')
                    .filter(|(role, path)| !role.is_empty() && !path.is_empty())
                    .ok_or_else(|| "--support requires ROLE=PATH".to_string())?;
                support.push((role.to_string(), PathBuf::from(path)));
            }
            "--iterations" => {
                iterations = values
                    .next()
                    .ok_or_else(|| "--iterations requires a value".to_string())?
                    .parse()
                    .map_err(|_| "--iterations requires a positive integer".to_string())?;
                if iterations == 0 {
                    return Err("--iterations requires a positive integer".into());
                }
            }
            "--consume-artifacts" => consume_artifacts = true,
            "--list-artifacts" => list_artifacts = true,
            "--stable-workspace" => stable_workspace = true,
            "--keep-engine" => keep_engine = true,
            "--review" => review = true,
            "--review-bases-dir" => review_bases_dir = values.next().map(PathBuf::from),
            "--export-review-bases-dir" => {
                export_review_bases_dir = values.next().map(PathBuf::from)
            }
            "--export-artifacts-dir" => export_artifacts_dir = values.next().map(PathBuf::from),
            "--change" => change = values.next(),
            "--direct-engine" => direct_engine = true,
            "--component" => {
                component = Some(
                    values
                        .next()
                        .ok_or_else(|| "--component requires an ID".to_string())?,
                )
            }
            "--conformance-attempt" => conformance_attempt = true,
            "--sequential-engine" => sequential_engine = true,
            "--provenance-evidence" => provenance_evidence = true,
            other => return Err(format!("unknown argument: {other}")),
        }
    }
    if review_bases_dir.is_some() && !review {
        return Err("--review-bases-dir requires --review".into());
    }
    if export_review_bases_dir.is_some() && review {
        return Err("--export-review-bases-dir requires a full execution".into());
    }
    if receipt.is_some() && diagnostic_receipt.is_some() {
        return Err("--receipt and --diagnostic-receipt are mutually exclusive".into());
    }
    if component.is_some()
        && (receipt.is_some()
            || diagnostic_receipt.is_some()
            || review
            || review_bases_dir.is_some()
            || export_review_bases_dir.is_some()
            || direct_engine
            || change.is_some())
    {
        return Err("--component is a closed component-only execution and cannot be combined with profile receipts, diagnostics, review state, direct engine, or --change".into());
    }
    if conformance_attempt
        && (receipt.is_none()
            || diagnostic_receipt.is_some()
            || component.is_some()
            || review
            || review_bases_dir.is_some()
            || export_review_bases_dir.is_some()
            || direct_engine
            || change.is_some()
            || iterations != 1)
    {
        return Err("--conformance-attempt requires exactly one --receipt and one full execution iteration; diagnostics, components, review, direct engine, and changes are unavailable".into());
    }
    Ok(Arguments {
        raw: raw.ok_or_else(|| "--raw PATH is required".to_string())?,
        options,
        receipt,
        diagnostic_receipt,
        support,
        iterations,
        consume_artifacts,
        list_artifacts,
        stable_workspace,
        keep_engine,
        review,
        review_bases_dir,
        export_review_bases_dir,
        export_artifacts_dir,
        change,
        direct_engine,
        component,
        conformance_attempt,
        sequential_engine,
        provenance_evidence,
    })
}

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn diagnostic_runtime_input(adapted: &[u8]) -> Result<Vec<u8>, String> {
    let mut reader = csv::ReaderBuilder::new()
        .flexible(true)
        .from_reader(adapted);
    let headers = reader
        .headers()
        .map_err(|error| format!("read diagnostic adapted header: {error}"))?
        .clone();
    let source_row = headers
        .iter()
        .position(|header| header == "literature_source_data_row")
        .ok_or_else(|| "diagnostic adapted input lacks source-row lineage".to_string())?;
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer
        .write_record(
            headers
                .iter()
                .enumerate()
                .filter_map(|(index, value)| (index != source_row).then_some(value)),
        )
        .map_err(|error| format!("write diagnostic runtime header: {error}"))?;
    for record in reader.records() {
        let record = record.map_err(|error| format!("read diagnostic adapted row: {error}"))?;
        writer
            .write_record(
                record
                    .iter()
                    .enumerate()
                    .filter_map(|(index, value)| (index != source_row).then_some(value)),
            )
            .map_err(|error| format!("write diagnostic runtime row: {error}"))?;
    }
    writer
        .into_inner()
        .map_err(|error| format!("finish diagnostic runtime input: {error}"))
}

fn options(
    options_path: Option<&Path>,
    change: Option<&str>,
    iteration: usize,
) -> Result<PipelineV2OptionsJson, String> {
    let mut options = if let Some(path) = options_path {
        serde_json::from_slice(
            &fs::read(path).map_err(|error| format!("read {}: {error}", path.display()))?,
        )
        .map_err(|error| format!("parse {}: {error}", path.display()))?
    } else {
        serde_json::json!({
        "study_name": String::new(),
        "timezone": "America/Chicago",
        "timezone_handling": "selected-filter",
        "usage_session_mode": "app_and_screen_usage",
        "event_retention_set": "none",
        "opener_set": "strategy_defined",
        "episode_reconstruction_strategy": "fused_matcher",
        "interval_quality_policy": "none",
        "session_grouping_policy": "none",
        "include_app_output": true,
        "include_screen_output": true,
        "use_filter_file": false,
        "use_apps_forcing_screen_open": false,
        "use_background_apps_file": false,
        "use_app_codebook": false,
        "include_category_column": false,
        "include_app_usage_end_reason": false,
        "deduplicate_exact_rows": true,
        "interaction_type_remap": Vec::<String>::new(),
        "correct_duplicate_event_timestamps": true,
        "allow_stop_event_reuse": false,
        "use_activity_stopped_as_fallback": true,
        "apply_threshold_to_fallback": true,
        "long_duration_threshold_ns": 43_200_000_000_000_i64,
        "proximity_interval_ns": 2_000_000_000,
        "custom_app_engagement_duration": 300.0,
        "long_data_time_gap_thresholds": (1..=12).map(f64::from).collect::<Vec<_>>(),
        "long_usage_duration_thresholds": (1..=12).map(f64::from).collect::<Vec<_>>(),
        "same_app_stop_types": vec!["Activity Paused", "Activity Resumed"],
        "other_stop_types": vec![
            "Activity Resumed",
            "Filtered App Resumed",
            "Filtered App Usage",
            "Filtered App Background Usage",
            "End of Usage Missing",
            "Device Shutdown",
        ],
        "interaction_types_to_remove": Vec::<String>::new(),
        "screen_auto_lock_timeout_seconds": 120.0,
        "screen_auto_lock_tolerance_seconds": 30.0,
        "screen_manual_lock_max_tail_seconds": 30.0,
        "screen_keyguard_near_stop_seconds": 2.0,
        "datetime_of_preprocessing": "2026-07-23 00:00:00 UTC",
        "model_concurrent_usage": true,
        "micro_use_classification_policy": "none",
        "minimum_usage_duration": 60.0,
        "minimum_duration_comparator": "strict_lt",
        "minimum_duration_disposition": "chronicle_blank_keep_row",
        "apply_minimum_usage_duration_to_concurrent_subintervals": false,
        "filter_zero_duration_sessions": false,
        "add_no_activity_placeholder_days": false,
        "enable_study_window_filter": false,
        "enable_person_attribution": false,
        "enable_day_coverage": false,
        "enable_compliance_scoring": false,
        "compliance_threshold_percent": 70.0,
        "enable_screen_gated_crediting": true,
        "enable_parquet_export": false,
        "enable_spss_export": false,
        "enable_aggregates": true,
        "aggregate_shape": "wide",
        "enable_plotting": true,
        "enable_activity_heatmap": true,
        "export_plots_as_svg": false,
        "enable_interactive_timeline": false,
        "include_filtered_app_usage_in_plots": false,
        "materialize_visualization_data": Some(true),
        "credited_session_cap_minutes": 360.0,
        "device_liveness_gap_tolerance_minutes": 120.0,
        "auto_lock_bridge_seconds": 120.0,
        "no_witness_min_day_apps": 2,
        })
    };
    match change {
        None | Some("unchanged") => {}
        Some("timestamp_only") => {
            options["datetime_of_preprocessing"] =
                format!("2026-07-23 00:00:{:02} UTC", iteration % 60).into();
        }
        Some("middle_concurrent_usage") => options["model_concurrent_usage"] = false.into(),
        Some("middle_minimum_usage_duration") => options["minimum_usage_duration"] = 2.0.into(),
        Some("baseline_without_concurrent_usage") => {
            options["model_concurrent_usage"] = false.into()
        }
        Some("middle_minimum_usage_duration_without_concurrent_usage") => {
            options["model_concurrent_usage"] = false.into();
            options["minimum_usage_duration"] = 2.0.into();
        }
        Some("repeated_minimum_usage_duration_without_concurrent_usage") => {
            options["model_concurrent_usage"] = false.into();
            options["minimum_usage_duration"] = (if iteration.is_multiple_of(2) {
                2.0
            } else {
                3.0
            })
            .into();
        }
        Some(other) => return Err(format!("unsupported --change: {other}")),
    }
    serde_json::from_value(options).map_err(|error| format!("build profile options: {error}"))
}

fn main() -> Result<(), String> {
    BACKTRACE_ENABLED.store(
        env::var_os("CHRONICLE_HEAP_BACKTRACE").is_some(),
        Ordering::Relaxed,
    );
    let arguments = arguments()?;
    if let Some(value) = env::var_os("CHRONICLE_PAYLOAD_BUDGET_MIB") {
        let mib: u64 = value
            .to_str()
            .ok_or("CHRONICLE_PAYLOAD_BUDGET_MIB must be UTF-8")?
            .parse()
            .map_err(|_| "CHRONICLE_PAYLOAD_BUDGET_MIB must be an unsigned integer")?;
        let bytes = mib
            .checked_mul(1024 * 1024)
            .ok_or("payload budget overflow")?;
        chronicle_preprocessing_runtime_wasm::set_payload_budget_bytes(bytes)?;
    }
    // One allocation, shared with the tracked input the way the worker's
    // single copy is: the runtime adopts it instead of copying.
    let mut raw = Arc::new(
        fs::read(&arguments.raw)
            .map_err(|error| format!("read {}: {error}", arguments.raw.display()))?,
    );
    let method_profile_receipt: Option<MethodProfileReceipt> = arguments
        .receipt
        .as_ref()
        .or(arguments.diagnostic_receipt.as_ref())
        .map(|path| {
            serde_json::from_slice(
                &fs::read(path).map_err(|error| format!("read {}: {error}", path.display()))?,
            )
            .map_err(|error| format!("parse {}: {error}", path.display()))
        })
        .transpose()?;
    if arguments.direct_engine {
        if arguments.diagnostic_receipt.is_some() {
            return Err("--diagnostic-receipt is unavailable with --direct-engine".into());
        }
        let mut engine = IncrementalPipelineV2Engine::default();
        let baseline = options(
            arguments.options.as_deref(),
            Some("baseline_without_concurrent_usage"),
            0,
        )?
        .into_pipeline_options();
        let started = Instant::now();
        engine.execute(&raw, &baseline, PipelineV2SupportFiles::default())?;
        eprintln!(
            "direct_engine_baseline_ms={:.3}",
            started.elapsed().as_secs_f64() * 1_000.0
        );
        for iteration in 0..arguments.iterations {
            let changed = options(
                arguments.options.as_deref(),
                Some("repeated_minimum_usage_duration_without_concurrent_usage"),
                iteration,
            )?
            .into_pipeline_options();
            let started = Instant::now();
            let execution =
                engine.execute_review(&raw, &changed, PipelineV2SupportFiles::default())?;
            println!(
                "direct_engine_iteration={iteration} execute_ms={:.3} executed_queries={} review_digest={}",
                started.elapsed().as_secs_f64() * 1_000.0,
                execution.executed_queries.join(","),
                sha256(&execution.result.review_summary_json_bytes.to_vec()),
            );
        }
        return Ok(());
    }
    if let Some(directory) = &arguments.export_artifacts_dir {
        fs::create_dir_all(directory)
            .map_err(|error| format!("create artifact directory: {error}"))?;
    }
    let mut support_files = RuntimeSupportFiles::default();
    let mut support_bytes = BTreeMap::new();
    for (role, path) in &arguments.support {
        let bytes = fs::read(path)
            .map_err(|error| format!("read support file {}: {error}", path.display()))?;
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| format!("support file has no valid file name: {}", path.display()))?;
        support_files
            .put_with_name(role, name, &bytes)
            .map_err(|_| format!("invalid support file for role {role}: {}", path.display()))?;
        support_bytes.insert(role.clone(), bytes);
    }
    let method_profile_receipt = if arguments.diagnostic_receipt.is_some() {
        let receipt = method_profile_receipt
            .as_ref()
            .ok_or_else(|| "diagnostic receipt is missing".to_string())?;
        validate_input_bindings_for_source(
            &receipt.input_bindings,
            Some(&receipt.source_work_id),
            Some(&receipt.source_method_variant_id),
        )?;
        if let Some(adapted) =
            adapt_literature_inputs(&raw, &sha256(&raw), &receipt.input_bindings, |role| {
                support_bytes
                    .get(role)
                    .map(Vec::as_slice)
                    .unwrap_or_default()
            })?
        {
            let runtime_input = diagnostic_runtime_input(&adapted.csv_bytes)?;
            if let Some(directory) = &arguments.export_artifacts_dir {
                fs::write(
                    directory.join("diagnostic-literature-input-adapted-csv"),
                    &adapted.csv_bytes,
                )
                .map_err(|error| format!("write diagnostic adapted input: {error}"))?;
                fs::write(
                    directory.join("diagnostic-literature-runtime-input-csv"),
                    &runtime_input,
                )
                .map_err(|error| format!("write diagnostic runtime input: {error}"))?;
                fs::write(
                    directory.join("diagnostic-literature-input-adaptation-receipt-json"),
                    serde_json::to_vec_pretty(&adapted.receipt).map_err(|error| {
                        format!("serialize diagnostic adaptation receipt: {error}")
                    })?,
                )
                .map_err(|error| format!("write diagnostic adaptation receipt: {error}"))?;
            }
            eprintln!(
                "diagnostic_input_adapter original={} adapted={} participants_removed={}",
                adapted.receipt.original_input_digest,
                adapted.receipt.adapted_input_digest,
                adapted.receipt.participants_removed,
            );
            raw = Arc::new(runtime_input);
        }
        None
    } else {
        method_profile_receipt
    };
    let input_digest = sha256(&raw);
    if let (Some(directory), Some(receipt)) = (
        &arguments.export_artifacts_dir,
        arguments.diagnostic_receipt.as_ref(),
    ) {
        fs::copy(
            receipt,
            directory.join("diagnostic-method-profile-preprocessing-receipt-json"),
        )
        .map_err(|error| format!("write diagnostic preprocessing receipt: {error}"))?;
    }
    let (review_base, reconstruction_base) = match &arguments.review_bases_dir {
        Some(directory) => (
            fs::read(directory.join("review-base.bin"))
                .map_err(|error| format!("read review base: {error}"))?,
            fs::read(directory.join("reconstruction-base.bin"))
                .map_err(|error| format!("read reconstruction base: {error}"))?,
        ),
        None => (Vec::new(), Vec::new()),
    };
    let command = if arguments.review {
        QUERY_REVIEW_COMMAND
    } else {
        EXECUTE_WORKSPACE_COMMAND
    };
    let mut previous_workspace_root = None;
    for iteration in 0..arguments.iterations {
        let workspace_iteration = if arguments.stable_workspace {
            0
        } else {
            iteration
        };
        let workspace_id =
            sha256(format!("runtime-profile:{input_digest}:{workspace_iteration}").as_bytes());
        let request = RuntimeRequest {
            protocol_version: RUNTIME_PROTOCOL_VERSION.into(),
            request_id: format!("runtime-profile-{iteration}"),
            command: command.into(),
            workspace_root_digest: previous_workspace_root.clone(),
            workspace_id,
            input_file_name: arguments
                .raw
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("profile.csv")
                .into(),
            input_sha256: input_digest.clone(),
            known_review_summary_digests: None,
            participant_partition_batch_id: None,
            fragmented_participant_tokens: Vec::new(),
            method_profile_receipt: method_profile_receipt.clone(),
            method_profile_receipts: Vec::new(),
            execution_engine: if arguments.sequential_engine {
                ExecutionEngine::Sequential
            } else {
                ExecutionEngine::Incremental
            },
            provenance_evidence: arguments.provenance_evidence,
            options: options(
                arguments.options.as_deref(),
                if arguments.keep_engine && iteration == 0 { None } else { arguments.change.as_deref() },
                iteration,
            )?,
        };
        let request_json = serde_json::to_string(&request)
            .map_err(|error| format!("serialize profile request: {error}"))?;
        let preflight_started = Instant::now();
        if arguments.component.is_none() {
            let scientific_preflight = if arguments.conformance_attempt {
                scientific_preflight_native_conformance_attempt(
                    &request_json,
                    &raw,
                    &support_files,
                )?
            } else {
                scientific_preflight_native_shared(&request_json, &raw, &support_files)?
            };
            if arguments.list_artifacts {
                println!("scientific_preflight={scientific_preflight}");
            }
        }
        let preflight_elapsed = preflight_started.elapsed();
        let (live, peak) = heap_mib();
        eprintln!("heap after_preflight live_mib={live:.1} peak_mib={peak:.1}");
        eprintln!(
            "payload {:?}",
            chronicle_chrono_kernel_wasm::payload_store::current_store().stats()
        );
        let execute_started = Instant::now();
        let warm_review = arguments.review
            && iteration > 0
            && review_base.is_empty()
            && reconstruction_base.is_empty();
        let mut handle = if let Some(component_id) = arguments.component.as_deref() {
            execute_literature_component_native(component_id, &request_json, &raw, &support_files)?
        } else if arguments.conformance_attempt {
            execute_workspace_native_conformance_attempt(&request_json, &raw, &support_files)?
        } else if warm_review {
            execute_workspace_native_warm_review(&request_json, raw.len() as u64, &support_files)?
        } else {
            // A sequential run parks the request's only copy of the file in
            // the payload store for the pass, so it is handed over outright;
            // the file is read again for any further iteration.
            let handed = if arguments.sequential_engine {
                std::mem::take(&mut raw)
            } else {
                Arc::clone(&raw)
            };
            execute_workspace_native_shared(
                &request_json,
                handed,
                &review_base,
                &reconstruction_base,
                &support_files,
            )?
        };
        let execute_elapsed = execute_started.elapsed();
        if arguments.sequential_engine && iteration + 1 < arguments.iterations {
            raw = Arc::new(
                fs::read(&arguments.raw)
                    .map_err(|error| format!("read {}: {error}", arguments.raw.display()))?,
            );
        }
        let (live, peak) = heap_mib();
        eprintln!("heap after_execute live_mib={live:.1} peak_mib={peak:.1}");
        eprintln!(
            "payload {:?}",
            chronicle_chrono_kernel_wasm::payload_store::current_store().stats()
        );
        for stats in chronicle_chrono_kernel_wasm::payload_store::current_store().stats_by_type() {
            eprintln!(
                "payload_type_after_execute {} @{}:{} entries={} resident={} resident_mib={:.1} pinned_mib={:.1} pinned_extra_refs={} spills={} reloads={}",
                stats.type_name,
                stats.published_at.file(),
                stats.published_at.line(),
                stats.entries,
                stats.resident_entries,
                stats.resident_bytes as f64 / (1024.0 * 1024.0),
                stats.pinned_bytes as f64 / (1024.0 * 1024.0),
                stats.pinned_extra_refs,
                stats.spilled_count,
                stats.reload_count,
            );
        }
        let manifest: serde_json::Value = serde_json::from_str(&handle.manifest_json())
            .map_err(|error| format!("parse runtime manifest: {error}"))?;
        previous_workspace_root = manifest["workspaceRootDigest"].as_str().map(str::to_string);
        if arguments.list_artifacts {
            println!(
                "cache_sources={}",
                manifest["cacheSources"]
                    .as_array()
                    .map(|sources| sources
                        .iter()
                        .filter_map(serde_json::Value::as_str)
                        .collect::<Vec<_>>()
                        .join(","))
                    .unwrap_or_default()
            );
        }
        let artifact_started = Instant::now();
        let mut artifact_bytes = 0_u64;
        if let Some(directory) = &arguments.export_review_bases_dir {
            fs::create_dir_all(directory)
                .map_err(|error| format!("create review-base directory: {error}"))?;
        }
        for index in 0..handle.artifact_count() {
            let metadata: RuntimeArtifactMetadata = serde_json::from_str(
                &handle
                    .artifact_metadata_json(index)
                    .map_err(|_| "read artifact metadata".to_string())?,
            )
            .map_err(|error| format!("parse artifact metadata: {error}"))?;
            let persisted_base_name = match metadata.kind.as_str() {
                "review-base" => Some("review-base.bin"),
                "reconstruction-base" => Some("reconstruction-base.bin"),
                _ => None,
            };
            if arguments.list_artifacts {
                println!(
                    "artifact kind={} bytes={} rows={}",
                    metadata.kind,
                    metadata.size,
                    metadata
                        .row_count
                        .map(|count| count.to_string())
                        .unwrap_or_else(|| "-".into()),
                );
            }
            if arguments.consume_artifacts
                || (arguments.export_review_bases_dir.is_some() && persisted_base_name.is_some())
                || arguments.export_artifacts_dir.is_some()
            {
                let bytes = handle
                    .take_artifact_bytes(index)
                    .map_err(|_| format!("take artifact bytes for {}", metadata.kind))?;
                if bytes.len() as u64 != metadata.size {
                    return Err(format!("artifact size mismatch for {}", metadata.kind));
                }
                artifact_bytes += bytes.len() as u64;
                if let (Some(directory), Some(file_name)) =
                    (&arguments.export_review_bases_dir, persisted_base_name)
                {
                    fs::write(directory.join(file_name), &bytes)
                        .map_err(|error| format!("write {file_name}: {error}"))?;
                }
                if let Some(directory) = &arguments.export_artifacts_dir {
                    fs::write(directory.join(format!("{index}-{}", metadata.kind)), &bytes)
                        .map_err(|error| format!("write {}: {error}", metadata.kind))?;
                }
                black_box(bytes);
            } else {
                artifact_bytes += metadata.size;
            }
        }
        let artifact_elapsed = artifact_started.elapsed();
        let (live, peak) = heap_mib();
        eprintln!("heap after_artifacts live_mib={live:.1} peak_mib={peak:.1}");
        eprintln!(
            "payload {:?}",
            chronicle_chrono_kernel_wasm::payload_store::current_store().stats()
        );
        if let Ok(slots) = PEAK_BACKTRACES.lock() {
            for (at, trace) in slots.iter() {
                eprintln!(
                    "heap growth at_mib={:.0} {trace}",
                    *at as f64 / (1024.0 * 1024.0)
                );
            }
        }
        let query_executions = manifest["queryExecutions"].as_array();
        let step_count = query_executions.map(Vec::len).unwrap_or_default();
        let recomputed_steps = query_executions.map(|steps| steps.iter()
            .filter(|step| step["status"] == "recomputed").count()).unwrap_or_default();
        let cached_steps = query_executions.map(|steps| steps.iter()
            .filter(|step| step["status"] == "cached").count()).unwrap_or_default();
        let result_digest = manifest["processingSummary"]["publishedOutputsDigest"]
            .as_str()
            .or_else(|| manifest["comparisonDigest"].as_str())
            .or_else(|| manifest["componentExecutionReceiptDigest"].as_str())
            .unwrap_or("missing");
        let reported_command = manifest["command"].as_str().unwrap_or(command);
        println!(
            "iteration={iteration} command={reported_command} rows={} preflight_ms={:.3} execute_ms={:.3} artifact_ms={:.3} artifacts={} artifact_bytes={artifact_bytes} steps={step_count} recomputed={recomputed_steps} cached={cached_steps} result_digest={result_digest}",
            manifest["counts"]["original"].as_u64()
                .or_else(|| manifest["sourceRowCount"].as_u64())
                .unwrap_or_default(),
            preflight_elapsed.as_secs_f64() * 1_000.0,
            execute_elapsed.as_secs_f64() * 1_000.0,
            artifact_elapsed.as_secs_f64() * 1_000.0,
            handle.artifact_count(),
        );
        drop(handle);
        let (live, _) = heap_mib();
        eprintln!("heap after_handle_drop live_mib={live:.1}");
        eprintln!(
            "payload {:?}",
            chronicle_chrono_kernel_wasm::payload_store::current_store().stats()
        );
        if !arguments.keep_engine {
            chronicle_preprocessing_runtime_wasm::set_comparison_cache_capacity(0);
        }
        let (live, _) = heap_mib();
        eprintln!("heap after_engine_cache_clear live_mib={live:.1}");
        eprintln!(
            "payload {:?}",
            chronicle_chrono_kernel_wasm::payload_store::current_store().stats()
        );
        // Everything still resident after a full pass is pinned by a value
        // held outside the store; live minus that is non-payload retention.
        if !arguments.keep_engine {
            if let Err(error) = chronicle_chrono_kernel_wasm::payload_store::current_store().evict_unpinned() {
                eprintln!("payload evict_unpinned error={error}");
            }
        }
        let (live, _) = heap_mib();
        eprintln!("heap after_evict_unpinned live_mib={live:.1}");
        for stats in chronicle_chrono_kernel_wasm::payload_store::current_store().stats_by_type() {
            eprintln!(
                "payload_type {} @{}:{} entries={} resident={} resident_mib={:.1} pinned_mib={:.1} pinned_extra_refs={} spills={} reloads={}",
                stats.type_name,
                stats.published_at.file(),
                stats.published_at.line(),
                stats.entries,
                stats.resident_entries,
                stats.resident_bytes as f64 / (1024.0 * 1024.0),
                stats.pinned_bytes as f64 / (1024.0 * 1024.0),
                stats.pinned_extra_refs,
                stats.spilled_count,
                stats.reload_count,
            );
        }
        if !arguments.keep_engine {
            chronicle_preprocessing_runtime_wasm::set_comparison_cache_capacity(1);
        }
    }
    Ok(())
}
