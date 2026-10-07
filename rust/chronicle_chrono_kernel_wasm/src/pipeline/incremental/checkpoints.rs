use std::fmt;
use super::{
    Arc,
    IntervalQualityPolicy,
    PayloadHandle,
    Row,
    RowCheckpointScratch,
    TimezoneSelection,
    WORKFLOW_CHECKPOINT_PROTOCOL,
    WORKFLOW_ROW_SCHEMA,
    WorkflowCheckpoint,
    checkpoint_digest_field,
    checkpoint_digest_fixed16,
    checkpoint_for_exact_row_state,
    checkpoint_hasher,
    finish_checkpoint_digest,
    query_payload,
    row_checkpoint_parts,
    row_checkpoint_parts_for_rows,
    terminal_checkpoint_digest,
    workflow_checkpoint,
    workflow_checkpoint_with_known_membership_and_order,
    workflow_checkpoint_with_reusable_rows,
    workflow_rows_checkpoint,
};

    #[derive(Clone, serde::Serialize, serde::Deserialize)]
    pub(crate) struct QueryValue<T: Send + Sync + 'static> {
        pub(crate) value: PayloadHandle<T>,
        pub(crate) checkpoint: WorkflowCheckpoint,
        /// The product DAG checkpoint emitted at this step boundary. Keeping
        /// it with Salsa's memoized step result avoids re-hashing an unchanged
        /// row table every time only a later option changes.
        pub(crate) query_group_checkpoint: Option<WorkflowCheckpoint>,
    }

    impl<T: Send + Sync + 'static> PartialEq for QueryValue<T> {
        fn eq(&self, other: &Self) -> bool {
            self.checkpoint == other.checkpoint
        }
    }

    impl<T: Send + Sync + 'static> Eq for QueryValue<T> {}

    impl<T: Send + Sync + 'static> fmt::Debug for QueryValue<T> {
        fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter
                .debug_struct("QueryValue")
                .field("step", &self.checkpoint.subject_id)
                .field("digest", &self.checkpoint.terminal_digest)
                .finish()
        }
    }



    pub(crate) fn value_step<T: serde::Serialize + Send + Sync + 'static>(
        store: &crate::payload_store::PayloadStore,
        step: &str,
        value: T,
    ) -> Result<QueryValue<T>, String> {
        value_step_shared(store, step, Arc::new(value))
    }

    /// value_step for an already-shared value, so a step that passes its
    /// input through unchanged can reuse the upstream allocation. The
    /// checkpoint is byte-identical to value_step's.
    pub(crate) fn value_step_shared<T: serde::Serialize + Send + Sync + 'static>(
        store: &crate::payload_store::PayloadStore,
        step: &str,
        value: Arc<T>,
    ) -> Result<QueryValue<T>, String> {
        let fingerprint = super::super::value_fingerprint(&*value)
            .map_err(|error| format!("serialize {step} checkpoint: {error}"))?;
        Ok(QueryValue {
            value: query_payload(store, value),
            checkpoint: workflow_checkpoint(step, &[], &[("value", &fingerprint)]),
            query_group_checkpoint: None,
        })
    }



    pub(crate) fn rows_step(
        store: &crate::payload_store::PayloadStore, step: &str, rows: Vec<Row>) -> QueryValue<Vec<Row>> {
        let checkpoint = workflow_rows_checkpoint(step, &rows);
        QueryValue {
            value: query_payload(store, Arc::new(rows)),
            checkpoint,
            query_group_checkpoint: None,
        }
    }

    pub(crate) fn same_row_state(left: &WorkflowCheckpoint, right: &WorkflowCheckpoint) -> bool {
        left.row_membership_digest == right.row_membership_digest
            && left.row_order_digest == right.row_order_digest
            && left.temporal_state_digest == right.temporal_state_digest
            && left.classification_digest == right.classification_digest
            && left.payload_digest == right.payload_digest
            && left.schema_digest == right.schema_digest
    }

    /// Keep the upstream row allocation when a real step is observationally
    /// unchanged. The step still has its own checkpoint and execution event;
    /// only the identical immutable row table is shared between Salsa memos.
    pub(crate) fn rows_step_reusing(
        store: &crate::payload_store::PayloadStore,
        step: &str,
        upstream: &QueryValue<Vec<Row>>,
        rows: Vec<Row>,
    ) -> Result<QueryValue<Vec<Row>>, String> {
        // The upstream table is often spilled by the 512 MiB browser budget.
        // Reloading and decoding it solely to compare with rows already in
        // hand is much more expensive than hashing the new rows. A resident
        // table retains the earlier component-reuse fast path.
        let previous = upstream.value.lease_if_resident()?;
        let exact_same_rows = previous.as_ref().is_some_and(|previous| {
            rows.len() == previous.len()
                && rows
                    .iter()
                    .zip(previous.iter())
                    .all(|(left, right)| Arc::ptr_eq(&left.0, &right.0))
        });
        let checkpoint = if exact_same_rows {
            checkpoint_for_exact_row_state(step, &upstream.checkpoint, &[])
        } else if previous.as_ref().is_some_and(|previous| rows.len() == previous.len()) {
            let parts = row_checkpoint_parts_for_rows(&rows);
            workflow_checkpoint_with_reusable_rows(
                step,
                &rows,
                &[],
                &parts,
                previous.as_ref().expect("resident previous rows"),
                &upstream.checkpoint,
            )
        } else {
            workflow_rows_checkpoint(step, &rows)
        };
        let value = if exact_same_rows || same_row_state(&upstream.checkpoint, &checkpoint) {
            upstream.value.clone()
        } else {
            query_payload(store, Arc::new(rows))
        };
        Ok(QueryValue {
            value,
            checkpoint,
            query_group_checkpoint: None,
        })
    }

    pub(crate) fn unchanged_rows_step(step: &str, upstream: &QueryValue<Vec<Row>>) -> QueryValue<Vec<Row>> {
        QueryValue {
            value: upstream.value.clone(),
            checkpoint: checkpoint_for_exact_row_state(step, &upstream.checkpoint, &[]),
            query_group_checkpoint: None,
        }
    }

    pub(crate) fn unchanged_rows_with_payload<P: serde::Serialize>(
        step: &str,
        upstream: &QueryValue<Vec<Row>>,
        payload: &P,
    ) -> Result<QueryValue<Vec<Row>>, String> {
        let fingerprint = super::super::value_fingerprint(payload)
            .map_err(|error| format!("serialize {step} checkpoint: {error}"))?;
        Ok(QueryValue {
            value: upstream.value.clone(),
            checkpoint: checkpoint_for_exact_row_state(
                step,
                &upstream.checkpoint,
                &[("value", &fingerprint)],
            ),
            query_group_checkpoint: None,
        })
    }



    pub(crate) fn value_payload_step<T: Send + Sync + 'static, P: serde::Serialize>(
        store: &crate::payload_store::PayloadStore,
        step: &str,
        value: T,
        payload: &P,
    ) -> Result<QueryValue<T>, String> {
        let checkpoint = value_payload_checkpoint(step, payload)?;
        Ok(QueryValue {
            value: query_payload(store, Arc::new(value)),
            checkpoint,
            query_group_checkpoint: None,
        })
    }

    pub(crate) fn value_payload_checkpoint<P: serde::Serialize>(
        step: &str,
        payload: &P,
    ) -> Result<WorkflowCheckpoint, String> {
        let fingerprint = super::super::value_fingerprint(payload)
            .map_err(|error| format!("serialize {step} checkpoint: {error}"))?;
        Ok(workflow_checkpoint(step, &[], &[("value", &fingerprint)]))
    }

    pub(crate) fn rows_and_value_checkpoint<P: serde::Serialize>(
        step: &str,
        rows: &[Row],
        payload: &P,
    ) -> Result<WorkflowCheckpoint, String> {
        let fingerprint = super::super::value_fingerprint(payload)
            .map_err(|error| format!("serialize {step} checkpoint: {error}"))?;
        Ok(workflow_checkpoint(
            step,
            &[("rows", rows)],
            &[("value", &fingerprint)],
        ))
    }

    pub(crate) fn rows_and_value_checkpoint_reusing<P: serde::Serialize>(
        step: &str,
        rows: &[Row],
        previous_rows: &[Row],
        previous_checkpoint: &WorkflowCheckpoint,
        payload: &P,
    ) -> Result<WorkflowCheckpoint, String> {
        let fingerprint = super::super::value_fingerprint(payload)
            .map_err(|error| format!("serialize {step} checkpoint: {error}"))?;
        let parts = row_checkpoint_parts_for_rows(rows);
        Ok(workflow_checkpoint_with_reusable_rows(
            step,
            rows,
            &[("value", &fingerprint)],
            &parts,
            previous_rows,
            previous_checkpoint,
        ))
    }

    pub(crate) fn rows_and_value_checkpoint_reusing_membership_and_order<P: serde::Serialize>(
        step: &str,
        rows: &[Row],
        previous_rows: &[Row],
        previous_checkpoint: &WorkflowCheckpoint,
        payload: &P,
    ) -> Result<WorkflowCheckpoint, String> {
        let fingerprint = super::super::value_fingerprint(payload)
            .map_err(|error| format!("serialize {step} checkpoint: {error}"))?;
        Ok(workflow_checkpoint_with_known_membership_and_order(
            step,
            rows,
            &[("value", &fingerprint)],
            previous_rows,
            previous_checkpoint,
        ))
    }

    #[derive(Clone, serde::Serialize, serde::Deserialize)]
    pub(crate) struct CanonicalTemporalSequence {
        /// Exact bytes consumed by the v6 temporal-state checkpoint for each
        /// row, in canonical source-identity order (24 bytes per row: 8-byte
        /// length frame + the 16-byte temporal part; identity is committed by
        /// the membership digest in the same order). Keeping this private
        /// buffer lets a repeated threshold edit patch changed rows and issue
        /// one SIMD-friendly BLAKE3 update instead of rebuilding 100k small
        /// hash writes.
        pub(crate) encoded_rows: Arc<Vec<u8>>,
        /// Current row index -> canonical source-identity position.
        pub(crate) canonical_positions: Arc<Vec<u32>>,
    }

    /// v6 temporal-state stride in `CanonicalTemporalSequence::encoded_rows`.
    pub(crate) const TEMPORAL_SEQUENCE_STRIDE: usize = 24;

    /// Offset of the 32-byte temporal part within one stride.
    pub(crate) const TEMPORAL_SEQUENCE_PART_OFFSET: usize = 8;

    pub(crate) fn canonical_row_order(rows: &[Row]) -> Vec<usize> {
        let mut canonical_order = (0..rows.len()).collect::<Vec<_>>();
        if rows.windows(2).all(|pair| {
            pair[0]
                .source_data_rows
                .cmp_expanded(&pair[1].source_data_rows)
                .then(pair[0].index.cmp(&pair[1].index))
                .is_le()
        }) {
            return canonical_order;
        }
        canonical_order.sort_by(|left, right| {
            rows[*left]
                .source_data_rows
                .cmp_expanded(&rows[*right].source_data_rows)
                .then(rows[*left].index.cmp(&rows[*right].index))
        });
        canonical_order
    }

    pub(crate) fn canonical_temporal_sequence_with_order(
        rows: &[Row],
        canonical_order: &[usize],
    ) -> CanonicalTemporalSequence {
        debug_assert_eq!(canonical_order.len(), rows.len());
        let mut canonical_positions = vec![0_u32; rows.len()];
        let mut encoded_rows = Vec::with_capacity(rows.len() * TEMPORAL_SEQUENCE_STRIDE);
        let mut scratch = RowCheckpointScratch::default();
        for (position, &row_index) in canonical_order.iter().enumerate() {
            canonical_positions[row_index] = position as u32;
            let parts = row_checkpoint_parts(&rows[row_index], &mut scratch);
            checkpoint_digest_fixed16(&mut encoded_rows, &parts.temporal);
        }
        CanonicalTemporalSequence {
            encoded_rows: Arc::new(encoded_rows),
            canonical_positions: Arc::new(canonical_positions),
        }
    }

    pub(crate) fn temporal_digest_with_changed_rows(
        base: &CanonicalTemporalSequence,
        rows: &[Row],
        changed_row_indices: &[u32],
    ) -> String {
        debug_assert_eq!(base.canonical_positions.len(), rows.len());
        let mut encoded_rows = (*base.encoded_rows).clone();
        let mut scratch = RowCheckpointScratch::default();
        for &row_index in changed_row_indices {
            let row_index = row_index as usize;
            let canonical_position = base.canonical_positions[row_index] as usize;
            let temporal_offset =
                canonical_position * TEMPORAL_SEQUENCE_STRIDE + TEMPORAL_SEQUENCE_PART_OFFSET;
            let parts = row_checkpoint_parts(&rows[row_index], &mut scratch);
            encoded_rows[temporal_offset..temporal_offset + 16].copy_from_slice(&parts.temporal);
        }
        let mut temporal = checkpoint_hasher("temporal-state");
        temporal.update(&1_u64.to_le_bytes());
        checkpoint_digest_field(&mut temporal, b"rows");
        temporal.update(&(rows.len() as u64).to_le_bytes());
        temporal.update(&encoded_rows);
        finish_checkpoint_digest(temporal)
    }

    pub(crate) fn checkpoint_with_known_row_components<P: serde::Serialize>(
        step: &str,
        previous: &WorkflowCheckpoint,
        temporal_state_digest: String,
        payload: &P,
    ) -> Result<WorkflowCheckpoint, String> {
        let fingerprint = super::super::value_fingerprint(payload)
            .map_err(|error| format!("serialize {step} checkpoint: {error}"))?;
        Ok(checkpoint_with_known_row_component_payloads(
            step,
            previous,
            temporal_state_digest,
            &[("value", &fingerprint)],
        ))
    }

    pub(crate) fn checkpoint_with_known_row_component_payloads(
        step: &str,
        previous: &WorkflowCheckpoint,
        temporal_state_digest: String,
        payloads: &[(&str, &[u8])],
    ) -> WorkflowCheckpoint {
        let mut payload_hasher = checkpoint_hasher("payload");
        let mut schema = checkpoint_hasher("schema");
        checkpoint_digest_field(&mut schema, WORKFLOW_ROW_SCHEMA.as_bytes());
        schema.update(&1_u64.to_le_bytes());
        checkpoint_digest_field(&mut schema, b"rows");
        payload_hasher.update(&(payloads.len() as u64).to_le_bytes());
        schema.update(&(payloads.len() as u64).to_le_bytes());
        for (label, bytes) in payloads {
            checkpoint_digest_field(&mut payload_hasher, label.as_bytes());
            checkpoint_digest_field(&mut payload_hasher, bytes);
            checkpoint_digest_field(&mut schema, label.as_bytes());
        }
        let payload_digest = finish_checkpoint_digest(payload_hasher);
        let schema_digest = finish_checkpoint_digest(schema);
        let terminal_digest = terminal_checkpoint_digest(
            step,
            [
                &previous.row_membership_digest,
                &previous.row_order_digest,
                &temporal_state_digest,
                &previous.classification_digest,
                &payload_digest,
                &schema_digest,
            ],
        );
        WorkflowCheckpoint {
            protocol_version: WORKFLOW_CHECKPOINT_PROTOCOL.into(),
            subject_id: step.into(),
            row_membership_digest: previous.row_membership_digest.clone(),
            row_order_digest: previous.row_order_digest.clone(),
            temporal_state_digest,
            classification_digest: previous.classification_digest.clone(),
            payload_digest,
            schema_digest,
            terminal_digest,
        }
    }

    pub(crate) fn review_passthrough_checkpoint<P: serde::Serialize>(
        step: &str,
        upstream: &WorkflowCheckpoint,
        payload: &P,
    ) -> Result<WorkflowCheckpoint, String> {
        let fingerprint = super::super::value_fingerprint(payload)
            .map_err(|error| format!("serialize {step} review checkpoint: {error}"))?;
        Ok(workflow_checkpoint(
            step,
            &[],
            &[
                ("review_passthrough", upstream.terminal_digest.as_bytes()),
                ("value", &fingerprint),
            ],
        ))
    }

    /// A cheap Merkle-style checkpoint for an intermediate review step. Its
    /// identity is derived from exact upstream checkpoints and the step's own
    /// semantic parameters. The final row-producing boundary is still hashed
    /// from its actual rows, so review mode does not repeatedly hash the same
    /// 100k-row table at every adjacent logical boundary.
    pub(crate) fn review_derived_checkpoint<P: serde::Serialize>(
        step: &str,
        dependencies: &[(&str, &WorkflowCheckpoint)],
        parameters: &P,
    ) -> Result<WorkflowCheckpoint, String> {
        let dependencies = dependencies
            .iter()
            .map(|(role, checkpoint)| {
                serde_json::json!({
                    "role": role,
                    "subjectId": checkpoint.subject_id,
                    "terminalDigest": checkpoint.terminal_digest,
                })
            })
            .collect::<Vec<_>>();
        value_payload_checkpoint(
            step,
            &serde_json::json!({
                "checkpointMode": "review-derived-v1",
                "dependencies": dependencies,
                "parameters": parameters,
            }),
        )
    }

    /// Checkpoint parameters for `suppress_excluded_timing`.
    ///
    /// The default policy contributes nothing, so the step's digest is exactly
    /// what it was before the option existed. Any other policy names itself,
    /// which is what stops one policy's cached rows from being served under
    /// another policy's receipt.
    pub(crate) fn interval_quality_checkpoint_payload(policy: IntervalQualityPolicy) -> serde_json::Value {
        if policy.blanks_filtered_timing() {
            serde_json::json!({})
        } else {
            serde_json::json!({ "intervalQualityPolicy": policy.canonical_id() })
        }
    }

    pub(crate) fn review_passthrough_rows<P: serde::Serialize>(
        step: &str,
        upstream: &QueryValue<Vec<Row>>,
        payload: &P,
        query_group: Option<&str>,
    ) -> Result<QueryValue<Vec<Row>>, String> {
        let checkpoint = review_passthrough_checkpoint(step, &upstream.checkpoint, payload)?;
        let query_group_checkpoint = query_group.map(|node| {
            workflow_checkpoint(
                node,
                &[],
                &[("review_passthrough", checkpoint.terminal_digest.as_bytes())],
            )
        });
        Ok(QueryValue {
            value: upstream.value.clone(),
            checkpoint,
            query_group_checkpoint,
        })
    }

    #[derive(Clone, serde::Serialize, serde::Deserialize)]
    pub(crate) struct SelectedTimezone {
        pub(crate) rows: PayloadHandle<Vec<Row>>,
        pub(crate) target_timezone: String,
        pub(crate) action: String,
    }



    pub(crate) fn selected_timezone_step(
        store: &crate::payload_store::PayloadStore,
        step: &str,
        upstream: &QueryValue<Vec<Row>>,
        selected: TimezoneSelection,
    ) -> Result<QueryValue<SelectedTimezone>, String> {
        let metadata = crate::pipeline_v2::source::timezone_metadata(&selected.target_timezone, selected.action).checkpoint_payload();
        let fingerprint = super::super::value_fingerprint(&metadata)
            .map_err(|error| format!("serialize {step} checkpoint: {error}"))?;
        let exact_same_rows = upstream
            .value
            .lease_if_resident()?
            .is_some_and(|upstream_rows| Arc::ptr_eq(&selected.rows, &upstream_rows.shared()));
        let checkpoint = if exact_same_rows {
            checkpoint_for_exact_row_state(step, &upstream.checkpoint, &[("value", &fingerprint)])
        } else {
            workflow_checkpoint(
                step,
                &[("rows", &selected.rows)],
                &[("value", &fingerprint)],
            )
        };
        Ok(QueryValue {
            value: query_payload(store, Arc::new(SelectedTimezone {
                rows: query_payload(store, selected.rows.clone()),
                target_timezone: selected.target_timezone,
                action: selected.action.to_string(),
            })),
            checkpoint,
            query_group_checkpoint: None,
        })
    }

    pub(crate) fn with_logical_rows(
        mut step: QueryValue<Vec<Row>>,
        query_group_id: &str,
    ) -> QueryValue<Vec<Row>> {
        step.query_group_checkpoint = Some(checkpoint_for_exact_row_state(
            query_group_id,
            &step.checkpoint,
            &[],
        ));
        step
    }

    pub(crate) fn required_query_group_checkpoint<T: Send + Sync + 'static>(
        step: &QueryValue<T>,
        query_group_id: &str,
    ) -> Result<WorkflowCheckpoint, String> {
        let checkpoint = step.query_group_checkpoint.clone().ok_or_else(|| {
            format!(
                "{} did not retain the required {query_group_id} workflow checkpoint",
                step.checkpoint.subject_id
            )
        })?;
        if checkpoint.subject_id != query_group_id {
            return Err(format!(
                "{} retained workflow checkpoint {} instead of {query_group_id}",
                step.checkpoint.subject_id, checkpoint.subject_id
            ));
        }
        Ok(checkpoint)
    }
