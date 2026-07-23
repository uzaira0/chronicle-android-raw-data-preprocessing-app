use chronicle_chrono_kernel_wasm::pipeline_v2::PipelineV2OptionsJson;
use chronicle_incremental_query_spike::{
    run_representative_queries, BaseOptionsInput, FilterSupportInput, RawInput, TrialDatabase,
    TrialSettings,
};
use salsa::Setter;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

const DEFAULT_OPTIONS: &str = include_str!("../../fixtures/trial-options.json");
const FILTER_BYTES: &[u8] = b"app_package_name,known_application_labels\ncom.example.app0,App 00\n";

#[derive(Debug)]
struct Args {
    raw_path: PathBuf,
    options_path: Option<PathBuf>,
}

#[derive(Debug, Serialize)]
struct Measurement {
    case: &'static str,
    elapsed_ns: u128,
    elapsed_ms: f64,
    query_bodies: Vec<String>,
    salsa_will_execute_count: usize,
    output_sha256: String,
}

fn parse_args() -> Result<Args, String> {
    let mut raw_path = None;
    let mut options_path = None;
    let mut args = std::env::args().skip(1);
    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--raw" => raw_path = args.next().map(PathBuf::from),
            "--options" => options_path = args.next().map(PathBuf::from),
            "--help" | "-h" => {
                println!("usage: measure_trial --raw PATH [--options PATH]");
                std::process::exit(0);
            }
            _ => return Err(format!("unknown argument {flag:?}")),
        }
    }
    Ok(Args {
        raw_path: raw_path.ok_or_else(|| "--raw PATH is required".to_string())?,
        options_path,
    })
}

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

fn measure(
    case: &'static str,
    db: &TrialDatabase,
    raw: RawInput,
    base: BaseOptionsInput,
    settings: TrialSettings,
    support: FilterSupportInput,
) -> Result<Measurement, String> {
    db.clear_events();
    let started = Instant::now();
    let result = run_representative_queries(db, raw, base, settings, support)?;
    let elapsed = started.elapsed();
    let mut query_bodies = db.take_query_bodies();
    query_bodies.sort();
    let salsa_will_execute_count = db.take_will_execute().len();
    if query_bodies.len() != salsa_will_execute_count {
        return Err(format!(
            "{case}: query body/event mismatch: bodies={} Salsa WillExecute={salsa_will_execute_count}",
            query_bodies.len()
        ));
    }
    let output = serde_json::to_vec(&result)
        .map_err(|error| format!("serialize {case} benchmark output: {error}"))?;
    Ok(Measurement {
        case,
        elapsed_ns: elapsed.as_nanos(),
        elapsed_ms: elapsed.as_secs_f64() * 1_000.0,
        query_bodies,
        salsa_will_execute_count,
        output_sha256: sha256(&output),
    })
}

fn main() -> Result<(), String> {
    let args = parse_args()?;
    let raw_bytes = Arc::new(
        std::fs::read(&args.raw_path)
            .map_err(|error| format!("read {}: {error}", args.raw_path.display()))?,
    );
    let options_json = match args.options_path {
        Some(path) => std::fs::read_to_string(&path)
            .map_err(|error| format!("read {}: {error}", path.display()))?,
        None => DEFAULT_OPTIONS.to_string(),
    };
    let options: PipelineV2OptionsJson = serde_json::from_str(&options_json)
        .map_err(|error| format!("parse benchmark options: {error}"))?;

    let mut db = TrialDatabase::default();
    let raw = RawInput::new(
        &db,
        Arc::clone(&raw_bytes),
        args.raw_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("trial-input.csv")
            .to_string(),
    );
    let base = BaseOptionsInput::new(&db, options_json);
    let settings = TrialSettings::new(
        &db,
        options.timezone,
        options.timezone_handling,
        options.model_concurrent_usage,
        options.use_filter_file,
        options.study_name,
    );
    let support = FilterSupportInput::new(
        &db,
        false,
        "filter.csv".to_string(),
        Arc::new(FILTER_BYTES.to_vec()),
    );

    let mut measurements = vec![measure("cold", &db, raw, base, settings, support)?];
    measurements.push(measure("unchanged", &db, raw, base, settings, support)?);

    settings
        .set_study_name(&mut db)
        .to("Renamed Salsa Product Trial".to_string());
    measurements.push(measure(
        "output_only_study_name",
        &db,
        raw,
        base,
        settings,
        support,
    )?);

    settings.set_model_concurrent_usage(&mut db).to(true);
    measurements.push(measure(
        "middle_model_concurrent_usage",
        &db,
        raw,
        base,
        settings,
        support,
    )?);

    raw.set_file_name(&mut db)
        .to("changed-display-label.csv".to_string());
    measurements.push(measure(
        "nonsemantic_raw_label",
        &db,
        raw,
        base,
        settings,
        support,
    )?);

    let mut changed_raw = (*raw_bytes).clone();
    changed_raw.push(b'\n');
    raw.set_bytes(&mut db).to(Arc::new(changed_raw));
    measurements.push(measure(
        "raw_bytes_same_timezone_set",
        &db,
        raw,
        base,
        settings,
        support,
    )?);

    support.set_present(&mut db).to(true);
    settings.set_use_filter_file(&mut db).to(true);
    measurements.push(measure(
        "binding_enable_filter_support",
        &db,
        raw,
        base,
        settings,
        support,
    )?);

    let input = serde_json::json!({
        "path": args.raw_path,
        "bytes": raw_bytes.len(),
        "sha256": sha256(&raw_bytes),
    });
    println!(
        "{}",
        serde_json::to_string_pretty(&serde_json::json!({
            "input": input,
            "measurements": measurements,
        }))
        .map_err(|error| format!("serialize benchmark report: {error}"))?
    );
    Ok(())
}
