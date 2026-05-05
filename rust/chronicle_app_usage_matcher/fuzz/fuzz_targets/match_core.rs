#![no_main]

use arbitrary::Arbitrary;
use _rust_app_usage_matcher::{match_app_usage_core, match_app_usage_update_indices_core, MatchOptions};
use libfuzzer_sys::fuzz_target;

/// Bounded wrapper so the fuzzer generates arrays of the same length
/// rather than independently-sized arrays that immediately fail the
/// length-validation check (which would waste corpus coverage on a
/// trivial error path).
#[derive(Debug, Arbitrary)]
struct FuzzEvent {
    app_code: u8,   // keep non-negative; cast to i32
    timestamp_delta: u32, // accumulate to guarantee monotonically increasing ts
    resumed: bool,
    same_stop: bool,
    other_stop: bool,
    stopped: bool,
}

#[derive(Debug, Arbitrary)]
struct FuzzOptions {
    allow_stop_event_reuse: bool,
    use_activity_stopped_as_fallback: bool,
    apply_threshold_to_fallback: bool,
    /// Arbitrary threshold in ns; keep in a sane range (0 .. 48 h in ns).
    threshold_hours: u8,
}

#[derive(Debug, Arbitrary)]
struct FuzzInput {
    /// At most 100 events to bound memory usage.
    #[arbitrary(with = |u: &mut arbitrary::Unstructured| {
        let len: usize = u.int_in_range(0..=100)?;
        (0..len).map(|_| u.arbitrary()).collect::<arbitrary::Result<Vec<FuzzEvent>>>()
    })]
    events: Vec<FuzzEvent>,
    options: FuzzOptions,
}

fuzz_target!(|input: FuzzInput| {
    let len = input.events.len();
    if len == 0 {
        return;
    }

    let mut app_codes: Vec<i32> = Vec::with_capacity(len);
    let mut timestamp_ns: Vec<i64> = Vec::with_capacity(len);
    let mut resumed: Vec<bool> = Vec::with_capacity(len);
    let mut same_stop: Vec<bool> = Vec::with_capacity(len);
    let mut other_stop: Vec<bool> = Vec::with_capacity(len);
    let mut stopped: Vec<bool> = Vec::with_capacity(len);

    let mut ts: i64 = 0;
    for ev in &input.events {
        app_codes.push(ev.app_code as i32);
        ts = ts.saturating_add(ev.timestamp_delta as i64);
        timestamp_ns.push(ts);
        resumed.push(ev.resumed);
        same_stop.push(ev.same_stop);
        other_stop.push(ev.other_stop);
        stopped.push(ev.stopped);
    }

    let threshold_ns: i64 = input.options.threshold_hours as i64 * 3600 * 1_000_000_000;
    let options = MatchOptions {
        allow_stop_event_reuse: input.options.allow_stop_event_reuse,
        use_activity_stopped_as_fallback: input.options.use_activity_stopped_as_fallback,
        apply_threshold_to_fallback: input.options.apply_threshold_to_fallback,
        long_duration_threshold_ns: threshold_ns,
    };

    // The Result may be Err (e.g. negative app code after type coercion,
    // or any validation error) — that is fine. What must NOT happen is a panic.
    let _ = match_app_usage_core(
        &app_codes,
        &timestamp_ns,
        &resumed,
        &same_stop,
        &other_stop,
        &stopped,
        options,
    );

    let _ = match_app_usage_update_indices_core(
        &app_codes,
        &timestamp_ns,
        &resumed,
        &same_stop,
        &other_stop,
        &stopped,
        options,
    );
});
