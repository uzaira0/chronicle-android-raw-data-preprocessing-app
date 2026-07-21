import defaultAppCodebookUrl from "@/assets/defaults/unified_app_codebook.csv?url";
import defaultAppsToFilterUrl from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv?url";
import defaultAppsForcingScreenOpenUrl from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv?url";
import defaultBackgroundAppsUrl from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_background_apps.csv?url";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import type {
  BrowserProcessingOptions,
  BrowserSupportFiles,
} from "@/lib/types";

export const PREPROCESSOR_VERSION = "1.0.0";
export { DEFAULT_BROWSER_OPTIONS };

export const TIMEZONE_HANDLING_OPTIONS = [
  {
    value: "selected-filter",
    label: "Remove data with timezones other than the selected timezone",
  },
  {
    value: "selected-convert",
    label: "Convert data to the selected timezone",
  },
  {
    value: "primary-filter",
    label: "Remove data with timezones other than the primary timezone per file",
  },
  {
    value: "primary-convert",
    label: "Convert data to the primary timezone per file",
  },
] as const;

export const SAME_APP_INTERACTION_TYPE_OPTIONS = [
  { label: "Activity Paused for the Same App", value: "Activity Paused" },
  { label: "Activity Resumed for the Same App", value: "Activity Resumed" },
  { label: "Activity Stopped for the Same App", value: "Activity Stopped" },
  {
    label: "Activity Destroyed for the Same App",
    value: "Activity Destroyed",
  },
];

export const OTHER_INTERACTION_TYPE_OPTIONS = [
  { label: "Activity Resumed for a Different App", value: "Activity Resumed" },
  { label: "Screen Non-Interactive", value: "Screen Non-Interactive" },
  { label: "Keyguard Shown", value: "Keyguard Shown" },
  { label: "Activity Destroyed", value: "Activity Destroyed" },
  { label: "Device Shutdown", value: "Device Shutdown" },
  { label: "User Stopped", value: "User Stopped" },
  {
    label: "Activity Resumed for a Filtered App",
    value: "Filtered App Resumed",
  },
  { label: "Instance of Usage for a Filtered App", value: "Filtered App Usage" },
  {
    label: "Background Usage for a Filtered App",
    value: "Filtered App Background Usage",
  },
];

export const INTERACTION_TYPES_TO_REMOVE_OPTIONS = [
  "Filtered App Usage",
  "End of Usage Missing",
  "End of Day",
  "Continue Previous Day",
  "Configuration Change",
  "System Interaction",
  "User Interaction",
  "Shortcut Invocation",
  "Chooser Action",
  "Notification Seen",
  "Standby Bucket Changed",
  "Notification Interruption",
  "Slice Pinned Priv",
  "Slice Pinned App",
  "Screen Interactive",
  "Screen Non-Interactive",
  "Keyguard Shown",
  "Keyguard Hidden",
  "Foreground Service Start",
  "Foreground Service Stop",
  "Continuing Foreground Service",
  "Rollover Foreground Service",
  "Activity Stopped",
  "Activity Destroyed",
  "Flush to Disk",
  "Device Shutdown",
  "Device Startup",
  "User Unlocked",
  "User Stopped",
  "Locus ID Set",
  "App Component Used",
];

const defaultBytesCache = new Map<string, Promise<ArrayBuffer>>();

async function fetchDefaultBytes(url: string): Promise<ArrayBuffer> {
  const cached = defaultBytesCache.get(url);
  if (cached) return cached;
  const pending = fetch(url).then((response) => {
    if (!response.ok) throw new Error(`Failed to load bundled asset: ${url}`);
    return response.arrayBuffer();
  });
  pending.catch(() => defaultBytesCache.delete(url));
  defaultBytesCache.set(url, pending);
  return pending;
}

function fileNameFromUrl(url: string): string {
  return (url.split("/").pop() ?? "default.csv").split("?")[0] ?? "default.csv";
}

export async function resolveDefaultSupportFiles(
  options: BrowserProcessingOptions,
  uploads?: BrowserSupportFiles,
): Promise<BrowserSupportFiles> {
  const result: BrowserSupportFiles = {};
  const load = async (
    key:
      | "filterFile"
      | "appsForcingScreenOpenFile"
      | "backgroundAppsFile"
      | "appCodebookFile",
    enabled: boolean,
    url: string,
  ) => {
    if (!enabled) return;
    result[key] =
      uploads?.[key] ??
      ({ name: fileNameFromUrl(url), bytes: await fetchDefaultBytes(url) });
  };
  await Promise.all([
    load("filterFile", options.useFilterFile, defaultAppsToFilterUrl),
    load(
      "appsForcingScreenOpenFile",
      options.useAppsForcingScreenOpenFile,
      defaultAppsForcingScreenOpenUrl,
    ),
    load(
      "backgroundAppsFile",
      options.useBackgroundAppsFile,
      defaultBackgroundAppsUrl,
    ),
    load("appCodebookFile", options.useAppCodebook, defaultAppCodebookUrl),
  ]);
  if (uploads?.studyDatesFile) result.studyDatesFile = uploads.studyDatesFile;
  if (uploads?.deviceSharingFile)
    result.deviceSharingFile = uploads.deviceSharingFile;
  if (uploads?.surveyAttributionFile)
    result.surveyAttributionFile = uploads.surveyAttributionFile;
  if (uploads?.enrolledDevicesFile)
    result.enrolledDevicesFile = uploads.enrolledDevicesFile;
  return result;
}
