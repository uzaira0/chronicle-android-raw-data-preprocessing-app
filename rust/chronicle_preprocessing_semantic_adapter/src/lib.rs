//! Semantic-federation adapter for the Chronicle raw-data preprocessing app.
//!
//! The app's existing fused Rust/WASM pipeline remains the preprocessing
//! implementation. This crate consumes shared release/materialization
//! contracts and owns only the app-specific plan, DAG propagation, bindings,
//! evidence projection, storage adapter, and typed views. It is not a
//! cross-product graph engine and it does not reimplement preprocessing.

pub mod capabilities;
pub mod journal;
pub mod materialize;
pub mod model;
pub mod protocol;
pub mod scheduler;
pub mod storage;
pub mod views;

pub use capabilities::{
    node_binding, step_binding, NodeBinding, PhysicalStage, StepBinding, EMBEDDED_PLAN_SHA256,
    EMBEDDED_PRODUCT_CONTRACT_SHA256, EMBEDDED_PROFILE_LOCK_SHA256, EMBEDDED_PROFILE_SHA256,
    EMBEDDED_RUNTIME_AUTHORITY_SHA256, NODE_BINDINGS, STEP_BINDINGS,
};
pub use materialize::{evaluate_materialization, Materialization};
pub use model::*;
pub use scheduler::{CapabilityExecutor, ExecutionInputs, ProducedArtifact, Scheduler, Workspace};
pub use storage::{ArtifactStore, MemoryCas};

pub fn embedded_plan() -> ChroniclePlan {
    serde_json::from_str(include_str!(concat!(
        env!("OUT_DIR"),
        "/chronicle.plan.json"
    )))
    .expect("build.rs validated embedded preprocessing-app plan")
}

pub fn embedded_plan_bytes() -> &'static [u8] {
    include_bytes!(concat!(env!("OUT_DIR"), "/chronicle.plan.json"))
}

pub fn embedded_runtime_authority_bytes() -> &'static [u8] {
    include_bytes!(concat!(env!("OUT_DIR"), "/runtime-authority.json"))
}

pub fn embedded_profile_bytes() -> &'static [u8] {
    include_bytes!(concat!(env!("OUT_DIR"), "/semantic-profile.json"))
}

pub fn embedded_profile_lock_bytes() -> &'static [u8] {
    include_bytes!(concat!(env!("OUT_DIR"), "/semantic-profile.lock"))
}

#[cfg(test)]
mod embedded_tests {
    use super::*;
    use sha2::{Digest, Sha256};

    fn digest(bytes: &[u8]) -> String {
        format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
    }

    #[test]
    fn every_embedded_contract_surface_matches_its_build_time_digest() {
        assert_eq!(digest(embedded_plan_bytes()), EMBEDDED_PLAN_SHA256);
        assert_eq!(
            digest(embedded_runtime_authority_bytes()),
            EMBEDDED_RUNTIME_AUTHORITY_SHA256
        );
        assert_eq!(digest(embedded_profile_bytes()), EMBEDDED_PROFILE_SHA256);
        assert_eq!(
            digest(embedded_profile_lock_bytes()),
            EMBEDDED_PROFILE_LOCK_SHA256
        );
        assert_eq!(embedded_plan().nodes.len(), 15);
    }
}

#[cfg(feature = "wasm")]
mod wasm {
    use wasm_bindgen::prelude::*;

    #[wasm_bindgen]
    pub fn embedded_plan_json() -> String {
        include_str!(concat!(env!("OUT_DIR"), "/chronicle.plan.json")).to_string()
    }

    #[wasm_bindgen]
    pub fn evaluate_requirements_json(
        assignments_json: &str,
        options_json: &str,
    ) -> Result<String, JsValue> {
        let assignments = serde_json::from_str(assignments_json)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let options = serde_json::from_str(options_json)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let materialization = crate::evaluate_materialization(
            &crate::embedded_plan(),
            &assignments,
            &options,
            &Default::default(),
            &Default::default(),
        );
        serde_json::to_string(&materialization)
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }
}
