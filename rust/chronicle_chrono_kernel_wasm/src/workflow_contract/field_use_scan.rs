//! Test-only static scan of the Rust step implementations.
//!
//! `declared_query_edges_equal_direct_salsa_query_calls` already proves that
//! `WorkflowQueryDefinition::inputs`, `query_request_fields`, and
//! `query_source_roles` equal what the tracked queries actually call and read.
//! This module extends the same technique one level finer: it reports, per
//! product step, which *data fields* the step's reachable Rust code touches and
//! which supplied source columns it names. `query_field_reads` /
//! `query_field_writes` in `workflow_contract.rs` are checked against it, so a step
//! that starts or stops using a raw/support column or a canonical row field
//! cannot silently drift away from the declared field graph.
//!
//! The scan is syntactic and deliberately conservative: it follows plain
//! function calls (including `super::`/`incremental::`/`aggregates::` paths)
//! from each tracked query, stops at another product step's query, and records
//! every field identifier that belongs to the canonical row/raw-row carriers.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use syn::visit::{self, Visit};

/// Files that carry the tracked queries and their pure implementations.
const SOURCES: &[(&str, &str)] = &[
    ("pipeline_v2.rs", include_str!("../pipeline_v2.rs")),
    (
        "pipeline_v2_incremental.rs",
        include_str!("../pipeline_v2_incremental.rs"),
    ),
    (
        "pipeline_v2_aggregates.rs",
        include_str!("../pipeline_v2_aggregates.rs"),
    ),
];

/// Structs whose fields make up the product data-field namespace. `RowData` is
/// the canonical row carrier every transformation hands on; `RawRow` is the
/// parsed raw-CSV record that feeds it.
const CARRIER_STRUCTS: &[&str] = &["RowData", "RawRow"];

/// Field identifiers that name a container or bookkeeping slot rather than a
/// product data value. They are excluded from the data-field namespace because
/// they carry provenance or row position, not content. Row position is modelled
/// by the `row.order` pseudo-field of the declared field graph.
const NON_DATA_FIELDS: &[&str] = &[
    "source_data_row",
    "source_data_rows",
    "lineage_searches",
    "index",
];

/// Internal Salsa queries that memoize a parsed support artifact. The declared
/// workflow contract deliberately looks through them, exactly as
/// `declared_query_edges_equal_direct_salsa_query_calls` does for option reads.
/// Every other internal query is a boundary: its work belongs to the product
/// steps that declare it, not to whichever step happened to call the fused
/// fast path.
const TRANSPARENT_INTERNAL_QUERIES: &[&str] = &[
    "background_apps",
    "parsed_filter_rules",
    "parsed_apps_forcing_screen_open",
    "parsed_codebook",
    "parsed_study_windows",
    "parsed_device_sharing",
    "parsed_survey_attribution",
    "parsed_enrolled_devices",
    // Renders the terminal CSV/JSON outputs of `assemble_result_manifest`. No other
    // product step owns the output writers, so its field reads are that step's.
    "assemble_primary_outputs",
    "collect_early_assembly",
];

/// Parse helpers that decode one supplied source artifact. Column literals seen
/// inside them are attributed to that role.
const PARSE_FN_ROLES: &[(&str, &str)] = &[
    ("decode_source_records", "raw_chronicle_csv"),
    ("parse_filter_csv", "filter_file"),
    ("parse_apps_forcing_csv", "apps_forcing_screen_open_file"),
    ("parse_background_apps_csv", "background_apps_file"),
    ("parse_codebook_csv", "app_codebook_file"),
    ("parse_study_windows", "study_dates_file"),
    ("parse_device_sharing", "device_sharing_file"),
    ("parse_survey_lookup", "survey_attribution_file"),
    ("parse_enrolled_devices", "enrolled_devices_file"),
];

#[derive(Default)]
struct FnFacts {
    reads: BTreeSet<String>,
    writes: BTreeSet<String>,
    column_literals: BTreeSet<String>,
    /// True when the body iterates `CODEBOOK_RENAME_PAIRS`, i.e. it reads every
    /// codebook source column rather than a literal subset.
    reads_all_codebook_columns: bool,
    calls: BTreeSet<String>,
    /// Calls made through an explicit `super::`/module path. These always mean
    /// the pure implementation, never the tracked query of the same name.
    qualified_calls: BTreeSet<String>,
    /// True when the body registers itself as an internal Salsa query.
    is_internal_query: bool,
}

#[derive(Default)]
pub(super) struct QueryFieldUse {
    pub(super) reads: BTreeSet<String>,
    pub(super) writes: BTreeSet<String>,
    pub(super) source_columns: BTreeSet<String>,
    /// Function keys the call walk reached from this step's tracked query,
    /// including the root itself. This is the walk's own `seen` set: it is what
    /// decides which implementations contribute fields, so it is reported
    /// rather than dropped.
    pub(super) reached: BTreeSet<String>,
}

struct StructFieldCollector {
    wanted: BTreeSet<&'static str>,
    fields: BTreeSet<String>,
}

impl<'ast> Visit<'ast> for StructFieldCollector {
    fn visit_item_struct(&mut self, item: &'ast syn::ItemStruct) {
        if self.wanted.contains(item.ident.to_string().as_str()) {
            for field in &item.fields {
                if let Some(ident) = &field.ident {
                    self.fields.insert(ident.to_string());
                }
            }
        }
        visit::visit_item_struct(self, item);
    }
}

struct FnCollector<'a> {
    universe: &'a BTreeSet<String>,
    current: Option<String>,
    in_tracked: bool,
    facts: BTreeMap<String, FnFacts>,
    tracked_fns: BTreeSet<String>,
}

impl<'a> FnCollector<'a> {
    fn entry(&mut self) -> Option<&mut FnFacts> {
        let key = self.current.clone()?;
        Some(self.facts.entry(key).or_default())
    }

    fn record_field(&mut self, member: &syn::Member, write: bool) {
        let syn::Member::Named(ident) = member else {
            return;
        };
        let name = ident.to_string();
        if !self.universe.contains(&name) {
            return;
        }
        if let Some(facts) = self.entry() {
            if write {
                facts.writes.insert(name);
            } else {
                facts.reads.insert(name);
            }
        }
    }

    fn record_write_target(&mut self, expr: &syn::Expr) {
        match expr {
            syn::Expr::Field(field) => self.record_field(&field.member, true),
            syn::Expr::Unary(unary) => self.record_write_target(&unary.expr),
            syn::Expr::Index(index) => self.record_write_target(&index.expr),
            syn::Expr::Paren(paren) => self.record_write_target(&paren.expr),
            syn::Expr::Reference(reference) => self.record_write_target(&reference.expr),
            syn::Expr::MethodCall(call) => self.record_write_target(&call.receiver),
            _ => {}
        }
    }
}

impl<'ast, 'a> Visit<'ast> for FnCollector<'a> {
    fn visit_item_mod(&mut self, module: &'ast syn::ItemMod) {
        if module.ident == "tests" {
            return;
        }
        let previous = self.in_tracked;
        if module.ident == "tracked" {
            self.in_tracked = true;
        }
        visit::visit_item_mod(self, module);
        self.in_tracked = previous;
    }

    fn visit_item_fn(&mut self, function: &'ast syn::ItemFn) {
        let name = function.sig.ident.to_string();
        let key = if self.in_tracked {
            self.tracked_fns.insert(name.clone());
            format!("tracked::{name}")
        } else {
            name
        };
        let previous = self.current.replace(key);
        self.facts.entry(self.current.clone().unwrap()).or_default();
        visit::visit_block(self, &function.block);
        self.current = previous;
    }

    fn visit_impl_item_fn(&mut self, function: &'ast syn::ImplItemFn) {
        let key = format!("impl::{}", function.sig.ident);
        let previous = self.current.replace(key);
        self.facts.entry(self.current.clone().unwrap()).or_default();
        visit::visit_block(self, &function.block);
        self.current = previous;
    }

    fn visit_expr_assign(&mut self, assign: &'ast syn::ExprAssign) {
        self.record_write_target(&assign.left);
        visit::visit_expr(self, &assign.right);
        // Walk only *inside* an assigned field so the assignment target is not
        // also counted as a read, while nested reads on the path to it are.
        match &*assign.left {
            syn::Expr::Field(field) => visit::visit_expr(self, &field.base),
            other => visit::visit_expr(self, other),
        }
    }

    fn visit_expr_binary(&mut self, binary: &'ast syn::ExprBinary) {
        if matches!(
            binary.op,
            syn::BinOp::AddAssign(_)
                | syn::BinOp::SubAssign(_)
                | syn::BinOp::MulAssign(_)
                | syn::BinOp::DivAssign(_)
                | syn::BinOp::RemAssign(_)
                | syn::BinOp::BitXorAssign(_)
                | syn::BinOp::BitAndAssign(_)
                | syn::BinOp::BitOrAssign(_)
                | syn::BinOp::ShlAssign(_)
                | syn::BinOp::ShrAssign(_)
        ) {
            self.record_write_target(&binary.left);
        }
        visit::visit_expr_binary(self, binary);
    }

    fn visit_expr_reference(&mut self, reference: &'ast syn::ExprReference) {
        if reference.mutability.is_some() {
            self.record_write_target(&reference.expr);
        }
        visit::visit_expr_reference(self, reference);
    }

    fn visit_expr_field(&mut self, field: &'ast syn::ExprField) {
        self.record_field(&field.member, false);
        visit::visit_expr_field(self, field);
    }

    fn visit_expr_struct(&mut self, literal: &'ast syn::ExprStruct) {
        let literal_is_carrier = literal
            .path
            .segments
            .last()
            .map(|segment| CARRIER_STRUCTS.contains(&segment.ident.to_string().as_str()))
            .unwrap_or(false);
        if literal_is_carrier {
            for field in &literal.fields {
                self.record_field(&field.member, true);
            }
        }
        visit::visit_expr_struct(self, literal);
    }

    fn visit_expr_call(&mut self, call: &'ast syn::ExprCall) {
        if let syn::Expr::Path(path) = &*call.func {
            if path.qself.is_none() {
                let segments = path
                    .path
                    .segments
                    .iter()
                    .map(|segment| segment.ident.to_string())
                    .collect::<Vec<_>>();
                if let Some(name) = segments.last().cloned() {
                    // Supplied support columns are named as string literals in
                    // the shared `support_value` / `require_support_columns`
                    // accessors as often as through `HashMap::get`.
                    let column_arguments: Vec<&syn::Expr> = match name.as_str() {
                        // `support_value(&row, "column")` — the column is the
                        // only string literal argument.
                        "support_value" => call.args.iter().collect(),
                        // `require_support_columns(label, &rows, &["a", "b"])`
                        // — only the array names columns; the label does not.
                        "require_support_columns" => call
                            .args
                            .iter()
                            .map(|argument| match argument {
                                syn::Expr::Reference(reference) => &*reference.expr,
                                other => other,
                            })
                            .filter_map(|argument| match argument {
                                syn::Expr::Array(array) => Some(array),
                                _ => None,
                            })
                            .flat_map(|array| array.elems.iter())
                            .collect(),
                        _ => Vec::new(),
                    };
                    let literals = column_arguments
                        .into_iter()
                        .filter_map(|argument| match argument {
                            syn::Expr::Lit(literal) => match &literal.lit {
                                syn::Lit::Str(text) => Some(text.value()),
                                _ => None,
                            },
                            _ => None,
                        })
                        .collect::<Vec<_>>();
                    if !literals.is_empty() {
                        if let Some(facts) = self.entry() {
                            facts.column_literals.extend(literals);
                        }
                    }
                    let qualified = segments.len() > 1;
                    if let Some(facts) = self.entry() {
                        if qualified {
                            facts.qualified_calls.insert(name);
                        } else {
                            facts.calls.insert(name);
                        }
                    }
                }
            }
        }
        visit::visit_expr_call(self, call);
    }

    fn visit_expr_method_call(&mut self, call: &'ast syn::ExprMethodCall) {
        if call.method == "record_internal_query_body" {
            if let Some(facts) = self.entry() {
                facts.is_internal_query = true;
            }
        }
        if call.method == "get" || call.method == "contains_key" {
            for argument in &call.args {
                if let syn::Expr::Lit(literal) = argument {
                    if let syn::Lit::Str(text) = &literal.lit {
                        if let Some(facts) = self.entry() {
                            facts.column_literals.insert(text.value());
                        }
                    }
                }
            }
        }
        visit::visit_expr_method_call(self, call);
    }

    fn visit_path(&mut self, path: &'ast syn::Path) {
        if path
            .segments
            .iter()
            .any(|segment| segment.ident == "CODEBOOK_RENAME_PAIRS")
        {
            if let Some(facts) = self.entry() {
                facts.reads_all_codebook_columns = true;
            }
        }
        visit::visit_path(self, path);
    }
}

/// Every data field name of the canonical row and raw-row carriers.
pub(super) fn data_field_universe() -> BTreeSet<String> {
    data_field_universe_from(SOURCES)
}

/// The carrier data fields declared by `sources`. `data_field_universe` passes
/// the real step implementations; the unit tests below pass small synthetic
/// sources so the same walk can be driven over a known input.
fn data_field_universe_from(sources: &[(&str, &str)]) -> BTreeSet<String> {
    let mut collector = StructFieldCollector {
        wanted: CARRIER_STRUCTS.iter().copied().collect(),
        fields: BTreeSet::new(),
    };
    for (name, source) in sources {
        let file = syn::parse_file(source).unwrap_or_else(|error| panic!("{name}: {error}"));
        collector.visit_file(&file);
    }
    for excluded in NON_DATA_FIELDS {
        collector.fields.remove(*excluded);
    }
    assert!(
        !collector.fields.is_empty(),
        "carrier structs must contribute data fields"
    );
    collector.fields
}

/// Supplied app-codebook source columns, taken from the join's own table.
fn codebook_source_columns() -> Vec<&'static str> {
    crate::pipeline_v2::codebook_column_renames()
        .iter()
        .map(|(source, _output)| *source)
        .collect()
}

/// Per-step field usage observed in the reachable Rust implementations.
pub(super) fn scan(query_ids: &BTreeSet<&str>) -> BTreeMap<String, QueryFieldUse> {
    scan_sources(query_ids, SOURCES)
}

/// The one scan implementation, over whichever `(name, source)` pairs it is
/// given. `scan` passes the real step implementations; the unit tests below
/// pass synthetic sources that exercise one expression shape at a time.
fn scan_sources(
    query_ids: &BTreeSet<&str>,
    sources: &[(&str, &str)],
) -> BTreeMap<String, QueryFieldUse> {
    let universe = data_field_universe_from(sources);
    let mut collector = FnCollector {
        universe: &universe,
        current: None,
        in_tracked: false,
        facts: BTreeMap::new(),
        tracked_fns: BTreeSet::new(),
    };
    for (name, source) in sources {
        let file = syn::parse_file(source).unwrap_or_else(|error| panic!("{name}: {error}"));
        collector.visit_file(&file);
    }
    let FnCollector {
        facts, tracked_fns, ..
    } = collector;
    let parse_roles = PARSE_FN_ROLES.iter().copied().collect::<BTreeMap<_, _>>();
    let transparent = TRANSPARENT_INTERNAL_QUERIES
        .iter()
        .copied()
        .collect::<BTreeSet<_>>();
    let opaque_internal_queries = facts
        .iter()
        .filter(|(key, current)| {
            current.is_internal_query && !transparent.contains(key.trim_start_matches("tracked::"))
        })
        .map(|(key, _)| key.trim_start_matches("tracked::").to_string())
        .collect::<BTreeSet<_>>();

    let mut result = BTreeMap::new();
    for step in query_ids {
        let root = format!("tracked::{step}");
        assert!(
            facts.contains_key(&root),
            "no tracked query named {step} was found"
        );
        let mut seen = BTreeSet::from([root.clone()]);
        let mut frontier = VecDeque::from([root]);
        let mut use_set = QueryFieldUse::default();
        while let Some(function) = frontier.pop_front() {
            let Some(current) = facts.get(&function) else {
                continue;
            };
            use_set.reads.extend(current.reads.iter().cloned());
            use_set.writes.extend(current.writes.iter().cloned());
            let plain = function
                .rsplit("::")
                .next()
                .expect("function key has a name");
            if let Some(role) = parse_roles.get(plain) {
                for column in &current.column_literals {
                    use_set.source_columns.insert(format!("{role}.{column}"));
                }
                if current.reads_all_codebook_columns {
                    for column in codebook_source_columns() {
                        use_set.source_columns.insert(format!("{role}.{column}"));
                    }
                }
            }
            let mut enqueue = |name: &str, allow_tracked: bool| {
                let mut candidates = Vec::new();
                if allow_tracked && tracked_fns.contains(name) {
                    candidates.push(format!("tracked::{name}"));
                }
                candidates.push(name.to_string());
                for candidate in candidates {
                    if facts.contains_key(&candidate) && seen.insert(candidate.clone()) {
                        frontier.push_back(candidate);
                    }
                }
            };
            for called in &current.calls {
                // Another product step's query, or an opaque internal query, is
                // a boundary: its fields belong to the steps that declare them,
                // not to whichever caller reached the fused fast path.
                if function.starts_with("tracked::")
                    && (query_ids.contains(called.as_str())
                        || opaque_internal_queries.contains(called.as_str()))
                {
                    continue;
                }
                enqueue(called, function.starts_with("tracked::"));
            }
            for called in &current.qualified_calls {
                // An explicit module path always names the pure implementation.
                enqueue(called, false);
            }
        }
        use_set.reached = seen;
        result.insert((*step).to_string(), use_set);
    }
    result
}

/// Unit tests over synthetic sources.
///
/// `declared_field_edges_equal_scanned_field_use` in `workflow_contract.rs` runs
/// this scanner over the real `pipeline_v2*.rs` files and only compares the
/// aggregate result against the declared field graph. That is insensitive to
/// most of the scanner's individual decisions: an expression shape it stops
/// unwrapping simply drops those writes from the observed set, and the
/// declared set is then reconciled against an under-reported one while the
/// suite stays green. These tests drive the same `scan_sources` /
/// `data_field_universe_from` entry points the production call uses, over
/// sources small enough to state the exact expected read, write, source-column
/// and reached-function sets.
#[cfg(test)]
mod tests {
    use super::*;

    /// The carrier every synthetic source declares. `scan_sources` derives its
    /// data-field universe from the sources it is given, so these are the only
    /// field names in play.
    const CARRIER: &str = r"
struct RowData {
    alpha: i64,
    beta: i64,
    handle: i64,
    items: Vec<i64>,
    text: String,
}
";

    fn source(body: &str) -> String {
        format!("{CARRIER}{body}")
    }

    /// Runs the production scan over one synthetic source file.
    fn scan_one(body: &str, step: &str) -> QueryFieldUse {
        let text = source(body);
        let sources = [("synthetic.rs", text.as_str())];
        let query_ids = BTreeSet::from([step]);
        let mut scanned = scan_sources(&query_ids, &sources);
        scanned
            .remove(step)
            .expect("the scan reports the step it was asked for")
    }

    fn names(items: &[&str]) -> BTreeSet<String> {
        items.iter().map(|item| (*item).to_string()).collect()
    }

    #[test]
    fn the_synthetic_carrier_defines_the_data_field_universe() {
        let text = source("");
        let universe = data_field_universe_from(&[("synthetic.rs", text.as_str())]);
        assert_eq!(
            universe,
            names(&["alpha", "beta", "handle", "items", "text"])
        );
    }

    /// `*row.handle = value` is `Expr::Unary(Expr::Field)`: without the unary
    /// arm of `record_write_target` the write disappears and only the read the
    /// assignment walk records survives.
    #[test]
    fn a_write_through_a_dereference_records_the_field_write() {
        let use_set = scan_one(
            r"
mod tracked {
    fn step_deref_write(row: &mut RowData) {
        *row.handle = 1;
    }
}
",
            "step_deref_write",
        );
        assert_eq!(use_set.writes, names(&["handle"]));
        assert_eq!(use_set.reads, names(&["handle"]));
    }

    /// `row.items[position] = value` is `Expr::Index(Expr::Field)`.
    #[test]
    fn a_write_through_an_index_records_the_field_write() {
        let use_set = scan_one(
            r"
mod tracked {
    fn step_index_write(row: &mut RowData, position: usize) {
        row.items[position] = 1;
    }
}
",
            "step_index_write",
        );
        assert_eq!(use_set.writes, names(&["items"]));
        assert_eq!(use_set.reads, names(&["items"]));
    }

    /// `(row.alpha) = value` is `Expr::Paren(Expr::Field)`.
    #[test]
    fn a_write_through_parentheses_records_the_field_write() {
        let use_set = scan_one(
            r"
mod tracked {
    fn step_paren_write(row: &mut RowData) {
        (row.alpha) = 1;
    }
}
",
            "step_paren_write",
        );
        assert_eq!(use_set.writes, names(&["alpha"]));
        assert_eq!(use_set.reads, names(&["alpha"]));
    }

    /// The outer `&mut` of `&mut &row.beta` is handled by
    /// `visit_expr_reference`, which then hands the *inner* `&row.beta` to
    /// `record_write_target`. A nested reference is therefore the shape that
    /// reaches the reference arm; a plain `&mut row.beta` never does, because
    /// the visitor already unwrapped it.
    #[test]
    fn a_write_through_a_nested_reference_records_the_field_write() {
        let use_set = scan_one(
            r"
mod tracked {
    fn step_nested_reference_write(row: &RowData) {
        let _ = &mut &row.beta;
    }
}
",
            "step_nested_reference_write",
        );
        assert_eq!(use_set.writes, names(&["beta"]));
        assert_eq!(use_set.reads, names(&["beta"]));
    }

    /// `&mut row.items.as_mut_slice()` hands `record_write_target` an
    /// `Expr::MethodCall` whose receiver is the field: mutable access reached
    /// through a method is still a write of the receiver field.
    #[test]
    fn a_write_through_a_method_receiver_records_the_field_write() {
        let use_set = scan_one(
            r"
mod tracked {
    fn step_method_receiver_write(row: &mut RowData) {
        let _ = &mut row.items.as_mut_slice();
    }
}
",
            "step_method_receiver_write",
        );
        assert_eq!(use_set.writes, names(&["items"]));
        assert_eq!(use_set.reads, names(&["items"]));
    }

    /// `visit_impl_item_fn` both scopes an inherent method to its own
    /// `impl::` key and walks its body. The walk is what makes a free function
    /// *declared inside* a method visible to the scan at all; the scoping is
    /// what keeps a method's own field use out of the enclosing function.
    #[test]
    fn impl_method_bodies_are_walked_and_scoped_to_their_own_key() {
        let use_set = scan_one(
            r"
mod tracked {
    fn step_impl_bodies(row: &mut RowData) {
        row.alpha = 1;
        helper_declared_in_impl(row);
        outer_holding_an_impl(row);
    }
}

struct Holder;

impl Holder {
    fn wrapper(&self) {
        fn helper_declared_in_impl(row: &mut RowData) {
            row.beta = 2;
        }
    }
}

fn outer_holding_an_impl(row: &mut RowData) {
    row.handle = 3;
    struct Local;
    impl Local {
        fn inner(other: &mut RowData) {
            other.text = 4;
        }
    }
}
",
            "step_impl_bodies",
        );
        // `beta` proves the impl method body was walked; `handle` is the plain
        // helper; `text` is written by an inherent method, which belongs to
        // `impl::inner` and is reachable from no call name.
        assert_eq!(use_set.writes, names(&["alpha", "beta", "handle"]));
        assert_eq!(use_set.reads, BTreeSet::new());
        assert_eq!(
            use_set.reached,
            names(&[
                "tracked::step_impl_bodies",
                "helper_declared_in_impl",
                "outer_holding_an_impl",
            ])
        );
    }

    /// `support_value(&row, "column")` names a supplied column by string
    /// literal, and a parse helper in `PARSE_FN_ROLES` attributes it to that
    /// helper's source role.
    #[test]
    fn support_value_arguments_are_attributed_to_the_parse_helper_role() {
        let use_set = scan_one(
            r#"
mod tracked {
    fn step_support_value(row: &RowData) {
        decode_source_records(row);
    }
}

fn decode_source_records(row: &RowData) {
    let value = support_value(row, "Event Timestamp");
}
"#,
            "step_support_value",
        );
        assert_eq!(
            use_set.source_columns,
            names(&["raw_chronicle_csv.Event Timestamp"])
        );
    }

    /// `require_support_columns(label, &rows, &["a", "b"])` names columns only
    /// in its array argument. The label is a string literal too, and must not
    /// be recorded as a column.
    #[test]
    fn require_support_columns_records_the_array_columns_and_not_the_label() {
        let use_set = scan_one(
            r#"
mod tracked {
    fn step_require_support_columns(rows: &[RowData]) {
        decode_source_records(rows);
    }
}

fn decode_source_records(rows: &[RowData]) {
    require_support_columns("Screen usage", rows, &["Column A", "Column B"]);
}
"#,
            "step_require_support_columns",
        );
        assert_eq!(
            use_set.source_columns,
            names(&["raw_chronicle_csv.Column A", "raw_chronicle_csv.Column B",])
        );
    }

    /// A call that is not made from a tracked query never resolves to the
    /// tracked query of the same name, even when one exists. Resolving it
    /// there would pull another Salsa query's field use into this step's
    /// observed set, which is exactly the over-reporting the `allow_tracked`
    /// guard prevents.
    #[test]
    fn a_qualified_call_resolves_to_the_pure_helper_not_the_tracked_query() {
        let use_set = scan_one(
            r"
mod tracked {
    fn step_qualified_call(row: &mut RowData) {
        row.alpha = 1;
        super::shared_helper(row);
    }

    fn shared_helper(row: &mut RowData) {
        row.handle = 3;
    }
}

fn shared_helper(row: &mut RowData) {
    row.beta = 2;
}
",
            "step_qualified_call",
        );
        assert_eq!(use_set.writes, names(&["alpha", "beta"]));
        assert_eq!(
            use_set.reached,
            names(&["tracked::step_qualified_call", "shared_helper"])
        );
    }

    /// A call to something the scanned sources do not define is not a reached
    /// function. Enqueuing it would put a name with no facts on the frontier
    /// and record it as walked; the walk must stay inside the sources it was
    /// given.
    #[test]
    fn a_call_to_a_function_outside_the_sources_is_never_reached() {
        let use_set = scan_one(
            r"
mod tracked {
    fn step_external_call(row: &mut RowData) {
        row.alpha = 1;
        helper_defined_elsewhere(row);
    }
}
",
            "step_external_call",
        );
        assert_eq!(use_set.writes, names(&["alpha"]));
        assert_eq!(use_set.reached, names(&["tracked::step_external_call"]));
    }
}
