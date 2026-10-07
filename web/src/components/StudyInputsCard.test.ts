import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { beforeAll, describe, expect, it } from "vitest";
import { loadMethodReceiptValidation } from "@/lib/settingsPersistence";

import { FilesAndInputsCard } from "@/components/FilesAndInputsCard";
import { StudyInputsCard } from "@/components/StudyInputsCard";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import { SUPPORT_FILE_ACCEPT } from "@/lib/validation";

// Receipt validation loads on demand in the app (see loadMethodReceiptValidation);
// these tests validate receipts synchronously, as App does once it has loaded.
beforeAll(async () => {
  await loadMethodReceiptValidation();
});

const COMPONENT_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "StudyInputsCard.tsx",
);

describe("input capability evidence upload", () => {
  it("is CSV-only and explains conditional retention plus typed refusal", () => {
    const source = readFileSync(COMPONENT_FILE, "utf8");
    expect(source).toContain(
      'testId="input-capability-evidence-file-input"',
    );
    expect(source).toContain('accept=".csv"');
    expect(source).toContain(
      "schema_version, raw_input_sha256, participant_id, capability_id, state, evidence_basis, evidence_reference, evidence_sha256",
    );
    expect(source).toContain("usesInputCapabilityEvidence(options)");
    expect(source).toContain(
      "Retained with project files, but not sent for the current binding.",
    );
    expect(source).toContain("input_capability_evidence_absent");
  });

  const render = (
    overrides: Partial<typeof DEFAULT_BROWSER_OPTIONS>,
  ): string =>
    renderToStaticMarkup(
      createElement(StudyInputsCard, {
        options: { ...DEFAULT_BROWSER_OPTIONS, ...overrides },
        studyDatesFile: null,
        setStudyDatesFile: () => {},
        deviceSharingFile: null,
        setDeviceSharingFile: () => {},
        surveyAttributionFile: null,
        setSurveyAttributionFile: () => {},
        enrolledDevicesFile: null,
        setEnrolledDevicesFile: () => {},
        inputCapabilityEvidenceFile: null,
        setInputCapabilityEvidenceFile: () => {},
        analysisFeatureMatrixFile: null,
        setAnalysisFeatureMatrixFile: () => {},
        callSmsEligibilityFile: null,
        setCallSmsEligibilityFile: () => {},
        phoneStudyPsCommunicationFile: null,
        setPhoneStudyPsCommunicationFile: () => {},
        phoneStudyEsFile: null,
        setPhoneStudyEsFile: () => {},
        anchorEventsFile: null,
        setAnchorEventsFile: () => {},
      }),
    );

  it("truthfully explains Chronicle-default B05 evidence used by Schoedel", () => {
    const html = render({
      processScreenUsage: false,
      processAppUsage: true,
      screenSessionConstructionStrategy: "chronicle_screen_interactive_v1",
      episodeReconstructionStrategy:
        "schoedel_2026_app_within_screen_prose_v1",
    });
    expect(html).toContain(
      "Schoedel app reconstruction and its bound B05 screen dependency",
    );
    expect(html).not.toContain(
      "selected source-sensitive screen-session construction",
    );
  });

  it("distinguishes a source-sensitive screen construction arm", () => {
    const html = render({
      processScreenUsage: true,
      processAppUsage: false,
      screenSessionConstructionStrategy:
        "parry_toth_2025_session_glance_v1",
    });
    expect(html).toContain(
      "selected source-sensitive screen-session construction",
    );
    expect(html).not.toContain("Schoedel app reconstruction and its bound");
  });
});

/**
 * `RuntimeSupportFiles::resolve` accepts `.csv` and `.xlsx` and has a dedicated
 * fail-closed arm for `.xls` ("Convert legacy .xls workbooks to .xlsx or CSV").
 * The pickers used to advertise `.xls`, so a user could pick one, see a green
 * "Loaded" / "Enabled with uploaded file" state, and lose the whole batch at
 * run time. Both cards now render the same accept set the validator reads.
 */
describe("support-file pickers advertise only resolvable formats", () => {
  const studyInputs = renderToStaticMarkup(
    createElement(StudyInputsCard, {
      options: DEFAULT_BROWSER_OPTIONS,
      studyDatesFile: null,
      setStudyDatesFile: () => {},
      deviceSharingFile: null,
      setDeviceSharingFile: () => {},
      surveyAttributionFile: null,
      setSurveyAttributionFile: () => {},
      enrolledDevicesFile: null,
      setEnrolledDevicesFile: () => {},
      inputCapabilityEvidenceFile: null,
      setInputCapabilityEvidenceFile: () => {},
      analysisFeatureMatrixFile: null,
      setAnalysisFeatureMatrixFile: () => {},
        callSmsEligibilityFile: null,
        setCallSmsEligibilityFile: () => {},
        phoneStudyPsCommunicationFile: null,
        setPhoneStudyPsCommunicationFile: () => {},
        phoneStudyEsFile: null,
        setPhoneStudyEsFile: () => {},
        anchorEventsFile: null,
        setAnchorEventsFile: () => {},
      }),
  );
  const filesAndInputs = renderToStaticMarkup(
    createElement(FilesAndInputsCard, {
      options: DEFAULT_BROWSER_OPTIONS,
      setOptions: () => {},
      filterFile: null,
      setFilterFile: () => {},
      appsForcingScreenOpenFile: null,
      setAppsForcingScreenOpenFile: () => {},
      backgroundAppsFile: null,
      setBackgroundAppsFile: () => {},
      appCodebookFile: null,
      setAppCodebookFile: () => {},
    }),
  );

  for (const [name, html] of [
    ["StudyInputsCard", studyInputs],
    ["FilesAndInputsCard", filesAndInputs],
  ] as const) {
    it(`renders no .xls in any ${name} picker`, () => {
      // Rendered markup, not source text: the accept set the browser dialog
      // actually receives.
      expect(html).toContain(`accept="${SUPPORT_FILE_ACCEPT}"`);
      expect(html).not.toContain('accept=".xls"');
      expect(html).not.toContain(".xls,");
      // Every file input carries an accept attribute; none may be unfiltered.
      const inputs = html.match(/<input type="file"[^>]*>/g) ?? [];
      expect(inputs.length).toBeGreaterThan(0);
      for (const input of inputs) {
        expect(input, `${name} picker without an accept set`).toContain(
          'accept="',
        );
      }
    });
  }

  it("still declares the CSV-only capability-evidence slot", () => {
    expect(studyInputs).toContain('accept=".csv"');
    expect(studyInputs).toContain(
      'data-testid="input-capability-evidence-file-input"',
    );
  });

  it("renders the schema-backed exact application-label controls and source values", () => {
    const html = renderToStaticMarkup(
      createElement(FilesAndInputsCard, {
        options: {
          ...DEFAULT_BROWSER_OPTIONS,
          filterMatchField: "application_label",
          applicationLabelExclusions: ["YouTube Vanced", "Basic Daydreams"],
        },
        setOptions: () => {},
        filterFile: null,
        setFilterFile: () => {},
        appsForcingScreenOpenFile: null,
        setAppsForcingScreenOpenFile: () => {},
        backgroundAppsFile: null,
        setBackgroundAppsFile: () => {},
        appCodebookFile: null,
        setAppCodebookFile: () => {},
      }),
    );
    expect(html).toContain('data-testid="filter-match-field-select"');
    expect(html.match(/<select[^>]*data-testid="filter-match-field-select"[^>]*>/)?.[0])
      .not.toContain("disabled");
    expect(html).toContain('value="application_label" selected=""');
    expect(html).toContain('data-testid="application-label-exclusions-input"');
    expect(html).toContain("YouTube Vanced\nBasic Daydreams");
  });

  /**
   * The refusal itself — a rejected pick never reaching the slot, the alert,
   * and the clearing of a standing refusal — is covered behaviourally in
   * `supportFilePick.test.ts` against the handler both cards install here. The
   * end-to-end rendering of the alert beside a suppressed "Enabled with …"
   * line is covered in `e2e/app.spec.ts` ("a legacy .xls support file is
   * refused at the picker"), which has a real DOM.
   */
  it("installs the shared refusal handler in both cards", () => {
    for (const file of ["StudyInputsCard.tsx", "FilesAndInputsCard.tsx"]) {
      const source = readFileSync(
        resolve(dirname(fileURLToPath(import.meta.url)), file),
        "utf8",
      );
      expect(source, file).toContain("createSupportFilePickHandler({");
      expect(source, file).toContain("onFormatError: setFormatError");
    }
  });
});

describe("analysis feature matrix upload", () => {
  it("shows the slice-qualified schema and becomes required for its method profile", () => {
    const html = renderToStaticMarkup(
      createElement(StudyInputsCard, {
        options: DEFAULT_BROWSER_OPTIONS,
        methodProfileSettingIds: ["method-setting-atomic-2da3112b38d70d2ddf49"],
        studyDatesFile: null,
        setStudyDatesFile: () => {},
        deviceSharingFile: null,
        setDeviceSharingFile: () => {},
        surveyAttributionFile: null,
        setSurveyAttributionFile: () => {},
        enrolledDevicesFile: null,
        setEnrolledDevicesFile: () => {},
        inputCapabilityEvidenceFile: null,
        setInputCapabilityEvidenceFile: () => {},
        analysisFeatureMatrixFile: null,
        setAnalysisFeatureMatrixFile: () => {},
        callSmsEligibilityFile: null,
        setCallSmsEligibilityFile: () => {},
        phoneStudyPsCommunicationFile: null,
        setPhoneStudyPsCommunicationFile: () => {},
        phoneStudyEsFile: null,
        setPhoneStudyEsFile: () => {},
        anchorEventsFile: null,
        setAnchorEventsFile: () => {},
      }),
    );
    expect(html).toContain("analysis-feature-matrix-file-input");
    expect(html).toContain("feature × temporal slice");
    expect(html).toContain(
      '<input type="file" accept=".csv" data-testid="analysis-feature-matrix-file-input"',
    );
    expect(html).toContain("the selected research method profile is on");
  });
});

describe("Call/SMS eligibility upload", () => {
  it("shows the registered shared schema and becomes required for either adapter profile", () => {
    for (const methodProfileSettingIds of [
      ["method-setting-adda9b69e35b45ac28a7d314"],
      ["method-setting-7227d4895934a7ef9170232e"],
    ]) {
      const html = renderToStaticMarkup(
        createElement(StudyInputsCard, {
          options: DEFAULT_BROWSER_OPTIONS,
          methodProfileSettingIds,
          studyDatesFile: null,
          setStudyDatesFile: () => {},
          deviceSharingFile: null,
          setDeviceSharingFile: () => {},
          surveyAttributionFile: null,
          setSurveyAttributionFile: () => {},
          enrolledDevicesFile: null,
          setEnrolledDevicesFile: () => {},
          inputCapabilityEvidenceFile: null,
          setInputCapabilityEvidenceFile: () => {},
          analysisFeatureMatrixFile: null,
          setAnalysisFeatureMatrixFile: () => {},
          callSmsEligibilityFile: null,
          setCallSmsEligibilityFile: () => {},
          phoneStudyPsCommunicationFile: null,
          setPhoneStudyPsCommunicationFile: () => {},
          phoneStudyEsFile: null,
          setPhoneStudyEsFile: () => {},
          anchorEventsFile: null,
          setAnchorEventsFile: () => {},
        }),
      );
      expect(html).toContain("call-sms-eligibility-file-input");
      expect(html).toContain("modality_scope");
      expect(html).toContain("year_equivalent_exposure_denominator");
      expect(html).toContain(
        '<input type="file" accept=".csv" data-testid="call-sms-eligibility-file-input"',
      );
      expect(html).toContain("the selected research method profile is on");
    }
  });
});

describe("PhoneStudy source-file uploads", () => {
  const render = (methodProfileSettingIds: readonly string[]): string =>
    renderToStaticMarkup(
      createElement(StudyInputsCard, {
        options: DEFAULT_BROWSER_OPTIONS,
        methodProfileSettingIds,
        studyDatesFile: null,
        setStudyDatesFile: () => {},
        deviceSharingFile: null,
        setDeviceSharingFile: () => {},
        surveyAttributionFile: null,
        setSurveyAttributionFile: () => {},
        enrolledDevicesFile: null,
        setEnrolledDevicesFile: () => {},
        inputCapabilityEvidenceFile: null,
        setInputCapabilityEvidenceFile: () => {},
        analysisFeatureMatrixFile: null,
        setAnalysisFeatureMatrixFile: () => {},
        callSmsEligibilityFile: null,
        setCallSmsEligibilityFile: () => {},
        phoneStudyPsCommunicationFile: null,
        setPhoneStudyPsCommunicationFile: () => {},
        phoneStudyEsFile: null,
        setPhoneStudyEsFile: () => {},
        anchorEventsFile: null,
        setAnchorEventsFile: () => {},
      }),
    );

  it("requires ps_communication only for the released relational join", () => {
    const html = render(["method-setting-faf89bac61ad22df438c751c"]);
    expect(html).toContain(
      'data-testid="phonestudy-ps-communication-file-input-needs-input"',
    );
    expect(html).not.toContain(
      'data-testid="phonestudy-es-file-input-needs-input"',
    );
    expect(html).toContain("id, type, length");
  });

  it("requires the ES questionnaire base for each registered downstream setting", () => {
    for (const settingId of [
      "method-setting-82e5e52c5cb3226a61e79545",
      "method-setting-9c0a51bb40b069aabe08c488",
      "method-setting-9bab1ec12ac7b8d13b09e1bc",
      "method-setting-2024dc3832e28339c35e77c6",
      "method-setting-25850bf69703fbf97a62f45a",
    ]) {
      const html = render([settingId]);
      expect(html, settingId).toContain(
        'data-testid="phonestudy-es-file-input-needs-input"',
      );
      expect(html, settingId).not.toContain(
        'data-testid="phonestudy-ps-communication-file-input-needs-input"',
      );
      expect(html).toContain("user_id, es_questionnaire_id");
    }
  });

  it("keeps both distinct source files optional for unrelated settings", () => {
    const html = render(["method-setting-unrelated"]);
    expect(html).not.toContain(
      'data-testid="phonestudy-ps-communication-file-input-needs-input"',
    );
    expect(html).not.toContain(
      'data-testid="phonestudy-es-file-input-needs-input"',
    );
    expect(html).toContain(
      '<input type="file" accept=".csv" data-testid="phonestudy-ps-communication-file-input"',
    );
    expect(html).toContain(
      '<input type="file" accept=".csv" data-testid="phonestudy-es-file-input"',
    );
    expect(html).toContain(
      '<input type="file" accept=".csv" data-testid="anchor-events-file-input"',
    );
    expect(html).toContain("participant_id, anchor_timestamp");
  });

  it("requires anchor events for each registered anchor-window boundary setting", () => {
    for (const settingId of [
      "method-setting-da25cc5253c1032953fd5cf4",
      "method-setting-269d943c93638026c80f3efc",
    ]) {
      const html = render([settingId]);
      expect(html, settingId).toContain(
        'data-testid="anchor-events-file-input-needs-input"',
      );
      expect(html, settingId).toContain("participant_id, anchor_timestamp");
      expect(html, settingId).toContain(
        "the selected research method profile is on",
      );
    }
  });
});
