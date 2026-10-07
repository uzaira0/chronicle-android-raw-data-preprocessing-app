import { useState, type ReactElement } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { BUILD_DATE, BUILD_SHA } from "@/lib/buildInfo";
import {
  collectDiagnosticEnvironment,
  formatDiagnosticReport,
  recentErrors,
} from "@/lib/diagnostics";
import { PREPROCESSOR_VERSION } from "@/lib/generatedInteractionTypes";

async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard access is denied without a user gesture or permission; the
    // dialog then shows the text for a manual copy.
    return false;
  }
}

async function buildDiagnosticReport(): Promise<string> {
  const environment = await collectDiagnosticEnvironment({
    appVersion: PREPROCESSOR_VERSION,
    buildSha: BUILD_SHA,
    buildDate: BUILD_DATE,
  });
  return formatDiagnosticReport(environment, recentErrors(), new Date().toISOString());
}

const COPIED = "Copied to the clipboard.";
const NOT_COPIED = "This browser blocked copying. Select the text below and copy it.";

/**
 * "Copy diagnostic report": the build, browser, storage and recent errors as
 * plain text for a bug report. Built on demand and only on this device; the
 * user decides whether to paste it anywhere. Shown in the footer and on the
 * crash screen.
 */
export function DiagnosticReportControl({
  className,
  testId = "copy-diagnostic-report",
}: {
  className: string;
  testId?: string;
}): ReactElement {
  const [report, setReport] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const open = async (): Promise<void> => {
    const text = await buildDiagnosticReport();
    setReport(text);
    setStatus((await copyText(text)) ? COPIED : NOT_COPIED);
  };

  return (
    <>
      <button
        type="button"
        className={className}
        data-testid={testId}
        onClick={() => {
          void open();
        }}
      >
        Copy diagnostic report
      </button>
      {report !== null ? (
        <ConfirmDialog
          title="Diagnostic report"
          confirmLabel="Copy again"
          cancelLabel="Close"
          tone="primary"
          testId="diagnostic-report-dialog"
          onCancel={() => setReport(null)}
          onConfirm={() => {
            void copyText(report).then((copied) => setStatus(copied ? COPIED : NOT_COPIED));
          }}
        >
          <p>
            This report stays on this device unless you paste it somewhere. It lists this
            app’s build, this browser, its storage and the errors recorded recently. It holds no
            file names, file contents, settings or results.
          </p>
          <p role="status" data-testid="diagnostic-report-status">
            {status}
          </p>
          <textarea
            className="input diagnostic-report__text"
            readOnly
            rows={12}
            aria-label="Diagnostic report text"
            data-testid="diagnostic-report-text"
            value={report}
          />
        </ConfirmDialog>
      ) : null}
    </>
  );
}
