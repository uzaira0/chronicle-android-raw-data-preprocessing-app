//! Measurement-only harness for recorded debt item 5 in
//! `docs/semantic-federation/final-review-matrix.md`: "The semantic index is
//! reconstructed for each query; a root-digest keyed cache should be added if
//! repeated interactive queries become material."
//!
//! `query()` calls `store_from_nquads()` on every call, so each registered
//! query re-parses the whole derived N-Quads index into a fresh Oxigraph
//! `Store` before evaluating any SPARQL. This harness splits those two costs so
//! the cache decision is made on the reconstruction share, not on the total.
//!
//! It is `#[ignore]`d, so `cargo test` never runs it. Produce a real index
//! source first, then run it:
//!
//! ```text
//! (cd web && npm run measure:perf-debt -- \
//!    --dump-semantic-source ../.tmp-perf-lane/semantic-source.json)
//! CHRONICLE_SEMANTIC_INDEX_SOURCE=.tmp-perf-lane/semantic-source.json \
//!   cargo test --release --manifest-path rust/chronicle_semantic_index_wasm/Cargo.toml \
//!   perf_measurement -- --ignored --nocapture
//! ```

use super::{query_on_store, rebuild_semantic_index_native, store_from_nquads};
use std::time::{Duration, Instant};

const ITERATIONS: usize = 60;

/// Every product-registered query, in the order `registered-queries.json`
/// declares them. An interactive panel refresh answers all of them.
const REGISTERED_QUERY_IDS: &[&str] = &[
    "open-obligations",
    "actual-executions",
    "role-assignments",
    "qualification-traces",
    "requirement-traces",
    "reason-trace",
    "has-open-obligations",
];

fn samples(iterations: usize, mut body: impl FnMut()) -> Vec<Duration> {
    body(); // discarded warm-up
    let mut values = Vec::with_capacity(iterations);
    for _ in 0..iterations {
        let started = Instant::now();
        body();
        values.push(started.elapsed());
    }
    values.sort();
    values
}

fn minimum_ms(values: &[Duration]) -> f64 {
    values.first().map_or(0.0, |value| value.as_secs_f64() * 1_000.0)
}

fn median_ms(values: &[Duration]) -> f64 {
    values
        .get(values.len() / 2)
        .map_or(0.0, |value| value.as_secs_f64() * 1_000.0)
}

#[test]
#[ignore = "measurement harness for recorded debt item 5; run deliberately"]
fn store_reconstruction_share_of_each_registered_query() {
    let Ok(path) = std::env::var("CHRONICLE_SEMANTIC_INDEX_SOURCE") else {
        eprintln!(
            "semantic-index-perf skipped: set CHRONICLE_SEMANTIC_INDEX_SOURCE to a \
             semantic-index-source-json artifact (see this module's doc comment)"
        );
        return;
    };
    let source = std::fs::read(&path).unwrap_or_else(|error| panic!("read {path}: {error}"));
    let index = rebuild_semantic_index_native(&source).expect("index source rebuilds");

    let rebuild = samples(ITERATIONS, || {
        let rebuilt = rebuild_semantic_index_native(&source).expect("rebuild");
        std::hint::black_box(&rebuilt);
    });
    let reconstruct = samples(ITERATIONS, || {
        let store = store_from_nquads(&index).expect("store");
        std::hint::black_box(&store);
    });
    eprintln!(
        "semantic-index-perf source={path} source_bytes={} index_bytes={} \
         rebuild_min_ms={:.4} rebuild_median_ms={:.4} \
         store_from_nquads_min_ms={:.4} store_from_nquads_median_ms={:.4}",
        source.len(),
        index.len(),
        minimum_ms(&rebuild),
        median_ms(&rebuild),
        minimum_ms(&reconstruct),
        median_ms(&reconstruct),
    );

    let mut total_query_min = 0.0;
    let mut total_evaluate_min = 0.0;
    let store = store_from_nquads(&index).expect("store");
    for query_id in REGISTERED_QUERY_IDS {
        // Whole current call path: reconstruct the store, then answer from it.
        let whole = samples(ITERATIONS, || {
            let value = super::query(&index, query_id).expect("query");
            std::hint::black_box(&value);
        });
        // The same answer against an already-built store: exactly what a
        // root-digest keyed store cache would leave behind. This calls the
        // product's own `query_on_store`, so the comparison includes solution
        // materialization and JSON building — Oxigraph's `execute()` is lazy,
        // and timing it alone would understate evaluation by an order of
        // magnitude.
        let evaluate = samples(ITERATIONS, || {
            let value = query_on_store(&store, query_id).expect("query on store");
            std::hint::black_box(&value);
        });
        total_query_min += minimum_ms(&whole);
        total_evaluate_min += minimum_ms(&evaluate);
        eprintln!(
            "semantic-index-perf query={query_id} whole_min_ms={:.4} whole_median_ms={:.4} \
             evaluate_only_min_ms={:.4} evaluate_only_median_ms={:.4} \
             reconstruction_share={:.4}",
            minimum_ms(&whole),
            median_ms(&whole),
            minimum_ms(&evaluate),
            median_ms(&evaluate),
            1.0 - minimum_ms(&evaluate) / minimum_ms(&whole),
        );
    }
    eprintln!(
        "semantic-index-perf panel_all_registered_queries whole_min_ms={total_query_min:.4} \
         evaluate_only_min_ms={total_evaluate_min:.4} \
         cacheable_saving_min_ms={:.4} cacheable_saving_share={:.4}",
        total_query_min - total_evaluate_min,
        (total_query_min - total_evaluate_min) / total_query_min,
    );
}
