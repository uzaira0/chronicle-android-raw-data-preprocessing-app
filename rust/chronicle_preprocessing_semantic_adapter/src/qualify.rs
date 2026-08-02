use crate::model::{ArtifactRef, ChroniclePlan, MaterializationState, RoleAssignment, Sha256Digest};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QualificationCandidate {
    pub candidate_id: String,
    pub artifact: ArtifactRef,
    /// Chronicle deliberately requires an exact role assertion from the typed
    /// ingress channel. File names and payload contents never guess a role.
    pub asserted_role_ids: Vec<String>,
    #[serde(default)]
    pub qualifiers: BTreeMap<String, String>,
    pub revision: u64,
}

impl From<&RoleAssignment> for QualificationCandidate {
    fn from(assignment: &RoleAssignment) -> Self {
        Self {
            candidate_id: assignment.assignment_id.clone(),
            artifact: assignment.artifact.clone(),
            asserted_role_ids: vec![assignment.role_id.clone()],
            qualifiers: assignment.qualifiers.clone(),
            revision: assignment.revision,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QualificationDecision {
    Accepted,
    Rejected,
    Ambiguous,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QualificationRuleEvaluation {
    pub rule_id: String,
    pub passed: bool,
    pub expected: String,
    pub observed: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QualificationTrace {
    pub trace_id: String,
    pub candidate_id: String,
    pub candidate_revision: u64,
    pub artifact_digest: Sha256Digest,
    pub qualifiers_digest: Sha256Digest,
    pub asserted_role_ids: Vec<String>,
    pub selected_role_id: Option<String>,
    pub decision: QualificationDecision,
    pub rule_evaluations: Vec<QualificationRuleEvaluation>,
    pub reason_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoleRequirementTrace {
    pub trace_id: String,
    pub role_id: String,
    pub required: bool,
    pub unconditional: bool,
    pub condition_id: Option<String>,
    pub condition_result: Option<bool>,
    pub candidate_trace_ids: Vec<String>,
    pub accepted_assignment_ids: Vec<String>,
    pub state: MaterializationState,
    pub reason_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QualificationReport {
    pub protocol_version: String,
    pub traces: Vec<QualificationTrace>,
    pub requirement_traces: Vec<RoleRequirementTrace>,
    pub accepted_assignment_ids: Vec<String>,
}

fn stable_id(parts: &[&str]) -> String {
    let joined = parts.join("\u{1f}");
    format!("sha256:{}", hex::encode(Sha256::digest(joined.as_bytes())))
}

fn is_sha256(value: &str) -> bool {
    value
        .strip_prefix("sha256:")
        .is_some_and(|hex| hex.len() == 64 && hex.bytes().all(|byte| byte.is_ascii_hexdigit()))
}

fn rule(
    rule_id: &str,
    passed: bool,
    expected: String,
    observed: String,
) -> QualificationRuleEvaluation {
    QualificationRuleEvaluation {
        rule_id: rule_id.into(),
        passed,
        expected,
        observed,
    }
}

/// Deterministically qualifies product-local ingress candidates.
///
/// This is intentionally smaller than a discovery or ontology reasoner. A
/// Chronicle candidate must arrive through exactly one typed role channel.
/// Competing candidates for a singleton role are ambiguous; there is no
/// hidden precedence, first-file-wins rule, or filename heuristic.
pub fn qualify_candidates(
    plan: &ChroniclePlan,
    candidates: &[QualificationCandidate],
    options: &Value,
) -> QualificationReport {
    let roles: BTreeMap<_, _> = plan
        .root_roles
        .iter()
        .map(|role| (role.role_id.as_str(), role))
        .collect();
    let mut candidate_id_counts = BTreeMap::<&str, usize>::new();
    for candidate in candidates {
        *candidate_id_counts
            .entry(candidate.candidate_id.as_str())
            .or_default() += 1;
    }

    // Count only candidates that pass all non-cardinality checks. This makes
    // the ambiguity decision independent of input order.
    let mut base_valid_counts = BTreeMap::<String, usize>::new();
    for candidate in candidates {
        let asserted = candidate
            .asserted_role_ids
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>();
        if candidate_id_counts[candidate.candidate_id.as_str()] != 1 || asserted.len() != 1 {
            continue;
        }
        let role_id = asserted.iter().next().expect("one asserted role");
        let Some(role) = roles.get(role_id.as_str()) else {
            continue;
        };
        if !role.media_types.contains(&candidate.artifact.media_type)
            || !is_sha256(&candidate.artifact.digest)
            || candidate
                .qualifiers
                .get("content_validation")
                .is_some_and(|value| value != "passed")
        {
            continue;
        }
        *base_valid_counts.entry(role_id.clone()).or_default() += 1;
    }

    let mut ordered_candidates = candidates.to_vec();
    ordered_candidates.sort_by(|left, right| {
        (
            left.candidate_id.as_str(),
            left.artifact.digest.as_str(),
            &left.asserted_role_ids,
        )
            .cmp(&(
                right.candidate_id.as_str(),
                right.artifact.digest.as_str(),
                &right.asserted_role_ids,
            ))
    });

    let mut traces = Vec::with_capacity(ordered_candidates.len());
    for candidate in ordered_candidates {
        let asserted = candidate
            .asserted_role_ids
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let unique_id = candidate_id_counts[candidate.candidate_id.as_str()] == 1;
        let exactly_one_role = asserted.len() == 1;
        let selected = exactly_one_role.then(|| asserted[0].clone());
        let known_role = selected
            .as_deref()
            .is_some_and(|role_id| roles.contains_key(role_id));
        let accepted_media_types = selected
            .as_deref()
            .and_then(|role_id| roles.get(role_id))
            .map(|role| role.media_types.clone())
            .unwrap_or_default();
        let media_valid =
            known_role && accepted_media_types.contains(&candidate.artifact.media_type);
        let digest_valid = is_sha256(&candidate.artifact.digest);
        let content_validation = candidate
            .qualifiers
            .get("content_validation")
            .map(String::as_str)
            .unwrap_or("not-required");
        let content_valid = matches!(content_validation, "passed" | "not-required");
        let observed_count = selected
            .as_ref()
            .and_then(|role_id| base_valid_counts.get(role_id))
            .copied()
            .unwrap_or(0);
        let maximum = selected
            .as_deref()
            .and_then(|role_id| roles.get(role_id))
            .map(|role| role.cardinality.maximum)
            .unwrap_or(0);
        let cardinality_valid = known_role && observed_count <= maximum;
        // A candidate without exactly one role cannot have a known selected
        // role, so `known_role` is the one decision predicate. Keeping both
        // here would be redundant and would obscure which rule rejects it.
        let decision =
            if !unique_id || !known_role || !media_valid || !digest_valid || !content_valid {
                if asserted.len() > 1 {
                    QualificationDecision::Ambiguous
                } else {
                    QualificationDecision::Rejected
                }
            } else if !cardinality_valid {
                QualificationDecision::Ambiguous
            } else {
                QualificationDecision::Accepted
            };
        let selected_role_id = matches!(decision, QualificationDecision::Accepted)
            .then(|| selected.clone())
            .flatten();
        let rule_evaluations = vec![
            rule(
                "chronicle.binding.candidate-id-unique.v1",
                unique_id,
                "exactly one candidate with this identity".into(),
                candidate_id_counts[candidate.candidate_id.as_str()].to_string(),
            ),
            rule(
                "chronicle.binding.exact-role-assertion.v1",
                exactly_one_role,
                "exactly one explicitly asserted role; no inference".into(),
                asserted.join(","),
            ),
            rule(
                "chronicle.binding.role-registered.v1",
                known_role,
                "a role identifier registered by the embedded plan".into(),
                selected.clone().unwrap_or_else(|| "none".into()),
            ),
            rule(
                "chronicle.binding.media-type.v1",
                media_valid,
                accepted_media_types.join(","),
                candidate.artifact.media_type.clone(),
            ),
            rule(
                "chronicle.binding.sha256.v1",
                digest_valid,
                "sha256:<64 hexadecimal characters>".into(),
                candidate.artifact.digest.clone(),
            ),
            rule(
                "chronicle.binding.content-validation.v1",
                content_valid,
                "passed or not-required".into(),
                content_validation.into(),
            ),
            rule(
                "chronicle.binding.cardinality.v1",
                cardinality_valid,
                format!("at most {maximum} base-valid candidate(s)"),
                observed_count.to_string(),
            ),
        ];
        let decision_name = match decision {
            QualificationDecision::Accepted => "accepted",
            QualificationDecision::Rejected => "rejected",
            QualificationDecision::Ambiguous => "ambiguous",
        };
        let reason_id = stable_id(&[
            "qualification-decision",
            &candidate.candidate_id,
            &candidate.artifact.digest,
            decision_name,
        ]);
        let qualifiers_digest = format!(
            "sha256:{}",
            hex::encode(Sha256::digest(
                serde_jcs::to_vec(&candidate.qualifiers)
                    .expect("candidate qualifiers are canonically serializable")
            ))
        );
        let mut rule_evaluations = rule_evaluations;
        rule_evaluations.push(rule(
            "chronicle.binding.qualifiers-informational.v1",
            true,
            "qualifiers are recorded but do not override the explicit role channel".into(),
            qualifiers_digest.clone(),
        ));
        let trace_id = stable_id(&[
            "qualification-trace",
            &candidate.candidate_id,
            &candidate.revision.to_string(),
            &candidate.artifact.digest,
            &qualifiers_digest,
            &asserted.join(","),
            decision_name,
        ]);
        traces.push(QualificationTrace {
            trace_id,
            candidate_id: candidate.candidate_id,
            candidate_revision: candidate.revision,
            artifact_digest: candidate.artifact.digest,
            qualifiers_digest,
            asserted_role_ids: asserted,
            selected_role_id,
            decision,
            rule_evaluations,
            reason_id,
        });
    }

    let accepted_assignment_ids = traces
        .iter()
        .filter(|trace| trace.decision == QualificationDecision::Accepted)
        .map(|trace| trace.candidate_id.clone())
        .collect::<Vec<_>>();

    let mut requirement_traces = plan
        .root_roles
        .iter()
        .map(|role| {
            let condition_result = role
                .required_when
                .as_ref()
                .map(|condition| condition.evaluate(options));
            let required = role.required || condition_result == Some(true);
            let condition_id = role.required_when.as_ref().map(|condition| {
                let canonical = serde_jcs::to_vec(condition)
                    .expect("a validated plan condition is canonically serializable");
                stable_id(&[
                    "role-required-when",
                    &role.role_id,
                    &hex::encode(Sha256::digest(canonical)),
                ])
            });
            let candidate_traces = traces
                .iter()
                .filter(|trace| trace.asserted_role_ids.contains(&role.role_id))
                .collect::<Vec<_>>();
            let accepted = candidate_traces
                .iter()
                .filter(|trace| trace.decision == QualificationDecision::Accepted)
                .map(|trace| trace.candidate_id.clone())
                .collect::<Vec<_>>();
            let invalid = candidate_traces
                .iter()
                .any(|trace| trace.decision != QualificationDecision::Accepted);
            let state = if invalid {
                MaterializationState::Invalid
            } else if !accepted.is_empty() && accepted.len() >= role.cardinality.minimum {
                MaterializationState::Satisfied
            } else if required {
                MaterializationState::Open
            } else {
                MaterializationState::NotApplicable
            };
            let state_name = format!("{state:?}").to_ascii_lowercase();
            let trace_id = stable_id(&[
                "role-requirement-trace",
                &role.role_id,
                &required.to_string(),
                condition_result
                    .map(|result| if result { "true" } else { "false" })
                    .unwrap_or("none"),
                &accepted.join(","),
                &state_name,
            ]);
            let reason_id = stable_id(&["role-requirement", &role.role_id, &state_name]);
            RoleRequirementTrace {
                trace_id,
                role_id: role.role_id.clone(),
                required,
                unconditional: role.required,
                condition_id,
                condition_result,
                candidate_trace_ids: candidate_traces
                    .iter()
                    .map(|trace| trace.trace_id.clone())
                    .collect(),
                accepted_assignment_ids: accepted,
                state,
                reason_id,
            }
        })
        .collect::<Vec<_>>();
    requirement_traces.sort_by(|left, right| left.role_id.cmp(&right.role_id));

    QualificationReport {
        protocol_version: "chronicle-qualification-report/v1".into(),
        traces,
        requirement_traces,
        accepted_assignment_ids,
    }
}

pub fn qualify_assignments(
    plan: &ChroniclePlan,
    assignments: &BTreeMap<String, RoleAssignment>,
    options: &Value,
) -> QualificationReport {
    let candidates = assignments
        .values()
        .map(QualificationCandidate::from)
        .collect::<Vec<_>>();
    qualify_candidates(plan, &candidates, options)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::embedded_plan;

    fn artifact(id: &str, media_type: &str) -> ArtifactRef {
        ArtifactRef {
            artifact_id: format!("artifact:{id}"),
            digest: format!("sha256:{}", hex::encode(Sha256::digest(id.as_bytes()))),
            media_type: media_type.into(),
            size: 1,
            derived_from: vec![],
            qualifiers: BTreeMap::new(),
        }
    }

    fn candidate(id: &str, roles: &[&str], media_type: &str) -> QualificationCandidate {
        QualificationCandidate {
            candidate_id: id.into(),
            artifact: artifact(id, media_type),
            asserted_role_ids: roles.iter().map(|role| (*role).into()).collect(),
            qualifiers: BTreeMap::new(),
            revision: 1,
        }
    }

    #[test]
    fn exact_typed_channel_is_accepted_without_filename_inference() {
        let report = qualify_candidates(
            &embedded_plan(),
            &[candidate("raw", &["raw_chronicle_csv"], "text/csv")],
            &serde_json::json!({}),
        );
        assert_eq!(report.traces[0].decision, QualificationDecision::Accepted);
        assert_eq!(
            report.traces[0].selected_role_id.as_deref(),
            Some("raw_chronicle_csv")
        );
        assert!(report.traces[0]
            .rule_evaluations
            .iter()
            .all(|rule| rule.passed));
    }

    #[test]
    fn failed_product_content_validation_rejects_an_otherwise_valid_candidate() {
        let mut invalid = candidate("filter", &["filter_file"], "text/csv");
        invalid
            .qualifiers
            .insert("content_validation".into(), "failed".into());
        invalid.qualifiers.insert(
            "content_validation_error".into(),
            "missing app_package_name".into(),
        );
        let report = qualify_candidates(
            &embedded_plan(),
            &[invalid],
            &serde_json::json!({"use_filter_file": true}),
        );
        assert_eq!(report.traces[0].decision, QualificationDecision::Rejected);
        assert!(report.accepted_assignment_ids.is_empty());
        assert_eq!(
            report
                .requirement_traces
                .iter()
                .find(|trace| trace.role_id == "filter_file")
                .unwrap()
                .state,
            MaterializationState::Invalid
        );
        assert!(report.traces[0].rule_evaluations.iter().any(|rule| {
            rule.rule_id == "chronicle.binding.content-validation.v1" && !rule.passed
        }));

        let mut failed_competitor = candidate("failed", &["filter_file"], "text/csv");
        failed_competitor
            .qualifiers
            .insert("content_validation".into(), "failed".into());
        let report = qualify_candidates(
            &embedded_plan(),
            &[
                candidate("valid", &["filter_file"], "text/csv"),
                failed_competitor,
            ],
            &serde_json::json!({"use_filter_file": true}),
        );
        assert_eq!(
            report
                .traces
                .iter()
                .find(|trace| trace.candidate_id == "valid")
                .expect("valid candidate trace")
                .decision,
            QualificationDecision::Accepted,
            "a content-invalid candidate must not create false singleton ambiguity"
        );
    }

    #[test]
    fn multiply_asserted_candidate_fails_closed_as_ambiguous() {
        let report = qualify_candidates(
            &embedded_plan(),
            &[candidate(
                "support",
                &["filter_file", "background_apps_file"],
                "text/csv",
            )],
            &serde_json::json!({}),
        );
        assert_eq!(report.traces[0].decision, QualificationDecision::Ambiguous);
        assert_eq!(report.traces[0].selected_role_id, None);
        assert!(report
            .requirement_traces
            .iter()
            .filter(
                |trace| ["filter_file", "background_apps_file"].contains(&trace.role_id.as_str())
            )
            .all(|trace| trace.state == MaterializationState::Invalid));
    }

    #[test]
    fn singleton_competition_is_ambiguous_and_order_independent() {
        let left = candidate("left", &["filter_file"], "text/csv");
        let right = candidate("right", &["filter_file"], "text/csv");
        let forward = qualify_candidates(
            &embedded_plan(),
            &[left.clone(), right.clone()],
            &serde_json::json!({"use_filter_file": true}),
        );
        let reverse = qualify_candidates(
            &embedded_plan(),
            &[right, left],
            &serde_json::json!({"use_filter_file": true}),
        );
        assert_eq!(forward, reverse);
        assert!(forward
            .traces
            .iter()
            .all(|trace| trace.decision == QualificationDecision::Ambiguous));
        assert!(forward.accepted_assignment_ids.is_empty());
    }

    #[test]
    fn configuration_changes_the_requirement_not_the_candidate_identity() {
        let candidate = candidate("filter", &["filter_file"], "text/csv");
        let disabled = qualify_candidates(
            &embedded_plan(),
            &[],
            &serde_json::json!({"use_filter_file": false}),
        );
        let enabled = qualify_candidates(
            &embedded_plan(),
            &[],
            &serde_json::json!({"use_filter_file": true}),
        );
        let supplied = qualify_candidates(
            &embedded_plan(),
            &[candidate],
            &serde_json::json!({"use_filter_file": true}),
        );
        let state = |report: &QualificationReport| {
            report
                .requirement_traces
                .iter()
                .find(|trace| trace.role_id == "filter_file")
                .expect("filter trace")
                .state
        };
        assert_eq!(state(&disabled), MaterializationState::NotApplicable);
        assert_eq!(state(&enabled), MaterializationState::Open);
        assert_eq!(state(&supplied), MaterializationState::Satisfied);
    }

    #[test]
    fn every_conditional_support_role_has_a_closed_three_state_requirement_proof() {
        let plan = embedded_plan();
        for role in plan
            .root_roles
            .iter()
            .filter(|role| role.required_when.is_some())
        {
            let crate::model::Condition::OptionTrue { option_key } =
                role.required_when.as_ref().expect("condition")
            else {
                panic!(
                    "conditional role {} is not controlled by one exact option",
                    role.role_id
                );
            };
            let mut disabled_options = serde_json::json!({});
            disabled_options[option_key] = Value::Bool(false);
            let mut enabled_options = serde_json::json!({});
            enabled_options[option_key] = Value::Bool(true);
            let disabled = qualify_candidates(&plan, &[], &disabled_options);
            let enabled = qualify_candidates(&plan, &[], &enabled_options);
            let supplied = qualify_candidates(
                &plan,
                &[candidate(
                    &role.role_id,
                    &[&role.role_id],
                    &role.media_types[0],
                )],
                &enabled_options,
            );
            let state = |report: &QualificationReport| {
                report
                    .requirement_traces
                    .iter()
                    .find(|trace| trace.role_id == role.role_id)
                    .expect("role requirement trace")
                    .state
            };
            assert_eq!(
                state(&disabled),
                MaterializationState::NotApplicable,
                "{} disabled",
                role.role_id
            );
            assert_eq!(
                state(&enabled),
                MaterializationState::Open,
                "{} enabled without candidate",
                role.role_id
            );
            assert_eq!(
                state(&supplied),
                MaterializationState::Satisfied,
                "{} enabled with candidate",
                role.role_id
            );
            let disabled_trace = disabled
                .requirement_traces
                .iter()
                .find(|trace| trace.role_id == role.role_id)
                .expect("disabled role trace");
            let enabled_trace = enabled
                .requirement_traces
                .iter()
                .find(|trace| trace.role_id == role.role_id)
                .expect("enabled role trace");
            assert_eq!(disabled_trace.condition_result, Some(false));
            assert_eq!(enabled_trace.condition_result, Some(true));
            assert_eq!(disabled_trace.condition_id, enabled_trace.condition_id);
        }
    }

    #[test]
    fn invalid_media_and_digest_are_rejected_with_exact_rule_failures() {
        let mut invalid = candidate("raw", &["raw_chronicle_csv"], "application/json");
        invalid.artifact.digest = "sha256:not-a-digest".into();
        let report = qualify_candidates(&embedded_plan(), &[invalid], &serde_json::json!({}));
        assert_eq!(report.traces[0].decision, QualificationDecision::Rejected);
        let failed = report.traces[0]
            .rule_evaluations
            .iter()
            .filter(|rule| !rule.passed)
            .map(|rule| rule.rule_id.as_str())
            .collect::<BTreeSet<_>>();
        assert!(failed.contains("chronicle.binding.media-type.v1"));
        assert!(failed.contains("chronicle.binding.sha256.v1"));
    }

    #[test]
    fn digest_shape_and_each_independent_candidate_rule_fail_closed() {
        assert!(is_sha256(&format!("sha256:{}", "a".repeat(64))));
        assert!(!is_sha256(&format!("sha256:{}", "a".repeat(63))));
        assert!(!is_sha256(&format!("sha256:{}g", "a".repeat(63))));
        assert_ne!(stable_id(&["a", "b"]), stable_id(&["ab"]));
        assert_eq!(stable_id(&["a", "b"]), stable_id(&["a", "b"]));

        let plan = embedded_plan();
        let mut wrong_media = candidate("wrong-media", &["filter_file"], "application/json");
        let mut wrong_digest = candidate("wrong-digest", &["filter_file"], "text/csv");
        wrong_digest.artifact.digest = format!("sha256:{}g", "a".repeat(63));

        for invalid in [&wrong_media, &wrong_digest] {
            let report = qualify_candidates(
                &plan,
                &[
                    candidate("valid", &["filter_file"], "text/csv"),
                    invalid.clone(),
                ],
                &serde_json::json!({"use_filter_file": true}),
            );
            let trace = report
                .traces
                .iter()
                .find(|trace| trace.candidate_id == invalid.candidate_id)
                .expect("invalid candidate trace");
            assert_eq!(trace.decision, QualificationDecision::Rejected);
            assert_eq!(
                report
                    .traces
                    .iter()
                    .find(|trace| trace.candidate_id == "valid")
                    .expect("valid candidate trace")
                    .decision,
                QualificationDecision::Accepted
            );
        }

        // Keep this mutable so the two malformed cases above cannot
        // accidentally share the same artifact identity in future fixtures.
        wrong_media.artifact.digest = artifact("wrong-media-2", "application/json").digest;
        assert_eq!(
            qualify_candidates(&plan, &[wrong_media], &serde_json::json!({})).traces[0].decision,
            QualificationDecision::Rejected
        );
    }

    #[test]
    fn invalid_digest_sibling_does_not_poison_a_valid_singleton_binding() {
        let valid = candidate("valid", &["filter_file"], "text/csv");
        let mut invalid = candidate("invalid", &["filter_file"], "text/csv");
        invalid.artifact.digest = format!("sha256:{}", "g".repeat(64));

        let report = qualify_candidates(
            &embedded_plan(),
            &[invalid, valid],
            &serde_json::json!({"use_filter_file": true}),
        );
        let valid_trace = report
            .traces
            .iter()
            .find(|trace| trace.candidate_id == "valid")
            .expect("valid trace");
        let invalid_trace = report
            .traces
            .iter()
            .find(|trace| trace.candidate_id == "invalid")
            .expect("invalid trace");

        assert_eq!(valid_trace.decision, QualificationDecision::Accepted);
        assert_eq!(invalid_trace.decision, QualificationDecision::Rejected);
        assert_eq!(report.accepted_assignment_ids, vec!["valid"]);
    }

    #[test]
    fn qualification_explanation_ids_are_sha256_content_identities() {
        let report = qualify_candidates(
            &embedded_plan(),
            &[candidate("raw", &["raw_chronicle_csv"], "text/csv")],
            &serde_json::json!({}),
        );
        let trace = &report.traces[0];
        let requirement = report
            .requirement_traces
            .iter()
            .find(|requirement| requirement.role_id == "raw_chronicle_csv")
            .expect("raw role requirement");

        for identity in [
            trace.trace_id.as_str(),
            trace.reason_id.as_str(),
            requirement.trace_id.as_str(),
            requirement.reason_id.as_str(),
        ] {
            assert!(
                is_sha256(identity),
                "invalid explanation identity: {identity}"
            );
        }
        assert_ne!(trace.trace_id, trace.reason_id);
    }

    #[test]
    fn every_fail_closed_identity_and_role_rule_has_a_killing_witness() {
        let plan = embedded_plan();
        let duplicate_left = candidate("duplicate", &["filter_file"], "text/csv");
        let mut duplicate_right = candidate("duplicate", &["filter_file"], "text/csv");
        duplicate_right.artifact = artifact("other", "text/csv");
        let cases = [
            (
                "chronicle.binding.candidate-id-unique.v1",
                vec![duplicate_left, duplicate_right],
            ),
            (
                "chronicle.binding.exact-role-assertion.v1",
                vec![candidate("unclaimed", &[], "text/csv")],
            ),
            (
                "chronicle.binding.role-registered.v1",
                vec![candidate("unknown", &["not_a_role"], "text/csv")],
            ),
        ];
        for (rule_id, candidates) in cases {
            let report = qualify_candidates(&plan, &candidates, &serde_json::json!({}));
            assert!(
                report.traces.iter().any(|trace| {
                    trace.decision != QualificationDecision::Accepted
                        && trace
                            .rule_evaluations
                            .iter()
                            .any(|rule| rule.rule_id == rule_id && !rule.passed)
                }),
                "qualification mutant removing {rule_id} has no rejection witness"
            );
        }
    }
}
