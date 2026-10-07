import contractJson from "../../schema/literature-input-adapter-contract.json" with { type: "json" };
import { BROWSER_SUPPORT_FILE_KEYS } from "@/lib/generatedContract";
import type { BrowserSupportFiles } from "@/lib/types";

export type LiteratureInputAdapterContract = {
  semanticType: string;
  adapterId: string;
  adapterVersion: string;
  routeKind: "protocol_input" | "native_operator_parameter";
  inputRole: string;
  schemaId: string;
  requiredSupportRoles?: string[];
  requiredFields: string[];
  guiSurface: string;
  /**
   * Adapter-output compatibility values applied to the runtime request. These
   * are not evidence mappings and must never be emitted as method bindings.
   */
  runtimeOptionOverrides?: Record<string, unknown>;
  optionBindings?: Record<string, unknown>;
  componentExecution?: LiteratureComponentExecutionContract;
  sourceSchemas?: LiteratureSourceSchemaContract[];
  methodSettingIds: string[];
};

export type LiteratureComponentExecutionContract = {
  componentId: string;
  parentMethodProfileId: string;
  sourceWorkId: string;
  sourceMethodVariantId: string;
  methodProfileVersion: string;
  derivedResultKind: string;
  adaptedResultKind?: "literature-input-adapted-csv" | "literature-input-adapted-arrow";
  tableFormat?: "arrow-ipc-file";
  sourceOracleId: string;
  additionalMethodSettingIds?: string[];
  requiredSupportRoles: string[];
  fullProfileExecutionStatus: "blocked";
  canonicalRegistrationStatus?: "blocked_version_mismatch" | "linked_artifact_only" | "outside_frozen143_extension";
  limitations?: string[];
};

export type RegisteredLiteratureComponentExecution = Omit<
  LiteratureComponentExecutionContract,
  "limitations"
> & {
  adapterId: string;
  adapterVersion: string;
  methodSettingIds: string[];
  limitations: string[];
};

export type LiteratureSourceSchemaContract = {
  methodSettingId: string;
  sourceWorkId: string;
  sourceValue: unknown;
  sourceValueSha256: string;
  kind: "event_type" | "field_alias" | "field_passthrough" | "scope_guard";
  sourceField: string;
  sourceExact?: boolean;
  sourceMatchValue?: string;
  canonicalField?: "interaction_type" | "event_timestamp" | "app_package_name";
  canonicalValue?: string;
  eventMatches?: {
    sourceMatchValue: string;
    canonicalValue: string;
    frameRole?: "start" | "stop";
  }[];
  framingPolicy?: "strict_two_token_complete_frames";
  requiresPackage: boolean;
};

const groups = contractJson.groups as LiteratureInputAdapterContract[];

export function literatureComponentTableMediaType(component: LiteratureComponentExecutionContract): string {
  return component.tableFormat === "arrow-ipc-file" ? "application/vnd.apache.arrow.file" : "text/csv";
}

export function literatureComponentInputRole(component: RegisteredLiteratureComponentExecution): string {
  if (component.tableFormat !== "arrow-ipc-file") return "raw_chronicle_csv";
  const group = groups.find((group) => group.adapterId === component.adapterId && group.adapterVersion === component.adapterVersion);
  if (!group) throw new Error("typed component input role is not registered");
  return group.inputRole;
}
const bySettingId = new Map<string, LiteratureInputAdapterContract>();
const sourceSchemaBySettingId = new Map<
  string,
  LiteratureSourceSchemaContract
>();
const componentBySettingId = new Map<
  string,
  RegisteredLiteratureComponentExecution
>();
const supportFileKeyByRole = new Map<string, keyof BrowserSupportFiles>(
  BROWSER_SUPPORT_FILE_KEYS.map((key) => [
    key
      .replace(/^phoneStudy/, "phonestudy")
      .replace(/[A-Z]/g, (character) => `_${character.toLocaleLowerCase()}`),
    key,
  ]),
);
for (const group of groups) {
  const groupIds = new Set(group.methodSettingIds);
  const groupSupportRoles = group.requiredSupportRoles ?? [];
  if (
    new Set(groupSupportRoles).size !== groupSupportRoles.length ||
    groupSupportRoles.some(
      (role) => !role.trim() || !supportFileKeyByRole.has(role),
    )
  ) {
    throw new Error(
      `malformed literature adapter support roles: ${group.adapterId}`,
    );
  }
  const component = group.componentExecution
    ? {
        ...group.componentExecution,
        adapterId: group.adapterId,
        adapterVersion: group.adapterVersion,
        methodSettingIds: [...group.methodSettingIds, ...(group.componentExecution.additionalMethodSettingIds ?? [])],
        requiredSupportRoles: [
          ...group.componentExecution.requiredSupportRoles,
        ],
        limitations: [...(group.componentExecution.limitations ?? [])],
      }
    : undefined;
  if (
    component &&
    (!component.componentId.trim() ||
      !component.parentMethodProfileId.trim() ||
      !component.sourceWorkId.trim() ||
      !component.sourceMethodVariantId.trim() ||
      !component.methodProfileVersion.trim() ||
      !component.derivedResultKind.trim() ||
      !component.sourceOracleId.trim() ||
      new Set(component.methodSettingIds).size !== component.methodSettingIds.length ||
      (component.tableFormat !== undefined && component.tableFormat !== "arrow-ipc-file") ||
      (component.adaptedResultKind !== undefined && component.adaptedResultKind !==
        (component.tableFormat === "arrow-ipc-file" ? "literature-input-adapted-arrow" : "literature-input-adapted-csv")) ||
      new Set(component.requiredSupportRoles).size !==
        component.requiredSupportRoles.length ||
      component.requiredSupportRoles.some(
        (role) => !role.trim() || !supportFileKeyByRole.has(role),
      ) ||
      new Set(component.limitations).size !== component.limitations.length ||
      component.limitations.some((limitation) => !limitation.trim()) ||
      component.fullProfileExecutionStatus !== "blocked")
  ) {
    throw new Error(
      `malformed literature component registration: ${group.adapterId}`,
    );
  }
  if (component?.canonicalRegistrationStatus !== undefined &&
      !["blocked_version_mismatch", "linked_artifact_only", "outside_frozen143_extension"].includes(component.canonicalRegistrationStatus)) {
    throw new Error(`unrecognized component registration status: ${group.adapterId}`);
  }
  const extension = component?.componentId === "chronicle.sdu-supplied-period-reductions/v1"
    ? ["outside143:sdu-device-tracker:v1", "doi:10.1016/j.chbr.2021.100164", "sdu-device-tracker:source-qualified-outside143:v1", "literature-sdu-supplied-period-reductions-csv", "outside143:sdu-device-tracker:v1:period_reductions", "sdu-primary-supplied-period-reductions-v1/primary-pdf-sha256:31c48a45306cbc1f9bb9675185bd8aa05e35940999a9b8744e4aa378fe5ae04a"]
    : component?.componentId === "chronicle.sdu-supplied-validation-arithmetic/v1"
    ? ["outside143:sdu-device-tracker:v1", "doi:10.1016/j.chbr.2021.100164", "sdu-device-tracker:source-qualified-outside143:v1", "literature-sdu-supplied-validation-arithmetic-csv", "outside143:sdu-device-tracker:v1:validation_arithmetic", "sdu-primary-supplied-validation-arithmetic-v1/primary-pdf-sha256:31c48a45306cbc1f9bb9675185bd8aa05e35940999a9b8744e4aa378fe5ae04a"]
    : component?.componentId === "chronicle.usage-logger-released-numeric/v1"
    ? ["outside143:usage-logger:v1", "doi:10.3758/s13428-021-01585-7", "usage-logger:source-qualified-outside143:v1", "literature-usage-logger-released-numeric-csv", "outside143:usage-logger:v1:released_numeric", "usage-logger-released-numeric-v1/source-commit:6d1f4d44560ccd9a158c04adb37c6fc988bbbd35"] : undefined;
  if (component?.canonicalRegistrationStatus === "outside_frozen143_extension" &&
      (!extension || component.parentMethodProfileId !== extension[0] ||
       component.sourceWorkId !== extension[1] || component.sourceMethodVariantId !== extension[2] ||
       component.methodProfileVersion !== "1" ||
       component.derivedResultKind !== extension[3] || component.sourceOracleId !== extension[5] ||
       component.componentId !== `${group.adapterId}/${group.adapterVersion}` ||
       group.routeKind !== "protocol_input" || group.inputRole !== "raw_chronicle_csv" ||
       group.methodSettingIds.length !== 1 ||
       group.methodSettingIds[0] !== extension[4] ||
       (component.additionalMethodSettingIds?.length ?? 0) !== 0 ||
       groupSupportRoles.length !== 0 || component.requiredSupportRoles.length !== 0 ||
       (group.sourceSchemas?.length ?? 0) !== 0 ||
       Object.keys(group.optionBindings ?? {}).length !== 0 ||
       Object.keys(group.runtimeOptionOverrides ?? {}).length !== 0 ||
       ("componentConfig" in group && group.componentConfig != null) ||
       component.tableFormat !== undefined || component.adaptedResultKind !== undefined ||
       component.limitations.length === 0)) {
    throw new Error(`malformed outside-freeze component registration: ${group.adapterId}`);
  }
  for (const schema of group.sourceSchemas ?? []) {
    if (
      !groupIds.has(schema.methodSettingId) ||
      sourceSchemaBySettingId.has(schema.methodSettingId)
    ) {
      throw new Error(
        `invalid literature source-schema registration: ${schema.methodSettingId}`,
      );
    }
    if (
      !/^[0-9a-f]{64}$/.test(schema.sourceValueSha256) ||
      (schema.sourceExact !== undefined && typeof schema.sourceExact !== "boolean") ||
      (schema.kind === "event_type" &&
        (schema.canonicalField !== "interaction_type" ||
          (schema.eventMatches?.length
            ? schema.eventMatches.length !== 2 ||
              schema.framingPolicy !== "strict_two_token_complete_frames" ||
              new Set(schema.eventMatches.map((entry) => entry.sourceMatchValue))
                .size !== schema.eventMatches.length ||
              new Set(schema.eventMatches.map((entry) => entry.frameRole)).size !== 2 ||
              schema.eventMatches.some(
                (entry) =>
                  !entry.sourceMatchValue ||
                  !entry.canonicalValue ||
                  !entry.frameRole,
              )
            : !schema.canonicalValue))) ||
      (schema.kind === "field_alias" &&
        (!schema.canonicalField || schema.canonicalValue !== undefined)) ||
      (schema.kind === "field_passthrough" &&
        (schema.canonicalField !== undefined || schema.canonicalValue !== undefined)) ||
      (schema.kind === "scope_guard" &&
        (schema.canonicalField !== undefined ||
          schema.canonicalValue !== "foreground"))
    ) {
      throw new Error(
        `malformed literature source-schema registration: ${schema.methodSettingId}`,
      );
    }
    sourceSchemaBySettingId.set(schema.methodSettingId, schema);
  }
  for (const settingId of group.methodSettingIds) {
    if (bySettingId.has(settingId))
      throw new Error(
        `duplicate literature input adapter registration: ${settingId}`,
      );
    bySettingId.set(settingId, group);
    if (component) componentBySettingId.set(settingId, component);
  }
}
if (bySettingId.size !== 825)
  throw new Error(
    `literature input adapter contract must register exactly 825 settings, got ${bySettingId.size}`,
  );
for (const component of new Set(componentBySettingId.values())) {
  if (component.methodSettingIds.some((settingId) => !bySettingId.has(settingId))) {
    throw new Error(`unregistered literature component dependency: ${component.componentId}`);
  }
}
if (sourceSchemaBySettingId.size !== 18)
  throw new Error(
    `literature source-schema contract must register exactly 18 settings, got ${sourceSchemaBySettingId.size}`,
  );

export const LITERATURE_INPUT_ADAPTER_CONTRACTS = groups;

export function literatureInputAdapterForSetting(
  settingId: string,
): LiteratureInputAdapterContract | undefined {
  return bySettingId.get(settingId);
}

export function literatureSourceSchemaForSetting(
  settingId: string,
): LiteratureSourceSchemaContract | undefined {
  return sourceSchemaBySettingId.get(settingId);
}

export function browserSupportFileKeyForRole(
  role: string,
): keyof BrowserSupportFiles | undefined {
  return supportFileKeyByRole.get(role);
}

/** Resolve every distinct registered component whose complete setting set is present. */
export function literatureComponentExecutionsForSettings(
  settingIds: readonly string[],
): RegisteredLiteratureComponentExecution[] {
  const selected = new Set(settingIds);
  const components = new Map<string, RegisteredLiteratureComponentExecution>();
  for (const settingId of settingIds) {
    const component = componentBySettingId.get(settingId);
    if (component) components.set(component.componentId, component);
  }
  return [...components.values()].filter((component) =>
    component.methodSettingIds.every((settingId) => selected.has(settingId)),
  );
}

/** Preserve the original single-component resolver for existing callers. */
export function literatureComponentExecutionForSettings(
  settingIds: readonly string[],
): RegisteredLiteratureComponentExecution | undefined {
  const components = literatureComponentExecutionsForSettings(settingIds);
  const exact = components.filter((component) => component.methodSettingIds.length === new Set(settingIds).size);
  if (exact.length === 1) return exact[0];
  const candidateComponentIds = new Set(settingIds.flatMap((settingId) => {
    const component = componentBySettingId.get(settingId);
    return component ? [component.componentId] : [];
  }));
  if (candidateComponentIds.size !== 1) return undefined;
  return components.length === 1 ? components[0] : undefined;
}

export function methodReceiptUsesInputCapabilityEvidence(
  settingIds: readonly string[],
): boolean {
  return methodReceiptUsesInputRole(
    settingIds,
    "input_capability_evidence_file",
  );
}

export function methodReceiptUsesAnalysisFeatureMatrix(
  settingIds: readonly string[],
): boolean {
  return methodReceiptUsesInputRole(settingIds, "analysis_feature_matrix_file");
}

export function methodReceiptUsesCallSmsEligibility(
  settingIds: readonly string[],
): boolean {
  return methodReceiptUsesInputRole(settingIds, "call_sms_eligibility_file");
}

function methodReceiptUsesInputRole(
  settingIds: readonly string[],
  role: string,
): boolean {
  return settingIds.some((settingId) => (
      bySettingId.get(settingId)?.inputRole === role ||
      bySettingId.get(settingId)?.requiredSupportRoles?.includes(role) ===
        true
  )) || literatureComponentExecutionsForSettings(settingIds).some(
    (component) => component.requiredSupportRoles.includes(role),
  );
}

export function methodReceiptUsesPhoneStudyPsCommunication(
  settingIds: readonly string[],
): boolean {
  return methodReceiptUsesInputRole(
    settingIds,
    "phonestudy_ps_communication_file",
  );
}

export function methodReceiptUsesPhoneStudyEs(
  settingIds: readonly string[],
): boolean {
  return methodReceiptUsesInputRole(settingIds, "phonestudy_es_file");
}

export function methodReceiptUsesAnchorEvents(
  settingIds: readonly string[],
): boolean {
  return methodReceiptUsesInputRole(settingIds, "anchor_events_file");
}
