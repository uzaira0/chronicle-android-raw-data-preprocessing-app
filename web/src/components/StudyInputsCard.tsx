import type { ReactElement } from "react";

import { SectionCard } from "@/components/SectionCard";
import type { BrowserProcessingOptions } from "@/lib/types";

/**
 * Study Inputs — the external tables the Analyze steps consume. These are
 * study-specific, so there are NO bundled defaults: each slot is either the
 * user's upload or absent. A slot that an enabled Analyze option depends on
 * shows a "needs input" warning instead of silently doing nothing.
 */

type Props = {
  options: BrowserProcessingOptions;
  studyDatesFile: File | null;
  setStudyDatesFile: (file: File | null) => void;
  deviceSharingFile: File | null;
  setDeviceSharingFile: (file: File | null) => void;
  surveyAttributionFile: File | null;
  setSurveyAttributionFile: (file: File | null) => void;
  enrolledDevicesFile: File | null;
  setEnrolledDevicesFile: (file: File | null) => void;
};

type SlotStatus =
  | { kind: "loaded"; fileName: string }
  | { kind: "needs-input"; neededBy: string }
  | { kind: "optional"; usedBy: string | null };

export function studyInputsNeedingUpload(
  options: BrowserProcessingOptions,
  files: {
    studyDatesFile: File | null;
    deviceSharingFile: File | null;
  },
): string[] {
  const missing: string[] = [];
  if (options.enableStudyWindowFilter && !files.studyDatesFile) {
    missing.push("Study dates (needed by the study-window filter)");
  }
  if (options.enablePersonAttribution && !files.deviceSharingFile) {
    missing.push("Device sharing (needed by person attribution)");
  }
  return missing;
}

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
    studyDatesFile || deviceSharingFile || surveyAttributionFile || enrolledDevicesFile,
  );

  return (
    <SectionCard id="study-inputs" title="Study inputs" accent="study" modified={anyLoaded}>
      <p className="u-card-intro">
        Study-specific tables consumed by the analysis steps below. There are no bundled
        defaults — a step that needs one of these tables reports it here until you upload it.
      </p>

      <StudyInputRow
        title="Study dates"
        columnsHint="participant_id, start_date, end_date"
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
    </SectionCard>
  );
}

type RowProps = {
  title: string;
  columnsHint: string;
  file: File | null;
  onFileChange: (next: File | null) => void;
  testId: string;
  status: SlotStatus;
};

function StudyInputRow(props: RowProps): ReactElement {
  const { title, columnsHint, file, onFileChange, testId, status } = props;
  return (
    <div className="support-file-row">
      <div className="support-file-row__main">
        <div className="u-inline-cluster">
          <span className="settings-field__label">{title}</span>
          <span className="text-faint u-meta-xs">.csv or .xlsx · columns: {columnsHint}</span>
        </div>
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          data-testid={testId}
          aria-label={`Upload ${title}`}
          onChange={(event) => {
            onFileChange(event.target.files?.[0] ?? null);
            event.currentTarget.value = "";
          }}
        />
        {status.kind === "loaded" ? (
          <span className="support-file-state is-enabled">Loaded: {status.fileName}</span>
        ) : status.kind === "needs-input" ? (
          <span className="warning-text" data-testid={`${testId}-needs-input`}>
            Needs input: {status.neededBy} is on but this table is not loaded. Upload it here,
            or turn that option off — the step cannot run without it.
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
