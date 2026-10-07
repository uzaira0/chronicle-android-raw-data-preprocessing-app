#[cfg(feature = "incremental-v2")]
#[test]
fn payload_budget_preserves_pipeline_bytes_and_reuse() {
    use chronicle_chrono_kernel_wasm::payload_store::{
        replace_current_store, MemorySpillBackend, PayloadStore,
    };
    use chronicle_chrono_kernel_wasm::pipeline_v2::{
        IncrementalPipelineV2Engine, PipelineV2OptionsJson, PipelineV2SupportFiles,
    };
    use sha2::{Digest, Sha256};
    use std::sync::Arc;

    let raw = include_bytes!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../web/src/testSupport/fixtures/b03-b04-duration-boundaries.csv"
    ));
    let options: PipelineV2OptionsJson = serde_json::from_value(serde_json::json!({
        "study_name": "Payload residency",
        "timezone": "America/Chicago",
        "timezone_handling": "selected-convert",
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
        "custom_app_engagement_duration": 300.0,
        "long_data_time_gap_thresholds": [1.0],
        "long_usage_duration_thresholds": [1.0],
        "same_app_stop_types": ["Activity Paused", "Activity Resumed"],
        "other_stop_types": ["Activity Resumed", "Device Shutdown"],
        "interaction_types_to_remove": [],
        "screen_auto_lock_timeout_seconds": 120.0,
        "screen_auto_lock_tolerance_seconds": 30.0,
        "screen_manual_lock_max_tail_seconds": 30.0,
        "screen_keyguard_near_stop_seconds": 2.0,
        "datetime_of_preprocessing": "2026-07-23 00:00:00 UTC",
        "enable_aggregates": true,
        "materialize_visualization_data": true
    }))
    .unwrap();
    let options = options.into_pipeline_options();
    let run = |budget| {
        let store = PayloadStore::new(budget, Arc::new(MemorySpillBackend::default()));
        let previous = replace_current_store(store.clone());
        let mut engine = IncrementalPipelineV2Engine::default();
        let execution = engine
            .execute(raw, &options, PipelineV2SupportFiles::default())
            .unwrap();
        assert!(!execution.result.app_csv_bytes.is_empty());
        // The result serialization includes every CSV/JSON artifact, aggregate,
        // lineage record, count, and every component/terminal checkpoint digest.
        let bytes = serde_json::to_vec(&*execution.result).unwrap();
        let digest = Sha256::digest(&bytes);
        let review_base = engine.export_review_base().unwrap();
        let reconstruction_base = engine.export_reconstruction_base().unwrap();
        store.evict_unpinned().unwrap();
        let warm = engine
            .execute(raw, &options, PipelineV2SupportFiles::default())
            .unwrap();
        assert_eq!(bytes, serde_json::to_vec(&*warm.result).unwrap());
        assert!(warm.executed_queries.is_empty());
        let mut changed_options = options.clone();
        changed_options.model_concurrent_usage = !options.model_concurrent_usage;
        let changed = engine
            .execute(raw, &changed_options, PipelineV2SupportFiles::default())
            .unwrap();
        let changed_bytes = serde_json::to_vec(&*changed.result).unwrap();
        store.evict_unpinned().unwrap();
        let stats = store.stats();
        replace_current_store(previous);
        (
            bytes,
            digest,
            review_base,
            reconstruction_base,
            changed_bytes,
            changed.executed_queries,
            stats,
        )
    };
    let unlimited = run(0);
    let tiny = run(1);
    assert_eq!(unlimited.0, tiny.0, "artifact/result bytes");
    assert_eq!(unlimited.1, tiny.1, "result digest");
    assert_eq!(unlimited.2, tiny.2, "review v17 base bytes");
    assert_eq!(unlimited.3, tiny.3, "reconstruction v23 base bytes");
    assert_eq!(unlimited.4, tiny.4, "changed-option result bytes");
    assert_eq!(unlimited.5, tiny.5, "Salsa execution evidence");
    assert!(
        !tiny.5.is_empty(),
        "the changed option must recompute something"
    );
    assert!(
        unlimited.4 != unlimited.0,
        "the changed option must move the result bytes"
    );
    assert_eq!(unlimited.6.spilled_count, 0);
    assert_eq!(unlimited.6.reload_count, 0);
    assert!(tiny.6.spilled_count > 0);
    assert!(tiny.6.reload_count > 0);
    assert!(tiny.6.resident_bytes < unlimited.6.resident_bytes);
}

// Expanded beside the existing private Row fixture, keeping Row private and
// all new residency tests in this file. The integration target runs the public
// pipeline test above; the library test target also runs this exact Row test.
#[allow(unused_macros)]
macro_rules! payload_row_roundtrip {
    ($rows:path, $checkpoint:path, $parts:path) => {
        #[test]
        fn row_payload_roundtrip_recomputes_equal_checkpoints_and_keeps_sharing_and_pinning() {
            use crate::payload_store::{MemorySpillBackend, PayloadStore};
            use std::sync::Arc;
            let mut rows = $rows();
            let search = crate::pipeline_v2::LineageSearchEvidence {
                protocol_version: Arc::new("chronicle-lineage-search/v1".into()),
                reason: Arc::new("no-qualifying-stop".into()),
                index_space: Arc::new("pipeline-event-order".into()),
                start_participant_id: Arc::new("shared participant".into()),
                start_event_index: 0,
                end_event_index_exclusive: 4,
                candidate_event_count: 4,
                candidate_chain_digest: crate::pipeline_v2::LineageSearchDigest::parse(&format!(
                    "blake3:{}",
                    "00".repeat(32)
                ))
                .unwrap(),
            };
            rows[0].lineage_searches = Arc::new(smallvec::smallvec![search]);
            rows[0].codebook_fields = Arc::new(vec![Some("shared codebook".into())]);
            rows[1].lineage_searches = Arc::new((*rows[0].lineage_searches).clone());
            rows[1].codebook_fields = Arc::new((*rows[0].codebook_fields).clone());
            rows[1].source_data_rows = rows[0].source_data_rows.clone();
            rows.push(rows[0].clone());
            let checkpoint = $checkpoint("spill_roundtrip", &rows);
            let parts = $parts(&rows);
            let bytes = crate::pipeline_v2::with_serialized_row_string_table(|| {
                postcard::to_allocvec(&rows)
            })
            .unwrap();
            let store = PayloadStore::new(0, Arc::new(MemorySpillBackend::default()));
            let handle = store.publish(Arc::new(rows), bytes.len() as u64);
            let lease = store.lease(&handle).unwrap();
            let charged_bytes = store.stats().resident_bytes;
            assert!(charged_bytes > bytes.len() as u64, "resident row charge includes deep allocations");
            let duplicate = store.publish(lease.shared(), bytes.len() as u64);
            assert_eq!(store.stats().resident_bytes, charged_bytes, "republishing the same allocation has no second charge");
            drop(duplicate);
            store.set_budget_bytes(1).unwrap();
            store.evict_unpinned().unwrap();
            assert_eq!(store.stats().spilled_count, 0, "lease pins the payload");
            drop(lease);
            assert_eq!(store.stats().resident_bytes, 0);
            assert!(store.stats().spilled_count > 0);
            let restored = store.lease(&handle).unwrap();
            assert_eq!(
                bytes,
                crate::pipeline_v2::with_serialized_row_string_table(|| postcard::to_allocvec(
                    &*restored
                ))
                .unwrap()
            );
            assert_eq!(parts, $parts(&restored));
            assert_eq!(checkpoint, $checkpoint("spill_roundtrip", &restored));
            assert!(Arc::ptr_eq(
                &restored[0].lineage_searches,
                &restored[1].lineage_searches
            ));
            assert!(Arc::ptr_eq(
                &restored[0].source_data_rows.0,
                &restored[1].source_data_rows.0
            ));
            assert!(Arc::ptr_eq(
                &restored[0].codebook_fields,
                &restored[1].codebook_fields
            ));
            assert!(Arc::ptr_eq(&restored[0].0, &restored.last().unwrap().0));
            assert!(store.stats().reload_count > 0);
            drop(handle);
            assert!(store.stats().resident_bytes > 0, "a lease owns its entry");
            drop(restored);
            assert_eq!(store.stats().resident_bytes, 0);

            let previous = crate::payload_store::replace_current_store(store.clone());
            let matcher = super::super::query_payload(&store, Arc::new(super::super::MatcherOutput {
                eyes_validation_expected_participant_ids: ["P01".to_string()].into(),
                schoedel_validation_witness: Some(crate::pipeline_v2::SchoedelValidationWitness {
                    trusted_retained_event_count: 7,
                    decisive_participant_ids: ["P01".to_string()].into(),
                }),
                schoedel_candidate_rows: Some($rows()),
                ..Default::default()
            }));
            store.evict_unpinned().unwrap();
            let restored = matcher.lease().unwrap();
            assert!(restored
                .eyes_validation_expected_participant_ids
                .contains("P01"));
            let witness = restored.schoedel_validation_witness.as_ref().unwrap();
            assert_eq!(witness.trusted_retained_event_count, 7);
            assert!(witness.decisive_participant_ids.contains("P01"));
            assert_eq!(
                restored.schoedel_candidate_rows.as_ref().unwrap().len(),
                $rows().len()
            );
            drop(restored);

            let mut engine = super::TrackedEngine::default();
            let execution = engine
                .execute(
                    &super::csv(),
                    &super::pipeline_options(),
                    crate::pipeline_v2::PipelineV2SupportFiles::default(),
                    true,
                )
                .unwrap();
            drop(execution);
            let inputs = engine.inputs.unwrap();
            let primary = super::super::assemble_primary_outputs(
                &engine.db,
                inputs.raw,
                inputs.early,
                inputs.usage,
                inputs.usage_support,
                inputs.late,
                inputs.late_support,
                inputs.output,
            )
            .unwrap();
            let memo = primary.value.lease().unwrap();
            store.evict_unpinned().unwrap();
            for bytes in [
                &memo.app_csv_bytes,
                &memo.screen_csv_bytes,
                &memo.credited_app_csv_bytes,
                &memo.notification_contact_csv_bytes,
                &memo.polled_emulation_csv_bytes,
                &memo.review_summary_json_bytes,
                &memo.visualization_data_json_bytes,
            ] {
                assert_eq!(bytes.resident_bytes(), 0, "primary memo pins artifact text");
            }
            for aggregate in memo.aggregate_csv_outputs.iter() {
                assert_eq!(
                    aggregate.bytes.resident_bytes(),
                    0,
                    "primary memo pins aggregate text"
                );
            }
            assert!(
                !memo.row_lineage.is_resident(),
                "primary memo pins expanded lineage"
            );
            crate::payload_store::replace_current_store(previous);
        }
    };
}
