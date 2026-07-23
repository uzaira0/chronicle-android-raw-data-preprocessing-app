use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("manifest dir"));
    println!("cargo:rerun-if-env-changed=CHRONICLE_SEMANTIC_ROOT");
    println!("cargo:rerun-if-env-changed=CHRONICLE_DEPENDENCY_CERTIFICATE");
    let semantic_root = env::var_os("CHRONICLE_SEMANTIC_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| manifest_dir.join("../../.semantic-federation/semantic"));
    let plan_path = semantic_root.join("resources/chronicle.plan.json");
    let runtime_authority_path = semantic_root.join("resources/runtime-authority.json");
    let dependency_certificate_path = env::var_os("CHRONICLE_DEPENDENCY_CERTIFICATE")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            semantic_root
                .parent()
                .expect("semantic root parent")
                .join("proofs/dependency-certificate.json")
        });
    let bindings_path = semantic_root.join("capability-bindings.json");
    let profile_path = semantic_root.join("semantic-profile.json");
    let profile_lock_path = semantic_root.join("semantic-profile.lock");
    println!("cargo:rerun-if-changed={}", plan_path.display());
    println!(
        "cargo:rerun-if-changed={}",
        runtime_authority_path.display()
    );
    println!("cargo:rerun-if-changed={}", bindings_path.display());
    println!("cargo:rerun-if-changed={}", profile_path.display());
    println!("cargo:rerun-if-changed={}", profile_lock_path.display());
    println!(
        "cargo:rerun-if-changed={}",
        dependency_certificate_path.display()
    );

    let bytes = fs::read(&plan_path).expect("read Chronicle product plan");
    let runtime_authority_bytes =
        fs::read(&runtime_authority_path).expect("read runtime authority contract");
    let bindings_bytes = fs::read(&bindings_path).expect("read capability bindings");
    let profile_bytes = fs::read(&profile_path).expect("read semantic profile");
    let profile_lock_bytes = fs::read(&profile_lock_path).expect("read semantic profile lock");
    let dependency_certificate_bytes =
        fs::read(&dependency_certificate_path).expect("read dependency certificate");
    let plan: Value = serde_json::from_slice(&bytes).expect("parse Chronicle product plan");
    let runtime_authority: Value =
        serde_json::from_slice(&runtime_authority_bytes).expect("parse runtime authority contract");
    let bindings: Value =
        serde_json::from_slice(&bindings_bytes).expect("parse capability bindings");
    let dependency_certificate: Value = serde_json::from_slice(&dependency_certificate_bytes)
        .expect("parse dependency certificate");
    let nodes = plan["nodes"].as_array().expect("plan nodes array");
    let steps = plan["steps"].as_array().expect("plan steps array");
    assert_eq!(
        nodes.len(),
        15,
        "preprocessing adapter requires all 15 nodes"
    );
    assert_eq!(
        steps.len(),
        55,
        "preprocessing adapter requires all 55 steps"
    );
    let runtime_surfaces = runtime_authority["surfaces"]
        .as_array()
        .expect("runtime surfaces");
    let runtime_surface_ids: BTreeSet<_> = runtime_surfaces
        .iter()
        .map(|surface| text(surface, "surface_id"))
        .collect();
    assert_eq!(
        runtime_surface_ids.len(),
        runtime_surfaces.len(),
        "duplicate runtime authority surface"
    );
    for required in [
        "semantic_graph_scheduler",
        "execution_evidence",
        "request_validation",
        "typed_views",
        "artifact_closure",
    ] {
        assert!(
            runtime_surface_ids.contains(required),
            "missing required runtime authority surface {required}"
        );
    }
    let product_contract_digest = bindings["product_contract_digest"]
        .as_str()
        .expect("product contract digest");

    assert_eq!(
        runtime_authority["cutover_gate"]["enforced"].as_bool(),
        Some(true),
        "embedded runtime authority must enforce the Rust cutover gate"
    );
    assert!(
        runtime_surfaces.iter().all(|surface| {
            surface["requires_active_authority"].as_bool() == Some(true)
                && text(&surface["current"], "language") == "rust"
        }),
        "every embedded runtime authority surface must be required and Rust-owned"
    );

    let required_capabilities: BTreeSet<_> = nodes
        .iter()
        .map(|node| text(node, "capability_id"))
        .chain(steps.iter().map(|step| text(step, "capability_id")))
        .chain(
            runtime_surfaces
                .iter()
                .map(|surface| text(surface, "capability_id")),
        )
        .collect();
    let active_authorities: Vec<_> = bindings["bindings"]
        .as_array()
        .expect("bindings array")
        .iter()
        .filter(|binding| {
            text(binding, "status") == "active" && binding["authority"].as_bool() == Some(true)
        })
        .collect();
    assert_eq!(
        active_authorities.len(),
        1,
        "embedded contract requires one selected production authority"
    );
    let selected = active_authorities[0];
    assert_eq!(
        text(&selected["implementation"], "language"),
        "rust",
        "selected production authority must be Rust"
    );
    assert_eq!(
        text(&selected["implementation"], "entrypoint"),
        "execute_workspace",
        "selected production authority must be the composed runtime"
    );
    let selected_capabilities: BTreeSet<_> = selected["capability_ids"]
        .as_array()
        .expect("selected capability array")
        .iter()
        .map(|value| value.as_str().expect("selected capability string"))
        .collect();
    assert_eq!(
        selected_capabilities, required_capabilities,
        "selected Rust runtime must cover the exact required capability closure"
    );

    validate_graph(nodes, steps);
    validate_dependency_certificate(
        &plan,
        &dependency_certificate,
        &hex::encode(Sha256::digest(&bytes)),
    );

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("out dir"));
    fs::write(out_dir.join("chronicle.plan.json"), &bytes).expect("copy embedded plan");
    fs::write(
        out_dir.join("runtime-authority.json"),
        &runtime_authority_bytes,
    )
    .expect("copy embedded runtime authority");
    fs::write(out_dir.join("semantic-profile.json"), &profile_bytes)
        .expect("copy embedded semantic profile");
    fs::write(out_dir.join("semantic-profile.lock"), &profile_lock_bytes)
        .expect("copy embedded semantic profile lock");
    fs::write(
        out_dir.join("dependency-certificate.json"),
        &dependency_certificate_bytes,
    )
    .expect("copy embedded dependency certificate");
    let registry_digests = RegistryDigests {
        plan: hex::encode(Sha256::digest(&bytes)),
        runtime_authority: hex::encode(Sha256::digest(&runtime_authority_bytes)),
        profile: hex::encode(Sha256::digest(&profile_bytes)),
        profile_lock: hex::encode(Sha256::digest(&profile_lock_bytes)),
        dependency_certificate: hex::encode(Sha256::digest(&dependency_certificate_bytes)),
    };
    fs::write(
        out_dir.join("capability_registry.rs"),
        render_registry(
            nodes,
            steps,
            &registry_digests,
            product_contract_digest,
            &dependency_certificate,
        ),
    )
    .expect("write capability registry");
}

fn validate_dependency_certificate(plan: &Value, certificate: &Value, plan_digest: &str) {
    assert_eq!(
        certificate["protocol_version"].as_str(),
        Some("chronicle-dependency-certificate/v1"),
        "unsupported dependency certificate protocol"
    );
    let structural = &certificate["structural_contract"];
    let expected_plan_digest = format!("sha256:{plan_digest}");
    assert_eq!(
        structural["plan_digest"].as_str(),
        Some(expected_plan_digest.as_str()),
        "dependency certificate plan digest is stale"
    );

    let expected_options: BTreeSet<_> = plan["nodes"]
        .as_array()
        .expect("plan nodes")
        .iter()
        .flat_map(|node| node["knobs"].as_array().expect("node knobs"))
        .map(|knob| text(knob, "option_key"))
        .collect();
    let certified_options: BTreeSet<_> = structural["cache_relevant_option_keys"]
        .as_array()
        .expect("certified option keys")
        .iter()
        .map(|value| value.as_str().expect("certified option string"))
        .collect();
    assert_eq!(
        certified_options, expected_options,
        "dependency certificate option universe differs from plan bindings"
    );

    let expected_roles: BTreeSet<_> = plan["root_roles"]
        .as_array()
        .expect("root roles")
        .iter()
        .map(|role| text(role, "role_id"))
        .collect();
    let certified_roles: BTreeSet<_> = structural["role_ids"]
        .as_array()
        .expect("certified roles")
        .iter()
        .map(|value| value.as_str().expect("certified role string"))
        .collect();
    assert_eq!(
        certified_roles, expected_roles,
        "dependency certificate role universe differs from plan roles"
    );
    assert_eq!(
        structural["unclassified_option_keys"]
            .as_array()
            .expect("unclassified option keys")
            .len(),
        0,
        "dependency certificate contains unclassified options"
    );
    assert_eq!(
        structural["unbound_role_ids"]
            .as_array()
            .expect("unbound roles")
            .len(),
        0,
        "dependency certificate contains unbound roles"
    );

    let actual_surface = dependency_binding_surface(plan);
    let actual_surface_digest = format!(
        "sha256:{}",
        hex::encode(Sha256::digest(
            serde_json::to_vec(&actual_surface).expect("serialize dependency binding surface")
        ))
    );
    assert_eq!(
        structural["binding_surface_digest"].as_str(),
        Some(actual_surface_digest.as_str()),
        "dependency certificate binding surface is stale"
    );
    assert_eq!(
        structural["binding_surface"], actual_surface,
        "dependency certificate binding surface payload is stale"
    );
}

fn dependency_binding_surface(plan: &Value) -> Value {
    let mut option_bindings: BTreeMap<String, Vec<Value>> = BTreeMap::new();
    let mut role_bindings: BTreeMap<String, Vec<Value>> = BTreeMap::from([
        (
            "processing_options".into(),
            vec![serde_json::json!({"kind": "configuration-source", "node_id": "*"})],
        ),
        (
            "raw_chronicle_csv".into(),
            vec![serde_json::json!({"kind": "raw-input", "node_id": "parse_events"})],
        ),
    ]);
    for node in plan["nodes"].as_array().expect("plan nodes") {
        let node_id = text(node, "node_id");
        for knob in node["knobs"].as_array().expect("node knobs") {
            option_bindings
                .entry(text(knob, "option_key").into())
                .or_default()
                .push(serde_json::json!({
                    "edge": text(knob, "edge"),
                    "node_id": node_id,
                }));
        }
        for role in node["support_roles"].as_array().expect("support roles") {
            role_bindings
                .entry(role.as_str().expect("support role string").into())
                .or_default()
                .push(serde_json::json!({
                    "kind": "support-input",
                    "node_id": node_id,
                }));
        }
    }
    for bindings in option_bindings.values_mut() {
        bindings.sort_by_key(|binding| {
            (
                text(binding, "node_id").to_string(),
                text(binding, "edge").to_string(),
            )
        });
    }
    for bindings in role_bindings.values_mut() {
        bindings.sort_by_key(|binding| {
            (
                text(binding, "node_id").to_string(),
                text(binding, "kind").to_string(),
            )
        });
    }
    serde_json::json!({
        "option_bindings": option_bindings,
        "role_bindings": role_bindings,
    })
}

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key]
        .as_str()
        .unwrap_or_else(|| panic!("missing string {key}"))
}

fn validate_graph(nodes: &[Value], steps: &[Value]) {
    let node_ids: BTreeSet<_> = nodes.iter().map(|node| text(node, "node_id")).collect();
    let step_ids: BTreeSet<_> = steps.iter().map(|step| text(step, "step_id")).collect();
    assert_eq!(node_ids.len(), nodes.len(), "duplicate node id");
    assert_eq!(step_ids.len(), steps.len(), "duplicate step id");

    let capabilities: BTreeSet<_> = nodes
        .iter()
        .map(|node| text(node, "capability_id"))
        .chain(steps.iter().map(|step| text(step, "capability_id")))
        .collect();
    assert_eq!(
        capabilities.len(),
        nodes.len() + steps.len(),
        "duplicate capability id"
    );

    let mut indegree: BTreeMap<&str, usize> = node_ids.iter().map(|id| (*id, 0)).collect();
    let mut children: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for node in nodes {
        let id = text(node, "node_id");
        for input in node["input_nodes"].as_array().expect("input_nodes") {
            let input = input.as_str().expect("node input string");
            assert!(node_ids.contains(input), "unknown node input {input}");
            *indegree.get_mut(id).expect("known node") += 1;
            children.entry(input).or_default().push(id);
        }
        let knob_keys = node["knobs"]
            .as_array()
            .expect("node knobs")
            .iter()
            .map(|knob| text(knob, "option_key"))
            .collect::<BTreeSet<_>>();
        let mut applicability_keys = BTreeSet::new();
        collect_condition_option_keys(&node["applicability"], &mut applicability_keys);
        for option_key in applicability_keys {
            assert!(
                knob_keys.contains(option_key),
                "node {id} applicability depends on {option_key} without an exact knob binding"
            );
        }
    }
    let mut queue: VecDeque<_> = indegree
        .iter()
        .filter_map(|(id, degree)| (*degree == 0).then_some(*id))
        .collect();
    let mut visited = 0;
    while let Some(id) = queue.pop_front() {
        visited += 1;
        for child in children.get(id).into_iter().flatten() {
            let degree = indegree.get_mut(child).expect("known child");
            *degree -= 1;
            if *degree == 0 {
                queue.push_back(child);
            }
        }
    }
    assert_eq!(
        visited,
        nodes.len(),
        "preprocessing-app node graph contains a cycle"
    );

    for step in steps {
        assert!(
            node_ids.contains(text(step, "unit_id")),
            "step has unknown unit"
        );
        for input in step["input_steps"].as_array().expect("input_steps") {
            assert!(
                step_ids.contains(input.as_str().expect("step input string")),
                "step has unknown input"
            );
        }
    }
}

fn collect_condition_option_keys<'a>(value: &'a Value, keys: &mut BTreeSet<&'a str>) {
    match value {
        Value::Array(values) => {
            for value in values {
                collect_condition_option_keys(value, keys);
            }
        }
        Value::Object(object) => {
            if let Some(option_key) = object.get("option_key").and_then(Value::as_str) {
                keys.insert(option_key);
            }
            for value in object.values() {
                collect_condition_option_keys(value, keys);
            }
        }
        _ => {}
    }
}

fn variant(identifier: &str) -> String {
    identifier
        .split('_')
        .map(|part| {
            let mut chars = part.chars();
            chars
                .next()
                .map(|first| first.to_uppercase().collect::<String>() + chars.as_str())
                .unwrap_or_default()
        })
        .collect()
}

fn quoted(value: &str) -> String {
    format!("{value:?}")
}

struct RegistryDigests {
    plan: String,
    runtime_authority: String,
    profile: String,
    profile_lock: String,
    dependency_certificate: String,
}

fn render_registry(
    nodes: &[Value],
    steps: &[Value],
    digests: &RegistryDigests,
    product_contract_digest: &str,
    dependency_certificate: &Value,
) -> String {
    let mut output = String::new();
    output.push_str("pub const EMBEDDED_PLAN_SHA256: &str = \"sha256:");
    output.push_str(&digests.plan);
    output.push_str("\";\n\n");
    output.push_str("pub const EMBEDDED_RUNTIME_AUTHORITY_SHA256: &str = \"sha256:");
    output.push_str(&digests.runtime_authority);
    output.push_str("\";\n");
    output.push_str("pub const EMBEDDED_PROFILE_SHA256: &str = \"sha256:");
    output.push_str(&digests.profile);
    output.push_str("\";\n");
    output.push_str("pub const EMBEDDED_PROFILE_LOCK_SHA256: &str = \"sha256:");
    output.push_str(&digests.profile_lock);
    output.push_str("\";\n");
    output.push_str("pub const EMBEDDED_DEPENDENCY_CERTIFICATE_SHA256: &str = \"sha256:");
    output.push_str(&digests.dependency_certificate);
    output.push_str("\";\n");
    output.push_str("pub const EMBEDDED_DEPENDENCY_BINDING_SURFACE_SHA256: &str = ");
    output.push_str(&quoted(
        dependency_certificate["structural_contract"]["binding_surface_digest"]
            .as_str()
            .expect("dependency binding surface digest"),
    ));
    output.push_str(";\n");
    output.push_str("pub const EMBEDDED_PRODUCT_CONTRACT_SHA256: &str = ");
    output.push_str(&quoted(product_contract_digest));
    output.push_str(";\n\n");
    output.push_str("pub const CERTIFIED_OPTION_KEYS: &[&str] = &[\n");
    for option_key in dependency_certificate["structural_contract"]["cache_relevant_option_keys"]
        .as_array()
        .expect("certified option keys")
    {
        output.push_str("    ");
        output.push_str(&quoted(
            option_key.as_str().expect("certified option string"),
        ));
        output.push_str(",\n");
    }
    output.push_str("];\n\npub const CERTIFIED_ROLE_IDS: &[&str] = &[\n");
    for role_id in dependency_certificate["structural_contract"]["role_ids"]
        .as_array()
        .expect("certified role ids")
    {
        output.push_str("    ");
        output.push_str(&quoted(role_id.as_str().expect("certified role string")));
        output.push_str(",\n");
    }
    output.push_str("];\n\n");
    output.push_str("#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize)]\n");
    output.push_str("#[serde(rename_all = \"snake_case\")]\npub enum PhysicalStage {\n");
    for node in nodes {
        output.push_str("    ");
        output.push_str(&variant(text(node, "node_id")));
        output.push_str(",\n");
    }
    output.push_str("}\n\n");
    output.push_str("pub const NODE_BINDINGS: &[NodeBinding] = &[\n");
    for node in nodes {
        output.push_str(&format!(
            "    NodeBinding {{ node_id: {}, capability_id: {}, stage: PhysicalStage::{} }},\n",
            quoted(text(node, "node_id")),
            quoted(text(node, "capability_id")),
            variant(text(node, "node_id")),
        ));
    }
    output.push_str("];\n\npub const STEP_BINDINGS: &[StepBinding] = &[\n");
    for step in steps {
        output.push_str(&format!(
            "    StepBinding {{ step_id: {}, unit_id: {}, capability_id: {}, stage: PhysicalStage::{} }},\n",
            quoted(text(step, "step_id")),
            quoted(text(step, "unit_id")),
            quoted(text(step, "capability_id")),
            variant(text(step, "unit_id")),
        ));
    }
    output.push_str("];\n");
    output
}
