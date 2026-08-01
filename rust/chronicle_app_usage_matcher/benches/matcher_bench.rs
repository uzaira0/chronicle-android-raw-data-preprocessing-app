use _rust_app_usage_matcher::{
    match_app_usage_core, match_app_usage_update_indices_core, MatchOptions,
};
use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion};

fn make_input(
    n: usize,
) -> (
    Vec<i32>,
    Vec<i64>,
    Vec<bool>,
    Vec<bool>,
    Vec<bool>,
    Vec<bool>,
    Vec<bool>,
) {
    let mut app_codes = Vec::with_capacity(n);
    let mut timestamps = Vec::with_capacity(n);
    let mut resumed = Vec::with_capacity(n);
    let mut same_stop = Vec::with_capacity(n);
    let mut other_stop = Vec::with_capacity(n);
    let mut stopped = Vec::with_capacity(n);
    let mut background = Vec::with_capacity(n);

    let mut ts: i64 = 0;
    let mut seed: u64 = 42;

    for i in 0..n {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
        ts += (seed % 600) as i64;
        app_codes.push((seed % 8) as i32);
        timestamps.push(ts);
        resumed.push(i % 5 == 0);
        same_stop.push(i % 6 == 0);
        other_stop.push(i % 7 == 0);
        stopped.push(i % 9 == 0);
        background.push(i % 11 == 0);
    }

    (
        app_codes, timestamps, resumed, same_stop, other_stop, stopped, background,
    )
}

fn bench_match_core(c: &mut Criterion) {
    let options = MatchOptions {
        allow_stop_event_reuse: false,
        use_activity_stopped_as_fallback: true,
        apply_threshold_to_fallback: true,
        long_duration_threshold_ns: 12 * 3600 * 1_000_000_000,
    };

    let mut group = c.benchmark_group("match_app_usage_core");
    for size in [100usize, 1_000, 10_000] {
        let (app_codes, timestamps, resumed, same_stop, other_stop, stopped, background) =
            make_input(size);
        group.bench_with_input(BenchmarkId::from_parameter(size), &size, |b, _| {
            b.iter(|| {
                match_app_usage_core(
                    black_box(&app_codes),
                    black_box(&timestamps),
                    black_box(&resumed),
                    black_box(&same_stop),
                    black_box(&other_stop),
                    black_box(&stopped),
                    black_box(&background),
                    options,
                )
                .unwrap()
            })
        });
    }
    group.finish();
}

fn bench_match_update_indices(c: &mut Criterion) {
    let options = MatchOptions {
        allow_stop_event_reuse: true,
        use_activity_stopped_as_fallback: true,
        apply_threshold_to_fallback: true,
        long_duration_threshold_ns: 12 * 3600 * 1_000_000_000,
    };

    let mut group = c.benchmark_group("match_app_usage_update_indices_core");
    for size in [100usize, 1_000, 10_000] {
        let (app_codes, timestamps, resumed, same_stop, other_stop, stopped, background) =
            make_input(size);
        group.bench_with_input(BenchmarkId::from_parameter(size), &size, |b, _| {
            b.iter(|| {
                match_app_usage_update_indices_core(
                    black_box(&app_codes),
                    black_box(&timestamps),
                    black_box(&resumed),
                    black_box(&same_stop),
                    black_box(&other_stop),
                    black_box(&stopped),
                    black_box(&background),
                    options,
                )
                .unwrap()
            })
        });
    }
    group.finish();
}

criterion_group!(benches, bench_match_core, bench_match_update_indices);
criterion_main!(benches);
