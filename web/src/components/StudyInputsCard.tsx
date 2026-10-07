import { useEffect, useState } from "react";
import type { ReactElement } from "react";

import { SectionCard } from "@/components/SectionCard";
import {
  hasSourceSensitiveScreenStrategy,
  usesInputCapabilityEvidence,
} from "@/lib/inputCapabilityEvidence";
import { methodReceiptInputUses } from "@/lib/settingsPersistence";
import { SUPPORT_FILE_ACCEPT } from "@/lib/validation";
import { createSupportFilePickHandler } from "@/components/supportFilePick";
import {
  createDemoDisplayMasker,
  type DemoDisplayMasker,
} from "@/lib/demoDisplay";
import type { BrowserProcessingOptions } from "@/lib/types";

/**
 * Study Inputs — the external tables the Analyze steps consume. These are
 * study-specific, so there are NO bundled defaults: each slot is either the
 * user's upload or absent. A slot that an enabled Analyze option depends on
 * shows a "needs input" warning instead of silently doing nothing.
 */

type Props = {
  options: BrowserProcessingOptions;
  displayMasker?: DemoDisplayMasker;
  studyDatesFile: File | null;
  setStudyDatesFile: (file: File | null) => void;
  deviceSharingFile: File | null;
  setDeviceSharingFile: (file: File | null) => void;
  surveyAttributionFile: File | null;
  setSurveyAttributionFile: (file: File | null) => void;
  enrolledDevicesFile: File | null;
  setEnrolledDevicesFile: (file: File | null) => void;
  inputCapabilityEvidenceFile: File | null;
  setInputCapabilityEvidenceFile: (file: File | null) => void;
  analysisFeatureMatrixFile: File | null;
  setAnalysisFeatureMatrixFile: (file: File | null) => void;
  callSmsEligibilityFile: File | null;
  setCallSmsEligibilityFile: (file: File | null) => void;
  phoneStudyPsCommunicationFile: File | null;
  setPhoneStudyPsCommunicationFile: (file: File | null) => void;
  phoneStudyEsFile: File | null;
  setPhoneStudyEsFile: (file: File | null) => void;
  anchorEventsFile: File | null;
  setAnchorEventsFile: (file: File | null) => void;
  methodProfileSettingIds?: readonly string[];
};

type SlotStatus =
  | { kind: "loaded"; fileName: string; retainedOnly?: boolean }
  | { kind: "needs-input"; neededBy: string }
  | { kind: "needs-capability-evidence"; neededBy: string }
  | { kind: "optional"; usedBy: string | null };

export function StudyInputsCard(props: Props): ReactElement {
  const {
    options,
    studyDatesFile,
    setStudyDatesFile,
    deviceSharingFile,
    setDeviceSharingFile,
    surveyAttributionFile,
    setSurveyAttributionFile,
    enrolledDevicesFile,
    setEnrolledDevicesFile,
    inputCapabilityEvidenceFile,
    setInputCapabilityEvidenceFile,
    analysisFeatureMatrixFile,
    setAnalysisFeatureMatrixFile,
    callSmsEligibilityFile,
    setCallSmsEligibilityFile,
    phoneStudyPsCommunicationFile,
    setPhoneStudyPsCommunicationFile,
    phoneStudyEsFile,
    setPhoneStudyEsFile,
    anchorEventsFile,
    setAnchorEventsFile,
    methodProfileSettingIds = [],
    displayMasker,
  } = props;

  const statusFor = (
    file: File | null,
    neededBy: string | null,
    usedBy: string | null,
  ): SlotStatus => {
    if (file) return { kind: "loaded", fileName: file.name };
    if (neededBy) return { kind: "needs-input", neededBy };
    return { kind: "optional", usedBy };
  };

  const anyLoaded = Boolean(
    studyDatesFile ||
      deviceSharingFile ||
      surveyAttributionFile ||
      enrolledDevicesFile ||
      inputCapabilityEvidenceFile ||
      analysisFeatureMatrixFile ||
      callSmsEligibilityFile ||
      phoneStudyPsCommunicationFile ||
      phoneStudyEsFile ||
      anchorEventsFile,
  );
  const receiptUses = methodReceiptInputUses(methodProfileSettingIds);
  const analysisFeatureMatrixActive = receiptUses.analysisFeatureMatrix;
  const callSmsEligibilityActive = receiptUses.callSmsEligibility;
  const phoneStudyPsCommunicationActive = receiptUses.phoneStudyPsCommunication;
  const phoneStudyEsActive = receiptUses.phoneStudyEs;
  const anchorEventsActive = receiptUses.anchorEvents;
  const capabilityEvidenceActive = usesInputCapabilityEvidence(options)
    || receiptUses.inputCapabilityEvidence;
  const schoedelCapabilityEvidenceActive =
    options.processAppUsage &&
    options.episodeReconstructionStrategy ===
      "schoedel_2026_app_within_screen_prose_v1";
  const sourceSensitiveScreenEvidenceActive =
    options.processScreenUsage && hasSourceSensitiveScreenStrategy(options);
  const capabilityEvidenceNeededBy = schoedelCapabilityEvidenceActive
    ? sourceSensitiveScreenEvidenceActive
      ? "the Schoedel app reconstruction and the selected source-sensitive screen-session construction"
      : "the Schoedel app reconstruction and its bound B05 screen dependency"
    : receiptUses.inputCapabilityEvidence
      ? "the selected research method profile"
      : "the selected source-sensitive screen-session construction";

  return (
    <SectionCard id="study-inputs" title="Study inputs" accent="study" modified={anyLoaded}>
      <p className="u-card-intro">
        Study-specific tables consumed by the analysis steps below. There are no bundled
        defaults — a step that needs one of these tables reports it here until you upload it.
      </p>

      <StudyInputRow
        displayMasker={displayMasker}
        title="Study dates"
        columnsHint="participant_id, start_date, end_date; optional repeated rows: exclusion_label, exclusion_start_date, exclusion_end_date"
        file={studyDatesFile}
        onFileChange={setStudyDatesFile}
        testId="study-dates-file-input"
        status={statusFor(
          studyDatesFile,
          options.enableStudyWindowFilter ? "the study-window filter" : null,
          options.enableDayCoverage ? "the day coverage report (falls back to each participant's observed date range without it)" : null,
        )}
      />
      <StudyInputRow
        displayMasker={displayMasker}
        title="Device sharing"
        columnsHint="participant_id, sharing_status (Shared / Non-Shared)"
        file={deviceSharingFile}
        onFileChange={setDeviceSharingFile}
        testId="device-sharing-file-input"
        status={statusFor(
          deviceSharingFile,
          options.enablePersonAttribution ? "person attribution" : null,
          options.enableComplianceScoring
            ? "compliance scoring (without it every device scores as non-shared)"
            : null,
        )}
      />
      <StudyInputRow
        displayMasker={displayMasker}
        title="Usage survey answers"
        columnsHint="participant_id, event_timestamp, users"
        file={surveyAttributionFile}
        onFileChange={setSurveyAttributionFile}
        testId="survey-attribution-file-input"
        status={statusFor(
          surveyAttributionFile,
          null,
          options.enablePersonAttribution
            ? "person attribution (relabels sessions the survey attributes to someone else)"
            : null,
        )}
      />
      <StudyInputRow
        displayMasker={displayMasker}
        title="Enrolled devices"
        columnsHint="participant_id, device_count"
        file={enrolledDevicesFile}
        onFileChange={setEnrolledDevicesFile}
        testId="enrolled-devices-file-input"
        status={statusFor(
          enrolledDevicesFile,
          null,
          options.enableComplianceScoring
            ? "the compliance report (adds the expected device count per participant)"
            : null,
        )}
      />
      <StudyInputRow
        displayMasker={displayMasker}
        title="Analysis feature matrix"
        columnsHint="participant_id, feature_id (feature × temporal slice), value, missing_state, feature_set_id"
        file={analysisFeatureMatrixFile}
        onFileChange={setAnalysisFeatureMatrixFile}
        testId="analysis-feature-matrix-file-input"
        accept=".csv"
        formatHint=".csv only"
        status={statusFor(
          analysisFeatureMatrixFile,
          analysisFeatureMatrixActive ? "the selected research method profile" : null,
          analysisFeatureMatrixActive ? null : "feature-matrix missingness profiles",
        )}
      />
      <StudyInputRow
        displayMasker={displayMasker}
        title="Call/SMS eligibility"
        columnsHint="participant_id, modality_scope, availability_state, year_equivalent_exposure_numerator, year_equivalent_exposure_denominator"
        file={callSmsEligibilityFile}
        onFileChange={setCallSmsEligibilityFile}
        testId="call-sms-eligibility-file-input"
        accept=".csv"
        formatHint=".csv only"
        status={statusFor(
          callSmsEligibilityFile,
          callSmsEligibilityActive ? "the selected research method profile" : null,
          callSmsEligibilityActive ? null : "Call/SMS eligibility profiles",
        )}
      />
      <StudyInputRow
        displayMasker={displayMasker}
        title="PhoneStudy ps_communication"
        columnsHint="id, type, length"
        file={phoneStudyPsCommunicationFile}
        onFileChange={setPhoneStudyPsCommunicationFile}
        testId="phonestudy-ps-communication-file-input"
        accept=".csv"
        formatHint=".csv only"
        status={statusFor(
          phoneStudyPsCommunicationFile,
          phoneStudyPsCommunicationActive
            ? "the selected PhoneStudy ps_activity relational join"
            : null,
          phoneStudyPsCommunicationActive
            ? null
            : "the PhoneStudy ps_activity relational join",
        )}
      />
      <StudyInputRow
        displayMasker={displayMasker}
        title="PhoneStudy ES questionnaire base"
        columnsHint="user_id, es_questionnaire_id"
        file={phoneStudyEsFile}
        onFileChange={setPhoneStudyEsFile}
        testId="phonestudy-es-file-input"
        accept=".csv"
        formatHint=".csv only"
        status={statusFor(
          phoneStudyEsFile,
          phoneStudyEsActive
            ? "the selected PhoneStudy call/SMS feature profile"
            : null,
          phoneStudyEsActive
            ? null
            : "PhoneStudy call/SMS feature profiles",
        )}
      />
      <StudyInputRow
        displayMasker={displayMasker}
        title="Anchor events"
        columnsHint="participant_id, anchor_timestamp"
        file={anchorEventsFile}
        onFileChange={setAnchorEventsFile}
        testId="anchor-events-file-input"
        accept=".csv"
        formatHint=".csv only"
        status={statusFor(
          anchorEventsFile,
          anchorEventsActive ? "the selected research method profile" : null,
          anchorEventsActive ? null : "anchor-relative research method profiles",
        )}
      />
      <StudyInputRow
        displayMasker={displayMasker}
        title="Input capability evidence"
        columnsHint="schema_version, raw_input_sha256, participant_id, capability_id, state, evidence_basis, evidence_reference, evidence_sha256"
        file={inputCapabilityEvidenceFile}
        onFileChange={setInputCapabilityEvidenceFile}
        testId="input-capability-evidence-file-input"
        accept=".csv"
        formatHint=".csv only · chronicle-input-capability-evidence/v1"
        status={
          inputCapabilityEvidenceFile
            ? {
                kind: "loaded",
                fileName: inputCapabilityEvidenceFile.name,
                retainedOnly: !capabilityEvidenceActive,
              }
            : capabilityEvidenceActive
              ? {
                  kind: "needs-capability-evidence",
                  neededBy: capabilityEvidenceNeededBy,
                }
              : {
                  kind: "optional",
                  usedBy:
                    "Parry–Toth or Zhu screen construction, or the Schoedel app reconstruction (including its Chronicle B05 screen dependency)",
                }
        }
      />
    </SectionCard>
  );
}

const IDENTITY_MASKER = createDemoDisplayMasker(false);

type RowProps = {
  title: string;
  columnsHint: string;
  file: File | null;
  onFileChange: (next: File | null) => void;
  testId: string;
  status: SlotStatus;
  accept?: string;
  formatHint?: string;
  displayMasker?: DemoDisplayMasker;
};

function StudyInputRow(props: RowProps): ReactElement {
  // See SupportFileRow: `accept` is a dialog hint, so the format the runtime
  // refuses is refused here too, at pick time, instead of failing the batch.
  const [formatError, setFormatError] = useState<string | null>(null);
  const {
    title,
    columnsHint,
    file,
    onFileChange,
    testId,
    status,
    accept = SUPPORT_FILE_ACCEPT,
    formatHint = ".csv or .xlsx",
    displayMasker = IDENTITY_MASKER,
  } = props;
  // See SupportFileRow: a standing rejection is cleared by any change to the
  // slot that did not come from this picker.
  useEffect(() => {
    setFormatError(null);
  }, [file]);
  return (
    <div className="support-file-row">
      <div className="support-file-row__main">
        <div className="u-inline-cluster">
          <span className="settings-field__label">{title}</span>
          <span className="text-faint u-meta-xs">{formatHint} · columns: {columnsHint}</span>
        </div>
        <input
          type="file"
          accept={accept}
          data-testid={testId}
          aria-label={`Upload ${title}`}
          onChange={createSupportFilePickHandler({
            accept,
            displayMasker,
            onFileChange,
            onFormatError: setFormatError,
          })}
        />
        {formatError ? (
          <span
            className="error-text"
            role="alert"
            data-testid={`${testId}-format-error`}
          >
            {formatError}
          </span>
        ) : null}
        {/* Suppress ONLY the green "Loaded: …" line while a rejection stands —
            that is the contradictory red/green pair. The `needs-input` and
            `needs-capability-evidence` arms are warnings about a required
            table that is still missing, which a format rejection does not
            answer; hiding them left the blocking condition invisible for as
            long as the refusal stood. */}
        {formatError && status.kind === "loaded" ? null : status.kind ===
          "loaded" ? (
          <span className="support-file-state is-enabled">
            Loaded: {displayMasker.fileName(status.fileName)}
            {status.retainedOnly
              ? " · Retained with project files, but not sent for the current binding."
              : ""}
          </span>
        ) : status.kind === "needs-input" ? (
          <span className="warning-text" data-testid={`${testId}-needs-input`}>
            Needs input: {status.neededBy} is on but this table is not loaded. Upload it here,
            or turn that option off — the step cannot run without it.
          </span>
        ) : status.kind === "needs-capability-evidence" ? (
          <span className="warning-text" data-testid={`${testId}-needs-input`}>
            Applicability evidence needed by {status.neededBy}. Without the sidecar, scientific
            preflight returns input_capability_evidence_absent; it never falls back to the
            Chronicle strategy.
          </span>
        ) : status.usedBy ? (
          <span className="support-file-state">Optional: would be used by {status.usedBy}.</span>
        ) : (
          <span className="support-file-state">Not loaded. No enabled step uses it right now.</span>
        )}
      </div>
      {file ? (
        <button
          type="button"
          className="btn btn--ghost"
          data-testid={`${testId}-clear`}
          onClick={() => onFileChange(null)}
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}
