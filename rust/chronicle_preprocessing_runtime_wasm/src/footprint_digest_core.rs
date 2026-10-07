// Shared implementation-source digest machinery. This file is spliced with
// `include!` into BOTH build.rs (the aggregate implementation digest baked
// into the WASM) and src/bin/footprint_digests.rs (the per-file digest map
// the dependency-evidence footprint selection compares against), so the
// test-stripping normalization has exactly one definition. It is NOT a module
// of the library crate.

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

// Used by build.rs (the aggregate fold); dead in the per-file example context.
#[allow(dead_code)]
fn digest_field(hasher: &mut Sha256, bytes: &[u8]) {
    hasher.update((bytes.len() as u64).to_le_bytes());
    hasher.update(bytes);
}

/// A predicate implies `test` when it is the bare `test` token or an
/// `all(...)` list with `test` as a top-level member -- `all(test, feature =
/// "x")` never compiles outside tests. `any(test, ...)` is deliberately NOT
/// treated as test-only: it can be live production code under the other
/// predicate. A naive comma split is safe for the membership check because a
/// fragment of a nested list can never equal the bare token `test`.
fn cfg_tokens_imply_test(tokens: &str) -> bool {
    if tokens == "test" {
        return true;
    }
    tokens
        .strip_prefix("all(")
        .and_then(|rest| rest.strip_suffix(')'))
        .is_some_and(|inner| inner.split(',').any(cfg_tokens_imply_test))
}

fn is_cfg_test(attributes: &[syn::Attribute]) -> bool {
    attributes.iter().any(|attribute| {
        attribute.path().is_ident("cfg")
            && matches!(&attribute.meta, syn::Meta::List(list)
            if cfg_tokens_imply_test(
                &list.tokens.to_string().split_whitespace().collect::<String>()
            ))
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

/// `#[cfg(test)]` methods and associated items inside `impl`/`trait` blocks
/// are items too -- the file/module retains never see them, so without these
/// the six test-only impl methods in the hashed crates were digested as
/// production and a test-only edit staled the dependency certificate.
fn is_test_only_impl_item(item: &syn::ImplItem) -> bool {
    let attributes: &[syn::Attribute] = match item {
        syn::ImplItem::Const(item) => &item.attrs,
        syn::ImplItem::Fn(item) => &item.attrs,
        syn::ImplItem::Type(item) => &item.attrs,
        syn::ImplItem::Macro(item) => &item.attrs,
        _ => &[],
    };
    is_cfg_test(attributes)
}

fn is_test_only_trait_item(item: &syn::TraitItem) -> bool {
    let attributes: &[syn::Attribute] = match item {
        syn::TraitItem::Const(item) => &item.attrs,
        syn::TraitItem::Fn(item) => &item.attrs,
        syn::TraitItem::Type(item) => &item.attrs,
        syn::TraitItem::Macro(item) => &item.attrs,
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

    fn visit_item_impl_mut(&mut self, item: &mut syn::ItemImpl) {
        visit_mut::visit_item_impl_mut(self, item);
        item.items.retain(|member| !is_test_only_impl_item(member));
    }

    fn visit_item_trait_mut(&mut self, item: &mut syn::ItemTrait) {
        visit_mut::visit_item_trait_mut(self, item);
        item.items.retain(|member| !is_test_only_trait_item(member));
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

/// The ordered production-source file list the implementation digest is
/// computed over (workflow-contract presentation files excluded — they carry
/// their own digests).
fn implementation_source_files(repository_root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for relative in [
        "rust/chronicle_preprocessing_runtime_wasm/Cargo.toml",
        "rust/chronicle_preprocessing_runtime_wasm/Cargo.lock",
        "rust/chronicle_preprocessing_runtime_wasm/build.rs",
        "rust/chronicle_preprocessing_runtime_wasm/.cargo",
        "rust/chronicle_preprocessing_runtime_wasm/src",
        "rust/chronicle_preprocessing_runtime_wasm/vendor/arrow-ipc-59.1.0/Cargo.toml",
        "rust/chronicle_preprocessing_runtime_wasm/vendor/arrow-ipc-59.1.0/src",
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
        "web/schema/literature-input-adapter-contract.json",
        "web/scripts/build_wasm.mjs",
        "web/scripts/wasm_build_flags.mjs",
    ] {
        let relative = Path::new(relative);
        if repository_root.join(relative).exists() {
            collect_files(repository_root, relative, &mut files);
        }
    }
    files.sort();
    files.dedup();
    let workflow_contract_file =
        Path::new("rust/chronicle_chrono_kernel_wasm/src/workflow_contract.rs");
    let workflow_contract_modules =
        Path::new("rust/chronicle_chrono_kernel_wasm/src/workflow_contract");
    files.retain(|relative| {
        relative != workflow_contract_file && !relative.starts_with(workflow_contract_modules)
    });
    files
}

/// The selection-tracked file list: the implementation-digest fold list plus
/// the workflow-contract presentation files. The aggregate implementation
/// digest deliberately excludes the contract files (their semantics are bound
/// separately), but the campaigns execute their code — footprint selection
/// must see a per-file digest move when they are edited, or a contract-code
/// refactor that leaves the contract golden untouched would never re-run
/// anything.
#[allow(dead_code)]
fn selection_tracked_files(repository_root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for relative in [
        "rust/chronicle_chrono_kernel_wasm/src/workflow_contract.rs",
        "rust/chronicle_chrono_kernel_wasm/src/workflow_contract",
    ] {
        let relative = Path::new(relative);
        if repository_root.join(relative).exists() {
            collect_files(repository_root, relative, &mut files);
        }
    }
    files.extend(implementation_source_files(repository_root));
    files.sort();
    files.dedup();
    files
}

/// Per-file digests of the exact test-stripped bytes the aggregate
/// implementation digest folds (plus the workflow-contract files), for
/// footprint dirty/clean comparison.
#[allow(dead_code)]
fn per_file_production_digests(repository_root: &Path) -> Vec<(String, String)> {
    selection_tracked_files(repository_root)
        .into_iter()
        .map(|relative| {
            let mut hasher = Sha256::new();
            hasher.update(production_source(&repository_root.join(&relative)));
            (
                relative.to_string_lossy().into_owned(),
                format!("sha256:{}", hex::encode(hasher.finalize())),
            )
        })
        .collect()
}
