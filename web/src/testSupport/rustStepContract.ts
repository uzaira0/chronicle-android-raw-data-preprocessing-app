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

export type RustStepContractStep = {
  id: string;
  group: string;
  inputs: string[];
  requestFields: string[];
  sourceRoles: string[];
  sourceRoleBindings: SourceRoleBinding[];
  applicability: unknown;
  canBypass: boolean;
};

export type RustStepContract = {
  protocolVersion: "chronicle-preprocessing-step-contract/v3";
  unboundOptionKeys: string[];
  rootRoles: unknown[];
  groups: unknown[];
  steps: RustStepContractStep[];
};

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
