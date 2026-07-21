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
    NODE_BINDINGS, STEP_BINDINGS,
};
pub use materialize::{evaluate_materialization, Materialization};
pub use model::*;
pub use scheduler::{CapabilityExecutor, ExecutionInputs, Scheduler, Workspace};
pub use storage::{ArtifactStore, MemoryCas};

pub fn embedded_plan() -> ChroniclePlan {
    serde_json::from_str(include_str!(concat!(
        env!("OUT_DIR"),
        "/chronicle.plan.json"
    )))
    .expect("build.rs validated embedded preprocessing-app plan")
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
