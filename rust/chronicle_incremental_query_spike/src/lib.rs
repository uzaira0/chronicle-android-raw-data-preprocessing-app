//! Bounded Salsa trial against the real Chronicle preprocessing code.
//!
//! This crate is deliberately outside the production runtime. It answers one
//! question before Salsa is adopted: can real Chronicle inputs be tracked at
//! field granularity, execute in native Rust and browser WASM, stop propagation
//! when a recomputed value is equal, and restore a verified cache? It calls the
//! existing product parsers, qualification evaluator, fused Rust pipeline, and
//! typed view code. It does not define another product graph or algorithm.

use chronicle_chrono_kernel_wasm::pipeline_v2::{
    discover_timezones_v2_native, run_pipeline_v2_with_supports, PipelineV2OptionsJson,
    PipelineV2SupportFiles,
};
use chronicle_preprocessing_runtime_wasm::{
    evaluate_workspace_requirements_native, plan_stage_view_native, RuntimeSupportFiles,
    RUNTIME_PROTOCOL_VERSION,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

pub const SNAPSHOT_PROTOCOL: &str = "chronicle-salsa-product-trial-cache/v1";

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

#[salsa::db]
pub trait TrialDb: salsa::Database {
    fn record_query_body(&self, query: &'static str);
}

#[salsa::db]
#[derive(Clone)]
pub struct TrialDatabase {
    storage: salsa::Storage<Self>,
    query_bodies: Arc<Mutex<Vec<String>>>,
    will_execute: Arc<Mutex<Vec<String>>>,
}

impl Default for TrialDatabase {
    fn default() -> Self {
        let will_execute = Arc::<Mutex<Vec<String>>>::default();
        Self {
            // Explicit registration keeps the browser module smaller than
            // Salsa's link-time inventory while preserving a fixed persisted
            // ingredient order.
            storage: salsa::Storage::builder()
                .event_callback(Box::new({
                    let will_execute = Arc::clone(&will_execute);
                    move |event| {
                        if let salsa::EventKind::WillExecute { database_key } = event.kind {
                            will_execute
                                .lock()
                                .expect("trial event log lock")
                                .push(format!("{database_key:?}"));
                        }
                    }
                }))
                .ingredient::<RawInput>()
                .ingredient::<BaseOptionsInput>()
                .ingredient::<TrialSettings>()
                .ingredient::<FilterSupportInput>()
                .ingredient::<discover_timezones>()
                .ingredient::<selected_timezone_is_present>()
                .ingredient::<qualification_probe>()
                .ingredient::<qualification_ready>()
                .ingredient::<pipeline_probe>()
                .ingredient::<stage_view_probe>()
                .build(),
            query_bodies: Arc::default(),
            will_execute,
        }
    }
}

#[salsa::db]
impl salsa::Database for TrialDatabase {}

#[salsa::db]
impl TrialDb for TrialDatabase {
    fn record_query_body(&self, query: &'static str) {
        self.query_bodies
            .lock()
            .expect("trial query log lock")
            .push(query.to_string());
    }
}

impl TrialDatabase {
    pub fn take_query_bodies(&self) -> Vec<String> {
        std::mem::take(&mut *self.query_bodies.lock().expect("trial query log lock"))
    }

    pub fn take_will_execute(&self) -> Vec<String> {
        std::mem::take(&mut *self.will_execute.lock().expect("trial event log lock"))
    }

    pub fn clear_events(&self) {
        self.take_query_bodies();
        self.take_will_execute();
    }

    pub fn save_verified_snapshot(&mut self, identity: &str) -> Result<Vec<u8>, String> {
        let payload = serde_json::to_vec(&<dyn salsa::Database>::as_serialize(self))
            .map_err(|error| format!("serialize Salsa database: {error}"))?;
        serde_json::to_vec(&SnapshotEnvelope {
            protocol_version: SNAPSHOT_PROTOCOL.to_string(),
            identity: identity.to_string(),
            payload_sha256: sha256(&payload),
            payload,
        })
        .map_err(|error| format!("serialize verified snapshot envelope: {error}"))
    }

    pub fn restore_verified_snapshot(
        &mut self,
        bytes: &[u8],
        expected_identity: &str,
    ) -> Result<(), String> {
        let envelope: SnapshotEnvelope = serde_json::from_slice(bytes)
            .map_err(|error| format!("parse snapshot envelope: {error}"))?;
        if envelope.protocol_version != SNAPSHOT_PROTOCOL {
            return Err(format!(
                "unsupported snapshot protocol: {}",
                envelope.protocol_version
            ));
        }
        if envelope.identity != expected_identity {
            return Err(format!(
                "snapshot identity mismatch: expected={expected_identity} actual={}",
                envelope.identity
            ));
        }
        let actual_digest = sha256(&envelope.payload);
        if actual_digest != envelope.payload_sha256 {
            return Err(format!(
                "snapshot payload digest mismatch: declared={} actual={actual_digest}",
                envelope.payload_sha256
            ));
        }
        <dyn salsa::Database>::deserialize(
            self,
            &mut serde_json::Deserializer::from_slice(&envelope.payload),
        )
        .map_err(|error| format!("restore Salsa database: {error}"))
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct SnapshotEnvelope {
    protocol_version: String,
    identity: String,
    payload_sha256: String,
    payload: Vec<u8>,
}

#[salsa::input(persist)]
pub struct RawInput {
    #[returns(clone)]
    pub bytes: Arc<Vec<u8>>,
    #[returns(clone)]
    pub file_name: String,
}

#[salsa::input(persist)]
pub struct BaseOptionsInput {
    #[returns(clone)]
    pub json: String,
}

#[salsa::input(persist)]
pub struct TrialSettings {
    #[returns(clone)]
    pub timezone: String,
    #[returns(clone)]
    pub timezone_handling: String,
    #[returns(copy)]
    pub model_concurrent_usage: bool,
    #[returns(copy)]
    pub use_filter_file: bool,
    #[returns(clone)]
    pub study_name: String,
}

#[salsa::input(persist)]
pub struct FilterSupportInput {
    #[returns(copy)]
    pub present: bool,
    #[returns(clone)]
    pub file_name: String,
    #[returns(clone)]
    pub bytes: Arc<Vec<u8>>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, salsa::SalsaValue)]
pub struct QualificationProbe {
    pub ready: bool,
    pub report_sha256: String,
    pub assigned_roles: Vec<String>,
    pub open_roles: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, salsa::SalsaValue)]
pub struct PipelineProbe {
    pub original_rows: u32,
    pub processed_rows: u32,
    pub app_rows: u32,
    pub screen_rows: u32,
    pub timezone: String,
    pub step_digests_before_output: BTreeMap<String, String>,
    pub group_digests_before_output: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, salsa::SalsaValue)]
pub struct StageViewProbe {
    pub view_sha256: String,
    pub root_digest: String,
    pub step_count: usize,
}

fn parse_options(base: &str) -> Result<PipelineV2OptionsJson, String> {
    serde_json::from_str(base).map_err(|error| format!("parse trial base options: {error}"))
}

fn qualification_options(
    db: &dyn TrialDb,
    base: BaseOptionsInput,
    settings: TrialSettings,
) -> Result<PipelineV2OptionsJson, String> {
    let mut options = parse_options(&base.json(db))?;
    options.timezone = settings.timezone(db);
    options.timezone_handling = settings.timezone_handling(db);
    options.use_filter_file = settings.use_filter_file(db);
    Ok(options)
}

fn pipeline_options(
    db: &dyn TrialDb,
    base: BaseOptionsInput,
    settings: TrialSettings,
) -> Result<PipelineV2OptionsJson, String> {
    let mut options = qualification_options(db, base, settings)?;
    options.model_concurrent_usage = settings.model_concurrent_usage(db);
    Ok(options)
}

fn output_view_options(
    db: &dyn TrialDb,
    base: BaseOptionsInput,
    settings: TrialSettings,
) -> Result<PipelineV2OptionsJson, String> {
    let mut options = parse_options(&base.json(db))?;
    options.study_name = settings.study_name(db);
    Ok(options)
}

fn request_json(raw_bytes: &[u8], file_name: &str, options: &PipelineV2OptionsJson) -> String {
    serde_json::json!({
        "protocolVersion": RUNTIME_PROTOCOL_VERSION,
        "requestId": "salsa-product-trial",
        "command": "ExecuteWorkspace",
        "workspaceRootDigest": null,
        "workspaceId": format!("sha256:{}", "5".repeat(64)),
        "inputFileName": file_name,
        "inputSha256": sha256(raw_bytes),
        "options": options,
    })
    .to_string()
}

fn runtime_support(
    db: &dyn TrialDb,
    settings: TrialSettings,
    support: FilterSupportInput,
) -> Result<RuntimeSupportFiles, String> {
    let mut files = RuntimeSupportFiles::new();
    if settings.use_filter_file(db) && support.present(db) {
        let name = support.file_name(db);
        let bytes = support.bytes(db);
        files
            .put_with_name("filter_file", &name, &bytes)
            .map_err(|_| "real runtime rejected trial filter support".to_string())?;
    }
    Ok(files)
}

#[salsa::tracked(returns(clone), persist)]
pub fn discover_timezones(db: &dyn TrialDb, raw: RawInput) -> Result<Vec<String>, String> {
    db.record_query_body("discover_timezones");
    discover_timezones_v2_native(&raw.bytes(db))
}

#[salsa::tracked(returns(copy), persist)]
pub fn selected_timezone_is_present(
    db: &dyn TrialDb,
    raw: RawInput,
    settings: TrialSettings,
) -> bool {
    db.record_query_body("selected_timezone_is_present");
    let selected = settings.timezone(db);
    discover_timezones(db, raw)
        .unwrap_or_default()
        .iter()
        .any(|timezone| timezone == &selected)
}

#[salsa::tracked(returns(clone), persist)]
pub fn qualification_probe(
    db: &dyn TrialDb,
    raw: RawInput,
    base: BaseOptionsInput,
    settings: TrialSettings,
    support: FilterSupportInput,
) -> Result<QualificationProbe, String> {
    db.record_query_body("qualification_probe");
    let raw_bytes = raw.bytes(db);
    let options = qualification_options(db, base, settings)?;
    let supports = runtime_support(db, settings, support)?;
    // The input name is deliberately stable here: qualification depends on
    // bytes, media type, options, and role, not on a browser display label.
    let request = request_json(&raw_bytes, "trial-input.csv", &options);
    let report = evaluate_workspace_requirements_native(&request, &raw_bytes, &supports)?;
    let value: serde_json::Value = serde_json::from_str(&report)
        .map_err(|error| format!("parse real qualification report: {error}"))?;
    let assigned_roles = value["roleAssignments"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|assignment| assignment["role_id"].as_str().map(str::to_string))
        .collect::<Vec<_>>();
    let open_roles = value["openObligations"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|obligation| obligation["role_id"].as_str().map(str::to_string))
        .collect::<Vec<_>>();
    Ok(QualificationProbe {
        ready: value["ready"].as_bool().unwrap_or(false),
        report_sha256: sha256(report.as_bytes()),
        assigned_roles,
        open_roles,
    })
}

#[salsa::tracked(returns(clone), persist)]
pub fn qualification_ready(
    db: &dyn TrialDb,
    raw: RawInput,
    base: BaseOptionsInput,
    settings: TrialSettings,
    support: FilterSupportInput,
) -> Result<bool, String> {
    db.record_query_body("qualification_ready");
    qualification_probe(db, raw, base, settings, support).map(|probe| probe.ready)
}

#[salsa::tracked(returns(clone), persist)]
pub fn pipeline_probe(
    db: &dyn TrialDb,
    raw: RawInput,
    base: BaseOptionsInput,
    settings: TrialSettings,
    support: FilterSupportInput,
) -> Result<PipelineProbe, String> {
    db.record_query_body("pipeline_probe");
    if !qualification_ready(db, raw, base, settings, support)? {
        return Err("qualification is not ready".to_string());
    }
    let raw_bytes = raw.bytes(db);
    let options = pipeline_options(db, base, settings)?.into_pipeline_options();
    let filter_bytes = if settings.use_filter_file(db) && support.present(db) {
        support.bytes(db)
    } else {
        Arc::new(Vec::new())
    };
    let result = run_pipeline_v2_with_supports(
        &raw_bytes,
        &options,
        PipelineV2SupportFiles {
            filter_csv: &filter_bytes,
            ..PipelineV2SupportFiles::default()
        },
    )?;
    Ok(PipelineProbe {
        original_rows: result.original_row_count,
        processed_rows: result.processed_row_count,
        app_rows: result.app_row_count,
        screen_rows: result.screen_row_count,
        timezone: result.timezone,
        step_digests_before_output: result
            .pipeline_step_digests
            .into_iter()
            .filter(|(step, _)| step != "assemble_result")
            .collect(),
        group_digests_before_output: result
            .logical_stage_digests
            .into_iter()
            .filter(|(group, _)| group != "outputs")
            .collect(),
    })
}

#[salsa::tracked(returns(clone), persist)]
pub fn stage_view_probe(
    db: &dyn TrialDb,
    base: BaseOptionsInput,
    settings: TrialSettings,
) -> Result<StageViewProbe, String> {
    db.record_query_body("stage_view_probe");
    let options = output_view_options(db, base, settings)?;
    let view = plan_stage_view_native(
        &serde_json::to_string(&options)
            .map_err(|error| format!("serialize output-view options: {error}"))?,
    )?;
    let value: serde_json::Value =
        serde_json::from_str(&view).map_err(|error| format!("parse real stage view: {error}"))?;
    Ok(StageViewProbe {
        view_sha256: sha256(view.as_bytes()),
        root_digest: value["root_digest"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        step_count: value["payload"]["step_states"]
            .as_array()
            .map_or(0, Vec::len),
    })
}

/// Execute each representative real-product query once. Tests call the same
/// entry after controlled input changes and inspect both Salsa's WillExecute
/// events and the query-body log.
pub fn run_representative_queries(
    db: &dyn TrialDb,
    raw: RawInput,
    base: BaseOptionsInput,
    settings: TrialSettings,
    support: FilterSupportInput,
) -> Result<(bool, PipelineProbe, StageViewProbe), String> {
    let selected = selected_timezone_is_present(db, raw, settings);
    let pipeline = pipeline_probe(db, raw, base, settings, support)?;
    let view = stage_view_probe(db, base, settings)?;
    Ok((selected, pipeline, view))
}

/// Small exported browser entry used only to measure the trial's optimized
/// WASM module. Production continues to call the existing runtime crate.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn run_trial_once_wasm(raw_bytes: &[u8], options_json: &str) -> Result<String, String> {
    let options = parse_options(options_json)?;
    let db = TrialDatabase::default();
    let raw = RawInput::new(&db, Arc::new(raw_bytes.to_vec()), "trial-input.csv".into());
    let base = BaseOptionsInput::new(&db, options_json.to_string());
    let settings = TrialSettings::new(
        &db,
        options.timezone,
        options.timezone_handling,
        options.model_concurrent_usage,
        options.use_filter_file,
        options.study_name,
    );
    let support = FilterSupportInput::new(&db, false, "filter.csv".into(), Arc::new(Vec::new()));
    serde_json::to_string(&run_representative_queries(
        &db, raw, base, settings, support,
    )?)
    .map_err(|error| format!("serialize trial result: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use salsa::Setter;

    fn csv() -> Arc<Vec<u8>> {
        Arc::new(
            concat!(
                "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n",
                "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago\n",
                "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:01:00,America/Chicago\n"
            )
            .as_bytes()
            .to_vec(),
        )
    }

    fn base_options() -> String {
        serde_json::json!({
            "study_name": "Trial Study",
            "timezone": "America/Chicago",
            "timezone_handling": "selected-convert",
            "usage_session_mode": "app_usage",
            "include_app_output": true,
            "include_screen_output": false,
            "use_filter_file": false,
            "use_apps_forcing_screen_open": false,
            "use_background_apps_file": false,
            "use_app_codebook": false,
            "include_category_column": false,
            "deduplicate_exact_rows": true,
            "interaction_type_remap": [],
            "correct_duplicate_event_timestamps": true,
            "allow_stop_event_reuse": false,
            "use_activity_stopped_as_fallback": true,
            "apply_threshold_to_fallback": true,
            "long_duration_threshold_ns": 43200000000000_i64,
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
            "datetime_of_preprocessing": "2026-07-21 12:00:00 UTC",
            "model_concurrent_usage": false,
            "minimum_usage_duration": 60.0,
            "apply_minimum_usage_duration_to_concurrent_subintervals": false
        })
        .to_string()
    }

    fn inputs(
        db: &TrialDatabase,
    ) -> (
        RawInput,
        BaseOptionsInput,
        TrialSettings,
        FilterSupportInput,
    ) {
        (
            RawInput::new(db, csv(), "Raw P01.csv".to_string()),
            BaseOptionsInput::new(db, base_options()),
            TrialSettings::new(
                db,
                "America/Chicago".to_string(),
                "selected-convert".to_string(),
                false,
                false,
                "Trial Study".to_string(),
            ),
            FilterSupportInput::new(
                db,
                false,
                "filter.csv".to_string(),
                Arc::new(
                    b"app_package_name,known_application_labels\ncom.example.chat,Chat\n".to_vec(),
                ),
            ),
        )
    }

    fn assert_real_events(db: &TrialDatabase, expected_bodies: &[&str]) {
        let mut bodies = db.take_query_bodies();
        let will_execute = db.take_will_execute();
        let mut expected = expected_bodies
            .iter()
            .map(|name| (*name).to_string())
            .collect::<Vec<_>>();
        bodies.sort();
        expected.sort();
        assert_eq!(
            bodies, expected,
            "query execution set differed; validation may execute dependencies before their parent"
        );
        assert_eq!(
            will_execute.len(),
            bodies.len(),
            "every executed query body must have one Salsa WillExecute event: {will_execute:?}"
        );
    }

    #[test]
    fn real_product_queries_reuse_and_track_individual_fields() {
        let mut db = TrialDatabase::default();
        let (raw, base, settings, support) = inputs(&db);

        let first = run_representative_queries(&db, raw, base, settings, support).unwrap();
        assert!(first.0);
        assert_eq!(first.1.step_digests_before_output.len(), 54);
        assert_eq!(first.1.group_digests_before_output.len(), 14);
        assert_eq!(first.2.step_count, 55);
        assert_real_events(
            &db,
            &[
                "selected_timezone_is_present",
                "discover_timezones",
                "pipeline_probe",
                "qualification_ready",
                "qualification_probe",
                "stage_view_probe",
            ],
        );

        let identical = run_representative_queries(&db, raw, base, settings, support).unwrap();
        assert_eq!(identical, first);
        assert_real_events(&db, &[]);

        settings
            .set_study_name(&mut db)
            .to("Renamed Trial Study".to_string());
        let renamed = run_representative_queries(&db, raw, base, settings, support).unwrap();
        assert_eq!(renamed.0, first.0);
        assert_eq!(renamed.1, first.1);
        assert_ne!(renamed.2, first.2);
        assert_real_events(&db, &["stage_view_probe"]);

        settings.set_model_concurrent_usage(&mut db).to(true);
        let concurrent = run_representative_queries(&db, raw, base, settings, support).unwrap();
        assert_ne!(concurrent.1, first.1);
        assert_eq!(concurrent.2, renamed.2);
        assert_real_events(&db, &["pipeline_probe"]);

        raw.set_file_name(&mut db)
            .to("Renamed browser label.csv".to_string());
        let relabeled = run_representative_queries(&db, raw, base, settings, support).unwrap();
        assert_eq!(relabeled, concurrent);
        assert_real_events(&db, &[]);

        support.set_present(&mut db).to(true);
        settings.set_use_filter_file(&mut db).to(true);
        let filtered = run_representative_queries(&db, raw, base, settings, support).unwrap();
        assert_ne!(filtered.1, concurrent.1);
        assert_real_events(
            &db,
            &[
                "pipeline_probe",
                "qualification_ready",
                "qualification_probe",
            ],
        );

        support
            .set_file_name(&mut db)
            .to("same-bytes-renamed.csv".to_string());
        let support_relabeled =
            run_representative_queries(&db, raw, base, settings, support).unwrap();
        assert_eq!(support_relabeled, filtered);
        assert_real_events(&db, &["qualification_probe"]);
    }

    #[test]
    fn qualification_hole_blocks_the_real_pipeline_query() {
        let mut db = TrialDatabase::default();
        let (raw, base, settings, support) = inputs(&db);
        settings.set_use_filter_file(&mut db).to(true);
        let error = pipeline_probe(&db, raw, base, settings, support).unwrap_err();
        assert_eq!(error, "qualification is not ready");
        let qualification = qualification_probe(&db, raw, base, settings, support).unwrap();
        assert!(!qualification.ready);
        assert!(qualification
            .open_roles
            .contains(&"filter_file".to_string()));
        assert_real_events(
            &db,
            &[
                "pipeline_probe",
                "qualification_ready",
                "qualification_probe",
            ],
        );
    }

    #[test]
    fn equal_timezone_result_stops_downstream_after_raw_reparse() {
        let mut db = TrialDatabase::default();
        let (raw, _base, settings, _support) = inputs(&db);
        assert!(selected_timezone_is_present(&db, raw, settings));
        assert_real_events(&db, &["selected_timezone_is_present", "discover_timezones"]);

        let mut bytes = (*raw.bytes(&db)).clone();
        bytes.extend_from_slice(b"\n");
        raw.set_bytes(&mut db).to(Arc::new(bytes));
        assert!(selected_timezone_is_present(&db, raw, settings));
        assert_real_events(&db, &["discover_timezones"]);
    }

    #[test]
    fn verified_snapshot_reuses_queries_and_rejects_wrong_or_corrupt_state() {
        let mut db = TrialDatabase::default();
        let (raw, base, settings, support) = inputs(&db);
        let expected = run_representative_queries(&db, raw, base, settings, support).unwrap();
        db.clear_events();
        let identity = "implementation+contract+profile-lock:test";
        let snapshot = db.save_verified_snapshot(identity).unwrap();

        let mut restored = TrialDatabase::default();
        restored
            .restore_verified_snapshot(&snapshot, identity)
            .unwrap();
        restored.clear_events();
        let actual = run_representative_queries(&restored, raw, base, settings, support).unwrap();
        assert_eq!(actual, expected);
        assert_real_events(&restored, &[]);

        let mut wrong_identity = TrialDatabase::default();
        assert!(wrong_identity
            .restore_verified_snapshot(&snapshot, "different-build")
            .unwrap_err()
            .contains("identity mismatch"));

        let mut envelope: serde_json::Value = serde_json::from_slice(&snapshot).unwrap();
        envelope["payload"][0] =
            serde_json::Value::from(envelope["payload"][0].as_u64().unwrap_or_default() ^ 1);
        let corrupt = serde_json::to_vec(&envelope).unwrap();
        let mut corrupt_target = TrialDatabase::default();
        assert!(corrupt_target
            .restore_verified_snapshot(&corrupt, identity)
            .unwrap_err()
            .contains("digest mismatch"));
    }

    #[cfg(target_arch = "wasm32")]
    mod wasm {
        use super::*;
        use wasm_bindgen_test::*;

        wasm_bindgen_test_configure!(run_in_browser);

        #[wasm_bindgen_test]
        fn real_product_queries_execute_and_reuse_in_wasm() {
            let db = TrialDatabase::default();
            let (raw, base, settings, support) = inputs(&db);
            let first = run_representative_queries(&db, raw, base, settings, support).unwrap();
            assert_eq!(first.1.step_digests_before_output.len(), 54);
            db.clear_events();
            assert_eq!(
                run_representative_queries(&db, raw, base, settings, support).unwrap(),
                first
            );
            assert!(db.take_query_bodies().is_empty());
            assert!(db.take_will_execute().is_empty());
        }
    }
}
