import type { Dispatch, ReactElement, SetStateAction } from "react";

import { SettingsOverviewCard } from "@/components/SettingsOverviewCard";
import { SessionDetectionCard } from "@/components/SessionDetectionCard";
import { ScreenDetectionCard } from "@/components/ScreenDetectionCard";
import { InteractionSemanticsCard } from "@/components/InteractionSemanticsCard";
import type { BrowserProcessingOptions } from "@/lib/types";

type Props = {
  options: BrowserProcessingOptions;
  setOptions: Dispatch<SetStateAction<BrowserProcessingOptions>>;
  onRun: () => void;
  onResetToA: () => void;
  onClose: () => void;
  running: boolean;
  error: string | null;
  completedCount: number;
  fileCount: number;
};

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
  completedCount,
  fileCount,
}: Props): ReactElement {
  return (
    <div className="review-drawer" data-testid="review-compare-drawer">
      <div className="review-drawer__head">
        <span>
          Arm B config — re-processes {fileCount} loaded review{" "}
          {fileCount === 1 ? "file" : "files"} with up to 8 workers
        </span>
        <button type="button" className="review-drawer__close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="review-drawer__body">
        <SettingsOverviewCard options={options} setOptions={setOptions} />
        <div className="settings-stack">
          <SessionDetectionCard options={options} setOptions={setOptions} />
          <ScreenDetectionCard options={options} setOptions={setOptions} />
          <InteractionSemanticsCard options={options} setOptions={setOptions} />
        </div>
      </div>
      {error ? (
        <p className="review-drawer__error" data-testid="review-compare-error">
          {error}
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
          disabled={running}
          data-testid="review-run-comparison"
        >
          {running
            ? `Running… ${completedCount}/${fileCount}`
            : "Run comparison"}
        </button>
      </div>
    </div>
  );
}
