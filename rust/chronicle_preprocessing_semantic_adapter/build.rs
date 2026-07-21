use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("manifest dir"));
    println!("cargo:rerun-if-env-changed=CHRONICLE_SEMANTIC_ROOT");
    let semantic_root = env::var_os("CHRONICLE_SEMANTIC_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| manifest_dir.join("../../.semantic-federation/semantic"));
    let plan_path = semantic_root.join("resources/chronicle.plan.json");
    let runtime_authority_path = semantic_root.join("resources/runtime-authority.json");
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

    let bytes = fs::read(&plan_path).expect("read Chronicle product plan");
    let runtime_authority_bytes =
        fs::read(&runtime_authority_path).expect("read runtime authority contract");
    let bindings_bytes = fs::read(&bindings_path).expect("read capability bindings");
    let profile_bytes = fs::read(&profile_path).expect("read semantic profile");
    let profile_lock_bytes = fs::read(&profile_lock_path).expect("read semantic profile lock");
    let plan: Value = serde_json::from_slice(&bytes).expect("parse Chronicle product plan");
    let runtime_authority: Value =
        serde_json::from_slice(&runtime_authority_bytes).expect("parse runtime authority contract");
    let bindings: Value =
        serde_json::from_slice(&bindings_bytes).expect("parse capability bindings");
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
        out_dir.join("capability_registry.rs"),
        render_registry(
            nodes,
            steps,
            &hex::encode(Sha256::digest(&bytes)),
            &hex::encode(Sha256::digest(&runtime_authority_bytes)),
            &hex::encode(Sha256::digest(&profile_bytes)),
            &hex::encode(Sha256::digest(&profile_lock_bytes)),
            product_contract_digest,
        ),
    )
    .expect("write capability registry");
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

fn render_registry(
    nodes: &[Value],
    steps: &[Value],
    plan_digest: &str,
    runtime_authority_digest: &str,
    profile_digest: &str,
    profile_lock_digest: &str,
    product_contract_digest: &str,
) -> String {
    let mut output = String::new();
    output.push_str("pub const EMBEDDED_PLAN_SHA256: &str = \"sha256:");
    output.push_str(plan_digest);
    output.push_str("\";\n\n");
    output.push_str("pub const EMBEDDED_RUNTIME_AUTHORITY_SHA256: &str = \"sha256:");
    output.push_str(runtime_authority_digest);
    output.push_str("\";\n");
    output.push_str("pub const EMBEDDED_PROFILE_SHA256: &str = \"sha256:");
    output.push_str(profile_digest);
    output.push_str("\";\n");
    output.push_str("pub const EMBEDDED_PROFILE_LOCK_SHA256: &str = \"sha256:");
    output.push_str(profile_lock_digest);
    output.push_str("\";\n");
    output.push_str("pub const EMBEDDED_PRODUCT_CONTRACT_SHA256: &str = ");
    output.push_str(&quoted(product_contract_digest));
    output.push_str(";\n\n");
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
