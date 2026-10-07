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
  inputCapabilityEvidenceFile: false,
  analysisFeatureMatrixFile: false,
  callSmsEligibilityFile: false,
  phoneStudyPsCommunicationFile: false,
  phoneStudyEsFile: false,
  anchorEventsFile: false,
};

describe("workflowExplorerSupportRoles", () => {
  it("reports every core browser role and excludes adapter-only inputs", () => {
    const roles = workflowExplorerSupportRoles(DEFAULT_BROWSER_OPTIONS, {
      ...noUploads,
      analysisFeatureMatrixFile: true,
      callSmsEligibilityFile: true,
      phoneStudyPsCommunicationFile: true,
      phoneStudyEsFile: true,
      anchorEventsFile: true,
    });
    expect(roles.map(({ roleId }) => roleId)).toEqual([
      "filter_file",
      "apps_forcing_screen_open_file",
      "background_apps_file",
      "app_codebook_file",
      "study_dates_file",
      "device_sharing_file",
      "survey_attribution_file",
      "enrolled_devices_file",
      "input_capability_evidence_file",
    ]);
    expect(roles.map(({ roleId }) => roleId)).not.toContain("analysis_feature_matrix_file");
    expect(roles.map(({ roleId }) => roleId)).not.toContain("call_sms_eligibility_file");
    expect(roles.map(({ roleId }) => roleId)).not.toContain("phone_study_ps_communication_file");
    expect(roles.map(({ roleId }) => roleId)).not.toContain("phone_study_es_file");
    expect(roles.map(({ roleId }) => roleId)).not.toContain("anchor_events_file");
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
        inputCapabilityEvidenceFile: true,
        analysisFeatureMatrixFile: false,
        callSmsEligibilityFile: false,
        phoneStudyPsCommunicationFile: false,
        phoneStudyEsFile: false,
        anchorEventsFile: false,
      },
    );
    const present = new Set(roles.filter((role) => role.present).map((role) => role.roleId));
    expect(present).toContain("study_dates_file");
    expect(present).toContain("device_sharing_file");
    expect(present).toContain("survey_attribution_file");
    expect(present).not.toContain("enrolled_devices_file");
    expect(present).not.toContain("input_capability_evidence_file");
    expect(present).not.toContain("analysis_feature_matrix_file");
    expect(present).not.toContain("call_sms_eligibility_file");
    expect(present).not.toContain("phone_study_ps_communication_file");
    expect(present).not.toContain("phone_study_es_file");
    expect(present).not.toContain("anchor_events_file");
  });

  it("marks capability evidence present only for an active source-sensitive B05 consumer", () => {
    const uploaded = { ...noUploads, inputCapabilityEvidenceFile: true };
    const sourceOptions = {
      ...DEFAULT_BROWSER_OPTIONS,
      screenSessionConstructionStrategy:
        "parry_toth_2025_session_glance_v1" as const,
    };
    const active = workflowExplorerSupportRoles(sourceOptions, uploaded);
    expect(
      active.find(({ roleId }) => roleId === "input_capability_evidence_file")
        ?.present,
    ).toBe(true);

    const inactive = workflowExplorerSupportRoles(
      { ...sourceOptions, processScreenUsage: false, processAppUsage: false },
      uploaded,
    );
    expect(
      inactive.find(({ roleId }) => roleId === "input_capability_evidence_file")
        ?.present,
    ).toBe(false);
  });
});
