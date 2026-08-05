//! Measurement-only harness for recorded debt item 6 in
//! `docs/semantic-federation/final-review-matrix.md`: "Parquet and SPSS export
//! paths independently parse CSV output".
//!
//! `parquet_from_csv` and `sav_from_csv` each begin with their own
//! `parse_csv` of the canonical CSV the pipeline already produced from typed
//! Rust values. This harness answers the only question that decides whether
//! that reparse is worth removing: what share of each export path is the
//! reparse, and how much memory does the intermediate `CsvTable` hold?
//!
//! It is `#[ignore]`d, so `cargo test` never runs it. Run it deliberately:
//!
//! ```text
//! cargo test --release --manifest-path rust/chronicle_preprocessing_runtime_wasm/Cargo.toml \
//!   binary_exports::perf_measurement -- --ignored --nocapture
//! ```
//!
//! Point it at a different input with `CHRONICLE_PERF_RAW_CSV=<path>`; with no
//! variable it uses the same reproducible 600-data-row contract fixture as
//! `web/scripts/measure_perf_debt.mts`.

use super::{
    parquet_from_csv, parquet_from_table, parse_csv, sav_from_csv, sav_from_table, CsvTable,
};
use crate::{execute_workspace_native, RuntimeArtifactMetadata, RuntimeSupportFiles};
use std::time::{Duration, Instant};

/// Iterations per measured function. Small because a single 40k-row SPSS write
/// is already tens of milliseconds; the reported minimum is the stable figure.
const ITERATIONS: usize = 12;

struct Samples {
    values: Vec<Duration>,
}

impl Samples {
    fn collect(iterations: usize, mut body: impl FnMut()) -> Self {
        body(); // discarded warm-up
        let mut values = Vec::with_capacity(iterations);
        for _ in 0..iterations {
            let started = Instant::now();
            body();
            values.push(started.elapsed());
        }
        values.sort();
        Self { values }
    }

    fn minimum_ms(&self) -> f64 {
        self.values.first().map_or(0.0, duration_ms)
    }

    fn median_ms(&self) -> f64 {
        self.values
            .get(self.values.len() / 2)
            .map_or(0.0, duration_ms)
    }

    fn maximum_ms(&self) -> f64 {
        self.values.last().map_or(0.0, duration_ms)
    }
}

fn duration_ms(value: &Duration) -> f64 {
    value.as_secs_f64() * 1_000.0
}

/// Bytes the intermediate `CsvTable` holds live while an export runs. Every
/// cell is an owned `String`; a typed-value export path would hold none of it.
fn table_heap_bytes(table: &CsvTable) -> usize {
    let header_bytes = table
        .headers
        .iter()
        .map(|header| header.capacity() + std::mem::size_of::<String>())
        .sum::<usize>();
    let row_bytes = table
        .rows
        .iter()
        .map(|row| {
            std::mem::size_of::<Vec<String>>()
                + row
                    .iter()
                    .map(|cell| cell.capacity() + std::mem::size_of::<String>())
                    .sum::<usize>()
        })
        .sum::<usize>();
    header_bytes + row_bytes
}

fn representative_600_event_csv() -> Vec<u8> {
    let mut csv = String::from(
        "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
    );
    for index in 0..600 {
        let hour = index / 60;
        let minute = index % 60;
        let interaction = if index % 2 == 0 {
            "Activity Resumed"
        } else {
            "Activity Paused"
        };
        csv.push_str(&format!(
            "Study,P01,Target Child,Chat,{interaction},com.example.chat,2026-03-07 {hour:02}:{minute:02}:00,America/Chicago\n"
        ));
    }
    csv.into_bytes()
}

fn measured_input() -> (String, Vec<u8>) {
    match std::env::var("CHRONICLE_PERF_RAW_CSV") {
        Ok(path) => (
            path.clone(),
            std::fs::read(&path).unwrap_or_else(|error| panic!("read {path}: {error}")),
        ),
        Err(_) => ("contract-600".to_string(), representative_600_event_csv()),
    }
}

/// Run the real pipeline once and return the canonical CSV bytes the export
/// paths reparse, so the measurement uses production output and not a mock.
fn canonical_csv_outputs(csv: &[u8]) -> Vec<(String, bool, Vec<u8>)> {
    let request = serde_json::json!({
        "protocolVersion": crate::RUNTIME_PROTOCOL_VERSION,
        "requestId": "perf-measurement",
        "command": crate::EXECUTE_WORKSPACE_COMMAND,
        "workspaceRootDigest": null,
        "workspaceId": crate::sha256(b"chronicle-perf-measurement-workspace"),
        "inputFileName": "perf-measurement.csv",
        "inputSha256": crate::sha256(csv),
        "options": {
            "study_name": "Perf Measurement",
            "timezone": "America/Chicago",
            "usage_session_mode": "app_and_screen_usage",
            "include_app_output": true,
            "include_screen_output": true,
            "use_filter_file": false,
            "use_apps_forcing_screen_open": false,
            "use_app_codebook": false,
            "correct_duplicate_event_timestamps": true,
            "allow_stop_event_reuse": false,
            "use_activity_stopped_as_fallback": true,
            "apply_threshold_to_fallback": true,
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
            "datetime_of_preprocessing": "2026-07-27 00:00:00 UTC",
            "model_concurrent_usage": false,
            "minimum_usage_duration": 60.0,
            "apply_minimum_usage_duration_to_concurrent_subintervals": false,
            "enable_parquet_export": true,
            "enable_spss_export": true,
        },
    });
    let mut handle =
        execute_workspace_native(&request.to_string(), csv, &RuntimeSupportFiles::default())
            .expect("perf measurement pipeline execution");
    let mut outputs = Vec::new();
    for index in 0..handle.artifact_count() {
        let metadata: RuntimeArtifactMetadata =
            serde_json::from_str(&handle.artifact_metadata_json(index).unwrap())
                .expect("perf measurement artifact metadata");
        let screen = match metadata.kind.as_str() {
            "app-csv" => false,
            "screen-csv" => true,
            _ => continue,
        };
        outputs.push((
            metadata.kind,
            screen,
            handle
                .take_artifact_bytes(index)
                .expect("perf measurement artifact bytes"),
        ));
    }
    outputs
}

#[test]
#[ignore = "measurement harness for recorded debt item 6; run deliberately"]
fn export_reparse_share_of_parquet_and_spss_paths() {
    let (label, csv) = measured_input();
    for (kind, screen, bytes) in canonical_csv_outputs(&csv) {
        if bytes.is_empty() {
            continue;
        }
        let table = parse_csv(&bytes).expect("canonical CSV parses");
        let rows = table.rows.len();
        let columns = table.headers.len();
        let heap_bytes = table_heap_bytes(&table);
        drop(table);

        let parse = Samples::collect(ITERATIONS, || {
            let parsed = parse_csv(&bytes).expect("parse");
            std::hint::black_box(&parsed);
        });
        let parquet = Samples::collect(ITERATIONS, || {
            let written = parquet_from_csv(&bytes, screen).expect("parquet");
            std::hint::black_box(&written);
        });
        let sav = Samples::collect(ITERATIONS, || {
            let written = sav_from_csv(&bytes, screen).expect("sav");
            std::hint::black_box(&written);
        });

        let parquet_output = parquet_from_csv(&bytes, screen).unwrap();
        let sav_output = sav_from_csv(&bytes, screen).unwrap();
        let parquet_bytes = parquet_output.len();
        let sav_bytes = sav_output.len();
        // Byte-identity anchors: these digests must not move when the export
        // path is restructured.
        let parquet_digest = crate::sha256(&parquet_output);
        let sav_digest = crate::sha256(&sav_output);
        eprintln!(
            "export-reparse label={label} kind={kind} rows={rows} columns={columns} \
             csv_bytes={csv_bytes} parquet_bytes={parquet_bytes} sav_bytes={sav_bytes} \
             parquet_digest={parquet_digest} sav_digest={sav_digest} \
             csv_table_heap_bytes={heap_bytes} csv_table_heap_ratio={heap_ratio:.2} \
             parse_min_ms={parse_min:.3} parse_median_ms={parse_median:.3} parse_max_ms={parse_max:.3} \
             parquet_min_ms={parquet_min:.3} parquet_median_ms={parquet_median:.3} \
             sav_min_ms={sav_min:.3} sav_median_ms={sav_median:.3} \
             parse_share_of_parquet={parquet_share:.3} parse_share_of_sav={sav_share:.3} \
             both_exports_reparse_min_ms={both:.3}",
            csv_bytes = bytes.len(),
            heap_ratio = heap_bytes as f64 / bytes.len() as f64,
            parse_min = parse.minimum_ms(),
            parse_median = parse.median_ms(),
            parse_max = parse.maximum_ms(),
            parquet_min = parquet.minimum_ms(),
            parquet_median = parquet.median_ms(),
            sav_min = sav.minimum_ms(),
            sav_median = sav.median_ms(),
            parquet_share = parse.minimum_ms() / parquet.minimum_ms(),
            sav_share = parse.minimum_ms() / sav.minimum_ms(),
            both = parse.minimum_ms() * 2.0,
        );
    }
}

/// Direct before/after for the change `append_binary_exports` actually makes
/// when both binary exports are enabled: two independent `*_from_csv` calls
/// (each with its own `parse_csv`) versus one `parse_csv` shared by
/// `parquet_from_table` and `sav_from_table`. Also asserts the shared path is
/// byte-identical, so the measurement can never report a saving that came from
/// producing different output.
#[test]
#[ignore = "measurement harness for recorded debt item 6; run deliberately"]
fn both_exports_shared_table_versus_independent_reparse() {
    let (label, csv) = measured_input();
    for (kind, screen, bytes) in canonical_csv_outputs(&csv) {
        if bytes.is_empty() {
            continue;
        }
        let independent = Samples::collect(ITERATIONS, || {
            let parquet = parquet_from_csv(&bytes, screen).expect("parquet");
            let sav = sav_from_csv(&bytes, screen).expect("sav");
            std::hint::black_box((&parquet, &sav));
        });
        let shared = Samples::collect(ITERATIONS, || {
            let table = parse_csv(&bytes).expect("parse");
            let parquet = parquet_from_table(&table, screen).expect("parquet");
            let sav = sav_from_table(&table, screen).expect("sav");
            std::hint::black_box((&parquet, &sav));
        });
        let table = parse_csv(&bytes).unwrap();
        assert_eq!(
            parquet_from_table(&table, screen).unwrap(),
            parquet_from_csv(&bytes, screen).unwrap(),
        );
        assert_eq!(
            sav_from_table(&table, screen).unwrap(),
            sav_from_csv(&bytes, screen).unwrap(),
        );
        eprintln!(
            "both-exports label={label} kind={kind} rows={rows} csv_bytes={csv_bytes} \
             independent_min_ms={independent_min:.3} independent_median_ms={independent_median:.3} \
             shared_min_ms={shared_min:.3} shared_median_ms={shared_median:.3} \
             saving_min_ms={saving:.3} saving_share={share:.4} \
             duplicate_csv_table_heap_bytes_avoided={heap}",
            rows = table.rows.len(),
            csv_bytes = bytes.len(),
            independent_min = independent.minimum_ms(),
            independent_median = independent.median_ms(),
            shared_min = shared.minimum_ms(),
            shared_median = shared.median_ms(),
            saving = independent.minimum_ms() - shared.minimum_ms(),
            share = (independent.minimum_ms() - shared.minimum_ms()) / independent.minimum_ms(),
            heap = table_heap_bytes(&table),
        );
    }
}
