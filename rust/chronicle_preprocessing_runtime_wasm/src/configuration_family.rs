//! Product-local configuration-family compilation.
//!
//! This module does not define a universal workflow ontology. It gives the
//! Chronicle preprocessing runtime a narrow way to preserve a finite option
//! family, partition it under explicit observational perspectives, and state
//! where the current evidence is exact versus only bounded.

use chronicle_preprocessing_semantic_adapter::ChroniclePlan;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

pub const CONFIGURATION_FAMILY_PROTOCOL_VERSION: &str = "chronicle-configuration-family/v1";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigurationVariantObservation {
    pub variant_id: String,
    pub assignments: BTreeMap<String, String>,
    pub declared_method_id: String,
    pub effective_target: String,
    pub retained_source_rows_digest: String,
    pub normalized_events_digest: String,
    pub published_outputs_digest: String,
    pub provenance_digest: String,
    pub rows_before: u32,
    pub rows_after: u32,
    pub rows_removed: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfigurationAxis {
    pub axis_id: String,
    pub option_keys: Vec<String>,
    pub cardinality: usize,
    pub variants: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VariantEvidence {
    pub variant_id: String,
    pub assignments: BTreeMap<String, String>,
    pub declared_method_id: String,
    pub effective_target: String,
    pub retained_source_rows_digest: String,
    pub normalized_events_digest: String,
    pub published_outputs_digest: String,
    pub provenance_digest: String,
    pub rows_before: u32,
    pub rows_after: u32,
    pub rows_removed: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EquivalenceClass {
    pub class_id: String,
    pub signature: String,
    pub variants: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PerspectivePartition {
    pub perspective_id: String,
    pub semantics: String,
    pub width: usize,
    pub classes: Vec<EquivalenceClass>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InfluenceEnvelope {
    pub changed_option_keys: Vec<String>,
    pub seed_nodes: Vec<String>,
    pub conservative_cone: Vec<String>,
    pub derivation: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NodeWidthEnvelope {
    pub node_id: String,
    pub minimum_width: usize,
    pub maximum_width: usize,
    pub status: String,
    pub evidence: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompletenessEvidence {
    pub expected_variant_count: usize,
    pub observed_variant_count: usize,
    pub missing_variants: Vec<String>,
    pub unexpected_variants: Vec<String>,
    pub duplicate_variants: Vec<String>,
    pub exhaustive: bool,
    pub full_rust_execution_count: usize,
    pub oracle: String,
    pub proof_scope: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfigurationFamilyReport {
    pub protocol_version: String,
    pub family_id: String,
    pub fixture_id: String,
    pub input_digest: String,
    pub axis: ConfigurationAxis,
    pub variants: Vec<VariantEvidence>,
    pub partitions: Vec<PerspectivePartition>,
    pub influence: InfluenceEnvelope,
    pub node_width_envelopes: Vec<NodeWidthEnvelope>,
    pub completeness: CompletenessEvidence,
}

fn stable_id(parts: &[&str]) -> String {
    format!(
        "sha256:{}",
        hex::encode(Sha256::digest(parts.join("\u{1f}").as_bytes()))
    )
}

fn partition<F>(
    observations: &[ConfigurationVariantObservation],
    perspective_id: &str,
    semantics: &str,
    signature: F,
) -> PerspectivePartition
where
    F: Fn(&ConfigurationVariantObservation) -> &str,
{
    let mut groups = BTreeMap::<String, BTreeSet<String>>::new();
    for observation in observations {
        groups
            .entry(signature(observation).to_string())
            .or_default()
            .insert(observation.variant_id.clone());
    }
    let classes = groups
        .into_iter()
        .map(|(signature, variants)| EquivalenceClass {
            class_id: stable_id(&["equivalence-class", perspective_id, &signature]),
            signature,
            variants: variants.into_iter().collect(),
        })
        .collect::<Vec<_>>();
    PerspectivePartition {
        perspective_id: perspective_id.into(),
        semantics: semantics.into(),
        width: classes.len(),
        classes,
    }
}

fn influence_envelope(plan: &ChroniclePlan, option_keys: &[&str]) -> InfluenceEnvelope {
    let option_keys = option_keys.iter().copied().collect::<BTreeSet<_>>();
    let seeds = plan
        .nodes
        .iter()
        .filter(|node| {
            node.knobs
                .iter()
                .any(|knob| option_keys.contains(knob.option_key.as_str()))
        })
        .map(|node| node.node_id.clone())
        .collect::<BTreeSet<_>>();
    let mut dependents = BTreeMap::<&str, Vec<&str>>::new();
    for node in &plan.nodes {
        for input in &node.input_nodes {
            dependents
                .entry(input.as_str())
                .or_default()
                .push(node.node_id.as_str());
        }
    }
    let mut cone = seeds.clone();
    let mut queue = seeds.iter().cloned().collect::<VecDeque<_>>();
    while let Some(node_id) = queue.pop_front() {
        for dependent in dependents.get(node_id.as_str()).into_iter().flatten() {
            if cone.insert((*dependent).to_string()) {
                queue.push_back((*dependent).to_string());
            }
        }
    }
    InfluenceEnvelope {
        changed_option_keys: option_keys.into_iter().map(str::to_string).collect(),
        seed_nodes: seeds.into_iter().collect(),
        conservative_cone: cone.into_iter().collect(),
        derivation: "product plan knob bindings plus transitive DAG reachability".into(),
    }
}

pub fn compile_configuration_family(
    plan: &ChroniclePlan,
    fixture_id: &str,
    input_digest: &str,
    expected_variants: &[&str],
    observations: Vec<ConfigurationVariantObservation>,
) -> Result<ConfigurationFamilyReport, String> {
    if expected_variants.is_empty() {
        return Err("configuration family requires at least one declared variant".into());
    }
    let expected = expected_variants
        .iter()
        .map(|value| (*value).to_string())
        .collect::<BTreeSet<_>>();
    if expected.len() != expected_variants.len() {
        return Err("configuration family declares duplicate variants".into());
    }

    let mut counts = BTreeMap::<String, usize>::new();
    for observation in &observations {
        *counts.entry(observation.variant_id.clone()).or_default() += 1;
    }
    let observed = counts.keys().cloned().collect::<BTreeSet<_>>();
    let missing_variants = expected.difference(&observed).cloned().collect::<Vec<_>>();
    let unexpected_variants = observed.difference(&expected).cloned().collect::<Vec<_>>();
    let duplicate_variants = counts
        .iter()
        .filter(|(_, count)| **count > 1)
        .map(|(variant, _)| variant.clone())
        .collect::<Vec<_>>();
    if !missing_variants.is_empty()
        || !unexpected_variants.is_empty()
        || !duplicate_variants.is_empty()
    {
        return Err(format!(
            "configuration family is not exhaustive: missing={missing_variants:?} unexpected={unexpected_variants:?} duplicate={duplicate_variants:?}"
        ));
    }

    let mut observations = observations;
    observations.sort_by(|left, right| left.variant_id.cmp(&right.variant_id));
    let partitions = vec![
        partition(
            &observations,
            "declared-method",
            "researcher-visible policy identity; never collapsed by equal outputs",
            |observation| &observation.declared_method_id,
        ),
        partition(
            &observations,
            "effective-target",
            "timezone selected after resolving selected-versus-primary qualification",
            |observation| &observation.effective_target,
        ),
        partition(
            &observations,
            "retained-source-rows",
            "exact raw-row membership retained by the timezone policy",
            |observation| &observation.retained_source_rows_digest,
        ),
        partition(
            &observations,
            "normalized-events",
            "exact Chronicle event state immediately after timezone normalization",
            |observation| &observation.normalized_events_digest,
        ),
        partition(
            &observations,
            "published-outputs",
            "byte identity of every scientific CSV/JSON output from a cold full Rust run",
            |observation| &observation.published_outputs_digest,
        ),
        partition(
            &observations,
            "provenance-identity",
            "outputs plus row lineage and resolved timezone policy evidence",
            |observation| &observation.provenance_digest,
        ),
    ];
    let normalized_width = partitions
        .iter()
        .find(|partition| partition.perspective_id == "normalized-events")
        .expect("normalized-events partition is constructed")
        .width;
    let published_width = partitions
        .iter()
        .find(|partition| partition.perspective_id == "published-outputs")
        .expect("published-outputs partition is constructed")
        .width;
    let influence = influence_envelope(plan, &["timezone_handling"]);
    if influence.seed_nodes != ["normalize_timezones"] {
        return Err(format!(
            "timezone option authority drifted from normalize_timezones: {:?}",
            influence.seed_nodes
        ));
    }
    let cone = influence
        .conservative_cone
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let node_width_envelopes = plan
        .nodes
        .iter()
        .map(|node| {
            if node.node_id == "normalize_timezones" {
                NodeWidthEnvelope {
                    node_id: node.node_id.clone(),
                    minimum_width: normalized_width,
                    maximum_width: normalized_width,
                    status: "exact-observed".into(),
                    evidence: "normalized-events partition from four cold Rust executions".into(),
                }
            } else if node.node_id == "outputs" {
                NodeWidthEnvelope {
                    node_id: node.node_id.clone(),
                    minimum_width: published_width,
                    maximum_width: published_width,
                    status: "exact-observed".into(),
                    evidence: "published-outputs partition from four cold Rust executions".into(),
                }
            } else if !cone.contains(node.node_id.as_str()) {
                NodeWidthEnvelope {
                    node_id: node.node_id.clone(),
                    minimum_width: 1,
                    maximum_width: 1,
                    status: "exact-unaffected".into(),
                    evidence: "node is outside the plan-derived timezone influence cone".into(),
                }
            } else if normalized_width == 1 {
                NodeWidthEnvelope {
                    node_id: node.node_id.clone(),
                    minimum_width: 1,
                    maximum_width: 1,
                    status: "exact-inferred".into(),
                    evidence:
                        "identical normalized input and no downstream timezone-option binding"
                            .into(),
                }
            } else {
                NodeWidthEnvelope {
                    node_id: node.node_id.clone(),
                    minimum_width: 1,
                    maximum_width: normalized_width,
                    status: "bounded-unresolved".into(),
                    evidence: "no product-local checkpoint exists yet at this logical node".into(),
                }
            }
        })
        .collect();
    let variants = observations
        .into_iter()
        .map(|observation| VariantEvidence {
            variant_id: observation.variant_id,
            assignments: observation.assignments,
            declared_method_id: observation.declared_method_id,
            effective_target: observation.effective_target,
            retained_source_rows_digest: observation.retained_source_rows_digest,
            normalized_events_digest: observation.normalized_events_digest,
            published_outputs_digest: observation.published_outputs_digest,
            provenance_digest: observation.provenance_digest,
            rows_before: observation.rows_before,
            rows_after: observation.rows_after,
            rows_removed: observation.rows_removed,
        })
        .collect::<Vec<_>>();

    Ok(ConfigurationFamilyReport {
        protocol_version: CONFIGURATION_FAMILY_PROTOCOL_VERSION.into(),
        family_id: "chronicle-preprocessing/timezone-handling/v1".into(),
        fixture_id: fixture_id.into(),
        input_digest: input_digest.into(),
        axis: ConfigurationAxis {
            axis_id: "timezone-handling".into(),
            option_keys: vec!["timezone_handling".into()],
            cardinality: expected.len(),
            variants: expected_variants
                .iter()
                .map(|variant| (*variant).to_string())
                .collect(),
        },
        variants,
        partitions,
        influence,
        node_width_envelopes,
        completeness: CompletenessEvidence {
            expected_variant_count: expected_variants.len(),
            observed_variant_count: counts.len(),
            missing_variants,
            unexpected_variants,
            duplicate_variants,
            exhaustive: true,
            full_rust_execution_count: expected_variants.len(),
            oracle: "chronicle_chrono_kernel_wasm::run_pipeline_v2_with_supports".into(),
            proof_scope: "finite timezone policy axis for one fixed fixture, selected timezone, support set, and all other options"
                .into(),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chronicle_preprocessing_semantic_adapter::embedded_plan;

    fn observation(
        variant_id: &str,
        normalized: &str,
        output: &str,
    ) -> ConfigurationVariantObservation {
        ConfigurationVariantObservation {
            variant_id: variant_id.into(),
            assignments: BTreeMap::from([("timezone_handling".into(), variant_id.into())]),
            declared_method_id: format!("method:{variant_id}"),
            effective_target: "America/Chicago".into(),
            retained_source_rows_digest: "rows:same".into(),
            normalized_events_digest: normalized.into(),
            published_outputs_digest: output.into(),
            provenance_digest: format!("provenance:{variant_id}"),
            rows_before: 10,
            rows_after: 10,
            rows_removed: 0,
        }
    }

    #[test]
    fn complete_simple_family_collapses_outputs_without_collapsing_methods() {
        let variants = ["a", "b", "c", "d"];
        let report = compile_configuration_family(
            &embedded_plan(),
            "simple",
            "sha256:input",
            &variants,
            variants
                .iter()
                .map(|variant| observation(variant, "normalized:same", "output:same"))
                .collect(),
        )
        .unwrap();
        let width = |perspective: &str| {
            report
                .partitions
                .iter()
                .find(|partition| partition.perspective_id == perspective)
                .unwrap()
                .width
        };
        assert_eq!(width("declared-method"), 4);
        assert_eq!(width("normalized-events"), 1);
        assert_eq!(width("published-outputs"), 1);
        let class_ids = report
            .partitions
            .iter()
            .flat_map(|partition| partition.classes.iter())
            .map(|class| class.class_id.as_str())
            .collect::<BTreeSet<_>>();
        assert!(class_ids.iter().all(|id| {
            id.strip_prefix("sha256:").is_some_and(|digest| {
                digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit())
            })
        }));
        assert_eq!(
            class_ids.len(),
            report
                .partitions
                .iter()
                .map(|partition| partition.classes.len())
                .sum::<usize>(),
            "class IDs must bind both perspective and signature"
        );
        assert!(report
            .node_width_envelopes
            .iter()
            .all(|envelope| envelope.minimum_width == envelope.maximum_width));
        assert_eq!(
            report
                .node_width_envelopes
                .iter()
                .find(|envelope| envelope.node_id == "dedup_and_order")
                .unwrap()
                .status,
            "exact-inferred"
        );
    }

    #[test]
    fn each_completeness_defect_fails_closed_independently() {
        let missing = compile_configuration_family(
            &embedded_plan(),
            "missing",
            "sha256:input",
            &["a", "b"],
            vec![observation("a", "n1", "o1")],
        )
        .unwrap_err();
        assert!(missing.contains("missing=[\"b\"]"));

        let unexpected = compile_configuration_family(
            &embedded_plan(),
            "unexpected",
            "sha256:input",
            &["a", "b"],
            vec![
                observation("a", "n1", "o1"),
                observation("b", "n2", "o2"),
                observation("c", "n3", "o3"),
            ],
        )
        .unwrap_err();
        assert!(unexpected.contains("unexpected=[\"c\"]"));

        let duplicate = compile_configuration_family(
            &embedded_plan(),
            "duplicate",
            "sha256:input",
            &["a", "b"],
            vec![
                observation("a", "n1", "o1"),
                observation("a", "n1", "o1"),
                observation("b", "n2", "o2"),
            ],
        )
        .unwrap_err();
        assert!(duplicate.contains("duplicate=[\"a\"]"));
    }

    #[test]
    fn asymmetric_checkpoint_widths_keep_exact_and_bounded_nodes_distinct() {
        let variants = ["a", "b", "c", "d"];
        let report = compile_configuration_family(
            &embedded_plan(),
            "asymmetric",
            "sha256:input",
            &variants,
            vec![
                observation("a", "normalized:one", "output:same"),
                observation("b", "normalized:two", "output:same"),
                observation("c", "normalized:one", "output:same"),
                observation("d", "normalized:two", "output:same"),
            ],
        )
        .unwrap();
        let envelopes = report
            .node_width_envelopes
            .iter()
            .map(|envelope| (envelope.node_id.as_str(), envelope))
            .collect::<BTreeMap<_, _>>();
        assert_eq!(
            (
                envelopes["normalize_timezones"].minimum_width,
                envelopes["normalize_timezones"].maximum_width,
                envelopes["normalize_timezones"].status.as_str()
            ),
            (2, 2, "exact-observed")
        );
        assert_eq!(
            (
                envelopes["outputs"].minimum_width,
                envelopes["outputs"].maximum_width,
                envelopes["outputs"].status.as_str()
            ),
            (1, 1, "exact-observed")
        );
        assert_eq!(
            (
                envelopes["parse_events"].minimum_width,
                envelopes["parse_events"].maximum_width,
                envelopes["parse_events"].status.as_str()
            ),
            (1, 1, "exact-unaffected")
        );
        assert_eq!(
            (
                envelopes["dedup_and_order"].minimum_width,
                envelopes["dedup_and_order"].maximum_width,
                envelopes["dedup_and_order"].status.as_str()
            ),
            (1, 2, "bounded-unresolved")
        );
    }
}
