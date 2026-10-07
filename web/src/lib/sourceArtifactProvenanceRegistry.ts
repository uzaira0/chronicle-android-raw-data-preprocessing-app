import registryJson from "@/generated/source-artifact-provenance-registry.json" with { type: "json" };
import androidRegistryJson from "@/generated/android-method-profile-runtime-registry.json" with { type: "json" };
import { canonicalJson } from "@/lib/canonicalJson";

type JsonObject = Record<string, unknown>;

export type RegistryRow = {
  method_setting_id: string;
  source_work_id: string;
  source_extraction_id: string;
  source_value_sha256: string;
  source_artifact_provenance: JsonObject;
  source_artifact_provenance_object_digest: string;
  provenance_keys: string[];
  candidate_status: string;
};

type RegistryFixture = {
  fixture_id: string;
  method_setting_id: string;
  input: unknown;
  case_digest: string;
  expected_result: SourceArtifactRegistryResult;
  result_digest: string;
};

type RegistryArtifact = {
  schema_version: string;
  source_packet: {
    batch_id: string;
    canonical_ledger_row_count: number;
    selected_immutable_source_projection_sha256: string;
    packet_manifest_sha256: string;
    imported_candidate_count: number;
    receipt_ready_count: number;
    blocked_method_setting_ids: string[];
  };
  profile_identities: SourceArtifactProfileIdentity[];
  rows: RegistryRow[];
  positive_fixtures: RegistryFixture[];
  negative_fixtures: RegistryFixture[];
  content_digest: string;
};

type ProtocolDocumentaryRegistryBinding = {
  setting_id: string;
  registry_input: JsonObject;
  registry_input_sha256: string;
  conformance_fixture_id: string;
  conformance_result_digest: string;
  execution_eligible: false;
};

type RegistryOutputBinding = {
  setting_id: string;
  output_kind: "app-csv" | "screen-csv";
  source_field: string;
  source_position: number;
  canonical_field: string;
  conformance_fixture_id: string;
  conformance_result_digest: string;
};

export type AndroidMethodProfileRegisteredComponent = {
  component_id: string;
  setting_ids: string[];
  input_role: string;
  required_support_roles: string[];
  limitations: string[];
  source_oracle_id: string;
  parent_method_profile_id: string;
  source_work_id: string;
  source_method_variant_id: string;
  method_profile_version: string;
  full_profile_execution_status: string;
};

type AndroidRegistryArtifact = {
  profiles: Array<SourceArtifactProfileIdentity & {
    registered_components?: AndroidMethodProfileRegisteredComponent[];
    runtime_setting_ids: string[];
    full_profile_blocked_reason: string | null;
    completed_configurations: Array<{
      selected_level_ids: string[];
      selected_combination_id?: string;
      execution_eligible: boolean;
    }>;
    protocol_documentary_bindings: ProtocolDocumentaryRegistryBinding[];
    typed_sections: Record<string, string>;
    output_bindings?: RegistryOutputBinding[];
  }>;
};

export type SourceArtifactProfileIdentity = {
  method_profile_id: string;
  source_work_id: string;
  source_method_variant_id: string;
  method_profile_version: string;
};

export type SourceArtifactRegistryResult = {
  accepted: boolean;
  registryStatus: string;
  errorCode?: string;
  methodSettingId?: string;
  sourceArtifactProvenanceId?: string;
  assertionDigest?: string;
  artifactContentsAvailable: boolean;
  contentDigestVerified: boolean;
  executionEligible: false;
  browserRoundtripAssertion?: JsonObject;
};

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};
const artifact = deepFreeze(registryJson) as unknown as RegistryArtifact;
const androidArtifact = deepFreeze(androidRegistryJson) as unknown as AndroidRegistryArtifact;
const androidProfileKey = (profile: SourceArtifactProfileIdentity): string => [
  profile.method_profile_id,
  profile.source_work_id,
  profile.source_method_variant_id,
  profile.method_profile_version,
].join("\0");
const androidProfiles = new Map(androidArtifact.profiles.map((profile) => [androidProfileKey(profile), profile]));
const androidProfilesByWork = new Map(androidArtifact.profiles.map((profile) => [profile.source_work_id, profile]));

export function androidMethodProfileRegisteredComponents(
  identity: SourceArtifactProfileIdentity,
): readonly AndroidMethodProfileRegisteredComponent[] {
  return androidProfiles.get(androidProfileKey(identity))?.registered_components ?? [];
}

export function androidMethodProfileFullBlockedReason(
  identity: SourceArtifactProfileIdentity,
): string | null {
  return androidProfiles.get(androidProfileKey(identity))?.full_profile_blocked_reason ?? null;
}

export function androidMethodProfileConfigurationIsExecutionEligible(receipt: {
  methodProfileId: string;
  sourceWorkId: string;
  sourceMethodVariantId: string;
  sourceMethodVariantIds: string[];
  sourceMethodCombinationId?: string;
  methodProfileVersion: string;
}): boolean {
  const profile = androidProfiles.get(androidProfileKey({
    method_profile_id: receipt.methodProfileId,
    source_work_id: receipt.sourceWorkId,
    source_method_variant_id: receipt.sourceMethodVariantId,
    method_profile_version: receipt.methodProfileVersion,
  }));
  if (!profile) return false;
  const selected = [...receipt.sourceMethodVariantIds].sort();
  return profile.completed_configurations.some((configuration) =>
    configuration.execution_eligible
    && configuration.selected_combination_id === receipt.sourceMethodCombinationId
    && JSON.stringify([...configuration.selected_level_ids].sort()) === JSON.stringify(selected));
}
const rows = new Map(artifact.rows.map((row) => [row.method_setting_id, row]));
const protocolDocumentaryBindings = new Map<string, {
  binding: ProtocolDocumentaryRegistryBinding;
  profile: SourceArtifactProfileIdentity;
}>();
for (const profile of androidArtifact.profiles) {
  for (const binding of profile.protocol_documentary_bindings) {
    if (protocolDocumentaryBindings.has(binding.setting_id)) throw new Error(`duplicate profile-protocol documentary setting: ${binding.setting_id}`);
    protocolDocumentaryBindings.set(binding.setting_id, { binding, profile });
  }
}
const expectedProfileIdentities: SourceArtifactProfileIdentity[] = [
  { method_profile_id: "method-profile:doi:10.1016/j.chb.2023.107977", source_work_id: "doi:10.1016/j.chb.2023.107977", source_method_variant_id: "source-configuration-space-8b14e63d69954819163df993", method_profile_version: "literature-sublation-v3-atomic" },
  { method_profile_id: "method-profile:doi:10.1080/15213269.2020.1768122", source_work_id: "doi:10.1080/15213269.2020.1768122", source_method_variant_id: "source-configuration-space-9a5dfdec15e1a632fd9a13f4", method_profile_version: "literature-sublation-v3-atomic" },
  { method_profile_id: "method-profile:doi:10.1177/00936502241276793", source_work_id: "doi:10.1177/00936502241276793", source_method_variant_id: "source-configuration-space-e9ce7cff19d18e050e47a180", method_profile_version: "literature-sublation-v3-atomic" },
];
const profileIdentities = new Map(artifact.profile_identities.map((identity) => [identity.source_work_id, identity]));
const inputKeys = [
  "method_setting_id",
  "operation",
  "public_contract_version",
  "source_artifact_provenance",
  "source_artifact_provenance_object_digest",
  "source_extraction_id",
  "source_value_sha256",
  "source_work_id",
].sort();

const isObject = (value: unknown): value is JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: unknown, expected: readonly string[]): value is JsonObject =>
  isObject(value) && Object.keys(value).sort().join("\0") === expected.join("\0");
const outputBindingKeys = [
  "canonical_field",
  "conformance_fixture_id",
  "conformance_result_digest",
  "output_kind",
  "setting_id",
  "source_field",
  "source_position",
].sort();

export type MethodProfileOutputBinding = {
  settingId: string;
  outputKind: "app-csv" | "screen-csv";
  sourceField: string;
  sourcePosition: number;
  canonicalField: string;
  conformanceFixtureId: string;
  conformanceResultDigest: string;
};

const outputBindings = new Map<string, {
  binding: MethodProfileOutputBinding;
  profile: SourceArtifactProfileIdentity;
}>();
for (const profile of androidArtifact.profiles) {
  for (const binding of profile.output_bindings ?? []) {
    if (!exactKeys(binding, outputBindingKeys)
      || typeof binding.setting_id !== "string" || !binding.setting_id
      || (binding.output_kind !== "app-csv" && binding.output_kind !== "screen-csv")
      || typeof binding.source_field !== "string" || !binding.source_field
      || !Number.isSafeInteger(binding.source_position) || binding.source_position < 0
      || typeof binding.canonical_field !== "string" || !binding.canonical_field
      || typeof binding.conformance_fixture_id !== "string" || !binding.conformance_fixture_id
      || typeof binding.conformance_result_digest !== "string"
      || !/^sha256:[0-9a-f]{64}$/.test(binding.conformance_result_digest)
      || outputBindings.has(binding.setting_id)) {
      throw new Error(`invalid or duplicate method-profile output binding: ${String(binding.setting_id)}`);
    }
    outputBindings.set(binding.setting_id, {
      binding: {
        settingId: binding.setting_id,
        outputKind: binding.output_kind,
        sourceField: binding.source_field,
        sourcePosition: binding.source_position,
        canonicalField: binding.canonical_field,
        conformanceFixtureId: binding.conformance_fixture_id,
        conformanceResultDigest: binding.conformance_result_digest,
      },
      profile,
    });
  }
}
const reject = (errorCode: string): SourceArtifactRegistryResult => ({
  accepted: false,
  registryStatus: "rejected",
  errorCode,
  artifactContentsAvailable: false,
  contentDigestVerified: false,
  executionEligible: false,
});

export async function sourceArtifactProvenanceJcsDigest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

export async function validateSourceArtifactProvenanceRegistry(): Promise<void> {
  const { content_digest: expectedDigest, ...payload } = artifact;
  if (
    artifact.schema_version !==
      "chronicle-source-artifact-provenance-closed-registry/v2" ||
    await sourceArtifactProvenanceJcsDigest(payload) !== expectedDigest ||
    artifact.source_packet.batch_id !==
      "source-artifact-provenance-receipt-batch-1" ||
    artifact.source_packet.canonical_ledger_row_count !== 1806 ||
    artifact.source_packet.selected_immutable_source_projection_sha256 !==
      "sha256:acc53ad3dc930ed7e3d7a3c620e7a42c7132b36f34c8966dbe4efce4ffebe297" ||
    artifact.source_packet.packet_manifest_sha256 !==
      "sha256:54fe6f58398f34e66377950dfc53ba37f1225f3b7ee6255f48c22f69fdc1c10e" ||
    artifact.source_packet.imported_candidate_count !== 19 ||
    artifact.source_packet.receipt_ready_count !== 18 ||
    artifact.positive_fixtures.length !== 19 ||
    artifact.negative_fixtures.length !== 11 ||
    rows.size !== 19 || profileIdentities.size !== 3 ||
    canonicalJson(artifact.profile_identities) !== canonicalJson(expectedProfileIdentities) ||
    artifact.rows.filter((row) => row.candidate_status === "ready_for_typed_registry")
      .length !== 18 ||
    artifact.rows.filter((row) => row.candidate_status.startsWith("blocked_"))
      .map((row) => row.method_setting_id).join("\0") !==
      "method-setting-ba42e53a2bb684a034aa67e0" ||
    artifact.source_packet.blocked_method_setting_ids.join("\0") !==
      "method-setting-ba42e53a2bb684a034aa67e0"
  ) {
    throw new Error("source-artifact provenance registry content drift");
  }
  for (const row of artifact.rows) {
    if (
      !exactKeys(row.source_artifact_provenance, row.provenance_keys) ||
      row.source_artifact_provenance.source_artifact_provenance_id !==
        `source-artifact-provenance:${row.method_setting_id}` ||
      await sourceArtifactProvenanceJcsDigest(row.source_artifact_provenance) !==
        row.source_artifact_provenance_object_digest
    ) {
      throw new Error(`source-artifact provenance row drift: ${row.method_setting_id}`);
    }
  }
}

const registryReady = validateSourceArtifactProvenanceRegistry();

export type SourceArtifactDocumentaryBinding = {
  settingId: string;
  registryInput: JsonObject;
  conformanceFixtureId: string;
  conformanceResultDigest: string;
  executionEligible: false;
};

export function sourceArtifactProfileIdentityForSetting(settingId: string): SourceArtifactProfileIdentity | undefined {
  const row = rows.get(settingId);
  const profile = row ? androidProfilesByWork.get(row.source_work_id) : undefined;
  return profile?.runtime_setting_ids.includes(settingId) ? profile : undefined;
}

export function sourceArtifactProvenanceAssertionForSetting(settingId: string): (RegistryRow & {
  conformance_fixture_id: string;
  conformance_result_digest: string;
  execution_eligibility: "documentary_only";
}) | undefined {
  const row = rows.get(settingId);
  const fixture = artifact.positive_fixtures.find((candidate) => candidate.method_setting_id === settingId);
  if (!row || !fixture || row.candidate_status !== "ready_for_typed_registry") return undefined;
  return {
    ...row,
    conformance_fixture_id: fixture.fixture_id,
    conformance_result_digest: fixture.result_digest,
    execution_eligibility: "documentary_only",
  };
}

export function sourceArtifactDocumentaryBindingForSetting(settingId: string): SourceArtifactDocumentaryBinding | undefined {
  const row = rows.get(settingId);
  const fixture = artifact.positive_fixtures.find((candidate) => candidate.method_setting_id === settingId);
  if (!row || !fixture || row.candidate_status !== "ready_for_typed_registry" || !isObject(fixture.input)) return undefined;
  return {
    settingId,
    registryInput: fixture.input,
    conformanceFixtureId: fixture.fixture_id,
    conformanceResultDigest: fixture.result_digest,
    executionEligible: false,
  };
}

export function profileProtocolDocumentaryBindingForSetting(settingId: string): SourceArtifactDocumentaryBinding | undefined {
  const registered = protocolDocumentaryBindings.get(settingId)?.binding;
  return registered ? {
    settingId,
    registryInput: registered.registry_input,
    conformanceFixtureId: registered.conformance_fixture_id,
    conformanceResultDigest: registered.conformance_result_digest,
    executionEligible: false,
  } : undefined;
}

export function profileProtocolProfileIdentityForSetting(settingId: string): SourceArtifactProfileIdentity | undefined {
  return protocolDocumentaryBindings.get(settingId)?.profile;
}

export function methodProfileOutputBindingForSetting(settingId: string): MethodProfileOutputBinding | undefined {
  return outputBindings.get(settingId)?.binding;
}

export function methodProfileOutputBindingProfileIdentityForSetting(settingId: string): SourceArtifactProfileIdentity | undefined {
  return outputBindings.get(settingId)?.profile;
}

/**
 * The canonical library records each locator under the absolute path of the
 * checkout that produced it; registries and source code keep only the
 * repository-relative remainder, so no machine-specific prefix ships. Each
 * "; "-separated part of a compound locator is reduced independently.
 */
export function repositoryRelativeSourceLocator(locator: string): string {
  const marker = "/chronicle-android-raw-data-preprocessing-app/";
  let normalized = locator;
  for (let markerIndex = normalized.indexOf(marker); markerIndex >= 0; markerIndex = normalized.indexOf(marker)) {
    const separatorIndex = normalized.lastIndexOf("; ", markerIndex);
    const prefixStart = separatorIndex >= 0 ? separatorIndex + 2 : 0;
    normalized = normalized.slice(0, prefixStart) + normalized.slice(markerIndex + marker.length);
  }
  return normalized;
}

export function methodProfileTypedSectionMatchesRegistry(
  profile: SourceArtifactProfileIdentity,
  section: string,
  value: unknown,
  methodSettings: readonly unknown[],
): boolean {
  const registered = androidProfiles.get(androidProfileKey(profile))?.typed_sections?.[section];
  if (registered === undefined) return false;
  const canonicalSettings = new Map<string, unknown>();
  for (const candidate of methodSettings) {
    if (!isObject(candidate) || typeof candidate.method_setting_id !== "string"
      || canonicalSettings.has(candidate.method_setting_id)) return false;
    canonicalSettings.set(candidate.method_setting_id, candidate);
  }
  const project = (candidate: unknown): unknown => {
    if (!isObject(candidate)) return candidate;
    const projected = { ...candidate };
    if (Array.isArray(projected.source_locators)) {
      const locators: unknown[] = projected.source_locators;
      projected.source_locators = locators.map((locator): unknown =>
        typeof locator === "string" ? repositoryRelativeSourceLocator(locator) : locator);
    }
    if (projected.method_settings !== undefined) {
      if (!Array.isArray(projected.method_settings)) return undefined;
      const ids: string[] = [];
      for (const nested of projected.method_settings) {
        if (!isObject(nested) || typeof nested.method_setting_id !== "string"
          || canonicalJson(nested) !== canonicalJson(canonicalSettings.get(nested.method_setting_id))) return undefined;
        ids.push(nested.method_setting_id);
      }
      projected.method_settings = ids;
    }
    return projected;
  };
  const projected = Array.isArray(value) ? value.map(project) : project(value);
  if (projected === undefined || (Array.isArray(projected) && projected.some((candidate) => candidate === undefined))) return false;
  return canonicalJson(projected) === registered;
}

const matchesProfileIdentity = (
  receipt: { methodProfileId: string; sourceWorkId: string; sourceMethodVariantId: string; methodProfileVersion: string },
  profile: SourceArtifactProfileIdentity,
): boolean => receipt.methodProfileId === profile.method_profile_id
  && receipt.sourceWorkId === profile.source_work_id
  && receipt.sourceMethodVariantId === profile.source_method_variant_id
  && receipt.methodProfileVersion === profile.method_profile_version;

export function methodProfileOutputBindingsForReceipt(
  receiptIdentity: { methodProfileId: string; sourceWorkId: string; sourceMethodVariantId: string; methodProfileVersion: string },
  settingIds: readonly string[],
): MethodProfileOutputBinding[] | undefined {
  const expected: MethodProfileOutputBinding[] = [];
  for (const settingId of settingIds) {
    const registered = outputBindings.get(settingId);
    if (!registered) continue;
    if (!matchesProfileIdentity(receiptIdentity, registered.profile)) return undefined;
    expected.push(registered.binding);
  }
  return expected.sort((left, right) => left.sourcePosition - right.sourcePosition
    || left.outputKind.localeCompare(right.outputKind)
    || left.settingId.localeCompare(right.settingId));
}

export function validateMethodProfileOutputBindings(
  value: unknown,
  receiptIdentity: { methodProfileId: string; sourceWorkId: string; sourceMethodVariantId: string; methodProfileVersion: string },
  settingIds: readonly string[],
): value is MethodProfileOutputBinding[] {
  if (!Array.isArray(value)) return false;
  const expected = methodProfileOutputBindingsForReceipt(receiptIdentity, settingIds);
  if (!expected || value.length !== expected.length) return false;
  const bindings: JsonObject[] = [];
  for (const candidate of value as unknown[]) {
    if (!isObject(candidate)) return false;
    bindings.push(candidate);
  }
  const sorted = bindings.sort((left, right) => {
    return Number(left.sourcePosition) - Number(right.sourcePosition)
      || String(left.outputKind).localeCompare(String(right.outputKind))
      || String(left.settingId).localeCompare(String(right.settingId));
  });
  return sorted.every((binding) => exactKeys(binding, [
    "canonicalField", "conformanceFixtureId", "conformanceResultDigest", "outputKind",
    "settingId", "sourceField", "sourcePosition",
  ].sort())) && canonicalJson(sorted) === canonicalJson(expected);
}

function validateSourceArtifactDocumentaryBinding(
  value: unknown,
  receiptIdentity: { methodProfileId: string; sourceWorkId: string; sourceMethodVariantId: string; methodProfileVersion: string },
): value is SourceArtifactDocumentaryBinding {
  if (!exactKeys(value, ["conformanceFixtureId", "conformanceResultDigest", "executionEligible", "registryInput", "settingId"])) return false;
  if (typeof value.settingId !== "string" || value.executionEligible !== false) return false;
  const expected = sourceArtifactDocumentaryBindingForSetting(value.settingId);
  const profile = sourceArtifactProfileIdentityForSetting(value.settingId);
  return expected !== undefined && profile !== undefined
    && receiptIdentity.methodProfileId === profile.method_profile_id
    && receiptIdentity.sourceWorkId === profile.source_work_id
    && receiptIdentity.sourceMethodVariantId === profile.source_method_variant_id
    && receiptIdentity.methodProfileVersion === profile.method_profile_version
    && canonicalJson(value) === canonicalJson(expected);
}

export function validateMethodProfileDocumentaryBinding(
  value: unknown,
  receiptIdentity: { methodProfileId: string; sourceWorkId: string; sourceMethodVariantId: string; methodProfileVersion: string },
): value is SourceArtifactDocumentaryBinding {
  if (validateSourceArtifactDocumentaryBinding(value, receiptIdentity)) return true;
  if (!exactKeys(value, ["conformanceFixtureId", "conformanceResultDigest", "executionEligible", "registryInput", "settingId"])
    || typeof value.settingId !== "string" || value.executionEligible !== false) return false;
  const expected = profileProtocolDocumentaryBindingForSetting(value.settingId);
  const profile = profileProtocolProfileIdentityForSetting(value.settingId);
  return expected !== undefined && profile !== undefined
    && receiptIdentity.methodProfileId === profile.method_profile_id
    && receiptIdentity.sourceWorkId === profile.source_work_id
    && receiptIdentity.sourceMethodVariantId === profile.source_method_variant_id
    && receiptIdentity.methodProfileVersion === profile.method_profile_version
    && canonicalJson(value) === canonicalJson(expected);
}

export async function registerSourceArtifactProvenance(
  input: unknown,
): Promise<SourceArtifactRegistryResult> {
  try {
    await registryReady;
  } catch {
    return reject("registry_artifact_invalid");
  }
  if (!exactKeys(input, inputKeys)) return reject("invalid_input_keys");
  if (
    input.operation !== "register_source_artifact_provenance" ||
    input.public_contract_version !== "source-artifact-provenance-registry/v1"
  ) {
    return reject("unsupported_contract_operation");
  }
  const settingId = input.method_setting_id;
  if (typeof settingId !== "string") return reject("unknown_setting_id");
  const registered = rows.get(settingId);
  if (!registered) return reject("unknown_setting_id");
  if (input.source_work_id !== registered.source_work_id) {
    return reject("source_work_identity_mismatch");
  }
  if (input.source_extraction_id !== registered.source_extraction_id) {
    return reject("source_extraction_identity_mismatch");
  }
  if (input.source_value_sha256 !== registered.source_value_sha256) {
    return reject("source_value_digest_mismatch");
  }
  if (!exactKeys(input.source_artifact_provenance, registered.provenance_keys)) {
    return reject("invalid_provenance_keys");
  }
  if (
    input.source_artifact_provenance.source_artifact_provenance_id !==
      `source-artifact-provenance:${settingId}`
  ) {
    return reject("provenance_setting_identity_mismatch");
  }
  const computedDigest = await sourceArtifactProvenanceJcsDigest(
    input.source_artifact_provenance,
  );
  if (input.source_artifact_provenance_object_digest !== computedDigest) {
    return reject("provenance_digest_mismatch");
  }
  if (computedDigest !== registered.source_artifact_provenance_object_digest) {
    return reject("unregistered_provenance_object");
  }
  if (registered.candidate_status.startsWith("blocked_")) {
    return reject(registered.candidate_status);
  }
  const contentsAvailable = Object.hasOwn(
    input.source_artifact_provenance,
    "locally_validated_artifact_digest",
  );
  return {
    accepted: true,
    registryStatus: "registered_documentary_provenance",
    methodSettingId: settingId,
    sourceArtifactProvenanceId:
      input.source_artifact_provenance.source_artifact_provenance_id,
    assertionDigest: computedDigest,
    artifactContentsAvailable: contentsAvailable,
    contentDigestVerified: contentsAvailable,
    executionEligible: false,
    browserRoundtripAssertion: input.source_artifact_provenance,
  };
}
