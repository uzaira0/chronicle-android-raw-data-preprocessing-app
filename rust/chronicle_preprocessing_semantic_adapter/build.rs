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
    println!("cargo:rerun-if-env-changed=CHRONICLE_DIGEST_ONLY_BOOTSTRAP");
    // The inventory generator must obtain the new implementation digest before
    // it can rewrite the bindings that normal builds validate below. This
    // narrowly scoped mode is used only by that digest-only example; it still
    // emits a compilable registry from the previous, internally complete
    // contract, but deliberately does not certify it as current. Every normal
    // runtime, test, WASM, and release build leaves the variable unset and
    // therefore remains fail-closed.
    let digest_only_bootstrap =
        env::var_os("CHRONICLE_DIGEST_ONLY_BOOTSTRAP").as_deref() == Some("1".as_ref());
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
    let query_groups = plan["query_groups"]
        .as_array()
        .expect("plan query_groups array");
    let queries = plan["queries"].as_array().expect("plan queries array");
    let product_contract_digest = bindings["product_contract_digest"]
        .as_str()
        .expect("product contract digest");
    if !digest_only_bootstrap {
        assert!(
            !query_groups.is_empty(),
            "preprocessing adapter requires query groups"
        );
        assert!(
            !queries.is_empty(),
            "preprocessing adapter requires physical queries"
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
            "query_group_projection",
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

        let node_capabilities: BTreeSet<_> = query_groups
            .iter()
            .map(|query_group| text(query_group, "capability_id"))
            .collect();
        let step_capabilities: BTreeMap<_, _> = queries
            .iter()
            .map(|query| (text(query, "capability_id"), text(query, "query_id")))
            .collect();
        let runtime_capabilities: BTreeSet<_> = runtime_surfaces
            .iter()
            .map(|surface| text(surface, "capability_id"))
            .collect();
        let required_capabilities: BTreeSet<_> = node_capabilities
            .iter()
            .copied()
            .chain(step_capabilities.keys().copied())
            .chain(runtime_capabilities.iter().copied())
            .collect();
        let active_authorities: Vec<_> = bindings["bindings"]
            .as_array()
            .expect("bindings array")
            .iter()
            .filter(|binding| {
                text(binding, "status") == "active" && binding["authority"].as_bool() == Some(true)
            })
            .collect();
        let mut authorities_by_capability: BTreeMap<&str, Vec<&Value>> = BTreeMap::new();
        for authority in &active_authorities {
            assert_eq!(
                text(&authority["implementation"], "language"),
                "rust",
                "every selected production authority must be Rust"
            );
            for capability in authority["capability_ids"]
                .as_array()
                .expect("selected capability array")
            {
                let capability = capability.as_str().expect("selected capability string");
                assert!(
                    required_capabilities.contains(capability),
                    "selected authority references unknown capability {capability}"
                );
                authorities_by_capability
                    .entry(capability)
                    .or_default()
                    .push(authority);
            }
        }
        for capability in &required_capabilities {
            assert_eq!(
            authorities_by_capability
                .get(capability)
                .map(Vec::len)
                .unwrap_or_default(),
            1,
            "embedded contract requires exactly one selected production authority for {capability}"
        );
        }

        let product_runtime = active_authorities
            .iter()
            .find(|authority| {
                text(&authority["implementation"], "entrypoint") == "execute_workspace"
            })
            .expect("selected composed product runtime");
        let product_runtime_capabilities: BTreeSet<_> = product_runtime["capability_ids"]
            .as_array()
            .expect("product runtime capability array")
            .iter()
            .map(|value| value.as_str().expect("product runtime capability string"))
            .collect();
        let expected_product_runtime_capabilities: BTreeSet<_> = node_capabilities
            .iter()
            .copied()
            .chain(runtime_capabilities.iter().copied())
            .collect();
        assert_eq!(
            product_runtime_capabilities, expected_product_runtime_capabilities,
            "selected product runtime must cover the exact query_group and runtime capability set"
        );

        for (capability, query_id) in &step_capabilities {
            let authority = authorities_by_capability[capability]
                .first()
                .expect("capability authority was checked above");
            assert_eq!(
                text(authority, "relationship"),
                "one-to-one",
                "query {query_id} must have a one-to-one production binding"
            );
            assert_eq!(
                text(&authority["implementation"], "entrypoint"),
                *query_id,
                "query {query_id} must bind to its exact Rust query"
            );
            assert_eq!(
                text(&authority["implementation"], "source"),
                "rust/chronicle_chrono_kernel_wasm/src/pipeline_v2_incremental.rs",
                "query {query_id} must bind to the tracked Rust source"
            );
        }

        validate_graph(query_groups, queries);
        validate_dependency_certificate(
            &plan,
            &dependency_certificate,
            &hex::encode(Sha256::digest(&bytes)),
        );
    }

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
            query_groups,
            queries,
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

    let expected_options: BTreeSet<_> = plan["query_groups"]
        .as_array()
        .expect("plan query_groups")
        .iter()
        .flat_map(|query_group| query_group["knobs"].as_array().expect("query_group knobs"))
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
            vec![serde_json::json!({"kind": "configuration-source", "query_group_id": "*"})],
        ),
        (
            "raw_chronicle_csv".into(),
            vec![serde_json::json!({"kind": "raw-input", "query_group_id": "parse_events"})],
        ),
    ]);
    for query_group in plan["query_groups"].as_array().expect("plan query_groups") {
        let query_group_id = text(query_group, "query_group_id");
        for knob in query_group["knobs"].as_array().expect("query_group knobs") {
            option_bindings
                .entry(text(knob, "option_key").into())
                .or_default()
                .push(serde_json::json!({
                    "edge": text(knob, "edge"),
                    "query_group_id": query_group_id,
                }));
        }
        for role in query_group["support_roles"]
            .as_array()
            .expect("support roles")
        {
            role_bindings
                .entry(role.as_str().expect("support role string").into())
                .or_default()
                .push(serde_json::json!({
                    "kind": "support-input",
                    "query_group_id": query_group_id,
                }));
        }
    }
    for bindings in option_bindings.values_mut() {
        bindings.sort_by_key(|binding| {
            (
                text(binding, "query_group_id").to_string(),
                text(binding, "edge").to_string(),
            )
        });
    }
    for bindings in role_bindings.values_mut() {
        bindings.sort_by_key(|binding| {
            (
                text(binding, "query_group_id").to_string(),
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

fn validate_graph(query_groups: &[Value], queries: &[Value]) {
    let query_group_ids: BTreeSet<_> = query_groups
        .iter()
        .map(|query_group| text(query_group, "query_group_id"))
        .collect();
    let query_ids: BTreeSet<_> = queries
        .iter()
        .map(|query| text(query, "query_id"))
        .collect();
    assert_eq!(
        query_group_ids.len(),
        query_groups.len(),
        "duplicate query_group id"
    );
    assert_eq!(query_ids.len(), queries.len(), "duplicate query id");

    let capabilities: BTreeSet<_> = query_groups
        .iter()
        .map(|query_group| text(query_group, "capability_id"))
        .chain(queries.iter().map(|query| text(query, "capability_id")))
        .collect();
    assert_eq!(
        capabilities.len(),
        query_groups.len() + queries.len(),
        "duplicate capability id"
    );

    let mut indegree: BTreeMap<&str, usize> = query_group_ids.iter().map(|id| (*id, 0)).collect();
    let mut children: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for query_group in query_groups {
        let id = text(query_group, "query_group_id");
        for input in query_group["input_query_groups"]
            .as_array()
            .expect("input_query_groups")
        {
            let input = input.as_str().expect("query_group input string");
            assert!(
                query_group_ids.contains(input),
                "unknown query_group input {input}"
            );
            *indegree.get_mut(id).expect("known query_group") += 1;
            children.entry(input).or_default().push(id);
        }
        let knob_keys = query_group["knobs"]
            .as_array()
            .expect("query_group knobs")
            .iter()
            .map(|knob| text(knob, "option_key"))
            .collect::<BTreeSet<_>>();
        let mut applicability_keys = BTreeSet::new();
        collect_condition_option_keys(&query_group["applicability"], &mut applicability_keys);
        for option_key in applicability_keys {
            assert!(
                knob_keys.contains(option_key),
                "query_group {id} applicability depends on {option_key} without an exact knob binding"
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
        query_groups.len(),
        "preprocessing-app query_group graph contains a cycle"
    );

    for query in queries {
        assert!(
            query_group_ids.contains(text(query, "query_group_id")),
            "query has unknown unit"
        );
        for input in query["input_queries"].as_array().expect("input_queries") {
            assert!(
                query_ids.contains(input.as_str().expect("query input string")),
                "query has unknown input"
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
    query_groups: &[Value],
    queries: &[Value],
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
    output.push_str("#[serde(rename_all = \"snake_case\")]\npub enum PhysicalQueryGroup {\n");
    for query_group in query_groups {
        output.push_str("    ");
        output.push_str(&variant(text(query_group, "query_group_id")));
        output.push_str(",\n");
    }
    output.push_str("}\n\n");
    output.push_str("pub const QUERY_GROUP_BINDINGS: &[QueryGroupBinding] = &[\n");
    for query_group in query_groups {
        output.push_str(&format!(
            "    QueryGroupBinding {{ query_group_id: {}, capability_id: {}, stage: PhysicalQueryGroup::{} }},\n",
            quoted(text(query_group, "query_group_id")),
            quoted(text(query_group, "capability_id")),
            variant(text(query_group, "query_group_id")),
        ));
    }
    output.push_str("];\n\npub const QUERY_BINDINGS: &[QueryBinding] = &[\n");
    for query in queries {
        output.push_str(&format!(
            "    QueryBinding {{ query_id: {}, query_group_id: {}, capability_id: {}, entrypoint: {}, tracking: \"salsa::tracked\" }},\n",
            quoted(text(query, "query_id")),
            quoted(text(query, "query_group_id")),
            quoted(text(query, "capability_id")),
            quoted(&format!(
                "chronicle_chrono_kernel_wasm::pipeline_v2::incremental::tracked::{}",
                text(query, "query_id")
            )),
        ));
    }
    output.push_str("];\n");
    output
}
