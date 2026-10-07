import { BROWSER_SUPPORT_FILE_KEYS } from "@/lib/generatedContract";
import { usesInputCapabilityEvidence } from "@/lib/inputCapabilityEvidence";
import type {
  BrowserProcessingOptions,
  BrowserSupportFiles,
  WorkflowExplorerSupportRole,
} from "@/lib/types";

export type BrowserSupportPresence = Record<keyof BrowserSupportFiles, boolean>;

const ADAPTER_ONLY_SUPPORT_FILES = [
  "analysisFeatureMatrixFile",
  "callSmsEligibilityFile",
  "phoneStudyPsCommunicationFile",
  "phoneStudyEsFile",
  "anchorEventsFile",
] as const satisfies readonly (keyof BrowserSupportFiles)[];

/**
 * The core PipelineV2 support roles. The adapter-only sidecars above are
 * filtered out before any enablement is asked for, so they carry no predicate.
 */
type CoreSupportFileKey = Exclude<
  keyof BrowserSupportFiles,
  (typeof ADAPTER_ONLY_SUPPORT_FILES)[number]
>;

const isEnabled = {
  filterFile: (options: BrowserProcessingOptions) => options.useFilterFile,
  appsForcingScreenOpenFile: (options: BrowserProcessingOptions) =>
    options.useAppsForcingScreenOpenFile,
  backgroundAppsFile: (options: BrowserProcessingOptions) => options.useBackgroundAppsFile,
  appCodebookFile: (options: BrowserProcessingOptions) => options.useAppCodebook,
  studyDatesFile: (options: BrowserProcessingOptions) =>
    options.enableStudyWindowFilter || options.enableDayCoverage,
  deviceSharingFile: (options: BrowserProcessingOptions) =>
    options.enablePersonAttribution || options.enableComplianceScoring,
  surveyAttributionFile: (options: BrowserProcessingOptions) => options.enablePersonAttribution,
  enrolledDevicesFile: (options: BrowserProcessingOptions) => options.enableComplianceScoring,
  inputCapabilityEvidenceFile: usesInputCapabilityEvidence,
} satisfies Record<CoreSupportFileKey, (options: BrowserProcessingOptions) => boolean>;

const adapterOnlySupportFiles = new Set<keyof BrowserSupportFiles>(
  ADAPTER_ONLY_SUPPORT_FILES,
);

const hasBundledDefault = new Set<keyof BrowserSupportFiles>([
  "filterFile",
  "appsForcingScreenOpenFile",
  "backgroundAppsFile",
  "appCodebookFile",
]);

function supportRoleId(key: keyof BrowserSupportFiles): string {
  return key.replace(/[A-Z]/g, (character) => `_${character.toLocaleLowerCase()}`);
}

/**
 * Describe exactly which support roles the next browser run can bind without
 * reading support-file bytes. The generated key list makes the browser role
 * inventory exhaustive; adapter-only sidecars are filtered before projection
 * because they are not members of the core PipelineV2 support contract. The
 * four packaged defaults are present whenever their corresponding option is
 * enabled, while core study-specific inputs require an uploaded file.
 */
export function workflowExplorerSupportRoles(
  options: BrowserProcessingOptions,
  uploaded: BrowserSupportPresence,
): WorkflowExplorerSupportRole[] {
  return BROWSER_SUPPORT_FILE_KEYS
    .filter((key): key is CoreSupportFileKey => !adapterOnlySupportFiles.has(key))
    .map((key) => ({
      roleId: supportRoleId(key),
      present:
        isEnabled[key](options) && (hasBundledDefault.has(key) || uploaded[key]),
    }));
}
