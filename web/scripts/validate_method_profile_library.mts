import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import process from "node:process";

import {
  compileNativeMethodProfileCampaign,
  compileNativeMethodProfile,
  enumerateMethodConfigurations,
  parseStudyMethodProfileLibrary,
  selectMethodConfiguration,
} from "../src/lib/methodProfiles";

const args = process.argv.slice(2);
const optionValues = (name: string): string[] => args.flatMap((argument, index) =>
  argument === name && args[index + 1] ? [args[index + 1]!] : []);
const outputValues = optionValues("--output");
if (args.includes("--output") && outputValues.length !== 1) throw new Error("--output requires exactly one file path");
const outputPath = outputValues.length ? resolve(outputValues[0]!) : undefined;
const sourceWorkIds = optionValues("--source-work");
const profileIds = optionValues("--profile-id");
for (const [name, values] of [["--source-work", sourceWorkIds], ["--profile-id", profileIds]] as const) {
  if (args.filter((argument) => argument === name).length !== values.length) throw new Error(`${name} requires a value`);
  if (new Set(values).size !== values.length) throw new Error(`${name} values must be unique`);
}
const optionValueIndexes = new Set(args.flatMap((argument, index) =>
  ["--output", "--source-work", "--profile-id"].includes(argument) ? [index + 1] : []));
const path = resolve(args.find((argument, index) => !argument.startsWith("--") && !optionValueIndexes.has(index))
  ?? "../.tmp-literature-review-private/ontology-sublation-20260831/adjudicated-method-profile-library.json");
const libraryBytes = readFileSync(path);
const library = parseStudyMethodProfileLibrary(JSON.parse(libraryBytes.toString("utf8")) as unknown);
const selected = library.profiles.filter((profile) =>
  (!sourceWorkIds.length && !profileIds.length)
  || sourceWorkIds.includes(profile.source_work_id)
  || profileIds.includes(profile.method_profile_id));
for (const sourceWorkId of sourceWorkIds) {
  if (!library.profiles.some((profile) => profile.source_work_id === sourceWorkId)) throw new Error(`unknown --source-work: ${sourceWorkId}`);
}
for (const profileId of profileIds) {
  if (!library.profiles.some((profile) => profile.method_profile_id === profileId)) throw new Error(`unknown --profile-id: ${profileId}`);
}
if ((sourceWorkIds.length || profileIds.length) && selected.length !== sourceWorkIds.length + profileIds.length) {
  throw new Error("profile selection resolves the same profile more than once");
}
const ordinaryResults = selected.map((profile) => {
  const selection = selectMethodConfiguration(profile, {});
  return compileNativeMethodProfile(
    profile,
    undefined,
    selection.ok ? selection.selection : undefined,
  );
});
const campaigns = selected.map((profile) => compileNativeMethodProfileCampaign(profile));
const unique = <T,>(values: T[]): T[] => [...new Map(values.map((value) => [JSON.stringify(value), value])).values()];
type Compilation = ReturnType<typeof compileNativeMethodProfile>;
const receiptFor = (compilation: Compilation) => compilation.ok
  ? compilation.receipt
  : compilation.supportedPlan?.receipt;
const receiptSettingPartition = (compilation: Compilation) => {
  const receipt = receiptFor(compilation);
  const evidenceSettingIds = new Set((receipt?.documentaryBindings ?? []).map((binding) => binding.settingId));
  return {
    executableSettingIds: (receipt?.settingIds ?? []).filter((id) => !evidenceSettingIds.has(id)),
    evidenceSettingIds: [...evidenceSettingIds],
  };
};
const results = selected.map((profile, index) => {
  const ordinary = ordinaryResults[index]!;
  const campaign = campaigns[index]!;
  if (ordinary.ok || !campaign.runs.length) {
    const partition = receiptSettingPartition(ordinary);
    return {
      ok: ordinary.ok,
      ...partition,
      blockers: ordinary.ok ? [] : ordinary.blockers,
      readiness: ordinary.readiness,
      legacyBlockers: ordinary.legacyBlockers,
      campaignRuns: [] as typeof campaign.runs,
    };
  }
  const readiness = Object.fromEntries(
    (["configuration", "input", "preprocessing", "downstream", "evidence"] as const).map((dimension) => {
      const blockers = unique(campaign.runs.flatMap(({ compilation }) => compilation.readiness[dimension].blockers));
      return [dimension, {
        status: blockers.length
          ? "blocked"
          : campaign.runs.some(({ compilation }) => compilation.readiness[dimension].status === "ready")
            ? "ready"
            : "not_required",
        blockers,
      }];
    }),
  ) as unknown as typeof ordinary.readiness;
  readiness.disposition = ([
    "refused_missing_signal",
    "unresolved",
    "prerequisite_unmet",
    "preprocessing_reproduced",
    "fully_reproduced",
  ] as const).find((disposition) =>
    campaign.runs.some(({ compilation }) => compilation.readiness.disposition === disposition))!;
  const blockers = unique(campaign.runs.flatMap(({ compilation }) => compilation.ok ? [] : compilation.blockers));
  const partitions = campaign.runs.map(({ compilation }) => receiptSettingPartition(compilation));
  return {
    ok: campaign.ok,
    executableSettingIds: unique(partitions.flatMap((partition) => partition.executableSettingIds)),
    evidenceSettingIds: unique(partitions.flatMap((partition) => partition.evidenceSettingIds)),
    blockers,
    readiness,
    legacyBlockers: unique(campaign.runs.flatMap(({ compilation }) => compilation.legacyBlockers)),
    campaignRuns: campaign.runs,
  };
});
const enumerations = selected.map((profile) => enumerateMethodConfigurations(profile));
const variantResults = selected.flatMap((profile, profileIndex) =>
  campaigns[profileIndex]!.runs.map(({ selection, compilation }) => ({
    profile,
    selection,
    result: compilation,
  })));
const countBy = (values: string[]): Record<string, number> => Object.fromEntries(
  [...new Set(values)].sort().map((value) => [value, values.filter((candidate) => candidate === value).length]),
);
const details = selected.map((profile, index) => {
  const result = results[index]!;
  const blockers = result.blockers;
  return {
    sourceWorkId: profile.source_work_id,
    settingCount: profile.method_settings.length,
    executableSettingIds: result.executableSettingIds,
    evidenceSettingIds: result.evidenceSettingIds,
    campaignRunCount: result.campaignRuns.length,
    settings: profile.method_settings.map((setting) => ({
      settingId: setting.method_setting_id,
      sourceExtractionId: setting.source_extraction_id,
      sourceClauseText: setting.source_clause_text ?? null,
      sourceObservedSetting: setting.source_observed_setting ?? null,
      sourceLocators: setting.source_locators,
      sourceValueSha256: setting.source_value_sha256,
      role: setting.method_setting_role,
      parameter: setting.method_parameter_key,
      targetLayer: setting.method_target_layer,
      valueKind: setting.method_value_kind,
      valueJson: setting.method_value_json,
      unit: setting.method_unit ?? null,
      comparator: setting.method_comparator ?? null,
      boundaryConvention: setting.method_boundary_convention ?? null,
      mappedOntologyTerm: setting.mapped_ontology_term,
      mappedContractSlot: setting.mapped_contract_slot,
      ontologyMappingNote: setting.ontology_mapping_note,
      gapAssessment: setting.gap_assessment ?? null,
      implementation: setting.method_implementation_status,
      route: setting.method_execution_route,
      destination: setting.method_execution_destination_id ?? null,
      parameterPath: setting.method_execution_parameter_path ?? null,
      bindings: setting.contract_bindings,
      fixture: setting.conformance_fixture_id ?? null,
      fixtureDigest: setting.conformance_result_digest ?? null,
      blockers: blockers.filter((blocker) => blocker.settingId === setting.method_setting_id),
    })),
    blockers,
    readiness: result.readiness,
    legacyBlockers: result.legacyBlockers,
  };
});
const legacyBlockers = results.flatMap((result) => result.legacyBlockers);
const variantLegacyBlockers = variantResults.flatMap(({ result }) => result.legacyBlockers);
const readinessDimensions = ["configuration", "input", "preprocessing", "downstream", "evidence"] as const;
const isFullProfileSuccessful = (result: { ok: boolean; readiness: { disposition: string } }): boolean =>
  result.ok && result.readiness.disposition === "fully_reproduced";
const isPreprocessingOnlyDiagnostic = (readiness: (typeof results)[number]["readiness"]): boolean =>
  readiness.disposition === "preprocessing_reproduced";
const preprocessingBlockerCount = (readiness: (typeof results)[number]["readiness"]): number =>
  readiness.configuration.blockers.length + readiness.input.blockers.length + readiness.preprocessing.blockers.length;
const allSettings = selected.flatMap((profile) => profile.method_settings);
const implementationObligationSettings = allSettings.filter((setting) =>
  setting.method_applicability_status !== "not_applicable"
  && !["native", "external_executor"].includes(setting.method_implementation_status)
  && setting.method_execution_route !== "receipt_conformance");
const evidenceProofSettings = allSettings.filter((setting) =>
  setting.method_applicability_status !== "not_applicable"
  && setting.method_execution_route === "receipt_conformance");
const executionIneligibleDocumentaryReceiptSettings = evidenceProofSettings.filter((setting) =>
  setting.method_implementation_status === "native"
  && setting.method_execution_destination_id === "chronicle.profile-protocol-documentary-registry");
const validation = {
  countingSemantics: {
    disclosedMethodAtom: "one source-backed method fact; not necessarily one app control or implementation task",
    blockerReference: "one unmet atom in one compilation; repeated references are not distinct engineering blockers",
    configurationVariant: "one selectable source execution; not an additional method atom",
    executableSetting: "one setting backed by a native input/operator/output binding or registered external execution; documentary receipt bindings are excluded",
    evidenceSetting: "one source fact preserved by an execution-ineligible documentary binding; it is not a claim that the reported scientific result was reproduced",
    implementationObligation: "one applicable non-native/non-external setting outside the evidence-only receipt route",
  },
  ...(sourceWorkIds.length || profileIds.length ? {
    selection: {
      selectionId: `sha256:${createHash("sha256").update(selected.map((profile) => profile.method_profile_id).join("\n")).digest("hex")}`,
      sourceLibrarySha256: `sha256:${createHash("sha256").update(libraryBytes).digest("hex")}`,
      profileIds: selected.map((profile) => profile.method_profile_id),
      sourceWorkIds: selected.map((profile) => profile.source_work_id),
    },
  } : {}),
  profiles: selected.length,
  preprocessingSliceAvailable: results.filter((result) => result.ok || result.executableSettingIds.length).length,
  supportedPreprocessingSettings: results.reduce((count, result) => count + result.executableSettingIds.length, 0),
  preservedEvidenceSettings: results.reduce((count, result) => count + result.evidenceSettingIds.length, 0),
  preprocessingOnlyDiagnostics: results.filter((result) => isPreprocessingOnlyDiagnostic(result.readiness)).length,
  preprocessingBlockers: results.reduce((count, result) => count + preprocessingBlockerCount(result.readiness), 0),
  fullProfileSuccessful: results.filter(isFullProfileSuccessful).length,
  fullProfileBlocked: results.filter((result) => !isFullProfileSuccessful(result)).length,
  dispositions: countBy(results.map((result) => result.readiness.disposition)),
  readiness: Object.fromEntries(readinessDimensions.map((dimension) => [dimension, {
    ready: results.filter((result) => result.readiness[dimension].status === "ready").length,
    blocked: results.filter((result) => result.readiness[dimension].status === "blocked").length,
    notRequired: results.filter((result) => result.readiness[dimension].status === "not_required").length,
    blockers: results.reduce((count, result) => count + result.readiness[dimension].blockers.length, 0),
  }])),
  legacyAudit: {
    findings: legacyBlockers.length,
    byCode: countBy(legacyBlockers.map((blocker) => blocker.code)),
  },
  configurationVariants: {
    enumerated: variantResults.length,
    sourceProfilesEnumerated: enumerations.filter((enumeration) => enumeration.ok).length,
    sourceProfilesBlocked: enumerations.filter((enumeration) => !enumeration.ok).length,
    preprocessingSliceAvailable: variantResults.filter(({ result }) => result.ok || result.supportedPlan).length,
    supportedPreprocessingSettings: variantResults.reduce((count, { result }) =>
      count + receiptSettingPartition(result).executableSettingIds.length, 0),
    preservedEvidenceSettings: variantResults.reduce((count, { result }) =>
      count + receiptSettingPartition(result).evidenceSettingIds.length, 0),
    preprocessingOnlyDiagnostics: variantResults.filter(({ result }) => isPreprocessingOnlyDiagnostic(result.readiness)).length,
    preprocessingBlockers: variantResults.reduce((count, { result }) => count + preprocessingBlockerCount(result.readiness), 0),
    fullProfileSuccessful: variantResults.filter(({ result }) => isFullProfileSuccessful(result)).length,
    fullProfileBlocked: variantResults.filter(({ result }) => !isFullProfileSuccessful(result)).length,
    legacyAuditFindings: variantLegacyBlockers.length,
    enumerationBlockers: enumerations.flatMap((enumeration) => enumeration.ok ? [] : enumeration.blockers),
  },
  settingInventory: {
    disclosedMethodAtoms: allSettings.length,
    settings: allSettings.length,
    byImplementation: countBy(allSettings.map((setting) => setting.method_implementation_status)),
    byRoute: countBy(allSettings.map((setting) => typeof setting.method_execution_route === "string" ? setting.method_execution_route : "unassigned")),
    implementationByRoute: countBy(allSettings.map((setting) => `${setting.method_implementation_status}/${typeof setting.method_execution_route === "string" ? setting.method_execution_route : "unassigned"}`)),
    implementationObligations: implementationObligationSettings.length,
    evidenceProofSettings: evidenceProofSettings.length,
    executionIneligibleDocumentaryReceipts: executionIneligibleDocumentaryReceiptSettings.length,
  },
  ...(process.argv.includes("--details") ? {
    details,
    campaignDetails: results.flatMap((result, index) => result.campaignRuns.length ? [{
      sourceWorkId: selected[index]!.source_work_id,
      runCount: result.campaignRuns.length,
      runs: result.campaignRuns.map(({ selection, compilation }) => ({
        selectionId: selection.selectionId,
      selectedLevelIds: selection.selectedLevelIds,
      selectedCombinationId: selection.selectedCombinationId ?? null,
        executableSettingIds: receiptSettingPartition(compilation).executableSettingIds,
        evidenceSettingIds: receiptSettingPartition(compilation).evidenceSettingIds,
        blockers: compilation.ok ? [] : compilation.blockers,
        readiness: compilation.readiness,
      })),
    }] : []),
    variantDetails: variantResults.map(({ profile, selection, result }) => ({
      sourceWorkId: profile.source_work_id,
      selectionId: selection.selectionId,
      selectedLevelIds: selection.selectedLevelIds,
      selectedCombinationId: selection.selectedCombinationId ?? null,
      effectiveSettingIds: selection.effectiveSettingIds,
      executableSettingIds: receiptSettingPartition(result).executableSettingIds,
      evidenceSettingIds: receiptSettingPartition(result).evidenceSettingIds,
      blockers: result.ok ? [] : result.blockers,
      readiness: result.readiness,
      legacyBlockers: result.legacyBlockers,
    })),
  } : {}),
};
if (validation.profiles !== validation.fullProfileSuccessful + validation.fullProfileBlocked) throw new Error("full-profile compiler count mismatch");
const serialized = `${JSON.stringify(validation, null, 2)}\n`;
if (outputPath) {
  writeFileSync(outputPath, serialized, { mode: 0o600 });
  chmodSync(outputPath, 0o600);
} else {
  process.stdout.write(serialized);
}
