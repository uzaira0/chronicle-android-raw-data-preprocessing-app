import { memo } from "react";
import type { Dispatch, ReactElement, SetStateAction } from "react";

import { SettingsOverviewCard } from "@/components/SettingsOverviewCard";
import { SessionDetectionCard } from "@/components/SessionDetectionCard";
import { ScreenDetectionCard } from "@/components/ScreenDetectionCard";
import { InteractionSemanticsCard } from "@/components/InteractionSemanticsCard";
import type { RuntimeScientificPreflightReceipt } from "@/lib/generatedRuntimeBoundary";
import type { ComparisonFailure } from "@/lib/comparisonFailures";
import type { DemoDisplayMasker } from "@/lib/demoDisplay";
import { BROWSER_OPTION_TOOLTIPS } from "@/lib/generatedContract";
import { collectOptionRangeViolations } from "@/lib/validation";
import type { BrowserProcessingOptions } from "@/lib/types";

type Props = {
  options: BrowserProcessingOptions;
  setOptions: Dispatch<SetStateAction<BrowserProcessingOptions>>;
  onRun: () => void;
  onResetToA: () => void;
  onClose: () => void;
  running: boolean;
  error: string | null;
  scientificRefusal: RuntimeScientificPreflightReceipt | null;
  comparisonFailures?: ComparisonFailure[];
  displayMasker: DemoDisplayMasker;
  completedCount: number;
  fileCount: number;
};

const CompareConfigFields = memo(function CompareConfigFields({
  options,
  setOptions,
  disabled,
}: Pick<Props, "options" | "setOptions"> & { disabled: boolean }): ReactElement {
  return (
    <fieldset className="review-drawer__body" disabled={disabled}>
      <SettingsOverviewCard options={options} setOptions={setOptions} />
      <div className="settings-stack">
        <SessionDetectionCard options={options} setOptions={setOptions} />
        <ScreenDetectionCard options={options} setOptions={setOptions} />
        <InteractionSemanticsCard options={options} setOptions={setOptions} />
      </div>
    </fieldset>
  );
});

/**
 * Arm-B configuration drawer: the same settings controls the Settings tab uses,
 * seeded from the current run's config. Editing changes Arm B only; "Run
 * comparison" re-processes the selected file under it and diffs against Arm A.
 */
export function CompareConfigDrawer({
  options,
  setOptions,
  onRun,
  onResetToA,
  onClose,
  running,
  error,
  scientificRefusal,
  comparisonFailures = [],
  displayMasker,
  completedCount,
  fileCount,
}: Props): ReactElement {
  const armBRangeViolations = collectOptionRangeViolations(options);
  const refusedApplicability =
    scientificRefusal?.b05Schoedel.screenApplicability?.executable === false
      ? scientificRefusal.b05Schoedel.screenApplicability
      : scientificRefusal?.b05Schoedel.schoedelApplicability?.executable ===
          false
        ? scientificRefusal.b05Schoedel.schoedelApplicability
        : undefined;
  const refusalReason = refusedApplicability
    ? `${refusedApplicability.refusalReason ?? "refused"}/${refusedApplicability.refusalDetail ?? "unspecified"}`
    : scientificRefusal?.eyesInputPartition.disposition === "refused"
      ? `${scientificRefusal.eyesInputPartition.refusalReason ?? "refused"}/${scientificRefusal.eyesInputPartition.refusalDetail ?? "unspecified"}`
      : null;
  return (
    <div className="review-drawer" data-testid="review-compare-drawer">
      <div className="review-drawer__head">
        <span>
          Arm B config — re-processes {fileCount} loaded review{" "}
          {fileCount === 1 ? "file" : "files"} with up to 8 workers
        </span>
        <button type="button" className="review-drawer__close" onClick={onClose} aria-label="Close" disabled={running}>
          ✕
        </button>
      </div>
      <CompareConfigFields
        options={options}
        setOptions={setOptions}
        disabled={running}
      />
      {error ? (
        <p className="review-drawer__error" data-testid="review-compare-error">
          {displayMasker.text(
            error,
            comparisonFailures.flatMap(({ fileNames }) => fileNames),
          )}
        </p>
      ) : null}
      {scientificRefusal && comparisonFailures.length === 0 ? (
        <details
          className="review-drawer__error"
          data-testid="review-comparison-scientific-refusal"
        >
          <summary>
            Scientific preflight decision
            {refusalReason ? ` · ${refusalReason}` : ""}
          </summary>
          <pre>{JSON.stringify(scientificRefusal, null, 2)}</pre>
        </details>
      ) : null}
      {comparisonFailures.map((failure) =>
        failure.scientificPreflightRefusal ? (
          <details
            className="review-drawer__error"
            data-testid="review-comparison-file-scientific-refusal"
            key={failure.fileNames.join("\u0000")}
          >
            <summary>
              Scientific preflight decision ·{" "}
              {failure.fileNames
                .map((name) => displayMasker.fileName(name))
                .join(", ")}
            </summary>
            <pre>
              {JSON.stringify(failure.scientificPreflightRefusal, null, 2)}
            </pre>
          </details>
        ) : null,
      )}
      {/* Arm B dispatches its own kernel run, so it needs the same bounds gate
          the Process button has. Without it an emptied field in this drawer
          sent Number("") === 0 straight to the kernel — a 0 ns cap makes every
          session End-of-Usage-Missing while the comparison reports success. */}
      {armBRangeViolations.length > 0 ? (
        <p
          className="error-text"
          role="alert"
          data-testid="review-range-block"
        >
          {`Cannot run the comparison: ${armBRangeViolations
            .map(
              (violation) =>
                `${BROWSER_OPTION_TOOLTIPS[violation.key].title} (${violation.message.toLowerCase()})`,
            )
            .join("; ")}.`}
        </p>
      ) : null}
      <div className="review-drawer__foot">
        <button type="button" className="btn" onClick={onResetToA} disabled={running}>
          Reset to A
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={onRun}
          disabled={running || armBRangeViolations.length > 0}
          data-testid="review-run-comparison"
        >
          {running
            ? `Running… ${completedCount}/${fileCount}`
            : armBRangeViolations.length > 0
              ? "Fix out-of-range settings"
              : "Run comparison"}
        </button>
      </div>
    </div>
  );
}
