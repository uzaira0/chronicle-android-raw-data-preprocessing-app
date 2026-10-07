export type SourceRolePredicate =
  | {
      operator: "boolean_equals";
      request_field: string;
      value: boolean;
    }
  | {
      operator: "string_one_of";
      request_field: string;
      values: string[];
    };

export type SourceRoleBinding = {
  role: string;
  whenAll: SourceRolePredicate[];
};

/** One declared field-level dependency: the exact inputs that determine one
 * produced field. Mirrors the Rust workflow query contract. */
export type FieldEdge = {
  to: string;
  from: string[];
};

/** One declared canonical output cell family and the data fields that render
 * it. Mirrors the Rust workflow output-cell contract. */
export type OutputCellBinding = {
  outputKind: string;
  /** CSV column name, or a JSON pointer whose `*` segments match any index or
   * key. */
  column: string;
  emittingQuery: string;
  from: string[];
};

export type RustWorkflowQuery = {
  id: string;
  group: string;
  /** The MAY-READ set: every upstream query this body can read on ANY
   * configuration arm. It is not an arm-exact edge list and nothing predicts a
   * per-arm execution set from it — Salsa records each body's real reads per
   * revision and owns invalidation outright. */
  inputs: string[];
  requestFields: string[];
  sourceRoles: string[];
  sourceRoleBindings: SourceRoleBinding[];
  fieldReads: string[];
  fieldWrites: string[];
  fieldEdges: FieldEdge[];
  applicability: unknown;
  canBypass: boolean;
};

export type RustWorkflowContract = {
  protocolVersion: "chronicle-workflow-contract/v1";
  preprocessorVersion: string;
  unboundOptionKeys: string[];
  /** Wire request fields consumed only while materializing derived
   * browser/export artifacts. The runtime excludes exactly these fields from
   * the options digest bound into scientific receipts. Mirrors
   * `RUNTIME_ARTIFACT_REQUEST_FIELDS` in `workflow_contract.rs`. */
  runtimeArtifactRequestFields: string[];
  semantic: {
    rootRoles: Array<{ roleId: string }>;
    outputCellBindings: OutputCellBinding[];
    rowSetFields: string[];
    rowAddressedOutputKinds: string[];
  };
  execution: {
    queryGroups: unknown[];
    queries: RustWorkflowQuery[];
  };
};

/** Complete dependency set of one output cell family: its rendered fields plus
 * the row-set pseudo-fields when the cell is addressed by row index. Mirrors
 * `output_cell_dependencies` in `workflow_contract.rs`. */
export function outputCellDependencies(
  contract: RustWorkflowContract,
  binding: OutputCellBinding,
): string[] {
  return contract.semantic.rowAddressedOutputKinds.includes(binding.outputKind)
    ? [...binding.from, ...contract.semantic.rowSetFields]
    : [...binding.from];
}

/** A binding column matches an observed column when it is equal, or when its
 * `*` segments stand in for the numeric/dynamic parts of the name. Mirrors
 * `output_column_matches` in `workflow_contract.rs`. */
export function outputColumnMatches(pattern: string, observed: string): boolean {
  const parts = pattern.split("*");
  const first = parts[0] ?? "";
  if (!observed.startsWith(first)) return false;
  let rest = observed.slice(first.length);
  // A pattern with no `*` is an exact column name, not a prefix.
  if (parts.length === 1) return rest.length === 0;
  for (let index = 1; index < parts.length; index += 1) {
    const part = parts[index] ?? "";
    if (index === parts.length - 1) {
      return rest.length >= part.length && rest.endsWith(part);
    }
    const found = rest.indexOf(part);
    if (found < 0) return false;
    rest = rest.slice(found + part.length);
  }
  return true;
}

/** Evaluate a `whenAll` predicate list against an exact options document. An
 * empty list is vacuously true, i.e. unconditional. */
function predicatesHold(
  whenAll: SourceRolePredicate[],
  exactOptions: Record<string, unknown>,
): boolean {
  return whenAll.every((predicate) => {
    const actual = exactOptions[predicate.request_field];
    if (predicate.operator === "boolean_equals") return actual === predicate.value;
    return typeof actual === "string" && predicate.values.includes(actual);
  });
}

export function sourceRoleIsActive(
  query: RustWorkflowQuery,
  role: string,
  exactOptions: Record<string, unknown>,
): boolean {
  // The Rust runtime treats a role as active when ANY of its bindings is
  // active (lib.rs active_source_roles filters over all bindings); a
  // first-binding-only .find here would silently diverge if a query ever
  // declared two bindings for one role.
  return query.sourceRoleBindings
    .filter((candidate) => candidate.role === role)
    .some((binding) => predicatesHold(binding.whenAll, exactOptions));
}

/** Every executed query in the warm target that has NO justification.
 *
 * WHY THIS SHAPE. Salsa owns invalidation: each of the tracked functions in
 * `pipeline_v2_incremental.rs` records its own real reads per revision, and
 * `WORKFLOW_QUERIES` is never consulted to decide recomputation. The published
 * `inputs` table is a MAY-READ set — the complete set of upstream queries a
 * body may read on ANY configuration arm — so it cannot predict a per-arm
 * execution set, and nothing here tries to. Predicting one was the previous
 * design; it failed in the direction that does not matter (a declared query
 * that did not run costs nothing) while spending its precision on arm-exact
 * edge bookkeeping.
 *
 * The dangerous direction is the other one: a query that RAN with nothing
 * upstream of it having changed. That is an undeclared read — the
 * missing-invalidation class, where the published graph says a value cannot
 * depend on an input that it does in fact read. So the property asserted per
 * case is that the set returned here is empty.
 *
 * THE RULE, exactly as implemented below.
 *
 * First, one-directionally and outside the disjunction: a query whose status in
 * the TARGET is `bypassed` is not applicable there, so executing it is
 * self-contradicting and is ALWAYS unjustified — no upstream change, changed
 * request field, or changed source role can excuse it.
 *
 * Otherwise the query is justified by ANY ONE of these four reasons:
 * 1. it was `bypassed` in the SOURCE, i.e. it is newly applicable in the target
 *    and so has no prior value to reuse;
 * 2. a request field it binds (`requestFields`) is in `changedRequestFields`;
 * 3. a source role it binds (`sourceRoles`) is in `changedSourceRoles` AND that
 *    role binding's `whenAll` predicates hold under the target options;
 * 4. at least one of its declared (may-read) `inputs` published a changed output
 *    digest, i.e. is in `changedQueryOutputs`.
 *
 * A query the contract does not register at all is reported unjustified: the
 * runtime executed something the published registry does not describe. */
export function unjustifiedExecutions(input: {
  contract: RustWorkflowContract;
  targetOptions: Record<string, unknown>;
  sourceStatuses: Record<string, string>;
  targetStatuses: Record<string, string>;
  changedRequestFields?: ReadonlySet<string>;
  changedSourceRoles?: ReadonlySet<string>;
  changedQueryOutputs?: ReadonlySet<string>;
  executed: readonly string[];
}): string[] {
  const changedRequestFields = input.changedRequestFields ?? new Set<string>();
  const changedSourceRoles = input.changedSourceRoles ?? new Set<string>();
  const changedQueryOutputs = input.changedQueryOutputs ?? new Set<string>();
  return [...input.executed]
    .filter((queryId) => {
      const query = input.contract.execution.queries.find(
        ({ id }) => id === queryId,
      );
      if (!query) return true;
      // ONE-DIRECTIONAL, and deliberately NOT one disjunct among others:
      // executing a query the target bypassed is contradictory on its face. The
      // target status says the query is not applicable on this arm, so no
      // amount of upstream movement makes running it legitimate. The previous
      // shape applied `applicableInTarget` only to the bypassed-in-source
      // disjunct, which let an executed-while-bypassed query be excused by, say,
      // a moved upstream output digest.
      if (input.targetStatuses[queryId] === "bypassed") return true;
      const bypassedInSource = input.sourceStatuses[queryId] === "bypassed";
      const justified =
        bypassedInSource ||
        query.requestFields.some((field) => changedRequestFields.has(field)) ||
        query.sourceRoles.some(
          (role) =>
            changedSourceRoles.has(role) &&
            sourceRoleIsActive(query, role, input.targetOptions),
        ) ||
        query.inputs.some((upstream) => changedQueryOutputs.has(upstream));
      return !justified;
    })
    .sort();
}
