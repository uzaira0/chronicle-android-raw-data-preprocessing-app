use crate::model::{
    ChroniclePlan, DependencyCacheDecision, DependencyCacheMode, DependencyCertificate,
    RoleAssignment, RuntimeError,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

/// Decide whether the runtime may use the measured narrow invalidation rules.
/// This validates the exact plan/option/role binding description and the
/// current empirical evidence. It does not schedule or execute product work.
pub fn evaluate_dependency_cache_decision(
    plan: &ChroniclePlan,
    certificate: Option<&DependencyCertificate>,
    certificate_digest: Option<&str>,
    expected_plan_digest: Option<&str>,
    empirical_evidence_current: bool,
    runtime_options: &Value,
    assignments: &BTreeMap<String, RoleAssignment>,
) -> Result<DependencyCacheDecision, RuntimeError> {
    let mut reasons = Vec::new();
    let Some(certificate) = certificate else {
        return Ok(DependencyCacheDecision {
            mode: DependencyCacheMode::ConservativeFull,
            certificate_digest: None,
            binding_surface_digest: None,
            empirical_evidence_current: false,
            reasons: vec!["dependency_certificate_missing".into()],
        });
    };
    if certificate.protocol_version != "chronicle-dependency-certificate/v1" {
        reasons.push("dependency_certificate_protocol_mismatch".into());
    }
    if certificate_digest.is_none() {
        reasons.push("dependency_certificate_digest_missing".into());
    }
    if expected_plan_digest != Some(certificate.structural_contract.plan_digest.as_str()) {
        reasons.push("dependency_certificate_plan_mismatch".into());
    }
    let actual_surface_digest = dependency_binding_surface_digest(plan)?;
    if actual_surface_digest != certificate.structural_contract.binding_surface_digest {
        reasons.push("dependency_binding_surface_mismatch".into());
    }
    let plan_options = plan
        .query_groups
        .iter()
        .flat_map(|node| node.knobs.iter().map(|knob| knob.option_key.as_str()))
        .collect::<BTreeSet<_>>();
    let certified_options = certificate
        .structural_contract
        .cache_relevant_option_keys
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    if plan_options != certified_options {
        reasons.push("dependency_option_binding_universe_mismatch".into());
    }
    let runtime_options = runtime_options
        .as_object()
        .ok_or_else(|| RuntimeError::Serialization("workspace options must be an object".into()))?
        .keys()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    if runtime_options != certified_options {
        if !runtime_options.is_superset(&certified_options) {
            reasons.push("dependency_option_missing".into());
        }
        if !runtime_options.is_subset(&certified_options) {
            reasons.push("dependency_option_unknown".into());
        }
    }
    let plan_roles = plan
        .root_roles
        .iter()
        .map(|role| role.role_id.as_str())
        .collect::<BTreeSet<_>>();
    let certified_roles = certificate
        .structural_contract
        .role_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    if plan_roles != certified_roles {
        reasons.push("dependency_role_binding_universe_mismatch".into());
    }
    if assignments
        .keys()
        .any(|role| !certified_roles.contains(role.as_str()))
    {
        reasons.push("dependency_role_unknown".into());
    }
    if !certificate
        .structural_contract
        .unclassified_option_keys
        .is_empty()
    {
        reasons.push("dependency_option_unclassified".into());
    }
    if !certificate.structural_contract.unbound_role_ids.is_empty() {
        reasons.push("dependency_role_unbound".into());
    }
    if !empirical_evidence_current {
        reasons.push("empirical_dependency_evidence_stale_release_blocking".into());
    }
    let structural_failure = reasons
        .iter()
        .any(|reason| reason != "empirical_dependency_evidence_stale_release_blocking");
    if !structural_failure {
        reasons.insert(0, "dependency_surface_structurally_certified".into());
    }
    Ok(DependencyCacheDecision {
        mode: if structural_failure || !empirical_evidence_current {
            DependencyCacheMode::ConservativeFull
        } else {
            DependencyCacheMode::CertifiedNarrow
        },
        certificate_digest: certificate_digest.map(str::to_string),
        binding_surface_digest: Some(actual_surface_digest),
        empirical_evidence_current,
        reasons,
    })
}

fn dependency_binding_surface_digest(plan: &ChroniclePlan) -> Result<String, RuntimeError> {
    let mut option_bindings: BTreeMap<&str, Vec<Value>> = BTreeMap::new();
    let mut role_bindings: BTreeMap<&str, Vec<Value>> = BTreeMap::from([
        (
            "processing_options",
            vec![serde_json::json!({"kind": "configuration-source", "query_group_id": "*"})],
        ),
        (
            "raw_chronicle_csv",
            vec![serde_json::json!({"kind": "raw-input", "query_group_id": "parse_events"})],
        ),
    ]);
    for node in &plan.query_groups {
        for knob in &node.knobs {
            option_bindings
                .entry(&knob.option_key)
                .or_default()
                .push(serde_json::json!({
                    "edge": knob.edge,
                    "query_group_id": node.query_group_id,
                }));
        }
        for role in &node.support_roles {
            role_bindings
                .entry(role)
                .or_default()
                .push(serde_json::json!({
                    "kind": "support-input",
                    "query_group_id": node.query_group_id,
                }));
        }
    }
    for bindings in option_bindings.values_mut() {
        bindings.sort_by_key(|binding| {
            (
                binding["query_group_id"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                binding["edge"].as_str().unwrap_or_default().to_string(),
            )
        });
    }
    for bindings in role_bindings.values_mut() {
        bindings.sort_by_key(|binding| {
            (
                binding["query_group_id"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                binding["kind"].as_str().unwrap_or_default().to_string(),
            )
        });
    }
    let bytes = serde_jcs::to_vec(&serde_json::json!({
        "option_bindings": option_bindings,
        "role_bindings": role_bindings,
    }))
    .map_err(|error| RuntimeError::Serialization(error.to_string()))?;
    Ok(format!("sha256:{}", hex::encode(Sha256::digest(bytes))))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        embedded_dependency_certificate, embedded_plan, ArtifactRef,
        EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256, EMBEDDED_PLAN_SHA256,
    };

    fn complete_options(certificate: &DependencyCertificate) -> Value {
        Value::Object(
            certificate
                .structural_contract
                .cache_relevant_option_keys
                .iter()
                .map(|key| (key.clone(), Value::Null))
                .collect(),
        )
    }

    #[test]
    fn exact_current_contract_enables_narrow_reuse() {
        let plan = embedded_plan();
        let certificate = embedded_dependency_certificate();
        let decision = evaluate_dependency_cache_decision(
            plan,
            Some(certificate),
            Some(EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256),
            Some(EMBEDDED_PLAN_SHA256),
            true,
            &complete_options(certificate),
            &BTreeMap::new(),
        )
        .unwrap();
        assert_eq!(decision.mode, DependencyCacheMode::CertifiedNarrow);
        assert_eq!(
            decision.reasons,
            ["dependency_surface_structurally_certified"]
        );
    }

    #[test]
    fn missing_stale_or_unknown_contract_information_falls_back_to_full_recomputation() {
        let plan = embedded_plan();
        let certificate = embedded_dependency_certificate();
        let options = complete_options(certificate);
        let missing_certificate = evaluate_dependency_cache_decision(
            plan,
            None,
            None,
            Some(EMBEDDED_PLAN_SHA256),
            true,
            &options,
            &BTreeMap::new(),
        )
        .unwrap();
        assert_eq!(
            missing_certificate.mode,
            DependencyCacheMode::ConservativeFull
        );

        let stale_evidence = evaluate_dependency_cache_decision(
            plan,
            Some(certificate),
            Some(EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256),
            Some(EMBEDDED_PLAN_SHA256),
            false,
            &options,
            &BTreeMap::new(),
        )
        .unwrap();
        assert_eq!(stale_evidence.mode, DependencyCacheMode::ConservativeFull);
        assert!(!stale_evidence.empirical_evidence_current);
        assert!(stale_evidence
            .reasons
            .iter()
            .any(|reason| reason == "empirical_dependency_evidence_stale_release_blocking"));
        assert!(stale_evidence
            .reasons
            .iter()
            .any(|reason| reason == "dependency_surface_structurally_certified"));

        let mut unknown = options;
        unknown
            .as_object_mut()
            .unwrap()
            .insert("unknown-option".into(), Value::Bool(true));
        let decision = evaluate_dependency_cache_decision(
            plan,
            Some(certificate),
            Some(EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256),
            Some(EMBEDDED_PLAN_SHA256),
            true,
            &unknown,
            &BTreeMap::new(),
        )
        .unwrap();
        assert_eq!(decision.mode, DependencyCacheMode::ConservativeFull);
        assert!(decision
            .reasons
            .iter()
            .any(|reason| reason == "dependency_option_unknown"));

        let mut missing = complete_options(certificate);
        let removed = certificate
            .structural_contract
            .cache_relevant_option_keys
            .iter()
            .find(|key| key.as_str() == "process_app_usage")
            .expect("dependency certificate must classify process_app_usage")
            .clone();
        missing.as_object_mut().unwrap().remove(&removed);
        let decision = evaluate_dependency_cache_decision(
            plan,
            Some(certificate),
            Some(EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256),
            Some(EMBEDDED_PLAN_SHA256),
            true,
            &missing,
            &BTreeMap::new(),
        )
        .unwrap();
        assert_eq!(decision.mode, DependencyCacheMode::ConservativeFull);
        assert!(decision
            .reasons
            .iter()
            .any(|reason| reason == "dependency_option_missing"));
        assert!(!decision
            .reasons
            .iter()
            .any(|reason| reason == "dependency_option_unknown"));

        let assignment = |role: &str| RoleAssignment {
            assignment_id: format!("assignment:{role}"),
            role_id: role.into(),
            artifact: ArtifactRef {
                artifact_id: format!("artifact:{role}"),
                digest: format!("sha256:{}", "a".repeat(64)),
                media_type: "text/csv".into(),
                size: 1,
                derived_from: Vec::new(),
                qualifiers: BTreeMap::new(),
            },
            qualifiers: BTreeMap::new(),
            revision: 1,
        };
        let known_role = certificate
            .structural_contract
            .role_ids
            .iter()
            .find(|role| role.as_str() == "raw_chronicle_csv")
            .expect("dependency certificate must declare raw_chronicle_csv")
            .clone();
        let known_assignments = BTreeMap::from([(known_role.clone(), assignment(&known_role))]);
        let known = evaluate_dependency_cache_decision(
            plan,
            Some(certificate),
            Some(EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256),
            Some(EMBEDDED_PLAN_SHA256),
            true,
            &complete_options(certificate),
            &known_assignments,
        )
        .unwrap();
        assert_eq!(known.mode, DependencyCacheMode::CertifiedNarrow);
        assert!(!known
            .reasons
            .iter()
            .any(|reason| reason == "dependency_role_unknown"));

        let unknown_assignments =
            BTreeMap::from([("unknown-role".into(), assignment("unknown-role"))]);
        let unknown = evaluate_dependency_cache_decision(
            plan,
            Some(certificate),
            Some(EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256),
            Some(EMBEDDED_PLAN_SHA256),
            true,
            &complete_options(certificate),
            &unknown_assignments,
        )
        .unwrap();
        assert_eq!(unknown.mode, DependencyCacheMode::ConservativeFull);
        assert!(unknown
            .reasons
            .iter()
            .any(|reason| reason == "dependency_role_unknown"));
    }
}
