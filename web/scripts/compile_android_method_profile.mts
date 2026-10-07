import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  literatureInputAdapterForSetting,
  methodReceiptUsesAnalysisFeatureMatrix,
  methodReceiptUsesCallSmsEligibility,
  methodReceiptUsesInputCapabilityEvidence,
  methodReceiptUsesPhoneStudyEs,
  methodReceiptUsesPhoneStudyPsCommunication,
} from "../src/lib/literatureInputAdapters";
import { usesInputCapabilityEvidence } from "../src/lib/inputCapabilityEvidence";
import { DEFAULT_BROWSER_OPTIONS } from "../src/lib/generatedContract";
import {
  compileNativeMethodProfileCampaign,
  compileNativeMethodProfile,
  parseStudyMethodProfileLibrary,
  requiresConfigurationSelection,
  selectMethodConfiguration,
  type MethodSettingAssertion,
  type StudyMethodProfile,
} from "../src/lib/methodProfiles";
import { buildRustV2Options } from "../src/lib/rustPipelineRuntime";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const defaultLibrary = path.join(
  repoRoot,
  ".tmp-literature-review-private/ontology-sublation-20260831/adjudicated-method-profile-library.json",
);

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
    : [];
}

function selectableSettingIds(profile: StudyMethodProfile): Set<string> {
  if (!profile.method_configuration_space || typeof profile.method_configuration_space !== "object") return new Set();
  return new Set(records((profile.method_configuration_space as Record<string, unknown>).method_configuration_groups)
    .flatMap((group) => {
      const levels = records(group.method_configuration_levels);
      return requiresConfigurationSelection(group)
        ? levels.flatMap((level) => [
          ...records([level]).flatMap(() => Array.isArray(level.included_method_setting_ids) ? level.included_method_setting_ids : []),
          ...records([level]).flatMap(() => Array.isArray(level.common_method_setting_ids) ? level.common_method_setting_ids : []),
          ...records([level]).flatMap(() => Array.isArray(level.branch_method_setting_ids) ? level.branch_method_setting_ids : []),
        ].filter((id): id is string => typeof id === "string"))
        : [];
    }));
}

function lane(setting: MethodSettingAssertion): string {
  if (literatureInputAdapterForSetting(setting.method_setting_id) || setting.method_execution_route === "protocol_input") return "input";
  if (setting.method_execution_route === "native_option_binding" || setting.method_execution_route === "native_operator_parameter") return "preprocessing";
  if (setting.method_execution_route === "external_named_executor") return "downstream";
  if (setting.method_execution_route === "receipt_conformance") return "evidence";
  return "unassigned";
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function requiredSupportRoles(
  options: Parameters<typeof usesInputCapabilityEvidence>[0],
  settingIds: readonly string[],
): string[] {
  return [
    ...((usesInputCapabilityEvidence(options) || methodReceiptUsesInputCapabilityEvidence(settingIds))
      ? ["input_capability_evidence_file"] : []),
    ...(methodReceiptUsesAnalysisFeatureMatrix(settingIds) ? ["analysis_feature_matrix_file"] : []),
    ...(methodReceiptUsesCallSmsEligibility(settingIds) ? ["call_sms_eligibility_file"] : []),
    ...(methodReceiptUsesPhoneStudyPsCommunication(settingIds)
      ? ["phonestudy_ps_communication_file"] : []),
    ...(methodReceiptUsesPhoneStudyEs(settingIds) ? ["phonestudy_es_file"] : []),
  ];
}

async function writePrivate(file: string, value: unknown): Promise<void> {
  await writeFile(file, json(value), { mode: 0o600 });
  await chmod(file, 0o600);
}

const sourceWorkId = argument("--source-work");
const profileId = argument("--profile-id");
const outputDir = path.resolve(argument("--output") ?? "method-profile-run");
if (!sourceWorkId && !profileId) throw new Error("--source-work DOI_OR_ID or --profile-id ID is required");

const libraryPath = path.resolve(argument("--library") ?? defaultLibrary);
const library = parseStudyMethodProfileLibrary(JSON.parse(await readFile(libraryPath, "utf8")) as unknown);
const matches = library.profiles.filter((profile) =>
  profileId ? profile.method_profile_id === profileId : profile.source_work_id === sourceWorkId);
if (matches.length !== 1) throw new Error(`expected one profile, found ${matches.length}`);
const profile = matches[0]!;
const baseline = {
  ...DEFAULT_BROWSER_OPTIONS,
  selectedTimezone: argument("--timezone") ?? "UTC",
  processScreenUsage: false,
  useAppCodebook: false,
};
if (process.argv.includes("--all-source-configurations")) {
  if (argument("--selection")) throw new Error("--selection cannot be combined with --all-source-configurations");
  const campaign = compileNativeMethodProfileCampaign(profile, baseline);
  if (!campaign.runs.length) throw new Error(`configuration enumeration failed: ${json(campaign.blockers)}`);
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  await chmod(outputDir, 0o700);
  const runs = [];
  for (const [index, run] of campaign.runs.entries()) {
    if (!run.compilation.ok) {
      throw new Error(`source configuration ${run.selection.selectionId} is not fully reproducible: ${json(run.compilation.blockers)}`);
    }
    const runName = String(index + 1).padStart(3, "0");
    const runDir = path.join(outputDir, "runs", runName);
    await mkdir(runDir, { recursive: true, mode: 0o700 });
    await chmod(runDir, 0o700);
    await Promise.all([
      writePrivate(path.join(runDir, "selection.json"), run.selection),
      writePrivate(path.join(runDir, "browser-options.json"), run.compilation.options),
      writePrivate(path.join(runDir, "runtime-options.json"), buildRustV2Options(run.compilation.options, {
        datetimeOfPreprocessing: "2026-09-01 00:00:00 UTC",
      })),
      writePrivate(path.join(runDir, "method-profile-receipt.json"), run.compilation.receipt),
    ]);
    runs.push({
      run: runName,
      selectionId: run.selection.selectionId,
      selectedLevelIds: run.selection.selectedLevelIds,
      selectedCombinationId: run.selection.selectedCombinationId ?? null,
      requiredSupportRoles: requiredSupportRoles(run.compilation.options, run.compilation.receipt.settingIds),
      directory: `runs/${runName}`,
    });
  }
  await writePrivate(path.join(outputDir, "campaign-manifest.json"), {
    profileId: profile.method_profile_id,
    sourceWorkId: profile.source_work_id,
    runCount: runs.length,
    runs,
  });
  process.stdout.write(json({ outputDir, sourceWorkId: profile.source_work_id, runCount: runs.length }));
  process.exit(0);
}
const requestedLevels = argument("--selection")
  ? JSON.parse(await readFile(path.resolve(argument("--selection")!), "utf8")) as Record<string, string>
  : {};
const selected = selectMethodConfiguration(profile, requestedLevels);
if (!selected.ok) throw new Error(`configuration selection failed: ${json(selected.blockers)}`);
const compilation = compileNativeMethodProfile(profile, baseline, selected.selection);
const supported = compilation.ok ? compilation : compilation.supportedPlan;
const fullProfileSuccessful = compilation.ok
  && compilation.readiness.disposition === "fully_reproduced";
const preprocessingOnlyDiagnostic = compilation.readiness.disposition === "preprocessing_reproduced";
if (compilation.ok && !supported) throw new Error("profile compiler returned no executable plan");

const runtimeSettingIds = new Set(supported?.receipt.settingIds ?? []);
const supportRoles = supported
  ? requiredSupportRoles(supported.options, supported.receipt.settingIds)
  : [];
const effectiveSettingIds = new Set(selected.selection.effectiveSettingIds);
const selectable = selectableSettingIds(profile);
const allBlockers = compilation.ok ? [] : compilation.blockers;
const matrix = profile.method_settings.map((setting) => ({
  settingId: setting.method_setting_id,
  parameter: setting.method_parameter_key ?? null,
  targetLayer: setting.method_target_layer ?? null,
  sourceWording: setting.source_clause_text ?? setting.source_observed_setting ?? null,
  sourceValue: setting.method_value_json ?? null,
  sourceLocations: setting.source_locators ?? [],
  selectedByConfiguration: effectiveSettingIds.has(setting.method_setting_id),
  selectionSemantics: selectable.has(setting.method_setting_id) ? "selectable" : "fixed",
  readinessLane: lane(setting),
  implementationStatus: setting.method_implementation_status,
  executionRoute: setting.method_execution_route ?? null,
  existingOwner: literatureInputAdapterForSetting(setting.method_setting_id)?.adapterId
    ?? setting.method_execution_destination_id
    ?? setting.executor_id
    ?? null,
  requiredSignals: setting.required_inputs ?? [],
  executionDisposition: setting.method_execution_route === "receipt_conformance"
    ? "documentary_only"
    : runtimeSettingIds.has(setting.method_setting_id)
      ? "executable"
      : setting.method_implementation_status === "refused_missing_signal"
      ? "refused_missing_signal"
      : "pending_implementation",
  conformanceFixtureId: setting.conformance_fixture_id ?? null,
  conformanceResultDigest: setting.conformance_result_digest ?? null,
  blockers: allBlockers.filter((blocker) => blocker.settingId === setting.method_setting_id),
}));

await mkdir(outputDir, { recursive: true, mode: 0o700 });
await chmod(outputDir, 0o700);
await Promise.all([
  writePrivate(path.join(outputDir, "setting-matrix.json"), matrix),
  writePrivate(path.join(outputDir, "compilation-report.json"), {
    profileId: profile.method_profile_id,
    sourceWorkId: profile.source_work_id,
    settingCount: matrix.length,
    selectedSettingCount: selected.selection.effectiveSettingIds.length,
    supportedSettingCount: supported?.receipt.settingIds.length ?? 0,
    executableSettingCount: matrix.filter((setting) => setting.executionDisposition === "executable").length,
    fullProfileSuccessful,
    preprocessingOnlyDiagnostic,
    preprocessingSliceAvailable: Boolean(supported),
    requiredSupportRoles: supportRoles,
    readiness: compilation.readiness,
    blockers: allBlockers,
  }),
  ...(supported ? [
    writePrivate(path.join(outputDir, "browser-options.json"), supported.options),
    writePrivate(path.join(outputDir, "runtime-options.json"), buildRustV2Options(supported.options, {
      datetimeOfPreprocessing: "2026-09-01 00:00:00 UTC",
    })),
    writePrivate(path.join(outputDir, fullProfileSuccessful
      ? "method-profile-receipt.json"
      : "preprocessing-diagnostic.json"), supported.receipt),
  ] : []),
]);

process.stdout.write(json({
  outputDir,
  sourceWorkId: profile.source_work_id,
  settingCount: matrix.length,
  supportedSettingCount: supported?.receipt.settingIds.length ?? 0,
  executableSettingCount: matrix.filter((setting) => setting.executionDisposition === "executable").length,
  fullProfileSuccessful,
  preprocessingOnlyDiagnostic,
  preprocessingSliceAvailable: Boolean(supported),
  requiredSupportRoles: supportRoles,
}));
