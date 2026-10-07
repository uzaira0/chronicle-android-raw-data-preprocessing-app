//! Prints the per-file production-source digest map as JSON on stdout:
//! `{ "<repo-relative path>": "sha256:<hex>", ... }`, computed over the exact
//! test-stripped normalized bytes the implementation digest folds (the shared
//! core in src/footprint_digest_core.rs is the single definition). The
//! dependency-evidence refresh compares this map against each campaign's
//! recorded footprint to decide dirty/clean, so any drift between this bin and
//! build.rs would be a parallel authority — which is why both include the same
//! file.
//!
//! Usage: cargo run --example footprint_digests -- <repository-root>

use quote::ToTokens;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use syn::visit_mut::{self, VisitMut};

include!("../src/footprint_digest_core.rs");

fn main() {
    let repository_root = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."));
    let map = per_file_production_digests(&repository_root)
        .into_iter()
        .map(|(path, digest)| (path, serde_json::Value::String(digest)))
        .collect::<serde_json::Map<String, serde_json::Value>>();
    println!(
        "{}",
        serde_json::to_string_pretty(&serde_json::Value::Object(map))
            .expect("serialize digest map")
    );
}
