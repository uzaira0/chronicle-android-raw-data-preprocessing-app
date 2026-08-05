import { describe, expect, it } from "vitest";

import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import { workflowExplorerSupportRoles } from "@/lib/workflowExplorerSupport";

const noUploads = {
  filterFile: false,
  appsForcingScreenOpenFile: false,
  backgroundAppsFile: false,
  appCodebookFile: false,
  studyDatesFile: false,
  deviceSharingFile: false,
  surveyAttributionFile: false,
  enrolledDevicesFile: false,
};

describe("workflowExplorerSupportRoles", () => {
  it("reports every generated browser role and includes enabled packaged defaults", () => {
    const roles = workflowExplorerSupportRoles(DEFAULT_BROWSER_OPTIONS, noUploads);
    expect(roles.map(({ roleId }) => roleId)).toEqual([
      "filter_file",
      "apps_forcing_screen_open_file",
      "background_apps_file",
      "app_codebook_file",
      "study_dates_file",
      "device_sharing_file",
      "survey_attribution_file",
      "enrolled_devices_file",
    ]);
    expect(Object.fromEntries(roles.map(({ roleId, present }) => [roleId, present]))).toMatchObject({
      filter_file: DEFAULT_BROWSER_OPTIONS.useFilterFile,
      apps_forcing_screen_open_file: DEFAULT_BROWSER_OPTIONS.useAppsForcingScreenOpenFile,
      background_apps_file: DEFAULT_BROWSER_OPTIONS.useBackgroundAppsFile,
      app_codebook_file: DEFAULT_BROWSER_OPTIONS.useAppCodebook,
      study_dates_file: false,
    });
  });

  it("only marks uploaded study inputs present while a consumer is enabled", () => {
    const roles = workflowExplorerSupportRoles(
      {
        ...DEFAULT_BROWSER_OPTIONS,
        enablePersonAttribution: true,
        enableComplianceScoring: false,
        enableDayCoverage: true,
      },
      {
        ...noUploads,
        studyDatesFile: true,
        deviceSharingFile: true,
        surveyAttributionFile: true,
        enrolledDevicesFile: true,
      },
    );
    const present = new Set(roles.filter((role) => role.present).map((role) => role.roleId));
    expect(present).toContain("study_dates_file");
    expect(present).toContain("device_sharing_file");
    expect(present).toContain("survey_attribution_file");
    expect(present).not.toContain("enrolled_devices_file");
  });
});
