//! Semantic-federation adapter for the Chronicle raw-data preprocessing app.
//!
//! The app's registered Rust/WASM queries are the only preprocessing
//! implementation. This crate contains the product contract, deterministic
//! qualification/materialization rules, evidence records, and typed views. It
//! does not contain a second scheduler or preprocessing engine.

pub mod capabilities;
pub mod dependency_cache;
pub mod journal;
pub mod materialize;
pub mod model;
pub mod protocol;
pub mod qualify;
pub mod views;

pub use capabilities::{
    query_binding, query_group_binding, PhysicalQueryGroup, QueryBinding, QueryGroupBinding,
    CERTIFIED_OPTION_KEYS, CERTIFIED_ROLE_IDS, EMBEDDED_DEPENDENCY_BINDING_SURFACE_SHA256,
    EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256, EMBEDDED_PLAN_SHA256, EMBEDDED_PRODUCT_CONTRACT_SHA256,
    EMBEDDED_PROFILE_LOCK_SHA256, EMBEDDED_PROFILE_SHA256, EMBEDDED_RUNTIME_AUTHORITY_SHA256,
    QUERY_BINDINGS, QUERY_GROUP_BINDINGS,
};
pub use dependency_cache::evaluate_dependency_cache_decision;
pub use materialize::{evaluate_materialization, Materialization};
pub use model::*;
pub use qualify::{
    qualify_assignments, qualify_candidates, QualificationCandidate, QualificationDecision,
    QualificationReport, QualificationRuleEvaluation, QualificationTrace, RoleRequirementTrace,
};

pub fn embedded_plan() -> &'static ChroniclePlan {
    static PLAN: std::sync::OnceLock<ChroniclePlan> = std::sync::OnceLock::new();
    PLAN.get_or_init(|| {
        serde_json::from_str(include_str!(concat!(
            env!("OUT_DIR"),
            "/chronicle.plan.json"
        )))
        .expect("build.rs validated embedded preprocessing-app plan")
    })
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

pub fn embedded_dependency_certificate() -> &'static DependencyCertificate {
    static CERT: std::sync::OnceLock<DependencyCertificate> = std::sync::OnceLock::new();
    CERT.get_or_init(|| {
        serde_json::from_str(include_str!(concat!(
            env!("OUT_DIR"),
            "/dependency-certificate.json"
        )))
        .expect("build.rs validated embedded dependency certificate")
    })
}

pub fn embedded_dependency_certificate_bytes() -> &'static [u8] {
    include_bytes!(concat!(env!("OUT_DIR"), "/dependency-certificate.json"))
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
        assert_eq!(
            digest(embedded_dependency_certificate_bytes()),
            EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256
        );
        let certificate = embedded_dependency_certificate();
        assert_eq!(
            certificate.structural_contract.binding_surface_digest,
            EMBEDDED_DEPENDENCY_BINDING_SURFACE_SHA256
        );
        assert_eq!(
            certificate.structural_contract.cache_relevant_option_keys,
            CERTIFIED_OPTION_KEYS
        );
        assert_eq!(certificate.structural_contract.role_ids, CERTIFIED_ROLE_IDS);
        assert!(!embedded_plan().query_groups.is_empty());
        assert!(!embedded_plan().queries.is_empty());
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
