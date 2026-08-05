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

fn is_cfg_test(attributes: &[syn::Attribute]) -> bool {
    attributes.iter().any(|attribute| {
        attribute.path().is_ident("cfg")
            && matches!(&attribute.meta, syn::Meta::List(list)
                if list.tokens.to_string().split_whitespace().collect::<String>() == "test")
    })
}

/// Attributes may be written in any order, and a doc comment *is* an
/// attribute. Reading only the first one meant a documented `#[cfg(test)]`
/// module was hashed into the implementation digest as production source —
/// the kernel's `output_contract` and `golden` modules both are — so every
/// edit to a test moved the digest that the runtime binds its receipts and
/// resume decisions to.
fn is_test_only_item(item: &syn::Item) -> bool {
    let attributes: &[syn::Attribute] = match item {
        syn::Item::Const(item) => &item.attrs,
        syn::Item::Enum(item) => &item.attrs,
        syn::Item::ExternCrate(item) => &item.attrs,
        syn::Item::Fn(item) => &item.attrs,
        syn::Item::ForeignMod(item) => &item.attrs,
        syn::Item::Impl(item) => &item.attrs,
        syn::Item::Macro(item) => &item.attrs,
        syn::Item::Mod(item) => &item.attrs,
        syn::Item::Static(item) => &item.attrs,
        syn::Item::Struct(item) => &item.attrs,
        syn::Item::Trait(item) => &item.attrs,
        syn::Item::TraitAlias(item) => &item.attrs,
        syn::Item::Type(item) => &item.attrs,
        syn::Item::Union(item) => &item.attrs,
        syn::Item::Use(item) => &item.attrs,
        _ => &[],
    };
    is_cfg_test(attributes)
}

fn is_test_only_statement(statement: &syn::Stmt) -> bool {
    match statement {
        syn::Stmt::Local(local) => is_cfg_test(&local.attrs),
        syn::Stmt::Item(item) => is_test_only_item(item),
        syn::Stmt::Macro(macro_statement) => is_cfg_test(&macro_statement.attrs),
        syn::Stmt::Expr(expression, _) => is_cfg_test(expression_attributes(expression)),
    }
}

fn expression_attributes(expression: &syn::Expr) -> &[syn::Attribute] {
    match expression {
        syn::Expr::Array(expression) => &expression.attrs,
        syn::Expr::Assign(expression) => &expression.attrs,
        syn::Expr::Async(expression) => &expression.attrs,
        syn::Expr::Await(expression) => &expression.attrs,
        syn::Expr::Binary(expression) => &expression.attrs,
        syn::Expr::Block(expression) => &expression.attrs,
        syn::Expr::Break(expression) => &expression.attrs,
        syn::Expr::Call(expression) => &expression.attrs,
        syn::Expr::Cast(expression) => &expression.attrs,
        syn::Expr::Closure(expression) => &expression.attrs,
        syn::Expr::Const(expression) => &expression.attrs,
        syn::Expr::Continue(expression) => &expression.attrs,
        syn::Expr::Field(expression) => &expression.attrs,
        syn::Expr::ForLoop(expression) => &expression.attrs,
        syn::Expr::Group(expression) => &expression.attrs,
        syn::Expr::If(expression) => &expression.attrs,
        syn::Expr::Index(expression) => &expression.attrs,
        syn::Expr::Infer(expression) => &expression.attrs,
        syn::Expr::Let(expression) => &expression.attrs,
        syn::Expr::Lit(expression) => &expression.attrs,
        syn::Expr::Loop(expression) => &expression.attrs,
        syn::Expr::Macro(expression) => &expression.attrs,
        syn::Expr::Match(expression) => &expression.attrs,
        syn::Expr::MethodCall(expression) => &expression.attrs,
        syn::Expr::Paren(expression) => &expression.attrs,
        syn::Expr::Path(expression) => &expression.attrs,
        syn::Expr::Range(expression) => &expression.attrs,
        syn::Expr::Reference(expression) => &expression.attrs,
        syn::Expr::Repeat(expression) => &expression.attrs,
        syn::Expr::Return(expression) => &expression.attrs,
        syn::Expr::Struct(expression) => &expression.attrs,
        syn::Expr::Try(expression) => &expression.attrs,
        syn::Expr::TryBlock(expression) => &expression.attrs,
        syn::Expr::Tuple(expression) => &expression.attrs,
        syn::Expr::Unary(expression) => &expression.attrs,
        syn::Expr::Unsafe(expression) => &expression.attrs,
        syn::Expr::While(expression) => &expression.attrs,
        syn::Expr::Yield(expression) => &expression.attrs,
        _ => &[],
    }
}

struct StripTestOnly;

impl VisitMut for StripTestOnly {
    fn visit_file_mut(&mut self, file: &mut syn::File) {
        visit_mut::visit_file_mut(self, file);
        file.items.retain(|item| !is_test_only_item(item));
    }

    fn visit_item_mod_mut(&mut self, module: &mut syn::ItemMod) {
        visit_mut::visit_item_mod_mut(self, module);
        if let Some((_, items)) = module.content.as_mut() {
            items.retain(|item| !is_test_only_item(item));
        }
    }

    fn visit_block_mut(&mut self, block: &mut syn::Block) {
        visit_mut::visit_block_mut(self, block);
        block
            .stmts
            .retain(|statement| !is_test_only_statement(statement));
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

    // Watch the directories as well as the files discovered below. Watching
    // only today's files misses a newly added or removed Rust module and can
    // leave the compiled implementation receipt bound to stale source.
    for relative in [
        "rust/chronicle_preprocessing_runtime_wasm/src",
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
    // The workflow contract contains semantic/execution identity plus
    // presentation copy. Those layers have their own digests and are watched
    // above, but must not contaminate the implementation-source digest: a
    // label-only edit cannot invalidate every physical cache entry.
    let workflow_contract_file =
        Path::new("rust/chronicle_chrono_kernel_wasm/src/workflow_contract.rs");
    let workflow_contract_modules =
        Path::new("rust/chronicle_chrono_kernel_wasm/src/workflow_contract");
    files.retain(|relative| {
        relative != workflow_contract_file && !relative.starts_with(workflow_contract_modules)
    });

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
