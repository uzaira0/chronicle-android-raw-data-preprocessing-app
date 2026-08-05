//! Emit the browser-side boundary artifact from the Rust serialization model.
//!
//! `web/src/lib/rustPipelineRuntime.ts` decodes the JSON that
//! [`RuntimeManifest`](chronicle_preprocessing_runtime_wasm::RuntimeManifest)
//! and `ReviewRuntimeManifest` serialize across the WASM boundary. Its
//! structural half — which fields exist, what their JSON names are, whether
//! they are nullable, whether they are strings/integers/booleans/arrays/maps,
//! and which enum spellings are legal — used to be retyped by hand in
//! TypeScript, and nothing bound the two together.
//!
//! This example parses the Rust structs with `syn` (the same crate and the
//! same `cfg(test)`-stripping approach `build.rs` already uses for the
//! implementation digest) and prints the generated TypeScript module that
//! carries both the TypeScript types and the runtime structural model. It is
//! an `examples/` target on purpose: `examples/` is outside both the
//! implementation-digest source set in `build.rs` and the closure digest in
//! `scripts/generate_semantic_behavior_inventory.py`, exactly like the
//! existing `implementation_digest` example, so regenerating the artifact
//! never perturbs the runtime's identity.
//!
//! Semantic cross-checks (protocol pins, certificate agreement, checkpoint
//! domains, row accounting, artifact-catalog agreement) stay hand-written in
//! `rustPipelineRuntime.ts`. Only the structural shape is generated here.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use quote::ToTokens;
use serde_json::{json, Map, Value};
use syn::{Attribute, Fields, Item, Type};

/// Boundary model protocol. Bump when the emitted model's own shape changes.
const MODEL_PROTOCOL_VERSION: &str = "chronicle-runtime-boundary-model/v1";

/// Serialization roots the browser decodes. The key is the exported model root
/// name used by `rustPipelineRuntime.ts`.
const ROOTS: [(&str, &str); 2] = [
    ("runtimeManifest", "RuntimeManifest"),
    ("reviewRuntimeManifest", "ReviewRuntimeManifest"),
];

/// Rust type aliases that declare a boundary value domain. A reachable alias
/// that is not listed here is an error: a new alias must state what the
/// browser is allowed to accept instead of silently degrading to a string.
const ALIAS_DOMAINS: [(&str, &str); 2] = [
    ("Sha256Digest", "sha256Digest"),
    ("PreviewCell", "looseString"),
];

/// Crate source trees that define the manifest serialization model: the
/// runtime that serializes it, the semantic adapter whose types it embeds, and
/// the chrono kernel that owns the checkpoint type. `chronicle_semantic_index_wasm`
/// is deliberately excluded — it is a *consumer* that re-declares its own
/// private deserialization mirrors of several of these names, and indexing it
/// would collide with the producing definitions.
const SOURCE_ROOTS: [&str; 3] = [
    "rust/chronicle_preprocessing_runtime_wasm/src",
    "rust/chronicle_preprocessing_semantic_adapter/src",
    "rust/chronicle_chrono_kernel_wasm/src",
];

#[derive(Clone)]
struct StructModel {
    rename_all: Option<String>,
    fields: Vec<FieldSource>,
    source: String,
    /// Set when the type cannot participate in the boundary model. Indexing
    /// stays tolerant so unrelated types elsewhere in the crates (tagged
    /// enums, tuple structs) are only an error when the boundary reaches them.
    unsupported: Option<String>,
}

#[derive(Clone)]
struct FieldSource {
    rust_name: String,
    rename: Option<String>,
    optional: bool,
    ty: Type,
}

#[derive(Clone)]
struct EnumModel {
    rename_all: Option<String>,
    variants: Vec<String>,
    source: String,
    unsupported: Option<String>,
}

#[derive(Default)]
struct Index {
    structs: BTreeMap<String, StructModel>,
    enums: BTreeMap<String, EnumModel>,
    aliases: BTreeMap<String, String>,
    duplicates: BTreeSet<String>,
}

fn repository_root() -> PathBuf {
    std::env::var_os("CHRONICLE_REPOSITORY_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").expect("manifest directory"))
                .join("../..")
        })
}

fn rust_sources(root: &Path, out: &mut Vec<PathBuf>) {
    let mut entries = match fs::read_dir(root) {
        Ok(entries) => entries
            .map(|entry| entry.expect("source directory entry").path())
            .collect::<Vec<_>>(),
        Err(error) => panic!("read {}: {error}", root.display()),
    };
    entries.sort();
    for entry in entries {
        if entry.is_dir() {
            rust_sources(&entry, out);
        } else if entry.extension().and_then(|value| value.to_str()) == Some("rs") {
            out.push(entry);
        }
    }
}

fn is_cfg_test(attrs: &[Attribute]) -> bool {
    attrs.iter().any(|attr| {
        attr.path().is_ident("cfg")
            && attr
                .to_token_stream()
                .to_string()
                .split_whitespace()
                .collect::<String>()
                .contains("(test)")
    })
}

fn container_rename_all(attrs: &[Attribute]) -> Result<Option<String>, String> {
    let mut rename_all = None;
    for attr in attrs {
        if !attr.path().is_ident("serde") {
            continue;
        }
        attr.parse_nested_meta(|meta| {
            if meta.path.is_ident("rename_all") {
                let value: syn::LitStr = meta.value()?.parse()?;
                rename_all = Some(value.value());
                Ok(())
            } else if meta.path.is_ident("deny_unknown_fields") {
                Ok(())
            } else {
                Err(meta.error("unsupported serde container attribute"))
            }
        })
        .map_err(|error| error.to_string())?;
    }
    Ok(rename_all)
}

/// Returns `(rename, optional, skipped)` for one field.
fn field_serde(attrs: &[Attribute]) -> Result<(Option<String>, bool, bool), String> {
    let mut rename = None;
    let mut optional = false;
    let mut skipped = false;
    for attr in attrs {
        if !attr.path().is_ident("serde") {
            continue;
        }
        attr.parse_nested_meta(|meta| {
            if meta.path.is_ident("rename") {
                let value: syn::LitStr = meta.value()?.parse()?;
                rename = Some(value.value());
                Ok(())
            } else if meta.path.is_ident("default") {
                // Deserialization-only: the field is still always serialized.
                if meta.input.peek(syn::Token![=]) {
                    let _: syn::LitStr = meta.value()?.parse()?;
                }
                Ok(())
            } else if meta.path.is_ident("skip_serializing_if") {
                let value: syn::LitStr = meta.value()?.parse()?;
                if value.value() != "Option::is_none" {
                    return Err(meta.error("only Option::is_none may make a field optional"));
                }
                optional = true;
                Ok(())
            } else if meta.path.is_ident("skip") || meta.path.is_ident("skip_serializing") {
                skipped = true;
                Ok(())
            } else {
                Err(meta.error("unsupported serde field attribute"))
            }
        })
        .map_err(|error| error.to_string())?;
    }
    Ok((rename, optional, skipped))
}

fn collect_items(items: &[Item], source: &str, index: &mut Index) {
    for item in items {
        match item {
            Item::Mod(module) => {
                if is_cfg_test(&module.attrs) {
                    continue;
                }
                if let Some((_, nested)) = &module.content {
                    collect_items(nested, source, index);
                }
            }
            Item::Struct(item) => {
                if is_cfg_test(&item.attrs) {
                    continue;
                }
                let name = item.ident.to_string();
                let mut unsupported = None;
                let rename_all = match container_rename_all(&item.attrs) {
                    Ok(value) => value,
                    Err(error) => {
                        unsupported = Some(error);
                        None
                    }
                };
                let mut fields = Vec::new();
                match &item.fields {
                    Fields::Named(named) => {
                        for field in &named.named {
                            let rust_name = field.ident.as_ref().expect("named field").to_string();
                            match field_serde(&field.attrs) {
                                Ok((_, _, true)) => continue,
                                Ok((rename, optional, false)) => fields.push(FieldSource {
                                    rust_name,
                                    rename,
                                    optional,
                                    ty: field.ty.clone(),
                                }),
                                Err(error) => {
                                    unsupported = Some(format!("field `{rust_name}`: {error}"));
                                }
                            }
                        }
                    }
                    _ => {
                        unsupported = Some(
                            "tuple and unit structs are not part of the boundary model".into(),
                        );
                    }
                }
                let model = StructModel {
                    rename_all,
                    fields,
                    source: source.to_string(),
                    unsupported,
                };
                if index.structs.insert(name.clone(), model).is_some()
                    || index.enums.contains_key(&name)
                {
                    index.duplicates.insert(name);
                }
            }
            Item::Enum(item) => {
                if is_cfg_test(&item.attrs) {
                    continue;
                }
                let name = item.ident.to_string();
                let mut unsupported = None;
                let rename_all = match container_rename_all(&item.attrs) {
                    Ok(value) => value,
                    Err(error) => {
                        unsupported = Some(error);
                        None
                    }
                };
                let mut variants = Vec::new();
                for variant in &item.variants {
                    if !matches!(variant.fields, Fields::Unit) {
                        unsupported = Some(
                            "data-carrying enum variants are not part of the boundary model".into(),
                        );
                        break;
                    }
                    variants.push(variant.ident.to_string());
                }
                let model = EnumModel {
                    rename_all,
                    variants,
                    source: source.to_string(),
                    unsupported,
                };
                if index.enums.insert(name.clone(), model).is_some()
                    || index.structs.contains_key(&name)
                {
                    index.duplicates.insert(name);
                }
            }
            Item::Type(item) => {
                if is_cfg_test(&item.attrs) {
                    continue;
                }
                let name = item.ident.to_string();
                let target = item.ty.to_token_stream().to_string();
                if index.aliases.insert(name.clone(), target).is_some() {
                    index.duplicates.insert(name);
                }
            }
            _ => {}
        }
    }
}

fn to_snake_case(value: &str) -> String {
    let mut out = String::new();
    for (position, character) in value.char_indices() {
        if character.is_uppercase() {
            if position != 0 {
                out.push('_');
            }
            out.extend(character.to_lowercase());
        } else {
            out.push(character);
        }
    }
    out
}

fn to_camel_case(value: &str) -> String {
    let mut out = String::new();
    let mut capitalize = false;
    for character in value.chars() {
        if character == '_' {
            capitalize = true;
            continue;
        }
        if capitalize {
            out.extend(character.to_uppercase());
            capitalize = false;
        } else {
            out.push(character);
        }
    }
    out
}

fn to_kebab_case(value: &str) -> String {
    to_snake_case(value).replace('_', "-")
}

fn apply_rename_all(rename_all: Option<&String>, rust_name: &str, context: &str) -> String {
    match rename_all.map(String::as_str) {
        None => rust_name.to_string(),
        Some("snake_case") => to_snake_case(rust_name),
        Some("camelCase") => to_camel_case(&to_snake_case(rust_name)),
        Some("kebab-case") => to_kebab_case(rust_name),
        Some(other) => panic!("{context}: unsupported serde rename_all `{other}`"),
    }
}

fn enum_label(name: &str) -> String {
    to_snake_case(name).replace('_', " ")
}

fn type_name(ty: &Type) -> (String, Vec<Type>) {
    let Type::Path(path) = ty else {
        panic!("unsupported boundary field type: {}", ty.to_token_stream());
    };
    let segment = path
        .path
        .segments
        .last()
        .expect("type path has a final segment");
    let name = segment.ident.to_string();
    let mut arguments = Vec::new();
    if let syn::PathArguments::AngleBracketed(bracketed) = &segment.arguments {
        for argument in &bracketed.args {
            match argument {
                syn::GenericArgument::Type(inner) => arguments.push(inner.clone()),
                other => panic!(
                    "unsupported generic argument in boundary field type: {}",
                    other.to_token_stream()
                ),
            }
        }
    }
    (name, arguments)
}

fn value_model(ty: &Type, index: &Index, reachable: &mut Vec<String>, context: &str) -> Value {
    let (name, arguments) = type_name(ty);
    match (name.as_str(), arguments.len()) {
        ("Option", 1) => json!({
            "kind": "nullable",
            "inner": value_model(&arguments[0], index, reachable, context),
        }),
        ("Vec", 1) => json!({
            "kind": "array",
            "items": value_model(&arguments[0], index, reachable, context),
        }),
        ("Box", 1) | ("Arc", 1) => value_model(&arguments[0], index, reachable, context),
        ("BTreeMap", 2) | ("HashMap", 2) => {
            let (key, _) = type_name(&arguments[0]);
            if key != "String" {
                panic!("{context}: boundary maps must be keyed by String, found {key}");
            }
            json!({
                "kind": "map",
                "values": value_model(&arguments[1], index, reachable, context),
            })
        }
        ("String", 0) => json!({ "kind": "string" }),
        ("bool", 0) => json!({ "kind": "boolean" }),
        ("u8", 0) | ("u16", 0) | ("u32", 0) | ("u64", 0) | ("usize", 0) => {
            json!({ "kind": "integer" })
        }
        _ if !arguments.is_empty() => {
            panic!("{context}: unsupported generic boundary type `{name}`")
        }
        _ => {
            if let Some(domain) = ALIAS_DOMAINS
                .iter()
                .find(|(alias, _)| *alias == name)
                .map(|(_, domain)| *domain)
            {
                if !index.aliases.contains_key(&name) {
                    panic!(
                        "{context}: alias `{name}` has a declared domain but no Rust definition"
                    );
                }
                return json!({ "kind": domain });
            }
            if index.aliases.contains_key(&name) {
                panic!(
                    "{context}: type alias `{name}` reaches the boundary without a declared value domain; add it to ALIAS_DOMAINS"
                );
            }
            if index.duplicates.contains(&name) {
                panic!("{context}: `{name}` is defined more than once in the parsed sources");
            }
            if index.structs.contains_key(&name) {
                reachable.push(name.clone());
                return json!({ "kind": "struct", "name": name });
            }
            if index.enums.contains_key(&name) {
                reachable.push(name.clone());
                return json!({ "kind": "enum", "name": name });
            }
            panic!("{context}: unknown boundary type `{name}`");
        }
    }
}

fn build_model(index: &Index) -> Map<String, Value> {
    let mut types: Map<String, Value> = Map::new();
    let mut pending: Vec<String> = ROOTS.iter().map(|(_, name)| name.to_string()).collect();
    while let Some(name) = pending.pop() {
        if types.contains_key(&name) {
            continue;
        }
        if index.duplicates.contains(&name) {
            panic!("`{name}` is defined more than once in the parsed sources");
        }
        if let Some(model) = index.structs.get(&name) {
            let context = format!("{}: struct {name}", model.source);
            if let Some(reason) = &model.unsupported {
                panic!("{context}: {reason}");
            }
            let mut fields = Vec::new();
            for field in &model.fields {
                let json_name = match &field.rename {
                    Some(rename) => rename.clone(),
                    None => apply_rename_all(model.rename_all.as_ref(), &field.rust_name, &context),
                };
                let field_context = format!("{context}.{}", field.rust_name);
                let mut entry = Map::new();
                entry.insert("name".into(), Value::String(json_name));
                entry.insert("rustName".into(), Value::String(field.rust_name.clone()));
                // `skip_serializing_if = "Option::is_none"` means the key is
                // absent, never `null`; the boundary value is the inner type.
                let mut value_type = field.ty.clone();
                if field.optional {
                    entry.insert("optional".into(), Value::Bool(true));
                    let (outer, arguments) = type_name(&value_type);
                    if outer != "Option" || arguments.len() != 1 {
                        panic!("{field_context}: skip_serializing_if requires an Option field");
                    }
                    value_type = arguments[0].clone();
                }
                entry.insert(
                    "value".into(),
                    value_model(&value_type, index, &mut pending, &field_context),
                );
                fields.push(Value::Object(entry));
            }
            types.insert(
                name.clone(),
                json!({ "kind": "struct", "fields": Value::Array(fields) }),
            );
            continue;
        }
        if let Some(model) = index.enums.get(&name) {
            let context = format!("{}: enum {name}", model.source);
            if let Some(reason) = &model.unsupported {
                panic!("{context}: {reason}");
            }
            let variants = model
                .variants
                .iter()
                .map(|variant| {
                    Value::String(apply_rename_all(
                        model.rename_all.as_ref(),
                        variant,
                        &context,
                    ))
                })
                .collect::<Vec<_>>();
            types.insert(
                name.clone(),
                json!({
                    "kind": "enum",
                    "label": enum_label(&name),
                    "variants": Value::Array(variants),
                }),
            );
            continue;
        }
        panic!("boundary root or reference `{name}` is not a serializable Rust type");
    }
    types
}

fn typescript_type(value: &Value) -> String {
    let kind = value["kind"].as_str().expect("value model kind");
    match kind {
        "string" | "looseString" | "sha256Digest" => "string".into(),
        "integer" => "number".into(),
        "boolean" => "boolean".into(),
        "nullable" => format!("{} | null", typescript_type(&value["inner"])),
        "array" => {
            let items = typescript_type(&value["items"]);
            if items.contains(' ') {
                format!("({items})[]")
            } else {
                format!("{items}[]")
            }
        }
        "map" => format!("Record<string, {}>", typescript_type(&value["values"])),
        "struct" | "enum" => value["name"].as_str().expect("named reference").into(),
        other => panic!("unsupported value model kind `{other}`"),
    }
}

fn typescript_declaration(name: &str, model: &Value) -> String {
    match model["kind"].as_str().expect("type model kind") {
        "struct" => {
            let mut lines = String::new();
            for field in model["fields"].as_array().expect("struct fields") {
                let key = field["name"].as_str().expect("field name");
                let optional = field.get("optional").is_some();
                let quoted = if key
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric() || character == '_')
                    && !key.chars().next().is_some_and(|c| c.is_ascii_digit())
                {
                    key.to_string()
                } else {
                    format!("\"{key}\"")
                };
                lines.push_str(&format!(
                    "  {quoted}{}: {};\n",
                    if optional { "?" } else { "" },
                    typescript_type(&field["value"])
                ));
            }
            format!("export type {name} = {{\n{lines}}};\n")
        }
        "enum" => {
            let variants = model["variants"]
                .as_array()
                .expect("enum variants")
                .iter()
                .map(|variant| format!("\"{}\"", variant.as_str().expect("variant")))
                .collect::<Vec<_>>()
                .join(" | ");
            format!("export type {name} = {variants};\n")
        }
        other => panic!("unsupported type model kind `{other}`"),
    }
}

fn main() {
    let root = repository_root();
    let mut index = Index::default();
    for relative in SOURCE_ROOTS {
        let directory = root.join(relative);
        let mut files = Vec::new();
        rust_sources(&directory, &mut files);
        for file in files {
            let text = fs::read_to_string(&file)
                .unwrap_or_else(|error| panic!("read {}: {error}", file.display()));
            let parsed = syn::parse_file(&text)
                .unwrap_or_else(|error| panic!("parse {}: {error}", file.display()));
            let source = file
                .strip_prefix(&root)
                .unwrap_or(&file)
                .display()
                .to_string();
            collect_items(&parsed.items, &source, &mut index);
        }
    }

    let types = build_model(&index);
    let mut roots = Map::new();
    for (key, name) in ROOTS {
        roots.insert(key.into(), Value::String(name.into()));
    }
    let model = json!({
        "protocolVersion": MODEL_PROTOCOL_VERSION,
        "roots": Value::Object(roots),
        "types": Value::Object(types.clone()),
    });

    let mut declarations = String::new();
    for (name, type_model) in &types {
        declarations.push('\n');
        declarations.push_str(&typescript_declaration(name, type_model));
    }

    let rendered = serde_json::to_string_pretty(&model).expect("render boundary model");
    print!(
        "// This file is generated by\n\
         // rust/chronicle_preprocessing_runtime_wasm/examples/boundary_model.rs.\n\
         // Do not edit by hand; change the Rust serialization model and run\n\
         // `npm run generate:boundary` (verified by `npm run check:boundary`).\n\
         //\n\
         // The model below drives the STRUCTURAL half of the fail-closed WASM\n\
         // boundary decoder in rustPipelineRuntime.ts: field presence, JSON\n\
         // names, nullability, value domains, collection shapes, and enum\n\
         // spellings. Semantic cross-checks (protocol pins, certificate\n\
         // agreement, checkpoint domains, row accounting, artifact-catalog\n\
         // agreement) remain hand-written beside the decoder.\n\
         import type {{ BoundaryModel }} from \"@/lib/runtimeBoundaryModel\";\n\
         {declarations}\n\
         export const RUNTIME_BOUNDARY_MODEL: BoundaryModel = {rendered};\n"
    );
}
