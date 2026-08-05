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

export function sourceRoleIsActive(
  query: RustWorkflowQuery,
  role: string,
  exactOptions: Record<string, unknown>,
): boolean {
  const binding = query.sourceRoleBindings.find((candidate) => candidate.role === role);
  if (!binding) return false;
  return binding.whenAll.every((predicate) => {
    const actual = exactOptions[predicate.request_field];
    if (predicate.operator === "boolean_equals") return actual === predicate.value;
    return typeof actual === "string" && predicate.values.includes(actual);
  });
}
