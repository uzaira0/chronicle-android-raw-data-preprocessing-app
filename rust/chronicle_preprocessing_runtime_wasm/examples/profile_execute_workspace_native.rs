use chronicle_chrono_kernel_wasm::pipeline_v2::{
    IncrementalPipelineV2Engine, PipelineV2OptionsJson, PipelineV2SupportFiles,
};
use chronicle_preprocessing_runtime_wasm::{
    execute_workspace_native, execute_workspace_native_with_review_bases, RuntimeArtifactMetadata,
    RuntimeRequest, RuntimeSupportFiles, EXECUTE_WORKSPACE_COMMAND, QUERY_REVIEW_COMMAND,
    RUNTIME_PROTOCOL_VERSION,
};
use sha2::{Digest, Sha256};
use std::env;
use std::fs;
use std::hint::black_box;
use std::path::PathBuf;
use std::time::Instant;

struct Arguments {
    raw: PathBuf,
    iterations: usize,
    consume_artifacts: bool,
    list_artifacts: bool,
    stable_workspace: bool,
    review: bool,
    review_bases_dir: Option<PathBuf>,
    export_review_bases_dir: Option<PathBuf>,
    export_artifacts_dir: Option<PathBuf>,
    change: Option<String>,
    direct_engine: bool,
}

fn arguments() -> Result<Arguments, String> {
    let mut raw = None;
    let mut iterations = 1_usize;
    let mut consume_artifacts = false;
    let mut list_artifacts = false;
    let mut stable_workspace = false;
    let mut review = false;
    let mut review_bases_dir = None;
    let mut export_review_bases_dir = None;
    let mut export_artifacts_dir = None;
    let mut change = None;
    let mut direct_engine = false;
    let mut values = env::args().skip(1);
    while let Some(argument) = values.next() {
        match argument.as_str() {
            "--raw" => raw = values.next().map(PathBuf::from),
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
            "--review" => review = true,
            "--review-bases-dir" => review_bases_dir = values.next().map(PathBuf::from),
            "--export-review-bases-dir" => {
                export_review_bases_dir = values.next().map(PathBuf::from)
            }
            "--export-artifacts-dir" => export_artifacts_dir = values.next().map(PathBuf::from),
            "--change" => change = values.next(),
            "--direct-engine" => direct_engine = true,
            other => return Err(format!("unknown argument: {other}")),
        }
    }
    if review_bases_dir.is_some() && !review {
        return Err("--review-bases-dir requires --review".into());
    }
    if export_review_bases_dir.is_some() && review {
        return Err("--export-review-bases-dir requires a full execution".into());
    }
    Ok(Arguments {
        raw: raw.ok_or_else(|| "--raw PATH is required".to_string())?,
        iterations,
        consume_artifacts,
        list_artifacts,
        stable_workspace,
        review,
        review_bases_dir,
        export_review_bases_dir,
        export_artifacts_dir,
        change,
        direct_engine,
    })
}

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn options(change: Option<&str>, iteration: usize) -> Result<PipelineV2OptionsJson, String> {
    let mut options = PipelineV2OptionsJson {
        study_name: String::new(),
        timezone: "America/Chicago".into(),
        timezone_handling: "selected-filter".into(),
        usage_session_mode: "app_and_screen_usage".into(),
        include_app_output: true,
        include_screen_output: true,
        use_filter_file: false,
        use_apps_forcing_screen_open: false,
        use_background_apps_file: false,
        use_app_codebook: false,
        include_category_column: false,
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
            "Filtered App Background Usage".into(),
            "End of Usage Missing".into(),
            "Device Shutdown".into(),
        ],
        interaction_types_to_remove: Vec::new(),
        screen_auto_lock_timeout_seconds: 120.0,
        screen_auto_lock_tolerance_seconds: 30.0,
        screen_manual_lock_max_tail_seconds: 30.0,
        screen_keyguard_near_stop_seconds: 2.0,
        datetime_of_preprocessing: "2026-07-23 00:00:00 UTC".into(),
        model_concurrent_usage: true,
        minimum_usage_duration: 60.0,
        apply_minimum_usage_duration_to_concurrent_subintervals: false,
        filter_zero_duration_sessions: false,
        add_no_activity_placeholder_days: false,
        enable_study_window_filter: false,
        enable_person_attribution: false,
        enable_day_coverage: false,
        enable_compliance_scoring: false,
        compliance_threshold_percent: 70.0,
        enable_screen_gated_crediting: true,
        enable_parquet_export: false,
        enable_spss_export: false,
        enable_aggregates: true,
        aggregate_shape: "wide".into(),
        enable_plotting: true,
        enable_activity_heatmap: true,
        export_plots_as_svg: false,
        enable_interactive_timeline: false,
        include_filtered_app_usage_in_plots: false,
        materialize_visualization_data: Some(true),
        credited_session_cap_minutes: 360.0,
        device_liveness_gap_tolerance_minutes: 120.0,
        auto_lock_bridge_seconds: 120.0,
        no_witness_min_day_apps: 2,
    };
    match change {
        None | Some("unchanged") => {}
        Some("middle_concurrent_usage") => options.model_concurrent_usage = false,
        Some("middle_minimum_usage_duration") => options.minimum_usage_duration = 2.0,
        Some("baseline_without_concurrent_usage") => options.model_concurrent_usage = false,
        Some("middle_minimum_usage_duration_without_concurrent_usage") => {
            options.model_concurrent_usage = false;
            options.minimum_usage_duration = 2.0;
        }
        Some("repeated_minimum_usage_duration_without_concurrent_usage") => {
            options.model_concurrent_usage = false;
            options.minimum_usage_duration = if iteration.is_multiple_of(2) { 2.0 } else { 3.0 };
        }
        Some(other) => return Err(format!("unsupported --change: {other}")),
    }
    Ok(options)
}

fn main() -> Result<(), String> {
    let arguments = arguments()?;
    let raw = fs::read(&arguments.raw)
        .map_err(|error| format!("read {}: {error}", arguments.raw.display()))?;
    if arguments.direct_engine {
        let mut engine = IncrementalPipelineV2Engine::default();
        let baseline =
            options(Some("baseline_without_concurrent_usage"), 0)?.into_pipeline_options();
        let started = Instant::now();
        engine.execute(&raw, &baseline, PipelineV2SupportFiles::default())?;
        eprintln!(
            "direct_engine_baseline_ms={:.3}",
            started.elapsed().as_secs_f64() * 1_000.0
        );
        for iteration in 0..arguments.iterations {
            let changed = options(
                Some("repeated_minimum_usage_duration_without_concurrent_usage"),
                iteration,
            )?
            .into_pipeline_options();
            let started = Instant::now();
            let execution =
                engine.execute_review(&raw, &changed, PipelineV2SupportFiles::default())?;
            println!(
                "direct_engine_iteration={iteration} execute_ms={:.3} executed_steps={} review_digest={}",
                started.elapsed().as_secs_f64() * 1_000.0,
                execution.executed_steps.join(","),
                sha256(&execution.result.review_summary_json_bytes),
            );
        }
        return Ok(());
    }
    let input_digest = sha256(&raw);
    let support_files = RuntimeSupportFiles::default();
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
            options: options(arguments.change.as_deref(), iteration)?,
        };
        let request_json = serde_json::to_string(&request)
            .map_err(|error| format!("serialize profile request: {error}"))?;
        let execute_started = Instant::now();
        let mut handle = if arguments.review_bases_dir.is_some() {
            execute_workspace_native_with_review_bases(
                &request_json,
                &raw,
                &review_base,
                &reconstruction_base,
                &support_files,
            )?
        } else {
            execute_workspace_native(&request_json, &raw, &support_files)?
        };
        let execute_elapsed = execute_started.elapsed();
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
        if let Some(directory) = &arguments.export_artifacts_dir {
            fs::create_dir_all(directory)
                .map_err(|error| format!("create artifact directory: {error}"))?;
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
        let step_count = manifest["stepExecutions"]
            .as_array()
            .map(Vec::len)
            .unwrap_or_default();
        let result_digest = manifest["processingSummary"]["publishedOutputsDigest"]
            .as_str()
            .or_else(|| manifest["comparisonDigest"].as_str())
            .unwrap_or("missing");
        println!(
            "iteration={iteration} command={command} rows={} execute_ms={:.3} artifact_ms={:.3} artifacts={} artifact_bytes={artifact_bytes} steps={step_count} result_digest={result_digest}",
            manifest["counts"]["original"].as_u64().unwrap_or_default(),
            execute_elapsed.as_secs_f64() * 1_000.0,
            artifact_elapsed.as_secs_f64() * 1_000.0,
            handle.artifact_count(),
        );
    }
    Ok(())
}
