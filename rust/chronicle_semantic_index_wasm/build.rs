use serde_json::Value;
use std::{env, fs, path::PathBuf};

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("manifest dir"));
    println!("cargo:rerun-if-env-changed=CHRONICLE_SEMANTIC_ROOT");
    println!("cargo:rerun-if-env-changed=CHRONICLE_REPOSITORY_ROOT");
    let semantic_root = env::var_os("CHRONICLE_SEMANTIC_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            env::var_os("CHRONICLE_REPOSITORY_ROOT")
                .map(PathBuf::from)
                .unwrap_or_else(|| manifest_dir.join("../.."))
                .join(".semantic-federation/semantic")
        });
    let registry = semantic_root.join("resources/registered-queries.json");
    println!("cargo:rerun-if-changed={}", registry.display());
    let bytes = fs::read(&registry).expect("read registered query resource");
    let value: Value = serde_json::from_slice(&bytes).expect("parse registered query resource");
    let queries = value["queries"]
        .as_array()
        .expect("registered query resource queries array");
    let mut arms = String::new();
    for query in queries {
        let query_id = query["query_id"].as_str().expect("query_id string");
        let sparql = query["sparql"].as_str().expect("sparql string");
        arms.push_str(&format!("        {:?} => Some({:?}),\n", query_id, sparql));
    }
    let generated = format!(
        "pub const REGISTERED_QUERY_RESOURCE_JSON: &str = include_str!({:?});\n\
         fn registered_query(query_id: &str) -> Option<&'static str> {{\n\
             match query_id {{\n{}\
                 _ => None,\n\
             }}\n\
         }}\n",
        registry.canonicalize().expect("canonical registry path"),
        arms,
    );
    let out = PathBuf::from(env::var("OUT_DIR").expect("out dir"));
    fs::write(out.join("registered_queries.rs"), generated)
        .expect("write generated query registry");
}
