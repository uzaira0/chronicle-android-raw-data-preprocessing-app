//! Native release probe for issue #5: the Zhu equal-timestamp decisiveness
//! scan on Chronicle-like data where app-event pairs share a millisecond.
//!
//! Run via hyperfine, e.g.:
//!   cargo build --release --no-default-features --example profile_b05_decisiveness
//!   hyperfine 'target/release/examples/profile_b05_decisiveness 16500'

use chronicle_chrono_kernel_wasm::b05_foundational_semantics::{
    probe_decisive_equal_timestamp_group_count, AndroidUsageSignal, RawB05Event,
    ScreenSessionConstructionStrategyId,
};

fn event(
    timestamp_ms: i64,
    source_data_row: u32,
    signal: AndroidUsageSignal,
    package: Option<&str>,
) -> RawB05Event {
    RawB05Event {
        participant_id: "P01".into(),
        timestamp_ns: Some(timestamp_ms * 1_000_000),
        source_data_row,
        source_data_rows: vec![source_data_row],
        raw_interaction_type: String::new(),
        signal,
        package_name: package.map(str::to_owned),
        app_opener_eligible: true,
    }
}

fn main() {
    let target_rows: usize = std::env::args()
        .nth(1)
        .and_then(|value| value.parse().ok())
        .unwrap_or(16_500);

    // Chronicle-like single participant: screen sessions of ~50 app rows,
    // where consecutive app events share the same millisecond (the pattern
    // that makes every timestamp an equal-timestamp group for Zhu).
    let mut rows = Vec::with_capacity(target_rows);
    let mut source_row = 1u32;
    let mut timestamp_ms = 1_700_000_000_000i64;
    let mut push = |rows: &mut Vec<RawB05Event>,
                    timestamp_ms: i64,
                    signal: AndroidUsageSignal,
                    package: Option<&str>| {
        rows.push(event(timestamp_ms, source_row, signal, package));
        source_row += 1;
    };
    while rows.len() < target_rows {
        push(
            &mut rows,
            timestamp_ms,
            AndroidUsageSignal::ScreenInteractive,
            None,
        );
        push(
            &mut rows,
            timestamp_ms,
            AndroidUsageSignal::KeyguardHidden,
            None,
        );
        timestamp_ms += 1_000;
        for _ in 0..24 {
            // An app pair sharing one millisecond: stop of one app, start of
            // the next, exactly the teardown churn shape from real exports.
            push(
                &mut rows,
                timestamp_ms,
                AndroidUsageSignal::ActivityResumed,
                Some("com.example.one"),
            );
            push(
                &mut rows,
                timestamp_ms,
                AndroidUsageSignal::Other,
                Some("com.example.two"),
            );
            timestamp_ms += 2_000;
        }
        push(
            &mut rows,
            timestamp_ms,
            AndroidUsageSignal::ScreenNonInteractive,
            None,
        );
        timestamp_ms += 60_000;
    }
    rows.truncate(target_rows);

    let started = std::time::Instant::now();
    let count = probe_decisive_equal_timestamp_group_count(
        ScreenSessionConstructionStrategyId::Zhu2018UnlockLockV1,
        &rows,
    );
    let elapsed = started.elapsed();
    println!(
        "rows={} decisive_groups={} elapsed_ms={:.1}",
        rows.len(),
        count,
        elapsed.as_secs_f64() * 1_000.0
    );
}
