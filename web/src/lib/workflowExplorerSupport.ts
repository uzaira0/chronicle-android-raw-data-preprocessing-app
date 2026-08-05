import { BROWSER_SUPPORT_FILE_KEYS } from "@/lib/generatedContract";
import type {
  BrowserProcessingOptions,
  BrowserSupportFiles,
  WorkflowExplorerSupportRole,
} from "@/lib/types";

export type BrowserSupportPresence = Record<keyof BrowserSupportFiles, boolean>;

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
} satisfies Record<keyof BrowserSupportFiles, (options: BrowserProcessingOptions) => boolean>;

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
 * reading support-file bytes. The generated key list makes this exhaustive;
 * the four packaged defaults are present whenever their corresponding option
 * is enabled, while study-specific inputs require an uploaded file.
 */
export function workflowExplorerSupportRoles(
  options: BrowserProcessingOptions,
  uploaded: BrowserSupportPresence,
): WorkflowExplorerSupportRole[] {
  return BROWSER_SUPPORT_FILE_KEYS.map((key) => ({
    roleId: supportRoleId(key),
    present:
      isEnabled[key](options) && (hasBundledDefault.has(key) || uploaded[key]),
  }));
}
