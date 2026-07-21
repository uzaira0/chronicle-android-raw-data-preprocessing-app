use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("manifest dir"));
    let plan_path =
        manifest_dir.join("../../.semantic-federation/semantic/resources/chronicle.plan.json");
    println!("cargo:rerun-if-changed={}", plan_path.display());

    let bytes = fs::read(&plan_path).expect("read Chronicle product plan");
    let plan: Value = serde_json::from_slice(&bytes).expect("parse Chronicle product plan");
    let nodes = plan["nodes"].as_array().expect("plan nodes array");
    let steps = plan["steps"].as_array().expect("plan steps array");
    assert_eq!(nodes.len(), 15, "Chronicle registry requires all 15 nodes");
    assert_eq!(steps.len(), 55, "Chronicle registry requires all 55 steps");

    validate_graph(nodes, steps);

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("out dir"));
    fs::write(out_dir.join("chronicle.plan.json"), &bytes).expect("copy embedded plan");
    fs::write(
        out_dir.join("capability_registry.rs"),
        render_registry(nodes, steps, &hex::encode(Sha256::digest(&bytes))),
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
        "Chronicle node graph contains a cycle"
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

fn render_registry(nodes: &[Value], steps: &[Value], plan_digest: &str) -> String {
    let mut output = String::new();
    output.push_str("pub const EMBEDDED_PLAN_SHA256: &str = \"sha256:");
    output.push_str(plan_digest);
    output.push_str("\";\n\n");
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
