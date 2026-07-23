use quote::ToTokens;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use syn::visit_mut::{self, VisitMut};

fn collect_files(root: &Path, relative: &Path, files: &mut Vec<PathBuf>) {
    let path = root.join(relative);
    if path.is_file() {
        files.push(relative.to_path_buf());
        return;
    }
    let mut entries = fs::read_dir(&path)
        .unwrap_or_else(|error| panic!("read implementation source {}: {error}", path.display()))
        .map(|entry| entry.expect("implementation source directory entry").path())
        .collect::<Vec<_>>();
    entries.sort();
    for entry in entries {
        let child = entry
            .strip_prefix(root)
            .expect("implementation source remains below repository root");
        if entry.is_dir() {
            collect_files(root, child, files);
        } else if entry.is_file() {
            files.push(child.to_path_buf());
        }
    }
}

fn digest_field(hasher: &mut Sha256, bytes: &[u8]) {
    hasher.update((bytes.len() as u64).to_le_bytes());
    hasher.update(bytes);
}

fn is_test_only(tokens: &impl ToTokens) -> bool {
    tokens
        .to_token_stream()
        .to_string()
        .split_whitespace()
        .collect::<String>()
        .starts_with("#[cfg(test)]")
}

struct StripTestOnly;

impl VisitMut for StripTestOnly {
    fn visit_file_mut(&mut self, file: &mut syn::File) {
        visit_mut::visit_file_mut(self, file);
        file.items.retain(|item| !is_test_only(item));
    }

    fn visit_block_mut(&mut self, block: &mut syn::Block) {
        visit_mut::visit_block_mut(self, block);
        block.stmts.retain(|statement| !is_test_only(statement));
    }
}

fn production_source(path: &Path) -> Vec<u8> {
    let bytes = fs::read(path)
        .unwrap_or_else(|error| panic!("read implementation source {}: {error}", path.display()));
    if path.extension().and_then(|extension| extension.to_str()) != Some("rs") {
        return bytes;
    }

    let mut file =
        syn::parse_file(std::str::from_utf8(&bytes).unwrap_or_else(|error| {
            panic!("UTF-8 implementation source {}: {error}", path.display())
        }))
        .unwrap_or_else(|error| panic!("parse implementation source {}: {error}", path.display()));
    StripTestOnly.visit_file_mut(&mut file);
    file.into_token_stream().to_string().into_bytes()
}

fn main() {
    println!("cargo:rerun-if-env-changed=CHRONICLE_REPOSITORY_ROOT");
    let repository_root = std::env::var_os("CHRONICLE_REPOSITORY_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").expect("manifest directory"))
                .join("../..")
        });
    println!(
        "cargo:rustc-env=CHRONICLE_REPOSITORY_ROOT={}",
        repository_root.display()
    );

    let mut files = Vec::new();
    for relative in [
        "rust/chronicle_preprocessing_runtime_wasm/Cargo.toml",
        "rust/chronicle_preprocessing_runtime_wasm/Cargo.lock",
        "rust/chronicle_preprocessing_runtime_wasm/build.rs",
        "rust/chronicle_preprocessing_runtime_wasm/.cargo",
        "rust/chronicle_preprocessing_runtime_wasm/src",
        "rust/chronicle_preprocessing_semantic_adapter/Cargo.toml",
        "rust/chronicle_preprocessing_semantic_adapter/Cargo.lock",
        "rust/chronicle_preprocessing_semantic_adapter/build.rs",
        "rust/chronicle_preprocessing_semantic_adapter/src",
        "rust/chronicle_chrono_kernel_wasm/Cargo.toml",
        "rust/chronicle_chrono_kernel_wasm/Cargo.lock",
        "rust/chronicle_chrono_kernel_wasm/src",
        "rust/chronicle_app_usage_matcher/Cargo.toml",
        "rust/chronicle_app_usage_matcher/Cargo.lock",
        "rust/chronicle_app_usage_matcher/src",
        "rust/chronicle_semantic_index_wasm/Cargo.toml",
        "rust/chronicle_semantic_index_wasm/Cargo.lock",
        "rust/chronicle_semantic_index_wasm/build.rs",
        "rust/chronicle_semantic_index_wasm/src",
        "web/scripts/build_wasm.mjs",
    ] {
        let relative = Path::new(relative);
        if repository_root.join(relative).exists() {
            collect_files(&repository_root, relative, &mut files);
        }
    }
    files.sort();
    files.dedup();

    let mut implementation_hasher = Sha256::new();
    digest_field(
        &mut implementation_hasher,
        b"chronicle-implementation-source/v2",
    );
    for relative in files {
        let path = repository_root.join(&relative);
        println!("cargo:rerun-if-changed={}", path.display());
        digest_field(
            &mut implementation_hasher,
            relative.to_string_lossy().as_bytes(),
        );
        digest_field(&mut implementation_hasher, &production_source(&path));
    }
    let implementation_digest = format!("sha256:{}", hex::encode(implementation_hasher.finalize()));
    println!("cargo:rustc-env=CHRONICLE_IMPLEMENTATION_BUILD_DIGEST={implementation_digest}");

    let mut environment_hasher = Sha256::new();
    digest_field(&mut environment_hasher, b"chronicle-build-environment/v1");
    digest_field(&mut environment_hasher, implementation_digest.as_bytes());
    for key in [
        "TARGET",
        "PROFILE",
        "OPT_LEVEL",
        "CARGO_CFG_TARGET_ARCH",
        "CARGO_CFG_TARGET_FEATURE",
        "CARGO_ENCODED_RUSTFLAGS",
        "RUSTFLAGS",
    ] {
        println!("cargo:rerun-if-env-changed={key}");
        digest_field(&mut environment_hasher, key.as_bytes());
        digest_field(
            &mut environment_hasher,
            std::env::var(key).unwrap_or_default().as_bytes(),
        );
    }
    let rustc = std::env::var_os("RUSTC").unwrap_or_else(|| "rustc".into());
    let rustc_version = Command::new(rustc)
        .arg("-vV")
        .output()
        .expect("run rustc -vV for implementation identity");
    assert!(rustc_version.status.success(), "rustc -vV failed");
    digest_field(&mut environment_hasher, &rustc_version.stdout);
    let environment_digest = format!("sha256:{}", hex::encode(environment_hasher.finalize()));
    println!("cargo:rustc-env=CHRONICLE_BUILD_ENVIRONMENT_DIGEST={environment_digest}");
}
