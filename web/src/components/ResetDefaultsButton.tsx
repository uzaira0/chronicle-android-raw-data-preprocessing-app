import { useState } from "react";
import type { ReactElement } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import type { BrowserProcessingOptions } from "@/lib/types";

type Props = {
  options: BrowserProcessingOptions;
  onReset: (next: BrowserProcessingOptions) => void;
};

function isAnyModified(options: BrowserProcessingOptions): boolean {
  const keys = Object.keys(DEFAULT_BROWSER_OPTIONS) as Array<keyof BrowserProcessingOptions>;
  return keys.some((key) => {
    const fallback = DEFAULT_BROWSER_OPTIONS[key];
    const value = options[key];
    if (Array.isArray(fallback) || Array.isArray(value)) {
      const left = (fallback ?? []) as unknown[];
      const right = (value ?? []) as unknown[];
      if (left.length !== right.length) return true;
      return left.some((entry, index) => entry !== right[index]);
    }
    return fallback !== value;
  });
}

export function ResetDefaultsButton({ options, onReset }: Props): ReactElement {
  const [confirming, setConfirming] = useState(false);
  const dirty = isAnyModified(options);

  return (
    <>
      <button
        type="button"
        className="btn btn--ghost"
        onClick={() => setConfirming(true)}
        disabled={!dirty}
      >
        Reset all to defaults
      </button>
      {confirming ? (
        <ConfirmDialog
          title="Reset all settings to defaults?"
          confirmLabel="Reset all"
          tone="primary"
          testId="reset-defaults-dialog"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            onReset({ ...DEFAULT_BROWSER_OPTIONS });
            setConfirming(false);
          }}
        >
          <p>
            Every setting in every section will be returned to the canonical default.
            Your selected files (raw, filter, apps forcing screen open, codebook) are kept.
          </p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}
