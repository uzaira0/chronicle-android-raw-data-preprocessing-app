/**
 * Method-profile receipt validation against the shipped registries (the
 * Android method-profile runtime registry, the source-artifact provenance
 * registry, the literature input-adapter contract, the external-executor
 * registry and the sleep-diary bridge). Those registries are large packed
 * assets, so this module is loaded on demand through
 * `loadMethodReceiptValidation()` in settingsPersistence and never sits on the
 * first-paint path of a browser that holds no receipt.
 */
import {
  literatureInputAdapterForSetting,
  literatureSourceSchemaForSetting,
  methodReceiptUsesAnalysisFeatureMatrix,
  methodReceiptUsesAnchorEvents,
  methodReceiptUsesCallSmsEligibility,
  methodReceiptUsesInputCapabilityEvidence,
  methodReceiptUsesPhoneStudyEs,
  methodReceiptUsesPhoneStudyPsCommunication,
} from "@/lib/literatureInputAdapters";
import { validateLiteratureExternalExecutionBinding } from "@/lib/literatureExternalExecutors";
import {
  androidMethodProfileConfigurationIsExecutionEligible,
  methodProfileOutputBindingsForReceipt,
  validateMethodProfileDocumentaryBinding,
  validateMethodProfileOutputBindings,
} from "@/lib/sourceArtifactProvenanceRegistry";
import {
  sanitizeDiaryReplicationBinding,
  sleepDiaryReceiptIdentityMatches,
} from "@/lib/sleepDiaryReplication";
import type { MethodProfileReceipt, MethodReceiptInputUses } from "@/lib/types";

export function methodReceiptInputUses(settingIds: readonly string[]): MethodReceiptInputUses {
  return {
    inputCapabilityEvidence: methodReceiptUsesInputCapabilityEvidence(settingIds),
    analysisFeatureMatrix: methodReceiptUsesAnalysisFeatureMatrix(settingIds),
    callSmsEligibility: methodReceiptUsesCallSmsEligibility(settingIds),
    phoneStudyPsCommunication: methodReceiptUsesPhoneStudyPsCommunication(settingIds),
    phoneStudyEs: methodReceiptUsesPhoneStudyEs(settingIds),
    anchorEvents: methodReceiptUsesAnchorEvents(settingIds),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateMethodProfileReceiptRecord(value: Record<string, unknown>): MethodProfileReceipt | undefined {
  const allowedKeys = new Set([
    "methodProfileId", "sourceWorkId", "sourceMethodVariantId", "sourceMethodVariantIds", "sourceMethodCombinationId", "methodProfileVersion",
    "settingIds", "bindings", "inputBindings", "outputBindings", "documentaryBindings", "externalBindings", "diaryReplicationBinding",
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return undefined;
  const { methodProfileId, sourceWorkId, sourceMethodVariantId, sourceMethodVariantIds, sourceMethodCombinationId, methodProfileVersion, settingIds, bindings, inputBindings, outputBindings, documentaryBindings, externalBindings, diaryReplicationBinding } = value;
  if (typeof methodProfileId !== "string" || !methodProfileId || typeof sourceWorkId !== "string" || !sourceWorkId || typeof sourceMethodVariantId !== "string" || !sourceMethodVariantId || typeof methodProfileVersion !== "string" || !methodProfileVersion) return undefined;
  if (sourceMethodCombinationId !== undefined && (typeof sourceMethodCombinationId !== "string" || !sourceMethodCombinationId)) return undefined;
  const validSourceMethodVariantIds = Array.isArray(sourceMethodVariantIds)
    ? sourceMethodVariantIds.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : [];
  if (!validSourceMethodVariantIds.length
    || validSourceMethodVariantIds.length !== (sourceMethodVariantIds as unknown[] | undefined)?.length
    || new Set(validSourceMethodVariantIds).size !== validSourceMethodVariantIds.length) return undefined;
  const rawSettingIds: unknown[] = Array.isArray(settingIds) ? settingIds : [];
  const validSettingIds = rawSettingIds.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  const rawBindings: unknown[] = Array.isArray(bindings) ? bindings : [];
  if (!validSettingIds.length || validSettingIds.length !== rawSettingIds.length || new Set(validSettingIds).size !== validSettingIds.length) return undefined;
  const bindingCandidates = rawBindings.map((binding) => {
    if (!isRecord(binding)
      || Object.keys(binding).some((key) => !new Set(["settingId", "slot", "value", "conformanceFixtureId", "conformanceResultDigest"]).has(key))
      || typeof binding.settingId !== "string" || !binding.settingId
      || typeof binding.slot !== "string" || !binding.slot
      || binding.value === undefined
      || typeof binding.conformanceFixtureId !== "string" || !binding.conformanceFixtureId
      || typeof binding.conformanceResultDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(binding.conformanceResultDigest)
    ) return null;
    return {
      settingId: binding.settingId,
      slot: binding.slot,
      value: binding.value,
      conformanceFixtureId: binding.conformanceFixtureId,
      conformanceResultDigest: binding.conformanceResultDigest,
    };
  });
  const parsedBindings = bindingCandidates.filter((binding) => binding !== null);
  if (parsedBindings.length !== bindingCandidates.length) return undefined;
  const rawInputBindings: unknown[] = Array.isArray(inputBindings) ? inputBindings : [];
  const inputBindingCandidates = rawInputBindings.map((binding) => {
    const allowedInputBindingKeys = new Set([
      "settingId", "routeKind", "inputRole", "schemaId", "adapterId", "adapterVersion",
      "requiredFields", "sourceValue", "sourceWorkId", "sourceValueSha256", "sourceSchema",
      "conformanceFixtureId", "conformanceResultDigest",
    ]);
    if (!isRecord(binding)
      || Object.keys(binding).some((key) => !allowedInputBindingKeys.has(key))
      || typeof binding.settingId !== "string" || !binding.settingId
      || (binding.routeKind !== "protocol_input" && binding.routeKind !== "native_operator_parameter")
      || typeof binding.inputRole !== "string" || !binding.inputRole
      || typeof binding.schemaId !== "string" || !binding.schemaId
      || typeof binding.adapterId !== "string" || !binding.adapterId
      || typeof binding.adapterVersion !== "string" || !binding.adapterVersion
      || !Array.isArray(binding.requiredFields) || binding.requiredFields.some((field) => typeof field !== "string" || !field)
      || binding.sourceValue === undefined
      || typeof binding.conformanceFixtureId !== "string" || !binding.conformanceFixtureId
      || typeof binding.conformanceResultDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(binding.conformanceResultDigest)
    ) return null;
    const adapter = literatureInputAdapterForSetting(binding.settingId);
    const sourceSchema = literatureSourceSchemaForSetting(binding.settingId);
    if (!adapter
      || binding.routeKind !== adapter.routeKind
      || binding.inputRole !== adapter.inputRole
      || binding.schemaId !== adapter.schemaId
      || binding.adapterId !== adapter.adapterId
      || binding.adapterVersion !== adapter.adapterVersion
      || JSON.stringify(binding.requiredFields) !== JSON.stringify(adapter.requiredFields)
      || (sourceSchema
        ? binding.sourceWorkId !== sourceSchema.sourceWorkId
          || sourceWorkId !== sourceSchema.sourceWorkId
          || binding.sourceValue !== sourceSchema.sourceValue
          || binding.sourceValueSha256 !== sourceSchema.sourceValueSha256
          || JSON.stringify(binding.sourceSchema) !== JSON.stringify(sourceSchema)
        : binding.sourceWorkId !== undefined || binding.sourceValueSha256 !== undefined || binding.sourceSchema !== undefined)
    ) return null;
    return {
      settingId: binding.settingId,
      routeKind: binding.routeKind,
      inputRole: binding.inputRole,
      schemaId: binding.schemaId,
      adapterId: binding.adapterId,
      adapterVersion: binding.adapterVersion,
      requiredFields: binding.requiredFields as string[],
      sourceValue: binding.sourceValue,
      ...(sourceSchema ? {
        sourceWorkId: sourceSchema.sourceWorkId,
        sourceValueSha256: sourceSchema.sourceValueSha256,
        sourceSchema,
      } : {}),
      conformanceFixtureId: binding.conformanceFixtureId,
      conformanceResultDigest: binding.conformanceResultDigest,
    };
  });
  const parsedInputBindings = inputBindingCandidates.filter((binding) => binding !== null);
  if (parsedInputBindings.length !== inputBindingCandidates.length) return undefined;
  const rawDocumentaryBindings: unknown[] = Array.isArray(documentaryBindings) ? documentaryBindings : [];
  if (documentaryBindings !== undefined && !Array.isArray(documentaryBindings)) return undefined;
  const receiptIdentity = { methodProfileId, sourceWorkId, sourceMethodVariantId, methodProfileVersion };
  const rawOutputBindings: unknown[] = Array.isArray(outputBindings) ? outputBindings : [];
  if ((outputBindings !== undefined && !Array.isArray(outputBindings))
    || !validateMethodProfileOutputBindings(rawOutputBindings, receiptIdentity, validSettingIds)) return undefined;
  const parsedOutputBindings = methodProfileOutputBindingsForReceipt(receiptIdentity, validSettingIds);
  if (!parsedOutputBindings) return undefined;
  if (rawDocumentaryBindings.some((binding) => !validateMethodProfileDocumentaryBinding(binding, receiptIdentity))) return undefined;
  const parsedDocumentaryBindings = rawDocumentaryBindings as NonNullable<MethodProfileReceipt["documentaryBindings"]>;
  const rawExternalBindings: unknown[] = Array.isArray(externalBindings) ? externalBindings : [];
  const externalIdentity = {
    methodProfileId,
    sourceWorkId,
    sourceMethodVariantId,
    sourceMethodVariantIds: validSourceMethodVariantIds,
    methodProfileVersion,
  };
  if ((externalBindings !== undefined && !Array.isArray(externalBindings))
    || rawExternalBindings.length > 1
    || rawExternalBindings.some((binding) => !validateLiteratureExternalExecutionBinding(externalIdentity, binding))) return undefined;
  const parsedExternalBindings = rawExternalBindings as NonNullable<MethodProfileReceipt["externalBindings"]>;
  const parsedDiaryBinding = diaryReplicationBinding === undefined
    ? undefined
    : sanitizeDiaryReplicationBinding(diaryReplicationBinding);
  if (diaryReplicationBinding !== undefined && !parsedDiaryBinding) return undefined;
  if (parsedDiaryBinding && !sleepDiaryReceiptIdentityMatches(
    methodProfileId, sourceWorkId, sourceMethodVariantId, methodProfileVersion, parsedDiaryBinding,
  )) return undefined;
  if (parsedDiaryBinding && (sourceMethodCombinationId !== undefined
    || validSourceMethodVariantIds.length !== 1
    || validSourceMethodVariantIds[0] !== sourceMethodVariantId)) return undefined;
  if (!parsedDiaryBinding && methodProfileId.startsWith("method-profile:")
    && !androidMethodProfileConfigurationIsExecutionEligible({
      methodProfileId,
      sourceWorkId,
      sourceMethodVariantId,
      sourceMethodVariantIds: validSourceMethodVariantIds,
      ...(sourceMethodCombinationId ? { sourceMethodCombinationId } : {}),
      methodProfileVersion,
    })) return undefined;
  const bindingIds = new Set([
    ...parsedBindings.map((binding) => binding.settingId),
    ...parsedInputBindings.map((binding) => binding.settingId),
    ...parsedOutputBindings.map((binding) => binding.settingId),
    ...parsedDocumentaryBindings.map((binding) => binding.settingId),
    ...parsedExternalBindings.flatMap((binding) => binding.settingIds),
    ...(parsedDiaryBinding ? [parsedDiaryBinding.settingId] : []),
  ]);
  if (bindingIds.size !== validSettingIds.length || validSettingIds.some((id) => !bindingIds.has(id))) return undefined;
  return {
    methodProfileId,
    sourceWorkId,
    sourceMethodVariantId,
    sourceMethodVariantIds: validSourceMethodVariantIds,
    ...(sourceMethodCombinationId ? { sourceMethodCombinationId } : {}),
    methodProfileVersion,
    settingIds: validSettingIds,
    bindings: parsedBindings,
    ...(parsedInputBindings.length
      ? { inputBindings: parsedInputBindings as NonNullable<MethodProfileReceipt["inputBindings"]> }
      : {}),
    ...(parsedOutputBindings.length ? { outputBindings: parsedOutputBindings } : {}),
    ...(parsedDocumentaryBindings.length ? { documentaryBindings: parsedDocumentaryBindings } : {}),
    ...(parsedExternalBindings.length ? { externalBindings: parsedExternalBindings } : {}),
    ...(parsedDiaryBinding ? { diaryReplicationBinding: parsedDiaryBinding } : {}),
  };
}
