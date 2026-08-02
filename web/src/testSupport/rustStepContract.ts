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
 * produced field. Mirrors `PipelineFieldEdge` in `step_contract.rs`. */
export type FieldEdge = {
  to: string;
  from: string[];
};

/** One declared canonical output cell family and the data fields that render
 * it. Mirrors `PipelineOutputCellBinding` in `step_contract.rs`. */
export type OutputCellBinding = {
  outputKind: string;
  /** CSV column name, or a JSON pointer whose `*` segments match any index or
   * key. */
  column: string;
  emittingStep: string;
  from: string[];
};

export type RustStepContractStep = {
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

export type RustStepContract = {
  protocolVersion: "chronicle-preprocessing-step-contract/v3";
  preprocessorVersion: string;
  unboundOptionKeys: string[];
  rootRoles: Array<{ roleId: string }>;
  groups: unknown[];
  steps: RustStepContractStep[];
  outputCellBindings: OutputCellBinding[];
  rowSetFields: string[];
  rowAddressedOutputKinds: string[];
};

/** Complete dependency set of one output cell family: its rendered fields plus
 * the row-set pseudo-fields when the cell is addressed by row index. Mirrors
 * `output_cell_dependencies` in `step_contract.rs`. */
export function outputCellDependencies(
  contract: RustStepContract,
  binding: OutputCellBinding,
): string[] {
  return contract.rowAddressedOutputKinds.includes(binding.outputKind)
    ? [...binding.from, ...contract.rowSetFields]
    : [...binding.from];
}

/** A binding column matches an observed column when it is equal, or when its
 * `*` segments stand in for the numeric/dynamic parts of the name. Mirrors
 * `output_column_matches` in `step_contract.rs`. */
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
  step: RustStepContractStep,
  role: string,
  exactOptions: Record<string, unknown>,
): boolean {
  const binding = step.sourceRoleBindings.find((candidate) => candidate.role === role);
  if (!binding) return false;
  return binding.whenAll.every((predicate) => {
    const actual = exactOptions[predicate.request_field];
    if (predicate.operator === "boolean_equals") return actual === predicate.value;
    return typeof actual === "string" && predicate.values.includes(actual);
  });
}
