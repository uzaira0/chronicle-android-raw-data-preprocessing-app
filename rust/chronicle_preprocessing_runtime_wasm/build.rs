use quote::ToTokens;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use syn::visit_mut::{self, VisitMut};

include!("src/footprint_digest_core.rs");

fn pack_json_assets(repository_root: &Path) {
    let output = PathBuf::from(std::env::var_os("OUT_DIR").expect("build output directory"));
    let mut declarations = String::new();
    for (name, relative) in [
        ("ANDROID_REGISTRY", "web/src/generated/android-method-profile-runtime-registry.json"),
        ("SLEEP_DIARY_BRIDGE", "web/schema/sleep-diary-catalog.bridge.json"),
        ("ADAPTER_CONTRACT", "web/schema/literature-input-adapter-contract.json"),
        ("ADAPTER_CONFORMANCE", "rust/chronicle_preprocessing_runtime_wasm/tests/fixtures/literature_input_adapter_conformance.json"),
    ] {
        let source = repository_root.join(relative);
        println!("cargo:rerun-if-changed={}", source.display());
        let bytes = fs::read(&source).expect("read existing JSON deploy input");
        let mut compressor = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::best());
        compressor.write_all(&bytes).expect("pack exact JSON bytes");
        let packed = compressor.finish().expect("finish packed JSON bytes");
        let file = format!("{name}.json.gz");
        fs::write(output.join(&file), packed).expect("write packed JSON deploy input");
        declarations.push_str(&format!(
            "pub(crate) static {name}: PackedJson = PackedJson {{ name: \"{name}\", gzip: include_bytes!(concat!(env!(\"OUT_DIR\"), \"/{file}\")), expected_bytes: {}, raw_sha256: \"{}\", text: OnceLock::new() }};\n",
            bytes.len(), hex::encode(Sha256::digest(&bytes)),
        ));
    }
    fs::write(output.join("packed_json_assets.rs"), declarations)
        .expect("write packed JSON byte identities");
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
    pack_json_assets(&repository_root);

    // Watch the directories as well as the files discovered below. Watching
    // only today's files misses a newly added or removed Rust module and can
    // leave the compiled implementation receipt bound to stale source.
    for relative in [
        "rust/chronicle_preprocessing_runtime_wasm/src",
        "rust/chronicle_preprocessing_runtime_wasm/vendor/arrow-ipc-59.1.0/src",
        "rust/chronicle_preprocessing_semantic_adapter/src",
        "rust/chronicle_chrono_kernel_wasm/src",
        "rust/chronicle_app_usage_matcher/src",
        "rust/chronicle_semantic_index_wasm/src",
    ] {
        println!(
            "cargo:rerun-if-changed={}",
            repository_root.join(relative).display()
        );
    }

    // The workflow-contract exclusion rationale lives with the shared list in
    // src/footprint_digest_core.rs.
    let files = implementation_source_files(&repository_root);

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
    digest_field(&mut environment_hasher, b"chronicle-build-environment/v2");
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
        let value = std::env::var(key).unwrap_or_default();
        let value = match key {
            "CARGO_ENCODED_RUSTFLAGS" => without_remap_sources(value.split('\x1f'), "\x1f"),
            "RUSTFLAGS" => without_remap_sources(value.split_whitespace(), " "),
            _ => value,
        };
        digest_field(&mut environment_hasher, key.as_bytes());
        digest_field(&mut environment_hasher, value.as_bytes());
    }
    let mut enabled_features = std::env::vars()
        .filter(|(key, value)| key.starts_with("CARGO_FEATURE_") && value == "1")
        .collect::<Vec<_>>();
    enabled_features.sort();
    for (key, value) in enabled_features {
        digest_field(&mut environment_hasher, key.as_bytes());
        digest_field(&mut environment_hasher, value.as_bytes());
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

/// Keep only the destination of each `--remap-path-prefix FROM=TO`. FROM is
/// the absolute checkout, cargo-home or sysroot path, which the remap exists to
/// keep out of the binary; hashing it made the embedded digest (and so the
/// WASM bytes) depend on where the repository was checked out.
fn without_remap_sources<'a>(flags: impl Iterator<Item = &'a str>, separator: &str) -> String {
    let mut normalized = Vec::new();
    let mut destinations = Vec::new();
    let mut remap_value_next = false;
    for flag in flags {
        if remap_value_next {
            remap_value_next = false;
            destinations.push(remap_destination(flag).to_owned());
        } else if flag == "--remap-path-prefix" {
            remap_value_next = true;
        } else if let Some(mapping) = flag.strip_prefix("--remap-path-prefix=") {
            destinations.push(remap_destination(mapping).to_owned());
        } else {
            normalized.push(flag.to_owned());
        }
    }
    // The remaps are ordered by source-path length, which differs per checkout.
    destinations.sort();
    normalized.extend(destinations.into_iter().map(|to| format!("--remap-path-prefix={to}")));
    normalized.join(separator)
}

/// rustc splits a remap at its last `=`.
fn remap_destination(mapping: &str) -> &str {
    mapping.rsplit_once('=').map_or(mapping, |(_, to)| to)
}
